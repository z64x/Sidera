// WhatsApp Business Cloud API Implementation
import axios from 'axios';
import { FileAttachment } from '../../shared/types';
import { saveWhatsAppImageAttachment } from './media';
import { WhatsAppConfig, WhatsAppMediaAttachment, WhatsAppMessage, WhatsAppSendResult } from './types';
import { normalizeWhatsAppNumber } from './authorization';

const WHATSAPP_API_VERSION = 'v21.0';
const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

export class BusinessCloudAPI {
  private config: WhatsAppConfig['businessCloud'];

  constructor(config: WhatsAppConfig['businessCloud']) {
    if (!config) {
      throw new Error('Business Cloud API configuration is required');
    }
    this.config = config;
  }

  /**
   * Send a text message via WhatsApp Business Cloud API
   */
  async sendMessage(to: string, message: string): Promise<WhatsAppSendResult> {
    try {
      if (!this.config) {
        return { success: false, error: 'Business Cloud API not configured' };
      }

      const url = `${WHATSAPP_API_BASE}/${this.config.phoneNumberId}/messages`;
      
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizeWhatsAppNumber(to),
          type: 'text',
          text: { body: message }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        messageId: response.data.messages?.[0]?.id
      };
    } catch (error: any) {
      console.error('[WhatsApp Business Cloud] Send error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (!this.config) {
      return null;
    }

    if (mode === 'subscribe' && token === this.config.webhookToken) {
      console.log('[WhatsApp Business Cloud] Webhook verified');
      return challenge;
    }
    
    console.error('[WhatsApp Business Cloud] Webhook verification failed');
    return null;
  }

  /**
   * Parse incoming webhook message
   */
  parseWebhookMessage(body: any): WhatsAppMessage | null {
    try {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message || (message.type !== 'text' && message.type !== 'image')) {
        return null;
      }

      const contact = value?.contacts?.[0];
      const timestamp = parseInt(message.timestamp) * 1000;

      if (message.type === 'image') {
        const image = message.image;
        if (!image?.id || !image?.mime_type) {
          return null;
        }

        return {
          from: message.from,
          body: image.caption || '',
          timestamp,
          messageId: message.id,
          profileName: contact?.profile?.name,
          media: [
            {
              type: 'image',
              id: image.id,
              mimeType: image.mime_type,
              sha256: image.sha256,
              caption: image.caption,
            },
          ],
        };
      }
      
      return {
        from: message.from,
        body: message.text.body,
        timestamp,
        messageId: message.id,
        profileName: contact?.profile?.name
      };
    } catch (error) {
      console.error('[WhatsApp Business Cloud] Parse error:', error);
      return null;
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<boolean> {
    try {
      if (!this.config) {
        return false;
      }

      const url = `${WHATSAPP_API_BASE}/${this.config.phoneNumberId}/messages`;
      
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return true;
    } catch (error) {
      console.error('[WhatsApp Business Cloud] Mark as read error:', error);
      return false;
    }
  }

  async downloadMediaAttachment(media: WhatsAppMediaAttachment, databasePath: string): Promise<FileAttachment> {
    if (!this.config) {
      throw new Error('Business Cloud API not configured');
    }
    if (!media.id) {
      throw new Error('Business Cloud media id is required');
    }

    const metadataResponse = await axios.get(`${WHATSAPP_API_BASE}/${media.id}`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiToken}`,
      },
    });

    const mediaUrl = metadataResponse.data?.url;
    const mimeType = metadataResponse.data?.mime_type || media.mimeType;
    if (!mediaUrl) {
      throw new Error('Business Cloud media URL missing from Graph API response');
    }

    const fileResponse = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${this.config.apiToken}`,
      },
    });

    return saveWhatsAppImageAttachment({
      buffer: Buffer.from(fileResponse.data),
      databasePath,
      mimeType,
      sourceName: media.id,
    });
  }
}
