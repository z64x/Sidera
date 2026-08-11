/**
 * Unit tests for AppRegistry
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AppRegistry } from '../../../src/main/app-resolver/AppRegistry';
import { AppRegistryEntry } from '../../../src/main/app-resolver/types';

describe('AppRegistry', () => {
  let tempDir: string;
  let registryPath: string;
  let registry: AppRegistry;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-registry-test-'));
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

  describe('lookup', () => {
    it('should return null for non-existent alias', async () => {
      const result = await registry.lookup('nonexistent');
      expect(result).toBeNull();
    });

    it('should perform case-insensitive lookup', async () => {
      const testExePath = path.join(tempDir, 'test.exe');
      await fs.writeFile(testExePath, '');

      const entry: AppRegistryEntry = {
        aliases: ['TestApp', 'test-app'],
        executablePath: testExePath,
        displayName: 'Test Application',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      await registry.addEntry(entry);

      // Test different case variations
      const result1 = await registry.lookup('testapp');
      const result2 = await registry.lookup('TESTAPP');
      const result3 = await registry.lookup('TestApp');
      const result4 = await registry.lookup('test-app');

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result3).not.toBeNull();
      expect(result4).not.toBeNull();
      expect(result1?.displayName).toBe('Test Application');
    });

    it('should handle aliases with leading/trailing spaces', async () => {
      const testExePath = path.join(tempDir, 'test.exe');
      await fs.writeFile(testExePath, '');

      const entry: AppRegistryEntry = {
        aliases: ['  spaced  '],
        executablePath: testExePath,
        displayName: 'Spaced App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      await registry.addEntry(entry);

      const result = await registry.lookup('spaced');
      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('Spaced App');
    });
  });

  describe('addEntry', () => {
    it('should add entry with valid executable path', async () => {
      const testExePath = path.join(tempDir, 'valid.exe');
      await fs.writeFile(testExePath, '');

      const entry: AppRegistryEntry = {
        aliases: ['valid'],
        executablePath: testExePath,
        displayName: 'Valid App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      await registry.addEntry(entry);

      const result = await registry.lookup('valid');
      expect(result).not.toBeNull();
      expect(result?.executablePath).toBe(testExePath);
    });

    it('should reject entry with non-existent executable path', async () => {
      const entry: AppRegistryEntry = {
        aliases: ['invalid'],
        executablePath: '/nonexistent/path/app.exe',
        displayName: 'Invalid App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      await expect(registry.addEntry(entry)).rejects.toThrow('Executable path does not exist');
    });

    it('should support multiple aliases for same executable', async () => {
      const testExePath = path.join(tempDir, 'multi.exe');
      await fs.writeFile(testExePath, '');

      const entry: AppRegistryEntry = {
        aliases: ['alias1', 'alias2', 'alias3'],
        executablePath: testExePath,
        displayName: 'Multi Alias App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      await registry.addEntry(entry);

      const result1 = await registry.lookup('alias1');
      const result2 = await registry.lookup('alias2');
      const result3 = await registry.lookup('alias3');

      expect(result1?.executablePath).toBe(testExePath);
      expect(result2?.executablePath).toBe(testExePath);
      expect(result3?.executablePath).toBe(testExePath);
    });

    it('should persist entry to disk', async () => {
      const testExePath = path.join(tempDir, 'persist.exe');
      await fs.writeFile(testExePath, '');

      const entry: AppRegistryEntry = {
        aliases: ['persist'],
        executablePath: testExePath,
        displayName: 'Persist App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      await registry.addEntry(entry);

      // Create new registry instance to test persistence
      const newRegistry = new AppRegistry(registryPath);
      const result = await newRegistry.lookup('persist');

      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('Persist App');
    });
  });

  describe('removeEntry', () => {
    it('should remove entry by alias', async () => {
      const testExePath = path.join(tempDir, 'remove.exe');
      await fs.writeFile(testExePath, '');

      const entry: AppRegistryEntry = {
        aliases: ['remove'],
        executablePath: testExePath,
        displayName: 'Remove App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      await registry.addEntry(entry);
      expect(await registry.lookup('remove')).not.toBeNull();

      await registry.removeEntry('remove');
      expect(await registry.lookup('remove')).toBeNull();
    });

    it('should handle removing non-existent alias gracefully', async () => {
      await expect(registry.removeEntry('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('updateUsage', () => {
    it('should increment usage count and update last used', async () => {
      const testExePath = path.join(tempDir, 'usage.exe');
      await fs.writeFile(testExePath, '');

      const entry: AppRegistryEntry = {
        aliases: ['usage'],
        executablePath: testExePath,
        displayName: 'Usage App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date('2024-01-01')
      };

      await registry.addEntry(entry);

      const beforeUpdate = await registry.lookup('usage');
      expect(beforeUpdate?.usageCount).toBe(0);

      await registry.updateUsage('usage');

      const afterUpdate = await registry.lookup('usage');
      expect(afterUpdate?.usageCount).toBe(1);
      expect(afterUpdate?.lastUsed.getTime()).toBeGreaterThan(new Date('2024-01-01').getTime());
    });

    it('should handle updating non-existent alias gracefully', async () => {
      await expect(registry.updateUsage('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('validateEntries', () => {
    it('should remove entries with non-existent executables', async () => {
      const validExePath = path.join(tempDir, 'valid.exe');
      const invalidExePath = path.join(tempDir, 'invalid.exe');
      
      // Create only the valid executable
      await fs.writeFile(validExePath, '');

      const validEntry: AppRegistryEntry = {
        aliases: ['valid'],
        executablePath: validExePath,
        displayName: 'Valid App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      const invalidEntry: AppRegistryEntry = {
        aliases: ['invalid'],
        executablePath: invalidExePath,
        displayName: 'Invalid App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      };

      await registry.addEntry(validEntry);
      
      // Manually add invalid entry by bypassing validation
      const newRegistry = new AppRegistry(registryPath);
      await fs.writeFile(invalidExePath, '');
      await newRegistry.addEntry(invalidEntry);
      await fs.unlink(invalidExePath);

      // Validate entries
      await newRegistry.validateEntries();

      expect(await newRegistry.lookup('valid')).not.toBeNull();
      expect(await newRegistry.lookup('invalid')).toBeNull();
    });
  });

  describe('persistence', () => {
    it('should handle corrupt JSON file gracefully', async () => {
      // Write corrupt JSON
      await fs.writeFile(registryPath, '{ invalid json }', 'utf-8');

      const newRegistry = new AppRegistry(registryPath);
      const result = await newRegistry.lookup('anything');

      expect(result).toBeNull();
    });

    it('should preserve Date objects through save/load cycle', async () => {
      const testExePath = path.join(tempDir, 'date.exe');
      await fs.writeFile(testExePath, '');

      const addedAt = new Date('2024-01-15T10:30:00Z');
      const lastUsed = new Date('2024-01-20T14:22:00Z');

      const entry: AppRegistryEntry = {
        aliases: ['datetest'],
        executablePath: testExePath,
        displayName: 'Date Test App',
        addedAt,
        source: 'predefined',
        usageCount: 5,
        lastUsed
      };

      await registry.addEntry(entry);

      // Load with new instance
      const newRegistry = new AppRegistry(registryPath);
      const result = await newRegistry.lookup('datetest');

      expect(result).not.toBeNull();
      expect(result?.addedAt).toBeInstanceOf(Date);
      expect(result?.lastUsed).toBeInstanceOf(Date);
      expect(result?.addedAt.toISOString()).toBe(addedAt.toISOString());
      expect(result?.lastUsed.toISOString()).toBe(lastUsed.toISOString());
    });
  });
});
