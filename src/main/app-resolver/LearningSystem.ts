/**
 * Smart App Resolution - Learning System Component
 * 
 * This module manages the learning system which tracks user interactions
 * with application resolutions. It learns from successes and failures,
 * calculates confidence scores, and promotes frequently used mappings
 * to the App Registry.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { LearningEntry, LearningData } from './types';
import { AppRegistry } from './AppRegistry';

/**
 * LearningSystem tracks application resolution successes and failures
 * to improve future resolutions through adaptive learning.
 */
export class LearningSystem {
  private data: LearningData;
  private storagePath: string;
  private registry: AppRegistry;
  private loaded: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(storagePath: string, registry: AppRegistry) {
    this.storagePath = storagePath;
    this.registry = registry;
    this.data = {
      version: '1.0.0',
      entries: []
    };
  }

  /**
   * Record a successful application launch
   * @param userInput - The user's input that was resolved
   * @param executablePath - The executable path that was successfully launched
   */
  async recordSuccess(userInput: string, executablePath: string): Promise<void> {
    await this.ensureLoaded();
    
    const normalized = this.normalizeInput(userInput);
    const existingEntry = this.findEntry(normalized, executablePath);

    if (existingEntry) {
      // Update existing entry
      existingEntry.successCount++;
      existingEntry.lastUsed = new Date();
    } else {
      // Create new entry
      const newEntry: LearningEntry = {
        userInput: normalized,
        executablePath,
        successCount: 1,
        failureCount: 0,
        firstSeen: new Date(),
        lastUsed: new Date(),
        promoted: false
      };
      this.data.entries.push(newEntry);
    }

    await this.save();
  }

  /**
   * Record a failed application launch attempt
   * @param userInput - The user's input that was attempted
   * @param executablePath - The executable path that failed to launch
   */
  async recordFailure(userInput: string, executablePath: string): Promise<void> {
    await this.ensureLoaded();
    
    const normalized = this.normalizeInput(userInput);
    const existingEntry = this.findEntry(normalized, executablePath);

    if (existingEntry) {
      // Update existing entry
      existingEntry.failureCount++;
      existingEntry.lastUsed = new Date();
    } else {
      // Create new entry with failure
      const newEntry: LearningEntry = {
        userInput: normalized,
        executablePath,
        successCount: 0,
        failureCount: 1,
        firstSeen: new Date(),
        lastUsed: new Date(),
        promoted: false
      };
      this.data.entries.push(newEntry);
    }

    await this.save();
  }

  /**
   * Lookup a learned mapping by user input
   * @param userInput - The user's input to search for
   * @returns The learning entry with highest confidence, or null if not found
   */
  async lookup(userInput: string): Promise<LearningEntry | null> {
    await this.ensureLoaded();
    
    const normalized = this.normalizeInput(userInput);
    
    // Find all entries matching the user input
    const matchingEntries = this.data.entries.filter(
      entry => entry.userInput === normalized && !entry.promoted
    );

    if (matchingEntries.length === 0) {
      return null;
    }

    // Return the entry with the highest confidence score
    let bestEntry = matchingEntries[0];
    let bestScore = this.getConfidenceScore(bestEntry);

    for (let i = 1; i < matchingEntries.length; i++) {
      const score = this.getConfidenceScore(matchingEntries[i]);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = matchingEntries[i];
      }
    }

