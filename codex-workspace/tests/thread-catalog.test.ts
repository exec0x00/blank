import { describe, expect, it } from 'vitest';
import type { ThreadListPage, ThreadSummary } from '../shared/types';
import type { MeasuredRange } from '../client/components/chat/MeasuredWindow';
import { THREAD_CATALOG_PAGE_SIZE, ThreadCatalogCache, threadListItems } from '../client/components/chat/useThreadCatalog';

function summary(index: number, patch: Partial<ThreadSummary> = {}): ThreadSummary {
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 2000 - index)).toISOString();
  return { id: `thread-${index}`, workspaceId: 'workspace-one', title: `Conversation ${index}`, status: 'idle', createdAt: timestamp, updatedAt: timestamp, ...patch };
}

function page(start: number, total = 1600): ThreadListPage {
  const items = Array.from({ length: Math.max(0, Math.min(THREAD_CATALOG_PAGE_SIZE, total - start)) }, (_, index) => summary(start + index));
  return { items, newerCursor: items.length ? `opaque-${start}` : null, olderCursor: items.length ? `opaque-${start + items.length - 1}` : null,
    hasNewer: start > 0, hasOlder: start + items.length < total };
}

function range(firstKey: string, pinnedKeys: string[] = []): MeasuredRange {
  return { start: 0, end: 10, firstKey, lastKey: firstKey, pinnedKeys: new Set(pinnedKeys), atStart: false, atEnd: true };
}

describe('bounded thread catalog snapshots', () => {
  it('keeps a selected older thread without retaining a legacy full list', () => {
    const response = Array.from({ length: 1000 }, (_, index) => summary(index));
    const result = threadListItems(response, { workspaceId: 'workspace-one', selectedId: 'thread-700', archived: 'all' });
    expect(result).toHaveLength(41);
    expect(result.slice(0, 40).map(item => item.id)).toEqual(response.slice(0, 40).map(item => item.id));
    expect(result.at(-1)?.id).toBe('thread-700');
    expect(response).toHaveLength(1000);
  });

  it('filters root threads, workspace, archive and search before bounding legacy fixtures', () => {
    const response = Array.from({ length: 100 }, (_, index) => summary(index, { title: index % 2 ? 'Find the answer' : 'Unrelated' }));
    response.unshift(summary(-1, { parentThreadId: 'parent', title: 'Find child' }), summary(-2, { workspaceId: 'workspace-two', title: 'Find elsewhere' }),
      summary(-3, { archivedAt: '2026-01-01T00:00:00Z', title: 'Find archived' }));
    const active = threadListItems(response, { workspaceId: 'workspace-one', archived: 'active', query: ' FIND ' });
    expect(active).toHaveLength(40);
    expect(active[0].id).toBe('thread-1');
    expect(active.at(-1)?.id).toBe('thread-79');
    const archived = threadListItems(response, { workspaceId: 'workspace-one', archived: 'archived', query: 'find' });
    expect(archived.map(item => item.id)).toEqual(['thread--3']);
  });

  it('unions a paginated selected summary once without creating a gap in chooser pages', () => {
    const response = { ...page(0), selected: summary(700) };
    expect(threadListItems(response)).toHaveLength(41);
    expect(threadListItems({ ...response, selected: summary(0) })).toHaveLength(40);
    const cache = new ThreadCatalogCache({ workspaceId: 'workspace-one' });
    cache.replace(response);
    expect(cache.snapshot().items).toHaveLength(40);
    expect(cache.snapshot().items.some(item => item.id === 'thread-700')).toBe(false);
    expect(cache.snapshot().olderCursor).toBe('opaque-39');
  });
});

