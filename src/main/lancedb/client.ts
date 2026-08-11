import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as lancedb from '@lancedb/lancedb';
import {
  EmbeddingModelInfo,
  embedTextForProvider,
  embedTextsForProvider,
  getAvailableEmbeddingModelInfos,
  pickDefaultEmbeddingModelInfo,
} from './embeddings';
import { getConfig } from '../config/storage';

const TABLE_NAME = 'memory';
const KNOWLEDGE_TABLE_NAME = 'knowledge';
const DEFAULT_TOP_K = 5;
const DEFAULT_KNOWLEDGE_TOP_K = 10;

const MIGRATION_SENTINEL_PREFIX = '.migrated-from-';
const MIGRATION_SENTINEL_NAME = `${MIGRATION_SENTINEL_PREFIX}legacy-jsonl`;

// Keep one connection/table per process (good for Electron main)
let connPromise: Promise<lancedb.Connection> | null = null;
const tablePromises = new Map<string, Promise<lancedb.Table>>();

// Simple migration lock (avoid duplicate imports if multiple calls happen early)
let migrationPromise: Promise<void> | null = null;

function getDbDir(dbPathFromConfig: string): string {
  // `databasePath` is a user-chosen folder. We'll keep LanceDB inside it.
  return path.join(dbPathFromConfig, 'lancedb');
}

function getLegacyJsonlPath(dbPathFromConfig: string): string {
  // Legacy versions stored the memory backing store at `${databasePath}.jsonl`
  return `${dbPathFromConfig}.jsonl`;
}

function sanitizeTablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}

function getEmbeddingTableName(baseName: string, info: EmbeddingModelInfo): string {
  return `${baseName}_${sanitizeTablePart(info.provider)}_${sanitizeTablePart(info.model)}`;
}

function getMigrationSentinelPath(dbDir: string): string {
  return path.join(dbDir, MIGRATION_SENTINEL_NAME);
}

