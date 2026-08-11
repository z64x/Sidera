/**
 * Unit tests for FuzzyMatcher
 * 
 * Tests fuzzy matching functionality including:
 * - Levenshtein distance calculation
 * - Similarity scoring
 * - Space normalization
 * - Result ordering and limiting
 * - Caching behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FuzzyMatcher } from '../../../src/main/app-resolver/FuzzyMatcher';
import { CacheManager } from '../../../src/main/app-resolver/CacheManager';
import { CacheConfig } from '../../../src/main/app-resolver/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FuzzyMatcher', () => {
  let cacheManager: CacheManager;
  let tempDir: string;

  beforeEach(() => {
    const cacheConfig: CacheConfig = {
      fuzzyMatchTTL: 24 * 60 * 60 * 1000,
      registryTTL: 60 * 60 * 1000,
      maxCacheSize: 100
    };
    cacheManager = new CacheManager(cacheConfig);
    
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzzy-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('search', () => {
    it('should find exact matches with high confidence', async () => {
      // Create test executable
      const testExe = path.join(tempDir, 'chrome.exe');
      fs.writeFileSync(testExe, '');

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('chrome');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('chrome');
      expect(results[0].confidenceScore).toBeGreaterThanOrEqual(0.95);
      expect(results[0].matchType).toBe('exact');
    });

    it('should find fuzzy matches with lower confidence', async () => {
      // Create test executable
      const testExe = path.join(tempDir, 'chrome.exe');
      fs.writeFileSync(testExe, '');

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('chrom'); // Missing 'e'

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('chrome');
      expect(results[0].confidenceScore).toBeLessThan(0.95);
      expect(results[0].confidenceScore).toBeGreaterThan(0);
    });

    it('should handle space normalization', async () => {
      // Create test executable with no spaces
      const testExe = path.join(tempDir, 'filepilot.exe');
      fs.writeFileSync(testExe, '');

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('file pilot'); // With space

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('filepilot');
      expect(results[0].confidenceScore).toBeGreaterThan(0.8);
    });

    it('should return maximum 5 results', async () => {
      // Create 10 test executables
      for (let i = 0; i < 10; i++) {
        const testExe = path.join(tempDir, `app${i}.exe`);
        fs.writeFileSync(testExe, '');
      }

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('app');

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should order results by confidence score descending', async () => {
      // Create test executables with varying similarity
      fs.writeFileSync(path.join(tempDir, 'chrome.exe'), '');
      fs.writeFileSync(path.join(tempDir, 'chromium.exe'), '');
      fs.writeFileSync(path.join(tempDir, 'chrom.exe'), '');

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('chrome');

      // Verify descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].confidenceScore).toBeGreaterThanOrEqual(
          results[i].confidenceScore
        );
      }
    });

    it('should cache search results', async () => {
      // Create test executable
      const testExe = path.join(tempDir, 'chrome.exe');
      fs.writeFileSync(testExe, '');

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      
      // First search
      const results1 = await matcher.search('chrome');
      
      // Second search should be cached
      const results2 = await matcher.search('chrome');

      expect(results1).toEqual(results2);
    });

    it('should index both .exe and .lnk files', async () => {
      // Create test files
      fs.writeFileSync(path.join(tempDir, 'app1.exe'), '');
      fs.writeFileSync(path.join(tempDir, 'app2.lnk'), '');
      fs.writeFileSync(path.join(tempDir, 'app3.txt'), ''); // Should be ignored

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('app');

      expect(results.length).toBe(2);
      expect(results.some(r => r.name === 'app1')).toBe(true);
      expect(results.some(r => r.name === 'app2')).toBe(true);
      expect(results.some(r => r.name === 'app3')).toBe(false);
    });

    it('should handle non-existent directories gracefully', async () => {
      const matcher = new FuzzyMatcher(['/non/existent/path'], cacheManager);
      const results = await matcher.search('chrome');

      expect(results).toEqual([]);
    });

    it('should scan subdirectories', async () => {
      // Create nested structure
      const subDir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'nested.exe'), '');

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('nested');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('nested');
    });
  });

  describe('rebuildIndex', () => {
    it('should rebuild the index and clear cache', async () => {
      // Create initial executable
      fs.writeFileSync(path.join(tempDir, 'app1.exe'), '');

      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      
      // First search to build index
      const results1 = await matcher.search('app');
      expect(results1.length).toBe(1);

      // Add new executable
      fs.writeFileSync(path.join(tempDir, 'app2.exe'), '');

      // Rebuild index
      await matcher.rebuildIndex();

      // Search again should find both
      const results2 = await matcher.search('app');
      expect(results2.length).toBe(2);
    });
  });

  describe('Levenshtein distance', () => {
    it('should calculate correct distance for identical strings', async () => {
      fs.writeFileSync(path.join(tempDir, 'test.exe'), '');
      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('test');

      expect(results[0].confidenceScore).toBeGreaterThanOrEqual(0.95);
    });

    it('should calculate correct distance for single character difference', async () => {
      fs.writeFileSync(path.join(tempDir, 'test.exe'), '');
      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('tast'); // One substitution

      expect(results[0].confidenceScore).toBeLessThan(0.95);
      expect(results[0].confidenceScore).toBeGreaterThan(0.5);
    });

    it('should handle partial matches with bonus', async () => {
      fs.writeFileSync(path.join(tempDir, 'google-chrome.exe'), '');
      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('chrome');

      // Should get partial match bonus
      expect(results[0].confidenceScore).toBeGreaterThan(0.7);
    });
  });

  describe('environment variable expansion', () => {
    it('should expand %APPDATA% in paths', async () => {
      const appDataPath = process.env.APPDATA || '';
      if (!appDataPath) {
        return; // Skip test if APPDATA not set
      }

      const matcher = new FuzzyMatcher(['%APPDATA%'], cacheManager);
      
      // The matcher should not throw when trying to scan
      const results = await matcher.search('test');
      expect(results).toBeDefined();
    });
  });

  describe('match type classification', () => {
    it('should classify exact matches correctly', async () => {
      fs.writeFileSync(path.join(tempDir, 'chrome.exe'), '');
      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('chrome');

      expect(results[0].matchType).toBe('exact');
    });

    it('should classify partial matches correctly', async () => {
      fs.writeFileSync(path.join(tempDir, 'google-chrome.exe'), '');
      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('chrome');

      expect(results[0].matchType).toBe('partial');
    });

    it('should classify fuzzy matches correctly', async () => {
      fs.writeFileSync(path.join(tempDir, 'chrome.exe'), '');
      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      const results = await matcher.search('chrime'); // Typo - not a substring

      expect(results[0].matchType).toBe('fuzzy');
    });
  });

  describe('case insensitivity', () => {
    it('should match regardless of case', async () => {
      fs.writeFileSync(path.join(tempDir, 'Chrome.exe'), '');
      const matcher = new FuzzyMatcher([tempDir], cacheManager);
      
      const results1 = await matcher.search('chrome');
      const results2 = await matcher.search('CHROME');
      const results3 = await matcher.search('ChRoMe');

      expect(results1.length).toBeGreaterThan(0);
      expect(results2.length).toBeGreaterThan(0);
      expect(results3.length).toBeGreaterThan(0);
      
      expect(results1[0].name).toBe('Chrome');
      expect(results2[0].name).toBe('Chrome');
      expect(results3[0].name).toBe('Chrome');
    });
  });
});
