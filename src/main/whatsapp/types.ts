// WhatsApp Integration Types

export type WhatsAppMethod = 'business-cloud' | 'twilio';

export interface WhatsAppConfig {
  activeMethod?: WhatsAppMethod;
  businessCloud?: {
    apiToken: string;
    phoneNumberId: string;
    businessAccountId: string;
    webhookToken: string;
  };
  twilio?: {
    accountSid: string;
    authToken: string;
    whatsappNumber: string;
    webhookUrl: string;
  };
  webhook?: {
    publicUrl: string;
    provider: 'cloudflare' | 'ngrok' | 'custom';
  };
  allowedNumbers: string[];
  replyToUnauthorized?: boolean;
}

export interface WhatsAppMessage {
  from: string;
  to?: string;
  body: string;
  timestamp: number;
  messageId: string;
  profileName?: string;
  media?: WhatsAppMediaAttachment[];
}

export interface WhatsAppMediaAttachment {
  type: 'image';
  id?: string;
  url?: string;
  mimeType: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppInstance {
  id: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'connected';
  qrCode?: string;
  phoneNumber?: string;
}
