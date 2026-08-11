import Store from 'electron-store';
import { AIProvider, Config } from '../../shared/types';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { resolveProviderModel } from '../ai/providerUtils';

// SECURITY NOTE:
// Do NOT commit personal proxy URLs here.
// Keep defaults empty so the repo is safe to publish.
const DEFAULT_PROXY_URLS = {
  gemini: '',
  openai: '',
  deepseek: '',
  claude: '',
} as const;

const store = new Store<Config>({
  name: 'config',
  defaults: {
    aiProvider: 'gemini',
    connectionMode: 'direct',
    apiKeys: {
      gemini: '',
      openai: '',
      deepseek: '',
      claude: '',
      googleSearch: '',
      googleSearchEngineId: '',
    },
    proxyApiKeys: {
      gemini: '',
      openai: '',
      deepseek: '',
      claude: '',
    },
    proxyBaseUrls: {
      gemini: DEFAULT_PROXY_URLS.gemini,
      openai: DEFAULT_PROXY_URLS.openai,
      deepseek: DEFAULT_PROXY_URLS.deepseek,
      claude: DEFAULT_PROXY_URLS.claude,
    },

    // Per-provider model selection (prevents gpt-* being used under Gemini, etc.)
    selectedModels: {
      gemini: '',
      openai: '',
      deepseek: '',
      claude: '',
    },

    // Legacy (migration only)
    selectedModel: '',

    embeddingProvider: 'auto',

    modelProfiles: {
      primary: {
        model: '',
        maxResponseTokens: 4096,
        contextSizeTokens: 128000,
      },
      secondary: {
        model: '',
        maxResponseTokens: 2048,
        contextSizeTokens: 32000,
      },
    },

    databasePath: path.join(app.getPath('userData'), 'My_AI_Data'),

    tools: {
      googleSearch: {
        enabled: false,
        provider: 'vertex-ai',
        apiKey: '',
        searchEngineId: '',
        projectId: '',
      },
      database: {
        enabled: true,
      },
      appControl: {
        enabled: false,
      },
      fileManagement: {
        enabled: true,
      },
      systemMonitoring: {
        enabled: false,
      },
    },

    stt: {
      enabled: false,
      provider: 'openai',
      openaiApiKey: '',
      language: 'auto',
      prompt: 'Audio language is either English or Romanian.',
    },


    userPersona: {
      name: 'AI Assistant',
      description: 'You are a helpful AI assistant.',
      userInfo: '',
      avatarImagePath: undefined,
    },

    thesisInfo: {
      student: '',
      coordinator: '',
    },

    ngrok: {
      enabled: false,
      port: 3000,
      useSdk: true, // Default to SDK implementation
    },

    whatsapp: {
      activeMethod: undefined,
      businessCloud: {
        apiToken: '',
        phoneNumberId: '',
        businessAccountId: '',
        webhookToken: '',
      },
      twilio: {
        accountSid: '',
        authToken: '',
        whatsappNumber: '',
        webhookUrl: '',
      },
      webhook: {
        publicUrl: '',
        provider: 'cloudflare',
      },
      allowedNumbers: [],
      replyToUnauthorized: false,
    },
  },
});

