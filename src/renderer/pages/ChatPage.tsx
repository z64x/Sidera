import { Button, DropdownMenu, Markdown } from '@lobehub/ui';
import { GradientButton } from '@lobehub/ui/awesome';
import { BackBottom, ChatActionsBar, ChatInputArea, ChatList, TokenTag, type ChatMessage } from '@lobehub/ui/chat';
import {
  Bot,
  CalendarDays,
  CheckCircle,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  FileText,
  Image as ImageIcon,
  Archive,
  LoaderCircle,
  MessageSquare,
  Mic,
  Paperclip,
  Pin,
  PinOff,
  PlayCircle,
  Search,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  RotateCcw,
  UsersRound,
  Wrench,
  X,
  Copy,
  type LucideIcon,
} from 'lucide-react';
import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Key } from 'react';
import type { Config, Conversation, ConversationScope, FileAttachment, Message, MessagePart, Profile } from '../../shared/types';
import { SIDERA_AGENT_ID, SIDERA_AGENT_NAME, isSideraScope } from '../../shared/sidera';
import {
  clearLiveToolParts,
  createConfirmationPart,
  estimateMessageTokens,
  findConfirmationToolIndex,
  getLiveToolParts,
  getMessagePartsVersion,
  mergeLiveToolParts,
  normalizeConfirmationPayload,
  normalizeToolCallPayload,
  normalizeToolResultPayload,
  setLiveToolParts,
  stringifyToolPayload,
  updateLiveToolPart,
  upsertLiveToolPart,
  type ToolCallEnvelope,
  type ToolResultEnvelope,
  type ToolPart,
} from './chatToolState';

interface ChatPageProps {
  activeRecent?: string | null;
  agentId: string;
  agentName: string;
  onConversationsChanged?: () => void;
  onRegisterNewConversation?: (handler: (() => void) | null) => void;
  onSelectAgent?: (agentId: string, agentName: string) => void;
}

function isLiveAssistantMessage(message: Message | undefined) {
  return Boolean(message && message.role === 'assistant');
}

type ChatAttachment = FileAttachment & {
  id: string;
  size?: number;
};

type AttachmentPreviewUrls = Record<string, string>;

const replyTemplates: Array<{
  icon: LucideIcon;
  label: string;
  prompt: string;
}> = [
  {
    icon: Search,
    label: 'Verifica',
    prompt: 'Verifica informatia asta si spune-mi ce este sigur, ce este incert:\n',
  },
  {
    icon: Wrench,
    label: 'Depanare',
    prompt: 'Ajuta-ma sa gasesc problema din codul asta:\n',
  },
  {
    icon: FileText,
    label: 'Rezuma',
    prompt: 'Rezuma-mi textul asta si scoate ideile importante:\n',
  },
  {
    icon: ShieldCheck,
    label: 'Plan rapid',
    prompt: 'Fa-mi un plan clar pentru ',
  },
];

const historyGroupLabels = ['Azi', 'Saptamana asta', 'Mai vechi'] as const;

function getElectronAPI() {
  return (window as typeof window & { electronAPI?: Window['electronAPI'] }).electronAPI;
}

function getStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getHistoryGroup(createdAt: number) {
  const now = new Date();
  const todayStart = getStartOfDay(now);
  const weekStart = todayStart - 1000 * 60 * 60 * 24 * 6;

  if (createdAt >= todayStart) return 'Azi';
  if (createdAt >= weekStart) return 'Saptamana asta';

  return 'Mai vechi';
}

function groupHistoryByDate(items: Conversation[]) {
  const groups = new Map<(typeof historyGroupLabels)[number], Conversation[]>();

  historyGroupLabels.forEach((label) => groups.set(label, []));
  items.forEach((item) => groups.get(getHistoryGroup(item.updatedAt || item.createdAt))?.push(item));

  return historyGroupLabels
    .map((label) => ({ label, items: groups.get(label) ?? [] }))
    .filter((group) => group.items.length > 0);
}

function formatHistoryTime(timestamp: number, now = Date.now()) {
  const elapsed = Math.max(0, now - timestamp);
  const minute = 1000 * 60;
  const hour = minute * 60;
  const day = hour * 24;

  if (elapsed < minute) return 'Acum';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} min`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} h`;
  if (elapsed < day * 7) return `${Math.floor(elapsed / day)} zile`;

  return new Intl.DateTimeFormat('ro-RO', { day: '2-digit', month: 'short' }).format(new Date(timestamp));
}

function getScope(agentId: string): ConversationScope {
  return isSideraScope(agentId) ? SIDERA_AGENT_ID : agentId || null;
}

function isSideraConversationScope(scope: ConversationScope) {
  return isSideraScope(scope);
}

function isSideraConversation(conversation: Conversation) {
  return conversation.kind === 'sidera' || conversation.kind === 'auto' || conversation.kind === 'multi-profile';
}

function getConversationTimestamp(conversation: Conversation) {
  return conversation.updatedAt || conversation.createdAt;
}

function isWhatsAppConversation(conversation: Conversation) {
  return conversation.source === 'whatsapp' || conversation.name.toLowerCase().startsWith('whatsapp');
}

function getWhatsAppNumberLabel(conversation: Conversation) {
  if (conversation.whatsappNumber) return conversation.whatsappNumber;
  const [, , number] = conversation.name.match(/^WhatsApp\s*-\s*.+?\s*-\s*(.+)$/i) || [];
  return number || 'Numar necunoscut';
}

function getWhatsAppContactLabel(conversation: Conversation) {
  const contactName = conversation.whatsappContactName?.trim();
  const number = getWhatsAppNumberLabel(conversation);
  return contactName ? `${contactName} - ${number}` : number;
}

function getMessageProfileName(message: Message, profiles: Profile[], fallback: string, userName: string) {
  if (message.role === 'user') return userName;
  if (!message.profileId) return fallback;
  return profiles.find((profile) => profile.id === message.profileId)?.name || fallback;
}

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'S';
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function getMessageAvatar(
  message: Message,
  profiles: Profile[],
  avatarUrls: Record<string, string>,
  fallbackProfileId: string | null,
  userName: string,
  userAvatarUrl: string | null,
): string {
  if (message.role === 'user') return userAvatarUrl || getInitials(userName);

  const profileId = message.profileId || fallbackProfileId;
  if (!profileId) return String.fromCodePoint(0x2728);
  const profile = profiles.find((item) => item.id === profileId);
  const avatarUrl = avatarUrls[profileId];
  if (avatarUrl) return avatarUrl;

  return profile?.avatarEmoji || profile?.name?.charAt(0).toUpperCase() || String.fromCodePoint(0x1f916);
}

function getTextFromPart(part: unknown) {
  if (!part || typeof part !== 'object') return '';

  const maybePart = part as {
    content?: unknown;
    text?: unknown;
    type?: unknown;
  };

  if (maybePart.type === 'text') {
    if (typeof maybePart.content === 'string') return maybePart.content;
    if (typeof maybePart.text === 'string') return maybePart.text;
  }

  if (typeof maybePart.text === 'string') return maybePart.text;
  if (typeof maybePart.content === 'string') return maybePart.content;

  return '';
}

function buildChatContent(message: Message) {
  const fallbackContent = typeof message.content === 'string' ? message.content : '';
  if (!message.parts?.length) return fallbackContent || message.statusText || '';

  const partsContent = message.parts.map(getTextFromPart).filter(Boolean).join('\n\n');

  return partsContent || fallbackContent || message.statusText || '\u200B';
}

function getToolParts(message: Message): ToolPart[] {
  return (message.parts || []).filter((part): part is ToolPart => part.type === 'tool');
}

function getAttachmentPreviewKey(attachment: FileAttachment) {
  return attachment.path || attachment.name;
}

function toChatMessage(
  message: Message,
  profiles: Profile[],
  fallbackAgentName: string,
  avatarUrls: Record<string, string>,
  fallbackProfileId: string | null,
  userName: string,
  userAvatarUrl: string | null,
  attachmentPreviewUrls: AttachmentPreviewUrls,
): ChatMessage {
  const partsVersion = getMessagePartsVersion(message);
  return {
    content: buildChatContent(message),
    createAt: message.timestamp,
    extra: {
      attachments: message.attachments,
      attachmentPreviewUrls,
      modelName: message.modelName,
      parts: message.parts,
      partsVersion,
      responseTimeSeconds: message.responseTimeSeconds,
      toolParts: getToolParts(message),
    },
    id: message.id,
    meta: {
      avatar: getMessageAvatar(message, profiles, avatarUrls, fallbackProfileId, userName, userAvatarUrl),
      title: getMessageProfileName(message, profiles, fallbackAgentName, userName),
    },
    role: message.role,
    updateAt: message.timestamp + partsVersion.length,
  };
}

function getSelectedModel(config: Config | null) {
  if (!config) return '';
  const providerModel = config.selectedModels?.[config.aiProvider];
  if (config.aiProvider === 'gemini') {
    return providerModel?.startsWith('gemini-') ? providerModel : 'gemini-2.5-flash';
  }
  return providerModel || config.selectedModel || 'gpt-4o';
}

