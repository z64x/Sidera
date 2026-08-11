import axios from 'axios';
import { getConfig } from '../config/storage';
import FormData from 'form-data';
import { createSign } from 'crypto';

export interface ConnectivityOperationResult {
  success: boolean;
  message: string;
  data?: any;
}

type GoogleServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

type AgentSearchResult = {
  title: string;
  url: string;
  snippet: string;
  provider: 'agent-search';
  timestamp: string;
  pageText?: string;
  pageFetchError?: string;
};

const SEARCH_RESULT_LIMIT = 10;
const PAGE_FETCH_LIMIT = 3;
const MAX_PAGE_TEXT_CHARS = 6000;
const MAX_PAGE_RESPONSE_BYTES = 750_000;
const PAGE_FETCH_TIMEOUT_MS = 10000;
const WEATHER_FORECAST_DAYS = 2;

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseServiceAccountCredentials(rawCredentials: string): GoogleServiceAccountCredentials | null {
  try {
    const credentials = JSON.parse(rawCredentials) as GoogleServiceAccountCredentials;
    if (!credentials.client_email || !credentials.private_key) return null;

    return {
      ...credentials,
      private_key: credentials.private_key.replace(/\\n/g, '\n'),
      token_uri: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    };
  } catch {
    return null;
  }
}

