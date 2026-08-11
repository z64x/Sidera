import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processKnowledgeFile } from '../../../src/main/lancedb/knowledge';
import type { KnowledgeFile } from '../../../src/shared/types';

const mocks = vi.hoisted(() => ({
  addToDatabase: vi.fn(),
  deleteKnowledgeChunks: vi.fn(),
}));

vi.mock('../../../src/main/lancedb/client', () => ({
  addToDatabase: mocks.addToDatabase,
  deleteKnowledgeChunks: mocks.deleteKnowledgeChunks,
}));

describe('processKnowledgeFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-test-'));
    mocks.addToDatabase.mockReset();
    mocks.deleteKnowledgeChunks.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function knowledgeFile(filePath: string, type: KnowledgeFile['type']): KnowledgeFile {
    return {
      id: 'file-1',
      name: path.basename(filePath),
      path: filePath,
      type,
      size: 0,
      addedAt: 123,
    };
  }

  it('indexes text files and reports processed chunks', async () => {
    const filePath = path.join(tempDir, 'notes.txt');
    await fs.writeFile(filePath, 'alpha beta gamma', 'utf-8');

    const result = await processKnowledgeFile('profile-1', knowledgeFile(filePath, 'text'));

    expect(result.status).toBe('indexed');
    expect(result.chunksProcessed).toBe(1);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.lastIndexedAt).toEqual(expect.any(Number));
    expect(mocks.deleteKnowledgeChunks).toHaveBeenCalledWith('profile-1', 'file-1');
    expect(mocks.addToDatabase).toHaveBeenCalledWith(
      'alpha beta gamma',
      expect.objectContaining({
        profileId: 'profile-1',
        fileId: 'file-1',
        fileName: 'notes.txt',
        chunkIndex: 0,
        totalChunks: 1,
        contentHash: result.contentHash,
      }),
      { isKnowledge: true },
    );
  });

  it('marks empty text files as failed', async () => {
    const filePath = path.join(tempDir, 'empty.txt');
    await fs.writeFile(filePath, '   ', 'utf-8');

    const result = await processKnowledgeFile('profile-1', knowledgeFile(filePath, 'text'));

    expect(result.status).toBe('failed');
    expect(result.chunksProcessed).toBe(0);
    expect(result.error).toContain('Nu s-a putut extrage text');
    expect(mocks.addToDatabase).not.toHaveBeenCalled();
  });

  it('marks unsupported files without indexing them', async () => {
    const filePath = path.join(tempDir, 'image.png');
    await fs.writeFile(filePath, 'not-an-image', 'utf-8');

    const result = await processKnowledgeFile('profile-1', knowledgeFile(filePath, 'image'));

    expect(result.status).toBe('unsupported');
    expect(result.chunksProcessed).toBe(0);
    expect(result.error).toContain('Format neacceptat');
    expect(mocks.addToDatabase).not.toHaveBeenCalled();
  });
});
