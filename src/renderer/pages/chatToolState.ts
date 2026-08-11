import type { Message, MessagePart } from '../../shared/types';

export type ToolPart = Extract<MessagePart, { type: 'tool' }>;

export type ToolCallEnvelope = {
  conversationId: string;
  messageId: string;
  tool?: ToolPart;
};

export type ToolResultEnvelope = {
  conversationId: string;
  messageId: string;
  result?: any;
};

export type ToolConfirmationEnvelope = {
  conversationId?: string;
  messageId?: string;
  toolCallId?: string;
  toolName: string;
  args: Record<string, any>;
  id: string;
  reason: string;
};

export type RoutedToolUpdate = {
  conversationId: string;
  messageId: string;
};

export function stringifyToolPayload(value: unknown) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getToolRouteKey(conversationId?: string, messageId?: string) {
  if (!conversationId || !messageId) return '';
  return `${conversationId}::${messageId}`;
}

export function mergeLiveToolParts(parts: MessagePart[], liveToolParts: ToolPart[]) {
  if (!liveToolParts.length) return parts;

  const merged = [...parts];
  for (const liveTool of liveToolParts) {
    const existingIndex = merged.findIndex((part) => part.type === 'tool' && part.id === liveTool.id);
    if (existingIndex === -1) {
      merged.push(liveTool);
    } else {
      merged[existingIndex] = liveTool;
    }
  }
  return merged;
}

export function getLiveToolParts(store: Map<string, ToolPart[]>, conversationId?: string, messageId?: string) {
  const key = getToolRouteKey(conversationId, messageId);
  return key ? store.get(key) || [] : [];
}

export function setLiveToolParts(store: Map<string, ToolPart[]>, route: RoutedToolUpdate, parts: ToolPart[]) {
  store.set(getToolRouteKey(route.conversationId, route.messageId), parts);
}

export function clearLiveToolParts(store: Map<string, ToolPart[]>, route?: Partial<RoutedToolUpdate>) {
  const key = getToolRouteKey(route?.conversationId, route?.messageId);
  if (key) store.delete(key);
  else store.clear();
}

export function upsertLiveToolPart(liveToolParts: ToolPart[], tool: ToolPart) {
  const now = Date.now();
  const normalizedTool = { ...tool, updatedAt: tool.updatedAt || now };
  const existingIndex = liveToolParts.findIndex((part) => part.id === normalizedTool.id);
  if (existingIndex === -1) return [...liveToolParts, normalizedTool];

  const next = [...liveToolParts];
  next[existingIndex] = normalizedTool;
  return next;
}

export function updateLiveToolPart(
  liveToolParts: ToolPart[],
  predicate: (part: ToolPart) => boolean,
  updater: (part: ToolPart) => ToolPart,
) {
  for (let index = liveToolParts.length - 1; index >= 0; index -= 1) {
    const part = liveToolParts[index];
    if (predicate(part)) {
      const next = [...liveToolParts];
      next[index] = updater(part);
      return next;
    }
  }
  return liveToolParts;
}

export function normalizeToolCallPayload(payload: ToolPart | ToolCallEnvelope): { conversationId?: string; messageId?: string; tool: ToolPart } | null {
  const maybeEnvelope = payload as ToolCallEnvelope;
  const tool = maybeEnvelope.tool || (payload as ToolPart);
  if (!tool || typeof tool !== 'object' || tool.type !== 'tool' || !tool.id) return null;
  if (maybeEnvelope.tool && (!maybeEnvelope.conversationId || !maybeEnvelope.messageId)) return null;

  return {
    conversationId: maybeEnvelope.tool ? maybeEnvelope.conversationId : undefined,
    messageId: maybeEnvelope.tool ? maybeEnvelope.messageId : undefined,
    tool: {
      ...tool,
      args: tool.args || {},
      argsText: typeof tool.argsText === 'string' ? tool.argsText : '',
      status: tool.status || 'running',
      phase: tool.phase || (tool.status === 'running' ? 'running' : undefined),
    },
  };
}

export function normalizeToolResultPayload(payload: any): { conversationId?: string; messageId?: string; result: any } | null {
  const maybeEnvelope = payload as ToolResultEnvelope;
  const hasResultEnvelope = Object.prototype.hasOwnProperty.call(maybeEnvelope, 'result');
  const result = hasResultEnvelope ? maybeEnvelope.result : payload;
  if (!result || typeof result !== 'object') return null;
  if (hasResultEnvelope && (!maybeEnvelope.conversationId || !maybeEnvelope.messageId)) return null;

  return {
    conversationId: hasResultEnvelope ? maybeEnvelope.conversationId : undefined,
    messageId: hasResultEnvelope ? maybeEnvelope.messageId : undefined,
    result,
  };
}

export function normalizeConfirmationPayload(payload: any): ToolConfirmationEnvelope | null {
  if (!payload || typeof payload !== 'object' || !payload.id || !payload.toolName) return null;
  return payload as ToolConfirmationEnvelope;
}

export function findConfirmationToolIndex(parts: MessagePart[], request: { toolName: string; toolCallId?: string }) {
  if (request.toolCallId) {
    const exactIndex = parts.findIndex((part) => part.type === 'tool' && part.id === request.toolCallId);
    if (exactIndex !== -1) return exactIndex;
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part.type === 'tool' && part.status === 'running' && part.name === request.toolName) {
      return index;
    }
  }
  return -1;
}

export function createConfirmationPart(request: ToolConfirmationEnvelope): ToolPart {
  const now = Date.now();
  return {
    type: 'tool',
    id: request.toolCallId || `confirm-${request.id}`,
    name: request.toolName,
    args: request.args || {},
    argsText: stringifyToolPayload(request.args || {}),
    status: 'pending',
    phase: undefined,
    startedAt: now,
    updatedAt: now,
    confirmationUpdatedAt: now,
    confirmation: request as any,
  };
}

export function getMessagePartsVersion(message: Message) {
  if (!message.parts?.length) return '';
  return message.parts
    .map((part) => {
      if (part.type === 'text') return `text:${part.content?.length || 0}`;
      return [
        'tool',
        part.id,
        part.name || 'pending',
        part.status,
        part.phase || '',
        part.startedAt || 0,
        part.updatedAt || 0,
        part.resultUpdatedAt || 0,
        part.confirmationUpdatedAt || 0,
        part.confirmation?.id || '',
      ].join(':');
    })
    .join('|');
}

function estimateToolPayloadTokens(value: unknown) {
  if (value === undefined || value === null) return 0;
  return Math.ceil(stringifyToolPayload(value).length / 4);
}

export function estimateMessageTokens(message: Message) {
  let total = Math.ceil(String(message.content || '').length / 4);
  for (const part of message.parts || []) {
    if (part.type === 'text') {
      total += Math.ceil(String(part.content || '').length / 4);
    } else {
      total += Math.ceil(String(part.name || '').length / 4);
      total += Math.ceil(String(part.argsText || '').length / 4);
      total += estimateToolPayloadTokens(part.args);
      total += estimateToolPayloadTokens(part.result);
      total += estimateToolPayloadTokens(part.confirmation);
    }
  }
  total += (message.attachments || []).length * 180;
  return total;
}
