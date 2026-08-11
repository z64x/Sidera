import { Config, Profile, ToolDefinition, ToolId } from './types';

export const TOOL_CATALOG: ToolDefinition[] = [
  {
    id: 'create_file',
    name: 'create_file',
    label: 'Creare fisier',
    description: 'Creeaza un fisier nou pe sistemul utilizatorului cu continutul specificat',
    category: 'file-management',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The name/path of the file to create' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    id: 'read_file',
    name: 'read_file',
    label: 'Citire fisier',
    description: 'Citeste continutul unui fisier de pe sistemul utilizatorului',
    category: 'file-management',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The name/path of the file to read' },
      },
      required: ['filename'],
    },
  },
  {
    id: 'delete_file',
    name: 'delete_file',
    label: 'Stergere fisier',
    description: 'Sterge un fisier de pe sistemul utilizatorului',
    category: 'file-management',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The name/path of the file to delete' },
      },
      required: ['filename'],
    },
  },
  {
    id: 'check_database',
    name: 'check_database',
    label: 'Cautare in baza de cunostinte',
    description: 'Cauta continut similar semantic in baza LanceDB',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to find relevant information' },
      },
      required: ['query'],
    },
  },
  {
    id: 'add_to_database',
    name: 'add_to_database',
    label: 'Adaugare in memorie',
    description: 'Adauga informatii noi in baza LanceDB pentru memorie pe termen lung',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The content to add to the database' },
      },
      required: ['content'],
    },
  },
  {
    id: 'delete_from_database',
    name: 'delete_from_database',
    label: 'Stergere din memorie',
    description: 'Sterge o intrare de memorie din LanceDB dupa ID-ul returnat de check_database',
    category: 'database',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The memory entry id returned by check_database' },
      },
      required: ['id'],
    },
  },
  {
    id: 'check_resources',
    name: 'check_resources',
    label: 'Monitorizare sistem',
    description: 'Verifica resursele sistemului: CPU, RAM, procese de top, disk, uptime, baterie, temperatura si retea',
    category: 'system-monitoring',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    id: 'start_app',
    name: 'start_app',
    label: 'Pornire aplicatie',
    description: 'Porneste o aplicatie de pe sistem',
    category: 'app-control',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      properties: {
        app_name: { type: 'string', description: 'The name or path of the application to start' },
      },
      required: ['app_name'],
    },
  },
  {
    id: 'stop_app',
    name: 'stop_app',
    label: 'Oprire proces',
    description: 'Opreste un proces sau o aplicatie care ruleaza',
    category: 'app-control',
    requiresConfirmation: true,
    parameters: {
      type: 'object',
      properties: {
        process_name: { type: 'string', description: 'The name of the process to stop' },
      },
      required: ['process_name'],
    },
  },
  {
    id: 'get_weather',
    name: 'get_weather',
    label: 'Vreme',
    description: 'Obtine vremea actuala si prognoza scurta pentru o localitate, folosind date meteo dedicate',
    category: 'search',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City, town, or address to get weather for, e.g. "Filiasi, Dolj"' },
      },
      required: ['location'],
    },
  },
  {
    id: 'google_search',
    name: 'google_search',
    label: 'Agent Search',
    description: 'Cauta informatii actuale prin Agent Search',
    category: 'search',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Short, natural search query. Use official names/English terms for international topics. Do not include current time/date unless the user asks for an exact date.',
        },
      },
      required: ['query'],
    },
  },
];

export const LEGACY_TOOL_MAP: Record<string, ToolId[]> = {
  file_operations: ['create_file', 'read_file', 'delete_file'],
};

const TOOL_IDS = new Set<ToolId>(TOOL_CATALOG.map((tool) => tool.id));

export function normalizeProfileToolIds(toolIds?: unknown): ToolId[] {
  if (!Array.isArray(toolIds)) return [];
  const normalized = new Set<ToolId>();

  for (const raw of toolIds) {
    if (typeof raw !== 'string') continue;
    const legacy = LEGACY_TOOL_MAP[raw];
    if (legacy) {
      legacy.forEach((id) => normalized.add(id));
      continue;
    }
    if (TOOL_IDS.has(raw as ToolId)) normalized.add(raw as ToolId);
  }

  if (normalized.has('check_database') || normalized.has('add_to_database')) {
    normalized.add('delete_from_database');
  }

  return [...normalized];
}

export function getGloballyEnabledToolIds(config: Config): ToolId[] {
  const enabled = new Set<ToolId>();
  const tools = config.tools || {};

  if (tools.fileManagement?.enabled ?? true) {
    enabled.add('create_file');
    enabled.add('read_file');
    enabled.add('delete_file');
  }

  if (tools.database?.enabled ?? true) {
    enabled.add('check_database');
    enabled.add('add_to_database');
    enabled.add('delete_from_database');
  }

  if (tools.appControl?.enabled ?? false) {
    enabled.add('start_app');
    enabled.add('stop_app');
  }

  if (tools.systemMonitoring?.enabled ?? false) {
    enabled.add('check_resources');
  }

  enabled.add('get_weather');

  const searchConfigured = !!(
    (tools.googleSearch?.apiKey || config.apiKeys?.googleSearch) &&
    (tools.googleSearch?.searchEngineId || config.apiKeys?.googleSearchEngineId) &&
    tools.googleSearch?.projectId
  );
  if ((tools.googleSearch?.enabled ?? searchConfigured) && searchConfigured) {
    enabled.add('google_search');
  }

  return [...enabled];
}

export function getEffectiveToolIds(config: Config, profile?: Profile | null): ToolId[] {
  const profileToolIds = normalizeProfileToolIds(profile?.defaultTool);
  if (profileToolIds.length === 0) return [];

  const globalIds = new Set(getGloballyEnabledToolIds(config));
  return profileToolIds.filter((id) => globalIds.has(id));
}

export function getEffectiveTools(config: Config, profile?: Profile | null): ToolDefinition[] {
  const effectiveIds = new Set(getEffectiveToolIds(config, profile));
  return TOOL_CATALOG.filter((tool) => effectiveIds.has(tool.id));
}

export function getToolDefinition(id: string): ToolDefinition | undefined {
  return TOOL_CATALOG.find((tool) => tool.id === id);
}
