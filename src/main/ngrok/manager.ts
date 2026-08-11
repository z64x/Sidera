// Ngrok Manager - Handle ngrok tunnel lifecycle using @ngrok/ngrok SDK
import ngrok from '@ngrok/ngrok';

interface NgrokConfig {
  authToken?: string;
  enabled: boolean;
  port: number;
  domain?: string;
  region?: 'us' | 'eu' | 'ap' | 'au' | 'sa' | 'jp' | 'in';
  metadata?: Record<string, any>;
}

/**
 * Migrate legacy config to new format with backward compatibility
 */
export function migrateNgrokConfig(oldConfig: any): NgrokConfig {
  return {
    authToken: oldConfig.authToken,
    enabled: oldConfig.enabled ?? false,
    port: oldConfig.port ?? 3000,
    // New optional fields with defaults
    domain: oldConfig.domain,
    region: oldConfig.region ?? 'us',
    metadata: oldConfig.metadata
  };
}


export class NgrokManager {
  private listener: any = null;
  private config: NgrokConfig;
  private publicUrl: string | null = null;
  private isRunning: boolean = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private consecutiveFailures: number = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  constructor(config: NgrokConfig) {
    this.config = config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: NgrokConfig) {
    this.config = config;
  }

  /**
   * Configure ngrok with auth token (validates and saves)
   */
  async configureAuthToken(authToken: string): Promise<{ success: boolean; message: string }> {
    // Use the validateToken method to check the token
    const validationResult = await this.validateToken(authToken);
    
    if (!validationResult.success) {
      return validationResult;
    }
    
    // Token is valid, save it
    this.config.authToken = authToken;
    return { success: true, message: 'Token de autentificare salvat cu succes' };
  }

