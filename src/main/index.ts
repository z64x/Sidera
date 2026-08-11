import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as https from 'https';
import * as http from 'http';
import express from 'express';
import { getConfig, setConfig, getConfigValue, validatePaths } from './config/storage';
import { backupConversations } from './config/backup';
import {
  getAllProfiles,
  getProfile,
  getActiveProfile,
  setActiveProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  normalizeProfile,
  copyKnowledgeFile,
  deleteKnowledgeFile,
  getWhatsAppDefaultProfile,
  setWhatsAppDefaultProfile,
  ensureWhatsAppDefaultProfile,
  copyProfileAvatarImage,
} from './config/profiles';
import { processKnowledgeFile } from './lancedb/knowledge';
import { deleteKnowledgeChunks } from './lancedb/client';
import { executeFunctionWithPolicy, resolveEffectiveToolIds } from './ai/functionCalling';
import { initializeGemini, validateGeminiKey, getGeminiModels, sendGeminiMessage, stopGeminiGeneration } from './ai/gemini';
import { initializeOpenAI, validateOpenAIKey, getOpenAIModels, sendOpenAIMessage, stopOpenAIGeneration } from './ai/openai';
import { validateClaudeKey, getClaudeModels, sendClaudeMessage, stopClaudeGeneration } from './ai/claude';
import { buildConversationHistory } from './ai/conversationHistory';
import { getDefaultModelForProvider, getEffectiveModelForProvider, isModelForProvider, withEffectiveProviderModel } from './ai/providerUtils';
import {
  deleteConversationMessages,
  getMessageProfileId,
  prepareRegeneration,
  type RegenerationTarget,
} from './chatLifecycle';
import {
  transcribeAudioWithOpenAI,
  ConnectivityOperationResult,
} from './functions/connectivity';
import { Config, Conversation, Message, FileAttachment, ModelInfo, Profile, KnowledgeFile, ConversationScope, ConsoleLogEntry, ToolConfirmationRequest } from '../shared/types';
import Store from 'electron-store';
import { WhatsAppManager } from './whatsapp/manager';
import { isSupportedImageMimeType } from './whatsapp/media';
import { WhatsAppConfig, WhatsAppMessage } from './whatsapp/types';
import { isWhatsAppNumberAuthorized, normalizeWhatsAppNumber } from './whatsapp/authorization';
import { NgrokManager } from './ngrok/manager';
import { clearConsoleLogs, getConsoleLogs, initializeConsoleLogging, logError, logInfo, persistConsoleLog } from './logging';
import { isConversationInScope, isSideraConversation } from '../shared/conversationScope';
import { SIDERA_AGENT_ID, isSideraScope } from '../shared/sidera';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

initializeConsoleLogging();

let mainWindow: BrowserWindow | null = null;
let expressApp: express.Application | null = null;
let expressServer: any = null;
let whatsappManager: WhatsAppManager | null = null;
let ngrokManager: NgrokManager | null = null;

type PendingLocalConfirmation = {
  request: ToolConfirmationRequest;
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
};

type PendingWhatsAppConfirmation = {
  request: ToolConfirmationRequest;
  token: string;
  from: string;
  profileId?: string;
  conversation: Conversation;
  createdAt: number;
};

type WhatsAppAgentRoute = {
  id?: string;
  name: string;
  isSidera: boolean;
};

function getWhatsAppContactName(message: { profileName?: string }): string | undefined {
  return message.profileName?.trim() || undefined;
}

const WHATSAPP_IMAGE_PROMPT = 'Analizeaza imaginea trimisa.';

function supportsWhatsAppImageInput(config: Config): boolean {
  return config.aiProvider === 'openai' || config.aiProvider === 'gemini';
}

function isLegacyWhatsAppConversationName(name: string): boolean {
  return /^WhatsApp\s*-\s*.+?\s*-\s*.+$/i.test(name);
}

const pendingLocalConfirmations = new Map<string, PendingLocalConfirmation>();
const pendingWhatsAppConfirmations = new Map<string, PendingWhatsAppConfirmation>();

function getAppIconPath() {
  return isDev
    ? path.join(process.cwd(), 'public', 'icon.png')
    : path.join(__dirname, '../renderer/icon.png');
}

function requestLocalToolConfirmation(request: ToolConfirmationRequest): Promise<boolean> {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve(false);
      return;
    }

    const timeout = setTimeout(() => {
      pendingLocalConfirmations.delete(request.id);
      resolve(false);
    }, Math.max(1000, request.expiresAt - Date.now()));

    pendingLocalConfirmations.set(request.id, { request, resolve, timeout });
    mainWindow.webContents.send('ai-tool-confirmation-request', request);
  });
}

function resolveLocalToolConfirmation(id: string, approved: boolean): boolean {
  const pending = pendingLocalConfirmations.get(id);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingLocalConfirmations.delete(id);
  pending.resolve(approved);
  return true;
}

