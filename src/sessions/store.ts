import { getMessageText, type ChatMessage } from '../types';

/** Lightweight info shown in the history list (no message bodies). */
export type ChatSessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Last message text, truncated. */
  preview: string;
  messageCount: number;
};

export type ChatSession = ChatSessionMeta & { messages: ChatMessage[] };

/** Where conversations are saved. Implement this for SQLite, MMKV, your server… */
export type ChatStore = {
  /** All sessions, newest first. */
  list(): Promise<ChatSessionMeta[]>;
  load(id: string): Promise<ChatSession | null>;
  save(session: ChatSession): Promise<void>;
  remove(id: string): Promise<void>;
  /** Optional: delete everything. */
  clear?(): Promise<void>;
};

/** Anything shaped like AsyncStorage: @react-native-async-storage/async-storage, MMKV adapters, localStorage wrappers. */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
};

const sortNewest = (a: ChatSessionMeta, b: ChatSessionMeta) => b.updatedAt - a.updatedAt;

export function toMeta(session: ChatSession): ChatSessionMeta {
  const { messages: _messages, ...meta } = session;
  return meta;
}

/**
 * Build a short title: the first thing the user typed. A chat that started with
 * only a photo or file is named after it ("📷 Photo", "📄 report.pdf").
 */
export function deriveTitle(messages: ChatMessage[], maxLength = 48): string {
  const users = messages.filter((m) => m.role === 'user');
  const typed = users.map((m) => getMessageText(m).replace(/\s+/g, ' ').trim()).find(Boolean);
  if (typed) return typed.length > maxLength ? `${typed.slice(0, maxLength - 1).trimEnd()}…` : typed;
  for (const m of users) {
    for (const part of m.parts) {
      if (part.type === 'image') return '📷 Photo';
      if (part.type === 'file') return `📄 ${part.name}`.slice(0, maxLength);
    }
  }
  return 'New chat';
}

export function derivePreview(messages: ChatMessage[], maxLength = 90): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = getMessageText(messages[i]!)
      .replace(/[`*_#>|~-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
  }
  return '';
}

/** In-memory store: handy for tests, Storybook, or when persistence isn't needed. */
export function createMemoryStore(initial: ChatSession[] = []): ChatStore {
  const sessions = new Map(initial.map((s) => [s.id, s]));
  return {
    async list() {
      return [...sessions.values()].map(toMeta).sort(sortNewest);
    },
    async load(id) {
      return sessions.get(id) ?? null;
    },
    async save(session) {
      sessions.set(session.id, session);
    },
    async remove(id) {
      sessions.delete(id);
    },
    async clear() {
      sessions.clear();
    },
  };
}

/**
 * Persist sessions in any AsyncStorage-like key/value storage.
 *
 * ```ts
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * const store = createKeyValueStore(AsyncStorage);
 * ```
 *
 * Layout: one index key with the metadata list, plus one key per session, so
 * opening the history screen never loads every conversation.
 */
export function createKeyValueStore(storage: KeyValueStorage, options: { prefix?: string } = {}): ChatStore {
  const prefix = options.prefix ?? 'ai-chat-kit';
  const indexKey = `${prefix}:index`;
  const sessionKey = (id: string) => `${prefix}:session:${id}`;

  // Serialize writes so concurrent saves can't clobber the index.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  };

  const readIndex = async (): Promise<ChatSessionMeta[]> => {
    try {
      const raw = await storage.getItem(indexKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (index: ChatSessionMeta[]) => storage.setItem(indexKey, JSON.stringify(index));

  return {
    async list() {
      await queue;
      return (await readIndex()).sort(sortNewest);
    },
    async load(id) {
      await queue;
      try {
        const raw = await storage.getItem(sessionKey(id));
        return raw ? (JSON.parse(raw) as ChatSession) : null;
      } catch {
        return null;
      }
    },
    save(session) {
      return serial(async () => {
        await storage.setItem(sessionKey(session.id), JSON.stringify(session));
        const index = (await readIndex()).filter((m) => m.id !== session.id);
        index.push(toMeta(session));
        await writeIndex(index.sort(sortNewest));
      });
    },
    remove(id) {
      return serial(async () => {
        await storage.removeItem(sessionKey(id));
        await writeIndex((await readIndex()).filter((m) => m.id !== id));
      });
    },
    clear() {
      return serial(async () => {
        for (const meta of await readIndex()) await storage.removeItem(sessionKey(meta.id));
        await storage.removeItem(indexKey);
      });
    },
  };
}
