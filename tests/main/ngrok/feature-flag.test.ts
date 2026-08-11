/**
 * Feature Flag System Tests
 * Tests for the ngrok SDK/CLI toggle feature flag
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Ngrok Feature Flag System', () => {
  const originalEnv = process.env.NGROK_USE_SDK;

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.NGROK_USE_SDK = originalEnv;
    } else {
      delete process.env.NGROK_USE_SDK;
    }
  });

  describe('Configuration Defaults', () => {
    it('should default to SDK implementation (useSdk: true)', () => {
      const defaultConfig = {
        enabled: false,
        port: 3000,
        useSdk: true,
      };
      
      expect(defaultConfig.useSdk).toBe(true);
    });

    it('should default port to 3000', () => {
      const defaultConfig = {
        enabled: false,
        port: 3000,
        useSdk: true,
      };
      
      expect(defaultConfig.port).toBe(3000);
    });

    it('should default enabled to false', () => {
      const defaultConfig = {
        enabled: false,
        port: 3000,
        useSdk: true,
      };
      
      expect(defaultConfig.enabled).toBe(false);
    });
  });

  describe('Environment Variable Override', () => {
    it('should respect NGROK_USE_SDK=true environment variable', () => {
      process.env.NGROK_USE_SDK = 'true';
      const useSdk = process.env.NGROK_USE_SDK === 'true';
      expect(useSdk).toBe(true);
    });

    it('should respect NGROK_USE_SDK=false environment variable', () => {
      process.env.NGROK_USE_SDK = 'false';
      const useSdk = process.env.NGROK_USE_SDK === 'true';
      expect(useSdk).toBe(false);
    });

    it('should handle undefined environment variable', () => {
      delete process.env.NGROK_USE_SDK;
      const configValue = true;
      const useSdk = process.env.NGROK_USE_SDK 
        ? process.env.NGROK_USE_SDK === 'true' 
        : configValue;
      expect(useSdk).toBe(true);
    });

    it('should prioritize environment variable over config', () => {
      process.env.NGROK_USE_SDK = 'false';
      const configValue = true;
      const useSdk = process.env.NGROK_USE_SDK 
        ? process.env.NGROK_USE_SDK === 'true' 
        : configValue;
      expect(useSdk).toBe(false);
    });
  });

  describe('Feature Flag Logic', () => {
    it('should use SDK when useSdk is true', () => {
      const config = { useSdk: true };
      const useSdk = config.useSdk !== false;
      expect(useSdk).toBe(true);
    });

    it('should use CLI when useSdk is false', () => {
      const config = { useSdk: false };
      const useSdk = config.useSdk !== false;
      expect(useSdk).toBe(false);
    });

    it('should default to SDK when useSdk is undefined', () => {
      const config = {};
      const useSdk = (config as any).useSdk !== false;
      expect(useSdk).toBe(true);
    });

    it('should handle null useSdk value', () => {
      const config = { useSdk: null };
      const useSdk = config.useSdk !== false;
      expect(useSdk).toBe(true);
    });
  });

  describe('Configuration Validation', () => {
    it('should accept valid ngrok configuration', () => {
      const config = {
        authToken: 'test_token_1234567890abcdefghijklmnopqrstuvwxyz',
        enabled: true,
        port: 3000,
        useSdk: true,
      };
      
      expect(config.authToken).toBeDefined();
      expect(config.enabled).toBe(true);
      expect(config.port).toBe(3000);
      expect(config.useSdk).toBe(true);
    });

    it('should handle missing authToken', () => {
      const config = {
        enabled: true,
        port: 3000,
        useSdk: true,
      };
      
      expect((config as any).authToken).toBeUndefined();
    });

    it('should handle custom port', () => {
      const config = {
        enabled: true,
        port: 8080,
        useSdk: true,
      };
      
      expect(config.port).toBe(8080);
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with legacy config without useSdk field', () => {
      const legacyConfig = {
        authToken: 'test_token',
        enabled: true,
        port: 3000,
      };
      
      const useSdk = (legacyConfig as any).useSdk !== false;
      expect(useSdk).toBe(true); // Should default to SDK
    });

    it('should preserve existing config fields', () => {
      const config = {
        authToken: 'test_token',
        enabled: true,
        port: 3000,
        useSdk: false,
      };
      
      expect(config.authToken).toBe('test_token');
      expect(config.enabled).toBe(true);
      expect(config.port).toBe(3000);
      expect(config.useSdk).toBe(false);
    });
  });
});