describe('thread catalog viewport cache', () => {
  it('retains only three pages during long traversal and refetches an evicted edge in reverse', () => {
    const cache = new ThreadCatalogCache({ workspaceId: 'workspace-one', archived: 'active' });
    cache.replace(page(0));
    for (let start = 40; start <= 360; start += 40) {
      cache.page(page(start), 'older');
      expect(cache.snapshot().items.length).toBeLessThanOrEqual(120);
    }
    expect(cache.snapshot()).toMatchObject({ hasNewer: true, hasOlder: true, newerCursor: 'opaque-280', olderCursor: 'opaque-399' });
    expect(cache.snapshot().items[0].id).toBe('thread-280');
    expect(cache.snapshot().items.at(-1)?.id).toBe('thread-399');
    for (let start = 240; start >= 0; start -= 40) cache.page(page(start), 'newer');
    expect(cache.snapshot().items).toHaveLength(120);
    expect(cache.snapshot().items[0].id).toBe('thread-0');
    expect(cache.snapshot().items.at(-1)?.id).toBe('thread-119');
    expect(cache.snapshot()).toMatchObject({ hasNewer: false, hasOlder: true, newerCursor: 'opaque-0', olderCursor: 'opaque-119' });
  });

  it('protects focus and text selection within six pages, fails atomically at the cap, and releases them', () => {
    const cache = new ThreadCatalogCache();
    cache.replace(page(0));
    cache.anchor(range('thread-0', ['thread-0']));
    for (let start = 40; start <= 200; start += 40) cache.page(page(start), 'older');
    const before = cache.snapshot();
    expect(before.items).toHaveLength(240);
    expect(() => cache.page(page(240), 'older')).toThrow('Move keyboard focus or clear the text selection');
    expect(cache.snapshot()).toEqual(before);
    expect(cache.anchor(range('thread-200'))).toBe(true);
    expect(cache.snapshot().items).toHaveLength(120);
    expect(cache.snapshot().items[0].id).toBe('thread-120');
    cache.page(page(240), 'older');
    expect(cache.snapshot().items).toHaveLength(120);
    expect(cache.snapshot().items.some(item => item.id === 'thread-200')).toBe(true);
  });

  it('keeps the visible anchor while loading in either direction', () => {
    const cache = new ThreadCatalogCache();
    cache.replace(page(120));
    cache.page(page(160), 'older');
    cache.page(page(200), 'older');
    cache.anchor(range('thread-220'));
    cache.page(page(80), 'newer');
    expect(cache.snapshot().items).toHaveLength(160);
    expect(cache.snapshot().items.some(item => item.id === 'thread-220')).toBe(true);
    cache.anchor(range('thread-90'));
    expect(cache.snapshot().items).toHaveLength(120);
    expect(cache.snapshot().items.at(-1)?.id).toBe('thread-199');
  });

  it('enforces the same protected bound when returning toward newer conversations', () => {
    const cache = new ThreadCatalogCache();
    cache.replace(page(240));
    cache.anchor(range('thread-260', ['thread-260']));
    for (let start = 200; start >= 40; start -= 40) cache.page(page(start), 'newer');
    expect(cache.snapshot().items).toHaveLength(240);
    expect(() => cache.page(page(0), 'newer')).toThrow('Move keyboard focus or clear the text selection');
    expect(cache.snapshot().items.some(item => item.id === 'thread-260')).toBe(true);
    cache.anchor(range('thread-50'));
    cache.page(page(0), 'newer');
    expect(cache.snapshot().items).toHaveLength(120);
    expect(cache.snapshot()).toMatchObject({ hasNewer: false, olderCursor: 'opaque-119' });
  });

  it('reconciles status, renamed search matches, archive changes and deletion in resident pages', () => {
    const cache = new ThreadCatalogCache({ workspaceId: 'workspace-one', archived: 'active', query: 'Conversation' });
    cache.replace(page(0));
    expect(cache.patch(summary(2, { status: 'running' }))).toBe(true);
    expect(cache.snapshot().items.find(item => item.id === 'thread-2')?.status).toBe('running');
    expect(cache.patch(summary(2, { status: 'running' }))).toBe(false);
    cache.patch(summary(3, { title: 'Different title' }));
    cache.patch(summary(4, { archivedAt: '2026-01-01T00:00:00Z' }));
    cache.remove('thread-5');
    expect(cache.snapshot().items).toHaveLength(37);
    expect(cache.snapshot().items.some(item => ['thread-3', 'thread-4', 'thread-5'].includes(item.id))).toBe(false);
    expect(cache.patch(summary(800))).toBe(false);
    expect(cache.snapshot().olderCursor).toBe('opaque-39');
  });

  it('stops on an empty edge without discarding the current window or its reverse cursor', () => {
    const cache = new ThreadCatalogCache();
    cache.replace(page(40));
    cache.page({ items: [], olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false }, 'older');
    expect(cache.snapshot().items).toHaveLength(40);
    expect(cache.snapshot()).toMatchObject({ hasOlder: false, hasNewer: true, olderCursor: null, newerCursor: 'opaque-40' });
  });

  it('rejects unusable cursors without replacing valid content', () => {
    const cache = new ThreadCatalogCache();
    cache.replace(page(0));
    const before = cache.snapshot();
    expect(() => cache.page({ ...page(40), olderCursor: null }, 'older')).toThrow('invalid page');
    expect(() => cache.replace({ ...page(0), olderCursor: 'x'.repeat(4097) })).toThrow('invalid page');
    expect(cache.snapshot()).toEqual(before);
  });
});
