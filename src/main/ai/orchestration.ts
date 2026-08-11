import { Config, FunctionCall, FunctionResult, ToolDefinition, ToolId } from '../../shared/types';
import { SIDERA_AGENT_NAME } from '../../shared/sidera';
import { checkDatabase } from '../functions/database';
import { googleSearch } from '../functions/connectivity';
import { readFile } from '../functions/fileOps';
import { checkResources } from '../functions/system';
import { logError, logInfo } from '../logging';
import { TOOL_CATALOG, getGloballyEnabledToolIds } from '../../shared/toolCatalog';

export type HiddenSubagentId = 'planner' | 'code_specialist' | 'reviewer';

export interface HiddenSubagent {
  id: HiddenSubagentId;
  name: string;
  description: string;
  instructions: string;
}

export interface SubagentRuntime {
  config: Config;
  provider: 'gemini' | 'openai' | 'deepseek' | 'claude';
  model: string;
  callModel: (params: {
    systemPrompt: string;
    userPrompt: string;
    tools: ToolDefinition[];
    allowedToolIds: ToolId[];
  }) => Promise<string>;
}

export interface OrchestrationOptions {
  enabled?: boolean;
  depth?: number;
  maxCalls?: number;
}

export interface ToolCallDuplicateGuard {
  check(functionCall: FunctionCall): FunctionResult | null;
}

export const SAFE_SUBAGENT_TOOL_IDS: ToolId[] = ['read_file', 'check_database', 'google_search', 'check_resources'];

export const HIDDEN_SUBAGENTS: HiddenSubagent[] = [
  {
    id: 'planner',
    name: 'Planner',
    description: 'Decomposes requests, chooses strategy, and identifies missing information.',
    instructions:
      `You are Planner, a hidden planning subagent for ${SIDERA_AGENT_NAME}. Break the user request into concrete steps, identify dependencies, risks, and missing information. Do not claim to execute changes. Return practical Romanian or user-language output.`,
  },
  {
    id: 'code_specialist',
    name: 'Code Specialist',
    description: 'Produces technical implementation details, code drafts, and file plans.',
    instructions:
      `You are Code Specialist, a hidden technical subagent for ${SIDERA_AGENT_NAME}. Focus on implementation structure, APIs, files, code snippets, edge cases, and tests. You may inspect safe context with allowed tools, but do not mutate files. Return concise engineering output.`,
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Checks risks, bugs, missing tests, and unclear assumptions.',
    instructions:
      `You are Reviewer, a hidden critical review subagent for ${SIDERA_AGENT_NAME}. Look for likely bugs, unsafe assumptions, missing tests, and scope issues. Be direct and actionable. Do not rewrite the whole answer unless needed.`,
  },
];

export const CALL_SUBAGENT_TOOL: ToolDefinition = {
  id: 'call_subagent',
  name: 'call_subagent',
  label: 'Apel subagent',
  description:
    `Calls a hidden Sidera subagent for a focused task. Use only as ${SIDERA_AGENT_NAME}, then synthesize the result yourself.`,
  category: 'orchestration',
  parameters: {
    type: 'object',
    properties: {
      subagentId: {
        type: 'string',
        enum: HIDDEN_SUBAGENTS.map((subagent) => subagent.id),
        description: 'Hidden subagent to call: planner, code_specialist, or reviewer.',
      },
      task: { type: 'string', description: 'Focused task for the subagent.' },
      context: { type: 'string', description: 'Relevant context to pass to the subagent.' },
      expectedOutput: { type: 'string', description: 'Expected output format or focus.' },
    },
    required: ['subagentId', 'task'],
  },
};

export function isCallSubagentTool(name: string) {
  return name === CALL_SUBAGENT_TOOL.id;
}

export function getHiddenSubagent(id: unknown): HiddenSubagent | null {
  if (typeof id !== 'string') return null;
  return HIDDEN_SUBAGENTS.find((subagent) => subagent.id === id) || null;
}

export function getSafeSubagentTools(allTools: ToolDefinition[]): ToolDefinition[] {
  const allowed = new Set<ToolId>(SAFE_SUBAGENT_TOOL_IDS);
  return allTools.filter((tool) => allowed.has(tool.id));
}

