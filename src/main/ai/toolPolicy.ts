import * as fs from 'fs/promises';
import { FunctionCall, ToolConfirmationRequest, ToolId } from '../../shared/types';
import { isAbsoluteFileAccess, resolveUserPath as resolveUserPathInfo } from '../functions/pathSafety';

export type ToolDecision =
  | { allowed: true; confirmation?: ToolConfirmationRequest }
  | { allowed: false; reason: string };

export function resolveUserPath(filename: string): string {
  return resolveUserPathInfo(filename).absolutePath;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function buildConfirmation(
  functionCall: FunctionCall,
  channel: 'local' | 'whatsapp',
  risk: ToolConfirmationRequest['risk'],
  reason: string
): ToolConfirmationRequest {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolName: functionCall.name,
    args: functionCall.arguments,
    risk,
    reason,
    channel,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
}

export async function evaluateToolPolicy(params: {
  functionCall: FunctionCall;
  allowedToolIds: ToolId[];
  channel: 'local' | 'whatsapp';
  approved?: boolean;
}): Promise<ToolDecision> {
  const { functionCall, allowedToolIds, channel, approved } = params;
  const name = functionCall.name as ToolId;

  if (!allowedToolIds.includes(name)) {
    return { allowed: false, reason: `Tool "${functionCall.name}" is not enabled for this profile or global settings.` };
  }

  if (approved) return { allowed: true };

  if (name === 'delete_file') {
    return {
      allowed: true,
      confirmation: buildConfirmation(functionCall, channel, 'delete_file', 'Stergerea fisierelor necesita confirmare.'),
    };
  }

  if (name === 'delete_from_database') {
    return {
      allowed: true,
      confirmation: buildConfirmation(functionCall, channel, 'delete_database', 'Stergerea din memorie necesita confirmare.'),
    };
  }

  if ((name === 'read_file' || name === 'create_file') && isAbsoluteFileAccess(functionCall.arguments?.filename)) {
    return {
      allowed: true,
      confirmation: buildConfirmation(
        functionCall,
        channel,
        'absolute_file_access',
        `Accesul la cai absolute necesita confirmare: ${resolveUserPath(String(functionCall.arguments?.filename || ''))}`
      ),
    };
  }

  if (name === 'start_app') return { allowed: true };

  if (name === 'stop_app') {
    return {
      allowed: true,
      confirmation: buildConfirmation(functionCall, channel, 'stop_app', 'Oprirea proceselor necesita confirmare.'),
    };
  }

  if (name === 'create_file') {
    const targetPath = resolveUserPath(String(functionCall.arguments?.filename || ''));
    if (await pathExists(targetPath)) {
      return {
        allowed: true,
        confirmation: buildConfirmation(
          functionCall,
          channel,
          'overwrite_file',
          `Fisierul exista deja si ar fi suprascris: ${targetPath}`
        ),
      };
    }
  }

  return { allowed: true };
}

export function deniedToolResult(functionCall: FunctionCall, reason: string) {
  return {
    name: functionCall.name,
    result: null,
    success: false,
    error: reason,
  };
}
