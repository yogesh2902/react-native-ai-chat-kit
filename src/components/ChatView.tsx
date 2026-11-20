import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  I18nManager,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ChatLabelsContext, mergeLabels, useChatLabels, type ChatLabelsOverrides } from '../labels';
import { isRTLLanguage, labelsForLanguage, type ChatLanguage } from '../locales';
import { fontStyle, useChatTheme } from '../theme';
import { toSpeakableText } from '../markdown/plainText';
import { isNetworkError } from '../adapters/network';
import { getMessageText, type ChatAttachment, type ChatMessage, type ChatSource, type FilePart, type ReplyReference } from '../types';
import { canContinue, toReplyReference, type SendOptions } from '../useChat';
import { expandCommand, matchCommand, type ChatCommand } from '../commands';
import { CodeBlockOptionsContext, MarkdownFeaturesContext, type CodeBlockOptions, type MarkdownFeatures, type MathOptions } from '../markdown/StreamingMarkdown';
import { ImageViewer } from './ImageViewer';
import { DocumentViewer, type DocumentViewerAdapter } from './DocumentViewer';
import { VoiceMode } from './VoiceMode';
import { ModelPicker, type ChatModelOption } from './ModelPicker';
import { resolveCodeBlocks, resolveReasoning } from './featureSwitches';
import { buildListItems, formatMessageTime, type ChatListItem } from './chatListItems';
import { MessageMenu, type MessageMenuItem } from './MessageMenu';
import { WelcomeScreen } from './WelcomeScreen';
import { ChatThemeProvider, type ThemeProps } from './ChatThemeProvider';
import { Composer, type ComposerProps } from './Composer';
import type {
  AttachmentPickers,
  ChatFeedbackEvent,
  ChatFeedbackHandler,
  ChatLayout,
  ChatStyles,
  MessageAction,
  NetworkMonitor,
  TypingIndicatorStyle,
  WelcomeConfig,
  MessageRenderers,
  SendButtonRenderProps,
  SpeechRecognizer,
  StopButtonRenderProps,
  TextToSpeech,
} from './customization';
import { MessageBubble } from './MessageBubble';
import { useKeyboardInset } from './useKeyboardInset';

