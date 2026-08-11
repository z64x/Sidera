import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\Users\\Test\\AppData\\Roaming\\SideraTest'),
  },
}));

vi.mock('../../../src/main/config/profiles', () => ({
  getActiveProfile: vi.fn(() => null),
  getProfile: vi.fn((id: string) => {
    if (id !== 'regular-profile') return null;
    return {
      id: 'regular-profile',
      name: 'Profil Normal',
      description: 'Regular profile description.',
      instructions: 'Regular profile instructions.',
      defaultTool: [],
      knowledgeFiles: [],
      createdAt: 1,
      updatedAt: 1,
    };
  }),
}));
import { TOOL_CATALOG } from '../../../src/shared/toolCatalog';
import { Config } from '../../../src/shared/types';
import { SIDERA_AGENT_NAME } from '../../../src/shared/sidera';
import { buildSystemPrompt, executeFunctionWithPolicy, resolveEffectiveToolIds } from '../../../src/main/ai/functionCalling';
import { buildSideraSystemPrompt, createToolCallDuplicateGuard, executeSafeSubagentTool, getHiddenSubagent, SAFE_SUBAGENT_TOOL_IDS } from '../../../src/main/ai/orchestration';
import { validateFunctionCall } from '../../../src/main/ai/toolValidation';

const baseConfig: Config = {
  aiProvider: 'gemini',
  connectionMode: 'direct',
  apiKeys: {
    gemini: '',
    openai: '',
  },
  proxyApiKeys: {
    gemini: '',
    openai: '',
  },
  proxyBaseUrls: {
    gemini: '',
    openai: '',
  },
  selectedModels: {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o',
  },
  selectedModel: 'gemini-2.5-flash',
  modelProfiles: {
    primary: {
      model: 'gemini-2.5-flash',
      maxResponseTokens: 4096,
      contextSizeTokens: 128000,
    },
    secondary: {
      model: 'gemini-2.5-flash',
      maxResponseTokens: 2048,
      contextSizeTokens: 64000,
    },
  },
  databasePath: 'C:\\SideraTest\\database',
  tools: {},
  userPersona: {
    name: 'Luis',
    description: 'Student at UCV who likes pizza.',
    userInfo: 'Nume: Luis\nDescriere: Student la UCV',
  },
  whatsapp: {
    allowedNumbers: [],
  },
};

