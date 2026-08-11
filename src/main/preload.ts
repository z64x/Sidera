import { contextBridge, ipcRenderer } from 'electron';
import { AIProvider, Config, Message, Conversation, FileAttachment, ModelInfo, Profile, KnowledgeFile, ConversationScope, ConsoleLogEntry } from '../shared/types';

type AIRequestOptions = {
  connectionMode?: 'direct' | 'proxy';
  proxyBaseUrl?: string;
};

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function onIpc<T extends unknown[]>(channel: string, callback: (...args: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: T) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function serializeConsoleArg(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeConsoleArg(entry, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = serializeConsoleArg(entry, seen);
    }
    seen.delete(value);
    return output;
  }

  return value;
}

(['log', 'info', 'warn', 'error'] as const).forEach((level) => {
  console[level] = (...args: unknown[]) => {
    try {
      ipcRenderer.send('renderer-console-log', level, args.map((arg) => serializeConsoleArg(arg)));
    } catch {
      // Preserve normal console behavior even if IPC is unavailable.
    }
    originalConsole[level](...args);
  };
});

contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: (): Promise<Config> => ipcRenderer.invoke('get-config'),
  setConfig: (updates: Partial<Config>): Promise<void> => ipcRenderer.invoke('set-config', updates),

  // STT (OpenAI Whisper)
  transcribeAudio: (
    audio: ArrayBuffer | Uint8Array,
    mimeType?: string
  ): Promise<{ success: boolean; message: string; data?: { transcript: string } }> => ipcRenderer.invoke('transcribe-audio', audio, mimeType),

  // AI
  sendMessage: (
    message: string,
    attachments?: FileAttachment[],
    options?: { conversationScope?: ConversationScope; forceNewConversation?: boolean; targetProfileId?: string | null }
  ): Promise<void> => ipcRenderer.invoke('send-message', message, attachments, options),
  onAIResponse: (callback: (chunk: string) => void) => {
    return onIpc<[string]>('ai-response-chunk', callback);
  },
  onAIResponseComplete: (callback: () => void) => {
    return onIpc<[]>('ai-response-complete', callback);
  },
  onAIToolCall: (callback: (tool: any) => void) => {
    return onIpc<[any]>('ai-tool-call', callback);
  },
  onAIToolResult: (callback: (result: any) => void) => {
    return onIpc<[any]>('ai-tool-result', callback);
  },
  onAIToolConfirmationRequest: (callback: (request: any) => void) => {
    return onIpc<[any]>('ai-tool-confirmation-request', callback);
  },
  resolveToolConfirmation: (id: string, approved: boolean): Promise<boolean> =>
    ipcRenderer.invoke('resolve-tool-confirmation', id, approved),
  stopGeneration: (): Promise<void> => ipcRenderer.invoke('stop-generation'),

  // Models / Key validation
  validateAPIKey: (provider: AIProvider, key: string, options?: AIRequestOptions): Promise<boolean> =>
    ipcRenderer.invoke('validate-api-key', provider, key, options),
  getAvailableModels: (provider: AIProvider, key: string, options?: AIRequestOptions): Promise<ModelInfo[]> =>
    ipcRenderer.invoke('get-available-models', provider, key, options),

  // Conversations
  getConversations: (profileId?: string, includeShared?: boolean): Promise<Conversation[]> =>
    ipcRenderer.invoke('get-conversations', profileId, includeShared),
  getConversation: (id: string): Promise<Conversation | null> => ipcRenderer.invoke('get-conversation', id),
  getArchivedConversations: (): Promise<Conversation[]> => ipcRenderer.invoke('get-archived-conversations'),
  createConversation: (profileId?: string): Promise<Conversation> => ipcRenderer.invoke('create-conversation', profileId),
  updateConversation: (id: string, updates: Partial<Conversation>): Promise<void> =>
    ipcRenderer.invoke('update-conversation', id, updates),
  deleteConversation: (id: string): Promise<void> => ipcRenderer.invoke('delete-conversation', id),
  deleteMessages: (conversationId: string, messageIds: string[]): Promise<void> =>
    ipcRenderer.invoke('delete-messages', conversationId, messageIds),
  editMessage: (conversationId: string, messageId: string, newContent: string): Promise<void> =>
    ipcRenderer.invoke('edit-message', conversationId, messageId, newContent),
  regenerateMessage: (conversationId: string, messageId: string): Promise<void> =>
    ipcRenderer.invoke('regenerate-message', conversationId, messageId),
  shareConversationWithProfile: (conversationId: string, profileId: string): Promise<boolean> =>
    ipcRenderer.invoke('share-conversation-with-profile', conversationId, profileId),
  onConversationUpdated: (callback: (conversation: Conversation) => void) => {
    return onIpc<[Conversation]>('conversation-updated', callback);
  },

  // File operations
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  selectFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('select-file', filters),
  cacheAttachment: (filePath: string): Promise<string | null> => ipcRenderer.invoke('cache-attachment', filePath),
  getAttachmentDataUrl: (filePath: string): Promise<string | null> => ipcRenderer.invoke('get-attachment-data-url', filePath),
  getFileDataUrl: (filePath: string): Promise<string | null> => ipcRenderer.invoke('get-file-data-url', filePath),
  setUserAvatarImage: (imagePath: string | null): Promise<string | null> => ipcRenderer.invoke('set-user-avatar-image', imagePath),
  onUserAvatarChanged: (callback: (avatarPath: string | null) => void) => {
    return onIpc<[string | null]>('user-avatar-changed', callback);
  },

  // Remove listeners
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),

  // Set current conversation
  setCurrentConversation: (id: string, scope?: ConversationScope) => ipcRenderer.send('set-current-conversation', id, scope),

  // Profiles
  getAllProfiles: (): Promise<Profile[]> => ipcRenderer.invoke('get-all-profiles'),
  getProfile: (id: string): Promise<Profile | null> => ipcRenderer.invoke('get-profile', id),
  getActiveProfile: (): Promise<Profile | null> => ipcRenderer.invoke('get-active-profile'),
  setActiveProfile: (id: string | null): Promise<void> => ipcRenderer.invoke('set-active-profile', id),
  onActiveProfileChanged: (callback: (profileId: string | null) => void) => {
    return onIpc<[string | null]>('active-profile-changed', callback);
  },
  onProfilesChanged: (callback: () => void) => {
    return onIpc<[]>('profiles-changed', callback);
  },
  createProfile: (profile: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>): Promise<Profile> =>
    ipcRenderer.invoke('create-profile', profile),
  updateProfile: (id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt'>>): Promise<Profile | null> =>
    ipcRenderer.invoke('update-profile', id, updates),
  deleteProfile: (id: string): Promise<boolean> => ipcRenderer.invoke('delete-profile', id),
  addKnowledgeFile: (profileId: string, filePath: string): Promise<KnowledgeFile | null> =>
    ipcRenderer.invoke('add-knowledge-file', profileId, filePath),
  reprocessKnowledgeFile: (profileId: string, fileId: string): Promise<KnowledgeFile | null> =>
    ipcRenderer.invoke('reprocess-knowledge-file', profileId, fileId),
  removeKnowledgeFile: (profileId: string, fileId: string): Promise<boolean> =>
    ipcRenderer.invoke('remove-knowledge-file', profileId, fileId),
  setProfileAvatarEmoji: (profileId: string, emoji: string | null): Promise<Profile | null> =>
    ipcRenderer.invoke('set-profile-avatar-emoji', profileId, emoji),
  setProfileAvatarImage: (profileId: string, imagePath: string | null): Promise<Profile | null> =>
    ipcRenderer.invoke('set-profile-avatar-image', profileId, imagePath),
  getWhatsAppDefaultProfile: (): Promise<Profile | null> => ipcRenderer.invoke('get-whatsapp-default-profile'),
  setWhatsAppDefaultProfile: (id: string | null): Promise<void> => ipcRenderer.invoke('set-whatsapp-default-profile', id),
  onWhatsAppDefaultProfileChanged: (callback: (profileId: string | null) => void) => {
    return onIpc<[string | null]>('whatsapp-default-profile-changed', callback);
  },

  // Ngrok API
  ngrokConfigureToken: (authToken: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('ngrok-configure-token', authToken),
  ngrokStart: (): Promise<{ success: boolean; message: string; publicUrl?: string }> =>
    ipcRenderer.invoke('ngrok-start'),
  ngrokStop: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('ngrok-stop'),
  ngrokGetStatus: (): Promise<{ isRunning: boolean; publicUrl: string | null; webhookUrl: string | null; configured: boolean }> =>
    ipcRenderer.invoke('ngrok-get-status'),
  webhookGetStatus: (): Promise<{ isRunning: boolean; port: number; localUrl: string }> =>
    ipcRenderer.invoke('webhook-get-status'),
  // Removed: ngrokIsInstalled - isInstalled() method no longer exists in SDK implementation
  onNgrokStatusChanged: (callback: (data: { isRunning: boolean; publicUrl: string | null; webhookUrl: string | null }) => void) => {
    return onIpc<[{ isRunning: boolean; publicUrl: string | null; webhookUrl: string | null }]>('ngrok-status-changed', callback);
  },

  // Window controls (custom titlebar)
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    return onIpc<[boolean]>('window-maximized-changed', callback);
  },

  // Console logs
  getConsoleLogs: (): Promise<ConsoleLogEntry[]> => ipcRenderer.invoke('get-console-logs'),
  clearConsoleLogs: (): Promise<void> => ipcRenderer.invoke('clear-console-logs'),
});

declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<Config>;
      setConfig: (updates: Partial<Config>) => Promise<void>;

      transcribeAudio: (
        audio: ArrayBuffer | Uint8Array,
        mimeType?: string
      ) => Promise<{ success: boolean; message: string; data?: { transcript: string } }>;
      sendMessage: (
        message: string,
        attachments?: FileAttachment[],
        options?: { conversationScope?: ConversationScope; forceNewConversation?: boolean; targetProfileId?: string | null }
      ) => Promise<void>;
      onAIResponse: (callback: (chunk: string) => void) => () => void;
      onAIResponseComplete: (callback: () => void) => () => void;
      onAIToolCall: (callback: (tool: any) => void) => () => void;
      onAIToolResult: (callback: (result: any) => void) => () => void;
      onAIToolConfirmationRequest: (callback: (request: any) => void) => () => void;
      resolveToolConfirmation: (id: string, approved: boolean) => Promise<boolean>;
      stopGeneration: () => Promise<void>;

      validateAPIKey: (provider: AIProvider, key: string, options?: AIRequestOptions) => Promise<boolean>;
      getAvailableModels: (provider: AIProvider, key: string, options?: AIRequestOptions) => Promise<ModelInfo[]>;

  getConversations: (profileId?: string, includeShared?: boolean) => Promise<Conversation[]>;
  getConversation: (id: string) => Promise<Conversation | null>;
  getArchivedConversations: () => Promise<Conversation[]>;
  createConversation: (profileId?: string) => Promise<Conversation>;
  updateConversation: (id: string, updates: Partial<Conversation>) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  deleteMessages: (conversationId: string, messageIds: string[]) => Promise<void>;
  editMessage: (conversationId: string, messageId: string, newContent: string) => Promise<void>;
  regenerateMessage: (conversationId: string, messageId: string) => Promise<void>;
  shareConversationWithProfile: (conversationId: string, profileId: string) => Promise<boolean>;
  onConversationUpdated: (callback: (conversation: Conversation) => void) => () => void;

      selectFolder: () => Promise<string | null>;
      selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>;
      removeAllListeners: (channel: string) => void;
      setCurrentConversation: (id: string, scope?: ConversationScope) => void;
      cacheAttachment: (filePath: string) => Promise<string | null>;
      getAttachmentDataUrl: (filePath: string) => Promise<string | null>;
      getFileDataUrl: (filePath: string) => Promise<string | null>;
      setUserAvatarImage: (imagePath: string | null) => Promise<string | null>;
      onUserAvatarChanged: (callback: (avatarPath: string | null) => void) => () => void;

      getAllProfiles: () => Promise<Profile[]>;
      getProfile: (id: string) => Promise<Profile | null>;
      getActiveProfile: () => Promise<Profile | null>;
      setActiveProfile: (id: string | null) => Promise<void>;
      onActiveProfileChanged: (callback: (profileId: string | null) => void) => () => void;
      onProfilesChanged: (callback: () => void) => () => void;
      createProfile: (profile: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Profile>;
      updateProfile: (id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt'>>) => Promise<Profile | null>;
      deleteProfile: (id: string) => Promise<boolean>;
  addKnowledgeFile: (profileId: string, filePath: string) => Promise<KnowledgeFile | null>;
      reprocessKnowledgeFile: (profileId: string, fileId: string) => Promise<KnowledgeFile | null>;
      removeKnowledgeFile: (profileId: string, fileId: string) => Promise<boolean>;
      setProfileAvatarEmoji: (profileId: string, emoji: string | null) => Promise<Profile | null>;
      setProfileAvatarImage: (profileId: string, imagePath: string | null) => Promise<Profile | null>;
      getWhatsAppDefaultProfile: () => Promise<Profile | null>;
      setWhatsAppDefaultProfile: (id: string | null) => Promise<void>;
      onWhatsAppDefaultProfileChanged: (callback: (profileId: string | null) => void) => () => void;

      // Ngrok API
      ngrokConfigureToken: (authToken: string) => Promise<{ success: boolean; message: string }>;
      ngrokStart: () => Promise<{ success: boolean; message: string; publicUrl?: string }>;
      ngrokStop: () => Promise<{ success: boolean; message: string }>;
      ngrokGetStatus: () => Promise<{ isRunning: boolean; publicUrl: string | null; webhookUrl: string | null; configured: boolean }>;
      webhookGetStatus: () => Promise<{ isRunning: boolean; port: number; localUrl: string }>;
      // Removed: ngrokIsInstalled - isInstalled() method no longer exists in SDK implementation
      onNgrokStatusChanged: (callback: (data: { isRunning: boolean; publicUrl: string | null; webhookUrl: string | null }) => void) => () => void;

      windowMinimize: () => void;
      windowToggleMaximize: () => void;
      windowClose: () => void;
      windowIsMaximized: () => Promise<boolean>;
      onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void;

      getConsoleLogs: () => Promise<ConsoleLogEntry[]>;
      clearConsoleLogs: () => Promise<void>;
    };
  }
}
