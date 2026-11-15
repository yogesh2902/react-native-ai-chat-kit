// Hook
export { useChat } from './useChat';
export type { UseChatOptions, UseChatResult, SendOptions } from './useChat';

// Conversation history
export { useChatSessions } from './sessions/useChatSessions';
export type { UseChatSessionsOptions, UseChatSessionsResult } from './sessions/useChatSessions';
export { createKeyValueStore, createMemoryStore, deriveTitle, derivePreview } from './sessions/store';
export type { ChatStore, ChatSession, ChatSessionMeta, KeyValueStorage } from './sessions/store';
export { groupSessionsByDate, formatSessionTime, filterSessions } from './sessions/groupSessions';
export type { SessionGroup } from './sessions/groupSessions';

// Components
export { ChatHistory } from './components/ChatHistory';
export type { ChatHistoryProps, ChatHistoryItemRenderProps } from './components/ChatHistory';
export type { ChatStyles, MessageRenderers, SendButtonRenderProps, StopButtonRenderProps } from './components/customization';
export { ChatThemeProvider, useResolvedTheme } from './components/ChatThemeProvider';
export type { ThemeProps } from './components/ChatThemeProvider';
export { ChatView } from './components/ChatView';
export type { ChatViewProps } from './components/ChatView';
export { MessageBubble } from './components/MessageBubble';
export type { MessageBubbleProps } from './components/MessageBubble';
export { Composer } from './components/Composer';
export type { ComposerProps } from './components/Composer';
export { ToolCallCard, humanizeToolName } from './components/ToolCallCard';
export { TypingIndicator } from './components/TypingIndicator';
export { StreamingMarkdown } from './markdown/StreamingMarkdown';
export type { StreamingMarkdownProps } from './markdown/StreamingMarkdown';

// Transports
export { createStreamTransport, toSimpleMessages } from './transports/stream';
export type { StreamTransportOptions, SimpleMessage } from './transports/stream';
export { createMockTransport, tokenize } from './transports/mock';
export type { MockStep, MockTransportOptions } from './transports/mock';
export { parseAuto, parseNative, parseOpenAI, parseAnthropic, parseAISDK, createSSEDecoder } from './transports/parsers';
export type { StreamParser, SSEEvent } from './transports/parsers';

// Markdown internals (useful for custom renderers)
export { parseBlocks, parseInline } from './markdown/parse';
export type { Block, InlineNode } from './markdown/parse';
export { highlight } from './markdown/highlight';

// Theme
export { lightTheme, darkTheme, mergeTheme, useChatTheme, ChatThemeContext, fontStyle } from './theme';
export type { ChatTheme, ChatThemeOverrides } from './theme';

// Types & utils
export { applyChunk, applyChunks } from './applyChunk';
export { getMessageText } from './types';
export type {
  ChatMessage,
  ChatChunk,
  ChatRole,
  ChatStatus,
  ChatTransport,
  MessagePart,
  MessageStatus,
  TextPart,
  ToolCallPart,
  ImagePart,
  TransportRequest,
} from './types';
