import type { CodeBlockOptions } from '../markdown/StreamingMarkdown';

export type ReasoningMode = 'collapsed' | 'expanded' | false;

/** `true` → 'collapsed', `false` → hidden; 'collapsed' / 'expanded' pass through. Default 'collapsed'. */
export function resolveReasoning(value: boolean | 'collapsed' | 'expanded' | undefined): ReasoningMode {
  if (value === undefined || value === true) return 'collapsed';
  return value;
}

const DEFAULT_CODE: CodeBlockOptions = {};
const PLAIN_CODE: CodeBlockOptions = { highlight: false, lineNumbers: false };

/** `true` / undefined → defaults, `false` → plain code (no colors, no line numbers), or your options. */
export function resolveCodeBlocks(value: boolean | CodeBlockOptions | undefined): CodeBlockOptions {
  if (value === false) return PLAIN_CODE;
  if (value === true || value === undefined) return DEFAULT_CODE;
  return value;
}
