import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage, NativeItemDetailReady, Thread, ToolActivity } from '../shared/types';
import { ActivityCard } from '../client/components/chat/ActivityCard';
import { ToolDetailScope } from '../client/components/chat/ToolDetailScope';
import { activityChangeReviewTarget, CHANGE_REVIEW_PAGE_CHARS, changeReviewKey, changeReviewModelUri, currentTurnChangeReviewTarget,
  MAX_RECORDED_PATCH_CHARS, MAX_REVIEW_FILES, recordedPatchPage, recordedPatchParts, validChangeReviewTarget, type ChangeReviewTarget } from '../client/components/editor/change-review';
import { changeReviewPageQuery, readChangeReview } from '../client/components/editor/change-review-reader';

const stamp = '2026-09-30T00:00:00.000Z';
const native: Extract<ChangeReviewTarget, { source: 'native-item' }> = {
  source: 'native-item', workspaceId: 'workspace-one', threadId: 'thread-one', turnId: 'turn-one', itemId: 'item-one',
};
const signal = () => new AbortController().signal;
const version = 'a'.repeat(64);
const filePatch = '--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n-old\n+new\n';
const patchActivity = (name = 'apply_patch', input = JSON.stringify({ patch: filePatch })): ToolActivity => ({
  id: 'activity-one', name, input, output: JSON.stringify({ changed: [{ path: 'source.ts', operation: 'updated' }, { path: 'removed.ts', operation: 'deleted' }] }), status: 'completed', startedAt: stamp,
});
function fixture(activity = patchActivity()) {
  const message: ChatMessage = { id: native.itemId, turnId: native.turnId, role: 'assistant', content: '', createdAt: stamp, activities: [activity] };
  const thread: Thread = { id: native.threadId, workspaceId: native.workspaceId, title: 'Changes', backend: 'codex-cli', status: 'idle', createdAt: stamp, updatedAt: stamp, messages: [message] };
  return { thread, message };
}
function reply(text: string, offset = 0, part = 0): NativeItemDetailReady {
  const selected = recordedPatchPage(text, offset);
  return { status: 'ready', threadId: native.threadId, turnId: native.turnId, itemId: native.itemId, field: 'output', itemType: 'fileChange',
    itemCursor: 'native-page-cursor', parts: [{ part: 0, label: 'Change 1: source.ts', totalChars: text.length }, { part: 1, label: 'Change 2: removed.ts', totalChars: text.length }],
    part, label: part === 0 ? 'Change 1: source.ts' : 'Change 2: removed.ts', totalChars: text.length, limit: CHANGE_REVIEW_PAGE_CHARS, version, ...selected };
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
afterEach(() => vi.unstubAllGlobals());

describe('recorded change identities and patch spans', () => {
  it('uses native item and turn identities, including an explicit file index for renamed files', () => {
    const scope = { workspaceId: native.workspaceId, threadId: native.threadId, turnId: native.turnId, messageId: native.itemId, backend: 'codex-cli' as const };
    expect(activityChangeReviewTarget(scope, patchActivity())).toEqual(native);
    expect(activityChangeReviewTarget(scope, patchActivity(), 'new-name.ts', 1)).toEqual({ ...native, path: 'new-name.ts', part: 1 });
    expect(activityChangeReviewTarget({ ...scope, turnId: undefined }, patchActivity())).toBeNull();
    expect(activityChangeReviewTarget(scope, { ...patchActivity(), name: 'exec_command' })).toBeNull();
    expect(activityChangeReviewTarget({ ...scope, backend: undefined, epoch: 'saved-epoch' }, patchActivity())).toMatchObject({
      source: 'saved-tool', epoch: 'saved-epoch', activityId: 'activity-one', itemId: native.itemId, field: 'input',
    });
  });

  it('rejects malformed identities, oversized snapshots and out-of-range native parts', () => {
    expect(validChangeReviewTarget(native)).toBe(true);
    for (const invalid of [{ ...native, workspaceId: '' }, { ...native, itemId: 'item\nother' }, { ...native, turnId: undefined },
      { ...native, part: MAX_REVIEW_FILES }, { ...native, path: 'bad\0path' }, { ...native, source: 'recorded-patch', patch: 'x'.repeat(MAX_RECORDED_PATCH_CHARS + 1) }]) {
      expect(validChangeReviewTarget(invalid)).toBe(false);
    }
  });

  it('isolates review models from editable files and every other recorded identity', () => {
    const uri = changeReviewModelUri(native, 'editor-one:request-one', version, '0', 0);
    expect(uri).toMatch(/^codex-change-review:\/\//);
    expect(uri).not.toMatch(/^file:|^codex-original:/);
    const alternatives = [
      changeReviewModelUri({ ...native, workspaceId: 'other' }, 'editor-one:request-one', version, '0', 0),
      changeReviewModelUri({ ...native, threadId: 'other' }, 'editor-one:request-one', version, '0', 0),
      changeReviewModelUri({ ...native, turnId: 'other' }, 'editor-one:request-one', version, '0', 0),
      changeReviewModelUri({ ...native, itemId: 'other' }, 'editor-one:request-one', version, '0', 0),
      changeReviewModelUri(native, 'editor-one:request-two', version, '0', 0),
      changeReviewModelUri(native, 'editor-one:request-one', 'b'.repeat(64), '0', 0),
      changeReviewModelUri(native, 'editor-one:request-one', version, '1', 0),
      changeReviewModelUri(native, 'editor-one:request-one', version, '0', 16_000),
    ];
    expect(new Set([uri, ...alternatives]).size).toBe(9);
    expect(changeReviewKey({ ...native, path: 'source.ts' })).toBe(changeReviewKey(native));
  });

  it('keeps aggregate native diffs as honest snapshots without inventing a turn identity', () => {
    const { thread } = fixture();
    thread.native = { activeTurnId: 'a-new-turn', diff: filePatch + '… [truncated]' } as NonNullable<Thread['native']>;
    expect(currentTurnChangeReviewTarget(thread)).toMatchObject({ source: 'recorded-patch', patch: filePatch + '… [truncated]', truncated: true });
    expect(currentTurnChangeReviewTarget(thread)).not.toHaveProperty('turnId');
    expect(currentTurnChangeReviewTarget({ ...thread, backend: undefined })).toBeNull();
  });

  it('preserves exact add/delete/rename/binary spans and quoted file names', () => {
    const patches = [
      'diff --git a/added.ts b/added.ts\nnew file mode 100644\n--- /dev/null\n+++ b/added.ts\n@@ -0,0 +1 @@\n+added\n',
      'diff --git a/deleted.ts b/deleted.ts\ndeleted file mode 100644\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted\n',
      'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n',
      'diff --git "a/space name.bin" "b/space name.bin"\nBinary files "a/space name.bin" and "b/space name.bin" differ\n',
    ];
    const full = patches.join(''), parts = recordedPatchParts(full);
    expect(parts.map(part => full.slice(part.start, part.end))).toEqual(patches);
    expect(parts.map(part => part.path)).toEqual(['added.ts', 'deleted.ts', 'new.ts', 'space name.bin']);
    const custom = '*** Begin Patch\n*** Update File: old.ts\n@@\n-old\n+new\n*** Delete File: removed.ts\n*** End Patch\n';
    const customParts = recordedPatchParts(custom);
    expect(customParts.map(part => part.path)).toEqual(['old.ts', 'removed.ts']);
    expect(customParts.map(part => custom.slice(part.start, part.end)).join('')).toBe(custom);
  });

  it('bounds file navigation while retaining all recorded spans', () => {
    const patch = Array.from({ length: MAX_REVIEW_FILES + 3 }, (_, index) => `diff --git a/file-${index} b/file-${index}\n`).join('');
    const parts = recordedPatchParts(patch);
    expect(parts).toHaveLength(MAX_REVIEW_FILES);
    expect(parts.at(-1)).toMatchObject({ label: 'Additional recorded files' });
    expect(parts.at(-1)?.path).toBeUndefined();
    expect(parts.map(part => patch.slice(part.start, part.end)).join('')).toBe(patch);
  });

  it('pages without losing or splitting surrogate pairs', () => {
    const patch = 'a'.repeat(CHANGE_REVIEW_PAGE_CHARS - 1) + '😀' + 'b'.repeat(CHANGE_REVIEW_PAGE_CHARS + 20);
    let offset = 0, joined = '';
    do {
      const page = recordedPatchPage(patch, offset);
      expect(page.text.length).toBeLessThanOrEqual(CHANGE_REVIEW_PAGE_CHARS);
      expect(page.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      joined += page.text;
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    } while (offset < patch.length);
    expect(joined).toBe(patch);
    expect(recordedPatchPage(patch, CHANGE_REVIEW_PAGE_CHARS).text.length).toBeLessThanOrEqual(CHANGE_REVIEW_PAGE_CHARS);
  });
});

describe('bounded recorded change readers', () => {
  it('reads exact native patch pages with version/cursor pinning and never requests working files', async () => {
    const text = filePatch.repeat(700);
    const fetcher = vi.fn(async (url: string) => {
      const params = new URL(url, 'http://test').searchParams;
      return response(reply(text, Number(params.get('offset')), Number(params.get('part'))));
    });
    vi.stubGlobal('fetch', fetcher);
    const selectedSignal = signal();
    const first = await readChangeReview(native, { offset: 0 }, selectedSignal);
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') throw new Error('Missing first page');
    expect(first.text).toBe(text.slice(0, CHANGE_REVIEW_PAGE_CHARS));
    expect(first.parts.map(part => part.path)).toEqual(['source.ts', 'removed.ts']);
    const next = await readChangeReview(native, changeReviewPageQuery(first, first.nextOffset!), selectedSignal);
    expect(next).toMatchObject({ status: 'ready', offset: CHANGE_REVIEW_PAGE_CHARS });
    const requested = new URL(fetcher.mock.calls[1][0], 'http://test');
    expect(requested.pathname).toBe('/api/threads/thread-one/native-item-detail');
    expect(Object.fromEntries(requested.searchParams)).toEqual({ turnId: native.turnId, itemId: native.itemId, field: 'output',
      offset: String(CHANGE_REVIEW_PAGE_CHARS), limit: String(CHANGE_REVIEW_PAGE_CHARS), cursor: 'native-page-cursor', part: '0', version });
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store', credentials: 'same-origin' }));
  });

  it('uses the native file index when a renamed summary path differs from the saved source path', async () => {
    const fetcher = vi.fn(async (_url: string) => response(reply(filePatch, 0, 1))); vi.stubGlobal('fetch', fetcher);
    const result = await readChangeReview({ ...native, path: 'renamed.ts', part: 1 }, { offset: 0 }, signal());
    expect(result).toMatchObject({ status: 'ready', part: '1' });
    expect(new URL(fetcher.mock.calls[0][0] as string, 'http://test').searchParams.get('part')).toBe('1');
  });

  it('does not silently search all history or substitute command output for a patch', async () => {
    const fetcher = vi.fn(async () => response({ status: 'searching', threadId: native.threadId, turnId: native.turnId,
      itemId: native.itemId, field: 'output', nextCursor: 'older-page', pagesScanned: 2 })); vi.stubGlobal('fetch', fetcher);
    expect(await readChangeReview(native, { offset: 0 }, signal())).toEqual({ status: 'searching', nextCursor: 'older-page' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => response({ ...reply('command output'), itemType: 'commandExecution' }));
    expect(await readChangeReview(native, { offset: 0 }, signal())).toMatchObject({ status: 'unavailable' });
    fetcher.mockImplementation(async () => response({ ...reply(filePatch), itemId: 'different-item' }));
    await expect(readChangeReview(native, { offset: 0 }, signal())).rejects.toThrow(/verified/);
  });

  it('rejects changes of recorded version and surfaces unavailable patches', async () => {
    const fetcher = vi.fn(async () => response({ ...reply(filePatch), version: 'b'.repeat(64) })); vi.stubGlobal('fetch', fetcher);
    await expect(readChangeReview(native, { offset: 0, cursor: 'native-page-cursor', version }, signal())).rejects.toMatchObject({ status: 409 });
    fetcher.mockImplementation(async () => response({ status: 'unavailable', threadId: native.threadId, turnId: native.turnId,
      itemId: native.itemId, field: 'output', itemType: 'fileChange', itemCursor: null, reason: 'no-public-content', message: 'No text was recorded.' }));
    expect(await readChangeReview(native, { offset: 0 }, signal())).toEqual({ status: 'unavailable', message: 'No text was recorded.' });
  });

  it('reads captured legacy content through the existing presented history endpoint', async () => {
    const target: ChangeReviewTarget = { source: 'saved-tool', workspaceId: native.workspaceId, threadId: native.threadId,
      itemId: native.itemId, activityId: 'old-tool', epoch: 'old-epoch', field: 'input' };
    const fetcher = vi.fn(async (_url: string) => response({ threadId: target.threadId, epoch: target.epoch, revision: 1, version, text: filePatch,
      offset: 0, totalChars: filePatch.length, previousOffset: null, nextOffset: null,
      presentation: { partId: 'patch', label: 'Patch', kind: 'code', language: 'diff', parts: [{ id: 'patch', label: 'Patch' }, { id: 'details', label: 'Details' }] } }));
    vi.stubGlobal('fetch', fetcher);
    const page = await readChangeReview(target, { offset: 0 }, signal());
    expect(page).toMatchObject({ status: 'ready', text: filePatch, language: 'diff', parts: [{ id: 'patch', label: 'Patch' }] });
    const request = new URL(fetcher.mock.calls[0][0] as string, 'http://test');
    expect(request.pathname).toBe('/api/threads/thread-one/history/detail');
    expect(request.searchParams.get('activityId')).toBe('old-tool');
    expect(request.searchParams.get('epoch')).toBe('old-epoch');
  });

  it('opens captured previews locally with explicit truncation and no file reads', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const page = await readChangeReview({ ...native, source: 'recorded-patch', patch: filePatch, truncated: true }, { offset: 0 }, signal());
    expect(page).toMatchObject({ status: 'ready', text: filePatch, notices: [expect.stringContaining('truncated')] });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('chat handoff to change review', () => {
  it('shows changed file summaries and review links with no inline patch, including deleted files', () => {
    const activity = patchActivity(); const { thread, message } = fixture(activity);
    const html = renderToStaticMarkup(<ToolDetailScope thread={thread} message={message} expanded onOpenChange={() => undefined}>
      <ActivityCard activity={activity} onNotify={() => undefined} onOpenFile={() => undefined} workspacePath="/workspace" />
    </ToolDetailScope>);
    expect(html).toContain('Open changes');
    expect(html).toContain('Review changes to removed.ts');
    expect(html).toContain('Deleted');
    expect(html).not.toContain('+new');
    expect(html).not.toContain('response-tool-code');
    expect(html).not.toContain('chat-history-detail-inline');
    expect(html).not.toContain('Open removed.ts');
  });

  it('keeps proposed file bodies out of chat even when approval expands the activity', () => {
    const activity = { ...patchActivity('write_file', JSON.stringify({ path: 'file.ts', content: 'PRIVATE_TO_PATCH_SURFACE' })), status: 'awaiting_approval' as const };
    const html = renderToStaticMarkup(<ActivityCard activity={activity} onNotify={() => undefined} />);
    expect(html).toContain('Awaiting approval');
    expect(html).not.toContain('PRIVATE_TO_PATCH_SURFACE');
  });

  it('retains ordinary command output and uses only the group status animation', () => {
    const activity: ToolActivity = { ...patchActivity('exec_command', JSON.stringify({ command: 'npm test' })), status: 'running', output: JSON.stringify({ output: 'PUBLIC_COMMAND_OUTPUT', running: true }) };
    const { thread, message } = fixture(activity);
    const html = renderToStaticMarkup(<ToolDetailScope thread={thread} message={message} expanded grouped>
      <ActivityCard activity={activity} onNotify={() => undefined} />
    </ToolDetailScope>);
    expect(html).toContain('PUBLIC_COMMAND_OUTPUT');
    expect(html).toContain('response-tool-code');
    expect(html).not.toContain('chat-spin');
    expect(html).not.toContain('aria-live="polite"');
  });
});
