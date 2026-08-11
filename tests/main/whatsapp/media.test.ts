import * as fs from 'fs/promises';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSupportedImageExtension,
  isSupportedImageMimeType,
  saveWhatsAppImageAttachment,
} from '../../../src/main/whatsapp/media';

const tmpDirs: string[] = [];

describe('WhatsApp media helpers', () => {
  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('accepts only supported image MIME types', () => {
    expect(getSupportedImageExtension('image/jpeg')).toBe('.jpg');
    expect(getSupportedImageExtension('image/png')).toBe('.png');
    expect(getSupportedImageExtension('image/webp')).toBe('.webp');
    expect(isSupportedImageMimeType('image/gif')).toBe(false);
    expect(isSupportedImageMimeType('application/pdf')).toBe(false);
  });

  it('saves downloaded media as an image FileAttachment', async () => {
    const tmpDir = path.join(process.cwd(), '.tmp-whatsapp-media-test', `${Date.now()}`);
    tmpDirs.push(tmpDir);

    const attachment = await saveWhatsAppImageAttachment({
      buffer: Buffer.from('fake-image'),
      databasePath: tmpDir,
      mimeType: 'image/png',
      sourceName: 'media id/with weird chars',
    });

    expect(attachment.type).toBe('image');
    expect(attachment.name).toMatch(/media-id-with-weird-chars\.png$/);
    expect(attachment.path).toContain(path.join(tmpDir, 'whatsapp-media'));
    await expect(fs.readFile(attachment.path, 'utf-8')).resolves.toBe('fake-image');
  });
});
