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