function formatFileSize(size?: number) {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentPreviewProps {
  attachments: ChatAttachment[];
  onRemoveAttachment: (id: string) => void;
}

function AttachmentPreview({ attachments, onRemoveAttachment }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="app-attachment-list">
      {attachments.map((attachment) => {
        const Icon = attachment.type === 'image' ? ImageIcon : FileText;

        return (
          <span className="app-attachment-chip" key={attachment.id} title={attachment.name}>
            <Icon size={12} strokeWidth={1.8} />
            <b>{attachment.name}</b>
            {attachment.size ? <small>{formatFileSize(attachment.size)}</small> : null}
            <button aria-label={`Scoate ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.id)} type="button">
              <X size={11} strokeWidth={2} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function MessageAttachments({ attachments, previewUrls }: { attachments?: FileAttachment[]; previewUrls?: AttachmentPreviewUrls }) {
  if (!attachments?.length) return null;

  return (
    <div className="app-chat-message-attachments">
      {attachments.map((attachment) => {
        const key = getAttachmentPreviewKey(attachment);
        const previewUrl = previewUrls?.[key];

        if (attachment.type === 'image' && previewUrl) {
          return (
            <figure className="app-chat-message-image" key={key}>
              <img alt={attachment.name} src={previewUrl} />
              <figcaption>{attachment.name}</figcaption>
            </figure>
          );
        }

        const Icon = attachment.type === 'image' ? ImageIcon : FileText;

        return (
          <span className="app-chat-message-file" key={key} title={attachment.name}>
            <Icon size={13} strokeWidth={1.8} />
            <span>{attachment.name}</span>
          </span>
        );
      })}
    </div>
  );
}

interface AttachmentControlProps {
  disabled?: boolean;
  onAddAttachment: (attachment: ChatAttachment) => void;
}

function AttachmentControl({ disabled, onAddAttachment }: AttachmentControlProps) {
  const handleAttach = async () => {
    const api = getElectronAPI();
    if (!api || disabled) return;

    try {
      const filePath = await api.selectFile([
        { name: 'Fisiere suportate', extensions: ['txt', 'md', 'json', 'csv', 'pdf', 'png', 'jpg', 'jpeg'] },
        { name: 'Imagini', extensions: ['png', 'jpg', 'jpeg'] },
        { name: 'Documente', extensions: ['txt', 'md', 'json', 'csv', 'pdf'] },
      ]);

      if (!filePath) return;

      const cachedPath = await api.cacheAttachment(filePath);
      const finalPath = cachedPath || filePath;
      const name = finalPath.split(/[/\\]/).pop() || 'file';
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const type: FileAttachment['type'] = ext === 'pdf' ? 'pdf' : ['png', 'jpg', 'jpeg'].includes(ext) ? 'image' : 'text';

      onAddAttachment({
        id: `${Date.now()}-${name}`,
        name,
        path: finalPath,
        type,
      });
    } catch (error) {
      console.error('[Chat] Failed to attach file:', error);
    }
  };

  return (
    <button
      aria-label="Ataseaza fisiere"
      className="app-chat-tool-button"
      disabled={disabled}
      onClick={handleAttach}
      title="Ataseaza fisiere"
      type="button"
    >
      <Paperclip size={14} strokeWidth={1.9} />
    </button>
  );
}

interface VoiceInputControlProps {
  disabled?: boolean;
  enabled?: boolean;
  onTranscript: (transcript: string) => void;
}

function VoiceInputControl({ disabled, enabled, onTranscript }: VoiceInputControlProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [levels, setLevels] = useState<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const bars = useMemo(() => {
    const count = 28;
    const tail = levels.slice(-count);

    return tail.length < count ? Array(count - tail.length).fill(0).concat(tail) : tail;
  }, [levels]);

  const stopVisualizer = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    dataArrayRef.current = null;
  };

  const stopStream = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const startVisualizer = async (stream: MediaStream) => {
    const AudioCtx = (window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    const data = new Uint8Array(analyser.frequencyBinCount);

    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    dataArrayRef.current = data;

    const tick = () => {
      const activeAnalyser = analyserRef.current;
      const activeData = dataArrayRef.current;

      if (!activeAnalyser || !activeData) return;

      activeAnalyser.getByteTimeDomainData(activeData as unknown as Uint8Array<ArrayBuffer>);

      let sum = 0;
      for (let index = 0; index < activeData.length; index += 1) {
        const value = (activeData[index] - 128) / 128;
        sum += value * value;
      }

      const rms = Math.sqrt(sum / activeData.length);
      const normalized = Math.min(1, Math.max(0, rms * 3));

      setLevels((previous) => {
        const next = [...previous, normalized];
        return next.length > 200 ? next.slice(-200) : next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  const transcribeAudio = async () => {
    const api = getElectronAPI();
    if (audioChunksRef.current.length === 0 || !api) return;

    setIsTranscribing(true);
    setStatusText('Se transcrie audio...');

    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const arrayBuffer = await audioBlob.arrayBuffer();
      const result = await api.transcribeAudio(new Uint8Array(arrayBuffer), 'audio/webm');
      const transcript = result.data?.transcript?.trim();

      if (result.success && transcript) {
        onTranscript(transcript);
        setStatusText('');
      } else {
        setStatusText(result.message || 'Transcrierea nu a returnat text.');
      }
    } catch {
      setStatusText('Nu am putut transcrie audio-ul.');
    } finally {
      setIsTranscribing(false);
      audioChunksRef.current = [];
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    stopVisualizer();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    stopStream();
    await transcribeAudio();
    setLevels([]);
  };

  const startRecording = async () => {
    if (!enabled) {
      setStatusText('Activeaza Whisper in setari pentru dictare.');
      return;
    }

    setStatusText('');
    setLevels([]);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      await startVisualizer(stream);
      mediaRecorder.start(1000);
    } catch {
      stopVisualizer();
      stopStream();
      setIsRecording(false);
      setStatusText('Microfonul nu este disponibil.');
    }
  };

  const toggleRecording = () => {
    if (disabled || isTranscribing) return;
    if (isRecording) {
      void stopRecording();
      return;
    }

    void startRecording();
  };

  useEffect(
    () => () => {
      stopVisualizer();
      stopStream();
    },
    [],
  );

  return (
    <div className="app-voice-input">
      <button
        aria-label={isRecording ? 'Opreste inregistrarea' : 'Inregistreaza voce'}
        className="app-chat-tool-button app-voice-button"
        data-recording={isRecording ? 'true' : undefined}
        disabled={disabled || isTranscribing}
        onClick={toggleRecording}
        title={isRecording ? 'Opreste inregistrarea' : 'Inregistreaza voce'}
        type="button"
      >
        <Mic size={14} strokeWidth={1.9} />
      </button>
      {(isRecording || isTranscribing || statusText) && (
        <div className="app-voice-status">
          <span>{isRecording ? 'Inregistrare in curs...' : statusText}</span>
          {isRecording && (
            <div className="app-voice-visualizer" aria-hidden="true">
              {bars.map((value, index) => (
                <i
                  key={index}
                  style={{
                    height: `${4 + Math.round(value * 20)}px`,
                    opacity: 0.35 + value * 0.65,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ChatInputFooterProps {
  attachmentsCount: number;
  canSend: boolean;
  isGenerating: boolean;
  sttEnabled: boolean;
  onAddAttachment: (attachment: ChatAttachment) => void;
  onSend: () => void;
  onStop: () => void;
  onTranscript: (transcript: string) => void;
  tokenUsage: number;
}

function ChatInputFooter({
  attachmentsCount,
  canSend,
  isGenerating,
  onAddAttachment,
  onSend,
  onStop,
  onTranscript,
  sttEnabled,
  tokenUsage,
}: ChatInputFooterProps) {
  return (
    <ChatInputArea.ActionBar
      className="app-chat-send-row"
      leftAddons={
        <>
          <TokenTag
            maxValue={128000}
            mode="used"
            showInfo
            size={18}
            text={{ overload: 'Context depasit', remained: 'ramase', used: 'tokenuri folosite' }}
            value={tokenUsage}
          />
          <AttachmentControl disabled={isGenerating} onAddAttachment={onAddAttachment} />
          <VoiceInputControl disabled={isGenerating} enabled={sttEnabled} onTranscript={onTranscript} />
        </>
      }
      rightAddons={
        <>
          <div className="app-chat-send-hint" aria-hidden="true">
            <CornerDownLeft size={13} strokeWidth={1.8} />
            <span>{isGenerating ? 'Stop' : 'Trimite'}</span>
          </div>
          <GradientButton
            className="app-chat-gradient-send"
            disabled={!isGenerating && !canSend && attachmentsCount === 0}
            glow={canSend || isGenerating}
            icon={isGenerating ? Square : SendHorizontal}
            onClick={isGenerating ? onStop : onSend}
            size="small"
            title={isGenerating ? 'Opreste generarea' : 'Trimite'}
          >
            {isGenerating ? 'Stop' : 'Trimite'}
          </GradientButton>
        </>
      }
    />
  );
}

function formatToolName(name?: string) {
  if (!name) return 'Actiune';
  return name
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function truncateToolText(value: string, maxLength = 220) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trim()}...`;
}

function isNonEmptyPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function getToolActionText(part: ToolPart, agentName: string) {
  const actions: Record<string, { running: string; success: string; error: string; pending: string }> = {
    add_to_database: {
      running: `${agentName} adauga in memorie`,
      success: `${agentName} a adaugat in memorie`,
      error: `${agentName} nu a putut adauga in memorie`,
      pending: `${agentName} cere confirmare pentru memorie`,
    },
    check_database: {
      running: `${agentName} cauta in memorie`,
      success: `${agentName} a cautat in memorie`,
      error: `${agentName} nu a putut cauta in memorie`,
      pending: `${agentName} cere confirmare pentru memorie`,
    },
    delete_from_database: {
      running: `${agentName} sterge din memorie`,
      success: `${agentName} a sters din memorie`,
      error: `${agentName} nu a putut sterge din memorie`,
      pending: `${agentName} cere confirmare pentru stergerea din memorie`,
    },
    check_resources: {
      running: `${agentName} verifica resursele sistemului`,
      success: `${agentName} a verificat resursele sistemului`,
      error: `${agentName} nu a putut verifica resursele sistemului`,
      pending: `${agentName} cere confirmare pentru verificarea sistemului`,
    },
    create_file: {
      running: `${agentName} creeaza un fisier`,
      success: `${agentName} a creat un fisier`,
      error: `${agentName} nu a putut crea fisierul`,
      pending: `${agentName} cere confirmare pentru fisier`,
    },
    delete_file: {
      running: `${agentName} sterge un fisier`,
      success: `${agentName} a sters un fisier`,
      error: `${agentName} nu a putut sterge fisierul`,
      pending: `${agentName} cere confirmare pentru stergere`,
    },
    google_search: {
      running: `${agentName} cauta pe web`,
      success: `${agentName} a cautat pe web`,
      error: `${agentName} nu a putut cauta pe web`,
      pending: `${agentName} cere confirmare pentru cautare`,
    },
    read_file: {
      running: `${agentName} citeste un fisier`,
      success: `${agentName} a citit un fisier`,
      error: `${agentName} nu a putut citi fisierul`,
      pending: `${agentName} cere confirmare pentru citire`,
    },
    start_app: {
      running: `${agentName} porneste o aplicatie`,
      success: `${agentName} a pornit o aplicatie`,
      error: `${agentName} nu a putut porni aplicatia`,
      pending: `${agentName} cere confirmare pentru pornire`,
    },
    stop_app: {
      running: `${agentName} opreste o aplicatie`,
      success: `${agentName} a oprit o aplicatie`,
      error: `${agentName} nu a putut opri aplicatia`,
      pending: `${agentName} cere confirmare pentru oprire`,
    },
  };

  const status = part.status === 'success' || part.status === 'error' || part.status === 'pending' ? part.status : 'running';
  const action = part.name ? actions[part.name] : undefined;
  const formattedToolName = part.name ? formatToolName(part.name).toLowerCase() : 'actiune';

  if (status === 'running') {
    if (part.phase === 'detected') return `${agentName} a pregatit ${formattedToolName}`;
    if (part.phase === 'starting') return `${agentName} porneste ${formattedToolName}`;
  }

  if (action) return action[status];

  if (!part.name) {
    if (part.status === 'success') return `${agentName} a terminat actiunea`;
    if (part.status === 'error') return `${agentName} nu a putut termina actiunea`;
    if (part.status === 'pending') return `${agentName} cere confirmare`;
    return `${agentName} pregateste o actiune`;
  }

  const toolName = formattedToolName;
  if (part.status === 'success') return `${agentName} a rulat ${toolName}`;
  if (part.status === 'error') return `${agentName} nu a putut rula ${toolName}`;
  if (part.status === 'pending') return `${agentName} cere confirmare pentru ${toolName}`;
  return `${agentName} ruleaza ${toolName}`;
}

function getToolArgumentPreview(part: ToolPart) {
  const streamingArgsText = typeof part.argsText === 'string' ? part.argsText.trim() : '';
  if (!isNonEmptyPlainObject(part.args)) {
    return streamingArgsText;
  }
  const args = part.args;
  const preferredKeys =
    part.name === 'create_file'
      ? ['path', 'filename', 'filePath', 'name']
      : part.name === 'read_file' || part.name === 'delete_file'
        ? ['filename', 'path', 'filePath']
        : part.name === 'start_app'
          ? ['app_name', 'appName', 'app', 'command']
          : part.name === 'stop_app'
            ? ['process_name', 'processName', 'process', 'appName']
            : part.name === 'add_to_database'
              ? ['content']
              : part.name === 'delete_from_database'
                ? ['id']
                : ['path', 'filename', 'query', 'task', 'name'];

  const key = preferredKeys.find((candidate) => typeof args[candidate] === 'string' && String(args[candidate]).trim().length > 0) ||
    Object.keys(args).find((candidate) => {
      const value = args[candidate];
      return ['string', 'number', 'boolean'].includes(typeof value);
    });

  if (!key) return stringifyToolPayload(args);
  return stringifyToolPayload({ [key]: args[key] });
}

function ToolTimelineStack({ message, toolParts: explicitToolParts }: { message?: ChatMessage; toolParts?: ToolPart[] }) {
  const toolParts = explicitToolParts || (((message?.extra as any)?.toolParts || []) as ToolPart[]);
  if (toolParts.length === 0) return null;

  const api = getElectronAPI();
  const agentName = String(message?.meta?.title || 'AI-ul');

  const getSubagentName = (part: ToolPart) =>
    part.result?.subagentName ||
    (part.args?.subagentId === 'code_specialist'
      ? 'Code Specialist'
      : part.args?.subagentId === 'reviewer'
        ? 'Reviewer'
        : 'Planner');

  const getTimelineTitle = (part: ToolPart) => {
    if (!part.name || part.name !== 'call_subagent') return getToolActionText(part, agentName);

    const subagentName = getSubagentName(part);
    if (part.status === 'success') return `${subagentName} a terminat taskul`;
    if (part.status === 'error') return `${subagentName} nu a putut termina taskul`;
    if (part.status === 'pending') return `${agentName} cere confirmare pentru ${subagentName}`;
    if (part.phase === 'detected') return `${subagentName} a fost selectat`;
    if (part.phase === 'starting') return `${subagentName} incepe taskul`;
    return `${subagentName} lucreaza la task`;
  };

  const getStatusLabel = (status: ToolPart['status']) => {
    if (status === 'running') return 'IN LUCRU';
    if (status === 'success') return 'FINALIZAT';
    if (status === 'error') return 'EROARE';
    return 'CONFIRMARE';
  };

  const getStatusIcon = (part: ToolPart) => {
    if (part.name === 'call_subagent') return <UsersRound size={14} />;
    if (part.status === 'success') return <CheckCircle size={14} />;
    if (part.status === 'running') return <LoaderCircle className="app-chat-action-spinner" size={14} />;
    if (part.status === 'error') return <X size={14} />;
    return <Wrench size={14} />;
  };

  const copyToolText = async (event: React.MouseEvent<HTMLButtonElement>, text: string) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard?.writeText(text);
    } catch (error) {
      console.warn('[Chat] Failed to copy tool payload:', error);
    }
  };

  const getDurationLabel = (part: ToolPart) => {
    const end = part.resultUpdatedAt || part.updatedAt || Date.now();
    if (!part.startedAt || end < part.startedAt) return '';
    const seconds = Math.max(0.1, (end - part.startedAt) / 1000);
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  };

  const renderPayloadField = (label: string, value: string) => (
    <div className="app-chat-action-field">
      <span>
        {label}
        <button aria-label={`Copiaza ${label}`} onClick={(event) => copyToolText(event, value)} type="button">
          <Copy size={12} />
        </button>
      </span>
      <pre>{value}</pre>
    </div>
  );

  return (
    <div className="app-chat-action-stack">
      {toolParts.map((part) => {
        const argsText = (part.argsText || '').trim() || (isNonEmptyPlainObject(part.args) ? stringifyToolPayload(part.args) : '');
        const resultText = stringifyToolPayload(part.result);
        const argPreview = truncateToolText(getToolArgumentPreview(part), 150);

        return (
        <details data-kind={part.name === 'call_subagent' ? 'subagent' : 'tool'} data-status={part.status} key={part.id}>
          <summary>
            <span className="app-chat-action-icon">{getStatusIcon(part)}</span>
            <span className="app-chat-action-copy">
              <strong>{getTimelineTitle(part)}</strong>
              {argPreview && <code>{argPreview}</code>}
            </span>
            {part.confirmation && part.status === 'pending' && (
              <span className="app-chat-action-confirm app-chat-action-confirm-inline">
                <button
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void api?.resolveToolConfirmation(part.confirmation!.id, true);
                  }}
                  type="button"
                >
                  Aproba
                </button>
                <button
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void api?.resolveToolConfirmation(part.confirmation!.id, false);
                  }}
                  type="button"
                >
                  Refuza
                </button>
              </span>
            )}
            <span className="app-chat-action-status">{getStatusLabel(part.status)}</span>
            <ChevronDown className="app-chat-action-chevron" size={14} />
          </summary>

          <div className="app-chat-action-details">
            {part.name === 'call_subagent' && (
              <div className="app-chat-action-field">
                <span>Subagent</span>
                <code>{String(part.args?.subagentId || part.result?.subagentId || 'planner')}</code>
              </div>
            )}
            <div className="app-chat-action-field">
              <span>Unealta</span>
              <code>{part.name || 'tool'}</code>
            </div>
            {getDurationLabel(part) && (
              <div className="app-chat-action-field">
                <span>Durata</span>
                <code>{getDurationLabel(part)}</code>
              </div>
            )}
            {argsText && renderPayloadField(part.name === 'call_subagent' ? 'Task trimis' : 'Argumente', argsText)}
            {part.confirmation && (
              renderPayloadField('Confirmare', part.confirmation.reason ? part.confirmation.reason : stringifyToolPayload(part.confirmation))
            )}
            {resultText && renderPayloadField(part.status === 'error' ? 'Eroare' : 'Rezultat', resultText)}
          </div>

        </details>
      );
      })}
    </div>
  );
}

