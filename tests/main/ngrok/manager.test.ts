// Unit tests for NgrokManager token validation
import { NgrokManager, migrateNgrokConfig } from '../../../src/main/ngrok/manager';
import ngrok from '@ngrok/ngrok';

// Mock the ngrok module
vi.mock('@ngrok/ngrok', () => ({
  default: {
    forward: vi.fn()
  }
}));

describe('NgrokManager Token Validation', () => {
  let manager: NgrokManager;

  beforeEach(() => {
    manager = new NgrokManager({
      enabled: false,
      port: 3000
    });
    vi.clearAllMocks();
  });

  describe('validateToken', () => {
    it('should reject tokens with less than 40 characters', async () => {
      const result = await manager.validateToken('short_token_123');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Format token invalid');
    });

    it('should reject tokens with invalid characters', async () => {
      const result = await manager.validateToken('invalid@token#with$special%chars!!!!!!!!!!');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Format token invalid');
    });

    it('should accept tokens with valid format (40+ alphanumeric, underscore, hyphen)', async () => {
      // Note: This will fail actual validation since it's not a real token
      // but it should pass format validation
      const validFormatToken = 'a'.repeat(40) + '_-test';
      const result = await manager.validateToken(validFormatToken);
      
      // Format is valid, but actual validation will fail (expected)
      // We're just checking that format validation passes
      expect(result.message).not.toContain('Format token invalid');
    });

    it('should handle empty token', async () => {
      const result = await manager.validateToken('');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Format token invalid');
    });

    it('should trim whitespace before validation', async () => {
      const result = await manager.validateToken('  short  ');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Format token invalid');
    });
  });

  describe('configureAuthToken', () => {
    it('should reject invalid format tokens', async () => {
      const result = await manager.configureAuthToken('invalid_short');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Format token invalid');
    });

    it('should use validateToken internally', async () => {
      // Spy on validateToken to ensure it's called
      const validateSpy = vi.spyOn(manager, 'validateToken');
      
      await manager.configureAuthToken('short');
      
      expect(validateSpy).toHaveBeenCalledWith('short');
      validateSpy.mockRestore();
    });
  });
});

describe('NgrokManager Error Handling & Retry Logic', () => {
  let manager: NgrokManager;
  const mockToken = 'a'.repeat(40);

  beforeEach(() => {
    manager = new NgrokManager({
      enabled: true,
      port: 3000,
      authToken: mockToken
    });
    vi.clearAllMocks();
  });

  describe('start with retry logic', () => {
    it('should succeed on first attempt when tunnel starts successfully', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);

      const result = await manager.start();

      expect(result.success).toBe(true);
      expect(result.publicUrl).toBe('https://test.ngrok.io');
      expect(ngrok.forward).toHaveBeenCalledTimes(1);
    });

    it('should retry on network errors with exponential backoff', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      // Fail twice with network error, succeed on third attempt
      (ngrok.forward as any)
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(mockListener);

      const result = await manager.start();

      expect(result.success).toBe(true);
      expect(ngrok.forward).toHaveBeenCalledTimes(3);
    });

    it('should NOT retry on authentication errors', async () => {
      (ngrok.forward as any).mockRejectedValueOnce(new Error('authentication failed'));

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Token de autentificare invalid');
      expect(ngrok.forward).toHaveBeenCalledTimes(1); // Only one attempt
    });

    it('should NOT retry on rate limit errors', async () => {
      (ngrok.forward as any).mockRejectedValueOnce(new Error('rate limit exceeded'));

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Limită de conexiuni depășită');
      expect(ngrok.forward).toHaveBeenCalledTimes(1); // Only one attempt
    });

    it('should fail after max retries (3 attempts)', async () => {
      (ngrok.forward as any).mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('expirat');
      expect(ngrok.forward).toHaveBeenCalledTimes(3); // Max retries
    });

    it('should handle service unavailable errors', async () => {
      // Mock all attempts to return the same service unavailable error
      (ngrok.forward as any)
        .mockRejectedValueOnce(new Error('503 service unavailable'))
        .mockRejectedValueOnce(new Error('503 service unavailable'))
        .mockRejectedValueOnce(new Error('503 service unavailable'));

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('temporar indisponibil');
    });

    it('should clean up listener on failed attempts', async () => {
      const mockListener = {
        url: () => null, // Simulate URL retrieval failure
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(mockListener.close).toHaveBeenCalled();
    });

    it('should return early if already running', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);

      // Start once
      await manager.start();
      
      // Try to start again
      const result = await manager.start();

      expect(result.success).toBe(true);
      expect(result.message).toContain('rulează deja');
      expect(ngrok.forward).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should return error if no auth token configured', async () => {
      const managerNoToken = new NgrokManager({
        enabled: true,
        port: 3000
      });

      const result = await managerNoToken.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Token de autentificare ngrok lipsește');
      expect(ngrok.forward).not.toHaveBeenCalled();
    });
  });

  describe('error categorization', () => {
    it('should categorize authentication errors correctly', async () => {
      (ngrok.forward as any).mockRejectedValueOnce(new Error('ERR_NGROK_108'));

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Token de autentificare invalid');
    });

    it('should categorize network errors correctly', async () => {
      // Mock all attempts to return the same network error
      (ngrok.forward as any)
        .mockRejectedValueOnce(new Error('ENOTFOUND'))
        .mockRejectedValueOnce(new Error('ENOTFOUND'))
        .mockRejectedValueOnce(new Error('ENOTFOUND'));

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Eroare de conexiune la rețea');
    });

    it('should categorize timeout errors correctly', async () => {
      (ngrok.forward as any).mockRejectedValueOnce(new Error('timeout'));

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('expirat');
    });

    it('should handle unknown errors gracefully', async () => {
      // Mock all attempts to return the same unknown error
      (ngrok.forward as any)
        .mockRejectedValueOnce(new Error('Unknown weird error'))
        .mockRejectedValueOnce(new Error('Unknown weird error'))
        .mockRejectedValueOnce(new Error('Unknown weird error'));

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Eroare');
    });
  });

  describe('exponential backoff timing', () => {
    it('should wait 1s, 2s, 4s between retries', async () => {
      vi.useFakeTimers();
      
      (ngrok.forward as any).mockRejectedValue(new Error('ETIMEDOUT'));

      const startPromise = manager.start();

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(0);
      
      // Wait 1 second for first retry
      await vi.advanceTimersByTimeAsync(1000);
      
      // Wait 2 seconds for second retry
      await vi.advanceTimersByTimeAsync(2000);
      
      // Wait 4 seconds for third retry (not needed as it's the last attempt)
      await vi.advanceTimersByTimeAsync(4000);

      const result = await startPromise;

      expect(result.success).toBe(false);
      expect(ngrok.forward).toHaveBeenCalledTimes(3);
      
      vi.useRealTimers();
    });
  });
});