    return bestEntry;
  }

  /**
   * Calculate confidence score for a learning entry
   * @param entry - The learning entry to score
   * @returns Confidence score between 0 and 0.95
   */
  getConfidenceScore(entry: LearningEntry): number {
    const total = entry.successCount + entry.failureCount;
    if (total === 0) {
      return 0;
    }
    
    // Cap at 0.95 to ensure learning system results are always
    // lower confidence than exact registry matches (1.0)
    const score = entry.successCount / total;
    return Math.min(score, 0.95);
  }

  /**
   * Promote entries with 3+ successes to the App Registry
   * This moves frequently used mappings to the permanent registry
   */
  async promoteToRegistry(): Promise<void> {
    await this.ensureLoaded();
    
    const entriesToPromote = this.data.entries.filter(
      entry => entry.successCount >= 3 && !entry.promoted
    );

    for (const entry of entriesToPromote) {
      try {
        // Check if executable still exists
        await fs.access(entry.executablePath);
        
        // Add to registry
        await this.registry.addEntry({
          aliases: [entry.userInput],
          executablePath: entry.executablePath,
          displayName: path.basename(entry.executablePath, path.extname(entry.executablePath)),
          addedAt: new Date(),
          source: 'learned',
          usageCount: entry.successCount,
          lastUsed: entry.lastUsed
        });

        // Mark as promoted
        entry.promoted = true;
      } catch (error) {
        // Skip entries with invalid paths
        console.error(`[LearningSystem] Failed to promote entry: ${entry.userInput}`, error);
      }
    }

    if (entriesToPromote.length > 0) {
      await this.save();
    }
  }

  /**
   * Remove entries that haven't been used in the last 90 days
   * This keeps the learning data fresh and relevant
   */
  async cleanup(): Promise<void> {
    await this.ensureLoaded();
    
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    
    const initialCount = this.data.entries.length;
    this.data.entries = this.data.entries.filter(
      entry => entry.lastUsed >= ninetyDaysAgo
    );
    
    const removedCount = initialCount - this.data.entries.length;
    if (removedCount > 0) {
      console.log(`[LearningSystem] Cleaned up ${removedCount} old entries`);
      await this.save();
    }
  }

  /**
   * Start periodic cleanup task
   * Runs cleanup every 24 hours and promotion check every hour
   * @param cleanupIntervalMs - Interval for cleanup in milliseconds (default: 24 hours)
   * @param promotionIntervalMs - Interval for promotion check in milliseconds (default: 1 hour)
   */
  startPeriodicTasks(
    cleanupIntervalMs: number = 24 * 60 * 60 * 1000,
    promotionIntervalMs: number = 60 * 60 * 1000
  ): void {
    // Stop any existing intervals
    this.stopPeriodicTasks();

    // Schedule cleanup task
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        console.error('[LearningSystem] Error during periodic cleanup:', error);
      }
    }, cleanupIntervalMs);

    // Schedule promotion task
    setInterval(async () => {
      try {
        await this.promoteToRegistry();
      } catch (error) {
        console.error('[LearningSystem] Error during periodic promotion:', error);
      }
    }, promotionIntervalMs);

    console.log('[LearningSystem] Periodic tasks started');
  }

  /**
   * Stop periodic cleanup task
   * Should be called when shutting down the application
   */
  stopPeriodicTasks(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[LearningSystem] Periodic tasks stopped');
    }
  }

  /**
   * Normalize user input for consistent matching
   * @param input - The user input to normalize
   * @returns Normalized input (lowercase, trimmed)
   */
  private normalizeInput(input: string): string {
    return input.toLowerCase().trim();
  }

  /**
   * Find an existing entry by user input and executable path
   * @param userInput - Normalized user input
   * @param executablePath - Executable path
   * @returns The matching entry or undefined
   */
  private findEntry(userInput: string, executablePath: string): LearningEntry | undefined {
    return this.data.entries.find(
      entry => entry.userInput === userInput && entry.executablePath === executablePath
    );
  }

  /**
   * Ensure the learning data is loaded from disk
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  /**
   * Load learning data from JSON file
   */
  private async load(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      
      // Convert date strings back to Date objects
      for (const entry of parsed.entries as LearningEntry[]) {
        entry.firstSeen = new Date(entry.firstSeen);
        entry.lastUsed = new Date(entry.lastUsed);
      }
      
      this.data = parsed;
      this.loaded = true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, start with empty data
        this.data = {
          version: '1.0.0',
          entries: []
        };
        this.loaded = true;
      } else if (error instanceof SyntaxError) {
        // Corrupt JSON file
        console.error('[LearningSystem] Corrupt learning data file, reinitializing');
        await this.backupAndReinitialize();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save learning data to JSON file
   */
  private async save(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.storagePath);
      await fs.mkdir(dir, { recursive: true });
      
      // Write with pretty formatting
      const jsonContent = JSON.stringify(this.data, null, 2);
      await fs.writeFile(this.storagePath, jsonContent, 'utf-8');
    } catch (error) {
      console.error('[LearningSystem] Error saving learning data:', error);
      throw error;
    }
  }

  /**
   * Backup corrupt file and reinitialize
   */
  private async backupAndReinitialize(): Promise<void> {
    try {
      const backupPath = `${this.storagePath}.backup.${Date.now()}`;
      await fs.copyFile(this.storagePath, backupPath);
      console.log(`[LearningSystem] Backed up corrupt file to ${backupPath}`);
    } catch {
      // Ignore backup errors
    }
    
    this.data = {
      version: '1.0.0',
      entries: []
    };
    this.loaded = true;
    await this.save();
  }
}
