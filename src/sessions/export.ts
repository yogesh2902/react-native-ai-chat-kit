import { toSpeakableText } from '../markdown/plainText';
import type { ChatMessage } from '../types';

export type ExportOptions = {
  title?: string;
  /** Name shown for the user's messages. Default "You". */
  userName?: string;
  /** Name shown for replies. Default "Assistant". */
  assistantName?: string;
  /** Add the time to each message. Default true. */
  timestamps?: boolean;
  /** Markdown (default) keeps formatting; 'text' is plain text for messaging apps. */
  format?: 'markdown' | 'text';
};

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * A conversation as Markdown (or plain text), ready to share or save:
 *
 *   Share.share({ message: exportChat(chat.messages, { title: 'Goa trip' }) });
 *
 * Reasoning is left out; tool steps, attachments and sources are summarized.
 */
export function exportChat(messages: ChatMessage[], options: ExportOptions = {}): string {
  const { userName = 'You', assistantName = 'Assistant', timestamps = true, format = 'markdown' } = options;
  const md = format === 'markdown';
  const out: string[] = [];
  if (options.title) out.push(md ? `# ${options.title}` : options.title, '');

  for (const m of messages) {
    if (m.role === 'system') continue;
    const who = m.role === 'user' ? userName : assistantName;
    const when = timestamps && m.createdAt ? ` · ${stamp(m.createdAt)}` : '';
    out.push(md ? `**${who}**${when}` : `${who}${when}`);
    if (m.replyTo?.text) out.push(md ? `> ${m.replyTo.text}` : `"${m.replyTo.text}"`);
    const body: string[] = [];
    for (const part of m.parts) {
      if (part.type === 'text') body.push(md ? part.text.trim() : toSpeakableText(part.text));
      else if (part.type === 'image') body.push(md ? `_[Image${part.name ? `: ${part.name}` : ''}]_` : `[Image${part.name ? `: ${part.name}` : ''}]`);
      else if (part.type === 'file') body.push(md ? `_[File: ${part.name}]_` : `[File: ${part.name}]`);
      else if (part.type === 'tool-call') {
        const status = part.state === 'done' ? '✓' : part.state === 'denied' ? '✕ not approved' : part.state === 'error' ? '✕ failed' : '…';
        body.push(`${md ? '> ' : ''}🛠 ${part.label ?? part.name} ${status}`);
      }
    }
    out.push(body.filter(Boolean).join('\n\n'));
    if (m.sources?.length) {
      out.push(m.sources.map((s, i) => `${i + 1}. ${s.title ?? s.url ?? ''}${s.url && s.title ? ` (${s.url})` : ''}`).join('\n'));
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Does the conversation mention `query` (case-insensitive) anywhere in its text? */
export function messagesContain(messages: ChatMessage[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return messages.some((m) => m.parts.some((p) => p.type === 'text' && p.text.toLowerCase().includes(q)));
}
