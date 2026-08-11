import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST, buildSystemPrompt, executeFunctionWithPolicy, resolveEffectiveToolIds, resolveEffectiveTools } from './functionCalling';
import { Config, FileAttachment, FunctionCall, FunctionResult, ToolConfirmationRequest, ToolDefinition, ToolId } from '../../shared/types';
import { estimateOpenAIMessagesTokens, estimateTextOutputTokens, logTokenStats } from './tokenStats';
import { logError, logInfo } from '../logging';
import { CALL_SUBAGENT_TOOL, OrchestrationOptions, buildSideraSystemPrompt, createToolCallDuplicateGuard, executeSafeSubagentTool } from './orchestration';
import { trimOpenAIHistoryToBudget } from './contextBudget';
import { getDefaultModelForProvider, getProviderAuth, resolveProviderModel } from './providerUtils';
import { appendKnowledgeContextToText, buildKnowledgeContext } from './knowledgeContext';

let openai: OpenAI | null = null;
const abortControllers = new Set<AbortController>();

const DEFAULT_OPENAI_MODEL = 'gpt-4o';

function isOpenAIChatModel(model?: string): model is string {
  return Boolean(
    model &&
      (model.startsWith('gpt-') ||
        model.startsWith('o1-') ||
        model.startsWith('o3-') ||
        model.startsWith('o4-') ||
        model.startsWith('o5-')),
  );
}

function resolveOpenAIModel(...candidates: Array<string | undefined>) {
  return candidates.find(isOpenAIChatModel) || DEFAULT_OPENAI_MODEL;
}

const AI_DEBUG_LOGS = process.env.AI_DEBUG_LOGS === '1';

function normalizeOpenAIBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  // Some reverse proxies expose a universal/provider endpoint directly
  // (for example /proxy/ or /proxy/v1/openai). In that case the URL is
  // already the SDK base path and adding another /v1 breaks routing.
  if (/\/proxy(?:\/|$)/i.test(trimmed)) return trimmed;
  // OpenAI SDK expects baseURL like https://host/v1 (it appends /chat/completions, /models, etc.)
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export function initializeOpenAI(apiKey: string, baseUrl?: string) {
  openai = new OpenAI({
    apiKey,
    baseURL: normalizeOpenAIBaseUrl(baseUrl),
  });
}

function createOpenAICompatibleClient(config: Config, provider: 'openai' | 'deepseek'): OpenAI {
  const auth = getProviderAuth(config, provider);
  if (!auth.apiKey) throw new Error(`${provider} API key is not configured`);
  return new OpenAI({
    apiKey: auth.apiKey,
    baseURL: normalizeOpenAIBaseUrl(auth.baseUrl),
  });
}

export async function getOpenAIModels(
  apiKey: string,
  baseUrl?: string
): Promise<Array<{ id: string; name: string; description?: string }>> {
  try {
    const tempClient = new OpenAI({
      apiKey,
      baseURL: normalizeOpenAIBaseUrl(baseUrl),
    });
    const models = await tempClient.models.list();

    // Do NOT filter to only GPT models: OpenAI-compatible proxies may return non-gpt ids
    // (e.g. gemini-*, claude-*, local models, etc.)
    return models.data.map(m => ({
      id: m.id,
      name: m.id,
      description: m.id.includes('gpt-4') || m.id.includes('4') ? 'Most capable' : m.id.includes('3.5') ? 'Fast and efficient' : undefined,
    }));
  } catch {
    // Return common models if API call fails
    return [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable model' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Fast and powerful' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and efficient' },
    ];
  }
}

export async function validateOpenAIKey(apiKey: string, baseUrl?: string): Promise<boolean> {
  try {
    const tempClient = new OpenAI({
      apiKey,
      baseURL: normalizeOpenAIBaseUrl(baseUrl),
    });
    await tempClient.models.list();
    return true;
  } catch {
    return false;
  }
}

