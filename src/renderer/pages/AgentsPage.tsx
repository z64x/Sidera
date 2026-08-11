import {
  Bot,
  Brain,
  Edit3,
  Eye,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeFile, Profile, ToolId } from '../../shared/types';
import { normalizeProfileToolIds, TOOL_CATALOG } from '../../shared/toolCatalog';
import { SIDERA_AGENT_ID, SIDERA_AGENT_NAME } from '../../shared/sidera';
import { getEmojiList } from '../fixtures/getEmojiList';

type AgentStatus = 'active' | 'inactive' | 'needs-setup';

interface AgentView {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  instructions: string;
  tools: string[];
  knowledge: string[];
  avatarEmoji: string;
  avatarUrl?: string;
  profile?: Profile;
  isSidera?: boolean;
}

const statusLabel: Record<AgentStatus, string> = {
  active: 'Activ',
  inactive: 'Inactiv',
  'needs-setup': 'Necesita configurare',
};

const templateOptions = [
  {
    id: 'general',
    name: 'Asistent general',
    description: 'Agent general pentru task-uri zilnice.',
    instructions: 'Raspunde clar, pragmatic si cere confirmare pentru actiuni riscante.',
  },
  {
    id: 'research',
    name: 'Agent de cercetare',
    description: 'Agent pentru cautare si verificare.',
    instructions: 'Cauta informatii, compara surse si marcheaza incertitudinea.',
  },
  {
    id: 'operator',
    name: 'Operator',
    description: 'Agent pentru actiuni si automatizari locale.',
    instructions: 'Executa actiuni doar cand cerinta este clara si foloseste confirmari pentru risc.',
  },
];

const agentEmojiOptions = Array.from(new Set(getEmojiList));
const toolOptions = TOOL_CATALOG.map((tool) => ({
  id: tool.id,
  label: tool.label,
  description: tool.description,
}));

