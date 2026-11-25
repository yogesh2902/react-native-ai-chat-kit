import { getMessageText, type ChatChunk, type ChatMessage, type ChatSource, type ChatTransport, type FinishReason } from '../types';

export type MockStep =
  | { text: string }
  /** Streamed as reasoning (the collapsible "Thinking" block). */
  | { reasoning: string }
  /** Cited pages, shown as source chips. */
  | { sources: ChatSource[] }
  /** An image in the reply (e.g. a generated one). */
  | { image: { url: string; alt?: string; width?: number; height?: number } }
  /** Why the reply ended; 'length' shows the Continue button. */
  | { finish: FinishReason }
  | {
      tool: {
        name: string;
        label?: string;
        args?: unknown;
        durationMs?: number;
        result?: unknown;
        error?: string;
        /** Pause for Approve / Deny before running. The reply continues after the user answers. */
        requireApproval?: boolean;
        /** The question shown on the approval card. */
        approvalMessage?: string;
        /** Said when the user taps Deny. */
        deniedText?: string;
      };
    }
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

function mathReply(): MockStep[] {
  return [
    {
      text:
        'The **quadratic formula** solves $ax^2 + bx + c = 0$:\n\n' +
        '$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\n' +
        'The part under the root, $\\Delta = b^2 - 4ac$, tells you how many real roots there are:\n\n' +
        '- $\\Delta > 0$: two roots\n' +
        '- $\\Delta = 0$: one root\n' +
        '- $\\Delta < 0$: no real roots\n\n' +
        '(Turn on `math` in ChatView to render formulas like these.)',
    },
    { suggestions: ['Solve x² − 5x + 6 = 0', 'Draw a sunset'] },
  ];
}

function imageReply(): MockStep[] {
  return [
    { text: "Here's a sunset over a Goa beach, generated for you:\n\n" },
    { tool: { name: 'generate_image', label: 'Creating image…', durationMs: 1800 } },
    {
      image: {
        url: 'https://picsum.photos/seed/goa-sunset/1024/768',
        alt: 'A warm sunset over a beach in Goa',
        width: 1024,
        height: 768,
      },
    },
    { text: '\n\nTap the image to view it full screen or share it. (Demo image from picsum.photos.)' },
    { suggestions: ['Make it more colorful', 'Plan a trip to Goa'] },
  ];
}

function holdSeatReply(): MockStep[] {
  return [
    { text: 'I can hold the evening Akasa seat for 15 minutes while you decide.\n\n' },
    {
      tool: {
        name: 'hold_seat',
        label: 'Hold seat: Akasa QP 1129',
        args: { flight: 'QP 1129', from: 'DEL', to: 'GOI', departs: 'Fri 18:30', price: 3980 },
        approvalMessage: 'Hold 1 seat on Akasa QP 1129, Delhi → Goa, Friday 18:30, for ₹3,980?',
        requireApproval: true,
        durationMs: 1400,
        result: { held: true, until: '18:45' },
        deniedText: "No problem, I haven't held anything. Want me to look at other flights?",
      },
    },
    { text: '\n\nDone! 🎉 Your seat is **held until 18:45**. Pay before then to confirm it.' },
    { suggestions: ['Pay now', 'Find a hotel in Goa'] },
  ];
}

const STORY_START =
  '## The lighthouse at Candolim\n\n' +
  'Every evening at six, Meera climbed the hundred and twelve steps of the old lighthouse with a flask of chai and a notebook. ' +
  'From the top she could see the whole curve of the beach: fishing boats pulled up on the sand, kids chasing the tide, ' +
  'and the shacks lighting their lanterns one by one.\n\n' +
  'She had been writing the same letter for three weeks. It was to her grandfather, who had kept this lighthouse for forty years ' +
  'before the new automatic beacon made him retire. He had never told her why he kept a second lamp, smaller and older, ' +
  'wrapped in cloth at the bottom of his trunk.\n\n' +
  'Tonight, the monsoon clouds were rolling in early. As the first drops hit the glass, Meera noticed a light blinking far out at sea, ' +
  'three short flashes, then a long one, the same pattern her grandfather used to';

const STORY_END =
  ' tap on the kitchen table when he thought nobody was watching.\n\n' +
  'She ran down the steps, unlocked the trunk and unwrapped the little lamp. Its brass was green with age, but the wick was new. ' +
  'Someone had been keeping it ready.\n\n' +
  'Back at the top, she lit it and answered: three short, one long. Out on the dark water the distant light paused, then flashed twice, ' +
  'slow and warm, like someone saying *finally*.\n\n' +
  "The next morning a small boat came in with the tide. The old man who stepped off it was thinner than she remembered, " +
  'but he was smiling, and he was holding a letter of his own.\n\n**The end.**';

