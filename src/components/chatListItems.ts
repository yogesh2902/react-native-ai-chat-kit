import type { ChatLabels } from '../labels';
import type { ChatMessage } from '../types';

export type ChatListItem =
  | { kind: 'message'; key: string; message: ChatMessage }
  | { kind: 'date'; key: string; label: string };

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "14:05" */
export function formatMessageTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** "Today", "Yesterday", "12 Nov", or "12 Nov 2025" for other years. */
export function formatDateSeparator(
  t: number,
  labels: Pick<ChatLabels, 'today' | 'yesterday' | 'months'>,
  now = Date.now(),
): string {
  const day = startOfDay(t);
  const today = startOfDay(now);
  if (day === today) return labels.today;
  if (day === today - 24 * 60 * 60 * 1000 || (today - day > 0 && today - day <= 25 * 60 * 60 * 1000)) return labels.yesterday;
  const d = new Date(t);
  const month = labels.months[d.getMonth()] ?? String(d.getMonth() + 1);
  return d.getFullYear() === new Date(now).getFullYear() ? `${d.getDate()} ${month}` : `${d.getDate()} ${month} ${d.getFullYear()}`;
}

/**
 * Items for the inverted message list (newest first). With `dateSeparators`,
 * a date label sits above the first message of each day.
 */
export function buildListItems(
  messages: ChatMessage[],
  options: { dateSeparators: boolean; labels: Pick<ChatLabels, 'today' | 'yesterday' | 'months'>; now?: number },
): ChatListItem[] {
  const visible = messages.filter((m) => m.role !== 'system');
  const items: ChatListItem[] = [];
  for (let i = visible.length - 1; i >= 0; i--) {
    const message = visible[i]!;
    items.push({ kind: 'message', key: message.id, message });
    if (!options.dateSeparators) continue;
    const older = visible[i - 1];
    if (!older || startOfDay(older.createdAt) !== startOfDay(message.createdAt)) {
      items.push({ kind: 'date', key: `date-${startOfDay(message.createdAt)}`, label: formatDateSeparator(message.createdAt, options.labels, options.now) });
    }
  }
  return items;
}
