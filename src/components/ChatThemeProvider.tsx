import React, { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { ChatThemeContext, darkTheme, lightTheme, mergeTheme, type ChatTheme, type ChatThemeOverrides } from '../theme';

export type ThemeProps = {
  /** 'auto' (default) follows the device setting. */
  colorScheme?: 'light' | 'dark' | 'auto';
  theme?: ChatThemeOverrides;
};

export function useResolvedTheme({ colorScheme, theme }: ThemeProps): ChatTheme {
  const system = useColorScheme();
  const scheme = colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : system === 'dark' ? 'dark' : 'light';
  return useMemo(() => mergeTheme(scheme === 'dark' ? darkTheme : lightTheme, theme), [scheme, theme]);
}

/** Share one theme between ChatView, ChatHistory and your own components. */
export function ChatThemeProvider({ children, ...props }: ThemeProps & { children: React.ReactNode }) {
  const theme = useResolvedTheme(props);
  return <ChatThemeContext.Provider value={theme}>{children}</ChatThemeContext.Provider>;
}
