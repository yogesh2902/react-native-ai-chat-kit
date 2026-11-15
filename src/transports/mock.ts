import { getMessageText, type ChatChunk, type ChatMessage, type ChatTransport } from '../types';

export type MockStep =
  | { text: string }
  | { tool: { name: string; label?: string; args?: unknown; durationMs?: number; result?: unknown; error?: string } };

export type MockTransportOptions = {
  /** Return the script for a reply. Defaults to a rotating set of demo answers. */
  reply?: (messages: ChatMessage[]) => MockStep[] | string;
  /** Delay between tokens in ms. */
  tokenDelayMs?: number;
  /** Delay before the first token in ms. */
  initialDelayMs?: number;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Split text into small word-ish tokens, roughly like an LLM does. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]{1,5}/g) ?? [];
}

const DEMO_REPLIES: MockStep[][] = [
  [
    {
      text:
        "Hi! I'm a **demo assistant** streaming from a mock transport, so this works with no API key.\n\n" +
        'Here is what I can render while tokens arrive:\n\n' +
        '- **Bold**, *italic* and `inline code`\n' +
        '- Numbered and bulleted lists\n' +
        '- Code blocks with a copy button\n' +
        '- Tables, quotes and [links](https://reactnative.dev)\n\n' +
        'Try asking me to **plan a trip** to see a tool-call card.',
    },
  ],
  [
    { text: 'Sure, let me check flights for you.\n\n' },
    { tool: { name: 'search_flights', label: 'Searching flights to Goa…', durationMs: 1600, result: { found: 3 } } },
    {
      text:
        'I found **3 options** for next Friday:\n\n' +
        '| Airline | Departs | Price |\n' +
        '| --- | --- | --- |\n' +
        '| IndiGo | 06:10 | ₹4,250 |\n' +
        '| Air India | 09:45 | ₹5,100 |\n' +
        '| Akasa | 18:30 | ₹3,980 |\n\n' +
        '> Tip: the evening Akasa flight is the cheapest.\n\n' +
        'Want me to hold a seat?',
    },
  ],
  [
    {
      text:
        "Here's a minimal setup:\n\n" +
        '```tsx\n' +
        "import { ChatView, useChat, createStreamTransport } from 'react-native-ai-chat-kit';\n\n" +
        "const transport = createStreamTransport({ url: 'https://api.example.com/chat' });\n\n" +
        'export default function Assistant() {\n' +
        '  const chat = useChat({ transport });\n' +
        '  return <ChatView {...chat} />;\n' +
        '}\n' +
        '```\n\n' +
        'That is the whole integration. Swap the URL for your backend.',
    },
  ],
];

/** Shows that the transport receives the whole conversation, including reopened chats. */
function recapReply(messages: ChatMessage[]): MockStep[] {
  const earlier = messages
    .slice(0, -1)
    .filter((m) => m.role === 'user')
    .map((m) => getMessageText(m).trim())
    .filter(Boolean);
  if (earlier.length === 0) return [{ text: "This is the start of our conversation, so there's nothing earlier to recap yet." }];
  return [
    {
      text:
        `I have the full history of this chat. Earlier you asked me ${earlier.length === 1 ? 'one thing' : `${earlier.length} things`}:\n\n` +
        earlier.map((q, i) => `${i + 1}. ${q}`).join('\n') +
        '\n\nWant to continue from any of these?',
    },
  ];
}

/** Describes received attachments, so the whole pipeline can be tested without an API key. */
function attachmentReply(last: ChatMessage): MockStep[] | null {
  const files = last.parts.filter((p) => p.type === 'image' || p.type === 'file');
  if (files.length === 0) return null;
  const kb = (b64?: string) => (b64 ? `${Math.round((b64.length * 3) / 4 / 1024)} KB` : 'no data');
  const lines = files.map((p) =>
    p.type === 'image'
      ? `- 🖼 **Image** ${p.width ?? '?'}×${p.height ?? '?'} px, ${kb(p.base64)} (${p.mimeType ?? 'image'})`
      : `- 📄 **${p.name}**: ${p.text !== undefined ? `text, ${p.text.length.toLocaleString()} characters` : `${p.mimeType}, ${kb(p.base64)}`}`,
  );
  return [
    {
      text:
        `Got ${files.length === 1 ? 'your attachment' : `${files.length} attachments`} (demo mode, so I can't actually look at them):\n\n` +
        lines.join('\n') +
        '\n\nWith a real provider (OpenAI, Claude or Gemini), these are sent to the model, which can read and describe them.',
    },
  ];
}

function defaultReply(messages: ChatMessage[]): MockStep[] {
  const last = messages[messages.length - 1];
  const withFiles = last ? attachmentReply(last) : null;
  if (withFiles) return withFiles;
  const text = last ? getMessageText(last).toLowerCase() : '';
  if (/before|earlier|previous|remember|recap|summar/.test(text)) return recapReply(messages);
  if (/trip|flight|travel|book|plan/.test(text)) return DEMO_REPLIES[1]!;
  if (/code|setup|install|use|how/.test(text)) return DEMO_REPLIES[2]!;
  return DEMO_REPLIES[0]!;
}

/** A fake streaming backend for demos, Storybook, tests and offline development. */
export function createMockTransport(options: MockTransportOptions = {}): ChatTransport {
  const { tokenDelayMs = 18, initialDelayMs = 450 } = options;
  let toolCounter = 0;

  return async function* mockTransport({ messages, signal }): AsyncGenerator<ChatChunk> {
    const script = options.reply ? options.reply(messages) : defaultReply(messages);
    const steps: MockStep[] = typeof script === 'string' ? [{ text: script }] : script;

    await sleep(initialDelayMs, signal);
    for (const step of steps) {
      if (signal.aborted) return;
      if ('text' in step) {
        for (const token of tokenize(step.text)) {
          if (signal.aborted) return;
          yield { type: 'text-delta', text: token };
          await sleep(tokenDelayMs, signal);
        }
      } else {
        const id = `mock_tool_${++toolCounter}`;
        const { name, label, args, durationMs = 1200, result, error } = step.tool;
        yield { type: 'tool-call-start', id, name, label, args };
        await sleep(durationMs, signal);
        if (signal.aborted) return;
        yield { type: 'tool-call-end', id, result, error };
      }
    }
  };
}
