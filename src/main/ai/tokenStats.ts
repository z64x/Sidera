import { logInfo, secondsFromMs } from '../logging';

type TokenStatsLog = {
  provider: 'openai' | 'gemini' | 'deepseek' | 'claude';
  mode: 'direct' | 'proxy';
  model: string;
  phase: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  toolCalls?: number;
  extra?: Record<string, unknown>;
};

function convertExtraMsToSeconds(extra?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!extra) return undefined;

  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'number' && (key.endsWith('Ms') || key.includes('ms'))) {
      const normalizedKey = key.replace(/Ms$/g, 'Seconds').replace(/ms/g, 'seconds');
      converted[normalizedKey] = secondsFromMs(value);
    } else {
      converted[key] = value;
    }
  }

  return converted;
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateUnknownValueTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return estimateTextTokens(value);
  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

export function estimateOpenAIMessagesTokens(messages: Array<any>): number {
  let total = 0;

  for (const message of messages || []) {
    total += 4;

    if (typeof message?.content === 'string') {
      total += estimateTextTokens(message.content);
    } else if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part?.type === 'text') total += estimateTextTokens(part.text || '');
        else if (part?.type === 'image_url') total += 85;
        else total += estimateUnknownValueTokens(part);
      }
    }

    if (Array.isArray(message?.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        total += estimateTextTokens(toolCall?.function?.name || '');
        total += estimateTextTokens(toolCall?.function?.arguments || '');
      }
    }

    if (typeof message?.tool_call_id === 'string') {
      total += estimateTextTokens(message.tool_call_id);
    }
  }

  return total;
}

export function estimateGeminiContentsTokens(contents: Array<any>, systemPrompt?: string): number {
  let total = systemPrompt ? estimateTextTokens(systemPrompt) : 0;

  for (const content of contents || []) {
    total += 2;
    for (const part of content?.parts || []) {
      if (typeof part?.text === 'string') total += estimateTextTokens(part.text);
      else if (part?.inlineData?.data) total += 85;
      else if (part?.functionCall) total += estimateUnknownValueTokens(part.functionCall);
      else if (part?.functionResponse) total += estimateUnknownValueTokens(part.functionResponse);
      else total += estimateUnknownValueTokens(part);
    }
  }

  return total;
}

export function estimateTextOutputTokens(text: string): number {
  return estimateTextTokens(text);
}

export function logTokenStats(stats: TokenStatsLog): void {
  logInfo('AI', 'token_stats', {
    provider: stats.provider,
    mode: stats.mode,
    model: stats.model,
    phase: stats.phase,
    inputTokens: stats.inputTokens ?? null,
    outputTokens: stats.outputTokens ?? null,
    totalTokens: stats.totalTokens ?? null,
    durationSeconds: secondsFromMs(stats.durationMs),
    toolCalls: stats.toolCalls ?? 0,
    ...(convertExtraMsToSeconds(stats.extra) || {}),
  });
}
