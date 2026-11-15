import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyChunks, settleToolCalls } from '../applyChunk';
import { createMockTransport, tokenize } from '../transports/mock';
import { createSSEDecoder, parseAISDK, parseAnthropic, parseAuto, parseOpenAI } from '../transports/parsers';
import { createStreamTransport } from '../transports/stream';
import type { ChatChunk, ChatMessage } from '../types';

const blank = (): ChatMessage => ({ id: 'a', role: 'assistant', parts: [], createdAt: 0, status: 'streaming' });
const user = (text: string): ChatMessage => ({ id: 'u', role: 'user', parts: [{ type: 'text', text }], createdAt: 0 });

async function collect(iter: AsyncIterable<ChatChunk>) {
  const out: ChatChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('applyChunks', () => {
  it('merges text and interleaves tool cards in order', () => {
    const m = applyChunks(blank(), [
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'tool-call-start', id: 't1', name: 'search' },
      { type: 'tool-call-end', id: 't1', result: 1 },
      { type: 'text-delta', text: 'Done' },
    ]);
    expect(m.parts).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'tool-call', id: 't1', name: 'search', label: undefined, args: undefined, state: 'done', result: 1, error: undefined },
      { type: 'text', text: 'Done' },
    ]);
  });

  it('marks failed tools and settles running ones', () => {
    let m = applyChunks(blank(), [
      { type: 'tool-call-start', id: 'a', name: 'x' },
      { type: 'tool-call-start', id: 'b', name: 'y' },
      { type: 'tool-call-end', id: 'a', error: 'boom' },
    ]);
    m = settleToolCalls(m, 'done');
    expect(m.parts.map((p) => p.type === 'tool-call' && p.state)).toEqual(['error', 'done']);
  });
});

describe('createSSEDecoder', () => {
  it('handles events split across arbitrary network chunks', () => {
    const d = createSSEDecoder();
    const wire = 'event: a\ndata: {"x":1}\n\n: comment\ndata: line1\ndata: line2\n\ndata: tail';
    const events = [];
    for (let i = 0; i < wire.length; i += 3) events.push(...d.push(wire.slice(i, i + 3)));
    events.push(...d.end());
    expect(events).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: undefined, data: 'line1\nline2' },
      { event: undefined, data: 'tail' },
    ]);
  });

  it('accepts CRLF line endings', () => {
    expect(createSSEDecoder().push('data: hi\r\n\r\n')).toEqual([{ event: undefined, data: 'hi' }]);
  });
});

describe('provider parsers', () => {
  it('OpenAI chat completions + responses', () => {
    expect(parseOpenAI('{"choices":[{"delta":{"content":"Hi"}}]}')).toEqual([{ type: 'text-delta', text: 'Hi' }]);
    expect(parseOpenAI('{"type":"response.output_text.delta","delta":"Yo"}')).toEqual([{ type: 'text-delta', text: 'Yo' }]);
    expect(parseOpenAI('{"choices":[{"delta":{"role":"assistant"}}]}')).toEqual([]);
  });

  it('Anthropic messages', () => {
    expect(parseAnthropic('{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hey"}}')).toEqual([
      { type: 'text-delta', text: 'Hey' },
    ]);
    expect(parseAnthropic('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')).toEqual([
      { type: 'error', message: 'Overloaded' },
    ]);
  });

  it('AI SDK UI message stream', () => {
    expect(parseAISDK('{"type":"text-delta","id":"1","delta":"Hi"}')).toEqual([{ type: 'text-delta', text: 'Hi' }]);
    expect(parseAISDK('{"type":"tool-input-start","toolCallId":"c","toolName":"weather"}')).toEqual([
      { type: 'tool-call-start', id: 'c', name: 'weather' },
    ]);
    expect(parseAISDK('{"type":"tool-output-available","toolCallId":"c","output":{"t":20}}')).toEqual([
      { type: 'tool-call-end', id: 'c', result: { t: 20 } },
    ]);
  });

  it('parseAuto detects each format and ignores [DONE]', () => {
    expect(parseAuto('[DONE]')).toEqual([]);
    expect(parseAuto('plain words')).toEqual([{ type: 'text-delta', text: 'plain words' }]);
    expect(parseAuto('{"type":"text-delta","text":"native"}')).toEqual([{ type: 'text-delta', text: 'native' }]);
    expect(parseAuto('{"type":"text-delta","id":"1","delta":"sdk"}')).toEqual([{ type: 'text-delta', text: 'sdk' }]);
    expect(parseAuto('{"choices":[{"delta":{"content":"oai"}}]}')).toEqual([{ type: 'text-delta', text: 'oai' }]);
    expect(parseAuto('{"type":"message_start","message":{}}')).toEqual([]);
  });
});

