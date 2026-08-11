/**
 * Smart App Resolution - Core Type Definitions
 * 
 * This module defines all interfaces, enums, and types used throughout
 * the app resolution system.
 */

/**
 * Enum defining the different resolution strategies available
 */
export enum ResolutionStrategy {
  EXACT_PATH = 'exact_path',
  SYSTEM_ALIAS = 'system_alias',
  APP_REGISTRY = 'app_registry',
  LEARNING_SYSTEM = 'learning_system',
  SHORTCUT_INDEX = 'shortcut_index',
  FUZZY_MATCHER = 'fuzzy_matcher',
  WINDOWS_REGISTRY = 'windows_registry',
  FALLBACK = 'fallback'
}

/**
 * Result of an app resolution attempt
 */
export interface ResolutionResult {
  success: boolean;
  displayName?: string;
  executablePath?: string;
  confidenceScore?: number;
  strategy?: ResolutionStrategy;
  suggestions?: ResolutionSuggestion[];
  error?: string;
}

/**
 * A single suggestion when multiple matches are found
 */
export interface ResolutionSuggestion {
  name: string;
  executablePath: string;
  confidenceScore: number;
  source: ResolutionStrategy;
}

/**
 * Configuration for the cache system
 */
export interface CacheConfig {
  fuzzyMatchTTL: number; // 24 hours in ms
  registryTTL: number; // 1 hour in ms
  maxCacheSize: number; // max entries
}

/**
 * Main configuration for the AppResolver
 */
export interface AppResolverConfig {
  confidenceThreshold: number; // default: 0.8
  ambiguousThreshold: number; // default: 0.5
  fuzzyLaunchThreshold?: number; // default: 0.85
  maxSuggestions: number; // default: 5
  enabledStrategies: ResolutionStrategy[];
  customSearchDirs: string[];
  cacheConfig: CacheConfig;
  shortcutDirs?: string[];
  searchDirs: string[];
  deepSearchEnabled?: boolean;
}

/**
 * Entry in the App Registry database
 */
export interface AppRegistryEntry {
  aliases: string[]; // case-insensitive aliases
  executablePath: string;
  displayName: string;
  addedAt: Date;
  source: 'predefined' | 'learned';
  usageCount: number;
  lastUsed: Date;
}

/**
 * Structure of the App Registry JSON file
 */
export interface AppRegistryData {
  version: string;
  entries: Record<string, AppRegistryEntry>; // key: normalized alias
}

/**
 * Entry in the Learning System database
 */
export interface LearningEntry {
  userInput: string;
  executablePath: string;
  successCount: number;
  failureCount: number;
  firstSeen: Date;
  lastUsed: Date;
  promoted: boolean; // moved to App Registry
}

/**
 * Structure of the Learning System JSON file
 */
export interface LearningData {
  version: string;
  entries: LearningEntry[];
}

/**
 * Result from a fuzzy match search
 */
export interface FuzzyMatchResult {
  name: string;
  executablePath: string;
  confidenceScore: number;
  matchType: 'exact' | 'fuzzy' | 'partial';
}

/**
 * An indexed application for fuzzy matching
 */
export interface IndexedApp {
  name: string;
  executablePath: string;
  normalizedName: string;
  directory: string;
}

/**
 * Application found in Windows Registry
 */
export interface RegistryApp {
  displayName: string;
  executablePath: string;
  publisher?: string;
  version?: string;
}

/**
 * Cache entry with TTL
 */
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Log entry for resolution operations
 */
export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  component: string;
  message: string;
  data?: any;
}

/**
 * Metrics collected by the system
 */
export interface Metrics {
  totalResolutions: number;
  successfulResolutions: number;
  failedResolutions: number;
  averageResolutionTime: number;
  strategyUsage: Record<ResolutionStrategy, number>;
  cacheHitRate: number;
}
