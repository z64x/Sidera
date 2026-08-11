// Twilio WhatsApp API Implementation
import axios from 'axios';
import { FileAttachment } from '../../shared/types';
import { saveWhatsAppImageAttachment } from './media';
import { WhatsAppConfig, WhatsAppMediaAttachment, WhatsAppMessage, WhatsAppSendResult } from './types';
import { normalizeWhatsAppNumber } from './authorization';

export class TwilioAPI {
  private config: WhatsAppConfig['twilio'];

  constructor(config: WhatsAppConfig['twilio']) {
    if (!config) {
      throw new Error('Twilio configuration is required');
    }
    this.config = config;
  }

  /**
   * Send a text message via Twilio WhatsApp API
   */
  async sendMessage(to: string, message: string): Promise<WhatsAppSendResult> {
    try {
      if (!this.config) {
        return { success: false, error: 'Twilio API not configured' };
      }

      // Twilio WhatsApp has a 1600 character limit
      const MAX_LENGTH = 1600;
      
      // If message is too long, truncate and add warning
      if (message.length > MAX_LENGTH) {
        console.warn(`[WhatsApp Twilio] Message too long (${message.length} chars), truncating to ${MAX_LENGTH}`);
        message = message.substring(0, MAX_LENGTH - 50) + '\n\n...(mesaj trunchiat - prea lung pentru WhatsApp)';
      }

      // Ensure phone numbers have whatsapp: prefix
      const configuredFrom = normalizeWhatsAppNumber(this.config.whatsappNumber);
      const fromNumber = this.config.whatsappNumber.startsWith('whatsapp:')
        ? this.config.whatsappNumber
        : `whatsapp:${configuredFrom}`;
      
      const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${normalizeWhatsAppNumber(to)}`;

      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
      
      const params = new URLSearchParams();
      params.append('From', fromNumber);
      params.append('To', toNumber);
      params.append('Body', message);

      const response = await axios.post(url, params, {
        auth: {
          username: this.config.accountSid,
          password: this.config.authToken
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        success: true,
        messageId: response.data.sid
      };
    } catch (error: any) {
      console.error('[WhatsApp Twilio] Send error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Parse incoming Twilio webhook message
   */
  parseWebhookMessage(body: any): WhatsAppMessage | null {
    try {
      // Twilio sends form-encoded data
      if (!body.From || (!body.Body && !Number(body.NumMedia || 0))) {
        return null;
      }

      // Ignore status callbacks (these have MessageStatus but no Body, or SmsStatus that's not "received")
      // "received" means incoming message, other statuses like "sent", "delivered", "read" are outbound
      if (body.SmsStatus && body.SmsStatus !== 'received') {
        console.log('[WhatsApp Twilio] Ignoring status callback:', body.SmsStatus);
        return null;
      }

      // Remove whatsapp: prefix if present
      const from = normalizeWhatsAppNumber(body.From);
      
      // Additional check: if From is our number, it's an outbound message
      if (from === normalizeWhatsAppNumber(this.config?.whatsappNumber)) {
        console.log('[WhatsApp Twilio] Ignoring outbound message');
        return null;
      }
      
      const media = this.parseMediaAttachments(body);

      return {
        from: from,
        body: body.Body || '',
        timestamp: Date.now(),
        messageId: body.MessageSid || body.SmsSid,
        profileName: body.ProfileName,
        media: media.length > 0 ? media : undefined,
      };
    } catch (error) {
      console.error('[WhatsApp Twilio] Parse error:', error);
      return null;
    }
  }

  /**
   * Verify Twilio webhook signature (optional but recommended)
   */
  verifyWebhookSignature(signature: string, url: string, params: any): boolean {
    // TODO: Implement Twilio signature verification using twilio-node library
    // For now, we'll accept all requests
    console.warn('[WhatsApp Twilio] Webhook signature verification not implemented');
    return true;
  }

  async downloadMediaAttachment(media: WhatsAppMediaAttachment, databasePath: string): Promise<FileAttachment> {
    if (!this.config) {
      throw new Error('Twilio API not configured');
    }
    if (!media.url) {
      throw new Error('Twilio media URL is required');
    }

    const response = await axios.get(media.url, {
      responseType: 'arraybuffer',
      auth: {
        username: this.config.accountSid,
        password: this.config.authToken,
      },
    });

    return saveWhatsAppImageAttachment({
      buffer: Buffer.from(response.data),
      databasePath,
      mimeType: media.mimeType,
      sourceName: media.filename || media.id || 'twilio-image',
    });
  }

  private parseMediaAttachments(body: any): WhatsAppMediaAttachment[] {
    const count = Number(body.NumMedia || 0);
    const media: WhatsAppMediaAttachment[] = [];

    for (let index = 0; index < count; index += 1) {
      const url = body[`MediaUrl${index}`];
      const mimeType = body[`MediaContentType${index}`];
      if (!url || !mimeType || !String(mimeType).toLowerCase().startsWith('image/')) {
        continue;
      }

      media.push({
        type: 'image',
        url,
        mimeType,
        id: body.MediaSid || body.MessageSid || body.SmsSid,
        filename: `twilio-media-${index}`,
      });
    }

    return media;
  }
}
