import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme, withAlpha } from '../theme';
import type { ToolCallPart } from '../types';

/** "search_flights" → "Search flights" */
export function humanizeToolName(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ToolCallCard({ part }: { part: ToolCallPart }) {
  const theme = useChatTheme();
  const { colors } = theme;
  const title = part.label ?? humanizeToolName(part.name);
  const labels = useChatLabels();
  const running = part.state === 'running';
  const statusText = running ? labels.toolRunning : part.state === 'done' ? labels.toolDone : part.error ?? labels.toolFailed;
  const tint = part.state === 'error' ? colors.danger : part.state === 'done' ? colors.success : colors.accent;

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
          <Text style={[styles.badgeGlyph, { color: tint }]}>{part.state === 'done' ? '✓' : '!'}</Text>
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

/** A soft highlight that sweeps across the card while the tool runs. */
function Shimmer({ color }: { color: string }) {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!width) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    );
    x.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [width, x]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.6, width] });
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
});