export function getConfig(): Config {
  // Normalize for backward compatibility (older configs won't have the new proxy fields)
  const cfg: any = store.store || {};

  const legacySelectedModel: string = cfg.selectedModel || '';

  // Best-effort migration:
  // - If selectedModels is missing, try to place legacy selectedModel into the matching provider slot.
  // - If we can't infer, leave empty (UI will prompt to select a valid model for that provider).
  const inferredGeminiModel =
    typeof legacySelectedModel === 'string' && legacySelectedModel.startsWith('gemini-') ? legacySelectedModel : '';
  const inferredOpenAIModel = resolveProviderModel('openai', legacySelectedModel) === legacySelectedModel ? legacySelectedModel : '';
  const inferredDeepSeekModel = resolveProviderModel('deepseek', legacySelectedModel) === legacySelectedModel ? legacySelectedModel : '';
  const inferredClaudeModel = resolveProviderModel('claude', legacySelectedModel) === legacySelectedModel ? legacySelectedModel : '';
  const activeProvider: AIProvider =
    cfg.aiProvider === 'openai' || cfg.aiProvider === 'deepseek' || cfg.aiProvider === 'claude'
      ? cfg.aiProvider
      : 'gemini' as AIProvider;
  const selectedModels = {
    gemini: resolveProviderModel('gemini', cfg.selectedModels?.gemini, inferredGeminiModel),
    openai: resolveProviderModel('openai', cfg.selectedModels?.openai, inferredOpenAIModel),
    deepseek: resolveProviderModel('deepseek', cfg.selectedModels?.deepseek, inferredDeepSeekModel),
    claude: resolveProviderModel('claude', cfg.selectedModels?.claude, inferredClaudeModel),
  };
  const activePrimaryModel = selectedModels[activeProvider];
  const normalizePositiveInt = (value: unknown, fallback: number) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  const modelProfiles = {
    primary: {
      model: resolveProviderModel(activeProvider, cfg.modelProfiles?.primary?.model, activePrimaryModel),
      maxResponseTokens: normalizePositiveInt(cfg.modelProfiles?.primary?.maxResponseTokens, 4096),
      contextSizeTokens: normalizePositiveInt(cfg.modelProfiles?.primary?.contextSizeTokens, 128000),
    },
    secondary: {
      model: resolveProviderModel(activeProvider, cfg.modelProfiles?.secondary?.model, cfg.modelProfiles?.primary?.model, activePrimaryModel),
      maxResponseTokens: normalizePositiveInt(cfg.modelProfiles?.secondary?.maxResponseTokens, 2048),
      contextSizeTokens: normalizePositiveInt(cfg.modelProfiles?.secondary?.contextSizeTokens, 32000),
    },
  };

  const rawWhatsapp = cfg.whatsapp || {};
  const activeMethod =
    rawWhatsapp.activeMethod === 'business-cloud' || rawWhatsapp.activeMethod === 'twilio'
      ? rawWhatsapp.activeMethod
      : undefined;

  return {
    ...cfg,
    aiProvider: activeProvider,
    connectionMode: cfg.connectionMode || 'direct',
    apiKeys: {
      gemini: cfg.apiKeys?.gemini || '',
      openai: cfg.apiKeys?.openai || '',
      deepseek: cfg.apiKeys?.deepseek || '',
      claude: cfg.apiKeys?.claude || '',
      googleSearch: cfg.apiKeys?.googleSearch || '',
      googleSearchEngineId: cfg.apiKeys?.googleSearchEngineId || '',
    },
    proxyApiKeys: {
      gemini: cfg.proxyApiKeys?.gemini || '',
      openai: cfg.proxyApiKeys?.openai || '',
      deepseek: cfg.proxyApiKeys?.deepseek || '',
      claude: cfg.proxyApiKeys?.claude || '',
    },
    proxyBaseUrls: {
      gemini: cfg.proxyBaseUrls?.gemini || DEFAULT_PROXY_URLS.gemini,
      openai: cfg.proxyBaseUrls?.openai || DEFAULT_PROXY_URLS.openai,
      deepseek: cfg.proxyBaseUrls?.deepseek || DEFAULT_PROXY_URLS.deepseek,
      claude: cfg.proxyBaseUrls?.claude || DEFAULT_PROXY_URLS.claude,
    },

    selectedModels,

    // Keep returning legacy field too (some UI paths still read it; we'll refactor next)
    selectedModel: legacySelectedModel,

    embeddingProvider: cfg.embeddingProvider === 'openai' || cfg.embeddingProvider === 'gemini'
      ? cfg.embeddingProvider
      : 'auto',

    modelProfiles,

    databasePath: cfg.databasePath || path.join(app.getPath('userData'), 'My_AI_Data'),

    tools: {
      googleSearch: {
        enabled: cfg.tools?.googleSearch?.enabled ?? !!(cfg.apiKeys?.googleSearch && cfg.apiKeys?.googleSearchEngineId),
        provider: 'vertex-ai',
        apiKey: cfg.tools?.googleSearch?.apiKey || cfg.apiKeys?.googleSearch || '',
        searchEngineId: cfg.tools?.googleSearch?.searchEngineId || cfg.apiKeys?.googleSearchEngineId || '',
        projectId: cfg.tools?.googleSearch?.projectId || '',
      },
      database: {
        enabled: cfg.tools?.database?.enabled ?? true,
      },
      appControl: {
        enabled: cfg.tools?.appControl?.enabled ?? false,
      },
      fileManagement: {
        enabled: cfg.tools?.fileManagement?.enabled ?? true,
      },
      systemMonitoring: {
        enabled: cfg.tools?.systemMonitoring?.enabled ?? false,
      },
    },

    stt: {
      enabled: typeof cfg.stt?.enabled === 'boolean' ? cfg.stt.enabled : false,
      provider: cfg.stt?.provider || 'openai',
      openaiApiKey: cfg.stt?.openaiApiKey || '',
      language: (cfg.stt?.language === 'en' || cfg.stt?.language === 'ro' || cfg.stt?.language === 'auto') ? cfg.stt.language : 'auto',
      prompt: typeof cfg.stt?.prompt === 'string' ? cfg.stt.prompt : 'Audio language is either English or Romanian.',
    },


    userPersona: {
      name: cfg.userPersona?.name || 'AI Assistant',
      description: cfg.userPersona?.description || 'You are a helpful AI assistant.',
      userInfo: cfg.userPersona?.userInfo || '',
      avatarImagePath: cfg.userPersona?.avatarImagePath,
    },

    thesisInfo: {
      student: typeof cfg.thesisInfo?.student === 'string' ? cfg.thesisInfo.student : '',
      coordinator: typeof cfg.thesisInfo?.coordinator === 'string' ? cfg.thesisInfo.coordinator : '',
    },

    ngrok: {
      authToken: cfg.ngrok?.authToken,
      enabled: typeof cfg.ngrok?.enabled === 'boolean' ? cfg.ngrok.enabled : false,
      port: cfg.ngrok?.port || 3000,
      // Feature flag: can be overridden by environment variable NGROK_USE_SDK
      useSdk: process.env.NGROK_USE_SDK 
        ? process.env.NGROK_USE_SDK === 'true' 
        : (typeof cfg.ngrok?.useSdk === 'boolean' ? cfg.ngrok.useSdk : true),
    },

    whatsapp: {
      activeMethod,
      businessCloud: {
        apiToken: rawWhatsapp.businessCloud?.apiToken || '',
        phoneNumberId: rawWhatsapp.businessCloud?.phoneNumberId || '',
        businessAccountId: rawWhatsapp.businessCloud?.businessAccountId || '',
        webhookToken: rawWhatsapp.businessCloud?.webhookToken || '',
      },
      twilio: {
        accountSid: rawWhatsapp.twilio?.accountSid || '',
        authToken: rawWhatsapp.twilio?.authToken || '',
        whatsappNumber: rawWhatsapp.twilio?.whatsappNumber || '',
        webhookUrl: rawWhatsapp.twilio?.webhookUrl || '',
      },
      webhook: {
        publicUrl: rawWhatsapp.webhook?.publicUrl || rawWhatsapp.twilio?.webhookUrl || '',
        provider:
          rawWhatsapp.webhook?.provider === 'ngrok' || rawWhatsapp.webhook?.provider === 'custom'
            ? rawWhatsapp.webhook.provider
            : 'cloudflare',
      },
      allowedNumbers: Array.isArray(rawWhatsapp.allowedNumbers)
        ? rawWhatsapp.allowedNumbers.filter((n: unknown): n is string => typeof n === 'string')
        : [],
      replyToUnauthorized: rawWhatsapp.replyToUnauthorized === true,
    },
  };
}

export function setConfig(updates: Partial<Config>): void {
  store.set(updates);
}

export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  return store.get(key);
}

export function setConfigValue<K extends keyof Config>(key: K, value: Config[K]): void {
  store.set(key, value);
}

export function validatePaths(): { database: boolean } {
  const config = getConfig();

  // Check database path (used for LanceDB + attachments)
  let databaseValid = false;
  try {
    if (!fs.existsSync(config.databasePath)) {
      fs.mkdirSync(config.databasePath, { recursive: true });
    }
    // Test write access
    const testFile = path.join(config.databasePath, '.test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    databaseValid = true;
  } catch {
    databaseValid = false;
  }

  return { database: databaseValid };
}
