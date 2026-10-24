import { describe, expect, it, vi } from 'vitest';
import type { FileContent, WorkspaceFileInfo, WorkspaceFilePage } from '../shared/types';
import type { OpenDocument } from '../client/components/editor/useDocuments';
import { ApiError } from '../client/api';
import {
  canReviewRange, evictCleanLargeRanges, largeEditError, largePageVisibleContent, LargeFileDocuments,
  MAX_LARGE_DIRTY_BUFFER_BYTES, MAX_LARGE_PAGE_EDIT_BYTES, MAX_LINE_SEEK_PAGES,
  movedLargeDocument, pagedDocument, readEditorDocument, textByteLength, validPage,
} from '../client/components/editor/large-file-documents';
import { byteOffsetAt, lineStarts, pagePositionLabel, pageRangeLabel, positionAtByte } from '../client/components/editor/large-file-position';

type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
const filePath = 'src/large.log';

function info(patch: Partial<WorkspaceFileInfo> = {}): WorkspaceFileInfo {
  return { path: filePath, size: 12 * 1024 * 1024, version: 'snapshot-v1', language: 'plaintext', paged: true,
    maxPageBytes: MAX_LARGE_PAGE_EDIT_BYTES, editable: true, readOnlyReason: null, totalLines: null, ...patch };
}

function page(content = 'first line\nsecond line\n', patch: Partial<WorkspaceFilePage> = {}): WorkspaceFilePage {
  const byteStart = patch.byteStart ?? 0;
  return { ...info(), content, byteStart, byteEnd: byteStart + textByteLength(content), startLine: 1,
    endLine: 1 + (content.match(/\r\n|\r|\n/g)?.length ?? 0), startsMidLine: false, endsMidLine: false,
    pageToken: `page-token-${byteStart}`, nextCursor: `next-${byteStart + textByteLength(content)}`, previousOffset: byteStart ? Math.max(0, byteStart - 128 * 1024) : null, ...patch };
}

function document(window?: WorkspaceFilePage): OpenDocument {
  const value = pagedDocument(window ?? info());
  return window ? { ...value, content: window.content, savedContent: window.content,
    largeFile: { ...value.largeFile!, page: window, target: { offset: window.byteStart }, draftBytes: textByteLength(window.content) } } : value;
}

