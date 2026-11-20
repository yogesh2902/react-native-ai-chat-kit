import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => import('./helpers/reactNativeMock'));

import { applyChunks } from '../applyChunk';
import { ChatView } from '../components/ChatView';
import { buildListItems, formatDateSeparator } from '../components/chatListItems';
import { defaultLabels, mergeLabels, type ChatLabels } from '../labels';
import { CHAT_LANGUAGES, chatLabelPacks, isRTLLanguage, labelsForLanguage, japaneseLabels, portugueseLabels } from '../locales';
import { formatSessionTime, groupSessionsByDate } from '../sessions/groupSessions';
import { createMockTransport } from '../transports/mock';
import { parseAnthropic, parseGemini, parseNative, parseOpenAI } from '../transports/parsers';
import { toSimpleMessages } from '../transports/stream';
import { getMessageText, type ChatMessage, type ChatTransport } from '../types';
import { canContinue, DEFAULT_CONTINUE_PROMPT, useChat, type UseChatResult } from '../useChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});
async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
  return renderer!;
}
const settle = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await settle(10);
  }
  throw new Error(`Timed out: ${label}`);
}
function textOf(r: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') out.push(String(node));
    else if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && 'children' in (node as object)) walk((node as { children: unknown }).children);
  };
  walk(r.toJSON());
  return out.join('');
}
const pressText = async (r: ReactTestRenderer, text: string | RegExp) => {
  const matches = (n: ReactTestInstance) =>
    typeof n.props.onPress === 'function' &&
    n.findAll((c) => typeof c.props.children === 'string' && (typeof text === 'string' ? c.props.children === text : text.test(c.props.children))).length > 0;
  const node = r.root.findAll(matches).pop();
  expect(node, `pressable with text ${String(text)}`).toBeDefined();
  await act(async () => node!.props.onPress());
};

const msg = (id: string, role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
  createdAt: 1_700_000_000_000 + Number(id.replace(/\D/g, '') || 0) * 1000,
  status: 'done',
  ...extra,
});

function Harness({ transport, onChat }: { transport: ChatTransport; onChat: (c: UseChatResult) => void }) {
  const chat = useChat({ transport });
  onChat(chat);
  return <ChatView {...chat} />;
}

describe('finish reasons', () => {
  it('are read from every provider', () => {
    expect(parseOpenAI(JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] }))).toEqual([{ type: 'finish', reason: 'length' }]);
    expect(parseOpenAI(JSON.stringify({ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }))).toEqual([
      { type: 'text-delta', text: 'x' },
      { type: 'finish', reason: 'stop' },
    ]);
    expect(parseOpenAI(JSON.stringify({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }))).toEqual([
      { type: 'finish', reason: 'length' },
    ]);
    expect(parseAnthropic(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }))).toEqual([{ type: 'finish', reason: 'length' }]);
    expect(parseAnthropic(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'pause_turn' } }))).toEqual([]);
    expect(parseGemini(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a' }] }, finishReason: 'MAX_TOKENS' }] }))).toEqual([
      { type: 'text-delta', text: 'a' },
      { type: 'finish', reason: 'length' },
    ]);
    expect(parseNative(JSON.stringify({ type: 'finish', reason: 'length' }))).toEqual([{ type: 'finish', reason: 'length' }]);
    expect(parseNative(JSON.stringify({ type: 'finish', reason: 'weird' }))).toEqual([]);
  });

  it('are kept on the message, and resume tokens on tool parts', () => {
    const base: ChatMessage = { id: 'a', role: 'assistant', parts: [], createdAt: 0, status: 'streaming' };
    const m = applyChunks(base, [
      { type: 'tool-call-start', id: 't1', name: 'hold' },
      { type: 'tool-call-start', id: 't1', name: 'hold', label: 'Hold seat', args: { flight: 'QP' } },
      { type: 'tool-approval-request', id: 't1', name: 'hold', message: 'OK?', resumeToken: 'tok.sig' },
      { type: 'finish', reason: 'tool-calls' },
    ]);
    expect(m.parts).toEqual([
      { type: 'tool-call', id: 't1', name: 'hold', label: 'Hold seat', args: { flight: 'QP' }, state: 'awaiting-approval', approval: 'pending', approvalMessage: 'OK?', resumeToken: 'tok.sig' },
    ]);
    expect(m.finishReason).toBe('tool-calls');
  });

  it('sends tool calls and decisions back to the server', () => {
    const assistant: ChatMessage = {
      id: 'a',
      role: 'assistant',
      createdAt: 0,
      parts: [
        { type: 'text', text: 'Holding.' },
        { type: 'tool-call', id: 't1', name: 'hold', state: 'running', approval: 'approved', resumeToken: 'tok.sig' },
        { type: 'tool-call', id: 't0', name: 'search', state: 'done', result: { found: 3 } },
      ],
    };
    const [simple] = toSimpleMessages([assistant]);
    expect(simple!.toolCalls).toEqual([
      { id: 't1', name: 'hold', approval: 'approved', resumeToken: 'tok.sig' },
      { id: 't0', name: 'search' },
    ]);
    expect(simple!.content).toContain('[Tool "hold" was approved by the user.]');
    expect(simple!.content).toContain('[Tool "search" returned: {"found":3}]');
  });
});

