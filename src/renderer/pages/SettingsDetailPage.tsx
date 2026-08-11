import {
  Activity,
  AppWindow,
  Archive,
  ArrowDownToLine,
  ArrowUpToLine,
  Bot,
  CheckCircle,
  Cloud,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  Info,
  MessageCircle,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Upload,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { Config, ConsoleLogEntry, Conversation, Profile, WhatsAppConfig, WhatsAppMethod } from '../../shared/types';
import { SIDERA_AGENT_ID, SIDERA_AGENT_NAME } from '../../shared/sidera';
import type { SettingsPageId } from './SettingsHubPage';

interface SettingsDetail {
  title: string;
  description: string;
  icon: LucideIcon;
  sections: Array<{
    title: string;
    description: string;
  }>;
}

type RegisterSaveHandler = (handler: (() => void) | null) => void;

interface SaveableSettingsProps {
  onRegisterSave?: RegisterSaveHandler;
}

type NativeSelectOption = {
  label: string;
  value: string;
};

interface NativeSelectProps {
  disabled?: boolean;
  onChange: (value: string) => void;
  options?: NativeSelectOption[];
  placeholder?: string;
  value?: string;
}

function joinClassName(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

function basename(filePath: string) {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function NativeInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={joinClassName('app-settings-native-input', className)} {...props} />;
}

function NativeTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={joinClassName('app-settings-native-input', className)} {...props} />;
}

function NativeSelect({ disabled, onChange, options = [], placeholder, value }: NativeSelectProps) {
  return (
    <select
      className="app-settings-native-input app-settings-native-select"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      value={value || ''}
    >
      {placeholder && (
        <option disabled value="">
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function NativeSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      className="app-settings-native-switch"
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

function useTitlebarSave(onRegisterSave: RegisterSaveHandler | undefined, handleSave: () => void | Promise<void>) {
  const handleSaveRef = useRef(handleSave);

  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  useEffect(() => {
    onRegisterSave?.(() => {
      void handleSaveRef.current();
    });
    return () => onRegisterSave?.(null);
  }, [onRegisterSave]);
}

const settingDetails: Record<SettingsPageId, SettingsDetail> = {
  'ai-connection': {
    title: 'Conexiune AI',
    description: 'Provider, model, chei API si modul proxy.',
    icon: Bot,
    sections: [
      { title: 'Provider', description: 'Google, OpenAI, DeepSeek, Claude si Proxy.' },
      { title: 'Model', description: 'Model implicit, alegerea modelului pe provider si preferinte de latenta.' },
    ],
  },
  user: {
    title: 'Profil de utilizator',
    description: 'Identitatea ta locala si contextul pe care il primeste asistentul.',
    icon: User,
    sections: [
      { title: 'Identitate', description: 'Nume afisat, preferinte locale si identitatea implicita a spatiului de lucru.' },
      { title: 'Personalizare', description: 'Ton, limba si comportament implicit al aplicatiei.' },
    ],
  },
  tools: {
    title: 'Unelte',
    description: 'Controleaza ce capabilitati pot folosi agentii.',
    icon: Wrench,
    sections: [
      { title: 'Acces global la unelte', description: 'Disponibilitatea de baza a uneltelor, comuna pentru toti agentii.' },
      { title: 'Setari pe agent', description: 'Vizibilitatea uneltelor si cerintele de confirmare pentru fiecare agent.' },
      { title: 'Actiuni riscante', description: 'Reguli de confirmare pentru fisiere, procese si actiuni externe.' },
    ],
  },
  whatsapp: {
    title: 'WhatsApp',
    description: 'Chat la distanta, numere autorizate si rutare.',
    icon: MessageCircle,
    sections: [
      { title: 'Provider', description: 'Detalii de conexiune Business Cloud sau Twilio.' },
      { title: 'Expeditori autorizati', description: 'Numere care pot vorbi cu Sidera de la distanta.' },
      { title: 'Agent implicit', description: 'Agentul care gestioneaza implicit conversatiile WhatsApp.' },
    ],
  },
  webhook: {
    title: 'Webhook',
    description: 'Tunel public, Webhook URL si configurarea endpoint-ului local.',
    icon: Globe,
    sections: [
      { title: 'Tunel', description: 'Configurarea URL-ului public Cloudflare sau ngrok.' },
      { title: 'Endpoint', description: 'Calea webhook, statusul verificarii si starea listener-ului local.' },
    ],
  },
  logs: {
    title: 'Log-uri',
    description: 'Iesire consola, diagnosticare si date pentru depanare.',
    icon: Terminal,
    sections: [
      { title: 'Log-uri consola', description: 'Log-uri din main si renderer salvate pentru verificare ulterioara.' },
      { title: 'Diagnosticare', description: 'Verificari runtime, erori recente si actiuni de export.' },
    ],
  },
  archive: {
    title: 'Arhiva',
    description: 'Conversatii pastrate, ascunse din istoricul principal.',
    icon: Archive,
    sections: [
      { title: 'Conversatii', description: 'Vezi, restaureaza sau sterge definitiv conversatiile arhivate.' },
    ],
  },
};

type AIProviderOption = 'google' | 'openai' | 'deepseek' | 'claude' | 'proxy';

const DEEPSEEK_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);
type AIProviderSectionId = AIProviderOption | 'whisper';
type ToolOptionId = 'google-search' | 'database' | 'app-control' | 'file-management' | 'system-monitoring';
type WhatsAppMethodOption = 'business-cloud' | 'twilio';
type TunnelProviderOption = 'ngrok' | 'cloudflare' | 'custom';
type LogLevelOption = 'log' | 'info' | 'warn' | 'error';

const aiProviderSections: Array<{
  id: AIProviderSectionId;
  title: string;
  description: string;
  status?: string;
}> = [
  { id: 'google', title: 'Google', description: 'Provider direct pentru modelele Google / Gemini.' },
  { id: 'openai', title: 'OpenAI', description: 'Provider direct pentru modelele GPT si serviciile OpenAI.' },
  { id: 'deepseek', title: 'DeepSeek', description: 'Provider direct pentru modelele DeepSeek OpenAI-compatible.' },
  { id: 'claude', title: 'Claude', description: 'Provider direct pentru Anthropic Claude cu tool-use nativ.' },
  { id: 'whisper', title: 'Whisper', description: 'Cheie separata pentru transcrierea audio din input.' },
  { id: 'proxy', title: 'Proxy', description: 'URL proxy si cheie pentru rutare prin server intermediar.' },
];

const toolOptions: Array<{
  id: ToolOptionId;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: 'google-search',
    title: 'Agent Search',
    description: 'Permite agentilor sa caute informatii actuale pe internet prin Agent Search.',
    icon: Search,
  },
  {
    id: 'database',
    title: 'Gestionare baza de date',
    description: 'Operatii de memorie si stocare cu LanceDB pentru pastrarea contextului conversatiilor.',
    icon: Database,
  },
  {
    id: 'app-control',
    title: 'Control aplicatii',
    description: 'Permite agentilor sa porneasca sau sa opreasca aplicatii din sistem.',
    icon: AppWindow,
  },
  {
    id: 'file-management',
    title: 'Gestionare fisiere',
    description: 'Permite agentilor sa creeze, sa citeasca si sa modifice fisiere.',
    icon: FileText,
  },
  {
    id: 'system-monitoring',
    title: 'Monitorizare sistem',
    description: 'Ofera informatii despre resursele sistemului, precum CPU, memorie si disc.',
    icon: Activity,
  },
];

const whatsAppProviderOptions: Array<{
  id: WhatsAppMethodOption;
  title: string;
  description: string;
}> = [
  {
    id: 'business-cloud',
    title: 'Meta Cloud API',
    description: 'Direct prin WhatsApp Business Platform. Recomandat pentru control pe termen lung.',
  },
  {
    id: 'twilio',
    title: 'Twilio WhatsApp',
    description: 'Bun pentru sandbox, testare si conturi care folosesc deja Twilio.',
  },
];

const webhookProviderOptions: NativeSelectOption[] = [
  { label: 'Cloudflare', value: 'cloudflare' },
  { label: 'Ngrok', value: 'ngrok' },
  { label: 'URL custom', value: 'custom' },
];

const tunnelProviderOptions: Array<{
  id: TunnelProviderOption;
  title: string;
  description: string;
}> = [
  { id: 'ngrok', title: 'Ngrok', description: 'Pornire automata pentru test rapid.' },
  { id: 'cloudflare', title: 'Cloudflare', description: 'Ghid manual pentru Zero Trust Tunnel.' },
  { id: 'custom', title: 'Custom', description: 'Foloseste orice URL HTTPS public.' },
];

function aiProviderFromConfig(config: Config): AIProviderOption {
  if (config.connectionMode === 'proxy') return 'proxy';
  if (config.aiProvider === 'deepseek' || config.aiProvider === 'claude') return config.aiProvider;
  return config.aiProvider === 'openai' ? 'openai' : 'google';
}

function configProviderForSelectedAIProvider(provider: Exclude<AIProviderOption, 'proxy'>): Config['aiProvider'] {
  if (provider === 'deepseek' || provider === 'claude') return provider;
  return provider === 'openai' ? 'openai' : 'gemini';
}

function isModelForAIProvider(provider: Config['aiProvider'], model?: string): model is string {
  if (!model) return false;
  if (provider === 'gemini') return model.startsWith('gemini-');
  if (provider === 'deepseek') return DEEPSEEK_MODELS.has(model);
  if (provider === 'claude') return model.startsWith('claude-');
  return (
    model.startsWith('gpt-') ||
    model.startsWith('o1-') ||
    model.startsWith('o3-') ||
    model.startsWith('o4-') ||
    model.startsWith('o5-')
  );
}

function fallbackModelForAIProvider(provider: Config['aiProvider']) {
  if (provider === 'gemini') return 'gemini-2.5-flash';
  if (provider === 'deepseek') return 'deepseek-v4-flash';
  if (provider === 'claude') return 'claude-sonnet-4-5';
  return 'gpt-4o';
}

function pickModelForAIProvider(provider: Config['aiProvider'], ...candidates: Array<string | undefined>) {
  return candidates.find((model) => isModelForAIProvider(provider, model)) || fallbackModelForAIProvider(provider);
}

function positiveIntOrFallback(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeNumbers(value: string) {
  return value
    .split(/[\n,;]/)
    .map((number) => number.trim())
    .filter(Boolean);
}

function formatUserPersonaInfo(name: string, description: string) {
  return [`Nume: ${name.trim()}`, `Descriere: ${description.trim()}`].join('\n');
}

function getWebhookPublicUrl(config: Config) {
  return config.whatsapp?.webhook?.publicUrl || '';
}

function AIConnectionSettings({ onRegisterSave }: SaveableSettingsProps) {
  const [selectedProvider, setSelectedProvider] = useState<AIProviderOption>('google');
  const [proxyProvider, setProxyProvider] = useState<Config['aiProvider']>('openai');
  const [primaryModel, setPrimaryModel] = useState<string>();
  const [secondaryModel, setSecondaryModel] = useState<string>();
  const [primaryMaxResponse, setPrimaryMaxResponse] = useState('4096');
  const [primaryContextSize, setPrimaryContextSize] = useState('128000');
  const [secondaryMaxResponse, setSecondaryMaxResponse] = useState('2048');
  const [secondaryContextSize, setSecondaryContextSize] = useState('32000');
  const [whisperKey, setWhisperKey] = useState('');
  const [keys, setKeys] = useState<Record<AIProviderOption, string>>({
    google: '',
    openai: '',
    deepseek: '',
    claude: '',
    proxy: '',
  });
  const [proxyUrl, setProxyUrl] = useState('');
  const [modelOptions, setModelOptions] = useState<NativeSelectOption[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const activeConfigProvider = selectedProvider === 'proxy' ? proxyProvider : configProviderForSelectedAIProvider(selectedProvider);
  const canLoadModels = Boolean(selectedProvider === 'proxy' ? proxyUrl.trim() && keys.proxy.trim() : keys[selectedProvider].trim());

  const updateKey = (provider: AIProviderOption, value: string) => {
    setKeys((current) => ({ ...current, [provider]: value }));
  };

  const handleProviderChange = (provider: AIProviderOption) => {
    setSelectedProvider(provider);
    const aiProvider = provider === 'proxy' ? proxyProvider : configProviderForSelectedAIProvider(provider);
    const fallbackModel = fallbackModelForAIProvider(aiProvider);
    setPrimaryModel(fallbackModel);
    setSecondaryModel(fallbackModel);
    setModelOptions([]);
  };

  const handleProxyProviderChange = (provider: Config['aiProvider']) => {
    setProxyProvider(provider);
    const fallbackModel = fallbackModelForAIProvider(provider);
    setPrimaryModel(fallbackModel);
    setSecondaryModel(fallbackModel);
    setModelOptions([]);
  };

  useEffect(() => {
    let cancelled = false;

    window.electronAPI
      .getConfig()
      .then((config) => {
        if (cancelled) return;

        const configProvider = aiProviderFromConfig(config);
        const aiProvider = configProvider === 'proxy' ? config.aiProvider : configProviderForSelectedAIProvider(configProvider);
        const selectedModel = pickModelForAIProvider(
          aiProvider,
          config.modelProfiles?.primary?.model,
          config.selectedModels?.[aiProvider],
          config.selectedModel,
        );
        const secondarySelectedModel = pickModelForAIProvider(
          aiProvider,
          config.modelProfiles?.secondary?.model,
          selectedModel,
        );
        setSelectedProvider(configProvider);
        setProxyProvider(config.aiProvider);
        const primaryProfile = config.modelProfiles?.primary;
        const secondaryProfile = config.modelProfiles?.secondary;
        setPrimaryModel(selectedModel);
        setSecondaryModel(secondarySelectedModel);
        setPrimaryMaxResponse(String(primaryProfile?.maxResponseTokens || 4096));
        setPrimaryContextSize(String(primaryProfile?.contextSizeTokens || 128000));
        setSecondaryMaxResponse(String(secondaryProfile?.maxResponseTokens || 2048));
        setSecondaryContextSize(String(secondaryProfile?.contextSizeTokens || 32000));
        setWhisperKey(config.stt?.openaiApiKey || '');
        setKeys({
          google: config.apiKeys?.gemini || '',
          openai: config.apiKeys?.openai || '',
          deepseek: config.apiKeys?.deepseek || '',
          claude: config.apiKeys?.claude || '',
          proxy: config.proxyApiKeys?.[config.aiProvider] || '',
        });
        setProxyUrl(config.proxyBaseUrls?.[config.aiProvider] || '');
      })
      .catch((error) => {
        console.error('[Settings] Failed to load AI config:', error);
        setStatusText('Nu am putut incarca setarile AI.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const provider = activeConfigProvider;
    const key = selectedProvider === 'proxy' ? keys.proxy : keys[selectedProvider];

    if (!key.trim()) {
      setModelOptions([]);
      return;
    }

    window.electronAPI
      .getAvailableModels(provider, key, selectedProvider === 'proxy' ? { connectionMode: 'proxy', proxyBaseUrl: proxyUrl } : undefined)
      .then((models) => {
        if (cancelled) return;
        const options = models.map((model) => ({ label: model.name || model.id, value: model.id }));
        setModelOptions(options);
        setPrimaryModel((current) => {
          if (current && options.some((option) => option.value === current)) return current;
          return options[0]?.value || fallbackModelForAIProvider(provider);
        });
        setSecondaryModel((current) => {
          if (current && options.some((option) => option.value === current)) return current;
          return options[0]?.value || fallbackModelForAIProvider(provider);
        });
      })
      .catch(() => {
        if (!cancelled) setModelOptions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeConfigProvider, keys.claude, keys.deepseek, keys.google, keys.openai, keys.proxy, proxyUrl, selectedProvider]);

  const handleSave = useCallback(async () => {
    try {
      const config = await window.electronAPI.getConfig();
      const aiProvider = activeConfigProvider;
      const connectionMode = selectedProvider === 'proxy' ? 'proxy' : 'direct';
      const selectedModel = pickModelForAIProvider(aiProvider, primaryModel, config.selectedModels?.[aiProvider], config.selectedModel);
      const secondarySelectedModel = pickModelForAIProvider(aiProvider, secondaryModel, selectedModel);

      await window.electronAPI.setConfig({
        aiProvider,
        connectionMode,
        apiKeys: {
          ...config.apiKeys,
          gemini: keys.google,
          openai: keys.openai,
          deepseek: keys.deepseek,
          claude: keys.claude,
        },
        proxyApiKeys: {
          ...config.proxyApiKeys,
          [aiProvider]: keys.proxy,
        },
        proxyBaseUrls: {
          ...config.proxyBaseUrls,
          [aiProvider]: proxyUrl,
        },
        selectedModels: {
          ...config.selectedModels,
          [aiProvider]: selectedModel,
        },
        selectedModel,
        embeddingProvider: 'auto',
        modelProfiles: {
          primary: {
            model: selectedModel,
            maxResponseTokens: positiveIntOrFallback(primaryMaxResponse, config.modelProfiles?.primary?.maxResponseTokens || 4096),
            contextSizeTokens: positiveIntOrFallback(primaryContextSize, config.modelProfiles?.primary?.contextSizeTokens || 128000),
          },
          secondary: {
            model: secondarySelectedModel,
            maxResponseTokens: positiveIntOrFallback(secondaryMaxResponse, config.modelProfiles?.secondary?.maxResponseTokens || 2048),
            contextSizeTokens: positiveIntOrFallback(secondaryContextSize, config.modelProfiles?.secondary?.contextSizeTokens || 32000),
          },
        },
        stt: {
          ...(config.stt || { enabled: false, provider: 'openai' as const }),
          provider: 'openai',
          enabled: Boolean(whisperKey.trim()),
          openaiApiKey: whisperKey,
        },
      });
      setStatusText('Setarile AI au fost salvate.');
    } catch (error) {
      console.error('[Settings] Failed to save AI config:', error);
      setStatusText('Esec la salvarea setarilor AI.');
    }
  }, [
    keys.google,
    keys.openai,
    keys.deepseek,
    keys.claude,
    keys.proxy,
    primaryContextSize,
    primaryMaxResponse,
    primaryModel,
    proxyUrl,
    activeConfigProvider,
    secondaryContextSize,
    secondaryMaxResponse,
    secondaryModel,
    selectedProvider,
    whisperKey,
  ]);

  useTitlebarSave(onRegisterSave, handleSave);

  return (
    <div className="app-ai-settings">
      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Provideri</h3>
          <p>Configureaza separat conexiunile disponibile. Providerul activ este folosit pentru raspunsurile AI.</p>
        </div>

        <div className="app-ai-provider-sections">
          {aiProviderSections.map((provider) => {
            if (provider.id === 'google' || provider.id === 'openai' || provider.id === 'deepseek' || provider.id === 'claude') {
              const providerId = provider.id;
              return (
                <article className="app-ai-provider-section" data-active={selectedProvider === providerId} key={providerId}>
                  <div className="app-ai-provider-section-main">
                    <div>
                      <div className="app-ai-provider-section-title">
                        <h4>{provider.title}</h4>
                        {selectedProvider === providerId && <span>Activ</span>}
                      </div>
                      <p>{provider.description}</p>
                    </div>
                    <button
                      className="app-ai-provider-activate"
                      disabled={selectedProvider === providerId}
                      onClick={() => handleProviderChange(providerId)}
                      type="button"
                    >
                      {selectedProvider === providerId ? 'Provider activ' : 'Foloseste providerul'}
                    </button>
                  </div>
                  <div className="app-ai-provider-fields">
                    <label>
                      <span>Cheie API {provider.title}</span>
                      <NativeInput
                        value={keys[providerId]}
                        onChange={(event) => updateKey(providerId, event.target.value)}
                        placeholder="Introdu cheia API"
                        type="password"
                      />
                    </label>
                  </div>
                </article>
              );
            }

            if (provider.id === 'proxy') {
              return (
                <article className="app-ai-provider-section" data-active={selectedProvider === 'proxy'} key={provider.id}>
                  <div className="app-ai-provider-section-main">
                    <div>
                      <div className="app-ai-provider-section-title">
                        <h4>{provider.title}</h4>
                        {selectedProvider === 'proxy' && <span>Activ</span>}
                      </div>
                      <p>{provider.description}</p>
                    </div>
                    <button
                      className="app-ai-provider-activate"
                      disabled={selectedProvider === 'proxy'}
                      onClick={() => handleProviderChange('proxy')}
                      type="button"
                    >
                      {selectedProvider === 'proxy' ? 'Provider activ' : 'Foloseste proxy'}
                    </button>
                  </div>
                  <div className="app-ai-provider-fields app-ai-provider-fields-proxy">
                    <label>
                      <span>Compatibilitate proxy</span>
                      <NativeSelect
                        options={[
                          { label: 'Google / Gemini', value: 'gemini' },
                          { label: 'OpenAI', value: 'openai' },
                          { label: 'DeepSeek', value: 'deepseek' },
                          { label: 'Claude', value: 'claude' },
                        ]}
                        value={proxyProvider}
                        onChange={(value) => handleProxyProviderChange(value as Config['aiProvider'])}
                      />
                    </label>
                    <label>
                      <span>Link proxy</span>
                      <NativeInput value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="https://proxy.example.com" />
                    </label>
                    <label>
                      <span>Cheie proxy</span>
                      <NativeInput
                        value={keys.proxy}
                        onChange={(event) => updateKey('proxy', event.target.value)}
                        placeholder="Introdu cheia pentru proxy"
                        type="password"
                      />
                    </label>
                  </div>
                </article>
              );
            }

            if (provider.id === 'whisper') {
              return (
                <article className="app-ai-provider-section" key={provider.id}>
                  <div className="app-ai-provider-section-main">
                    <div>
                      <div className="app-ai-provider-section-title">
                        <h4>{provider.title}</h4>
                        <span>Transcriere</span>
                      </div>
                      <p>{provider.description}</p>
                    </div>
                  </div>
                  <div className="app-ai-provider-fields">
                    <label>
                      <span>Cheie API Whisper</span>
                      <NativeInput
                        onChange={(event) => setWhisperKey(event.target.value)}
                        placeholder="Introdu cheia pentru transcriere"
                        type="password"
                        value={whisperKey}
                      />
                    </label>
                  </div>
                </article>
              );
            }

            return (
              <article className="app-ai-provider-section app-ai-provider-section-disabled" key={provider.id}>
                <div className="app-ai-provider-section-main">
                  <div>
                    <div className="app-ai-provider-section-title">
                      <h4>{provider.title}</h4>
                      <span>{provider.status}</span>
                    </div>
                    <p>{provider.description}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Memorie</h3>
          <p>Memoria LanceDB foloseste embeddings pentru adaugare si cautare semantica.</p>
        </div>

        <div className="app-memory-config">
          <strong>Embeddings: OpenAI sau Google/Gemini</strong>
          <p>
            Aplicatia alege automat providerul disponibil. Daca folosesti doar DeepSeek sau Claude,
            chat-ul poate merge, dar memoria semantica are nevoie de o cheie sau un proxy OpenAI/Gemini.
          </p>
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Model</h3>
          <p>Alege modelul principal pentru task-uri complexe si modelul secundar pentru actiuni rapide.</p>
        </div>

        <div className="app-model-zones">
          <label className="app-model-zone app-model-zone-primary">
            <span>Model principal</span>
            <p>
              Folosit pentru raspunsuri importante, reasoning, planificare si actiuni unde ai nevoie de calitate mai buna.
            </p>
            <NativeSelect
              disabled={!canLoadModels}
              options={modelOptions}
              value={primaryModel}
              onChange={(value) => setPrimaryModel(String(value))}
              placeholder="Alege modelul principal"
            />
            <div className="app-model-limits">
              <label>
                <span>Raspuns maxim</span>
                <NativeInput
                  min={1}
                  onChange={(event) => setPrimaryMaxResponse(event.target.value)}
                  placeholder="4096"
                  type="number"
                  value={primaryMaxResponse}
                />
              </label>
              <label>
                <span>Context maxim</span>
                <NativeInput
                  min={1}
                  onChange={(event) => setPrimaryContextSize(event.target.value)}
                  placeholder="128000"
                  type="number"
                  value={primaryContextSize}
                />
              </label>
            </div>
          </label>

          <label className="app-model-zone app-model-zone-secondary">
            <span>Model secundar</span>
            <p>
              Folosit pentru actiuni simple, rapide, unde nu ai nevoie de modelul principal.
            </p>
            <NativeSelect
              disabled={!canLoadModels}
              options={modelOptions}
              value={secondaryModel}
              onChange={(value) => setSecondaryModel(String(value))}
              placeholder="Alege modelul secundar"
            />
            <div className="app-model-limits">
              <label>
                <span>Raspuns maxim</span>
                <NativeInput
                  min={1}
                  onChange={(event) => setSecondaryMaxResponse(event.target.value)}
                  placeholder="2048"
                  type="number"
                  value={secondaryMaxResponse}
                />
              </label>
              <label>
                <span>Context maxim</span>
                <NativeInput
                  min={1}
                  onChange={(event) => setSecondaryContextSize(event.target.value)}
                  placeholder="32000"
                  type="number"
                  value={secondaryContextSize}
                />
              </label>
            </div>
          </label>
        </div>
      </section>

      {statusText && (
        <div className="app-user-profile-actions">
          <span>{statusText}</span>
        </div>
      )}
    </div>
  );
}

function UserProfileSettings({ onRegisterSave }: SaveableSettingsProps) {
  const [userName, setUserName] = useState('');
  const [userDescription, setUserDescription] = useState('');
  const [avatarPath, setAvatarPath] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarName, setAvatarName] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI
      .getConfig()
      .then((config) => {
        setUserName(config.userPersona?.name || '');
        setUserDescription(config.userPersona?.description || config.userPersona?.userInfo || '');
        setAvatarPath(config.userPersona?.avatarImagePath || '');
        setAvatarName(config.userPersona?.avatarImagePath ? basename(config.userPersona.avatarImagePath) : '');
      })
      .catch((error) => console.error('[Settings] Failed to load user profile:', error));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAvatarUrl(null);

    if (!avatarPath) return;

    window.electronAPI
      .getFileDataUrl(avatarPath)
      .then((url) => {
        if (!cancelled) setAvatarUrl(url);
      })
      .catch(() => {
        if (!cancelled) setAvatarUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  const pickUserAvatar = async () => {
    try {
      const filePath = await window.electronAPI.selectFile([
        { name: 'Imagini', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: 'Toate fisierele', extensions: ['*'] },
      ]);
      if (!filePath) return;

      setAvatarPath(filePath);
      setAvatarName(basename(filePath));

      const savedPath = await window.electronAPI.setUserAvatarImage(filePath);
      if (savedPath) {
        setAvatarPath(savedPath);
        setAvatarName(basename(savedPath));
      }
    } catch (error) {
      console.error('[Settings] Failed to set user avatar:', error);
    }
  };

  const handleSave = useCallback(async () => {
    const config = await window.electronAPI.getConfig();
    await window.electronAPI.setConfig({
      userPersona: {
        ...config.userPersona,
        name: userName,
        description: userDescription,
        userInfo: formatUserPersonaInfo(userName, userDescription),
        avatarImagePath: avatarPath || config.userPersona?.avatarImagePath,
      },
    });
    setSavedAt(new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }));
  }, [avatarPath, userDescription, userName]);

  useTitlebarSave(onRegisterSave, handleSave);

  return (
    <div className="app-user-profile-settings">
      <section className="app-settings-linear-section">
        <div className="app-user-profile-note">
          <Info size={18} strokeWidth={1.8} />
          <div>
            <h3>Despre acest profil</h3>
            <p>
              Acesta este profilul tau, adica utilizatorul uman. Informatiile de aici vor fi transmise
              asistentului AI ca sa stie cu cine vorbeste si sa poata raspunde mai personalizat.
            </p>
            <p>
              Profilul acesta este diferit de Agenti. Agentii controleaza comportamentul asistentului, iar
              profilul de utilizator descrie cine esti tu.
            </p>
          </div>
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Poza de profil</h3>
          <p>Alege o imagine locala pentru preview-ul profilului tau in interfata principala.</p>
        </div>

        <div className="app-user-profile-avatar-picker">
          <button className="app-agent-avatar-upload app-user-profile-avatar-upload" onClick={pickUserAvatar} type="button">
            <span>Poza profil</span>
            <div className="app-agent-avatar-upload-body">
              <span className="app-agent-avatar-upload-preview">
                {avatarUrl ? <img alt="" draggable={false} src={avatarUrl} /> : <ImageIcon size={18} strokeWidth={1.8} />}
              </span>
              <span className="app-agent-avatar-upload-copy">
                <strong>{avatarName || 'Alege poza'}</strong>
                <small>{avatarName ? 'Poza selectata pentru utilizator' : 'PNG, JPG, JPEG, WebP sau GIF'}</small>
              </span>
              <span className="app-agent-avatar-upload-action">
                <Upload size={14} strokeWidth={1.8} />
                Incarca
              </span>
            </div>
          </button>
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Identitate</h3>
          <p>Numele si descrierea sunt folosite ca context pentru conversatiile cu asistentul.</p>
        </div>

        <div className="app-user-profile-form">
          <label>
            <span>Nume</span>
            <small>Numele complet sau prenumele cu care vrei sa ti se adreseze asistentul.</small>
            <NativeInput
              onChange={(event) => setUserName(event.target.value)}
              placeholder="Introdu numele tau"
              value={userName}
            />
          </label>

          <label>
            <span>Descriere</span>
            <small>
              Ocupatie, interese, preferinte si orice context relevant pentru raspunsuri personalizate.
            </small>
            <NativeTextarea
              onChange={(event) => setUserDescription(event.target.value)}
              placeholder="Exemplu: Sunt dezvoltator software, lucrez cu React si TypeScript si prefer explicatii tehnice clare, cu exemple practice."
              rows={6}
              value={userDescription}
            />
            <em>{userDescription.length} caractere</em>
          </label>
        </div>
      </section>

      {savedAt && (
        <div className="app-user-profile-actions">
          <span>Salvat local la {savedAt}</span>
        </div>
      )}
    </div>
  );
}

function ToolsSettings({ onRegisterSave }: SaveableSettingsProps) {
  const [enabledTools, setEnabledTools] = useState<Record<ToolOptionId, boolean>>({
    'google-search': false,
    database: true,
    'app-control': false,
    'file-management': true,
    'system-monitoring': false,
  });
  const [googleSearchApiKey, setGoogleSearchApiKey] = useState('');
  const [googleSearchEngineId, setGoogleSearchEngineId] = useState('');
  const [googleSearchProjectId, setGoogleSearchProjectId] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI
      .getConfig()
      .then((config) => {
        const tools = config.tools || {};
        setEnabledTools({
          'google-search': Boolean(tools.googleSearch?.enabled ?? false),
          database: Boolean(tools.database?.enabled ?? true),
          'app-control': Boolean(tools.appControl?.enabled ?? false),
          'file-management': Boolean(tools.fileManagement?.enabled ?? true),
          'system-monitoring': Boolean(tools.systemMonitoring?.enabled ?? false),
        });
        setGoogleSearchApiKey(tools.googleSearch?.apiKey || config.apiKeys?.googleSearch || '');
        setGoogleSearchEngineId(tools.googleSearch?.searchEngineId || config.apiKeys?.googleSearchEngineId || '');
        setGoogleSearchProjectId(tools.googleSearch?.projectId || '');
      })
      .catch((error) => console.error('[Settings] Failed to load tools config:', error));
  }, []);

  const toggleTool = (toolId: ToolOptionId, enabled: boolean) => {
    setEnabledTools((current) => ({ ...current, [toolId]: enabled }));
  };

  const handleSave = useCallback(async () => {
    const config = await window.electronAPI.getConfig();
    await window.electronAPI.setConfig({
      apiKeys: {
        ...config.apiKeys,
        googleSearch: googleSearchApiKey,
        googleSearchEngineId,
      },
      tools: {
        ...(config.tools || {}),
        googleSearch: {
          ...(config.tools?.googleSearch || {}),
          enabled: enabledTools['google-search'],
          provider: 'vertex-ai',
          apiKey: googleSearchApiKey,
          searchEngineId: googleSearchEngineId,
          projectId: googleSearchProjectId,
        },
        database: { enabled: enabledTools.database },
        appControl: { enabled: enabledTools['app-control'] },
        fileManagement: { enabled: enabledTools['file-management'] },
        systemMonitoring: { enabled: enabledTools['system-monitoring'] },
      },
    });
    setSavedAt(new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }));
  }, [enabledTools, googleSearchApiKey, googleSearchEngineId, googleSearchProjectId]);

  useTitlebarSave(onRegisterSave, handleSave);

  return (
    <div className="app-tools-settings">
      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Unelte disponibile</h3>
          <p>Activeaza sau dezactiveaza capabilitatile pe care agentii le pot folosi in conversatii.</p>
        </div>

        <div className="app-tools-list">
          {toolOptions.map((tool) => {
            const Icon = tool.icon;
            const enabled = enabledTools[tool.id];

            return (
              <article className="app-tool-row" data-enabled={enabled} key={tool.id}>
                <div className="app-tool-row-header">
                  <div className="app-tool-row-icon">
                    <Icon size={19} strokeWidth={1.8} />
                  </div>
                  <div className="app-tool-row-copy">
                    <h3>{tool.title}</h3>
                    <p>{tool.description}</p>
                  </div>
                  <NativeSwitch checked={enabled} onChange={(checked) => toggleTool(tool.id, checked)} />
                </div>

                {tool.id === 'google-search' && enabled && (
                  <div className="app-tool-config">
                    <label>
                      <span>Cheie JSON Service Account</span>
                      <small>Folosita pentru autentificarea in Agent Search.</small>
                      <NativeInput
                        onChange={(event) => setGoogleSearchApiKey(event.target.value)}
                        placeholder="Introdu cheia JSON de Service Account"
                        type="password"
                        value={googleSearchApiKey}
                      />
                    </label>

                    <label>
                      <span>Data Store ID</span>
                      <NativeInput
                        onChange={(event) => setGoogleSearchEngineId(event.target.value)}
                        placeholder="Introdu Data Store ID-ul"
                        value={googleSearchEngineId}
                      />
                    </label>

                    <label>
                      <span>Project ID</span>
                      <small>Necesar pentru Agent Search.</small>
                      <NativeInput
                        onChange={(event) => setGoogleSearchProjectId(event.target.value)}
                        placeholder="Introdu Project ID-ul GCP"
                        value={googleSearchProjectId}
                      />
                    </label>

                    <div className="app-tool-help">
                      <Info size={15} strokeWidth={1.8} />
                      <div>
                        <p>
                          Pentru Agent Search: activeaza API-ul in Google Cloud, creeaza un Data Store, apoi foloseste
                          Service Account JSON, Data Store ID si Project ID.
                        </p>
                        <a
                          href="https://cloud.google.com/generative-ai-app-builder/docs/try-enterprise-search"
                          rel="noreferrer"
                          target="_blank"
                        >
                          Ghid de configurare
                          <ExternalLink size={12} strokeWidth={1.8} />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-user-profile-note">
          <Info size={18} strokeWidth={1.8} />
          <div>
            <h3>Despre unelte</h3>
            <p>
              Uneltele controleaza ce actiuni poate executa un agent. Daca o unealta este dezactivata aici,
              agentii nu ar trebui sa o poata folosi, chiar daca profilul lor o cere.
            </p>
            <p>
              Actiunile riscante, cum ar fi stergerea fisierelor sau oprirea aplicatiilor, vor ramane protejate
              prin confirmare cand migram backend-ul in interfata principala.
            </p>
          </div>
        </div>
      </section>

      {savedAt && (
        <div className="app-user-profile-actions">
          <span className="app-tools-saved">
            <CheckCircle size={14} strokeWidth={1.8} />
            Salvat local la {savedAt}
          </span>
        </div>
      )}
    </div>
  );
}

function WhatsAppSettings({ onRegisterSave }: SaveableSettingsProps) {
  const [activeMethod, setActiveMethod] = useState<WhatsAppMethodOption>('business-cloud');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [businessApiToken, setBusinessApiToken] = useState('');
  const [businessPhoneNumberId, setBusinessPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [businessWebhookToken, setBusinessWebhookToken] = useState('');
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [twilioWhatsappNumber, setTwilioWhatsappNumber] = useState('');
  const [webhookProvider, setWebhookProvider] = useState('ngrok');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [allowedNumbersText, setAllowedNumbersText] = useState('');
  const [replyToUnauthorized, setReplyToUnauthorized] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const canonicalWebhookUrl = webhookUrl.trim() || 'https://assistant.example.com/webhook';
  const allowedNumbers = allowedNumbersText
    .split(/[\n,;]/)
    .map((number) => number.trim())
    .filter(Boolean);
  const checklist = [
    { label: 'Provider activ', done: !!activeMethod },
    { label: 'Webhook public HTTPS', done: webhookUrl.trim().startsWith('https://') },
    { label: 'Numere autorizate', done: allowedNumbers.length > 0 },
  ];

  useEffect(() => {
    void Promise.all([
      window.electronAPI.getConfig(),
      window.electronAPI.getAllProfiles(),
      window.electronAPI.getWhatsAppDefaultProfile(),
    ])
      .then(([config, allProfiles, defaultProfile]) => {
        const whatsapp = config.whatsapp;
        setProfiles(allProfiles);
        setDefaultProfileId(defaultProfile?.id || null);
        setActiveMethod((whatsapp?.activeMethod || 'business-cloud') as WhatsAppMethodOption);
        setBusinessApiToken(whatsapp?.businessCloud?.apiToken || '');
        setBusinessPhoneNumberId(whatsapp?.businessCloud?.phoneNumberId || '');
        setBusinessAccountId(whatsapp?.businessCloud?.businessAccountId || '');
        setBusinessWebhookToken(whatsapp?.businessCloud?.webhookToken || '');
        setTwilioAccountSid(whatsapp?.twilio?.accountSid || '');
        setTwilioAuthToken(whatsapp?.twilio?.authToken || '');
        setTwilioWhatsappNumber(whatsapp?.twilio?.whatsappNumber || '');
        setWebhookProvider(whatsapp?.webhook?.provider || 'ngrok');
        setWebhookUrl(whatsapp?.webhook?.publicUrl || whatsapp?.twilio?.webhookUrl || '');
        setAllowedNumbersText((whatsapp?.allowedNumbers || []).join('\n'));
        setReplyToUnauthorized(Boolean(whatsapp?.replyToUnauthorized));
      })
      .catch((error) => console.error('[Settings] Failed to load WhatsApp config:', error));
  }, []);

  const handleSave = useCallback(async () => {
    const config = await window.electronAPI.getConfig();
    const nextWhatsapp: WhatsAppConfig = {
      ...(config.whatsapp || {}),
      activeMethod: activeMethod as WhatsAppMethod,
      businessCloud: {
        apiToken: businessApiToken,
        phoneNumberId: businessPhoneNumberId,
        businessAccountId,
        webhookToken: businessWebhookToken,
      },
      twilio: {
        accountSid: twilioAccountSid,
        authToken: twilioAuthToken,
        whatsappNumber: twilioWhatsappNumber,
        webhookUrl,
      },
      webhook: {
        publicUrl: publicBaseFromWebhook(webhookUrl),
        provider: webhookProvider as NonNullable<WhatsAppConfig['webhook']>['provider'],
      },
      allowedNumbers,
      replyToUnauthorized,
    };

    await window.electronAPI.setConfig({ whatsapp: nextWhatsapp });
    if (defaultProfileId) {
      await window.electronAPI.setWhatsAppDefaultProfile(defaultProfileId);
    }
    setSavedAt(new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }));
  }, [
    activeMethod,
    allowedNumbers,
    businessAccountId,
    businessApiToken,
    businessPhoneNumberId,
    businessWebhookToken,
    defaultProfileId,
    replyToUnauthorized,
    twilioAccountSid,
    twilioAuthToken,
    twilioWhatsappNumber,
    webhookProvider,
    webhookUrl,
  ]);

  useTitlebarSave(onRegisterSave, handleSave);

  return (
    <div className="app-whatsapp-settings">
      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Provider WhatsApp</h3>
          <p>Alege canalul prin care Sidera va primi si trimite mesaje WhatsApp.</p>
        </div>

        <div className="app-whatsapp-provider-list">
          {whatsAppProviderOptions.map((provider) => (
            <button
              aria-current={activeMethod === provider.id ? 'page' : undefined}
              className="app-whatsapp-provider-row"
              key={provider.id}
              onClick={() => setActiveMethod(provider.id)}
              type="button"
            >
              <span>{provider.title}</span>
              <small>{provider.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>{activeMethod === 'business-cloud' ? 'Credentiale Meta Cloud API' : 'Credentiale Twilio'}</h3>
          <p>
            {activeMethod === 'business-cloud'
              ? 'Copiaza tokenul, Phone Number ID, Business Account ID si Verify Token din Meta Developers.'
              : 'Foloseste Account SID, Auth Token si numarul WhatsApp aprobat din Twilio.'}
          </p>
        </div>

        {activeMethod === 'business-cloud' ? (
          <div className="app-whatsapp-field-grid">
            <label>
              <span>Access token Meta</span>
              <NativeInput
                onChange={(event) => setBusinessApiToken(event.target.value)}
                placeholder="Access token Meta"
                type="password"
                value={businessApiToken}
              />
            </label>
            <label>
              <span>Phone Number ID</span>
              <NativeInput
                onChange={(event) => setBusinessPhoneNumberId(event.target.value)}
                placeholder="Phone Number ID"
                type="text"
                value={businessPhoneNumberId}
              />
            </label>
            <label>
              <span>Business Account ID</span>
              <NativeInput
                onChange={(event) => setBusinessAccountId(event.target.value)}
                placeholder="Business Account ID"
                type="text"
                value={businessAccountId}
              />
            </label>
            <label>
              <span>Verify token webhook</span>
              <NativeInput
                onChange={(event) => setBusinessWebhookToken(event.target.value)}
                placeholder="Verify token webhook"
                type="password"
                value={businessWebhookToken}
              />
            </label>
          </div>
        ) : (
          <div className="app-whatsapp-field-grid">
            <label>
              <span>Account SID</span>
              <NativeInput
                onChange={(event) => setTwilioAccountSid(event.target.value)}
                placeholder="Account SID"
                type="text"
                value={twilioAccountSid}
              />
            </label>
            <label>
              <span>Auth Token</span>
              <NativeInput
                onChange={(event) => setTwilioAuthToken(event.target.value)}
                placeholder="Auth Token"
                type="password"
                value={twilioAuthToken}
              />
            </label>
            <label className="app-whatsapp-wide-field">
              <span>Numar WhatsApp Twilio</span>
              <NativeInput
                onChange={(event) => setTwilioWhatsappNumber(event.target.value)}
                placeholder="whatsapp:+1234567890"
                type="text"
                value={twilioWhatsappNumber}
              />
            </label>
          </div>
        )}
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Webhook public</h3>
          <p>Providerul WhatsApp trebuie sa trimita mesajele catre URL-ul public al aplicatiei.</p>
        </div>

        <div className="app-whatsapp-webhook-note">
          <Cloud size={18} strokeWidth={1.8} />
          <div>
            <p>
              Recomandat: creeaza un Cloudflare Tunnel catre <code>http://localhost:3000</code>, apoi foloseste
              hostname-ul public cu ruta <code>/webhook</code>.
            </p>
            <strong>{canonicalWebhookUrl}</strong>
          </div>
        </div>

        <div className="app-whatsapp-webhook-fields">
          <label>
            <span>Provider tunel</span>
            <NativeSelect
              onChange={(value) => setWebhookProvider(String(value))}
              options={webhookProviderOptions}
              value={webhookProvider}
            />
          </label>
          <label>
            <span>URL webhook</span>
            <NativeInput
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="https://assistant.example.com/webhook"
              type="url"
              value={webhookUrl}
            />
          </label>
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Numere autorizate</h3>
          <p>Default este deny-all. Doar numerele din lista asta pot trimite comenzi catre AI si unelte.</p>
        </div>

        <div className="app-whatsapp-authorized">
          <ShieldCheck size={18} strokeWidth={1.8} />
          <label>
            <span>Lista numere</span>
            <NativeTextarea
              onChange={(event) => setAllowedNumbersText(event.target.value)}
              placeholder="+40722123456&#10;+15551234567"
              rows={4}
              value={allowedNumbersText}
            />
            <small>{allowedNumbers.length} numere autorizate</small>
          </label>
        </div>

        <label className="app-whatsapp-checkbox">
          <NativeSwitch checked={replyToUnauthorized} onChange={setReplyToUnauthorized} />
          <span>Trimite raspuns scurt numerelor neautorizate</span>
        </label>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Agent WhatsApp implicit</h3>
          <p>Agentul selectat aici raspunde la mesajele venite prin WhatsApp.</p>
        </div>
        <label className="app-whatsapp-wide-field">
          <span>Agent implicit</span>
          <NativeSelect
            onChange={(value) => setDefaultProfileId(String(value))}
            options={[
              { label: SIDERA_AGENT_NAME, value: SIDERA_AGENT_ID },
              ...profiles.map((profile) => ({ label: profile.name, value: profile.id })),
            ]}
            placeholder="Alege agent"
            value={defaultProfileId || undefined}
          />
        </label>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-whatsapp-checklist">
          <h3>Checklist setup</h3>
          <div>
            {checklist.map((item) => (
              <span data-done={item.done} key={item.label}>
                <i />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {savedAt && (
        <div className="app-user-profile-actions">
          <span className="app-tools-saved">
            <CheckCircle size={14} strokeWidth={1.8} />
            Salvat local la {savedAt}
          </span>
        </div>
      )}
    </div>
  );
}

function normalizeWebhookUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/webhook') ? trimmed : `${trimmed}/webhook`;
}

function publicBaseFromWebhook(value: string) {
  return value.trim().replace(/\/+$/, '').replace(/\/webhook$/, '');
}

function WebhookSettings({ onRegisterSave }: SaveableSettingsProps) {
  const [provider, setProvider] = useState<TunnelProviderOption>('ngrok');
  const [ngrokAuthToken, setNgrokAuthToken] = useState('');
  const [ngrokPublicUrl, setNgrokPublicUrl] = useState('');
  const [cloudflarePublicUrl, setCloudflarePublicUrl] = useState('');
  const [customPublicUrl, setCustomPublicUrl] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'checking'>('offline');
  const [isNgrokRunning, setIsNgrokRunning] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const manualInput = provider === 'cloudflare' ? cloudflarePublicUrl : customPublicUrl;
  const activeWebhookUrl =
    provider === 'ngrok'
      ? normalizeWebhookUrl(ngrokPublicUrl)
      : normalizeWebhookUrl(manualInput);
  const activePublicUrl = publicBaseFromWebhook(activeWebhookUrl);
  const canUseUrl = activeWebhookUrl.startsWith('https://');

  const checkServer = useCallback(async () => {
    setServerStatus('checking');
    try {
      const status = await window.electronAPI.webhookGetStatus();
      setServerStatus(status.isRunning ? 'online' : 'offline');
    } catch (error) {
      console.error('[Settings] Failed to get webhook status:', error);
      setServerStatus('offline');
    }
  }, []);

  const refreshNgrok = useCallback(async () => {
    try {
      const status = await window.electronAPI.ngrokGetStatus();
      setIsNgrokRunning(status.isRunning);
      setNgrokPublicUrl(status.publicUrl || '');
    } catch (error) {
      console.error('[Settings] Failed to get ngrok status:', error);
    }
  }, []);

  useEffect(() => {
    void Promise.all([window.electronAPI.getConfig(), window.electronAPI.ngrokGetStatus()])
      .then(([config, ngrokStatus]) => {
        const webhook = config.whatsapp?.webhook;
        setProvider((webhook?.provider || 'ngrok') as TunnelProviderOption);
        setNgrokAuthToken(config.ngrok?.authToken || '');
        setIsNgrokRunning(ngrokStatus.isRunning);
        setNgrokPublicUrl(ngrokStatus.publicUrl || '');
        if (webhook?.provider === 'custom') setCustomPublicUrl(webhook.publicUrl || '');
        else setCloudflarePublicUrl(webhook?.publicUrl || '');
        setVerifyToken(config.whatsapp?.businessCloud?.webhookToken || '');
      })
      .catch((error) => console.error('[Settings] Failed to load webhook config:', error));
    void checkServer();

    window.electronAPI.onNgrokStatusChanged((status) => {
      setIsNgrokRunning(status.isRunning);
      setNgrokPublicUrl(status.publicUrl || '');
    });
  }, [checkServer]);

  const saveWebhookConfig = useCallback(async (publicUrl: string) => {
    const config = await window.electronAPI.getConfig();
    await window.electronAPI.setConfig({
      whatsapp: {
        ...(config.whatsapp || { allowedNumbers: [] }),
        webhook: {
          publicUrl: publicBaseFromWebhook(publicUrl),
          provider,
        },
        businessCloud: {
          ...(config.whatsapp?.businessCloud || {
            apiToken: '',
            phoneNumberId: '',
            businessAccountId: '',
            webhookToken: '',
          }),
          webhookToken: verifyToken || config.whatsapp?.businessCloud?.webhookToken || '',
        },
      },
    });
    setStatusMessage('Webhook-ul a fost salvat in configuratie.');
  }, [provider, verifyToken]);

  useTitlebarSave(onRegisterSave, () => saveWebhookConfig(activeWebhookUrl));

  const configureNgrok = async () => {
    const result = await window.electronAPI.ngrokConfigureToken(ngrokAuthToken);
    setStatusMessage(result.message);
    await refreshNgrok();
  };

  const startNgrok = async () => {
    const result = await window.electronAPI.ngrokStart();
    setStatusMessage(result.message);
    await refreshNgrok();
  };

  const stopNgrok = async () => {
    const result = await window.electronAPI.ngrokStop();
    setStatusMessage(result.message);
    await refreshNgrok();
  };

  const copyValue = async (key: string, value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <div className="app-webhook-settings">
      <section className="app-settings-linear-section">
        <div className="app-webhook-status-row">
          <div className="app-webhook-status-main">
            <Server size={19} strokeWidth={1.8} />
            <div>
              <h3>Server webhook local</h3>
              <p>Endpoint local: http://localhost:3000/webhook</p>
            </div>
          </div>
          <div className="app-webhook-status-actions">
            <span data-status={serverStatus}>
              {serverStatus === 'checking'
                ? 'Se verifica...'
                : serverStatus === 'online'
                  ? 'Server local activ'
                  : 'Server local indisponibil'}
            </span>
            <button aria-label="Reverifica serverul local" onClick={checkServer} type="button">
              <RefreshCw size={15} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Provider tunnel</h3>
          <p>Alege cum expui endpoint-ul local in internet pentru Meta WhatsApp sau Twilio.</p>
        </div>

        <div className="app-webhook-provider-list">
          {tunnelProviderOptions.map((item) => (
            <button
              aria-current={provider === item.id ? 'page' : undefined}
              className="app-webhook-provider-row"
              key={item.id}
              onClick={() => setProvider(item.id)}
              type="button"
            >
              <span>{item.title}</span>
              <small>{item.description}</small>
            </button>
          ))}
        </div>
      </section>

      {provider === 'ngrok' && (
        <section className="app-settings-linear-section">
          <div className="app-settings-linear-heading">
            <h3>Ngrok pentru testare</h3>
            <p>Copiaza authtoken-ul din contul ngrok si porneste tunelul catre portul 3000.</p>
          </div>

          <div className="app-webhook-ngrok">
            <label>
              <span>Token ngrok</span>
              <NativeInput
                onChange={(event) => setNgrokAuthToken(event.target.value)}
                placeholder="Introdu token-ul ngrok"
                type="password"
                value={ngrokAuthToken}
              />
            </label>
            <div className="app-webhook-ngrok-actions">
              <button disabled={!ngrokAuthToken.trim()} onClick={configureNgrok} type="button">
                Salveaza token
              </button>
              <button
                disabled={!ngrokAuthToken.trim() || isNgrokRunning}
                onClick={startNgrok}
                type="button"
              >
                <Play size={14} strokeWidth={1.8} />
                Porneste Ngrok
              </button>
              <button disabled={!isNgrokRunning} onClick={stopNgrok} type="button">
                <Square size={14} strokeWidth={1.8} />
                Opreste Ngrok
              </button>
            </div>
          </div>
        </section>
      )}

      {provider === 'cloudflare' && (
        <section className="app-settings-linear-section">
          <div className="app-settings-linear-heading">
            <h3>Cloudflare Zero Trust manual</h3>
            <p>Recomandat pentru setup stabil. Tunnel-ul trimite traficul public catre serverul local.</p>
          </div>

          <ol className="app-webhook-steps">
            <li>In Cloudflare Zero Trust creeaza un Tunnel pentru acest PC.</li>
            <li>Adauga un Public Hostname, de exemplu assistant.example.com.</li>
            <li>Seteaza service-ul catre http://localhost:3000.</li>
            <li>Lipeste mai jos hostname-ul public sau URL-ul complet cu /webhook.</li>
          </ol>

          <label className="app-webhook-url-input">
            <span>URL public Cloudflare</span>
            <NativeInput
              onChange={(event) => setCloudflarePublicUrl(event.target.value)}
              placeholder="https://assistant.example.com"
              type="url"
              value={cloudflarePublicUrl}
            />
          </label>
        </section>
      )}

      {provider === 'custom' && (
        <section className="app-settings-linear-section">
          <div className="app-settings-linear-heading">
            <h3>URL custom/manual</h3>
            <p>Foloseste orice URL public HTTPS care trimite traficul catre http://localhost:3000.</p>
          </div>

          <label className="app-webhook-url-input">
            <span>URL public custom</span>
            <NativeInput
              onChange={(event) => setCustomPublicUrl(event.target.value)}
              placeholder="https://public.example.com"
              type="url"
              value={customPublicUrl}
            />
          </label>
        </section>
      )}

      <section className="app-settings-linear-section">
        <div className="app-settings-linear-heading">
          <h3>Date pentru providerul WhatsApp</h3>
          <p>Valorile de mai jos sunt cele pe care le copiezi in Meta Developers sau Twilio.</p>
        </div>

        <div className="app-webhook-output-list">
          <div>
            <span>Public base URL</span>
            <code>{activePublicUrl || 'Introdu un URL public.'}</code>
            <button disabled={!activePublicUrl} onClick={() => copyValue('public', activePublicUrl)} type="button">
              {copiedKey === 'public' ? <CheckCircle size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <div data-highlight="true">
            <span>Callback URL / Webhook URL</span>
            <code>{activeWebhookUrl || 'URL-ul webhook va aparea aici.'}</code>
            <button disabled={!activeWebhookUrl} onClick={() => copyValue('webhook', activeWebhookUrl)} type="button">
              {copiedKey === 'webhook' ? <CheckCircle size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <div>
            <span>Verify token webhook</span>
            <NativeInput
              onChange={(event) => setVerifyToken(event.target.value)}
              placeholder="Completeaza Verify token webhook"
              value={verifyToken}
            />
            <button disabled={!verifyToken} onClick={() => copyValue('verify', verifyToken)} type="button">
              {copiedKey === 'verify' ? <CheckCircle size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        <div className="app-webhook-apply-row">
          <span>{canUseUrl ? 'URL-ul este pregatit pentru setup.' : 'URL-ul public trebuie sa fie HTTPS.'}</span>
          <button disabled={!canUseUrl} onClick={() => saveWebhookConfig(activeWebhookUrl)} type="button">
            Aplica in WhatsApp setup
          </button>
        </div>
        {statusMessage && <div className="app-logs-message">{statusMessage}</div>}
      </section>
    </div>
  );
}

function formatLogTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  return date.toLocaleString('ro-RO', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  });
}

function formatConversationTimestamp(timestamp?: number | null) {
  if (!timestamp) return 'Fara data';
  return formatLogTimestamp(new Date(timestamp).toISOString());
}

function ArchiveSettings() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadArchive = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const archived = await window.electronAPI.getArchivedConversations();
      setConversations(archived);
    } catch (error) {
      console.error('[Settings] Failed to load archived conversations:', error);
      setMessage('Nu am putut incarca arhiva.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadArchive();
  }, [loadArchive]);

  const restoreConversation = async (conversation: Conversation) => {
    await window.electronAPI.updateConversation(conversation.id, { archivedAt: null });
    setConversations((current) => current.filter((item) => item.id !== conversation.id));
    setMessage('Conversatia a fost restaurata in istoric.');
  };

  const deleteConversation = async (conversation: Conversation) => {
    await window.electronAPI.deleteConversation(conversation.id);
    setConversations((current) => current.filter((item) => item.id !== conversation.id));
    setMessage('Conversatia a fost stearsa permanent.');
  };

  return (
    <div className="app-archive-settings">
      <section className="app-settings-linear-section">
        <div className="app-logs-toolbar">
          <div className="app-settings-linear-heading">
            <h3>Conversatii arhivate</h3>
            <p>Arhiva pastreaza conversatiile, dar le ascunde din istoric si din sidebar.</p>
          </div>
          <div className="app-logs-actions">
            <button disabled={isLoading} onClick={loadArchive} type="button">
              <RefreshCw size={14} strokeWidth={1.8} />
              Reincarca
            </button>
          </div>
        </div>
      </section>

      {message && <div className="app-logs-message">{message}</div>}

      <section className="app-archive-list" aria-label="Conversatii arhivate">
        {conversations.length === 0 ? (
          <div className="app-logs-empty">Nu exista conversatii arhivate.</div>
        ) : (
          conversations.map((conversation) => (
            <article className="app-archive-entry" key={conversation.id}>
              <div>
                <strong>{conversation.name || 'Conversatie fara nume'}</strong>
                <small>
                  {conversation.source === 'whatsapp' ? `WhatsApp ${conversation.whatsappNumber || ''}` : conversation.kind || 'app'}
                  {' - '}
                  {formatConversationTimestamp(conversation.archivedAt)}
                </small>
              </div>
              <div className="app-archive-actions">
                <button onClick={() => restoreConversation(conversation)} type="button">
                  <RefreshCw size={14} strokeWidth={1.8} />
                  Restaureaza
                </button>
                <button onClick={() => deleteConversation(conversation)} type="button">
                  <Trash2 size={14} strokeWidth={1.8} />
                  Sterge
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function LogsSettings() {
  const [logs, setLogs] = useState<ConsoleLogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevelOption>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'main' | 'renderer'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const logsListRef = useRef<HTMLElement | null>(null);

  const filteredLogs = logs
    .filter((log) => {
      const levelMatches = levelFilter === 'all' || log.level === levelFilter;
      const sourceMatches = sourceFilter === 'all' || log.source === sourceFilter;
      return levelMatches && sourceMatches;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const scrollLogs = (position: 'top' | 'bottom') => {
    const list = logsListRef.current;
    if (!list) return;

    const target = position === 'top' ? list.firstElementChild : list.lastElementChild;
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: position === 'top' ? 'start' : 'end' });
      return;
    }

    list.scrollIntoView({ behavior: 'smooth', block: position === 'top' ? 'start' : 'end' });
  };

  const reloadLogs = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const entries = await window.electronAPI.getConsoleLogs();
      setLogs(entries);
      setIsLoading(false);
      setMessage('Log-urile au fost reincarcate.');
    } catch (error) {
      console.error('[Settings] Failed to load logs:', error);
      setIsLoading(false);
      setMessage('Nu am putut incarca log-urile.');
    }
  }, []);

  const clearLogs = async () => {
    await window.electronAPI.clearConsoleLogs();
    setLogs([]);
    setMessage('Log-urile au fost sterse.');
  };

  useEffect(() => {
    void reloadLogs();
  }, [reloadLogs]);

  return (
    <div className="app-logs-settings">
      <section className="app-settings-linear-section">
        <div className="app-logs-toolbar">
          <div className="app-settings-linear-heading">
            <h3>Log-uri consola</h3>
            <p>Aici apar log-urile salvate din procesul principal si din interfata.</p>
          </div>

          <div className="app-logs-actions">
            <button disabled={isLoading} onClick={reloadLogs} type="button">
              <RefreshCw size={14} strokeWidth={1.8} />
              Reincarca
            </button>
            <button className="app-logs-danger-action" disabled={isLoading || logs.length === 0} onClick={clearLogs} type="button">
              <Trash2 size={14} strokeWidth={1.8} />
              Sterge
            </button>
          </div>
        </div>

        <div className="app-logs-stats">
          <div>
            <span>Total</span>
            <strong>{logs.length}</strong>
          </div>
          <div data-tone="error">
            <span>Erori</span>
            <strong>{logs.filter((log) => log.level === 'error').length}</strong>
          </div>
          <div data-tone="warn">
            <span>Avertismente</span>
            <strong>{logs.filter((log) => log.level === 'warn').length}</strong>
          </div>
        </div>
      </section>

      <section className="app-settings-linear-section">
        <div className="app-logs-filters">
          <label>
            <span>Nivel</span>
            <NativeSelect
              onChange={(value) => setLevelFilter(value as 'all' | LogLevelOption)}
              options={[
                { label: 'Toate', value: 'all' },
                { label: 'Log', value: 'log' },
                { label: 'Info', value: 'info' },
                { label: 'Avertismente', value: 'warn' },
                { label: 'Erori', value: 'error' },
              ]}
              value={levelFilter}
            />
          </label>
          <label>
            <span>Sursa</span>
            <NativeSelect
              onChange={(value) => setSourceFilter(value as 'all' | 'main' | 'renderer')}
              options={[
                { label: 'Toate', value: 'all' },
                { label: 'Proces principal', value: 'main' },
                { label: 'Renderer', value: 'renderer' },
              ]}
              value={sourceFilter}
            />
          </label>
        </div>
      </section>

      {message && <div className="app-logs-message">{message}</div>}

      <section className="app-logs-list" aria-label="Log-uri consola" ref={logsListRef}>
        {filteredLogs.length === 0 ? (
          <div className="app-logs-empty">Nu exista log-uri pentru filtrul selectat.</div>
        ) : (
          filteredLogs.map((log) => (
            <article className="app-log-entry" data-level={log.level} key={log.id}>
              <div className="app-log-entry-meta">
                <span className="app-log-level">{log.level}</span>
                <span>{log.source}</span>
                <time>{formatLogTimestamp(log.timestamp)}</time>
              </div>
              <pre>{log.data?.length ? `${log.message} ${JSON.stringify(log.data)}` : log.message}</pre>
            </article>
          ))
        )}
      </section>

      <div className="app-logs-jump-actions" aria-label="Navigare log-uri">
        <button disabled={filteredLogs.length === 0} onClick={() => scrollLogs('top')} title="Mergi sus de tot" type="button">
          <ArrowUpToLine size={14} strokeWidth={1.8} />
          Sus
        </button>
        <button disabled={filteredLogs.length === 0} onClick={() => scrollLogs('bottom')} title="Mergi jos de tot" type="button">
          <ArrowDownToLine size={14} strokeWidth={1.8} />
          Jos
        </button>
      </div>
    </div>
  );
}

function SettingsDetailPage({ pageId, onRegisterSave }: { pageId: SettingsPageId; onRegisterSave?: RegisterSaveHandler }) {
  const detail = settingDetails[pageId];
  const Icon = detail.icon;

  return (
    <section className="app-settings-detail-page" aria-label={detail.title}>
      <div className="app-settings-detail-hero">
        <div className="app-settings-card-visual">
          <Icon size={26} strokeWidth={1.8} />
        </div>
        <div>
          <h2>{detail.title}</h2>
          <p>{detail.description}</p>
        </div>
      </div>

      {pageId === 'ai-connection' ? (
        <AIConnectionSettings onRegisterSave={onRegisterSave} />
      ) : pageId === 'user' ? (
        <UserProfileSettings onRegisterSave={onRegisterSave} />
      ) : pageId === 'tools' ? (
        <ToolsSettings onRegisterSave={onRegisterSave} />
      ) : pageId === 'whatsapp' ? (
        <WhatsAppSettings onRegisterSave={onRegisterSave} />
      ) : pageId === 'webhook' ? (
        <WebhookSettings onRegisterSave={onRegisterSave} />
      ) : pageId === 'logs' ? (
        <LogsSettings />
      ) : pageId === 'archive' ? (
        <ArchiveSettings />
      ) : (
        <div className="app-settings-detail-grid">
          {detail.sections.map((section) => (
            <article className="app-settings-detail-card" key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default SettingsDetailPage;
