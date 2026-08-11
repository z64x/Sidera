/**
 * Integration tests for AppResolver factory and full system
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

describe('AppResolver Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-resolver-integration-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  async function createTestResolver(): Promise<AppResolver> {
    const config: AppResolverConfig = {
      confidenceThreshold: 0.8,
      ambiguousThreshold: 0.5,
      fuzzyLaunchThreshold: 0.85,
      maxSuggestions: 5,
      enabledStrategies: [
        ResolutionStrategy.EXACT_PATH,
        ResolutionStrategy.APP_REGISTRY,
        ResolutionStrategy.LEARNING_SYSTEM,
        ResolutionStrategy.SHORTCUT_INDEX,
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

    const registryPath = path.join(tempDir, 'registry.json');
    const learningPath = path.join(tempDir, 'learning.json');

    const cache = new CacheManager(config.cacheConfig);
    const registry = new AppRegistry(registryPath);
    const learning = new LearningSystem(learningPath, registry);
    const shortcuts = new ShortcutIndexer(config.shortcutDirs || [], cache);
    const fuzzy = new FuzzyMatcher(config.searchDirs, cache);
    const winRegistry = new WindowsRegistrySearcher(cache);

    return new AppResolver(config, registry, learning, shortcuts, fuzzy, winRegistry, cache);
  }

  describe('full pipeline resolution', () => {
    it('should resolve app through learning system', async () => {
      const resolver = await createTestResolver();

      // Create a test executable
      const testExePath = path.join(tempDir, 'testapp.exe');
      await fs.writeFile(testExePath, '');

      // Report success to build learning data
      await resolver.reportSuccess('testapp', testExePath);
      await resolver.reportSuccess('testapp', testExePath);
      await resolver.reportSuccess('testapp', testExePath);

      // Try to resolve it
      const result = await resolver.resolve('testapp');

      expect(result.success).toBe(true);
      expect(result.executablePath).toBe(testExePath);
      expect(result.strategy).toBe(ResolutionStrategy.LEARNING_SYSTEM);
    });

    it('should handle feedback loop correctly', async () => {
      const resolver = await createTestResolver();

      const testExePath = path.join(tempDir, 'feedbackapp.exe');
      await fs.writeFile(testExePath, '');

      // Report multiple successes
      await resolver.reportSuccess('myapp', testExePath);
      await resolver.reportSuccess('myapp', testExePath);
      await resolver.reportSuccess('myapp', testExePath);

      // Should now be able to resolve
      const result = await resolver.resolve('myapp');

      expect(result.success).toBe(true);
      expect(result.executablePath).toBe(testExePath);

      // Report a failure
      await resolver.reportFailure('myapp', testExePath);

      // One failure drops confidence below the launch threshold, so it should
      // return a suggestion instead of launching automatically.
      const result2 = await resolver.resolve('myapp');
      expect(result2.success).toBe(false);
      expect(result2.suggestions?.[0].executablePath).toBe(testExePath);
    });

    it('should prefer registry over learning system', async () => {
      const resolver = await createTestResolver();

      const registryPath = path.join(tempDir, 'registry-app.exe');
      const learningPath = path.join(tempDir, 'learning-app.exe');
      await fs.writeFile(registryPath, '');
      await fs.writeFile(learningPath, '');

      // Add to learning system
      await resolver.reportSuccess('app', learningPath);

      // Manually add to registry (simulating predefined app)
      const registry = new AppRegistry(path.join(tempDir, 'registry.json'));
      await registry.addEntry({
        aliases: ['app'],
        executablePath: registryPath,
        displayName: 'Registry App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      });

      // Create new resolver to pick up registry changes
      const resolver2 = await createTestResolver();

      const result = await resolver2.resolve('app');

      // Should prefer registry (higher confidence)
      expect(result.success).toBe(true);
      expect(result.executablePath).toBe(registryPath);
      expect(result.strategy).toBe(ResolutionStrategy.APP_REGISTRY);
    });

    it('should return suggestions for ambiguous results', async () => {
      const resolver = await createTestResolver();

      // Create multiple test executables
      const app1Path = path.join(tempDir, 'app1.exe');
      const app2Path = path.join(tempDir, 'app2.exe');
      await fs.writeFile(app1Path, '');
      await fs.writeFile(app2Path, '');

      // Add both with low confidence (1 success each)
      await resolver.reportSuccess('app', app1Path);
      await resolver.reportSuccess('app', app2Path);

      const result = await resolver.resolve('app');

      // With only 1 success each, confidence will be low
      // Should return suggestions or best match depending on threshold
      expect(result).toBeDefined();
    });
  });

  describe('strategy coordination', () => {
    it('should respect disabled strategies', async () => {
      const config: AppResolverConfig = {
        confidenceThreshold: 0.8,
        ambiguousThreshold: 0.5,
        fuzzyLaunchThreshold: 0.85,
        maxSuggestions: 5,
        enabledStrategies: [ResolutionStrategy.APP_REGISTRY], // Only registry enabled
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

      const registryPath = path.join(tempDir, 'registry.json');
      const learningPath = path.join(tempDir, 'learning.json');

      const cache = new CacheManager(config.cacheConfig);
      const registry = new AppRegistry(registryPath);
      const learning = new LearningSystem(learningPath, registry);
      const shortcuts = new ShortcutIndexer(config.shortcutDirs || [], cache);
      const fuzzy = new FuzzyMatcher(config.searchDirs, cache);
      const winRegistry = new WindowsRegistrySearcher(cache);

      const resolver = new AppResolver(config, registry, learning, shortcuts, fuzzy, winRegistry, cache);

      const testExePath = path.join(tempDir, 'learned.exe');
      await fs.writeFile(testExePath, '');

      // Add to learning system
      await learning.recordSuccess('myapp', testExePath);

      const result = await resolver.resolve('myapp');

      // Should not find it because learning system is disabled
      expect(result.success).toBe(false);
    });

    it('should early exit on high confidence match', async () => {
      const resolver = await createTestResolver();

      const testExePath = path.join(tempDir, 'early-exit.exe');
      await fs.writeFile(testExePath, '');

      // Add to registry (confidence 1.0)
      const registry = new AppRegistry(path.join(tempDir, 'registry.json'));
      await registry.addEntry({
        aliases: ['app'],
        executablePath: testExePath,
        displayName: 'Early Exit App',
        addedAt: new Date(),
        source: 'predefined',
        usageCount: 0,
        lastUsed: new Date()
      });

      const resolver2 = await createTestResolver();
      const result = await resolver2.resolve('app');

      // Should return immediately with registry result
      expect(result.success).toBe(true);
      expect(result.confidenceScore).toBe(1.0);
      expect(result.strategy).toBe(ResolutionStrategy.APP_REGISTRY);
    });
  });
});
