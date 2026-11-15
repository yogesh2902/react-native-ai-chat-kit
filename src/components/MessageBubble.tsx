import React, { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { StreamingMarkdown } from '../markdown/StreamingMarkdown';
import { useChatTheme } from '../theme';
import { getMessageText, type ChatMessage } from '../types';
import { ToolCallCard } from './ToolCallCard';
import { TypingIndicator } from './TypingIndicator';

export type MessageBubbleProps = {
  message: ChatMessage;
  /** Only the latest assistant message shows Retry. */
  isLast?: boolean;
  onRetry?: () => void;
  onCopyMessage?: (text: string) => void;
  onCopyCode?: (code: string) => void;
  onLinkPress?: (url: string) => void;
};

function MessageBubbleImpl({ message, isLast, onRetry, onCopyMessage, onCopyCode, onLinkPress }: MessageBubbleProps) {
  const theme = useChatTheme();
  const isUser = message.role === 'user';
  const streaming = message.status === 'streaming';
  const color = isUser ? theme.colors.userText : theme.colors.assistantText;
  const lastPart = message.parts[message.parts.length - 1];
  const waiting = streaming && (message.parts.length === 0 || lastPart?.type === 'tool-call' && lastPart.state === 'done');

  if (message.role === 'system') return null;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          isUser ? styles.userBubble : styles.assistantBubble,
          {
            backgroundColor: isUser ? theme.colors.userBubble : theme.colors.assistantBubble,
            borderRadius: theme.radius,
          },
          !isUser && theme.colors.assistantBubble !== 'transparent' && styles.assistantPadded,
        ]}
      >
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return isUser ? (
              <Text key={i} selectable style={{ color, fontSize: theme.fontSize, lineHeight: theme.lineHeight }}>
                {part.text}
              </Text>
            ) : (
              <StreamingMarkdown
                key={i}
                streaming={streaming && i === message.parts.length - 1}
                color={color}
                onCopyCode={onCopyCode}
                onLinkPress={onLinkPress}
              >
                {part.text}
              </StreamingMarkdown>
            );
          }
          if (part.type === 'tool-call') return <ToolCallCard key={part.id} part={part} />;
          if (part.type === 'image') {
            const ratio = part.width && part.height ? part.width / part.height : 4 / 3;
            return (
              <Image
                key={i}
                source={{ uri: part.uri }}
                accessibilityIgnoresInvertColors
                style={[styles.image, { aspectRatio: ratio, borderRadius: theme.radius * 0.6 }]}
              />
            );
          }
          return null;
        })}

        {waiting ? <TypingIndicator /> : null}

        {message.status === 'error' ? (
          <View style={styles.errorRow}>
            <Text style={{ color: theme.colors.danger, fontSize: theme.fontSize * 0.85, flexShrink: 1 }}>
              {message.error ?? 'Something went wrong.'}
            </Text>
          </View>
        ) : null}

        {message.status === 'stopped' ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize * 0.8, marginTop: 6 }}>Stopped</Text>
        ) : null}
      </View>

      {!isUser && !streaming && (onCopyMessage || (isLast && onRetry)) ? (
        <View style={styles.actions}>
          {onCopyMessage && getMessageText(message) ? (
            <ActionButton label="Copy" onPress={() => onCopyMessage(getMessageText(message))} />
          ) : null}
          {isLast && onRetry ? <ActionButton label="Retry" onPress={onRetry} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useChatTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { borderColor: theme.colors.border, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 6 },
  rowUser: { alignItems: 'flex-end' },
  rowAssistant: { alignItems: 'stretch' },
  userBubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 9 },
  assistantBubble: { maxWidth: '100%' },
  assistantPadded: { paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start', maxWidth: '92%' },
  image: { width: 220, marginBottom: 6 },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
