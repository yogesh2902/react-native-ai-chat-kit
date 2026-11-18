import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { applyChunk, applyChunks, settleReasoning } from '../applyChunk';
import { highlight } from '../markdown/highlight';
import { buildProviderRequest } from '../providers';
import { createMemoryStore } from '../sessions/store';
import { useChatSessions, type UseChatSessionsResult } from '../sessions/useChatSessions';
import { createMockTransport } from '../transports/mock';
import { parseAISDK, parseAnthropic, parseAuto, parseGemini, parseOpenAI } from '../transports/parsers';
import { toSimpleMessages } from '../transports/stream';
import { getMessageText, type ChatMessage, type ChatTransport, type TransportRequest } from '../types';
import { allVersions, toReplyReference, useChat, type UseChatOptions, type UseChatResult } from '../useChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const settle = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await settle(10);
  }
  throw new Error(`Timed out: ${label}`);
}

const blank = (): ChatMessage => ({ id: 'a', role: 'assistant', parts: [], createdAt: 0, status: 'streaming' });

async function mount(options: Partial<UseChatOptions> & { transport: ChatTransport }) {
  const ref: { current: UseChatResult | null } = { current: null };
  function Harness() {
    ref.current = useChat(options);
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Harness));
  });
  return ref as { current: UseChatResult };
}

describe('reasoning and sources chunks', () => {
  it('merges reasoning, then times it when the answer starts', () => {
    let m = applyChunk(blank(), { type: 'reasoning-delta', text: 'Let me ' }, 1000);
    m = applyChunk(m, { type: 'reasoning-delta', text: 'think.' }, 1200);
    expect(m.parts).toEqual([{ type: 'reasoning', text: 'Let me think.', startedAt: 1000 }]);
    m = applyChunk(m, { type: 'text-delta', text: 'Answer' }, 4200);
    expect(m.parts).toEqual([
      { type: 'reasoning', text: 'Let me think.', startedAt: 1000, durationMs: 3200 },
      { type: 'text', text: 'Answer' },
    ]);
    // Reasoning after the answer (interleaved thinking) starts a new block.
    m = applyChunk(m, { type: 'reasoning-delta', text: 'More' }, 5000);
    expect(m.parts).toHaveLength(3);
  });

  it('closes reasoning that never reached an answer', () => {
    const m = applyChunks(blank(), [{ type: 'reasoning-delta', text: 'hmm' }], 100);
    expect(settleReasoning(m, 2100).parts[0]).toMatchObject({ durationMs: 2000 });
  });

  it('collects sources and ignores duplicates', () => {
    let m = applyChunk(blank(), { type: 'source', source: { url: 'https://a.com/x', title: 'A' } });
    m = applyChunk(m, { type: 'source', source: { url: 'https://A.com/x/#top', title: 'A again' } });
    m = applyChunk(m, { type: 'source', source: { url: 'https://a.com/x?page=2' } });
    m = applyChunk(m, { type: 'source', source: {} });
    expect(m.sources?.map((s) => s.url)).toEqual(['https://a.com/x', 'https://a.com/x?page=2']);
  });
});

