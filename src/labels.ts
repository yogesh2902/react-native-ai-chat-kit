import { createContext, useContext } from 'react';

/**
 * Every piece of text the kit shows or announces to screen readers.
 * Pass a partial object to `<ChatView labels={…}>` / `<ChatHistory labels={…}>`
 * to translate or reword any of it.
 */
export type ChatLabels = {
  // Composer
  placeholder: string;
  listening: string;
  messageInput: string;
  sendMessage: string;
  stopGenerating: string;
  voiceInput: string;
  stopListening: string;
  addAttachment: string;
  photos: string;
  camera: string;
  files: string;
  attachFrom: (source: string) => string;
  removeAttachment: (name: string) => string;
  maxAttachments: (max: number) => string;
  attachmentsSkipped: (max: number) => string;
  attachFailed: string;
  voiceFailed: string;
  editing: string;
  cancelEdit: string;
  commands: string;
  voiceMode: string;
  speaking: string;
  voicePaused: string;
  tapToTalk: string;
  tapToSend: string;
  tapToInterrupt: string;
  endVoice: string;

  // Chat
  emptyTitle: string;
  scrollToLatest: string;

  // Message actions and states
  copy: string;
  copied: string;
  copyCode: string;
  retry: string;
  listen: string;
  stopSpeaking: string;
  edit: string;
  helpful: string;
  notHelpful: string;
  stopped: string;
  errorFallback: string;
  suggestionsHint: string;
  thinking: string;
  messageOptions: string;
  deleteMessage: string;
  closeMenu: string;
  offline: string;
  offlineQueued: (count: number) => string;
  queued: string;
  reconnecting: string;

  // Screen readers
  youSaid: string;
  assistantSaid: string;
  replyReady: string;
  replyFailed: string;

  // Reasoning, sources, versions
  thoughtFor: (seconds: number) => string;
  showReasoning: string;
  hideReasoning: string;
  sources: (count: number) => string;
  openSource: (title: string) => string;
  previousVersion: string;
  nextVersion: string;
  versionOf: (current: number, total: number) => string;
  previousEdit: string;
  nextEdit: string;
  editOf: (current: number, total: number) => string;
  regenerate: string;
  /** Button under a reply that was cut off (too long, stopped, or the connection dropped). */
  continueGenerating: string;
  /** Shown at the top of a long chat when older messages are hidden. */
  loadEarlier: (count: number) => string;

  // Quote reply
  reply: string;
  replyingTo: (role: 'user' | 'assistant' | 'system') => string;
  cancelReply: string;
  quotedMessage: string;

  // Images
  image: string;
  closeImage: string;
  shareImage: string;
  openImage: (alt: string) => string;

  // Documents
  openDocument: (name: string) => string;
  closeDocument: string;
  openIn: string;
  noPreview: string;

  // Model picker
  chooseModel: string;
  currentModel: (name: string) => string;

  // Tool cards
  toolRunning: string;
  toolDone: string;
  toolFailed: string;
  needsApproval: string;
  approve: string;
  deny: string;
  toolDenied: string;

  // History
  pinned: string;
  pin: string;
  unpin: string;
  rename: string;
  renameChat: string;
  save: string;
  exportChat: string;
  chatActions: (title: string) => string;
  chats: string;
  newChat: string;
  searchChats: string;
  noChats: string;
  noMatches: string;
  clearAllChats: string;
  clearAllConfirm: (count: number) => string;
  deleteAll: string;
  delete: string;
  deleteChat: (title: string) => string;
  cancel: string;
  longPressToDelete: string;
  longPressForActions: string;
  closeHistory: string;
  today: string;
  yesterday: string;
  previous7Days: string;
  previous30Days: string;
  /** Short month names, January first. */
  months: string[];
  /** A date from its parts, e.g. '12 Nov' / '12 Nov 2025' (default) or '11月12日'. `month` comes from `months`. */
  formatDay?: (day: number, month: string, year?: number) => string;
  /** A month heading in chat history, e.g. 'Nov 2025' (default) or '2025年11月'. */
  formatMonth?: (month: string, year?: number) => string;
};

/** Day and month in the order the labels ask for. */
export function formatDayLabel(labels: Pick<ChatLabels, 'formatDay'>, day: number, month: string, year?: number): string {
  if (labels.formatDay) return labels.formatDay(day, month, year);
  return year === undefined ? `${day} ${month}` : `${day} ${month} ${year}`;
}

export function formatMonthLabel(labels: Pick<ChatLabels, 'formatMonth'>, month: string, year?: number): string {
  if (labels.formatMonth) return labels.formatMonth(month, year);
  return year === undefined ? month : `${month} ${year}`;
}

export type ChatLabelsOverrides = Partial<ChatLabels>;

