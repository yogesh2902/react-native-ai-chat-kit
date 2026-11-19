import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => import('./helpers/reactNativeMock'));

import * as RN from './helpers/reactNativeMock';
import { ChatHistory } from '../components/ChatHistory';
import { ChatView } from '../components/ChatView';
import { MessageBubble } from '../components/MessageBubble';
import { ModelPicker } from '../components/ModelPicker';
import { StreamingMarkdown } from '../markdown/StreamingMarkdown';
import type { ChatSessionMeta } from '../sessions/store';
import type { ChatMessage } from '../types';

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

/** All visible text, joined. */
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

/** Host element name (the stand-in renders 'View', 'Text', 'Pressable'… as strings). */
const isHost = (n: ReactTestInstance, name: string) => (n.type as unknown) === name;

const byLabel = (r: ReactTestRenderer, label: string | RegExp): ReactTestInstance[] =>
  r.root.findAll(
    (n) => typeof n.type === 'string' && typeof n.props.accessibilityLabel === 'string' && (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(n.props.accessibilityLabel)),
  );
const press = async (node: ReactTestInstance | undefined) => {
  expect(node).toBeDefined();
  await act(async () => node!.props.onPress?.());
};

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  createdAt: 0,
  status: 'done',
  parts: [
    { type: 'reasoning', text: 'Comparing prices', startedAt: 0, durationMs: 3200 },
    { type: 'text', text: 'Akasa is cheapest [1], IndiGo is earliest [2].' },
  ],
  sources: [
    { url: 'https://akasaair.com', title: 'Akasa Air' },
    { url: 'https://goindigo.in', title: 'IndiGo' },
  ],
  ...over,
});

describe('MessageBubble', () => {
  it('shows reasoning, sources, citations and the version switcher', async () => {
    const onSourcePress = vi.fn();
    const onSelectVersion = vi.fn();
    const message = assistant({
      versions: [
        { parts: [{ type: 'text', text: 'old 1' }], createdAt: 0 },
        { parts: [{ type: 'text', text: 'old 2' }], createdAt: 0 },
      ],
      versionIndex: 1,
    });
    const r = await render(React.createElement(MessageBubble, { message, isLast: true, onSourcePress, onSelectVersion, onCopyMessage: () => {} }));
    const text = textOf(r);
    expect(text).toContain('Thought for 3s');
    expect(text).toContain('2 sources');
    expect(text).toContain('2/3');
    // [1] became a tappable superscript ¹.
    expect(text).toContain('Akasa is cheapest ¹');
    await press(byLabel(r, 'Source 1: Akasa Air')[0]);
    expect(onSourcePress).toHaveBeenCalledWith(message.sources![0], 0);
    await press(byLabel(r, 'Next answer')[0]);
    expect(onSelectVersion).toHaveBeenCalledWith(message, 2);
  });

  it('hides reasoning, sources and citations when switched off', async () => {
    const r = await render(React.createElement(MessageBubble, { message: assistant(), reasoning: false, showSources: false, linkCitations: false }));
    const text = textOf(r);
    expect(text).not.toContain('Thought for');
    expect(text).not.toContain('sources');
    expect(text).toContain('cheapest [1]');
  });

  it('asks before running a tool and reports the decision', async () => {
    const onToolDecision = vi.fn();
    const message = assistant({
      sources: undefined,
      parts: [
        {
          type: 'tool-call',
          id: 't1',
          name: 'hold_seat',
          label: 'Hold seat',
          state: 'awaiting-approval',
          approval: 'pending',
          approvalMessage: 'Hold 1 seat for ₹3,980?',
        },
      ],
    });
    const r = await render(React.createElement(MessageBubble, { message, onToolDecision }));
    expect(textOf(r)).toContain('Hold 1 seat for ₹3,980?');
    await press(byLabel(r, 'Approve: Hold seat')[0]);
    expect(onToolDecision).toHaveBeenCalledWith('t1', true);
    await press(byLabel(r, 'Deny: Hold seat')[0]);
    expect(onToolDecision).toHaveBeenLastCalledWith('t1', false);
  });

  it('shows quotes, branch switcher and tappable images, and names the speaker for screen readers', async () => {
    const onQuotePress = vi.fn();
    const onSelectBranch = vi.fn();
    const onImagePress = vi.fn();
    const message: ChatMessage = {
      id: 'u1',
      role: 'user',
      createdAt: 0,
      parts: [{ type: 'image', uri: 'https://x/cat.jpg', alt: 'A cat' }, { type: 'text', text: 'Like this?' }],
      replyTo: { id: 'a0', role: 'assistant', text: 'Paris is the capital.' },
      branches: [{ parts: [{ type: 'text', text: 'first try' }], createdAt: 0, following: [] }],
      branchIndex: 1,
    };
    const r = await render(React.createElement(MessageBubble, { message, onQuotePress, onSelectBranch, onImagePress, onEdit: () => {} }));
    const text = textOf(r);
    expect(text).toContain('You said');
    expect(text).toContain('Paris is the capital.');
    expect(text).toContain('2/2');
    await press(byLabel(r, /^Quoted message/)[0]);
    expect(onQuotePress).toHaveBeenCalledWith('a0');
    await press(byLabel(r, 'Previous version of this message')[0]);
    expect(onSelectBranch).toHaveBeenCalledWith(message, 0);
    await press(byLabel(r, 'A cat. Tap to view full screen')[0]);
    expect(onImagePress).toHaveBeenCalledWith('https://x/cat.jpg', 'A cat');
  });
});

