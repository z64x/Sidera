/**
 * AppResolver - Main orchestrator for smart app resolution
 * 
 * Coordinates all resolution strategies in cascade order:
 * 1. App Registry (exact matches, confidence: 1.0)
 * 2. Learning System (learned mappings, confidence: 0-0.95)
 * 3. Fuzzy Matcher (filesystem search, confidence: 0-0.95)
 * 4. Windows Registry (system registry, confidence: 0.7-0.9)
 * 
 * Features:
 * - Early exit when confidence >= 0.8
 * - Best match selection from multiple results
 * - Suggestion lists for ambiguous results
 * - Feedback loop to Learning System
 * - Configurable strategy execution
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.1, 5.3, 7.5
 */

import { AppRegistry } from './AppRegistry';
import * as fs from 'fs';
import * as path from 'path';
import { LearningSystem } from './LearningSystem';
import { ShortcutIndexer } from './ShortcutIndexer';
import { FuzzyMatcher } from './FuzzyMatcher';
import { WindowsRegistrySearcher } from './WindowsRegistrySearcher';
import { CacheManager } from './CacheManager';
import { resolveSystemAlias } from './systemAliases';
import {
  AppResolverConfig,
  ResolutionResult,
  ResolutionStrategy,
  ResolutionSuggestion
} from './types';

export class AppResolver {
  private config: AppResolverConfig;
  private registry: AppRegistry;
  private learning: LearningSystem;
  private shortcuts: ShortcutIndexer;
  private fuzzy: FuzzyMatcher;
  private winRegistry: WindowsRegistrySearcher;
  private cache: CacheManager;

  constructor(
    config: AppResolverConfig,
    registry: AppRegistry,
    learning: LearningSystem,
    shortcuts: ShortcutIndexer,
    fuzzy: FuzzyMatcher,
    winRegistry: WindowsRegistrySearcher,
    cache: CacheManager
  ) {
    this.config = config;
    this.registry = registry;
    this.learning = learning;
    this.shortcuts = shortcuts;
    this.fuzzy = fuzzy;
    this.winRegistry = winRegistry;
    this.cache = cache;
  }

  /**
   * Resolve an application name to an executable path
   * Tries all enabled strategies in order until high confidence match is found
   * 
   * @param userInput - User's application name input
   * @returns Resolution result with path, suggestions, or error
   */
  async resolve(userInput: string): Promise<ResolutionResult> {
    if (!userInput || userInput.trim() === '') {
      return {
        success: false,
        error: 'User input cannot be empty'
      };
    }

    const results: ResolutionResult[] = [];

    // Try each strategy in order
    const strategies = [
      { name: ResolutionStrategy.EXACT_PATH, fn: () => this.tryExactPath(userInput) },
      { name: ResolutionStrategy.SYSTEM_ALIAS, fn: () => this.trySystemAlias(userInput) },
      { name: ResolutionStrategy.APP_REGISTRY, fn: () => this.tryRegistry(userInput) },
      { name: ResolutionStrategy.LEARNING_SYSTEM, fn: () => this.tryLearning(userInput) },
      { name: ResolutionStrategy.SHORTCUT_INDEX, fn: () => this.tryShortcutIndex(userInput) },
      { name: ResolutionStrategy.WINDOWS_REGISTRY, fn: () => this.tryWindowsRegistry(userInput) }
    ];

    if (this.config.deepSearchEnabled && this.config.enabledStrategies.includes(ResolutionStrategy.FUZZY_MATCHER)) {
      strategies.push({ name: ResolutionStrategy.FUZZY_MATCHER, fn: () => this.tryFuzzyMatch(userInput) });
    }

    for (const strategy of strategies) {
      // Skip disabled strategies
      if (!this.config.enabledStrategies.includes(strategy.name)) {
        continue;
      }

      try {
        const result = await strategy.fn();

        if (result) {
          // Early exit on high confidence match
          const threshold = this.getLaunchThreshold(result.strategy);
          if (result.confidenceScore && result.confidenceScore >= threshold) {
            return result;
          }

          results.push(result);
        }
      } catch (error) {
        console.error(`[AppResolver] Strategy ${strategy.name} failed:`, error);
        // Continue with next strategy
      }
    }

    // Handle results
    return this.handleAmbiguousResults(results);
  }

  /**
   * Report successful application launch to Learning System
   * 
   * @param userInput - User's original input
   * @param executablePath - Path that was successfully launched
   */
  async reportSuccess(userInput: string, executablePath: string): Promise<void> {
    try {
      await this.learning.recordSuccess(userInput, executablePath);
    } catch (error) {
      console.error('[AppResolver] Error reporting success:', error);
    }
  }