function makeWhatsAppConfirmationToken(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getSafeRealPath(p: string): string | null {
  try {
    // best-effort normalization; fs.realpathSync throws if missing
    return fsSync.realpathSync(p);
  } catch {
    try {
      return path.resolve(p);
    } catch {
      return null;
    }
  }
}

function isPathUnder(candidatePath: string, allowedRoot: string): boolean {
  const cand = getSafeRealPath(candidatePath);
  const root = getSafeRealPath(allowedRoot);
  if (!cand || !root) return false;

  const rel = path.relative(root, cand);
  // If rel starts with .. or is absolute, it's outside.
  if (!rel || rel === '.') return true;
  return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

function getAllowedFileRootsForRenderer(): string[] {
  const cfg = getConfig();
  const base = cfg.databasePath || app.getPath('userData');
  return [
    path.join(base, 'attachments'),
    // Profile knowledge files live under databasePath/profiles
    path.join(base, 'profiles'),
    // Profile avatar images are stored under userData/profiles (see src/main/config/profiles.ts)
    path.join(app.getPath('userData'), 'profiles'),
    // User avatar images are stored under userData/user/avatar.
    path.join(app.getPath('userData'), 'user'),
  ];
}

function isAllowedRendererFilePath(params: { filePath: string; allowedExts?: string[] }): boolean {
  const { filePath, allowedExts } = params;
  if (!filePath || typeof filePath !== 'string') return false;

  // Extension allow-list (defense in depth)
  if (allowedExts && allowedExts.length > 0) {
    const ext = path.extname(filePath).toLowerCase();
    if (!allowedExts.includes(ext)) return false;
  }

  const roots = getAllowedFileRootsForRenderer();
  return roots.some((r) => isPathUnder(filePath, r));
}

// Store for conversations
const conversationStore = new Store<{ conversations: Conversation[] }>({
  name: 'conversations',
  defaults: { conversations: [] },
});

function normalizeConversation(conversation: Conversation): Conversation {
  const messageProfileIds = Array.from(
    new Set(conversation.messages.map((message) => message.profileId).filter(Boolean) as string[])
  );
  const hasOwnerProfile = !!conversation.profileId;
  const hasMessageProfiles = messageProfileIds.length > 0;
  const hasMultipleMessageProfiles = messageProfileIds.length > 1;

  let kind = conversation.kind;
  if (!kind) {
    if (hasMultipleMessageProfiles) {
      kind = 'sidera';
    } else if (hasOwnerProfile) {
      kind = 'single-profile';
    } else if (hasMessageProfiles) {
      kind = 'sidera';
    } else {
      kind = 'legacy';
    }
  }

  let profileId = conversation.profileId;
  let defaultProfileId = conversation.defaultProfileId || conversation.profileId;

  if (kind === 'legacy') {
    profileId = undefined;
    defaultProfileId = undefined;
  } else if (kind === 'single-profile') {
    const singleProfileId = profileId || messageProfileIds[0] || defaultProfileId;
    profileId = singleProfileId || undefined;
    defaultProfileId = singleProfileId || undefined;
  } else if (kind === 'auto' || kind === 'multi-profile' || kind === 'sidera') {
    kind = 'sidera';
    profileId = undefined;
    defaultProfileId = undefined;
  }

  return {
    ...conversation,
    kind,
    profileId,
    defaultProfileId,
    source: conversation.source || 'app',
  };
}

function getStoredConversations(): Conversation[] {
  return conversationStore.get('conversations', []).map(normalizeConversation);
}

function saveConversations(conversations: Conversation[]) {
  conversationStore.set('conversations', conversations.map(normalizeConversation));
}

function notifyConversationUpdated(conversation: Conversation) {
  mainWindow?.webContents.send('conversation-updated', normalizeConversation(conversation));
}

function createConversationForScope(scope: ConversationScope, activeProfileId?: string | null): Conversation {
  const isSidera = isSideraScope(scope);
  const effectiveProfileId = isSidera ? undefined : (scope || activeProfileId || undefined);

  return normalizeConversation({
    id: Date.now().toString(),
    name: 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    kind: isSidera ? 'sidera' : (effectiveProfileId ? 'single-profile' : 'legacy'),
    defaultProfileId: isSidera ? undefined : effectiveProfileId,
    profileId: effectiveProfileId,
    source: 'app',
  });
}

function resolveProfileCommand(rawMessage: string): { targetProfileId: string | null; content: string } {
  const trimmed = rawMessage.trim();
  if (!trimmed.startsWith('/')) {
    return { targetProfileId: null, content: rawMessage };
  }

  const firstSpace = trimmed.indexOf(' ');
  const command = (firstSpace === -1 ? trimmed.slice(1) : trimmed.slice(1, firstSpace)).trim().toLowerCase();
  if (!command) {
    return { targetProfileId: null, content: rawMessage };
  }

  const profile = getAllProfiles().find((item) => item.name.trim().toLowerCase() === command);
  if (!profile) {
    return { targetProfileId: null, content: rawMessage };
  }

  const content = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();
  return {
    targetProfileId: profile.id,
    content,
  };
}

function resolveMessageRouting(params: {
  rawMessage: string;
  requestedScope: ConversationScope;
  explicitTargetProfileId?: string | null;
  activeProfileId?: string | null;
}): {
  resolvedMessage: string;
  effectiveScope: ConversationScope;
  targetProfileId: string | null;
} {
  const commandResolution = resolveProfileCommand(params.rawMessage);
  const effectiveScope: ConversationScope = isSideraScope(params.requestedScope)
    ? SIDERA_AGENT_ID
    : (params.requestedScope || params.activeProfileId || null);

  return {
    resolvedMessage: commandResolution.targetProfileId ? commandResolution.content : params.rawMessage,
    effectiveScope,
    targetProfileId:
      commandResolution.targetProfileId ||
      params.explicitTargetProfileId ||
      (isSideraScope(effectiveScope) ? null : effectiveScope),
  };
}

function toTextHistory(history: { role: 'user' | 'model' | 'function'; parts: any[] }[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history.map(h => ({
    role: h.role === 'user' ? 'user' : ('assistant' as const),
    content: Array.isArray(h.parts)
      ? h.parts.map((p: any) => p.text || JSON.stringify(p)).join('\n')
      : String(h.parts),
  }));
}

async function sendConfiguredAIMessage(params: {
  config: Config;
  message: string;
  onChunk: (chunk: string) => void;
  onComplete: (metadata?: { functionCalls?: any[]; functionResults?: any[] }) => void;
  profileId?: string;
  geminiHistory: { role: 'user' | 'model' | 'function'; parts: any[] }[];
  textHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments?: FileAttachment[];
  onToolUpdate?: (type: LiveToolUpdateType, data: any) => void | Promise<void>;
  channel: 'local' | 'whatsapp';
  requestConfirmation: (request: ToolConfirmationRequest) => Promise<boolean>;
  orchestration?: any;
}) {
  const {
    config,
    message,
    onChunk,
    onComplete,
    profileId,
    geminiHistory,
    attachments,
    onToolUpdate,
    channel,
    requestConfirmation,
    orchestration,
  } = params;
  const effectiveConfig = withEffectiveProviderModel(config);
  const runtimeProfileId = orchestration?.enabled ? SIDERA_AGENT_ID : profileId;
  if (effectiveConfig.aiProvider === 'gemini') {
    await sendGeminiMessage(effectiveConfig, message, onChunk, onComplete, geminiHistory, attachments, onToolUpdate, runtimeProfileId, {
      channel,
      requestConfirmation,
      orchestration,
    });
    return;
  }

  const textHistory = params.textHistory || toTextHistory(geminiHistory);
  if (effectiveConfig.aiProvider === 'claude') {
    await sendClaudeMessage(effectiveConfig, message, onChunk, onComplete, runtimeProfileId, textHistory, attachments, onToolUpdate, {
      channel,
      requestConfirmation,
      orchestration,
    });
    return;
  }

  await sendOpenAIMessage(
    effectiveConfig,
    message,
    onChunk,
    onComplete,
    runtimeProfileId,
    textHistory,
    attachments,
    onToolUpdate,
    {
      channel,
      requestConfirmation,
      orchestration,
      provider: effectiveConfig.aiProvider === 'deepseek' ? 'deepseek' : 'openai',
    }
  );
}

async function regenerateFromUserMessage(params: {
  config: Config;
  conversation: Conversation;
  conversations: Conversation[];
  target: RegenerationTarget;
}) {
  const { config, conversation, conversations, target } = params;
  const effectiveSelectedModel = target.modelName || getEffectiveModelForProvider(config);

  const newMessage: Message = {
    id: Date.now().toString(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    profileId: target.assistantProfileId,
    modelName: effectiveSelectedModel,
    parts: [],
  };

  conversation.messages.push(newMessage);
  if (target.assistantProfileId) {
    conversation.defaultProfileId = target.assistantProfileId;
  }
  if (isSideraConversation(conversation)) {
    conversation.kind = 'sidera';
    conversation.profileId = undefined;
    conversation.defaultProfileId = undefined;
    newMessage.profileId = undefined;
  }
  conversation.updatedAt = Date.now();
  saveConversations(conversations);
  notifyConversationUpdated(conversation);

  let saveTimer: NodeJS.Timeout | null = null;
  let savePending = false;
  const scheduleSave = (immediate = false) => {
    conversation.updatedAt = Date.now();
    savePending = true;

    if (immediate) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      saveConversations(conversations);
      savePending = false;
      notifyConversationUpdated(conversation);
      return;
    }

    if (saveTimer) return;

    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!savePending) return;
      saveConversations(conversations);
      savePending = false;
    }, 250);
  };

  const onChunk = (chunk: string) => {
    if (!mainWindow) return;

    newMessage.content += chunk;
    const lastPart =
      newMessage.parts && newMessage.parts.length > 0 ? newMessage.parts[newMessage.parts.length - 1] : null;
    if (lastPart && lastPart.type === 'text') {
      lastPart.content += chunk;
    } else {
      if (!newMessage.parts) newMessage.parts = [];
      newMessage.parts.push({ type: 'text', content: chunk });
    }

    mainWindow.webContents.send('ai-response-chunk', chunk);
    scheduleSave(false);
  };

  const onToolUpdate = (type: LiveToolUpdateType, data: any) => {
    if (mainWindow) {
      return applyLiveToolUpdate(
        newMessage,
        type,
        data,
        (toolPart) => mainWindow?.webContents.send('ai-tool-call', createLiveToolEnvelope(conversation, newMessage, toolPart)),
        (result) => mainWindow?.webContents.send('ai-tool-result', createLiveToolResultEnvelope(conversation, newMessage, result)),
        scheduleSave,
        () => notifyConversationUpdated(conversation)
      );
    }
    return Promise.resolve();
  };

  const requestToolConfirmation = (request: ToolConfirmationRequest) => {
    const routedRequest: ToolConfirmationRequest = {
      ...request,
      conversationId: conversation.id,
      messageId: newMessage.id,
    };
    const confirmationRequest = mainWindow
      ? applyLiveToolConfirmation(
        newMessage,
        routedRequest,
        (toolPart) => mainWindow?.webContents.send('ai-tool-call', createLiveToolEnvelope(conversation, newMessage, toolPart)),
        scheduleSave,
        () => notifyConversationUpdated(conversation)
      )
      : routedRequest;
    return requestLocalToolConfirmation(confirmationRequest);
  };

  const onComplete = (metadata?: { functionCalls?: any[]; functionResults?: any[] }) => {
    if (metadata?.functionCalls) {
      console.log('Received function calls in onComplete:', metadata.functionCalls);
      newMessage.functionCalls = metadata.functionCalls;
    }
    if (metadata?.functionResults) {
      newMessage.functionResults = metadata.functionResults;
    }

    mainWindow?.webContents.send('ai-response-complete');
    scheduleSave(true);
  };

  try {
    const effectiveConfig = withEffectiveProviderModel(config, effectiveSelectedModel);

    await sendConfiguredAIMessage({
      config: effectiveConfig,
      message: target.userMessage.content,
      onChunk,
      onComplete,
      profileId: isSideraConversation(conversation) ? undefined : target.assistantProfileId,
      geminiHistory: buildConversationHistory(conversation.messages.slice(0, target.userMessageIndex)),
      attachments: target.userMessage.attachments,
      onToolUpdate,
      channel: 'local',
      requestConfirmation: requestToolConfirmation,
      orchestration: undefined,
    });
  } catch (error: any) {
    console.error('Error regenerating AI response:', error);
    newMessage.content = `Error: ${error.message}`;
    saveConversations(conversations);
    notifyConversationUpdated(conversation);
    mainWindow?.webContents.send('ai-response-complete');
  }
}

