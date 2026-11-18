import React, { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { applyPalette, ChatThemeContext, darkTheme, lightTheme, mergeTheme, type ChatPalette, type ChatTheme, type ChatThemeOverrides } from '../theme';
import type { ChatLayout } from './customization';
import { presetTheme } from './layoutPresets';

export { presetTheme };

export type ThemeProps = {
  /** 'auto' (default) follows the device setting. */
  colorScheme?: 'light' | 'dark' | 'auto';
  theme?: ChatThemeOverrides;
  /** Built-in color mood: 'neutral' (default), 'violet', 'ocean', 'sunset' or 'forest'. */
  palette?: ChatPalette;
};

export function useResolvedTheme({ colorScheme, theme, layout, palette }: ThemeProps & { layout?: ChatLayout }): ChatTheme {
  const system = useColorScheme();
  const scheme = colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : system === 'dark' ? 'dark' : 'light';
  return useMemo(
    () => mergeTheme(presetTheme(applyPalette(scheme === 'dark' ? darkTheme : lightTheme, palette, scheme), layout), theme),
    [scheme, theme, layout, palette],
  );
}

/** Share one theme between ChatView, ChatHistory and your own components. */
export function ChatThemeProvider({ children, ...props }: ThemeProps & { layout?: ChatLayout; children: React.ReactNode }) {
  const theme = useResolvedTheme(props);
  return <ChatThemeContext.Provider value={theme}>{children}</ChatThemeContext.Provider>;
}