function InlineChatParts({ message }: { message: ChatMessage }) {
  const parts = ((message.extra as any)?.parts || []) as MessagePart[];
  if (parts.length === 0) return <>{message.content}</>;

  return (
    <div className="app-chat-inline-parts">
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return part.content ? (
            <Markdown
              animated={false}
              className="app-chat-inline-markdown"
              enableStream
              fullFeaturedCodeBlock
              key={`text-${index}`}
              {...chatMarkdownProps}
            >
              {part.content}
            </Markdown>
          ) : null;
        }

        return <ToolTimelineStack key={part.id || `tool-${index}`} message={message} toolParts={[part]} />;
      })}
    </div>
  );
}

const chatMarkdownProps = {
  lineHeight: 1.45,
  marginMultiple: 0.45,
  variant: 'chat' as const,
};

const chatEditorStyles = {
  editor: {
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.45,
    letterSpacing: 0,
  },
  highlight: {
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.45,
    letterSpacing: 0,
  },
  input: {
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.45,
    letterSpacing: 0,
  },
  markdown: {
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.45,
    letterSpacing: 0,
  },
  textarea: {
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.45,
    letterSpacing: 0,
  },
};

function withChatEditableMetrics(editableContent: ReactNode) {
  if (!isValidElement(editableContent)) return editableContent;
  const props = editableContent.props as {
    classNames?: Record<string, string>;
    markdownProps?: Record<string, unknown>;
    styles?: Record<string, Record<string, unknown>>;
  };

  return cloneElement(editableContent, {
    classNames: {
      ...(props.classNames || {}),
      editor: [props.classNames?.editor, 'app-chat-edit-editor'].filter(Boolean).join(' '),
      highlight: [props.classNames?.highlight, 'app-chat-edit-highlight'].filter(Boolean).join(' '),
      input: [props.classNames?.input, 'app-chat-edit-input'].filter(Boolean).join(' '),
      markdown: [props.classNames?.markdown, 'app-chat-edit-markdown'].filter(Boolean).join(' '),
      textarea: [props.classNames?.textarea, 'app-chat-edit-textarea'].filter(Boolean).join(' '),
    },
    editButtonSize: 'small',
    fontSize: 14,
    height: 'auto',
    language: 'plaintext',
    markdownProps: {
      ...(props.markdownProps || {}),
      ...chatMarkdownProps,
    },
    styles: {
      ...(props.styles || {}),
      editor: {
        ...(props.styles?.editor || {}),
        ...chatEditorStyles.editor,
      },
      highlight: {
        ...(props.styles?.highlight || {}),
        ...chatEditorStyles.highlight,
      },
      input: {
        ...(props.styles?.input || {}),
        ...chatEditorStyles.input,
      },
      markdown: {
        ...(props.styles?.markdown || {}),
        ...chatEditorStyles.markdown,
      },
      textarea: {
        ...(props.styles?.textarea || {}),
        ...chatEditorStyles.textarea,
      },
    },
    text: {
      ...((props as { text?: Record<string, string> }).text || {}),
      cancel: 'Anuleaza',
      confirm: 'Confirma',
    },
    variant: 'borderless',
  } as Record<string, unknown>);
}

