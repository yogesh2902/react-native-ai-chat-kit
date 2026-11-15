import type { ChatSessionMeta } from './store';

export type SessionGroup = { title: string; data: ChatSessionMeta[] };

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Group sessions ChatGPT-style: Today, Yesterday, Previous 7 days, Previous 30 days, then by month. */
export function groupSessionsByDate(sessions: ChatSessionMeta[], now = Date.now()): SessionGroup[] {
  const today = startOfDay(now);
  const groups = new Map<string, ChatSessionMeta[]>();
  const add = (key: string, s: ChatSessionMeta) => {
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  };

  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const t = s.updatedAt;
    if (t >= today) add('Today', s);
    else if (t >= today - DAY) add('Yesterday', s);
    else if (t >= today - 7 * DAY) add('Previous 7 days', s);
    else if (t >= today - 30 * DAY) add('Previous 30 days', s);
    else {
      const d = new Date(t);
      const sameYear = d.getFullYear() === new Date(now).getFullYear();
      add(sameYear ? MONTHS[d.getMonth()]! : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, s);
    }
  }
  return [...groups.entries()].map(([title, data]) => ({ title, data }));
}

/** "14:05" for today, otherwise "12 Nov". */
export function formatSessionTime(t: number, now = Date.now()): string {
  const d = new Date(t);
  if (t >= startOfDay(now)) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function filterSessions(sessions: ChatSessionMeta[], query: string): ChatSessionMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q));
}
