import { describe, expect, it } from 'vitest';
import { Conversation } from '../../src/shared/types';
import { getConversationProfileIds, isConversationInScope, isSideraConversation } from '../../src/shared/conversationScope';
import { SIDERA_AGENT_ID } from '../../src/shared/sidera';

function conversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: overrides.id || 'conversation-1',
    name: overrides.name || 'Test conversation',
    messages: overrides.messages || [],
    createdAt: overrides.createdAt || 1,
    updatedAt: overrides.updatedAt || 1,
    ...overrides,
  };
}

describe('conversation scope routing', () => {
  it('keeps Sidera history limited to Sidera conversations and legacy Auto shapes', () => {
    const sideraConversation = conversation({
      kind: 'sidera',
    });
    const legacyAutoConversation = conversation({
      kind: 'auto',
      defaultProfileId: 'david',
      messages: [{ id: 'm1', role: 'user', content: 'Hi', timestamp: 1, profileId: 'david' }],
    });
    const legacyMultiProfileConversation = conversation({
      kind: 'multi-profile',
      defaultProfileId: 'david',
      messages: [
        { id: 'm1', role: 'user', content: 'Hi', timestamp: 1, profileId: 'david' },
        { id: 'm2', role: 'assistant', content: 'Hello', timestamp: 2, profileId: 'ionut' },
      ],
    });
    const davidConversation = conversation({
      kind: 'single-profile',
      profileId: 'david',
      defaultProfileId: 'david',
    });

    expect(isConversationInScope(sideraConversation, SIDERA_AGENT_ID, null)).toBe(true);
    expect(isConversationInScope(legacyAutoConversation, SIDERA_AGENT_ID, null)).toBe(true);
    expect(isConversationInScope(legacyMultiProfileConversation, SIDERA_AGENT_ID, null)).toBe(true);
    expect(isConversationInScope(davidConversation, SIDERA_AGENT_ID, null)).toBe(false);
  });

  it('does not show Sidera conversations in a profile history just because defaultProfileId matches', () => {
    const sideraConversation = conversation({
      kind: 'sidera',
      defaultProfileId: 'david',
    });
    const legacyMultiProfileConversation = conversation({
      kind: 'multi-profile',
      defaultProfileId: 'david',
      messages: [
        { id: 'm1', role: 'user', content: 'Hi', timestamp: 1, profileId: 'david' },
        { id: 'm2', role: 'assistant', content: 'Hello', timestamp: 2, profileId: 'ionut' },
      ],
    });
    const davidConversation = conversation({
      kind: 'single-profile',
      profileId: 'david',
      defaultProfileId: 'david',
    });

    expect(isConversationInScope(davidConversation, 'david', 'david')).toBe(true);
    expect(isConversationInScope(sideraConversation, 'david', 'david')).toBe(false);
    expect(isConversationInScope(legacyMultiProfileConversation, 'david', 'david')).toBe(false);
  });

  it('allows explicitly shared Sidera conversations in profile history when requested', () => {
    const sharedSideraConversation = conversation({
      kind: 'sidera',
      defaultProfileId: 'david',
      sharedWithProfiles: ['david'],
    });

    expect(isConversationInScope(sharedSideraConversation, 'david', 'david', false)).toBe(false);
    expect(isConversationInScope(sharedSideraConversation, 'david', 'david', true)).toBe(true);
  });

  it('returns ordered participating profile ids for legacy Sidera sidebar badges', () => {
    const mixedConversation = conversation({
      kind: 'multi-profile',
      defaultProfileId: 'david',
      profileId: 'legacy-owner',
      messages: [
        { id: 'm1', role: 'user', content: 'A', timestamp: 1, profileId: 'david' },
        { id: 'm2', role: 'assistant', content: 'B', timestamp: 2, profileId: 'ionut' },
        { id: 'm3', role: 'user', content: 'C', timestamp: 3, profileId: 'david' },
      ],
    });

    expect(getConversationProfileIds(mixedConversation)).toEqual(['david', 'ionut', 'legacy-owner']);
  });

  it('recognizes Sidera and legacy Auto shapes as Sidera conversations', () => {
    expect(isSideraConversation(conversation({ kind: 'sidera' }))).toBe(true);
    expect(isSideraConversation(conversation({ kind: 'auto' }))).toBe(true);
    expect(isSideraConversation(conversation({ kind: 'multi-profile' }))).toBe(true);
    expect(isSideraConversation(conversation({ kind: 'single-profile', profileId: 'ionut' }))).toBe(false);
  });
});
