import { describe, expect, it } from 'vitest';
import { filterSessions, formatSessionTime, groupSessionsByDate } from '../sessions/groupSessions';
import {
  createKeyValueStore,
  createMemoryStore,
  derivePreview,
  deriveTitle,
  type ChatSession,
  type ChatSessionMeta,
} from '../sessions/store';
import { createMockTransport } from '../transports/mock';
import type { ChatChunk, ChatMessage } from '../types';

const msg = (role: ChatMessage['role'], text: string, id = Math.random().toString(36)): ChatMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
  createdAt: 0,
  status: 'done',
});

const session = (id: string, updatedAt: number, messages: ChatMessage[] = [msg('user', `hi ${id}`)]): ChatSession => ({
  id,
  title: deriveTitle(messages),
  createdAt: updatedAt,
  updatedAt,
  preview: derivePreview(messages),
  messageCount: messages.length,
  messages,
});

/** AsyncStorage-like fake with async methods, like the real thing. */
function fakeAsyncStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => void data.set(k, v),
    removeItem: async (k: string) => void data.delete(k),
  };
}

describe('deriveTitle / derivePreview', () => {
  it('uses the first user message, collapsed and truncated', () => {
    expect(deriveTitle([msg('assistant', 'Hello'), msg('user', '  Plan a\n trip  ')])).toBe('Plan a trip');
    expect(deriveTitle([msg('user', 'x'.repeat(100))])).toHaveLength(48);
    expect(deriveTitle([])).toBe('New chat');
  });

  it('previews the last message without markdown symbols', () => {
    expect(derivePreview([msg('user', 'q'), msg('assistant', '**Bold** and `code`')])).toBe('Bold and code');
  });
});

describe('createKeyValueStore', () => {
  it('saves, lists newest first, loads, and removes', async () => {
    const storage = fakeAsyncStorage();
    const store = createKeyValueStore(storage);
    await store.save(session('a', 100));
    await store.save(session('b', 300));
    await store.save(session('c', 200));

    expect((await store.list()).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect((await store.load('c'))?.messages[0]).toMatchObject({ role: 'user' });
    // The index holds metadata only, never message bodies.
    expect(storage.data.get('ai-chat-kit:index')).not.toContain('"messages"');

    await store.remove('b');
    expect((await store.list()).map((s) => s.id)).toEqual(['c', 'a']);
    expect(await store.load('b')).toBeNull();
  });

  it('updates an existing session in place', async () => {
    const store = createKeyValueStore(fakeAsyncStorage());
    await store.save(session('a', 100));
    await store.save({ ...session('a', 500, [msg('user', 'hi'), msg('assistant', 'updated reply')]) });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a', updatedAt: 500, preview: 'updated reply', messageCount: 2 });
  });

  it('does not lose sessions when saves run concurrently', async () => {
    const store = createKeyValueStore(fakeAsyncStorage());
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(session(`s${i}`, i))));
    expect(await store.list()).toHaveLength(20);
  });

  it('survives corrupted data', async () => {
    const storage = fakeAsyncStorage();
    storage.data.set('ai-chat-kit:index', '{not json');
    storage.data.set('ai-chat-kit:session:x', 'oops');
    const store = createKeyValueStore(storage);
    expect(await store.list()).toEqual([]);
    expect(await store.load('x')).toBeNull();
  });

  it('isolates data by prefix and clears everything', async () => {
    const storage = fakeAsyncStorage();
    const a = createKeyValueStore(storage, { prefix: 'app1' });
    const b = createKeyValueStore(storage, { prefix: 'app2' });
    await a.save(session('x', 1));
    expect(await b.list()).toEqual([]);
    await a.clear!();
    expect(storage.data.size).toBe(0);
  });
});

describe('createMemoryStore', () => {
  it('implements the same contract', async () => {
    const store = createMemoryStore([session('old', 1)]);
    await store.save(session('new', 2));
    expect((await store.list()).map((s) => s.id)).toEqual(['new', 'old']);
    await store.remove('old');
    expect(await store.load('old')).toBeNull();
  });
});

describe('groupSessionsByDate', () => {
  const now = new Date(2026, 10, 16, 15, 0).getTime();
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
  const meta = (id: string, updatedAt: number): ChatSessionMeta => ({ id, title: id, preview: '', createdAt: updatedAt, updatedAt, messageCount: 1 });

  it('buckets by recency', () => {
    const groups = groupSessionsByDate(
      [
        meta('today', at(2026, 10, 16, 9)),
        meta('yesterday', at(2026, 10, 15)),
        meta('week', at(2026, 10, 11)),
        meta('month', at(2026, 10, 1)),
        meta('sep', at(2026, 8, 3)),
        meta('lastyear', at(2025, 4, 3)),
      ],
      now,
    );
    expect(groups.map((g) => [g.title, g.data.map((s) => s.id)])).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['week']],
      ['Previous 30 days', ['month']],
      ['Sep', ['sep']],
      ['May 2025', ['lastyear']],
    ]);
  });

  it('formats times', () => {
    expect(formatSessionTime(at(2026, 10, 16, 9), now)).toBe('09:00');
    expect(formatSessionTime(at(2026, 10, 12), now)).toBe('12 Nov');
  });

  it('filters by title or preview', () => {
    const list = [
      { ...meta('a', 1), title: 'Goa trip', preview: 'flights' },
      { ...meta('b', 2), title: 'Code help', preview: 'useChat hook' },
    ];
    expect(filterSessions(list, 'GOA').map((s) => s.id)).toEqual(['a']);
    expect(filterSessions(list, 'hook').map((s) => s.id)).toEqual(['b']);
    expect(filterSessions(list, '  ')).toHaveLength(2);
  });
});

describe('mock transport recap', () => {
  it('replies using earlier messages in the conversation', async () => {
    const transport = createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0 });
    const history = [msg('user', 'Plan a trip to Goa'), msg('assistant', 'Sure'), msg('user', 'What did I ask before?')];
    let text = '';
    for await (const c of transport({ messages: history, signal: new AbortController().signal })) {
      if ((c as ChatChunk).type === 'text-delta') text += (c as { text: string }).text;
    }
    expect(text).toContain('1. Plan a trip to Goa');
  });
});
