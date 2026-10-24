import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireWorkspaceActivity, type WorkspaceActivityKind } from '../server/worktrees/activity';
import { listTrashRecords, readWorkspaceTrashMetadataExclusions } from '../server/workspace-trash/records';
import { removeTree, identity } from '../server/workspace-trash/filesystem';
import { fixture, fsError, git, type TrashFixture } from './workspace-trash-fixture';

describe('durable whole-workspace deletion', () => {
  let f: TrashFixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });

  it('moves real files to durable trash and restores the same identity, modes, links and account selection', async () => {
    await f.service.update(f.workspace.id, { githubAccountId: 'saved-account', active: true });
    await f.service.writeFile(f.workspace.id, 'nested/run.sh', '#!/bin/sh\nprintf retained\n');
    await fs.chmod(path.join(f.workspace.path, 'nested'), 0o2775);
    await fs.chmod(path.join(f.workspace.path, 'nested/run.sh'), 0o751);
    await fs.mkdir(path.join(f.workspace.path, 'empty'));
    await fs.symlink('nested/run.sh', path.join(f.workspace.path, 'script-link'));
    await f.store.write('protected-credentials', { fixture: 'unchanged-encrypted-test-value' });
    await f.store.write('thread-unrelated', { text: 'Keep conversations and unrelated state.' });
    await f.service.writeFile(f.workspace.id, 'discarded.txt', 'Recoverable prior file deletion');
    const prior = await f.service.trashEntry(f.workspace.id, 'discarded.txt');
    const entry = await f.trash();
    expect(entry).toMatchObject({ workspaceId: f.workspace.id, state: 'ready', canRestore: true, reason: 'deleted' });
    expect(Date.parse(entry.expiresAt) - Date.parse(entry.deletedAt)).toBe(30 * 24 * 60 * 60 * 1000);
    await expect(fs.lstat(f.workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/nested/run.sh'), 'utf8')).toContain('retained');
    expect((await f.service.list()).some(item => item.id === f.workspace.id)).toBe(false);
    const restarted = await f.restart();
    const restored = await restarted.restoreWorkspaceTrash(entry.id);
    expect(restored.id).toBe(f.workspace.id);
    expect(restored.githubAccountId).toBe('saved-account');
    expect((await fs.stat(path.join(restored.path, 'nested'))).mode & 0o7777).toBe(0o2775);
    expect((await fs.stat(path.join(restored.path, 'nested/run.sh'))).mode & 0o7777).toBe(0o751);
    expect(await fs.readlink(path.join(restored.path, 'script-link'))).toBe('nested/run.sh');
    expect(await fs.readdir(path.join(restored.path, 'empty'))).toEqual([]);
    expect((await restarted.listTrash(restored.id))[0].id).toBe(prior.id);
    await restarted.restoreEntry(restored.id, prior.id);
    expect(await fs.readFile(path.join(restored.path, 'discarded.txt'), 'utf8')).toBe('Recoverable prior file deletion');
    await expect(fs.lstat(path.join(f.entryPath(entry.id), 'content'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.store.read('protected-credentials', null)).toEqual({ fixture: 'unchanged-encrypted-test-value' });
    expect(await f.store.read('thread-unrelated', null)).toEqual({ text: 'Keep conversations and unrelated state.' });
  });

  it.each<WorkspaceActivityKind>(['terminal', 'agent', 'files', 'git', 'extension', 'worktree'])('refuses moving a workspace while its %s lease is live', async kind => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'busy native contents');
    const release = acquireWorkspaceActivity(f.config.workspacesDir, f.workspace.id, kind);
    try { await expect(f.trash()).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', status: 409 }); }
    finally { release(); }
    expect(await fs.readFile(path.join(f.workspace.path, 'keep.txt'), 'utf8')).toBe('busy native contents');
    expect(await listTrashRecords(f.config)).toEqual([]);
  });

  it('records a truly missing directory durably even while an already-owned terminal lease remains live', async () => {
    await f.service.update(f.workspace.id, { githubAccountId: 'account-kept', active: true });
    await fs.rm(f.workspace.path, { recursive: true });
    const release = acquireWorkspaceActivity(f.config.workspacesDir, f.workspace.id, 'terminal');
    try {
      expect((await f.service.list()).some(item => item.id === f.workspace.id)).toBe(false);
      const entry = (await f.service.listWorkspaceTrash())[0];
      expect(entry).toMatchObject({ workspaceId: f.workspace.id, reason: 'missing', state: 'missing', canRestore: false });
      expect((await f.service.getRegistration(f.workspace.id, { includeArchived: true })).githubAccountId).toBe('account-kept');
      await expect(f.service.restoreWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    } finally { release(); }
    const restarted = await f.restart();
    const entry = (await restarted.listWorkspaceTrash())[0];
    await expect(restarted.restoreWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_MISSING' });
    await expect(fs.lstat(f.workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.store.read('active-workspace', null)).not.toBe(f.workspace.id);
  });

  it.each(['EIO', 'EACCES'])('does not call a transient %s storage failure a deletion', async code => {
    const lstat = fs.lstat.bind(fs);
    const spy = vi.spyOn(fs, 'lstat').mockImplementation(((input: Parameters<typeof fs.lstat>[0], options?: unknown) => {
      if (String(input).endsWith(`/${f.workspace.id}`)) return Promise.reject(fsError(code));
      return lstat(input, options as never);
    }) as typeof fs.lstat);
    expect((await f.service.list()).some(item => item.id === f.workspace.id)).toBe(true);
    expect(await listTrashRecords(f.config)).toEqual([]);
    spy.mockRestore();
    expect((await f.service.get(f.workspace.id)).id).toBe(f.workspace.id);
  });

  it('rejects linked roots and never follows an outside link when permanently clearing owned trash', async () => {
    const outside = path.join(f.directory, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep'), 'outside sentinel');
    await fs.rmdir(f.workspace.path);
    await fs.symlink(outside, f.workspace.path);
    await expect(f.trash()).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_UNSAFE' });
    expect((await f.service.list()).some(item => item.id === f.workspace.id)).toBe(true);
    await fs.unlink(f.workspace.path);
    await fs.mkdir(f.workspace.path);
    await fs.symlink(outside, path.join(f.workspace.path, 'outside-link'));
    const entry = await f.trash();
    await f.service.purgeWorkspaceTrash(entry.id);
    expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('outside sentinel');
  });

  it('preserves a concurrently allocated empty restore directory and retains the whole trash copy', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'copy to preserve');
    const entry = await f.trash();
    const mkdir = fs.mkdir.bind(fs);
    let raced = false;
    const spy = vi.spyOn(fs, 'mkdir').mockImplementation((async (input: Parameters<typeof fs.mkdir>[0], options?: unknown) => {
      if (!raced && String(input).endsWith(`/${f.workspace.id}`)) {
        raced = true;
        await mkdir(f.workspace.path);
      }
      return mkdir(input, options as never);
    }) as typeof fs.mkdir);
    await expect(f.service.restoreWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_RESTORE_CONFLICT' });
    spy.mockRestore();
    expect(raced).toBe(true);
    expect(await fs.readdir(f.workspace.path)).toEqual([]);
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/keep.txt'), 'utf8')).toBe('copy to preserve');
    expect((await f.service.listWorkspaceTrash())[0].canRestore).toBe(true);
  });

  it('recovers an actual move interrupted before its final ready journal write', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'moved before interruption');
    const update = f.store.update.bind(f.store);
    const spy = vi.spyOn(f.store, 'update').mockImplementation(async <T>(key: string, fallback: T, updater: (current: T) => T | Promise<T>): Promise<T> =>
      update(key, fallback, async current => {
        const next = await updater(current);
        if (key.startsWith('workspace-trash-record-') && (next as { phase?: unknown })?.phase === 'ready') throw fsError('EIO');
        return next;
      }));
    await expect(f.trash()).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    spy.mockRestore();
    expect(await readWorkspaceTrashMetadataExclusions(f.config)).toContain(f.workspace.id);
    const restarted = await f.restart();
    const entry = (await restarted.listWorkspaceTrash())[0];
    expect(entry.state).toBe('ready');
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/keep.txt'), 'utf8')).toBe('moved before interruption');
    await restarted.restoreWorkspaceTrash(entry.id);
    expect(await fs.readFile(path.join(f.workspace.path, 'keep.txt'), 'utf8')).toBe('moved before interruption');
  });

  it('keeps an interrupted pre-move source with changed native identity as recovery, never falsely missing', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'still at original location');
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('/content')) throw fsError('EIO');
      return rename(from, to);
    });
    await expect(f.trash()).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    spy.mockRestore();
    const record = (await listTrashRecords(f.config))[0];
    await f.store.write(`workspace-trash-record-${record.id}`, { ...record, contentIdentity: { dev: -1, ino: -1 } });
    const restarted = await f.restart();
    expect((await restarted.listWorkspaceTrash())[0]).toMatchObject({ state: 'recovery', canRestore: false });
    expect((await restarted.listWorkspaceTrash())[0].issue).toContain('original workspace location');
    expect(await fs.readFile(path.join(f.workspace.path, 'keep.txt'), 'utf8')).toBe('still at original location');
  });

  it('finishes a fully copied restore after its acknowledgment was interrupted', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'copied before registration');
    const entry = await f.trash();
    const update = f.store.update.bind(f.store);
    const spy = vi.spyOn(f.store, 'update').mockImplementation(async <T>(key: string, fallback: T, updater: (current: T) => T | Promise<T>): Promise<T> => {
      if (key.startsWith('workspace-untrash-')) throw fsError('EIO');
      return update(key, fallback, updater);
    });
    await expect(f.service.restoreWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    spy.mockRestore();
    await expect(f.service.get(f.workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    const restarted = await f.restart();
    expect((await restarted.get(f.workspace.id)).id).toBe(f.workspace.id);
    expect(await fs.readFile(path.join(f.workspace.path, 'keep.txt'), 'utf8')).toBe('copied before registration');
    await expect(fs.lstat(path.join(f.entryPath(entry.id), 'content'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never activates a partial restore and retains its intact original trash copy after restart', async () => {
    await f.service.writeFile(f.workspace.id, 'a.txt', 'first');
    await f.service.writeFile(f.workspace.id, 'b.txt', 'second');
    const entry = await f.trash();
    const open = fs.open.bind(fs);
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (input, flags, mode) => {
      if (String(input).endsWith('/b.txt') && typeof flags === 'number' && (flags & constants.O_EXCL)) throw fsError('EIO');
      return open(input, flags, mode);
    });
    await expect(f.service.restoreWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    spy.mockRestore();
    const restarted = await f.restart();
    await expect(restarted.get(f.workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    expect((await restarted.listWorkspaceTrash())[0]).toMatchObject({ state: 'recovery', canRestore: false });
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/b.txt'), 'utf8')).toBe('second');
    expect(await fs.readFile(path.join(f.workspace.path, 'a.txt'), 'utf8')).toBe('first');
  });

  it('retries hidden restored-copy cleanup after restart without altering the active restored files', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'restored active bytes');
    const entry = await f.trash();
    const unlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async input => {
      if (String(input).endsWith('/keep.txt')) throw fsError('EIO');
      return unlink(input);
    });
    const restored = await f.service.restoreWorkspaceTrash(entry.id);
    expect(restored.id).toBe(f.workspace.id);
    expect((await f.record(entry.id)).phase).toBe('restored');
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/keep.txt'), 'utf8')).toBe('restored active bytes');
    spy.mockRestore();
    await f.restart();
    await expect(fs.lstat(path.join(f.entryPath(entry.id), 'content'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(f.workspace.path, 'keep.txt'), 'utf8')).toBe('restored active bytes');
  });

  it('does not truncate an external hard-link target during final metadata cleanup', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'delete owned bytes');
    const entry = await f.trash();
    const sentinel = path.join(f.directory, 'outside-hardlink');
    await fs.writeFile(sentinel, 'do not truncate these external bytes');
    await fs.unlink(path.join(f.entryPath(entry.id), 'snapshot.json'));
    await fs.link(sentinel, path.join(f.entryPath(entry.id), 'snapshot.json'));
    await f.service.purgeWorkspaceTrash(entry.id);
    expect(await fs.readFile(sentinel, 'utf8')).toBe('do not truncate these external bytes');
  });

  it('does not let an old delete or old purge remove a later replacement folder', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'old workspace');
    const entry = await f.trash();
    await f.service.purgeWorkspaceTrash(entry.id);
    await fs.mkdir(f.workspace.path);
    await fs.writeFile(path.join(f.workspace.path, 'new.txt'), 'unrelated replacement');
    await expect(f.trash()).rejects.toMatchObject({ code: 'WORKSPACE_ALREADY_DELETED' });
    await f.service.purgeWorkspaceTrash(entry.id);
    expect(await fs.readFile(path.join(f.workspace.path, 'new.txt'), 'utf8')).toBe('unrelated replacement');
    expect((await listTrashRecords(f.config)).length).toBe(1);
  });

  it('does not let an old restore journal purge a newer deletion’s independent file trash', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'first generation');
    const first = await f.trash();
    const update = f.store.update.bind(f.store);
    const spy = vi.spyOn(f.store, 'update').mockImplementation(async <T>(key: string, fallback: T, updater: (current: T) => T | Promise<T>): Promise<T> =>
      update(key, fallback, async current => {
        const next = await updater(current);
        if (key === `workspace-trash-record-${first.id}` && (next as { phase?: unknown })?.phase === 'restored') throw fsError('EIO');
        return next;
      }));
    await expect(f.service.restoreWorkspaceTrash(first.id)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    spy.mockRestore();
    expect((await f.service.get(f.workspace.id)).id).toBe(f.workspace.id);
    await f.service.writeFile(f.workspace.id, 'new-deleted.txt', 'new generation file trash');
    const newFileTrash = await f.service.trashEntry(f.workspace.id, 'new-deleted.txt');
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'second generation');
    const second = await f.trash();
    await f.service.purgeWorkspaceTrash(first.id);
    expect(await fs.readFile(path.join(f.config.workspacesDir, '.trash', f.workspace.id, newFileTrash.id, 'content'), 'utf8')).toBe('new generation file trash');
    expect(await fs.readFile(path.join(f.entryPath(second.id), 'content/keep.txt'), 'utf8')).toBe('second generation');
    await f.service.restoreWorkspaceTrash(second.id);
    await f.service.restoreEntry(f.workspace.id, newFileTrash.id);
    expect(await fs.readFile(path.join(f.workspace.path, 'new-deleted.txt'), 'utf8')).toBe('new generation file trash');
  });

  it('does not let a stale acknowledged restore change a newer restored root’s permissions', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'retained across generations');
    const first = await f.trash();
    const unlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async input => {
      if (String(input).endsWith(`/.codex-restore-${first.id}`)) throw fsError('EIO');
      return unlink(input);
    });
    await expect(f.service.restoreWorkspaceTrash(first.id)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    spy.mockRestore();
    await fs.chmod(f.workspace.path, 0o2750);
    const second = await f.trash();
    await f.service.restoreWorkspaceTrash(second.id);
    expect((await fs.stat(f.workspace.path)).mode & 0o7777).toBe(0o2750);
    await f.restart();
    expect((await fs.stat(f.workspace.path)).mode & 0o7777).toBe(0o2750);
    expect(await fs.readFile(path.join(f.workspace.path, 'keep.txt'), 'utf8')).toBe('retained across generations');
  });

  it('serializes competing service instances into one durable delete intent', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'one retained copy');
    const other = await f.restart();
    const [first, second] = await Promise.all([
      f.service.trashWorkspace(f.workspace.id, { expectedMode: 'trash' }),
      other.trashWorkspace(f.workspace.id, { expectedMode: 'trash' }),
    ]);
    expect(first.mode).toBe('trash');
    expect(second).toEqual(first);
    expect((await listTrashRecords(f.config)).length).toBe(1);
    const record = (await listTrashRecords(f.config))[0];
    expect(await fs.readFile(path.join(f.entryPath(record.id), 'content/keep.txt'), 'utf8')).toBe('one retained copy');
  });

  it('keeps internal metadata-only remove authoritative after trash restoration', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'preserved internal archive');
    const entry = await f.trash();
    await f.service.restoreWorkspaceTrash(entry.id);
    await f.service.remove(f.workspace.id);
    await expect(f.service.get(f.workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    expect(await fs.readFile(path.join(f.workspace.path, 'keep.txt'), 'utf8')).toBe('preserved internal archive');
  });

  it('preserves a substituted directory when owned recursive cleanup receives an old identity', async () => {
    const target = path.join(f.directory, 'owned');
    await fs.mkdir(target);
    const expected = identity(await fs.lstat(target));
    await fs.rename(target, path.join(f.directory, 'old-owned'));
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'sentinel'), 'replacement remains');
    await expect(removeTree(target, expected)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_UNSAFE' });
    expect(await fs.readFile(path.join(target, 'sentinel'), 'utf8')).toBe('replacement remains');
  });

  it('uses native worktree guards and records a missing primary without erasing surviving child files', async () => {
    const repository = await f.service.create({ name: 'Native primary', initializeGit: true });
    await fs.writeFile(path.join(repository.path, 'tracked.txt'), 'native worktree file');
    await git('git', ['-C', repository.path, 'add', 'tracked.txt']);
    await git('git', ['-C', repository.path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
    const id = randomUUID();
    const checkout = path.join(f.config.workspacesDir, id);
    await git('git', ['-C', repository.path, 'worktree', 'add', '--detach', checkout, 'HEAD']);
    const administrative = (await git('git', ['-C', checkout, 'rev-parse', '--absolute-git-dir'])).stdout.trim();
    const now = new Date().toISOString();
    await f.service.registerWorktree({ id, name: 'Managed child', path: checkout, createdAt: now, updatedAt: now,
      worktree: { id, sourceWorkspaceId: repository.id, repositoryWorkspaceId: repository.id, gitDirectory: administrative, commonDirectory: path.join(repository.path, '.git') } });
    await expect(f.service.trashWorkspace(id)).rejects.toMatchObject({ code: 'WORKSPACE_MANAGED_WORKTREE' });
    await expect(f.service.trashWorkspace(repository.id)).rejects.toMatchObject({ code: 'WORKSPACE_HAS_WORKTREES' });
    const preservedPrimary = path.join(f.directory, 'externally-retained-primary');
    await fs.rename(repository.path, preservedPrimary);
    expect((await f.service.list()).some(item => item.id === repository.id)).toBe(false);
    expect((await f.service.listWorkspaceTrash()).find(item => item.workspaceId === repository.id)).toMatchObject({ state: 'missing', canRestore: false });
    expect(await fs.readFile(path.join(checkout, 'tracked.txt'), 'utf8')).toBe('native worktree file');
    expect(await fs.readFile(path.join(preservedPrimary, 'tracked.txt'), 'utf8')).toBe('native worktree file');
    expect((await fs.stat(path.join(preservedPrimary, '.git/worktrees'))).isDirectory()).toBe(true);
  });
});
