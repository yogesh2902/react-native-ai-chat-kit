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
  refreshSessions: () => Promise<void>;
};

const defaultSessionId = () => `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A message still marked as streaming when saved was interrupted; store it as stopped. */
function normalize(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' } : m));
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
    const normalized = normalize(messages);
    const session: ChatSession = {
      id: active.id,
      title: active.title ?? deriveTitle(normalized),
      createdAt: active.createdAt,
      updatedAt: Date.now(),
      preview: derivePreview(normalized),
      messageCount: normalized.filter((m) => m.role !== 'system').length,
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

  // Load the history list on mount (and optionally reopen the latest chat).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
    refreshSessions,
  };
}
