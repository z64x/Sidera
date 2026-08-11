import axios from 'axios';
import { MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST, buildSystemPrompt, executeFunctionWithPolicy, resolveEffectiveToolIds, resolveEffectiveTools } from './functionCalling';
import { Config, FileAttachment, FunctionCall, FunctionResult, ToolConfirmationRequest, ToolDefinition, ToolId } from '../../shared/types';
import { CALL_SUBAGENT_TOOL, OrchestrationOptions, buildSideraSystemPrompt, createToolCallDuplicateGuard, executeSafeSubagentTool } from './orchestration';
import { getProviderAuth } from './providerUtils';
import { trimOpenAIHistoryToBudget } from './contextBudget';
import { appendKnowledgeContextToText, buildKnowledgeContext } from './knowledgeContext';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
const abortControllers = new Set<AbortController>();

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

function resolveClaudeModel(config: Config) {
  return config.modelProfiles?.primary?.model || config.selectedModels?.claude || config.selectedModel || DEFAULT_CLAUDE_MODEL;
}

export async function validateClaudeKey(apiKey: string, baseUrl?: string): Promise<boolean> {
  try {
    const response = await axios.post(
      `${(baseUrl || CLAUDE_API_URL).replace(/\/+$/, '')}`,
      {
        model: DEFAULT_CLAUDE_MODEL,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Hi' }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 15000,
      },
    );
    return Boolean(response.data?.content);
  } catch {
    return false;
  }
}

export async function getClaudeModels(): Promise<Array<{ id: string; name: string; description?: string }>> {
  return [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', description: 'Balanced Claude model' },
    { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', description: 'Most capable Claude model' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fast Claude model' },
  ];
}

