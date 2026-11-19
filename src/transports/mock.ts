import { getMessageText, type ChatChunk, type ChatMessage, type ChatSource, type ChatTransport } from '../types';

export type MockStep =
  | { text: string }
  /** Streamed as reasoning (the collapsible "Thinking" block). */
  | { reasoning: string }
  /** Cited pages, shown as source chips. */
  | { sources: ChatSource[] }
  | { tool: { name: string; label?: string; args?: unknown; durationMs?: number; result?: unknown; error?: string } }
  /** Follow-up chips shown under the reply. */
  | { suggestions: string[] };

export type MockTransportOptions = {
  /** Return the script for a reply. Defaults to a rotating set of demo answers. */
  reply?: (messages: ChatMessage[]) => MockStep[] | string;
  /** Delay between tokens in ms. */
  tokenDelayMs?: number;
  /** Delay before the first token in ms. */
  initialDelayMs?: number;
  /**
   * Stream a short "thinking" section before demo answers. 'auto' (default) does it
   * when the picked model's id mentions "think" or "reason".
   */
  reasoning?: boolean | 'auto';
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

const SEARCH_SOURCES: ChatSource[] = [
  { url: 'https://reactnative.dev/blog', title: 'React Native Blog: latest releases' },
  { url: 'https://expo.dev/changelog', title: 'Expo Changelog' },
  { url: 'https://github.com/yogesh2902/react-native-ai-chat-kit', title: 'react-native-ai-chat-kit on GitHub' },
];

function searchReply(): MockStep[] {
  return [
    { tool: { name: 'web_search', label: 'Searching the web…', durationMs: 1300 } },
    { sources: SEARCH_SOURCES },
    {
      text:
        "Here's what I found (demo results):\n\n" +
        '- **React Native** keeps shipping the New Architecture by default [1]\n' +
        '- **Expo** releases a new SDK about three times a year [2]\n' +
        '- This kit renders the pages a reply cites as **source chips** below it [3]\n\n' +
        'Tap a source to open it.',
    },
    { suggestions: ['Show me the setup code', 'Plan a trip to Goa'] },
  ];
}

function reasoningFor(text: string): string {
  if (/search|news|latest|web|sources?/.test(text)) {
    return '**What they want**\nRecent news, so my own knowledge may be out of date.\n\n**Plan**\nSearch the web, summarize the top results, and cite each one as a source.';
  }
  if (/trip|flight|travel|book|plan/.test(text)) {
    return (
      '**Understanding the request**\nThe user wants flight options to Goa. I should search flights for next Friday first.\n\n' +
      '**Plan**\nCompare departure times and prices, then point out the cheapest option and offer to hold a seat.'
    );
  }
  if (/code|setup|install|use|how/.test(text)) {
    return '**What they need**\nA minimal integration example.\n\n**Approach**\nShow useChat plus ChatView with a stream transport, and keep it short.';
  }
  return '**Reading the question**\nA general greeting, so I should introduce the demo and list what the UI can render.\n\n**Answer shape**\nShort intro, a bullet list, then a nudge to try a tool call.';
}

function defaultReply(messages: ChatMessage[]): MockStep[] {
  const last = messages[messages.length - 1];
  const withFiles = last ? attachmentReply(last) : null;
  if (withFiles) return withFiles;
  const text = last ? getMessageText(last).toLowerCase() : '';
  if (/search|news|latest|web|sources?/.test(text)) return searchReply();
  if (/before|earlier|previous|remember|recap|summar/.test(text)) return recapReply(messages);
  if (/trip|flight|travel|book|plan/.test(text)) {
    return [...DEMO_REPLIES[1]!, { suggestions: ['Show cheaper flights', 'Hold the Akasa seat', 'What can I do in Goa?'] }];
  }
  if (/code|setup|install|use|how/.test(text)) {
    return [...DEMO_REPLIES[2]!, { suggestions: ['How do I add chat history?', 'Connect a real model'] }];
  }
  return [...DEMO_REPLIES[0]!, { suggestions: ['Plan a trip to Goa', 'Show me the setup code'] }];
}

/** A fake streaming backend for demos, Storybook, tests and offline development. */
export function createMockTransport(options: MockTransportOptions = {}): ChatTransport {
  const { tokenDelayMs = 18, initialDelayMs = 450 } = options;
  let toolCounter = 0;

  return async function* mockTransport({ messages, signal, model }): AsyncGenerator<ChatChunk> {
    const script = options.reply ? options.reply(messages) : defaultReply(messages);
    let steps: MockStep[] = typeof script === 'string' ? [{ text: script }] : script;
    const think = options.reasoning === 'auto' || options.reasoning === undefined ? /think|reason/i.test(model ?? '') : options.reasoning;
    if (think && !options.reply && !steps.some((s) => 'reasoning' in s)) {
      const last = messages[messages.length - 1];
      steps = [{ reasoning: reasoningFor(last ? getMessageText(last).toLowerCase() : '') }, ...steps];
    }

    await sleep(initialDelayMs, signal);
    for (const step of steps) {
      if (signal.aborted) return;
      if ('suggestions' in step) {
        yield { type: 'suggestions', suggestions: step.suggestions };
      } else if ('sources' in step) {
        for (const source of step.sources) yield { type: 'source', source };
      } else if ('reasoning' in step) {
        for (const token of tokenize(step.reasoning)) {
          if (signal.aborted) return;
          yield { type: 'reasoning-delta', text: token };
          await sleep(tokenDelayMs * 0.7, signal);
        }
      } else if ('text' in step) {
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
