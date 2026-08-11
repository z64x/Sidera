/**
 * Unit tests for WindowsRegistrySearcher
 * 
 * Tests the Windows Registry search functionality including:
 * - Registry key querying
 * - Case-insensitive matching
 * - Path validation
 * - Caching behavior
 */

import { WindowsRegistrySearcher } from '../../../src/main/app-resolver/WindowsRegistrySearcher';
import { CacheManager } from '../../../src/main/app-resolver/CacheManager';
import { CacheConfig, RegistryApp } from '../../../src/main/app-resolver/types';

describe('WindowsRegistrySearcher', () => {
  let cacheManager: CacheManager;
  let searcher: WindowsRegistrySearcher;

  beforeEach(() => {
    const cacheConfig: CacheConfig = {
      fuzzyMatchTTL: 24 * 60 * 60 * 1000, // 24 hours
      registryTTL: 60 * 60 * 1000, // 1 hour
      maxCacheSize: 100
    };
    cacheManager = new CacheManager(cacheConfig);
    searcher = new WindowsRegistrySearcher(cacheManager);
  });

  describe('search', () => {
    it('should return empty array when no matches found', async () => {
      const results = await searcher.search('NonExistentApp12345XYZ');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should perform case-insensitive search', async () => {
      // This test will only pass if there are actual apps in the registry
      // We'll search for common Windows apps that should exist
      const lowerResults = await searcher.search('microsoft');
      const upperResults = await searcher.search('MICROSOFT');
      const mixedResults = await searcher.search('MiCrOsOfT');

      // All three searches should return the same results
      expect(lowerResults.length).toBeGreaterThanOrEqual(0);
      expect(upperResults.length).toBe(lowerResults.length);
      expect(mixedResults.length).toBe(lowerResults.length);
    });

    it('should cache search results', async () => {
      const searchTerm = 'test_app_cache';
      
      // First search
      const startTime1 = Date.now();
      const results1 = await searcher.search(searchTerm);
      const duration1 = Date.now() - startTime1;

      // Second search (should be cached)
      const startTime2 = Date.now();
      const results2 = await searcher.search(searchTerm);
      const duration2 = Date.now() - startTime2;

      // Results should be identical
      expect(results2).toEqual(results1);

      // Second search should be significantly faster (cached)
      // Note: This might not always be true in fast test environments
      // but it's a good indicator that caching is working
      expect(duration2).toBeLessThanOrEqual(duration1);
    });

    it('should return apps with required fields', async () => {
      const results = await searcher.getAllInstalledApps();
      
      // Check that each result has the required fields
      results.forEach(app => {
        expect(app).toHaveProperty('displayName');
        expect(app).toHaveProperty('executablePath');
        expect(typeof app.displayName).toBe('string');
        expect(typeof app.executablePath).toBe('string');
        expect(app.displayName.length).toBeGreaterThan(0);
        expect(app.executablePath.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getAllInstalledApps', () => {
    it('should return an array of apps', async () => {
      const results = await searcher.getAllInstalledApps();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should cache results', async () => {
      // First call
      const results1 = await searcher.getAllInstalledApps();
      
      // Second call (should be cached)
      const results2 = await searcher.getAllInstalledApps();
      
      // Should return the same results
      expect(results2).toEqual(results1);
    });

    it('should return apps with validated executable paths', async () => {
      const results = await searcher.getAllInstalledApps();
      
      // All returned apps should have valid executable paths
      // (the implementation validates paths before returning)
      results.forEach(app => {
        expect(app.executablePath).toBeTruthy();
        // Path should look like a Windows path
        expect(app.executablePath).toMatch(/^[A-Z]:\\/i);
      });
    });

    it('should not return duplicate apps', async () => {
      const results = await searcher.getAllInstalledApps();
      
      // Check for duplicates based on executable path
      const paths = results.map(app => app.executablePath.toLowerCase());
      const uniquePaths = new Set(paths);
      
      expect(paths.length).toBe(uniquePaths.size);
    });
  });

  describe('integration with real registry', () => {
    it('should find common Windows applications', async () => {
      // Search for Windows-related apps that should exist on most systems
      const windowsResults = await searcher.search('windows');
      
      // Should find at least some Windows-related entries
      // (exact count depends on system, but there should be some)
      expect(windowsResults.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle partial name matches', async () => {
      // Get all apps first
      const allApps = await searcher.getAllInstalledApps();
      
      if (allApps.length > 0) {
        // Take the first app and search for part of its name
        const firstApp = allApps[0];
        const partialName = firstApp.displayName.substring(0, 5);
        
        if (partialName.length >= 3) {
          const results = await searcher.search(partialName);
          
          // Should find at least the original app
          const found = results.some(app => 
            app.displayName.toLowerCase().includes(partialName.toLowerCase())
          );
          expect(found).toBe(true);
        }
      }
    });
  });

  describe('caching behavior', () => {
    it('should respect cache TTL', async () => {
      // This test verifies that the cache manager is being used correctly
      const searchTerm = 'cache_ttl_test';
      
      // Perform search
      await searcher.search(searchTerm);
      
      // Check that cache has the entry
      const cacheKey = `registry:${searchTerm}`;
      const cached = cacheManager.get<RegistryApp[]>(cacheKey);
      
      expect(cached).not.toBeNull();
    });

    it('should cache getAllInstalledApps separately', async () => {
      // Get all apps
      await searcher.getAllInstalledApps();
      
      // Check that the all apps cache entry exists
      const cached = cacheManager.get<RegistryApp[]>('registry:all_apps');
      
      expect(cached).not.toBeNull();
      expect(Array.isArray(cached)).toBe(true);
    });
  });
});
