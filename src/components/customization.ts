import type React from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { ChatMessage, ToolCallPart } from '../types';

/** Style overrides for individual pieces of the chat UI. Merged on top of the theme. */
export type ChatStyles = {
  /** The row holding avatar + bubble. */
  messageRow?: StyleProp<ViewStyle>;
  userBubble?: StyleProp<ViewStyle>;
  assistantBubble?: StyleProp<ViewStyle>;
  userText?: StyleProp<TextStyle>;
  /** Wrapper around whatever `renderAvatar` returns. */
  avatar?: StyleProp<ViewStyle>;
  listContent?: StyleProp<ViewStyle>;
  /** Outer composer area (padding, background, border). */
  composer?: StyleProp<ViewStyle>;
  /** The rounded box around the text input and buttons. */
  composerBox?: StyleProp<ViewStyle>;
  input?: StyleProp<TextStyle>;
  suggestionChip?: StyleProp<ViewStyle>;
  suggestionText?: StyleProp<TextStyle>;
};

export type MessageRenderers = {
  /** Shown beside each message. Return null to hide it for some messages. */
  renderAvatar?: (message: ChatMessage) => React.ReactNode;
  /**
   * Render a tool call your own way (e.g. a flight card from `part.result`).
   * Return `undefined` to fall back to the default card for that tool.
   */
  renderToolCall?: (part: ToolCallPart, message: ChatMessage) => React.ReactNode | undefined;
  /** Replaces the three animated dots shown while waiting for the first token. */
  renderTypingIndicator?: () => React.ReactNode;
};

export type SendButtonRenderProps = { onPress: () => void; disabled: boolean };
export type StopButtonRenderProps = { onPress: () => void };

/** Callbacks a speech recognizer reports to while the user talks. */
export type SpeechRecognizerCallbacks = {
  /** Live transcript while the user is still speaking. */
  onPartial: (text: string) => void;
  /** Final transcript. */
  onFinal: (text: string) => void;
  onError: (error: Error) => void;
  /** Listening stopped (after final, error, or stop()). */
  onEnd: () => void;
};

/** Speech-to-text for the mic button. See createExpoSpeechRecognizer / createWebSpeechRecognizer. */
export type SpeechRecognizer = {
  start: (callbacks: SpeechRecognizerCallbacks) => void | Promise<void>;
  /** Stop listening and deliver the final transcript. */
  stop: () => void | Promise<void>;
  /** Stop without a result. */
  abort?: () => void;
};

/** Text-to-speech for the "Listen" button on replies. See createExpoSpeech. */
export type TextToSpeech = {
  speak: (text: string, callbacks: { onDone: () => void }) => void;
  stop: () => void;
};

/** Functions that open pickers and return ready-to-send attachments. See createExpoAttachmentPickers. */
export type AttachmentPickers = {
  pickImages?: () => Promise<import('../types').ChatAttachment[]>;
  takePhoto?: () => Promise<import('../types').ChatAttachment[]>;
  pickDocuments?: () => Promise<import('../types').ChatAttachment[]>;
};

/** Overall look of the conversation. */
export type ChatLayout =
  /** Answers full-width without a bubble (default). */
  | 'minimal'
  /** Both sides in bubbles, user in the accent color. */
  | 'bubbles'
  /** Tighter spacing and smaller text for dense screens. */
  | 'compact';

/** An extra action on a message: shown in the long-press menu, and optionally as a button. */
export type MessageAction = {
  key: string;
  label: string;
  /** Emoji or short text shown before the label. */
  icon?: string;
  onPress: (message: import('../types').ChatMessage) => void;
  /** Also show it as a button under assistant replies. */
  inline?: boolean;
  /** Red text, for things like Report. */
  destructive?: boolean;
};

export type WelcomeCard = {
  title: string;
  description?: string;
  /** Emoji or a small element. */
  icon?: React.ReactNode;
  /** What gets sent when tapped. Defaults to `title`. */
  prompt?: string;
};

/** A richer empty state than plain suggestion chips. */
export type WelcomeConfig = {
  logo?: React.ReactNode;
  title?: string;
  subtitle?: string;
  cards?: WelcomeCard[];
  /** Default 'grid' (two columns). */
  cardLayout?: 'grid' | 'list';
};

export type TypingIndicatorStyle = 'dots' | 'pulse' | 'text';

/** Tells the chat whether the device is online. See createNetInfoMonitor / createWebNetworkMonitor. */
export type NetworkMonitor = {
  /** Call `onChange` whenever connectivity changes; return an unsubscribe function. */
  subscribe: (onChange: (online: boolean) => void) => () => void;
  /** Current state, if known synchronously. */
  isOnline?: () => boolean | undefined;
};
