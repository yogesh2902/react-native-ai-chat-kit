import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { useChatTheme } from '../theme';

const useNativeDriver = Platform.OS !== 'web';

export function TypingIndicator({ color }: { color?: string }) {
  const theme = useChatTheme();
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
    <View style={styles.row} accessibilityLabel="Assistant is typing" accessibilityRole="progressbar">
      {dots.map((opacity, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { opacity, backgroundColor: color ?? theme.colors.textMuted }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: 24, gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
