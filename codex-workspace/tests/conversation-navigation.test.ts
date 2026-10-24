import { describe, expect, it } from 'vitest';
import type { ThreadSummary } from '../shared/types';
import { conversationDateGroup, conversationHistoryEntries, conversationStatusLabel, conversationUpdatedLabel } from '../client/components/chat/conversation-navigation';

const now = new Date(2026, 8, 30, 0, 5);
function thread(id: string, updatedAt: Date, patch: Partial<ThreadSummary> = {}): ThreadSummary {
  return { id, workspaceId: 'fixture-workspace', title: id, status: 'idle', backend: 'codex-cli', createdAt: updatedAt.toISOString(), updatedAt: updatedAt.toISOString(), ...patch };
}

describe('conversation navigation presentation', () => {
  it('uses local calendar days across midnight and preserves the bounded catalog order', () => {
    const items = [thread('current', new Date(2026, 8, 30, 0, 4)), thread('yesterday-a', new Date(2026, 8, 29, 23, 59)),
      thread('yesterday-b', new Date(2026, 8, 29, 4)), thread('week', new Date(2026, 8, 26)), thread('month', new Date(2026, 8, 6)), thread('earlier', new Date(2026, 6, 1))];
    const entries = conversationHistoryEntries(items, now);
    expect(entries.map(entry => entry.thread)).toEqual(items);
    expect(entries.slice(0, 5).map(entry => entry.group)).toEqual(['Today', 'Yesterday', null, 'Previous 7 days', 'Previous 30 days']);
    expect(entries[5].group).toBe(new Date(2026, 6, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    expect(conversationHistoryEntries(items.slice(2), now)[0].group).toBe('Yesterday');
  });

  it('keeps preserved and archived metadata from claiming live native activity', () => {
    expect(conversationStatusLabel(thread('legacy', now, { backend: 'legacy', status: 'running' }))).toBe('Read only');
    expect(conversationStatusLabel(thread('archive', now, { archivedAt: now.toISOString(), status: 'running' }))).toBe('Archived');
    expect(conversationStatusLabel(thread('approval', now, { status: 'awaiting_approval' }))).toBe('Needs approval');
    expect(conversationStatusLabel(thread('question', now, { status: 'awaiting_input' }))).toBe('Needs your answer');
    expect(conversationStatusLabel(thread('fork', now, { forkedFrom: { threadId: 'source' } }))).toBe('Forked conversation');
  });

  it('labels unreadable dates honestly without breaking rows', () => {
    expect(conversationDateGroup('unreadable', now)).toBe('Earlier');
    expect(conversationUpdatedLabel('unreadable', now)).toBe('Date unavailable');
    expect(conversationUpdatedLabel(new Date(2025, 8, 30).toISOString(), now)).toContain('2025');
    expect(conversationUpdatedLabel(new Date(2026, 8, 30, 0, 4).toISOString(), now)).toBe(new Date(2026, 8, 30, 0, 4).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  });
});
