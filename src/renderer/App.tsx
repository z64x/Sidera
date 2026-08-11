import { useCallback, useEffect, useState } from 'react';
import { MessageSquarePlus, RotateCcw, Save, X } from 'lucide-react';
import Providers from './app/providers/Providers';
import AppSideNav, { type TitleState } from './app/shell/AppSideNav';
import TitleBar from './app/shell/TitleBar';
import AboutPage from './pages/AboutPage';
import AgentsPage from './pages/AgentsPage';
import ChatPage from './pages/ChatPage';
import SettingsHubPage, { type SettingsPageId } from './pages/SettingsHubPage';
import SettingsDetailPage from './pages/SettingsDetailPage';
import SetupPage from './pages/SetupPage';
import { SIDERA_AGENT_ID, SIDERA_AGENT_NAME } from '../shared/sidera';
import type { Config } from '../shared/types';

interface RouteSnapshot {
  titleState: TitleState;
  settingsPage: SettingsPageId | null;
}

const settingsTitleIconByPage: Record<SettingsPageId, NonNullable<TitleState['settingsIcon']>> = {
  'ai-connection': 'ai',
  user: 'user',
  tools: 'tools',
  whatsapp: 'whatsapp',
  webhook: 'webhook',
  logs: 'logs',
  archive: 'archive',
};

const settingsSaveLabelByPage: Partial<Record<SettingsPageId, string>> = {
  'ai-connection': 'Salveaza AI',
  user: 'Salveaza profil',
  tools: 'Salveaza unelte',
  whatsapp: 'Salveaza WhatsApp',
  webhook: 'Salveaza webhook',
};

const homeTitleState: TitleState = {
  view: 'home',
  activeAgent: SIDERA_AGENT_ID,
  activeRecent: null,
  agentIcon: 'sidera',
  agentName: SIDERA_AGENT_NAME,
};

const setupTitleState: TitleState = {
  view: 'setup',
  activeAgent: SIDERA_AGENT_ID,
  activeRecent: null,
  agentIcon: 'sidera',
  agentName: 'Configurare',
};

function isSetupComplete(config: Config) {
  const provider = config.aiProvider;
  const activeKey =
    config.connectionMode === 'proxy'
      ? config.proxyApiKeys?.[provider]
      : config.apiKeys?.[provider];
  const activeModel = config.selectedModels?.[provider] || config.selectedModel || config.modelProfiles?.primary?.model;

  return Boolean(provider && activeKey?.trim() && activeModel?.trim() && config.databasePath?.trim());
}

