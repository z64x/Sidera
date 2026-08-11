import { GoogleGenAI, type Content, type Part, type Tool } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import { MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST, buildSystemPrompt, executeFunctionWithPolicy, resolveEffectiveToolIds, resolveEffectiveTools } from './functionCalling';
import { Config, FunctionCall, FunctionResult, FileAttachment, ToolConfirmationRequest, ToolDefinition, ToolId } from '../../shared/types';
import { estimateGeminiContentsTokens, estimateTextOutputTokens, logTokenStats } from './tokenStats';
import { logError, logInfo, logWarn } from '../logging';
import { CALL_SUBAGENT_TOOL, OrchestrationOptions, buildSideraSystemPrompt, createToolCallDuplicateGuard, executeSafeSubagentTool } from './orchestration';
import { trimGeminiContentsToBudget } from './contextBudget';
import { appendKnowledgeContextToText, buildKnowledgeContext } from './knowledgeContext';

let genAI: GoogleGenAI | null = null;
const abortControllers = new Set<AbortController>();

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function isGeminiModel(model?: string): model is string {
  return Boolean(model && model.startsWith('gemini-'));
}

function resolveGeminiModel(...candidates: Array<string | undefined>) {
  return candidates.find(isGeminiModel) || DEFAULT_GEMINI_MODEL;
}

const AI_DEBUG_LOGS = process.env.AI_DEBUG_LOGS === '1';

function createGeminiClient(apiKey: string, baseUrl?: string): GoogleGenAI {
  const trimmedBaseUrl = baseUrl?.trim().replace(/\/+$/, '');
  return new GoogleGenAI({
    apiKey,
    httpOptions: trimmedBaseUrl
      ? {
          baseUrl: trimmedBaseUrl,
          apiVersion: 'v1beta',
        }
      : {
          apiVersion: 'v1beta',
        },
  });
}

function normalizeGeminiBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim().replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com');
}

function toGeminiTools(effectiveTools: ToolDefinition[]): Tool[] {
  if (effectiveTools.length === 0) return [];
  return [
    {
      functionDeclarations: effectiveTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as any,
      })),
    },
  ];
}

function buildGeminiTools(config: Config, profileId?: string, includeOrchestration = false): Tool[] {
  const effectiveTools = resolveEffectiveTools(config, profileId);
  return toGeminiTools(includeOrchestration ? [...effectiveTools, CALL_SUBAGENT_TOOL] : effectiveTools);
}

function toGeminiContents(history: Array<{ role: 'user' | 'model' | 'function'; parts: string | any[] }>): Content[] {
  return history
    .filter(msg => {
      if (typeof msg.parts === 'string') return msg.parts.trim().length > 0;
      return Array.isArray(msg.parts) && msg.parts.length > 0;
    })
    .map(msg => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: Array.isArray(msg.parts) ? msg.parts : [{ text: msg.parts as string }],
    }));
}

