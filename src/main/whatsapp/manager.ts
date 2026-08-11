// WhatsApp Manager - Unified interface for all WhatsApp methods
import { BusinessCloudAPI } from './businessCloud';
import { TwilioAPI } from './twilio';
import { FileAttachment } from '../../shared/types';
import { WhatsAppConfig, WhatsAppMediaAttachment, WhatsAppMessage, WhatsAppSendResult } from './types';

export class WhatsAppManager {
  private config: WhatsAppConfig;
  private businessCloud?: BusinessCloudAPI;
  private twilio?: TwilioAPI;

  constructor(config: WhatsAppConfig) {
    this.config = config;
    this.initializeAPIs();
  }

  /**
   * Update configuration and reinitialize APIs
   */
  updateConfig(config: WhatsAppConfig) {
    this.config = config;
    this.initializeAPIs();
  }

  /**
   * Initialize API instances based on configuration
   */
  private initializeAPIs() {
    try {
      if (this.config.businessCloud) {
        this.businessCloud = new BusinessCloudAPI(this.config.businessCloud);
      }
    } catch (error) {
      console.error('[WhatsApp Manager] Failed to initialize Business Cloud API:', error);
    }

    try {
      if (this.config.twilio) {
        this.twilio = new TwilioAPI(this.config.twilio);
      }
    } catch (error) {
      console.error('[WhatsApp Manager] Failed to initialize Twilio API:', error);
    }

  }

  /**
   * Get the active API instance
   */
  private getActiveAPI(): BusinessCloudAPI | TwilioAPI | null {
    switch (this.config.activeMethod) {
      case 'business-cloud':
        return this.businessCloud || null;
      case 'twilio':
        return this.twilio || null;
      default:
        return null;
    }
  }

  /**
   * Send a message using the active method
   */
  async sendMessage(to: string, message: string): Promise<WhatsAppSendResult> {
    const api = this.getActiveAPI();
    
    if (!api) {
      return {
        success: false,
        error: 'No active WhatsApp method configured'
      };
    }

    return api.sendMessage(to, message);
  }

  /**
   * Parse incoming webhook message based on active method
   */
  parseWebhookMessage(body: any): WhatsAppMessage | null {
    const api = this.getActiveAPI();
    
    if (!api) {
      console.error('[WhatsApp Manager] No active method to parse webhook');
      return null;
    }

    return api.parseWebhookMessage(body);
  }

  async downloadMediaAttachment(media: WhatsAppMediaAttachment, databasePath: string): Promise<FileAttachment> {
    const api = this.getActiveAPI();

    if (!api) {
      throw new Error('No active WhatsApp method configured');
    }

    return api.downloadMediaAttachment(media, databasePath);
  }

  /**
   * Verify webhook (Business Cloud only)
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (this.config.activeMethod === 'business-cloud' && this.businessCloud) {
      return this.businessCloud.verifyWebhook(mode, token, challenge);
    }
    return null;
  }

  /**
   * Mark message as read (Business Cloud only)
   */
  async markAsRead(messageId: string): Promise<boolean> {
    if (this.config.activeMethod === 'business-cloud' && this.businessCloud) {
      return this.businessCloud.markAsRead(messageId);
    }
    return false;
  }

  /**
   * Check if WhatsApp is configured and active
   */
  isConfigured(): boolean {
    return !!this.config.activeMethod && !!this.getActiveAPI();
  }

  /**
   * Get active method name
   */
  getActiveMethod(): string | undefined {
    return this.config.activeMethod;
  }
}