describe('StreamingMarkdown', () => {
  it('renders math as Unicode only when math is on', async () => {
    const md = 'Area is $\\pi r^2$ and $$\\frac{1}{2} \\le x$$';
    const on = await render(React.createElement(StreamingMarkdown, { math: true, children: md }));
    expect(textOf(on)).toContain('Area is πr²');
    expect(textOf(on)).toContain('½ ≤ x');
    await act(async () => on.unmount());
    const off = await render(React.createElement(StreamingMarkdown, { children: 'Costs $5 and $10' }));
    expect(textOf(off)).toBe('Costs $5 and $10');
  });

  it('code blocks: line numbers on request, plain with codeBlocks={false}', async () => {
    const code = '```ts\nconst a = 1;\nconst b = 2;\n```';
    const numbered = await render(React.createElement(StreamingMarkdown, { codeBlocks: { lineNumbers: true }, children: code }));
    expect(textOf(numbered)).toContain('1\n2');
    await act(async () => numbered.unmount());
    const plain = await render(React.createElement(StreamingMarkdown, { codeBlocks: false, children: code }));
    expect(textOf(plain)).not.toContain('1\n2');
    // No highlighting: the code is one run of text.
    expect(plain.root.findAll((n) => isHost(n, 'Text') && n.props.children === 'const a = 1;\nconst b = 2;')).toHaveLength(1);
  });
});

