/**
 * Smart App Resolution - Main Entry Point
 * 
 * This module exports all public interfaces and utilities for the
 * app resolution system.
 */

import { AppResolver } from './AppResolver';
import { AppRegistry } from './AppRegistry';
import { LearningSystem } from './LearningSystem';
import { FuzzyMatcher } from './FuzzyMatcher';
import { ShortcutIndexer } from './ShortcutIndexer';
import { WindowsRegistrySearcher } from './WindowsRegistrySearcher';
import { CacheManager } from './CacheManager';
import {
  loadConfig,
  getAppRegistryPath,
  getLearningDataPath,
  ensureStorageDir
} from './config';
import { AppResolverConfig } from './types';

// Export all types
export * from './types';

// Export configuration utilities
export {
  DEFAULT_CONFIG,
  getStorageDir,
  getConfigPath,
  getAppRegistryPath,
  getLearningDataPath,
  ensureStorageDir,
  loadConfig,
  saveConfig
} from './config';

// Export components
export { CacheManager } from './CacheManager';
export { AppRegistry } from './AppRegistry';
export { LearningSystem } from './LearningSystem';
export { FuzzyMatcher } from './FuzzyMatcher';
export { ShortcutIndexer } from './ShortcutIndexer';
export { WindowsRegistrySearcher } from './WindowsRegistrySearcher';
export { AppResolver } from './AppResolver';

// Export predefined apps utilities
export {
  initializePredefinedApps,
  getPredefinedApps,
  validateRegistryEntries
} from './predefinedApps';

/**
 * Factory function to create a fully initialized AppResolver instance
 * with all dependencies configured and ready to use.
 * 
 * @param config - Optional custom configuration (uses defaults if not provided)
 * @returns Promise resolving to configured AppResolver instance
 * 
 * @example
 * ```typescript
 * const resolver = await createAppResolver();
 * const result = await resolver.resolve('Chrome');
 * ```
 */
export async function createAppResolver(config?: AppResolverConfig): Promise<AppResolver> {
  // Ensure storage directory exists
  await ensureStorageDir();

  // Load configuration
  const resolverConfig = config || await loadConfig();

  // Initialize components
  const registryPath = getAppRegistryPath();
  const learningPath = getLearningDataPath();

  const cache = new CacheManager(resolverConfig.cacheConfig);
  const registry = new AppRegistry(registryPath);
  const learning = new LearningSystem(learningPath, registry);
  const fuzzy = new FuzzyMatcher(resolverConfig.searchDirs, cache);
  const shortcuts = new ShortcutIndexer(resolverConfig.shortcutDirs || [], cache);
  const winRegistry = new WindowsRegistrySearcher(cache);

  // Create and return resolver
  const resolver = new AppResolver(
    resolverConfig,
    registry,
    learning,
    shortcuts,
    fuzzy,
    winRegistry,
    cache
  );

  // Start periodic tasks for learning system
  learning.startPeriodicTasks();

  return resolver;
}
