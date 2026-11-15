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

export type ImagePart = { type: 'image'; uri: string; width?: number; height?: number };

export type MessagePart = TextPart | ToolCallPart | ImagePart;

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  parts: MessagePart[];
  createdAt: number;
  status?: MessageStatus;
  error?: string;
};

/**
 * A single event emitted by a transport while the assistant is responding.
 * Transports adapt any provider (OpenAI, Anthropic, your backend…) into these.
 */
export type ChatChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call-start'; id: string; name: string; label?: string; args?: unknown }
  | { type: 'tool-call-end'; id: string; result?: unknown; error?: string }
  | { type: 'error'; message: string };

export type TransportRequest = {
  /** Full conversation so far, including the new user message. */
  messages: ChatMessage[];
  /** Aborted when the user taps Stop or the component unmounts. */
  signal: AbortSignal;
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
