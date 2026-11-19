// Hook
export { useChat, toReplyReference, allVersions, allBranches } from './useChat';
export type { UseChatOptions, UseChatResult, SendOptions } from './useChat';

// Conversation history
export { useChatSessions } from './sessions/useChatSessions';
export type { UseChatSessionsOptions, UseChatSessionsResult } from './sessions/useChatSessions';
export { createKeyValueStore, createMemoryStore, deriveTitle, derivePreview } from './sessions/store';
export type { ChatStore, ChatSession, ChatSessionMeta, KeyValueStorage } from './sessions/store';
export { groupSessionsByDate, formatSessionTime, filterSessions } from './sessions/groupSessions';
export { exportChat, messagesContain } from './sessions/export';
export type { ExportOptions } from './sessions/export';
export type { SessionGroup } from './sessions/groupSessions';

// Components
export { ChatHistory } from './components/ChatHistory';
export type { ChatHistoryProps, ChatHistoryItemRenderProps } from './components/ChatHistory';
export type {
  AttachmentPickers,
  ChatFeedbackEvent,
  ChatFeedbackHandler,
  ChatLayout,
  ChatStyles,
  MessageAction,
  NetworkMonitor,
  TypingIndicatorStyle,
  WelcomeCard,
  WelcomeConfig,
  MessageRenderers,
  SendButtonRenderProps,
  SpeechRecognizer,
  SpeechRecognizerCallbacks,
  StopButtonRenderProps,
  TextToSpeech,
} from './components/customization';

// Adapters: attachments (image optimization) and voice
export {
  createExpoAttachmentPickers,
  createExpoSpeech,
  createExpoSpeechRecognizer,
  createExpoHaptics,
  createExpoSounds,
  defaultChatSounds,
  optimizeImage,
  base64ToUtf8,
} from './adapters/expo';
export type { ExpoAttachmentPickersOptions, ImageOptimizationOptions, HapticPattern, SoundSource } from './adapters/expo';
export { createWebSpeechRecognizer, isWebSpeechRecognitionAvailable } from './adapters/web';
export { toSpeakableText } from './markdown/plainText';
export { ChatThemeProvider, useResolvedTheme, presetTheme } from './components/ChatThemeProvider';
export { WelcomeScreen } from './components/WelcomeScreen';
export { ReasoningBlock } from './components/ReasoningBlock';
export type { ReasoningBlockProps } from './components/ReasoningBlock';
export { SourceList, sourceDomain } from './components/SourceList';
export type { SourceListProps } from './components/SourceList';
export { ModelPicker } from './components/ModelPicker';
export { ImageViewer } from './components/ImageViewer';
export type { ImageViewerProps } from './components/ImageViewer';
export type { ModelPickerProps, ChatModelOption } from './components/ModelPicker';
export { MessageMenu } from './components/MessageMenu';
export type { MessageMenuItem } from './components/MessageMenu';
export { buildListItems, formatMessageTime, formatDateSeparator } from './components/chatListItems';
export type { ChatListItem } from './components/chatListItems';
export { createNetInfoMonitor, createWebNetworkMonitor, isNetworkError } from './adapters/network';
export type { ThemeProps } from './components/ChatThemeProvider';
export { ChatView } from './components/ChatView';
export type { ChatViewProps } from './components/ChatView';
export { MessageBubble } from './components/MessageBubble';
export type { MessageBubbleProps } from './components/MessageBubble';
export { Composer } from './components/Composer';
export type { ComposerProps } from './components/Composer';
export { ToolCallCard, humanizeToolName } from './components/ToolCallCard';
export type { ToolCallCardProps } from './components/ToolCallCard';
export { TypingIndicator } from './components/TypingIndicator';
export type { TypingIndicatorProps } from './components/TypingIndicator';
export { StreamingMarkdown, CodeBlockOptionsContext, MarkdownFeaturesContext, lightCodeColors } from './markdown/StreamingMarkdown';
export type { StreamingMarkdownProps, CodeBlockOptions, MathOptions, MarkdownFeatures } from './markdown/StreamingMarkdown';
export { texToUnicode } from './markdown/math';

// Transports
export { createStreamTransport, toSimpleMessages } from './transports/stream';
export type { StreamTransportOptions, SimpleMessage, SimpleAttachment } from './transports/stream';
export { createMockTransport, tokenize } from './transports/mock';
export { createProviderTransport } from './transports/provider';
export type { ProviderTransportOptions } from './transports/provider';
export { buildProviderRequest, PROVIDERS } from './providers';
export type { ProviderConfig, ProviderName, ProviderMessage } from './providers';
export type { MockStep, MockTransportOptions } from './transports/mock';
export { parseAuto, parseNative, parseOpenAI, parseAnthropic, parseAISDK, parseGemini, createSSEDecoder } from './transports/parsers';
export type { StreamParser, SSEEvent } from './transports/parsers';

// Markdown internals (useful for custom renderers)
export { parseBlocks, parseInline } from './markdown/parse';
export type { Block, InlineNode, MarkdownOptions } from './markdown/parse';
export { highlight } from './markdown/highlight';
export type { Token, TokenKind } from './markdown/highlight';

// Labels (translations)
export { defaultLabels, mergeLabels, useChatLabels, ChatLabelsContext } from './labels';
export type { ChatLabels, ChatLabelsOverrides } from './labels';

// Theme
export { lightTheme, darkTheme, mergeTheme, useChatTheme, ChatThemeContext, fontStyle, applyPalette, PALETTE_NAMES, withAlpha } from './theme';
export type { ChatTheme, ChatThemeOverrides, ChatPalette } from './theme';

// Types & utils
export { applyChunk, applyChunks, settleReasoning } from './applyChunk';
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
  ReasoningPart,
  ChatSource,
  MessageVersion,
  MessageBranch,
  ReplyReference,
  ToolCallState,
  ToolCallPart,
  ImagePart,
  FilePart,
  ChatAttachment,
  TransportRequest,
} from './types';
