/**
 * A small stand-in for 'react-native' so components render under Node with
 * react-test-renderer. Host components keep their props (accessibilityLabel,
 * onPress…), which is what the tests look for.
 */
import React from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyProps = Record<string, any> & { children?: any };

const host = (name: string) => {
  const Component = React.forwardRef<unknown, AnyProps>((props, ref) => React.createElement(name, { ...props, ref }, props.children));
  Component.displayName = name;
  return Component;
};

export const View = host('View');
export const Text = host('Text');
export const TextInput = host('TextInput');
export const ScrollView = host('ScrollView');
export const Image = host('Image');
export const ActivityIndicator = host('ActivityIndicator');

/** Pressable: resolves function styles and children with { pressed: false }. */
export const Pressable = React.forwardRef<unknown, AnyProps>(({ style, children, ...props }, ref) =>
  React.createElement(
    'Pressable',
    { ...props, ref, style: typeof style === 'function' ? style({ pressed: false, hovered: false }) : style },
    typeof children === 'function' ? children({ pressed: false }) : children,
  ),
);

/** Calls onDismiss when it closes, like iOS. */
export function Modal({ visible, children, onDismiss }: AnyProps) {
  const was = React.useRef(visible);
  React.useEffect(() => {
    if (was.current && !visible) onDismiss?.();
    was.current = visible;
  }, [visible, onDismiss]);
  return visible ? React.createElement('Modal', null, children) : null;
}

export function FlatList({ data = [], renderItem, keyExtractor, inverted, ListFooterComponent, onEndReached }: AnyProps) {
  const items = (data as unknown[]).map((item, index) =>
    React.createElement(React.Fragment, { key: keyExtractor ? keyExtractor(item, index) : index }, renderItem({ item, index })),
  );
  return React.createElement('FlatList', { inverted, onEndReached }, items, ListFooterComponent ?? null);
}

export function SectionList({ sections = [], renderItem, renderSectionHeader, keyExtractor, ListEmptyComponent, ListFooterComponent }: AnyProps) {
  const children: any[] = [];
  for (const section of sections as { title: string; data: unknown[] }[]) {
    children.push(React.createElement(React.Fragment, { key: `h-${section.title}` }, renderSectionHeader?.({ section })));
    section.data.forEach((item, index) =>
      children.push(React.createElement(React.Fragment, { key: keyExtractor ? keyExtractor(item, index) : `${section.title}-${index}` }, renderItem({ item, index, section }))),
    );
  }
  return React.createElement('SectionList', null, children.length ? children : ListEmptyComponent, ListFooterComponent);
}

class AnimatedValue {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  setValue(v: number) {
    this.value = v;
  }
  interpolate() {
    return this;
  }
}
const animation = () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {} });
export const Animated = {
  Value: AnimatedValue,
  View: host('Animated.View'),
  Text: host('Animated.Text'),
  timing: animation,
  spring: animation,
  loop: animation,
  sequence: animation,
  parallel: animation,
  delay: animation,
};
export const Easing = { out: (f: unknown) => f, in: (f: unknown) => f, inOut: (f: unknown) => f, cubic: () => 0, quad: () => 0, ease: () => 0 };

export const StyleSheet = {
  create: <T>(styles: T) => styles,
  flatten: (style: unknown) => style,
  hairlineWidth: 0.5,
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
};
export const Platform = { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.native ?? o.default };
export const I18nManager = { isRTL: false };
export const StatusBar = { currentHeight: 24 };
export const Keyboard = { addListener: () => ({ remove: () => {} }), dismiss: () => {} };
export const LayoutAnimation = { configureNext: () => {}, create: () => ({}), Types: { keyboard: 'keyboard' } };
export const AccessibilityInfo = {
  announced: [] as string[],
  isReduceMotionEnabled: () => Promise.resolve(false),
  addEventListener: () => ({ remove: () => {} }),
  announceForAccessibility(message: string) {
    this.announced.push(message);
  },
};
export const Linking = { opened: [] as string[], openURL(url: string) {
  this.opened.push(url);
  return Promise.resolve();
} };
export const Share = { share: () => Promise.resolve({ action: 'sharedAction' }) };
export const PanResponder = { create: () => ({ panHandlers: {} }) };
export const useColorScheme = () => 'light';
export const Dimensions = { get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) };
