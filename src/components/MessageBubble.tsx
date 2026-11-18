import React, { memo, useMemo, useRef } from 'react';
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { StreamingMarkdown } from '../markdown/StreamingMarkdown';
import { fontStyle, useChatTheme, withAlpha } from '../theme';
import { getMessageText, type ChatMessage } from '../types';
import type { ChatFeedbackHandler, ChatLayout, ChatStyles, MessageAction, MessageRenderers, TypingIndicatorStyle } from './customization';
import { FadeIn, usePressScale } from './animations';
import { ReasoningBlock } from './ReasoningBlock';
import { SourceList } from './SourceList';
import type { ChatSource } from '../types';
import { ToolCallCard } from './ToolCallCard';
import { TypingIndicator } from './TypingIndicator';

export type MessageBubbleProps = MessageRenderers & {
  message: ChatMessage;
  /** Only the latest assistant message shows Retry. */
  isLast?: boolean;
  onRetry?: () => void;
  onCopyMessage?: (text: string) => void;
  onCopyCode?: (code: string) => void;
  onLinkPress?: (url: string) => void;
  styles?: ChatStyles;
  /** Shows a Listen button that reads the reply aloud. */
  onSpeak?: (message: ChatMessage) => void;
  /** This message is being read aloud right now (button shows Stop). */
  speaking?: boolean;
  /** Shows 👍/👎 under assistant replies. Called with the new rating (`null` when un-selected). */
  onFeedback?: (message: ChatMessage, rating: 'up' | 'down' | null) => void;
  /** Shows an Edit action under this (user) message. */
  onEdit?: (message: ChatMessage) => void;
  /** Tapping a follow-up suggestion chip. Chips show only on the latest reply. */
  onSuggestionPress?: (text: string) => void;
  layout?: ChatLayout;
  typingIndicator?: TypingIndicatorStyle;
  /** Character shown at the end of a reply while it streams, e.g. '▍'. */
  streamingCursor?: string;
  /** Custom actions shown as buttons under this (assistant) message. */
  inlineActions?: MessageAction[];
  /** Long-pressing the bubble (opens the message menu in ChatView). */
  onLongPress?: (message: ChatMessage) => void;
  /** Already-formatted time shown under the bubble. */
  timestamp?: string;
  /** Fade/slide in on mount (for messages that just arrived). */
  animateIn?: boolean;
  /** 'icons' (default): compact icon toolbar under replies. 'labels': text buttons. */
  actionsStyle?: 'icons' | 'labels';
  /** How the model's reasoning shows: 'collapsed' (default), 'expanded', or false to hide it. */
  reasoning?: 'collapsed' | 'expanded' | false;
  /** Show the pages a reply cites. Default true. */
  showSources?: boolean;
  onSourcePress?: (source: ChatSource, index: number) => void;
  /** Shows ‹ 2/3 › to switch between regenerated answers. */
  onSelectVersion?: (message: ChatMessage, index: number) => void;
  /** Enables swipe-to-reply on this message. */
  onReply?: (message: ChatMessage) => void;
  /** Tapping the quote in a reply (scroll to the original). */
  onQuotePress?: (id: string) => void;
  /** Haptics / sounds for swipe, version switch and reasoning toggles. */
  onFeedbackEvent?: ChatFeedbackHandler;
  /** Shown next to the timestamp, e.g. the model that wrote the reply. */
  modelName?: string;
  /** Mirror the swipe direction for right-to-left layouts. */
  rtl?: boolean;
  /** Briefly tint the message (after jumping to it from a quote). */
  highlighted?: boolean;
};

const formatBytes = (n?: number) =>
  n === undefined ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

