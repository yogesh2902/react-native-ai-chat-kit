import { useCallback, useEffect, useRef, useState } from 'react';
import { applyChunks, settleToolCalls } from './applyChunk';
import type {
  ChatChunk,
  ChatMessage,
  ChatStatus,
  ChatAttachment,
  ChatTransport,
  MessagePart,
} from './types';

export type UseChatOptions = {
  transport: ChatTransport;
  initialMessages?: ChatMessage[];
  /** Called once the assistant finishes (including when stopped). */
  onFinish?: (message: ChatMessage) => void;
  onError?: (error: Error) => void;
  generateId?: () => string;
};

export type SendOptions = { attachments?: ChatAttachment[] };

export type UseChatResult = {
  messages: ChatMessage[];
  status: ChatStatus;
  error: Error | undefined;
  isStreaming: boolean;
  send: (text: string, options?: SendOptions) => void;
  stop: () => void;
  retry: () => void;
  clear: () => void;
  setMessages: (messages: ChatMessage[]) => void;
  /** Save a thumbs up/down on an assistant reply (`null` clears it). Kept with the message, so chat history keeps it too. */
  rateMessage: (id: string, rating: 'up' | 'down' | null) => void;
  /**
   * Replace a user message with new text and get a fresh reply. Everything
   * after that message is dropped (like editing in ChatGPT); its attachments are kept.
   */
  editMessage: (id: string, text: string) => void;
  /** Remove one message. Deleting the reply that is streaming stops it first. */
  deleteMessage: (id: string) => void;
};

const defaultId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const scheduleFrame: (cb: () => void) => unknown =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16);

