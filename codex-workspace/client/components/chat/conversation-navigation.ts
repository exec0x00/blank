import type { ThreadSummary } from '../../../shared/types';

export interface ConversationHistoryEntry {
  thread: ThreadSummary;
  group: string | null;
}

/** Calendar days, rather than elapsed hours, keep groups correct across DST. */
function calendarDay(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
}

export function conversationDateGroup(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Earlier';
  const age = calendarDay(now) - calendarDay(date);
  if (age <= 0) return 'Today';
  if (age === 1) return 'Yesterday';
  if (age < 7) return 'Previous 7 days';
  if (age < 30) return 'Previous 30 days';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Keep native catalog order and keys intact; group headings belong to a row. */
export function conversationHistoryEntries(items: readonly ThreadSummary[], now = new Date()): ConversationHistoryEntry[] {
  let previous: string | undefined;
  return items.map(thread => {
    const label = conversationDateGroup(thread.updatedAt, now);
    const group = label === previous ? null : label;
    previous = label;
    return { thread, group };
  });
}

export function conversationUpdatedLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  if (calendarDay(date) === calendarDay(now)) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) });
}

export function conversationStatusLabel(thread: ThreadSummary): string {
  if (thread.backend === 'legacy' || thread.readOnly) return 'Read only';
  if (thread.archivedAt) return 'Archived';
  switch (thread.status) {
    case 'running': return 'Working';
    case 'awaiting_approval': return 'Needs approval';
    case 'awaiting_input': return 'Needs your answer';
    case 'compacting': return 'Compacting context';
    case 'error': return 'Needs attention';
    case 'interrupted': return 'Interrupted';
    default: return thread.forkedFrom ? 'Forked conversation' : 'Updated';
  }
}
