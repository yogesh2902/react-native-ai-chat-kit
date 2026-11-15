# react-native-ai-chat-kit

**Add a ChatGPT-quality AI chat to your React Native or Expo app in minutes.**

Smooth streaming markdown, tool-call cards, chat history, stop/retry, dark mode, and a `useChat()` hook that works with **OpenAI, Anthropic (Claude), the Vercel AI SDK, or your own backend**.

<!-- TODO: add demo GIF here: docs/demo.gif -->

```tsx
import { ChatView, useChat, createStreamTransport } from 'react-native-ai-chat-kit';

const transport = createStreamTransport({ url: 'https://your-api.com/chat' });

export default function Assistant() {
  const chat = useChat({ transport });
  return <ChatView {...chat} />;
}
```

## Why

Building AI chat in React Native means solving the same hard problems every time:

- Text **janks or flickers** while tokens stream in
- **Half-written markdown** (`**bold`, unclosed code fences, tables) renders as garbage
- `fetch` in React Native **doesn't stream** response bodies out of the box
- Keyboard, auto-scroll, stop, retry, tool-call states, dark mode…

This kit solves them once, with **zero native dependencies**: pure TypeScript, works in Expo Go, iOS, Android and web.

## Features

- ⚡ **Streaming markdown built for tokens**: unclosed `**bold**`, `` `code` ``, links and code fences render cleanly mid-stream. Completed blocks are memoized, so only the block receiving tokens re-renders.
- 🧠 **Frame-batched updates**: tokens are coalesced into one render per frame, not one per token.
- 🛠️ **Tool-call cards**: show "Searching flights…" → ✓ Done while your agent works.
- 🔌 **Provider-agnostic**: auto-detects OpenAI (Chat Completions & Responses), Anthropic Messages, Vercel AI SDK UI streams, plain text, or this kit's own format.
- 🧑‍💻 **Code blocks** with syntax highlighting and a Copy button.
- 📊 Tables, lists, task lists, quotes, headings, links.
- ⏹️ **Stop & Retry**, error states, "scroll to latest" button.
- 💬 **Starter suggestions** for empty chats.
- 🌗 **Light/dark themes**, fully overridable.
- ⌨️ Enter-to-send on web/desktop, keyboard-aware on iOS/Android.
- 🗂️ **Chat history**: saved conversations you can reopen and continue, with a ready-made history screen.
- 🧪 **Mock transport** for demos, tests and building UI without an API key.

## Install

```sh
npm install react-native-ai-chat-kit
# or
npx expo install react-native-ai-chat-kit
```

Requires `react >= 18` and `react-native >= 0.74`. No native modules, no linking.

## Quick start (no API key)

```tsx
import { ChatView, useChat, createMockTransport } from 'react-native-ai-chat-kit';

const transport = createMockTransport();

export default function Screen() {
  const chat = useChat({ transport });
  return (
    <ChatView
      {...chat}
      suggestions={['What can you render?', 'Plan a trip to Goa']}
    />
  );
}
```

## Connect a real model

> ⚠️ **Never put an OpenAI/Anthropic API key in your app.** Anyone can extract it from the bundle. Stream through your own backend.

### Your backend (Node / Express example)

The kit sends `{ messages: [{ role, content }] }` and understands the provider's SSE stream as-is, so your server can just pipe it through.

**Anthropic (Claude)**

```ts
app.post('/chat', async (req, res) => {
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 2048,
      stream: true,
      messages: req.body.messages,
    }),
  });
  res.setHeader('Content-Type', 'text/event-stream');
  for await (const chunk of upstream.body!) res.write(chunk);
  res.end();
});
```

**OpenAI**: same idea, call `/v1/chat/completions` with `stream: true` and pipe the response.

**Vercel AI SDK**: return `result.toUIMessageStreamResponse()`. Text and tool calls are mapped automatically.

### In the app

```tsx
const transport = createStreamTransport({
  url: 'https://your-api.com/chat',
  headers: async () => ({ Authorization: `Bearer ${await getUserToken()}` }),
});
```

## Chat history (previous conversations)

Swap `useChat` for `useChatSessions` and every conversation is saved automatically. Users can reopen any past chat and keep talking: new replies get that chat's full history as context.

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatHistory, ChatView, createKeyValueStore, useChatSessions } from 'react-native-ai-chat-kit';

