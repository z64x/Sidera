export type AIProvider = 'gemini' | 'openai' | 'deepseek' | 'claude';

export type AIConnectionMode = 'direct' | 'proxy';

export type WhatsAppMethod = 'business-cloud' | 'twilio';

export type ToolId =
  | 'create_file'
  | 'read_file'
  | 'delete_file'
  | 'check_database'
  | 'add_to_database'
  | 'delete_from_database'
  | 'check_resources'
  | 'start_app'
  | 'stop_app'
  | 'get_weather'
  | 'google_search'
  | 'call_subagent';

export type ToolCategory = 'file-management' | 'database' | 'system-monitoring' | 'app-control' | 'search' | 'orchestration';

export interface ToolDefinition {
  id: ToolId;
  name: ToolId;
  label: string;
  description: string;
  category: ToolCategory;
  requiresConfirmation?: boolean;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

export interface ToolsConfig {
  googleSearch?: {
    enabled?: boolean;
    provider?: string;
    apiKey?: string;
    searchEngineId?: string;
    projectId?: string;
  };
  database?: { enabled?: boolean };
  appControl?: { enabled?: boolean };
  fileManagement?: { enabled?: boolean };
  systemMonitoring?: { enabled?: boolean };
}

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  level: 'log' | 'info' | 'warn' | 'error';
  source: 'main' | 'renderer';
  message: string;
  data?: unknown[];
}

export interface WhatsAppConfig {
  activeMethod?: WhatsAppMethod;
  businessCloud?: {
    apiToken: string;
    phoneNumberId: string;
    businessAccountId: string;
    webhookToken: string;
  };
  twilio?: {
    accountSid: string;
    authToken: string;
    whatsappNumber: string;
    webhookUrl: string;
  };
  webhook?: {
    publicUrl: string;
    provider: 'cloudflare' | 'ngrok' | 'custom';
  };
  allowedNumbers: string[];
  replyToUnauthorized?: boolean;
}

export interface ModelProfileConfig {
  model: string;
  maxResponseTokens: number;
  contextSizeTokens: number;
}

export interface ModelProfilesConfig {
  primary: ModelProfileConfig;
  secondary: ModelProfileConfig;
}

export type EmbeddingProviderConfig = 'auto' | 'openai' | 'gemini';

export interface ThesisInfo {
  student: string;
  coordinator: string;
}

export interface Config {
  aiProvider: AIProvider;

  /**
   * direct: talk to the provider endpoints directly (Google/OpenAI)
   * proxy: talk to a provider-compatible proxy endpoint (Gemini/OpenAI compatible)
   */
  connectionMode: AIConnectionMode;

  /**
   * Direct provider keys (existing behavior).
   * NOTE: Setup/Settings must preserve googleSearch/googleSearchEngineId when updating this object.
   */
  apiKeys: {
    gemini: string;
    openai: string;
    deepseek?: string;
    claude?: string;
    googleSearch?: string;
    googleSearchEngineId?: string;
  };

  /**
   * Proxy authentication keys (kept separate so switching mode doesn't overwrite direct keys)
   */
  proxyApiKeys: {
    gemini: string;
    openai: string;
    deepseek?: string;
    claude?: string;
  };

  /**
   * Proxy base URLs (global per provider)
   */
  proxyBaseUrls: {
    gemini: string;
    openai: string;
    deepseek?: string;
    claude?: string;
  };

  /**
   * Per-provider selected models (prevents selecting gpt-* under Gemini, etc.)
   */
  selectedModels: {
    gemini: string;
    openai: string;
    deepseek?: string;
    claude?: string;
  };

  /**
   * Legacy global selected model (kept only for backward compatibility / migration).
   * New code should prefer `selectedModels[aiProvider]`.
   */
  selectedModel: string;

  /**
   * Provider used only for vector embeddings / LanceDB memory.
   * Chat providers such as DeepSeek or Claude can still use OpenAI/Gemini embeddings.
   */
  embeddingProvider?: EmbeddingProviderConfig;

  /**
   * Primary model drives the visible assistant reply.
   * Secondary model is used by hidden Sidera subagents.
   */
  modelProfiles: ModelProfilesConfig;

  databasePath: string;

  tools?: ToolsConfig;

  /**
   * Optional Speech-to-Text configuration (OpenAI Whisper API).
   * When enabled, the UI should expose a record button in chat.
   */
  stt?: {
    enabled: boolean;
    provider: 'openai';
    openaiApiKey?: string; // API key for OpenAI Whisper API
    /** Optional: hint the language to Whisper to improve accuracy. */
    language?: 'en' | 'ro' | 'auto';
    /** Optional: prompt hint to bias Whisper decoding (e.g. "English or Romanian"). */
    prompt?: string;
  };


  userPersona: {
    name: string;
    description: string;
    userInfo: string;
    /** Absolute path to a copied user avatar image stored in app-managed storage. */
    avatarImagePath?: string;
  };

