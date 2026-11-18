import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { applyChunk } from '../applyChunk';
import { defaultLabels, mergeLabels } from '../labels';
import { groupSessionsByDate, formatSessionTime } from '../sessions/groupSessions';
import { createMemoryStore, type ChatSessionMeta } from '../sessions/store';
import { useChatSessions } from '../sessions/useChatSessions';
import { createMockTransport } from '../transports/mock';
import { parseAuto } from '../transports/parsers';
import { getMessageText, type ChatChunk, type ChatMessage, type ChatTransport } from '../types';
import { useChat, type UseChatResult } from '../useChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const settle = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle(10);
  }
  throw new Error(`Timed out: ${label}`);
}

const lastUserText = (m: ChatMessage[]) => getMessageText([...m].reverse().find((x) => x.role === 'user')!);
const echo: ChatTransport = createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: (m) => `echo:${lastUserText(m)} n=${m.length}` });

async function mountChat(transport: ChatTransport = echo) {
  const ref: { current: UseChatResult | null } = { current: null };
  function Harness() {
    ref.current = useChat({ transport });
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Harness));
  });
  return ref as { current: UseChatResult };
}

const texts = (messages: ChatMessage[]) => messages.map((m) => `${m.role}:${getMessageText(m)}`);

describe('labels', () => {
  it('merges overrides over English defaults', () => {
    const hi = mergeLabels({ placeholder: 'संदेश लिखें', copy: 'कॉपी', clearAllConfirm: (n) => `${n} चैट हटाएं?` });
    expect(hi.placeholder).toBe('संदेश लिखें');
    expect(hi.copy).toBe('कॉपी');
    expect(hi.retry).toBe('Retry'); // untouched keys keep the default
    expect(hi.clearAllConfirm(3)).toBe('3 चैट हटाएं?');
    expect(mergeLabels()).toBe(defaultLabels);
    expect(mergeLabels({ copy: undefined }).copy).toBe('Copy');
  });

  it('translates history date groups and month names', () => {
    const now = new Date(2026, 10, 18, 12).getTime();
    const meta = (id: string, t: number): ChatSessionMeta => ({ id, title: id, preview: '', createdAt: t, updatedAt: t, messageCount: 1 });
    const labels = { ...defaultLabels, today: 'आज', yesterday: 'कल', months: defaultLabels.months.map((m) => `${m}.`) };
    const groups = groupSessionsByDate([meta('a', now - 1000), meta('b', now - 26 * 3600 * 1000), meta('c', new Date(2026, 3, 2).getTime())], now, labels);
    expect(groups.map((g) => g.title)).toEqual(['आज', 'कल', 'Apr.']);
    expect(formatSessionTime(new Date(2026, 3, 2).getTime(), now, labels.months)).toBe('2 Apr.');
  });
});

describe('follow-up suggestions', () => {
  const base: ChatMessage = { id: 'a', role: 'assistant', parts: [], createdAt: 0 };

  it('are stored on the reply, trimmed and capped at 6', () => {
    const m = applyChunk(base, { type: 'suggestions', suggestions: [' One ', '', 'Two', '3', '4', '5', '6', '7'] });
    expect(m.suggestions).toEqual(['One', 'Two', '3', '4', '5', '6']);
    expect(applyChunk(base, { type: 'suggestions', suggestions: ['  '] })).toBe(base);
  });

  it('arrive from a backend stream in the kit format', () => {
    expect(parseAuto('{"type":"suggestions","suggestions":["Book it",5,"More"]}')).toEqual([
      { type: 'suggestions', suggestions: ['Book it', 'More'] },
    ]);
  });

  it('come with the mock transport demo replies', async () => {
    const chunks: ChatChunk[] = [];
    const t = createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0 });
    const user: ChatMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'plan a trip' }], createdAt: 0 };
    for await (const c of t({ messages: [user], signal: new AbortController().signal })) chunks.push(c);
    expect(chunks.at(-1)).toEqual({ type: 'suggestions', suggestions: ['Show cheaper flights', 'Hold the Akasa seat', 'What can I do in Goa?'] });
  });
});

describe('useChat v0.2', () => {
  it('rateMessage saves and clears a rating on assistant replies only', async () => {
    const chat = await mountChat();
    await act(async () => chat.current.send('hi'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'reply');
    const [user, reply] = chat.current.messages;

    await act(async () => chat.current.rateMessage(reply!.id, 'up'));
    expect(chat.current.messages[1]!.rating).toBe('up');
    await act(async () => chat.current.rateMessage(reply!.id, 'down'));
    expect(chat.current.messages[1]!.rating).toBe('down');
    await act(async () => chat.current.rateMessage(reply!.id, null));
    expect('rating' in chat.current.messages[1]!).toBe(false);
    await act(async () => chat.current.rateMessage(user!.id, 'up'));
    expect(chat.current.messages[0]!.rating).toBeUndefined();
  });

  it('editMessage replaces the message, drops later turns and gets a fresh reply', async () => {
    const chat = await mountChat();
    await act(async () => chat.current.send('first'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'first reply');
    await act(async () => chat.current.send('second'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 4, 'second reply');

    const firstId = chat.current.messages[0]!.id;
    await act(async () => chat.current.editMessage(firstId, 'first, edited'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'edited reply');

    expect(texts(chat.current.messages)).toEqual(['user:first, edited', 'assistant:echo:first, edited n=1']);
    expect(chat.current.messages[0]!.id).not.toBe(firstId);
  });

  it('editMessage keeps attachments and ignores non-user messages', async () => {
    const chat = await mountChat();
    const attachment = { id: 'x', kind: 'image' as const, uri: 'file:///a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', base64: 'AAA' };
    await act(async () => chat.current.send('what is this?', { attachments: [attachment] }));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2, 'reply');
    const [user, reply] = chat.current.messages;

    await act(async () => chat.current.editMessage(reply!.id, 'nope'));
    expect(chat.current.messages).toHaveLength(2); // assistant messages can't be edited

    await act(async () => chat.current.editMessage(user!.id, 'describe it'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 2 && getMessageText(chat.current.messages[0]!) === 'describe it', 'edit');
    expect(chat.current.messages[0]!.parts.map((p) => p.type)).toEqual(['image', 'text']);
  });
});

describe('useChatSessions v0.2', () => {
  it('saves ratings and suggestions with the chat', async () => {
    const store = createMemoryStore();
    const ref: { current: ReturnType<typeof useChatSessions> | null } = { current: null };
    const transport = createMockTransport({
      tokenDelayMs: 0,
      initialDelayMs: 0,
      reply: () => [{ text: 'Sure.' }, { suggestions: ['Next step'] }],
    });
    function Harness() {
      ref.current = useChatSessions({ transport, store, streamingSaveIntervalMs: 20 });
      return null;
    }
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    const chat = ref as { current: ReturnType<typeof useChatSessions> };
    await act(async () => chat.current.send('hello'));
    await until(() => !chat.current.isStreaming && chat.current.sessions.length === 1, 'saved');
    const reply = chat.current.messages[1]!;
    expect(reply.suggestions).toEqual(['Next step']);

    await act(async () => chat.current.rateMessage(reply.id, 'up'));
    await settle(60);
    const saved = await store.load(chat.current.activeSessionId!);
    expect(saved!.messages[1]).toMatchObject({ rating: 'up', suggestions: ['Next step'] });
  });
});
