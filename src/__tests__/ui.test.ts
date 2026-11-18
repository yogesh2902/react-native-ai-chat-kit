import { describe, expect, it } from 'vitest';
import { applyPalette, PALETTE_NAMES, withAlpha } from '../palettes';
import type { ChatTheme } from '../theme';

const base = { colors: { accent: '#111418', onAccent: '#FFFFFF', userBubble: '#F1F3F5', text: '#111418' }, fontSize: 16 } as unknown as ChatTheme;

describe('palettes', () => {
  it('lists the built-in palettes, neutral first', () => {
    expect(PALETTE_NAMES).toEqual(['neutral', 'violet', 'ocean', 'sunset', 'forest']);
  });

  it('neutral leaves the theme alone; others recolor accents and bubbles per scheme', () => {
    expect(applyPalette(base, 'neutral')).toBe(base);
    const violetLight = applyPalette(base, 'violet', 'light');
    const violetDark = applyPalette(base, 'violet', 'dark');
    expect(violetLight.colors.accent).toBe('#7C3AED');
    expect(violetDark.colors.accent).toBe('#A78BFA');
    expect(violetLight.colors.text).toBe('#111418'); // untouched keys survive
    for (const name of PALETTE_NAMES.slice(1)) {
      const t = applyPalette(base, name, 'light');
      expect(t.colors.accent).toMatch(/^#[0-9A-F]{6}$/i);
      expect(t.colors.userBubble).not.toBe(base.colors.userBubble);
    }
  });
});

describe('withAlpha', () => {
  it('adds an alpha channel to #RRGGBB colors', () => {
    expect(withAlpha('#7C3AED', 0.1)).toBe('#7C3AED1a');
    expect(withAlpha('#000000', 1)).toBe('#000000ff');
    expect(withAlpha('#000000', 2)).toBe('#000000ff'); // clamped
  });

  it('leaves other color formats alone', () => {
    expect(withAlpha('rgb(0,0,0)', 0.5)).toBe('rgb(0,0,0)');
    expect(withAlpha('transparent', 0.5)).toBe('transparent');
  });
});
