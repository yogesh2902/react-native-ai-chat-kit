import { useCallback, useEffect, useRef, useState } from 'react';
import { applyChunks, settleReasoning, settleToolCalls } from './applyChunk';
import { toSpeakableText } from './markdown/plainText';
import {
  getMessageText,
  type ChatChunk,
  type ChatMessage,
  type ChatStatus,
  type ChatAttachment,
  type ChatTransport,
  type MessageBranch,
  type MessagePart,
  type MessageVersion,
  type ReplyReference,
} from './types';

export type UseChatOptions = {
  transport: ChatTransport;
  initialMessages?: ChatMessage[];
  /** Called once the assistant finishes (including when stopped). */
  onFinish?: (message: ChatMessage) => void;
  onError?: (error: Error) => void;
  generateId?: () => string;
  /** The model to start with (for the model picker). Sent to the transport with every request. */
  model?: string;
  /**
   * Regenerating a reply keeps the earlier answers, so the user can flip between
   * them (‹ 2/3 ›). Default true. Set false to simply replace the reply.
   */
  keepReplyVersions?: boolean;
  /**
   * Editing a message keeps the original wording and the replies that followed it as a
   * branch, so the user can flip back (‹ 1/2 ›). Default true. Set false to simply replace it.
   */
  keepEditBranches?: boolean;
};

export type SendOptions = {
  attachments?: ChatAttachment[];
  /** Quote an earlier message in this one (quote reply). Pass the message or a ReplyReference. */
  replyTo?: ChatMessage | ReplyReference;
};

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
  /** Get a new answer to the last question. The old one is kept as a version unless `keepReplyVersions` is false. */
  regenerate: () => void;
  /** Show another version of a reply (0-based index into all its versions). */
  selectVersion: (id: string, index: number) => void;
  /** Switch an edited message to another of its wordings, with the conversation that followed it. */
  selectBranch: (id: string, index: number) => void;
  /** The active model (see the `model` option). */
  model: string | undefined;
  /** Switch models. Applies from the next reply. */
  setModel: (model: string) => void;
  /**
   * Answer a tool approval request (Approve / Deny). Once every pending tool in the
   * reply is answered, the reply continues: the transport gets the conversation with
   * the decision on the tool part (`approval: 'approved' | 'denied'`).
   */
  respondToTool: (toolCallId: string, approved: boolean) => void;
};

/** A short quote of a message for `send(text, { replyTo })`. */
export function toReplyReference(message: ChatMessage, maxLength = 280): ReplyReference {
  // Quote what the user saw, not markdown symbols; code blocks become "(code omitted)".
  const raw = getMessageText(message);
  const text = (message.role === 'assistant' ? toSpeakableText(raw) : raw).replace(/\s+/g, ' ').trim();
  const fallback = message.parts.some((p) => p.type === 'image') ? '📷 Photo' : message.parts.find((p) => p.type === 'file') ? '📄 File' : '';
  return {
    id: message.id,
    role: message.role,
    text: text ? (text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text) : fallback,
  };
}

const snapshot = (m: ChatMessage): MessageVersion => ({
  parts: m.parts,
  createdAt: m.createdAt,
  status: m.status,
  error: m.error,
  rating: m.rating,
  suggestions: m.suggestions,
  sources: m.sources,
  model: m.model,
});

/** All versions of a reply in order, the current one included. */
export function allVersions(m: ChatMessage): MessageVersion[] {
  const others = m.versions ?? [];
  const at = Math.min(Math.max(m.versionIndex ?? others.length, 0), others.length);
  return [...others.slice(0, at), snapshot(m), ...others.slice(at)];
}

/** Mark tools still waiting for approval as denied (the user moved on). */
function expirePendingApprovals(list: ChatMessage[]): ChatMessage[] {
  let changed = false;
  const next = list.map((m) => {
    if (!m.parts.some((p) => p.type === 'tool-call' && p.approval === 'pending')) return m;
    changed = true;
    return {
      ...m,
      parts: m.parts.map((p) =>
        p.type === 'tool-call' && p.approval === 'pending' ? { ...p, approval: 'denied' as const, state: 'denied' as const } : p,
      ),
    };
  });
  return changed ? next : list;
}

/** All wordings of an edited message in order, the current one (with `following`) included. */
export function allBranches(m: ChatMessage, following: ChatMessage[]): MessageBranch[] {
  const others = m.branches ?? [];
  const at = Math.min(Math.max(m.branchIndex ?? others.length, 0), others.length);
  const current: MessageBranch = { parts: m.parts, createdAt: m.createdAt, ...(m.replyTo ? { replyTo: m.replyTo } : {}), following };
  return [...others.slice(0, at), current, ...others.slice(at)];
}

const keepsAsVersion = (m: ChatMessage) =>
  (m.status === 'done' || m.status === 'stopped') && m.parts.some((p) => (p.type === 'text' && p.text.trim()) || p.type === 'tool-call');

const defaultId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const scheduleFrame: (cb: () => void) => unknown =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16);