function hasAnyMigrationSentinel(dbDir: string): boolean {
  try {
    const entries = fsSync.readdirSync(dbDir);
    return entries.some(name => typeof name === 'string' && name.startsWith(MIGRATION_SENTINEL_PREFIX));
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function getConnection(): Promise<lancedb.Connection> {
  if (!connPromise) {
    connPromise = (async () => {
      const cfg = getConfig();
      const dbDir = getDbDir(cfg.databasePath);
      await ensureDir(dbDir);
      return await lancedb.connect(dbDir);
    })();
  }
  return connPromise;
}

async function openOrCreateNamedTableWithRow(tableName: string, row: Record<string, unknown>): Promise<lancedb.Table> {
  const conn = await getConnection();

  try {
    return await conn.openTable(tableName);
  } catch {
    // Table doesn't exist yet; create it using the first row (vector inferred from `vector` field)
    // Note: createTable requires non-empty data, which we have here.
    return await conn.createTable(tableName, [row], { mode: 'create', existOk: true });
  }
}

async function getNamedTable(tableName: string): Promise<lancedb.Table> {
  if (!tablePromises.has(tableName)) {
    tablePromises.set(tableName, (async () => {
      const conn = await getConnection();
      try {
        const tbl = await conn.openTable(tableName);
        return tbl;
      } catch {
        throw new Error(`LanceDB table not created yet: ${tableName}`);
      }
    })());
  }
  return tablePromises.get(tableName)!;
}

async function getKnowledgeSelectColumns(table: lancedb.Table): Promise<string[]> {
  try {
    const schema: any = await table.schema();
    const fields: any[] = Array.isArray(schema?.fields) ? schema.fields : [];
    const fieldNames = new Set(fields.map((field) => field?.name).filter(Boolean));
    return ['id', 'content', 'metadata', 'profileId', 'fileId', 'fileName', 'chunkIndex', 'totalChunks', 'contentHash', '_distance']
      .filter((column) => column === '_distance' || fieldNames.has(column));
  } catch {
    return ['id', 'content', 'metadata', '_distance'];
  }
}

type StoredRow = {
  id: string;
  content: string;
  vector: number[];
  metadata?: string; // JSON string
  createdAt?: number;
  profileId?: string;
  fileId?: string;
  fileName?: string;
  chunkIndex?: number;
  totalChunks?: number;
  contentHash?: string;
};

function toStoredRow(params: { content: string; vector: number[]; metadata?: Record<string, any> }): StoredRow {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    content: params.content,
    vector: params.vector,
    metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    createdAt: Date.now(),
    profileId: typeof params.metadata?.profileId === 'string' ? params.metadata.profileId : undefined,
    fileId: typeof params.metadata?.fileId === 'string' ? params.metadata.fileId : undefined,
    fileName: typeof params.metadata?.fileName === 'string' ? params.metadata.fileName : undefined,
    chunkIndex: typeof params.metadata?.chunkIndex === 'number' ? params.metadata.chunkIndex : undefined,
    totalChunks: typeof params.metadata?.totalChunks === 'number' ? params.metadata.totalChunks : undefined,
    contentHash: typeof params.metadata?.contentHash === 'string' ? params.metadata.contentHash : undefined,
  };
}

function withEmbeddingMetadata(metadata: Record<string, any> | undefined, info: EmbeddingModelInfo): Record<string, any> {
  return {
    ...(metadata || {}),
    embeddingProvider: info.provider,
    embeddingModel: info.model,
    embeddingMode: info.mode,
  };
}

async function migrateFromLegacyJsonlIfNeeded(): Promise<void> {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const cfg = getConfig();
    const dbDir = getDbDir(cfg.databasePath);
    const sentinel = getMigrationSentinelPath(dbDir);
    const legacyJsonl = getLegacyJsonlPath(cfg.databasePath);

    await ensureDir(dbDir);

    if (hasAnyMigrationSentinel(dbDir)) return;
    if (!fsSync.existsSync(legacyJsonl)) {
      // No legacy file; mark as done so we don't check on every query
      await fs.writeFile(sentinel, 'no-legacy\n', 'utf-8');
      return;
    }

    const raw = await fs.readFile(legacyJsonl, 'utf-8').catch(() => '');
    const lines = raw.split(/\r?\n/).filter(Boolean);

    const entries: Array<{ content: string; metadata?: Record<string, any> }> = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const content = typeof parsed?.content === 'string' ? parsed.content : '';
        if (!content.trim()) continue;
        const metadata = parsed?.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : undefined;
        entries.push({ content, metadata });
      } catch {
        // ignore malformed lines
      }
    }

    if (entries.length === 0) {
      await fs.writeFile(sentinel, 'empty-legacy\n', 'utf-8');
      return;
    }

    // Build vectors in chunks (OpenAI supports batching, Gemini is sequential but still OK)
    const CHUNK = 32;

    let table: lancedb.Table | null = null;
    let info: EmbeddingModelInfo;
    try {
      info = pickDefaultEmbeddingModelInfo(cfg);
    } catch (error) {
      console.warn('[LanceDB] Legacy migration waiting for embedding provider configuration:', (error as any)?.message || error);
      return;
    }

    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const vectors = await embedTextsForProvider(cfg, info.provider, chunk.map(e => e.content));

      const rows: StoredRow[] = chunk.map((e, idx) => toStoredRow({
        content: e.content,
        vector: vectors[idx],
        metadata: withEmbeddingMetadata(e.metadata, info),
      }));

      if (!table) {
        // Create table using the first row in the first chunk
        const tableName = getEmbeddingTableName(TABLE_NAME, info);
        table = await openOrCreateNamedTableWithRow(tableName, rows[0]);
        tablePromises.set(tableName, Promise.resolve(table));
        // Append remaining rows (if any)
        if (rows.length > 1) {
          await table.add(rows.slice(1));
        }
      } else {
        await table.add(rows);
      }
    }

    await fs.writeFile(sentinel, `migrated ${entries.length}\n`, 'utf-8');
  })();

  return migrationPromise;
}

