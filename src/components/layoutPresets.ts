import type { ChatTheme } from '../theme';
import type { ChatLayout } from './customization';

/** Theme defaults behind each layout preset; your own `theme` overrides still win. */
export function presetTheme(base: ChatTheme, layout: ChatLayout = 'minimal'): ChatTheme {
  if (layout === 'bubbles') {
    return {
      ...base,
      colors: { ...base.colors, assistantBubble: base.colors.inputBackground, userBubble: base.colors.accent, userText: base.colors.onAccent },
    };
  }
  if (layout === 'compact') {
    return { ...base, fontSize: base.fontSize - 1, lineHeight: base.lineHeight - 3, radius: Math.max(8, base.radius - 6) };
  }
  return base;
}
