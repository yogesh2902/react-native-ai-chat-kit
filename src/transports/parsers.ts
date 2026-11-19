import type { ChatChunk, ChatSource } from '../types';

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

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Accept a source object loosely ({ url | uri, title, snippet }). */
function toSource(raw: unknown): ChatSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Json;
  const url = str(r.url) ?? str(r.uri);
  const title = str(r.title);
  if (!url && !title) return undefined;
  return { ...(url ? { url } : {}), ...(title ? { title } : {}), ...(str(r.snippet) ? { snippet: r.snippet } : {}), ...(str(r.id) ? { id: r.id } : {}) };
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
    case 'tool-approval-request':
      return obj.id && obj.name
        ? [{ type: 'tool-approval-request', id: String(obj.id), name: String(obj.name), label: obj.label, args: obj.args, message: obj.message }]
        : [];
    case 'reasoning-delta':
      return typeof obj.text === 'string' ? [{ type: 'reasoning-delta', text: obj.text }] : [];
    case 'image':
      return str(obj.url) || str(obj.base64)
        ? [{ type: 'image', id: str(obj.id), url: str(obj.url), base64: str(obj.base64), mimeType: str(obj.mimeType), alt: str(obj.alt), width: obj.width, height: obj.height }]
        : [];
    case 'source': {
      const source = toSource(obj.source);
      return source ? [{ type: 'source', source }] : [];
    }
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
  // Responses API: reasoning summaries and web-search citations.
  if ((obj.type === 'response.reasoning_summary_text.delta' || obj.type === 'response.reasoning_text.delta') && typeof obj.delta === 'string') {
    return [{ type: 'reasoning-delta', text: obj.delta }];
  }
  // Responses API image generation: progressive previews, then the final image.
  if (obj.type === 'response.image_generation_call.partial_image' && typeof obj.partial_image_b64 === 'string') {
    return [{ type: 'image', id: str(obj.item_id), base64: obj.partial_image_b64, mimeType: `image/${obj.output_format ?? 'png'}` }];
  }
  if (obj.type === 'response.output_item.done' && obj.item?.type === 'image_generation_call' && typeof obj.item.result === 'string') {
    return [{ type: 'image', id: str(obj.item.id), base64: obj.item.result, mimeType: `image/${obj.item.output_format ?? 'png'}` }];
  }
  if (obj.type === 'response.output_text.annotation.added') {
    const source = obj.annotation?.type === 'url_citation' ? toSource(obj.annotation) : undefined;
    return source ? [{ type: 'source', source }] : [];
  }
  if (obj.type === 'error' || (obj.error && typeof obj.error.message === 'string')) {
    return [{ type: 'error', message: obj.error?.message ?? obj.message ?? 'Unknown error' }];
  }
  const delta = obj.choices?.[0]?.delta;
  if (!delta) return [];
  const out: ChatChunk[] = [];
  // OpenAI-compatible APIs (DeepSeek, OpenRouter, Groq, vLLM…) stream reasoning in one of these fields.
  const reasoning = str(delta.reasoning_content) ?? str(delta.reasoning);
  if (reasoning) out.push({ type: 'reasoning-delta', text: reasoning });
  if (typeof delta.content === 'string' && delta.content) out.push({ type: 'text-delta', text: delta.content });
  if (Array.isArray(delta.annotations)) {
    for (const a of delta.annotations) {
      const source = a?.type === 'url_citation' ? toSource(a.url_citation ?? a) : undefined;
      if (source) out.push({ type: 'source', source });
    }
  }
  return out;
};

/** Anthropic Messages API streaming events. */
export const parseAnthropic: StreamParser = (data) => {
  const obj = tryJson(data);
  if (!obj) return [];
  if (obj.type === 'content_block_delta') {
    const delta = obj.delta ?? {};
    if (delta.type === 'text_delta') return [{ type: 'text-delta', text: String(delta.text ?? '') }];
    // Adaptive thinking with display: 'summarized'. (With the default 'omitted' the text is empty.)
    if (delta.type === 'thinking_delta') return delta.thinking ? [{ type: 'reasoning-delta', text: String(delta.thinking) }] : [];
    if (delta.type === 'citations_delta') {
      const c = delta.citation ?? {};
      const source = toSource({ url: c.url, title: c.title ?? c.document_title, snippet: c.cited_text });
      return source ? [{ type: 'source', source }] : [];
    }
    return [];
  }
  if (obj.type === 'content_block_start') {
    const block = obj.content_block ?? {};
    if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      const label = block.name === 'web_search' ? 'Searching the web…' : block.name === 'web_fetch' ? 'Reading the page…' : undefined;
      return [{ type: 'tool-call-start', id: String(block.id), name: String(block.name), ...(label ? { label } : {}) }];
    }
    if (block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result') {
      const results = Array.isArray(block.content) ? block.content : [];
      const failed = !Array.isArray(block.content) && block.content?.error_code;
      return [
        { type: 'tool-call-end', id: String(block.tool_use_id), ...(failed ? { error: String(block.content.error_code) } : {}) },
        ...results
          .map((r: Json) => toSource(r))
          .filter((x: ChatSource | undefined): x is ChatSource => !!x)
          .map((source: ChatSource): ChatChunk => ({ type: 'source', source })),
      ];
    }
    return [];
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
    case 'reasoning-delta':
      return typeof obj.delta === 'string' && obj.delta ? [{ type: 'reasoning-delta', text: obj.delta }] : [];
    case 'file':
      return typeof obj.url === 'string' && String(obj.mediaType ?? '').startsWith('image/')
        ? [{ type: 'image', url: obj.url, mimeType: obj.mediaType }]
        : [];
    case 'source-url':
    case 'source-document': {
      const source = toSource({ url: obj.url, title: obj.title, id: obj.sourceId });
      return source ? [{ type: 'source', source }] : [];
    }
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
  const candidate = obj.candidates?.[0];
  const parts: { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[] = candidate?.content?.parts ?? [];
  const out: ChatChunk[] = [];
  for (const p of parts) {
    if (p.inlineData?.data && String(p.inlineData.mimeType ?? '').startsWith('image/')) {
      out.push({ type: 'image', base64: p.inlineData.data, mimeType: p.inlineData.mimeType });
      continue;
    }
    if (typeof p.text !== 'string' || !p.text) continue;
    // With thinkingConfig.includeThoughts, thought summaries arrive as parts marked `thought: true`.
    out.push(p.thought ? { type: 'reasoning-delta', text: p.text } : { type: 'text-delta', text: p.text });
  }
  // Google Search grounding.
  const chunks: Json[] = candidate?.groundingMetadata?.groundingChunks ?? [];
  for (const g of chunks) {
    const source = toSource(g?.web);
    if (source) out.push({ type: 'source', source });
  }
  return out;
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