export async function queryDatabase(
  query: string,
  options?: { profileId?: string; includeKnowledge?: boolean; limit?: number }
): Promise<any[]> {
  const cfg = getConfig();
  const profileId = options?.profileId;
  const includeKnowledge = options?.includeKnowledge ?? true;
  const limit = options?.limit ?? DEFAULT_TOP_K;

  // Ensure migration happens once, best-effort. If it fails, we still allow empty DB usage.
  try {
    await migrateFromLegacyJsonlIfNeeded();
  } catch (e) {
    console.warn('[LanceDB] Migration skipped/failed:', (e as any)?.message || e);
  }

  const q = (query || '').trim();
  if (!q) return [];

  const results: any[] = [];

  // Try querying using *any available* embedding provider.
  // This allows users to switch chat provider (Gemini/OpenAI) while still accessing the same DB.
  const embeddingInfos = getAvailableEmbeddingModelInfos(cfg);
  if (embeddingInfos.length === 0) return [];

  // Query conversation memory with each provider (different embedding spaces).
  for (const info of embeddingInfos) {
    let qVec: number[];
    try {
      qVec = await embedTextForProvider(cfg, info.provider, q);
    } catch {
      continue;
    }

    const memoryTableNames = [getEmbeddingTableName(TABLE_NAME, info), TABLE_NAME];
    for (const tableName of memoryTableNames) {
      if (tableName === TABLE_NAME && info.provider !== 'openai') continue;

      try {
        const table = await getNamedTable(tableName);
        // Get more results than needed, then filter (LanceDB where clause is limited)
        const search = table.vectorSearch(qVec).limit(limit * 3).select(['id', 'content', 'metadata', '_distance']);
        const rows = await search.toArray();

      // Filter by profileId if provided (include profile-specific or global memories)
      const filteredRows = profileId
        ? rows.filter((r: any) => {
            try {
              const meta = typeof r?.metadata === 'string' ? JSON.parse(r.metadata) : r?.metadata;
              return !meta?.profileId || meta.profileId === profileId;
            } catch {
              return true; // Include if metadata parsing fails (legacy entries)
            }
          })
        : rows;

      results.push(
        ...(filteredRows || []).map((r: any) => {
          const distance = typeof r?._distance === 'number' ? r._distance : null;
          const score = distance === null ? null : 1 / (1 + distance);
          let metadata: any = undefined;
          if (typeof r?.metadata === 'string' && r.metadata.trim().length > 0) {
            try {
              metadata = JSON.parse(r.metadata);
            } catch {
              metadata = { raw: r.metadata };
            }
          }

          return {
            id: String(r?.id ?? ''),
            content: String(r?.content ?? ''),
            score: score ?? 0,
            metadata,
            distance,
            source: 'memory',
            embeddingProvider: info.provider,
            embeddingModel: info.model,
          };
        })
      );
      } catch {
        // No table yet.
      }
    }
  }

  // Query knowledge files if requested
  if (includeKnowledge && profileId) {
    for (const info of embeddingInfos) {
      let qVec: number[];
      try {
        qVec = await embedTextForProvider(cfg, info.provider, q);
      } catch {
        continue;
      }

      const knowledgeTableNames = [getEmbeddingTableName(KNOWLEDGE_TABLE_NAME, info), KNOWLEDGE_TABLE_NAME];
      for (const tableName of knowledgeTableNames) {
        if (tableName === KNOWLEDGE_TABLE_NAME && info.provider !== 'openai') continue;

      try {
        const knowledgeTable = await getNamedTable(tableName);
        const selectColumns = await getKnowledgeSelectColumns(knowledgeTable);
        const search = knowledgeTable
          .vectorSearch(qVec)
          .limit(DEFAULT_KNOWLEDGE_TOP_K * 2)
          .select(selectColumns);

        const rows = await search.toArray();

        // Filter by profileId
        const filteredRows = rows.filter((r: any) => {
          try {
            const meta = typeof r?.metadata === 'string' ? JSON.parse(r.metadata) : r?.metadata;
            return meta?.profileId === profileId;
          } catch {
            return false;
          }
        });

        results.push(
          ...(filteredRows || []).map((r: any) => {
            const distance = typeof r?._distance === 'number' ? r._distance : null;
            const score = distance === null ? null : 1 / (1 + distance);
            let metadata: any = undefined;
            if (typeof r?.metadata === 'string' && r.metadata.trim().length > 0) {
              try {
                metadata = JSON.parse(r.metadata);
              } catch {
                metadata = { raw: r.metadata };
              }
            }
            metadata = {
              ...(metadata || {}),
              ...(r?.profileId ? { profileId: r.profileId } : {}),
              ...(r?.fileId ? { fileId: r.fileId } : {}),
              ...(r?.fileName ? { fileName: r.fileName } : {}),
              ...(typeof r?.chunkIndex === 'number' ? { chunkIndex: r.chunkIndex } : {}),
              ...(typeof r?.totalChunks === 'number' ? { totalChunks: r.totalChunks } : {}),
              ...(r?.contentHash ? { contentHash: r.contentHash } : {}),
            };

            return {
              id: String(r?.id ?? ''),
              content: String(r?.content ?? ''),
              score: score ?? 0,
              metadata,
              distance,
              source: 'knowledge',
              embeddingProvider: info.provider,
              embeddingModel: info.model,
            };
          })
        );
      } catch {
        // No knowledge table yet
      }
      }
    }
  }

  // Sort by score (highest first) and return top results
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function addToDatabase(
  content: string,
  metadata?: Record<string, any>,
  options?: { isKnowledge?: boolean }
): Promise<void> {
  const cfg = getConfig();
  const isKnowledge = options?.isKnowledge ?? false;

  // Ensure migration runs before first insert (so new table doesn't conflict with importing)
  try {
    await migrateFromLegacyJsonlIfNeeded();
  } catch (e) {
    console.warn('[LanceDB] Migration skipped/failed:', (e as any)?.message || e);
  }

  const text = (content || '').trim();
  if (!text) return;

  const embedInfo = pickDefaultEmbeddingModelInfo(cfg);
  const vec = await embedTextForProvider(cfg, embedInfo.provider, text);
  const row = toStoredRow({ content: text, vector: vec, metadata: withEmbeddingMetadata(metadata, embedInfo) });
  const tableName = getEmbeddingTableName(isKnowledge ? KNOWLEDGE_TABLE_NAME : TABLE_NAME, embedInfo);

  if (isKnowledge) {
    let table: lancedb.Table;
    try {
      table = await getNamedTable(tableName);
    } catch {
      // Table doesn't exist yet; create it using this row
      table = await openOrCreateNamedTableWithRow(tableName, row);
      tablePromises.set(tableName, Promise.resolve(table));
      return;
    }
    await table.add([row]);
  } else {
    let table: lancedb.Table;
    try {
      table = await getNamedTable(tableName);
    } catch {
      // Table doesn't exist yet; create it using this row
      table = await openOrCreateNamedTableWithRow(tableName, row);
      tablePromises.set(tableName, Promise.resolve(table));
      return;
    }
    await table.add([row]);
  }
}

async function getTableColumns(table: lancedb.Table): Promise<string[]> {
  try {
    const schema: any = await table.schema();
    const fields: any[] = Array.isArray(schema?.fields) ? schema.fields : [];
    return fields.map((field) => field?.name).filter(Boolean);
  } catch {
    return [];
  }
}

export async function deleteFromDatabase(id: string, options?: { profileId?: string }): Promise<number> {
  const cfg = getConfig();
  const memoryId = (id || '').trim();
  if (!memoryId) return 0;

  const tableNames = new Set<string>([TABLE_NAME]);
  for (const info of getAvailableEmbeddingModelInfos(cfg)) {
    tableNames.add(getEmbeddingTableName(TABLE_NAME, info));
  }

  const escapedId = memoryId.replace(/'/g, "''");
  const escapedProfileId = options?.profileId?.replace(/'/g, "''");
  let deletedCount = 0;

  for (const tableName of tableNames) {
    try {
      const table = await getNamedTable(tableName);
      const columns = await getTableColumns(table);
      if (!columns.includes('id')) continue;

      const rows = await table.query().where(`id = '${escapedId}'`).limit(10).toArray();
      const matchingRows = escapedProfileId && columns.includes('profileId')
        ? rows.filter((row: any) => !row?.profileId || row.profileId === options?.profileId)
        : rows;

      if (matchingRows.length === 0) continue;

      await table.delete(`id = '${escapedId}'`);
      deletedCount += matchingRows.length;
    } catch (error: any) {
      const message = String(error?.message || error || '');
      if (!message.includes('LanceDB table not created yet')) {
        console.warn(`[LanceDB] Failed to delete memory from ${tableName}:`, message);
      }
    }
  }

  return deletedCount;
}

export async function deleteKnowledgeChunks(profileId: string, fileId: string): Promise<void> {
  const cfg = getConfig();
  const tableNames = new Set<string>([KNOWLEDGE_TABLE_NAME]);
  for (const info of getAvailableEmbeddingModelInfos(cfg)) {
    tableNames.add(getEmbeddingTableName(KNOWLEDGE_TABLE_NAME, info));
  }

  for (const tableName of tableNames) {
    try {
      const table = await getNamedTable(tableName);
      const selectColumns = await getKnowledgeSelectColumns(table);
      if (!selectColumns.includes('profileId') || !selectColumns.includes('fileId')) {
        console.warn(`[LanceDB] Knowledge chunk delete skipped for ${tableName} because the current table schema lacks profileId/fileId columns.`);
        continue;
      }
      const escapedProfileId = profileId.replace(/'/g, "''");
      const escapedFileId = fileId.replace(/'/g, "''");
      await table.delete(`profileId = '${escapedProfileId}' AND fileId = '${escapedFileId}'`);
    } catch (error: any) {
      const message = String(error?.message || error || '');
      if (!message.includes('LanceDB table not created yet')) {
        console.warn(`[LanceDB] Failed to delete knowledge chunks from ${tableName}:`, message);
      }
    }
  }
}