  /**
   * Report failed application launch to Learning System
   * 
   * @param userInput - User's original input
   * @param attemptedPath - Path that failed to launch
   */
  async reportFailure(userInput: string, attemptedPath: string): Promise<void> {
    try {
      await this.learning.recordFailure(userInput, attemptedPath);
    } catch (error) {
      console.error('[AppResolver] Error reporting failure:', error);
    }
  }

  private async tryExactPath(userInput: string): Promise<ResolutionResult | null> {
    const trimmed = userInput.trim().replace(/^"|"$/g, '');
    if (!trimmed) return null;
    if (!/^[a-z]:[\\/]/i.test(trimmed) && !/^\\\\/.test(trimmed)) return null;
    if (!fs.existsSync(trimmed)) return null;

    const extension = path.extname(trimmed).toLowerCase();
    const allowedExtensions = new Set(['.exe', '.lnk', '.url', '.appref-ms', '.msc']);
    if (!allowedExtensions.has(extension)) return null;

    return {
      success: true,
      displayName: path.basename(trimmed, extension),
      executablePath: trimmed,
      confidenceScore: 1,
      strategy: ResolutionStrategy.EXACT_PATH,
    };
  }

  private async trySystemAlias(userInput: string): Promise<ResolutionResult | null> {
    return resolveSystemAlias(userInput);
  }

  /**
   * Try to resolve using App Registry
   * Returns exact match with confidence 1.0
   */
  private async tryRegistry(userInput: string): Promise<ResolutionResult | null> {
    try {
      const entry = await this.registry.lookup(userInput);

      if (entry) {
        // Update usage statistics
        await this.registry.updateUsage(userInput);

        return {
          success: true,
          displayName: entry.displayName,
          executablePath: entry.executablePath,
          confidenceScore: 1.0,
          strategy: ResolutionStrategy.APP_REGISTRY
        };
      }

      return null;
    } catch (error) {
      console.error('[AppResolver] Registry lookup failed:', error);
      return null;
    }
  }

  /**
   * Try to resolve using Learning System
   * Returns learned mapping with confidence based on success rate
   */
  private async tryLearning(userInput: string): Promise<ResolutionResult | null> {
    try {
      const entry = await this.learning.lookup(userInput);

      if (entry) {
        const confidenceScore = this.learning.getConfidenceScore(entry);

        return {
          success: true,
          displayName: entry.executablePath.split('\\').pop()?.replace(/\.[^.]+$/, ''),
          executablePath: entry.executablePath,
          confidenceScore,
          strategy: ResolutionStrategy.LEARNING_SYSTEM
        };
      }

      return null;
    } catch (error) {
      console.error('[AppResolver] Learning lookup failed:', error);
      return null;
    }
  }

  private async tryShortcutIndex(userInput: string): Promise<ResolutionResult | null> {
    try {
      const matches = await this.shortcuts.search(userInput, this.config.maxSuggestions);
      if (matches.length === 0) return null;

      const bestMatch = matches[0];
      return {
        success: true,
        displayName: bestMatch.name,
        executablePath: bestMatch.executablePath,
        confidenceScore: bestMatch.confidenceScore,
        strategy: ResolutionStrategy.SHORTCUT_INDEX,
        suggestions: matches.slice(1).map((match) => ({
          name: match.name,
          executablePath: match.executablePath,
          confidenceScore: match.confidenceScore,
          source: ResolutionStrategy.SHORTCUT_INDEX,
        })),
      };
    } catch (error) {
      console.error('[AppResolver] Shortcut index search failed:', error);
      return null;
    }
  }

  /**
   * Try to resolve using Fuzzy Matcher
   * Returns best fuzzy match from filesystem search
   */
  private async tryFuzzyMatch(userInput: string): Promise<ResolutionResult | null> {
    try {
      const matches = await this.fuzzy.search(userInput, this.config.maxSuggestions);

      if (matches.length === 0) {
        return null;
      }

      // Return best match
      const bestMatch = matches[0];

      return {
        success: true,
        displayName: bestMatch.name,
        executablePath: bestMatch.executablePath,
        confidenceScore: bestMatch.confidenceScore,
        strategy: ResolutionStrategy.FUZZY_MATCHER,
        suggestions: matches.slice(1).map(m => ({
          name: m.name,
          executablePath: m.executablePath,
          confidenceScore: m.confidenceScore,
          source: ResolutionStrategy.FUZZY_MATCHER
        }))
      };
    } catch (error) {
      console.error('[AppResolver] Fuzzy match failed:', error);
      return null;
    }
  }

