import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireWorkspaceActivity } from '../server/worktrees/activity';
import { listTrashRecords, readWorkspaceTrashMetadataExclusions, TRASH_RETENTION_MS } from '../server/workspace-trash/records';
import { fixture, fsError, type TrashFixture } from './workspace-trash-fixture';
import { FileMetadataManager, FILE_METADATA_KEY } from '../server/file-metadata';

describe('workspace trash retention and GitHub deletion', () => {
  let f: TrashFixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });

  it('uses 30 days from deletion, preserves younger trash, and purges expired bytes at startup', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'until thirty days');
    const entry = await f.trash();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(entry.expiresAt) - 1);
    let restarted = await f.restart();
    expect((await restarted.listWorkspaceTrash())[0].id).toBe(entry.id);
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/keep.txt'), 'utf8')).toBe('until thirty days');
    clock.mockReturnValue(Date.parse(entry.expiresAt));
    await expect(restarted.restoreWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_EXPIRED', status: 410 });
    restarted = await f.restart();
    expect(await restarted.listWorkspaceTrash()).toEqual([]);
    expect((await f.record(entry.id)).phase).toBe('purged');
    await expect(fs.lstat(path.join(f.entryPath(entry.id), 'content'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readWorkspaceTrashMetadataExclusions(f.config)).toContain(f.workspace.id);
  });

  it('runs scheduled retention, drains cleanup on close and does not require another restart', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'periodic retention');
    const entry = await f.trash();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(entry.expiresAt) + 1);
    const interval = global.setInterval;
    vi.spyOn(global, 'setInterval').mockImplementation(((callback: (...args: unknown[]) => void) => interval(callback, 20)) as typeof setInterval);
    f.service.startTrashCleanup();
    for (let attempt = 0; attempt < 100 && (await f.record(entry.id)).phase !== 'purged'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await f.service.closeTrashCleanup();
    expect((await f.record(entry.id)).phase).toBe('purged');
    await expect(fs.lstat(path.join(f.entryPath(entry.id), 'content'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains explicit purge intent and retries a real interrupted unlink after restart', async () => {
    await f.service.writeFile(f.workspace.id, 'keep.txt', 'retained after failed unlink');
    const entry = await f.trash();
    const unlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async input => {
      if (String(input).endsWith('/keep.txt')) throw fsError('EACCES');
      return unlink(input);
    });
    await expect(f.service.purgeWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    expect((await f.record(entry.id)).phase).toBe('purging');
    expect((await f.service.listWorkspaceTrash())[0]).toMatchObject({ state: 'recovery', canRestore: false });
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/keep.txt'), 'utf8')).toBe('retained after failed unlink');
    spy.mockRestore();
    await f.restart();
    expect((await f.record(entry.id)).phase).toBe('purged');
    await expect(fs.lstat(path.join(f.entryPath(entry.id), 'content'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not infer GitHub provenance from a mutable account selection or arbitrary PATCH source', async () => {
    await f.service.update(f.workspace.id, { githubAccountId: 'selected-account', source: { kind: 'github', fullName: 'example/forged' } } as never);
    expect((await f.service.get(f.workspace.id)).source).toBeUndefined();
    expect(await f.service.getWorkspaceDeletionPlan(f.workspace.id)).toEqual({ workspaceId: f.workspace.id, mode: 'trash', retentionDays: 30 });
    expect((await f.trash()).canRestore).toBe(true);
  });

  it('permanently deletes a verified native GitHub checkout and its prior file trash without a restorable row', async () => {
    const repository = await f.githubRemote();
    await f.service.writeFile(repository.id, 'work.txt', 'local uncommitted changes');
    await f.service.writeFile(repository.id, 'previous.txt', 'earlier deleted local bytes');
    await f.service.trashEntry(repository.id, 'previous.txt');
    await f.store.write('protected-credentials', { fixture: 'global connection remains' });
    expect(await f.service.getWorkspaceDeletionPlan(repository.id)).toEqual({ workspaceId: repository.id, mode: 'permanent', retentionDays: null });
    await expect(f.service.trashWorkspace(repository.id)).rejects.toMatchObject({ code: 'WORKSPACE_PERMANENT_CONFIRMATION_REQUIRED' });
    expect(await fs.readFile(path.join(repository.path, 'work.txt'), 'utf8')).toBe('local uncommitted changes');
    expect(await f.service.trashWorkspace(repository.id, { expectedMode: 'permanent' })).toEqual({ removed: true, mode: 'permanent', workspaceId: repository.id });
    await expect(fs.lstat(repository.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(f.config.workspacesDir, '.trash', repository.id))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.service.listWorkspaceTrash()).toEqual([]);
    expect(await f.service.listWorkspaceDeletions()).toEqual([]);
    expect(await f.store.read('protected-credentials', null)).toEqual({ fixture: 'global connection remains' });
    const record = (await listTrashRecords(f.config))[0];
    expect(record).toMatchObject({ mode: 'permanent', phase: 'purged' });
    await expect(f.service.restoreWorkspaceTrash(record.id)).rejects.toMatchObject({ status: 404 });
  });

  it('preserves trusted GitHub import provenance across account disconnect and restart', async () => {
    const repository = await f.githubRemote();
    await f.service.completeGithubImport(repository.id, 'saved-import-account', 'example/fixture');
    await f.service.clearGithubAccount(repository.id, 'saved-import-account');
    await fs.rm(path.join(repository.path, '.git'), { recursive: true });
    const restarted = await f.restart();
    expect((await restarted.get(repository.id)).source).toEqual({ kind: 'github', fullName: 'example/fixture' });
    expect((await restarted.get(repository.id)).githubAccountId).toBeUndefined();
    expect((await restarted.getWorkspaceDeletionPlan(repository.id)).mode).toBe('permanent');
  });

  it('requires an actual named remote and real Git identity, including old supported remote syntax', async () => {
    const repository = await f.service.create({ name: 'Native empty repository', initializeGit: true });
    await fs.appendFile(path.join(repository.path, '.git/config'), '\n[remote]\nurl = https://github.com/example/not-a-remote.git\n');
    expect((await f.service.getWorkspaceDeletionPlan(repository.id)).mode).toBe('trash');
    await fs.appendFile(path.join(repository.path, '.git/config'), '\n[remote.origin]\nurl = git@github.com:example/fixture.git\n');
    expect((await f.service.getWorkspaceDeletionPlan(repository.id)).mode).toBe('permanent');
    await fs.mkdir(path.join(f.workspace.path, '.git'));
    await fs.writeFile(path.join(f.workspace.path, '.git/config'), '[remote "origin"]\nurl = https://github.com/example/fixture.git\n');
    await expect(f.service.getWorkspaceDeletionPlan(f.workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_REPOSITORY_UNVERIFIED' });
  });

  it('does not escalate a stale trash confirmation after the repository becomes GitHub-backed', async () => {
    const repository = await f.service.create({ name: 'Remote changes', initializeGit: true });
    expect((await f.service.getWorkspaceDeletionPlan(repository.id)).mode).toBe('trash');
    await fs.appendFile(path.join(repository.path, '.git/config'), '\n[remote "origin"]\nurl = https://github.com/example/fixture.git\n');
    await expect(f.service.trashWorkspace(repository.id, { expectedMode: 'trash' })).rejects.toMatchObject({ code: 'WORKSPACE_DELETION_CHANGED' });
    expect((await fs.stat(repository.path)).isDirectory()).toBe(true);
    expect(await listTrashRecords(f.config)).toEqual([]);
  });

  it('exposes a failed permanent deletion separately and retries only its exact generation', async () => {
    const repository = await f.githubRemote();
    await f.service.writeFile(repository.id, 'keep.txt', 'pending permanent cleanup');
    const unlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async input => {
      if (String(input).endsWith('/keep.txt')) throw fsError('EIO');
      return unlink(input);
    });
    await expect(f.service.trashWorkspace(repository.id, { expectedMode: 'permanent' })).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    expect(await f.service.listWorkspaceTrash()).toEqual([]);
    const status = (await f.service.listWorkspaceDeletions())[0];
    expect(status).toMatchObject({ workspaceId: repository.id, mode: 'permanent', state: 'error' });
    spy.mockRestore();
    expect(await f.service.retryWorkspaceDeletion(status.id)).toEqual({ removed: true, mode: 'permanent', workspaceId: repository.id });
    expect(await f.service.listWorkspaceDeletions()).toEqual([]);
    await fs.mkdir(repository.path);
    await fs.writeFile(path.join(repository.path, 'new.txt'), 'new unrelated local folder');
    await f.service.retryWorkspaceDeletion(status.id);
    expect(await fs.readFile(path.join(repository.path, 'new.txt'), 'utf8')).toBe('new unrelated local folder');
  });

  it('clears prior file trash for a genuinely missing GitHub checkout only after its live lease drains', async () => {
    const repository = await f.githubRemote();
    await f.service.completeGithubImport(repository.id, 'account', 'example/fixture');
    await f.service.writeFile(repository.id, 'old.txt', 'old repository file trash');
    const fileEntry = await f.service.trashEntry(repository.id, 'old.txt');
    await fs.rm(repository.path, { recursive: true });
    const release = acquireWorkspaceActivity(f.config.workspacesDir, repository.id, 'terminal');
    let deletionId = '';
    try {
      expect((await f.service.list()).some(item => item.id === repository.id)).toBe(false);
      const pending = (await f.service.listWorkspaceDeletions())[0];
      deletionId = pending.id;
      expect(pending.state).toBe('pending');
      await expect(f.service.retryWorkspaceDeletion(pending.id)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
      expect(await fs.readFile(path.join(f.config.workspacesDir, '.trash', repository.id, fileEntry.id, 'content'), 'utf8')).toBe('old repository file trash');
    } finally { release(); }
    await f.service.retryWorkspaceDeletion(deletionId);
    await expect(fs.lstat(path.join(f.config.workspacesDir, '.trash', repository.id))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.service.listWorkspaceDeletions()).toEqual([]);
  });

  it('expires per-file trash by its original age even while its ordinary workspace is in trash', async () => {
    await f.service.writeFile(f.workspace.id, 'old.txt', 'old deleted contents');
    await f.service.writeFile(f.workspace.id, 'active.txt', 'keep whole workspace young');
    const fileEntry = await f.service.trashEntry(f.workspace.id, 'old.txt');
    const location = path.join(f.config.workspacesDir, '.trash', f.workspace.id, fileEntry.id);
    const old = new Date(Date.now() - TRASH_RETENTION_MS - 1).toISOString();
    await fs.writeFile(path.join(location, 'metadata.json'), JSON.stringify({ ...fileEntry, deletedAt: old }));
    const workspaceEntry = await f.trash();
    const restarted = await f.restart();
    await expect(fs.lstat(location)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await restarted.listWorkspaceTrash())[0].id).toBe(workspaceEntry.id);
    await restarted.restoreWorkspaceTrash(workspaceEntry.id);
    expect(await fs.readFile(path.join(f.workspace.path, 'active.txt'), 'utf8')).toBe('keep whole workspace young');
    expect(await restarted.listTrash(f.workspace.id)).toEqual([]);
    expect(await readWorkspaceTrashMetadataExclusions(f.config)).toContain(`.trash/${f.workspace.id}/${fileEntry.id}`);
  });

  it('rejects expired file restoration even if an existing terminal defers scheduled cleanup', async () => {
    await f.service.writeFile(f.workspace.id, 'old.txt', 'too old to restore');
    const entry = await f.service.trashEntry(f.workspace.id, 'old.txt');
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(entry.expiresAt) + 1);
    const release = acquireWorkspaceActivity(f.config.workspacesDir, f.workspace.id, 'terminal');
    try {
      const restarted = await f.restart();
      expect((await restarted.listTrash(f.workspace.id))[0].id).toBe(entry.id);
      await expect(restarted.restoreEntry(f.workspace.id, entry.id)).rejects.toMatchObject({ code: 'FILE_TRASH_EXPIRED', status: 410 });
      expect(await fs.readFile(path.join(f.config.workspacesDir, '.trash', f.workspace.id, entry.id, 'content'), 'utf8')).toBe('too old to restore');
    } finally { release(); }
  });

  it('journals interrupted per-file expiry, preserves its metadata until content deletion, and retries after restart', async () => {
    await f.service.writeFile(f.workspace.id, 'old.txt', 'retained during expiry failure');
    const entry = await f.service.trashEntry(f.workspace.id, 'old.txt');
    const directory = path.join(f.config.workspacesDir, '.trash', f.workspace.id, entry.id);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(entry.expiresAt));
    const unlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async input => {
      if (String(input).endsWith('/content')) throw fsError('EIO');
      return unlink(input);
    });
    const restarted = await f.restart();
    expect(await fs.readFile(path.join(directory, 'content'), 'utf8')).toBe('retained during expiry failure');
    expect(JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8')).id).toBe(entry.id);
    expect(await f.store.read(`file-trash-expiry-${entry.id}`, null)).toMatchObject({ phase: 'purging' });
    expect((await restarted.fileTrashStatus(f.workspace.id)).issue).toContain('retained');
    expect(await readWorkspaceTrashMetadataExclusions(f.config)).toContain(`.trash/${f.workspace.id}/${entry.id}`);
    spy.mockRestore();
    const finished = await f.restart();
    await expect(fs.lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.store.read(`file-trash-expiry-${entry.id}`, null)).toMatchObject({ phase: 'purged' });
    expect((await finished.fileTrashStatus(f.workspace.id)).issue).toBeNull();
  });

  it('keeps startup and healthy file recovery usable beside an unsafe expired sibling', async () => {
    await f.service.writeFile(f.workspace.id, 'valid.txt', 'healthy recoverable contents');
    const valid = await f.service.trashEntry(f.workspace.id, 'valid.txt');
    const root = path.join(f.config.workspacesDir, '.trash', f.workspace.id);
    const outside = path.join(f.directory, 'outside-trash');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'sentinel'), 'never follow this link');
    await fs.symlink(outside, path.join(root, randomUUID()));
    const restarted = await f.restart();
    expect((await restarted.fileTrashStatus(f.workspace.id)).issue).toContain('retained');
    expect((await restarted.listTrash(f.workspace.id)).some(item => item.id === valid.id)).toBe(true);
    await restarted.restoreEntry(f.workspace.id, valid.id);
    expect(await fs.readFile(path.join(f.workspace.path, 'valid.txt'), 'utf8')).toBe('healthy recoverable contents');
    expect(await fs.readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('never follow this link');
  });

  it('does not resurrect expired per-file directories or links from a stale native metadata snapshot', async () => {
    await f.service.writeFile(f.workspace.id, 'deleted/nested.txt', 'expired bytes');
    await fs.symlink('nested.txt', path.join(f.workspace.path, 'deleted/link'));
    await f.service.writeFile(f.workspace.id, 'unrelated.txt', 'retain live bytes');
    await fs.mkdir(path.join(f.workspace.path, 'live-empty'));
    await fs.symlink('unrelated.txt', path.join(f.workspace.path, 'live-link'));
    const entry = await f.service.trashEntry(f.workspace.id, 'deleted');
    const manager = new FileMetadataManager(f.config, f.store, undefined, { workspaceRestoreExclusions: () => readWorkspaceTrashMetadataExclusions(f.config) });
    await manager.initialize();
    await manager.close();
    const stale = await f.store.read<unknown>(FILE_METADATA_KEY, null);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(entry.expiresAt) + 1);
    await f.restart();
    const expiredPath = path.join(f.config.workspacesDir, '.trash', f.workspace.id, entry.id);
    await expect(fs.lstat(expiredPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rmdir(path.join(f.workspace.path, 'live-empty'));
    await fs.unlink(path.join(f.workspace.path, 'live-link'));
    await f.store.write(FILE_METADATA_KEY, stale);
    const restoredMetadata = new FileMetadataManager(f.config, f.store, undefined, { workspaceRestoreExclusions: () => readWorkspaceTrashMetadataExclusions(f.config) });
    try {
      await restoredMetadata.initialize();
      await expect(fs.lstat(expiredPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await fs.stat(path.join(f.workspace.path, 'live-empty'))).isDirectory()).toBe(true);
      expect(await fs.readlink(path.join(f.workspace.path, 'live-link'))).toBe('unrelated.txt');
      expect(await fs.readFile(path.join(f.workspace.path, 'unrelated.txt'), 'utf8')).toBe('retain live bytes');
    } finally { await restoredMetadata.close(); }
  });
});