const isContinueRequest = (m: ChatMessage | undefined) =>
  !!m && m.role === 'user' && (m.id.endsWith(':continue') || /^your last reply was cut off/i.test(getMessageText(m)));

function storyReply(): MockStep[] {
  return [{ text: STORY_START }, { finish: 'length' }];
}

function reasoningFor(text: string): string {
  if (/\b(hold|reserve)\b/.test(text)) {
    return '**Booking action**\nHolding a seat commits the user, so I must ask before doing it.\n\n**Plan**\nExplain the hold, then request approval for the hold_seat tool.';
  }
  if (/\b(draw|image|picture|generate)\b/.test(text)) {
    return '**Image request**\nA warm beach sunset. Wide shot, soft light, calm water.\n\n**Plan**\nGenerate the image, then offer to tweak it.';
  }
  if (/\b(formula|equation|math|solve|quadratic)\b/.test(text)) {
    return '**Math question**\nState the formula, then explain the discriminant and its three cases.';
  }
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
  if (isContinueRequest(last)) {
    const cut = messages[messages.length - 2];
    return cut && getMessageText(cut).includes('Candolim')
      ? [{ text: STORY_END }, { finish: 'stop' }, { suggestions: ['Write another story', 'Plan a trip to Goa'] }]
      : [{ text: ' …and that is the rest of the answer.' }, { finish: 'stop' }];
  }
  if (/\b(story|essay)\b/.test(text)) return storyReply();
  if (/search|news|latest|web|sources?/.test(text)) return searchReply();
  if (/\b(hold|reserve)\b/.test(text)) return holdSeatReply();
  if (/\b(draw|image|picture|photo of|generate)\b/.test(text) && !/attach/.test(text)) return imageReply();
  if (/\b(formula|equation|math|solve|quadratic)\b/.test(text)) return mathReply();
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
    // Continuing a reply after the user approved or denied a tool.
    const lastMessage = messages[messages.length - 1];
    const resumed = lastMessage?.role === 'assistant' ? lastMessage : undefined;
    const history = resumed ? messages.slice(0, -1) : messages;
    const script = options.reply ? options.reply(history) : defaultReply(history);
    let steps: MockStep[] = typeof script === 'string' ? [{ text: script }] : script;
    if (resumed) {
      const decided = [...resumed.parts]
        .reverse()
        .find((p) => p.type === 'tool-call' && (p.approval === 'approved' || p.approval === 'denied'));
      if (!decided || decided.type !== 'tool-call') return;
      const at = steps.findIndex((s) => 'tool' in s && s.tool.name === decided.name && s.tool.requireApproval);
      const step = steps[at] as Extract<MockStep, { tool: unknown }> | undefined;
      await sleep(initialDelayMs / 2, signal);
      if (decided.approval === 'denied') {
        for (const token of tokenize(`\n\n${step?.tool.deniedText ?? "Okay, I won't do that."}`)) {
          if (signal.aborted) return;
          yield { type: 'text-delta', text: token };
          await sleep(tokenDelayMs, signal);
        }
        return;
      }
      await sleep(step?.tool.durationMs ?? 1200, signal);
      if (signal.aborted) return;
      yield { type: 'tool-call-end', id: decided.id, result: step?.tool.result, error: step?.tool.error };
      steps = at === -1 ? [] : steps.slice(at + 1);
    }
    const think = options.reasoning === 'auto' || options.reasoning === undefined ? /think|reason/i.test(model ?? '') : options.reasoning;
    if (think && !resumed && !options.reply && !isContinueRequest(lastMessage) && !steps.some((s) => 'reasoning' in s)) {
      const last = messages[messages.length - 1];
      steps = [{ reasoning: reasoningFor(last ? getMessageText(last).toLowerCase() : '') }, ...steps];
    }

    if (!resumed) await sleep(initialDelayMs, signal);
    for (const step of steps) {
      if (signal.aborted) return;
      if ('suggestions' in step) {
        yield { type: 'suggestions', suggestions: step.suggestions };
      } else if ('sources' in step) {
        for (const source of step.sources) yield { type: 'source', source };
      } else if ('finish' in step) {
        yield { type: 'finish', reason: step.finish };
      } else if ('image' in step) {
        yield { type: 'image', id: `mock_image_${++toolCounter}`, url: step.image.url, alt: step.image.alt, width: step.image.width, height: step.image.height };
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
        if (step.tool.requireApproval) {
          // Pause here; the reply continues when the user answers.
          yield { type: 'tool-approval-request', id, name, label, args, message: step.tool.approvalMessage };
          return;
        }
        yield { type: 'tool-call-start', id, name, label, args };
        await sleep(durationMs, signal);
        if (signal.aborted) return;
        yield { type: 'tool-call-end', id, result, error };
      }
    }
  };
}