describe('NgrokManager Health Monitoring', () => {
  let manager: NgrokManager;
  const mockToken = 'a'.repeat(40);

  beforeEach(() => {
    manager = new NgrokManager({
      enabled: true,
      port: 3000,
      authToken: mockToken
    });
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('healthCheck', () => {
    it('should return false when no listener exists', async () => {
      const result = await manager.healthCheck();
      expect(result).toBe(false);
    });

    it('should return true when listener is healthy', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      const result = await manager.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when listener.url() throws error', async () => {
      const mockListener = {
        url: () => { throw new Error('Connection lost'); },
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      const startPromise = manager.start();
      await vi.runAllTimersAsync();
      await startPromise;

      const result = await manager.healthCheck();
      expect(result).toBe(false);
    });

    it('should return false when listener.url() returns null', async () => {
      const mockListener = {
        url: () => null,
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      const startPromise = manager.start();
      await vi.runAllTimersAsync();
      await startPromise;

      const result = await manager.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('health monitoring lifecycle', () => {
    it('should start health monitoring when tunnel starts successfully', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      // Health check should be scheduled
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });

    it('should stop health monitoring when tunnel stops', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      await manager.stop();

      // All timers should be cleared
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should perform health checks every 30 seconds', async () => {
      const mockListener = {
        url: vi.fn(() => 'https://test.ngrok.io'),
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      // Initial call count
      const initialCalls = mockListener.url.mock.calls.length;

      // Advance 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockListener.url).toHaveBeenCalledTimes(initialCalls + 1);

      // Advance another 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockListener.url).toHaveBeenCalledTimes(initialCalls + 2);

      // Advance another 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockListener.url).toHaveBeenCalledTimes(initialCalls + 3);
    });

    it('should not start health monitoring if tunnel start fails', async () => {
      (ngrok.forward as any).mockRejectedValue(new Error('authentication failed'));
      
      await manager.start();

      // No timers should be scheduled
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('automatic restart on health check failure', () => {
    it('should attempt restart after 3 consecutive health check failures', async () => {
      let callCount = 0;
      const mockListener = {
        url: vi.fn(() => {
          callCount++;
          // First call is for initial start, then health checks
          if (callCount === 1) return 'https://test.ngrok.io'; // Initial start
          if (callCount === 2) return 'https://test.ngrok.io'; // First health check - success
          // Next 3 calls fail (health checks 2, 3, 4)
          if (callCount <= 5) return null;
          // After restart
          return 'https://restarted.ngrok.io';
        }),
        close: vi.fn()
      };
      
      const mockRestartListener = {
        url: () => 'https://restarted.ngrok.io',
        close: vi.fn()
      };

      (ngrok.forward as any)
        .mockResolvedValueOnce(mockListener)
        .mockResolvedValueOnce(mockRestartListener);

      await manager.start();

      // First health check - success
      await vi.advanceTimersByTimeAsync(30000);
      
      // Second health check - fail 1
      await vi.advanceTimersByTimeAsync(30000);
      
      // Third health check - fail 2
      await vi.advanceTimersByTimeAsync(30000);
      
      // Fourth health check - fail 3 (triggers restart)
      await vi.advanceTimersByTimeAsync(30000);
      
      // Wait for restart delay (1 second)
      await vi.advanceTimersByTimeAsync(1000);

      // Should have called forward twice (initial start + restart)
      expect(ngrok.forward).toHaveBeenCalledTimes(2);
    });

    it('should reset failure counter on successful health check', async () => {
      let callCount = 0;
      const mockListener = {
        url: vi.fn(() => {
          callCount++;
          if (callCount === 1) return 'https://test.ngrok.io'; // Initial start
          if (callCount === 2) return null; // First health check - fail 1
          if (callCount === 3) return null; // Second health check - fail 2
          if (callCount === 4) return 'https://test.ngrok.io'; // Third health check - success (resets counter)
          if (callCount === 5) return null; // Fourth health check - fail 1 (counter reset)
          return null; // Fifth health check - fail 2
        }),
        close: vi.fn()
      };

      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      // Fail twice
      await vi.advanceTimersByTimeAsync(30000);
      await vi.advanceTimersByTimeAsync(30000);
      
      // Success (resets counter)
      await vi.advanceTimersByTimeAsync(30000);
      
      // Fail twice more (should not trigger restart yet - only 2 failures after reset)
      await vi.advanceTimersByTimeAsync(30000);
      await vi.advanceTimersByTimeAsync(30000);

      // Should only have called forward once (no restart)
      expect(ngrok.forward).toHaveBeenCalledTimes(1);
    });
  });

  describe('restart method', () => {
    it('should stop and start the tunnel', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      const mockRestartListener = {
        url: () => 'https://restarted.ngrok.io',
        close: vi.fn()
      };

      (ngrok.forward as any)
        .mockResolvedValueOnce(mockListener)
        .mockResolvedValueOnce(mockRestartListener);

      await manager.start();
      
      const restartPromise = manager.restart();
      await vi.advanceTimersByTimeAsync(1000); // Wait for restart delay
      const result = await restartPromise;

      expect(result.success).toBe(true);
      expect(result.publicUrl).toBe('https://restarted.ngrok.io');
      expect(mockListener.close).toHaveBeenCalled();
      expect(ngrok.forward).toHaveBeenCalledTimes(2);
    });

    it('should wait 1 second between stop and start', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      const mockRestartListener = {
        url: () => 'https://restarted.ngrok.io',
        close: vi.fn()
      };

      (ngrok.forward as any)
        .mockResolvedValueOnce(mockListener)
        .mockResolvedValueOnce(mockRestartListener);

      await manager.start();
      
      const restartPromise = manager.restart();
      
      // Should wait 1 second
      await vi.advanceTimersByTimeAsync(1000);
      
      const result = await restartPromise;

      expect(result.success).toBe(true);
    });

    it('should return error if restart fails', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };

      (ngrok.forward as any)
        .mockResolvedValueOnce(mockListener)
        .mockRejectedValueOnce(new Error('authentication failed'));

      await manager.start();
      
      const restartPromise = manager.restart();
      await vi.advanceTimersByTimeAsync(1000); // Wait for restart delay
      const result = await restartPromise;

      expect(result.success).toBe(false);
      expect(result.message).toContain('Token de autentificare invalid');
    });
  });

  describe('cleanup on app shutdown', () => {
    it('should stop health monitoring when stop is called', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      // Verify health monitoring is running
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await manager.stop();

      // Verify all timers are cleared
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should clear health monitoring interval even if listener close fails', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn().mockRejectedValue(new Error('Close failed'))
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      await manager.stop();

      // Health monitoring should still be stopped
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('getStatus with health monitoring', () => {
    it('should expose health status through getStatus', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      const status = await manager.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.publicUrl).toBe('https://test.ngrok.io');
      expect(status.webhookUrl).toBe('https://test.ngrok.io/webhook');
    });

    it('should detect when listener becomes unhealthy', async () => {
      let callCount = 0;
      const mockListener = {
        url: vi.fn(() => {
          callCount++;
          if (callCount === 1) return 'https://test.ngrok.io'; // Initial start
          return null; // getStatus check - unhealthy
        }),
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);
      await manager.start();

      const status = await manager.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.publicUrl).toBe(null);
    });
  });
});

describe('NgrokConfig Migration', () => {
  describe('migrateNgrokConfig', () => {
    it('should migrate legacy config with all fields', () => {
      const oldConfig = {
        authToken: 'test_token_1234567890123456789012345678901234567890',
        enabled: true,
        port: 8080,
        domain: 'my-app.ngrok.io',
        region: 'eu' as const,
        metadata: { app: 'test', version: '1.0' }
      };

      const migrated = migrateNgrokConfig(oldConfig);

      expect(migrated).toEqual({
        authToken: 'test_token_1234567890123456789012345678901234567890',
        enabled: true,
        port: 8080,
        domain: 'my-app.ngrok.io',
        region: 'eu',
        metadata: { app: 'test', version: '1.0' }
      });
    });

    it('should provide defaults for missing optional fields', () => {
      const oldConfig = {
        authToken: 'test_token_1234567890123456789012345678901234567890',
        enabled: true,
        port: 3000
      };

      const migrated = migrateNgrokConfig(oldConfig);

      expect(migrated.authToken).toBe('test_token_1234567890123456789012345678901234567890');
      expect(migrated.enabled).toBe(true);
      expect(migrated.port).toBe(3000);
      expect(migrated.region).toBe('us'); // Default region
      expect(migrated.domain).toBeUndefined();
      expect(migrated.metadata).toBeUndefined();
    });

    it('should default enabled to false if not provided', () => {
      const oldConfig = {
        authToken: 'test_token_1234567890123456789012345678901234567890',
        port: 3000
      };

      const migrated = migrateNgrokConfig(oldConfig);

      expect(migrated.enabled).toBe(false);
    });

    it('should default port to 3000 if not provided', () => {
      const oldConfig = {
        authToken: 'test_token_1234567890123456789012345678901234567890',
        enabled: true
      };

      const migrated = migrateNgrokConfig(oldConfig);

      expect(migrated.port).toBe(3000);
    });

    it('should handle config with only authToken', () => {
      const oldConfig = {
        authToken: 'test_token_1234567890123456789012345678901234567890'
      };

      const migrated = migrateNgrokConfig(oldConfig);

      expect(migrated.authToken).toBe('test_token_1234567890123456789012345678901234567890');
      expect(migrated.enabled).toBe(false);
      expect(migrated.port).toBe(3000);
      expect(migrated.region).toBe('us');
    });

    it('should preserve metadata when provided', () => {
      const oldConfig = {
        authToken: 'test_token_1234567890123456789012345678901234567890',
        enabled: true,
        port: 3000,
        metadata: {
          app: 'my-app',
          version: '2.0',
          environment: 'production'
        }
      };

      const migrated = migrateNgrokConfig(oldConfig);

      expect(migrated.metadata).toEqual({
        app: 'my-app',
        version: '2.0',
        environment: 'production'
      });
    });

    it('should handle empty metadata object', () => {
      const oldConfig = {
        authToken: 'test_token_1234567890123456789012345678901234567890',
        enabled: true,
        port: 3000,
        metadata: {}
      };

      const migrated = migrateNgrokConfig(oldConfig);

      expect(migrated.metadata).toEqual({});
    });

    it('should maintain backward compatibility with configs missing new fields', () => {
      // Simulate old config that doesn't have domain, region, or metadata
      const oldConfig = {
        authToken: 'test_token_1234567890123456789012345678901234567890',
        enabled: true,
        port: 3000
      };

      const migrated = migrateNgrokConfig(oldConfig);

      // Should not throw and should provide sensible defaults
      expect(migrated).toBeDefined();
      expect(migrated.authToken).toBe('test_token_1234567890123456789012345678901234567890');
      expect(migrated.enabled).toBe(true);
      expect(migrated.port).toBe(3000);
    });
  });

  describe('NgrokManager with metadata', () => {
    it('should pass metadata to ngrok.forward when starting tunnel', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);

      const manager = new NgrokManager({
        enabled: true,
        port: 3000,
        authToken: 'a'.repeat(40),
        metadata: {
          app: 'test-app',
          version: '1.0.0'
        }
      });

      await manager.start();

      expect(ngrok.forward).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: JSON.stringify({
            app: 'test-app',
            version: '1.0.0'
          })
        })
      );
    });

    it('should not pass metadata if not configured', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);

      const manager = new NgrokManager({
        enabled: true,
        port: 3000,
        authToken: 'a'.repeat(40)
      });

      await manager.start();

      const forwardCall = (ngrok.forward as any).mock.calls[0][0];
      expect(forwardCall.metadata).toBeUndefined();
    });

    it('should handle empty metadata object', async () => {
      const mockListener = {
        url: () => 'https://test.ngrok.io',
        close: vi.fn()
      };
      
      (ngrok.forward as any).mockResolvedValueOnce(mockListener);

      const manager = new NgrokManager({
        enabled: true,
        port: 3000,
        authToken: 'a'.repeat(40),
        metadata: {}
      });

      await manager.start();

      expect(ngrok.forward).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: JSON.stringify({})
        })
      );
    });
  });
});