describe('continue generating', () => {
  it('knows which replies can continue', () => {
    expect(canContinue(msg('a1', 'assistant', 'Once upon', { finishReason: 'length' }))).toBe(true);
    expect(canContinue(msg('a1', 'assistant', 'Once upon', { status: 'stopped' }))).toBe(true);
    expect(canContinue(msg('a1', 'assistant', 'Once upon', { status: 'error', error: 'Network request failed' }))).toBe(true);
    expect(canContinue(msg('a1', 'assistant', 'Done.', { finishReason: 'stop' }))).toBe(false);
    expect(canContinue(msg('a1', 'assistant', '', { status: 'error' }))).toBe(false);
    expect(canContinue(msg('u1', 'user', 'hi', { status: 'stopped' }))).toBe(false);
  });

  it('adds the rest of the answer to the same message', async () => {
    const seen: ChatMessage[][] = [];
    const transport: ChatTransport = async function* ({ messages }) {
      seen.push(messages);
      if (seen.length === 1) {
        yield { type: 'text-delta', text: 'The lighthouse keeper' };
        yield { type: 'finish', reason: 'length' };
      } else {
        yield { type: 'text-delta', text: ' lit the lamp.' };
        yield { type: 'finish', reason: 'stop' };
      }
    };
    let chat!: UseChatResult;
    const r = await render(<Harness transport={transport} onChat={(c) => (chat = c)} />);
    await act(async () => chat.send('Tell me a story'));
    await until(() => chat.status === 'idle' && chat.messages[1]?.finishReason === 'length', 'first reply');
    expect(textOf(r)).toContain('Continue');

    await pressText(r, /Continue$/);
    await until(() => chat.status === 'idle' && chat.messages[1]?.finishReason === 'stop', 'continued reply');
    expect(chat.messages).toHaveLength(2);
    expect(getMessageText(chat.messages[1]!)).toBe('The lighthouse keeper lit the lamp.');
    // The model was asked to continue; the instruction never entered the chat.
    const sent = seen[1]!;
    expect(sent.at(-2)!.id).toBe(chat.messages[1]!.id);
    expect(getMessageText(sent.at(-1)!)).toBe(DEFAULT_CONTINUE_PROMPT);
    expect(textOf(r)).not.toContain('Continue');
  });

  it('works with the demo transport', async () => {
    let chat!: UseChatResult;
    await render(<Harness transport={createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0 })} onChat={(c) => (chat = c)} />);
    await act(async () => chat.send('Write a short story'));
    await until(() => chat.status === 'idle', 'story');
    expect(chat.messages[1]!.finishReason).toBe('length');
    await act(async () => chat.continueReply());
    await until(() => chat.status === 'idle' && chat.messages[1]!.finishReason === 'stop', 'story continued');
    expect(getMessageText(chat.messages[1]!)).toMatch(/used to tap on the kitchen table[\s\S]*The end\./);
  });

  it('can be turned off', async () => {
    const messages = [msg('u1', 'user', 'Story'), msg('a2', 'assistant', 'Once', { finishReason: 'length' })];
    const r = await render(<ChatView messages={messages} send={() => {}} stop={() => {}} isStreaming={false} continueReply={() => {}} allowContinue={false} />);
    expect(textOf(r)).not.toContain('Continue');
  });
});

