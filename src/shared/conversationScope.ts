import { Conversation, ConversationScope } from './types';
import { SIDERA_AGENT_ID, isSideraScope } from './sidera';

export function isSideraConversation(conversation: Conversation): boolean {
  return conversation.kind === 'sidera' || conversation.kind === 'auto' || conversation.kind === 'multi-profile';
}

/** @deprecated Use isSideraConversation. Kept for legacy callers while old Auto code is removed. */
export function isAutoConversation(conversation: Conversation): boolean {
  return isSideraConversation(conversation);
}

export function isProfileConversation(conversation: Conversation): boolean {
  return conversation.kind === 'legacy' || conversation.kind === 'single-profile';
}

export function getConversationProfileIds(conversation: Conversation): string[] {
  const orderedIds: string[] = [];
  const seen = new Set<string>();

  for (const message of conversation.messages) {
    if (!message.profileId || seen.has(message.profileId)) continue;
    seen.add(message.profileId);
    orderedIds.push(message.profileId);
  }

  const fallbackIds = [conversation.defaultProfileId, conversation.profileId].filter(Boolean) as string[];
  for (const profileId of fallbackIds) {
    if (seen.has(profileId)) continue;
    seen.add(profileId);
    orderedIds.push(profileId);
  }

  return orderedIds;
}

export function isConversationInScope(
  conversation: Conversation,
  scope: ConversationScope,
  effectiveProfileId?: string | null,
  includeShared: boolean = false
): boolean {
  if (isSideraScope(scope)) {
    return isSideraConversation(conversation);
  }

  if (!effectiveProfileId) {
    return conversation.kind === 'legacy' && !conversation.profileId;
  }

  if (includeShared && conversation.sharedWithProfiles?.includes(effectiveProfileId)) {
    return true;
  }

  if (!isProfileConversation(conversation)) {
    return false;
  }

  if (conversation.kind === 'legacy') {
    return !conversation.profileId && !conversation.defaultProfileId;
  }

  return conversation.profileId === effectiveProfileId;
}

export { SIDERA_AGENT_ID };
