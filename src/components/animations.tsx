import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';

const useNativeDriver = Platform.OS !== 'web';

/** Respect the system "Reduce motion" setting. */
function useReduceMotion() {
  const reduce = useRef(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (!cancelled) reduce.current = value;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return reduce;
}

/**
 * Fades and slides its children up into place when first mounted.
 * With `animate={false}` (or Reduce Motion on) it renders in place immediately.
 */
export function FadeIn({
  children,
  animate = true,
  delay = 0,
  distance = 8,
  duration = 240,
  style,
}: {
  children: React.ReactNode;
  animate?: boolean;
  delay?: number;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    if (reduce.current) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver,
    });
    anim.start();
    return () => anim.stop();
    // Only on mount: later prop changes must not replay the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/** Scale-down-on-press feedback for cards and chips. */
export function usePressScale(to = 0.97) {
  const scale = useRef(new Animated.Value(1)).current;
  const animateTo = (value: number) =>
    Animated.spring(scale, { toValue: value, useNativeDriver, speed: 40, bounciness: value === 1 ? 6 : 0 }).start();
  return {
    style: { transform: [{ scale }] },
    onPressIn: () => animateTo(to),
    onPressOut: () => animateTo(1),
  };
}