export type ChatViewProps = ThemeProps & MessageRenderers & {
  messages: ChatMessage[];
  /** `send` from useChat. */
  send: (text: string, options?: SendOptions) => void;
  stop?: () => void;
  retry?: () => void;
  isStreaming?: boolean;

  placeholder?: string;
  /** Tappable starter prompts shown while the conversation is empty. */
  suggestions?: string[];
  emptyState?: React.ReactNode;
  header?: React.ReactNode;

  onCopyMessage?: (text: string) => void;
  onCopyCode?: (code: string) => void;
  onLinkPress?: (url: string) => void;

  /** Image/document sharing. See createExpoAttachmentPickers. */
  attachments?: AttachmentPickers;
  /** Max attachments per message. Default 5. */
  maxAttachments?: number;
  /** Speech-to-text mic button. See createExpoSpeechRecognizer / createWebSpeechRecognizer. */
  voice?: SpeechRecognizer;
  /** Send dictated text automatically when the user stops speaking. */
  autoSendVoice?: boolean;
  /** Read replies aloud (adds a Listen button). See createExpoSpeech. */
  speech?: TextToSpeech;

  /** Style overrides for individual pieces (bubbles, input, chips…). */
  styles?: ChatStyles;
  /** Replace the send button. Call `onPress` to send. */
  renderSendButton?: (props: SendButtonRenderProps) => React.ReactNode;
  /** Replace the stop button shown while a reply streams. */
  renderStopButton?: (props: StopButtonRenderProps) => React.ReactNode;

  /** Translate or reword any text in the UI, e.g. `{ placeholder: 'संदेश लिखें', copy: 'कॉपी' }`. */
  labels?: ChatLabelsOverrides;
  /**
   * Use a built-in translation: 'hi', 'ar', 'es', 'fr', 'de', 'pt', 'ja', 'zh' or 'en'
   * (region codes like 'pt-BR' work too). `labels` still overrides single strings.
   */
  language?: ChatLanguage | (string & {});
  /**
   * Show 👍/👎 under replies and get called when the user rates one (`null` = rating removed).
   * With `useChat`/`useChatSessions` spread in, the rating is also saved on the message.
   */
  onFeedback?: (message: ChatMessage, rating: 'up' | 'down' | null) => void;
  /** `rateMessage` from useChat (spread in automatically). */
  rateMessage?: (id: string, rating: 'up' | 'down' | null) => void;
  /** `editMessage` from useChat. When present, the latest user message gets an Edit action. Set `allowEdit={false}` to hide it. */
  editMessage?: (id: string, text: string, options?: { command?: { name: string; input: string } }) => void;
  allowEdit?: boolean;
  /** Also edit older messages (long-press → Edit). The original stays as a branch (‹ 1/2 ›). Default false. */
  editAnyMessage?: boolean;
  /**
   * Render LaTeX math in replies (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) as readable Unicode. Default false,
   * because `$` is common in normal text. Pass `{ render }` to use your own math renderer.
   */
  math?: boolean | MathOptions;
  /** Tapping an image in a message. Defaults to the built-in full-screen viewer (`imageViewer={false}` turns it off). */
  onImagePress?: (uri: string, alt?: string) => void;
  imageViewer?: boolean;
  /**
   * Slash commands: typing `/` suggests them; `/summarize text` sends the expanded prompt
   * (the bubble shows `/summarize text`). See `defaultCommands`.
   */
  commands?: ChatCommand[];
  /**
   * Tap a file in a message to preview it. Text files (txt, md, csv, json, code) render in the app;
   * PDFs need `documentViewer` (see createExpoDocumentViewer). Default true.
   */
  documentPreview?: boolean;
  documentViewer?: DocumentViewerAdapter;
  /**
   * Hands-free voice conversation (listen → answer aloud → listen again), opened from a
   * button next to the mic. Needs `voice` and `speech`. Default false.
   */
  voiceMode?: boolean;
  /** Handle file taps yourself instead of the built-in preview. */
  onFilePress?: (file: FilePart) => void;
  /** Messages written while offline wait in the chat and send when the connection returns. Needs `network`. Default true. */
  offlineQueue?: boolean;
  /** `flushQueue` from useChat (spread in). */
  flushQueue?: () => void;
  /**
   * Show a Continue button under a reply that was cut off (token limit, Stop, or a dropped
   * connection). Needs `continueReply` from useChat. Default true.
   */
  allowContinue?: boolean;
  /** `continueReply` from useChat (spread in). */
  continueReply?: () => void;
  /**
   * Long chats render the newest messages first and load older ones as you scroll up,
   * this many at a time. Default 40. `false` renders every message.
   */
  pageSize?: number | false;
  /** `selectBranch` from useChat (spread in). Shows ‹ 1/2 › on edited messages. */
  selectBranch?: (id: string, index: number) => void;
  /**
   * Follow-up chips under the latest reply. By default they come from the
   * reply itself (a `suggestions` stream event). Pass a function to create them
   * in the app instead, or `false` to hide them.
   */
  followUps?: false | ((message: ChatMessage) => string[] | undefined);

  /** 'minimal' (default), 'bubbles' or 'compact'. */
  layout?: ChatLayout;
  /** Look of the indicator shown before the first token: 'dots' (default), 'pulse' or 'text'. */
  typingIndicator?: TypingIndicatorStyle;
  /** Show a cursor at the end of a streaming reply. `true` uses '▍', or pass your own character. */
  streamingCursor?: boolean | string;
  /** Extra actions for the long-press menu (and inline buttons with `inline: true`). */
  messageActions?: MessageAction[] | ((message: ChatMessage) => MessageAction[]);
  /** `deleteMessage` from useChat (spread in). Shown in the long-press menu when `allowDelete` is true. */
  deleteMessage?: (id: string) => void;
  allowDelete?: boolean;
  /** A richer empty screen: logo, greeting and starter cards. */
  welcome?: WelcomeConfig;
  /** Time under each message. Also turns on date separators unless `dateSeparators` is set. */
  showTimestamps?: boolean;
  dateSeparators?: boolean;
  formatTime?: (date: Date) => string;
  /** Connectivity source for the offline banner. See createNetInfoMonitor / createWebNetworkMonitor. */
  network?: NetworkMonitor;
  /** Retry a reply that failed for lack of network once the device is back online. Default true. */
  autoRetry?: boolean;
  /** 'auto' (default) follows the app's RTL setting; 'rtl' mirrors the layout for Arabic, Urdu, Hebrew… */
  direction?: 'ltr' | 'rtl' | 'auto';
  /** Message actions as a compact icon toolbar ('icons', default) or text buttons ('labels'). */
  actionsStyle?: 'icons' | 'labels';
  /** Fade new messages in. Default true (off automatically with Reduce Motion). */
  animations?: boolean;

  /**
   * The model's reasoning above replies. `true` or 'collapsed' (default): shown closed, tap to open.
   * 'expanded': shown open. `false`: hidden.
   */
  reasoning?: boolean | 'collapsed' | 'expanded';
  /** Source chips under replies that cite pages. Default true. */
  showSources?: boolean;
  /** Tapping a source chip or citation. Defaults to opening its URL. */
  onSourcePress?: (source: ChatSource, index: number) => void;
  /** Turn [1], [2]… in replies into tappable superscripts that open the matching source. Default true. */
  linkCitations?: boolean;
  /** `selectVersion` from useChat (spread in). Shows ‹ 2/3 › on regenerated replies. Set `replyVersions={false}` to hide it. */
  selectVersion?: (id: string, index: number) => void;
  replyVersions?: boolean;
  /** Quote reply: swipe a message (or pick Reply in its menu) to quote it in the next message. Default false. */
  allowReply?: boolean;
  /** Models to choose from. Shows a model picker above the input. Spread `useChat` in for `model` / `setModel`. */
  models?: ChatModelOption[];
  /** The selected model id (from useChat). */
  model?: string;
  /** Switch the model (from useChat). */
  setModel?: (id: string) => void;
  /** Called after the user picks a model. */
  onModelChange?: (id: string) => void;
  /** Show the built-in picker when `models` is set. Default true; set false to place `<ModelPicker>` yourself, e.g. in your header. */
  showModelPicker?: boolean;
  /**
   * Code block look: highlighting, line numbers, light/dark theme, or your own renderer.
   * `true` (default) uses the defaults; `false` shows plain code (no colors, no line numbers).
   */
  codeBlocks?: boolean | CodeBlockOptions;
  /** `respondToTool` from useChat (spread in). Shows Approve / Deny on tools that need the user's OK. */
  respondToTool?: (toolCallId: string, approved: boolean) => void;
  /** Called when the user approves or denies a tool, e.g. for analytics. */
  onToolDecision?: (toolCallId: string, approved: boolean) => void;
  /** Haptic feedback on chat events. See createExpoHaptics. Off unless passed. */
  haptics?: ChatFeedbackHandler;
  /** Sounds on chat events. See createExpoSounds. Off unless passed. */
  sounds?: ChatFeedbackHandler;

  /** Fully replace how a message renders. */
  renderMessage?: (message: ChatMessage, index: number) => React.ReactElement | null;

  /**
   * Space to leave between the keyboard and the composer, in points. The chat
   * measures the keyboard itself, so headers above it no longer need an offset.
   */
  keyboardVerticalOffset?: number;
  bottomInset?: number;
  composerProps?: Partial<ComposerProps>;
  style?: StyleProp<ViewStyle>;
};

