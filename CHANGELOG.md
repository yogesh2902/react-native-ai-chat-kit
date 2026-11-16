# Changelog

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
