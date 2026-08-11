import { AIProvider, Config } from '../../shared/types';

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  deepseek: 'deepseek-v4-flash',
  claude: 'claude-sonnet-4-5',
};

const DEEPSEEK_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);

export function isModelForProvider(provider: AIProvider, model?: string): model is string {
  if (!model) return false;
  if (provider === 'gemini') return model.startsWith('gemini-');
  if (provider === 'deepseek') return DEEPSEEK_MODELS.has(model);
  if (provider === 'claude') return model.startsWith('claude-');
  return (
    model.startsWith('gpt-') ||
    model.startsWith('o1-') ||
    model.startsWith('o3-') ||
    model.startsWith('o4-') ||
    model.startsWith('o5-')
  );
}

export function getDefaultModelForProvider(provider: AIProvider): string {
  return DEFAULT_MODELS[provider];
}

export function resolveProviderModel(provider: AIProvider, ...candidates: Array<string | undefined>): string {
  return candidates.find((model) => isModelForProvider(provider, model)) || getDefaultModelForProvider(provider);
}

export function getEffectiveModelForProvider(config: Config): string {
  const provider = config.aiProvider;
  return resolveProviderModel(
    provider,
    config.modelProfiles?.primary?.model,
    config.selectedModels?.[provider],
    config.selectedModel,
  );
}

export function withEffectiveProviderModel(config: Config, model = getEffectiveModelForProvider(config)): Config {
  return {
    ...config,
    selectedModel: model,
    selectedModels: {
      ...config.selectedModels,
      [config.aiProvider]: model,
    },
    modelProfiles: {
      ...config.modelProfiles,
      primary: {
        ...config.modelProfiles.primary,
        model,
      },
      secondary: {
        ...config.modelProfiles.secondary,
        model: isModelForProvider(config.aiProvider, config.modelProfiles.secondary?.model)
          ? config.modelProfiles.secondary.model
          : model,
      },
    },
  };
}

export function getProviderAuth(config: Config, provider = config.aiProvider): { apiKey: string; baseUrl?: string } {
  if (config.connectionMode === 'proxy') {
    return {
      apiKey: config.proxyApiKeys?.[provider] || '',
      baseUrl: config.proxyBaseUrls?.[provider] || undefined,
    };
  }

  if (provider === 'deepseek') {
    return {
      apiKey: config.apiKeys?.deepseek || '',
      baseUrl: 'https://api.deepseek.com',
    };
  }

  return {
    apiKey: config.apiKeys?.[provider] || '',
    baseUrl: undefined,
  };
}