export const defaultLabels: ChatLabels = {
  placeholder: 'Message',
  listening: 'Listening…',
  messageInput: 'Message input',
  sendMessage: 'Send message',
  stopGenerating: 'Stop generating',
  voiceInput: 'Voice input',
  stopListening: 'Stop listening',
  addAttachment: 'Add attachment',
  photos: 'Photos',
  camera: 'Camera',
  files: 'Files',
  attachFrom: (source) => `Attach from ${source}`,
  removeAttachment: (name) => `Remove ${name}`,
  maxAttachments: (max) => `You can attach up to ${max} files.`,
  attachmentsSkipped: (max) => `Only ${max} attachments per message; extra ones were skipped.`,
  attachFailed: 'Could not attach that file.',
  voiceFailed: 'Voice input failed.',
  editing: 'Editing message',
  cancelEdit: 'Cancel',
  commands: 'Commands',
  voiceMode: 'Voice conversation',
  speaking: 'Speaking…',
  voicePaused: 'Paused',
  tapToTalk: 'Tap the circle to talk',
  tapToSend: 'Tap to send now',
  tapToInterrupt: 'Tap to interrupt',
  endVoice: 'End voice conversation',

  emptyTitle: 'How can I help?',
  scrollToLatest: 'Scroll to latest message',

  copy: 'Copy',
  copied: 'Copied ✓',
  copyCode: 'Copy code',
  retry: 'Retry',
  listen: '🔊 Listen',
  stopSpeaking: '■ Stop',
  edit: 'Edit',
  helpful: 'Helpful',
  notHelpful: 'Not helpful',
  stopped: 'Stopped',
  errorFallback: 'Something went wrong.',
  suggestionsHint: 'Suggested follow-ups',
  thinking: 'Thinking…',
  messageOptions: 'Message options',
  deleteMessage: 'Delete message',
  closeMenu: 'Close menu',
  offline: "You're offline. Messages will send when you're back online.",
  offlineQueued: (count) => `You're offline. ${count === 1 ? 'Your message' : `${count} messages`} will send when you're back online.`,
  queued: 'Waiting for connection',
  reconnecting: 'Back online. Retrying…',

  youSaid: 'You said',
  assistantSaid: 'Assistant said',
  replyReady: 'Reply ready',
  replyFailed: 'The reply failed',

  thoughtFor: (seconds) => (seconds < 1 ? 'Thought for a moment' : `Thought for ${seconds}s`),
  showReasoning: 'Show reasoning',
  hideReasoning: 'Hide reasoning',
  sources: (count) => (count === 1 ? '1 source' : `${count} sources`),
  openSource: (title) => `Open ${title}`,
  previousVersion: 'Previous answer',
  nextVersion: 'Next answer',
  versionOf: (current, total) => `Answer ${current} of ${total}`,
  previousEdit: 'Previous version of this message',
  nextEdit: 'Next version of this message',
  editOf: (current, total) => `Message version ${current} of ${total}`,
  regenerate: 'Regenerate',
  continueGenerating: 'Continue',
  loadEarlier: (count) => (count === 1 ? 'Show 1 earlier message' : `Show ${count} earlier messages`),

  reply: 'Reply',
  replyingTo: (role) => (role === 'user' ? 'Replying to your message' : 'Replying to the answer'),
  cancelReply: 'Cancel reply',
  quotedMessage: 'Quoted message. Tap to show it.',

  image: 'Image',
  closeImage: 'Close image',
  shareImage: 'Share image',
  openImage: (alt) => `${alt}. Tap to view full screen`,

  openDocument: (name) => `${name}. Tap to preview`,
  closeDocument: 'Close document',
  openIn: 'Open in…',
  noPreview: "This file can't be previewed here. Use Open in… to view it in another app.",

  chooseModel: 'Choose model',
  currentModel: (name) => `Model: ${name}`,

  toolRunning: 'Working…',
  toolDone: 'Done',
  toolFailed: 'Failed',
  needsApproval: 'Needs your approval',
  approve: 'Approve',
  deny: 'Deny',
  toolDenied: 'Not approved',

  pinned: 'Pinned',
  pin: 'Pin',
  unpin: 'Unpin',
  rename: 'Rename',
  renameChat: 'Rename chat',
  save: 'Save',
  exportChat: 'Export / share',
  chatActions: (title) => `Actions for ${title}`,
  chats: 'Chats',
  newChat: '＋ New chat',
  searchChats: 'Search chats',
  noChats: 'No conversations yet',
  noMatches: 'No matching chats',
  clearAllChats: 'Clear all chats',
  clearAllConfirm: (count) => `${count === 1 ? 'Delete this chat' : `Delete all ${count} chats`}? This can't be undone.`,
  deleteAll: 'Delete all',
  delete: 'Delete',
  deleteChat: (title) => `Delete ${title}`,
  cancel: 'Cancel',
  longPressToDelete: 'Long press to delete',
  longPressForActions: 'Long press for pin, rename, export and delete',
  closeHistory: 'Close history',
  today: 'Today',
  yesterday: 'Yesterday',
  previous7Days: 'Previous 7 days',
  previous30Days: 'Previous 30 days',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export function mergeLabels(overrides?: ChatLabelsOverrides, base: ChatLabels = defaultLabels): ChatLabels {
  if (!overrides) return base;
  const merged = { ...base };
  for (const key of Object.keys(overrides) as (keyof ChatLabels)[]) {
    const value = overrides[key];
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

export const ChatLabelsContext = createContext<ChatLabels>(defaultLabels);
export const useChatLabels = () => useContext(ChatLabelsContext);
