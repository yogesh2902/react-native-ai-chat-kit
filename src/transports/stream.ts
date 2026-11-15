import { getMessageText, type ChatChunk, type ChatMessage, type ChatTransport } from '../types';
import { createAsyncQueue } from './asyncQueue';
import { createSSEDecoder, parseAuto, type StreamParser } from './parsers';

export type SimpleMessage = { role: ChatMessage['role']; content: string };

/** Convert rich messages to the `{ role, content }` shape most backends expect. */
export function toSimpleMessages(messages: ChatMessage[]): SimpleMessage[] {
  return messages
    .map((m) => ({ role: m.role, content: getMessageText(m) }))
    .filter((m) => m.content.length > 0);
}

export type StreamTransportOptions = {
  /** Your backend endpoint. Never call an LLM provider directly with a secret key from a mobile app. */
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Build the request body. Defaults to `{ messages: [{ role, content }] }`. */
  body?: (messages: ChatMessage[]) => unknown;
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
  const { url, method = 'POST', format = 'sse', parser = parseAuto } = options;
  const buildBody = options.body ?? ((messages: ChatMessage[]) => ({ messages: toSimpleMessages(messages) }));

  return async function* streamTransport({ messages, signal }) {
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

    xhr.send(JSON.stringify(buildBody(messages)));

    try {
      yield* queue;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (xhr.readyState !== 4) xhr.abort();
    }
  };
}
