import { describe, expect, it } from 'vitest';
import { BusinessCloudAPI } from '../../../src/main/whatsapp/businessCloud';
import { TwilioAPI } from '../../../src/main/whatsapp/twilio';

function createBusinessCloudApi() {
  return new BusinessCloudAPI({
    apiToken: 'token',
    phoneNumberId: 'phone-id',
    businessAccountId: 'business-id',
    webhookToken: 'verify-token',
  });
}

function createTwilioApi() {
  return new TwilioAPI({
    accountSid: 'AC123',
    authToken: 'token',
    whatsappNumber: 'whatsapp:+15550000000',
    webhookUrl: 'https://example.com/webhook',
  });
}

describe('BusinessCloudAPI.parseWebhookMessage', () => {
  it('parses text messages', () => {
    const message = createBusinessCloudApi().parseWebhookMessage({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Luis' } }],
                messages: [
                  {
                    id: 'wamid.text',
                    from: '40722123456',
                    timestamp: '1710000000',
                    type: 'text',
                    text: { body: 'Salut' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(message).toMatchObject({
      from: '40722123456',
      body: 'Salut',
      messageId: 'wamid.text',
      profileName: 'Luis',
    });
    expect(message?.media).toBeUndefined();
  });

  it('parses image messages with captions', () => {
    const message = createBusinessCloudApi().parseWebhookMessage({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.image',
                    from: '40722123456',
                    timestamp: '1710000000',
                    type: 'image',
                    image: {
                      id: 'media-id',
                      mime_type: 'image/jpeg',
                      sha256: 'hash',
                      caption: 'Ce vezi aici?',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(message?.body).toBe('Ce vezi aici?');
    expect(message?.media).toEqual([
      {
        type: 'image',
        id: 'media-id',
        mimeType: 'image/jpeg',
        sha256: 'hash',
        caption: 'Ce vezi aici?',
      },
    ]);
  });

  it('parses image messages without captions', () => {
    const message = createBusinessCloudApi().parseWebhookMessage({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.image',
                    from: '40722123456',
                    timestamp: '1710000000',
                    type: 'image',
                    image: {
                      id: 'media-id',
                      mime_type: 'image/png',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(message?.body).toBe('');
    expect(message?.media?.[0]).toMatchObject({
      type: 'image',
      id: 'media-id',
      mimeType: 'image/png',
    });
  });

  it('ignores non-message payloads', () => {
    expect(createBusinessCloudApi().parseWebhookMessage({ entry: [{ changes: [{ value: {} }] }] })).toBeNull();
  });
});

describe('TwilioAPI.parseWebhookMessage', () => {
  it('parses text messages', () => {
    const message = createTwilioApi().parseWebhookMessage({
      From: 'whatsapp:+40722123456',
      Body: 'Salut',
      MessageSid: 'SM123',
      SmsStatus: 'received',
      ProfileName: 'Luis',
    });

    expect(message).toMatchObject({
      from: '+40722123456',
      body: 'Salut',
      messageId: 'SM123',
      profileName: 'Luis',
    });
    expect(message?.media).toBeUndefined();
  });

  it('parses image messages with media URLs', () => {
    const message = createTwilioApi().parseWebhookMessage({
      From: 'whatsapp:+40722123456',
      Body: 'Analizeaza asta',
      MessageSid: 'SM123',
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/media/ME123',
      MediaContentType0: 'image/webp',
    });

    expect(message?.body).toBe('Analizeaza asta');
    expect(message?.media).toEqual([
      {
        type: 'image',
        url: 'https://api.twilio.com/media/ME123',
        mimeType: 'image/webp',
        id: 'SM123',
        filename: 'twilio-media-0',
      },
    ]);
  });

  it('parses image messages without body text', () => {
    const message = createTwilioApi().parseWebhookMessage({
      From: 'whatsapp:+40722123456',
      MessageSid: 'SM123',
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/media/ME123',
      MediaContentType0: 'image/png',
    });

    expect(message?.body).toBe('');
    expect(message?.media?.[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
    });
  });

  it('ignores status callbacks', () => {
    expect(
      createTwilioApi().parseWebhookMessage({
        From: 'whatsapp:+40722123456',
        Body: 'delivered',
        MessageSid: 'SM123',
        SmsStatus: 'delivered',
      })
    ).toBeNull();
  });
});