function PlainChatMessage(message: ChatMessage & { editableContent?: React.ReactNode }) {
  const parts = (((message.extra as any)?.parts || []) as MessagePart[]);
  const hasParts = parts.length > 0;
  const messageAttachments = ((message.extra as any)?.attachments || []) as FileAttachment[];
  const attachmentPreviewUrls = ((message.extra as any)?.attachmentPreviewUrls || {}) as AttachmentPreviewUrls;
  const editableContent = withChatEditableMetrics(message.editableContent);
  const isEditing =
    isValidElement(editableContent) &&
    typeof editableContent.props === 'object' &&
    editableContent.props !== null &&
    Boolean((editableContent.props as { editing?: boolean }).editing);

  return (
    <div className="app-chat-message-text">
      {!isEditing && <MessageAttachments attachments={messageAttachments} previewUrls={attachmentPreviewUrls} />}
      {hasParts && !isEditing ? <InlineChatParts message={message} /> : editableContent || message.content}
    </div>
  );
}

function SafeChatActionsBar({ onActionClick, text }: Pick<React.ComponentProps<typeof ChatActionsBar>, 'onActionClick' | 'text'>) {
  return <ChatActionsBar onActionClick={onActionClick} text={text} />;
}

function SafeChatMessage({
  editableContent,
  ...message
}: ChatMessage & { editableContent?: React.ReactNode }) {
  return <PlainChatMessage {...message} editableContent={editableContent} />;
}