export function ChatView({ colorScheme, theme, palette, labels, language, ...props }: ChatViewProps) {
  const merged = useMemo(() => mergeLabels(labels, labelsForLanguage(language)), [labels, language]);
  // Arabic and other right-to-left languages mirror the layout unless `direction` says otherwise.
  const direction = props.direction ?? (isRTLLanguage(language) ? 'rtl' : undefined);
  return (
    <ChatThemeProvider colorScheme={colorScheme} theme={theme} palette={palette} layout={props.layout}>
      <ChatLabelsContext.Provider value={merged}>
        <ChatViewInner {...props} direction={direction} />
      </ChatLabelsContext.Provider>
    </ChatThemeProvider>
  );
}

function ChatViewInner({
  messages,
  send,
  stop,
  retry,
  isStreaming,
  placeholder,
  suggestions,
  emptyState,
  header,
  onCopyMessage,
  onCopyCode,
  onLinkPress,
  renderMessage,
  keyboardVerticalOffset = 0,
  bottomInset,
  composerProps,
  style,
  styles: custom = {},
  renderAvatar,
  renderToolCall,
  renderTypingIndicator,
  renderSendButton,
  renderStopButton,
  attachments,
  maxAttachments,
  voice,
  autoSendVoice,
  speech,
  onFeedback,
  rateMessage,
  editMessage,
  allowEdit = true,
  followUps,
  layout = 'minimal',
  typingIndicator,
  streamingCursor,
  messageActions,
  deleteMessage,
  allowDelete = false,
  welcome,
  showTimestamps = false,
  dateSeparators,
  formatTime = formatMessageTime,
  network,
  autoRetry = true,
  direction = 'auto',
  actionsStyle = 'icons',
  animations = true,
  reasoning = 'collapsed',
  showSources = true,
  onSourcePress,
  selectVersion,
  replyVersions = true,
  allowReply = false,
  models,
  model,
  setModel,
  onModelChange,
  showModelPicker = true,
  codeBlocks,
  haptics,
  sounds,
  respondToTool,
  onToolDecision,
  linkCitations = true,
  editAnyMessage = false,
  selectBranch,
  math = false,
  onImagePress,
  imageViewer = true,
  commands,
  offlineQueue = true,
  flushQueue,
  allowContinue = true,
  continueReply,
  pageSize = 40,
  documentPreview = true,
  documentViewer,
  onFilePress,
  voiceMode = false,
}: Omit<ChatViewProps, keyof ThemeProps | 'labels' | 'language'>) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const listRef = useRef<FlatList<ChatListItem>>(null);
  const latestDataRef = useRef<ChatListItem[]>([]);
  const [showJump, setShowJump] = useState(false);

  // Connectivity, read by send handlers (the banner state is set further down).
  const onlineRef = useRef(network?.isOnline?.() ?? true);
  const networkRef = useRef(network);
  networkRef.current = network;

  // Haptics and sounds share one event stream.
  const feedbackRef = useRef({ haptics, sounds });
  feedbackRef.current = { haptics, sounds };
  const feedback = useCallback((event: ChatFeedbackEvent) => {
    feedbackRef.current.haptics?.(event);
    feedbackRef.current.sounds?.(event);
  }, []);

  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  // A reply finishing (or failing) is detected from the messages themselves,
  // so it works with any hook and with stop/retry.
  const lastStatusRef = useRef<{ id: string; status?: string } | null>(null);
  useEffect(() => {
    let last: ChatMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant') {
        last = messages[i];
        break;
      }
    }
    const previous = lastStatusRef.current;
    lastStatusRef.current = last ? { id: last.id, status: last.status } : null;
    if (!last || !previous || previous.id !== last.id || previous.status !== 'streaming') return;
    // Screen readers: say when the answer is ready, since it streamed in silently.
    if (last.status === 'done') {
      feedback('replyDone');
      AccessibilityInfo.announceForAccessibility?.(labelsRef.current.replyReady);
    } else if (last.status === 'error') {
      feedback('error');
      AccessibilityInfo.announceForAccessibility?.(`${labelsRef.current.replyFailed}. ${last.error ?? ''}`.trim());
    }
  }, [messages, feedback]);

  // Code block options, kept stable so finished blocks don't re-render on every token.
  const code = typeof codeBlocks === 'object' ? codeBlocks : undefined;
  const codeOptions = useMemo<CodeBlockOptions>(
    () => resolveCodeBlocks(codeBlocks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [codeBlocks === false, code?.highlight, code?.lineNumbers, code?.theme, code?.header, code?.renderCodeBlock],
  );
  const reasoningMode = resolveReasoning(reasoning);

  // Inverted list: newest message sits at offset 0, so streaming text grows
  // upward from the composer and the view stays pinned to the bottom for free.
  const withDates = dateSeparators ?? showTimestamps;

  // Long chats: render from `oldestId` on; older messages load a page at a time as you scroll up.
  // The window is anchored to a message, so new replies never push what you're reading out of it.
  const pageLimit = pageSize === false ? Infinity : Math.max(1, Math.floor(pageSize));
  const [oldestId, setOldestId] = useState<string | undefined>(undefined);
  const start = useMemo(() => {
    if (pageLimit === Infinity) return 0;
    const at = oldestId ? messages.findIndex((m) => m.id === oldestId) : -1;
    return at >= 0 ? at : Math.max(0, messages.length - pageLimit);
  }, [messages, oldestId, pageLimit]);
  useEffect(() => {
    const id = pageLimit === Infinity ? undefined : messages[start]?.id;
    if (id !== oldestId) setOldestId(id);
  }, [messages, start, oldestId, pageLimit]);
  const loadEarlier = useCallback(() => {
    if (start <= 0) return;
    setOldestId(messages[Math.max(0, start - pageLimit)]?.id);
  }, [messages, start, pageLimit]);
  const visibleMessages = useMemo(() => (start > 0 ? messages.slice(start) : messages), [messages, start]);
  const data = useMemo(() => buildListItems(visibleMessages, { dateSeparators: withDates, labels }), [visibleMessages, withDates, labels]);
  const indexById = useMemo(() => new Map(messages.map((m, i) => [m.id, i])), [messages]);
  latestDataRef.current = data;

  // Animate only messages that just arrived. When many appear at once
  // (opening a saved chat), they show in place instead of all flying in.
  // (Keyed by when each id was first seen, so a repeated render pass gives the same answer.)
  const firstSeen = useRef<Map<string, { at: number; bulk: boolean }> | null>(null);
  const freshIds = useMemo(() => {
    const now = Date.now();
    const initial = !firstSeen.current;
    if (!firstSeen.current) firstSeen.current = new Map();
    const seen = firstSeen.current;
    const added = messages.filter((m) => !seen.has(m.id));
    const bulk = initial || added.length > 2;
    for (const m of added) seen.set(m.id, { at: now, bulk });
    if (!animations) return new Set<string>();
    return new Set(
      messages
        .filter((m) => {
          const entry = seen.get(m.id);
          return entry && !entry.bulk && now - entry.at < 600;
        })
        .map((m) => m.id),
    );
  }, [messages, animations]);
  const cursor = streamingCursor === true ? '▍' : streamingCursor || undefined;
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'assistant') return messages[i]!.id;
    return undefined;
  }, [messages]);

  const lastUserId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return messages[i]!.id;
    return undefined;
  }, [messages]);

  // Feedback: save the rating on the message (if the hook is spread in) and tell the app.
  const handleFeedback = useCallback(
    (message: ChatMessage, rating: 'up' | 'down' | null) => {
      feedback('rate');
      rateMessage?.(message.id, rating);
      onFeedback?.(message, rating);
    },
    [rateMessage, onFeedback, feedback],
  );

  // Edit & resend: the composer switches to edit mode for the chosen message.
  const [editing, setEditing] = useState<{ id: string; key: string; text: string } | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyReference | null>(null);
  const startEdit = useCallback((message: ChatMessage) => {
    setReplyingTo(null);
    // A slash-command message is edited as typed (`/summarize …`), not as its expanded prompt.
    const text = message.command ? `/${message.command.name} ${message.command.input}`.trim() : getMessageText(message);
    setEditing({ id: message.id, key: `${message.id}:${Date.now()}`, text });
  }, []);
  const startReply = useCallback((message: ChatMessage) => {
    setEditing(null);
    setReplyingTo(toReplyReference(message));
  }, []);
  useEffect(() => {
    // The message being edited or quoted disappeared (new chat, history switch): leave that mode.
    if (editing && !messages.some((m) => m.id === editing.id)) setEditing(null);
    if (replyingTo && !messages.some((m) => m.id === replyingTo.id)) setReplyingTo(null);
  }, [messages, editing, replyingTo]);
  const handleSend = useCallback(
    (text: string, options?: { attachments?: ChatAttachment[] }) => {
      // Slash commands: run app code, or send the expanded prompt and remember what was typed.
      const matched = matchCommand(text, commands);
      if (matched?.command.onRun && !editing) {
        feedback('select');
        matched.command.onRun(matched.input);
        return;
      }
      const command = matched ? { name: matched.command.name, input: matched.input } : undefined;
      const outgoing = matched ? expandCommand(matched.command, matched.input) : text;
      feedback('send');
      if (editing && editMessage) {
        editMessage(editing.id, outgoing, command ? { command } : undefined);
        setEditing(null);
        return;
      }
      const queue = offlineQueue && !!networkRef.current && !onlineRef.current;
      send(outgoing, {
        ...options,
        ...(replyingTo ? { replyTo: replyingTo } : {}),
        ...(command ? { command } : {}),
        ...(queue ? { queue: true } : {}),
      });
      setReplyingTo(null);
    },
    [editing, editMessage, send, replyingTo, feedback, commands, offlineQueue],
  );
  const sendText = useCallback(
    (text: string) => {
      feedback('send');
      send(text, offlineQueue && networkRef.current && !onlineRef.current ? { queue: true } : undefined);
    },
    [send, feedback, offlineQueue],
  );

  // Tapping a quote scrolls to the original and briefly highlights it.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const jumpTo = useCallback((id: string) => {
    const index = latestDataRef.current.findIndex((item) => item.kind === 'message' && item.message.id === id);
    if (index < 0) {
      // The quoted message is in an older page: show it, then scroll once it's rendered.
      const all = messagesRef.current;
      const at = all.findIndex((m) => m.id === id);
      if (at < 0) return;
      setOldestId(all[Math.max(0, at - 2)]?.id);
      setTimeout(() => jumpToRef.current(id), 300);
      return;
    }
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1400);
  }, []);
  const jumpToRef = useRef(jumpTo);
  jumpToRef.current = jumpTo;

  const handleToolDecision = useCallback(
    (toolCallId: string, approved: boolean) => {
      respondToTool?.(toolCallId, approved);
      onToolDecision?.(toolCallId, approved);
    },
    [respondToTool, onToolDecision],
  );

  // Image viewer
  const [viewing, setViewing] = useState<{ uri: string; alt?: string } | null>(null);
  const handleImagePress = useMemo(
    () => onImagePress ?? (imageViewer ? (uri: string, alt?: string) => setViewing({ uri, alt }) : undefined),
    [onImagePress, imageViewer],
  );
  const [voiceOpen, setVoiceOpen] = useState(false);
  const canVoiceMode = voiceMode && !!voice && !!speech;
  const [viewingFile, setViewingFile] = useState<FilePart | null>(null);
  const handleFilePress = useMemo(
    () => onFilePress ?? (documentPreview ? (file: FilePart) => setViewingFile(file) : undefined),
    [onFilePress, documentPreview],
  );
  const mathRender = typeof math === 'object' ? math.render : undefined;
  const markdownFeatures = useMemo<MarkdownFeatures>(
    () => ({ math: math ? { render: mathRender } : undefined, onImagePress: handleImagePress }),
    [!!math, mathRender, handleImagePress], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleSelectBranch = useCallback(
    (message: ChatMessage, index: number) => selectBranch?.(message.id, index),
    [selectBranch],
  );

  const handleSelectVersion = useCallback(
    (message: ChatMessage, index: number) => selectVersion?.(message.id, index),
    [selectVersion],
  );
  const dir = direction === 'auto' ? (I18nManager.isRTL ? 'rtl' : 'ltr') : direction;
  const modelNames = useMemo(() => new Map((models ?? []).map((m) => [m.id, m.name])), [models]);

  // Follow-up chips: from the reply's own suggestions, or the app's function.
  const withFollowUps = useCallback(
    (message: ChatMessage): ChatMessage => {
      if (followUps === false || message.role !== 'assistant') return message;
      if (!followUps) return message;
      const generated = followUps(message);
      return generated?.length ? { ...message, suggestions: generated } : message;
    },
    [followUps],
  );

  const handleSuggestion = sendText;

  const lastMessage = messages[messages.length - 1];
  const continuableId =
    allowContinue && continueReply && !isStreaming && lastMessage && canContinue(lastMessage) ? lastMessage.id : undefined;
  const handleContinue = useCallback(() => {
    feedback('send');
    continueReply?.();
  }, [continueReply, feedback]);

  // Read-aloud: one message at a time; tapping again stops it.
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const onSpeak = useCallback(
    (message: ChatMessage) => {
      if (!speech) return;
      if (speakingId === message.id) {
        speech.stop();
        setSpeakingId(null);
        return;
      }
      setSpeakingId(message.id);
      speech.speak(toSpeakableText(getMessageText(message)), {
        onDone: () => setSpeakingId((current) => (current === message.id ? null : current)),
      });
    },
    [speech, speakingId],
  );
  useEffect(() => () => speech?.stop(), [speech]);

  // Custom actions and the long-press menu.
  const actionsFor = useCallback(
    (message: ChatMessage): MessageAction[] =>
      !messageActions ? [] : typeof messageActions === 'function' ? messageActions(message) : messageActions,
    [messageActions],
  );
  const menuEnabled = !!messageActions || (allowDelete && !!deleteMessage) || allowReply || (editAnyMessage && allowEdit && !!editMessage);
  const [menuMessage, setMenuMessage] = useState<ChatMessage | null>(null);
  const openMenu = useCallback(
    (message: ChatMessage) => {
      feedback('longPress');
      setMenuMessage(message);
    },
    [feedback],
  );
  const menuItems: MessageMenuItem[] = useMemo(() => {
    if (!menuMessage) return [];
    const text = getMessageText(menuMessage);
    const items: MessageMenuItem[] = [];
    if (allowReply && menuMessage.status !== 'streaming') items.push({ key: 'reply', icon: '↩\uFE0E', label: labels.reply, onPress: () => startReply(menuMessage) });
    if (onCopyMessage && text) items.push({ key: 'copy', icon: '⧉', label: labels.copy, onPress: () => onCopyMessage(text) });
    if (menuMessage.role === 'user' && allowEdit && editMessage && (editAnyMessage || menuMessage.id === lastUserId) && !isStreaming) {
      items.push({ key: 'edit', icon: '✎', label: labels.edit, onPress: () => startEdit(menuMessage) });
    }
    for (const action of actionsFor(menuMessage)) {
      items.push({ key: `custom:${action.key}`, icon: action.icon, label: action.label, destructive: action.destructive, onPress: () => action.onPress(menuMessage) });
    }
    if (allowDelete && deleteMessage) {
      items.push({ key: 'delete', icon: '🗑', label: labels.deleteMessage, destructive: true, onPress: () => deleteMessage(menuMessage.id) });
    }
    return items;
  }, [menuMessage, onCopyMessage, labels, allowEdit, editMessage, lastUserId, isStreaming, startEdit, actionsFor, allowDelete, deleteMessage, allowReply, startReply, editAnyMessage]);

  // Offline banner, and retrying a reply that failed for lack of network once we're back.
  const [online, setOnline] = useState(() => network?.isOnline?.() ?? true);
  const [reconnecting, setReconnecting] = useState(false);
  const latest = useRef({ messages, retry, autoRetry });
  latest.current = { messages, retry, autoRetry };
  useEffect(() => {
    if (!network) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasOnline = network.isOnline?.() ?? true;
    onlineRef.current = wasOnline;
    setOnline(wasOnline);
    const unsubscribe = network.subscribe((isOnline) => {
      onlineRef.current = isOnline;
      setOnline(isOnline);
      if (isOnline && !wasOnline) {
        const last = latest.current.messages[latest.current.messages.length - 1];
        if (latest.current.autoRetry && last?.role === 'assistant' && last.status === 'error' && isNetworkError(last.error)) {
          setReconnecting(true);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => setReconnecting(false), 2500);
          latest.current.retry?.();
        }
      }
      wasOnline = isOnline;
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [network]);

  // Send messages queued while offline, one reply at a time, once we're online.
  const queuedCount = useMemo(() => messages.filter((m) => m.status === 'queued').length, [messages]);
  useEffect(() => {
    if (!offlineQueue || !flushQueue || !queuedCount || isStreaming || !online) return;
    flushQueue();
  }, [offlineQueue, flushQueue, queuedCount, isStreaming, online, messages]);

  const renderItem = useCallback(
    ({ item: listItem }: ListRenderItemInfo<ChatListItem>) => {
      if (listItem.kind === 'date') {
        return (
          <View style={styles.dateRow} accessibilityRole="header">
            <Text style={[styles.dateText, { color: theme.colors.textMuted, backgroundColor: theme.colors.inputBackground }, fontStyle(theme, 'bold')]}>
              {listItem.label}
            </Text>
          </View>
        );
      }
      const item = listItem.message;
      return renderMessage ? (
        renderMessage(item, indexById.get(item.id) ?? 0)
      ) : (
        <MessageBubble
          animateIn={freshIds.has(item.id)}
          actionsStyle={actionsStyle}
          layout={layout}
          typingIndicator={typingIndicator}
          streamingCursor={cursor}
          inlineActions={item.role === 'assistant' ? actionsFor(item).filter((a) => a.inline) : undefined}
          onLongPress={menuEnabled ? openMenu : undefined}
          timestamp={showTimestamps && item.status !== 'streaming' ? formatTime(new Date(item.createdAt)) : undefined}
          message={item.id === lastAssistantId ? withFollowUps(item) : item}
          isLast={item.id === lastAssistantId}
          onFeedback={onFeedback ? handleFeedback : undefined}
          onEdit={allowEdit && editMessage && item.id === lastUserId && !isStreaming ? startEdit : undefined}
          onSuggestionPress={followUps === false ? undefined : handleSuggestion}
          onRetry={retry}
          onCopyMessage={onCopyMessage}
          onCopyCode={onCopyCode}
          onLinkPress={onLinkPress}
          renderAvatar={renderAvatar}
          renderToolCall={renderToolCall}
          renderTypingIndicator={renderTypingIndicator}
          styles={custom}
          onSpeak={speech ? onSpeak : undefined}
          speaking={item.id === speakingId}
          reasoning={reasoningMode}
          showSources={showSources}
          onSourcePress={onSourcePress}
          onSelectVersion={replyVersions && selectVersion && item.id === lastAssistantId && !isStreaming ? handleSelectVersion : undefined}
          onReply={allowReply && item.status !== 'streaming' ? startReply : undefined}
          onQuotePress={jumpTo}
          onFeedbackEvent={feedback}
          modelName={item.model && models ? modelNames.get(item.model) : undefined}
          rtl={dir === 'rtl'}
          highlighted={item.id === flashId}
          onToolDecision={respondToTool || onToolDecision ? handleToolDecision : undefined}
          linkCitations={linkCitations}
          onSelectBranch={selectBranch && !isStreaming ? handleSelectBranch : undefined}
          onImagePress={handleImagePress}
          onFilePress={handleFilePress}
          onContinue={item.id === continuableId ? handleContinue : undefined}
        />
      );
    },
    [
      theme,
      indexById,
      freshIds,
      actionsStyle,
      layout,
      typingIndicator,
      cursor,
      actionsFor,
      menuEnabled,
      openMenu,
      showTimestamps,
      formatTime,
      renderMessage,
      lastAssistantId,
      retry,
      onCopyMessage,
      onCopyCode,
      onLinkPress,
      renderAvatar,
      renderToolCall,
      renderTypingIndicator,
      custom,
      speech,
      onSpeak,
      speakingId,
      withFollowUps,
      onFeedback,
      handleFeedback,
      allowEdit,
      editMessage,
      lastUserId,
      isStreaming,
      startEdit,
      followUps,
      handleSuggestion,
      reasoningMode,
      showSources,
      onSourcePress,
      replyVersions,
      selectVersion,
      handleSelectVersion,
      allowReply,
      startReply,
      jumpTo,
      feedback,
      models,
      modelNames,
      dir,
      flashId,
      respondToTool,
      onToolDecision,
      handleToolDecision,
      linkCitations,
      selectBranch,
      handleSelectBranch,
      handleImagePress,
      handleFilePress,
      continuableId,
      handleContinue,
    ],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const away = e.nativeEvent.contentOffset.y > 240;
    setShowJump((prev) => (prev === away ? prev : away));
  }, []);

  const empty = messages.length === 0;
  const rootRef = useRef<React.ComponentRef<typeof View>>(null);
  const keyboard = useKeyboardInset(rootRef);
  const rootStyle = [styles.root, { backgroundColor: theme.colors.background, direction: dir } as const, style];

  const body = (
    <>
      {header}
      {empty && welcome && !emptyState ? (
        <Pressable style={styles.welcome} onPress={Keyboard.dismiss} accessible={false}>
          <WelcomeScreen config={welcome} onSend={sendText} />
        </Pressable>
      ) : empty ? (
        // Tapping empty space closes the keyboard (the message list does this on its own).
        <Pressable style={styles.empty} onPress={Keyboard.dismiss} accessible={false}>
          {emptyState ?? (
            <Text style={[{ color: theme.colors.text, fontSize: theme.fontSize * 1.4, textAlign: 'center' }, fontStyle(theme, 'bold')]}>
              {labels.emptyTitle}
            </Text>
          )}
          {suggestions?.length ? (
            <View style={styles.suggestions}>
              {suggestions.map((s) => (
                <Pressable
                  key={s}
                  accessibilityRole="button"
                  onPress={() => sendText(s)}
                  style={({ pressed }) => [
                    styles.chip,
                    { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground, opacity: pressed ? 0.7 : 1 },
                    custom.suggestionChip,
                  ]}
                >
                  <Text style={[{ color: theme.colors.text, fontSize: theme.fontSize * 0.9 }, fontStyle(theme), custom.suggestionText]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Pressable>
      ) : (
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            data={data}
            inverted
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            onScroll={onScroll}
            scrollEventThrottle={64}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              // The target isn't rendered yet: scroll near it, then try again.
              listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: true });
              setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 250);
            }}
            contentContainerStyle={[styles.listContent, custom.listContent]}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={9}
            onEndReached={start > 0 ? loadEarlier : undefined}
            onEndReachedThreshold={0.4}
            // Inverted: the footer sits at the top, above the oldest message shown.
            ListFooterComponent={
              start > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={loadEarlier}
                  style={({ pressed }) => [styles.loadEarlier, { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={[{ color: theme.colors.textMuted, fontSize: theme.fontSize * 0.8 }, fontStyle(theme, 'bold')]}>
                    {labels.loadEarlier(Math.min(start, pageLimit))}
                  </Text>
                </Pressable>
              ) : undefined
            }
          />
          {showJump ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.scrollToLatest}
              onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
              style={[styles.jump, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
            >
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>↓</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {network && (!online || reconnecting) ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.banner, { backgroundColor: online ? theme.colors.success : theme.colors.text }]}
        >
          <Text style={[styles.bannerText, { color: theme.colors.background }, fontStyle(theme, 'bold')]}>
            {online ? labels.reconnecting : queuedCount ? labels.offlineQueued(queuedCount) : labels.offline}
          </Text>
        </View>
      ) : null}
      <Composer
        onSend={handleSend}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        commands={commands}
        onVoiceMode={
          canVoiceMode
            ? () => {
                feedback('select');
                speech?.stop();
                setVoiceOpen(true);
              }
            : undefined
        }
        topAccessory={
          models?.length && showModelPicker ? (
            <ModelPicker
              models={models}
              value={model}
              disabled={isStreaming}
              bottomInset={bottomInset}
              onChange={(id) => {
                feedback('select');
                setModel?.(id);
                onModelChange?.(id);
              }}
            />
          ) : undefined
        }
        onStop={stop}
        isStreaming={isStreaming}
        placeholder={placeholder}
        // The keyboard covers the home indicator / nav bar, so drop that inset while it's open.
        bottomInset={keyboard.visible ? 0 : bottomInset}
        renderSendButton={renderSendButton}
        renderStopButton={renderStopButton}
        style={custom.composer}
        boxStyle={custom.composerBox}
        inputStyle={custom.input}
        attachments={attachments}
        maxAttachments={maxAttachments}
        voice={voice}
        autoSendVoice={autoSendVoice}
        {...composerProps}
      />
      {menuEnabled ? (
        <MessageMenu message={menuMessage} items={menuItems} onClose={() => setMenuMessage(null)} bottomInset={bottomInset} />
      ) : null}
    </>
  );

  // Both platforms: lift the chat by exactly how much of it the keyboard covers.
  return (
    <CodeBlockOptionsContext.Provider value={codeOptions}>
      <MarkdownFeaturesContext.Provider value={markdownFeatures}>
        <View ref={rootRef} style={[rootStyle, { paddingBottom: keyboard.overlap > 0 ? keyboard.overlap + keyboardVerticalOffset : 0 }]}>
          {body}
          {imageViewer && !onImagePress ? <ImageViewer image={viewing} onClose={() => setViewing(null)} /> : null}
          {canVoiceMode && voice && speech ? (
            <VoiceMode
              visible={voiceOpen}
              onClose={() => setVoiceOpen(false)}
              voice={voice}
              speech={speech}
              send={sendText}
              messages={messages}
              isStreaming={isStreaming}
              stop={stop}
              onStateChange={(state) => state === 'listening' && feedback('select')}
            />
          ) : null}
          {documentPreview && !onFilePress ? (
            <DocumentViewer file={viewingFile} adapter={documentViewer} onClose={() => setViewingFile(null)} />
          ) : null}
        </View>
      </MarkdownFeaturesContext.Provider>
    </CodeBlockOptionsContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listWrap: { flex: 1 },
  listContent: { paddingVertical: 12 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  welcome: { flex: 1 },
  dateRow: { alignItems: 'center', paddingVertical: 8 },
  loadEarlier: {
    alignSelf: 'center',
    marginVertical: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dateText: { fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  banner: { marginHorizontal: 12, marginBottom: 4, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  bannerText: { fontSize: 13, textAlign: 'center' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 20 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  jump: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
