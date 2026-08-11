import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveUserPath } from './pathSafety';

export interface FileOperationResult {
  success: boolean;
  message: string;
  data?: any;
}

const MAX_READ_CHARS = 80_000;

export interface FileOperationOptions {
  allowAbsolutePath?: boolean;
}

function resolveFileOperationPath(filename: string, options?: FileOperationOptions): string {
  const resolved = resolveUserPath(filename);
  if (resolved.isAbsoluteInput && !options?.allowAbsolutePath) {
    throw new Error(`Absolute file paths require explicit approval: ${resolved.absolutePath}`);
  }
  return resolved.absolutePath;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  const root = path.parse(filePath).root;
  if (dir && dir !== filePath && dir !== root) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function createFile(filename: string, content: string, options?: FileOperationOptions): Promise<FileOperationResult> {
  try {
    const filePath = resolveFileOperationPath(filename, options);

    await ensureParentDirectory(filePath);

    // Write file
    await fs.writeFile(filePath, String(content), 'utf-8');

    return {
      success: true,
      message: `File created successfully: ${filePath}`,
      data: { path: filePath },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to create file: ${error.message}`,
    };
  }
}

export async function readFile(filename: string, options?: FileOperationOptions): Promise<FileOperationResult> {
  try {
    const filePath = resolveFileOperationPath(filename, options);

    const content = await fs.readFile(filePath, 'utf-8');
    const truncated = content.length > MAX_READ_CHARS;
    const visibleContent = truncated
      ? `${content.slice(0, MAX_READ_CHARS)}\n...[truncated: file exceeds ${MAX_READ_CHARS} characters]`
      : content;

    return {
      success: true,
      message: truncated ? `File read successfully (truncated)` : `File read successfully`,
      data: { content: visibleContent, path: filePath, truncated, originalLength: content.length },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to read file: ${error.message}`,
    };
  }
}

export async function deleteFile(filename: string, options?: FileOperationOptions): Promise<FileOperationResult> {
  try {
    const filePath = resolveFileOperationPath(filename, options);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return {
        success: false,
        message: `File does not exist: ${filePath}`,
      };
    }

    await fs.unlink(filePath);

    return {
      success: true,
      message: `File deleted successfully: ${filePath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to delete file: ${error.message}`,
    };
  }
}
