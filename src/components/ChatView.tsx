import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
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
import { getMessageText, type ChatAttachment, type ChatMessage } from '../types';
import { ChatThemeProvider, type ThemeProps } from './ChatThemeProvider';
import { Composer, type ComposerProps } from './Composer';
import type {
  AttachmentPickers,
  ChatStyles,
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
    <ChatThemeProvider colorScheme={colorScheme} theme={theme}>
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
}: Omit<ChatViewProps, keyof ThemeProps | 'labels'>) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [showJump, setShowJump] = useState(false);

  // Inverted list: newest message sits at offset 0, so streaming text grows
  // upward from the composer and the view stays pinned to the bottom for free.
  const data = useMemo(() => messages.filter((m) => m.role !== 'system').reverse(), [messages]);
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

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ChatMessage>) =>
      renderMessage ? (
        renderMessage(item, data.length - 1 - index)
      ) : (
        <MessageBubble
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
      ),
    [
      renderMessage,
      data.length,
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
  const rootStyle = [styles.root, { backgroundColor: theme.colors.background }, style];

  const body = (
    <>
      {header}
      {empty ? (
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
            keyExtractor={(m) => m.id}
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
