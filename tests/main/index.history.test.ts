import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/shared/types';
import { buildConversationHistory } from '../../src/main/ai/conversationHistory';

describe('buildConversationHistory', () => {
  it('preserves Gemini provider function-call metadata when replaying saved history', () => {
    const geminiFunctionCall = {
      id: 'gemini-call-1',
      name: 'read_file',
      args: { filename: 'Desktop/a.txt' },
      thoughtSignature: 'thought-signature',
    };
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        functionCalls: [
          {
            name: 'read_file',
            arguments: { filename: 'Desktop/a.txt' },
            providerMetadata: { geminiFunctionCall },
          },
        ],
        functionResults: [{ name: 'read_file', result: { content: 'ok' }, success: true }],
      },
    ];

    const history = buildConversationHistory(messages);

    expect(history[0].role).toBe('model');
    expect(history[0].parts[0].functionCall).toEqual(geminiFunctionCall);
  });
});
