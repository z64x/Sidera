import { describe, expect, it } from 'vitest';
import { trimOpenAIHistoryToBudget } from '../../../src/main/ai/contextBudget';
import { Config } from '../../../src/shared/types';

const config = {
  modelProfiles: {
    primary: { model: 'gpt-4o', maxResponseTokens: 4096, contextSizeTokens: 50 },
    secondary: { model: 'gpt-4o', maxResponseTokens: 2048, contextSizeTokens: 50 },
  },
} as Config;

describe('context budget', () => {
  it('trims oldest history while preserving recent messages', () => {
    const history = [
      { role: 'user' as const, content: 'old '.repeat(200) },
      { role: 'assistant' as const, content: 'older '.repeat(200) },
      { role: 'user' as const, content: 'recent' },
    ];
    const trimmed = trimOpenAIHistoryToBudget(config, 'system', history, 'latest');
    expect(trimmed.length).toBeLessThan(history.length);
    expect(trimmed.at(-1)?.content).toBe('recent');
  });
});
