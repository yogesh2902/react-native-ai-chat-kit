import type { ChatChunk, ChatMessage, ChatSource, MessagePart } from './types';

/** Stamp how long the trailing reasoning block took, once the model moves on to its answer. */
function closeReasoning(parts: MessagePart[], now: number): MessagePart[] {
  const last = parts[parts.length - 1];
  if (!last || last.type !== 'reasoning' || last.durationMs !== undefined || last.startedAt === undefined) return parts;
  const next = parts.slice();
  next[next.length - 1] = { ...last, durationMs: Math.max(0, now - last.startedAt) };
  return next;
}

const sourceKey = (s: ChatSource) => (s.url ? s.url.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase() : `${s.id ?? ''}|${s.title ?? ''}`);

/**
 * Pure reducer: returns a new message with the chunk applied.
 * Consecutive text deltas are merged into the trailing text part so a message
 * reads text → tool card → text in the order the model produced it.
 * `now` timestamps reasoning (defaults to the current time).
 */
export function applyChunk(message: ChatMessage, chunk: ChatChunk, now: number = Date.now()): ChatMessage {
  switch (chunk.type) {
    case 'reasoning-delta': {
      if (!chunk.text) return message;
      const parts = message.parts.slice();
      const last = parts[parts.length - 1];
      if (last && last.type === 'reasoning' && last.durationMs === undefined) {
        parts[parts.length - 1] = { ...last, text: last.text + chunk.text };
      } else {
        parts.push({ type: 'reasoning', text: chunk.text, startedAt: now });
      }
      return { ...message, parts };
    }
    case 'image': {
      const uri = chunk.url ?? (chunk.base64 ? `data:${chunk.mimeType ?? 'image/png'};base64,${chunk.base64}` : '');
      if (!uri) return message;
      const part: MessagePart = {
        type: 'image',
        uri,
        ...(chunk.id ? { id: chunk.id } : {}),
        ...(chunk.alt ? { alt: chunk.alt } : {}),
        ...(chunk.mimeType ? { mimeType: chunk.mimeType } : {}),
        ...(chunk.width && chunk.height ? { width: chunk.width, height: chunk.height } : {}),
      };
      const closed = closeReasoning(message.parts, now);
      const existing = chunk.id ? closed.findIndex((p) => p.type === 'image' && p.id === chunk.id) : -1;
      if (existing !== -1) {
        const parts = closed.slice();
        parts[existing] = part;
        return { ...message, parts };
      }
      return { ...message, parts: [...closed, part] };
    }
    case 'source': {
      const source = chunk.source;
      if (!source || (!source.url && !source.title)) return message;
      const existing = message.sources ?? [];
      const key = sourceKey(source);
      if (existing.some((s) => sourceKey(s) === key)) return message;
      return { ...message, sources: [...existing, source] };
    }
    case 'text-delta': {
      if (!chunk.text) return message;
      const parts = closeReasoning(message.parts, now).slice();
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') {
        parts[parts.length - 1] = { type: 'text', text: last.text + chunk.text };
      } else {
        parts.push({ type: 'text', text: chunk.text });
      }
      return { ...message, parts };
    }
    case 'tool-call-start': {
      const at = message.parts.findIndex((p) => p.type === 'tool-call' && p.id === chunk.id);
      if (at !== -1) {
        // A second start for the same call fills in what the first didn't know yet (label, arguments).
        const current = message.parts[at] as Extract<MessagePart, { type: 'tool-call' }>;
        const label = chunk.label ?? current.label;
        const args = chunk.args !== undefined ? chunk.args : current.args;
        if (label === current.label && args === current.args) return message;
        const parts = message.parts.slice();
        parts[at] = { ...current, ...(label !== undefined ? { label } : {}), ...(args !== undefined ? { args } : {}) };
        return { ...message, parts };
      }
      const closed = closeReasoning(message.parts, now);
      const part: MessagePart = {
        type: 'tool-call',
        id: chunk.id,
        name: chunk.name,
        label: chunk.label,
        args: chunk.args,
        state: 'running',
      };
      return { ...message, parts: [...closed, part] };
    }
    case 'tool-approval-request': {
      const closed = closeReasoning(message.parts, now);
      const existing = closed.findIndex((p) => p.type === 'tool-call' && p.id === chunk.id);
      const fields = {
        state: 'awaiting-approval' as const,
        approval: 'pending' as const,
        ...(chunk.message ? { approvalMessage: chunk.message } : {}),
        ...(chunk.resumeToken ? { resumeToken: chunk.resumeToken } : {}),
      };
      if (existing !== -1) {
        const parts = closed.slice();
        const current = parts[existing] as Extract<MessagePart, { type: 'tool-call' }>;
        parts[existing] = {
          ...current,
          ...(chunk.label !== undefined ? { label: chunk.label } : {}),
          ...(chunk.args !== undefined ? { args: chunk.args } : {}),
          ...fields,
        };
        return { ...message, parts };
      }
      const part: MessagePart = { type: 'tool-call', id: chunk.id, name: chunk.name, label: chunk.label, args: chunk.args, ...fields };
      return { ...message, parts: [...closed, part] };
    }
    case 'tool-call-end': {
      return {
        ...message,
        parts: message.parts.map((p) =>
          p.type === 'tool-call' && p.id === chunk.id
            ? { ...p, state: chunk.error ? 'error' : 'done', result: chunk.result, error: chunk.error }
            : p,
        ),
      };
    }
    case 'suggestions': {
      const suggestions = chunk.suggestions.map((s) => s.trim()).filter(Boolean).slice(0, 6);
      return suggestions.length ? { ...message, suggestions } : message;
    }
    case 'finish':
      return message.finishReason === chunk.reason ? message : { ...message, finishReason: chunk.reason };
    case 'error':
      return { ...message, status: 'error', error: chunk.message };
    default:
      return message;
  }
}

export function applyChunks(message: ChatMessage, chunks: ChatChunk[], now: number = Date.now()): ChatMessage {
  let next = message;
  for (const chunk of chunks) next = applyChunk(next, chunk, now);
  return next;
}

/** When a reply ends while still "thinking" (stopped, reasoning-only), close the reasoning block. */
export function settleReasoning(message: ChatMessage, now: number = Date.now()): ChatMessage {
  const parts = closeReasoning(message.parts, now);
  return parts === message.parts ? message : { ...message, parts };
}

/** Mark any tool cards still spinning as finished/errored when the stream ends. */
export function settleToolCalls(message: ChatMessage, state: 'done' | 'error'): ChatMessage {
  if (!message.parts.some((p) => p.type === 'tool-call' && p.state === 'running')) return message;
  return {
    ...message,
    parts: message.parts.map((p) =>
      p.type === 'tool-call' && p.state === 'running' ? { ...p, state } : p,
    ),
  };
}
