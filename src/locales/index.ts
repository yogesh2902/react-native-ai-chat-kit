/**
 * Ready-made translations of every label. Pick one with `<ChatView language="hi" />`
 * (and the same on ChatHistory); `labels` still overrides single strings on top.
 */
import { defaultLabels, type ChatLabels } from '../labels';
import { arabicLabels } from './ar';
import { germanLabels } from './de';
import { spanishLabels } from './es';
import { frenchLabels } from './fr';
import { hindiLabels } from './hi';
import { japaneseLabels } from './ja';
import { portugueseLabels } from './pt';
import { chineseLabels } from './zh';

export { arabicLabels, chineseLabels, frenchLabels, germanLabels, hindiLabels, japaneseLabels, portugueseLabels, spanishLabels };

/** Languages with a built-in label pack. */
export type ChatLanguage = 'en' | 'hi' | 'ar' | 'es' | 'fr' | 'de' | 'pt' | 'ja' | 'zh';

export const chatLabelPacks: Record<ChatLanguage, ChatLabels> = {
  en: defaultLabels,
  hi: hindiLabels,
  ar: arabicLabels,
  es: spanishLabels,
  fr: frenchLabels,
  de: germanLabels,
  pt: portugueseLabels,
  ja: japaneseLabels,
  zh: chineseLabels,
};

export const CHAT_LANGUAGES = Object.keys(chatLabelPacks) as ChatLanguage[];

const baseLanguage = (code: string) => code.trim().toLowerCase().split(/[-_]/)[0] ?? '';

/**
 * The label pack for a language code. Region and script are ignored, so 'hi-IN', 'pt-BR'
 * and 'zh-Hans' work. Undefined for languages without a pack (pass your own `labels`).
 */
export function labelsForLanguage(code: string | undefined): ChatLabels | undefined {
  if (!code) return undefined;
  return (chatLabelPacks as Record<string, ChatLabels>)[baseLanguage(code)];
}

/** Right-to-left languages (Arabic, Hebrew, Persian, Urdu…). */
export function isRTLLanguage(code: string | undefined): boolean {
  return !!code && ['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv', 'ku', 'ug'].includes(baseLanguage(code));
}
