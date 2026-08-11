import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FileAttachment } from '../../shared/types';

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function getSupportedImageExtension(mimeType: string): string | null {
  return IMAGE_MIME_EXTENSIONS[mimeType.toLowerCase()] || null;
}

export function isSupportedImageMimeType(mimeType: string): boolean {
  return getSupportedImageExtension(mimeType) !== null;
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image';
}

export async function saveWhatsAppImageAttachment(params: {
  buffer: Buffer;
  databasePath: string;
  mimeType: string;
  sourceName?: string;
}): Promise<FileAttachment> {
  const extension = getSupportedImageExtension(params.mimeType);
  if (!extension) {
    throw new Error(`Unsupported WhatsApp image MIME type: ${params.mimeType}`);
  }

  const mediaDir = path.join(params.databasePath, 'whatsapp-media');
  await fs.mkdir(mediaDir, { recursive: true });

  const baseName = sanitizeFilePart(params.sourceName || 'whatsapp-image');
  const fileName = `${Date.now()}-${crypto.randomUUID()}-${baseName}${extension}`;
  const filePath = path.join(mediaDir, fileName);

  await fs.writeFile(filePath, params.buffer);

  return {
    name: fileName,
    path: filePath,
    type: 'image',
  };
}
