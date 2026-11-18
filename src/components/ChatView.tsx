import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  I18nManager,
  Keyboard,
  KeyboardAvoidingView,
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
import { fontStyle, useChatTheme } from '../theme';
import { toSpeakableText } from '../markdown/plainText';
import { isNetworkError } from '../adapters/network';
import { getMessageText, type ChatAttachment, type ChatMessage } from '../types';
import { buildListItems, formatMessageTime, type ChatListItem } from './chatListItems';
import { MessageMenu, type MessageMenuItem } from './MessageMenu';
import { WelcomeScreen } from './WelcomeScreen';
import { ChatThemeProvider, type ThemeProps } from './ChatThemeProvider';
import { Composer, type ComposerProps } from './Composer';
import type {
  AttachmentPickers,
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
  send: (text: string, options?: { attachments?: ChatAttachment[] }) => void;
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
   * Show 👍/👎 under replies and get called when the user rates one (`null` = rating removed).
   * With `useChat`/`useChatSessions` spread in, the rating is also saved on the message.
   */
  onFeedback?: (message: ChatMessage, rating: 'up' | 'down' | null) => void;
  /** `rateMessage` from useChat (spread in automatically). */
  rateMessage?: (id: string, rating: 'up' | 'down' | null) => void;
  /** `editMessage` from useChat. When present, the latest user message gets an Edit action. Set `allowEdit={false}` to hide it. */
  editMessage?: (id: string, text: string) => void;
  allowEdit?: boolean;
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

  /** Fully replace how a message renders. */
  renderMessage?: (message: ChatMessage, index: number) => React.ReactElement | null;

  keyboardVerticalOffset?: number;
  bottomInset?: number;
  composerProps?: Partial<ComposerProps>;
  style?: StyleProp<ViewStyle>;
};

export function ChatView({ colorScheme, theme, labels, ...props }: ChatViewProps) {
  const merged = useMemo(() => mergeLabels(labels), [labels]);
  return (
    <ChatThemeProvider colorScheme={colorScheme} theme={theme} layout={props.layout}>
      <ChatLabelsContext.Provider value={merged}>
        <ChatViewInner {...props} />
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
}: Omit<ChatViewProps, keyof ThemeProps | 'labels'>) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const listRef = useRef<FlatList<ChatListItem>>(null);
  const [showJump, setShowJump] = useState(false);

  // Inverted list: newest message sits at offset 0, so streaming text grows
  // upward from the composer and the view stays pinned to the bottom for free.
  const withDates = dateSeparators ?? showTimestamps;
  const data = useMemo(() => buildListItems(messages, { dateSeparators: withDates, labels }), [messages, withDates, labels]);
  const indexById = useMemo(() => new Map(messages.map((m, i) => [m.id, i])), [messages]);
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
      rateMessage?.(message.id, rating);
      onFeedback?.(message, rating);
    },
    [rateMessage, onFeedback],
  );

  // Edit & resend: the composer switches to edit mode for the chosen message.
  const [editing, setEditing] = useState<{ id: string; key: string; text: string } | null>(null);
  const startEdit = useCallback((message: ChatMessage) => {
    setEditing({ id: message.id, key: `${message.id}:${Date.now()}`, text: getMessageText(message) });
  }, []);
  useEffect(() => {
    // The message being edited disappeared (new chat, history switch): leave edit mode.
    if (editing && !messages.some((m) => m.id === editing.id)) setEditing(null);
  }, [messages, editing]);
  const handleSend = useCallback(
    (text: string, options?: { attachments?: ChatAttachment[] }) => {
      if (editing && editMessage) {
        editMessage(editing.id, text);
        setEditing(null);
        return;
      }
      send(text, options);
    },
    [editing, editMessage, send],
  );

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

  const handleSuggestion = useCallback((text: string) => send(text), [send]);

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
  const menuEnabled = !!messageActions || (allowDelete && !!deleteMessage);
  const [menuMessage, setMenuMessage] = useState<ChatMessage | null>(null);
  const openMenu = useCallback((message: ChatMessage) => setMenuMessage(message), []);
  const menuItems: MessageMenuItem[] = useMemo(() => {
    if (!menuMessage) return [];
    const text = getMessageText(menuMessage);
    const items: MessageMenuItem[] = [];
    if (onCopyMessage && text) items.push({ key: 'copy', icon: '⧉', label: labels.copy, onPress: () => onCopyMessage(text) });
    if (menuMessage.role === 'user' && allowEdit && editMessage && menuMessage.id === lastUserId && !isStreaming) {
      items.push({ key: 'edit', icon: '✎', label: labels.edit, onPress: () => startEdit(menuMessage) });
    }
    for (const action of actionsFor(menuMessage)) {
      items.push({ key: `custom:${action.key}`, icon: action.icon, label: action.label, destructive: action.destructive, onPress: () => action.onPress(menuMessage) });
    }
    if (allowDelete && deleteMessage) {
      items.push({ key: 'delete', icon: '🗑', label: labels.deleteMessage, destructive: true, onPress: () => deleteMessage(menuMessage.id) });
    }
    return items;
  }, [menuMessage, onCopyMessage, labels, allowEdit, editMessage, lastUserId, isStreaming, startEdit, actionsFor, allowDelete, deleteMessage]);

  // Offline banner, and retrying a reply that failed for lack of network once we're back.
  const [online, setOnline] = useState(() => network?.isOnline?.() ?? true);
  const [reconnecting, setReconnecting] = useState(false);
  const latest = useRef({ messages, retry, autoRetry });
  latest.current = { messages, retry, autoRetry };
  useEffect(() => {
    if (!network) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasOnline = network.isOnline?.() ?? true;
    setOnline(wasOnline);
    const unsubscribe = network.subscribe((isOnline) => {
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
        />
      );
    },
    [
      theme,
      indexById,
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
    ],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const away = e.nativeEvent.contentOffset.y > 240;
    setShowJump((prev) => (prev === away ? prev : away));
  }, []);

  const empty = messages.length === 0;
  const rootRef = useRef<React.ComponentRef<typeof View>>(null);
  const keyboard = useKeyboardInset(rootRef);
  const dir = direction === 'auto' ? (I18nManager.isRTL ? 'rtl' : 'ltr') : direction;
  const rootStyle = [styles.root, { backgroundColor: theme.colors.background, direction: dir } as const, style];

  const body = (
    <>
      {header}
      {empty && welcome && !emptyState ? (
        <Pressable style={styles.welcome} onPress={Keyboard.dismiss} accessible={false}>
          <WelcomeScreen config={welcome} onSend={(text) => send(text)} />
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
                  onPress={() => send(s)}
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
            contentContainerStyle={[styles.listContent, custom.listContent]}
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
            {online ? labels.reconnecting : labels.offline}
          </Text>
        </View>
      ) : null}
      <Composer
        onSend={handleSend}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
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

  // iOS: KeyboardAvoidingView works well. Android: pad by the measured keyboard overlap.
  return Platform.OS === 'ios' ? (
    <KeyboardAvoidingView style={rootStyle} behavior="padding" keyboardVerticalOffset={keyboardVerticalOffset}>
      {body}
    </KeyboardAvoidingView>
  ) : (
    <View ref={rootRef} style={[rootStyle, { paddingBottom: keyboard.overlap }]}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listWrap: { flex: 1 },
  listContent: { paddingVertical: 12 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  welcome: { flex: 1 },
  dateRow: { alignItems: 'center', paddingVertical: 8 },
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
