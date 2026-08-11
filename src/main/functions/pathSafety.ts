import * as path from 'path';
import { app } from 'electron';

export type FileOperationKind = 'create_file' | 'read_file' | 'delete_file';

export interface ResolvedUserPath {
  input: string;
  absolutePath: string;
  isAbsoluteInput: boolean;
}

export function resolveUserPath(filename: unknown): ResolvedUserPath {
  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw new Error('File path is required.');
  }

  const input = filename.trim();
  const absolutePath = path.isAbsolute(input) ? path.normalize(input) : path.join(app.getPath('home'), input);
  return {
    input,
    absolutePath,
    isAbsoluteInput: path.isAbsolute(input),
  };
}

export function isAbsoluteFileAccess(filename: unknown): boolean {
  if (typeof filename !== 'string') return false;
  return path.isAbsolute(filename.trim());
}
