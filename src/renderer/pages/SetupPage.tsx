import { ArrowRight, Bot, Check, Database, FolderOpen, Globe, Key, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AIConnectionMode, AIProvider, Config, ModelInfo } from '../../shared/types';

interface SetupPageProps {
  lockUntilComplete?: boolean;
  onComplete: () => void;
}

const providerOptions: Array<{ id: AIProvider; label: string; description: string }> = [
  { id: 'gemini', label: 'Google Gemini', description: 'Provider rapid pentru chat si tool-use.' },
  { id: 'openai', label: 'OpenAI', description: 'Provider general pentru modele GPT.' },
  { id: 'deepseek', label: 'DeepSeek', description: 'Provider compatibil pentru chat rapid.' },
  { id: 'claude', label: 'Claude', description: 'Provider Anthropic pentru raspunsuri ample.' },
];

function defaultModelForProvider(provider: AIProvider) {
  if (provider === 'openai') return 'gpt-4o-mini';
  if (provider === 'deepseek') return 'deepseek-v4-flash';
  if (provider === 'claude') return 'claude-3-5-sonnet-latest';
  return 'gemini-2.5-flash';
}

function getActiveKey(config: Config, provider: AIProvider, mode: AIConnectionMode) {
  return mode === 'proxy' ? config.proxyApiKeys?.[provider] || '' : config.apiKeys?.[provider] || '';
}

function getActiveProxyUrl(config: Config, provider: AIProvider) {
  return config.proxyBaseUrls?.[provider] || '';
}

