import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import mammoth from 'mammoth';
import { addToDatabase, deleteKnowledgeChunks } from './client';
import { KnowledgeFile } from '../../shared/types';

type KnowledgeProcessingStatus = NonNullable<KnowledgeFile['status']>;

export type KnowledgeProcessingResult = {
  status: KnowledgeProcessingStatus;
  chunksProcessed: number;
  error?: string;
  lastIndexedAt?: number;
  contentHash?: string;
};

async function hashFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function extractPdfText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const canvas = await import('@napi-rs/canvas');
  const globals = globalThis as any;
  globals.DOMMatrix ??= canvas.DOMMatrix;
  globals.ImageData ??= canvas.ImageData;
  globals.Path2D ??= canvas.Path2D;

  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

async function extractTextFromFile(filePath: string, type: string): Promise<{ text: string; unsupported?: boolean }> {
  if (type === 'text') {
    return { text: await fs.readFile(filePath, 'utf-8') };
  }
  if (type === 'pdf') {
    return { text: await extractPdfText(filePath) };
  }
  if (type === 'docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return { text: result.value || '' };
  }
  return { text: '', unsupported: true };
}

function chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim()) {
      chunks.push(chunk);
    }
  }
  
  return chunks.length > 0 ? chunks : [text];
}

export async function processKnowledgeFile(
  profileId: string,
  file: KnowledgeFile
): Promise<KnowledgeProcessingResult> {
  try {
    const contentHash = await hashFile(file.path);
    const extracted = await extractTextFromFile(file.path, file.type);

    if (extracted.unsupported) {
      return {
        status: 'unsupported',
        chunksProcessed: 0,
        error: 'Format neacceptat pentru indexare knowledge.',
        contentHash,
      };
    }

    const text = extracted.text;
    
    if (!text.trim()) {
      return {
        status: 'failed',
        chunksProcessed: 0,
        error: 'Nu s-a putut extrage text din fisier.',
        contentHash,
      };
    }

    const chunks = chunkText(text);
    await deleteKnowledgeChunks(profileId, file.id);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const metadata = {
        profileId,
        fileId: file.id,
        fileName: file.name,
        fileType: file.type,
        chunkIndex: i,
        totalChunks: chunks.length,
        addedAt: file.addedAt,
        contentHash,
      };

      await addToDatabase(chunk, metadata, { isKnowledge: true });
    }

    return {
      status: 'indexed',
      chunksProcessed: chunks.length,
      lastIndexedAt: Date.now(),
      contentHash,
    };
  } catch (error: any) {
    return {
      status: 'failed',
      chunksProcessed: 0,
      error: error?.message || 'Procesarea fisierului a esuat.',
    };
  }
}

export async function reprocessAllKnowledgeFiles(profileId: string, files: KnowledgeFile[]): Promise<void> {
  for (const file of files) {
    await processKnowledgeFile(profileId, file);
  }
}

