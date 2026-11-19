# Changelog

## 0.4.0

Every new feature is optional, with its own switch.

- **Tool approval**: a new `tool-approval-request` stream event pauses the reply on an Approve / Deny card. `respondToTool(id, approved)` records the choice on the tool part and continues the same reply; sending a new message cancels pending approvals. `renderToolCall` gets a `respond` function for custom cards.
- **Chat tools**: pin, rename and export chats from a long-press sheet in `ChatHistory` (`onPin`, `onRename`, `onExport`); a "Pinned" section; search inside messages (`searchMessages`). New `pinSession`, `exportSession`, `searchSessions` in `useChatSessions` and `exportChat()` for Markdown / plain text.
- **Edit older messages**: `editAnyMessage` adds Edit to the long-press menu of any user message. Edits keep the original and its replies as a branch (‹ 1/2 ›, `selectBranch`); `keepEditBranches: false` restores replace-only editing.
- **Tappable citations**: `[1]`, `[2]`… in replies become superscript links to their sources (`linkCitations`).
- **Math**: `math` renders LaTeX (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) as readable Unicode with no dependencies, or through your own renderer (`math={{ render }}`).
- **Generated images**: a new `image` stream event (with progressive previews), parsed from OpenAI image generation, Gemini and AI SDK file parts; markdown images render too. Tap any image for a full-screen viewer with Share (`imageViewer`, `onImagePress`).
- **Accessibility**: messages announce who is speaking; "Reply ready" / failure announcements; icons capped for very large text; shimmer animations respect Reduce Motion; version and branch switchers are adjustable controls.
- **Fix (iOS)**: actions in the long-press menu that open a share sheet or another dialog now wait until the menu has closed, so they no longer silently fail.
- **Tests**: component tests with a React Native stand-in (renders the real components), plus tests for approvals, branches, export, math and images (143 in total).
- **Docs**: a demo GIF in the README.

## 0.3.0

Every new feature is optional, with its own prop to turn it on or off.

- **Reasoning**: replies from reasoning models show a collapsible "Thinking…" block with a live preview, then "Thought for 12s". `reasoning={true | false}` or `"expanded"`.
- **Sources**: numbered source chips under answers that cite pages (web search, RAG). `showSources`, `onSourcePress`.
- **Reply versions**: Regenerate keeps the earlier answer; switch with ‹ 2/3 ›. Each version keeps its own rating. `useChat({ keepReplyVersions })`, `regenerate()`, `selectVersion()`.
- **Quote reply**: swipe a message (or long-press → Reply) to quote it; the quote is shown in the bubble and sent to the model. Tap a quote to jump to the original. `allowReply`.
- **Model picker**: `models={[...]}` shows a picker above the input; the choice is sent as `model`, saved per chat and restored when it is reopened. `<ModelPicker>` is exported for custom headers.
- **Code blocks**: richer highlighting (types, properties, JSX/HTML tags and attributes, decorators, SQL, CSS, YAML, diffs), optional line numbers, light/dark/auto code themes, and `renderCodeBlock` for any highlighter. `codeBlocks={false}` for plain code, or `codeBlocks={{ ... }}`.
- **Haptics and sounds**: `createExpoHaptics(Haptics)` and `createExpoSounds(Audio)` (built-in sounds included), or any `(event) => void` function.
- **Providers**: `reasoning` and `webSearch` options for Claude (adaptive thinking, web search citations), Gemini (thought summaries, Google Search grounding) and OpenAI (`reasoning_effort`, `web_search_options`). Parsers also read reasoning and citations from OpenAI-compatible APIs, the Responses API and AI SDK streams.
- **Server**: `models` allowlist (`AI_MODELS`) for the model picker, plus `AI_REASONING` and `AI_WEB_SEARCH`.
- New stream events `reasoning-delta` and `source`; the mock transport demos reasoning, web search and sources.

## 0.2.0

A big update: conversation features, customization, and a visual refresh.

Conversation
- **Feedback**: 👍/👎 under replies with an `onFeedback` callback; ratings are saved on the message (`message.rating`) and in chat history. New `rateMessage(id, rating)` on `useChat`.
- **Edit & resend**: the latest user message can be edited; the rest of the conversation after it is replaced by a fresh reply. New `editMessage(id, text)` on `useChat`, `allowEdit` prop.
- **Follow-up chips** under the latest reply, from a new `suggestions` stream event or an app-side `followUps` function.
- **Long-press message menu** with Copy, Edit, custom `messageActions` and Delete (`allowDelete`); actions can also show inline under replies. New `deleteMessage(id)` on `useChat`.
- **Timestamps and date separators** (`showTimestamps`, `dateSeparators`, `formatTime`).
- **Offline banner with auto-retry** via a `network` monitor: `createNetInfoMonitor(NetInfo)` or `createWebNetworkMonitor()`.

Customization
- **Color palettes**: `palette="neutral" | "violet" | "ocean" | "sunset" | "forest"` on `ChatView` and `ChatHistory`, tuned for light and dark. New `applyPalette`, `PALETTE_NAMES` and `withAlpha` helpers.
- **Layout presets**: `layout="minimal" | "bubbles" | "compact"`, applied under your own theme.
- **Rich welcome screen** (`welcome`): logo, greeting, subtitle and starter cards in a grid or list.
- **Streaming look**: `typingIndicator="dots" | "pulse" | "text"` and `streamingCursor`.
- **Translations**: a `labels` prop on `ChatView` and `ChatHistory` overrides every UI and screen-reader string, including history date groups and month names (`defaultLabels` lists them all).
- **Right-to-left layout** (`direction`) for Arabic, Urdu and Hebrew, mirroring bubbles, composer and tables.

Look and feel
- **Motion**: new messages fade in (saved history loads in place), follow-up chips and welcome cards stagger in, the send button springs in when ready, and cards scale on press. Honors Reduce Motion; `animations={false}` turns it off.
- **Icon toolbar** for message actions by default (`actionsStyle="labels"` for text buttons).
- **Floating composer** with a soft shadow and an accent focus glow.
- **Tool cards** shimmer while running, with the status in a tinted badge.
- **Code blocks** get a window-style header with the language and a Copy button.
- **Welcome screen** accent glow and tinted icon tiles.

Also
- Mock transport demo replies include follow-up suggestions.
- README: screenshots gallery; fixed the `send` attachments docs.

Fixes (found testing on iOS and Android)
- iOS: the composer no longer sits partly behind the keyboard. Keyboard space is now measured on both platforms instead of using KeyboardAvoidingView, so `keyboardVerticalOffset` now means the gap between keyboard and composer.
- iOS: the selected 👍/👎 is now clearly highlighted (tinted circle, full-color emoji).
- Editing a message opens the keyboard on the input right away.
- Chats that start with a photo or file get a real title ("📷 Photo", "📄 report.pdf") instead of "New chat".
- The Edit button has a clean screen-reader label.

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