function harness(initial: OpenDocument[] = [document()], responder: (path: string, options?: RequestInit) => unknown | Promise<unknown> = () => page()) {
  let documents = initial;
  let blocked = false;
  const request = vi.fn(async (path: string, options?: RequestInit) => responder(path, options));
  const notify = vi.fn();
  const changed = vi.fn();
  const saving = new Set<string>();
  const controller = new LargeFileDocuments('workspace-a', {
    get: path => documents.find(document => document.path === path), all: () => documents,
    update: (path, apply) => { documents = documents.map(document => document.path === path ? apply(document) : document); },
    blocked: () => blocked, notify, saving, changed,
  }, request as Request);
  return { controller, request, notify, changed, saving,
    get: (path = filePath) => documents.find(document => document.path === path)!, all: () => documents,
    set: (next: OpenDocument[]) => { documents = next; }, block: (value = true) => { blocked = value; },
    edit: (content: string, path = filePath) => { documents = documents.map(document => document.path === path ? { ...document, content, largeFile: { ...document.largeFile!, draftBytes: textByteLength(content) } } : document); },
  };
}

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('large-file document opening and bounded retention', () => {
  it('keeps a small file on the original route without any metadata/page requests', async () => {
    const small: FileContent = { path: 'small.ts', content: 'export const value = 1;\n', version: 'digest', language: 'typescript', size: 24 };
    const request = vi.fn(async () => small);
    const opened = await readEditorDocument('/workspaces/a', 'small.ts', request as Request);
    expect(opened).toMatchObject({ ...small, savedContent: small.content });
    expect(opened.largeFile).toBeUndefined(); expect(request.mock.calls).toHaveLength(1);
  });

  it('opens metadata after the bounded route rejects a large file, without preloading its text', async () => {
    const request = vi.fn(async (path: string) => { if (path.includes('/file?')) throw new ApiError('Too large', 413, 'FILE_TOO_LARGE'); return info(); });
    const opened = await readEditorDocument('/workspaces/a', filePath, request as Request);
    expect(opened.content).toBe(''); expect(opened.savedContent).toBe(''); expect(opened.largeFile?.page).toBeUndefined();
    expect(request.mock.calls.map(call => call[0])).toEqual([
      '/workspaces/a/file?path=src%2Flarge.log', '/workspaces/a/file-info?path=src%2Flarge.log',
    ]);
  });

  it('does not hide authentication or missing-file failures behind a paging retry', async () => {
    const request = vi.fn(async () => { throw new ApiError('Missing', 404); });
    await expect(readEditorDocument('/workspaces/a', filePath, request as Request)).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('loads exactly one bounded page with its snapshot identity and disposes clean inactive range data', async () => {
    const h = harness();
    expect(await h.controller.load(filePath)).toBe(true);
    expect(h.get().content).toBe(page().content); expect(h.get().size).toBe(12 * 1024 * 1024);
    expect(h.request.mock.calls[0][0]).toContain('/file-page?path=src%2Flarge.log&offset=0&version=snapshot-v1');
    const other = document(page('another\n', { path: 'other.log', byteStart: 100 }));
    const retained = evictCleanLargeRanges([h.get(), other], 'other.log');
    expect(retained[0].content).toBe(''); expect(retained[0].largeFile?.page).toBeUndefined();
    expect(retained[1]).toBe(other); expect(retained[0].largeFile?.target).toEqual({ offset: 0 });
  });

  it('pins dirty and saving pages while clean tabs use no hidden payload cache', () => {
    const clean = document(page()); const dirty = { ...document(page('saved\n', { path: 'dirty.log' })), content: 'edits\n' };
    const saving = { ...document(page('in flight\n', { path: 'saving.log' })), saving: true };
    const result = evictCleanLargeRanges([clean, dirty, saving], 'unrelated.ts');
    expect(result[0].largeFile?.page).toBeUndefined(); expect(result[1]).toBe(dirty); expect(result[2]).toBe(saving);
    expect(evictCleanLargeRanges(result, 'unrelated.ts')).toBe(result);
  });

  it('counts UTF-8 bytes for edit limits and refuses an insertion before evicting any dirty range', () => {
    const source = document(page());
    expect(largeEditError(source, 'é'.repeat(MAX_LARGE_PAGE_EDIT_BYTES / 2), [source])).toBeUndefined();
    expect(largeEditError(source, 'é'.repeat(MAX_LARGE_PAGE_EDIT_BYTES / 2 + 1), [source])).toContain('too large');
    const pinned = Array.from({ length: MAX_LARGE_DIRTY_BUFFER_BYTES / (2 * MAX_LARGE_PAGE_EDIT_BYTES) }, (_, index) => {
      const window = page('x'.repeat(MAX_LARGE_PAGE_EDIT_BYTES), { path: `${index}.log` });
      const value = document(window);
      return { ...value, content: 'y'.repeat(MAX_LARGE_PAGE_EDIT_BYTES) };
    });
    expect(largeEditError(source, 'new edit', pinned)).toContain('another edited large-file tab');
    expect(pinned.every(document => document.content.startsWith('y'))).toBe(true);
    expect(largeEditError(source, source.savedContent, pinned)).toBeUndefined();
  });

  it('shows read-only service limits and rejects malformed or oversized range responses', async () => {
    const readOnly = document(page('read only', { editable: false, readOnlyReason: 'This file exceeds the safe save limit.' }));
    expect(largeEditError(readOnly, 'changed', [readOnly])).toContain('safe save limit');
    const h = harness([document()], () => page('x', { byteEnd: 50 }));
    expect(await h.controller.load(filePath)).toBe(false); expect(h.get().largeFile?.error).toContain('invalid or oversized');
    expect(h.get().content).toBe('');
    expect(validPage(page('x'.repeat(MAX_LARGE_PAGE_EDIT_BYTES + 1)), filePath)).toBe(false);
  });
});

describe('large-file save and navigation safety', () => {
  it('refuses page navigation while edited text remains and makes no network request', async () => {
    const h = harness([document(page())]); h.edit('my unsaved edits\n');
    expect(await h.controller.load(filePath, { offset: 500000 })).toBe(false);
    expect(h.get().content).toBe('my unsaved edits\n'); expect(h.request).not.toHaveBeenCalled();
    expect(h.notify.mock.calls[0][0]).toContain('Save or explicitly discard');
  });

  it('keeps an explicitly discarded draft until the replacement read actually succeeds', async () => {
    const h = harness([document(page())], () => { throw new ApiError('Storage unavailable', 503); }); h.edit('my draft\n');
    expect(await h.controller.load(filePath, { offset: 100 }, { discard: true, fresh: true })).toBe(false);
    expect(h.get().content).toBe('my draft\n'); expect(h.get().savedContent).toBe(page().content);
    expect(h.get().largeFile?.error).toBe('Storage unavailable');
  });

  it('posts only the signed edited range and adopts the new full-file size/version', async () => {
    const original = page('before\n', { byteStart: 512, startLine: null, endLine: null });
    const edited = 'after with unicode 😺\n';
    const h = harness([document(original)], (_path, options) => {
      expect(JSON.parse(String(options?.body))).toEqual({ path: filePath, pageToken: original.pageToken, content: edited });
      return page(edited, { byteStart: original.byteStart, size: original.size + textByteLength(edited) - textByteLength(original.content), version: 'snapshot-v2', pageToken: 'fresh-token' });
    });
    h.edit(edited); expect(await h.controller.save(filePath)).toBe(true);
    expect(h.request.mock.calls[0][0]).toBe('/workspaces/workspace-a/file-range');
    expect(h.request.mock.calls[0][1]?.method).toBe('PUT');
    expect(h.get()).toMatchObject({ content: edited, savedContent: edited, version: 'snapshot-v2', saving: false });
    expect(h.get().largeFile?.page?.pageToken).toBe('fresh-token');
    expect(h.get().size).toBe(original.size + textByteLength(edited) - textByteLength(original.content));
    expect(h.saving.size).toBe(0); expect(h.changed).toHaveBeenCalledTimes(1);
  });

  it('retains a conflicting draft without overwriting, auto-retrying, or rebasing its range token', async () => {
    const original = page(); const h = harness([document(original)], () => { throw new ApiError('Source changed', 409, 'VERSION_CONFLICT'); }); h.edit('my draft');
    expect(await h.controller.save(filePath)).toBe(false);
    expect(h.get().content).toBe('my draft'); expect(h.get().savedContent).toBe(original.content);
    expect(h.get().largeFile?.page?.pageToken).toBe(original.pageToken);
    expect(h.get().largeFile?.conflict).toContain('changed on disk'); expect(h.request).toHaveBeenCalledTimes(1);
    expect(await h.controller.save(filePath)).toBe(false); expect(h.request).toHaveBeenCalledTimes(1);
  });

  it('requires matching fresh bounds and explicit reviewed save before replacing a conflicted range', async () => {
    const original = page('saved\n', { byteStart: 80 }); const fresh = page('other\n', { byteStart: 80, version: 'snapshot-v2', pageToken: 'reviewed-token' });
    const starting = document(original); starting.largeFile!.conflict = 'Changed'; starting.content = 'draft\n';
    const h = harness([starting], (path, options) => path.includes('/file-page?') ? fresh : page('draft\n', { byteStart: 80, version: 'snapshot-v3' }));
    await h.controller.inspectConflict(filePath); expect(canReviewRange(h.get())).toBe(true);
    expect(h.get().content).toBe('draft\n'); expect(await h.controller.save(filePath)).toBe(false);
    expect(await h.controller.save(filePath, true)).toBe(true);
    expect(JSON.parse(String(h.request.mock.calls.at(-1)?.[1]?.body)).pageToken).toBe('reviewed-token');
  });

  it('never applies a reviewed draft over newly shifted page boundaries', async () => {
    const original = page('saved\n', { byteStart: 80 }); const starting = document(original); starting.content = 'draft';
    starting.largeFile!.conflict = 'Changed'; starting.largeFile!.remote = page('a longer changed page\n', { byteStart: 80, version: 'snapshot-v2' });
    const h = harness([starting]); expect(canReviewRange(h.get())).toBe(false);
    expect(await h.controller.save(filePath, true)).toBe(false); expect(h.request).not.toHaveBeenCalled(); expect(h.get().content).toBe('draft');
  });

  it('does not claim a successful save if the response appends unseen neighboring text', async () => {
    const h = harness([document(page())], () => page('draft plus unrequested tail\n', { version: 'snapshot-v2' })); h.edit('draft');
    expect(await h.controller.save(filePath)).toBe(false); expect(h.get().content).toBe('draft');
    expect(h.get().largeFile?.conflict).toContain('unexpected page');
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('does not overwrite newer edits that arrive while a page load is in flight', async () => {
    const pending = deferred<WorkspaceFilePage>(); const h = harness([document(page())], () => pending.promise);
    const loading = h.controller.load(filePath, { offset: 500 }); h.edit('newer edit');
    pending.resolve(page('remote\n', { byteStart: 500 })); expect(await loading).toBe(false);
    expect(h.get().content).toBe('newer edit'); expect(h.get().largeFile?.error).toContain('New edits arrived');
  });

  it('ignores late range data after close/reopen, native path transfer, or workspace reset', async () => {
    for (const action of ['reopen', 'transfer', 'reset'] as const) {
      const pending = deferred<WorkspaceFilePage>(); const h = harness([document()], () => pending.promise);
      const loading = h.controller.load(filePath);
      if (action === 'reopen') h.set([document()]);
      if (action === 'transfer') h.controller.invalidate(['src']);
      if (action === 'reset') h.controller.reset();
      pending.resolve(page('stale response\n')); expect(await loading).toBe(false);
      expect(h.get().content).toBe(''); expect(h.get().largeFile?.page).toBeUndefined();
    }
  });

  it('retains dirty text across moves but invalidates the old path-bound write token', async () => {
    const original = document(page()); original.content = 'keep this draft';
    const moved = movedLargeDocument(original, 'destination/large.log');
    let metadataVersion = original.version;
    const h = harness([moved], () => info({ path: moved.path, version: metadataVersion }));
    expect(moved.content).toBe('keep this draft'); expect(moved.savedContent).toBe(original.savedContent);
    expect(moved.largeFile?.invalidated).toBe(true); expect(moved.largeFile?.conflict).toContain('moved');
    expect(await h.controller.save(moved.path)).toBe(false); expect(h.request).not.toHaveBeenCalled();
    for (const version of [original.version, 'metadata-after-move']) {
      metadataVersion = version;
      await h.controller.refresh(moved.path);
      expect(h.get(moved.path)).toMatchObject({ content: 'keep this draft', savedContent: original.savedContent,
        largeFile: { invalidated: true, conflict: moved.largeFile!.conflict, page: { pageToken: original.largeFile!.page!.pageToken } } });
      expect(await h.controller.save(moved.path)).toBe(false);
    }
    expect(h.request.mock.calls.map(call => call[0])).toEqual(Array(2).fill('/workspaces/workspace-a/file-info?path=destination%2Flarge.log'));
    const clean = movedLargeDocument(document(page()), 'destination/clean.log');
    expect(clean.content).toBe(''); expect(clean.largeFile?.page).toBeUndefined(); expect(clean.largeFile?.invalidated).toBe(true);
  });

  it('uses metadata-only refresh for a dirty file and leaves its original page untouched', async () => {
    const h = harness([document(page())], () => info({ version: 'changed-version' })); h.edit('pinned draft');
    await h.controller.refresh(filePath);
    expect(h.request.mock.calls.map(call => call[0])).toEqual(['/workspaces/workspace-a/file-info?path=src%2Flarge.log']);
    expect(h.get().content).toBe('pinned draft'); expect(h.get().version).toBe('snapshot-v1'); expect(h.get().largeFile?.conflict).toBeTruthy();
  });

  it('keeps an already reviewed current range stable during metadata polling', async () => {
    const current = document(page()); current.content = 'draft'; current.largeFile!.conflict = 'Changed';
    current.largeFile!.remote = page(undefined, { version: 'snapshot-v2', pageToken: 'reviewed-token' });
    const h = harness([current], () => info({ version: 'snapshot-v2' }));
    await h.controller.refresh(filePath);
    expect(h.get().largeFile?.remote?.pageToken).toBe('reviewed-token'); expect(canReviewRange(h.get())).toBe(true);
  });

  it('lets the signed continuation choose the byte boundary after a CRLF join', async () => {
    const current = document(page('first\r', { endsMidLine: true, nextCursor: 'signed-crlf-join' }));
    const h = harness([current], path => {
      const params = new URL(`https://fixture${path}`).searchParams;
      expect(params.get('cursor')).toBe('signed-crlf-join'); expect(params.has('offset')).toBe(false);
      return page('\r\nnext', { byteStart: 5, startLine: 1, endLine: 2 });
    });
    expect(await h.controller.load(filePath, { offset: 6, cursor: 'signed-crlf-join' })).toBe(true);
    expect(h.get().largeFile?.page?.byteStart).toBe(5);
  });

  it('rejects reads and saves while the owning workspace is locked', async () => {
    const h = harness([document(page())]); h.edit('draft'); h.block();
    expect(await h.controller.load(filePath, undefined, { discard: true })).toBe(false);
    expect(await h.controller.save(filePath)).toBe(false); await h.controller.inspectConflict(filePath); await h.controller.refresh(filePath);
    expect(h.request).not.toHaveBeenCalled(); expect(h.get().content).toBe('draft');
  });
});

describe('honest byte and line navigation', () => {
  it('uses signed sequential cursors and stops after a fixed amount of line scanning', async () => {
    let calls = 0;
    const h = harness([document()], (path) => {
      const params = new URL(`https://fixture${path}`).searchParams;
      expect(params.get('offset')).toBe(calls ? null : '0');
      if (calls) expect(params.get('cursor')).toBe(`cursor-${calls}`);
      const index = calls++;
      return page('x\n', { byteStart: index * 2, startLine: index + 1, endLine: index + 2, nextCursor: `cursor-${index + 1}` });
    });
    expect(await h.controller.seekLine(filePath, 1000)).toBe(false); expect(calls).toBe(MAX_LINE_SEEK_PAGES);
    expect(h.get().content).toBe('x\n'); expect(h.get().largeFile?.seek?.line).toBe(1000);
    expect(h.get().largeFile?.seek?.nextCursor).toBe(`cursor-${MAX_LINE_SEEK_PAGES}`);
    expect(await h.controller.seekLine(filePath, 1000, 1, true)).toBe(false); expect(calls).toBe(MAX_LINE_SEEK_PAGES * 2);
  });

  it('moves the caret inside a known dirty page without discarding its edits or scanning', async () => {
    const h = harness([document(page())]); h.edit('changed first line\nsecond line\n');
    expect(await h.controller.seekLine(filePath, 2, 4)).toBe(true); expect(h.request).not.toHaveBeenCalled();
    expect(h.get().content).toContain('changed first'); expect(h.get().largeFile?.reveal).toMatchObject({ line: 2, column: 4 });
  });

  it('can locate the beginning of a very long line without reading the rest of it', async () => {
    const h = harness([document()], () => page('x'.repeat(128 * 1024), { startLine: 1, endLine: 1, endsMidLine: true }));
    expect(await h.controller.seekLine(filePath, 1)).toBe(true); expect(h.request).toHaveBeenCalledTimes(1);
  });

  it('preserves UTF-8 byte positions across a BOM, non-BMP characters and CRLF lines', () => {
    const content = '\uFEFFa😺\r\nβ\n';
    expect(lineStarts(content)).toEqual([0, 6, 8]);
    expect(byteOffsetAt('a😺\r\nβ\n', lineStarts('a😺\r\nβ\n'), 2, 2)).toBe(9);
    expect(positionAtByte('a😺\r\nβ\n', 7)).toEqual({ lineNumber: 2, column: 1 });
    expect(largePageVisibleContent(document(page(content)))).toBe('a😺\r\nβ\n');
    expect(largePageVisibleContent(document(page(content, { byteStart: 10 })))).toBe(content);
    const window = page(content);
    expect(pagePositionLabel(window, content, 2, 2, false)).toBe('Byte 12 · Ln 2, Col 2');
  });

  it('labels unknown global lines and continued columns without fabricating totals', () => {
    const window = page('tail\nnext', { byteStart: 90000, startLine: null, endLine: null, startsMidLine: true });
    expect(pageRangeLabel(window)).toContain('Global lines unknown'); expect(pageRangeLabel(window)).not.toContain('Lines 1');
    expect(pagePositionLabel(window, window.content, 1, 3, false)).toBe('Byte 90,002 · Page Ln 1, Col 3');
    expect(pagePositionLabel({ ...window, startLine: 700 }, window.content, 1, 3, true)).toBe('Edited byte 90,002 · Ln 700, page col 3');
    expect(pagePositionLabel({ ...window, startLine: 700 }, window.content, 2, 2, false)).toBe('Byte 90,006 · Ln 701, Col 2');
  });

  it('does not invent a global line after an edited range ends inside a joined CRLF', () => {
    const window = page('first\r', { startLine: 1, endLine: 1, endsMidLine: true });
    expect(pagePositionLabel(window, window.content, 2, 1, false)).toBe('Byte 6 · Line break continues on next page');
  });
});