function ChatPage({ activeRecent, agentId, agentName, onConversationsChanged, onRegisterNewConversation, onSelectAgent }: ChatPageProps) {
  const [inputHeight, setInputHeight] = useState(152);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<AttachmentPreviewUrls>({});
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [historyPinned, setHistoryPinned] = useState(true);
  const [historyNow, setHistoryNow] = useState(() => Date.now());
  const [isNewConversationDraft, setIsNewConversationDraft] = useState(true);
  const [homeWelcome] = useState(() => 'Sidera');
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const autoScrollFrameRef = useRef<number | null>(null);
  const responseStartTimeRef = useRef<number | null>(null);
  const optimisticConversationRef = useRef<Conversation | null>(null);
  const liveToolPartsRef = useRef<Map<string, ToolPart[]>>(new Map());

  const selectedScope = getScope(agentId);
  const effectiveAgentName = isSideraScope(agentId) ? SIDERA_AGENT_NAME : agentName;
  const isSideraAgent = isSideraConversationScope(selectedScope);
  const activeProfileId = activeProfile?.id || null;
  const userName = config?.userPersona?.name?.trim() || 'Luis';
  const sttEnabled = Boolean(config?.stt?.enabled && (config?.stt?.openaiApiKey || config?.apiKeys?.openai));

  const focusChatInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      const textarea = chatInputRef.current?.querySelector('textarea');

      if (!textarea || textarea.disabled || document.activeElement === textarea) return;

      textarea.focus({ preventScroll: true });
    });
  }, []);

  const focusChatInputIfIdle = useCallback(() => {
    const activeElement = document.activeElement;
    const isIdleFocus =
      !activeElement ||
      activeElement === document.body ||
      activeElement === document.documentElement ||
      Boolean(chatInputRef.current?.contains(activeElement));

    if (isIdleFocus) focusChatInput();
  }, [focusChatInput]);

  const messages = useMemo(
    () =>
      (currentConversation?.messages || []).map((message) =>
        toChatMessage(
          message,
          profiles,
          effectiveAgentName,
          avatarUrls,
          isSideraAgent ? null : currentConversation?.defaultProfileId || activeProfileId,
          userName,
          userAvatarUrl,
          attachmentPreviewUrls,
        ),
      ),
    [
      activeProfileId,
      attachmentPreviewUrls,
      avatarUrls,
      currentConversation?.defaultProfileId,
      currentConversation?.messages,
      effectiveAgentName,
      isSideraAgent,
      profiles,
      userAvatarUrl,
      userName,
    ],
  );

  const tokenUsage = useMemo(() => {
    const messageTokens = (currentConversation?.messages || []).reduce((total, message) => total + estimateMessageTokens(message), 0);
    const inputTokens = Math.ceil(inputValue.length / 4);
    const attachmentTokens = attachments.length * 180;

    return messageTokens + inputTokens + attachmentTokens;
  }, [attachments.length, currentConversation?.messages, inputValue]);

  const appConversations = useMemo(() => conversations.filter((conversation) => !isWhatsAppConversation(conversation)), [conversations]);
  const whatsappConversations = useMemo(() => conversations.filter(isWhatsAppConversation), [conversations]);
  const groupedHistory = useMemo(() => groupHistoryByDate(appConversations), [appConversations]);

  const getConversationAgentLabel = (conversation: Conversation) =>
    isSideraConversation(conversation) ? SIDERA_AGENT_NAME : profiles.find((profile) => profile.id === conversation.profileId)?.name || effectiveAgentName;

  const loadProfilesAndConfig = async () => {
    const api = getElectronAPI();
    if (!api) return;

    try {
      const [cfg, profile, allProfiles] = await Promise.all([api.getConfig(), api.getActiveProfile(), api.getAllProfiles()]);
      let nextUserAvatarUrl: string | null = null;
      if (cfg.userPersona?.avatarImagePath) {
        try {
          nextUserAvatarUrl = await api.getFileDataUrl(cfg.userPersona.avatarImagePath);
        } catch {
          nextUserAvatarUrl = null;
        }
      }
      const avatarEntries = await Promise.all(
        allProfiles.map(async (item) => {
          if (!item.avatarImagePath) return [item.id, null] as const;
          try {
            return [item.id, await api.getFileDataUrl(item.avatarImagePath)] as const;
          } catch {
            return [item.id, null] as const;
          }
        }),
      );
      const nextAvatarUrls: Record<string, string> = {};

      for (const [id, url] of avatarEntries) {
        if (url) nextAvatarUrls[id] = url;
      }

      setConfig(cfg);
      setActiveProfile(profile);
      setProfiles(allProfiles);
      setAvatarUrls(nextAvatarUrls);
      setUserAvatarUrl(nextUserAvatarUrl);
    } catch (error) {
      console.error('[Chat] Failed to load profile/config:', error);
    }
  };

  const loadConversations = async (scope: ConversationScope = selectedScope): Promise<Conversation[]> => {
    const api = getElectronAPI();
    if (!api) return [];

    try {
      const convs = await api.getConversations(scope || undefined, true);
      setConversations(convs);

      if (
        selectedConversation &&
        !selectedConversation.startsWith('draft-') &&
        !convs.some((conversation) => conversation.id === selectedConversation)
      ) {
        setSelectedConversation(null);
        setCurrentConversation(null);
        setIsNewConversationDraft(true);
        api.setCurrentConversation('', scope);
      }
      return convs;
    } catch (error) {
      console.error('[Chat] Failed to load conversations:', error);
      return [];
    }
  };

  const loadConversation = async (id: string | null) => {
    const api = getElectronAPI();
    if (!api || !id) {
      setCurrentConversation(null);
      setAttachmentPreviewUrls({});
      return;
    }
    if (id.startsWith('draft-')) return;

    try {
      const conversation = await api.getConversation(id);
      if (conversation) setCurrentConversation(conversation);
    } catch (error) {
      console.error('[Chat] Failed to load conversation:', error);
    }
  };

  const loadAttachmentPreviewUrls = async (conversation: Conversation | null) => {
    const api = getElectronAPI();
    if (!api || !conversation) {
      setAttachmentPreviewUrls({});
      return;
    }

    const imageAttachments = conversation.messages
      .flatMap((message) => message.attachments || [])
      .filter((attachment) => attachment.type === 'image' && attachment.path);

    if (imageAttachments.length === 0) {
      setAttachmentPreviewUrls({});
      return;
    }

    const entries = await Promise.all(
      imageAttachments.map(async (attachment) => {
        try {
          return [getAttachmentPreviewKey(attachment), await api.getFileDataUrl(attachment.path)] as const;
        } catch {
          return [getAttachmentPreviewKey(attachment), null] as const;
        }
      }),
    );
    const nextUrls: AttachmentPreviewUrls = {};

    for (const [key, url] of entries) {
      if (url) nextUrls[key] = url;
    }

    setAttachmentPreviewUrls(nextUrls);
  };

  const createOptimisticConversation = (): Conversation => {
    const now = Date.now();
    const targetProfileId = isSideraConversationScope(selectedScope) ? undefined : agentId || activeProfileId || undefined;

    return {
      createdAt: now,
      defaultProfileId: isSideraConversationScope(selectedScope) ? undefined : targetProfileId || undefined,
      id: `draft-${now}`,
      kind: isSideraConversationScope(selectedScope) ? 'sidera' : 'single-profile',
      messages: [],
      name: 'Conversatie noua',
      profileId: isSideraConversationScope(selectedScope) ? undefined : targetProfileId || undefined,
      updatedAt: now,
    };
  };

  const createConversation = async (): Promise<Conversation | null> => {
    const api = getElectronAPI();
    if (!api) return null;

    try {
      const conversation = await api.createConversation(isSideraConversationScope(selectedScope) ? SIDERA_AGENT_ID : agentId || activeProfileId || undefined);
      setConversations((current) => [conversation, ...current]);
      setSelectedConversation(conversation.id);
      setCurrentConversation(conversation);
      setIsNewConversationDraft(false);
      api.setCurrentConversation(conversation.id, selectedScope);
      return conversation;
    } catch (error) {
      console.error('[Chat] Failed to create conversation:', error);
      return null;
    }
  };

  const startNewConversation = () => {
    const api = getElectronAPI();
    setSelectedConversation(null);
    setCurrentConversation(null);
    setIsNewConversationDraft(true);
    api?.setCurrentConversation('', selectedScope);
    setInputValue('');
    setAttachments([]);
  };

  const handleSelectConversation = (id: string) => {
    const api = getElectronAPI();
    setSelectedConversation(id);
    setIsNewConversationDraft(false);
    api?.setCurrentConversation(id, selectedScope);
  };

  const handleArchiveConversation = async (conversation: Conversation) => {
    const api = getElectronAPI();
    if (!api) return;

    const archivedAt = Date.now();
    const archivedCurrent = selectedConversation === conversation.id;

    try {
      await api.updateConversation(conversation.id, { archivedAt, updatedAt: archivedAt });
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (archivedCurrent) {
        setSelectedConversation(null);
        setCurrentConversation(null);
        setIsNewConversationDraft(true);
        api.setCurrentConversation('', selectedScope);
      }
      await loadConversations(selectedScope);
      onConversationsChanged?.();
    } catch (error) {
      console.error('[Chat] Failed to archive conversation:', error);
    }
  };

  const handleClearWhatsAppConversation = async (conversation: Conversation) => {
    const api = getElectronAPI();
    if (!api || conversation.messages.length === 0) return;

    const clearedConversation: Conversation = {
      ...conversation,
      messages: [],
      updatedAt: Date.now(),
    };

    try {
      await api.updateConversation(conversation.id, {
        messages: [],
        updatedAt: clearedConversation.updatedAt,
      });
      setConversations((current) => current.map((item) => (item.id === conversation.id ? clearedConversation : item)));
      if (selectedConversation === conversation.id) {
        setCurrentConversation(clearedConversation);
      }
      onConversationsChanged?.();
    } catch (error) {
      console.error('[Chat] Failed to clear WhatsApp conversation:', error);
    }
  };

  const handleDeleteWhatsAppConversation = async (conversation: Conversation) => {
    const api = getElectronAPI();
    if (!api) return;
    if (!window.confirm('Stergi complet conversatia WhatsApp? Mesajele se pierd definitiv.')) return;

    try {
      await api.deleteConversation(conversation.id);
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (selectedConversation === conversation.id) {
        setSelectedConversation(null);
        setCurrentConversation(null);
        setIsNewConversationDraft(true);
        api.setCurrentConversation('', selectedScope);
      }
      await loadConversations(selectedScope);
      onConversationsChanged?.();
    } catch (error) {
      console.error('[Chat] Failed to delete WhatsApp conversation:', error);
    }
  };

  const clearHistory = async (range: 'hour' | 'today' | 'all') => {
    const api = getElectronAPI();
    if (!api) return;

    const now = Date.now();
    const todayStart = getStartOfDay(new Date(now));
    const lastHour = now - 1000 * 60 * 60;
    const candidates = appConversations.filter((conversation) => {
      const timestamp = getConversationTimestamp(conversation);
      if (range === 'all') return true;
      if (range === 'today') return timestamp >= todayStart;
      return timestamp >= lastHour;
    });

    if (candidates.length === 0) return;

    try {
      const deletedIds = new Set(candidates.map((conversation) => conversation.id));
      await Promise.all(candidates.map((conversation) => api.deleteConversation(conversation.id)));
      setConversations((current) => current.filter((conversation) => !deletedIds.has(conversation.id)));
      if (selectedConversation && deletedIds.has(selectedConversation)) {
        setSelectedConversation(null);
        setCurrentConversation(null);
        setIsNewConversationDraft(true);
        api.setCurrentConversation('', selectedScope);
      }
      await loadConversations(selectedScope);
      onConversationsChanged?.();
    } catch (error) {
      console.error('[Chat] Failed to clear conversations:', error);
    }
  };

  const handleSend = async () => {
    const api = getElectronAPI();
    if (!api || isGenerating || (!inputValue.trim() && attachments.length === 0)) return;

    const targetProfileId = isSideraConversationScope(selectedScope) ? undefined : agentId || activeProfileId;
    const now = Date.now();
    const isDraftSend = isNewConversationDraft || !currentConversation || !selectedConversation;
    const conversation = isDraftSend ? createOptimisticConversation() : currentConversation;
    const userMessage: Message = {
      attachments: attachments.length > 0 ? attachments.map(({ id: _id, size: _size, ...attachment }) => attachment) : undefined,
      content: inputValue,
      id: String(now),
      profileId: isSideraConversationScope(selectedScope) ? undefined : targetProfileId || undefined,
      role: 'user',
      timestamp: now,
    };
    const assistantMessage: Message = {
      content: '',
      id: 'streaming-ai-response',
      modelName: getSelectedModel(config),
      parts: [],
      profileId: isSideraConversationScope(selectedScope) ? undefined : targetProfileId || undefined,
      role: 'assistant',
      timestamp: now + 1,
    };
    const nextConversation: Conversation = {
      ...conversation,
      defaultProfileId: isSideraConversationScope(selectedScope) ? undefined : targetProfileId || conversation.defaultProfileId,
      kind: isSideraConversationScope(selectedScope) ? 'sidera' : 'single-profile',
      messages: [...conversation.messages, userMessage, assistantMessage],
      updatedAt: now,
    };

    responseStartTimeRef.current = performance.now();
    setSelectedConversation(conversation.id);
    setCurrentConversation(nextConversation);
    optimisticConversationRef.current = nextConversation;
    void loadAttachmentPreviewUrls(nextConversation);
    setIsNewConversationDraft(false);
    setInputValue('');
    setAttachments([]);
    setIsGenerating(true);
    setCurrentResponse('');
    clearLiveToolParts(liveToolPartsRef.current, { conversationId: conversation.id, messageId: assistantMessage.id });
    let unsubscribeChunk: (() => void) | null = null;
    let unsubscribeComplete: (() => void) | null = null;
    const cleanupResponseListeners = () => {
      unsubscribeChunk?.();
      unsubscribeComplete?.();
      unsubscribeChunk = null;
      unsubscribeComplete = null;
    };

    const onChunk = (chunk: string) => {
      setCurrentResponse((previous) => previous + chunk);
    };
    const onComplete = () => {
      setIsGenerating(false);
      optimisticConversationRef.current = null;
      clearLiveToolParts(liveToolPartsRef.current, { conversationId: conversation.id, messageId: assistantMessage.id });
      cleanupResponseListeners();
      window.setTimeout(() => {
        void (async () => {
          const convs = await loadConversations(selectedScope);
          if (isDraftSend) {
            const createdConversation = convs[0] || null;
            if (createdConversation) {
              setSelectedConversation(createdConversation.id);
              api.setCurrentConversation(createdConversation.id, selectedScope);
              await loadConversation(createdConversation.id);
            }
          } else {
            await loadConversation(conversation.id);
          }
          onConversationsChanged?.();
        })();
      }, 100);
    };

    unsubscribeChunk = api.onAIResponse(onChunk);
    unsubscribeComplete = api.onAIResponseComplete(onComplete);

    try {
      await api.sendMessage(userMessage.content, userMessage.attachments, {
        conversationScope: selectedScope,
        forceNewConversation: isDraftSend,
        targetProfileId: isSideraConversationScope(selectedScope) ? null : targetProfileId,
      });
    } catch (error) {
      console.error('[Chat] Failed to send message:', error);
      setIsGenerating(false);
      optimisticConversationRef.current = null;
      clearLiveToolParts(liveToolPartsRef.current, { conversationId: conversation.id, messageId: assistantMessage.id });
      cleanupResponseListeners();
      if (isDraftSend) {
        setSelectedConversation(null);
        setCurrentConversation(null);
        setIsNewConversationDraft(true);
      } else {
        void loadConversation(conversation.id);
      }
    }
  };

  const handleStop = async () => {
    const api = getElectronAPI();
    try {
      await api?.stopGeneration();
    } finally {
      setIsGenerating(false);
      optimisticConversationRef.current = null;
      clearLiveToolParts(liveToolPartsRef.current);
    }
  };

  const handleAddAttachment = (attachment: ChatAttachment) => {
    setAttachments((current) => [...current, attachment]);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const applyTemplate = (prompt: string) => {
    setInputValue(prompt);
  };

  const handleSelectAgentCard = (profile: Profile) => {
    onSelectAgent?.(profile.id, profile.name);
  };

  const renderAgentAvatar = (profile: Profile) => {
    const avatarUrl = avatarUrls[profile.id];
    if (avatarUrl) return <img alt={profile.name} className="app-chat-agent-avatar-image" src={avatarUrl} />;
    return profile.avatarEmoji || <Bot size={16} strokeWidth={1.8} />;
  };

  const handleTranscript = (transcript: string) => {
    setInputValue((previous) => (previous.trim() ? `${previous.trim()}\n${transcript}` : transcript));
  };

  useEffect(() => {
    const handleWindowFocus = () => focusChatInputIfIdle();
    const handlePageShow = () => focusChatInputIfIdle();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') focusChatInputIfIdle();
    };

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [focusChatInputIfIdle]);

  const handleMessageChange = async (id: string, content: string) => {
    const api = getElectronAPI();
    if (!api || !selectedConversation) return;

    const sourceConversation = currentConversation;
    const messageIndex = sourceConversation?.messages.findIndex((message) => message.id === id) ?? -1;
    const editedMessage = messageIndex >= 0 ? sourceConversation?.messages[messageIndex] : null;

    if (editedMessage?.role === 'user' && sourceConversation) {
      const oldAssistant = sourceConversation.messages[messageIndex + 1]?.role === 'assistant'
        ? sourceConversation.messages[messageIndex + 1]
        : null;
      const assistantMessage: Message = {
        content: '',
        id: `editing-${Date.now()}`,
        modelName: oldAssistant?.modelName || getSelectedModel(config),
        parts: [],
        profileId: isSideraConversationScope(selectedScope) ? undefined : oldAssistant?.profileId || sourceConversation.defaultProfileId || activeProfileId || undefined,
        role: 'assistant',
        timestamp: Date.now(),
      };
      const nextMessages = sourceConversation.messages.slice(0, messageIndex + 1).map((message) =>
        message.id === id ? { ...message, content } : message,
      );
      const nextConversation = {
        ...sourceConversation,
        messages: [...nextMessages, assistantMessage],
        updatedAt: Date.now(),
      };

      responseStartTimeRef.current = performance.now();
      setCurrentResponse('');
      setIsGenerating(true);
      setCurrentConversation(nextConversation);
      optimisticConversationRef.current = nextConversation;
      const cleanup = subscribeToResponseStream({
        api,
        conversationId: selectedConversation,
        messageId: assistantMessage.id,
        onComplete: () => {
          window.setTimeout(() => {
            void (async () => {
              await loadConversation(selectedConversation);
              await loadConversations(selectedScope);
              onConversationsChanged?.();
            })();
          }, 100);
        },
      });

      try {
        await api.editMessage(selectedConversation, id, content);
      } catch (error) {
        console.error('[Chat] Failed to edit message:', error);
        setIsGenerating(false);
        optimisticConversationRef.current = null;
        cleanup();
        await loadConversation(selectedConversation);
      }
      return;
    }

    setCurrentConversation((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        messages: previous.messages.map((message) => (message.id === id ? { ...message, content } : message)),
      };
    });

    await api.editMessage(selectedConversation, id, content);
    await loadConversation(selectedConversation);
  };

  const subscribeToResponseStream = (params: {
    api: NonNullable<ReturnType<typeof getElectronAPI>>;
    conversationId: string;
    messageId: string;
    onComplete?: () => void;
  }) => {
    const { api, conversationId, messageId, onComplete } = params;
    let unsubscribeChunk: (() => void) | null = null;
    let unsubscribeComplete: (() => void) | null = null;
    const cleanup = () => {
      unsubscribeChunk?.();
      unsubscribeComplete?.();
      unsubscribeChunk = null;
      unsubscribeComplete = null;
    };

    unsubscribeChunk = api.onAIResponse((chunk) => {
      setCurrentResponse((previous) => previous + chunk);
    });
    unsubscribeComplete = api.onAIResponseComplete(() => {
      setIsGenerating(false);
      optimisticConversationRef.current = null;
      clearLiveToolParts(liveToolPartsRef.current, { conversationId, messageId });
      cleanup();
      onComplete?.();
    });

    return cleanup;
  };

  const handleActionClick = async (action: { key: Key }, message: ChatMessage) => {
    const api = getElectronAPI();
    if (!api || !selectedConversation || isGenerating) return;

    if (action.key === 'del') {
      await api.deleteMessages(selectedConversation, [String(message.id)]);
      await loadConversation(selectedConversation);
      await loadConversations(selectedScope);
      onConversationsChanged?.();
      return;
    }

    if (action.key === 'regenerate') {
      const sourceConversation = currentConversation;
      if (!sourceConversation) return;
      const targetIndex = sourceConversation.messages.findIndex((item) => item.id === String(message.id));
      if (targetIndex === -1) return;

      const targetMessage = sourceConversation.messages[targetIndex];
      const userIndex = targetMessage.role === 'assistant'
        ? (() => {
            for (let index = targetIndex - 1; index >= 0; index -= 1) {
              if (sourceConversation.messages[index].role === 'user') return index;
            }
            return -1;
          })()
        : targetIndex;
      if (userIndex === -1) return;

      const oldAssistant = targetMessage.role === 'assistant'
        ? targetMessage
        : sourceConversation.messages[targetIndex + 1]?.role === 'assistant'
          ? sourceConversation.messages[targetIndex + 1]
          : null;
      const assistantMessage: Message = {
        content: '',
        id: `regenerating-${Date.now()}`,
        modelName: oldAssistant?.modelName || getSelectedModel(config),
        parts: [],
        profileId: isSideraConversationScope(selectedScope) ? undefined : oldAssistant?.profileId || sourceConversation.defaultProfileId || activeProfileId || undefined,
        role: 'assistant',
        timestamp: Date.now(),
      };
      const nextConversation = {
        ...sourceConversation,
        messages: [...sourceConversation.messages.slice(0, userIndex + 1), assistantMessage],
        updatedAt: Date.now(),
      };

      responseStartTimeRef.current = performance.now();
      setCurrentResponse('');
      setIsGenerating(true);
      setCurrentConversation(nextConversation);
      optimisticConversationRef.current = nextConversation;
      clearLiveToolParts(liveToolPartsRef.current, { conversationId: selectedConversation, messageId: assistantMessage.id });
      const cleanup = subscribeToResponseStream({
        api,
        conversationId: selectedConversation,
        messageId: assistantMessage.id,
        onComplete: () => {
          window.setTimeout(() => {
            void (async () => {
              await loadConversation(selectedConversation);
              await loadConversations(selectedScope);
              onConversationsChanged?.();
            })();
          }, 100);
        },
      });

      try {
        await api.regenerateMessage(selectedConversation, String(message.id));
      } catch (error) {
        console.error('[Chat] Failed to regenerate message:', error);
        setIsGenerating(false);
        optimisticConversationRef.current = null;
        cleanup();
        await loadConversation(selectedConversation);
      }
    }
  };

  useEffect(() => {
    void loadAttachmentPreviewUrls(currentConversation);
  }, [currentConversation?.id, currentConversation?.messages]);

  useEffect(() => {
    void loadProfilesAndConfig();
  }, []);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.onUserAvatarChanged) return;

    const unsubscribe = api.onUserAvatarChanged(() => {
      void loadProfilesAndConfig();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setHistoryNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    void loadConversations(selectedScope);
    setSelectedConversation(null);
    setCurrentConversation(null);
    setIsNewConversationDraft(true);
  }, [agentId]);

  useEffect(() => {
    if (activeRecent) {
      const api = getElectronAPI();
      setSelectedConversation(activeRecent);
      setIsNewConversationDraft(false);
      api?.setCurrentConversation(activeRecent, selectedScope);
    }
  }, [activeRecent, selectedScope]);

  useEffect(() => {
    void loadConversation(selectedConversation);
  }, [selectedConversation]);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.onConversationUpdated) return;

    const handleConversationUpdated = (conversation: Conversation) => {
      void loadConversations(selectedScope);
      const isSelectedConversation = selectedConversation === conversation.id;
      const isLiveDraftReplacement =
        isGenerating &&
        Boolean(selectedConversation?.startsWith('draft-')) &&
        conversation.source !== 'whatsapp' &&
        conversation.messages.some((message) => message.role === 'assistant' && (message.parts || []).some((part) => part.type === 'tool'));

      if (isSelectedConversation || isLiveDraftReplacement) {
        if (isLiveDraftReplacement) {
          setSelectedConversation(conversation.id);
          api.setCurrentConversation(conversation.id, selectedScope);
        }
        setCurrentConversation(conversation);
        optimisticConversationRef.current = conversation;
        setIsNewConversationDraft(false);
      }
      onConversationsChanged?.();
    };

    const unsubscribe = api.onConversationUpdated(handleConversationUpdated);

    return () => {
      unsubscribe();
    };
  }, [isGenerating, onConversationsChanged, selectedConversation, selectedScope]);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    const onToolCall = (payload: ToolPart | ToolCallEnvelope) => {
      const normalized = normalizeToolCallPayload(payload);
      if (!normalized?.conversationId || !normalized.messageId) return;
      const { conversationId, messageId, tool } = normalized;
      const route = { conversationId, messageId };
      const scopedLiveParts = upsertLiveToolPart(getLiveToolParts(liveToolPartsRef.current, conversationId, messageId), tool);
      setLiveToolParts(liveToolPartsRef.current, route, scopedLiveParts);
      setCurrentConversation((previous) => {
        const sourceConversation = previous || optimisticConversationRef.current;
        if (!sourceConversation) return previous;
        if (sourceConversation.id !== conversationId) return previous;
        const messages = [...sourceConversation.messages];
        const targetIndex = messages.findIndex((message) => message.id === messageId);
        const lastMessage = targetIndex >= 0 ? messages[targetIndex] : messages[messages.length - 1];
        if (!isLiveAssistantMessage(lastMessage)) {
          const assistantMessage: Message = {
            content: '',
            id: messageId,
            modelName: getSelectedModel(config),
            parts: [tool],
            profileId: sourceConversation.defaultProfileId || activeProfileId || undefined,
            role: 'assistant',
            timestamp: Date.now(),
          };
          const nextConversation = { ...sourceConversation, messages: [...messages, assistantMessage] };
          optimisticConversationRef.current = nextConversation;
          return nextConversation;
        }
        const nextMessage = {
          ...lastMessage,
          parts: mergeLiveToolParts([...(lastMessage.parts || [])], scopedLiveParts),
        };
        if (targetIndex >= 0) {
          messages[targetIndex] = nextMessage;
        } else {
          messages[messages.length - 1] = nextMessage;
        }
        const nextConversation = { ...sourceConversation, messages };
        optimisticConversationRef.current = nextConversation;
        return nextConversation;
      });
    };

    const onToolResult = (payload: any) => {
      const normalized = normalizeToolResultPayload(payload);
      if (!normalized?.conversationId || !normalized.messageId) return;
      const { conversationId, messageId, result } = normalized;
      let appliedLiveUpdate = false;
      const nextScopedLiveParts = updateLiveToolPart(
        getLiveToolParts(liveToolPartsRef.current, conversationId, messageId),
        (part) => {
          const matches = part.id === result.id;
          if (matches) appliedLiveUpdate = true;
          return matches;
        },
        (part) => ({
          ...part,
          result: result.result,
          status: result.success ? 'success' : 'error',
          phase: undefined,
          updatedAt: Date.now(),
          resultUpdatedAt: Date.now(),
        }),
      );
      setLiveToolParts(liveToolPartsRef.current, { conversationId, messageId }, nextScopedLiveParts);
      setCurrentConversation((previous) => {
        const sourceConversation = previous || optimisticConversationRef.current;
        if (!sourceConversation) return previous;
        if (sourceConversation.id !== conversationId) return previous;
        const messages = [...sourceConversation.messages];
        const targetIndex = messages.findIndex((message) => message.id === messageId);
        if (targetIndex === -1) return previous;
        const lastMessage = targetIndex >= 0 ? messages[targetIndex] : messages[messages.length - 1];
        if (!isLiveAssistantMessage(lastMessage)) return previous;

        const parts = [...(lastMessage.parts || [])];
        const toolIndex = parts.map((part) => (part.type === 'tool' ? part.id : '')).lastIndexOf(result.id);
        if (toolIndex === -1 && !appliedLiveUpdate) return previous;

        const part = toolIndex >= 0 ? parts[toolIndex] : null;
        if (part?.type === 'tool') {
          parts[toolIndex] = {
            ...part,
            result: result.result,
            status: result.success ? 'success' : 'error',
            phase: undefined,
            updatedAt: Date.now(),
            resultUpdatedAt: Date.now(),
          };
        }

        const nextMessage = { ...lastMessage, parts: mergeLiveToolParts(parts, nextScopedLiveParts) };
        if (targetIndex >= 0) {
          messages[targetIndex] = nextMessage;
        } else {
          messages[messages.length - 1] = nextMessage;
        }
        const nextConversation = { ...sourceConversation, messages };
        optimisticConversationRef.current = nextConversation;
        return nextConversation;
      });
    };

    const onToolConfirmationRequest = (request: any) => {
      const normalized = normalizeConfirmationPayload(request);
      if (!normalized?.conversationId || !normalized.messageId) return;
      let appliedLiveUpdate = false;
      const fallbackPart = createConfirmationPart(normalized);
      let nextScopedLiveParts = updateLiveToolPart(
        getLiveToolParts(liveToolPartsRef.current, normalized.conversationId, normalized.messageId),
        (part) => {
          const matches = normalized.toolCallId ? part.id === normalized.toolCallId : false;
          if (matches) appliedLiveUpdate = true;
          return matches;
        },
        (part) => ({
          ...part,
          confirmation: normalized as any,
          status: 'pending',
          updatedAt: Date.now(),
          confirmationUpdatedAt: Date.now(),
        }),
      );
      if (!appliedLiveUpdate) {
        nextScopedLiveParts = upsertLiveToolPart(nextScopedLiveParts, fallbackPart);
        appliedLiveUpdate = true;
      }
      setLiveToolParts(liveToolPartsRef.current, { conversationId: normalized.conversationId, messageId: normalized.messageId }, nextScopedLiveParts);
      setCurrentConversation((previous) => {
        const sourceConversation = previous || optimisticConversationRef.current;
        if (!sourceConversation) return previous;
        if (sourceConversation.id !== normalized.conversationId) return previous;
        const messages = [...sourceConversation.messages];
        const targetIndex = messages.findIndex((message) => message.id === normalized.messageId);
        if (targetIndex === -1) return previous;
        const lastMessage = messages[targetIndex];
        if (!isLiveAssistantMessage(lastMessage)) return previous;

        const parts = [...(lastMessage.parts || [])];
        const toolIndex = findConfirmationToolIndex(parts, normalized);

        const part = toolIndex >= 0 ? parts[toolIndex] : null;
        if (part?.type === 'tool') {
          parts[toolIndex] = {
            ...part,
            confirmation: normalized as any,
            status: 'pending',
            updatedAt: Date.now(),
            confirmationUpdatedAt: Date.now(),
          };
        } else {
          parts.push(fallbackPart);
        }

        messages[targetIndex] = { ...lastMessage, parts: mergeLiveToolParts(parts, nextScopedLiveParts) };
        const nextConversation = { ...sourceConversation, messages };
        optimisticConversationRef.current = nextConversation;
        return nextConversation;
      });
    };

    const unsubscribeToolCall = api.onAIToolCall(onToolCall);
    const unsubscribeToolResult = api.onAIToolResult(onToolResult);
    const unsubscribeToolConfirmation = api.onAIToolConfirmationRequest(onToolConfirmationRequest);

    return () => {
      unsubscribeToolCall();
      unsubscribeToolResult();
      unsubscribeToolConfirmation();
    };
  }, []);

  useEffect(() => {
    if (!isGenerating) return;

    setCurrentConversation((previous) => {
      if (!previous) return previous;
      const messages = [...previous.messages];
      const lastMessage = messages[messages.length - 1];
      if (!isLiveAssistantMessage(lastMessage)) return previous;

      const previousText = lastMessage.content || '';
      const newText = currentResponse.slice(previousText.length);
      const partsRoute = getLiveToolParts(liveToolPartsRef.current, previous.id, lastMessage.id);
      let parts = mergeLiveToolParts([...(lastMessage.parts || [])], partsRoute);
      if (newText) {
        const lastPart = parts[parts.length - 1];
        if (lastPart?.type === 'text') {
          parts[parts.length - 1] = { ...lastPart, content: lastPart.content + newText };
        } else {
          parts.push({ type: 'text', content: newText });
        }
      }

      messages[messages.length - 1] = {
        ...lastMessage,
        content: currentResponse,
        parts,
      };
      const nextConversation = { ...previous, messages };
      optimisticConversationRef.current = nextConversation;
      return nextConversation;
    });
  }, [currentResponse, isGenerating]);

  useEffect(() => {
    const scroller = chatListRef.current;
    if (!scroller) return;

    const updateAutoScroll = () => {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom < 120;
    };

    updateAutoScroll();
    scroller.addEventListener('scroll', updateAutoScroll, { passive: true });

    return () => {
      scroller.removeEventListener('scroll', updateAutoScroll);
    };
  }, [selectedConversation]);

  useEffect(() => {
    if (!isGenerating || !shouldAutoScrollRef.current) return;

    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      const scroller = chatListRef.current;
      if (!scroller) return;

      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: 'smooth',
      });
      autoScrollFrameRef.current = null;
    });

    return () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [currentResponse, isGenerating]);

  useEffect(() => {
    if (isGenerating) return;
    if (responseStartTimeRef.current === null) return;

    const elapsed = Math.round(((performance.now() - responseStartTimeRef.current) / 1000) * 100) / 100;
    responseStartTimeRef.current = null;

    setCurrentConversation((previous) => {
      if (!previous) return previous;
      const messages = [...previous.messages];
      const lastMessage = messages[messages.length - 1];
      if (!isLiveAssistantMessage(lastMessage)) return previous;
      messages[messages.length - 1] = { ...lastMessage, responseTimeSeconds: elapsed };
      return { ...previous, messages };
    });
  }, [isGenerating]);

  useEffect(() => {
    onRegisterNewConversation?.(startNewConversation);
    return () => onRegisterNewConversation?.(null);
  }, [onRegisterNewConversation, selectedScope, activeProfileId]);

  const renderHomeStart = () => (
    <div className="app-chat-start app-chat-home-start">
      <div className="app-chat-welcome">
        <span className="app-chat-welcome-mark">
          <Sparkles size={26} strokeWidth={1.7} />
        </span>
        <div>
          <h1>{homeWelcome}</h1>
        </div>
      </div>

      {profiles.length > 0 && (
        <section className="app-chat-agent-section" aria-label="Agenti disponibili">
          <div className="app-chat-start-heading">
            <h2>Agenti</h2>
            <p>Alege agentul pentru o conversatie directa.</p>
          </div>
          <div className="app-chat-agent-grid">
            {profiles.map((profile) => (
              <button
                className="app-chat-agent-card app-chat-agent-general"
                key={profile.id}
                onClick={() => handleSelectAgentCard(profile)}
                type="button"
              >
                <span>{renderAgentAvatar(profile)}</span>
                <strong>{profile.name}</strong>
                <p>{profile.description || 'Conversatie directa cu agentul.'}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="app-chat-template-section" aria-label="Sabloane de raspuns">
        <div className="app-chat-start-heading">
          <h2>Sabloane rapide</h2>
          <p>Alegerea completeaza inputul. Mesajul ramane la tine pana apesi Trimite.</p>
        </div>
        <div className="app-chat-template-grid">
          {replyTemplates.map((template) => {
            const Icon = template.icon;

            return (
              <button key={template.label} onClick={() => applyTemplate(template.prompt)} type="button">
                <span>
                  <Icon size={16} strokeWidth={1.8} />
                </span>
                <strong>{template.label}</strong>
                <small>{template.prompt.trim()}</small>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderAgentStart = () => (
    <div className="app-chat-start app-chat-agent-start">
      <div className="app-chat-agent-profile">
        <span>
          {(() => {
            const profile = profiles.find((item) => item.id === agentId);
            return profile ? renderAgentAvatar(profile) : <Bot size={34} strokeWidth={1.7} />;
          })()}
        </span>
        <h1>{effectiveAgentName}</h1>
        <p>{profiles.find((profile) => profile.id === agentId)?.description || 'Conversatie reala cu agentul selectat.'}</p>
      </div>
    </div>
  );

  const hasConversationMessages = messages.length > 0;
  const chatListVersion = (currentConversation?.messages || [])
    .map((message) => `${message.id}:${message.content?.length || 0}:${getMessagePartsVersion(message)}`)
    .join('~');

  return (
    <section className="app-chat-page" aria-label="Chat AI">
      <div className="app-chat-main">
        <div className="app-chat-list-shell">
          <div className="app-chat-list-wrap" data-state={hasConversationMessages ? 'conversation' : 'welcome'} ref={chatListRef}>
            <div aria-hidden={hasConversationMessages} className="app-chat-welcome-layer">
              {isSideraScope(agentId) ? renderHomeStart() : renderAgentStart()}
            </div>
            <div aria-hidden={!hasConversationMessages} className="app-chat-conversation-layer">
              {hasConversationMessages && (
                <>
                  <ChatList
                    key={chatListVersion}
                    data={messages}
                    onActionsClick={handleActionClick}
                    onMessageChange={handleMessageChange}
                    renderActions={{ default: SafeChatActionsBar }}
                    renderMessages={{
                      default: SafeChatMessage,
                    }}
                    showAvatar
                    showTitle
                    text={{
                      copy: 'Copiaza',
                      copySuccess: 'Copiat',
                      delete: 'Sterge',
                      edit: 'Editeaza',
                      regenerate: 'Regenereaza',
                    }}
                    variant="bubble"
                  />
                </>
              )}
            </div>
          </div>
          {hasConversationMessages && (
            <BackBottom className="app-chat-back-bottom" target={chatListRef} text="La final" visibilityHeight={120} />
          )}
        </div>

        <div ref={chatInputRef}>
          <ChatInputArea
            autoSize={{ maxRows: 6, minRows: 2 }}
            bottomAddons={
              <ChatInputFooter
                attachmentsCount={attachments.length}
                canSend={Boolean(inputValue.trim()) || attachments.length > 0}
                isGenerating={isGenerating}
                onAddAttachment={handleAddAttachment}
                onSend={() => void handleSend()}
                onStop={() => void handleStop()}
                onTranscript={handleTranscript}
                sttEnabled={sttEnabled}
                tokenUsage={tokenUsage}
              />
            }
            className="app-chat-input-area"
            expand={false}
            heights={{ inputHeight, maxHeight: 260, minHeight: 132 }}
            onInput={setInputValue}
            onPointerDown={focusChatInput}
            onSend={() => void handleSend()}
            onSizeChange={(_: unknown, size: { height?: number | string } | undefined) => setInputHeight(Number(size?.height ?? inputHeight))}
            placeholder={`Scrie un mesaj pentru ${effectiveAgentName}...`}
            resize={{ top: true }}
            topAddons={<AttachmentPreview attachments={attachments} onRemoveAttachment={handleRemoveAttachment} />}
            value={inputValue}
          />
        </div>
      </div>

      {historyPinned && (
        <aside className="app-chat-history-panel">
          <div className="app-chat-history-body">
          <header className="app-chat-history-header">
            <div className="app-chat-history-header-title">
              <strong>Istoric</strong>
              <small>{appConversations.length} conversatii</small>
            </div>
            <div className="app-chat-history-header-actions">
              <button
                aria-pressed={historyPinned}
                className="app-chat-history-pin"
                onClick={() => setHistoryPinned((current) => !current)}
                title={historyPinned ? 'Unpin' : 'Pin'}
                type="button"
              >
                {historyPinned ? <PinOff size={15} strokeWidth={1.8} /> : <Pin size={15} strokeWidth={1.8} />}
              </button>
              <DropdownMenu
                items={[
                  {
                    icon: Clock3,
                    key: 'hour',
                    label: 'Ultima ora',
                    onClick: () => void clearHistory('hour'),
                  },
                  {
                    icon: CalendarDays,
                    key: 'today',
                    label: 'Azi',
                    onClick: () => void clearHistory('today'),
                  },
                  { type: 'divider' },
                  {
                    icon: Trash2,
                    key: 'all',
                    label: 'Toate',
                    onClick: () => void clearHistory('all'),
                  },
                ]}
                nativeButton
                placement="bottomRight"
              >
                <Button className="app-chat-history-clear" icon={Trash2} size="small" type="text">
                  Sterge
                </Button>
              </DropdownMenu>
            </div>
          </header>
          <div className="app-chat-history-scroll">
            {groupedHistory.map((group) => (
              <section className="app-chat-history-group" key={group.label}>
                <h4>{group.label}</h4>
                {group.items.map((item) => (
                  <div
                    aria-current={selectedConversation === item.id ? 'page' : undefined}
                    className="app-chat-history-row"
                    key={item.id}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      handleSelectConversation(item.id);
                    }}
                    onClick={() => handleSelectConversation(item.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <MessageSquare size={14} strokeWidth={1.8} />
                    <span className="app-chat-history-row-main">
                      <strong>{item.name || 'Conversatie noua'}</strong>
                      <small>
                        <span>{getConversationAgentLabel(item)}</span>
                        <span className="app-chat-history-live-time">{formatHistoryTime(getConversationTimestamp(item), historyNow)}</span>
                      </small>
                    </span>
                    <button
                      aria-label="Arhiveaza conversatia"
                      className="app-chat-history-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleArchiveConversation(item);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        void handleArchiveConversation(item);
                      }}
                      type="button"
                    >
                      <Archive size={13} strokeWidth={1.9} />
                    </button>
                  </div>
                ))}
              </section>
            ))}
            {groupedHistory.length === 0 && (
              <section className="app-chat-history-group">
                <h4>Istoric</h4>
                <div aria-disabled="true" className="app-chat-history-row">
                  <PlayCircle size={14} strokeWidth={1.8} />
                  <span className="app-chat-history-row-main">
                    <strong>Nicio conversatie inca</strong>
                    <small>Apasa Conversatie noua sau trimite un mesaj.</small>
                  </span>
                </div>
              </section>
            )}
          </div>
          {whatsappConversations.length > 0 && (
            <footer className="app-chat-history-whatsapp">
              <div className="app-chat-history-whatsapp-heading">
                <span>WhatsApp</span>
                <small>{whatsappConversations.length} active</small>
              </div>
              {whatsappConversations.map((item) => (
                <div
                  aria-current={selectedConversation === item.id ? 'page' : undefined}
                  className="app-chat-history-whatsapp-row"
                  key={item.id}
                >
                  <button
                    className="app-chat-history-whatsapp-open"
                    onClick={() => handleSelectConversation(item.id)}
                    type="button"
                  >
                    <MessageSquare size={14} strokeWidth={1.8} />
                    <span>
                      <strong>{getConversationAgentLabel(item)}</strong>
                      <small>{getWhatsAppContactLabel(item)} - {formatHistoryTime(getConversationTimestamp(item), historyNow)}</small>
                    </span>
                  </button>
                  <div className="app-chat-history-whatsapp-actions">
                    {item.messages.length > 0 && (
                      <button
                        aria-label="Goleste mesajele chatului WhatsApp"
                        className="app-chat-history-whatsapp-clear"
                        onClick={() => {
                          void handleClearWhatsAppConversation(item);
                        }}
                        type="button"
                      >
                        <RotateCcw size={12} strokeWidth={1.9} />
                        <span>Goleste</span>
                      </button>
                    )}
                    <button
                      aria-label="Sterge chatul WhatsApp"
                      className="app-chat-history-whatsapp-delete"
                      onClick={() => {
                        void handleDeleteWhatsAppConversation(item);
                      }}
                      type="button"
                    >
                      <Trash2 size={12} strokeWidth={1.9} />
                      <span>Sterge</span>
                    </button>
                  </div>
                </div>
              ))}
            </footer>
          )}
          </div>
        </aside>
      )}
    </section>
  );
}

export default ChatPage;

