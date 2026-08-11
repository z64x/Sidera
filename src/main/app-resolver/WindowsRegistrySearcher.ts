/**
 * WindowsRegistrySearcher - Query Windows Registry for installed applications
 * 
 * Searches Windows Registry keys to find installed applications:
 * - HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths
 * - HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
 * - HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall (32-bit apps on 64-bit Windows)
 * 
 * Features:
 * - Case-insensitive DisplayName matching
 * - Executable path validation (checks if file exists)
 * - 1-hour caching via CacheManager
 * - PowerShell-based registry queries
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { CacheManager } from './CacheManager';
import { RegistryApp } from './types';

const execAsync = promisify(exec);

export class WindowsRegistrySearcher {
  private cacheManager: CacheManager;
  private readonly CACHE_KEY_PREFIX = 'registry:';
  private readonly CACHE_KEY_ALL_APPS = 'registry:all_apps';

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Search for applications matching the user input
   * Returns cached results if available (1h TTL)
   * 
   * @param userInput - User's search query (e.g., "Chrome", "File Pilot")
   * @returns Array of matching applications
   */
  async search(userInput: string): Promise<RegistryApp[]> {
    const normalizedInput = userInput.toLowerCase().trim();
    const cacheKey = `${this.CACHE_KEY_PREFIX}${normalizedInput}`;

    // Check cache first
    const cached = this.cacheManager.get<RegistryApp[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get all installed apps (this call is also cached)
    const allApps = await this.getAllInstalledApps();

    // Filter apps by case-insensitive DisplayName matching
    const matches = allApps.filter(app => {
      const displayName = app.displayName.toLowerCase();
      return displayName.includes(normalizedInput);
    });

    // Cache the search results for 1 hour
    const ttl = this.cacheManager['config'].registryTTL;
    this.cacheManager.set(cacheKey, matches, ttl);

    return matches;
  }

  /**
   * Get all installed applications from Windows Registry
   * Results are cached for 1 hour
   * 
   * @returns Array of all installed applications
   */
  async getAllInstalledApps(): Promise<RegistryApp[]> {
    // Check cache first
    const cached = this.cacheManager.get<RegistryApp[]>(this.CACHE_KEY_ALL_APPS);
    if (cached) {
      return cached;
    }

    const apps: RegistryApp[] = [];

    // Query App Paths registry key
    const appPathsApps = await this.queryAppPaths();
    apps.push(...appPathsApps);

    // Query Uninstall registry keys (both 64-bit and 32-bit)
    const uninstallApps = await this.queryUninstallKeys();
    apps.push(...uninstallApps);

    // Remove duplicates based on executable path
    const uniqueApps = this.deduplicateApps(apps);

    // Cache results for 1 hour
    const ttl = this.cacheManager['config'].registryTTL;
    this.cacheManager.set(this.CACHE_KEY_ALL_APPS, uniqueApps, ttl);

    return uniqueApps;
  }

  /**
   * Query HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths
   * This key contains registered application paths
   */
  private async queryAppPaths(): Promise<RegistryApp[]> {
    const keyPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths';
    return await this.queryAppPathsKey(keyPath);
  }

  /**
   * Query Uninstall registry keys for installed applications
   * Queries both 64-bit and 32-bit (WOW6432Node) locations
   */
  private async queryUninstallKeys(): Promise<RegistryApp[]> {
    const apps: RegistryApp[] = [];

    // 64-bit applications
    const key64 = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
    const apps64 = await this.queryUninstallKey(key64);
    apps.push(...apps64);

    // 32-bit applications on 64-bit Windows
    const key32 = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
    const apps32 = await this.queryUninstallKey(key32);
    apps.push(...apps32);

    return apps;
  }

  /**
   * Query App Paths registry key
   * Each subkey represents an application with a default value pointing to the executable
   */
  private async queryAppPathsKey(keyPath: string): Promise<RegistryApp[]> {
    const apps: RegistryApp[] = [];

    try {
      // Use a simpler PowerShell approach with timeout
      const script = `
        $apps = @();
        try {
          $items = Get-ChildItem -Path '${keyPath}' -ErrorAction SilentlyContinue;
          foreach ($item in $items) {
            try {
              $props = Get-ItemProperty -Path $item.PSPath -ErrorAction SilentlyContinue;
              $defaultValue = $props.'(default)';
              if ($defaultValue) {
                $apps += [PSCustomObject]@{
                  Name = $item.PSChildName;
                  Path = $defaultValue;
                };
              }
            } catch {}
          }
        } catch {}
        $apps | ConvertTo-Json -Compress;
      `.replace(/\n/g, ' ').trim();

      const { stdout } = await execAsync(`powershell -NoProfile -Command "${script}"`, {
        windowsHide: true,
        timeout: 10000 // 10 second timeout
      });

      if (!stdout.trim()) {
        return apps;
      }

      // Parse JSON output
      let appData: any[];
      try {
        const parsed = JSON.parse(stdout);
        appData = Array.isArray(parsed) ? parsed : [parsed];
      } catch (error) {
        return apps;
      }

      // Process each application
      for (const app of appData) {
        if (app.Path && await this.validateExecutable(app.Path)) {
          apps.push({
            displayName: app.Name.replace('.exe', ''),
            executablePath: app.Path
          });
        }
      }
    } catch (error: any) {
      // Silently fail - registry key might not exist or timeout
    }

    return apps;
  }

  /**
   * Query Uninstall registry key
   * Each subkey represents an installed application with DisplayName and InstallLocation/UninstallString
   */
  private async queryUninstallKey(keyPath: string): Promise<RegistryApp[]> {
    const apps: RegistryApp[] = [];

    try {
      // PowerShell script to query all subkeys and extract relevant properties
      const script = `
        $apps = @();
        try {
          $items = Get-ChildItem -Path '${keyPath}' -ErrorAction SilentlyContinue;
          foreach ($item in $items) {
            try {
              $props = Get-ItemProperty -Path $item.PSPath -ErrorAction SilentlyContinue;
              if ($props.DisplayName) {
                $apps += [PSCustomObject]@{
                  DisplayName = $props.DisplayName;
                  InstallLocation = $props.InstallLocation;
                  UninstallString = $props.UninstallString;
                  Publisher = $props.Publisher;
                  DisplayVersion = $props.DisplayVersion;
                };
              }
            } catch {}
          }
        } catch {}
        $apps | ConvertTo-Json -Compress;
      `.replace(/\n/g, ' ').trim();

      const { stdout } = await execAsync(`powershell -NoProfile -Command "${script}"`, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large output
        timeout: 15000 // 15 second timeout
      });

      if (!stdout.trim()) {
        return apps;
      }

      // Parse JSON output
      let appData: any[];
      try {
        const parsed = JSON.parse(stdout);
        // PowerShell returns single object if only one result, array otherwise
        appData = Array.isArray(parsed) ? parsed : [parsed];
      } catch (error) {
        return apps;
      }

      // Process each application
      for (const app of appData) {
        if (!app.DisplayName) continue;

        // Try to find executable path from InstallLocation or UninstallString
        const executablePath = await this.extractExecutablePath(app);

        if (executablePath && await this.validateExecutable(executablePath)) {
          apps.push({
            displayName: app.DisplayName,
            executablePath: executablePath,
            publisher: app.Publisher,
            version: app.DisplayVersion
          });
        }
      }
    } catch (error: any) {
      // Silently fail - registry key might not exist or timeout
    }

    return apps;
  }

  /**
   * Extract executable path from registry app data
   * Tries InstallLocation first, then parses UninstallString
   */
  private async extractExecutablePath(appData: any): Promise<string | null> {
    // Try InstallLocation + common executable names
    if (appData.InstallLocation) {
      const installLocation = appData.InstallLocation.trim();
      const displayName = appData.DisplayName.toLowerCase();

      // Common executable patterns
      const commonNames = [
        `${displayName}.exe`,
        `${displayName.replace(/\s+/g, '')}.exe`,
        'app.exe',
        'main.exe',
        'launcher.exe'
      ];

      for (const name of commonNames) {
        const path = `${installLocation}\\${name}`;
        if (existsSync(path)) {
          return path;
        }
      }
    }

    // Try to extract from UninstallString
    if (appData.UninstallString) {
      const uninstallString = appData.UninstallString.trim();
      
      // Extract path from quotes
      const quotedMatch = uninstallString.match(/"([^"]+\.exe)"/i);
      if (quotedMatch) {
        return quotedMatch[1];
      }

      // Extract path without quotes
      const pathMatch = uninstallString.match(/([A-Z]:\\[^"]+\.exe)/i);
      if (pathMatch) {
        return pathMatch[1];
      }
    }

    return null;
  }

  /**
   * Validate that an executable path exists on the filesystem
   * 
   * @param path - Path to validate
   * @returns true if path exists and is accessible
   */
  private async validateExecutable(path: string): Promise<boolean> {
    if (!path || path.trim() === '') {
      return false;
    }

    try {
      return existsSync(path.trim());
    } catch (error) {
      return false;
    }
  }

  /**
   * Remove duplicate applications based on executable path
   * Keeps the first occurrence of each unique path
   */
  private deduplicateApps(apps: RegistryApp[]): RegistryApp[] {
    const seen = new Set<string>();
    const unique: RegistryApp[] = [];

    for (const app of apps) {
      const normalizedPath = app.executablePath.toLowerCase();
      if (!seen.has(normalizedPath)) {
        seen.add(normalizedPath);
        unique.push(app);
      }
    }

    return unique;
  }
}