describe('long chats', () => {
  const long = Array.from({ length: 100 }, (_, i) => msg(`m${i + 1}`, i % 2 ? 'assistant' : 'user', `Message number ${i + 1}.`));

  it('show the newest page and load older ones on request', async () => {
    const r = await render(<ChatView messages={long} send={() => {}} stop={() => {}} isStreaming={false} pageSize={40} />);
    expect(textOf(r)).toContain('Message number 100.');
    expect(textOf(r)).toContain('Message number 61.');
    expect(textOf(r)).not.toContain('Message number 60.');
    expect(textOf(r)).toContain('Show 40 earlier messages');

    await pressText(r, 'Show 40 earlier messages');
    expect(textOf(r)).toContain('Message number 21.');
    expect(textOf(r)).not.toContain('Message number 20.');
    expect(textOf(r)).toContain('Show 20 earlier messages');

    // Scrolling to the top loads the rest.
    const list = r.root.findAll((n) => (n.type as unknown) === 'FlatList')[0]!;
    await act(async () => list.props.onEndReached());
    expect(textOf(r)).toContain('Message number 1.');
    expect(textOf(r)).not.toContain('earlier message');
  });

  it('keeps what you are reading when new messages arrive', async () => {
    const r = await render(<ChatView messages={long} send={() => {}} stop={() => {}} isStreaming={false} pageSize={40} />);
    await act(async () => r.update(<ChatView messages={[...long, msg('m101', 'user', 'Message number 101.')]} send={() => {}} stop={() => {}} isStreaming={false} pageSize={40} />));
    expect(textOf(r)).toContain('Message number 61.');
    expect(textOf(r)).toContain('Message number 101.');
  });

  it('renders everything with pageSize={false}', async () => {
    const r = await render(<ChatView messages={long} send={() => {}} stop={() => {}} isStreaming={false} pageSize={false} />);
    expect(textOf(r)).toContain('Message number 1.');
    expect(textOf(r)).not.toContain('earlier message');
  });

  it('starts over when another chat opens', async () => {
    const r = await render(<ChatView messages={long} send={() => {}} stop={() => {}} isStreaming={false} pageSize={40} />);
    await pressText(r, 'Show 40 earlier messages');
    const other = Array.from({ length: 50 }, (_, i) => msg(`x${i + 1}`, 'user', `Other chat ${i + 1}.`));
    await act(async () => r.update(<ChatView messages={other} send={() => {}} stop={() => {}} isStreaming={false} pageSize={40} />));
    expect(textOf(r)).toContain('Other chat 11.');
    expect(textOf(r)).not.toContain('Other chat 10.');
  });
});

describe('language packs', () => {
  const keys = Object.keys(defaultLabels).sort();

  it('translate every label', () => {
    for (const code of CHAT_LANGUAGES) {
      const pack = chatLabelPacks[code];
      const own = Object.keys(pack).filter((k) => k !== 'formatDay' && k !== 'formatMonth').sort();
      expect(own, code).toEqual(keys);
      for (const key of keys as (keyof ChatLabels)[]) {
        const value = pack[key];
        if (typeof value === 'function') {
          const text = String((value as (...a: unknown[]) => unknown)(2, 3));
          expect(text.length, `${code}.${key}`).toBeGreaterThan(0);
        } else if (Array.isArray(value)) expect(value, `${code}.${key}`).toHaveLength(12);
        else expect(String(value).trim().length, `${code}.${key}`).toBeGreaterThan(0);
      }
      if (code !== 'en') expect(pack.emptyTitle, code).not.toBe(defaultLabels.emptyTitle);
    }
  });

  it('are found by language code', () => {
    expect(labelsForLanguage('pt-BR')).toBe(portugueseLabels);
    expect(labelsForLanguage('JA')).toBe(japaneseLabels);
    expect(labelsForLanguage('zh-Hans-CN')).toBe(chatLabelPacks.zh);
    expect(labelsForLanguage('sw')).toBeUndefined();
    expect(isRTLLanguage('ar-EG')).toBe(true);
    expect(isRTLLanguage('hi')).toBe(false);
  });

  it('switch the whole UI with one prop, and labels still override', async () => {
    const hi = await render(<ChatView messages={[]} send={() => {}} stop={() => {}} isStreaming={false} language="hi" labels={{ copy: 'X' }} />);
    expect(textOf(hi)).toContain(chatLabelPacks.hi.emptyTitle);
    expect(mergeLabels({ copy: 'X' }, chatLabelPacks.hi).copy).toBe('X');
    await act(async () => hi.unmount());
    renderer = undefined;

    const ar = await render(<ChatView messages={[msg('u1', 'user', 'مرحبا')]} send={() => {}} stop={() => {}} isStreaming={false} language="ar" />);
    const root = ar.root.findAll((n) => (n.type as unknown) === 'View' && Array.isArray(n.props.style))[0]!;
    expect(JSON.stringify(root.props.style)).toContain('"direction":"rtl"');
  });

  it('format dates in each language’s order', () => {
    const t = new Date(2025, 10, 12, 9).getTime();
    const now = new Date(2026, 0, 20).getTime();
    expect(formatDateSeparator(t, defaultLabels, now)).toBe('12 Nov 2025');
    expect(formatDateSeparator(t, japaneseLabels, now)).toBe('2025年11月12日');
    expect(formatDateSeparator(t, chatLabelPacks.de, now)).toBe('12. Nov. 2025');
    expect(formatSessionTime(t, now, japaneseLabels.months, japaneseLabels.formatDay)).toBe('11月12日');
    const groups = groupSessionsByDate([{ id: 's', title: 'x', preview: '', createdAt: t, updatedAt: t, messageCount: 1 }], now, japaneseLabels);
    expect(groups[0]!.title).toBe('2025年11月');
    expect(buildListItems([msg('u1', 'user', 'a', { createdAt: t })], { dateSeparators: true, labels: japaneseLabels, now }).at(-1)).toMatchObject({
      kind: 'date',
      label: '2025年11月12日',
    });
  });
});
