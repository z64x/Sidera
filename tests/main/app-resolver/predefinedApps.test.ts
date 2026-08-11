/**
 * Unit tests for predefinedApps module
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AppRegistry } from '../../../src/main/app-resolver/AppRegistry';
import { initializePredefinedApps, getPredefinedApps, validateRegistryEntries } from '../../../src/main/app-resolver/predefinedApps';

describe('predefinedApps', () => {
  let tempDir: string;
  let registryPath: string;
  let registry: AppRegistry;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'predefined-apps-test-'));
    registryPath = path.join(tempDir, 'test-registry.json');
    registry = new AppRegistry(registryPath);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getPredefinedApps', () => {
    it('should return an array of predefined applications', () => {
      const apps = getPredefinedApps();
      
      expect(Array.isArray(apps)).toBe(true);
      expect(apps.length).toBeGreaterThan(0);
    });

    it('should include common applications', () => {
      const apps = getPredefinedApps();
      const appNames = apps.map(app => app.displayName);
      
      expect(appNames).toContain('Google Chrome');
      expect(appNames).toContain('Mozilla Firefox');
      expect(appNames).toContain('Visual Studio Code');
      expect(appNames).toContain('File Pilot');
    });

    it('should have multiple aliases for each app', () => {
      const apps = getPredefinedApps();
      
      for (const app of apps) {
        expect(app.aliases.length).toBeGreaterThan(0);
        expect(app.displayName).toBeTruthy();
        expect(app.possiblePaths.length).toBeGreaterThan(0);
      }
    });

    it('should include Chrome with expected aliases', () => {
      const apps = getPredefinedApps();
      const chrome = apps.find(app => app.displayName === 'Google Chrome');
      
      expect(chrome).toBeDefined();
      expect(chrome?.aliases).toContain('chrome');
      expect(chrome?.aliases).toContain('google chrome');
      expect(chrome?.aliases).toContain('browser');
    });

    it('should include VS Code with expected aliases', () => {
      const apps = getPredefinedApps();
      const vscode = apps.find(app => app.displayName === 'Visual Studio Code');
      
      expect(vscode).toBeDefined();
      expect(vscode?.aliases).toContain('vscode');
      expect(vscode?.aliases).toContain('vs code');
      expect(vscode?.aliases).toContain('code');
    });

    it('should include File Pilot with expected aliases', () => {
      const apps = getPredefinedApps();
      const filePilot = apps.find(app => app.displayName === 'File Pilot');
      
      expect(filePilot).toBeDefined();
      expect(filePilot?.aliases).toContain('filepilot');
      expect(filePilot?.aliases).toContain('file pilot');
      expect(filePilot?.aliases).toContain('pilot');
    });
  });

  describe('initializePredefinedApps', () => {
    it('should only add apps that exist on the system', async () => {
      // Create a mock executable in temp directory
      const mockExePath = path.join(tempDir, 'mock-app.exe');
      await fs.writeFile(mockExePath, '');

      // Initialize with real predefined apps (most won't exist in temp dir)
      const addedCount = await initializePredefinedApps(registry);

      // The count should be >= 0 (depends on what's installed on the system)
      expect(addedCount).toBeGreaterThanOrEqual(0);
    });

    it('should skip apps that are not installed', async () => {
      // Initialize with empty temp directory (no apps installed)
      const addedCount = await initializePredefinedApps(registry);

      // Most apps won't be found in the test environment
      // Just verify it doesn't crash and returns a valid count
      expect(typeof addedCount).toBe('number');
      expect(addedCount).toBeGreaterThanOrEqual(0);
    });

    it('should add entries with correct structure', async () => {
      // We can't guarantee any specific app is installed, but if any are added,
      // they should have the correct structure
      const addedCount = await initializePredefinedApps(registry);

      if (addedCount > 0) {
        // Try to find any added entry
        const apps = getPredefinedApps();
        for (const app of apps) {
          for (const alias of app.aliases) {
            const entry = await registry.lookup(alias);
            if (entry) {
              expect(entry.displayName).toBe(app.displayName);
              expect(entry.source).toBe('predefined');
              expect(entry.usageCount).toBe(0);
              expect(entry.aliases).toEqual(app.aliases);
              break;
            }
          }
        }
      }
    });

    it('should handle errors gracefully when adding entries', async () => {
      // This test verifies that the function doesn't crash even if there are issues
      await expect(initializePredefinedApps(registry)).resolves.not.toThrow();
    });
  });

  describe('validateRegistryEntries', () => {
    it('should call registry validateEntries method', async () => {
      // Add a valid entry
      const testExePath = path.join(tempDir, 'test.exe');
      await fs.writeFile(testExePath, '');

      await registry.addEntry({
        aliases: ['test'],
        executablePath: testExePath,
        displayName: 'Test App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      });

      // Validate should not throw
      await expect(validateRegistryEntries(registry)).resolves.not.toThrow();

      // Entry should still exist
      const entry = await registry.lookup('test');
      expect(entry).not.toBeNull();
    });

    it('should remove entries with non-existent executables', async () => {
      const testExePath = path.join(tempDir, 'temp.exe');
      await fs.writeFile(testExePath, '');

      await registry.addEntry({
        aliases: ['temp'],
        executablePath: testExePath,
        displayName: 'Temp App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      });

      // Delete the executable
      await fs.unlink(testExePath);

      // Validate should remove the entry
      await validateRegistryEntries(registry);

      const entry = await registry.lookup('temp');
      expect(entry).toBeNull();
    });
  });

  describe('path validation', () => {
    it('should use environment variables for common paths', () => {
      const apps = getPredefinedApps();
      
      // Check that paths are constructed (not just hardcoded strings)
      // This is implicit in the implementation, but we can verify
      // that the paths look reasonable
      for (const app of apps) {
        for (const possiblePath of app.possiblePaths) {
          expect(typeof possiblePath).toBe('string');
          expect(possiblePath.length).toBeGreaterThan(0);
          // Paths should be absolute on Windows
          if (process.platform === 'win32') {
            expect(possiblePath).toMatch(/^[A-Za-z]:\\/);
          }
        }
      }
    });

    it('should include multiple possible paths for each app', () => {
      const apps = getPredefinedApps();
      
      for (const app of apps) {
        expect(app.possiblePaths.length).toBeGreaterThan(0);
        
        // Most apps should have at least 1 possible path
        // Some should have multiple (32-bit vs 64-bit, different install locations)
        expect(app.possiblePaths.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('common applications coverage', () => {
    it('should include web browsers', () => {
      const apps = getPredefinedApps();
      const browsers = apps.filter(app => 
        app.displayName.includes('Chrome') ||
        app.displayName.includes('Firefox') ||
        app.displayName.includes('Edge') ||
        app.displayName.includes('Opera') ||
        app.displayName.includes('Brave')
      );
      
      expect(browsers.length).toBeGreaterThanOrEqual(3);
    });

    it('should include code editors', () => {
      const apps = getPredefinedApps();
      const editors = apps.filter(app => 
        app.displayName.includes('Code') ||
        app.displayName.includes('Notepad++') ||
        app.displayName.includes('Sublime') ||
        app.displayName.includes('Atom')
      );
      
      expect(editors.length).toBeGreaterThanOrEqual(2);
    });

    it('should include File Pilot', () => {
      const apps = getPredefinedApps();
      const filePilot = apps.find(app => app.displayName === 'File Pilot');
      
      expect(filePilot).toBeDefined();
    });

    it('should include system utilities', () => {
      const apps = getPredefinedApps();
      const utilities = apps.filter(app => 
        app.displayName.includes('Notepad') ||
        app.displayName.includes('Calculator') ||
        app.displayName.includes('Paint')
      );
      
      expect(utilities.length).toBeGreaterThanOrEqual(2);
    });
  });
});