function MessageBubbleImpl({
  message,
  isLast,
  onRetry,
  onCopyMessage,
  onCopyCode,
  onLinkPress,
  renderAvatar,
  renderToolCall,
  renderTypingIndicator,
  styles: custom = {},
  onSpeak,
  speaking,
  onFeedback,
  onEdit,
  onSuggestionPress,
  layout = 'minimal',
  typingIndicator,
  streamingCursor,
  inlineActions,
  onLongPress,
  timestamp,
  animateIn = false,
  actionsStyle = 'icons',
  reasoning = 'collapsed',
  showSources = true,
  onSourcePress,
  onSelectVersion,
  onReply,
  onQuotePress,
  onFeedbackEvent,
  modelName,
  rtl = false,
  highlighted = false,
}: MessageBubbleProps) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const isUser = message.role === 'user';
  const streaming = message.status === 'streaming';
  const color = isUser ? theme.colors.userText : theme.colors.assistantText;
  const lastPart = message.parts[message.parts.length - 1];
  const waiting = streaming && (message.parts.length === 0 || (lastPart?.type === 'tool-call' && lastPart.state === 'done'));
  const versionCount = (message.versions?.length ?? 0) + 1;
  const versionIndex = message.versionIndex ?? versionCount - 1;
  const swipe = useSwipeToReply(onReply ? () => onReply(message) : undefined, rtl, onFeedbackEvent);

  if (message.role === 'system') return null;
  const compact = layout === 'compact';
  // Long-press opens the menu; native text selection would swallow it, so Copy moves into the menu.
  const selectable = !onLongPress;
  const lastTextIndex = (() => {
    for (let i = message.parts.length - 1; i >= 0; i--) if (message.parts[i]!.type === 'text') return i;
    return -1;
  })();
  const avatar = renderAvatar?.(message);

  return (
    <FadeIn animate={animateIn} distance={isUser ? 6 : 10}>
     {swipe.icon}
     <Animated.View {...swipe.handlers} style={[styles.row, compact && styles.rowCompact, isUser && styles.rowUser, custom.messageRow, swipe.style, highlighted && { backgroundColor: withAlpha(theme.colors.accent, 0.08), borderRadius: theme.radius * 0.6 }]}>
      {avatar != null ? (
        <View style={[styles.avatar, isUser ? styles.avatarUser : styles.avatarAssistant, custom.avatar]}>{avatar}</View>
      ) : null}
      <View style={[styles.column, isUser ? styles.columnUser : styles.columnAssistant]}>
        <Pressable
          onLongPress={onLongPress ? () => onLongPress(message) : undefined}
          delayLongPress={350}
          disabled={!onLongPress}
          accessibilityHint={onLongPress ? labels.messageOptions : undefined}
          style={[
            isUser ? styles.userBubble : styles.assistantBubble,
            isUser && compact && styles.userBubbleCompact,
            {
              backgroundColor: isUser ? theme.colors.userBubble : theme.colors.assistantBubble,
              borderRadius: theme.radius,
            },
            !isUser && theme.colors.assistantBubble !== 'transparent' && (compact ? styles.assistantPaddedCompact : styles.assistantPadded),
            isUser ? custom.userBubble : custom.assistantBubble,
          ]}
        >
          {message.replyTo ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${labels.quotedMessage} ${message.replyTo.text}`}
              disabled={!onQuotePress}
              onPress={() => onQuotePress?.(message.replyTo!.id)}
              style={[
                styles.quote,
                {
                  borderLeftColor: theme.colors.accent,
                  backgroundColor: withAlpha(isUser ? theme.colors.userText : theme.colors.text, 0.06),
                  borderRadius: theme.radius * 0.45,
                },
              ]}
            >
              <Text numberOfLines={2} style={[{ color: isUser ? theme.colors.userText : theme.colors.text, fontSize: theme.fontSize * 0.82, opacity: 0.8 }, fontStyle(theme)]}>
                {message.replyTo.text}
              </Text>
            </Pressable>
          ) : null}
          {message.parts.map((part, i) => {
            if (part.type === 'reasoning') {
              if (reasoning === false || isUser || !part.text.trim()) return null;
              const thinking = streaming && i === message.parts.length - 1 && part.durationMs === undefined;
              return (
                <ReasoningBlock
                  key={`r${i}`}
                  part={part}
                  thinking={thinking}
                  defaultExpanded={reasoning === 'expanded'}
                  onToggle={() => onFeedbackEvent?.('select')}
                />
              );
            }
            if (part.type === 'text') {
              return isUser ? (
                <Text
                  key={i}
                  selectable={selectable}
                  style={[{ color, fontSize: theme.fontSize, lineHeight: theme.lineHeight }, fontStyle(theme), custom.userText]}
                >
                  {part.text}
                </Text>
              ) : (
                <StreamingMarkdown
                  key={i}
                  streaming={streaming && i === message.parts.length - 1}
                  color={color}
                  onCopyCode={onCopyCode}
                  onLinkPress={onLinkPress}
                  selectable={selectable}
                >
                  {streaming && streamingCursor && i === lastTextIndex && i === message.parts.length - 1
                    ? part.text.replace(/\s+$/, '') + streamingCursor
                    : part.text}
                </StreamingMarkdown>
              );
            }
            if (part.type === 'tool-call') {
              const customCard = renderToolCall?.(part, message);
              return <React.Fragment key={part.id}>{customCard !== undefined ? customCard : <ToolCallCard part={part} />}</React.Fragment>;
            }
            if (part.type === 'image') {
              const ratio = part.width && part.height ? part.width / part.height : 4 / 3;
              // Cache files can be cleaned up by the OS; fall back to the saved data.
              const uri = part.uri || (part.base64 ? `data:${part.mimeType ?? 'image/jpeg'};base64,${part.base64}` : '');
              if (!uri) return null;
              return (
                <Image
                  key={i}
                  source={{ uri }}
                  accessibilityIgnoresInvertColors
                  accessibilityLabel={part.name ?? 'Image'}
                  style={[styles.image, { aspectRatio: ratio, borderRadius: theme.radius * 0.6 }]}
                />
              );
            }
            if (part.type === 'file') {
              return (
                <View key={i} style={[styles.fileChip, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                  <Text style={styles.fileIcon}>📄</Text>
                  <View style={styles.fileText}>
                    <Text numberOfLines={1} style={[{ color: theme.colors.text, fontSize: 13 }, fontStyle(theme, 'bold')]}>
                      {part.name}
                    </Text>
                    <Text style={[{ color: theme.colors.textMuted, fontSize: 11 }, fontStyle(theme)]}>
                      {[part.mimeType === 'application/pdf' ? 'PDF' : part.text !== undefined ? 'Text' : 'File', formatBytes(part.size)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              );
            }
            return null;
          })}

          {waiting ? (renderTypingIndicator ? renderTypingIndicator() : <TypingIndicator variant={typingIndicator} />) : null}

          {message.status === 'error' ? (
            <View style={styles.errorRow}>
              <Text style={[{ color: theme.colors.danger, fontSize: theme.fontSize * 0.85, flexShrink: 1 }, fontStyle(theme)]}>
                {message.error ?? labels.errorFallback}
              </Text>
            </View>
          ) : null}

          {message.status === 'stopped' ? (
            <Text style={[{ color: theme.colors.textMuted, fontSize: theme.fontSize * 0.8, marginTop: 6 }, fontStyle(theme)]}>{labels.stopped}</Text>
          ) : null}
        </Pressable>

        {!isUser && showSources && message.sources?.length ? <SourceList sources={message.sources} onSourcePress={onSourcePress} /> : null}

        {timestamp || (!isUser && modelName && !streaming) ? (
          <Text style={[styles.timestamp, { color: theme.colors.textMuted }, fontStyle(theme)]}>
            {[timestamp, !isUser && !streaming ? modelName : undefined].filter(Boolean).join(' · ')}
          </Text>
        ) : null}

        {isUser && onEdit && message.status !== 'streaming' ? (
          <View style={styles.actions}>
            <ActionButton label={`✎ ${labels.edit}`} accessibilityLabel={labels.edit} onPress={() => onEdit(message)} />
          </View>
        ) : null}

        {!isUser && !streaming && (onCopyMessage || onSpeak || onFeedback || inlineActions?.length || (isLast && onRetry) || (onSelectVersion && versionCount > 1)) ? (
          <View style={[styles.actions, actionsStyle === 'icons' && styles.iconActions]}>
            {onSelectVersion && versionCount > 1 ? (
              <View style={styles.versions} accessibilityRole="adjustable" accessibilityLabel={labels.versionOf(versionIndex + 1, versionCount)}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={labels.previousVersion}
                  disabled={versionIndex === 0}
                  hitSlop={8}
                  onPress={() => {
                    onFeedbackEvent?.('select');
                    onSelectVersion(message, versionIndex - 1);
                  }}
                  style={({ pressed }) => [styles.versionArrow, { opacity: versionIndex === 0 ? 0.3 : pressed ? 0.5 : 1 }]}
                >
                  <Text style={[styles.versionGlyph, { color: theme.colors.textMuted }]}>‹</Text>
                </Pressable>
                <Text style={[styles.versionText, { color: theme.colors.textMuted }, fontStyle(theme, 'bold')]}>
                  {versionIndex + 1}/{versionCount}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={labels.nextVersion}
                  disabled={versionIndex >= versionCount - 1}
                  hitSlop={8}
                  onPress={() => {
                    onFeedbackEvent?.('select');
                    onSelectVersion(message, versionIndex + 1);
                  }}
                  style={({ pressed }) => [styles.versionArrow, { opacity: versionIndex >= versionCount - 1 ? 0.3 : pressed ? 0.5 : 1 }]}
                >
                  <Text style={[styles.versionGlyph, { color: theme.colors.textMuted }]}>›</Text>
                </Pressable>
              </View>
            ) : null}
            {onFeedback && message.status !== 'error' ? (
              <>
                <Action
                  kind={actionsStyle}
                  icon="👍"
                  emoji
                  label="👍"
                  accessibilityLabel={labels.helpful}
                  selected={message.rating === 'up'}
                  onPress={() => onFeedback(message, message.rating === 'up' ? null : 'up')}
                />
                <Action
                  kind={actionsStyle}
                  icon="👎"
                  emoji
                  label="👎"
                  accessibilityLabel={labels.notHelpful}
                  selected={message.rating === 'down'}
                  onPress={() => onFeedback(message, message.rating === 'down' ? null : 'down')}
                />
              </>
            ) : null}
            {onSpeak && getMessageText(message) ? (
              <Action
                kind={actionsStyle}
                icon={speaking ? '■' : '🔊'}
                emoji={!speaking}
                selected={speaking}
                label={speaking ? labels.stopSpeaking : labels.listen}
                accessibilityLabel={speaking ? labels.stopSpeaking.replace(/^\W+\s*/, '') : labels.listen.replace(/^\W+\s*/, '')}
                onPress={() => onSpeak(message)}
              />
            ) : null}
            {onCopyMessage && getMessageText(message) ? (
              <Action kind={actionsStyle} icon="⧉" label={labels.copy} onPress={() => onCopyMessage(getMessageText(message))} />
            ) : null}
            {inlineActions?.map((action) => (
              <Action
                key={action.key}
                kind={action.icon ? actionsStyle : 'labels'}
                icon={action.icon}
                label={action.icon && actionsStyle === 'labels' ? `${action.icon} ${action.label}` : action.label}
                accessibilityLabel={action.label}
                onPress={() => action.onPress(message)}
              />
            ))}
            {isLast && onRetry ? (
              <Action
                kind={actionsStyle}
                icon="↻"
                label={message.status === 'error' ? labels.retry : labels.regenerate}
                onPress={onRetry}
              />
            ) : null}
          </View>
        ) : null}

        {!isUser && isLast && !streaming && onSuggestionPress && message.suggestions?.length ? (
          <View style={styles.suggestions} accessibilityLabel={labels.suggestionsHint}>
            {message.suggestions.map((suggestion, i) => (
              <FadeIn key={suggestion} delay={120 + i * 70} distance={6}>
                <SuggestionChip text={suggestion} onPress={() => onSuggestionPress(suggestion)} />
              </FadeIn>
            ))}
          </View>
        ) : null}
      </View>
     </Animated.View>
    </FadeIn>
  );
}

/**
 * Swipe a message sideways to quote it in a reply (like WhatsApp). The reply
 * arrow fades in as you drag; passing the threshold gives a haptic tick.
 */
function useSwipeToReply(onReply: (() => void) | undefined, rtl: boolean, feedback?: ChatFeedbackHandler) {
  const theme = useChatTheme();
  const dx = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const latest = useRef({ onReply, feedback });
  latest.current = { onReply, feedback };
  const dir = rtl ? -1 : 1;
  const THRESHOLD = 56;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          !!latest.current.onReply && dir * g.dx > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,
        onPanResponderMove: (_e, g) => {
          const distance = Math.max(0, Math.min(84, dir * g.dx * 0.75));
          dx.setValue(distance * dir);
          if (distance >= THRESHOLD && !armed.current) {
            armed.current = true;
            latest.current.feedback?.('swipeReply');
          } else if (distance < THRESHOLD) armed.current = false;
        },
        onPanResponderRelease: () => {
          if (armed.current) latest.current.onReply?.();
          armed.current = false;
          Animated.spring(dx, { toValue: 0, useNativeDriver: true, speed: 22, bounciness: 6 }).start();
        },
        onPanResponderTerminate: () => {
          armed.current = false;
          Animated.spring(dx, { toValue: 0, useNativeDriver: true, speed: 22, bounciness: 6 }).start();
        },
      }),
    [dx, dir],
  );

  if (!onReply) return { handlers: {}, style: undefined, icon: null };
  const opacity = dx.interpolate({ inputRange: rtl ? [-THRESHOLD, -12, 0] : [0, 12, THRESHOLD], outputRange: rtl ? [1, 0, 0] : [0, 0, 1], extrapolate: 'clamp' });
  const scale = dx.interpolate({ inputRange: rtl ? [-THRESHOLD, 0] : [0, THRESHOLD], outputRange: rtl ? [1, 0.6] : [0.6, 1], extrapolate: 'clamp' });
  return {
    handlers: responder.panHandlers,
    style: { transform: [{ translateX: dx }] },
    icon: (
      <Animated.View
        pointerEvents="none"
        style={[styles.replyIcon, rtl ? styles.replyIconRtl : styles.replyIconLtr, { opacity, transform: [{ scale }], backgroundColor: theme.colors.inputBackground }]}
      >
        <Text style={{ color: theme.colors.textMuted, fontSize: 16, fontWeight: '700' }}>{'↩\uFE0E'}</Text>
      </Animated.View>
    ),
  };
}

function ActionButton({
  label,
  onPress,
  accessibilityLabel,
  selected,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  selected?: boolean;
}) {
  const theme = useChatTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor: selected ? theme.colors.inputBackground : 'transparent',
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Text style={[{ color: selected ? theme.colors.text : theme.colors.textMuted, fontSize: 12 }, fontStyle(theme, 'bold')]}>{label}</Text>
    </Pressable>
  );
}

/** One message action, as a compact icon (default) or a labelled pill. */
function Action({
  kind,
  icon,
  emoji,
  label,
  accessibilityLabel,
  selected,
  onPress,
}: {
  kind: 'icons' | 'labels';
  icon?: string;
  emoji?: boolean;
  label: string;
  accessibilityLabel?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const theme = useChatTheme();
  if (kind === 'labels' || !icon) {
    return <ActionButton label={label} accessibilityLabel={accessibilityLabel} selected={selected} onPress={onPress} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.iconButton,
        {
          backgroundColor: selected
            ? withAlpha(theme.colors.accent, 0.18)
            : pressed || hovered
              ? theme.colors.inputBackground
              : 'transparent',
        },
      ]}
    >
      {/* Emoji can't be tinted, so unselected ones are dimmed. The opacity sits on a
          View because iOS ignores it on emoji text. */}
      <View style={{ opacity: emoji && !selected ? 0.45 : 1 }}>
        <Text style={[styles.iconGlyph, !emoji && { color: selected ? theme.colors.accent : theme.colors.textMuted }]}>{icon}</Text>
      </View>
    </Pressable>
  );
}

function SuggestionChip({ text, onPress }: { text: string; onPress: () => void }) {
  const theme = useChatTheme();
  const press = usePressScale(0.95);
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.suggestion, { borderColor: theme.colors.accent, backgroundColor: theme.colors.background }]}
      >
        <Text style={[{ color: theme.colors.accent, fontSize: theme.fontSize * 0.85 }, fontStyle(theme, 'bold')]}>{text} ›</Text>
      </Pressable>
    </Animated.View>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 6 },
  rowCompact: { paddingHorizontal: 12, paddingVertical: 3 },
  timestamp: { fontSize: 11, marginTop: 4, marginHorizontal: 4 },
  rowUser: { flexDirection: 'row-reverse' },
  column: { flex: 1 },
  columnUser: { alignItems: 'flex-end' },
  columnAssistant: { alignItems: 'stretch' },
  avatar: { marginTop: 2 },
  avatarUser: { marginLeft: 8 },
  avatarAssistant: { marginRight: 10 },
  userBubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 9 },
  userBubbleCompact: { paddingHorizontal: 11, paddingVertical: 6 },
  assistantBubble: { maxWidth: '100%' },
  assistantPadded: { paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start', maxWidth: '92%' },
  assistantPaddedCompact: { paddingHorizontal: 11, paddingVertical: 7, alignSelf: 'flex-start', maxWidth: '92%' },
  image: { width: 220, marginBottom: 6 },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6, maxWidth: 260 },
  fileIcon: { fontSize: 20 },
  fileText: { flexShrink: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  suggestion: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  iconActions: { gap: 2, marginTop: 4, marginLeft: -6 },
  iconButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  versions: { flexDirection: 'row', alignItems: 'center', marginRight: 4 },
  versionArrow: { width: 22, height: 32, alignItems: 'center', justifyContent: 'center' },
  versionGlyph: { fontSize: 20, fontWeight: '600', marginTop: -2 },
  versionText: { fontSize: 12, minWidth: 26, textAlign: 'center' },
  quote: { borderLeftWidth: 3, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6 },
  replyIcon: { position: 'absolute', top: '50%', marginTop: -16, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  replyIconLtr: { left: 6 },
  replyIconRtl: { right: 6 },
  iconGlyph: { fontSize: 15, fontWeight: '600' },
});