  /**
   * Validate token format
   */
  private validateTokenFormat(token: string): boolean {
    // Ngrok tokens are typically 40+ characters alphanumeric with underscore and hyphen
    const tokenRegex = /^[a-zA-Z0-9_-]{40,}$/;
    return tokenRegex.test(token.trim());
  }
  /**
   * Validate token by attempting to create a test connection
   * This method can be called independently to verify a token before saving
   */
  async validateToken(token: string): Promise<{ success: boolean; message: string }> {
    try {
      // First check format
      if (!this.validateTokenFormat(token)) {
        return {
          success: false,
          message: 'Format token invalid. Token-ul trebuie să aibă minim 40 caractere alfanumerice.'
        };
      }

      // Test the token by creating a test connection
      try {
        const testListener = await ngrok.forward({
          addr: this.config.port,
          authtoken: token
        });

        // Close the test connection immediately
        await testListener.close();

        return { success: true, message: 'Token valid' };
      } catch (error: any) {
        // Use the centralized error handler
        return this.handleError(error);
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Eroare la validarea token-ului: ${error.message || 'Eroare necunoscută'}`
      };
    }
  }

  /**
   * Delay helper for retry logic
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Handle and categorize errors
   */
  private handleError(error: any): { success: false; message: string } {
    console.error('[Ngrok] Error:', error);
    
    // Authentication errors
    if (error.message?.includes('authentication') || 
        error.message?.includes('unauthorized') ||
        error.message?.includes('invalid token') ||
        error.message?.includes('ERR_NGROK_108')) {
      return {
        success: false,
        message: 'Token de autentificare invalid sau expirat'
      };
    }
    
    // Timeout errors (check before network errors since ETIMEDOUT is also a network error)
    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      return {
        success: false,
        message: 'Conexiunea a expirat. Te rog încearcă din nou.'
      };
    }
    
    // Service unavailable (check before network errors)
    if (error.message?.includes('503') || 
        error.message?.includes('service unavailable') ||
        error.message?.includes('temporarily unavailable')) {
      return {
        success: false,
        message: 'Serviciul ngrok este temporar indisponibil. Te rog încearcă din nou.'
      };
    }
    
    // Rate limiting
    if (error.message?.includes('rate limit') || 
        error.message?.includes('429') ||
        error.message?.includes('too many')) {
      return {
        success: false,
        message: 'Limită de conexiuni depășită. Te rog așteaptă câteva minute.'
      };
    }
    
    // Network errors (more general, check last)
    if (error.message?.includes('network') || 
        error.message?.includes('ENOTFOUND') ||
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('connection')) {
      return {
        success: false,
        message: 'Eroare de conexiune la rețea. Verifică conexiunea la internet.'
      };
    }
    
    // Generic error with message
    if (error.message) {
      return {
        success: false,
        message: `Eroare: ${error.message}`
      };
    }
    
    // Unknown error
    return {
      success: false,
      message: 'Eroare necunoscută la pornirea ngrok'
    };
  }

  /**
   * Check if error is retryable (not authentication error)
   */
  private isRetryableError(error: any): boolean {
    // Don't retry authentication errors
    if (error.message?.includes('authentication') || 
        error.message?.includes('unauthorized') ||
        error.message?.includes('invalid token') ||
        error.message?.includes('ERR_NGROK_108')) {
      return false;
    }
    
    // Don't retry rate limit errors
    if (error.message?.includes('rate limit') || 
        error.message?.includes('429') ||
        error.message?.includes('too many')) {
      return false;
    }
    
    // Retry network and service errors
    return true;
  }

  /**
   * Start ngrok tunnel with retry logic and exponential backoff
   */
  private async startWithRetry(maxRetries: number = 3): Promise<{ success: boolean; message: string; publicUrl?: string }> {
    let lastError: any = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Ngrok] Start attempt ${attempt}/${maxRetries}...`);
        const port = this.config.port || 3000;
        
        // Create tunnel using SDK
        this.listener = await ngrok.forward({
          addr: port,
          authtoken: this.config.authToken,
          domain: this.config.domain,
          ...(this.config.region && { region: this.config.region }),
          ...(this.config.metadata && { metadata: JSON.stringify(this.config.metadata) })
        });

        // Get the public URL
        const url = this.listener.url();
        
        if (url) {
          this.isRunning = true;
          this.publicUrl = url;
          console.log('[Ngrok] Tunnel started successfully:', url);
          return { success: true, message: 'Ngrok pornit cu succes', publicUrl: url };
        } else {
          throw new Error('Nu s-a putut obține URL-ul public de la ngrok');
        }

      } catch (error: any) {
        lastError = error;
        console.error(`[Ngrok] Attempt ${attempt} failed:`, error.message);
        
        // Clean up failed attempt
        if (this.listener) {
          try {
            await this.listener.close();
          } catch (closeError) {
            // Ignore close errors
          }
          this.listener = null;
        }
        
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          console.log('[Ngrok] Non-retryable error, stopping retry attempts');
          return this.handleError(error);
        }
        
        // If not the last attempt, wait with exponential backoff
        if (attempt < maxRetries) {
          const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
          console.log(`[Ngrok] Waiting ${delayMs}ms before retry...`);
          await this.delay(delayMs);
        }
      }
    }
    
    // All retries failed
    console.error('[Ngrok] All retry attempts failed');
    this.isRunning = false;
    this.publicUrl = null;
    this.listener = null;
    
    return this.handleError(lastError);
  }

  /**
   * Start ngrok tunnel using SDK
   */
  async start(): Promise<{ success: boolean; message: string; publicUrl?: string }> {
    if (this.isRunning) {
      return { success: true, message: 'Ngrok rulează deja', publicUrl: this.publicUrl || undefined };
    }

    if (!this.config.authToken) {
      return { success: false, message: 'Token de autentificare ngrok lipsește' };
    }

    console.log('[Ngrok] Starting tunnel with retry logic...');
    const result = await this.startWithRetry(3);
    
    // Start health monitoring if tunnel started successfully
    if (result.success) {
      this.startHealthMonitoring();
    }
    
    return result;
  }

  /**
   * Stop ngrok tunnel using SDK
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    // Stop health monitoring first
    this.stopHealthMonitoring();
    
    if (this.listener) {
      try {
        console.log('[Ngrok] Stopping tunnel...');
        await this.listener.close();
        this.listener = null;
        this.isRunning = false;
        this.publicUrl = null;
        console.log('[Ngrok] Tunnel stopped successfully');
        return { success: true, message: 'Ngrok oprit' };
      } catch (error: any) {
        console.error('[Ngrok] Error stopping tunnel:', error);
        // Clean up state even if close fails
        this.listener = null;
        this.isRunning = false;
        this.publicUrl = null;
        return { success: true, message: 'Ngrok oprit' };
      }
    }
    return { success: false, message: 'Ngrok nu rulează' };
  }

  /**
   * Check if the tunnel is healthy
   */
  async healthCheck(): Promise<boolean> {
    if (!this.listener) {
      return false;
    }
    
    try {
      const url = this.listener.url();
      return !!url;
    } catch (error) {
      console.warn('[Ngrok] Health check failed:', error);
      return false;
    }
  }

  /**
   * Start periodic health monitoring
   */
  private startHealthMonitoring(): void {
    // Clear any existing interval
    this.stopHealthMonitoring();
    
    console.log('[Ngrok] Starting health monitoring (every 30s)...');
    this.consecutiveFailures = 0;
    
    this.healthCheckInterval = setInterval(async () => {
      const isHealthy = await this.healthCheck();
      
      if (!isHealthy && this.isRunning) {
        this.consecutiveFailures++;
        console.warn(`[Ngrok] Health check failed (${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})`);
        
        if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
          console.error('[Ngrok] Max consecutive failures reached, attempting restart...');
          await this.restart();
        }
      } else if (isHealthy) {
        // Reset failure counter on successful health check
        if (this.consecutiveFailures > 0) {
          console.log('[Ngrok] Health check recovered');
          this.consecutiveFailures = 0;
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      console.log('[Ngrok] Stopping health monitoring...');
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Restart the tunnel
   */
  async restart(): Promise<{ success: boolean; message: string; publicUrl?: string }> {
    console.log('[Ngrok] Restarting tunnel...');
    
    // Stop the current tunnel
    await this.stop();
    
    // Wait a moment before restarting
    await this.delay(1000);
    
    // Start a new tunnel
    const result = await this.start();
    
    if (result.success) {
      console.log('[Ngrok] Tunnel restarted successfully');
    } else {
      console.error('[Ngrok] Tunnel restart failed:', result.message);
    }
    
    return result;
  }

  /**
   * Get current status using SDK
   */
  async getStatus(): Promise<{ 
    isRunning: boolean; 
    publicUrl: string | null; 
    webhookUrl: string | null;
    configured: boolean;
  }> {
    // If we think it's running, verify the listener is still active
    if (this.isRunning && this.listener) {
      try {
        const url = this.listener.url();
        if (url) {
          this.publicUrl = url;
        } else {
          // Listener is no longer valid
          this.isRunning = false;
          this.publicUrl = null;
          this.listener = null;
        }
      } catch (error) {
        // Listener stopped unexpectedly
        console.warn('[Ngrok] Listener check failed:', error);
        this.isRunning = false;
        this.publicUrl = null;
        this.listener = null;
      }
    }

    return {
      isRunning: this.isRunning,
      publicUrl: this.publicUrl,
      webhookUrl: this.publicUrl ? `${this.publicUrl}/webhook` : null,
      configured: !!this.config.authToken
    };
  }
}