export function getEnabledSafeSubagentToolIds(config: Config): ToolId[] {
  const globallyEnabled = new Set<ToolId>(getGloballyEnabledToolIds(config));
  return SAFE_SUBAGENT_TOOL_IDS.filter((id) => globallyEnabled.has(id));
}

export function getEnabledSafeSubagentTools(config: Config): ToolDefinition[] {
  const enabled = new Set<ToolId>(getEnabledSafeSubagentToolIds(config));
  return TOOL_CATALOG.filter((tool) => enabled.has(tool.id));
}

export function buildSideraSystemPrompt(basePrompt: string) {
  const workers = HIDDEN_SUBAGENTS.map((subagent) => `- ${subagent.id}: ${subagent.name} - ${subagent.description}`).join('\n');

  return `${basePrompt}

SIDERA ORCHESTRATION:
You are ${SIDERA_AGENT_NAME}, a supervisor/orchestrator agent.
You can use hidden subagents through call_subagent when a task benefits from planning, technical drafting, or review.
Available hidden subagents:
${workers}

Rules:
- Keep control of the conversation. Subagents do not talk to the user directly.
- Use call_subagent only for focused subtasks, not for every simple question.
- After receiving subagent results, synthesize the final response yourself.
- For user requests that create or edit files, avoid a separate planner call unless the request is ambiguous. If technical help is useful, call Code Specialist once and ask for all needed files/content in that single task.
- Do not split related files into separate Code Specialist calls. One implementation subagent call should cover the whole requested artifact set.
- Track completed work inside the current request. Do not call a subagent again for the same task, and do not recreate a file path that was already created in this request.
- If a tool result shows the requested file or subtask is already complete, stop delegating and give the user the final result.
- Do not mention hidden implementation details unless useful to the user.
- Do not call more than three subagents for a single user request.`;
}

