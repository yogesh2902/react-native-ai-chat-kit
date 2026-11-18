# Changelog

## 0.2.0

- **Feedback**: 👍/👎 under replies with an `onFeedback` callback; ratings are saved on the message (`message.rating`) and in chat history. New `rateMessage(id, rating)` on `useChat`.
- **Edit & resend**: the latest user message can be edited; the rest of the conversation after it is replaced by a fresh reply. New `editMessage(id, text)` on `useChat`, `allowEdit` prop.
- **Follow-up chips** under the latest reply, from a new `suggestions` stream event or an app-side `followUps` function.
- **Translations**: a `labels` prop on `ChatView` and `ChatHistory` overrides every UI and screen-reader string, including history date groups and month names. `defaultLabels` lists them all.
- Mock transport demo replies now include follow-up suggestions.
- README: screenshots gallery, fixed the `send` attachments docs.

## 0.1.1

- Fix: the composer's mic button now shows a recognizable microphone icon (it previously looked like a "0").

## 0.1.0

First release.

- `ChatView` with streaming-safe markdown, code highlighting, tables, tool-call cards, starter suggestions, stop/retry, light/dark themes
- `useChat` hook with frame-batched streaming and a provider-agnostic transport layer
- `createProviderTransport` for OpenAI, Anthropic (Claude), Gemini and OpenAI-compatible APIs
- `react-native-ai-chat-kit/server`: secure chat handler for Vercel, Next.js, Cloudflare, Deno, Bun and Node, configured by env vars
- Chat history with `useChatSessions` and `ChatHistory`: reopen, continue, search, delete, auto-cleanup
- Image, camera and document sharing with automatic image optimization
- Voice input (speech-to-text) and read-aloud
- Customization: theme, custom fonts, style slots, avatars, custom tool cards, send/stop buttons, history rows
- Android edge-to-edge keyboard handling
