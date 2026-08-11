import { FunctionCall, FunctionResult, ToolDefinition } from '../../shared/types';
import { TOOL_CATALOG } from '../../shared/toolCatalog';

const MAX_STRING_ARG_CHARS = 200_000;
const MAX_TOOL_RESULT_CHARS = 80_000;
const MEMORY_ID_PATTERN = /^\d{10,}-[a-f0-9]{8,}$/i;

function invalid(functionCall: FunctionCall, error: string): FunctionResult {
  return {
    name: functionCall.name,
    result: null,
    success: false,
    error,
  };
}

function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_CATALOG.find((tool) => tool.name === name);
}

function validatePrimitive(value: unknown, expectedType: string): boolean {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  return typeof value === expectedType;
}

export function validateFunctionCall(functionCall: FunctionCall): FunctionResult | null {
  const definition = getToolDefinition(functionCall.name);
  if (!definition && functionCall.name !== 'call_subagent') {
    return invalid(functionCall, `Unknown tool "${functionCall.name}".`);
  }

  const args = functionCall.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return invalid(functionCall, `Tool "${functionCall.name}" arguments must be an object.`);
  }

  const parameters = definition?.parameters;
  if (!parameters) return null;

  for (const field of parameters.required || []) {
    if (!(field in args)) {
      return invalid(functionCall, `Tool "${functionCall.name}" is missing required argument "${field}".`);
    }
  }

  for (const [field, schema] of Object.entries(parameters.properties || {})) {
    if (!(field in args)) continue;
    const expectedType = typeof schema?.type === 'string' ? schema.type : undefined;
    if (expectedType && !validatePrimitive(args[field], expectedType)) {
      return invalid(functionCall, `Tool "${functionCall.name}" argument "${field}" must be ${expectedType}.`);
    }
    if (typeof args[field] === 'string' && args[field].length > MAX_STRING_ARG_CHARS) {
      return invalid(functionCall, `Tool "${functionCall.name}" argument "${field}" is too large.`);
    }
  }

  if ((functionCall.name === 'create_file' || functionCall.name === 'read_file' || functionCall.name === 'delete_file') && !String(args.filename || '').trim()) {
    return invalid(functionCall, `Tool "${functionCall.name}" requires a non-empty filename.`);
  }

  if (functionCall.name === 'delete_file' && MEMORY_ID_PATTERN.test(String(args.filename || '').trim())) {
    return invalid(functionCall, 'This looks like a database memory id, not a file path. Use delete_from_database with argument "id" instead.');
  }

  if (functionCall.name === 'start_app' && !String(args.app_name || '').trim()) {
    return invalid(functionCall, 'Tool "start_app" requires a non-empty app_name.');
  }

  if (functionCall.name === 'stop_app' && !String(args.process_name || '').trim()) {
    return invalid(functionCall, 'Tool "stop_app" requires a non-empty process_name.');
  }

  if (functionCall.name === 'delete_from_database' && !String(args.id || '').trim()) {
    return invalid(functionCall, 'Tool "delete_from_database" requires a non-empty id.');
  }

  return null;
}

export function limitToolResultPayload(result: FunctionResult): FunctionResult {
  const json = JSON.stringify(result.result);
  if (!json || json.length <= MAX_TOOL_RESULT_CHARS) return result;

  return {
    ...result,
    result: {
      truncated: true,
      originalLength: json.length,
      preview: json.slice(0, MAX_TOOL_RESULT_CHARS),
    },
  };
}