describe('ChatView', () => {
  const base = { send: () => {}, colorScheme: 'light' as const };

  it('shows the model picker, and quote-reply from the long-press menu', async () => {
    const messages: ChatMessage[] = [
      { id: 'u', role: 'user', createdAt: 0, status: 'done', parts: [{ type: 'text', text: 'Hi' }] },
      { id: 'a', role: 'assistant', createdAt: 0, status: 'done', parts: [{ type: 'text', text: 'Hello there' }] },
    ];
    const send = vi.fn();
    const models = [
      { id: 'fast', name: 'Fast' },
      { id: 'smart', name: 'Smart' },
    ];
    const r = await render(React.createElement(ChatView, { ...base, send, messages, models, model: 'smart', allowReply: true }));
    expect(byLabel(r, /^Model: Smart/)).toHaveLength(1);

    // The list is inverted (newest first), so the assistant's reply comes first.
    const bubble = r.root.findAll((n) => isHost(n, 'Pressable') && typeof n.props.onLongPress === 'function')[0];
    await act(async () => bubble!.props.onLongPress());
    await press(byLabel(r, 'Reply')[0]);
    expect(textOf(r)).toContain('Replying to the answer');
  });

  it('hides the picker with showModelPicker={false}', async () => {
    const r = await render(React.createElement(ChatView, { ...base, messages: [], models: [{ id: 'm', name: 'M' }], showModelPicker: false }));
    expect(byLabel(r, /^Model:/)).toHaveLength(0);
  });

  it('announces when a reply is ready', async () => {
    RN.AccessibilityInfo.announced.length = 0;
    const streaming: ChatMessage[] = [{ id: 'a', role: 'assistant', createdAt: 0, status: 'streaming', parts: [{ type: 'text', text: 'Hel' }] }];
    const r = await render(React.createElement(ChatView, { ...base, messages: streaming }));
    await act(async () => r.update(React.createElement(ChatView, { ...base, messages: [{ ...streaming[0]!, status: 'done', parts: [{ type: 'text', text: 'Hello' }] }] })));
    expect(RN.AccessibilityInfo.announced).toContain('Reply ready');
  });
});

describe('ChatHistory', () => {
  const sessions: ChatSessionMeta[] = [
    { id: 's1', title: 'Goa trip', preview: 'flights', createdAt: 1, updatedAt: Date.now(), messageCount: 2, pinned: true },
    { id: 's2', title: 'Code help', preview: 'useChat', createdAt: 1, updatedAt: Date.now() - 1000, messageCount: 2 },
  ];

  it('pins, renames and exports from the long-press menu', async () => {
    const onPin = vi.fn();
    const onRename = vi.fn();
    const onExport = vi.fn();
    const r = await render(
      React.createElement(ChatHistory, { sessions, onSelect: () => {}, onDelete: () => {}, onPin, onRename, onExport, colorScheme: 'light' }),
    );
    expect(textOf(r)).toContain('Pinned');
    const row = byLabel(r, 'Goa trip. flights')[0]!;
    await act(async () => row.props.onLongPress());
    await press(byLabel(r, 'Unpin')[0]);
    expect(onPin).toHaveBeenCalledWith('s1', false);

    await act(async () => byLabel(r, 'Code help. useChat')[0]!.props.onLongPress());
    await press(byLabel(r, 'Export / share')[0]);
    expect(onExport).toHaveBeenCalledWith('s2'); // ran after the sheet closed

    await act(async () => byLabel(r, 'Code help. useChat')[0]!.props.onLongPress());
    await press(byLabel(r, 'Rename')[0]);
    const input = r.root.findAll((n) => isHost(n, 'TextInput') && n.props.accessibilityLabel === 'Rename chat')[0]!;
    await act(async () => input.props.onChangeText('Hooks help'));
    // The deepest Pressable containing "Save" is the button itself (the outer ones are the backdrop and dialog).
    await press(r.root.findAll((n) => isHost(n, 'Pressable') && n.findAll((c) => c.props.children === 'Save').length > 0).at(-1));
    expect(onRename).toHaveBeenCalledWith('s2', 'Hooks help');
  });
});

describe('ModelPicker', () => {
  it('opens a sheet and picks a model', async () => {
    const onChange = vi.fn();
    const r = await render(
      React.createElement(ModelPicker, {
        models: [
          { id: 'fast', name: 'Fast', badge: 'Fast' },
          { id: 'smart', name: 'Smart', description: 'Thinks first' },
        ],
        value: 'fast',
        onChange,
      }),
    );
    expect(textOf(r)).not.toContain('Choose model');
    await press(byLabel(r, /^Model: Fast/)[0]);
    expect(textOf(r)).toContain('Choose model');
    await press(byLabel(r, 'Smart. Thinks first')[0]);
    expect(onChange).toHaveBeenCalledWith('smart');
  });
});
