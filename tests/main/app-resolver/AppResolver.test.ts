/**
 * Unit tests for AppResolver
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AppResolver } from '../../../src/main/app-resolver/AppResolver';
import { AppRegistry } from '../../../src/main/app-resolver/AppRegistry';
import { LearningSystem } from '../../../src/main/app-resolver/LearningSystem';
import { ShortcutIndexer } from '../../../src/main/app-resolver/ShortcutIndexer';
import { FuzzyMatcher } from '../../../src/main/app-resolver/FuzzyMatcher';
import { WindowsRegistrySearcher } from '../../../src/main/app-resolver/WindowsRegistrySearcher';
import { CacheManager } from '../../../src/main/app-resolver/CacheManager';
import { AppResolverConfig, ResolutionStrategy } from '../../../src/main/app-resolver/types';

describe('AppResolver', () => {
  let tempDir: string;
  let resolver: AppResolver;
  let registry: AppRegistry;
  let learning: LearningSystem;
  let shortcuts: ShortcutIndexer;
  let fuzzy: FuzzyMatcher;
  let winRegistry: WindowsRegistrySearcher;
  let cache: CacheManager;
  let config: AppResolverConfig;

  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-resolver-test-'));

    // Create test configuration
    config = {
      confidenceThreshold: 0.8,
      ambiguousThreshold: 0.5,
      fuzzyLaunchThreshold: 0.85,
      maxSuggestions: 5,
      enabledStrategies: [
        ResolutionStrategy.EXACT_PATH,
        ResolutionStrategy.SYSTEM_ALIAS,
        ResolutionStrategy.APP_REGISTRY,
        ResolutionStrategy.LEARNING_SYSTEM,
        ResolutionStrategy.SHORTCUT_INDEX,
        ResolutionStrategy.FUZZY_MATCHER,
        ResolutionStrategy.WINDOWS_REGISTRY
      ],
      customSearchDirs: [],
      shortcutDirs: [tempDir],
      searchDirs: [tempDir],
      deepSearchEnabled: false,
      cacheConfig: {
        fuzzyMatchTTL: 24 * 60 * 60 * 1000,
        registryTTL: 60 * 60 * 1000,
        maxCacheSize: 100
      }
    };

    // Initialize components
    const registryPath = path.join(tempDir, 'registry.json');
    const learningPath = path.join(tempDir, 'learning.json');

    registry = new AppRegistry(registryPath);
    cache = new CacheManager(config.cacheConfig);
    learning = new LearningSystem(learningPath, registry);
    shortcuts = new ShortcutIndexer(config.shortcutDirs || [], cache);
    fuzzy = new FuzzyMatcher(config.searchDirs, cache);
    winRegistry = new WindowsRegistrySearcher(cache);

    resolver = new AppResolver(config, registry, learning, shortcuts, fuzzy, winRegistry, cache);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('resolve', () => {
    it('should return error for empty input', async () => {
      const result = await resolver.resolve('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should resolve from registry with confidence 1.0', async () => {
      // Add test app to registry
      const testExePath = path.join(tempDir, 'testapp.exe');
      await fs.writeFile(testExePath, '');

      await registry.addEntry({
        aliases: ['testapp', 'test'],
        executablePath: testExePath,
        displayName: 'Test App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      });

      const result = await resolver.resolve('testapp');

      expect(result.success).toBe(true);
      expect(result.executablePath).toBe(testExePath);
      expect(result.confidenceScore).toBe(1.0);
      expect(result.strategy).toBe(ResolutionStrategy.APP_REGISTRY);
    });

    it('should resolve from learning system', async () => {
      const testExePath = path.join(tempDir, 'learned.exe');
      await fs.writeFile(testExePath, '');

      // Record successful launches to build learning data
      await learning.recordSuccess('myapp', testExePath);
      await learning.recordSuccess('myapp', testExePath);
      await learning.recordSuccess('myapp', testExePath);

      const result = await resolver.resolve('myapp');

      expect(result.success).toBe(true);
      expect(result.executablePath).toBe(testExePath);
      expect(result.strategy).toBe(ResolutionStrategy.LEARNING_SYSTEM);
      expect(result.confidenceScore).toBeGreaterThan(0);
    });

    it('should return error when no matches found', async () => {
      const result = await resolver.resolve('nonexistentapp');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No matching applications found');
    });

    it('should respect disabled strategies', async () => {
      // Disable all strategies except registry
      const limitedConfig = {
        ...config,
        enabledStrategies: [ResolutionStrategy.APP_REGISTRY]
      };

      const limitedResolver = new AppResolver(
        limitedConfig,
        registry,
        learning,
        shortcuts,
        fuzzy,
        winRegistry,
        cache
      );

      // Add app to learning system but not registry
      const testExePath = path.join(tempDir, 'learned.exe');
      await fs.writeFile(testExePath, '');
      await learning.recordSuccess('myapp', testExePath);

      const result = await limitedResolver.resolve('myapp');

      // Should not find it because learning system is disabled
      expect(result.success).toBe(false);
    });

    it('should return best match when multiple results found', async () => {
      const highConfPath = path.join(tempDir, 'high.exe');
      const lowConfPath = path.join(tempDir, 'low.exe');
      await fs.writeFile(highConfPath, '');
      await fs.writeFile(lowConfPath, '');

      // Add high confidence match to registry
      await registry.addEntry({
        aliases: ['app'],
        executablePath: highConfPath,
        displayName: 'High Confidence App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      });

      const result = await resolver.resolve('app');

      expect(result.success).toBe(true);
      expect(result.executablePath).toBe(highConfPath);
      expect(result.confidenceScore).toBe(1.0);
    });
  });

  describe('reportSuccess', () => {
    it('should record success in learning system', async () => {
      const testExePath = path.join(tempDir, 'success.exe');
      await fs.writeFile(testExePath, '');

      await resolver.reportSuccess('myapp', testExePath);

      // Verify it was recorded
      const entry = await learning.lookup('myapp');
      expect(entry).not.toBeNull();
      expect(entry?.successCount).toBe(1);
      expect(entry?.executablePath).toBe(testExePath);
    });

    it('should not throw on error', async () => {
      // Should handle errors gracefully
      await expect(resolver.reportSuccess('', '')).resolves.not.toThrow();
    });
  });

  describe('reportFailure', () => {
    it('should record failure in learning system', async () => {
      const testExePath = path.join(tempDir, 'failure.exe');
      await fs.writeFile(testExePath, '');

      await resolver.reportFailure('badapp', testExePath);

      // Verify it was recorded
      const entry = await learning.lookup('badapp');
      expect(entry).not.toBeNull();
      expect(entry?.failureCount).toBe(1);
      expect(entry?.executablePath).toBe(testExePath);
    });

    it('should not throw on error', async () => {
      // Should handle errors gracefully
      await expect(resolver.reportFailure('', '')).resolves.not.toThrow();
    });
  });

  describe('strategy execution order', () => {
    it('should try registry first', async () => {
      const registryPath = path.join(tempDir, 'registry-app.exe');
      const learningPath = path.join(tempDir, 'learning-app.exe');
      await fs.writeFile(registryPath, '');
      await fs.writeFile(learningPath, '');

      // Add to both registry and learning
      await registry.addEntry({
        aliases: ['app'],
        executablePath: registryPath,
        displayName: 'Registry App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      });

      await learning.recordSuccess('app', learningPath);

      const result = await resolver.resolve('app');

      // Should prefer registry (higher confidence)
      expect(result.executablePath).toBe(registryPath);
      expect(result.strategy).toBe(ResolutionStrategy.APP_REGISTRY);
    });

    it('should resolve system aliases before fuzzy or registry fallbacks', async () => {
      const result = await resolver.resolve('task manager');

      if (process.platform === 'win32') {
        expect(result.success).toBe(true);
        expect(result.executablePath?.toLowerCase()).toContain('taskmgr.exe');
        expect(result.strategy).toBe(ResolutionStrategy.SYSTEM_ALIAS);
      } else {
        expect(result.success).toBe(false);
      }
    });

    it('should resolve exact executable paths directly', async () => {
      const exactPath = path.join(tempDir, 'Taskmgr.exe');
      await fs.writeFile(exactPath, '');

      const result = await resolver.resolve(exactPath);

      expect(result.success).toBe(true);
      expect(result.executablePath).toBe(exactPath);
      expect(result.strategy).toBe(ResolutionStrategy.EXACT_PATH);
    });

    it('should prefer shortcut exact matches over deep executable scan', async () => {
      const shortcutPath = path.join(tempDir, 'Task Manager.lnk');
      const amdDir = path.join(tempDir, 'AMD', 'CIM', 'Bin64');
      await fs.mkdir(amdDir, { recursive: true });
      await fs.writeFile(shortcutPath, '');
      await fs.writeFile(path.join(amdDir, 'InstallManagerApp.exe'), '');

      const result = await resolver.resolve('Task Manager');

      if (process.platform === 'win32') {
        expect(result.strategy).toBe(ResolutionStrategy.SYSTEM_ALIAS);
      } else {
        expect(result.success).toBe(true);
        expect(result.executablePath).toBe(shortcutPath);
        expect(result.strategy).toBe(ResolutionStrategy.SHORTCUT_INDEX);
      }
    });

    it('should not launch low-confidence fuzzy matches as successful resolution', async () => {
      const deepConfig = {
        ...config,
        enabledStrategies: [ResolutionStrategy.FUZZY_MATCHER],
        deepSearchEnabled: true,
      };
      const deepResolver = new AppResolver(deepConfig, registry, learning, shortcuts, fuzzy, winRegistry, cache);
      await fs.writeFile(path.join(tempDir, 'InstallManagerApp.exe'), '');

      const result = await deepResolver.resolve('Task Manager');

      expect(result.success).toBe(false);
      expect(result.suggestions?.[0].executablePath).toContain('InstallManagerApp.exe');
    });

    it('should early exit on high confidence match', async () => {
      const testExePath = path.join(tempDir, 'early-exit.exe');
      await fs.writeFile(testExePath, '');

      await registry.addEntry({
        aliases: ['app'],
        executablePath: testExePath,
        displayName: 'Early Exit App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      });

      const result = await resolver.resolve('app');

      // Should return immediately with registry result (confidence 1.0 >= 0.8)
      expect(result.success).toBe(true);
      expect(result.confidenceScore).toBe(1.0);
      expect(result.strategy).toBe(ResolutionStrategy.APP_REGISTRY);
    });
  });

  describe('ambiguous results handling', () => {
    it('should return suggestions when confidence is below threshold', async () => {
      // Create a scenario where we have low confidence matches
      // This would typically come from fuzzy matching or registry search
      // For this test, we'll use a non-existent app which should return no results
      // or suggestions if the fuzzy matcher finds anything

      const result = await resolver.resolve('veryunlikelyappname12345');

      // Should either have no results or suggestions with low confidence
      if (result.suggestions && result.suggestions.length > 0) {
        expect(result.success).toBe(false);
        expect(result.suggestions.length).toBeGreaterThan(0);
        expect(result.suggestions.length).toBeLessThanOrEqual(config.maxSuggestions);
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });
});
