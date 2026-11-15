/** Turn markdown into natural text for text-to-speech (no symbols, no code). */
export function toSpeakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Tables: drop the |---| separator, read each row as "cell, cell".
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}[-:| \t]*$/gm, '')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, row: string) =>
      row
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
        .join(', '),
    )
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/^\s*([-*_]\s*){3,}$/gm, '')
    .replace(/^[ \t,]+|[ \t,]+$/gm, '')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