export function useChat(options: UseChatOptions): UseChatResult {
  const [messages, setMessagesState] = useState<ChatMessage[]>(options.initialMessages ?? []);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<Error | undefined>();

  // The ref is the source of truth so async stream code never sees stale state.
  const messagesRef = useRef(messages);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<ChatChunk[]>([]);
  // Which assistant message pending chunks belong to. A frame scheduled by a
  // previous reply may fire late, so flush must never use a captured id.
  const pendingTargetRef = useRef<string | null>(null);
  const frameScheduledRef = useRef(false);
  const mountedRef = useRef(true);

  const commit = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    if (mountedRef.current) setMessagesState(next);
  }, []);

  const updateMessage = useCallback(
    (id: string, fn: (m: ChatMessage) => ChatMessage) => {
      const list = messagesRef.current;
      const index = list.findIndex((m) => m.id === id);
      const current = list[index];
      if (!current) return;
      const updated = fn(current);
      if (updated === current) return;
      const next = list.slice();
      next[index] = updated;
      commit(next);
    },
    [commit],
  );

  const flush = useCallback(() => {
    frameScheduledRef.current = false;
    const chunks = pendingRef.current;
    const target = pendingTargetRef.current;
    if (chunks.length === 0 || !target) return;
    pendingRef.current = [];
    updateMessage(target, (m) => applyChunks(m, chunks));
  }, [updateMessage]);

  const run = useCallback(
    async (history: ChatMessage[], assistantId: string) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setStatus('streaming');
      setError(undefined);
      pendingRef.current = [];
      pendingTargetRef.current = assistantId;

      let failure: Error | undefined;
      try {
        const stream = optionsRef.current.transport({ messages: history, signal: controller.signal });
        for await (const chunk of stream) {
          if (controller.signal.aborted) break;
          if (chunk.type === 'error') {
            failure = new Error(chunk.message);
            break;
          }
          pendingRef.current.push(chunk);
          // Batch token updates to one render per frame instead of one per token.
          if (!frameScheduledRef.current) {
            frameScheduledRef.current = true;
            scheduleFrame(flush);
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) failure = e instanceof Error ? e : new Error(String(e));
      }

      if (pendingTargetRef.current === assistantId) flush();
      const stopped = controller.signal.aborted && !failure;
      updateMessage(assistantId, (m) => {
        const settled = settleToolCalls(m, failure ? 'error' : 'done');
        return failure
          ? { ...settled, status: 'error', error: failure.message }
          : { ...settled, status: stopped ? 'stopped' : 'done' };
      });

      if (controllerRef.current === controller) controllerRef.current = null;
      if (!mountedRef.current) return;
      setStatus(failure ? 'error' : 'idle');
      setError(failure);
      if (failure) optionsRef.current.onError?.(failure);
      const finished = messagesRef.current.find((m) => m.id === assistantId);
      if (finished && !failure) optionsRef.current.onFinish?.(finished);
    },
    [flush, updateMessage],
  );

  const send = useCallback(
    (text: string, sendOptions?: SendOptions) => {
      const trimmed = text.trim();
      const attachments = sendOptions?.attachments ?? [];
      if (!trimmed && attachments.length === 0) return;
      if (controllerRef.current) return; // one response at a time

      const makeId = optionsRef.current.generateId ?? defaultId;
      const parts: MessagePart[] = attachments.map((a): MessagePart =>
        a.kind === 'image'
          ? { type: 'image', uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType, base64: a.base64, name: a.name }
          : { type: 'file', name: a.name, mimeType: a.mimeType, size: a.size, uri: a.uri, base64: a.base64, text: a.text },
      );
      if (trimmed) parts.push({ type: 'text', text: trimmed });

      const userMessage: ChatMessage = { id: makeId(), role: 'user', parts, createdAt: Date.now(), status: 'done' };
      const assistant: ChatMessage = { id: makeId(), role: 'assistant', parts: [], createdAt: Date.now(), status: 'streaming' };
      const history = [...messagesRef.current, userMessage];
      commit([...history, assistant]);
      void run(history, assistant.id);
    },
    [commit, run],
  );

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  const retry = useCallback(() => {
    if (controllerRef.current) return;
    const list = messagesRef.current;
    let lastUser = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.role === 'user') {
        lastUser = i;
        break;
      }
    }
    if (lastUser === -1) return;
    const makeId = optionsRef.current.generateId ?? defaultId;
    const history = list.slice(0, lastUser + 1);
    const assistant: ChatMessage = { id: makeId(), role: 'assistant', parts: [], createdAt: Date.now(), status: 'streaming' };
    commit([...history, assistant]);
    void run(history, assistant.id);
  }, [commit, run]);

  const rateMessage = useCallback(
    (id: string, rating: 'up' | 'down' | null) => {
      updateMessage(id, (m) => {
        if (m.role !== 'assistant') return m;
        if (rating === null) {
          if (m.rating === undefined) return m;
          const { rating: _old, ...rest } = m;
          return rest;
        }
        return m.rating === rating ? m : { ...m, rating };
      });
    },
    [updateMessage],
  );

  const editMessage = useCallback(
    (id: string, text: string) => {
      const trimmed = text.trim();
      if (controllerRef.current) return; // wait for the current reply to finish or be stopped
      const list = messagesRef.current;
      const index = list.findIndex((m) => m.id === id);
      const original = list[index];
      if (!original || original.role !== 'user') return;
      const keptParts = original.parts.filter((p) => p.type !== 'text');
      if (!trimmed && keptParts.length === 0) return;

      const makeId = optionsRef.current.generateId ?? defaultId;
      const edited: ChatMessage = {
        ...original,
        id: makeId(),
        parts: trimmed ? [...keptParts, { type: 'text', text: trimmed }] : keptParts,
        createdAt: Date.now(),
      };
      const history = [...list.slice(0, index), edited];
      const assistant: ChatMessage = { id: makeId(), role: 'assistant', parts: [], createdAt: Date.now(), status: 'streaming' };
      commit([...history, assistant]);
      void run(history, assistant.id);
    },
    [commit, run],
  );

  const deleteMessage = useCallback(
    (id: string) => {
      const list = messagesRef.current;
      const target = list.find((m) => m.id === id);
      if (!target) return;
      if (target.status === 'streaming') controllerRef.current?.abort();
      commit(list.filter((m) => m.id !== id));
    },
    [commit],
  );

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    commit([]);
    setError(undefined);
    setStatus('idle');
  }, [commit]);

  const setMessages = useCallback((next: ChatMessage[]) => commit(next), [commit]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  return {
    messages,
    status,
    error,
    isStreaming: status === 'streaming',
    send,
    stop,
    retry,
    clear,
    rateMessage,
    editMessage,
    deleteMessage,
    setMessages,
  };
}
