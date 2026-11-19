import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme, withAlpha } from '../theme';
import type { ToolCallPart } from '../types';
import { useReducedMotion } from './animations';

/** "search_flights" → "Search flights" */
export function humanizeToolName(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ToolCallCardProps = {
  part: ToolCallPart;
  /** Shown as Approve / Deny when the tool is waiting for the user's OK. */
  onDecision?: (approved: boolean) => void;
};

export function ToolCallCard({ part, onDecision }: ToolCallCardProps) {
  const theme = useChatTheme();
  const { colors } = theme;
  const title = part.label ?? humanizeToolName(part.name);
  const labels = useChatLabels();
  if (part.state === 'awaiting-approval') return <ApprovalCard part={part} title={title} onDecision={onDecision} />;
  const running = part.state === 'running';
  const denied = part.state === 'denied';
  const statusText = running
    ? labels.toolRunning
    : part.state === 'done'
      ? labels.toolDone
      : denied
        ? labels.toolDenied
        : part.error ?? labels.toolFailed;
  const tint = part.state === 'error' ? colors.danger : part.state === 'done' ? colors.success : denied ? colors.textMuted : colors.accent;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${title}: ${statusText}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.toolCardBackground,
          borderColor: running ? withAlpha(colors.accent, 0.35) : colors.border,
          borderRadius: theme.radius * 0.7,
        },
      ]}
    >
      {running ? <Shimmer color={colors.accent} /> : null}
      <View style={[styles.badge, { backgroundColor: withAlpha(tint, 0.14) }]}>
        {running ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Text maxFontSizeMultiplier={1.3} style={[styles.badgeGlyph, { color: tint }]}>{part.state === 'done' ? '✓' : denied ? '✕' : '!'}</Text>
        )}
      </View>
      <View style={styles.body}>
        <Text style={[{ color: colors.text, fontSize: theme.fontSize * 0.9 }, fontStyle(theme, 'bold')]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[{ color: part.state === 'error' ? colors.danger : colors.textMuted, fontSize: theme.fontSize * 0.78 }, fontStyle(theme)]} numberOfLines={2}>
          {statusText}
        </Text>
      </View>
    </View>
  );
}

/** "Hold 1 seat for ₹3,980?" with Approve / Deny. */
function ApprovalCard({ part, title, onDecision }: { part: ToolCallPart; title: string; onDecision?: (approved: boolean) => void }) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${labels.needsApproval}: ${part.approvalMessage ?? title}`}
      style={[
        styles.approval,
        { backgroundColor: colors.toolCardBackground, borderColor: withAlpha(colors.accent, 0.45), borderRadius: theme.radius * 0.7 },
      ]}
    >
      <View style={styles.approvalTop}>
        <View style={[styles.badge, { backgroundColor: withAlpha(colors.accent, 0.14) }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.badgeGlyph, { color: colors.accent }]}>?</Text>
        </View>
        <View style={styles.body}>
          <Text style={[{ color: colors.accent, fontSize: theme.fontSize * 0.74, letterSpacing: 0.3 }, fontStyle(theme, 'bold')]}>
            {labels.needsApproval.toUpperCase()}
          </Text>
          <Text style={[{ color: colors.text, fontSize: theme.fontSize * 0.92, marginTop: 1 }, fontStyle(theme, 'bold')]}>{title}</Text>
        </View>
      </View>
      {part.approvalMessage ? (
        <Text style={[{ color: colors.text, fontSize: theme.fontSize * 0.88, lineHeight: theme.fontSize * 1.3, marginTop: 8 }, fontStyle(theme)]}>
          {part.approvalMessage}
        </Text>
      ) : null}
      {onDecision ? (
        <View style={styles.approvalButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${labels.deny}: ${title}`}
            onPress={() => onDecision(false)}
            style={({ pressed }) => [styles.decision, { borderColor: colors.border, backgroundColor: pressed ? colors.inputBackground : colors.background }]}
          >
            <Text style={[{ color: colors.text, fontSize: theme.fontSize * 0.88 }, fontStyle(theme, 'bold')]}>{labels.deny}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${labels.approve}: ${title}`}
            onPress={() => onDecision(true)}
            style={({ pressed }) => [styles.decision, { borderColor: colors.accent, backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[{ color: colors.onAccent, fontSize: theme.fontSize * 0.88 }, fontStyle(theme, 'bold')]}>{labels.approve}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** A soft highlight that sweeps across the card while the tool runs. */
function Shimmer({ color }: { color: string }) {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!width || reduced) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    );
    x.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [width, x, reduced]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.6, width] });
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.shimmer, { width: width * 0.6, backgroundColor: withAlpha(color, 0.07), transform: [{ translateX }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minWidth: 230,
    overflow: 'hidden',
  },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  badgeGlyph: { fontSize: 15, fontWeight: '800' },
  body: { flexShrink: 1 },
  shimmer: { position: 'absolute', top: 0, bottom: 0 },
  approval: { borderWidth: 1.5, padding: 12, marginVertical: 6, alignSelf: 'stretch', maxWidth: 420 },
  approvalTop: { flexDirection: 'row', alignItems: 'center' },
  approvalButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  decision: { flex: 1, borderWidth: 1, borderRadius: 999, paddingVertical: 10, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
});
