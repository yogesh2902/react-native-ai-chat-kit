import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNetInfoMonitor, createWebNetworkMonitor, isNetworkError } from '../adapters/network';
import { buildListItems, formatDateSeparator, formatMessageTime } from '../components/chatListItems';
import { presetTheme } from '../components/layoutPresets';
import { defaultLabels } from '../labels';
import type { ChatTheme } from '../theme';
import { createMockTransport } from '../transports/mock';
import type { ChatMessage } from '../types';
import { useChat, type UseChatResult } from '../useChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

const msg = (id: string, role: ChatMessage['role'], createdAt: number): ChatMessage => ({ id, role, createdAt, parts: [{ type: 'text', text: id }] });
const colors = (accent: string, input: string) =>
  ({ accent, onAccent: '#fff', inputBackground: input, userBubble: '#eee', userText: '#111', assistantBubble: 'transparent' }) as unknown as ChatTheme['colors'];
const lightTheme = { colors: colors('#111418', '#F6F7F9'), fontSize: 16, lineHeight: 24, radius: 18 } as ChatTheme;
const darkTheme = { colors: colors('#ECEDEF', '#16181D'), fontSize: 16, lineHeight: 24, radius: 18 } as ChatTheme;
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const now = at(2026, 10, 18, 15);

describe('date separators and timestamps', () => {
  it('puts one date label above the first message of each day (newest first, for the inverted list)', () => {
    const messages = [
      msg('a', 'user', at(2026, 10, 12, 9)),
      msg('b', 'assistant', at(2026, 10, 12, 9)),
      msg('c', 'user', at(2026, 10, 17, 20)),
      msg('d', 'assistant', at(2026, 10, 17, 20)),
      msg('e', 'user', at(2026, 10, 18, 10)),
      msg('sys', 'system', at(2026, 10, 18, 10)),
    ];
    const items = buildListItems(messages, { dateSeparators: true, labels: defaultLabels, now });
    expect(items.map((i) => (i.kind === 'date' ? `[${i.label}]` : i.message.id))).toEqual(['e', '[Today]', 'd', 'c', '[Yesterday]', 'b', 'a', '[12 Nov]']);
    expect(buildListItems(messages, { dateSeparators: false, labels: defaultLabels, now }).every((i) => i.kind === 'message')).toBe(true);
  });

  it('formats dates in other years and translated month names', () => {
    expect(formatDateSeparator(at(2025, 4, 3), defaultLabels, now)).toBe('3 May 2025');
    expect(formatDateSeparator(at(2026, 4, 3), { ...defaultLabels, months: defaultLabels.months.map((m) => m.toUpperCase()) }, now)).toBe('3 MAY');
    expect(formatMessageTime(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
  });
});

describe('layout presets', () => {
  it('bubbles puts both sides in bubbles, user in the accent color', () => {
    const t = presetTheme(lightTheme, 'bubbles');
    expect(t.colors.assistantBubble).toBe(lightTheme.colors.inputBackground);
    expect(t.colors.userBubble).toBe(lightTheme.colors.accent);
    expect(t.colors.userText).toBe(lightTheme.colors.onAccent);
    expect(presetTheme(darkTheme, 'bubbles').colors.userBubble).toBe(darkTheme.colors.accent);
  });

  it('compact shrinks text and corners; minimal changes nothing', () => {
    const t = presetTheme(lightTheme, 'compact');
    expect(t.fontSize).toBe(lightTheme.fontSize - 1);
    expect(t.radius).toBeLessThan(lightTheme.radius);
    expect(presetTheme(lightTheme, 'minimal')).toBe(lightTheme);
  });
});

describe('network monitors', () => {
  it('NetInfo monitor reports only changes and treats unreachable internet as offline', () => {
    let listener: ((s: { isConnected: boolean | null; isInternetReachable?: boolean | null }) => void) | undefined;
    const unsubscribe = vi.fn();
    const monitor = createNetInfoMonitor({ addEventListener: (l) => ((listener = l), unsubscribe) });
    const seen: boolean[] = [];
    const stop = monitor.subscribe((o) => seen.push(o));
    listener!({ isConnected: true, isInternetReachable: true });
    listener!({ isConnected: true, isInternetReachable: null });
    listener!({ isConnected: true, isInternetReachable: false });
    listener!({ isConnected: false });
    listener!({ isConnected: true, isInternetReachable: true });
    expect(seen).toEqual([true, false, true]);
    expect(monitor.isOnline!()).toBe(true);
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('web monitor follows online/offline events', () => {
    const handlers: Record<string, () => void> = {};
    vi.stubGlobal('addEventListener', (e: string, h: () => void) => (handlers[e] = h));
    vi.stubGlobal('removeEventListener', (e: string) => delete handlers[e]);
    vi.stubGlobal('navigator', { onLine: false });
    const monitor = createWebNetworkMonitor();
    const seen: boolean[] = [];
    const stop = monitor.subscribe((o) => seen.push(o));
    expect(monitor.isOnline!()).toBe(false);
    handlers.online!();
    handlers.offline!();
    expect(seen).toEqual([true, false]);
    stop();
    expect(Object.keys(handlers)).toEqual([]);
  });

  it('tells network failures apart from server errors', () => {
    expect(isNetworkError('Network request failed')).toBe(true);
    expect(isNetworkError('TypeError: Failed to fetch')).toBe(true);
    expect(isNetworkError('Could not reach openai.')).toBe(true);
    expect(isNetworkError('Request failed (401): bad key')).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe('deleteMessage', () => {
  it('removes one message, and stops a reply that is still streaming', async () => {
    const ref: { current: UseChatResult | null } = { current: null };
    const transport = createMockTransport({ tokenDelayMs: 20, initialDelayMs: 0, reply: () => 'one two three four five six seven eight nine ten' });
    function Harness() {
      ref.current = useChat({ transport });
      return null;
    }
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    const chat = ref as { current: UseChatResult };
    await act(async () => chat.current.send('hi'));
    await act(() => new Promise<void>((r) => setTimeout(r, 60)));
    expect(chat.current.isStreaming).toBe(true);

    const replyId = chat.current.messages[1]!.id;
    await act(async () => chat.current.deleteMessage(replyId));
    await act(() => new Promise<void>((r) => setTimeout(r, 120)));
    expect(chat.current.messages.map((m) => m.role)).toEqual(['user']);
    expect(chat.current.isStreaming).toBe(false);

    await act(async () => chat.current.deleteMessage(chat.current.messages[0]!.id));
    expect(chat.current.messages).toEqual([]);
  });
});
