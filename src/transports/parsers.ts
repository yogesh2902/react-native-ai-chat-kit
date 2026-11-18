import type { ChatChunk } from '../types';

/** Turns one SSE event's `data:` payload into zero or more chunks. */
export type StreamParser = (data: string, event?: string) => ChatChunk[];

type Json = Record<string, any>;

function tryJson(data: string): Json | undefined {
  try {
    const value = JSON.parse(data);
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** This library's own wire format: each event is a `ChatChunk` as JSON. */
export const parseNative: StreamParser = (data) => {
  const obj = tryJson(data);
  if (!obj) return [];
  switch (obj.type) {
    case 'text-delta':
      return typeof obj.text === 'string' ? [{ type: 'text-delta', text: obj.text }] : [];
    case 'tool-call-start':
      return [{ type: 'tool-call-start', id: String(obj.id), name: String(obj.name), label: obj.label, args: obj.args }];
    case 'tool-call-end':
      return [{ type: 'tool-call-end', id: String(obj.id), result: obj.result, error: obj.error }];
    case 'suggestions':
      return Array.isArray(obj.suggestions)
        ? [{ type: 'suggestions', suggestions: obj.suggestions.filter((x: unknown): x is string => typeof x === 'string') }]
        : [];
    case 'error':
      return typeof obj.message === 'string' ? [{ type: 'error', message: obj.message }] : [];
    default:
      return [];
  }
};

/** OpenAI Chat Completions (`choices[].delta.content`) and Responses API (`response.output_text.delta`). */
export const parseOpenAI: StreamParser = (data) => {
  const obj = tryJson(data);
  if (!obj) return [];
  if (obj.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
    return [{ type: 'text-delta', text: obj.delta }];
  }
  if (obj.type === 'error' || (obj.error && typeof obj.error.message === 'string')) {
    return [{ type: 'error', message: obj.error?.message ?? obj.message ?? 'Unknown error' }];
  }
  const content = obj.choices?.[0]?.delta?.content;
  return typeof content === 'string' && content ? [{ type: 'text-delta', text: content }] : [];
};

/** Anthropic Messages API streaming events. */
export const parseAnthropic: StreamParser = (data) => {
  const obj = tryJson(data);
  if (!obj) return [];
  if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
    return [{ type: 'text-delta', text: String(obj.delta.text ?? '') }];
  }
  if (obj.type === 'content_block_start' && obj.content_block?.type === 'tool_use') {
    const block = obj.content_block;
    return [{ type: 'tool-call-start', id: String(block.id), name: String(block.name) }];
  }
  if (obj.type === 'error' && obj.error) {
    return [{ type: 'error', message: String(obj.error.message ?? 'Unknown error') }];
  }
  return [];
};

/** Vercel AI SDK UI message stream protocol (`toUIMessageStreamResponse()`). */
export const parseAISDK: StreamParser = (data) => {
  const obj = tryJson(data);
  if (!obj) return [];
  switch (obj.type) {
    case 'text-delta':
      return typeof obj.delta === 'string' ? [{ type: 'text-delta', text: obj.delta }] : [];
    case 'tool-input-start':
      return [{ type: 'tool-call-start', id: String(obj.toolCallId), name: String(obj.toolName) }];
    case 'tool-input-available':
      return [{ type: 'tool-call-start', id: String(obj.toolCallId), name: String(obj.toolName), args: obj.input }];
    case 'tool-output-available':
      return [{ type: 'tool-call-end', id: String(obj.toolCallId), result: obj.output }];
    case 'tool-output-error':
      return [{ type: 'tool-call-end', id: String(obj.toolCallId), error: String(obj.errorText ?? 'Tool failed') }];
    case 'error':
      return typeof obj.errorText === 'string' ? [{ type: 'error', message: obj.errorText }] : [];
    default:
      return [];
  }
};

/** Google Gemini `streamGenerateContent?alt=sse` events. */
export const parseGemini: StreamParser = (data) => {
  let obj: any;
  try {
    obj = JSON.parse(data);
  } catch {
    return [];
  }
  if (!obj || typeof obj !== 'object') return [];
  if (obj.error) return [{ type: 'error', message: String(obj.error.message ?? 'Gemini request failed') }];
  const parts: { text?: string }[] = obj.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  return text ? [{ type: 'text-delta', text } ] : [];
};

/**
 * Auto-detects the format. Tries, in order: this library's format, AI SDK,
 * Anthropic, OpenAI, Gemini. Non-JSON payloads are treated as raw text.
 */
export const parseAuto: StreamParser = (data, event) => {
  if (data === '[DONE]') return [];
  if (!tryJson(data)) return data ? [{ type: 'text-delta', text: data }] : [];
  for (const parser of [parseNative, parseAISDK, parseAnthropic, parseOpenAI, parseGemini]) {
    const chunks = parser(data, event);
    if (chunks.length > 0) return chunks;
  }
  return [];
};

export type SSEEvent = { event?: string; data: string };

/**
 * Incremental SSE parser. Feed it text as it arrives; it returns complete
 * events and keeps any partial event buffered for the next call.
 */
export function createSSEDecoder() {
  let buffer = '';
  const parseBlock = (block: string): SSEEvent | null => {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };

  return {
    push(text: string): SSEEvent[] {
      buffer += text;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      return blocks.map(parseBlock).filter((e): e is SSEEvent => e !== null);
    },
    /** Flush whatever is left when the stream closes. */
    end(): SSEEvent[] {
      const rest = buffer;
      buffer = '';
      const event = rest.trim() ? parseBlock(rest) : null;
      return event ? [event] : [];
    },
  };
}