async function callOpenAISubagent(
  config: Config,
  model: string,
  params: {
    systemPrompt: string;
    userPrompt: string;
    tools: ToolDefinition[];
    allowedToolIds: ToolId[];
  }
): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI not initialized');
  }

  const tools = params.tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
  let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: params.systemPrompt },
    { role: 'user', content: params.userPrompt },
  ];
  let finalText = '';

  for (let turn = 0; turn < 3; turn += 1) {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools,
      max_tokens: config.modelProfiles?.secondary?.maxResponseTokens,
      stream: false,
    });
    const message = response.choices[0]?.message;
    if (!message) break;

    finalText = typeof message.content === 'string' ? message.content : finalText;
    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) break;

    messages = [...messages, message as OpenAI.Chat.Completions.ChatCompletionMessageParam];

    for (const toolCall of toolCalls) {
      const argsText = toolCall.function?.arguments || '{}';
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(argsText);
      } catch {
        args = {};
      }
      const result = await executeSafeSubagentTool({
        name: toolCall.function.name,
        arguments: args,
      });
      messages = [
        ...messages,
        {
          role: 'tool',
          // @ts-ignore
          tool_call_id: toolCall.id,
          content: JSON.stringify(result.success ? result.result : { error: result.error }),
        } as OpenAI.Chat.Completions.ChatCompletionMessageParam,
      ];
    }
  }

  return finalText || 'Subagentul nu a returnat continut.';
}

