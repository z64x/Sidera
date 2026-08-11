/**
 * CacheManager - In-memory cache with LRU eviction and TTL support
 * 
 * Provides caching for fuzzy match results (24h TTL) and Windows Registry
 * results (1h TTL) to improve resolution performance.
 * 
 * Features:
 * - LRU (Least Recently Used) eviction when cache is full
 * - Per-entry TTL (Time To Live) support
 * - Automatic expiration checking on get()
 * - Thread-safe operations
 */

import { CacheConfig, CacheEntry } from './types';

export class CacheManager {
  private cache: Map<string, CacheEntry<any>>;
  private accessOrder: string[]; // Track access order for LRU
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
    this.cache = new Map();
    this.accessOrder = [];
  }

  /**
   * Retrieve a value from cache
   * Returns null if key doesn't exist or entry has expired
   * Updates access time for LRU tracking
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      return null;
    }

    // Update access order for LRU
    this.updateAccessOrder(key);

    return entry.data as T;
  }

  /**
   * Store a value in cache with specified TTL
   * Evicts oldest entry if cache is full
   */
  set<T>(key: string, value: T, ttl: number): void {
    // If cache is full and key doesn't exist, evict oldest
    if (this.cache.size >= this.config.maxCacheSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      data: value,
      timestamp: Date.now(),
      ttl: ttl
    };

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
  }

  /**
   * Remove a specific key from cache
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.removeFromAccessOrder(key);
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Check if a cache entry has expired based on its TTL
   */
  private isExpired(entry: CacheEntry<any>): boolean {
    const now = Date.now();
    const age = now - entry.timestamp;
    return age > entry.ttl;
  }

  /**
   * Evict the least recently used entry from cache
   * Uses accessOrder array to determine which entry to remove
   */
  private evictOldest(): void {
    if (this.accessOrder.length === 0) {
      return;
    }

    // The first item in accessOrder is the least recently used
    const oldestKey = this.accessOrder[0];
    this.cache.delete(oldestKey);
    this.accessOrder.shift();
  }

  /**
   * Update the access order for LRU tracking
   * Moves the key to the end of the array (most recently used)
   */
  private updateAccessOrder(key: string): void {
    // Remove key from current position if it exists
    this.removeFromAccessOrder(key);
    
    // Add to end (most recently used)
    this.accessOrder.push(key);
  }

  /**
   * Remove a key from the access order array
   */
  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Get current cache size (for testing/debugging)
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics (for monitoring)
   */
  getStats(): { size: number; maxSize: number; keys: string[] } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
      keys: Array.from(this.cache.keys())
    };
  }
}
