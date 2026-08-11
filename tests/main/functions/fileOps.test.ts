import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('fs/promises', () => fsMocks);
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\Users\\Luis'),
  },
}));

describe('file operations path handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fsMocks.writeFile.mockResolvedValue(undefined);
  });

  it('blocks absolute create paths until approval is forwarded', async () => {
    const { createFile } = await import('../../../src/main/functions/fileOps');

    const result = await createFile('C:\\hello_world_countdown.py', 'print("hi")');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Absolute file paths require explicit approval');
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
  });

  it('writes an approved file in a drive root without trying to mkdir the root', async () => {
    const { createFile } = await import('../../../src/main/functions/fileOps');

    const result = await createFile('C:\\hello_world_countdown.py', 'print("hi")', {
      allowAbsolutePath: true,
    });

    expect(result.success).toBe(true);
    expect(fsMocks.mkdir).not.toHaveBeenCalled();
    expect(fsMocks.writeFile).toHaveBeenCalledWith('C:\\hello_world_countdown.py', 'print("hi")', 'utf-8');
  });
});
