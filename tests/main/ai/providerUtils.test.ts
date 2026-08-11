import { describe, expect, it } from 'vitest';
import { getDefaultModelForProvider, isModelForProvider, resolveProviderModel } from '../../../src/main/ai/providerUtils';

describe('provider model resolution', () => {
  it('uses the current DeepSeek model ids and rejects retired ids', () => {
    expect(getDefaultModelForProvider('deepseek')).toBe('deepseek-v4-flash');
    expect(isModelForProvider('deepseek', 'deepseek-v4-flash')).toBe(true);
    expect(isModelForProvider('deepseek', 'deepseek-v4-pro')).toBe(true);
    expect(isModelForProvider('deepseek', 'deepseek-chat')).toBe(false);
    expect(isModelForProvider('deepseek', 'deepseek-reasoner')).toBe(false);
    expect(resolveProviderModel('deepseek', 'deepseek-chat')).toBe('deepseek-v4-flash');
  });
});