function App() {
  const [titleState, setTitleState] = useState<TitleState>(homeTitleState);
  const [isLoadingInitialConfig, setIsLoadingInitialConfig] = useState(true);
  const [setupLocked, setSetupLocked] = useState(false);
  const [activeSettingsPage, setActiveSettingsPage] = useState<SettingsPageId | null>(null);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [agentCreateSaveHandler, setAgentCreateSaveHandler] = useState<(() => void) | null>(null);
  const [settingsSaveHandler, setSettingsSaveHandler] = useState<(() => void) | null>(null);
  const [newConversationHandler, setNewConversationHandler] = useState<(() => void) | null>(null);
  const [navigationRefreshKey, setNavigationRefreshKey] = useState(0);
  const [history, setHistory] = useState<RouteSnapshot[]>([
    {
      titleState: homeTitleState,
      settingsPage: null,
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const forceSetupRoute = useCallback(() => {
    setActiveSettingsPage(null);
    setSettingsSaveHandler(null);
    setIsCreatingAgent(false);
    setAgentCreateSaveHandler(null);
    setTitleState(setupTitleState);
    setHistory([{ titleState: setupTitleState, settingsPage: null }]);
    setHistoryIndex(0);
  }, []);

  useEffect(() => {
    let cancelled = false;

    window.electronAPI
      .getConfig()
      .then((config) => {
        if (cancelled) return;
        const complete = isSetupComplete(config);
        setSetupLocked(!complete);
        if (!complete) {
          forceSetupRoute();
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[App] Failed to load initial config:', error);
        setSetupLocked(true);
        forceSetupRoute();
      })
      .finally(() => {
        if (!cancelled) setIsLoadingInitialConfig(false);
      });

    return () => {
      cancelled = true;
    };
  }, [forceSetupRoute]);

  const registerAgentCreateSaveHandler = useCallback((handler: (() => void) | null) => {
    setAgentCreateSaveHandler(() => handler);
  }, []);

  const registerSettingsSaveHandler = useCallback((handler: (() => void) | null) => {
    setSettingsSaveHandler(() => handler);
  }, []);

  const registerNewConversationHandler = useCallback((handler: (() => void) | null) => {
    setNewConversationHandler(() => handler);
  }, []);

  const pushRoute = (snapshot: RouteSnapshot) => {
    setHistory((current) => {
      const next = current.slice(0, historyIndex + 1);
      next.push(snapshot);
      return next;
    });
    setHistoryIndex((index) => index + 1);
  };

  const applySnapshot = (snapshot: RouteSnapshot) => {
    setSettingsSaveHandler(null);
    setTitleState(snapshot.titleState);
    setActiveSettingsPage(snapshot.settingsPage);
  };

  const handleTitleChange = (nextState: TitleState) => {
    if (setupLocked) return;

    const nextSettingsPage = nextState.view === 'settings' && nextState.settingsPage ? activeSettingsPage : null;

    if (nextState.view !== 'agents') {
      setIsCreatingAgent(false);
      setAgentCreateSaveHandler(null);
    }
    if (nextState.view !== 'settings') {
      setSettingsSaveHandler(null);
    }
    setTitleState(nextState);
    setActiveSettingsPage(nextSettingsPage);
    pushRoute({
      titleState: nextState,
      settingsPage: nextSettingsPage,
    });
  };

  const openSettingsPage = (page: SettingsPageId, title: string) => {
    if (setupLocked) return;

    setSettingsSaveHandler(null);
    setActiveSettingsPage(page);
    const nextTitleState: TitleState = {
      view: 'settings',
      activeAgent: titleState.activeAgent,
      activeRecent: null,
      agentIcon: titleState.agentIcon,
      agentName: titleState.agentName,
      settingsIcon: settingsTitleIconByPage[page],
      settingsPage: title,
    };
    setTitleState(nextTitleState);
    pushRoute({
      titleState: nextTitleState,
      settingsPage: page,
    });
  };

  const openSetupPage = () => {
    const nextTitleState: TitleState = {
      view: 'setup',
      activeAgent: titleState.activeAgent,
      activeRecent: null,
      agentIcon: titleState.agentIcon,
      agentName: 'Configurare',
    };
    setActiveSettingsPage(null);
    setSettingsSaveHandler(null);
    setTitleState(nextTitleState);
    pushRoute({
      titleState: nextTitleState,
      settingsPage: null,
    });
  };

  const openAgentCreator = () => {
    if (setupLocked) return;

    const nextTitleState: TitleState = {
      view: 'agents',
      activeAgent: titleState.activeAgent,
      activeRecent: null,
      agentIcon: titleState.agentIcon,
      agentName: titleState.agentName,
    };
    setActiveSettingsPage(null);
    setSettingsSaveHandler(null);
    setTitleState(nextTitleState);
    setIsCreatingAgent(true);
    pushRoute({
      titleState: nextTitleState,
      settingsPage: null,
    });
  };

  const openAgentChat = (agentId: string, agentName: string) => {
    if (setupLocked) return;

    const nextTitleState: TitleState = {
      view: 'home',
      activeAgent: agentId,
      activeRecent: null,
      agentIcon: 'agent',
      agentName,
    };
    setActiveSettingsPage(null);
    setSettingsSaveHandler(null);
    setTitleState(nextTitleState);
    pushRoute({
      titleState: nextTitleState,
      settingsPage: null,
    });
  };

  const canGoBack = !setupLocked && (isCreatingAgent || historyIndex > 0);
  const canGoForward = !setupLocked && historyIndex < history.length - 1;

  const goBack = () => {
    if (setupLocked) return;

    if (titleState.view === 'agents' && isCreatingAgent) {
      setIsCreatingAgent(false);
      setAgentCreateSaveHandler(null);
      return;
    }

    if (!canGoBack) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    applySnapshot(history[nextIndex]);
    if (history[nextIndex].titleState.view !== 'agents') {
      setIsCreatingAgent(false);
      setAgentCreateSaveHandler(null);
    }
  };

  const goForward = () => {
    if (setupLocked) return;

    if (!canGoForward) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    applySnapshot(history[nextIndex]);
    if (history[nextIndex].titleState.view !== 'agents') {
      setIsCreatingAgent(false);
      setAgentCreateSaveHandler(null);
    }
  };

  const closeAgentCreator = () => {
    if (setupLocked) return;

    setIsCreatingAgent(false);
    setAgentCreateSaveHandler(null);
  };

  const handleSetupComplete = async () => {
    try {
      const config = await window.electronAPI.getConfig();
      if (!isSetupComplete(config)) {
        forceSetupRoute();
        setSetupLocked(true);
        return;
      }
    } catch (error) {
      console.error('[App] Failed to verify setup completion:', error);
      forceSetupRoute();
      setSetupLocked(true);
      return;
    }

    setSetupLocked(false);
    setActiveSettingsPage(null);
    setSettingsSaveHandler(null);
    setTitleState(homeTitleState);
    setHistory([{ titleState: homeTitleState, settingsPage: null }]);
    setHistoryIndex(0);
  };

  const settingsSaveLabel = activeSettingsPage ? settingsSaveLabelByPage[activeSettingsPage] : undefined;
  const startNewConversation = () => {
    newConversationHandler?.();
    setTitleState((current) =>
      current.view === 'home'
        ? {
            ...current,
            activeRecent: null,
          }
        : current
    );
  };

  return (
    <Providers>
      <div className="app-empty-stage">
        <div className="app-sidenav-mount">
          <AppSideNav
            navigationRefreshKey={navigationRefreshKey}
            onCreateAgent={openAgentCreator}
            onTitleChange={handleTitleChange}
            titleState={titleState}
          />
        </div>
        <main className="app-main-stage">
          <TitleBar
            actions={
              titleState.view === 'agents' && isCreatingAgent ? (
                <>
                  <button className="app-titlebar-secondary-action" onClick={closeAgentCreator} type="button">
                    <X size={14} strokeWidth={1.8} />
                    Anuleaza
                  </button>
                  <button className="app-titlebar-primary-action" onClick={() => agentCreateSaveHandler?.()} type="button">
                    <Save size={14} strokeWidth={1.8} />
                    Salveaza agent
                  </button>
                </>
              ) : titleState.view === 'home' ? (
                <button className="app-titlebar-secondary-action" onClick={startNewConversation} type="button">
                  <MessageSquarePlus size={14} strokeWidth={1.8} />
                  Conversatie noua
                </button>
              ) : titleState.view === 'settings' && !activeSettingsPage ? (
                <button className="app-titlebar-secondary-action" onClick={openSetupPage} type="button">
                  <RotateCcw size={14} strokeWidth={1.8} />
                  Inapoi la configurare
                </button>
              ) : titleState.view === 'settings' && settingsSaveLabel ? (
                <button className="app-titlebar-primary-action" onClick={() => settingsSaveHandler?.()} type="button">
                  <Save size={14} strokeWidth={1.8} />
                  {settingsSaveLabel}
                </button>
              ) : undefined
            }
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onBack={goBack}
            onForward={goForward}
            titleState={titleState}
          />
          <div className="app-content-stage">
            {isLoadingInitialConfig && (
              <div className="app-setup-loading">Se incarca...</div>
            )}
            {!isLoadingInitialConfig && titleState.view === 'setup' && (
              <SetupPage lockUntilComplete={setupLocked} onComplete={setupLocked ? handleSetupComplete : goBack} />
            )}
            {!isLoadingInitialConfig && titleState.view === 'home' && (
              <ChatPage
                activeRecent={titleState.activeRecent}
                agentId={titleState.activeAgent ?? SIDERA_AGENT_ID}
                agentName={titleState.agentName}
                onConversationsChanged={() => setNavigationRefreshKey((key) => key + 1)}
                onRegisterNewConversation={registerNewConversationHandler}
                onSelectAgent={openAgentChat}
              />
            )}
            {!isLoadingInitialConfig && titleState.view === 'agents' && (
              <AgentsPage
                isCreating={isCreatingAgent}
                onAgentSaved={() => {
                  setIsCreatingAgent(false);
                  setAgentCreateSaveHandler(null);
                  setNavigationRefreshKey((key) => key + 1);
                }}
                onCreateAgent={() => setIsCreatingAgent(true)}
                onRegisterSave={registerAgentCreateSaveHandler}
              />
            )}
            {!isLoadingInitialConfig && titleState.view === 'about' && <AboutPage />}
            {!isLoadingInitialConfig && titleState.view === 'settings' &&
              (activeSettingsPage ? (
                <SettingsDetailPage pageId={activeSettingsPage} onRegisterSave={registerSettingsSaveHandler} />
              ) : (
                <SettingsHubPage onOpenPage={openSettingsPage} />
              ))}
          </div>
        </main>
      </div>
    </Providers>
  );
}

export default App;