describe('provider parsers', () => {
  it('Anthropic: thinking, web search and citations', () => {
    expect(parseAnthropic(JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Plan…' } }))).toEqual([
      { type: 'reasoning-delta', text: 'Plan…' },
    ]);
    expect(parseAnthropic(JSON.stringify({ type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'x' } }))).toEqual([]);
    expect(parseAnthropic(JSON.stringify({ type: 'content_block_start', content_block: { type: 'server_tool_use', id: 's1', name: 'web_search' } }))).toEqual([
      { type: 'tool-call-start', id: 's1', name: 'web_search', label: 'Searching the web…' },
    ]);
    const result = parseAnthropic(
      JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 's1',
          content: [{ type: 'web_search_result', url: 'https://x.dev', title: 'X' }],
        },
      }),
    );
    expect(result).toEqual([
      { type: 'tool-call-end', id: 's1' },
      { type: 'source', source: { url: 'https://x.dev', title: 'X' } },
    ]);
    expect(
      parseAnthropic(
        JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://y.dev', title: 'Y', cited_text: 'quote' } },
        }),
      ),
    ).toEqual([{ type: 'source', source: { url: 'https://y.dev', title: 'Y', snippet: 'quote' } }]);
  });

  it('OpenAI and compatible APIs: reasoning fields and url citations', () => {
    expect(parseOpenAI(JSON.stringify({ choices: [{ delta: { reasoning_content: 'hm', content: 'Hi' } }] }))).toEqual([
      { type: 'reasoning-delta', text: 'hm' },
      { type: 'text-delta', text: 'Hi' },
    ]);
    expect(parseOpenAI(JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: 'sum' }))).toEqual([{ type: 'reasoning-delta', text: 'sum' }]);
    expect(
      parseOpenAI(JSON.stringify({ type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: 'https://o.ai', title: 'O' } })),
    ).toEqual([{ type: 'source', source: { url: 'https://o.ai', title: 'O' } }]);
    expect(
      parseOpenAI(JSON.stringify({ choices: [{ delta: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://r.dev', title: 'R' } }] } }] })),
    ).toEqual([{ type: 'source', source: { url: 'https://r.dev', title: 'R' } }]);
  });

  it('AI SDK, Gemini and the native format', () => {
    expect(parseAISDK(JSON.stringify({ type: 'reasoning-delta', id: 'r', delta: 'why' }))).toEqual([{ type: 'reasoning-delta', text: 'why' }]);
    expect(parseAISDK(JSON.stringify({ type: 'source-url', sourceId: 's', url: 'https://s.io', title: 'S' }))).toEqual([
      { type: 'source', source: { url: 'https://s.io', title: 'S', id: 's' } },
    ]);
    const gemini = parseGemini(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: 'thinking', thought: true }, { text: 'answer' }] },
            groundingMetadata: { groundingChunks: [{ web: { uri: 'https://g.co', title: 'G' } }] },
          },
        ],
      }),
    );
    expect(gemini).toEqual([
      { type: 'reasoning-delta', text: 'thinking' },
      { type: 'text-delta', text: 'answer' },
      { type: 'source', source: { url: 'https://g.co', title: 'G' } },
    ]);
    expect(parseAuto(JSON.stringify({ type: 'reasoning-delta', text: 'native' }))).toEqual([{ type: 'reasoning-delta', text: 'native' }]);
    expect(parseAuto(JSON.stringify({ type: 'source', source: { url: 'https://n.dev' } }))).toEqual([{ type: 'source', source: { url: 'https://n.dev' } }]);
  });
});

