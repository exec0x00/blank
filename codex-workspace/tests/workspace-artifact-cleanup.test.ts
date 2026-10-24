import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { WorkspaceService } from '../server/workspaces';
import { JsonStore } from '../server/store';
import { CheckpointStore, CHECKPOINT_LIMITS } from '../server/git-checkpoints/store';
import { cleanupWorkspaceGitCheckpoints } from '../server/git-checkpoints';
import { assertWorkspaceFileRewindDeletionAllowed, cleanupWorkspaceFileRewinds } from '../server/agent/file-rewind-cleanup';
import { acquireWorkspaceActivity, workspaceActivityKinds, workspaceRecoveryBarrier } from '../server/worktrees/activity';
import type { WorkspaceArtifactCleanupRequest, WorkspaceLifecycleOptions } from '../server/workspace-trash/service';
import { listTrashRecords } from '../server/workspace-trash/records';
import { fixture, fsError, type TrashFixture } from './workspace-trash-fixture';

describe('workspace-owned rewind artifact lifecycle', () => {
  let f: TrashFixture;
  const services: WorkspaceService[] = [];
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const service of services.splice(0)) { await service.closeFileTrashPages(); await service.closeTrashCleanup(); }
    await f?.close();
  });

  async function checkpoint(workspaceId = f.workspace.id, source = 'Owned original source bytes') {
    const store = new CheckpointStore({ config: f.config }, { ...CHECKPOINT_LIMITS });
    const { directory, owner } = await store.create({ workspaceId, threadId: `thr_${randomUUID().replace(/-/g, '')}`, turnId: 'turn_fixture', phase: 'before' });
    const bytes = Buffer.from(source);
    const object = Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]);
    const hash = createHash('sha1').update(object).digest('hex');
    const objectPath = path.join(directory.absolute, 'objects', hash.slice(0, 2), hash.slice(2));
    try {
      await fs.mkdir(path.dirname(objectPath), { recursive: true });
      await fs.writeFile(objectPath, deflateSync(object));
      return { directory: directory.absolute, objectPath, object, owner };
    } finally { await directory.close(); }
  }

  async function hooked(overrides: WorkspaceLifecycleOptions = {}) {
    const service = new WorkspaceService(f.config, new JsonStore(f.config.stateDir), {
      assertWorkspaceDeletionAllowed: id => assertWorkspaceFileRewindDeletionAllowed({ config: f.config }, id),
      cleanupWorkspaceArtifacts: async request => {
        await request.assertCurrent();
        await cleanupWorkspaceFileRewinds(f, request.workspaceId);
        await request.assertCurrent();
        await cleanupWorkspaceGitCheckpoints(f.config, request.workspaceId);
        await request.assertCurrent();
      },
      ...overrides,
    });
    services.push(service);
    await service.initialize();
    return service;
  }

  async function pendingOperation(workspaceId: string, familyIds = [workspaceId]) {
    const id = randomUUID(), threadId = `thr_${randomUUID().replace(/-/g, '')}`;
    const value = { version: 1, workspaceId, threadId, recoveryId: id, familyIds,
      selection: { planId: id, version: 'a'.repeat(64) }, state: 'pending', blocking: true,
      completion: { workspaceId, threadId, recoveryId: id, backupId: `history_${randomUUID().replace(/-/g, '')}`, beforeTurnId: 'turn_fixture' },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await f.store.write(`file-rewind-operation-${id}`, { version: 1, value,
      signature: createHmac('sha256', f.config.sessionSecret).update(JSON.stringify(value)).digest('hex') });
    return id;
  }

  async function trash(service: WorkspaceService) {
    const result = await service.trashWorkspace(f.workspace.id, { expectedMode: 'trash' });
    if (result.mode !== 'trash') throw new Error('Expected ordinary workspace trash.');
    return result.trash;
  }

  it('retains signed checkpoint source through ordinary trash and restore, then removes it on explicit purge', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Original live workspace bytes');
    const saved = await checkpoint();
    const service = await hooked();
    const first = await trash(service);
    expect(inflateSync(await fs.readFile(saved.objectPath))).toEqual(saved.object);
    expect((await f.record(first.id)).artifactCleanup).toBeUndefined();
    await service.restoreWorkspaceTrash(first.id);
    expect(inflateSync(await fs.readFile(saved.objectPath))).toEqual(saved.object);
    const second = await trash(service);
    await service.purgeWorkspaceTrash(second.id);
    await expect(fs.lstat(saved.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.record(second.id)).artifactCleanup).toMatchObject({ version: 1, state: 'complete' });
  });

  it('permanently removes GitHub-owned source bytes while preserving other workspaces and global settings/accounts/models', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'GitHub checkout bytes');
    await f.service.completeGithubImport(f.workspace.id, 'connected-account', 'example/repository');
    const peer = await f.service.create({ name: 'Unrelated artifact owner' });
    const target = await checkpoint();
    const unrelated = await checkpoint(peer.id, 'Other workspace source bytes');
    await f.store.write('protected-credentials', { fixture: 'opaque encrypted account fixture' });
    await f.store.write('settings', { model: 'saved-owner-model', reasoningEffort: 'high' });
    await f.store.write('custom-model-preferences', { preserved: true });
    const observed: WorkspaceArtifactCleanupRequest[] = [];
    const service = await hooked({ cleanupWorkspaceArtifacts: async request => {
      observed.push(request);
      expect(Object.isFrozen(request)).toBe(true);
      expect(workspaceActivityKinds(f.config.workspacesDir, request.workspaceId).exclusive).toBe(true);
      expect(() => acquireWorkspaceActivity(f.config.workspacesDir, request.workspaceId, 'files')).toThrowError();
      await expect(fs.lstat(f.workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.lstat(path.join(f.entryPath(request.deletionId), 'content'))).rejects.toMatchObject({ code: 'ENOENT' });
      await request.assertCurrent();
      await cleanupWorkspaceFileRewinds(f, request.workspaceId);
      await cleanupWorkspaceGitCheckpoints(f.config, request.workspaceId);
      await request.assertCurrent();
    } });
    expect(await service.trashWorkspace(f.workspace.id, { expectedMode: 'permanent' })).toEqual({ removed: true, mode: 'permanent', workspaceId: f.workspace.id });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ workspaceId: f.workspace.id, mode: 'permanent' });
    await expect(fs.lstat(target.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(inflateSync(await fs.readFile(unrelated.objectPath))).toEqual(unrelated.object);
    expect(await f.store.read('protected-credentials', null)).toEqual({ fixture: 'opaque encrypted account fixture' });
    expect(await f.store.read('settings', null)).toEqual({ model: 'saved-owner-model', reasoningEffort: 'high' });
    expect(await f.store.read('custom-model-preferences', null)).toEqual({ preserved: true });
    expect(await service.listWorkspaceDeletions()).toEqual([]);
  });

  it('runs the same source cleanup on the 30-day startup purge without a live workspace or initialized agent', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Expiring workspace bytes');
    const saved = await checkpoint();
    const service = await hooked();
    const entry = await trash(service);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(entry.expiresAt) + 1);
    const restarted = await hooked();
    expect((await f.record(entry.id)).phase).toBe('purged');
    expect((await f.record(entry.id)).artifactCleanup?.state).toBe('complete');
    await expect(fs.lstat(saved.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await restarted.listWorkspaceTrash()).toEqual([]);
  });

  it('rejects a signed pending rewind before ordinary trash moves any files, even without an in-memory marker', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Keep for blocked recovery');
    const saved = await checkpoint();
    await pendingOperation(f.workspace.id);
    expect(workspaceRecoveryBarrier(f.config.workspacesDir, f.workspace.id)).toBeNull();
    const service = await hooked();
    await expect(trash(service)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    expect(await fs.readFile(path.join(f.workspace.path, 'live.txt'), 'utf8')).toBe('Keep for blocked recovery');
    expect(inflateSync(await fs.readFile(saved.objectPath))).toEqual(saved.object);
    expect(await listTrashRecords(f.config)).toEqual([]);
  });

  it('preserves expired trash and checkpoint bytes when startup discovers blocking signed recovery', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Retain while recovery is blocked');
    const saved = await checkpoint();
    const entry = await f.trash();
    await pendingOperation(f.workspace.id);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(entry.expiresAt) + 1);
    const service = await hooked();
    expect((await f.record(entry.id)).phase).toBe('purging');
    expect((await f.record(entry.id)).artifactCleanup).toBeUndefined();
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/live.txt'), 'utf8')).toBe('Retain while recovery is blocked');
    expect(inflateSync(await fs.readFile(saved.objectPath))).toEqual(saved.object);
    await expect(service.purgeWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
  });

  it('persists pending artifact cleanup across a failed leaf and refuses to finish without the configured hook', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Delete only the original payload first');
    await f.service.completeGithubImport(f.workspace.id, 'account', 'example/repository');
    const saved = await checkpoint();
    const service = await hooked({ cleanupWorkspaceArtifacts: async request => {
      await request.assertCurrent();
      throw fsError('EIO');
    } });
    await expect(service.trashWorkspace(f.workspace.id, { expectedMode: 'permanent' })).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_FAILED' });
    const status = (await service.listWorkspaceDeletions())[0];
    const failed = await f.record(status.id);
    expect(failed).toMatchObject({ phase: 'purging', artifactCleanup: { version: 1, state: 'pending' } });
    await expect(fs.lstat(f.workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(inflateSync(await fs.readFile(saved.objectPath))).toEqual(saved.object);
    const noHook = await f.restart();
    await expect(noHook.retryWorkspaceDeletion(status.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_UNAVAILABLE' });
    expect((await f.record(status.id)).artifactCleanup?.state).toBe('pending');
    await hooked();
    expect((await f.record(status.id))).toMatchObject({ phase: 'purged', artifactCleanup: { state: 'complete' } });
    await expect(fs.lstat(saved.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not repeat completed source cleanup when only the final metadata checkpoint needs retry', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Payload');
    await f.service.completeGithubImport(f.workspace.id, 'account', 'example/repository');
    const saved = await checkpoint();
    let cleanupCalls = 0, failCheckpoint = true;
    const service = await hooked({
      cleanupWorkspaceArtifacts: async request => { cleanupCalls++; await request.assertCurrent(); await cleanupWorkspaceGitCheckpoints(f.config, request.workspaceId); },
      checkpointFileMetadata: async () => { if (failCheckpoint) throw fsError('EIO'); },
    });
    await expect(service.trashWorkspace(f.workspace.id, { expectedMode: 'permanent' })).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_RECOVERY' });
    const status = (await service.listWorkspaceDeletions())[0];
    expect((await f.record(status.id)).artifactCleanup?.state).toBe('complete');
    await expect(fs.lstat(saved.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    failCheckpoint = false;
    await service.retryWorkspaceDeletion(status.id);
    expect(cleanupCalls).toBe(1);
    expect((await f.record(status.id)).phase).toBe('purged');
  });

  it('does not let an old pending journal claim a newer workspace generation’s checkpoint sources', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Current workspace');
    const original = await checkpoint();
    let calls = 0;
    const service = await hooked({ cleanupWorkspaceArtifacts: async request => { calls++; await request.assertCurrent(); await cleanupWorkspaceGitCheckpoints(f.config, request.workspaceId); } });
    const first = await trash(service);
    await service.restoreWorkspaceTrash(first.id);
    const newer = await checkpoint(f.workspace.id, 'New lifetime source bytes');
    const second = await trash(service);
    const old = await f.record(first.id);
    await f.store.write(`workspace-trash-record-${first.id}`, { ...old, phase: 'purging',
      artifactCleanup: { version: 1, state: 'pending', updatedAt: new Date().toISOString() } });
    await service.purgeWorkspaceTrash(first.id);
    expect((await f.record(first.id)).artifactCleanup?.state).toBe('superseded');
    expect(calls).toBe(0);
    expect(inflateSync(await fs.readFile(original.objectPath))).toEqual(original.object);
    expect(inflateSync(await fs.readFile(newer.objectPath))).toEqual(newer.object);
    await service.purgeWorkspaceTrash(second.id);
    expect(calls).toBe(1);
    await expect(fs.lstat(original.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(newer.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks generation after asynchronous preflight before adopting independent file trash or deleting source data', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Retain the owned payload');
    await f.service.writeFile(f.workspace.id, 'prior.txt', 'Retain independent file trash');
    const prior = await f.service.trashEntry(f.workspace.id, 'prior.txt');
    const saved = await checkpoint();
    let supersede = false;
    const service = await hooked({ assertWorkspaceDeletionAllowed: async id => {
      if (supersede) await f.store.write(`workspace-archived-${id}`, { id, kind: 'workspace-trash', trashId: randomUUID(), archivedAt: new Date().toISOString() });
    } });
    const entry = await trash(service);
    supersede = true;
    await expect(service.purgeWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/live.txt'), 'utf8')).toBe('Retain the owned payload');
    expect(await fs.readFile(path.join(f.config.workspacesDir, '.trash', f.workspace.id, prior.id, 'content'), 'utf8')).toBe('Retain independent file trash');
    expect(inflateSync(await fs.readFile(saved.objectPath))).toEqual(saved.object);
  });

  it('does not adopt a same-ID same-path replacement registration created during deletion preflight', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Original trash payload must remain');
    const originalSource = await checkpoint();
    let replace = false, cleanupCalls = 0;
    let replacementSource: Awaited<ReturnType<typeof checkpoint>> | undefined;
    const replacementTrashId = randomUUID();
    const replacementTrash = path.join(f.config.workspacesDir, '.trash', f.workspace.id, replacementTrashId);
    const nextCreatedAt = new Date(Date.parse(f.workspace.createdAt) + 60_000).toISOString();
    const service = await hooked({
      assertWorkspaceDeletionAllowed: async id => {
        if (!replace) return;
        // Simulate a later logical registration while deliberately retaining
        // the old tombstone, ID and pathname. Path/generation-only checks are
        // insufficient authority for the replacement's independent artifacts.
        await f.store.write(`workspace-record-${id}`, { ...f.workspace, createdAt: nextCreatedAt, updatedAt: nextCreatedAt });
        await fs.mkdir(f.workspace.path);
        await fs.writeFile(path.join(f.workspace.path, 'replacement.txt'), 'New logical workspace contents');
        await fs.mkdir(replacementTrash, { recursive: true });
        await fs.writeFile(path.join(replacementTrash, 'content'), 'Replacement file trash must remain');
        await fs.writeFile(path.join(replacementTrash, 'metadata.json'), JSON.stringify({ id: replacementTrashId,
          path: 'replacement-deleted.txt', kind: 'file', deletedAt: new Date().toISOString() }));
        replacementSource = await checkpoint(id, 'Replacement checkpoint source must remain');
      },
      cleanupWorkspaceArtifacts: async request => {
        cleanupCalls++;
        await request.assertCurrent();
        await cleanupWorkspaceGitCheckpoints(f.config, request.workspaceId);
      },
    });
    const entry = await trash(service);
    const archive = await f.store.read(`workspace-archived-${f.workspace.id}`, null);
    replace = true;
    await expect(service.purgeWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(cleanupCalls).toBe(0);
    expect(await f.store.read(`workspace-archived-${f.workspace.id}`, null)).toEqual(archive);
    expect((await service.getRegistration(f.workspace.id, { includeArchived: true })).createdAt).toBe(nextCreatedAt);
    expect((await f.record(entry.id)).workspace.createdAt).toBe(f.workspace.createdAt);
    expect((await f.record(entry.id)).artifactCleanup).toBeUndefined();
    expect(await fs.readFile(path.join(f.entryPath(entry.id), 'content/live.txt'), 'utf8')).toBe('Original trash payload must remain');
    expect(await fs.readFile(path.join(f.workspace.path, 'replacement.txt'), 'utf8')).toBe('New logical workspace contents');
    expect(await fs.readFile(path.join(replacementTrash, 'content'), 'utf8')).toBe('Replacement file trash must remain');
    expect(inflateSync(await fs.readFile(originalSource.objectPath))).toEqual(originalSource.object);
    expect(inflateSync(await fs.readFile(replacementSource!.objectPath))).toEqual(replacementSource!.object);
  });

  it('keeps unknown checkpoint entries retryable and never sweeps global state or unrelated historical purges', async () => {
    await f.service.writeFile(f.workspace.id, 'live.txt', 'Payload with retained sources');
    const saved = await checkpoint();
    await fs.writeFile(path.join(saved.directory, 'unowned.txt'), 'Unexpected entry must remain');
    const service = await hooked();
    const entry = await trash(service);
    await expect(service.purgeWorkspaceTrash(entry.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_FAILED' });
    expect((await f.record(entry.id)).artifactCleanup?.state).toBe('pending');
    expect(await fs.readFile(path.join(saved.directory, 'unowned.txt'), 'utf8')).toBe('Unexpected entry must remain');

    const legacy = await f.service.create({ name: 'Historical terminal purge' });
    const historical = await checkpoint(legacy.id, 'Historical data outside this new opt-in cleanup');
    const old = await f.service.trashWorkspace(legacy.id, { expectedMode: 'trash' });
    if (old.mode !== 'trash') throw new Error('Expected historical trash fixture.');
    await f.service.purgeWorkspaceTrash(old.trash.id);
    expect((await f.record(old.trash.id)).artifactCleanup).toBeUndefined();
    await hooked();
    expect(inflateSync(await fs.readFile(historical.objectPath))).toEqual(historical.object);
  });
});
