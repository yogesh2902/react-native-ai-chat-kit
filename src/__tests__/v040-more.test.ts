import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => import('./helpers/reactNativeMock'));

import { defaultCommands, expandCommand, matchCommand, suggestCommands, type ChatCommand } from '../commands';
import { ChatView } from '../components/ChatView';
import { Composer } from '../components/Composer';
import { DocumentViewer } from '../components/DocumentViewer';
import { VoiceMode } from '../components/VoiceMode';
import type { SpeechRecognizerCallbacks } from '../components/customization';
import { deriveTitle } from '../sessions/store';
import { createMockTransport } from '../transports/mock';
import { toSimpleMessages } from '../transports/stream';
import { getMessageText, type ChatMessage, type FilePart } from '../types';
import { useChat, type UseChatResult } from '../useChat';

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
  for (let i = 0; i < 200; i++) {
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
const isHost = (n: ReactTestInstance, name: string) => (n.type as unknown) === name;
const byLabel = (r: ReactTestRenderer, label: string | RegExp) =>
  r.root.findAll(
    (n) => typeof n.type === 'string' && typeof n.props.accessibilityLabel === 'string' && (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(n.props.accessibilityLabel)),
  );
const press = async (node: ReactTestInstance | undefined) => {
  expect(node).toBeDefined();
  await act(async () => node!.props.onPress?.());
};

describe('slash commands', () => {
  const commands: ChatCommand[] = [
    { name: 'summarize', prompt: 'Summarize:\n\n{input}' },
    { name: 'tone', prompt: 'Make this friendlier' },
    { name: 'shout', prompt: (input) => input.toUpperCase() },
    { name: 'clear', onRun: () => {} },
  ];

  it('matches, expands and suggests', () => {
    expect(matchCommand('/summarize the meeting notes', commands)).toEqual({ command: commands[0], input: 'the meeting notes' });
    expect(matchCommand('/unknown x', commands)).toBeNull();
    expect(matchCommand('not a command', commands)).toBeNull();
    expect(expandCommand(commands[0]!, 'notes')).toBe('Summarize:\n\nnotes');
    expect(expandCommand(commands[1]!, 'hi there')).toBe('Make this friendlier\n\nhi there');
    expect(expandCommand(commands[2]!, 'hey')).toBe('HEY');
    expect(suggestCommands('/s', commands).map((c) => c.name)).toEqual(['summarize', 'shout']);
    expect(suggestCommands('/summarize text', commands)).toEqual([]); // stops once you type a space
    expect(expandCommand(defaultCommands.find((c) => c.name === 'translate')!, 'Hindi Good morning')).toContain('into Hindi');
  });

  it('suggests commands in the composer and fills the one you pick', async () => {
    const r = await render(React.createElement(Composer, { onSend: () => {}, commands }));
    const input = () => r.root.findAll((n) => isHost(n, 'TextInput'))[0]!;
    await act(async () => input().props.onChangeText('/su'));
    expect(textOf(r)).toContain('/summarize');
    await press(byLabel(r, /^\/summarize/)[0]);
    expect(input().props.value).toBe('/summarize ');
  });

  it('ChatView sends the expanded prompt but shows what was typed; onRun commands run instead', async () => {
    const send = vi.fn();
    const onRun = vi.fn();
    const r = await render(
      React.createElement(ChatView, { messages: [], send, colorScheme: 'light', commands: [...commands.slice(0, 3), { name: 'clear', onRun }] }),
    );
    const input = () => r.root.findAll((n) => isHost(n, 'TextInput'))[0]!;
    await act(async () => input().props.onChangeText('/summarize notes from today'));
    await press(byLabel(r, 'Send message')[0]);
    expect(send).toHaveBeenCalledWith('Summarize:\n\nnotes from today', { command: { name: 'summarize', input: 'notes from today' } });

    await act(async () => input().props.onChangeText('/clear'));
    await press(byLabel(r, 'Send message')[0]);
    expect(onRun).toHaveBeenCalledWith('');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the command on the message, for titles and display', async () => {
    const ref: { current: UseChatResult | null } = { current: null };
    function Harness() {
      ref.current = useChat({ transport: createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: () => 'ok' }) });
      return null;
    }
    await render(React.createElement(Harness));
    await act(async () => ref.current!.send('Summarize:\n\nnotes', { command: { name: 'summarize', input: 'notes' } }));
    const user = ref.current!.messages[0]!;
    expect(user.command).toEqual({ name: 'summarize', input: 'notes' });
    expect(getMessageText(user)).toBe('Summarize:\n\nnotes'); // what the model gets
    expect(deriveTitle(ref.current!.messages)).toBe('/summarize notes');
  });
});

