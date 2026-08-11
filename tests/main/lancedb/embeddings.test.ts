import { describe, expect, it } from 'vitest';
import type { Config } from '../../../src/shared/types';
import { getAvailableEmbeddingProviders, getGeminiEmbeddingEndpointForTest, pickDefaultEmbeddingProvider } from '../../../src/main/lancedb/embeddings';

function config(overrides: Partial<Config> = {}): Config {
  return {
    aiProvider: 'deepseek',
    connectionMode: 'proxy',
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
      deepseek: 'deepseek-proxy-key',
      claude: '',
    },
    proxyBaseUrls: {
      gemini: '',
      openai: '',
      deepseek: 'https://proxy.example.com/proxy/deepseek',
      claude: '',
    },
    selectedModels: {
      gemini: '',
      openai: '',
      deepseek: 'deepseek-v4-pro',
      claude: '',
    },
    selectedModel: '',
    modelProfiles: {
      primary: {
        model: 'deepseek-v4-pro',
        maxResponseTokens: 4096,
        contextSizeTokens: 128000,
      },
      secondary: {
        model: 'deepseek-v4-flash',
        maxResponseTokens: 2048,
        contextSizeTokens: 32000,
      },
    },
    databasePath: 'unused',
    userPersona: {
      name: 'Sidera',
      description: '',
      userInfo: '',
    },
    ...overrides,
  };
}

describe('embedding provider selection', () => {
  it('does not treat a DeepSeek chat proxy as an embedding provider', () => {
    const cfg = config();

    expect(getAvailableEmbeddingProviders(cfg)).toEqual([]);
    expect(() => pickDefaultEmbeddingProvider(cfg)).toThrow(/DeepSeek and Claude can chat/);
  });

  it('allows DeepSeek chat with a separate OpenAI embedding proxy', () => {
    const cfg = config({
      proxyApiKeys: {
        gemini: '',
        openai: 'openai-proxy-key',
        deepseek: 'deepseek-proxy-key',
        claude: '',
      },
      proxyBaseUrls: {
        gemini: '',
        openai: 'https://proxy.example.com/proxy/openai',
        deepseek: 'https://proxy.example.com/proxy/deepseek',
        claude: '',
      },
    });

    expect(getAvailableEmbeddingProviders(cfg)).toEqual(['openai']);
    expect(pickDefaultEmbeddingProvider(cfg)).toBe('openai');
  });

  it('allows DeepSeek chat with a separate Gemini embedding proxy', () => {
    const cfg = config({
      proxyApiKeys: {
        gemini: 'gemini-proxy-key',
        openai: '',
        deepseek: 'deepseek-proxy-key',
        claude: '',
      },
      proxyBaseUrls: {
        gemini: 'https://proxy.example.com/proxy/gemini',
        openai: '',
        deepseek: 'https://proxy.example.com/proxy/deepseek',
        claude: '',
      },
    });

    expect(getAvailableEmbeddingProviders(cfg)).toEqual(['gemini']);
    expect(pickDefaultEmbeddingProvider(cfg)).toBe('gemini');
  });

  it('uses the Google-style Gemini embedding endpoint for Gemini proxy embeddings', () => {
    const cfg = config({
      proxyApiKeys: {
        gemini: 'gemini-proxy-key',
        openai: '',
        deepseek: 'deepseek-proxy-key',
        claude: '',
      },
      proxyBaseUrls: {
        gemini: 'https://proxy.example.com/proxy/gemini/',
        openai: '',
        deepseek: 'https://proxy.example.com/proxy/deepseek',
        claude: '',
      },
    });

    expect(getGeminiEmbeddingEndpointForTest(cfg)).toBe(
      'https://proxy.example.com/proxy/gemini/v1beta/models/gemini-embedding-001:embedContent'
    );
  });
});
