import OpenAI from 'openai';
import { Config } from '../../shared/types';

const DEFAULT_EMBEDDING_MODELS = {
  openai: 'text-embedding-3-small',

  /**
   * Direct Google AI supports `text-embedding-004`.
   * The bundled reverse proxy (`ai-reverse-proxy-main`) only exposes the embeddings route:
   *   POST /v1beta/models/gemini-embedding-001:embedContent
   * and validates the embeddings model list to `gemini-embedding-001`.
   *
   * So in proxy mode we MUST use `gemini-embedding-001` or we will get a 404/"Unknown proxy endpoint".
   */
  geminiDirect: 'text-embedding-004',
  geminiProxy: 'gemini-embedding-001',
} as const;

type EmbeddingAuthMode = 'direct' | 'proxy';
export type EmbeddingProvider = 'openai' | 'gemini';
export type EmbeddingModelInfo = {
  provider: EmbeddingProvider;
  model: string;
  mode: EmbeddingAuthMode;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function normalizeOpenAIBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  const trimmed = normalizeBaseUrl(baseUrl);
  // OpenAI SDK expects baseURL like https://host/v1
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export function getGeminiEmbeddingEndpointForTest(config: Config): string {
  const { baseUrl, model } = getGeminiAuth(config);
  return `${baseUrl}/v1beta/models/${model}:embedContent`;
}

function getOpenAIAuth(config: Config): { apiKey: string; baseUrl?: string; model: string; mode: EmbeddingAuthMode } {
  const directKey = config.apiKeys?.openai?.trim();
  if (directKey) {
    return {
      apiKey: directKey,
      baseUrl: undefined,
      model: DEFAULT_EMBEDDING_MODELS.openai,
      mode: 'direct',
    };
  }

  const proxyKey = config.proxyApiKeys?.openai?.trim();
  const proxyBaseUrl = config.proxyBaseUrls?.openai?.trim();

  if (proxyKey && proxyBaseUrl) {
    return {
      apiKey: proxyKey,
      baseUrl: proxyBaseUrl,
      model: DEFAULT_EMBEDDING_MODELS.openai,
      mode: 'proxy',
    };
  }

  throw new Error('OpenAI API key or OpenAI proxy missing (needed for embeddings)');
}

function getGeminiAuth(config: Config): { apiKey: string; baseUrl: string; model: string; mode: EmbeddingAuthMode } {
  const directKey = config.apiKeys?.gemini?.trim();
  if (directKey) {
    return {
      apiKey: directKey,
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: DEFAULT_EMBEDDING_MODELS.geminiDirect,
      mode: 'direct',
    };
  }

  const proxyKey = config.proxyApiKeys?.gemini?.trim();
  const proxyBaseUrl = config.proxyBaseUrls?.gemini?.trim();

  if (proxyKey && proxyBaseUrl) {
    return {
      apiKey: proxyKey,
      baseUrl: normalizeBaseUrl(proxyBaseUrl),
      model: DEFAULT_EMBEDDING_MODELS.geminiProxy,
      mode: 'proxy',
    };
  }

  throw new Error('Gemini API key or Gemini proxy missing (needed for embeddings)');
}

async function embedOpenAI(config: Config, texts: string[]): Promise<number[][]> {
  const { apiKey, baseUrl, model } = getOpenAIAuth(config);

  const client = new OpenAI({
    apiKey,
    baseURL: normalizeOpenAIBaseUrl(baseUrl),
  });

  // OpenAI embeddings supports batching via input: string[]
  const resp = await client.embeddings.create({
    model,
    input: texts,
  });

  // Preserve order: OpenAI returns data in input order
  return resp.data.map((d: any) => d.embedding as number[]);
}

async function embedGeminiOne(config: Config, text: string): Promise<number[]> {
  const { apiKey, baseUrl, model, mode } = getGeminiAuth(config);

  // Gemini embeddings:
  // - Direct Google: POST {baseUrl}/v1beta/models/{model}:embedContent
  // - ai-reverse-proxy: exposes POST {baseUrl}/v1beta/models/gemini-embedding-001:embedContent
  //   with a Google-style payload. The OpenAI-compatible route is not available on all proxies.
  const url = `${baseUrl}/v1beta/models/${model}:embedContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Works for both direct and proxy in your app (you already use this header in proxy mode)
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      content: { parts: [{ text }] },
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Gemini embeddings failed (${res.status}): ${bodyText}`);
  }

  const json: any = await res.json().catch(() => ({}));

  // Direct Google/proxy response: { embedding: { values: number[] } }
  const values = json?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${mode === 'proxy' ? 'Proxy' : 'Gemini'} embeddings response missing embedding.values`);
  }
  return values as number[];
}

function canEmbed(config: Config, provider: EmbeddingProvider): boolean {
  try {
    if (provider === 'openai') {
      // Will throw if missing
      getOpenAIAuth(config);
      return true;
    }
    getGeminiAuth(config);
    return true;
  } catch {
    return false;
  }
}

function getEmbeddingModelInfo(config: Config, provider: EmbeddingProvider): EmbeddingModelInfo {
  if (provider === 'openai') {
    const auth = getOpenAIAuth(config);
    return { provider, model: auth.model, mode: auth.mode };
  }

  const auth = getGeminiAuth(config);
  return { provider, model: auth.model, mode: auth.mode };
}

export async function embedTextsForProvider(
  config: Config,
  provider: EmbeddingProvider,
  texts: string[]
): Promise<number[][]> {
  const clean = texts.map(t => (t || '').toString());

  if (provider === 'openai') {
    return embedOpenAI(config, clean);
  }

  // Gemini: do sequential calls (simple + compatible with proxies)
  const out: number[][] = [];
  for (const t of clean) out.push(await embedGeminiOne(config, t));
  return out;
}

export async function embedTextForProvider(config: Config, provider: EmbeddingProvider, text: string): Promise<number[]> {
  const [vec] = await embedTextsForProvider(config, provider, [text]);
  return vec;
}

export function getAvailableEmbeddingProviders(config: Config): EmbeddingProvider[] {
  const providers: EmbeddingProvider[] = [];
  if (canEmbed(config, 'openai')) providers.push('openai');
  if (canEmbed(config, 'gemini')) providers.push('gemini');
  return providers;
}

export function pickDefaultEmbeddingProvider(config: Config): EmbeddingProvider {
  if (config.embeddingProvider === 'openai' || config.embeddingProvider === 'gemini') {
    if (canEmbed(config, config.embeddingProvider)) return config.embeddingProvider;
    const label = config.embeddingProvider === 'openai' ? 'OpenAI' : 'Gemini';
    throw new Error(`Database memory is configured to use ${label} embeddings, but ${label} credentials are missing. Configure ${label} direct/proxy credentials or switch Memory / Embeddings to Auto.`);
  }

  // Prefer OpenAI for speed/batching, fallback to Gemini.
  if (canEmbed(config, 'openai')) return 'openai';
  if (canEmbed(config, 'gemini')) return 'gemini';
  throw new Error('Database memory needs an embedding provider. DeepSeek and Claude can chat, but they do not provide embeddings here. Configure OpenAI or Gemini credentials for Memory / Embeddings.');
}

export function pickDefaultEmbeddingModelInfo(config: Config): EmbeddingModelInfo {
  return getEmbeddingModelInfo(config, pickDefaultEmbeddingProvider(config));
}

export function getAvailableEmbeddingModelInfos(config: Config): EmbeddingModelInfo[] {
  return getAvailableEmbeddingProviders(config).map((provider) => getEmbeddingModelInfo(config, provider));
}

export async function embedTexts(config: Config, texts: string[]): Promise<number[][]> {
  const provider: EmbeddingProvider = config.aiProvider === 'gemini' ? 'gemini' : pickDefaultEmbeddingProvider(config);
  return embedTextsForProvider(config, provider, texts);
}

export async function embedText(config: Config, text: string): Promise<number[]> {
  const provider: EmbeddingProvider = config.aiProvider === 'gemini' ? 'gemini' : pickDefaultEmbeddingProvider(config);
  return embedTextForProvider(config, provider, text);
}
