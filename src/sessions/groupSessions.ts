import { defaultLabels, type ChatLabels } from '../labels';
import type { ChatSessionMeta } from './store';

export type SessionGroup = { title: string; data: ChatSessionMeta[] };

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

type GroupLabels = Pick<ChatLabels, 'today' | 'yesterday' | 'previous7Days' | 'previous30Days' | 'months'> & Partial<Pick<ChatLabels, 'pinned'>>;

/** Group sessions ChatGPT-style: Pinned first, then Today, Yesterday, Previous 7 days, Previous 30 days, then by month. */
export function groupSessionsByDate(
  sessions: ChatSessionMeta[],
  now = Date.now(),
  labels: GroupLabels = defaultLabels,
): SessionGroup[] {
  const today = startOfDay(now);
  const groups = new Map<string, ChatSessionMeta[]>();
  const add = (key: string, s: ChatSessionMeta) => {
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  };

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = sorted.filter((s) => s.pinned);
  for (const s of sorted) {
    if (s.pinned) continue;
    const t = s.updatedAt;
    if (t >= today) add(labels.today, s);
    else if (t >= today - DAY) add(labels.yesterday, s);
    else if (t >= today - 7 * DAY) add(labels.previous7Days, s);
    else if (t >= today - 30 * DAY) add(labels.previous30Days, s);
    else {
      const d = new Date(t);
      const sameYear = d.getFullYear() === new Date(now).getFullYear();
      const month = labels.months[d.getMonth()] ?? String(d.getMonth() + 1);
      add(sameYear ? month : `${month} ${d.getFullYear()}`, s);
    }
  }
  const dated = [...groups.entries()].map(([title, data]) => ({ title, data }));
  return pinned.length ? [{ title: labels.pinned ?? defaultLabels.pinned, data: pinned }, ...dated] : dated;
}

/** "14:05" for today, otherwise "12 Nov". */
export function formatSessionTime(t: number, now = Date.now(), months: string[] = defaultLabels.months): string {
  const d = new Date(t);
  if (t >= startOfDay(now)) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getDate()} ${months[d.getMonth()] ?? d.getMonth() + 1}`;
}

export function filterSessions(sessions: ChatSessionMeta[], query: string): ChatSessionMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q));
}
