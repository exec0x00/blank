import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Workspace } from '../shared/types';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { JsonStore } from '../server/store';
import { assertRewindSourceRepairAllowed } from '../server/agent/file-rewind-source-authority';
import { isGitCheckpointRepository } from '../server/git-checkpoints/identity-contract';
import type { GitCheckpointRepository } from '../server/git-checkpoints/types';
import { TRASH_RETENTION_MS, trashRestoreKey, writeTrashRecord } from '../server/workspace-trash/records';
import type { WorkspaceTrashRecord } from '../server/workspace-trash/types';
import { worktreeRecordKey, writeWorktreeRecord } from '../server/worktrees/records';
import type { WorktreeRecord } from '../server/worktrees/types';

const refused = { code: 'FILE_REWIND_SOURCE_REPAIR_REFUSED' };
const randomHex = () => randomUUID().replaceAll('-', '');
const createdAt = '2026-09-20T12:00:00.000Z';
const exists = (filename: string) => fs.lstat(filename).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  throw error;
});
async function physicalIdentity(absolute: string) {
  const stat = await fs.lstat(absolute); return { dev: stat.dev, ino: stat.ino };
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rewind-source-authority-'));
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'),
    WORKSPACE_PASSWORD: 'source-authority-test-password', SESSION_SECRET: 'source-authority-test-secret-'.repeat(3), ENCRYPTION_KEY: 'f'.repeat(64) });
  await fs.mkdir(config.stateDir, { recursive: true }); await fs.mkdir(config.workspacesDir, { recursive: true });
  const store = new JsonStore(config.stateDir), ctx = { config, store } as unknown as AppContext;
  const workspaceAccess = vi.fn(() => { throw new Error('Source repair must not initialize or consult WorkspaceService.'); });
  Object.defineProperty(ctx, 'workspaces', { get: workspaceAccess });
  const id = randomUUID(), threadId = `thr_${randomHex()}`;
  const workspace: Workspace = { id, name: 'Retained workspace', path: path.join(config.workspacesDir, id), createdAt, updatedAt: createdAt };
  const gitDirectory = path.join(workspace.path, '.git');
  await fs.mkdir(gitDirectory, { recursive: true });
  await fs.writeFile(path.join(workspace.path, 'sentinel.txt'), 'Preserve this existing workspace file.');
  await store.write(`workspace-record-${id}`, workspace);
  const repository: GitCheckpointRepository = { root: workspace.path, gitDirectory, commonDirectory: gitDirectory,
    rootIdentity: await physicalIdentity(workspace.path), gitIdentity: await physicalIdentity(gitDirectory), commonIdentity: await physicalIdentity(gitDirectory),
    generation: { version: 1, repository: `repository_${randomHex()}`, checkout: `checkout_${randomHex()}`,
      workspaceId: id, workspaceCreatedAt: createdAt, repositoryWorkspaceId: id, repositoryWorkspaceCreatedAt: createdAt, worktreeId: null },
    observedIn: `boot_${randomHex()}`, objectFormat: 'sha1', head: '1'.repeat(40), headRef: 'refs/heads/main' };
  if (!isGitCheckpointRepository(repository)) throw new Error('The source-authority fixture must satisfy the real signed repository schema.');
  const input = { threadId, workspaceId: id, repository };
  const filename = (key: string) => path.join(config.stateDir, `${key}.json`);
  const archiveKey = (owner: string = id) => `workspace-archived-${owner}`;
  async function trash(options: Partial<WorkspaceTrashRecord> = {}) {
    const deletedAt = '2026-09-20T12:10:00.000Z';
    const record: WorkspaceTrashRecord = { version: 1, id: randomUUID(), workspace: structuredClone(workspace), deletedAt,
      expiresAt: new Date(Date.parse(deletedAt) + TRASH_RETENTION_MS).toISOString(), updatedAt: deletedAt,
      reason: 'deleted', mode: 'trash', phase: 'restored', ...options };
    await writeTrashRecord(config, store, record, true);
    return record;
  }
  async function archiveTrash(record: WorkspaceTrashRecord, restored = false) {
    await store.write(archiveKey(record.workspace.id), { id: record.workspace.id, kind: 'workspace-trash', trashId: record.id, archivedAt: record.deletedAt });
    if (restored) await store.write(trashRestoreKey(record.workspace.id, record.id), { version: 1, id: record.workspace.id, trashId: record.id });
  }
  async function managed() {
    const managedId = randomUUID(), managedCreatedAt = '2026-09-20T12:05:00.000Z';
    const managedPath = path.join(config.workspacesDir, managedId), admin = path.join(gitDirectory, 'worktrees', managedId);
    await fs.mkdir(managedPath); await fs.mkdir(admin, { recursive: true });
    const managedWorkspace: Workspace = { id: managedId, name: 'Managed checkout', path: managedPath, createdAt: managedCreatedAt, updatedAt: managedCreatedAt,
      worktree: { id: managedId, sourceWorkspaceId: id, repositoryWorkspaceId: id, gitDirectory: admin, commonDirectory: gitDirectory } };
    const record: WorktreeRecord = { version: 1, id: managedId, workspaceId: managedId, name: managedWorkspace.name, path: managedPath,
      sourceWorkspaceId: id, sourcePath: workspace.path, repositoryWorkspaceId: id, repositoryPath: workspace.path,
      commonDirectory: gitDirectory, gitDirectory: admin, createdAt: managedCreatedAt, updatedAt: managedCreatedAt,
      phase: 'ready', expectedHead: repository.head!, createdBranch: false };
    const captured: GitCheckpointRepository = { ...repository, root: managedPath, gitDirectory: admin,
      rootIdentity: await physicalIdentity(managedPath), gitIdentity: await physicalIdentity(admin),
      generation: { ...repository.generation, checkout: `checkout_${randomHex()}`, workspaceId: managedId,
        workspaceCreatedAt: managedCreatedAt, worktreeId: managedId } };
    if (!isGitCheckpointRepository(captured)) throw new Error('The managed fixture must satisfy the real signed repository schema.');
    await store.write(`workspace-record-${managedId}`, managedWorkspace); await writeWorktreeRecord(ctx, record);
    return { workspace: managedWorkspace, record, input: { threadId, workspaceId: managedId, repository: captured } };
  }
  return { directory, config, store, ctx, workspace, workspaceAccess, repository, threadId, input, filename, archiveKey, trash, archiveTrash, managed,
    async close() { await store.flush(); await fs.rm(directory, { recursive: true, force: true }); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
let f: Fixture;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });

describe('missing rewind transcript source authority', () => {
  it('permits the exact active registration using readonly lifecycle records without opening WorkspaceService', async () => {
    const stateBefore = (await fs.readdir(f.config.stateDir)).sort();
    const registration = await fs.readFile(f.filename(`workspace-record-${f.workspace.id}`));
    await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).resolves.toBeUndefined();
    expect(f.workspaceAccess).not.toHaveBeenCalled();
    expect((await fs.readdir(f.config.stateDir)).sort()).toEqual(stateBefore);
    expect(await fs.readFile(f.filename(`workspace-record-${f.workspace.id}`))).toEqual(registration);
    expect(await fs.readFile(path.join(f.workspace.path, 'sentinel.txt'), 'utf8')).toBe('Preserve this existing workspace file.');
    expect(await exists(f.filename(`thread-${f.threadId}`))).toBe(false);
  });

  it('does not read the canonical thread through JsonStore while its real recovery queue is held', async () => {
    const key = `thread-${f.threadId}`, read = f.store.read.bind(f.store), readVersion = f.store.readWithVersion.bind(f.store);
    const reads = vi.spyOn(f.store, 'read').mockImplementation(async <T>(requested: string, fallback: T): Promise<T> => {
      if (requested === key) throw new Error('A canonical-key read from inside its own recovery queue would deadlock.');
      return read(requested, fallback);
    });
    const versionReads = vi.spyOn(f.store, 'readWithVersion').mockImplementation(async <T>(requested: string, fallback: T) => {
      if (requested === key) throw new Error('A canonical version read from inside its own recovery queue would deadlock.');
      return readVersion(requested, fallback);
    });
    const checkAllowed = vi.fn(() => assertRewindSourceRepairAllowed(f.ctx, f.input));
    const before = (await fs.readdir(f.config.stateDir)).sort();
    // No recovery bundle exists: the real conditional repair calls its guard
    // inside the per-key queue, then honestly reports that nothing was restored.
    await expect(f.store.recoverConditionalKey(key, { threadId: f.threadId, workspaceId: f.workspace.id,
      expectedLogicalDigest: 'a'.repeat(64), expectedRawSha256: 'b'.repeat(64), desiredRawSha256: 'c'.repeat(64), checkAllowed })).resolves.toBe(false);
    expect(checkAllowed.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(reads.mock.calls.every(([requested]) => requested !== key)).toBe(true);
    expect(versionReads.mock.calls.every(([requested]) => requested !== key)).toBe(true);
    expect((await fs.readdir(f.config.stateDir)).sort()).toEqual(before);
    expect(f.workspaceAccess).not.toHaveBeenCalled();
  });

  it.each(['valid JSON', 'null', 'malformed JSON', 'directory', 'dangling symlink', 'ordinary symlink'] as const)
    ('refuses any deleted-thread marker, including %s', async kind => {
      const marker = f.filename(`thread-deleted-${f.threadId}`);
      if (kind === 'directory') await fs.mkdir(marker);
      else if (kind === 'dangling symlink') await fs.symlink(path.join(f.directory, 'absent-marker-target'), marker);
      else if (kind === 'ordinary symlink') {
        const target = path.join(f.directory, 'unrelated-marker-target'); await fs.writeFile(target, 'null\n'); await fs.symlink(target, marker);
      } else await fs.writeFile(marker, kind === 'valid JSON' ? JSON.stringify({ id: f.threadId, deletedAt: createdAt }) : kind === 'null' ? 'null\n' : '{incomplete');
      await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toMatchObject(refused);
      expect(await exists(marker)).toBe(true);
      expect(await exists(f.filename(`thread-${f.threadId}`))).toBe(false);
      expect(f.workspaceAccess).not.toHaveBeenCalled();
    });

  it.each(['missing', 'null'] as const)('refuses a %s workspace registration instead of recreating it', async state => {
    const key = `workspace-record-${f.workspace.id}`;
    if (state === 'missing') await f.store.delete(key); else await f.store.write(key, null);
    await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toMatchObject(refused);
    expect(await f.store.read(key, null)).toBeNull();
    expect(f.workspaceAccess).not.toHaveBeenCalled();
  });

  it.each(['id', 'creation time', 'path', 'worktree identity'] as const)('refuses a replaced registration with a different %s', async changed => {
    const replacement = structuredClone(f.workspace);
    if (changed === 'id') replacement.id = randomUUID();
    if (changed === 'creation time') replacement.createdAt = '2026-09-20T13:00:00.000Z';
    if (changed === 'path') replacement.path += '-replacement';
    if (changed === 'worktree identity') replacement.worktree = { id: randomUUID(), sourceWorkspaceId: f.workspace.id,
      repositoryWorkspaceId: f.workspace.id, gitDirectory: f.repository.gitDirectory, commonDirectory: f.repository.commonDirectory };
    await f.store.write(`workspace-record-${f.workspace.id}`, replacement);
    await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toMatchObject(refused);
    expect(await f.store.read(`workspace-record-${f.workspace.id}`, null)).toEqual(replacement);
  });

  it('does not give a legacy repository an invented logical generation', async () => {
    const legacy: Partial<GitCheckpointRepository> = { ...f.repository }; delete legacy.generation;
    await expect(assertRewindSourceRepairAllowed(f.ctx, { ...f.input, repository: legacy as GitCheckpointRepository })).rejects.toMatchObject(refused);
  });

  it.each(['null', 'invalid generation version', 'invalid observation nonce', 'unexpected field'] as const)
    ('refuses a malformed captured repository with %s before granting source repair', async invalid => {
      const repository: unknown = invalid === 'null' ? null
        : invalid === 'invalid generation version' ? { ...f.repository, generation: { ...f.repository.generation, version: 2 } }
        : invalid === 'invalid observation nonce' ? { ...f.repository, observedIn: 'not-an-observation' }
        : { ...f.repository, unexpectedAuthority: 'This field cannot extend a signed repository schema.' };
      expect(isGitCheckpointRepository(repository)).toBe(false);
      await expect(assertRewindSourceRepairAllowed(f.ctx, { ...f.input, repository: repository as GitCheckpointRepository })).rejects.toMatchObject(refused);
      expect(await exists(f.filename(`thread-${f.threadId}`))).toBe(false);
    });

  it.each(['outside the root', 'unnormalized'] as const)('refuses a registration path %s even when captured path text matches it', async kind => {
    const badPath = kind === 'outside the root' ? path.join(f.directory, 'elsewhere') : `${f.config.workspacesDir}/unused/../${f.workspace.id}`;
    await f.store.write(`workspace-record-${f.workspace.id}`, { ...f.workspace, path: badPath });
    await expect(assertRewindSourceRepairAllowed(f.ctx, { ...f.input, repository: { ...f.repository, root: badPath } })).rejects.toMatchObject(refused);
  });

  it('permits a restored trash archive only with its exact acknowledgement and a restored journal', async () => {
    const record = await f.trash(); await f.archiveTrash(record, true);
    await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).resolves.toBeUndefined();
    expect(await exists(f.filename(f.archiveKey()))).toBe(true);
    expect(await exists(f.filename(trashRestoreKey(f.workspace.id, record.id)))).toBe(true);
  });

  it.each(['missing', 'other deletion', 'other workspace', 'wrong version', 'null'] as const)
    ('refuses a trash archive with a %s restore acknowledgement', async state => {
      const record = await f.trash(); await f.archiveTrash(record);
      const key = trashRestoreKey(f.workspace.id, record.id);
      if (state !== 'missing') await f.store.write(key, state === 'null' ? null : { version: state === 'wrong version' ? 2 : 1,
        id: state === 'other workspace' ? randomUUID() : f.workspace.id, trashId: state === 'other deletion' ? randomUUID() : record.id });
      await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toMatchObject(refused);
    });

  it('does not reuse an older trash acknowledgement for a later archive generation', async () => {
    const old = await f.trash(); await f.archiveTrash(old, true);
    const current = await f.trash(); await f.archiveTrash(current);
    await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toMatchObject(refused);
    expect(await exists(f.filename(trashRestoreKey(f.workspace.id, old.id)))).toBe(true);
  });

  it.each([null, {}, { id: 'other', kind: 'managed-worktree', generation: 'a'.repeat(32) }])
    ('does not confuse a stored malformed archive marker with an absent marker (%j)', async marker => {
      await f.store.write(f.archiveKey(), marker);
      await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toMatchObject(refused);
      expect(await exists(f.filename(f.archiveKey()))).toBe(true);
    });

  it('fails closed when lifecycle metadata cannot be parsed, without deleting the bad evidence', async () => {
    const filename = f.filename(f.archiveKey()); await fs.writeFile(filename, '{broken archive');
    await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toBeInstanceOf(Error);
    expect(await fs.readFile(filename, 'utf8')).toBe('{broken archive');
  });

  it.each(['preparing', 'ready', 'missing', 'restoring', 'purging', 'purged', 'recovery'] as const)
    ('refuses a matching %s trash/permanent-cleanup journal even when an archive has a restore acknowledgement', async phase => {
      const record = await f.trash({ phase, mode: ['purging', 'purged'].includes(phase) ? 'permanent' : 'trash' });
      await f.archiveTrash(record, true);
      await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toMatchObject(refused);
    });

  it.each(['pending', 'complete'] as const)('does not certify a contradictory restored journal with %s artifact cleanup', async state => {
    const record = await f.trash({ phase: 'restored', mode: 'permanent', artifactCleanup: { version: 1, state, updatedAt: createdAt } });
    await f.archiveTrash(record, true);
    await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).rejects.toMatchObject(refused);
  });

  it('allows a cancelled cleanup and does not apply an older registration lifetime’s purge to this one', async () => {
    await f.trash({ phase: 'cancelled', artifactCleanup: { version: 1, state: 'superseded', updatedAt: createdAt } });
    await f.trash({ phase: 'purged', mode: 'permanent', workspace: { ...f.workspace, createdAt: '2026-09-19T12:00:00.000Z' } });
    await expect(assertRewindSourceRepairAllowed(f.ctx, f.input)).resolves.toBeUndefined();
  });

  it('permits a ready managed checkout bound to the captured primary repository and administration directory', async () => {
    const managed = await f.managed();
    await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).resolves.toBeUndefined();
    expect(f.workspaceAccess).not.toHaveBeenCalled();
  });

  it.each(['missing', 'null', 'different id', 'different creation time', 'different path', 'managed primary'] as const)
    ('refuses a managed checkout whose primary registration is %s', async changed => {
      const managed = await f.managed(), primaryKey = `workspace-record-${f.workspace.id}`;
      const currentCheckout = await fs.readFile(f.filename(`workspace-record-${managed.workspace.id}`));
      const primary = structuredClone(f.workspace);
      if (changed === 'missing') await f.store.delete(primaryKey);
      else if (changed === 'null') await f.store.write(primaryKey, null);
      else {
        if (changed === 'different id') primary.id = randomUUID();
        if (changed === 'different creation time') primary.createdAt = '2026-09-20T14:00:00.000Z';
        if (changed === 'different path') primary.path += '-replacement';
        if (changed === 'managed primary') primary.worktree = { ...managed.workspace.worktree!, id: primary.id };
        await f.store.write(primaryKey, primary);
      }
      await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).rejects.toMatchObject(refused);
      expect(await fs.readFile(f.filename(`workspace-record-${managed.workspace.id}`))).toEqual(currentCheckout);
      expect(await exists(f.filename(`thread-${f.threadId}`))).toBe(false);
    });

  it('permits an acknowledged managed archive only for that exact generation and a ready checkout', async () => {
    const managed = await f.managed(), generation = randomHex();
    await f.store.write(f.archiveKey(managed.workspace.id), { id: managed.workspace.id, kind: 'managed-worktree', generation, archivedAt: createdAt });
    await f.store.write(`workspace-restored-${managed.workspace.id}-${generation}`, { version: 1, id: managed.workspace.id, generation });
    await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).resolves.toBeUndefined();
    await writeWorktreeRecord(f.ctx, { ...managed.record, phase: 'archived' });
    await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).rejects.toMatchObject(refused);
  });

  it.each(['missing', 'different generation', 'different owner', 'wrong version', 'null'] as const)
    ('refuses a managed archive with a %s restore acknowledgement', async state => {
      const managed = await f.managed(), generation = randomHex();
      await f.store.write(f.archiveKey(managed.workspace.id), { id: managed.workspace.id, kind: 'managed-worktree', generation, archivedAt: createdAt });
      if (state !== 'missing') await f.store.write(`workspace-restored-${managed.workspace.id}-${generation}`, state === 'null' ? null : {
        version: state === 'wrong version' ? 2 : 1, id: state === 'different owner' ? f.workspace.id : managed.workspace.id,
        generation: state === 'different generation' ? randomHex() : generation,
      });
      await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).rejects.toMatchObject(refused);
    });

  it.each(['creating', 'archived', 'removing', 'artifact-cleanup', 'removed', 'recovery'] as const)
    ('refuses a managed checkout in %s instead of reviving its thread', async phase => {
      const managed = await f.managed(), removal = phase === 'artifact-cleanup' || phase === 'removed' ? {
        version: 1 as const, deletionId: randomUUID(), deletedAt: createdAt, nativeRemovedAt: createdAt,
        archiveGeneration: randomHex(), artifactCleanup: phase === 'removed' ? 'complete' as const : 'pending' as const,
      } : undefined;
      await writeWorktreeRecord(f.ctx, { ...managed.record, phase, ...(removal ? { removal } : {}) });
      await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).rejects.toMatchObject(refused);
      expect(await exists(f.filename(`thread-${f.threadId}`))).toBe(false);
    });

  it('refuses a managed registration whose authoritative worktree record was deleted', async () => {
    const managed = await f.managed(); await f.store.delete(worktreeRecordKey(managed.record.id));
    await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).rejects.toMatchObject(refused);
  });

  it.each(['workspace owner', 'Git administration directory', 'common directory', 'primary repository'] as const)
    ('refuses a managed record with changed %s binding', async changed => {
      const managed = await f.managed(), record = { ...managed.record };
      if (changed === 'workspace owner') record.workspaceId = randomUUID();
      if (changed === 'Git administration directory') record.gitDirectory = path.join(record.commonDirectory, 'worktrees', randomUUID());
      if (changed === 'common directory') {
        record.repositoryPath += '-replacement'; record.commonDirectory = path.join(record.repositoryPath, '.git');
        record.gitDirectory = path.join(record.commonDirectory, 'worktrees', record.id);
      }
      if (changed === 'primary repository') record.repositoryWorkspaceId = randomUUID();
      await writeWorktreeRecord(f.ctx, record);
      await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).rejects.toMatchObject(refused);
    });

  it.each(['gitDirectory', 'commonDirectory', 'repositoryWorkspaceId', 'sourceWorkspaceId'] as const)
    ('refuses contradictory current registration %s even while the managed record still matches the checkpoint', async field => {
      const managed = await f.managed(), worktree = { ...managed.workspace.worktree! };
      worktree[field] = field.endsWith('Directory') ? `${worktree[field]}-replacement` : randomUUID();
      const recordFile = f.filename(worktreeRecordKey(managed.record.id));
      const authoritativeBytes = await fs.readFile(recordFile);
      await f.store.write(`workspace-record-${managed.workspace.id}`, { ...managed.workspace, worktree });
      await expect(assertRewindSourceRepairAllowed(f.ctx, managed.input)).rejects.toMatchObject(refused);
      expect(await fs.readFile(recordFile)).toEqual(authoritativeBytes);
    });

  it('refuses a managed checkout path different from its authoritative worktree record even when registration and captured path agree', async () => {
    const managed = await f.managed(), changedPath = `${managed.workspace.path}-moved`;
    await f.store.write(`workspace-record-${managed.workspace.id}`, { ...managed.workspace, path: changedPath });
    await expect(assertRewindSourceRepairAllowed(f.ctx, { ...managed.input,
      repository: { ...managed.input.repository, root: changedPath } })).rejects.toMatchObject(refused);
  });
});