describe('Sidera orchestration', () => {
  it('keeps call_subagent out of the public tool catalog', () => {
    expect(TOOL_CATALOG.some((tool) => tool.id === 'call_subagent')).toBe(false);
  });

  it('defines the expected hidden built-in subagents', () => {
    expect(getHiddenSubagent('planner')?.name).toBe('Planner');
    expect(getHiddenSubagent('code_specialist')?.name).toBe('Code Specialist');
    expect(getHiddenSubagent('reviewer')?.name).toBe('Reviewer');
  });

  it('keeps Sidera identity separate from the human user persona', () => {
    const prompt = buildSideraSystemPrompt(buildSystemPrompt(baseConfig, 'sidera-super-agent'));

    expect(prompt).toContain(`You are ${SIDERA_AGENT_NAME}`);
    expect(prompt).not.toContain('You are Luis');
    expect(prompt).toContain('- User name: Luis');
    expect(prompt).toContain('Luis is the human user, not the assistant');
  });

  it('still lets a regular profile define the assistant identity', () => {
    const prompt = buildSystemPrompt(baseConfig, 'regular-profile');

    expect(prompt).toContain('You are Profil Normal');
    expect(prompt).toContain('Regular profile instructions.');
    expect(prompt).not.toContain(`You are ${SIDERA_AGENT_NAME}`);
    expect(prompt).toContain('- User name: Luis');
  });

  it('uses the structured user persona name even when legacy userInfo only has the description', () => {
    const prompt = buildSystemPrompt({
      ...baseConfig,
      userPersona: {
        name: 'Luis',
        description: 'Student la UCV, imi place pizza',
        userInfo: 'Student la UCV, imi place pizza',
      },
    }, 'sidera-super-agent');

    expect(prompt).toContain('- User name: Luis');
    expect(prompt).toContain('- User description: Student la UCV, imi place pizza');
    expect(prompt).not.toContain('- User name: (unknown)');
  });

  it('keeps the real Sidera scope on Sidera identity', () => {
    const prompt = buildSystemPrompt(baseConfig, 'sidera');

    expect(prompt).toContain(`You are ${SIDERA_AGENT_NAME}`);
    expect(prompt).not.toContain('You are Luis');
  });

  it('gives Sidera every globally enabled catalog tool', () => {
    const config: Config = {
      ...baseConfig,
      apiKeys: {
        ...baseConfig.apiKeys,
        googleSearch: 'search-key',
        googleSearchEngineId: 'data-store-id',
      },
      tools: {
        fileManagement: { enabled: true },
        database: { enabled: true },
        appControl: { enabled: true },
        systemMonitoring: { enabled: true },
        googleSearch: {
          enabled: true,
          apiKey: 'search-key',
          searchEngineId: 'data-store-id',
          projectId: 'project-id',
        },
      },
    };

    expect(resolveEffectiveToolIds(config, 'sidera').sort()).toEqual(
      TOOL_CATALOG.map((tool) => tool.id).sort()
    );
  });

  it('allows only safe tools for hidden subagents', async () => {
    expect(SAFE_SUBAGENT_TOOL_IDS).toEqual(['read_file', 'check_database', 'google_search', 'check_resources']);

    const result = await executeSafeSubagentTool({
      name: 'create_file',
      arguments: { filename: 'x.txt', content: 'unsafe' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('blocks call_subagent outside the Sidera allowlist', async () => {
    const result = await executeFunctionWithPolicy({
      name: 'call_subagent',
      arguments: { subagentId: 'planner', task: 'Plan this' },
    }, {
      allowedToolIds: ['read_file'],
      channel: 'local',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Sidera');
  });

  it('requires an orchestration runtime even when call_subagent is allowlisted', async () => {
    const result = await executeFunctionWithPolicy({
      name: 'call_subagent',
      arguments: { subagentId: 'planner', task: 'Plan this' },
    }, {
      allowedToolIds: ['call_subagent'],
      channel: 'local',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('runtime');
  });

  it('blocks duplicate create_file calls for the same path in one request', () => {
    const guard = createToolCallDuplicateGuard();
    const first = guard.check({
      name: 'create_file',
      arguments: { filename: 'Desktop\\video optimizer\\backend.py', content: 'one' },
    });
    const duplicate = guard.check({
      name: 'create_file',
      arguments: { filename: 'Desktop/video optimizer/backend.py', content: 'two' },
    });

    expect(first).toBeNull();
    expect(duplicate?.success).toBe(false);
    expect(duplicate?.error).toContain('Duplicate create_file');
  });

  it('blocks duplicate delete actions in one request', () => {
    const guard = createToolCallDuplicateGuard();
    expect(guard.check({
      name: 'delete_from_database',
      arguments: { id: '1777825479491-00e67c35f2751' },
    })).toBeNull();

    const duplicateDatabaseDelete = guard.check({
      name: 'delete_from_database',
      arguments: { id: '1777825479491-00e67c35f2751' },
    });

    expect(duplicateDatabaseDelete?.success).toBe(false);
    expect(duplicateDatabaseDelete?.error).toContain('Duplicate delete_from_database');
  });

  it('rejects database memory ids passed to delete_file', () => {
    const result = validateFunctionCall({
      name: 'delete_file',
      arguments: { filename: '1777825479491-00e67c35f2751' },
    });

    expect(result?.success).toBe(false);
    expect(result?.error).toContain('delete_from_database');
  });

  it('blocks duplicate subagent tasks in one request', () => {
    const guard = createToolCallDuplicateGuard();
    const first = guard.check({
      name: 'call_subagent',
      arguments: { subagentId: 'code_specialist', task: 'Generate backend.py' },
    });
    const duplicate = guard.check({
      name: 'call_subagent',
      arguments: { subagentId: 'code_specialist', task: '  generate   backend.py  ' },
    });

    expect(first).toBeNull();
    expect(duplicate?.success).toBe(false);
    expect(duplicate?.error).toContain('Duplicate call_subagent');
  });

  it('blocks repeated calls to the same subagent even for a different task', () => {
    const guard = createToolCallDuplicateGuard();
    const first = guard.check({
      name: 'call_subagent',
      arguments: { subagentId: 'code_specialist', task: 'Generate backend.py' },
    });
    const repeatedRole = guard.check({
      name: 'call_subagent',
      arguments: { subagentId: 'code_specialist', task: 'Generate frontend.py' },
    });

    expect(first).toBeNull();
    expect(repeatedRole?.success).toBe(false);
    expect(repeatedRole?.error).toContain('Repeated subagent call');
  });
});
