import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme } from '../theme';
import type { TypingIndicatorStyle } from './customization';

const useNativeDriver = Platform.OS !== 'web';

export type TypingIndicatorProps = {
  color?: string;
  /** 'dots' (default), 'pulse' (one breathing dot) or 'text' (a fading "Thinking…"). */
  variant?: TypingIndicatorStyle;
};

export function TypingIndicator({ color, variant = 'dots' }: TypingIndicatorProps) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const tint = color ?? theme.colors.textMuted;
  if (variant === 'pulse') return <Pulse color={tint} label={labels.thinking} />;
  if (variant === 'text') return <ShimmerText color={tint} label={labels.thinking} font={fontStyle(theme)} size={theme.fontSize * 0.95} />;
  return <Dots color={tint} label={labels.thinking} />;
}

function Dots({ color, label }: { color: string; label: string }) {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 320, useNativeDriver }),
          Animated.timing(dot, { toValue: 0.3, duration: 320, useNativeDriver }),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [dots]);

  return (
    <View style={styles.row} accessibilityLabel={label} accessibilityRole="progressbar">
      {dots.map((opacity, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity, backgroundColor: color }]} />
      ))}
    </View>
  );
}

function Pulse({ color, label }: { color: string; label: string }) {
  const scale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver }),
        Animated.timing(scale, { toValue: 0.6, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return (
    <View style={styles.row} accessibilityLabel={label} accessibilityRole="progressbar">
      <Animated.View style={[styles.pulse, { backgroundColor: color, transform: [{ scale }], opacity: scale }]} />
    </View>
  );
}

function ShimmerText({ color, label, font, size }: { color: string; label: string; font: object; size: number }) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={label}>
      <Animated.Text style={[{ color, fontSize: size, opacity }, font]}>{label}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: 24, gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pulse: { width: 12, height: 12, borderRadius: 6 },
});