function resolveActiveConversation(params: {
  conversations: Conversation[];
  currentConversationId: string | null;
  effectiveScope: ConversationScope;
  effectiveProfileId: string | null;
  activeProfileId?: string | null;
  forceNewConversation?: boolean;
}): { conversations: Conversation[]; conversation: Conversation | null; conversationId: string | null } {
  const { conversations, currentConversationId, effectiveScope, effectiveProfileId, activeProfileId, forceNewConversation } = params;
  const currentConversation = currentConversationId
    ? conversations.find((conversation) => conversation.id === currentConversationId) || null
    : null;

  if (isSideraScope(effectiveScope)) {
    if (forceNewConversation) {
      const newConversation = createConversationForScope(SIDERA_AGENT_ID, activeProfileId || null);
      return {
        conversations: [newConversation, ...conversations],
        conversation: newConversation,
        conversationId: newConversation.id,
      };
    }

    if (currentConversation && isSideraConversation(currentConversation)) {
      return { conversations, conversation: currentConversation, conversationId: currentConversation.id };
    }

    const routedConversation = conversations.find((conversation) => isSideraConversation(conversation)) || null;
    if (routedConversation) {
      return { conversations, conversation: routedConversation, conversationId: routedConversation.id };
    }

    const newConversation = createConversationForScope(SIDERA_AGENT_ID, activeProfileId || null);
    return {
      conversations: [newConversation, ...conversations],
      conversation: newConversation,
      conversationId: newConversation.id,
    };
  }

  if (forceNewConversation) {
    const newConversation = createConversationForScope(effectiveScope, activeProfileId || null);
    return {
      conversations: [newConversation, ...conversations],
      conversation: newConversation,
      conversationId: newConversation.id,
    };
  }

  const currentMatchesScope = currentConversation
    ? isConversationInScope(currentConversation, effectiveScope, effectiveProfileId, false)
    : false;
  if (currentConversation && currentMatchesScope) {
    return { conversations, conversation: currentConversation, conversationId: currentConversation.id };
  }

  const scopedConversation = conversations.find((conversation) =>
    isConversationInScope(conversation, effectiveScope, effectiveProfileId, false)
  ) || null;
  if (scopedConversation) {
    return { conversations, conversation: scopedConversation, conversationId: scopedConversation.id };
  }

  const newConversation = createConversationForScope(effectiveScope, activeProfileId || null);
  return {
    conversations: [newConversation, ...conversations],
    conversation: newConversation,
    conversationId: newConversation.id,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,

    // Remove the native Windows titlebar so we can render a custom one in the renderer.
    // NOTE: This also removes the default window controls (min/max/close).
    frame: false,

    backgroundColor: '#0f0f0f',
    autoHideMenuBar: true,
    icon: getAppIconPath(),

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Notify renderer when maximized state changes (for custom maximize/restore icon).
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized-changed', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximized-changed', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize WhatsApp Manager
function initializeWhatsApp() {
  const config = getConfig();
  const whatsappConfig = (config as any).whatsapp as WhatsAppConfig;
  
  if (whatsappConfig) {
    whatsappManager = new WhatsAppManager(whatsappConfig);
    console.log('[WhatsApp] Manager initialized with method:', whatsappConfig.activeMethod);
  }
}

// Initialize Ngrok Manager
function initializeNgrok() {
  const config = getConfig();
  const ngrokConfig = config.ngrok || { enabled: false, port: 3000, useSdk: true };
  
  // Feature flag: Use SDK or CLI implementation
  const useSdk = ngrokConfig.useSdk !== false; // Default to true (SDK)
  
  // Filter out useSdk before passing to NgrokManager (it's not part of NgrokConfig interface)
  const { useSdk: _, ...managerConfig } = ngrokConfig;
  
  // Ensure managerConfig has all required NgrokConfig fields
  const validManagerConfig = {
    ...managerConfig,
    enabled: managerConfig.enabled ?? false,
    port: managerConfig.port ?? 3000
  };
  
  ngrokManager = new NgrokManager(validManagerConfig);
  console.log('[Ngrok] Manager initialized');
  console.log('[Ngrok] Implementation mode:', useSdk ? 'SDK' : 'CLI');
  console.log('[Ngrok] Feature flag (useSdk):', ngrokConfig.useSdk);
  console.log('[Ngrok] Environment override (NGROK_USE_SDK):', process.env.NGROK_USE_SDK);
  
  // Auto-start if enabled and configured
  if (ngrokConfig.enabled && ngrokConfig.authToken) {
    setTimeout(async () => {
      try {
        const result = await ngrokManager?.start();
        if (result?.success) {
          console.log('[Ngrok] Auto-started:', result.publicUrl);
          // Notify renderer about the new URL
          mainWindow?.webContents.send('ngrok-status-changed', {
            isRunning: true,
            publicUrl: result.publicUrl,
            webhookUrl: `${result.publicUrl}/webhook`
          });
        } else {
          console.error('[Ngrok] Auto-start failed:', result?.message);
          // If SDK fails and we're using SDK mode, log the fallback suggestion
          if (useSdk) {
            console.log('[Ngrok] Tip: Set NGROK_USE_SDK=false or config.ngrok.useSdk=false to use CLI fallback');
          }
        }
      } catch (error) {
        console.error('[Ngrok] Auto-start error:', error);
        // If SDK fails and we're using SDK mode, log the fallback suggestion
        if (useSdk) {
          console.log('[Ngrok] Tip: Set NGROK_USE_SDK=false or config.ngrok.useSdk=false to use CLI fallback');
        }
      }
    }, 2000); // Wait for Express server to start
  }
}

// Setup WhatsApp webhook routes
function setupWhatsAppWebhook() {
  if (!expressApp) return;

  // Webhook verification (GET) - for Business Cloud API
  expressApp.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && challenge) {
      const result = whatsappManager?.verifyWebhook(
        mode as string,
        token as string,
        challenge as string
      );
      
      if (result) {
        res.status(200).send(result);
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
  });

  // Webhook message handler (POST)
  expressApp.post('/webhook', async (req, res) => {
    try {
      const webhookStartMs = Date.now();
      logInfo('WhatsAppWebhook', 'received', {
        hasBody: !!req.body,
        topLevelKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 10) : [],
      });

      // Acknowledge receipt immediately
      res.sendStatus(200);

      if (!whatsappManager) {
        logError('WhatsAppWebhook', 'manager_not_initialized');
        return;
      }

      // Parse the incoming message
      const message = whatsappManager.parseWebhookMessage(req.body);
      
      if (!message) {
        logInfo('WhatsAppWebhook', 'ignored_event', {
          reason: 'no_valid_message_found',
          durationMs: Date.now() - webhookStartMs,
        });
        return;
      }

      logInfo('WhatsAppWebhook', 'message_parsed', {
        from: message.from,
        messageId: message.messageId,
        bodyLength: message.body?.length || 0,
        mediaCount: message.media?.length || 0,
      });

      const config = getConfig();
      const whatsappConfig = config.whatsapp as WhatsAppConfig | undefined;
      if (!isWhatsAppNumberAuthorized(message.from, whatsappConfig)) {
        logError('WhatsAppWebhook', 'unauthorized_sender', {
          from: message.from,
          messageId: message.messageId,
        });

        if (whatsappConfig?.replyToUnauthorized) {
          await whatsappManager.sendMessage(
            message.from,
            'Acest numar nu este autorizat sa controleze asistentul.'
          );
        }
        return;
      }

      // Mark as read (Business Cloud only)
      await whatsappManager.markAsRead(message.messageId);

      const supportedMedia = (message.media || []).filter((media) =>
        media.type === 'image' && isSupportedImageMimeType(media.mimeType)
      );
      const unsupportedMediaCount = (message.media?.length || 0) - supportedMedia.length;
      let attachments: FileAttachment[] | undefined;

      if (supportedMedia.length > 0) {
        if (!supportsWhatsAppImageInput(config)) {
          await whatsappManager.sendMessage(
            message.from,
            'Providerul AI curent nu poate analiza imagini prin WhatsApp. Alege OpenAI sau Gemini cu un model vision.'
          );
          logInfo('WhatsAppWebhook', 'image_input_not_supported', {
            from: message.from,
            provider: config.aiProvider,
            mediaCount: supportedMedia.length,
          });
          return;
        }

        attachments = [];
        for (const media of supportedMedia) {
          try {
            attachments.push(await whatsappManager.downloadMediaAttachment(media, config.databasePath));
          } catch (error) {
            logError('WhatsAppWebhook', 'media_download_failed', {
              from: message.from,
              messageId: message.messageId,
              mediaId: media.id,
              mediaUrl: media.url,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (attachments.length === 0) {
          await whatsappManager.sendMessage(
            message.from,
            'Nu am putut descarca imaginea trimisa. Te rog incearca din nou.'
          );
          return;
        }
      }

      if (unsupportedMediaCount > 0) {
        logInfo('WhatsAppWebhook', 'unsupported_media_ignored', {
          from: message.from,
          messageId: message.messageId,
          unsupportedMediaCount,
        });

        if (!message.body?.trim() && !attachments?.length) {
          await whatsappManager.sendMessage(
            message.from,
            'Momentan pot analiza doar imagini JPEG, PNG sau WebP prin WhatsApp.'
          );
          return;
        }
      }

      const whatsappDefaultAgent = getWhatsAppDefaultProfile();
      const whatsappFallbackProfile = whatsappDefaultAgent ? null : ensureWhatsAppDefaultProfile();
      const whatsappAgent: WhatsAppAgentRoute =
        whatsappDefaultAgent?.id === SIDERA_AGENT_ID
          ? { id: undefined, name: whatsappDefaultAgent.name, isSidera: true }
          : {
              id: (whatsappDefaultAgent || whatsappFallbackProfile)?.id,
              name: (whatsappDefaultAgent || whatsappFallbackProfile)?.name || 'WhatsApp Assistant',
              isSidera: false,
            };
      
      logInfo('WhatsAppWebhook', 'profile_selected', {
        profileId: whatsappAgent.isSidera ? SIDERA_AGENT_ID : whatsappAgent.id,
        profileName: whatsappAgent.name,
      });

      const confirmationMatch = /^confirm\s+([a-z0-9]+)$/i.exec((message.body || '').trim());
      if (confirmationMatch) {
        const token = confirmationMatch[1].toUpperCase();
        const pending = pendingWhatsAppConfirmations.get(token);
        if (!pending || pending.from !== message.from || pending.request.expiresAt < Date.now()) {
          pendingWhatsAppConfirmations.delete(token);
          await whatsappManager.sendMessage(message.from, 'Confirmarea nu este valida sau a expirat.');
          return;
        }

        pendingWhatsAppConfirmations.delete(token);
        const toolResult = await executeFunctionWithPolicy(
          { name: pending.request.toolName, arguments: pending.request.args },
          {
            profileId: pending.profileId,
            allowedToolIds: resolveEffectiveToolIds(getConfig(), pending.profileId),
            channel: 'whatsapp',
            approved: true,
          }
        );

        await whatsappManager.sendMessage(message.from, toolResult.success
          ? `Confirmat. ${pending.request.toolName} a fost executat cu succes.`
          : `Confirmat, dar ${pending.request.toolName} a esuat: ${toolResult.error || 'eroare necunoscuta'}`
        );

        const conversations = conversationStore.get('conversations', []);
        const index = conversations.findIndex(c => c.id === pending.conversation.id);
        if (index !== -1) {
          const assistantMessage: Message = {
            id: `${Date.now()}-tool-confirmation`,
            role: 'assistant',
            content: toolResult.success
              ? `Tool confirmed and executed: ${pending.request.toolName}`
              : `Tool confirmation failed: ${toolResult.error || 'Unknown error'}`,
            timestamp: Date.now(),
            profileId: pending.profileId,
            functionCalls: [{ name: pending.request.toolName, arguments: pending.request.args }],
            functionResults: [toolResult],
            parts: [{
              type: 'tool',
              id: pending.request.id,
              name: pending.request.toolName,
              args: pending.request.args,
              status: toolResult.success ? 'success' : 'error',
              result: toolResult.result,
            }],
          };
          pending.conversation.messages.push(assistantMessage);
          pending.conversation.updatedAt = Date.now();
          conversations[index] = pending.conversation;
          conversationStore.set('conversations', conversations);
          notifyConversationUpdated(pending.conversation);
        }
        logInfo('WhatsAppWebhook', 'confirmed_tool_executed', {
          from: message.from,
          toolName: pending.request.toolName,
          success: toolResult.success,
        });
        return;
      }

      // Create or get the dedicated WhatsApp conversation for this agent and sender.
      const conversations = conversationStore.get('conversations', []);
      const whatsappNumber = normalizeWhatsAppNumber(message.from);
      const whatsappContactName = getWhatsAppContactName(message);
      let conversation = conversations.find(
        c => c.source === 'whatsapp' &&
             !c.archivedAt &&
             (whatsappAgent.isSidera ? isSideraConversation(c) : c.profileId === whatsappAgent.id) &&
             c.whatsappNumber === whatsappNumber
      );

      if (!conversation) {
        conversation = normalizeConversation({
          id: Date.now().toString(),
          name: whatsappAgent.name,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          kind: whatsappAgent.isSidera ? 'sidera' : 'single-profile',
          defaultProfileId: whatsappAgent.isSidera ? undefined : whatsappAgent.id,
          profileId: whatsappAgent.isSidera ? undefined : whatsappAgent.id,
          source: 'whatsapp',
          whatsappNumber,
          whatsappContactName,
        });
        conversations.push(conversation);
      } else if (whatsappContactName && conversation.whatsappContactName !== whatsappContactName) {
        conversation.whatsappContactName = whatsappContactName;
      }
      if (isLegacyWhatsAppConversationName(conversation.name)) {
        conversation.name = whatsappAgent.name;
      }

      // Add user message to conversation
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: message.body?.trim() || (attachments?.length ? WHATSAPP_IMAGE_PROMPT : ''),
        timestamp: message.timestamp,
        profileId: whatsappAgent.id,
        attachments,
      };
      conversation.messages.push(userMessage);
      conversation.updatedAt = Date.now();

      // Save conversation
      conversationStore.set('conversations', conversations);
      notifyConversationUpdated(conversation);

      // Process with AI
      await processWhatsAppMessage(message, conversation, whatsappAgent);
      logInfo('WhatsAppWebhook', 'processed', {
        from: message.from,
        messageId: message.messageId,
        durationMs: Date.now() - webhookStartMs,
      });

    } catch (error) {
      logError('WhatsAppWebhook', 'processing_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

// Process WhatsApp message with AI
async function processWhatsAppMessage(
  whatsappMessage: WhatsAppMessage,
  conversation: Conversation,
  agent: WhatsAppAgentRoute
) {
  try {
    const processingStartMs = Date.now();
    const config = getConfig();
    // Prepare AI response message
    let aiResponseContent = '';
    const aiMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      profileId: agent.id,
    };

    const onChunk = (chunk: string) => {
      aiResponseContent += chunk;
      aiMessage.content = aiResponseContent;
    };

    const onComplete = async () => {
      // Save AI response to conversation
      conversation.messages.push(aiMessage);
      conversation.updatedAt = Date.now();
      
      const conversations = conversationStore.get('conversations', []);
      const index = conversations.findIndex(c => c.id === conversation.id);
      if (index !== -1) {
        conversations[index] = conversation;
        conversationStore.set('conversations', conversations);
        notifyConversationUpdated(conversation);
      }

      // Send response back via WhatsApp
      if (whatsappManager && aiResponseContent) {
        const result = await whatsappManager.sendMessage(
          whatsappMessage.from,
          aiResponseContent
        );
        
        if (!result.success) {
          logError('WhatsApp', 'response_send_failed', {
            to: whatsappMessage.from,
            error: result.error,
            durationMs: Date.now() - processingStartMs,
          });
        } else {
          logInfo('WhatsApp', 'response_sent', {
            to: whatsappMessage.from,
            responseLength: aiResponseContent.length,
            durationMs: Date.now() - processingStartMs,
          });
        }
      }
    };

    // Convert conversation messages to history format for Gemini
    const geminiHistory = conversation.messages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' as const : 'model' as const,
      parts: msg.content
    }));

    // Convert conversation messages to history format for OpenAI
    const openaiHistory = conversation.messages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content
    }));

    // Get the last user message
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    const messageText = lastMessage.content;
    const attachments = lastMessage.attachments;

    const requestConfirmation = async (request: ToolConfirmationRequest): Promise<boolean> => {
      if (!whatsappManager) return false;

      const token = makeWhatsAppConfirmationToken();
      pendingWhatsAppConfirmations.set(token, {
        request,
        token,
        from: whatsappMessage.from,
        profileId: agent.isSidera ? SIDERA_AGENT_ID : agent.id,
        conversation,
        createdAt: Date.now(),
      });

      await whatsappManager.sendMessage(
        whatsappMessage.from,
        `Confirmare necesara pentru ${request.toolName}: ${request.reason}\nRaspunde cu: confirm ${token}`
      );
      return false;
    };

    await sendConfiguredAIMessage({
      config,
      message: messageText,
      onChunk,
      onComplete,
      profileId: agent.id,
      geminiHistory: geminiHistory.map((item) => ({
        role: item.role,
        parts: typeof item.parts === 'string' ? [{ text: item.parts }] : item.parts,
      })),
      textHistory: openaiHistory,
      attachments,
      onToolUpdate: () => {},
      channel: 'whatsapp',
      requestConfirmation,
      orchestration: agent.isSidera ? { enabled: true, depth: 0, maxCalls: 3 } : undefined,
    });

  } catch (error) {
    logError('WhatsApp', 'ai_processing_failed', {
      to: whatsappMessage.from,
      error: error instanceof Error ? error.message : String(error),
    });
    
    // Send error message
    if (whatsappManager) {
      await whatsappManager.sendMessage(
        whatsappMessage.from,
        'Ne pare rău, a apărut o eroare. Te rog încearcă din nou.'
      );
    }
  }
}

function startWebhookServer() {
  console.log('[Webhook Server] Starting...');
  
  expressApp = express();
  
  // Parse both JSON and URL-encoded data (Twilio uses URL-encoded)
  expressApp.use(express.json({ limit: '1mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // WhatsApp webhook routes
  setupWhatsAppWebhook();

  const port = 3000;
  
  try {
    expressServer = expressApp.listen(port, () => {
      console.log(`[Webhook Server] ✓ Running on port ${port}`);
      console.log(`[Webhook Server] Webhook endpoint: http://localhost:${port}/webhook`);
    });

    expressServer.on('error', (error: any) => {
      console.error('[Webhook Server] Error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`[Webhook Server] Port ${port} is already in use!`);
      }
    });
  } catch (error) {
    console.error('[Webhook Server] Failed to start:', error);
  }
}

ipcMain.handle('webhook-get-status', async () => {
  const port = 3000;
  const isListening = !!expressServer?.listening;

  return {
    isRunning: isListening,
    port,
    localUrl: `http://localhost:${port}/webhook`,
  };
});

app.whenReady().then(async () => {
  createWindow();

  // Ensure database folder exists (LanceDB is embedded; no external server)
  validatePaths();

  // Backup old conversations before making changes
  await backupConversations();

  // Start webhook server
  startWebhookServer();

  // Initialize WhatsApp
  initializeWhatsApp();

  // Initialize Ngrok
  initializeNgrok();

  // Initialize AI based on config
  const config = getConfig();


  const activeKey =
    config.connectionMode === 'proxy'
      ? config.proxyApiKeys?.[config.aiProvider] || ''
      : config.apiKeys?.[config.aiProvider] || '';

  const activeBaseUrl =
    config.connectionMode === 'proxy' ? config.proxyBaseUrls?.[config.aiProvider] : undefined;

  // Provider-native initialization:
  // - Gemini direct: initialize SDK
  // - Gemini proxy: @google/genai client with custom baseUrl inside sendGeminiMessage()
  // - OpenAI direct/proxy: initialize OpenAI client with optional baseURL
  if (config.aiProvider === 'gemini') {
    if (config.connectionMode === 'direct' && activeKey) {
      initializeGemini(activeKey);
    }
  } else if (config.aiProvider === 'openai' || config.aiProvider === 'deepseek') {
    if (activeKey) initializeOpenAI(activeKey, activeBaseUrl);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (expressServer) {
    expressServer.close();
    expressServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


app.on('before-quit', () => {
  if (expressServer) {
    expressServer.close();
    expressServer = null;
  }
});

// IPC Handlers
// -----------------------------
// Window controls (for custom titlebar)
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  win?.minimize();
});

ipcMain.on('window-toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  win?.close();
});

ipcMain.handle('window-is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return !!win?.isMaximized();
});

ipcMain.handle('get-console-logs', (): ConsoleLogEntry[] => getConsoleLogs());

ipcMain.handle('clear-console-logs', (): void => {
  clearConsoleLogs();
});

ipcMain.on('renderer-console-log', (_event, level: ConsoleLogEntry['level'], args: unknown[]) => {
  const safeLevel = level === 'info' || level === 'warn' || level === 'error' ? level : 'log';
  persistConsoleLog(safeLevel, 'renderer', Array.isArray(args) ? args : [args]);
});

// -----------------------------
// Config handlers
ipcMain.handle('get-config', () => getConfig());
ipcMain.handle('set-config', (_event, updates: Partial<any>) => {
  setConfig(updates);

  // Re-initialize AI if settings changed
  const config = getConfig();

  const activeKey =
    config.connectionMode === 'proxy'
      ? config.proxyApiKeys?.[config.aiProvider] || ''
      : config.apiKeys?.[config.aiProvider] || '';

  const activeBaseUrl =
    config.connectionMode === 'proxy' ? config.proxyBaseUrls?.[config.aiProvider] : undefined;

  if (config.aiProvider === 'gemini') {
    if (config.connectionMode === 'direct' && activeKey) {
      initializeGemini(activeKey);
    }
  } else if (config.aiProvider === 'openai' || config.aiProvider === 'deepseek') {
    if (activeKey) initializeOpenAI(activeKey, activeBaseUrl);
  }

  // Re-initialize WhatsApp if settings changed
  if (updates.whatsapp) {
    initializeWhatsApp();
  }

  // Re-initialize Ngrok if settings changed
  if (updates.ngrok) {
    const updatedConfig = config.ngrok;
    // Only update if config exists and has required fields
    if (updatedConfig && typeof updatedConfig.enabled === 'boolean' && typeof updatedConfig.port === 'number') {
      ngrokManager?.updateConfig(updatedConfig);
      console.log('[Ngrok] Config updated');
      console.log('[Ngrok] Feature flag (useSdk):', updatedConfig?.useSdk);
    }
  }
});

// API Key validation
ipcMain.handle(
  'validate-api-key',
  async (
    _event,
    provider: Config['aiProvider'],
    key: string,
    options?: { connectionMode?: 'direct' | 'proxy'; proxyBaseUrl?: string }
  ) => {
    if (provider === 'gemini') {
      // Provider-native validation:
      // - direct: validate against Google Gemini
      // - proxy: validate against Gemini-compatible proxy base URL
      const baseUrl = options?.connectionMode === 'proxy' ? options?.proxyBaseUrl : undefined;
      return await validateGeminiKey(key, baseUrl);
    }
    if (provider === 'claude') {
      return await validateClaudeKey(key, options?.connectionMode === 'proxy' ? options?.proxyBaseUrl : undefined);
    }

    return await validateOpenAIKey(key, options?.connectionMode === 'proxy' ? options?.proxyBaseUrl : undefined);
  }
);

// Model fetching
ipcMain.handle(
  'get-available-models',
  async (
    _event,
    provider: Config['aiProvider'],
    key: string,
    options?: { connectionMode?: 'direct' | 'proxy'; proxyBaseUrl?: string }
  ): Promise<ModelInfo[]> => {
    if (provider === 'gemini') {
      return await getGeminiModels(key, options?.connectionMode === 'proxy' ? options?.proxyBaseUrl : undefined);
    }
    if (provider === 'claude') {
      return await getClaudeModels();
    }
    if (provider === 'deepseek') {
      return [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'Fast DeepSeek chat model' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'Stronger DeepSeek chat model' },
      ];
    }

    return await getOpenAIModels(key, options?.connectionMode === 'proxy' ? options?.proxyBaseUrl : undefined);
  }
);

// File operations
ipcMain.handle('select-folder', async (event) => {
  console.log('IPC: select-folder called');
  const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!window) {
    console.error('IPC: select-folder - No window found');
    return null;
  }
  try {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
    });
    console.log('IPC: select-folder result:', result.canceled ? 'canceled' : result.filePaths[0]);
    return result.canceled ? null : result.filePaths[0];
  } catch (error) {
    console.error('IPC: select-folder error:', error);
    return null;
  }
});