export async function sendOpenAIMessage(
  config: Config,
  message: string,
  onChunk: (chunk: string) => void,
  onComplete: (metadata?: { functionCalls?: FunctionCall[]; functionResults?: FunctionResult[] }) => void,
  profileId?: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  attachments?: FileAttachment[],
  onToolUpdate?: (type: 'call' | 'start' | 'update' | 'result', data: any) => void | Promise<void>,
  options?: {
    channel?: 'local' | 'whatsapp';
    requestConfirmation?: (request: ToolConfirmationRequest) => Promise<boolean>;
    orchestration?: OrchestrationOptions;
    provider?: 'openai' | 'deepseek';
  }
): Promise<void> {
  const provider = options?.provider || (config.aiProvider === 'deepseek' ? 'deepseek' : 'openai');
  const client = provider === 'openai' && openai ? openai : createOpenAICompatibleClient(config, provider);
  if (!client) {
    throw new Error('OpenAI not initialized');
  }

  const abortController = new AbortController();
  abortControllers.add(abortController);

  const orchestrationEnabled = Boolean(options?.orchestration?.enabled && (options.orchestration.depth || 0) === 0);
  const systemPrompt = orchestrationEnabled ? buildSideraSystemPrompt(buildSystemPrompt(config, 'sidera-super-agent')) : buildSystemPrompt(config, profileId);
  const primaryModel = provider === 'deepseek'
    ? resolveProviderModel('deepseek', config.modelProfiles?.primary?.model, config.selectedModels?.deepseek, config.selectedModel)
    : resolveOpenAIModel(config.modelProfiles?.primary?.model, config.selectedModels?.openai, config.selectedModel);
  const secondaryModel = provider === 'deepseek'
    ? resolveProviderModel('deepseek', config.modelProfiles?.secondary?.model, primaryModel, getDefaultModelForProvider('deepseek'))
    : resolveOpenAIModel(config.modelProfiles?.secondary?.model, primaryModel);

  // Convert tools to OpenAI format
  const baseEffectiveTools = resolveEffectiveTools(config, profileId);
  const effectiveTools = orchestrationEnabled ? [...baseEffectiveTools, CALL_SUBAGENT_TOOL] : baseEffectiveTools;
  const allowedToolIds = orchestrationEnabled ? [...resolveEffectiveToolIds(config, profileId), 'call_subagent' as ToolId] : resolveEffectiveToolIds(config, profileId);
  const tools = effectiveTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  // Build multimodal user content when attachments are provided.
  // For images, use a data URL in an image_url content part.
  const knowledgeContext = orchestrationEnabled ? '' : await buildKnowledgeContext(config, profileId, message);
  const messageWithKnowledge = appendKnowledgeContextToText(message, knowledgeContext);
  const userParts: any[] = [];
  if (messageWithKnowledge && messageWithKnowledge.trim().length > 0) userParts.push({ type: 'text', text: messageWithKnowledge });

  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      if (att.type === 'image') {
        try {
          const buffer = fs.readFileSync(att.path);
          const ext = path.extname(att.path).toLowerCase();
          const mimeType =
            ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/*';
          const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

          userParts.push({
            type: 'image_url',
            image_url: { url: dataUrl },
          });
        } catch (e) {
          console.warn('[OpenAI] Failed to read image attachment:', e);
          userParts.push({
            type: 'text',
            text: `Note: An image attachment "${att.name}" at path "${att.path}" could not be loaded.`,
          });
        }
      } else if (att.type === 'text') {
        try {
          const textContent = fs.readFileSync(att.path, 'utf-8');
          const snippet = textContent.length > 5000 ? textContent.slice(0, 5000) + '\n...[truncated]...' : textContent;
          userParts.push({
            type: 'text',
            text: `Content of attached text file "${att.name}":\n${snippet}`,
          });
        } catch (e) {
          console.warn('[OpenAI] Failed to read text attachment:', e);
          userParts.push({
            type: 'text',
            text: `Note: A text attachment "${att.name}" at path "${att.path}" could not be read.`,
          });
        }
      } else {
        userParts.push({
          type: 'text',
          text: `Attached ${att.type} file: "${att.name}" at path "${att.path}".`,
        });
      }
    }
  }

  const userContent: any = userParts.length > 0 ? userParts : messageWithKnowledge;

  const trimmedHistory = trimOpenAIHistoryToBudget(config, systemPrompt, conversationHistory, userContent);
  const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory.map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: msg.content,
    })),
    // @ts-ignore - multimodal content parts supported on compatible models
    { role: 'user' as const, content: userContent },
  ];

  const allFunctionCalls: FunctionCall[] = [];
  const allFunctionResults: FunctionResult[] = [];
  let totalEstimatedInputTokens = 0;
  let totalEstimatedOutputTokens = 0;
  let totalProviderRequestMs = 0;
  let totalTimeToFirstEventMs = 0;
  let totalTimeToFirstTextMs = 0;
  let turnsWithFirstEvent = 0;
  let turnsWithFirstText = 0;
  let subagentCallCount = 0;
  let googleSearchCallCount = 0;
  const duplicateGuard = createToolCallDuplicateGuard();

  // Latency instrumentation (helps distinguish proxy/network slowness vs local overhead)
  const overallStartMs = Date.now();
  let overallFirstTextMs: number | null = null;

  const safeJsonParse = (raw: string): Record<string, any> => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      return {};
    }
  };

  try {
    let maxTurns = 5;
    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = baseMessages;

      while (maxTurns > 0) {
      maxTurns--;

      if (AI_DEBUG_LOGS) {
        // Avoid logging raw message content (may include secrets/PII).
        logInfo('OpenAI', 'request_payload', {
          model: primaryModel,
          messages: messages.map((m: any) => ({
            role: m.role,
            contentLength: typeof m.content === 'string' ? m.content.length : null,
            hasToolCalls: !!(m as any).tool_calls,
          })),
        });
      }

      const turnStartMs = Date.now();
      const requestStartMs = Date.now();
      let firstEventMs: number | null = null;
      let firstTextMs: number | null = null;

      let streamedTextChars = 0;
      let sawToolDelta = false;
      const estimatedInputTokensThisTurn = estimateOpenAIMessagesTokens(messages);
      const providerRequestStartMs = Date.now();

      // Collect tool calls exactly as streamed (including ids + raw args text)
      const toolCallsByIndex: Array<{
        id?: string;
        uiId?: string;
        name?: string;
        argsText: string;
        announced?: boolean;
        startedAt?: number;
        countedForLimit?: boolean;
        blockedByLimit?: boolean;
      }> = [];
      let googleSearchCallsQueuedThisTurn = 0;
      let streamedText = '';
      let reasoningContent = '';

      const stream = await client.chat.completions.create(
        {
          model: primaryModel,
          messages,
          tools,
          max_tokens: config.modelProfiles?.primary?.maxResponseTokens,
          stream: true,
        },
        {
          signal: abortController.signal,
        }
      );
      const providerRequestMs = Date.now() - providerRequestStartMs;
      totalProviderRequestMs += providerRequestMs;

      for await (const chunk of stream) {
        if (abortController?.signal.aborted) break;

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        const reasoningDelta = typeof (delta as any).reasoning_content === 'string' ? (delta as any).reasoning_content : '';

        if (!firstEventMs && (delta.content || delta.tool_calls || reasoningDelta)) {
          firstEventMs = Date.now();
        }

        if (delta.content) {
          if (!firstTextMs) {
            firstTextMs = Date.now();
            if (!overallFirstTextMs) overallFirstTextMs = firstTextMs;
          }
          streamedTextChars += delta.content.length;
          streamedText += delta.content;
          onChunk(delta.content);
        }

        if (reasoningDelta) {
          reasoningContent += reasoningDelta;
        }

        if (delta.tool_calls) {
          sawToolDelta = true;
          for (const tc of delta.tool_calls) {
            const index = typeof tc.index === 'number' ? tc.index : 0;
            if (!toolCallsByIndex[index]) toolCallsByIndex[index] = { argsText: '' };
            const pendingToolCall = toolCallsByIndex[index];
            if (tc.id) toolCallsByIndex[index].id = tc.id;
            if (tc.id && !pendingToolCall.uiId) pendingToolCall.uiId = tc.id;
            if (!pendingToolCall.uiId) pendingToolCall.uiId = `openai-turn-${5 - maxTurns}-${index}`;
            if (!pendingToolCall.startedAt) pendingToolCall.startedAt = Date.now();
            if (tc.function?.name) toolCallsByIndex[index].name = tc.function.name;
            if (typeof tc.function?.arguments === 'string') toolCallsByIndex[index].argsText += tc.function.arguments;

            if (pendingToolCall.name === 'google_search' && !pendingToolCall.countedForLimit && !pendingToolCall.blockedByLimit) {
              if (googleSearchCallCount + googleSearchCallsQueuedThisTurn >= MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST) {
                pendingToolCall.blockedByLimit = true;
              } else {
                pendingToolCall.countedForLimit = true;
                googleSearchCallsQueuedThisTurn += 1;
              }
            }

            if (!pendingToolCall.name || pendingToolCall.blockedByLimit) {
              continue;
            }

            if (onToolUpdate && !pendingToolCall.announced) {
              pendingToolCall.announced = true;
              await onToolUpdate('call', {
                id: pendingToolCall.uiId,
                name: pendingToolCall.name,
                arguments: safeJsonParse(pendingToolCall.argsText),
                argumentsText: pendingToolCall.argsText,
                startedAt: pendingToolCall.startedAt,
              });
            } else if (onToolUpdate && pendingToolCall.announced) {
              await onToolUpdate('update', {
                id: pendingToolCall.uiId,
                name: pendingToolCall.name,
                arguments: safeJsonParse(pendingToolCall.argsText),
                argumentsText: pendingToolCall.argsText,
                startedAt: pendingToolCall.startedAt,
              });
            }
          }
        }
      }

      logInfo('OpenAI', 'turn_stream_complete', {
        model: primaryModel,
        msToFirstEvent: firstEventMs ? firstEventMs - requestStartMs : null,
        msToFirstText: firstTextMs ? firstTextMs - requestStartMs : null,
        streamedTextChars,
        hasReasoningContent: reasoningContent.length > 0,
        sawToolDelta,
        turnMs: Date.now() - turnStartMs,
      });

      const estimatedOutputTokensThisTurn = estimateTextOutputTokens('x'.repeat(streamedTextChars));
      totalEstimatedInputTokens += estimatedInputTokensThisTurn;
      totalEstimatedOutputTokens += estimatedOutputTokensThisTurn;
      if (firstEventMs) {
        totalTimeToFirstEventMs += firstEventMs - requestStartMs;
        turnsWithFirstEvent++;
      }
      if (firstTextMs) {
        totalTimeToFirstTextMs += firstTextMs - requestStartMs;
        turnsWithFirstText++;
      }

      logTokenStats({
        provider,
        mode: config.connectionMode || 'direct',
        model: primaryModel,
        phase: 'turn-complete',
        inputTokens: estimatedInputTokensThisTurn,
        outputTokens: estimatedOutputTokensThisTurn,
        totalTokens: estimatedInputTokensThisTurn + estimatedOutputTokensThisTurn,
        durationMs: Date.now() - turnStartMs,
        toolCalls: toolCallsByIndex.filter(tc => tc && tc.name).length,
        extra: {
          providerRequestMs,
          msToFirstEvent: firstEventMs ? firstEventMs - requestStartMs : null,
          msToFirstText: firstTextMs ? firstTextMs - requestStartMs : null,
          streamedTextChars,
          hasReasoningContent: reasoningContent.length > 0,
          sawToolDelta,
        },
      });

      const finalizedToolCalls = toolCallsByIndex.filter(tc => tc && tc.name);

      // No tools requested → we're done
      if (finalizedToolCalls.length === 0) break;

      // Ensure every tool call has a stable id (must match between assistant.tool_calls and tool responses)
      const normalizedCalls = finalizedToolCalls.map((tc, i) => {
        const id = tc.id || `call_turn${5 - maxTurns}_${i}`;
        const uiId = tc.uiId || id;
        return { ...tc, id, uiId };
      });

      // Append the assistant tool_calls message (important for strict OpenAI-compatible servers/proxies)
      const assistantToolCallsMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: 'assistant',
        content: streamedText || null,
        // @ts-ignore - OpenAI types differ across SDK versions but tool_calls is supported
        tool_calls: normalizedCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.argsText && tc.argsText.trim().length > 0 ? tc.argsText : '{}',
          },
        })),
      } as any;
      if (provider === 'deepseek' && reasoningContent.trim().length > 0) {
        (assistantToolCallsMessage as any).reasoning_content = reasoningContent;
      }

      messages = [...messages, assistantToolCallsMessage];

      // Execute tools sequentially and append tool result messages
      for (const tc of normalizedCalls) {
        const fc: FunctionCall = {
          name: tc.name as string,
          arguments: safeJsonParse(tc.argsText),
        };

        const blockedBySearchLimit = fc.name === 'google_search' && tc.blockedByLimit === true;
        if (!blockedBySearchLimit) allFunctionCalls.push(fc);

        let fr: FunctionResult;
        if (blockedBySearchLimit) {
          fr = {
            name: fc.name,
            result: null,
            success: false,
            error: `Maximum web searches reached for this answer (${MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST}). Answer from the results already available or say they are insufficient.`,
          };
        } else {
          const duplicateResult = duplicateGuard.check(fc);
          if (duplicateResult) {
            allFunctionResults.push(duplicateResult);
            const duplicateToolMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
              role: 'tool',
              // @ts-ignore
              tool_call_id: tc.id,
              content: JSON.stringify({ error: duplicateResult.error }),
            } as any;
            messages = [...messages, duplicateToolMessage];
            continue;
          }

          if (onToolUpdate) {
            if (tc.announced) {
              await onToolUpdate('update', { id: tc.uiId, ...fc, argumentsText: tc.argsText });
            } else {
              await onToolUpdate('call', { id: tc.uiId, ...fc, argumentsText: tc.argsText, startedAt: Date.now() });
            }
            await onToolUpdate('start', { id: tc.uiId, ...fc, argumentsText: tc.argsText, startedAt: tc.startedAt || Date.now() });
          }

          const toolStartMs = Date.now();
          if (fc.name === 'call_subagent' && subagentCallCount >= (options?.orchestration?.maxCalls ?? 3)) {
            fr = {
              name: fc.name,
              result: null,
              success: false,
              error: 'Maximum subagent calls reached for this request.',
            };
          } else {
            if (fc.name === 'call_subagent') subagentCallCount += 1;
            if (fc.name === 'google_search') googleSearchCallCount += 1;
            fr = await executeFunctionWithPolicy(fc, {
              profileId,
              allowedToolIds,
              channel: options?.channel || 'local',
              requestConfirmation: options?.requestConfirmation,
              subagentRuntime: orchestrationEnabled
                ? {
                    config,
                    provider,
                    model: secondaryModel,
                    callModel: (params) => callOpenAISubagent(config, secondaryModel, params),
                  }
              : undefined,
            });
          }
          const toolMs = Date.now() - toolStartMs;
          logInfo('OpenAI', 'tool_executed', {
            name: fc.name,
            durationMs: toolMs,
            success: fr.success,
          });
        }

        if (!blockedBySearchLimit) allFunctionResults.push(fr);
        if (onToolUpdate && !blockedBySearchLimit) await onToolUpdate('result', { id: tc.uiId, ...fr });

        const toolMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
          role: 'tool',
          // OpenAI requires the tool_call_id to match assistant.tool_calls[].id
          // @ts-ignore
          tool_call_id: tc.id,
          content: JSON.stringify(fr.success ? fr.result : { error: fr.error }),
        } as any;

        messages = [...messages, toolMessage];
      }

      // Loop continues: model sees tool outputs and can continue (text or more tools)
    }

    logInfo('OpenAI', 'request_complete', {
      model: primaryModel,
      msTotal: Date.now() - overallStartMs,
      msToFirstText: overallFirstTextMs ? overallFirstTextMs - overallStartMs : null,
      toolCalls: allFunctionCalls.map(c => c.name),
    });

    logTokenStats({
      provider,
      mode: config.connectionMode || 'direct',
      model: primaryModel,
      phase: 'request-complete',
      inputTokens: totalEstimatedInputTokens,
      outputTokens: totalEstimatedOutputTokens,
      totalTokens: totalEstimatedInputTokens + totalEstimatedOutputTokens,
      durationMs: Date.now() - overallStartMs,
      toolCalls: allFunctionCalls.length,
      extra: {
        providerRequestMsTotal: totalProviderRequestMs,
        providerRequestMsAvg: totalProviderRequestMs > 0 ? Math.round(totalProviderRequestMs / Math.max(1, 5 - maxTurns)) : null,
        msToFirstEventAvg: turnsWithFirstEvent > 0 ? Math.round(totalTimeToFirstEventMs / turnsWithFirstEvent) : null,
        msToFirstText: overallFirstTextMs ? overallFirstTextMs - overallStartMs : null,
        msToFirstTextAvg: turnsWithFirstText > 0 ? Math.round(totalTimeToFirstTextMs / turnsWithFirstText) : null,
        estimated: true,
      },
    });

    onComplete({
      functionCalls: allFunctionCalls.length > 0 ? allFunctionCalls : undefined,
      functionResults: allFunctionResults.length > 0 ? allFunctionResults : undefined,
    });
  } catch (error: any) {
    logError('OpenAI', 'request_aborted_or_error', {
      model: primaryModel,
      msTotal: Date.now() - overallStartMs,
      msToFirstText: overallFirstTextMs ? overallFirstTextMs - overallStartMs : null,
      error: error?.message || String(error),
    });

    logTokenStats({
      provider,
      mode: config.connectionMode || 'direct',
      model: primaryModel,
      phase: 'request-aborted-or-error',
      inputTokens: totalEstimatedInputTokens,
      outputTokens: totalEstimatedOutputTokens,
      totalTokens: totalEstimatedInputTokens + totalEstimatedOutputTokens,
      durationMs: Date.now() - overallStartMs,
      toolCalls: allFunctionCalls.length,
      extra: {
        error: error?.message || String(error),
        providerRequestMsTotal: totalProviderRequestMs,
        estimated: true,
      },
    });

    if (error.message !== 'Aborted' && !error.message.includes('abort')) {
      throw error;
    }
    onComplete({
      functionCalls: allFunctionCalls.length > 0 ? allFunctionCalls : undefined,
      functionResults: allFunctionResults.length > 0 ? allFunctionResults : undefined,
    });
  } finally {
    abortControllers.delete(abortController);
  }
}

export function stopOpenAIGeneration() {
  for (const controller of abortControllers) controller.abort();
  abortControllers.clear();
}
