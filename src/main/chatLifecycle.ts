import type { Conversation, Message } from '../shared/types';
import { isSideraConversation } from '../shared/conversationScope';

export type DeleteMessagesResult = {
  changed: boolean;
};

export type RegenerationTarget = {
  assistantProfileId?: string;
  modelName?: string;
  userMessage: Message;
  userMessageIndex: number;
};

export function getMessageProfileId(message: Message, conversation: Conversation): string | undefined {
  return message.profileId || conversation.defaultProfileId || conversation.profileId || undefined;
}

export function deleteConversationMessages(conversation: Conversation, messageIds: string[]): DeleteMessagesResult {
  const ids = new Set(messageIds);
  if (ids.size === 0) return { changed: false };

  const removeIndexes = new Set<number>();
  conversation.messages.forEach((message, index) => {
    if (!ids.has(message.id)) return;

    removeIndexes.add(index);
    if (message.role === 'user' && conversation.messages[index + 1]?.role === 'assistant') {
      removeIndexes.add(index + 1);
    }
  });

  if (removeIndexes.size === 0) return { changed: false };

  conversation.messages = conversation.messages.filter((_message, index) => !removeIndexes.has(index));
  return { changed: true };
}

export function prepareRegeneration(conversation: Conversation, messageId: string): RegenerationTarget | null {
  const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
  if (messageIndex === -1) return null;

  const message = conversation.messages[messageIndex];
  let userMessageIndex = messageIndex;
  let previousAssistant: Message | undefined;

  if (message.role === 'assistant') {
    previousAssistant = message;
    userMessageIndex = findPreviousUserMessageIndex(conversation.messages, messageIndex);
    if (userMessageIndex === -1) return null;
  } else {
    previousAssistant = conversation.messages[messageIndex + 1]?.role === 'assistant'
      ? conversation.messages[messageIndex + 1]
      : undefined;
  }

  const userMessage = conversation.messages[userMessageIndex];
  if (!userMessage || userMessage.role !== 'user') return null;

  const assistantProfileId = previousAssistant
    ? getMessageProfileId(previousAssistant, conversation)
    : getMessageProfileId(userMessage, conversation);

  conversation.messages.splice(userMessageIndex + 1);

  return {
    assistantProfileId: isSideraConversation(conversation) ? undefined : assistantProfileId,
    modelName: previousAssistant?.modelName,
    userMessage,
    userMessageIndex,
  };
}

function findPreviousUserMessageIndex(messages: Message[], fromIndex: number): number {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index;
  }
  return -1;
}
