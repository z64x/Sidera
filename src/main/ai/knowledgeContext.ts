import { Config } from '../../shared/types';
import { queryDatabase } from '../lancedb/client';

const KNOWLEDGE_TOP_K = 5;
const MAX_CONTEXT_CHARS = 4000;

export async function buildKnowledgeContext(config: Config, profileId: string | undefined, query: string): Promise<string> {
  if (!profileId || !query.trim()) return '';

  try {
    const results = await queryDatabase(query, {
      profileId,
      includeKnowledge: true,
      limit: KNOWLEDGE_TOP_K,
    });

    const knowledge = results
      .filter((result) => result.source === 'knowledge' && String(result.content || '').trim().length > 0)
      .slice(0, KNOWLEDGE_TOP_K);

    if (knowledge.length === 0) return '';

    let usedChars = 0;
    const sections: string[] = [];
    for (const [index, result] of knowledge.entries()) {
      const metadata = result.metadata || {};
      const fileName = metadata.fileName || 'document';
      const chunkInfo =
        typeof metadata.chunkIndex === 'number' && typeof metadata.totalChunks === 'number'
          ? `, fragment ${metadata.chunkIndex + 1}/${metadata.totalChunks}`
          : '';
      const header = `[${index + 1}] ${fileName}${chunkInfo}`;
      const remaining = MAX_CONTEXT_CHARS - usedChars - header.length - 8;
      if (remaining <= 0) break;
      const content = String(result.content).slice(0, remaining);
      usedChars += header.length + content.length + 4;
      sections.push(`${header}\n${content}`);
    }

    if (sections.length === 0) return '';

    return `CONTEXT DIN FISIERELE AGENTULUI:\n${sections.join('\n\n')}\n\nFoloseste contextul doar daca este relevant pentru intrebarea utilizatorului.`;
  } catch (error) {
    console.warn('[KnowledgeContext] Failed to build automatic knowledge context:', error);
    return '';
  }
}

export function appendKnowledgeContextToText(message: string, knowledgeContext: string): string {
  if (!knowledgeContext.trim()) return message;
  return `${message}\n\n${knowledgeContext}`;
}
