import type { ChatTheme } from './theme';

/** Built-in color moods. 'neutral' is the default monochrome look. */
export type ChatPalette = 'neutral' | 'violet' | 'ocean' | 'sunset' | 'forest';

type PaletteColors = Partial<ChatTheme['colors']>;

const PALETTES: Record<Exclude<ChatPalette, 'neutral'>, { light: PaletteColors; dark: PaletteColors }> = {
  violet: {
    light: { accent: '#7C3AED', onAccent: '#FFFFFF', userBubble: '#F1EBFF', userText: '#2E1065', link: '#6D28D9', quoteBar: '#C4B5FD', toolCardBackground: '#FAF7FF', inlineCodeBackground: '#F1EBFF' },
    dark: { accent: '#A78BFA', onAccent: '#140B2E', userBubble: '#2A2142', userText: '#EDE9FE', link: '#C4B5FD', quoteBar: '#5B4B8A', toolCardBackground: '#17121F', inlineCodeBackground: '#2A2142' },
  },
  ocean: {
    light: { accent: '#0284C7', onAccent: '#FFFFFF', userBubble: '#E6F4FD', userText: '#0C3149', link: '#0369A1', quoteBar: '#7DD3FC', toolCardBackground: '#F4FAFE', inlineCodeBackground: '#E6F4FD' },
    dark: { accent: '#38BDF8', onAccent: '#04121C', userBubble: '#0F2A3B', userText: '#E0F2FE', link: '#7DD3FC', quoteBar: '#1E4E6A', toolCardBackground: '#0D1820', inlineCodeBackground: '#0F2A3B' },
  },
  sunset: {
    light: { accent: '#EA580C', onAccent: '#FFFFFF', userBubble: '#FFEFE4', userText: '#431407', link: '#C2410C', quoteBar: '#FDBA74', toolCardBackground: '#FFF8F3', inlineCodeBackground: '#FFEFE4' },
    dark: { accent: '#FB923C', onAccent: '#1C0A02', userBubble: '#3A2116', userText: '#FFEDD5', link: '#FDBA74', quoteBar: '#7C3A15', toolCardBackground: '#1C130E', inlineCodeBackground: '#3A2116' },
  },
  forest: {
    light: { accent: '#15803D', onAccent: '#FFFFFF', userBubble: '#E7F6EC', userText: '#052E16', link: '#15803D', quoteBar: '#86EFAC', toolCardBackground: '#F5FBF7', inlineCodeBackground: '#E7F6EC' },
    dark: { accent: '#4ADE80', onAccent: '#03140A', userBubble: '#123222', userText: '#DCFCE7', link: '#86EFAC', quoteBar: '#1F5A37', toolCardBackground: '#0E1A13', inlineCodeBackground: '#123222' },
  },
};

/** Apply a palette to a light or dark base theme. */
export function applyPalette(base: ChatTheme, palette: ChatPalette = 'neutral', scheme: 'light' | 'dark' = 'light'): ChatTheme {
  if (palette === 'neutral') return base;
  return { ...base, colors: { ...base.colors, ...PALETTES[palette][scheme] } };
}

export const PALETTE_NAMES: ChatPalette[] = ['neutral', 'violet', 'ocean', 'sunset', 'forest'];

/** `#RRGGBB` plus an opacity (0-1) → `#RRGGBBAA`. Other color formats are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
  return `${color}${a}`;
}