ipcMain.handle('select-file', async (event, filters?: { name: string; extensions: string[] }[]) => {
  const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!window) return null;
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: filters || [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'PDF Files', extensions: ['pdf'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});


// Attachment helpers
ipcMain.handle('cache-attachment', async (_event, originalPath: string): Promise<string | null> => {
  try {
    const config = getConfig();
    const baseDir = config.databasePath || app.getPath('userData');
    const attachmentsDir = path.join(baseDir, 'attachments');
    await fs.mkdir(attachmentsDir, { recursive: true });

    const fileName = path.basename(originalPath);
    const uniqueName = `${Date.now()}-${fileName}`;
    const destPath = path.join(attachmentsDir, uniqueName);
    await fs.copyFile(originalPath, destPath);
    return destPath;
  } catch (error) {
    console.error('IPC: cache-attachment error:', error);
    return null;
  }
});

ipcMain.handle('get-attachment-data-url', async (_event, filePath: string): Promise<string | null> => {
  try {
    // Security: renderer must not be able to read arbitrary local files.
    // Attachments should be served only from the app-managed cache directory.
    if (!isAllowedRendererFilePath({
      filePath,
      allowedExts: ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.txt', '.md', '.json', '.csv'],
    })) {
      console.warn('[IPC] Blocked get-attachment-data-url for path outside allowed roots:', filePath);
      return null;
    }

    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.txt' || ext === '.md') mimeType = 'text/plain';
    else if (ext === '.json') mimeType = 'application/json';
    else if (ext === '.csv') mimeType = 'text/csv';

    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('IPC: get-attachment-data-url error:', error);
    return null;
  }
});

// Conversation handlers
ipcMain.handle('get-conversations', (_event, profileId?: string, includeShared?: boolean): Conversation[] => {
  const conversations = getStoredConversations().filter((conversation) => !conversation.archivedAt);
  const activeProfile = getActiveProfile();
  const effectiveProfileId = isSideraScope(profileId) ? null : (profileId || activeProfile?.id || null);
  if (isSideraScope(profileId)) {
    return conversations
      .filter((conversation) => isConversationInScope(conversation, SIDERA_AGENT_ID, effectiveProfileId, includeShared))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  return conversations.filter((conversation) => isConversationInScope(conversation, profileId || null, effectiveProfileId, includeShared));
});

ipcMain.handle('get-archived-conversations', (): Conversation[] => {
  return getStoredConversations()
    .filter((conversation) => Boolean(conversation.archivedAt))
    .sort((a, b) => (b.archivedAt || b.updatedAt || b.createdAt) - (a.archivedAt || a.updatedAt || a.createdAt));
});

ipcMain.handle('get-conversation', (_event, id: string): Conversation | null => {
  const conversations = getStoredConversations();
  const activeProfile = getActiveProfile();
  const effectiveScope: ConversationScope = isSideraScope(currentConversationScope)
    ? SIDERA_AGENT_ID
    : (currentConversationScope || activeProfile?.id || null);
  const effectiveProfileId = isSideraScope(effectiveScope)
    ? null
    : effectiveScope;

  const conversation = conversations.find((item) => item.id === id) || null;
  if (!conversation) return null;

  if (id === currentConversationId) {
    return conversation;
  }

  if (!isConversationInScope(conversation, effectiveScope, effectiveProfileId, true)) {
    return null;
  }

  return conversation;
});

ipcMain.handle('create-conversation', (_event, profileId?: string): Conversation => {
  const conversations = getStoredConversations();
  const activeProfile = getActiveProfile();
  const newConversation = createConversationForScope(profileId || null, activeProfile?.id || null);
  conversations.unshift(newConversation);
  saveConversations(conversations);
  return normalizeConversation(newConversation);
});

ipcMain.handle('update-conversation', (_event, id: string, updates: Partial<Conversation>) => {
  const conversations = getStoredConversations();
  const index = conversations.findIndex(c => c.id === id);
  if (index !== -1) {
    const nextConversation = normalizeConversation({ ...conversations[index], ...updates, updatedAt: Date.now() });
    if (updates.archivedAt === null) {
      delete nextConversation.archivedAt;
    }
    conversations[index] = nextConversation;
    saveConversations(conversations);
  }
});

ipcMain.handle('share-conversation-with-profile', (_event, conversationId: string, profileId: string): boolean => {
  const conversations = getStoredConversations();
  const conversation = conversations.find(c => c.id === conversationId);
  if (!conversation) return false;
  
  const sharedWith = conversation.sharedWithProfiles || [];
  if (!sharedWith.includes(profileId)) {
    sharedWith.push(profileId);
    conversation.sharedWithProfiles = sharedWith;
    conversation.updatedAt = Date.now();
    saveConversations(conversations);
  }
  return true;
});

ipcMain.handle('delete-conversation', (_event, id: string) => {
  const conversations = getStoredConversations();
  const filtered = conversations.filter(c => c.id !== id);
  saveConversations(filtered);
});

ipcMain.handle('delete-messages', (_event, conversationId: string, messageIds: string[]) => {
  const conversations = getStoredConversations();
  const conversation = conversations.find(c => c.id === conversationId);
  if (!conversation) return;

  const result = deleteConversationMessages(conversation, messageIds);
  if (!result.changed) return;

  if (conversation.kind === 'single-profile' && conversation.messages.some((m) => m.profileId && m.profileId !== conversation.profileId)) {
    conversation.kind = 'sidera';
    conversation.profileId = undefined;
    conversation.defaultProfileId = undefined;
  }
  conversation.updatedAt = Date.now();
  saveConversations(conversations);
  notifyConversationUpdated(conversation);
});

ipcMain.handle('edit-message', async (_event, conversationId: string, messageId: string, newContent: string) => {
  const conversations = getStoredConversations();
  const conversation = conversations.find(c => c.id === conversationId);
  if (!conversation) return;

  const messageIndex = conversation.messages.findIndex(m => m.id === messageId);
  if (messageIndex === -1) return;

  const message = conversation.messages[messageIndex];
  message.content = newContent;

  if (message.role === 'assistant') {
    conversation.updatedAt = Date.now();
    saveConversations(conversations);
    notifyConversationUpdated(conversation);
    return;
  }

  const target = prepareRegeneration(conversation, messageId);
  if (!target) {
    conversation.updatedAt = Date.now();
    saveConversations(conversations);
    notifyConversationUpdated(conversation);
    return;
  }

  await regenerateFromUserMessage({
    config: getConfig(),
    conversation,
    conversations,
    target,
  });
});

ipcMain.handle('regenerate-message', async (_event, conversationId: string, messageId: string) => {
  const conversations = getStoredConversations();
  const conversation = conversations.find(c => c.id === conversationId);
  if (!conversation) return;

  const target = prepareRegeneration(conversation, messageId);
  if (!target) return;

  await regenerateFromUserMessage({
    config: getConfig(),
    conversation,
    conversations,
    target,
  });
});

// AI message handling
let currentConversationId: string | null = null;
let currentConversationScope: ConversationScope = null;

type LiveToolUpdateType = 'call' | 'start' | 'update' | 'result';
type LiveToolPart = Extract<NonNullable<Message['parts']>[number], { type: 'tool' }> & {
  type: 'tool';
  startedAt?: number;
};
type LiveToolEnvelope = {
  conversationId: string;
  messageId: string;
  tool: LiveToolPart;
};
type LiveToolResultEnvelope = {
  conversationId: string;
  messageId: string;
  result: any;
};

const MIN_VISIBLE_TOOL_MS = 1500;

function hasToolArguments(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function formatLiveToolStatusText(toolName?: string): string {
  const actions: Record<string, string> = {
    add_to_database: 'adauga in memorie',
    call_subagent: 'apeleaza un subagent',
    check_database: 'cauta in memorie',
    check_resources: 'verifica resursele sistemului',
    create_file: 'creeaza un fisier',
    delete_from_database: 'sterge din memorie',
    delete_file: 'sterge un fisier',
    google_search: 'cauta pe web',
    read_file: 'citeste un fisier',
    start_app: 'porneste o aplicatie',
    stop_app: 'opreste o aplicatie',
  };

  if (!toolName) return 'ruleaza un tool';
  return actions[toolName] || `ruleaza ${toolName.replace(/_/g, ' ')}`;
}

function createLiveToolEnvelope(conversation: Conversation, message: Message, tool: LiveToolPart): LiveToolEnvelope {
  const routedTool = {
    ...tool,
    confirmation: tool.confirmation
      ? {
          ...tool.confirmation,
          conversationId: tool.confirmation.conversationId || conversation.id,
          messageId: tool.confirmation.messageId || message.id,
          toolCallId: tool.confirmation.toolCallId || tool.id,
        }
      : undefined,
  };
  return {
    conversationId: conversation.id,
    messageId: message.id,
    tool: routedTool,
  };
}

function createLiveToolResultEnvelope(conversation: Conversation, message: Message, result: any): LiveToolResultEnvelope {
  return {
    conversationId: conversation.id,
    messageId: message.id,
    result,
  };
}

function findLiveToolPart(parts: NonNullable<Message['parts']>, id?: string, name?: string): LiveToolPart | undefined {
  const toolParts = [...parts]
    .reverse()
    .filter((part): part is LiveToolPart => part.type === 'tool');

  if (id) {
    const exactMatch = toolParts.find(part => part.id === id);
    if (exactMatch) return exactMatch;
  }

  return toolParts.find(part => Boolean(name && part.name === name) && (part.status === 'running' || part.status === 'pending'));
}

function applyLiveToolUpdate(
  message: Message,
  type: LiveToolUpdateType,
  data: any,
  sendToolCall: (toolPart: LiveToolPart) => void,
  sendToolResult: (result: any) => void,
  scheduleSave: (immediate?: boolean) => void,
  notifyLiveUpdate?: () => void
): Promise<void> {
  if (!message.parts) message.parts = [];

  if (type === 'call') {
    const id = data.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const existingToolPart = findLiveToolPart(message.parts, id);
    const toolPart: LiveToolPart =
      existingToolPart || {
        type: 'tool',
        id,
        name: data.name,
        args: data.arguments || {},
        argsText: typeof data.argumentsText === 'string' ? data.argumentsText : '',
        status: 'running',
        phase: data.phase || 'detected',
        startedAt: data.startedAt || Date.now(),
        updatedAt: Date.now(),
      };

    toolPart.name = data.name || toolPart.name;
    if (typeof data.argumentsText === 'string') {
      toolPart.argsText = data.argumentsText;
    }
    if (hasToolArguments(data.arguments) || !hasToolArguments(toolPart.args)) {
      toolPart.args = data.arguments ?? toolPart.args;
    }
    toolPart.status = toolPart.status === 'pending' ? 'pending' : 'running';
    toolPart.phase = data.phase || 'detected';
    toolPart.startedAt = toolPart.startedAt || data.startedAt || Date.now();
    toolPart.updatedAt = Date.now();
    message.statusText = formatLiveToolStatusText(toolPart.name);

    if (!existingToolPart) message.parts.push(toolPart);
    scheduleSave(true);
    sendToolCall(toolPart);
    notifyLiveUpdate?.();
    return Promise.resolve();
  } else if (type === 'start') {
    const toolPart = findLiveToolPart(message.parts, data.id, data.name);
    if (toolPart) {
      toolPart.name = data.name || toolPart.name;
      if (typeof data.argumentsText === 'string') {
        toolPart.argsText = data.argumentsText;
      }
      if (hasToolArguments(data.arguments) || !hasToolArguments(toolPart.args)) {
        toolPart.args = data.arguments ?? toolPart.args;
      }
      toolPart.status = toolPart.status === 'pending' ? 'pending' : 'running';
      toolPart.phase = data.phase || 'running';
      toolPart.startedAt = data.startedAt || toolPart.startedAt || Date.now();
      toolPart.updatedAt = Date.now();
      message.statusText = formatLiveToolStatusText(toolPart.name);
      sendToolCall(toolPart);
      notifyLiveUpdate?.();
    }
  } else if (type === 'update') {
    const toolPart = findLiveToolPart(message.parts, data.id, data.name);
    if (toolPart) {
      toolPart.name = data.name || toolPart.name;
      if (typeof data.argumentsText === 'string') {
        toolPart.argsText = data.argumentsText;
      }
      if (hasToolArguments(data.arguments) || !hasToolArguments(toolPart.args)) {
        toolPart.args = data.arguments ?? toolPart.args;
      }
      message.statusText = formatLiveToolStatusText(toolPart.name);
      if (toolPart.phase !== 'starting') toolPart.phase = data.phase || toolPart.phase || 'detected';
      toolPart.updatedAt = Date.now();
      sendToolCall(toolPart);
      notifyLiveUpdate?.();
    }
  } else if (type === 'result') {
    const toolPart = findLiveToolPart(message.parts, data.id, data.name);
    if (toolPart) {
      const finalize = () => {
        toolPart.status = data.success ? 'success' : 'error';
        toolPart.phase = undefined;
        toolPart.result = data.success ? data.result : data.error || data.result;
        toolPart.updatedAt = Date.now();
        toolPart.resultUpdatedAt = Date.now();
        delete message.statusText;
        sendToolResult({ id: toolPart.id, ...data });
        notifyLiveUpdate?.();
        scheduleSave(false);
      };
      const elapsed = Date.now() - (toolPart.startedAt || Date.now());
      const remaining = Math.max(0, MIN_VISIBLE_TOOL_MS - elapsed);
      if (remaining > 0) {
        return new Promise((resolve) => {
          setTimeout(() => {
            finalize();
            resolve();
          }, remaining);
        });
      } else {
        finalize();
      }
      return Promise.resolve();
    }
  }

  scheduleSave(false);
  return Promise.resolve();
}

function applyLiveToolConfirmation(
  message: Message,
  request: ToolConfirmationRequest,
  sendToolCall: (toolPart: LiveToolPart) => void,
  scheduleSave: (immediate?: boolean) => void,
  notifyLiveUpdate?: () => void
): ToolConfirmationRequest {
  if (!message.parts) message.parts = [];

  const existingToolPart = findLiveToolPart(message.parts, request.toolCallId, request.toolName);
  const routedRequest: ToolConfirmationRequest = {
    ...request,
    messageId: request.messageId,
    toolCallId: existingToolPart?.id || request.toolCallId || `confirm-${request.id}`,
  };
  const toolPart: LiveToolPart =
    existingToolPart || {
      type: 'tool',
      id: routedRequest.toolCallId || `confirm-${request.id}`,
      name: routedRequest.toolName,
      args: routedRequest.args,
      argsText: JSON.stringify(routedRequest.args || {}),
      status: 'pending',
      startedAt: Date.now(),
    };

  routedRequest.toolCallId = toolPart.id;
  toolPart.name = routedRequest.toolName || toolPart.name;
  toolPart.args = routedRequest.args ?? toolPart.args;
  toolPart.argsText = JSON.stringify(routedRequest.args || {});
  toolPart.status = 'pending';
  toolPart.confirmation = routedRequest;
  toolPart.startedAt = toolPart.startedAt || Date.now();
  toolPart.updatedAt = Date.now();
  toolPart.confirmationUpdatedAt = Date.now();
  message.statusText = formatLiveToolStatusText(toolPart.name);

  if (!existingToolPart) message.parts.push(toolPart);
  scheduleSave(true);
  sendToolCall(toolPart);
  notifyLiveUpdate?.();

  return routedRequest;
}

ipcMain.on('set-current-conversation', (_event, id: string, scope?: ConversationScope) => {
  currentConversationId = id;
  currentConversationScope = typeof scope === 'undefined' ? null : scope;
});

ipcMain.handle('send-message', async (
  _event,
  message: string,
  attachments?: FileAttachment[],
  options?: { conversationScope?: ConversationScope; forceNewConversation?: boolean; targetProfileId?: string | null }
) => {
  const config = getConfig();
  const activeProfile = getActiveProfile();
  const requestedScope = typeof options?.conversationScope === 'undefined'
    ? currentConversationScope
    : options?.conversationScope;
  const routing = resolveMessageRouting({
    rawMessage: message,
    requestedScope,
    explicitTargetProfileId: options?.targetProfileId,
    activeProfileId: activeProfile?.id || null,
  });
  const resolvedMessage = routing.resolvedMessage;
  const effectiveScope = routing.effectiveScope;
  const effectiveProfileId = routing.targetProfileId;
  const responseStartMs = Date.now();

  if (!resolvedMessage.trim() && (!attachments || attachments.length === 0)) {
    return;
  }

  // Ensure currentConversationId always points to a conversation that matches the active profile scope.
  // This prevents “cross-profile” chat histories.
  // IMPORTANT: keep a single in-memory `conversations` reference for the entire request.
  // If we mix different arrays (multiple `get()` calls), later saves can overwrite newer state and
  // cause symptoms like “a bunch of new conversations being created”.
  let conversations = getStoredConversations();
  const resolvedConversation = resolveActiveConversation({
    conversations,
    currentConversationId,
    effectiveScope,
    effectiveProfileId,
    activeProfileId: activeProfile?.id || null,
    forceNewConversation: Boolean(options?.forceNewConversation),
  });
  const conversationsChanged = resolvedConversation.conversations !== conversations;
  conversations = resolvedConversation.conversations;
  currentConversationId = resolvedConversation.conversationId;

  if (conversationsChanged) {
    saveConversations(conversations);
  }

  if (!currentConversationId) return;

  const conversation = resolvedConversation.conversation;
  if (!conversation) return;

  if (isSideraScope(effectiveScope)) {
    conversation.kind = 'sidera';
    conversation.profileId = undefined;
    conversation.defaultProfileId = undefined;
  } else if (effectiveProfileId) {
    conversation.kind = 'single-profile';
    conversation.profileId = effectiveProfileId;
    conversation.defaultProfileId = effectiveProfileId;
  }

  // Add user message
  const userMessage: Message = {
    id: Date.now().toString(),
    role: 'user',
    content: resolvedMessage,
    timestamp: Date.now(),
    profileId: isSideraScope(effectiveScope) ? undefined : effectiveProfileId || undefined,
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  };
  conversation.messages.push(userMessage);
  conversation.updatedAt = Date.now();
  saveConversations(conversations);

  const effectiveSelectedModel = getEffectiveModelForProvider(config);

  // Create AI message placeholder
  const aiMessage: Message = {
    id: (Date.now() + 1).toString(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    profileId: isSideraScope(effectiveScope) ? undefined : getMessageProfileId(userMessage, conversation),
    modelName: effectiveSelectedModel,
    statusText: undefined,
    parts: [], // Initialize parts
  };
  conversation.messages.push(aiMessage);
  saveConversations(conversations);

  // Generate AI name for conversation if first message
  if (conversation.messages.length === 2) {
    // Generate a name based on first message (simplified)
    conversation.name = resolvedMessage.substring(0, 30) + (resolvedMessage.length > 30 ? '...' : '');
    saveConversations(conversations);
  }

  const history = buildConversationHistory(conversation.messages.slice(0, -2));

  // Throttle disk writes during streaming/tool updates (major speedup vs writing on every chunk)
  let saveTimer: NodeJS.Timeout | null = null;
  let savePending = false;
  const scheduleSave = (immediate = false) => {
    conversation.updatedAt = Date.now();
    savePending = true;

    if (immediate) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      saveConversations(conversations);
      savePending = false;
      return;
    }

    if (saveTimer) return;

    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!savePending) return;
      saveConversations(conversations);
      savePending = false;
    }, 250);
  };

  const onChunk = (chunk: string) => {
    if (mainWindow) {
      aiMessage.content += chunk;

      // Update parts: if last part is text, append; otherwise add new text part
      const lastPart =
        aiMessage.parts && aiMessage.parts.length > 0 ? aiMessage.parts[aiMessage.parts.length - 1] : null;
      if (lastPart && lastPart.type === 'text') {
        lastPart.content += chunk;
      } else {
        if (!aiMessage.parts) aiMessage.parts = [];
        aiMessage.parts.push({ type: 'text', content: chunk });
      }

      mainWindow.webContents.send('ai-response-chunk', chunk);
      scheduleSave(false);
    }
  };

  const onToolUpdate = (type: LiveToolUpdateType, data: any) => {
    if (mainWindow) {
      return applyLiveToolUpdate(
        aiMessage,
        type,
        data,
        (toolPart) => mainWindow?.webContents.send('ai-tool-call', createLiveToolEnvelope(conversation, aiMessage, toolPart)),
        (result) => mainWindow?.webContents.send('ai-tool-result', createLiveToolResultEnvelope(conversation, aiMessage, result)),
        scheduleSave,
        () => notifyConversationUpdated(conversation)
      );
    }
    return Promise.resolve();
  };
  const requestToolConfirmation = (request: ToolConfirmationRequest) => {
    const routedRequest: ToolConfirmationRequest = {
      ...request,
      conversationId: conversation.id,
      messageId: aiMessage.id,
    };
    const confirmationRequest = mainWindow
      ? applyLiveToolConfirmation(
        aiMessage,
        routedRequest,
        (toolPart) => mainWindow?.webContents.send('ai-tool-call', createLiveToolEnvelope(conversation, aiMessage, toolPart)),
        scheduleSave,
        () => notifyConversationUpdated(conversation)
      )
      : routedRequest;
    return requestLocalToolConfirmation(confirmationRequest);
  };

  const onComplete = (metadata?: { functionCalls?: any[]; functionResults?: any[] }) => {
    if (mainWindow) {
      if (metadata?.functionCalls) {
        console.log('Received function calls in onComplete:', metadata.functionCalls);
        aiMessage.functionCalls = metadata.functionCalls;
      }
      if (metadata?.functionResults) {
        aiMessage.functionResults = metadata.functionResults;
      }
      aiMessage.responseTimeSeconds = Math.round(((Date.now() - responseStartMs) / 1000) * 100) / 100;

      mainWindow.webContents.send('ai-response-complete');
      scheduleSave(true);
    }
  };

  try {
    const effectiveConfig = withEffectiveProviderModel(config, effectiveSelectedModel);

    await sendConfiguredAIMessage({
      config: effectiveConfig,
      message: resolvedMessage,
      onChunk,
      onComplete,
      profileId: isSideraScope(effectiveScope) ? undefined : effectiveProfileId || undefined,
      geminiHistory: history,
      attachments,
      onToolUpdate,
      channel: 'local',
      requestConfirmation: requestToolConfirmation,
      orchestration: isSideraScope(effectiveScope) ? { enabled: true, depth: 0, maxCalls: 3 } : undefined,
    });
  } catch (error: any) {
    console.error('AI error:', error);
    aiMessage.content = `Error: ${error.message}`;
    saveConversations(conversations);
    if (mainWindow) {
      mainWindow.webContents.send('ai-response-complete');
    }
  }
});