function buildGeminiMessageParts(message: string, attachments?: FileAttachment[]): Part[] {
  const parts: Part[] = [];
  if (message && message.trim().length > 0) {
    parts.push({ text: message });
  }

  if (!attachments || attachments.length === 0) return parts;

  for (const att of attachments) {
    if (att.type === 'image') {
      try {
        const buffer = fs.readFileSync(att.path);
        const ext = path.extname(att.path).toLowerCase();
        const mimeType =
          ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/*';

        parts.push({
          inlineData: {
            data: buffer.toString('base64'),
            mimeType,
          },
        });
      } catch (e) {
        console.warn('Failed to read image attachment for Gemini:', e);
        parts.push({
          text: `Note: An image attachment "${att.name}" at path "${att.path}" could not be loaded by the tool.`,
        });
      }
    } else if (att.type === 'text') {
      try {
        const textContent = fs.readFileSync(att.path, 'utf-8');
        const snippet =
          textContent.length > 5000 ? textContent.slice(0, 5000) + '\n...[truncated]...' : textContent;
        parts.push({
          text: `Content of attached text file "${att.name}":\n${snippet}`,
        });
      } catch (e) {
        console.warn('Failed to read text attachment for Gemini:', e);
        parts.push({
          text: `Note: A text attachment "${att.name}" at path "${att.path}" could not be read.`,
        });
      }
    } else {
      parts.push({
        text: `Attached ${att.type} file: "${att.name}" at path "${att.path}".`,
      });
    }
  }

  return parts;
}

function toAppFunctionCalls(calls?: Array<{ name?: string; args?: Record<string, unknown>, id?: string }>): FunctionCall[] {
  if (!calls || calls.length === 0) return [];
  return calls
    .filter(fc => typeof fc.name === 'string' && fc.name.trim().length > 0)
    .map(fc => ({
      name: fc.name as string,
      arguments: (fc.args || {}) as Record<string, any>,
      providerMetadata: fc.id ? { id: fc.id } : undefined,
    }));
}

function buildModelFunctionCallContent(text: string, functionCalls: FunctionCall[], originalContent?: Content): Content | null {
  if (originalContent?.parts?.length) return originalContent;
  const parts: Part[] = [];
  if (text && text.trim().length > 0) parts.push({ text });
  for (const fc of functionCalls) {
    parts.push({
      functionCall: {
        ...(fc.providerMetadata?.id ? { id: fc.providerMetadata.id } : {}),
        name: fc.name,
        args: fc.arguments,
        ...(fc.thoughtSignature ? { thoughtSignature: fc.thoughtSignature } : {}),
      },
    });
  }
  return parts.length > 0 ? { role: 'model', parts } : null;
}

function buildFunctionResponseContent(functionResults: FunctionResult[]): Content {
  return {
    role: 'user',
    parts: functionResults.map(fr => ({
      functionResponse: {
        name: fr.name,
        response: fr.success ? fr.result : { error: fr.error || 'Unknown error' },
      },
    })),
  };
}

async function streamGeminiSdkTurn(params: {
  client: GoogleGenAI;
  model: string;
  contents: Content[];
  systemPrompt: string;
  tools: Tool[];
  mode: 'direct' | 'proxy';
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  onChunk: (chunk: string) => void;
  onFunctionCalls?: (functionCalls: FunctionCall[]) => void | Promise<void>;
}): Promise<{
  text: string;
  functionCalls: FunctionCall[];
  modelContent?: Content;
  providerRequestMs: number;
  providerStreamMs: number;
  msToFirstEvent: number | null;
  msToFirstText: number | null;
}> {
  const { client, model, contents, systemPrompt, tools, mode, maxOutputTokens, abortSignal, onChunk, onFunctionCalls } = params;
  const requestStartMs = Date.now();
  let firstEventMs: number | null = null;
  let firstTextMs: number | null = null;
  let fullText = '';
  let functionCalls: FunctionCall[] = [];
  let modelContent: Content | undefined;
  let announcedFunctionCalls = false;

  if (AI_DEBUG_LOGS) {
    logInfo('Gemini', 'sdk_stream_request', {
      mode,
      model,
      contentsRoles: contents.map(c => c.role),
      contentsLen: contents.length,
      toolsLen: tools.length,
    });
  }

  const stream = await client.models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      tools,
      maxOutputTokens,
      abortSignal,
    },
  });
  const providerRequestMs = Date.now() - requestStartMs;
  const streamStartMs = Date.now();

  for await (const chunk of stream) {
    if (abortSignal?.aborted) break;

    const chunkText = chunk.text || '';
    const chunkCalls = toAppFunctionCalls(chunk.functionCalls);

    if ((chunkText || chunkCalls.length > 0) && !firstEventMs) {
      firstEventMs = Date.now();
    }

    if (chunkText) {
      if (!firstTextMs) firstTextMs = Date.now();
      fullText += chunkText;
      onChunk(chunkText);
    }

    if (chunkCalls.length > 0) {
      functionCalls = chunkCalls;
      const content = chunk.candidates?.[0]?.content as Content | undefined;
      if (content?.parts?.length) modelContent = content;
      if (!announcedFunctionCalls) announcedFunctionCalls = true;
      await onFunctionCalls?.(chunkCalls);
    }
  }

  return {
    text: fullText,
    functionCalls,
    modelContent,
    providerRequestMs,
    providerStreamMs: Date.now() - streamStartMs,
    msToFirstEvent: firstEventMs ? firstEventMs - requestStartMs : null,
    msToFirstText: firstTextMs ? firstTextMs - requestStartMs : null,
  };
}

export function initializeGemini(apiKey: string) {
  genAI = createGeminiClient(apiKey);
}

type GeminiListedModel = {
  name?: string;
  baseModelId?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
};

function toGeminiModelId(model: GeminiListedModel): string {
  const raw = model.name || model.baseModelId || '';
  return raw.replace(/^models\//, '');
}

export async function getGeminiModels(
  apiKey: string,
  baseUrl?: string
): Promise<Array<{ id: string; name: string; description?: string }>> {
  try {
    const endpoint = new URL(`${normalizeGeminiBaseUrl(baseUrl)}/v1beta/models`);
    endpoint.searchParams.set('pageSize', '1000');
    if (!baseUrl) endpoint.searchParams.set('key', apiKey);

    const response = await fetch(endpoint, {
      headers: {
        'x-goog-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Gemini models list failed (${response.status}): ${bodyText}`);
    }

    const body: { models?: GeminiListedModel[] } = await response.json().catch(() => ({}));
    return (body.models || [])
      .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
      .map((model) => {
        const id = toGeminiModelId(model);
        return {
          id,
          name: model.displayName || id,
          description: model.description,
        };
      })
      .filter((model) => Boolean(model.id));
  } catch (error) {
    logWarn('Gemini', 'models_list_failed', { error: (error as any)?.message || String(error) });
    return [];
  }
}

export async function validateGeminiKey(apiKey: string, baseUrl?: string): Promise<boolean> {
  try {
    logInfo('Gemini', 'validation_started');
    const tempAI = createGeminiClient(apiKey, baseUrl);

    // Try reliable models for validation.
    // Some projects don't have free-tier access to 3.x models, so prefer 2.5.
    const modelsToTry = [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',
    ];

    for (const modelName of modelsToTry) {
      try {
        logInfo('Gemini', 'validation_attempt', { model: modelName, mode: baseUrl ? 'proxy' : 'direct' });
        const response = await tempAI.models.generateContent({
          model: modelName,
          contents: 'Hello',
        });
        const text = response.text;
        if (text) {
          logInfo('Gemini', 'validation_success', { model: modelName, mode: baseUrl ? 'proxy' : 'direct' });
          return true;
        }
      } catch (e: any) {
        logWarn('Gemini', 'validation_attempt_failed', { model: modelName, mode: baseUrl ? 'proxy' : 'direct', error: e.message });

        // Check for 429 (Quota Exceeded) or 503 (Service Unavailable).
        // If we get these, the key is likely valid but the service is busy/limited.
        if (e.message && (e.message.includes('429') || e.message.includes('503') || e.message.includes('Quota exceeded'))) {
          logInfo('Gemini', 'validation_success_rate_limited', { model: modelName });
          return true;
        }

        // Continue to next model
      }
    }

    logError('Gemini', 'validation_failed_all_models');
    return false;
  } catch (error: any) {
    logError('Gemini', 'validation_failed', { error: error.message || String(error) });
    return false;
  }
}

async function callGeminiSubagent(
  client: GoogleGenAI,
  model: string,
  mode: 'direct' | 'proxy',
  maxOutputTokens: number | undefined,
  params: {
    systemPrompt: string;
    userPrompt: string;
    tools: ToolDefinition[];
    allowedToolIds: ToolId[];
  }
): Promise<string> {
  const contents: Content[] = [{ role: 'user', parts: [{ text: params.userPrompt }] }];
  const tools = toGeminiTools(params.tools);
  let finalText = '';

  for (let turnIndex = 0; turnIndex < 3; turnIndex += 1) {
    const turn = await streamGeminiSdkTurn({
      client,
      model,
      contents,
      systemPrompt: params.systemPrompt,
      tools,
      mode,
      maxOutputTokens,
      onChunk: (chunk) => {
        finalText += chunk;
      },
    });

    if (turn.functionCalls.length === 0) {
      if (turn.text) finalText = turn.text;
      break;
    }

    const modelContent = buildModelFunctionCallContent(turn.text, turn.functionCalls, turn.modelContent);
    if (modelContent) contents.push(modelContent);

    const results: FunctionResult[] = [];
    for (const functionCall of turn.functionCalls) {
      results.push(await executeSafeSubagentTool(functionCall));
    }
    contents.push(buildFunctionResponseContent(results));
  }

  return finalText || 'Subagentul nu a returnat continut.';
}

export async function startGeminiConversation(
  config: Config,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  conversationHistory: Array<{ role: 'user' | 'model' | 'function'; parts: string | any[] }> = []
): Promise<void> {
  const lastUserMessage = conversationHistory.filter(m => m.role === 'user').pop();
  if (!lastUserMessage) {
    onComplete();
    return;
  }

  await sendGeminiMessage(
    config,
    typeof lastUserMessage.parts === 'string' ? lastUserMessage.parts : '',
    onChunk,
    () => {},
    conversationHistory,
    undefined,
    undefined
  );

  try {
    onComplete();
  } catch (error: any) {
    if (error.message !== 'Aborted') {
      throw error;
    }
  }
}

export async function sendGeminiMessage(
  config: Config,
  message: string,
  onChunk: (chunk: string) => void,
  onComplete: (metadata?: { functionCalls?: FunctionCall[]; functionResults?: FunctionResult[] }) => void,
  conversationHistory: Array<{ role: 'user' | 'model' | 'function'; parts: string | any[] }> = [],
  attachments?: FileAttachment[],
  onToolUpdate?: (type: 'call' | 'start' | 'update' | 'result', data: any) => void | Promise<void>,
  /** Optional profile override (used by WhatsApp default profile routing). */
  profileId?: string,
  options?: {
    channel?: 'local' | 'whatsapp';
    requestConfirmation?: (request: ToolConfirmationRequest) => Promise<boolean>;
    orchestration?: OrchestrationOptions;
  }
): Promise<void> {
  const abortController = new AbortController();
  abortControllers.add(abortController);

  const orchestrationEnabled = Boolean(options?.orchestration?.enabled && (options.orchestration.depth || 0) === 0);
  const systemPrompt = orchestrationEnabled ? buildSideraSystemPrompt(buildSystemPrompt(config, 'sidera-super-agent')) : buildSystemPrompt(config, profileId);
  const mode: 'direct' | 'proxy' = config.connectionMode === 'proxy' ? 'proxy' : 'direct';
  const apiKey = mode === 'proxy' ? config.proxyApiKeys?.gemini : config.apiKeys?.gemini;
  const proxyBaseUrl = mode === 'proxy' ? config.proxyBaseUrls?.gemini : undefined;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(mode === 'proxy' ? 'Gemini proxy not configured (missing proxyApiKey)' : 'Gemini not initialized');
  }

  if (mode === 'proxy' && (!proxyBaseUrl || proxyBaseUrl.trim().length === 0)) {
    throw new Error('Gemini proxy not configured (missing proxyBaseUrl)');
  }

  const client = mode === 'proxy' ? createGeminiClient(apiKey, proxyBaseUrl) : genAI || createGeminiClient(apiKey);
  if (mode === 'direct' && !genAI) genAI = client;

  const tools = buildGeminiTools(config, profileId, orchestrationEnabled);
  const allowedToolIds = orchestrationEnabled ? [...resolveEffectiveToolIds(config, profileId), 'call_subagent' as ToolId] : resolveEffectiveToolIds(config, profileId);
  const model = resolveGeminiModel(config.modelProfiles?.primary?.model, config.selectedModels?.gemini, config.selectedModel);
  const subagentModel = resolveGeminiModel(config.modelProfiles?.secondary?.model, model);
  const knowledgeContext = orchestrationEnabled ? '' : await buildKnowledgeContext(config, profileId, message);
  const messageWithKnowledge = appendKnowledgeContextToText(message, knowledgeContext);
  const userParts = buildGeminiMessageParts(messageWithKnowledge, attachments);
  let contents: Content[] = [
    ...toGeminiContents(conversationHistory),
    { role: 'user', parts: userParts.length > 0 ? userParts : [{ text: messageWithKnowledge }] },
  ];
  contents = trimGeminiContentsToBudget(config, contents, systemPrompt);

  logInfo('Gemini', 'chat_started', { historyLength: conversationHistory.length, mode, model });

  try {
    const requestStartMs = Date.now();
    let providerRequestMsTotal = 0;
    let providerStreamMsTotal = 0;
    let firstEventMsTotal = 0;
    let firstTextMsTotal = 0;
    let turnsWithFirstEvent = 0;
    let turnsWithFirstText = 0;
    let completedTurns = 0;
    let maxTurns = 5;
    let totalEstimatedInputTokens = 0;
    let totalEstimatedOutputTokens = 0;
    let functionCalls: FunctionCall[] = [];
    const allFunctionCalls: FunctionCall[] = [];
    const allFunctionResults: FunctionResult[] = [];
    let subagentCallCount = 0;
    let googleSearchCallCount = 0;
    let streamedGoogleSearchCallsThisTurn = 0;
    const duplicateGuard = createToolCallDuplicateGuard();

    while (maxTurns > 0) {
      maxTurns--;
      const turnNumber = 5 - maxTurns;
      const liveToolIds: string[] = [];
      const liveToolStartedAt: number[] = [];
      const liveToolBlockedByLimit: boolean[] = [];
      streamedGoogleSearchCallsThisTurn = 0;
      const turnStartMs = Date.now();
      const estimatedInputTokensThisTurn = estimateGeminiContentsTokens(contents, systemPrompt);
      const turn = await streamGeminiSdkTurn({
        client,
        model,
        contents,
        systemPrompt,
        tools,
        mode,
        maxOutputTokens: config.modelProfiles?.primary?.maxResponseTokens,
        abortSignal: abortController.signal,
        onChunk,
        onFunctionCalls: async (calls) => {
          if (!onToolUpdate) return;
          await Promise.all(
            calls.map(async (fc, index) => {
              const isNewTool = !liveToolIds[index];
              if (isNewTool) {
                liveToolIds[index] = `gemini-turn-${turnNumber}-${index}-${Date.now()}`;
                liveToolStartedAt[index] = Date.now();
              }
              if (fc.name === 'google_search' && isNewTool) {
                if (googleSearchCallCount + streamedGoogleSearchCallsThisTurn >= MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST) {
                  liveToolBlockedByLimit[index] = true;
                } else {
                  streamedGoogleSearchCallsThisTurn += 1;
                }
              }
              if (liveToolBlockedByLimit[index]) return;
              await onToolUpdate(isNewTool ? 'call' : 'update', {
                id: liveToolIds[index],
                ...fc,
                argumentsText: JSON.stringify(fc.arguments || {}),
                startedAt: liveToolStartedAt[index],
              });
            }),
          );
        },
      });

      functionCalls = turn.functionCalls;
      const estimatedOutputTokensThisTurn = estimateTextOutputTokens(turn.text || '');
      totalEstimatedInputTokens += estimatedInputTokensThisTurn;
      totalEstimatedOutputTokens += estimatedOutputTokensThisTurn;
      providerRequestMsTotal += turn.providerRequestMs;
      providerStreamMsTotal += turn.providerStreamMs;
      completedTurns++;
      if (turn.msToFirstEvent !== null) {
        firstEventMsTotal += turn.msToFirstEvent;
        turnsWithFirstEvent++;
      }
      if (turn.msToFirstText !== null) {
        firstTextMsTotal += turn.msToFirstText;
        turnsWithFirstText++;
      }

      logTokenStats({
        provider: 'gemini',
        mode,
        model,
        phase: 'turn-complete',
        inputTokens: estimatedInputTokensThisTurn,
        outputTokens: estimatedOutputTokensThisTurn,
        totalTokens: estimatedInputTokensThisTurn + estimatedOutputTokensThisTurn,
        durationMs: Date.now() - turnStartMs,
        toolCalls: functionCalls.length,
        extra: {
          providerRequestMs: turn.providerRequestMs,
          providerStreamMs: turn.providerStreamMs,
          msToFirstEvent: turn.msToFirstEvent,
          msToFirstText: turn.msToFirstText,
          estimated: true,
        },
      });

      if (functionCalls.length === 0) break;

      logInfo('Gemini', 'function_calls_received', { names: functionCalls.map(c => c.name), mode });
      const publicFunctionCallsThisTurn = functionCalls.filter((fc, index) => !(fc.name === 'google_search' && liveToolBlockedByLimit[index]));
      allFunctionCalls.push(...publicFunctionCallsThisTurn);

      const modelContent = buildModelFunctionCallContent(turn.text, functionCalls, turn.modelContent);
      if (modelContent) contents.push(modelContent);

      const functionResultsThisTurn: FunctionResult[] = [];
      for (const [index, fc] of functionCalls.entries()) {
        const hadLiveTool = Boolean(liveToolIds[index]);
        const toolUiId = liveToolIds[index] || `gemini-turn-${turnNumber}-${index}-${Date.now()}`;
        let result: FunctionResult;
        const blockedBySearchLimit =
          fc.name === 'google_search' &&
          (liveToolBlockedByLimit[index] === true || googleSearchCallCount >= MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST);
        if (blockedBySearchLimit) {
          result = {
            name: fc.name,
            result: null,
            success: false,
            error: `Maximum web searches reached for this answer (${MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST}). Answer from the results already available or say they are insufficient.`,
          };
          functionResultsThisTurn.push(result);
          continue;
        }
        const duplicateResult = duplicateGuard.check(fc);
        if (duplicateResult) {
          result = duplicateResult;
          functionResultsThisTurn.push(result);
          allFunctionResults.push(result);
          continue;
        }
        if (onToolUpdate && !hadLiveTool) {
          await onToolUpdate('call', { id: toolUiId, ...fc, argumentsText: JSON.stringify(fc.arguments || {}), startedAt: Date.now() });
        } else if (onToolUpdate) {
          await onToolUpdate('update', { id: toolUiId, ...fc, argumentsText: JSON.stringify(fc.arguments || {}), startedAt: liveToolStartedAt[index] });
        }
        if (onToolUpdate) {
          await onToolUpdate('start', { id: toolUiId, ...fc, argumentsText: JSON.stringify(fc.arguments || {}), startedAt: liveToolStartedAt[index] || Date.now() });
        }
        if (fc.name === 'call_subagent' && subagentCallCount >= (options?.orchestration?.maxCalls ?? 3)) {
          result = {
            name: fc.name,
            result: null,
            success: false,
            error: 'Maximum subagent calls reached for this request.',
          };
        } else {
          if (fc.name === 'call_subagent') subagentCallCount += 1;
          if (fc.name === 'google_search') googleSearchCallCount += 1;
          result = await executeFunctionWithPolicy(fc, {
            profileId,
            allowedToolIds,
            channel: options?.channel || 'local',
            requestConfirmation: options?.requestConfirmation,
            subagentRuntime: orchestrationEnabled
              ? {
                  config,
                  provider: 'gemini',
                  model: subagentModel,
                  callModel: (params) => callGeminiSubagent(client, subagentModel, mode, config.modelProfiles?.secondary?.maxResponseTokens, params),
                }
              : undefined,
          });
        }
        if (onToolUpdate) await onToolUpdate('result', { id: toolUiId, ...result });
        functionResultsThisTurn.push(result);
        allFunctionResults.push(result);
      }

      logInfo('Gemini', 'function_responses_sent', {
        names: functionResultsThisTurn.map(fr => fr.name),
        count: functionResultsThisTurn.length,
        mode,
      });

      contents.push(buildFunctionResponseContent(functionResultsThisTurn));
    }

    onComplete({
      functionCalls: allFunctionCalls.length > 0 ? allFunctionCalls : undefined,
      functionResults: allFunctionResults.length > 0 ? allFunctionResults : undefined,
    });

    logTokenStats({
      provider: 'gemini',
      mode,
      model,
      phase: 'request-complete',
      inputTokens: totalEstimatedInputTokens,
      outputTokens: totalEstimatedOutputTokens,
      totalTokens: totalEstimatedInputTokens + totalEstimatedOutputTokens,
      durationMs: Date.now() - requestStartMs,
      toolCalls: allFunctionCalls.length,
      extra: {
        providerRequestMsTotal,
        providerRequestMsAvg: completedTurns > 0 ? Math.round(providerRequestMsTotal / completedTurns) : null,
        providerStreamMsTotal,
        providerStreamMsAvg: completedTurns > 0 ? Math.round(providerStreamMsTotal / completedTurns) : null,
        msToFirstEventAvg: turnsWithFirstEvent > 0 ? Math.round(firstEventMsTotal / turnsWithFirstEvent) : null,
        msToFirstTextAvg: turnsWithFirstText > 0 ? Math.round(firstTextMsTotal / turnsWithFirstText) : null,
        estimated: true,
      },
    });
  } catch (error: any) {
    logTokenStats({
      provider: 'gemini',
      mode,
      model,
      phase: 'request-aborted-or-error',
      extra: {
        error: error?.message || String(error),
      },
    });

    if (error.message !== 'Aborted' && !error.message?.includes?.('abort')) {
      throw error;
    }
    onComplete();
  } finally {
    abortControllers.delete(abortController);
  }
}

export function stopGeminiGeneration() {
  for (const controller of abortControllers) controller.abort();
  abortControllers.clear();
}
