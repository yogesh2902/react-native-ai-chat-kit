import type { ChatChunk, ChatMessage, MessagePart } from './types';

/**
 * Pure reducer: returns a new message with the chunk applied.
 * Consecutive text deltas are merged into the trailing text part so a message
 * reads text → tool card → text in the order the model produced it.
 */
export function applyChunk(message: ChatMessage, chunk: ChatChunk): ChatMessage {
  switch (chunk.type) {
    case 'text-delta': {
      if (!chunk.text) return message;
      const parts = message.parts.slice();
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') {
        parts[parts.length - 1] = { type: 'text', text: last.text + chunk.text };
      } else {
        parts.push({ type: 'text', text: chunk.text });
      }
      return { ...message, parts };
    }
    case 'tool-call-start': {
      const exists = message.parts.some((p) => p.type === 'tool-call' && p.id === chunk.id);
      if (exists) return message;
      const part: MessagePart = {
        type: 'tool-call',
        id: chunk.id,
        name: chunk.name,
        label: chunk.label,
        args: chunk.args,
        state: 'running',
      };
      return { ...message, parts: [...message.parts, part] };
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
    case 'error':
      return { ...message, status: 'error', error: chunk.message };
    default:
      return message;
  }
}

export function applyChunks(message: ChatMessage, chunks: ChatChunk[]): ChatMessage {
  let next = message;
  for (const chunk of chunks) next = applyChunk(next, chunk);
  return next;
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
