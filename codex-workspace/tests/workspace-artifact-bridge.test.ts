import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceService } from '../server/workspaces';
import type { Workspace } from '../shared/types';
import type { WorkspaceWorktree } from '../server/worktrees/types';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';
import { withWorkspaceRemoval, workspaceActivityKinds } from '../server/worktrees/activity';
import { fixture, git, type TrashFixture } from './workspace-trash-fixture';

describe('managed workspace artifact ownership bridge', () => {
  let f: TrashFixture;
  const services: WorkspaceService[] = [];
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const service of services.splice(0)) { await service.closeFileTrashPages(); await service.closeTrashCleanup(); }
    await f?.close();
  });

  async function nativeWorktree(): Promise<Workspace & { worktree: WorkspaceWorktree }> {
    const repository = await f.service.create({ name: 'Artifact bridge primary', initializeGit: true });
    await fs.writeFile(path.join(repository.path, 'tracked.txt'), 'Retained native checkout contents');
    await git('git', ['-C', repository.path, 'add', 'tracked.txt']);
    await git('git', ['-C', repository.path, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
    const id = randomUUID(), directory = path.join(f.config.workspacesDir, id);
    await git('git', ['-C', repository.path, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', directory, 'HEAD']);
    const administrative = (await git('git', ['-C', directory, 'rev-parse', '--absolute-git-dir'])).stdout.trim();
    const now = new Date().toISOString();
    const workspace: Workspace & { worktree: WorkspaceWorktree } = { id, name: 'Managed artifact owner', path: directory, createdAt: now, updatedAt: now,
      worktree: { id, sourceWorkspaceId: repository.id, repositoryWorkspaceId: repository.id,
        gitDirectory: administrative, commonDirectory: path.join(repository.path, '.git') } };
    await f.service.registerWorktree(workspace);
    return workspace;
  }

  async function missingArchive() {
    const workspace = await nativeWorktree();
    const parked = path.join(f.directory, `parked-${workspace.id}`);
    await fs.rename(workspace.path, parked);
    const entry = (await f.service.listWorkspaceTrash()).find(record => record.workspaceId === workspace.id)!;
    expect(entry).toMatchObject({ reason: 'missing', state: 'missing' });
    const token = await f.service.getWorktreeArchive(workspace.id);
    await fs.rename(parked, workspace.path);
    return { workspace, entry, token };
  }

  it('forwards cleanup under the caller’s gate without initialization, live-root reads or admission reentry', async () => {
    const artifact = path.join(f.directory, 'owned-managed-artifact');
    await fs.writeFile(artifact, 'Owned native removal backup');
    const expected = { workspaceId: f.workspace.id, deletionId: 'managed-removal-fixture', phase: 'cleanup_pending' };
    await f.store.write('managed-removal-fixture', expected);
    let preflight = 0, checks = 0, calls = 0;
    const service = new WorkspaceService(f.config, f.store, {
      assertWorkspaceDeletionAllowed: async id => { expect(id).toBe(expected.workspaceId); preflight++; },
      cleanupWorkspaceArtifacts: async request => {
        calls++; expect(Object.isFrozen(request)).toBe(true);
        expect(request.deletionId).toBe(expected.deletionId);
        expect(workspaceActivityKinds(f.config.workspacesDir, request.workspaceId).exclusive).toBe(true);
        await fs.unlink(artifact);
      },
    });
    services.push(service);
    vi.spyOn(service, 'initialize').mockImplementation(() => { throw new Error('Cleanup may not initialize workspaces.'); });
    vi.spyOn(service, 'get').mockImplementation(async () => { throw new Error('Cleanup may not require a live checkout.'); });
    expect(service.hasWorkspaceArtifactCleanup()).toBe(true);
    const request: WorkspaceArtifactCleanupRequest = { workspaceId: expected.workspaceId, deletionId: expected.deletionId,
      mode: 'permanent', deletedAt: new Date().toISOString(), assertCurrent: async () => {
        expect(await f.store.read('managed-removal-fixture', null)).toEqual(expected);
        expect(workspaceActivityKinds(f.config.workspacesDir, expected.workspaceId).exclusive).toBe(true);
        checks++;
      } };
    await withWorkspaceRemoval(f.config.workspacesDir, expected.workspaceId, async () => {
      await service.assertWorkspaceDeletionAllowed(expected.workspaceId);
      await service.cleanupWorkspaceArtifacts(request);
    });
    expect(preflight).toBe(1); expect(calls).toBe(1); expect(checks).toBe(2);
    await expect(fs.lstat(artifact)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses required cleanup when not configured and preserves caller-supplied generation failure', async () => {
    const empty = new WorkspaceService(f.config, f.store); services.push(empty);
    const request: WorkspaceArtifactCleanupRequest = { workspaceId: f.workspace.id, deletionId: 'managed-removal-fixture', mode: 'permanent',
      deletedAt: new Date().toISOString(), assertCurrent: async () => undefined };
    expect(empty.hasWorkspaceArtifactCleanup()).toBe(false);
    await expect(empty.cleanupWorkspaceArtifacts(request)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_UNAVAILABLE' });
    let called = false;
    const configured = new WorkspaceService(f.config, f.store, { cleanupWorkspaceArtifacts: async () => { called = true; } }); services.push(configured);
    const stale = new Error('Managed removal generation changed.');
    await expect(configured.cleanupWorkspaceArtifacts({ ...request, assertCurrent: async () => { throw stale; } })).rejects.toBe(stale);
    expect(called).toBe(false);
  });

  it('preserves ordinary managed Archive and exact-identity restoration', async () => {
    const workspace = await nativeWorktree();
    await f.service.remove(workspace.id);
    const token = await f.service.getWorktreeArchive(workspace.id);
    const restored = await f.service.restoreWorktree(workspace, token.generation);
    expect(restored.id).toBe(workspace.id);
    expect(await fs.readFile(path.join(restored.path, 'tracked.txt'), 'utf8')).toBe('Retained native checkout contents');
  });

  it('never reopens a permanently purged managed-missing generation or clears its archive fence', async () => {
    const { workspace, entry, token } = await missingArchive();
    await f.service.purgeWorkspaceTrash(entry.id);
    const marker = await f.store.read(`workspace-archived-${workspace.id}`, null);
    await expect(f.service.getWorktreeArchive(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_PERMANENTLY_DELETED', status: 410 });
    await expect(f.service.restoreWorktree(workspace, token.generation)).rejects.toMatchObject({ code: 'WORKSPACE_PERMANENTLY_DELETED', status: 410 });
    expect(await f.store.read(`workspace-restored-${workspace.id}-${token.generation}`, null)).toBeNull();
    expect(await f.store.read(`workspace-archived-${workspace.id}`, null)).toEqual(marker);
    expect(await fs.readFile(path.join(workspace.path, 'tracked.txt'), 'utf8')).toBe('Retained native checkout contents');
    const restarted = await f.restart();
    await expect(restarted.getWorktreeArchive(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_PERMANENTLY_DELETED' });
  });

  it('also fences reopening after a permanent purge has started but retained cleanup is still pending', async () => {
    const { workspace, entry, token } = await missingArchive();
    const record = await f.record(entry.id);
    await f.store.write(`workspace-trash-record-${entry.id}`, { ...record, phase: 'purging',
      artifactCleanup: { version: 1, state: 'pending', updatedAt: new Date().toISOString() } });
    await expect(f.service.getWorktreeArchive(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_PURGE_IN_PROGRESS' });
    await expect(f.service.restoreWorktree(workspace, token.generation)).rejects.toMatchObject({ code: 'WORKSPACE_PURGE_IN_PROGRESS' });
    expect(await f.store.read(`workspace-restored-${workspace.id}-${token.generation}`, null)).toBeNull();
    expect(await fs.readFile(path.join(workspace.path, 'tracked.txt'), 'utf8')).toBe('Retained native checkout contents');
  });
});