  thesisInfo: ThesisInfo;

  /**
   * Ngrok configuration for tunnel management
   */
  ngrok?: {
    authToken?: string;
    enabled: boolean;
    port: number;
    useSdk?: boolean; // Feature flag: true = SDK, false = CLI (default: true)
  };

  /**
   * WhatsApp remote-control channel configuration.
   * Incoming commands are denied unless the sender is in allowedNumbers.
   */
  whatsapp?: WhatsAppConfig;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Optional profile that this message should be routed to or was generated by. */
  profileId?: string;
  responseTimeSeconds?: number;
  functionCalls?: FunctionCall[];
  functionResults?: FunctionResult[];
  // Optional: which underlying model actually generated this message
  modelName?: string;
  // Optional: lightweight status text for tool progress (e.g. "Creating file Cozonac.txt...")
  statusText?: string;
  // Optional: attachments that were sent with this message (for previews)
  attachments?: FileAttachment[];
  // Parts for interleaved rendering (Text -> Tool -> Text)
  parts?: MessagePart[];
}

export type MessagePart =
  | { type: 'text'; content: string }
  | {
      type: 'tool';
      id: string;
      name?: string;
      args: any;
      status: 'pending' | 'running' | 'success' | 'error';
      phase?: 'detected' | 'starting' | 'running';
      argsText?: string;
      startedAt?: number;
      updatedAt?: number;
      resultUpdatedAt?: number;
      confirmationUpdatedAt?: number;
      result?: any;
      confirmation?: ToolConfirmationRequest;
    };

export interface FunctionCall {
  name: string;
  arguments: Record<string, any>;
  /**
   * Gemini 3 tool calls can include a thought signature that must be echoed back
   * alongside the functionCall part in follow-up turns.
   */
  thoughtSignature?: string;
  /** Provider-private metadata used to replay native tool-use turns. */
  providerMetadata?: Record<string, any>;
}

export interface FunctionResult {
  name: string;
  result: any;
  success: boolean;
  error?: string;
}

export interface ToolConfirmationRequest {
  id: string;
  toolName: string;
  args: Record<string, any>;
  conversationId?: string;
  messageId?: string;
  toolCallId?: string;
  reason: string;
  risk: 'overwrite_file' | 'delete_file' | 'delete_database' | 'launch_app' | 'stop_app' | 'absolute_file_access';
  channel: 'local' | 'whatsapp';
  expiresAt: number;
}

export interface Conversation {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  /**
   * Legacy/single-profile owner. Kept only for backward compatibility and scoped views.
   * Legacy/single-profile owner. Kept only for backward compatibility and scoped views.
   * Sidera conversations do not use a profile owner.
   */
  profileId?: string;
  /**
   * Explicit conversation mode.
   * Supported architecture:
   * - legacy: backward-compatible conversation without routing metadata
   * - single-profile: one profile owns the conversation
   * - sidera: built-in Sidera orchestrator conversation
   * - auto/multi-profile: legacy Sidera conversation shapes kept for migration compatibility
   */
  kind?: 'legacy' | 'single-profile' | 'sidera' | 'auto' | 'multi-profile';
  /** Default profile used for replies when the user does not override routing per message. */
  defaultProfileId?: string;
  /** Conversation origin. Defaults to app for older conversations. */
  source?: 'app' | 'whatsapp';
  /** Normalized sender number for WhatsApp conversations. */
  whatsappNumber?: string;
  /** Contact/profile name reported by the WhatsApp provider, when available. */
  whatsappContactName?: string;
  /** Archived conversations stay stored but are hidden from normal history/navigation. */
  archivedAt?: number | null;
  sharedWithProfiles?: string[]; // Optional: profiles that can access this conversation
}

export type ConversationScope = string | 'sidera' | 'auto' | null;

export interface FileAttachment {
  name: string;
  path: string;
  type: 'text' | 'pdf' | 'image';
  content?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  instructions: string;
  defaultTool?: string[];
  /** UI-level availability flag for the agent list. Undefined means active for older profiles. */
  isActive?: boolean;
  /** Optional UI avatar for this profile (shown in sidebar header). */
  avatarEmoji?: string;
  /** Absolute path to a copied avatar image stored under databasePath/profiles/<id>/avatar */
  avatarImagePath?: string;
  knowledgeFiles: KnowledgeFile[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeFile {
  id: string;
  name: string;
  path: string;
  type: 'text' | 'pdf' | 'docx' | 'image' | 'other';
  size: number;
  addedAt: number;
  status?: 'pending' | 'processing' | 'indexed' | 'failed' | 'unsupported';
  chunksProcessed?: number;
  error?: string;
  lastIndexedAt?: number;
  contentHash?: string;
  // Content will be embedded and stored in LanceDB with profileId metadata
}
