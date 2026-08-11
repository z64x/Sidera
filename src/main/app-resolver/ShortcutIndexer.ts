import * as fs from 'fs';
import * as path from 'path';
import { CacheManager } from './CacheManager';
import { FuzzyMatchResult, IndexedApp } from './types';

const SHORTCUT_EXTENSIONS = new Set(['.lnk', '.url', '.appref-ms']);

export class ShortcutIndexer {
  private readonly shortcutDirs: string[];
  private indexCache: IndexedApp[] | null = null;
  private readonly INDEX_CACHE_KEY = 'shortcut_index';
  private readonly CACHE_KEY_PREFIX = 'shortcut_search:';

  constructor(shortcutDirs: string[], private readonly cacheManager: CacheManager) {
    this.shortcutDirs = shortcutDirs.map((dir) => this.expandEnvVars(dir));
  }

  async search(userInput: string, maxResults = 5): Promise<FuzzyMatchResult[]> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${userInput.toLowerCase().trim()}`;
    const cached = this.cacheManager.get<FuzzyMatchResult[]>(cacheKey);
    if (cached) return cached;

    const apps = await this.getIndexedApps();
    const input = this.normalize(userInput);
    const inputNoSpaces = input.replace(/\s+/g, '');

    const results = apps
      .map((app) => {
        const score = Math.max(
          this.calculateSimilarity(input, app.normalizedName),
          this.calculateSimilarity(inputNoSpaces, app.normalizedName.replace(/\s+/g, ''))
        );
        return {
          name: app.name,
          executablePath: app.executablePath,
          confidenceScore: score,
          matchType: this.getMatchType(score, input, app.normalizedName),
        } as FuzzyMatchResult;
      })
      .filter((result) => result.confidenceScore > 0)
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, maxResults);

    this.cacheManager.set(cacheKey, results, this.cacheManager['config'].fuzzyMatchTTL);
    return results;
  }

  async rebuildIndex(): Promise<void> {
    this.indexCache = null;
    this.cacheManager.invalidate(this.INDEX_CACHE_KEY);
    await this.indexShortcuts();
  }

  private async getIndexedApps(): Promise<IndexedApp[]> {
    if (this.indexCache) return this.indexCache;
    const cached = this.cacheManager.get<IndexedApp[]>(this.INDEX_CACHE_KEY);
    if (cached) {
      this.indexCache = cached;
      return cached;
    }
    const apps = await this.indexShortcuts();
    this.cacheManager.set(this.INDEX_CACHE_KEY, apps, this.cacheManager['config'].fuzzyMatchTTL);
    this.indexCache = apps;
    return apps;
  }

  private async indexShortcuts(): Promise<IndexedApp[]> {
    const apps: IndexedApp[] = [];
    const seen = new Set<string>();

    for (const dir of this.shortcutDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        this.scanDirectory(dir, apps, seen);
      } catch (error) {
        console.error(`[ShortcutIndexer] Error scanning ${dir}:`, error);
      }
    }

    return apps;
  }

  private scanDirectory(dir: string, apps: IndexedApp[], seen: Set<string>, depth = 0): void {
    if (depth > 5) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error: any) {
      if (error.code === 'EPERM' || error.code === 'EACCES') return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.scanDirectory(fullPath, apps, seen, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SHORTCUT_EXTENSIONS.has(ext)) continue;

      const key = fullPath.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const name = path.basename(entry.name, ext);
      apps.push({
        name,
        executablePath: fullPath,
        normalizedName: this.normalize(name),
        directory: dir,
      });
    }
  }

  private calculateSimilarity(input: string, target: string): number {
    if (!input || !target) return 0;
    if (input === target) return 0.98;
    if (target.includes(input)) {
      const ratio = input.length / target.length;
      return Math.min(0.86 + ratio * 0.1, 0.96);
    }

    const distance = this.levenshteinDistance(input, target);
    const maxLength = Math.max(input.length, target.length);
    return Math.max(0, 1 - distance / maxLength);
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
    return matrix[b.length][a.length];
  }

  private getMatchType(score: number, input: string, target: string): 'exact' | 'fuzzy' | 'partial' {
    if (input === target) return 'exact';
    if (target.includes(input)) return 'partial';
    return score >= 0.85 ? 'fuzzy' : 'fuzzy';
  }

  private normalize(input: string): string {
    return input.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private expandEnvVars(inputPath: string): string {
    return inputPath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
  }
}
