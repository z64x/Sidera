import { describe, expect, it } from 'vitest';
import type { Conversation, Message } from '../../src/shared/types';
import { deleteConversationMessages, prepareRegeneration } from '../../src/main/chatLifecycle';

const message = (id: string, role: Message['role'], overrides: Partial<Message> = {}): Message => ({
  id,
  role,
  content: id,
  timestamp: Number(id.replace(/\D/g, '')) || 1,
  ...overrides,
});

const conversation = (messages: Message[], overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  name: 'Chat',
  messages,
  createdAt: 1,
  updatedAt: 1,
  kind: 'single-profile',
  profileId: 'profile-a',
  defaultProfileId: 'profile-a',
  source: 'app',
  ...overrides,
});

describe('chat message lifecycle', () => {
  it('deletes a user message with its immediate assistant response', () => {
    const conv = conversation([
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
    ]);

    const result = deleteConversationMessages(conv, ['u1']);

    expect(result.changed).toBe(true);
    expect(conv.messages.map((item) => item.id)).toEqual(['u2']);
  });

  it('deletes an assistant message without deleting the previous user message', () => {
    const conv = conversation([
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
    ]);

    deleteConversationMessages(conv, ['a1']);

    expect(conv.messages.map((item) => item.id)).toEqual(['u1', 'u2']);
  });

  it('prepares regeneration from an assistant by keeping the previous user and cutting later messages', () => {
    const conv = conversation([
      message('u1', 'user', { profileId: 'profile-a' }),
      message('a1', 'assistant', { modelName: 'model-old', profileId: 'profile-b' }),
      message('u2', 'user'),
    ]);

    const target = prepareRegeneration(conv, 'a1');

    expect(target?.userMessage.id).toBe('u1');
    expect(target?.userMessageIndex).toBe(0);
    expect(target?.assistantProfileId).toBe('profile-b');
    expect(target?.modelName).toBe('model-old');
    expect(conv.messages.map((item) => item.id)).toEqual(['u1']);
  });

  it('prepares regeneration from a user by cutting the old assistant and later messages', () => {
    const conv = conversation([
      message('u1', 'user', { profileId: 'profile-a' }),
      message('a1', 'assistant', { profileId: 'profile-b' }),
      message('u2', 'user'),
    ]);

    const target = prepareRegeneration(conv, 'u1');

    expect(target?.userMessage.id).toBe('u1');
    expect(target?.assistantProfileId).toBe('profile-b');
    expect(conv.messages.map((item) => item.id)).toEqual(['u1']);
  });

  it('does not force an assistant profile for Sidera conversations', () => {
    const conv = conversation(
      [
        message('u1', 'user', { profileId: 'profile-a' }),
        message('a1', 'assistant', { profileId: 'profile-b' }),
      ],
      { kind: 'sidera', profileId: undefined, defaultProfileId: undefined },
    );

    const target = prepareRegeneration(conv, 'a1');

    expect(target?.assistantProfileId).toBeUndefined();
  });
});