describe('offline queue', () => {
  it('queues messages and sends them in order, one reply each', async () => {
    const ref: { current: UseChatResult | null } = { current: null };
    function Harness() {
      ref.current = useChat({ transport: createMockTransport({ tokenDelayMs: 0, initialDelayMs: 0, reply: (m) => `re:${getMessageText(m[m.length - 1]!)}` }) });
      return null;
    }
    await render(React.createElement(Harness));
    const chat = ref as { current: UseChatResult };
    await act(async () => chat.current.send('one', { queue: true }));
    await act(async () => chat.current.send('two', { queue: true }));
    expect(chat.current.messages.map((m) => `${getMessageText(m)}:${m.status}`)).toEqual(['one:queued', 'two:queued']);

    await act(async () => chat.current.flushQueue());
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 3, 'first reply');
    expect(chat.current.messages.map(getMessageText)).toEqual(['one', 're:one', 'two']);
    expect(chat.current.messages[2]!.status).toBe('queued');
    // The model never sees a queued message early.
    expect(toSimpleMessages(chat.current.messages.slice(0, 2)).map((m) => m.content)).toEqual(['one', 're:one']);

    await act(async () => chat.current.flushQueue());
    await until(() => !chat.current.isStreaming && chat.current.messages.length === 4, 'second reply');
    expect(chat.current.messages.map(getMessageText)).toEqual(['one', 're:one', 'two', 're:two']);
  });

  it('ChatView queues while offline and flushes when back online', async () => {
    let notify: (online: boolean) => void = () => {};
    const network = { subscribe: (cb: (o: boolean) => void) => ((notify = cb), () => {}), isOnline: () => false };
    const send = vi.fn();
    const flushQueue = vi.fn();
    const queued: ChatMessage = { id: 'q', role: 'user', createdAt: 0, status: 'queued', parts: [{ type: 'text', text: 'later' }] };
    const r = await render(React.createElement(ChatView, { messages: [queued], send, flushQueue, network, colorScheme: 'light' }));
    expect(textOf(r)).toContain("Your message will send when you're back online");
    expect(textOf(r)).toContain('Waiting for connection');

    const input = r.root.findAll((n) => isHost(n, 'TextInput'))[0]!;
    await act(async () => input.props.onChangeText('another'));
    await press(byLabel(r, 'Send message')[0]);
    expect(send).toHaveBeenCalledWith('another', { queue: true });
    expect(flushQueue).not.toHaveBeenCalled();

    await act(async () => notify(true));
    expect(flushQueue).toHaveBeenCalled();
  });
});

describe('document preview', () => {
  const textFile: FilePart = { type: 'file', name: 'notes.md', mimeType: 'text/markdown', text: '# Trip\n\n- Goa' };
  const pdf: FilePart = { type: 'file', name: 'ticket.pdf', mimeType: 'application/pdf', uri: 'file:///cache/ticket.pdf', size: 120_000 };

  it('renders text documents in the app', async () => {
    const r = await render(React.createElement(DocumentViewer, { file: textFile, onClose: () => {} }));
    expect(textOf(r)).toContain('notes.md');
    expect(textOf(r)).toContain('Trip');
    expect(textOf(r)).toContain('Goa');
  });

  it('PDFs use the adapter, or offer Open in… when it cannot render', async () => {
    const open = vi.fn();
    const withViewer = await render(
      React.createElement(DocumentViewer, { file: pdf, onClose: () => {}, adapter: { renderPdf: () => React.createElement('PdfView', { testID: 'pdf' }), open } }),
    );
    expect(withViewer.root.findAll((n) => (n.type as unknown) === 'PdfView')).toHaveLength(1);
    await press(byLabel(withViewer, 'Open in…')[0]);
    expect(open).toHaveBeenCalledWith(pdf);
    await act(async () => withViewer.unmount());

    const noViewer = await render(React.createElement(DocumentViewer, { file: pdf, onClose: () => {}, adapter: { open } }));
    expect(textOf(noViewer)).toContain("can't be previewed here");
  });

  it('tapping a file in a message opens the preview', async () => {
    const messages: ChatMessage[] = [{ id: 'u', role: 'user', createdAt: 0, status: 'done', parts: [textFile, { type: 'text', text: 'Read this' }] }];
    const r = await render(React.createElement(ChatView, { messages, send: () => {}, colorScheme: 'light' }));
    expect(textOf(r)).not.toContain('# Trip');
    await press(byLabel(r, 'notes.md. Tap to preview')[0]);
    expect(byLabel(r, 'Close document')).toHaveLength(1);
  });
});

describe('voice mode', () => {
  it('listens, sends, reads the answer aloud, then listens again', async () => {
    let callbacks: SpeechRecognizerCallbacks | null = null;
    const voice = { start: vi.fn((cb: SpeechRecognizerCallbacks) => void (callbacks = cb)), stop: vi.fn(), abort: vi.fn() };
    let spoken = '';
    let finishSpeaking: () => void = () => {};
    const speech = { speak: vi.fn((text: string, cb: { onDone: () => void }) => ((spoken = text), (finishSpeaking = cb.onDone))), stop: vi.fn() };
    const send = vi.fn();
    const user: ChatMessage = { id: 'u', role: 'user', createdAt: 0, status: 'done', parts: [{ type: 'text', text: 'Hi' }] };
    const props = { visible: true, onClose: () => {}, voice, speech, send, messages: [] as ChatMessage[] };
    const r = await render(React.createElement(VoiceMode, props));
    expect(voice.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      callbacks!.onPartial('Plan a');
      callbacks!.onFinal('Plan a trip');
      callbacks!.onEnd();
    });
    expect(send).toHaveBeenCalledWith('Plan a trip');
    expect(textOf(r)).toContain('Thinking');

    const reply: ChatMessage = { id: 'a', role: 'assistant', createdAt: 0, status: 'done', parts: [{ type: 'text', text: '**Sure!** Goa it is.' }] };
    await act(async () => r.update(React.createElement(VoiceMode, { ...props, messages: [user, reply] })));
    expect(spoken).toBe('Sure! Goa it is.');
    expect(textOf(r)).toContain('Speaking');

    await act(async () => finishSpeaking());
    expect(voice.start).toHaveBeenCalledTimes(2); // listening again
  });
});