function SetupPage({ lockUntilComplete = false, onComplete }: SetupPageProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [connectionMode, setConnectionMode] = useState<AIConnectionMode>('direct');
  const [apiKey, setApiKey] = useState('');
  const [proxyBaseUrl, setProxyBaseUrl] = useState('');
  const [databasePath, setDatabasePath] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.electronAPI
      .getConfig()
      .then((nextConfig) => {
        if (cancelled) return;
        const nextProvider = nextConfig.aiProvider || 'gemini';
        const nextMode = nextConfig.connectionMode || 'direct';
        setConfig(nextConfig);
        setProvider(nextProvider);
        setConnectionMode(nextMode);
        setApiKey(getActiveKey(nextConfig, nextProvider, nextMode));
        setProxyBaseUrl(getActiveProxyUrl(nextConfig, nextProvider));
        setDatabasePath(nextConfig.databasePath || '');
        setSelectedModel(nextConfig.selectedModels?.[nextProvider] || nextConfig.selectedModel || defaultModelForProvider(nextProvider));
      })
      .catch((error) => {
        console.error('[Setup] Failed to load config:', error);
        setStatusText('Nu am putut incarca setarile curente.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const canLoadModels = useMemo(() => {
    if (!apiKey.trim()) return false;
    if (connectionMode === 'proxy' && !proxyBaseUrl.trim()) return false;
    return true;
  }, [apiKey, connectionMode, proxyBaseUrl]);

  const handleProviderSelect = (nextProvider: AIProvider) => {
    setProvider(nextProvider);
    setApiKey(config ? getActiveKey(config, nextProvider, connectionMode) : '');
    setProxyBaseUrl(config ? getActiveProxyUrl(config, nextProvider) : '');
    setSelectedModel(config?.selectedModels?.[nextProvider] || defaultModelForProvider(nextProvider));
    setModels([]);
    setStatusText(null);
  };

  const handleModeSelect = (nextMode: AIConnectionMode) => {
    setConnectionMode(nextMode);
    setApiKey(config ? getActiveKey(config, provider, nextMode) : '');
    setStatusText(null);
  };

  const handleLoadModels = async () => {
    if (!canLoadModels) return;

    setLoadingModels(true);
    setStatusText(null);
    try {
      const isValid = await window.electronAPI.validateAPIKey(provider, apiKey, {
        connectionMode,
        proxyBaseUrl: connectionMode === 'proxy' ? proxyBaseUrl : undefined,
      });
      if (!isValid) {
        setModels([]);
        setStatusText('Cheia sau conexiunea nu a putut fi validata.');
        return;
      }

      const nextModels = await window.electronAPI.getAvailableModels(provider, apiKey, {
        connectionMode,
        proxyBaseUrl: connectionMode === 'proxy' ? proxyBaseUrl : undefined,
      });
      setModels(nextModels);
      setSelectedModel((current) => {
        if (current && nextModels.some((model) => model.id === current)) return current;
        return nextModels[0]?.id || defaultModelForProvider(provider);
      });
      setStatusText('Conexiunea este valida.');
    } catch (error) {
      console.error('[Setup] Failed to validate setup:', error);
      setModels([]);
      setStatusText('Nu am putut valida conexiunea.');
    } finally {
      setLoadingModels(false);
    }
  };

  const handleBrowseDatabase = async () => {
    const selectedPath = await window.electronAPI.selectFolder();
    if (selectedPath) setDatabasePath(selectedPath);
  };

  const handleSave = async () => {
    if (!config) {
      setStatusText('Configuratia inca se incarca.');
      return;
    }

    if (!apiKey.trim()) {
      setStatusText('Cheia API este obligatorie.');
      return;
    }

    if (connectionMode === 'proxy' && !proxyBaseUrl.trim()) {
      setStatusText('URL-ul proxy este obligatoriu pentru modul Proxy.');
      return;
    }

    if (!selectedModel.trim()) {
      setStatusText('Modelul principal este obligatoriu.');
      return;
    }

    if (!databasePath.trim()) {
      setStatusText('Alege un path pentru baza de date ca sa poti iesi din setup.');
      return;
    }

    setSaving(true);
    setStatusText(null);
    try {
      await window.electronAPI.setConfig({
        aiProvider: provider,
        connectionMode,
        apiKeys: {
          ...config.apiKeys,
          [provider]: connectionMode === 'direct' ? apiKey : config.apiKeys?.[provider] || '',
        },
        proxyApiKeys: {
          ...config.proxyApiKeys,
          [provider]: connectionMode === 'proxy' ? apiKey : config.proxyApiKeys?.[provider] || '',
        },
        proxyBaseUrls: {
          ...config.proxyBaseUrls,
          [provider]: proxyBaseUrl,
        },
        selectedModels: {
          ...config.selectedModels,
          [provider]: selectedModel,
        },
        selectedModel,
        modelProfiles: {
          primary: {
            ...(config.modelProfiles?.primary || { maxResponseTokens: 4096, contextSizeTokens: 128000 }),
            model: selectedModel,
          },
          secondary: {
            ...(config.modelProfiles?.secondary || { maxResponseTokens: 2048, contextSizeTokens: 32000 }),
            model: config.modelProfiles?.secondary?.model || selectedModel,
          },
        },
        databasePath,
      });
      onComplete();
    } catch (error) {
      console.error('[Setup] Failed to save setup:', error);
      setStatusText('Esec la salvarea configuratiei.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-setup-page" aria-label="Configurare">
      <div className="app-setup-hero">
        <span>
          <Sparkles size={28} strokeWidth={1.8} />
        </span>
        <div>
          <h2>Configurare</h2>
          <p>
            {lockUntilComplete
              ? 'Completeaza configuratia initiala. Nu poti parasi configurarea fara provider, cheie, model si path pentru baza de date.'
              : 'Refa configuratia principala pentru provider, conexiune, model si baza de date.'}
          </p>
        </div>
      </div>

      <div className="app-setup-section">
        <div className="app-setup-section-heading">
          <Bot size={16} strokeWidth={1.8} />
          <h3>Provider AI</h3>
        </div>
        <div className="app-setup-provider-grid">
          {providerOptions.map((option) => (
            <button
              data-active={provider === option.id}
              key={option.id}
              onClick={() => handleProviderSelect(option.id)}
              type="button"
            >
              <strong>{option.label}</strong>
              <small>{option.description}</small>
              {provider === option.id && <Check size={16} strokeWidth={1.8} />}
            </button>
          ))}
        </div>
      </div>

      <div className="app-setup-section">
        <div className="app-setup-section-heading">
          <Globe size={16} strokeWidth={1.8} />
          <h3>Conexiune</h3>
        </div>
        <div className="app-setup-segmented">
          <button data-active={connectionMode === 'direct'} onClick={() => handleModeSelect('direct')} type="button">
            Direct
          </button>
          <button data-active={connectionMode === 'proxy'} onClick={() => handleModeSelect('proxy')} type="button">
            Proxy
          </button>
        </div>

        {connectionMode === 'proxy' && (
          <label className="app-setup-field">
            <span>URL proxy</span>
            <input
              className="app-settings-native-input"
              onChange={(event) => setProxyBaseUrl(event.target.value)}
              placeholder="https://proxy.example.com/v1"
              type="text"
              value={proxyBaseUrl}
            />
          </label>
        )}

        <label className="app-setup-field">
          <span>{connectionMode === 'proxy' ? 'Cheie proxy' : 'Cheie API'}</span>
          <input
            className="app-settings-native-input"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Introdu cheia pentru providerul selectat"
            type="password"
            value={apiKey}
          />
        </label>

        <button className="app-setup-inline-action" disabled={!canLoadModels || loadingModels} onClick={handleLoadModels} type="button">
          <Key size={15} strokeWidth={1.8} />
          {loadingModels ? 'Se verifica...' : 'Verifica si incarca modele'}
        </button>
      </div>

      <div className="app-setup-section">
        <div className="app-setup-section-heading">
          <Bot size={16} strokeWidth={1.8} />
          <h3>Model</h3>
        </div>
        <label className="app-setup-field">
          <span>Model principal</span>
          {models.length > 0 ? (
            <select
              className="app-settings-native-input app-settings-native-select"
              onChange={(event) => setSelectedModel(event.target.value)}
              value={selectedModel}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name || model.id}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="app-settings-native-input"
              onChange={(event) => setSelectedModel(event.target.value)}
              placeholder={defaultModelForProvider(provider)}
              type="text"
              value={selectedModel}
            />
          )}
        </label>
      </div>

      <div className="app-setup-section">
        <div className="app-setup-section-heading">
          <Database size={16} strokeWidth={1.8} />
          <h3>Baza de date</h3>
        </div>
        <div className="app-setup-browse-row">
          <input
            className="app-settings-native-input"
            onChange={(event) => setDatabasePath(event.target.value)}
            placeholder="Alege dosarul pentru datele aplicatiei"
            type="text"
            value={databasePath}
          />
          <button className="app-setup-inline-action" onClick={handleBrowseDatabase} type="button">
            <FolderOpen size={15} strokeWidth={1.8} />
            Rasfoieste
          </button>
        </div>
      </div>

      <div className="app-setup-footer">
        {statusText && <span>{statusText}</span>}
        <button className="app-setup-save" disabled={saving} onClick={handleSave} type="button">
          {saving ? 'Se salveaza...' : 'Finalizeaza configurarea'}
          <ArrowRight size={15} strokeWidth={1.8} />
        </button>
      </div>
    </section>
  );
}

export default SetupPage;