  /**
   * Try to resolve using Windows Registry
   * Returns best registry match with confidence based on match quality
   */
  private async tryWindowsRegistry(userInput: string): Promise<ResolutionResult | null> {
    try {
      const apps = await this.winRegistry.search(userInput);

      if (apps.length === 0) {
        return null;
      }

      // Calculate confidence scores for each match
      const scoredApps = apps.map(app => {
        const score = this.calculateRegistryConfidence(userInput, app.displayName);
        return {
          app,
          score
        };
      });

      // Sort by confidence score
      scoredApps.sort((a, b) => b.score - a.score);

      const bestMatch = scoredApps[0];

      return {
        success: true,
        displayName: bestMatch.app.displayName,
        executablePath: bestMatch.app.executablePath,
        confidenceScore: bestMatch.score,
        strategy: ResolutionStrategy.WINDOWS_REGISTRY,
        suggestions: scoredApps.slice(1, this.config.maxSuggestions).map(s => ({
          name: s.app.displayName,
          executablePath: s.app.executablePath,
          confidenceScore: s.score,
          source: ResolutionStrategy.WINDOWS_REGISTRY
        }))
      };
    } catch (error) {
      console.error('[AppResolver] Windows Registry search failed:', error);
      return null;
    }
  }

  /**
   * Calculate confidence score for Windows Registry match
   * Based on how well the user input matches the display name
   */
  private calculateRegistryConfidence(userInput: string, displayName: string): number {
    const inputLower = userInput.toLowerCase();
    const nameLower = displayName.toLowerCase();

    // Exact match (case-insensitive)
    if (inputLower === nameLower) {
      return 0.9;
    }

    // Input is exact substring of name
    if (nameLower === inputLower) {
      return 0.85;
    }

    // Input is substring of name
    if (nameLower.includes(inputLower)) {
      return 0.7;
    }

    // Partial match
    return 0.5;
  }

  /**
   * Handle ambiguous results when no high-confidence match is found
   * Returns best match if above threshold, or suggestions list
   */
  private handleAmbiguousResults(results: ResolutionResult[]): ResolutionResult {
    if (results.length === 0) {
      return {
        success: false,
        error: 'No matching applications found'
      };
    }

    // Find best result
    let bestResult = results[0];
    for (let i = 1; i < results.length; i++) {
      if ((results[i].confidenceScore || 0) > (bestResult.confidenceScore || 0)) {
        bestResult = results[i];
      }
    }

    if (bestResult.confidenceScore && bestResult.confidenceScore >= this.getLaunchThreshold(bestResult.strategy)) {
      return bestResult;
    }

    // Collect all suggestions from all results
    const allSuggestions: ResolutionSuggestion[] = [];

    for (const result of results) {
      if (result.executablePath && result.confidenceScore) {
        // Add the main result as a suggestion
        allSuggestions.push({
          name: result.executablePath.split('\\').pop()?.replace('.exe', '') || 'Unknown',
          executablePath: result.executablePath,
          confidenceScore: result.confidenceScore,
          source: result.strategy || ResolutionStrategy.FALLBACK
        });
      }

      // Add any additional suggestions from the result
      if (result.suggestions) {
        allSuggestions.push(...result.suggestions);
      }
    }

    // Sort by confidence and limit to maxSuggestions
    allSuggestions.sort((a, b) => b.confidenceScore - a.confidenceScore);
    const topSuggestions = allSuggestions.slice(0, this.config.maxSuggestions);

    return {
      success: false,
      suggestions: topSuggestions,
      error: bestResult.confidenceScore && bestResult.confidenceScore < this.getLaunchThreshold(bestResult.strategy)
        ? 'Application match is not confident enough. Please select one:'
        : 'Multiple applications found. Please select one:'
    };
  }

  private getLaunchThreshold(strategy?: ResolutionStrategy): number {
    if (
      strategy === ResolutionStrategy.SYSTEM_ALIAS ||
      strategy === ResolutionStrategy.EXACT_PATH ||
      strategy === ResolutionStrategy.APP_REGISTRY ||
      strategy === ResolutionStrategy.LEARNING_SYSTEM
    ) {
      return this.config.confidenceThreshold;
    }
    return this.config.fuzzyLaunchThreshold ?? 0.85;
  }
}
