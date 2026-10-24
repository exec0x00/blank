import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FileTransferPage, FileTransferStatus } from '../shared/types';
import { fileTransferStatusLabel, readFileTransferPage } from '../client/components/editor/file-transfer-pages';
import { FileTransferHistory, type FileTransferHistoryProps } from '../client/components/editor/FileTransferHistory';

const workspaceId = 'transfer-page-workspace';
function entry(index: number, patch: Partial<FileTransferStatus> = {}): FileTransferStatus {
  return { id: `saved-transfer-${index}`, workspaceId, kind: 'move', path: `source/file-${index}.txt`, newPath: `destination/file-${index}.txt`,
    state: 'interrupted', phase: 'verifying', createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
    issue: 'Inspect both retained paths before making changes.', ...patch };
}
function page(items: FileTransferStatus[], patch: Partial<FileTransferPage> = {}): FileTransferPage {
  return { items, offset: 0, limit: 25, total: items.length, hasMore: false, ...patch };
}
function render(value: FileTransferPage | null, patch: Partial<FileTransferHistoryProps> = {}): string {
  return renderToStaticMarkup(<FileTransferHistory workspaceId={workspaceId} page={value} query="" loadedQuery="" loading={false} error=""
    onQueryChange={() => undefined} onPrevious={() => undefined} onNext={() => undefined} onRefresh={() => undefined} onClose={() => undefined} onInspect={() => undefined} {...patch} />);
}

describe('bounded file operation client pages', () => {
  it('preserves inspectable current-workspace paths and strips unknown fields without mutating the received page', () => {
    const saved = { ...entry(0), issue: 'x'.repeat(1024), internalOnly: 'not public display metadata' };
    const source = page([saved]);
    const parsed = readFileTransferPage(source, workspaceId);
    expect(parsed.items[0]).toMatchObject({ path: 'source/file-0.txt', newPath: 'destination/file-0.txt', state: 'interrupted', phase: 'verifying' });
    expect(parsed.items[0].issue).toHaveLength(1000);
    expect(parsed.items[0]).not.toHaveProperty('internalOnly');
    expect(saved.issue).toHaveLength(1024);
    expect(parsed.items[0]).not.toBe(saved);
    const nativePath = `${('nested'.repeat(12) + '/').repeat(35)}file.txt`;
    expect(nativePath.length).toBeGreaterThan(2048);
    expect(readFileTransferPage(page([entry(1, { path: nativePath })]), workspaceId).items[0].path).toBe(nativePath);
  });

  it('rejects foreign workspaces, unsafe paths and duplicate identities before an Inspect action is rendered', () => {
    for (const invalid of [entry(0, { workspaceId: 'different-workspace' }), entry(0, { path: '../outside.txt' }),
      entry(0, { newPath: '/outside.txt' }), entry(0, { path: 'C:outside.txt' }), entry(0, { newPath: 'folder\\outside.txt' }),
      entry(0, { id: '' }), entry(0, { createdAt: 'not a date' })]) {
      expect(() => readFileTransferPage(page([invalid]), workspaceId)).toThrow('unreadable file operation page');
    }
    expect(() => readFileTransferPage(page([entry(0), entry(0)]), workspaceId)).toThrow('unreadable file operation page');
  });

  it('rejects oversized and contradictory envelopes instead of accepting a whole retained history', () => {
    expect(() => readFileTransferPage(page(Array.from({ length: 26 }, (_, index) => entry(index))), workspaceId)).toThrow('unreadable');
    for (const invalid of [page([entry(0)], { offset: -1 }), page([entry(0)], { total: 513 }), page([entry(0)], { hasMore: true }),
      page([entry(0)], { limit: 50 }), page([entry(0)], { total: 2 }), page([], { offset: 25, total: 0 })]) {
      expect(() => readFileTransferPage(invalid, workspaceId)).toThrow('unreadable');
    }
    const last = page(Array.from({ length: 12 }, (_, index) => entry(500 + index)), { offset: 500, total: 512 });
    expect(readFileTransferPage(last, workspaceId)).toEqual(last);
  });

  it('reports exact totals without claiming the states of unseen operations', () => {
    const first = page(Array.from({ length: 25 }, (_, index) => entry(index)), { total: 512, hasMore: true });
    expect(fileTransferStatusLabel(first, '')).toBe('512 unfinished file operations');
    expect(fileTransferStatusLabel(page([entry(0)]), '')).toBe('1 interrupted file operation');
    expect(fileTransferStatusLabel(page([entry(0, { state: 'running', issue: undefined })]), '')).toBe('1 file operation in progress');
    expect(fileTransferStatusLabel(first, 'Storage failed')).toBe('File operation status unavailable');
    expect(fileTransferStatusLabel(page([]), '')).toBeNull();
  });

  it('bounds mounted cards and exposes read-only page and inspection controls', () => {
    const html = render(page(Array.from({ length: 25 }, (_, index) => entry(index)), { total: 512, hasMore: true }));
    expect((html.match(/data-file-transfer-id=/g) ?? []).length).toBeLessThan(10);
    expect(html).toContain('aria-label="Search file operations"');
    expect(html).toContain('aria-label="Next file operations"');
    expect(html).toContain('aria-setsize="512"');
    expect(html).toContain('Inspect source'); expect(html).toContain('Inspect destination');
    expect(html).not.toContain('source/file-24.txt');
    expect(html).not.toContain('Retry transfer'); expect(html).not.toContain('Delete files');
  });

  it('keeps inspected paths visible beside a refresh error without promising an empty history', () => {
    const html = render(page([entry(0)]), { error: 'Saved status is temporarily unavailable.' });
    expect(html).toContain('Saved status is temporarily unavailable.');
    expect(html).toContain('source/file-0.txt'); expect(html).toContain('destination/file-0.txt');
    expect(html).toContain('Retry loading');
    expect(html).not.toContain('No unfinished file operations.');
    expect(render(page([]), { query: 'absent' })).toContain('No file operations match this search.');
  });
});
