import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { createKeyValueStore, createMemoryStore, type ChatStore } from '../sessions/store';
import { useChatSessions, type UseChatSessionsResult } from '../sessions/useChatSessions';
import { createMockTransport } from '../transports/mock';
import { getMessageText, type ChatMessage, type ChatTransport } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lastUserText = (messages: ChatMessage[]) => getMessageText([...messages].reverse().find((m) => m.role === 'user')!);

/** Replies "echo:<question> n=<messages the transport saw>" so tests can see what context was sent. */
const echoTransport = (tokenDelayMs = 0): ChatTransport =>
  createMockTransport({ tokenDelayMs, initialDelayMs: 0, reply: (m) => `echo:${lastUserText(m)} n=${m.length}` });

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

async function mount(options: { store: ChatStore; transport: ChatTransport; restoreLastSession?: boolean }) {
  const ref: { current: UseChatSessionsResult | null } = { current: null };
  function Harness() {
    ref.current = useChatSessions({ ...options, streamingSaveIntervalMs: 20 });
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Harness));
  });
  await settle();
  return ref as { current: UseChatSessionsResult };
}

const settle = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle(10);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const texts = (messages: ChatMessage[]) => messages.map((m) => `${m.role}:${getMessageText(m)}`);

describe('useChatSessions', () => {
  it('saves each chat separately and continues an old chat with its own context', async () => {
    const store = createMemoryStore();
    const chat = await mount({ store, transport: echoTransport() });

    await act(async () => chat.current.send('Plan a trip'));
    await until(() => !chat.current.isStreaming && chat.current.sessions.length === 1, 'first chat saved');
    const firstId = chat.current.activeSessionId!;

    await act(async () => chat.current.newSession());
    expect(chat.current.messages).toEqual([]);
    expect(chat.current.activeSessionId).toBeNull();

    await act(async () => chat.current.send('Show me code'));
    await until(() => !chat.current.isStreaming && chat.current.sessions.length === 2, 'second chat saved');
    const secondId = chat.current.activeSessionId!;
    expect(secondId).not.toBe(firstId);

    // Reopen the first chat and continue it.
    await act(() => chat.current.openSession(firstId));
    expect(texts(chat.current.messages)).toEqual(['user:Plan a trip', 'assistant:echo:Plan a trip n=1']);
    await act(async () => chat.current.send('What did I ask before?'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 4, 'reply in reopened chat');

    // The transport saw the reopened chat's full history (3 messages), not the other chat.
    expect(getMessageText(chat.current.messages[3]!)).toBe('echo:What did I ask before? n=3');

    await settle();
    const first = await store.load(firstId);
    const second = await store.load(secondId);
    expect(texts(first!.messages)).toEqual([
      'user:Plan a trip',
      'assistant:echo:Plan a trip n=1',
      'user:What did I ask before?',
      'assistant:echo:What did I ask before? n=3',
    ]);
    expect(first!.title).toBe('Plan a trip');
    expect(texts(second!.messages)).toEqual(['user:Show me code', 'assistant:echo:Show me code n=1']);
    expect(second!.title).toBe('Show me code');
    expect(chat.current.sessions.map((s) => s.id)).toEqual([firstId, secondId]); // most recently updated first
  });

  it('switching chats mid-stream saves the partial reply and never leaks tokens into the next chat', async () => {
    const store = createMemoryStore();
    const chat = await mount({ store, transport: echoTransport(15) });

    await act(async () => chat.current.send('first question here'));
    await until(() => !chat.current.isStreaming && chat.current.sessions.length === 1, 'first chat done');
    const firstId = chat.current.activeSessionId!;

    await act(async () => chat.current.newSession());
    await act(async () => chat.current.send('second question that streams slowly'));
    await settle(40); // a few tokens in
    expect(chat.current.isStreaming).toBe(true);
    const secondId = chat.current.activeSessionId!;

    await act(() => chat.current.openSession(firstId));
    await settle(150); // let any late tokens from the aborted stream arrive

    expect(texts(chat.current.messages)).toEqual(['user:first question here', 'assistant:echo:first question here n=1']);
    const second = await store.load(secondId);
    expect(second!.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'stopped' });
    expect(getMessageText(second!.messages.at(-1)!).length).toBeGreaterThan(0);
    const first = await store.load(firstId);
    expect(first!.messages).toHaveLength(2);
  });

  it('starting a new chat mid-stream keeps the old chat intact', async () => {
    const store = createMemoryStore();
    const chat = await mount({ store, transport: echoTransport(15) });

    await act(async () => chat.current.send('long answer please'));
    await settle(40);
    const firstId = chat.current.activeSessionId!;
    await act(async () => chat.current.newSession());
    await settle(150);

    expect(chat.current.messages).toEqual([]);
    await act(async () => chat.current.send('fresh start'));
    await until(() => !chat.current.isStreaming && chat.current.sessions.length === 2, 'new chat saved');

    const first = await store.load(firstId);
    expect(texts(first!.messages)[0]).toBe('user:long answer please');
    expect(first!.messages).toHaveLength(2);
    expect(first!.messages[1]!.status).toBe('stopped');
  });

  it('restores the latest chat after an app restart', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
      removeItem: async (k: string) => void data.delete(k),
    };
    const first = await mount({ store: createKeyValueStore(storage), transport: echoTransport() });
    await act(async () => first.current.send('remember me'));
    await until(() => !first.current.isStreaming && first.current.sessions.length === 1, 'saved');
    const id = first.current.activeSessionId;
    await settle();
    await act(async () => renderer!.unmount());

    // "Restart": a fresh hook instance with the same storage.
    const second = await mount({ store: createKeyValueStore(storage), transport: echoTransport(), restoreLastSession: true });
    await until(() => second.current.messages.length === 2, 'restored');
    expect(second.current.activeSessionId).toBe(id);
    expect(texts(second.current.messages)).toEqual(['user:remember me', 'assistant:echo:remember me n=1']);
  });

  it('deleting the open chat starts a new one', async () => {
    const store = createMemoryStore();
    const chat = await mount({ store, transport: echoTransport() });
    await act(async () => chat.current.send('to be deleted'));
    await until(() => !chat.current.isStreaming && chat.current.sessions.length === 1, 'saved');
    const id = chat.current.activeSessionId!;

    await act(() => chat.current.deleteSession(id));
    expect(chat.current.messages).toEqual([]);
    expect(chat.current.sessions).toEqual([]);
    expect(await store.load(id)).toBeNull();
    await settle();
    expect(await store.list()).toEqual([]); // nothing re-saved afterwards
  });

  it('renames a chat and keeps the name when the chat continues', async () => {
    const store = createMemoryStore();
    const chat = await mount({ store, transport: echoTransport() });
    await act(async () => chat.current.send('hello'));
    await until(() => !chat.current.isStreaming && chat.current.sessions.length === 1, 'saved');
    const id = chat.current.activeSessionId!;

    await act(() => chat.current.renameSession(id, 'My trip'));
    await act(async () => chat.current.send('more'));
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 4, 'second reply');
    await settle();
    expect((await store.load(id))!.title).toBe('My trip');
    expect(chat.current.sessions[0]!.title).toBe('My trip');
  });
});
