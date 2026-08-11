/**
 * Unit tests for CacheManager
 * Tests basic functionality, TTL expiration, and LRU eviction
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CacheManager } from '../../../src/main/app-resolver/CacheManager';
import { CacheConfig } from '../../../src/main/app-resolver/types';

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  let config: CacheConfig;

  beforeEach(() => {
    config = {
      fuzzyMatchTTL: 86400000, // 24 hours
      registryTTL: 3600000, // 1 hour
      maxCacheSize: 3
    };
    cacheManager = new CacheManager(config);
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      cacheManager.set('key1', 'value1', 1000);
      expect(cacheManager.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cacheManager.get('nonexistent')).toBeNull();
    });

    it('should invalidate specific keys', () => {
      cacheManager.set('key1', 'value1', 1000);
      cacheManager.invalidate('key1');
      expect(cacheManager.get('key1')).toBeNull();
    });

    it('should clear all entries', () => {
      cacheManager.set('key1', 'value1', 1000);
      cacheManager.set('key2', 'value2', 1000);
      cacheManager.clear();
      expect(cacheManager.size()).toBe(0);
      expect(cacheManager.get('key1')).toBeNull();
      expect(cacheManager.get('key2')).toBeNull();
    });
  });

  describe('TTL Expiration', () => {
    it('should return null for expired entries', async () => {
      cacheManager.set('key1', 'value1', 50); // 50ms TTL
      
      // Should be available immediately
      expect(cacheManager.get('key1')).toBe('value1');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should be expired now
      expect(cacheManager.get('key1')).toBeNull();
    });

    it('should not return expired entries even if not accessed', async () => {
      cacheManager.set('key1', 'value1', 50);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(cacheManager.get('key1')).toBeNull();
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entry when cache is full', () => {
      // Fill cache to max size
      cacheManager.set('key1', 'value1', 10000);
      cacheManager.set('key2', 'value2', 10000);
      cacheManager.set('key3', 'value3', 10000);
      
      expect(cacheManager.size()).toBe(3);
      
      // Access key1 to make it recently used
      cacheManager.get('key1');
      
      // Add new entry, should evict key2 (least recently used)
      cacheManager.set('key4', 'value4', 10000);
      
      expect(cacheManager.size()).toBe(3);
      expect(cacheManager.get('key1')).toBe('value1'); // Still there
      expect(cacheManager.get('key2')).toBeNull(); // Evicted
      expect(cacheManager.get('key3')).toBe('value3'); // Still there
      expect(cacheManager.get('key4')).toBe('value4'); // New entry
    });

    it('should update access order on get', () => {
      cacheManager.set('key1', 'value1', 10000);
      cacheManager.set('key2', 'value2', 10000);
      cacheManager.set('key3', 'value3', 10000);
      
      // Access key1 to make it most recently used
      cacheManager.get('key1');
      
      // Add new entry, should evict key2
      cacheManager.set('key4', 'value4', 10000);
      
      expect(cacheManager.get('key2')).toBeNull();
      expect(cacheManager.get('key1')).toBe('value1');
    });

    it('should update access order on set for existing keys', () => {
      cacheManager.set('key1', 'value1', 10000);
      cacheManager.set('key2', 'value2', 10000);
      cacheManager.set('key3', 'value3', 10000);
      
      // Update key1 to make it most recently used
      cacheManager.set('key1', 'updated1', 10000);
      
      // Add new entry, should evict key2
      cacheManager.set('key4', 'value4', 10000);
      
      expect(cacheManager.get('key2')).toBeNull();
      expect(cacheManager.get('key1')).toBe('updated1');
    });
  });

  describe('Edge Cases', () => {
    it('should handle cache size of 1', () => {
      const smallCache = new CacheManager({ ...config, maxCacheSize: 1 });
      smallCache.set('key1', 'value1', 1000);
      smallCache.set('key2', 'value2', 1000);
      
      expect(smallCache.size()).toBe(1);
      expect(smallCache.get('key1')).toBeNull();
      expect(smallCache.get('key2')).toBe('value2');
    });

    it('should handle complex data types', () => {
      const complexData = {
        nested: { value: 'test' },
        array: [1, 2, 3]
      };
      
      cacheManager.set('complex', complexData, 1000);
      expect(cacheManager.get('complex')).toEqual(complexData);
    });

    it('should handle updating existing keys without eviction', () => {
      cacheManager.set('key1', 'value1', 10000);
      cacheManager.set('key2', 'value2', 10000);
      cacheManager.set('key3', 'value3', 10000);
      
      // Update existing key - should not trigger eviction
      cacheManager.set('key2', 'updated2', 10000);
      
      expect(cacheManager.size()).toBe(3);
      expect(cacheManager.get('key2')).toBe('updated2');
    });
  });

  describe('Statistics', () => {
    it('should return correct cache statistics', () => {
      cacheManager.set('key1', 'value1', 1000);
      cacheManager.set('key2', 'value2', 1000);
      
      const stats = cacheManager.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
    });
  });
});