function toClaudeTools(config: Config, profileId?: string) {
  return resolveEffectiveTools(config, profileId).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function toClaudeToolDefinitions(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function historyToClaudeMessages(history: Array<{ role: 'user' | 'assistant'; content: string }>) {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function textFromContent(content: ClaudeContentBlock[]): string {
  return content.filter((block): block is { type: 'text'; text: string } => block.type === 'text').map((block) => block.text).join('');
}

async function callClaudeSubagent(
  config: Config,
  endpoint: string,
  auth: { apiKey: string },
  model: string,
  params: {
    systemPrompt: string;
    userPrompt: string;
    tools: ToolDefinition[];
    allowedToolIds: ToolId[];
  },
): Promise<string> {
  let messages: any[] = [{ role: 'user', content: params.userPrompt }];
  let finalText = '';

  for (let turn = 0; turn < 3; turn += 1) {
    const response = await axios.post(
      endpoint,
      {
        model,
        system: params.systemPrompt,
        max_tokens: config.modelProfiles?.secondary?.maxResponseTokens || 2048,
        messages,
        tools: toClaudeToolDefinitions(params.tools),
      },
      {
        headers: {
          'x-api-key': auth.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      },
    );

    const content = (response.data?.content || []) as ClaudeContentBlock[];
    const text = textFromContent(content);
    if (text) finalText += text;
    const toolUses = content.filter((block): block is Extract<ClaudeContentBlock, { type: 'tool_use' }> => block.type === 'tool_use');
    if (toolUses.length === 0) break;

    const toolResults: ClaudeContentBlock[] = [];
    for (const toolUse of toolUses) {
      const result = await executeSafeSubagentTool({
        name: toolUse.name,
        arguments: toolUse.input || {},
        providerMetadata: { toolUseId: toolUse.id },
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result.success ? result.result : { error: result.error }),
        is_error: !result.success,
      });
    }
    messages = [...messages, { role: 'assistant', content }, { role: 'user', content: toolResults }];
  }

  return finalText || 'Subagentul nu a returnat continut.';
}

export async function sendClaudeMessage(
  config: Config,
  message: string,
  onChunk: (chunk: string) => void,
  onComplete: (metadata?: { functionCalls?: FunctionCall[]; functionResults?: FunctionResult[] }) => void,
  profileId?: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  _attachments?: FileAttachment[],
  onToolUpdate?: (type: 'call' | 'start' | 'update' | 'result', data: any) => void | Promise<void>,
  options?: {
    channel?: 'local' | 'whatsapp';
    requestConfirmation?: (request: ToolConfirmationRequest) => Promise<boolean>;
    orchestration?: OrchestrationOptions;
  },
): Promise<void> {
  const auth = getProviderAuth(config, 'claude');
  if (!auth.apiKey) throw new Error('Claude API key is not configured');

  const endpoint = (auth.baseUrl || CLAUDE_API_URL).replace(/\/+$/, '');
  const model = resolveClaudeModel(config);
  const orchestrationEnabled = Boolean(options?.orchestration?.enabled && (options.orchestration.depth || 0) === 0);
  const systemPrompt = orchestrationEnabled ? buildSideraSystemPrompt(buildSystemPrompt(config, 'sidera-super-agent')) : buildSystemPrompt(config, profileId);
  const baseTools = resolveEffectiveTools(config, profileId);
  const effectiveTools = orchestrationEnabled ? [...baseTools, CALL_SUBAGENT_TOOL] : baseTools;
  const tools = toClaudeToolDefinitions(effectiveTools);
  const allowedToolIds = orchestrationEnabled ? [...resolveEffectiveToolIds(config, profileId), 'call_subagent' as ToolId] : resolveEffectiveToolIds(config, profileId);
  const subagentModel = config.modelProfiles?.secondary?.model || model;
  const abortController = new AbortController();
  abortControllers.add(abortController);
    const allFunctionCalls: FunctionCall[] = [];
    const allFunctionResults: FunctionResult[] = [];
    const duplicateGuard = createToolCallDuplicateGuard();
    let googleSearchCallCount = 0;

  try {
    const knowledgeContext = orchestrationEnabled ? '' : await buildKnowledgeContext(config, profileId, message);
    const messageWithKnowledge = appendKnowledgeContextToText(message, knowledgeContext);
    const trimmedHistory = trimOpenAIHistoryToBudget(config, systemPrompt, conversationHistory, messageWithKnowledge);
    let messages: any[] = [
      ...historyToClaudeMessages(trimmedHistory),
      { role: 'user', content: messageWithKnowledge },
    ];

    for (let turn = 0; turn < 5; turn += 1) {
      const response = await axios.post(
        endpoint,
        {
          model,
          system: systemPrompt,
          max_tokens: config.modelProfiles?.primary?.maxResponseTokens || 4096,
          messages,
          tools,
        },
        {
          signal: abortController.signal,
          headers: {
            'x-api-key': auth.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
        },
      );

      const content = (response.data?.content || []) as ClaudeContentBlock[];
      const text = textFromContent(content);
      if (text) onChunk(text);
      const toolUses = content.filter((block): block is Extract<ClaudeContentBlock, { type: 'tool_use' }> => block.type === 'tool_use');
      if (toolUses.length === 0) break;

      messages = [...messages, { role: 'assistant', content }];
      const toolResults: ClaudeContentBlock[] = [];
      for (const toolUse of toolUses) {
        const functionCall: FunctionCall = {
          name: toolUse.name,
          arguments: toolUse.input || {},
          providerMetadata: { toolUseId: toolUse.id },
        };
        const blockedBySearchLimit = functionCall.name === 'google_search' && googleSearchCallCount >= MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST;
        if (!blockedBySearchLimit) allFunctionCalls.push(functionCall);

        if (blockedBySearchLimit) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              error: `Maximum web searches reached for this answer (${MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST}). Answer from the results already available or say they are insufficient.`,
            }),
            is_error: true,
          });
          continue;
        }

        const duplicateResult = duplicateGuard.check(functionCall);
        if (duplicateResult) {
          allFunctionResults.push(duplicateResult);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: duplicateResult.error }),
            is_error: true,
          });
          continue;
        }

        await onToolUpdate?.('call', {
          id: toolUse.id,
          ...functionCall,
          argumentsText: JSON.stringify(functionCall.arguments || {}),
          startedAt: Date.now(),
        });
        await onToolUpdate?.('start', {
          id: toolUse.id,
          ...functionCall,
          argumentsText: JSON.stringify(functionCall.arguments || {}),
          startedAt: Date.now(),
        });
        const result = await executeFunctionWithPolicy(functionCall, {
          profileId,
          allowedToolIds,
          channel: options?.channel || 'local',
          requestConfirmation: options?.requestConfirmation,
          subagentRuntime: orchestrationEnabled
            ? {
                config,
                provider: 'claude',
                model: subagentModel,
                callModel: (params) => callClaudeSubagent(config, endpoint, auth, subagentModel, params),
              }
            : undefined,
        });
        if (functionCall.name === 'google_search' && result.success !== false) googleSearchCallCount += 1;
        allFunctionResults.push(result);
        await onToolUpdate?.('result', { id: toolUse.id, ...result });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result.success ? result.result : { error: result.error }),
          is_error: !result.success,
        });
      }
      messages = [...messages, { role: 'user', content: toolResults }];
    }

    onComplete({
      functionCalls: allFunctionCalls.length > 0 ? allFunctionCalls : undefined,
      functionResults: allFunctionResults.length > 0 ? allFunctionResults : undefined,
    });
  } catch (error: any) {
    if (error?.message !== 'canceled' && !String(error?.message || '').includes('abort')) throw error;
    onComplete({
      functionCalls: allFunctionCalls.length > 0 ? allFunctionCalls : undefined,
      functionResults: allFunctionResults.length > 0 ? allFunctionResults : undefined,
    });
  } finally {
    abortControllers.delete(abortController);
  }
}

export function stopClaudeGeneration() {
  for (const controller of abortControllers) controller.abort();
  abortControllers.clear();
}
