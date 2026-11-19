import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { applyChunk } from '../applyChunk';
import { texToUnicode } from '../markdown/math';
import { parseBlocks, parseInline } from '../markdown/parse';
import { exportChat } from '../sessions/export';
import { groupSessionsByDate } from '../sessions/groupSessions';
import { createMemoryStore, type ChatSessionMeta } from '../sessions/store';
import { useChatSessions, type UseChatSessionsResult } from '../sessions/useChatSessions';
import { createMockTransport } from '../transports/mock';
import { parseAISDK, parseAuto, parseGemini, parseOpenAI } from '../transports/parsers';
import { toSimpleMessages } from '../transports/stream';
import { getMessageText, type ChatMessage, type ChatTransport, type ToolCallPart } from '../types';
import { useChat, type UseChatOptions, type UseChatResult } from '../useChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const settle = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await settle(10);
  }
  throw new Error(`Timed out: ${label}`);
}

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

const fast = () => createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0 });
const toolOf = (m: ChatMessage) => m.parts.find((p): p is ToolCallPart => p.type === 'tool-call');

describe('tool approval', () => {
  it('pauses for approval, then continues the same reply', async () => {
    const chat = await mount({ transport: fast() });
    await act(async () => chat.current.send('Hold the Akasa seat'));
    await until(() => !chat.current.isStreaming && !!chat.current.messages[1] && !!toolOf(chat.current.messages[1]!), 'approval request');
    const reply = chat.current.messages[1]!;
    expect(toolOf(reply)).toMatchObject({ name: 'hold_seat', state: 'awaiting-approval', approval: 'pending' });
    expect(toolOf(reply)?.approvalMessage).toContain('₹3,980');

    await act(async () => chat.current.respondToTool(toolOf(reply)!.id, true));
    expect(toolOf(chat.current.messages[1]!)).toMatchObject({ state: 'running', approval: 'approved' });
    await until(() => !chat.current.isStreaming && getMessageText(chat.current.messages[1]!).includes('held until'), 'continued');
    expect(chat.current.messages).toHaveLength(2); // same reply, not a new message
    expect(toolOf(chat.current.messages[1]!)?.state).toBe('done');
  });

  it('a denial is sent to the model and the reply backs off', async () => {
    const chat = await mount({ transport: fast() });
    await act(async () => chat.current.send('Hold the Akasa seat'));
    await until(() => !chat.current.isStreaming && !!chat.current.messages[1] && !!toolOf(chat.current.messages[1]!), 'approval request');
    await act(async () => chat.current.respondToTool(toolOf(chat.current.messages[1]!)!.id, false));
    await until(() => !chat.current.isStreaming && getMessageText(chat.current.messages[1]!).includes("haven't held"), 'denied');
    expect(toolOf(chat.current.messages[1]!)).toMatchObject({ state: 'denied', approval: 'denied' });
    expect(toSimpleMessages(chat.current.messages)[1]!.content).toContain('[Tool "hold_seat" was denied by the user.]');
  });

  it('sending a new message cancels a pending approval', async () => {
    const chat = await mount({ transport: fast() });
    await act(async () => chat.current.send('Hold the Akasa seat'));
    await until(() => !chat.current.isStreaming && !!chat.current.messages[1] && !!toolOf(chat.current.messages[1]!), 'approval request');
    await act(async () => chat.current.send('Actually, never mind'));
    expect(toolOf(chat.current.messages[1]!)).toMatchObject({ state: 'denied', approval: 'denied' });
  });

  it('parses approval requests from the native stream format', () => {
    expect(parseAuto(JSON.stringify({ type: 'tool-approval-request', id: 't', name: 'pay', message: 'Pay ₹10?' }))).toEqual([
      { type: 'tool-approval-request', id: 't', name: 'pay', label: undefined, args: undefined, message: 'Pay ₹10?' },
    ]);
  });
});