ipcMain.handle('stop-generation', () => {
  const config = getConfig();
  if (config.aiProvider === 'gemini') {
    stopGeminiGeneration();
  } else if (config.aiProvider === 'claude') {
    stopClaudeGeneration();
  } else {
    stopOpenAIGeneration();
  }
});

ipcMain.handle('resolve-tool-confirmation', (_event, id: string, approved: boolean): boolean => {
  return resolveLocalToolConfirmation(id, approved === true);
});

// Profile handlers
ipcMain.handle('get-all-profiles', (): Profile[] => {
  return getAllProfiles().map(normalizeProfile);
});

ipcMain.handle('get-profile', (_event, id: string): Profile | null => {
  const profile = getProfile(id);
  return profile ? normalizeProfile(profile) : null;
});

ipcMain.handle('get-active-profile', (): Profile | null => {
  const profile = getActiveProfile();
  return profile ? normalizeProfile(profile) : null;
});

ipcMain.handle('set-active-profile', (_event, id: string | null) => {
  setActiveProfile(id);
  // Notify renderer(s) so they can refresh profile-scoped UI immediately.
  mainWindow?.webContents.send('active-profile-changed', id);
});

ipcMain.handle('create-profile', (_event, profile: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>): Profile => {
  const created = createProfile(profile);
  mainWindow?.webContents.send('profiles-changed');
  return created;
});

