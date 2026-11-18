# Changelog

## 0.4.0

A visual polish release.

- **Color palettes**: `palette="neutral" | "violet" | "ocean" | "sunset" | "forest"` on `ChatView` and `ChatHistory`, tuned for light and dark. New `applyPalette`, `PALETTE_NAMES` and `withAlpha` helpers.
- **Motion**: new messages fade in (saved history loads in place), follow-up chips and welcome cards stagger in, the send button springs in when ready, and cards scale on press. Honors Reduce Motion; `animations={false}` turns it off.
- **Icon toolbar** for message actions by default (`actionsStyle="labels"` for the previous text buttons).
- **Floating composer** with a soft shadow and an accent focus glow.
- **Tool cards** shimmer while running, with the status in a tinted badge.
- **Code blocks** get a window-style header with the language and a Copy button.
- **Welcome screen**: accent glow behind the logo and roomier cards with tinted icon tiles.

## 0.3.0

Customization
- **Layout presets**: `layout="minimal" | "bubbles" | "compact"`, applied under your own theme.
- **Rich welcome screen** (`welcome`): logo, greeting, subtitle and starter cards in a grid or list.
- **Custom message actions** (`messageActions`) in a long-press menu, optionally inline under replies; Copy, Edit and Delete (`allowDelete`) included. New `deleteMessage(id)` on `useChat`.
- **Streaming look**: `typingIndicator="dots" | "pulse" | "text"` and `streamingCursor`.

Enhancements
- **Timestamps and date separators** (`showTimestamps`, `dateSeparators`, `formatTime`).
- **Offline banner with auto-retry** via a `network` monitor: `createNetInfoMonitor(NetInfo)` or `createWebNetworkMonitor()`.
- **Right-to-left layout** (`direction`), mirroring bubbles, composer and tables; table cells follow the text direction.
- New labels: `thinking`, `messageOptions`, `deleteMessage`, `closeMenu`, `offline`, `reconnecting`.

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
