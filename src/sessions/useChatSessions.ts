import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat, type UseChatOptions, type UseChatResult } from '../useChat';
import type { ChatMessage } from '../types';
import { derivePreview, deriveTitle, toMeta, type ChatSession, type ChatSessionMeta, type ChatStore } from './store';

export type UseChatSessionsOptions = UseChatOptions & {
  store: ChatStore;
  /** Open the most recent conversation on mount instead of starting a new one. */
  restoreLastSession?: boolean;
  /** How often to save while a reply is streaming, in ms. Default 1500. */
  streamingSaveIntervalMs?: number;
  generateSessionId?: () => string;
  /**
   * Save image/PDF data with each chat so reopened chats can still discuss them.
   * Default true. Set false to keep storage small (old attachments then show
   * as "no longer available" to the model).
   */
  persistAttachmentData?: boolean;
  /** Automatically delete chats not updated in this many days (checked on mount). */
  maxAgeDays?: number;
};

export type UseChatSessionsResult = UseChatResult & {
  /** All saved conversations, newest first. */
  sessions: ChatSessionMeta[];
  /** `null` while on a brand-new chat that has no messages yet. */
  activeSessionId: string | null;
  isLoadingSessions: boolean;
  /** Start a fresh conversation. The current one is saved first. */
  newSession: () => void;
  /** Reopen a saved conversation. New replies continue with its full context. */
  openSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  /** Delete every saved chat and start a new one. */
  clearSessions: () => Promise<void>;
  /** Delete chats not updated in `days` days. Returns how many were deleted. */
  deleteSessionsOlderThan: (days: number) => Promise<number>;
  refreshSessions: () => Promise<void>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const defaultSessionId = () => `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A message still marked as streaming when saved was interrupted; store it as stopped. */
function normalize(messages: ChatMessage[], keepAttachmentData: boolean): ChatMessage[] {
  return messages.map((m) => {
    let next = m.status === 'streaming' ? { ...m, status: 'stopped' as const } : m;
    if (!keepAttachmentData && next.parts.some((p) => (p.type === 'image' || p.type === 'file') && p.base64)) {
      next = { ...next, parts: next.parts.map((p) => ((p.type === 'image' || p.type === 'file') && p.base64 ? { ...p, base64: undefined } : p)) };
    }
    return next;
  });
}

/**
 * `useChat` plus conversation history: every chat is saved to `store`
 * automatically, and any past chat can be reopened and continued.
 */
export function useChatSessions(options: UseChatSessionsOptions): UseChatSessionsResult {
  const { store, restoreLastSession = false, streamingSaveIntervalMs = 1500 } = options;
  const chat = useChat(options);

  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const chatRef = useRef(chat);
  chatRef.current = chat;
  const storeRef = useRef(store);
  storeRef.current = store;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const activeRef = useRef<{ id: string; createdAt: number; title?: string } | null>(null);
  const lastSavedRef = useRef<ChatMessage[]>(chat.messages);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedModelRef = useRef(chat.model);

  const upsertMeta = useCallback((meta: ChatSessionMeta) => {
    setSessions((prev) => [meta, ...prev.filter((s) => s.id !== meta.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  /** Save the current conversation now (no-op if nothing changed). */
  const flushSave = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const messages = chatRef.current.messages;
    if (messages.length === 0 || messages === lastSavedRef.current) return;
    lastSavedRef.current = messages;

    if (!activeRef.current) {
      const id = (optionsRef.current.generateSessionId ?? defaultSessionId)();
      activeRef.current = { id, createdAt: messages[0]?.createdAt ?? Date.now() };
      setActiveSessionId(id);
    }
    const active = activeRef.current;
    const normalized = normalize(messages, optionsRef.current.persistAttachmentData ?? true);
    const session: ChatSession = {
      id: active.id,
      title: active.title ?? deriveTitle(normalized),
      createdAt: active.createdAt,
      updatedAt: Date.now(),
      preview: derivePreview(normalized),
      messageCount: normalized.filter((m) => m.role !== 'system').length,
      ...(chatRef.current.model ? { model: chatRef.current.model } : {}),
      messages: normalized,
    };
    upsertMeta(toMeta(session));
    try {
      await storeRef.current.save(session);
    } catch (e) {
      optionsRef.current.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }, [upsertMeta]);

  // Auto-save: immediately when idle, throttled while tokens stream in.
  useEffect(() => {
    if (chat.messages.length === 0 || chat.messages === lastSavedRef.current) return;
    if (!chat.isStreaming) {
      void flushSave();
    } else if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushSave();
      }, streamingSaveIntervalMs);
    }
  }, [chat.messages, chat.isStreaming, flushSave, streamingSaveIntervalMs]);

  // Picking another model in an open chat saves that choice with it.
  useEffect(() => {
    if (savedModelRef.current === chat.model) return;
    savedModelRef.current = chat.model;
    if (!activeRef.current || chat.isStreaming || chatRef.current.messages.length === 0) return;
    lastSavedRef.current = [];
    void flushSave();
  }, [chat.model, chat.isStreaming, flushSave]);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await storeRef.current.list());
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const switchTo = useCallback((session: ChatSession | null) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    activeRef.current = session ? { id: session.id, createdAt: session.createdAt, title: session.title } : null;
    setActiveSessionId(session?.id ?? null);
    const messages = session?.messages ?? [];
    lastSavedRef.current = messages;
    chatRef.current.setMessages(messages);
    // A reopened chat continues with the model it used; a new chat keeps the current pick.
    if (session?.model && session.model !== chatRef.current.model) {
      savedModelRef.current = session.model; // restoring, not a change to save
      chatRef.current.setModel(session.model);
    }
  }, []);

  const newSession = useCallback(() => {
    chatRef.current.stop();
    void flushSave();
    switchTo(null);
  }, [flushSave, switchTo]);

  const openSession = useCallback(
    async (id: string) => {
      if (activeRef.current?.id === id) return;
      chatRef.current.stop();
      await flushSave();
      const session = await storeRef.current.load(id);
      if (!session) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        return;
      }
      switchTo(session);
    },
    [flushSave, switchTo],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      if (activeRef.current?.id === id) {
        chatRef.current.stop();
        switchTo(null);
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
      await storeRef.current.remove(id);
    },
    [switchTo],
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      if (activeRef.current?.id === id) activeRef.current.title = clean;
      const session = await storeRef.current.load(id);
      if (!session) return;
      const updated = { ...session, title: clean };
      upsertMeta(toMeta(updated));
      await storeRef.current.save(updated);
    },
    [upsertMeta],
  );

  const deleteSessionsOlderThan = useCallback(
    async (days: number) => {
      const cutoff = Date.now() - days * DAY_MS;
      const old = (await storeRef.current.list()).filter((s) => s.updatedAt < cutoff);
      if (old.length === 0) return 0;
      const ids = new Set(old.map((s) => s.id));
      if (activeRef.current && ids.has(activeRef.current.id)) {
        chatRef.current.stop();
        switchTo(null);
      }
      setSessions((prev) => prev.filter((s) => !ids.has(s.id)));
      for (const id of ids) await storeRef.current.remove(id);
      return ids.size;
    },
    [switchTo],
  );

  const clearSessions = useCallback(async () => {
    chatRef.current.stop();
    switchTo(null);
    setSessions([]);
    const store = storeRef.current;
    if (store.clear) await store.clear();
    else for (const s of await store.list()) await store.remove(s.id);
  }, [switchTo]);

  // Load the history list on mount (and optionally reopen the latest chat).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maxAgeDays = optionsRef.current.maxAgeDays;
        if (maxAgeDays !== undefined && maxAgeDays > 0) {
          const cutoff = Date.now() - maxAgeDays * DAY_MS;
          for (const s of await storeRef.current.list()) if (s.updatedAt < cutoff) await storeRef.current.remove(s.id);
        }
        const list = await storeRef.current.list();
        if (cancelled) return;
        setSessions(list);
        const latest = list[0];
        if (restoreLastSession && latest && !activeRef.current && chatRef.current.messages.length === 0) {
          const session = await storeRef.current.load(latest.id);
          if (!cancelled && session && !activeRef.current) switchTo(session);
        }
      } catch (e) {
        optionsRef.current.onError?.(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setIsLoadingSessions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on unmount so nothing typed is lost.
  useEffect(() => () => void flushSave(), [flushSave]);

  return {
    ...chat,
    // `clear` on a sessions chat means "start a new chat", not "wipe history".
    clear: newSession,
    sessions,
    activeSessionId,
    isLoadingSessions,
    newSession,
    openSession,
    deleteSession,
    renameSession,
    clearSessions,
    deleteSessionsOlderThan,
    refreshSessions,
  };
}