const store = createKeyValueStore(AsyncStorage); // or MMKV, SQLite, your server…

function Assistant() {
  const chat = useChatSessions({ transport, store, restoreLastSession: true });
  const [showHistory, setShowHistory] = useState(false);

  return showHistory ? (
    <ChatHistory
      sessions={chat.sessions}
      activeSessionId={chat.activeSessionId}
      onSelect={(id) => { chat.openSession(id); setShowHistory(false); }}
      onDelete={chat.deleteSession}
      onNewChat={() => { chat.newSession(); setShowHistory(false); }}
    />
  ) : (
    <ChatView {...chat} header={<Button title="History" onPress={() => setShowHistory(true)} />} />
  );
}
```

- **`useChatSessions`** returns everything `useChat` does, plus `sessions`, `activeSessionId`, `newSession()`, `openSession(id)`, `deleteSession(id)` and `renameSession(id, title)`.
- Titles come from the first message, and previews from the last one.
- Saving happens on every reply, and is throttled while tokens stream, so nothing is lost if the app is killed mid-answer.
- Switching chats mid-reply stops the reply and saves what arrived so far.
- **`<ChatHistory />`** groups chats ChatGPT-style (Today, Yesterday, Previous 7 days…), with search and long-press to delete.
- Bring your own storage by implementing `ChatStore` (`list`, `load`, `save`, `remove`), e.g. to sync chats to your backend.

## API

### `useChat(options)`

| Option | Type | |
| --- | --- | --- |
| `transport` | `ChatTransport` | **Required.** Where responses come from. |
| `initialMessages` | `ChatMessage[]` | Restore a saved conversation. |
| `onFinish` | `(message) => void` | Assistant finished (or was stopped). Save history here. |
| `onError` | `(error) => void` | Stream failed. |

Returns `{ messages, status, isStreaming, error, send, stop, retry, clear, setMessages }`.

`send(text, { images })` also accepts image attachments: `[{ uri, width, height }]`.

### `<ChatView />`

Spread `useChat()` into it, plus:

| Prop | Description |
| --- | --- |
| `colorScheme` | `'light' \| 'dark' \| 'auto'` (default `auto`) |
| `theme` | Partial overrides, e.g. `{ colors: { accent: '#7C3AED' }, radius: 12 }` |
| `suggestions` | Starter prompts shown when the chat is empty |
| `placeholder`, `header`, `emptyState` | Customize the chrome |
| `onCopyCode`, `onCopyMessage` | Enable Copy buttons, e.g. `Clipboard.setStringAsync` from `expo-clipboard` |
| `onLinkPress` | Defaults to `Linking.openURL` |
| `renderMessage` | Render messages yourself |
| `bottomInset`, `keyboardVerticalOffset` | Safe-area and header offsets |

### Transports

```ts
createStreamTransport({ url, headers?, body?, format?: 'sse' | 'text', parser? })
createMockTransport({ reply?, tokenDelayMs?, initialDelayMs? })
```

A transport is just an async generator, so you can write your own (WebSocket, Firebase, on-device model…):

```ts
const myTransport: ChatTransport = async function* ({ messages, signal }) {
  yield { type: 'tool-call-start', id: '1', name: 'search_docs', label: 'Searching docs…' };
  yield { type: 'tool-call-end', id: '1' };
  yield { type: 'text-delta', text: 'Found it!' };
};
```

### Building blocks

Use the pieces on their own: `StreamingMarkdown`, `MessageBubble`, `Composer`, `ToolCallCard`, `TypingIndicator`, plus `parseBlocks`, `parseInline` and `highlight`.

```tsx
<StreamingMarkdown streaming={isStreaming}>{text}</StreamingMarkdown>
```

## Run the example

```sh
cd example
npm install
npx expo start        # press i / a / w for iOS, Android, web
```

Set `EXPO_PUBLIC_CHAT_URL=https://your-api.com/chat` to use a real backend instead of the mock.

## Development

```sh
npm install
npm test          # unit tests (markdown parser, SSE decoding, provider parsers, transports)
npm run typecheck
npm run build     # emits lib/
```

## License

MIT