ipcMain.handle('update-profile', (_event, id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt'>>): Profile | null => {
  const updated = updateProfile(id, updates);
  if (updated) {
    mainWindow?.webContents.send('profiles-changed');
  }
  return updated;
});

ipcMain.handle('delete-profile', (_event, id: string): boolean => {
  const deleted = deleteProfile(id);
  if (deleted) {
    mainWindow?.webContents.send('profiles-changed');
  }
  return deleted;
});

ipcMain.handle('add-knowledge-file', async (_event, profileId: string, filePath: string): Promise<KnowledgeFile | null> => {
  try {
    const profile = getProfile(profileId);
    if (!profile) return null;

    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    
    let fileType: KnowledgeFile['type'] = 'other';
    if (['.txt', '.md', '.json', '.csv'].includes(ext)) fileType = 'text';
    else if (ext === '.pdf') fileType = 'pdf';
    else if (ext === '.docx') fileType = 'docx';
    else if (['.png', '.jpg', '.jpeg', '.gif'].includes(ext)) fileType = 'image';

    const knowledgeFile: KnowledgeFile = {
      id: Date.now().toString(),
      name: fileName,
      path: filePath,
      type: fileType,
      size: stats.size,
      addedAt: Date.now(),
      status: 'pending',
      chunksProcessed: 0,
    };

    // Copy file to profile knowledge directory
    const destPath = await copyKnowledgeFile(profileId, filePath, `${knowledgeFile.id}-${fileName}`);
    knowledgeFile.path = destPath;

    // Update profile with new file
    const updatedFiles = [...profile.knowledgeFiles, knowledgeFile];
    updateProfile(profileId, { knowledgeFiles: updatedFiles });

    // Process and embed the file
    updateProfile(profileId, {
      knowledgeFiles: updatedFiles.map((file) =>
        file.id === knowledgeFile.id ? { ...file, status: 'processing' } : file
      ),
    });
    const processing = await processKnowledgeFile(profileId, knowledgeFile);
    const processedFile: KnowledgeFile = {
      ...knowledgeFile,
      status: processing.status,
      chunksProcessed: processing.chunksProcessed,
      error: processing.error,
      lastIndexedAt: processing.lastIndexedAt,
      contentHash: processing.contentHash,
    };
    const latestProfile = getProfile(profileId);
    updateProfile(profileId, {
      knowledgeFiles: (latestProfile?.knowledgeFiles || updatedFiles).map((file) =>
        file.id === processedFile.id ? processedFile : file
      ),
    });
    mainWindow?.webContents.send('profiles-changed');

    return processedFile;
  } catch (error: any) {
    console.error('Error adding knowledge file:', error);
    return null;
  }
});