function normalizeGuardText(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getDuplicateKey(functionCall: FunctionCall): string | null {
  const args = functionCall.arguments || {};

  switch (functionCall.name) {
    case 'create_file': {
      const filename = normalizeGuardText(args.filename);
      return filename ? `create_file:${filename}` : null;
    }
    case 'delete_file': {
      const filename = normalizeGuardText(args.filename);
      return filename ? `delete_file:${filename}` : null;
    }
    case 'delete_from_database': {
      const id = normalizeGuardText(args.id);
      return id ? `delete_from_database:${id}` : null;
    }
    case 'call_subagent': {
      const subagentId = normalizeGuardText(args.subagentId);
      const task = normalizeGuardText(args.task);
      return subagentId && task ? `call_subagent:${subagentId}:${task}` : null;
    }
    default:
      return null;
  }
}

export function createToolCallDuplicateGuard(): ToolCallDuplicateGuard {
  const seen = new Set<string>();
  const seenSubagents = new Set<string>();

  return {
    check(functionCall: FunctionCall): FunctionResult | null {
      const key = getDuplicateKey(functionCall);
      if (!key) return null;

      if (seen.has(key)) {
        return {
          name: functionCall.name,
          result: null,
          success: false,
          error:
            functionCall.name === 'create_file'
              ? 'Duplicate create_file blocked: this file path was already created during the current request. Continue with the next unfinished step or final response.'
              : functionCall.name === 'delete_file'
                ? 'Duplicate delete_file blocked: this file path was already requested for deletion during the current request. Use the existing result instead of asking for confirmation again.'
                : functionCall.name === 'delete_from_database'
                  ? 'Duplicate delete_from_database blocked: this memory id was already requested for deletion during the current request. Use the existing result instead of asking for confirmation again.'
              : 'Duplicate call_subagent blocked: this subagent already handled the same task during the current request. Synthesize the existing result instead of delegating again.',
        };
      }

      if (functionCall.name === 'call_subagent') {
        const subagentId = normalizeGuardText(functionCall.arguments?.subagentId);
        if (subagentId && seenSubagents.has(subagentId)) {
          return {
            name: functionCall.name,
            result: null,
            success: false,
            error:
              'Repeated subagent call blocked: each hidden subagent may be called only once during the current request. Use the previous result, handle the next step yourself, or provide the final response.',
          };
        }
      }

      seen.add(key);
      if (functionCall.name === 'call_subagent') {
        const subagentId = normalizeGuardText(functionCall.arguments?.subagentId);
        if (subagentId) seenSubagents.add(subagentId);
      }
      return null;
    },
  };
}

export function buildSubagentSystemPrompt(subagent: HiddenSubagent) {
  return `${subagent.instructions}

You are running as a hidden worker for ${SIDERA_AGENT_NAME}.
You cannot call other subagents.
You must not mutate files, start apps, stop apps, or write memory.
Use only safe tools if available: read_file, check_database, google_search, check_resources.
Return a compact result with:
Summary:
Content:
Warnings:`;
}

export function buildSubagentUserPrompt(args: Record<string, any>) {
  const task = String(args.task || '').trim();
  const context = String(args.context || '').trim();
  const expectedOutput = String(args.expectedOutput || '').trim();

  return `Task:
${task}

Context:
${context || '(none provided)'}

Expected output:
${expectedOutput || 'A concise, useful specialist result.'}`;
}

function extractWarnings(content: string): string[] {
  const warningsMatch = content.match(/Warnings:\s*([\s\S]*)$/i);
  if (!warningsMatch) return [];
  return warningsMatch[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function extractSummary(content: string): string {
  const summaryMatch = content.match(/Summary:\s*([\s\S]*?)(?:\n\s*Content:|\n\s*Warnings:|$)/i);
  if (summaryMatch?.[1]?.trim()) return summaryMatch[1].trim().slice(0, 600);
  return content.trim().split(/\r?\n/).find((line) => line.trim().length > 0)?.trim().slice(0, 600) || '';
}

export async function executeSafeSubagentTool(functionCall: FunctionCall): Promise<FunctionResult> {
  const { name, arguments: args } = functionCall;
  if (!SAFE_SUBAGENT_TOOL_IDS.includes(name as ToolId)) {
    return {
      name,
      result: null,
      success: false,
      error: `Tool "${name}" is not allowed inside hidden subagents.`,
    };
  }

  try {
    let result: any;
    switch (name) {
      case 'read_file':
        result = await readFile(String(args.filename || ''));
        break;
      case 'check_database':
        result = await checkDatabase(String(args.query || ''), undefined);
        break;
      case 'google_search':
        result = await googleSearch(String(args.query || ''));
        break;
      case 'check_resources':
        result = await checkResources();
        break;
      default:
        throw new Error(`Unsupported safe subagent tool: ${name}`);
    }

    return {
      name,
      result: result.data || result,
      success: result.success !== false,
      error: result.success === false ? result.message : undefined,
    };
  } catch (error: any) {
    return {
      name,
      result: null,
      success: false,
      error: error.message || String(error),
    };
  }
}

export async function callHiddenSubagent(args: Record<string, any>, runtime: SubagentRuntime): Promise<FunctionResult> {
  const subagent = getHiddenSubagent(args.subagentId);
  if (!subagent) {
    return {
      name: CALL_SUBAGENT_TOOL.name,
      result: null,
      success: false,
      error: `Unknown hidden subagent: ${String(args.subagentId || '')}`,
    };
  }

  try {
    logInfo('Orchestration', 'subagent_started', { subagentId: subagent.id, provider: runtime.provider, model: runtime.model });
    const content = await runtime.callModel({
      systemPrompt: buildSubagentSystemPrompt(subagent),
      userPrompt: buildSubagentUserPrompt(args),
      tools: getEnabledSafeSubagentTools(runtime.config),
      allowedToolIds: getEnabledSafeSubagentToolIds(runtime.config),
    });
    const result = {
      subagentId: subagent.id,
      subagentName: subagent.name,
      summary: extractSummary(content),
      content,
      warnings: extractWarnings(content),
    };
    logInfo('Orchestration', 'subagent_completed', { subagentId: subagent.id, contentLength: content.length });
    return {
      name: CALL_SUBAGENT_TOOL.name,
      result,
      success: true,
    };
  } catch (error: any) {
    logError('Orchestration', 'subagent_failed', { subagentId: subagent.id, error: error.message || String(error) });
    return {
      name: CALL_SUBAGENT_TOOL.name,
      result: {
        subagentId: subagent.id,
        subagentName: subagent.name,
        summary: '',
        content: '',
        warnings: [error.message || String(error)],
      },
      success: false,
      error: error.message || String(error),
    };
  }
}