describe('provider requests', () => {
  const msgs = [{ role: 'user' as const, content: 'Hi' }];
  it('turns on reasoning and web search per provider', () => {
    const claude = buildProviderRequest({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5-5', reasoning: 'high', webSearch: { maxUses: 2 } }, msgs).body as any;
    expect(claude.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(claude.output_config).toEqual({ effort: 'high' });
    expect(claude.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }]);

    const gemini = buildProviderRequest({ provider: 'gemini', apiKey: 'k', model: 'g', reasoning: true, webSearch: true }, msgs).body as any;
    expect(gemini.generationConfig.thinkingConfig).toEqual({ includeThoughts: true });
    expect(gemini.tools).toEqual([{ google_search: {} }]);

    const openai = buildProviderRequest({ provider: 'openai', apiKey: 'k', model: 'o', reasoning: 'low' }, msgs).body as any;
    expect(openai.reasoning_effort).toBe('low');
    const plain = buildProviderRequest({ provider: 'anthropic', apiKey: 'k', model: 'c' }, msgs).body as any;
    expect(plain.thinking).toBeUndefined();
    expect(plain.tools).toBeUndefined();
  });
});

describe('reply versions', () => {
  it('regenerate keeps earlier answers and selectVersion flips between them', async () => {
    let n = 0;
    const chat = await mount({ transport: createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: () => `answer ${++n}` }) });
    await act(async () => chat.current.send('Q'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'first reply');
    await act(async () => chat.current.rateMessage(chat.current.messages[1]!.id, 'up'));
    const id = chat.current.messages[1]!.id;

    await act(async () => chat.current.regenerate());
    await until(() => !chat.current.isStreaming && getMessageText(chat.current.messages[1]!) === 'answer 2', 'second reply');
    const reply = chat.current.messages[1]!;
    expect(reply.id).toBe(id); // same message, new version
    expect(reply.rating).toBeUndefined();
    expect(allVersions(reply).map((v) => (v.parts[0] as { text: string }).text)).toEqual(['answer 1', 'answer 2']);
    expect(reply.versionIndex).toBe(1);

    await act(async () => chat.current.selectVersion(id, 0));
    const back = chat.current.messages[1]!;
    expect(getMessageText(back)).toBe('answer 1');
    expect(back.rating).toBe('up'); // each version keeps its own rating
    expect(back.versionIndex).toBe(0);
    expect(allVersions(back)).toHaveLength(2);

    // Regenerating from version 1 adds a third at the end.
    await act(async () => chat.current.regenerate());
    await until(() => !chat.current.isStreaming && getMessageText(chat.current.messages[1]!) === 'answer 3', 'third reply');
    expect(allVersions(chat.current.messages[1]!).map((v) => (v.parts[0] as { text: string }).text)).toEqual(['answer 1', 'answer 2', 'answer 3']);
    // The model only ever sees the current version.
    expect(toSimpleMessages(chat.current.messages).map((m) => m.content)).toEqual(['Q', 'answer 3']);
  });

  it('replaces failed replies and can be turned off', async () => {
    let fail = true;
    const transport: ChatTransport = async function* () {
      if (fail) throw new Error('boom');
      yield { type: 'text-delta', text: 'ok' };
    };
    const chat = await mount({ transport });
    await act(async () => chat.current.send('Q'));
    await until(() => chat.current.messages[1]?.status === 'error', 'error');
    fail = false;
    await act(async () => chat.current.retry());
    await until(() => chat.current.messages[1]?.status === 'done', 'retry');
    expect(chat.current.messages[1]!.versions).toBeUndefined();

    await act(async () => renderer?.unmount());
    const plain = await mount({ transport: createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: () => 'x' }), keepReplyVersions: false });
    await act(async () => plain.current.send('Q'));
    await until(() => !plain.current.isStreaming && plain.current.messages.length === 2, 'reply');
    await act(async () => plain.current.regenerate());
    await until(() => !plain.current.isStreaming && plain.current.messages[1]?.status === 'done', 'regenerated');
    expect(plain.current.messages[1]!.versions).toBeUndefined();
  });
});

describe('model and quote reply', () => {
  it('sends the picked model and stamps it on replies', async () => {
    const seen: (string | undefined)[] = [];
    const transport: ChatTransport = async function* (req: TransportRequest) {
      seen.push(req.model);
      yield { type: 'text-delta', text: 'hi' };
    };
    const chat = await mount({ transport, model: 'fast' });
    await act(async () => chat.current.send('one'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'reply 1');
    await act(async () => chat.current.setModel('smart'));
    await act(async () => chat.current.send('two'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 4, 'reply 2');
    expect(seen).toEqual(['fast', 'smart']);
    expect(chat.current.messages.filter((m) => m.role === 'assistant').map((m) => m.model)).toEqual(['fast', 'smart']);
    expect(chat.current.model).toBe('smart');
  });

  it('quotes the replied-to message for the model', async () => {
    const chat = await mount({ transport: createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: () => 'Paris is the capital.\nIt has the Louvre.' }) });
    await act(async () => chat.current.send('Tell me about France'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'reply');
    await act(async () => chat.current.send('More on this?', { replyTo: chat.current.messages[1]! }));
    const user = chat.current.messages[2]!;
    expect(user.replyTo).toEqual({ id: chat.current.messages[1]!.id, role: 'assistant', text: 'Paris is the capital. It has the Louvre.' });
    const simple = toSimpleMessages(chat.current.messages.slice(0, 3));
    expect(simple[2]!.content).toBe('> Paris is the capital. It has the Louvre.\n\n(Replying to the quoted part of your answer above.)\n\nMore on this?');
  });

  it('shortens long quotes and names photo-only messages', () => {
    const long: ChatMessage = { id: 'x', role: 'user', parts: [{ type: 'text', text: 'word '.repeat(100) }], createdAt: 0 };
    expect(toReplyReference(long, 20).text).toHaveLength(20);
    const photo: ChatMessage = { id: 'p', role: 'user', parts: [{ type: 'image', uri: 'a.jpg' }], createdAt: 0 };
    expect(toReplyReference(photo).text).toBe('📷 Photo');
    const md: ChatMessage = { id: 'm', role: 'assistant', parts: [{ type: 'text', text: '- **Bold** and `code`' }], createdAt: 0 };
    expect(toReplyReference(md).text).toBe('Bold and code');
  });

  it('saves the model with each chat and restores it on reopen', async () => {
    const store = createMemoryStore();
    const ref: { current: UseChatSessionsResult | null } = { current: null };
    function Harness() {
      ref.current = useChatSessions({ store, model: 'fast', transport: createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: () => 'ok' }) });
      return null;
    }
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    const chat = ref as { current: UseChatSessionsResult };
    await act(async () => chat.current.setModel('smart'));
    await act(async () => chat.current.send('hello'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'reply');
    await settle();
    const id = chat.current.activeSessionId!;
    expect((await store.load(id))?.model).toBe('smart');

    await act(async () => chat.current.newSession());
    await act(async () => chat.current.setModel('fast'));
    await act(async () => chat.current.openSession(id));
    await settle();
    expect(chat.current.model).toBe('smart');
  });
});