ipcMain.handle('reprocess-knowledge-file', async (_event, profileId: string, fileId: string): Promise<KnowledgeFile | null> => {
  try {
    const profile = getProfile(profileId);
    const file = profile?.knowledgeFiles.find((item) => item.id === fileId);
    if (!profile || !file) return null;

    updateProfile(profileId, {
      knowledgeFiles: profile.knowledgeFiles.map((item) =>
        item.id === fileId ? { ...item, status: 'processing', error: undefined } : item
      ),
    });

    const processing = await processKnowledgeFile(profileId, file);
    const processedFile: KnowledgeFile = {
      ...file,
      status: processing.status,
      chunksProcessed: processing.chunksProcessed,
      error: processing.error,
      lastIndexedAt: processing.lastIndexedAt,
      contentHash: processing.contentHash,
    };
    const latestProfile = getProfile(profileId);
    updateProfile(profileId, {
      knowledgeFiles: (latestProfile?.knowledgeFiles || profile.knowledgeFiles).map((item) =>
        item.id === fileId ? processedFile : item
      ),
    });
    mainWindow?.webContents.send('profiles-changed');
    return processedFile;
  } catch (error: any) {
    console.error('Error reprocessing knowledge file:', error);
    return null;
  }
});

// Serve local files (avatars, etc.) as data URLs for safe renderer display.
ipcMain.handle('get-file-data-url', async (_event, filePath: string): Promise<string | null> => {
  try {
    // Security: this endpoint is used for avatars; restrict to app-managed profile storage.
    if (!isAllowedRendererFilePath({
      filePath,
      allowedExts: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    })) {
      console.warn('[IPC] Blocked get-file-data-url for path outside allowed roots:', filePath);
      return null;
    }

    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.gif') mimeType = 'image/gif';

    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('IPC: get-file-data-url error:', error);
    return null;
  }
});