const fileFilters = [
  { name: 'Documente', extensions: ['txt', 'md', 'json', 'csv', 'pdf', 'docx'] },
  { name: 'Fisiere text', extensions: ['txt', 'md', 'json', 'csv'] },
  { name: 'Fisiere PDF', extensions: ['pdf'] },
  { name: 'Fisiere Word', extensions: ['docx'] },
  { name: 'Imagini', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
  { name: 'Toate fisierele', extensions: ['*'] },
];

const imageFilters = [
  { name: 'Imagini', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
  { name: 'Toate fisierele', extensions: ['*'] },
];

function basename(filePath: string) {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function createTempKnowledgeFile(filePath: string): KnowledgeFile {
  const name = basename(filePath);
  const extension = name.split('.').pop()?.toLowerCase();
  const type: KnowledgeFile['type'] =
    extension === 'pdf'
      ? 'pdf'
      : extension === 'docx'
        ? 'docx'
      : ['png', 'jpg', 'jpeg', 'webp'].includes(extension || '')
        ? 'image'
        : ['txt', 'md', 'json', 'csv'].includes(extension || '')
          ? 'text'
          : 'other';

  return {
    id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    path: filePath,
    type,
    size: 0,
    addedAt: Date.now(),
    status: 'pending',
    chunksProcessed: 0,
  };
}

function profileToAgentView(
  profile: Profile,
  activeProfileId: string | null,
  avatarUrls: Record<string, string>,
): AgentView {
  const tools = normalizeProfileToolIds(profile.defaultTool)
    .map((toolId) => TOOL_CATALOG.find((tool) => tool.id === toolId)?.label || toolId)
    .filter(Boolean);

  return {
    id: profile.id,
    name: profile.name,
    description: profile.description || 'Agent fara descriere.',
    status: profile.isActive === false ? 'inactive' : 'active',
    instructions: profile.instructions || 'Nu are instructiuni definite.',
    tools,
    knowledge: (profile.knowledgeFiles || []).map((file) => file.name),
    avatarEmoji: profile.avatarEmoji || profile.name.charAt(0).toUpperCase() || String.fromCodePoint(0x1f916),
    avatarUrl: avatarUrls[profile.id],
    profile,
  };
}

function getKnowledgeStatus(file: KnowledgeFile): { label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' } {
  const status = file.status || 'indexed';
  if (status === 'processing') return { label: 'Se proceseaza...', tone: 'neutral' };
  if (status === 'pending') return { label: 'In asteptare', tone: 'neutral' };
  if (status === 'indexed') return { label: `Indexat: ${file.chunksProcessed || 0} bucati`, tone: 'success' };
  if (status === 'unsupported') return { label: 'Format neacceptat', tone: 'warning' };
  return { label: file.error || 'Eroare la indexare', tone: 'danger' };
}

function AgentsPage({
  isCreating,
  onCreateAgent,
  onRegisterSave,
  onAgentSaved,
}: {
  isCreating: boolean;
  onCreateAgent: () => void;
  onRegisterSave: (handler: (() => void) | null) => void;
  onAgentSaved: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [whatsAppAgentId, setWhatsAppAgentId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState(SIDERA_AGENT_ID);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openAgentMenuId, setOpenAgentMenuId] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    try {
      const [allProfiles, active, whatsAppDefault] = await Promise.all([
        window.electronAPI.getAllProfiles(),
        window.electronAPI.getActiveProfile(),
        window.electronAPI.getWhatsAppDefaultProfile(),
      ]);

      setProfiles(allProfiles);
      setActiveProfileId(active?.id || null);
      setWhatsAppAgentId(whatsAppDefault?.id || null);
      setLoadError(null);

      const avatarEntries = await Promise.all(
        allProfiles.map(async (profile) => {
          if (!profile.avatarImagePath) return [profile.id, null] as const;
          try {
            return [profile.id, await window.electronAPI.getFileDataUrl(profile.avatarImagePath)] as const;
          } catch {
            return [profile.id, null] as const;
          }
        }),
      );

      const nextAvatarUrls: Record<string, string> = {};
      for (const [id, url] of avatarEntries) {
        if (url) nextAvatarUrls[id] = url;
      }
      setAvatarUrls(nextAvatarUrls);
    } catch (error) {
      console.error('[Agents] Failed to load profiles:', error);
      setLoadError('Nu am putut incarca profilurile.');
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    const unsubscribeProfilesChanged = window.electronAPI.onProfilesChanged(() => {
      void loadProfiles();
    });
    const unsubscribeActiveProfileChanged = window.electronAPI.onActiveProfileChanged(() => {
      void loadProfiles();
    });
    const unsubscribeWhatsAppDefaultProfileChanged = window.electronAPI.onWhatsAppDefaultProfileChanged((profileId) => {
      setWhatsAppAgentId(profileId);
    });

    return () => {
      unsubscribeProfilesChanged();
      unsubscribeActiveProfileChanged();
      unsubscribeWhatsAppDefaultProfileChanged();
    };
  }, [loadProfiles]);

  const agentViews = useMemo<AgentView[]>(() => {
    const homeAgent: AgentView = {
      id: SIDERA_AGENT_ID,
      name: SIDERA_AGENT_NAME,
      description: 'Super agent care orchestreaza subagenti ascunsi pentru taskuri complexe.',
      status: 'active',
      instructions: 'Coordoneaza Planner, Code Specialist si Reviewer fara sa schimbe conversatia principala.',
      tools: ['Orchestrare multiagent', 'Planner', 'Code Specialist', 'Reviewer'],
      knowledge: [],
      avatarEmoji: String.fromCodePoint(0x2728),
      isSidera: true,
    };

    return [homeAgent, ...profiles.map((profile) => profileToAgentView(profile, activeProfileId, avatarUrls))];
  }, [activeProfileId, avatarUrls, profiles]);

  const selectedAgent = agentViews.find((agent) => agent.id === selectedAgentId) || agentViews[0];
  const selectedIsWhatsAppAgent = selectedAgent.id === whatsAppAgentId;

  useEffect(() => {
    if (selectedAgentId !== SIDERA_AGENT_ID && !profiles.some((profile) => profile.id === selectedAgentId)) {
      setSelectedAgentId(SIDERA_AGENT_ID);
    }
  }, [profiles, selectedAgentId]);

  if (isCreating) {
    return (
      <AgentCreatePage
        initialProfile={editingProfile}
        onRegisterSave={onRegisterSave}
        onSaved={async (savedProfile) => {
          await loadProfiles();
          setSelectedAgentId(savedProfile.id);
          setEditingProfile(null);
          onAgentSaved();
        }}
      />
    );
  }

  const toggleAgentAvailability = async (profile: Profile) => {
    const nextIsActive = profile.isActive === false;
    try {
      const updated = await window.electronAPI.updateProfile(profile.id, { isActive: nextIsActive });
      if (updated) {
        setProfiles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      }
      setSelectedAgentId(profile.id);
    } catch (error) {
      console.error('[Agents] Failed to toggle agent availability:', error);
    }
  };

  const setWhatsAppAgent = async (agentId: string) => {
    try {
      await window.electronAPI.setWhatsAppDefaultProfile(agentId);
      setWhatsAppAgentId(agentId);
      setSelectedAgentId(agentId);
    } catch (error) {
      console.error('[Agents] Failed to set WhatsApp agent:', error);
    }
  };

  const deleteAgent = async (profile: Profile) => {
    if (!confirm(`Stergi agentul "${profile.name}"?`)) return;

    try {
      const deleted = await window.electronAPI.deleteProfile(profile.id);
      if (!deleted) return;
      if (activeProfileId === profile.id) {
        await window.electronAPI.setActiveProfile(null);
      }
      if (whatsAppAgentId === profile.id) {
        await window.electronAPI.setWhatsAppDefaultProfile(null);
      }
      setSelectedAgentId(SIDERA_AGENT_ID);
      await loadProfiles();
    } catch (error) {
      console.error('[Agents] Failed to delete profile:', error);
    }
  };

  return (
    <section className="app-agents-page" aria-label="Agenti">
      <div className="app-agents-main">
        <div className="app-agents-heading">
          <h2>Agenti</h2>
          <p>Administreaza agentii reali ai aplicatiei: agent activ, agent WhatsApp, instructiuni, unelte si knowledge.</p>
          {loadError && <small className="app-agent-inline-error">{loadError}</small>}
        </div>

        <div className="app-agents-grid">
          <button
            className="app-agent-card app-agent-create-card"
            onClick={() => {
              setEditingProfile(null);
              onCreateAgent();
            }}
            type="button"
          >
            <span>
              <Plus size={22} strokeWidth={1.8} />
            </span>
            <strong>Agent nou</strong>
            <p>Creeaza un agent cu instructiuni, unelte si fisiere proprii.</p>
          </button>

          {agentViews.map((agent) => {
            const isInactive = agent.status === 'inactive';
            const isWhatsAppAgent = agent.id === whatsAppAgentId;

            return (
              <div
                aria-current={selectedAgentId === agent.id ? 'page' : undefined}
                aria-label={`Selecteaza ${agent.name}`}
                className="app-agent-card"
                key={agent.id}
                onClick={() => {
                  setSelectedAgentId(agent.id);
                  setOpenAgentMenuId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedAgentId(agent.id);
                    setOpenAgentMenuId(null);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="app-agent-card-icon">
                  {agent.avatarUrl ? (
                    <img alt="" draggable={false} src={agent.avatarUrl} />
                  ) : agent.isSidera ? (
                    <Sparkles size={21} strokeWidth={1.8} />
                  ) : agent.profile?.avatarEmoji ? (
                    <span className="app-agent-card-emoji">{agent.avatarEmoji}</span>
                  ) : (
                    <Bot size={21} strokeWidth={1.8} />
                  )}
                </span>
                <strong className="app-agent-card-name">
                  {agent.name}
                  {agent.isSidera && <Pin className="app-agent-pin" size={12} strokeWidth={1.9} />}
                  {isWhatsAppAgent && <MessageCircle className="app-agent-whatsapp-pin" size={13} strokeWidth={1.9} />}
                </strong>
                <p>{agent.description}</p>
                <small data-status={agent.status}>{statusLabel[agent.status]}</small>
                <button
                  aria-expanded={openAgentMenuId === agent.id}
                  aria-label={`Optiuni pentru ${agent.name}`}
                  className="app-agent-card-menu"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenAgentMenuId((current) => (current === agent.id ? null : agent.id));
                  }}
                  type="button"
                >
                  <MoreHorizontal size={14} strokeWidth={1.9} />
                </button>
                {openAgentMenuId === agent.id && (
                  <div className="app-agent-card-menu-panel" onClick={(event) => event.stopPropagation()} role="menu">
                    {agent.profile ? (
                      <>
                        <button
                          onClick={() => {
                            setOpenAgentMenuId(null);
                            setSelectedAgentId(agent.id);
                            setEditingProfile(agent.profile || null);
                            onCreateAgent();
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Edit3 size={13} strokeWidth={1.8} />
                          Editeaza
                        </button>
                        <button
                          onClick={() => {
                            setOpenAgentMenuId(null);
                            if (agent.profile) void toggleAgentAvailability(agent.profile);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Eye size={13} strokeWidth={1.8} />
                          {isInactive ? 'Activeaza agent' : 'Agent activ'}
                        </button>
                        <button
                          onClick={() => {
                            setOpenAgentMenuId(null);
                            void setWhatsAppAgent(agent.id);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <MessageCircle size={13} strokeWidth={1.8} />
                          {isWhatsAppAgent ? 'WhatsApp Agent activ' : 'WhatsApp Agent'}
                        </button>
                        <button
                          onClick={() => {
                            setOpenAgentMenuId(null);
                            if (agent.profile) void deleteAgent(agent.profile);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                          Sterge
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setOpenAgentMenuId(null);
                            void setWhatsAppAgent(agent.id);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <MessageCircle size={13} strokeWidth={1.8} />
                          {isWhatsAppAgent ? 'WhatsApp Agent activ' : 'WhatsApp Agent'}
                        </button>
                        <button
                          onClick={() => {
                            setOpenAgentMenuId(null);
                            setSelectedAgentId(agent.id);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Eye size={13} strokeWidth={1.8} />
                          Sidera workspace
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="app-agent-preview" aria-label="Preview agent">
        <div className="app-agent-preview-header">
          <div className="app-agent-preview-avatar">
            {selectedAgent.avatarUrl ? (
              <img alt="" draggable={false} src={selectedAgent.avatarUrl} />
            ) : selectedAgent.isSidera ? (
              <Sparkles size={28} strokeWidth={1.8} />
            ) : selectedAgent.profile?.avatarEmoji ? (
              <span className="app-agent-preview-emoji">{selectedAgent.avatarEmoji}</span>
            ) : (
              <Bot size={28} strokeWidth={1.8} />
            )}
          </div>
          <div>
            <h3>
              {selectedAgent.name}
              {selectedAgent.id === SIDERA_AGENT_ID && <Pin className="app-agent-pin" size={12} strokeWidth={1.9} />}
              {selectedIsWhatsAppAgent && <MessageCircle className="app-agent-whatsapp-pin" size={13} strokeWidth={1.9} />}
            </h3>
            <div className="app-agent-preview-meta">
              <span data-status={selectedAgent.status}>{statusLabel[selectedAgent.status]}</span>
              {selectedIsWhatsAppAgent && <span data-status="whatsapp">WhatsApp Agent</span>}
            </div>
          </div>
        </div>

        <p className="app-agent-preview-description">{selectedAgent.description}</p>

        <div className="app-agent-preview-section">
          <h4>
            <Brain size={14} strokeWidth={1.8} />
            Instructiuni
          </h4>
          <p>{selectedAgent.instructions}</p>
        </div>

        <div className="app-agent-preview-section">
          <h4>
            <Wrench size={14} strokeWidth={1.8} />
            Unelte
          </h4>
          <div className="app-agent-preview-tags">
            {selectedAgent.tools.length > 0 ? selectedAgent.tools.map((tool) => <span key={tool}>{tool}</span>) : <span>Nicio unealta</span>}
          </div>
        </div>

        {(!selectedAgent.isSidera || selectedAgent.knowledge.length > 0) && (
          <div className="app-agent-preview-section">
            <h4>
              <FileText size={14} strokeWidth={1.8} />
              Cunostinte
            </h4>
            <div className="app-agent-preview-tags">
              {selectedAgent.knowledge.length > 0
                ? selectedAgent.knowledge.map((item) => <span key={item}>{item}</span>)
                : <span>Nicio cunostinta</span>}
            </div>
          </div>
        )}

        <div className="app-agent-preview-section">
          <h4>
            <ShieldCheck size={14} strokeWidth={1.8} />
            Reguli
          </h4>
          <p>Profilul activ controleaza rutarea normala. Profilul WhatsApp este folosit pentru mesajele remote.</p>
        </div>

        {selectedAgent.profile && (
          <button
            className="app-agent-preview-action"
            onClick={() => {
              setEditingProfile(selectedAgent.profile || null);
              onCreateAgent();
            }}
            type="button"
          >
            <Search size={14} strokeWidth={1.8} />
            Editeaza detalii
          </button>
        )}
      </aside>
    </section>
  );
}

function AgentCreatePage({
  initialProfile,
  onRegisterSave,
  onSaved,
}: {
  initialProfile: Profile | null;
  onRegisterSave: (handler: (() => void) | null) => void;
  onSaved: (profile: Profile) => void | Promise<void>;
}) {
  const isEditing = Boolean(initialProfile);
  const [name, setName] = useState(initialProfile?.name ?? '');
  const [description, setDescription] = useState(initialProfile?.description ?? '');
  const [instructions, setInstructions] = useState(initialProfile?.instructions ?? '');
  const [avatarMode, setAvatarMode] = useState<'emoji' | 'image'>(initialProfile?.avatarImagePath ? 'image' : 'emoji');
  const [avatarEmoji, setAvatarEmoji] = useState(initialProfile?.avatarEmoji || String.fromCodePoint(0x1f916));
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [avatarImagePath, setAvatarImagePath] = useState(initialProfile?.avatarImagePath || '');
  const [avatarImageUrl, setAvatarImageUrl] = useState<string | null>(null);
  const [avatarImageName, setAvatarImageName] = useState(initialProfile?.avatarImagePath ? basename(initialProfile.avatarImagePath) : '');
  const [tools, setTools] = useState<ToolId[]>(normalizeProfileToolIds(initialProfile?.defaultTool));
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>(initialProfile?.knowledgeFiles || []);
  const [statusText, setStatusText] = useState<string | null>(null);

  useEffect(() => {
    setName(initialProfile?.name ?? '');
    setDescription(initialProfile?.description ?? '');
    setInstructions(initialProfile?.instructions ?? '');
    setAvatarMode(initialProfile?.avatarImagePath ? 'image' : 'emoji');
    setAvatarEmoji(initialProfile?.avatarEmoji || String.fromCodePoint(0x1f916));
    setAvatarImagePath(initialProfile?.avatarImagePath || '');
    setAvatarImageName(initialProfile?.avatarImagePath ? basename(initialProfile.avatarImagePath) : '');
    setTools(normalizeProfileToolIds(initialProfile?.defaultTool));
    setKnowledgeFiles(initialProfile?.knowledgeFiles || []);
    setStatusText(null);
  }, [initialProfile]);

  useEffect(() => {
    let cancelled = false;
    setAvatarImageUrl(null);

    if (!avatarImagePath) return;

    window.electronAPI
      .getFileDataUrl(avatarImagePath)
      .then((url) => {
        if (!cancelled) setAvatarImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setAvatarImageUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [avatarImagePath]);

  const applyTemplate = (template: (typeof templateOptions)[number]) => {
    setName(template.name);
    setDescription(template.description);
    setInstructions(template.instructions);
  };

  const toggleTool = (toolId: ToolId, enabled: boolean) => {
    setTools((current) => {
      const next = new Set(current);
      if (enabled) next.add(toolId);
      else next.delete(toolId);
      return [...next];
    });
  };

  const pickAvatarImage = async () => {
    try {
      const filePath = await window.electronAPI.selectFile(imageFilters);
      if (!filePath) return;

      setAvatarMode('image');
      setAvatarEmoji('');
      setAvatarImagePath(filePath);
      setAvatarImageName(basename(filePath));

      if (initialProfile) {
        const updated = await window.electronAPI.setProfileAvatarImage(initialProfile.id, filePath);
        if (updated?.avatarImagePath) {
          setAvatarImagePath(updated.avatarImagePath);
          setAvatarImageName(basename(updated.avatarImagePath));
        }
      }
    } catch (error) {
      console.error('[Agents] Failed to pick avatar image:', error);
      setStatusText('Nu am putut selecta poza.');
    }
  };

  const removeAvatarImage = async () => {
    try {
      setAvatarMode('emoji');
      setAvatarImagePath('');
      setAvatarImageUrl(null);
      setAvatarImageName('');

      if (initialProfile) {
        await window.electronAPI.setProfileAvatarImage(initialProfile.id, null);
      }
    } catch (error) {
      console.error('[Agents] Failed to remove avatar image:', error);
      setStatusText('Nu am putut sterge poza de profil.');
    }
  };

  const addKnowledgeFile = async () => {
    try {
      const filePath = await window.electronAPI.selectFile(fileFilters);
      if (!filePath) return;

      if (initialProfile) {
        const tempFile = createTempKnowledgeFile(filePath);
        tempFile.status = 'processing';
        setKnowledgeFiles((current) => [...current, tempFile]);
        const added = await window.electronAPI.addKnowledgeFile(initialProfile.id, filePath);
        setKnowledgeFiles((current) =>
          current.map((file) => (file.id === tempFile.id ? added || { ...tempFile, status: 'failed', error: 'Nu am putut indexa fisierul.' } : file))
        );
      } else {
        setKnowledgeFiles((current) => [...current, createTempKnowledgeFile(filePath)]);
      }
    } catch (error) {
      console.error('[Agents] Failed to add knowledge file:', error);
      setStatusText('Nu am putut adauga fisierul knowledge.');
    }
  };

  const removeKnowledgeFile = async (file: KnowledgeFile) => {
    try {
      if (initialProfile && !file.id.startsWith('temp-')) {
        await window.electronAPI.removeKnowledgeFile(initialProfile.id, file.id);
      }
      setKnowledgeFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (error) {
      console.error('[Agents] Failed to remove knowledge file:', error);
      setStatusText('Nu am putut sterge fisierul knowledge.');
    }
  };

  const reprocessKnowledgeFile = async (file: KnowledgeFile) => {
    if (!initialProfile || file.id.startsWith('temp-')) return;
    try {
      setKnowledgeFiles((current) =>
        current.map((item) => (item.id === file.id ? { ...item, status: 'processing', error: undefined } : item))
      );
      const updated = await window.electronAPI.reprocessKnowledgeFile(initialProfile.id, file.id);
      if (updated) {
        setKnowledgeFiles((current) => current.map((item) => (item.id === file.id ? updated : item)));
      } else {
        setKnowledgeFiles((current) =>
          current.map((item) =>
            item.id === file.id ? { ...item, status: 'failed', error: 'Nu am putut reindexa fisierul.' } : item
          )
        );
      }
    } catch (error) {
      console.error('[Agents] Failed to reprocess knowledge file:', error);
      setStatusText('Nu am putut reindexa fisierul knowledge.');
    }
  };

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatusText('Agentul are nevoie de un nume.');
      return;
    }

    setStatusText('Se salveaza...');

    try {
      let savedProfile: Profile | null;
      const normalizedTools = normalizeProfileToolIds(tools);

      if (initialProfile) {
        savedProfile = await window.electronAPI.updateProfile(initialProfile.id, {
          name: trimmedName,
          description: description.trim(),
          instructions: instructions.trim(),
          defaultTool: normalizedTools.length > 0 ? normalizedTools : undefined,
          avatarEmoji: avatarMode === 'emoji' ? avatarEmoji.trim() || undefined : undefined,
          avatarImagePath: initialProfile.avatarImagePath || undefined,
          knowledgeFiles,
        });

        if (avatarMode === 'emoji') {
          savedProfile = await window.electronAPI.setProfileAvatarEmoji(initialProfile.id, avatarEmoji.trim() || null);
        } else if (avatarImagePath && avatarImagePath !== initialProfile.avatarImagePath) {
          savedProfile = await window.electronAPI.setProfileAvatarImage(initialProfile.id, avatarImagePath);
        }
      } else {
        savedProfile = await window.electronAPI.createProfile({
          name: trimmedName,
          description: description.trim(),
          instructions: instructions.trim(),
          defaultTool: normalizedTools.length > 0 ? normalizedTools : undefined,
          avatarEmoji: avatarMode === 'emoji' ? avatarEmoji.trim() || undefined : undefined,
          avatarImagePath: undefined,
          knowledgeFiles: [],
        });

        const createdProfileId = savedProfile.id;

        if (avatarMode === 'image' && avatarImagePath) {
          savedProfile = await window.electronAPI.setProfileAvatarImage(createdProfileId, avatarImagePath);
        }

        const processedFiles: KnowledgeFile[] = [];
        for (const file of knowledgeFiles) {
          if (!file.path) continue;
          setKnowledgeFiles((current) =>
            current.map((item) => (item.id === file.id ? { ...item, status: 'processing', error: undefined } : item))
          );
          const added = await window.electronAPI.addKnowledgeFile(createdProfileId, file.path);
          if (added) processedFiles.push(added);
        }
        if (processedFiles.length > 0) setKnowledgeFiles(processedFiles);

        savedProfile = await window.electronAPI.getProfile(createdProfileId);
      }

      if (!savedProfile) {
        setStatusText('Profilul nu a putut fi salvat.');
        return;
      }

      setStatusText('Salvat.');
      await onSaved(savedProfile);
    } catch (error) {
      console.error('[Agents] Failed to save profile:', error);
      setStatusText('Esec la salvarea agentului.');
    }
  }, [avatarEmoji, avatarImagePath, avatarMode, description, initialProfile, instructions, knowledgeFiles, name, onSaved, tools]);

  const handleSaveRef = useRef(handleSave);

  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  useEffect(() => {
    onRegisterSave(() => {
      void handleSaveRef.current();
    });
    return () => onRegisterSave(null);
  }, [onRegisterSave]);

  const visibleToolLabels = tools
    .map((toolId) => TOOL_CATALOG.find((tool) => tool.id === toolId)?.label || toolId)
    .filter(Boolean);

  return (
    <section className="app-agent-create-page" aria-label="Creare agent">
      <div className="app-agent-create-form">
        <div className="app-agent-create-heading">
          <div>
            <h2>{isEditing ? `Editeaza ${initialProfile?.name}` : 'Agent nou'}</h2>
            <p>
              {isEditing
                ? 'Modifica identitatea, instructiunile, uneltele si cunostintele agentului.'
                : 'Configureaza identitatea, instructiunile, uneltele si cunostintele agentului.'}
            </p>
          </div>
        </div>

        <section className="app-agent-create-section">
          <h3>Sablon</h3>
          <div className="app-agent-template-grid">
            {templateOptions.map((template) => (
              <button key={template.id} onClick={() => applyTemplate(template)} type="button">
                <strong>{template.name}</strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="app-agent-create-section">
          <h3>Identitate</h3>
          <div className="app-agent-create-fields">
            <label>
              <span>Nume agent</span>
              <input
                className="app-agent-native-input"
                onChange={(event) => setName(event.target.value)}
                placeholder="ex: Asistent de scriere"
                type="text"
                value={name}
              />
            </label>
            <label>
              <span>Descriere</span>
              <textarea
                className="app-agent-native-input"
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Descrie scopul agentului"
                rows={3}
                value={description}
              />
              <small>{description.length} / 500 caractere</small>
            </label>
          </div>

          <div className="app-agent-avatar-picker">
            <div className="app-agent-emoji-picker">
              <span>Emoji</span>
              <button className="app-agent-emoji-trigger" onClick={() => setEmojiPanelOpen((open) => !open)} type="button">
                <span>{avatarEmoji || String.fromCodePoint(0x1f916)}</span>
                Alege emoji
              </button>
              {emojiPanelOpen && (
                <div className="app-agent-emoji-panel">
                  {agentEmojiOptions.map((emoji, index) => (
                    <button
                      aria-current={avatarMode === 'emoji' && avatarEmoji === emoji ? 'page' : undefined}
                      key={`${emoji}-${index}`}
                      onClick={() => {
                        setAvatarMode('emoji');
                        setAvatarEmoji(emoji);
                        setAvatarImagePath('');
                        setAvatarImageName('');
                        setEmojiPanelOpen(false);
                      }}
                      type="button"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className="app-agent-avatar-or">sau</span>

            <div className="app-agent-avatar-upload">
              <span>Poza profil</span>
              <div className="app-agent-avatar-upload-body">
                <span className="app-agent-avatar-upload-preview">
                  {avatarMode === 'image' && avatarImageUrl ? (
                    <img alt="" draggable={false} src={avatarImageUrl} />
                  ) : (
                    <ImageIcon size={18} strokeWidth={1.8} />
                  )}
                </span>
                <span className="app-agent-avatar-upload-copy">
                  <strong>{avatarImageName || 'Alege poza'}</strong>
                  <small>{avatarImageName ? 'Poza selectata pentru agent' : 'PNG, JPG, JPEG sau WebP'}</small>
                </span>
                <span className="app-agent-avatar-upload-actions">
                  {avatarImagePath && (
                    <button
                      aria-label="Sterge poza de profil"
                      className="app-agent-avatar-remove-action"
                      onClick={removeAvatarImage}
                      title="Sterge poza de profil"
                      type="button"
                    >
                      <Trash2 size={14} strokeWidth={1.8} />
                    </button>
                  )}
                  <button className="app-agent-avatar-upload-action" onClick={pickAvatarImage} type="button">
                    <Upload size={14} strokeWidth={1.8} />
                    Incarca
                  </button>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="app-agent-create-section">
          <h3>Instructiuni</h3>
          <textarea
            className="app-agent-native-input"
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Scrie cum trebuie sa se comporte agentul, ce reguli are si ce stil de raspuns preferi."
            rows={7}
            value={instructions}
          />
        </section>

        <section className="app-agent-create-section">
          <h3>Unelte</h3>
          <div className="app-agent-create-tools">
            {toolOptions.map((tool) => (
              <label key={tool.id} title={tool.description}>
                <span>{tool.label}</span>
                <button
                  aria-checked={tools.includes(tool.id)}
                  className="app-agent-native-switch"
                  onClick={() => toggleTool(tool.id, !tools.includes(tool.id))}
                  role="switch"
                  type="button"
                >
                  <span />
                </button>
              </label>
            ))}
          </div>
        </section>

        <section className="app-agent-create-section">
          <h3>Cunostinte</h3>
          <button className="app-agent-knowledge-box" onClick={addKnowledgeFile} type="button">
            <Upload size={16} strokeWidth={1.8} />
            <div>
              <strong>Adauga document pentru agent</strong>
              <p>Agentul va putea folosi continutul documentului in raspunsuri.</p>
            </div>
          </button>
          {knowledgeFiles.length > 0 && (
            <div className="app-agent-knowledge-list">
              {knowledgeFiles.map((file) => {
                const status = getKnowledgeStatus(file);
                const isProcessing = (file.status || 'indexed') === 'processing';
                return (
                  <div className="app-agent-knowledge-item" key={file.id}>
                    <FileText size={14} strokeWidth={1.8} />
                    <div className="app-agent-knowledge-meta">
                      <span>{file.name}</span>
                      <small className={`app-agent-knowledge-status app-agent-knowledge-status-${status.tone}`}>
                        {status.label}
                      </small>
                    </div>
                    {initialProfile && !file.id.startsWith('temp-') && (
                      <button
                        aria-label={`Reindexeaza ${file.name}`}
                        disabled={isProcessing}
                        onClick={() => reprocessKnowledgeFile(file)}
                        type="button"
                      >
                        <RefreshCw size={13} strokeWidth={1.8} />
                      </button>
                    )}
                    <button aria-label={`Sterge ${file.name}`} disabled={isProcessing} onClick={() => removeKnowledgeFile(file)} type="button">
                      <X size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {statusText && <div className="app-agent-create-status">{statusText}</div>}
      </div>

      <aside className="app-agent-create-preview" aria-label="Preview agent nou">
        <div className="app-agent-preview-header">
          <div className="app-agent-preview-avatar">
            {avatarMode === 'image' && avatarImageUrl ? (
              <img alt="" draggable={false} src={avatarImageUrl} />
            ) : avatarMode === 'image' ? (
              <ImageIcon size={24} strokeWidth={1.8} />
            ) : (
              <span className="app-agent-preview-emoji">{avatarEmoji || String.fromCodePoint(0x1f916)}</span>
            )}
          </div>
          <div>
            <h3>{name || 'Agent fara nume'}</h3>
            <div className="app-agent-preview-meta">
              <span data-status="needs-setup">{isEditing ? 'Editare' : 'Preview'}</span>
            </div>
          </div>
        </div>

        <p className="app-agent-preview-description">
          {description || 'Completeaza descrierea pentru a vedea cum va aparea agentul in lista.'}
        </p>

        <div className="app-agent-preview-section">
          <h4>
            <Brain size={14} strokeWidth={1.8} />
            Instructiuni
          </h4>
          <p>{instructions || 'Instructiunile agentului vor aparea aici.'}</p>
        </div>

        <div className="app-agent-preview-section">
          <h4>
            <Wrench size={14} strokeWidth={1.8} />
            Unelte
          </h4>
          <div className="app-agent-preview-tags">
            {visibleToolLabels.length > 0 ? visibleToolLabels.map((tool) => <span key={tool}>{tool}</span>) : <span>Nicio unealta</span>}
          </div>
        </div>

        <div className="app-agent-preview-section">
          <h4>
            <FileText size={14} strokeWidth={1.8} />
            Cunostinte
          </h4>
          <div className="app-agent-preview-tags">
            {knowledgeFiles.length > 0 ? knowledgeFiles.map((file) => <span key={file.id}>{file.name}</span>) : <span>Nicio cunostinta</span>}
          </div>
        </div>
      </aside>
    </section>
  );
}

export default AgentsPage;
