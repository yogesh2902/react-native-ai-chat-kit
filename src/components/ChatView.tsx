import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
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
import { useChatTheme } from '../theme';
import type { ChatMessage } from '../types';
import { ChatThemeProvider, type ThemeProps } from './ChatThemeProvider';
import { Composer, type ComposerProps } from './Composer';
import { MessageBubble } from './MessageBubble';
import { useKeyboardInset } from './useKeyboardInset';

export type ChatViewProps = ThemeProps & {
  messages: ChatMessage[];
  /** `send` from useChat. */
  send: (text: string) => void;
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

  /** Fully replace how a message renders. */
  renderMessage?: (message: ChatMessage, index: number) => React.ReactElement | null;

  keyboardVerticalOffset?: number;
  bottomInset?: number;
  composerProps?: Partial<ComposerProps>;
  style?: StyleProp<ViewStyle>;
};

export function ChatView({ colorScheme, theme, ...props }: ChatViewProps) {
  return (
    <ChatThemeProvider colorScheme={colorScheme} theme={theme}>
      <ChatViewInner {...props} />
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
}: Omit<ChatViewProps, keyof ThemeProps>) {
  const theme = useChatTheme();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [showJump, setShowJump] = useState(false);

  // Inverted list: newest message sits at offset 0, so streaming text grows
  // upward from the composer and the view stays pinned to the bottom for free.
  const data = useMemo(() => messages.filter((m) => m.role !== 'system').reverse(), [messages]);
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'assistant') return messages[i]!.id;
    return undefined;
  }, [messages]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ChatMessage>) =>
      renderMessage ? (
        renderMessage(item, data.length - 1 - index)
      ) : (
        <MessageBubble
          message={item}
          isLast={item.id === lastAssistantId}
          onRetry={retry}
          onCopyMessage={onCopyMessage}
          onCopyCode={onCopyCode}
          onLinkPress={onLinkPress}
        />
      ),
    [renderMessage, data.length, lastAssistantId, retry, onCopyMessage, onCopyCode, onLinkPress],
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
        <View style={styles.empty}>
          {emptyState ?? (
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize * 1.4, fontWeight: '700', textAlign: 'center' }}>
              How can I help?
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
                  ]}
                >
                  <Text style={{ color: theme.colors.text, fontSize: theme.fontSize * 0.9 }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
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
            contentContainerStyle={styles.listContent}
          />
          {showJump ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scroll to latest message"
              onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
              style={[styles.jump, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
            >
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>↓</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      <Composer
        onSend={send}
        onStop={stop}
        isStreaming={isStreaming}
        placeholder={placeholder}
        // The keyboard covers the home indicator / nav bar, so drop that inset while it's open.
        bottomInset={keyboard.visible ? 0 : bottomInset}
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
