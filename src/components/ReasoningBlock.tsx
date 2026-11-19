import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutAnimation, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { StreamingMarkdown } from '../markdown/StreamingMarkdown';
import { fontStyle, useChatTheme, withAlpha } from '../theme';
import type { ReasoningPart } from '../types';
import { useReducedMotion } from './animations';

export type ReasoningBlockProps = {
  part: ReasoningPart;
  /** True while this reasoning is still arriving. */
  thinking: boolean;
  /** Start opened. Default false. */
  defaultExpanded?: boolean;
  /** Called when the user opens or closes the block (e.g. for a haptic tap). */
  onToggle?: (expanded: boolean) => void;
};

/**
 * The model's reasoning above its answer: "Thinking…" with a live preview while
 * it streams, then "Thought for 12s". Tap to read the whole thing.
 */
export function ReasoningBlock({ part, thinking, defaultExpanded = false, onToggle }: ReasoningBlockProps) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const seconds = part.durationMs !== undefined ? Math.round(part.durationMs / 1000) : undefined;
  const title = thinking ? labels.thinking : seconds !== undefined ? labels.thoughtFor(seconds) : labels.thinking.replace(/…$/, '');
  const preview = thinking && !expanded ? lastLine(part.text) : '';

  const toggle = () => {
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
    setExpanded((v) => {
      onToggle?.(!v);
      return !v;
    });
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${expanded ? labels.hideReasoning : labels.showReasoning}`}
        accessibilityState={{ expanded }}
        hitSlop={6}
        onPress={toggle}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.6 : 1 }]}
      >
        <View style={[styles.icon, { backgroundColor: withAlpha(colors.accent, 0.12) }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.iconGlyph, { color: colors.accent }]}>✦</Text>
        </View>
        {thinking ? (
          <ShimmerText text={title} color={colors.textMuted} highlight={colors.text} style={[{ fontSize: theme.fontSize * 0.86 }, fontStyle(theme, 'bold')]} />
        ) : (
          <Text style={[{ color: colors.textMuted, fontSize: theme.fontSize * 0.86 }, fontStyle(theme, 'bold')]}>{title}</Text>
        )}
        <Text maxFontSizeMultiplier={1.3} style={[styles.chevron, { color: colors.textMuted, transform: [{ rotate: expanded ? '90deg' : '0deg' }] }]}>›</Text>
      </Pressable>

      {preview ? (
        <Text numberOfLines={2} style={[styles.preview, { color: colors.textMuted, fontSize: theme.fontSize * 0.8 }, fontStyle(theme)]}>
          {preview}
        </Text>
      ) : null}

      {expanded ? (
        <View style={[styles.body, { borderLeftColor: colors.border }]}>
          <StreamingMarkdown streaming={thinking} color={colors.textMuted} selectable>
            {part.text}
          </StreamingMarkdown>
        </View>
      ) : null}
    </View>
  );
}

/** The last non-empty line of the reasoning, without markdown symbols. */
function lastLine(text: string): string {
  const lines = text.split('\n').map((l) => l.replace(/[*_#`>]+/g, '').trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/** Text with a soft highlight pulsing through it while the model thinks. */
function ShimmerText({ text, color, highlight, style }: { text: string; color: string; highlight: string; style: object }) {
  const t = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      t.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(t, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, reduced]);
  const animatedColor = t.interpolate({ inputRange: [0, 1], outputRange: [color, highlight] });
  return <Animated.Text style={[style, { color: animatedColor }]}>{text}</Animated.Text>;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 2 },
  icon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  iconGlyph: { fontSize: 12, fontWeight: '700' },
  chevron: { fontSize: 18, fontWeight: '600', marginTop: -2 },
  preview: { marginTop: 4, marginLeft: 30, fontStyle: 'italic' },
  body: { marginTop: 8, marginLeft: 10, paddingLeft: 18, borderLeftWidth: 2 },
});
