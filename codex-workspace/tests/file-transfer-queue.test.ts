import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withWorkspaceFileMutation } from '../server/file-transfers/queue';
import { withWorkspaceRemoval } from '../server/worktrees/activity';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('caller-scoped file mutation cancellation', () => {
  let directory: string;
  let workspacesDir: string;
  let filename: string;
  const workspaceId = 'queue-fixture';

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-file-queue-'));
    workspacesDir = path.join(directory, 'workspaces');
    const workspace = path.join(workspacesDir, workspaceId);
    await fs.mkdir(workspace, { recursive: true });
    filename = path.join(workspace, 'value.txt');
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });

  it('does not admit an already-aborted caller or prevent another context from writing', async () => {
    const closing = new AbortController();
    const reason = new Error('This context is closing.');
    closing.abort(reason);
    const callback = vi.fn(async () => { await fs.writeFile(filename, 'cancelled'); });
    await expect(withWorkspaceFileMutation(workspacesDir, workspaceId, callback, { signal: closing.signal })).rejects.toBe(reason);
    expect(callback).not.toHaveBeenCalled();
    await withWorkspaceFileMutation(workspacesDir, workspaceId, () => fs.writeFile(filename, 'other context'), { signal: new AbortController().signal });
    expect(await fs.readFile(filename, 'utf8')).toBe('other context');
    await expect(withWorkspaceRemoval(workspacesDir, workspaceId, async () => 'released')).resolves.toBe('released');
  });

  it('cancels a waiting callback promptly but keeps the predecessor barrier for a later context', async () => {
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const first = withWorkspaceFileMutation(workspacesDir, workspaceId, async () => {
      entered.resolve(); await release.promise;
      await fs.writeFile(filename, 'first'); order.push('first');
    });
    await entered.promise;
    const closing = new AbortController();
    const reason = new Error('Queued context closed.');
    const skipped = vi.fn(async () => { await fs.writeFile(filename, 'must never run'); });
    const cancelled = withWorkspaceFileMutation(workspacesDir, workspaceId, skipped, { signal: closing.signal });
    const rejected = expect(cancelled).rejects.toBe(reason);
    closing.abort(reason);
    let later: Promise<void> | undefined;
    const otherContext = new AbortController();
    try {
      await rejected;
      // Admit this caller only after cancellation has returned: prematurely
      // deleting the cancelled tail would let it overlap the active predecessor.
      later = withWorkspaceFileMutation(workspacesDir, workspaceId, async () => {
        order.push('later'); await fs.writeFile(filename, 'later');
      }, { signal: otherContext.signal });
      await new Promise<void>(resolve => { setImmediate(resolve); });
      expect(order).toEqual([]);
      expect(otherContext.signal.aborted).toBe(false);
      await expect(withWorkspaceRemoval(workspacesDir, workspaceId, async () => undefined)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
    } finally { release.resolve(); await first; await later; }
    expect(skipped).not.toHaveBeenCalled();
    expect(order).toEqual(['first', 'later']);
    expect(await fs.readFile(filename, 'utf8')).toBe('later');
  });

  it('keeps an active callback and its cleanup leased until they actually settle after cancellation', async () => {
    const entered = deferred();
    const releaseWork = deferred();
    const cleanupEntered = deferred();
    const releaseCleanup = deferred();
    const closing = new AbortController();
    const reason = new Error('Active context closed.');
    let settled = false;
    const active = withWorkspaceFileMutation(workspacesDir, workspaceId, async () => {
      await fs.writeFile(filename, 'active'); entered.resolve();
      try { await releaseWork.promise; closing.signal.throwIfAborted(); }
      finally { cleanupEntered.resolve(); await releaseCleanup.promise; await fs.writeFile(filename, 'cleaned'); }
    }, { signal: closing.signal });
    void active.then(() => { settled = true; }, () => { settled = true; });
    const rejected = expect(active).rejects.toBe(reason);
    await entered.promise;
    closing.abort(reason);
    let later: Promise<void> | undefined;
    let laterStarted = false;
    try {
      await new Promise<void>(resolve => { setImmediate(resolve); });
      expect(settled).toBe(false);
      releaseWork.resolve(); await cleanupEntered.promise;
      expect(settled).toBe(false);
      await expect(withWorkspaceRemoval(workspacesDir, workspaceId, async () => undefined)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
      later = withWorkspaceFileMutation(workspacesDir, workspaceId, async () => {
        laterStarted = true; await fs.writeFile(filename, 'next context');
      });
      await new Promise<void>(resolve => { setImmediate(resolve); });
      expect(laterStarted).toBe(false);
    } finally { releaseWork.resolve(); releaseCleanup.resolve(); await rejected; await later; }
    expect(settled).toBe(true);
    expect(await fs.readFile(filename, 'utf8')).toBe('next context');
    await expect(withWorkspaceRemoval(workspacesDir, workspaceId, async () => 'released')).resolves.toBe('released');
  });

  it('returns the actual result of an active non-cooperative callback after it completes', async () => {
    const entered = deferred();
    const release = deferred();
    const closing = new AbortController();
    let settled = false;
    const active = withWorkspaceFileMutation(workspacesDir, workspaceId, async () => {
      entered.resolve(); await release.promise;
      await fs.writeFile(filename, 'committed');
      return 'committed';
    }, { signal: closing.signal });
    void active.then(() => { settled = true; }, () => { settled = true; });
    await entered.promise;
    closing.abort(new Error('Closing request arrived.'));
    try { await new Promise<void>(resolve => { setImmediate(resolve); }); expect(settled).toBe(false); }
    finally { release.resolve(); }
    await expect(active).resolves.toBe('committed');
    expect(await fs.readFile(filename, 'utf8')).toBe('committed');
  });
});
