/**
 * Smart App Resolution - App Registry Component
 * 
 * This module manages the application registry database which stores
 * mappings between aliases and executable paths. It provides fast
 * case-insensitive lookup and persists data to JSON.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { AppRegistryEntry, AppRegistryData } from './types';

/**
 * AppRegistry manages a database of known applications and their aliases.
 * It provides case-insensitive lookup and JSON persistence.
 */
export class AppRegistry {
  private data: AppRegistryData;
  private storagePath: string;
  private loaded: boolean = false;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.data = {
      version: '1.0.0',
      entries: {}
    };
  }

  /**
   * Lookup an application by alias (case-insensitive)
   * @param alias - The alias to search for
   * @returns The registry entry if found, null otherwise
   */
  async lookup(alias: string): Promise<AppRegistryEntry | null> {
    await this.ensureLoaded();
    const normalized = this.normalize(alias);
    return this.data.entries[normalized] || null;
  }

  /**
   * Add a new entry to the registry
   * @param entry - The registry entry to add
   */
  async addEntry(entry: AppRegistryEntry): Promise<void> {
    await this.ensureLoaded();
    
    // Validate that the executable exists
    try {
      await fs.access(entry.executablePath);
    } catch {
      throw new Error(`Executable path does not exist: ${entry.executablePath}`);
    }

    // Add entry for each alias
    for (const alias of entry.aliases) {
      const normalized = this.normalize(alias);
      this.data.entries[normalized] = entry;
    }

    await this.save();
  }

  /**
   * Remove an entry by alias
   * @param alias - The alias to remove
   */
  async removeEntry(alias: string): Promise<void> {
    await this.ensureLoaded();
    const normalized = this.normalize(alias);
    
    if (this.data.entries[normalized]) {
      delete this.data.entries[normalized];
      await this.save();
    }
  }

  /**
   * Update usage statistics for an alias
   * @param alias - The alias that was used
   */
  async updateUsage(alias: string): Promise<void> {
    await this.ensureLoaded();
    const normalized = this.normalize(alias);
    const entry = this.data.entries[normalized];
    
    if (entry) {
      entry.usageCount++;
      entry.lastUsed = new Date();
      await this.save();
    }
  }

  /**
   * Validate all entries to ensure executables still exist
   * Removes entries with invalid paths
   */
  async validateEntries(): Promise<void> {
    await this.ensureLoaded();
    const invalidAliases: string[] = [];

    for (const [alias, entry] of Object.entries(this.data.entries)) {
      try {
        await fs.access(entry.executablePath);
      } catch {
        invalidAliases.push(alias);
      }
    }

    // Remove invalid entries
    for (const alias of invalidAliases) {
      delete this.data.entries[alias];
    }

    if (invalidAliases.length > 0) {
      await this.save();
    }
  }

  /**
   * Normalize an alias for case-insensitive matching
   * @param alias - The alias to normalize
   * @returns Normalized alias (lowercase, trimmed)
   */
  private normalize(alias: string): string {
    return alias.toLowerCase().trim();
  }

  /**
   * Ensure the registry data is loaded from disk
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  /**
   * Load registry data from JSON file
   */
  private async load(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      
      // Convert date strings back to Date objects
      for (const entry of Object.values(parsed.entries) as AppRegistryEntry[]) {
        entry.addedAt = new Date(entry.addedAt);
        entry.lastUsed = new Date(entry.lastUsed);
      }
      
      this.data = parsed;
      this.loaded = true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, start with empty registry
        this.data = {
          version: '1.0.0',
          entries: {}
        };
        this.loaded = true;
      } else if (error instanceof SyntaxError) {
        // Corrupt JSON file
        console.error('[AppRegistry] Corrupt registry file, reinitializing');
        await this.backupAndReinitialize();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save registry data to JSON file
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
      console.error('[AppRegistry] Error saving registry:', error);
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
      console.log(`[AppRegistry] Backed up corrupt file to ${backupPath}`);
    } catch {
      // Ignore backup errors
    }
    
    this.data = {
      version: '1.0.0',
      entries: {}
    };
    this.loaded = true;
    await this.save();
  }
}
