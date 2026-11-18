import type { ChatChunk, ChatMessage, ChatTransport } from '../types';
import { createAsyncQueue } from './asyncQueue';
import { createSSEDecoder, parseAuto, type StreamParser } from './parsers';

export type SimpleAttachment = { mimeType: string; data: string; name?: string };
export type SimpleMessage = { role: ChatMessage['role']; content: string; attachments?: SimpleAttachment[] };

const SENDABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

/**
 * Convert rich messages to the `{ role, content, attachments? }` shape the
 * server handler and provider adapters expect. Images and PDFs become base64
 * attachments; text documents are inlined into `content`.
 */
export function toSimpleMessages(messages: ChatMessage[]): SimpleMessage[] {
  const out: SimpleMessage[] = [];
  for (const m of messages) {
    const texts: string[] = [];
    const attachments: SimpleAttachment[] = [];
    for (const part of m.parts) {
      if (part.type === 'text') texts.push(part.text);
      else if (part.type === 'image') {
        if (part.base64) attachments.push({ mimeType: part.mimeType ?? 'image/jpeg', data: part.base64, ...(part.name ? { name: part.name } : {}) });
        else texts.push('[An image was shared here but is no longer available.]');
      } else if (part.type === 'file') {
        if (part.text !== undefined) texts.push(`<document name="${part.name}">\n${part.text}\n</document>`);
        else if (part.base64 && SENDABLE.has(part.mimeType)) attachments.push({ mimeType: part.mimeType, data: part.base64, name: part.name });
        else texts.push(`[Attached file "${part.name}" (${part.mimeType}) could not be read.]`);
      }
    }
    // Put documents before the user's own words, which reads best for models.
    const docs = texts.filter((t) => t.startsWith('<document') || t.startsWith('[A'));
    const words = texts.filter((t) => !docs.includes(t));
    // A quote reply tells the model which earlier message the user means.
    const quote = m.replyTo?.text.trim()
      ? `> ${m.replyTo.text.trim().replace(/\n/g, '\n> ')}\n\n(Replying to the quoted ${m.replyTo.role === 'user' ? 'message' : 'part of your answer'} above.)`
      : '';
    const content = [...docs, quote, words.join('')].filter((t) => t.trim()).join('\n\n');
    if (!content && attachments.length === 0) continue;
    out.push({ role: m.role, content, ...(attachments.length ? { attachments } : {}) });
  }
  return out;
}

export type StreamTransportOptions = {
  /** Your backend endpoint. Never call an LLM provider directly with a secret key from a mobile app. */
  url: string | ((request: { model?: string }) => string);
  method?: 'POST' | 'PUT';
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /**
   * Build the request body. Defaults to `{ messages: [{ role, content }], model? }`,
   * where `model` is the one picked in the model picker (if any).
   */
  body?: (messages: ChatMessage[], request: { model?: string }) => unknown;
  /**
   * `sse` (default): Server-Sent Events, parsed with `parser`.
   * `text`: a plain text stream where every byte is assistant text.
   */
  format?: 'sse' | 'text';
  /** Defaults to `parseAuto`, which understands OpenAI, Anthropic, AI SDK and this library's format. */
  parser?: StreamParser;
};

/**
 * Streams a response over XMLHttpRequest. XHR progress events deliver text
 * incrementally on iOS, Android and web without polyfills, which `fetch` in
 * React Native does not do out of the box.
 */
export function createStreamTransport(options: StreamTransportOptions): ChatTransport {
  const { method = 'POST', format = 'sse', parser = parseAuto } = options;
  const buildBody =
    options.body ??
    ((messages: ChatMessage[], request: { model?: string }) => ({
      messages: toSimpleMessages(messages),
      ...(request.model ? { model: request.model } : {}),
    }));

  return async function* streamTransport({ messages, signal, model }) {
    const url = typeof options.url === 'function' ? options.url({ model }) : options.url;
    const headers =
      typeof options.headers === 'function' ? await options.headers() : options.headers ?? {};
    if (signal.aborted) return;

    const queue = createAsyncQueue<ChatChunk>();
    const decoder = createSSEDecoder();
    const xhr = new XMLHttpRequest();
    let seen = 0;

    const emit = (events: { event?: string; data: string }[]) => {
      for (const e of events) for (const chunk of parser(e.data, e.event)) queue.push(chunk);
    };

    const readNew = () => {
      if (xhr.status >= 400) return; // error bodies are reported in onload
      const text = xhr.responseText ?? '';
      if (text.length <= seen) return;
      const fresh = text.slice(seen);
      seen = text.length;
      if (format === 'text') queue.push({ type: 'text-delta', text: fresh });
      else emit(decoder.push(fresh));
    };

    xhr.open(method, url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', format === 'sse' ? 'text/event-stream' : 'text/plain');
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);

    xhr.onprogress = readNew;
    xhr.onload = () => {
      if (xhr.status >= 400) {
        const detail = (xhr.responseText ?? '').slice(0, 300);
        queue.fail(new Error(`Request failed (${xhr.status})${detail ? `: ${detail}` : ''}`));
        return;
      }
      readNew();
      if (format === 'sse') emit(decoder.end());
      queue.end();
    };
    xhr.onerror = () => queue.fail(new Error('Network request failed'));
    xhr.ontimeout = () => queue.fail(new Error('Request timed out'));

    const onAbort = () => {
      xhr.abort();
      queue.end();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    xhr.send(JSON.stringify(buildBody(messages, { model })));

    try {
      yield* queue;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (xhr.readyState !== 4) xhr.abort();
    }
  };
}
