/**
 * FuzzyMatcher - Fuzzy search for installed applications
 * 
 * Scans standard Windows directories for .exe and .lnk files and provides
 * fuzzy matching capabilities using Levenshtein distance algorithm.
 * 
 * Features:
 * - Indexes applications from Program Files, AppData, etc.
 * - Calculates similarity scores using Levenshtein distance
 * - Handles space normalization (tries both with and without spaces)
 * - Returns top 5 results ordered by confidence score
 * - Integrates with CacheManager for 24h caching
 */

import * as fs from 'fs';
import * as path from 'path';
import { FuzzyMatchResult, IndexedApp } from './types';
import { CacheManager } from './CacheManager';

export class FuzzyMatcher {
  private searchDirs: string[];
  private cacheManager: CacheManager;
  private indexCache: IndexedApp[] | null = null;
  private readonly CACHE_KEY_PREFIX = 'fuzzy_search:';
  private readonly INDEX_CACHE_KEY = 'fuzzy_index';

  constructor(searchDirs: string[], cacheManager: CacheManager) {
    this.searchDirs = searchDirs.map(dir => this.expandEnvVars(dir));
    this.cacheManager = cacheManager;
  }

  /**
   * Search for applications matching the user input
   * Returns top 5 results ordered by confidence score
   */
  async search(userInput: string, maxResults: number = 5): Promise<FuzzyMatchResult[]> {
    // Check cache first
    const cacheKey = `${this.CACHE_KEY_PREFIX}${userInput.toLowerCase()}`;
    const cached = this.cacheManager.get<FuzzyMatchResult[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get indexed applications
    const apps = await this.getIndexedApps();
    
    // Normalize input
    const normalizedInput = this.normalizeInput(userInput);
    const inputWithoutSpaces = userInput.replace(/\s+/g, '').toLowerCase();

    // Calculate similarity for all apps
    const results: FuzzyMatchResult[] = [];

    for (const app of apps) {
      // Try matching with original input
      const score1 = this.calculateSimilarity(userInput.toLowerCase(), app.normalizedName);
      
      // Try matching without spaces
      const score2 = this.calculateSimilarity(inputWithoutSpaces, app.normalizedName);
      
      // Use the better score
      const bestScore = Math.max(score1, score2);
      
      if (bestScore > 0) {
        results.push({
          name: app.name,
          executablePath: app.executablePath,
          confidenceScore: bestScore,
          matchType: this.getMatchType(bestScore, userInput.toLowerCase(), app.normalizedName)
        });
      }
    }

    // Sort by confidence score (descending) and take top N
    results.sort((a, b) => b.confidenceScore - a.confidenceScore);
    const topResults = results.slice(0, maxResults);

    // Cache the results for 24 hours
    const ttl = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    this.cacheManager.set(cacheKey, topResults, ttl);

    return topResults;
  }

  /**
   * Rebuild the application index
   * Can be called in background to refresh the index
   */
  async rebuildIndex(): Promise<void> {
    this.indexCache = null;
    this.cacheManager.invalidate(this.INDEX_CACHE_KEY);
    
    // Clear all search result caches
    this.cacheManager.clear();
    
    await this.indexApplications();
  }

  /**
   * Get indexed applications (from cache or by scanning)
   */
  private async getIndexedApps(): Promise<IndexedApp[]> {
    // Check memory cache first
    if (this.indexCache) {
      return this.indexCache;
    }

    // Check persistent cache
    const cached = this.cacheManager.get<IndexedApp[]>(this.INDEX_CACHE_KEY);
    if (cached) {
      this.indexCache = cached;
      return cached;
    }

    // Build new index
    const apps = await this.indexApplications();
    
    // Cache for 24 hours
    const ttl = 24 * 60 * 60 * 1000;
    this.cacheManager.set(this.INDEX_CACHE_KEY, apps, ttl);
    this.indexCache = apps;

    return apps;
  }

  /**
   * Scan directories and index all .exe and .lnk files
   */
  private async indexApplications(): Promise<IndexedApp[]> {
    const apps: IndexedApp[] = [];

    for (const dir of this.searchDirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }

      try {
        await this.scanDirectory(dir, apps);
      } catch (error) {
        // Log error but continue with other directories
        console.error(`Error scanning directory ${dir}:`, error);
      }
    }

    return apps;
  }

  /**
   * Recursively scan a directory for .exe and .lnk files
   */
  private async scanDirectory(dir: string, apps: IndexedApp[], depth: number = 0): Promise<void> {
    // Limit recursion depth to avoid performance issues
    if (depth > 5) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await this.scanDirectory(fullPath, apps, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          
          // Only index .exe and .lnk files
          if (ext === '.exe' || ext === '.lnk') {
            const nameWithoutExt = path.basename(entry.name, ext);
            
            apps.push({
              name: nameWithoutExt,
              executablePath: fullPath,
              normalizedName: this.normalizeInput(nameWithoutExt),
              directory: dir
            });
          }
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
      if ((error as any).code !== 'EPERM' && (error as any).code !== 'EACCES') {
        throw error;
      }
    }
  }

  /**
   * Calculate similarity between input and target using Levenshtein distance
   * Returns a confidence score between 0 and 1
   */
  private calculateSimilarity(input: string, target: string): number {
    const inputLower = input.toLowerCase();
    const targetLower = target.toLowerCase();

    // Exact match (case-insensitive)
    if (inputLower === targetLower) {
      return 0.95;
    }

    // Check for partial match first (input is substring of target)
    if (targetLower.includes(inputLower)) {
      // For partial matches, give a high score based on the ratio
      const ratio = inputLower.length / targetLower.length;
      return Math.min(0.85 + (ratio * 0.1), 0.94);
    }

    // Calculate Levenshtein distance for fuzzy matching
    const distance = this.levenshteinDistance(inputLower, targetLower);
    const maxLength = Math.max(inputLower.length, targetLower.length);
    
    // Convert distance to similarity score (0-1)
    const score = 1 - (distance / maxLength);

    return Math.max(0, score);
  }

  /**
   * Calculate Levenshtein distance between two strings
   * Returns the minimum number of single-character edits required
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    // Initialize first column
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    // Initialize first row
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Normalize input by removing spaces and converting to lowercase
   */
  private normalizeInput(input: string): string {
    return input.replace(/\s+/g, '').toLowerCase();
  }

  /**
   * Determine match type based on score and comparison
   */
  private getMatchType(score: number, input: string, target: string): 'exact' | 'fuzzy' | 'partial' {
    if (score >= 0.95) {
      return 'exact';
    } else if (target.includes(input)) {
      return 'partial';
    } else {
      return 'fuzzy';
    }
  }

  /**
   * Expand environment variables in paths
   */
  private expandEnvVars(dirPath: string): string {
    return dirPath.replace(/%([^%]+)%/g, (_, varName) => {
      return process.env[varName] || '';
    });
  }
}
