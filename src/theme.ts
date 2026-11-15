import { createContext, useContext } from 'react';
import { Platform } from 'react-native';

export type ChatTheme = {
  colors: {
    background: string;
    text: string;
    textMuted: string;
    border: string;
    accent: string;
    onAccent: string;
    userBubble: string;
    userText: string;
    /** Use 'transparent' for the full-width assistant style. */
    assistantBubble: string;
    assistantText: string;
    inputBackground: string;
    codeBackground: string;
    codeText: string;
    codeHeader: string;
    inlineCodeBackground: string;
    link: string;
    quoteBar: string;
    toolCardBackground: string;
    success: string;
    danger: string;
  };
  syntax: { keyword: string; string: string; comment: string; number: string; fn: string };
  fontSize: number;
  lineHeight: number;
  radius: number;
  monoFont: string;
};

export type ChatThemeOverrides = {
  [K in keyof ChatTheme]?: ChatTheme[K] extends object ? Partial<ChatTheme[K]> : ChatTheme[K];
};

const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' }) as string;

export const lightTheme: ChatTheme = {
  colors: {
    background: '#FFFFFF',
    text: '#111418',
    textMuted: '#6B7280',
    border: '#E5E7EB',
    accent: '#111418',
    onAccent: '#FFFFFF',
    userBubble: '#F1F3F5',
    userText: '#111418',
    assistantBubble: 'transparent',
    assistantText: '#111418',
    inputBackground: '#F6F7F9',
    codeBackground: '#0F1117',
    codeText: '#E6E8EB',
    codeHeader: '#1A1D26',
    inlineCodeBackground: '#EEF0F3',
    link: '#2563EB',
    quoteBar: '#D1D5DB',
    toolCardBackground: '#F7F8FA',
    success: '#16A34A',
    danger: '#DC2626',
  },
  syntax: { keyword: '#C792EA', string: '#C3E88D', comment: '#6A7385', number: '#F78C6C', fn: '#82AAFF' },
  fontSize: 16,
  lineHeight: 24,
  radius: 18,
  monoFont,
};

export const darkTheme: ChatTheme = {
  ...lightTheme,
  colors: {
    background: '#0B0C0F',
    text: '#ECEDEF',
    textMuted: '#9AA0A8',
    border: '#24262C',
    accent: '#ECEDEF',
    onAccent: '#0B0C0F',
    userBubble: '#1F2127',
    userText: '#ECEDEF',
    assistantBubble: 'transparent',
    assistantText: '#ECEDEF',
    inputBackground: '#16181D',
    codeBackground: '#14161C',
    codeText: '#E6E8EB',
    codeHeader: '#1C1F27',
    inlineCodeBackground: '#22252C',
    link: '#60A5FA',
    quoteBar: '#3A3D45',
    toolCardBackground: '#15171C',
    success: '#22C55E',
    danger: '#F87171',
  },
};

export function mergeTheme(base: ChatTheme, overrides?: ChatThemeOverrides): ChatTheme {
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    colors: { ...base.colors, ...overrides.colors },
    syntax: { ...base.syntax, ...overrides.syntax },
  } as ChatTheme;
}

export const ChatThemeContext = createContext<ChatTheme>(lightTheme);
export const useChatTheme = () => useContext(ChatThemeContext);