describe('edit branches', () => {
  it('editing an older message keeps the old conversation as a branch', async () => {
    const chat = await mount({ transport: createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: (m) => `re:${getMessageText(m[m.length - 1]!)}` }) });
    await act(async () => chat.current.send('one'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'reply 1');
    await act(async () => chat.current.send('two'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 4, 'reply 2');

    const firstId = chat.current.messages[0]!.id;
    await act(async () => chat.current.editMessage(firstId, 'ONE'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'edited');
    expect(chat.current.messages.map(getMessageText)).toEqual(['ONE', 're:ONE']);

    await act(async () => chat.current.selectBranch(firstId, 0));
    expect(chat.current.messages.map(getMessageText)).toEqual(['one', 're:one', 'two', 're:two']);
    expect(chat.current.messages[0]!.branchIndex).toBe(0);

    await act(async () => chat.current.selectBranch(firstId, 1));
    expect(chat.current.messages.map(getMessageText)).toEqual(['ONE', 're:ONE']);
    expect(toSimpleMessages(chat.current.messages).map((m) => m.content)).toEqual(['ONE', 're:ONE']);
  });
});

describe('session tools', () => {
  it('pins, exports and searches inside messages', async () => {
    const store = createMemoryStore();
    const ref: { current: UseChatSessionsResult | null } = { current: null };
    function Harness() {
      ref.current = useChatSessions({ store, transport: createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: () => 'The secret word is banana.' }) });
      return null;
    }
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    const chat = ref as { current: UseChatSessionsResult };
    await act(async () => chat.current.send('Tell me a secret'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'reply');
    await settle();
    const id = chat.current.activeSessionId!;

    await act(async () => chat.current.pinSession(id, true));
    expect(chat.current.sessions[0]?.pinned).toBe(true);
    expect((await store.load(id))?.pinned).toBe(true);

    // The pin survives the next autosave.
    await act(async () => chat.current.send('Another'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 4, 'reply 2');
    await settle();
    expect((await store.load(id))?.pinned).toBe(true);

    const md = await chat.current.exportSession(id);
    expect(md).toMatch(/^# Tell me a secret/);
    expect(md).toContain('**You**');
    expect(md).toContain('The secret word is banana.');

    expect((await chat.current.searchSessions('banana')).map((s) => s.id)).toEqual([id]);
    expect(await chat.current.searchSessions('kiwi')).toEqual([]);
  });

  it('lists pinned chats first', () => {
    const now = Date.now();
    const meta = (id: string, updatedAt: number, pinned?: boolean): ChatSessionMeta => ({ id, title: id, preview: '', createdAt: 0, updatedAt, messageCount: 1, pinned });
    const groups = groupSessionsByDate([meta('new', now), meta('old-pinned', now - 90 * 864e5, true)], now);
    expect(groups.map((g) => [g.title, g.data.map((s) => s.id)])).toEqual([
      ['Pinned', ['old-pinned']],
      ['Today', ['new']],
    ]);
  });

  it('exports plain text too, with tools, files and sources summarized', () => {
    const messages: ChatMessage[] = [
      { id: 'u', role: 'user', createdAt: 0, parts: [{ type: 'file', name: 'plan.pdf', mimeType: 'application/pdf' }, { type: 'text', text: 'Summarize' }] },
      {
        id: 'a',
        role: 'assistant',
        createdAt: 0,
        parts: [
          { type: 'reasoning', text: 'private thoughts' },
          { type: 'tool-call', id: 't', name: 'read', label: 'Reading the PDF', state: 'done' },
          { type: 'text', text: '**Short** version' },
        ],
        sources: [{ url: 'https://x.dev', title: 'X' }],
      },
    ];
    const text = exportChat(messages, { format: 'text', timestamps: false });
    expect(text).toContain('[File: plan.pdf]');
    expect(text).toContain('🛠 Reading the PDF ✓');
    expect(text).toContain('Short version');
    expect(text).toContain('1. X (https://x.dev)');
    expect(text).not.toContain('private thoughts');
  });
});

describe('math', () => {
  it('converts common LaTeX to readable Unicode', () => {
    expect(texToUnicode('x^2 + y^2 = r^2')).toBe('x² + y² = r²');
    expect(texToUnicode('\\frac{1}{2}')).toBe('½');
    expect(texToUnicode('\\frac{a+b}{c}')).toBe('(a + b)⁄c');
    expect(texToUnicode('\\sqrt{x}')).toBe('√x');
    expect(texToUnicode('\\sum_{i=1}^{n} i')).toBe('∑ᵢ₌₁ⁿi');
    expect(texToUnicode('\\alpha \\leq \\beta')).toBe('α ≤ β');
    expect(texToUnicode('E = mc^2')).toBe('E = mc²');
    expect(texToUnicode('x \\in \\mathbb{R}')).toBe('x ∈ ℝ');
    expect(texToUnicode('90^\\circ')).toBe('90°');
  });

  it('finds math only when enabled, and leaves prices alone', () => {
    expect(parseInline('Costs $5 and $10', false, { math: true })).toEqual([{ type: 'text', text: 'Costs $5 and $10' }]);
    expect(parseInline('Area $\\pi r^2$ ok', false, { math: true })).toEqual([
      { type: 'text', text: 'Area ' },
      { type: 'math', tex: '\\pi r^2' },
      { type: 'text', text: ' ok' },
    ]);
    expect(parseInline('Area $\\pi r^2$', false)).toEqual([{ type: 'text', text: 'Area $\\pi r^2$' }]);
    expect(parseBlocks('$$\nE = mc^2\n$$', { math: true })).toEqual([{ type: 'math', tex: 'E = mc^2', closed: true, raw: '$$\nE = mc^2\n$$' }]);
    expect(parseBlocks('\\[x^2\\]', { math: true })[0]).toMatchObject({ type: 'math', tex: 'x^2' });
  });
});

describe('generated images', () => {
  it('adds image parts and replaces progressive previews with the same id', () => {
    const blank: ChatMessage = { id: 'a', role: 'assistant', parts: [], createdAt: 0, status: 'streaming' };
    let m = applyChunk(blank, { type: 'image', id: 'img1', base64: 'AAA', mimeType: 'image/png' });
    m = applyChunk(m, { type: 'image', id: 'img1', base64: 'BBB', mimeType: 'image/png', alt: 'final' });
    expect(m.parts).toEqual([{ type: 'image', uri: 'data:image/png;base64,BBB', id: 'img1', alt: 'final', mimeType: 'image/png' }]);
  });

  it('reads images from OpenAI, Gemini, the AI SDK and markdown', () => {
    expect(parseOpenAI(JSON.stringify({ type: 'response.image_generation_call.partial_image', item_id: 'ig', partial_image_b64: 'X' }))).toEqual([
      { type: 'image', id: 'ig', base64: 'X', mimeType: 'image/png' },
    ]);
    expect(parseGemini(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'Y' } }] } }] }))).toEqual([
      { type: 'image', base64: 'Y', mimeType: 'image/png' },
    ]);
    expect(parseAISDK(JSON.stringify({ type: 'file', url: 'data:image/png;base64,Z', mediaType: 'image/png' }))).toEqual([
      { type: 'image', url: 'data:image/png;base64,Z', mimeType: 'image/png' },
    ]);
    expect(parseBlocks('![A cat](https://x/cat.png)')).toEqual([{ type: 'image', alt: 'A cat', src: 'https://x/cat.png', raw: '![A cat](https://x/cat.png)' }]);
  });

  it('the demo draws an image', async () => {
    const chat = await mount({ transport: fast() });
    await act(async () => chat.current.send('Draw a sunset'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'reply');
    expect(chat.current.messages[1]!.parts.some((p) => p.type === 'image' && p.uri.includes('picsum'))).toBe(true);
  });
});
