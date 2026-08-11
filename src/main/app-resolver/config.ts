/**
 * Smart App Resolution - Configuration Management
 * 
 * This module handles loading, validating, and providing default
 * configuration for the app resolution system.
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AppResolverConfig, ResolutionStrategy } from './types';

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: AppResolverConfig = {
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
  cacheConfig: {
    fuzzyMatchTTL: 86400000, // 24 hours in ms
    registryTTL: 3600000, // 1 hour in ms
    maxCacheSize: 1000
  },
  deepSearchEnabled: false,
  shortcutDirs: [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu'),
    path.join(process.env.USERPROFILE || '', 'Desktop'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu',
    'C:\\Users\\Public\\Desktop'
  ],
  searchDirs: [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.USERPROFILE || '', 'Desktop'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu',
    'C:\\Users\\Public\\Desktop'
  ]
};

/**
 * Get the storage directory for app resolver data
 */
export function getStorageDir(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'app-resolver');
}

/**
 * Get the path to the configuration file
 */
export function getConfigPath(): string {
  return path.join(getStorageDir(), 'app-resolver-config.json');
}

/**
 * Get the path to the app registry file
 */
export function getAppRegistryPath(): string {
  return path.join(getStorageDir(), 'app-registry.json');
}

/**
 * Get the path to the learning data file
 */
export function getLearningDataPath(): string {
  return path.join(getStorageDir(), 'learning-data.json');
}

/**
 * Ensure the storage directory exists
 */
export async function ensureStorageDir(): Promise<void> {
  const storageDir = getStorageDir();
  try {
    await fs.access(storageDir);
  } catch {
    await fs.mkdir(storageDir, { recursive: true });
  }
}

/**
 * Validate a configuration object
 */
function validateConfig(config: any): boolean {
  if (!config || typeof config !== 'object') return false;
  
  // Check required numeric fields
  if (typeof config.confidenceThreshold !== 'number' || 
      config.confidenceThreshold < 0 || 
      config.confidenceThreshold > 1) {
    return false;
  }
  
  if (typeof config.ambiguousThreshold !== 'number' || 
      config.ambiguousThreshold < 0 || 
      config.ambiguousThreshold > 1) {
    return false;
  }
  
  if (typeof config.maxSuggestions !== 'number' || 
      config.maxSuggestions < 1) {
    return false;
  }
  
  // Check arrays
  if (!Array.isArray(config.enabledStrategies) ||
      !Array.isArray(config.customSearchDirs) ||
      !Array.isArray(config.searchDirs)) {
    return false;
  }
  
  // Check cache config
  if (!config.cacheConfig || typeof config.cacheConfig !== 'object') {
    return false;
  }
  
  return true;
}

function mergeConfigWithDefaults(config: AppResolverConfig): AppResolverConfig {
  const enabled = new Set([
    ...DEFAULT_CONFIG.enabledStrategies,
    ...(Array.isArray(config.enabledStrategies) ? config.enabledStrategies : []),
  ]);

  return {
    ...DEFAULT_CONFIG,
    ...config,
    fuzzyLaunchThreshold: typeof config.fuzzyLaunchThreshold === 'number'
      ? config.fuzzyLaunchThreshold
      : DEFAULT_CONFIG.fuzzyLaunchThreshold,
    deepSearchEnabled: typeof config.deepSearchEnabled === 'boolean'
      ? config.deepSearchEnabled
      : DEFAULT_CONFIG.deepSearchEnabled,
    enabledStrategies: [...enabled],
    cacheConfig: {
      ...DEFAULT_CONFIG.cacheConfig,
      ...(config.cacheConfig || {}),
    },
    shortcutDirs: Array.isArray(config.shortcutDirs) ? config.shortcutDirs : DEFAULT_CONFIG.shortcutDirs,
    searchDirs: Array.isArray(config.searchDirs) ? config.searchDirs : DEFAULT_CONFIG.searchDirs,
    customSearchDirs: Array.isArray(config.customSearchDirs) ? config.customSearchDirs : DEFAULT_CONFIG.customSearchDirs,
  };
}

/**
 * Load configuration from file, falling back to defaults if needed
 */
export async function loadConfig(): Promise<AppResolverConfig> {
  try {
    await ensureStorageDir();
    const configPath = getConfigPath();
    
    try {
      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      
      if (validateConfig(config)) {
        console.log('[AppResolver] Configuration loaded successfully');
        return mergeConfigWithDefaults(config);
      } else {
        console.warn('[AppResolver] Invalid configuration, using defaults');
        return DEFAULT_CONFIG;
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create it with defaults
        await saveConfig(DEFAULT_CONFIG);
        console.log('[AppResolver] Created default configuration file');
        return DEFAULT_CONFIG;
      }
      throw error;
    }
  } catch (error) {
    console.error('[AppResolver] Error loading configuration:', error);
    console.warn('[AppResolver] Using default configuration');
    return DEFAULT_CONFIG;
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: AppResolverConfig): Promise<void> {
  try {
    await ensureStorageDir();
    const configPath = getConfigPath();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('[AppResolver] Error saving configuration:', error);
    throw error;
  }
}