async function getGoogleAccessToken(rawCredentials: string): Promise<string> {
  const credentials = parseServiceAccountCredentials(rawCredentials);
  if (!credentials?.client_email || !credentials.private_key || !credentials.token_uri) {
    throw new Error('Service Account JSON invalid. Verifica daca ai lipit JSON-ul complet din Google Cloud.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: credentials.token_uri,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsignedJwt = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = base64Url(signer.sign(credentials.private_key));

  const response = await axios.post(
    credentials.token_uri,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedJwt}.${signature}`,
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    }
  );

  if (!response.data?.access_token) {
    throw new Error('Google OAuth did not return an access token.');
  }

  return response.data.access_token;
}

function getSearchServingConfig(projectId: string, dataStoreId: string): string {
  const trimmedDataStoreId = dataStoreId.trim();
  if (trimmedDataStoreId.startsWith('projects/')) {
    return trimmedDataStoreId.includes('/servingConfigs/')
      ? trimmedDataStoreId
      : `${trimmedDataStoreId}/servingConfigs/default_config`;
  }

  return `projects/${projectId.trim()}/locations/global/dataStores/${trimmedDataStoreId}/servingConfigs/default_config`;
}

function readStringField(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const nested = readStringField(...value);
      if (nested) return nested;
    }
  }

  return '';
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = String(entity).toLowerCase();
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return namedEntities[normalized] || match;
  });
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractReadableText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const withBreaks = withoutNoise
    .replace(/<\/(p|div|section|article|header|footer|main|aside|li|h[1-6]|tr|table|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  return normalizeExtractedText(decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ' ')));
}

function getFetchableSearchUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') return null;
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchSearchResultPageText(rawUrl: string): Promise<{ text?: string; error?: string }> {
  const url = getFetchableSearchUrl(rawUrl);
  if (!url) return { error: 'URL is not fetchable.' };

  try {
    const response = await axios.get<string>(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'User-Agent': 'SideraAgentSearch/1.0 (+https://local.sidera.app)',
      },
      maxContentLength: MAX_PAGE_RESPONSE_BYTES,
      responseType: 'text',
      timeout: PAGE_FETCH_TIMEOUT_MS,
      transformResponse: [(data) => data],
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('xml')) {
      return { error: `Unsupported content type: ${contentType}` };
    }

    const html = typeof response.data === 'string' ? response.data : String(response.data || '');
    const text = extractReadableText(html).slice(0, MAX_PAGE_TEXT_CHARS);
    return text ? { text } : { error: 'No readable text found.' };
  } catch (error: any) {
    const status = error.response?.status ? `HTTP ${error.response.status}` : '';
    const message = error.code || error.message || 'Request failed';
    return { error: [status, message].filter(Boolean).join(' ') };
  }
}

async function enrichSearchResultsWithPageText(results: AgentSearchResult[]): Promise<AgentSearchResult[]> {
  const enriched = [...results];
  const fetchTargets = enriched
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => Boolean(result.url))
    .slice(0, PAGE_FETCH_LIMIT);

  await Promise.all(
    fetchTargets.map(async ({ result, index }) => {
      const page = await fetchSearchResultPageText(result.url);
      enriched[index] = {
        ...result,
        ...(page.text ? { pageText: page.text } : {}),
        ...(page.error ? { pageFetchError: page.error } : {}),
      };
    })
  );

  return enriched;
}

function mapVertexSearchResult(result: any): AgentSearchResult {
  const document = result?.document || {};
  const derived = document.derivedStructData || {};
  const structured = document.structData || {};
  const snippets = derived.snippets || structured.snippets || [];
  const extractiveAnswers = derived.extractive_answers || derived.extractiveAnswers || [];

  return {
    title: readStringField(derived.title, structured.title, document.title, document.id, document.name) || 'No title',
    url: readStringField(derived.link, derived.uri, structured.link, structured.uri, structured.url, document.uri),
    snippet:
      readStringField(
        snippets?.[0]?.snippet,
        snippets?.[0]?.text,
        extractiveAnswers?.[0]?.content,
        structured.description,
        structured.snippet,
        document.snippet
      ) || '',
    provider: 'agent-search',
    timestamp: new Date().toISOString(),
  };
}


export async function transcribeAudioWithOpenAI(
  audioBuffer: Buffer,
  apiKey: string,
  mimeType: string = 'audio/webm',
  opts?: { language?: string; prompt?: string }
): Promise<ConnectivityOperationResult> {
  try {
    if (!apiKey) {
      return {
        success: false,
        message: 'OpenAI API key is required for transcription.',
      };
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return {
        success: false,
        message: 'Audio buffer is empty.',
      };
    }

    // OpenAI Whisper API endpoint
    const transcriptionUrl = 'https://api.openai.com/v1/audio/transcriptions';

    // Create FormData for multipart/form-data request
    const formData = new FormData();
    
    // Determine file extension based on mime type
    let filename = 'audio.webm';
    if (mimeType.includes('webm')) {
      filename = 'audio.webm';
    } else if (mimeType.includes('wav')) {
      filename = 'audio.wav';
    } else if (mimeType.includes('mp3')) {
      filename = 'audio.mp3';
    } else if (mimeType.includes('m4a')) {
      filename = 'audio.m4a';
    }
    
    // Add file as blob
    formData.append('file', audioBuffer, {
      filename: filename,
      contentType: mimeType,
    });
    
    // Add model parameter (Whisper only has one model: whisper-1)
    formData.append('model', 'whisper-1');
    
    // Add language (optional, but can help with accuracy)
    // NOTE: Whisper supports a single language code; there is no "en|ro".
    // If you want English+Romanian, keep language unset (auto) and use a prompt hint.
    const language = (opts?.language || '').trim();
    if (language && language !== 'auto') {
      formData.append('language', language);
    }

    // Add prompt hint (optional)
    const prompt = (opts?.prompt || '').trim();
    if (prompt) {
      formData.append('prompt', prompt);
    }

    console.log(
      `[Whisper] Sending audio for transcription: ${audioBuffer.length} bytes, type: ${mimeType}, language: ${language || 'auto'}, prompt: ${prompt ? 'yes' : 'no'}`
    );

    const response = await axios.post(transcriptionUrl, formData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30000, // 30 second timeout
    });

    console.log('[Whisper] Response received:', response.data);

    const transcript = response.data?.text || '';
    
    if (!transcript) {
      console.error('[Whisper] No transcript in response:', response.data);
      return {
        success: false,
        message: 'No transcript returned from OpenAI Whisper API.',
        data: response.data,
      };
    }

    console.log('[Whisper] Transcription successful:', transcript);
    return {
      success: true,
      message: 'Audio transcribed successfully',
      data: { transcript },
    };
  } catch (error: any) {
    console.error('[Whisper] Transcription error:', error.message, error.response?.data);
    return {
      success: false,
      message: `Failed to transcribe audio: ${error.message}${error.response?.data ? ` - ${JSON.stringify(error.response.data)}` : ''}`,
      data: error.response?.data,
    };
  }
}

export async function googleSearch(query: string): Promise<ConnectivityOperationResult> {
  const config = getConfig();
  const searchConfig = config.tools?.googleSearch || {};
  const serviceAccountJson = searchConfig.apiKey || config.apiKeys.googleSearch || '';
  const dataStoreId = searchConfig.searchEngineId || config.apiKeys.googleSearchEngineId || '';
  const projectId = searchConfig.projectId || '';

  if (!serviceAccountJson || !dataStoreId || !projectId) {
    return {
      success: false,
      message:
        'Agent Search is not configured. Add Service Account JSON, Data Store ID, and Project ID before using google_search.',
    };
  }

  try {
    console.log('Attempting Agent Search through Vertex AI Search...');
    const accessToken = await getGoogleAccessToken(serviceAccountJson);
    const servingConfig = getSearchServingConfig(projectId, dataStoreId);
    const searchUrl = `https://discoveryengine.googleapis.com/v1/${servingConfig}:search`;

    const response = await axios.post(
      searchUrl,
      {
        query,
        pageSize: 10,
        safeSearch: true,
        contentSearchSpec: {
          snippetSpec: {
            returnSnippet: true,
          },
          extractiveContentSpec: {
            maxExtractiveAnswerCount: 1,
            maxExtractiveSegmentCount: 1,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
    const items = response.data?.results || [];
    const results = items.slice(0, SEARCH_RESULT_LIMIT).map(mapVertexSearchResult);
    const enrichedResults = await enrichSearchResultsWithPageText(results);

    return {
      success: true,
      message: `Found ${items.length} search results using Agent Search`,
      data: {
        query,
        results: enrichedResults,
      },
    };
  } catch (error: any) {
    const details = error.response?.data?.error?.message || error.response?.data?.message || error.message;
    return {
      success: false,
      message: `Agent Search failed: ${details}`,
    };
  }
}

function formatWeatherTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getWeatherDescription(code?: number): string {
  const descriptions: Record<number, string> = {
    0: 'cer senin',
    1: 'in mare parte senin',
    2: 'partial innorat',
    3: 'innorat',
    45: 'ceata',
    48: 'ceata cu depunere de chiciura',
    51: 'burnita usoara',
    53: 'burnita moderata',
    55: 'burnita densa',
    56: 'burnita inghetata usoara',
    57: 'burnita inghetata densa',
    61: 'ploaie usoara',
    63: 'ploaie moderata',
    65: 'ploaie puternica',
    66: 'ploaie inghetata usoara',
    67: 'ploaie inghetata puternica',
    71: 'ninsoare usoara',
    73: 'ninsoare moderata',
    75: 'ninsoare puternica',
    77: 'granule de zapada',
    80: 'averse usoare',
    81: 'averse moderate',
    82: 'averse violente',
    85: 'averse de ninsoare usoare',
    86: 'averse de ninsoare puternice',
    95: 'furtuna',
    96: 'furtuna cu grindina usoara',
    99: 'furtuna cu grindina puternica',
  };

  return typeof code === 'number' ? descriptions[code] || `cod meteo ${code}` : 'necunoscut';
}

function getDailyWeatherRows(daily: any): any[] {
  const times = Array.isArray(daily?.time) ? daily.time : [];
  return times.map((time: string, index: number) => ({
    date: time,
    weatherCode: daily.weather_code?.[index],
    condition: getWeatherDescription(daily.weather_code?.[index]),
    temperatureMaxC: daily.temperature_2m_max?.[index],
    temperatureMinC: daily.temperature_2m_min?.[index],
    precipitationSumMm: daily.precipitation_sum?.[index],
    rainSumMm: daily.rain_sum?.[index],
    windSpeedMaxKmh: daily.wind_speed_10m_max?.[index],
  }));
}

function removeDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buildWeatherLocationQueries(location: string): string[] {
  const normalized = location.trim();
  const withoutDiacritics = removeDiacritics(normalized);
  const cityOnly = normalized.split(',')[0]?.trim() || normalized;
  const cityOnlyPlain = removeDiacritics(cityOnly);
  const candidates = [
    normalized,
    withoutDiacritics,
    cityOnly,
    cityOnlyPlain,
    `${cityOnly}, Romania`,
    `${cityOnlyPlain}, Romania`,
  ];
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const value = candidate.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findWeatherLocation(location: string): Promise<{ place: any; matchedQuery: string } | null> {
  for (const candidate of buildWeatherLocationQueries(location)) {
    const geocodingResponse = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: {
        name: candidate,
        count: 5,
        language: 'ro',
        format: 'json',
      },
      timeout: 15000,
    });
    const results = Array.isArray(geocodingResponse.data?.results) ? geocodingResponse.data.results : [];
    const romanianPlace = results.find((item: any) => item?.country_code === 'RO');
    const place = romanianPlace || results[0];
    if (place?.latitude && place?.longitude) {
      return { place, matchedQuery: candidate };
    }
  }

  return null;
}

export async function getWeather(location: string): Promise<ConnectivityOperationResult> {
  const query = String(location || '').trim();
  if (!query) {
    return {
      success: false,
      message: 'Location is required for weather.',
    };
  }

  try {
    const locationMatch = await findWeatherLocation(query);
    const place = locationMatch?.place;
    if (!place?.latitude || !place?.longitude) {
      return {
        success: false,
        message: `Nu am gasit coordonate meteo pentru "${query}".`,
      };
    }

    const forecastResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: 'auto',
        forecast_days: WEATHER_FORECAST_DAYS,
        current: [
          'temperature_2m',
          'relative_humidity_2m',
          'apparent_temperature',
          'is_day',
          'precipitation',
          'rain',
          'showers',
          'weather_code',
          'cloud_cover',
          'wind_speed_10m',
          'wind_direction_10m',
          'wind_gusts_10m',
        ].join(','),
        daily: [
          'weather_code',
          'temperature_2m_max',
          'temperature_2m_min',
          'precipitation_sum',
          'rain_sum',
          'wind_speed_10m_max',
        ].join(','),
      },
      timeout: 15000,
    });

    const current = forecastResponse.data?.current || {};
    const weatherCode = current.weather_code;
    const resolvedLocation = [
      place.name,
      place.admin1,
      place.country,
    ].filter(Boolean).join(', ');
    const currentWeather = {
      time: current.time,
      localTime: formatWeatherTime(current.time),
      temperatureC: current.temperature_2m,
      apparentTemperatureC: current.apparent_temperature,
      humidityPercent: current.relative_humidity_2m,
      condition: getWeatherDescription(weatherCode),
      weatherCode,
      precipitationMm: current.precipitation,
      rainMm: current.rain,
      showersMm: current.showers,
      cloudCoverPercent: current.cloud_cover,
      windSpeedKmh: current.wind_speed_10m,
      windDirectionDegrees: current.wind_direction_10m,
      windGustsKmh: current.wind_gusts_10m,
      isDay: current.is_day === 1,
    };

    return {
      success: true,
      message: `Weather loaded for ${resolvedLocation}`,
      data: {
        query,
        matchedQuery: locationMatch?.matchedQuery || query,
        provider: 'open-meteo',
        resolvedLocation,
        coordinates: {
          latitude: place.latitude,
          longitude: place.longitude,
        },
        timezone: forecastResponse.data?.timezone,
        current: currentWeather,
        daily: getDailyWeatherRows(forecastResponse.data?.daily),
      },
    };
  } catch (error: any) {
    const details = error.response?.data?.reason || error.response?.data?.error || error.message;
    return {
      success: false,
      message: `Weather failed: ${details}`,
    };
  }
}