describe('mock transport demo', () => {
  it('thinks first for reasoning models and cites sources for searches', async () => {
    const t = createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0 });
    const run = async (text: string, model?: string) => {
      let m = blank();
      const messages: ChatMessage[] = [{ id: 'u', role: 'user', parts: [{ type: 'text', text }], createdAt: 0 }];
      for await (const c of t({ messages, signal: new AbortController().signal, model })) m = applyChunk(m, c);
      return m;
    };
    const thinking = await run('hello', 'demo-thinking');
    expect(thinking.parts[0]?.type).toBe('reasoning');
    expect((await run('hello', 'demo-fast')).parts[0]?.type).toBe('text');
    const search = await run('search the latest news');
    expect(search.sources).toHaveLength(3);
    expect(search.parts.some((p) => p.type === 'tool-call' && p.name === 'web_search')).toBe(true);
  });
});

describe('syntax highlighting', () => {
  const kinds = (code: string, lang: string) =>
    highlight(code, lang)
      .filter((t) => t.kind !== 'plain')
      .map((t) => `${t.kind}:${t.text}`);

  it('colors TSX: types, JSX tags and attributes, but not generics', () => {
    const out = kinds('const a: Array<string> = <ChatView style={s} />;', 'tsx');
    expect(out).toContain('type:Array');
    expect(out).toContain('tag:<ChatView');
    expect(out).toContain('attr:style');
    expect(out).not.toContain('tag:<string');
  });

  it('colors JSON keys, SQL keywords, HTML and diffs', () => {
    expect(kinds('{"name": "kit"}', 'json')).toEqual(['punctuation:{', 'property:"name"', 'operator::', 'string:"kit"', 'punctuation:}']);
    expect(kinds('select id from users -- all', 'sql')).toEqual(['keyword:select', 'keyword:from', 'comment:-- all']);
    expect(kinds('<a data-id="1">Hi</a>', 'html')).toEqual(['tag:<a', 'attr:data-id', 'punctuation:=', 'string:"1"', 'tag:>', 'tag:</a>']);
    expect(kinds('@@ -1 +1 @@\n-old\n+new', 'diff')).toEqual(['meta:@@ -1 +1 @@\n', 'deleted:-old\n', 'inserted:+new']);
  });

  it('keeps every character of the code', () => {
    const code = 'fn main() { let x = "a#b"; // c\n  x.len() }';
    for (const lang of ['rust', 'python', 'tsx', 'html', 'sql', '']) expect(highlight(code, lang).map((t) => t.text).join('')).toBe(code);
  });
});
