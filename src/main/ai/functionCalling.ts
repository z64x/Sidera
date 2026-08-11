import { Config, FunctionCall, FunctionResult, KnowledgeFile, Profile, ToolConfirmationRequest, ToolId } from '../../shared/types';
import { TOOL_CATALOG, getEffectiveToolIds, getEffectiveTools } from '../../shared/toolCatalog';
import { createFile, readFile, deleteFile } from '../functions/fileOps';
import { checkDatabase, addToDatabaseFunction, deleteFromDatabaseFunction } from '../functions/database';
import { checkResources, launchResolvedApp, resolveStartAppTarget, startApp, stopApp } from '../functions/system';
import { getWeather, googleSearch } from '../functions/connectivity';
import { getActiveProfile, getProfile } from '../config/profiles';
import { isAbsoluteFileAccess } from '../functions/pathSafety';
import { deniedToolResult, evaluateToolPolicy } from './toolPolicy';
import { SubagentRuntime, callHiddenSubagent, isCallSubagentTool } from './orchestration';
import { limitToolResultPayload, validateFunctionCall } from './toolValidation';
import { SIDERA_AGENT_ID, SIDERA_AGENT_NAME } from '../../shared/sidera';

export const AVAILABLE_TOOLS = TOOL_CATALOG;
export const MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST = 2;

export function resolveEffectiveTools(config: Config, profileId?: string) {
  if (profileId === SIDERA_AGENT_ID || profileId === 'sidera-super-agent') {
    const ids = new Set(getEffectiveToolIds(config, {
      id: SIDERA_AGENT_ID,
      name: SIDERA_AGENT_NAME,
      description: '',
      instructions: '',
      defaultTool: TOOL_CATALOG.map((tool) => tool.id),
      knowledgeFiles: [],
      createdAt: 0,
      updatedAt: 0,
    } as Profile));
    return TOOL_CATALOG.filter((tool) => ids.has(tool.id));
  }
  const profile = profileId ? getProfile(profileId) : getActiveProfile();
  return getEffectiveTools(config, profile as Profile | null);
}

export function resolveEffectiveToolIds(config: Config, profileId?: string): ToolId[] {
  if (profileId === SIDERA_AGENT_ID || profileId === 'sidera-super-agent') {
    return resolveEffectiveTools(config, profileId).map((tool) => tool.id);
  }
  const profile = profileId ? getProfile(profileId) : getActiveProfile();
  return getEffectiveToolIds(config, profile as Profile | null);
}