export function useChat(options: UseChatOptions): UseChatResult {
  const [messages, setMessagesState] = useState<ChatMessage[]>(options.initialMessages ?? []);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<Error | undefined>();
  const [model, setModelState] = useState<string | undefined>(options.model);
  const modelRef = useRef(model);

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

  const newAssistant = (id: string): ChatMessage => ({
    id,
    role: 'assistant',
    parts: [],
    createdAt: Date.now(),
    status: 'streaming',
    ...(modelRef.current ? { model: modelRef.current } : {}),
  });

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
        const stream = optionsRef.current.transport({
          messages: history,
          signal: controller.signal,
          ...(modelRef.current ? { model: modelRef.current } : {}),
        });
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
        const settled = settleReasoning(settleToolCalls(m, failure ? 'error' : 'done'));
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

      const quoted = sendOptions?.replyTo;
      const replyTo = quoted ? ('parts' in quoted ? toReplyReference(quoted) : quoted) : undefined;
      const userMessage: ChatMessage = {
        id: makeId(),
        role: 'user',
        parts,
        createdAt: Date.now(),
        status: 'done',
        ...(replyTo ? { replyTo } : {}),
      };
      const assistant = newAssistant(makeId());
      // A new question replaces any approval still waiting for an answer.
      const history = [...expirePendingApprovals(messagesRef.current), userMessage];
      commit([...history, assistant]);
      void run(history, assistant.id);
    },
    [commit, run],
  );

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  // Retry and Regenerate: answer the last question again. A finished reply is
  // kept as a version (‹ 1/2 ›); a failed one is simply replaced.
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
    const previous = list.slice(lastUser + 1).find((m) => m.role === 'assistant');
    let assistant = newAssistant(makeId());
    if (previous && optionsRef.current.keepReplyVersions !== false) {
      const kept = (keepsAsVersion(previous) ? allVersions(previous) : previous.versions ?? []).filter(
        (v) => v.status !== 'streaming',
      );
      if (kept.length) assistant = { ...assistant, id: previous.id, versions: kept, versionIndex: kept.length };
    }
    commit([...history, assistant]);
    void run(history, assistant.id);
  }, [commit, run]);

  const selectVersion = useCallback(
    (id: string, index: number) => {
      if (controllerRef.current) return;
      updateMessage(id, (m) => {
        if (!m.versions?.length) return m;
        const all = allVersions(m);
        const current = m.versionIndex ?? m.versions.length;
        const target = all[index];
        if (!target || index === current) return m;
        const { rating: _r, suggestions: _s, sources: _src, error: _e, model: _m, ...base } = m;
        return {
          ...base,
          ...target,
          versions: all.filter((_, i) => i !== index),
          versionIndex: index,
        };
      });
    },
    [updateMessage],
  );

  const selectBranch = useCallback(
    (id: string, index: number) => {
      if (controllerRef.current) return;
      const list = messagesRef.current;
      const at = list.findIndex((m) => m.id === id);
      const message = list[at];
      if (!message?.branches?.length) return;
      const all = allBranches(message, list.slice(at + 1));
      const current = message.branchIndex ?? message.branches.length;
      const target = all[index];
      if (!target || index === current) return;
      const { replyTo: _r, ...base } = message;
      const switched: ChatMessage = {
        ...base,
        parts: target.parts,
        createdAt: target.createdAt,
        ...(target.replyTo ? { replyTo: target.replyTo } : {}),
        branches: all.filter((_, i) => i !== index),
        branchIndex: index,
      };
      commit([...list.slice(0, at), switched, ...target.following]);
    },
    [commit],
  );

  const respondToTool = useCallback(
    (toolCallId: string, approved: boolean) => {
      if (controllerRef.current) return;
      const list = messagesRef.current;
      const index = list.findIndex((m) => m.parts.some((p) => p.type === 'tool-call' && p.id === toolCallId && p.approval === 'pending'));
      const target = list[index];
      if (!target) return;
      const decided: ChatMessage = {
        ...target,
        parts: target.parts.map((p) =>
          p.type === 'tool-call' && p.id === toolCallId
            ? { ...p, approval: approved ? ('approved' as const) : ('denied' as const), state: approved ? ('running' as const) : ('denied' as const) }
            : p,
        ),
      };
      const stillPending = decided.parts.some((p) => p.type === 'tool-call' && p.approval === 'pending');
      // Continue the same reply once nothing else is waiting, if it's still the latest message.
      if (stillPending || index !== list.length - 1) {
        const next = list.slice();
        next[index] = decided;
        commit(next);
        return;
      }
      const resumed: ChatMessage = { ...decided, status: 'streaming' };
      const history = [...list.slice(0, index), resumed];
      commit(history);
      void run(history, resumed.id);
    },
    [commit, run],
  );

  const setModel = useCallback((next: string) => {
    modelRef.current = next;
    setModelState(next);
  }, []);

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
      const parts: MessagePart[] = trimmed ? [...keptParts, { type: 'text', text: trimmed }] : keptParts;
      const branches = optionsRef.current.keepEditBranches === false ? undefined : allBranches(original, list.slice(index + 1));
      const edited: ChatMessage = branches
        ? // Same message, new wording; the old one and its replies stay as a branch.
          { ...original, parts, createdAt: Date.now(), branches, branchIndex: branches.length }
        : { ...original, id: makeId(), parts, createdAt: Date.now() };
      const history = [...list.slice(0, index), edited];
      const assistant = newAssistant(makeId());
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
    regenerate: retry,
    selectVersion,
    selectBranch,
    model,
    setModel,
    respondToTool,
  };
}