ipcMain.handle('set-user-avatar-image', async (_event, imagePath: string | null): Promise<string | null> => {
  const config = getConfig();
  const nextUserPersona = { ...config.userPersona };

  if (!imagePath) {
    delete nextUserPersona.avatarImagePath;
    setConfig({ userPersona: nextUserPersona });
    return null;
  }

  try {
    const ext = path.extname(imagePath).toLowerCase() || '.png';
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return null;

    const avatarDir = path.join(app.getPath('userData'), 'user', 'avatar');
    await fs.mkdir(avatarDir, { recursive: true });

    const destPath = path.join(avatarDir, `avatar-${Date.now()}${ext}`);
    await fs.copyFile(imagePath, destPath);

    setConfig({
      userPersona: {
        ...nextUserPersona,
        avatarImagePath: destPath,
      },
    });

    mainWindow?.webContents.send('user-avatar-changed', destPath);
    return destPath;
  } catch (error) {
    console.error('Failed to set user avatar image:', error);
    return null;
  }
});

ipcMain.handle('remove-knowledge-file', async (_event, profileId: string, fileId: string): Promise<boolean> => {
  await deleteKnowledgeChunks(profileId, fileId);
  const deleted = await deleteKnowledgeFile(profileId, fileId);
  if (deleted) mainWindow?.webContents.send('profiles-changed');
  return deleted;
});

ipcMain.handle('set-profile-avatar-emoji', async (_event, profileId: string, emoji: string | null): Promise<Profile | null> => {
  const profile = getProfile(profileId);
  if (!profile) return null;
  const sanitized = (emoji || '').trim();
  const updated = updateProfile(profileId, {
    avatarEmoji: sanitized.length > 0 ? sanitized : undefined,
    // If user sets emoji, keep any image path but emoji takes priority in UI.
  } as any);
  if (updated) {
    mainWindow?.webContents.send('profiles-changed');
  }
  return updated;
});

ipcMain.handle('set-profile-avatar-image', async (_event, profileId: string, imagePath: string | null): Promise<Profile | null> => {
  const profile = getProfile(profileId);
  if (!profile) return null;
  if (!imagePath) {
    const updated = updateProfile(profileId, { avatarImagePath: undefined } as any);
    if (updated) {
      mainWindow?.webContents.send('profiles-changed');
    }
    return updated;
  }
  try {
    const dest = await copyProfileAvatarImage(profileId, imagePath);
    const updated = updateProfile(profileId, { avatarImagePath: dest } as any);
    if (updated) {
      mainWindow?.webContents.send('profiles-changed');
    }
    return updated;
  } catch (e) {
    console.error('Failed to set profile avatar image:', e);
    return null;
  }
});

ipcMain.handle('get-whatsapp-default-profile', (): Profile | null => {
  return getWhatsAppDefaultProfile();
});

ipcMain.handle('set-whatsapp-default-profile', (_event, id: string | null) => {
  setWhatsAppDefaultProfile(id);
  mainWindow?.webContents.send('whatsapp-default-profile-changed', id);
});

// Ngrok IPC Handlers
ipcMain.handle('ngrok-configure-token', async (_event, authToken: string) => {
  if (!ngrokManager) {
    return { success: false, message: 'Ngrok not initialized' };
  }
  const result = await ngrokManager.configureAuthToken(authToken);
  
  if (result.success) {
    // Save to config
    const config = getConfig();
    const ngrokConfig = (config as any).ngrok || {};
    ngrokConfig.authToken = authToken;
    (config as any).ngrok = ngrokConfig;
    setConfig(config);
  }
  
  return result;
});

ipcMain.handle('ngrok-start', async () => {
  if (!ngrokManager) {
    return { success: false, message: 'Ngrok not initialized' };
  }
  const result = await ngrokManager.start();
  
  if (result.success) {
    // Notify renderer about status change
    mainWindow?.webContents.send('ngrok-status-changed', {
      isRunning: true,
      publicUrl: result.publicUrl,
      webhookUrl: `${result.publicUrl}/webhook`
    });
  }
  
  return result;
});

ipcMain.handle('ngrok-stop', async () => {
  if (!ngrokManager) {
    return { success: false, message: 'Ngrok not initialized' };
  }
  const result = await ngrokManager.stop();
  
  if (result.success) {
    // Notify renderer about status change
    mainWindow?.webContents.send('ngrok-status-changed', {
      isRunning: false,
      publicUrl: null,
      webhookUrl: null
    });
  }
  
  return result;
});

ipcMain.handle('ngrok-get-status', async () => {
  if (!ngrokManager) {
    return { 
      isRunning: false, 
      publicUrl: null, 
      webhookUrl: null,
      configured: false 
    };
  }
  return await ngrokManager.getStatus();
});

// Removed: ngrok-is-installed handler - isInstalled() method no longer exists in SDK implementation


function coerceToNodeBuffer(input: any): Buffer {
  // Renderer cannot use Node's Buffer. IPC payloads should be structured-clone-safe.
  // Accept Buffer (dev), Uint8Array, or ArrayBuffer and convert to Node Buffer here.
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));
  // Electron may deserialize TypedArray-like objects; handle common shape.
  if (input && typeof input === 'object' && input.type === 'Buffer' && Array.isArray(input.data)) {
    return Buffer.from(input.data);
  }
  throw new Error('Unsupported audio payload type for transcription');
}

// Whisper OpenAI transcription handler
ipcMain.handle('transcribe-audio', async (_event, audio: any, mimeType: string = 'audio/webm') => {
  try {
    const audioBuffer = coerceToNodeBuffer(audio);

    console.log('[Whisper IPC] Received transcription request:', {
      bufferSize: audioBuffer?.length,
      mimeType,
    });

    const config = getConfig();
    const apiKey = config.stt?.openaiApiKey || config.apiKeys?.openai;
    
    console.log('[Whisper IPC] API key check:', {
      hasSttKey: !!config.stt?.openaiApiKey,
      hasOpenAiKey: !!config.apiKeys?.openai,
      sttEnabled: config.stt?.enabled,
    });
    
    if (!apiKey) {
      console.error('[Whisper IPC] No API key found');
      return {
        success: false,
        message: 'OpenAI API key is required for transcription. Please configure it in Settings > Speech-to-Text.',
      };
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      console.error('[Whisper IPC] Empty audio buffer');
      return {
        success: false,
        message: 'Audio buffer is empty. Please try recording again.',
      };
    }

    const sttLanguage = config.stt?.language;
    const sttPrompt = config.stt?.prompt;

    const result = await transcribeAudioWithOpenAI(audioBuffer, apiKey, mimeType, {
      language: sttLanguage,
      prompt: sttPrompt,
    });
    console.log('[Whisper IPC] Transcription result:', result.success ? 'Success' : 'Failed', result.message);
    return result;
  } catch (error: any) {
    console.error('[Whisper IPC] Unexpected error:', error);
    return {
      success: false,
      message: `Transcription error: ${error.message}`,
    };
  }
});