export function buildSystemPrompt(config: Config, profileId?: string): string {
  const { userPersona } = config;
  const isSideraSuperAgent = profileId === SIDERA_AGENT_ID || profileId === 'sidera-super-agent';
  let profile = null;
  
  if (isSideraSuperAgent) {
    profile = null;
  } else if (profileId) {
    profile = getProfile(profileId);
  } else {
    profile = getActiveProfile();
  }
  
  const now = new Date();
  const dateTimeString = now.toLocaleString('ro-RO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // IMPORTANT:
  // - If a Profile is active, it defines the assistant identity (name + instructions).
  // - The legacy `config.userPersona` (Ion/old personalization) should NOT override a profile.
  // - Sidera is not a regular profile and must never inherit the human user's name.
  const assistantName = isSideraSuperAgent
    ? SIDERA_AGENT_NAME
    : profile
      ? profile.name
      : (userPersona?.name || 'AI Assistant');

  // If a profile is active, never fall back to legacy `userPersona` text (Ion).
  // Use the profile's description when present; otherwise use a neutral default.
  const assistantDescription = isSideraSuperAgent
    ? 'You are a supervisor AI assistant that coordinates tools and hidden specialist subagents for the user.'
    : profile
      ? (profile.description && profile.description.trim().length > 0
          ? profile.description
          : 'You are a helpful AI assistant.')
      : (userPersona?.description || 'You are a helpful AI assistant.');

  // Parse user context written by SettingsPage in a stable format:
  //   Nume: <...>
  //   Descriere: <...>
  const rawUserInfo = (userPersona?.userInfo || '').trim();
  const userNameMatch = rawUserInfo.match(/(?:^|\n)\s*Nume\s*:\s*(.*)\s*(?:\n|$)/i);
  const userDescMatch = rawUserInfo.match(/(?:^|\n)\s*Descriere\s*:\s*([\s\S]*)$/i);
  const userName = (userPersona?.name || userNameMatch?.[1] || '').trim();
  const userDescription = (
    userPersona?.description ||
    userDescMatch?.[1] ||
    (userNameMatch ? '' : rawUserInfo)
  ).trim();

  // Profile-specific instructions (only when a profile exists)
  let profileInstructions = '';
  if (profile) {
    profileInstructions = `

PROFIL ACTIV: ${profile.name}
${profile.description ? `Descriere: ${profile.description}` : ''}
${profile.instructions ? `\n\nINSTRUCȚIUNI SPECIFICE PROFILULUI:\n${profile.instructions}` : ''}
${profile.knowledgeFiles.length > 0 ? `\n\nFișiere de cunoștințe disponibile (${profile.knowledgeFiles.length}): ${profile.knowledgeFiles.map((f: KnowledgeFile) => f.name).join(', ')}` : ''}
`;
  }

  return `You are ${assistantName}. ${assistantDescription}${profileInstructions}

DATA ȘI ORA CURENTĂ: ${dateTimeString}

INSTRUCȚIUNI IMPORTANTE:
1. Răspunsurile tale trebuie să fie **DETALIATE** și să conțină informații utile. Nu oferi răspunsuri scurte sau superficiale.
2. Când cauți informații sensibile la timp (ex: vreme, știri, program):
   - Include ORA și DATA curentă în query-ul de căutare pentru rezultate mai precise (ex: "vremea București ora 15:00 9 ianuarie").
   - Analizează cu atenție rezultatele căutării pentru a extrage informația cea mai recentă și relevantă pentru momentul actual.
3. Vorbește în **ROMÂNĂ** (sau în limba în care ți se adresează utilizatorul), dar asigură-te că ești explicit și cuprinzător.

USER CONTEXT (about the user):
${userName ? `- User name: ${userName}` : '- User name: (unknown)'}
${userDescription ? `- User description: ${userDescription}` : '- User description: (none)'}

IMPORTANT:
- If the user asks “Cum mă cheamă?” you MUST answer using the user name above (if known).
- Do not claim you don't know the user's name if it is provided above.
- USER CONTEXT describes the human user only. Do not claim to be the user. If the user name is "Luis", Luis is the human user, not the assistant.

You have access to tools that allow you to:
- Manage files on the user's system (create, read, delete)
- Search, store, and delete specific entries in a vector database (LanceDB) for long-term memory
- Check system resources (CPU, RAM)
- Control applications (start, stop)
- Get current weather and short forecasts with \`get_weather\`
- Search the web for current information

For current weather or forecasts, use \`get_weather\` first with the requested location. Do not use \`google_search\` for live weather unless the user explicitly asks for weather articles, warnings, or web pages.

For news and recent events, use short, natural, precise \`google_search\` queries. Do not add the current time/date to the query unless the user asks about an exact date. For international topics, use the official English terms, for example "White House latest news" or "White House incident". If results are weak, old, or irrelevant, say that clearly and do not speculate. Use at most ${MAX_GOOGLE_SEARCH_CALLS_PER_REQUEST} web searches per answer; after that, answer from the best available results or explain that the available results are insufficient.

When the user asks you to perform an action, you MUST use the appropriate tool by calling the function, not just describe what you would do.

SPECIFICALLY FOR FILES / SISTEM DE FIȘIERE:
- If the user asks you to create a file (e.g. "creează un fișier Cozonac.txt pe desktop și scrie în el..."), you MUST call the \`create_file\` tool with:
  - \`filename\`: a clear relative or absolute path (for Desktop you can use something like "Desktop\\\\Cozonac.txt" so the app resolves it correctly)
  - \`content\`: exactly the content that should be written into the file.
- If the user asks you to read a file (e.g. "spune-mi ce scrie în fișierul ăsta"), you MUST call the \`read_file\` tool with the correct \`filename\`.
- Do NOT invent that you have created or read a file if you did not actually call these tools.

SPECIFICALLY FOR DATABASE MEMORY:
- If the user asks you to delete something from memory/database, first use \`check_database\` to find the relevant entry and its \`id\`, unless the user already provided a specific database id.
- Then call \`delete_from_database\` with that exact \`id\`. Do not guess ids and do not delete knowledge-file chunks with this tool.

PENTRU TOATE TOOL-URILE:
- Înainte să chemi un tool, explică foarte pe scurt ce urmează să faci (1-2 propoziții).
- După ce primești rezultatul de la tool, explică utilizatorului ce s-a întâmplat și ce rezultate ai obținut, cu căi de fișiere exacte și rezumate scurte ale conținutului, dacă este cazul.

When you call tools, stream **step-by-step updates** so the user can see what is happening in real time. For example:
- "Creating file 'Cozonac.txt' in the Documents directory..."
- "File created successfully at C:\\Users\\User\\Cozonac.txt. Here is what it contains: ..."
Do NOT wait until everything is finished to explain; narrate the progress while tools are running using short, clear sentences.

Be concise but thorough. If you need to use multiple tools, do so sequentially and explain each step.`;
}

export async function executeFunction(
  functionCall: FunctionCall,
  context?: { profileId?: string; allowedToolIds?: ToolId[]; subagentRuntime?: SubagentRuntime; approved?: boolean }
): Promise<FunctionResult> {
  const { name, arguments: args } = functionCall;
  const validationError = validateFunctionCall(functionCall);
  if (validationError) return validationError;

  try {
    if (context?.allowedToolIds && !context.allowedToolIds.includes(name as ToolId)) {
      return {
        name,
        result: null,
        success: false,
        error: `Tool "${name}" is not enabled for this profile or global settings.`,
      };
    }

    let result: any;
    const fileOptions = { allowAbsolutePath: context?.approved === true && isAbsoluteFileAccess(args.filename) };

    switch (name) {
      case 'call_subagent': {
        if (!context?.subagentRuntime) {
          return {
            name,
            result: null,
            success: false,
            error: 'Subagent orchestration is not available in this context.',
          };
        }
        return callHiddenSubagent(args, context.subagentRuntime);
      }
      case 'create_file':
        result = await createFile(args.filename, args.content, fileOptions);
        break;
      case 'read_file':
        result = await readFile(args.filename, fileOptions);
        break;
      case 'delete_file':
        result = await deleteFile(args.filename, fileOptions);
        break;
      case 'check_database':
        result = await checkDatabase(args.query, args.profileId ?? context?.profileId);
        break;
      case 'add_to_database':
        result = await addToDatabaseFunction(args.content, args.metadata, args.profileId ?? context?.profileId);
        break;
      case 'delete_from_database':
        result = await deleteFromDatabaseFunction(args.id, args.profileId ?? context?.profileId);
        break;
      case 'check_resources':
        result = await checkResources();
        break;
      case 'start_app':
        result = await startApp(args.app_name);
        break;
      case 'stop_app':
        result = await stopApp(args.process_name);
        break;
      case 'get_weather':
        result = await getWeather(args.location);
        break;
      case 'google_search':
        result = await googleSearch(args.query);
        break;
      default:
        throw new Error(`Unknown function: ${name}`);
    }

    return limitToolResultPayload({
      name,
      result: result.data || result,
      success: result.success !== false,
      error: result.success === false ? result.message : undefined,
    });
  } catch (error: any) {
    return {
      name,
      result: null,
      success: false,
      error: error.message,
    };
  }
}

export async function executeFunctionWithPolicy(
  functionCall: FunctionCall,
  params: {
    allowedToolIds: ToolId[];
    profileId?: string;
    subagentRuntime?: SubagentRuntime;
    channel: 'local' | 'whatsapp';
    approved?: boolean;
    requestConfirmation?: (request: ToolConfirmationRequest) => Promise<boolean>;
  }
): Promise<FunctionResult> {
  const validationError = validateFunctionCall(functionCall);
  if (validationError) return validationError;

  if (isCallSubagentTool(functionCall.name)) {
    if (!params.allowedToolIds.includes('call_subagent')) {
      return deniedToolResult(functionCall, 'Subagent orchestration is only available in Sidera.');
    }
    if (!params.subagentRuntime) {
      return deniedToolResult(functionCall, 'Subagent orchestration runtime is not available.');
    }
    return executeFunction(functionCall, {
      profileId: params.profileId,
      allowedToolIds: params.allowedToolIds,
      subagentRuntime: params.subagentRuntime,
      approved: params.approved,
    });
  }

  if (functionCall.name === 'start_app') {
    if (!params.allowedToolIds.includes('start_app')) {
      return deniedToolResult(functionCall, 'Tool "start_app" is not enabled for this profile or global settings.');
    }

    if (params.approved) {
      const target = functionCall.arguments?.resolvedTarget;
      if (target?.launchTarget) {
        const result = await launchResolvedApp(target);
        return limitToolResultPayload({
          name: functionCall.name,
          result: result.data || result,
          success: result.success !== false,
          error: result.success === false ? result.message : undefined,
        });
      }
      return executeFunction(functionCall, {
        profileId: params.profileId,
        allowedToolIds: params.allowedToolIds,
        subagentRuntime: params.subagentRuntime,
        approved: params.approved,
      });
    }

    const resolution = await resolveStartAppTarget(String(functionCall.arguments?.app_name || ''));
    if (!resolution.success || !resolution.data?.launchTarget) {
      return limitToolResultPayload({
        name: functionCall.name,
        result: resolution.data || resolution,
        success: false,
        error: resolution.message,
      });
    }

    const target = resolution.data;
    const confirmation: ToolConfirmationRequest = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolName: functionCall.name,
      args: {
        ...functionCall.arguments,
        resolvedTarget: target,
      },
      risk: 'launch_app',
      reason: `Pornirea aplicatiei necesita confirmare.\nAplicatie: ${target.displayName}\nTinta: ${target.launchTarget}`,
      channel: params.channel,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    const approved = await params.requestConfirmation?.(confirmation);
    if (!approved) {
      return deniedToolResult(functionCall, `Tool "${functionCall.name}" needs confirmation before it can run.`);
    }

    const launch = await launchResolvedApp(target);
    return limitToolResultPayload({
      name: functionCall.name,
      result: launch.data || launch,
      success: launch.success !== false,
      error: launch.success === false ? launch.message : undefined,
    });
  }

  const decision = await evaluateToolPolicy({
    functionCall,
    allowedToolIds: params.allowedToolIds,
    channel: params.channel,
    approved: params.approved,
  });

  if (!decision.allowed) {
    return deniedToolResult(functionCall, decision.reason);
  }

  if (decision.confirmation) {
    const approved = await params.requestConfirmation?.(decision.confirmation);
    if (!approved) {
      return deniedToolResult(functionCall, `Tool "${functionCall.name}" needs confirmation before it can run.`);
    }
  }

  return executeFunction(functionCall, {
    profileId: params.profileId,
    allowedToolIds: params.allowedToolIds,
    subagentRuntime: params.subagentRuntime,
    approved: params.approved || Boolean(decision.confirmation),
  });
}
