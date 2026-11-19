export type ChatRole = 'user' | 'assistant' | 'system';

export type ToolCallState = 'running' | 'done' | 'error';

export type TextPart = { type: 'text'; text: string };

export type ToolCallPart = {
  type: 'tool-call';
  id: string;
  name: string;
  /** Human-friendly label shown on the card, e.g. "Searching flights…" */
  label?: string;
  args?: unknown;
  state: ToolCallState;
  result?: unknown;
  error?: string;
};

export type ImagePart = {
  type: 'image';
  uri: string;
  width?: number;
  height?: number;
  mimeType?: string;
  /** Image data sent to the model (already optimized). */
  base64?: string;
  name?: string;
};

export type FilePart = {
  type: 'file';
  name: string;
  mimeType: string;
  size?: number;
  uri?: string;
  /** For PDFs: data sent to the model. */
  base64?: string;
  /** For text documents (txt, md, csv, json…): the contents, inlined into the prompt. */
  text?: string;
};

/** The model's reasoning ("thinking") before or between its answer. Shown collapsed above the reply. */
export type ReasoningPart = {
  type: 'reasoning';
  text: string;
  /** When the reasoning started arriving (ms since epoch). */
  startedAt?: number;
  /** How long the model thought, set once the answer starts. */
  durationMs?: number;
};

export type MessagePart = TextPart | ReasoningPart | ToolCallPart | ImagePart | FilePart;

/** A web page or document the reply is based on (web search, RAG, citations). */
export type ChatSource = {
  /** Where it opens. Sources without a URL show as plain chips. */
  url?: string;
  title?: string;
  /** A short quote from the source. */
  snippet?: string;
  id?: string;
};

/** An earlier answer kept when a reply is regenerated. */
export type MessageVersion = {
  parts: MessagePart[];
  createdAt: number;
  status?: MessageStatus;
  error?: string;
  rating?: 'up' | 'down';
  suggestions?: string[];
  sources?: ChatSource[];
  model?: string;
};

/** The message a user is replying to (quote reply). */
export type ReplyReference = {
  id: string;
  role: ChatRole;
  /** The quoted text, shortened. */
  text: string;
};

/** An image or document picked in the composer, ready to send. */
export type ChatAttachment = {
  id: string;
  kind: 'image' | 'file';
  uri: string;
  name: string;
  mimeType: string;
  /** Bytes after optimization. */
  size?: number;
  /** Bytes before optimization (images). */
  originalSize?: number;
  width?: number;
  height?: number;
  base64?: string;
  text?: string;
};

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  parts: MessagePart[];
  createdAt: number;
  status?: MessageStatus;
  error?: string;
  /** The user's thumbs up/down on an assistant reply. */
  rating?: 'up' | 'down';
  /** Follow-up prompts offered under an assistant reply. */
  suggestions?: string[];
  /** Pages or documents the reply cites. */
  sources?: ChatSource[];
  /** Other answers to the same question (from Regenerate). The current one lives in the message itself. */
  versions?: MessageVersion[];
  /** Position of the current answer among all versions (0-based). Total = versions.length + 1. */
  versionIndex?: number;
  /** User messages: the message being quoted. */
  replyTo?: ReplyReference;
  /** Assistant messages: the model that wrote the reply. */
  model?: string;
};

/**
 * A single event emitted by a transport while the assistant is responding.
 * Transports adapt any provider (OpenAI, Anthropic, your backend…) into these.
 */
export type ChatChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call-start'; id: string; name: string; label?: string; args?: unknown }
  | { type: 'tool-call-end'; id: string; result?: unknown; error?: string }
  /** Follow-up prompts to show as chips under the reply. */
  | { type: 'suggestions'; suggestions: string[] }
  /** Reasoning / thinking text, shown in a collapsible block above the answer. */
  | { type: 'reasoning-delta'; text: string }
  /** A source the answer cites. Duplicate URLs are ignored. */
  | { type: 'source'; source: ChatSource }
  | { type: 'error'; message: string };

export type TransportRequest = {
  /** Full conversation so far, including the new user message. */
  messages: ChatMessage[];
  /** Aborted when the user taps Stop or the component unmounts. */
  signal: AbortSignal;
  /** The model picked in the model picker (`useChat({ model })`), if any. */
  model?: string;
};

/** A transport turns a conversation into a stream of chunks. */
export type ChatTransport = (request: TransportRequest) => AsyncIterable<ChatChunk>;

export type ChatStatus = 'idle' | 'streaming' | 'error';

/** Concatenate all text parts of a message. */
export function getMessageText(message: ChatMessage): string {
  let out = '';
  for (const part of message.parts) if (part.type === 'text') out += part.text;
  return out;
}