describe('createMockTransport', () => {
  it('streams the scripted reply', async () => {
    const transport = createMockTransport({
      tokenDelayMs: 0,
      initialDelayMs: 0,
      reply: () => [{ text: 'Hello world' }, { tool: { name: 'lookup', durationMs: 0 } }],
    });
    const chunks = await collect(transport({ messages: [user('hi')], signal: new AbortController().signal }));
    const text = chunks.filter((c) => c.type === 'text-delta').map((c) => (c as { text: string }).text).join('');
    expect(text).toBe('Hello world');
    expect(chunks.slice(-2).map((c) => c.type)).toEqual(['tool-call-start', 'tool-call-end']);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    const transport = createMockTransport({ tokenDelayMs: 5, initialDelayMs: 0, reply: () => 'a b c d e f g h i j k l m n o p' });
    const out: ChatChunk[] = [];
    for await (const c of transport({ messages: [], signal: controller.signal })) {
      out.push(c);
      if (out.length === 3) controller.abort();
    }
    expect(out.length).toBe(3);
  });

  it('tokenize preserves text', () => {
    const s = 'Hello,   wonderful world!\n\nNew para';
    expect(tokenize(s).join('')).toBe(s);
  });
});

// Minimal XMLHttpRequest double that emits the body in pieces.
class FakeXHR {
  static instances: FakeXHR[] = [];
  static script: { status: number; pieces: string[] } = { status: 200, pieces: [] };
  status = 0;
  readyState = 0;
  responseText = '';
  sentBody: string | undefined;
  headers: Record<string, string> = {};
  aborted = false;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXHR.instances.push(this);
  }
  open() {
    this.readyState = 1;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  abort() {
    this.aborted = true;
    this.readyState = 4;
  }
  send(body: string) {
    this.sentBody = body;
    const { status, pieces } = FakeXHR.script;
    let i = 0;
    const tick = () => {
      if (this.aborted) return;
      this.status = status;
      if (i < pieces.length) {
        this.readyState = 3;
        this.responseText += pieces[i++];
        this.onprogress?.();
        setTimeout(tick, 0);
      } else {
        this.readyState = 4;
        this.onload?.();
      }
    };
    setTimeout(tick, 0);
  }
}

describe('createStreamTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeXHR.instances = [];
  });

  it('streams SSE from an OpenAI-style backend and sends simple messages', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    FakeXHR.script = {
      status: 200,
      pieces: ['data: {"choices":[{"delta":{"content":"Hel"}}]}\n', '\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'],
    };
    const transport = createStreamTransport({ url: 'https://example.test/chat', headers: () => ({ Authorization: 'Bearer t' }) });
    const chunks = await collect(transport({ messages: [user('hi')], signal: new AbortController().signal }));
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
    ]);
    const xhr = FakeXHR.instances[0]!;
    expect(JSON.parse(xhr.sentBody!)).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
    expect(xhr.headers.Authorization).toBe('Bearer t');
  });

  it('supports plain text streams', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    FakeXHR.script = { status: 200, pieces: ['Hello ', 'there'] };
    const chunks = await collect(createStreamTransport({ url: 'x', format: 'text' })({ messages: [], signal: new AbortController().signal }));
    expect(chunks.map((c) => (c as { text: string }).text).join('')).toBe('Hello there');
  });

  it('rejects with the status and body on HTTP errors', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    FakeXHR.script = { status: 401, pieces: ['{"error":"bad key"}'] };
    await expect(collect(createStreamTransport({ url: 'x' })({ messages: [], signal: new AbortController().signal }))).rejects.toThrow(
      'Request failed (401): {"error":"bad key"}',
    );
  });

  it('aborts the request when the signal fires', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    FakeXHR.script = { status: 200, pieces: ['data: a\n\n', 'data: b\n\n', 'data: c\n\n'] };
    const controller = new AbortController();
    const out: ChatChunk[] = [];
    for await (const c of createStreamTransport({ url: 'x' })({ messages: [], signal: controller.signal })) {
      out.push(c);
      controller.abort();
    }
    expect(out).toEqual([{ type: 'text-delta', text: 'a' }]);
    expect(FakeXHR.instances[0]!.aborted).toBe(true);
  });
});
