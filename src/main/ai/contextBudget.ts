import { Config } from '../../shared/types';
import { logInfo } from '../logging';
import { estimateGeminiContentsTokens, estimateOpenAIMessagesTokens } from './tokenStats';

export function trimOpenAIHistoryToBudget(
  config: Config,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  latestMessage: any,
  budget = config.modelProfiles?.primary?.contextSizeTokens || 128000,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((msg) => ({ role: msg.role, content: msg.content })),
    { role: 'user' as const, content: typeof latestMessage === 'string' ? latestMessage : JSON.stringify(latestMessage) },
  ];
  if (estimateOpenAIMessagesTokens(messages as any) <= budget) return history;

  const trimmed = [...history];
  while (trimmed.length > 0) {
    trimmed.shift();
    const candidate = [
      { role: 'system' as const, content: systemPrompt },
      ...trimmed.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: 'user' as const, content: typeof latestMessage === 'string' ? latestMessage : JSON.stringify(latestMessage) },
    ];
    if (estimateOpenAIMessagesTokens(candidate as any) <= budget) break;
  }

  logInfo('ContextBudget', 'openai_history_trimmed', { before: history.length, after: trimmed.length, budget });
  return trimmed;
}

export function trimGeminiContentsToBudget(
  config: Config,
  contents: any[],
  systemPrompt: string,
  budget = config.modelProfiles?.primary?.contextSizeTokens || 128000,
): any[] {
  if (estimateGeminiContentsTokens(contents, systemPrompt) <= budget) return contents;
  const trimmed = [...contents];
  while (trimmed.length > 1 && estimateGeminiContentsTokens(trimmed, systemPrompt) > budget) {
    trimmed.shift();
  }
  logInfo('ContextBudget', 'gemini_contents_trimmed', { before: contents.length, after: trimmed.length, budget });
  return trimmed;
}
