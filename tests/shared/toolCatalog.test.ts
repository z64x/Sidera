import { describe, expect, it } from 'vitest';
import { getEffectiveToolIds, normalizeProfileToolIds } from '../../src/shared/toolCatalog';
import { Config, Profile } from '../../src/shared/types';

const baseConfig = {
  apiKeys: {
    gemini: '',
    openai: '',
    googleSearch: 'key',
    googleSearchEngineId: 'cx',
  },
  tools: {
    googleSearch: { enabled: true, projectId: 'project-1' },
    database: { enabled: true },
    appControl: { enabled: false },
    fileManagement: { enabled: true },
    systemMonitoring: { enabled: false },
  },
} as Config;

function profile(defaultTool: string[]): Profile {
  return {
    id: 'profile-1',
    name: 'Test',
    description: '',
    instructions: '',
    defaultTool,
    knowledgeFiles: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('tool catalog permissions', () => {
  it('expands legacy file_operations to real file tools', () => {
    expect(normalizeProfileToolIds(['file_operations'])).toEqual(['create_file', 'read_file', 'delete_file']);
  });

  it('adds delete_from_database for older profiles that selected database tools', () => {
    expect(normalizeProfileToolIds(['check_database'])).toEqual(['check_database', 'delete_from_database']);
    expect(normalizeProfileToolIds(['add_to_database'])).toEqual(['add_to_database', 'delete_from_database']);
  });

  it('includes tools only when selected and globally enabled', () => {
    expect(getEffectiveToolIds(baseConfig, profile(['google_search', 'get_weather', 'check_database', 'delete_from_database', 'start_app'])).sort()).toEqual([
      'check_database',
      'delete_from_database',
      'get_weather',
      'google_search',
    ]);
  });

  it('does not expose globally enabled tools that the profile did not select', () => {
    expect(getEffectiveToolIds(baseConfig, profile(['google_search']))).toEqual(['google_search']);
  });

  it('exposes weather without search credentials when the profile selected it', () => {
    const config = {
      ...baseConfig,
      apiKeys: { ...baseConfig.apiKeys, googleSearch: '', googleSearchEngineId: '' },
    } as Config;

    expect(getEffectiveToolIds(config, profile(['get_weather']))).toEqual(['get_weather']);
  });

  it('removes search when provider keys are missing', () => {
    const config = {
      ...baseConfig,
      apiKeys: { ...baseConfig.apiKeys, googleSearch: '', googleSearchEngineId: '' },
    } as Config;

    expect(getEffectiveToolIds(config, profile(['google_search']))).toEqual([]);
  });
});
