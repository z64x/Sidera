import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessCloudAPI } from '../../../src/main/whatsapp/businessCloud';
import { TwilioAPI } from '../../../src/main/whatsapp/twilio';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedAxios = vi.mocked(axios);
const tmpDirs: string[] = [];

function makeTmpDir(label: string) {
  const dir = path.join(process.cwd(), '.tmp-whatsapp-download-test', `${Date.now()}-${label}`);
  tmpDirs.push(dir);
  return dir;
}

describe('WhatsApp media downloads', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('downloads Business Cloud media into an image attachment', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          url: 'https://lookaside.facebook.com/media/file',
          mime_type: 'image/jpeg',
        },
      })
      .mockResolvedValueOnce({
        data: Buffer.from('business-cloud-image'),
      });

    const api = new BusinessCloudAPI({
      apiToken: 'token',
      phoneNumberId: 'phone-id',
      businessAccountId: 'business-id',
      webhookToken: 'verify-token',
    });

    const attachment = await api.downloadMediaAttachment(
      { type: 'image', id: 'media-id', mimeType: 'image/jpeg' },
      makeTmpDir('business')
    );

    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v21.0/media-id',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
      })
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://lookaside.facebook.com/media/file',
      expect.objectContaining({
        responseType: 'arraybuffer',
        headers: { Authorization: 'Bearer token' },
      })
    );
    expect(attachment.type).toBe('image');
    expect(attachment.name).toMatch(/media-id\.jpg$/);
    await expect(fs.readFile(attachment.path, 'utf-8')).resolves.toBe('business-cloud-image');
  });

  it('downloads Twilio media into an image attachment', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: Buffer.from('twilio-image'),
    });

    const api = new TwilioAPI({
      accountSid: 'AC123',
      authToken: 'token',
      whatsappNumber: 'whatsapp:+15550000000',
      webhookUrl: 'https://example.com/webhook',
    });

    const attachment = await api.downloadMediaAttachment(
      {
        type: 'image',
        url: 'https://api.twilio.com/media/ME123',
        mimeType: 'image/webp',
        filename: 'twilio-file',
      },
      makeTmpDir('twilio')
    );

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.twilio.com/media/ME123',
      expect.objectContaining({
        responseType: 'arraybuffer',
        auth: {
          username: 'AC123',
          password: 'token',
        },
      })
    );
    expect(attachment.type).toBe('image');
    expect(attachment.name).toMatch(/twilio-file\.webp$/);
    await expect(fs.readFile(attachment.path, 'utf-8')).resolves.toBe('twilio-image');
  });
});
