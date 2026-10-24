import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AppSettings, Workspace } from '../shared/types';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { WorktreeService } from '../server/worktrees';
import { acquireWorkspaceActivity, workspaceActivityKinds } from '../server/worktrees/activity';
import { checkedWorktreeRecord, readWorktreeRecord, worktreeRecordKey } from '../server/worktrees/records';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';
import { assertWorkspaceFileRewindDeletionAllowed } from '../server/agent/file-rewind-cleanup';
import { cleanupWorkspaceArtifacts } from '../server/workspace-artifacts';
import { GitCheckpointService } from '../server/git-checkpoints';
import * as gitModule from '../server/git';

const execute = promisify(execFile);
const cleanup = vi.fn(async (owner: AppContext, request: WorkspaceArtifactCleanupRequest) => cleanupWorkspaceArtifacts(owner, request));
const preflight = vi.fn(async (owner: AppContext, id: string) => assertWorkspaceFileRewindDeletionAllowed(owner, id));
const checkpointMetadata = vi.fn(async () => {});
const exists = (file: string) => fs.lstat(file).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  throw error;
});
let directory: string, ctx: AppContext, source: Workspace, worktrees: WorktreeService;
let contexts: AppContext[], services: WorktreeService[];

function context(withCleanup = true): AppContext {
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'),
    WORKSPACE_PASSWORD: 'worktree-cleanup-fixture-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
  const store = new JsonStore(config.stateDir);
  const settings: AppSettings = { model: 'fixture', reasoningEffort: 'max', autoApprove: false, theme: 'dark', fontSize: 13,
    wordWrap: true, provider: 'openai', apiKeyConfigured: false };
  const value: AppContext = {
    config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    workspaces: new WorkspaceService(config, store, {
      checkpointFileMetadata: () => checkpointMetadata(),
      assertWorkspaceDeletionAllowed: id => preflight(value, id),
      ...(withCleanup ? { cleanupWorkspaceArtifacts: (request: WorkspaceArtifactCleanupRequest) => cleanup(value, request) } : {}),
    }),
    settings: async () => settings, saveSettings: async patch => Object.assign(settings, patch), providerKey: async () => undefined,
  };
  contexts.push(value);
  return value;
}

function service(owner: AppContext): WorktreeService {
  const value = new WorktreeService(owner);
  services.push(value);
  return value;
}

async function command(cwd: string, ...args: string[]): Promise<string> {
  const result = await execute('/usr/bin/git', ['-c', `safe.directory=${cwd}`, '-c', 'core.hooksPath=/dev/null',
    '-c', 'gc.auto=0', '-c', 'user.name=Worktree Cleanup Fixture', '-c', 'user.email=cleanup@example.invalid', ...args], {
    cwd, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  return result.stdout.trim();
}

async function branch(name = 'feature/cleanup') {
  return worktrees.create(source.id, { branch: name, createBranch: true });
}

async function capture(workspace: Workspace): Promise<string> {
  const checkpoints = new GitCheckpointService(ctx);
  try {
    const result = await checkpoints.capture({ workspaceId: workspace.id,
      threadId: `thr_${randomUUID().replaceAll('-', '')}`, turnId: 'turn_fixture', phase: 'before' });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') throw new Error(result.reason);
    return path.join(ctx.config.stateDir, 'git-checkpoints-v1', workspace.id, result.checkpoint.id);
  } finally { await checkpoints.close(); }
}

/** Real signed recovery authority and real retained original bytes; no rewind is replayed. */
async function savedRewind(owner: Workspace, options: { pending?: boolean; family?: string[]; markers?: boolean } = {}) {
  const id = randomUUID(), threadId = `thr_${randomUUID().replaceAll('-', '')}`, turnId = 'turn_rewind_fixture';
  const backupId = `history_${randomUUID().replaceAll('-', '')}`, family = options.family ?? [owner.id];
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const sign = (value: unknown) => createHmac('sha256', ctx.config.sessionSecret).update(JSON.stringify(value)).digest('hex');
  const writeSigned = (key: string, value: unknown) => ctx.store.write(key, { version: 1, value, signature: sign(value) });
  const plan = { version: 1, id, workspaceId: owner.id, threadId, beforeTurnId: turnId, sourceDigest: 'a'.repeat(64), turnIds: [turnId],
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    current: { repository: { root: owner.path, gitDirectory: owner.worktree?.gitDirectory ?? path.join(owner.path, '.git') } },
    target: { workspaceId: owner.id, threadId, turnId }, restore: { files: [], rows: [] } };
  const value = { version: 1, workspaceId: owner.id, threadId, recoveryId: id, selection: { planId: id, version: sign(plan) },
    state: options.pending ? 'pending' : 'complete', blocking: options.pending === true, familyIds: family, sourceDigest: 'a'.repeat(64),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    completion: { workspaceId: owner.id, threadId, recoveryId: id, beforeTurnId: turnId, backupId,
      filesUnchanged: false, filesRewound: 1, restoredPrompt: 'Saved fixture prompt' } };
  const keys = { operation: `file-rewind-operation-${id}`, plan: `file-rewind-plan-${id}`, latest: `file-rewind-latest-${threadId}`,
    turn: `file-rewind-turn-${digest([threadId, turnId])}`, review: `file-rewind-review-${id}`,
    backup: `thread-backup-${backupId}`, journal: `thread-turn-${threadId}-${turnId}` };
  await writeSigned(keys.plan, plan);
  await writeSigned(keys.operation, value);
  if (options.markers !== false) for (const member of family) await writeSigned(`file-rewind-block-${member}`, value);
  await writeSigned(keys.latest, value.selection);
  await writeSigned(keys.turn, { version: 1, workspaceId: owner.id, threadId, turnId,
    before: { status: 'unavailable', code: 'FIXTURE', reason: 'Cleanup does not execute checkpoints.' }, manualPaths: [] });
  await writeSigned(keys.review, { version: 1, recoveryId: id, workspaceId: owner.id, operationDigest: digest(value),
    fileToken: 'a'.repeat(64), threadDigest: 'b'.repeat(64), createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(),
    rows: [], transcript: 'original', index: 'original' });
  await ctx.store.write(keys.backup, { version: 2, threadId, beforeTurnId: turnId, record: {
    thread: { id: threadId, workspaceId: owner.id, messages: [{ role: 'user', content: 'Saved fixture prompt' }] }, input: [],
    turnJournals: { [turnId]: keys.journal } }, turnInputs: [{ turnId, input: [{ role: 'user', content: 'Saved fixture prompt' }] }] });
  await ctx.store.write(keys.journal, { turnId, input: [{ role: 'assistant', content: 'Saved fixture model input' }] });
  const transaction = path.join(ctx.config.stateDir, 'file-rewinds', id);
  for (const name of ['before', 'after', 'parked', 'events', 'objects']) await fs.mkdir(path.join(transaction, name), { recursive: true });
  await fs.writeFile(path.join(transaction, 'identity.json'), JSON.stringify({ version: 1, id, workspaceId: owner.id, threadId,
    createdAt: new Date().toISOString(), paths: ['notes.txt'] }));
  await fs.writeFile(path.join(transaction, 'manifest.json'), JSON.stringify({ version: 1, id, workspaceId: owner.id, threadId, units: [] }));
  await fs.writeFile(path.join(transaction, 'before', '000000'), 'original fixture bytes');
  await fs.writeFile(path.join(transaction, 'after', '000000'), 'staged fixture bytes');
  await fs.writeFile(path.join(transaction, 'parked', '000000'), 'parked original fixture bytes');
  await fs.writeFile(path.join(transaction, 'events', '00000001.json'), JSON.stringify({ id, state: value.state }));
  await fs.writeFile(path.join(transaction, 'objects', '000000'), 'staged fixture object');
  return { transaction, keys, paths: Object.values(keys).map(key => path.join(ctx.config.stateDir, `${key}.json`)) };
}

beforeEach(async () => {
  contexts = []; services = [];
  cleanup.mockReset().mockImplementation((owner, request) => cleanupWorkspaceArtifacts(owner, request));
  preflight.mockReset().mockImplementation((owner, id) => assertWorkspaceFileRewindDeletionAllowed(owner, id));
  checkpointMetadata.mockReset().mockResolvedValue(undefined);
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-worktree-artifacts-'));
  ctx = context();
  source = await ctx.workspaces.create({ name: 'Source fixture', initializeGit: true });
  await fs.writeFile(path.join(source.path, 'notes.txt'), 'committed source\n');
  await command(source.path, 'add', '--all');
  await command(source.path, 'commit', '-m', 'Fixture baseline');
  worktrees = service(ctx);
});

afterEach(async () => {
  for (const owned of services.reverse()) await owned.close();
  vi.restoreAllMocks();
  for (const owner of contexts) await owner.store.flush();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

describe('permanent native worktree artifact cleanup', () => {
  it('cleans only the removed checkout while retaining source/sibling checkpoints and shared settings/accounts', async () => {
    const target = await branch(), sibling = await branch('feature/sibling');
    const targetCheckpoint = await capture(target.workspace), sourceCheckpoint = await capture(source), siblingCheckpoint = await capture(sibling.workspace);
    const rewind = await savedRewind(target.workspace);
    await ctx.store.write('settings', { model: 'saved-fixture-model', fontSize: 15 });
    await ctx.store.write('protected-credentials', { github_fixture: 'synthetic-saved-account-value' });
    const retainedKeys = ['settings', 'protected-credentials'];
    const before = await Promise.all(retainedKeys.map(key => fs.readFile(path.join(ctx.config.stateDir, `${key}.json`))));
    cleanup.mockImplementationOnce(async (owner, request) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(request).toMatchObject({ workspaceId: target.workspace.id, mode: 'permanent' });
      for (const id of [source.id, sibling.workspace.id, target.workspace.id]) {
        expect(workspaceActivityKinds(owner.config.workspacesDir, id)).toEqual({ exclusive: true, counts: {} });
      }
      expect(await exists(target.workspace.path)).toBe(false);
      expect(await exists(target.workspace.worktree!.gitDirectory)).toBe(false);
      expect(await readWorktreeRecord(owner, target.worktree.id)).toMatchObject({ phase: 'artifact-cleanup',
        removal: { nativeRemovedAt: expect.any(String), archiveGeneration: expect.any(String), artifactCleanup: 'pending' } });
      await cleanupWorkspaceArtifacts(owner, request);
    });
    await expect(worktrees.remove(source.id, target.worktree.id)).resolves.toEqual({ removed: true, workspaceId: target.workspace.id });
    expect(await exists(targetCheckpoint)).toBe(false);
    expect(await exists(rewind.transaction)).toBe(false);
    for (const file of rewind.paths) expect(await exists(file), file).toBe(false);
    for (const retained of [sourceCheckpoint, siblingCheckpoint]) expect(await exists(retained)).toBe(true);
    expect(await command(source.path, 'rev-parse', 'refs/heads/feature/cleanup')).toMatch(/^[a-f0-9]{40}$/);
    expect(await fs.readFile(path.join(sibling.workspace.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
    expect(await Promise.all(retainedKeys.map(key => fs.readFile(path.join(ctx.config.stateDir, `${key}.json`))))).toEqual(before);
    expect(await readWorktreeRecord(ctx, target.worktree.id)).toMatchObject({ phase: 'removed', removal: { artifactCleanup: 'complete' } });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('archives without consuming native files, checkpoints or pending rewind recovery', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const rewind = await savedRewind(target.workspace, { pending: true, markers: false });
    await expect(worktrees.archive(source.id, target.worktree.id)).resolves.toMatchObject({ state: 'archived' });
    expect(await exists(snapshot)).toBe(true);
    expect(await fs.readFile(path.join(rewind.transaction, 'parked', '000000'), 'utf8')).toBe('parked original fixture bytes');
    expect(await fs.readFile(path.join(target.workspace.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
    expect(await command(source.path, 'worktree', 'list', '--porcelain')).toContain(`worktree ${target.workspace.path}`);
    expect((await readWorktreeRecord(ctx, target.worktree.id))?.removal).toBeUndefined();
    expect(cleanup).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
  });

  it('keeps a failed artifact phase visible and retries without native removal, still refusing a busy source', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const native = vi.spyOn(gitModule, 'runGit');
    cleanup.mockRejectedValueOnce(new Error('Fixture storage unavailable'));
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_ARTIFACT_CLEANUP_FAILED' });
    expect(await exists(target.workspace.path)).toBe(false);
    expect(await exists(snapshot)).toBe(true);
    expect(await ctx.workspaces.getRegistration(target.workspace.id, { includeArchived: true })).toMatchObject({ id: target.workspace.id });
    await expect(ctx.workspaces.get(target.workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    const expected = { id: target.worktree.id, state: 'recovery', removalPending: true, issue: expect.stringContaining('retry Remove') };
    expect(await worktrees.list(source.id)).toEqual([expect.objectContaining(expected)]);
    expect((await worktrees.listPage(source.id)).items).toEqual([expect.objectContaining(expected)]);
    await expect(worktrees.open(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_REMOVAL_PENDING' });
    await expect(worktrees.archive(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_REMOVAL_PENDING' });
    const release = acquireWorkspaceActivity(ctx.config.workspacesDir, source.id, 'terminal');
    try { await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' }); }
    finally { release(); }
    await expect(worktrees.remove(source.id, target.worktree.id)).resolves.toMatchObject({ removed: true });
    expect(await exists(snapshot)).toBe(false);
    expect(native.mock.calls.filter(([, args]) => args[0] === 'worktree' && args[1] === 'remove')).toHaveLength(1);
    expect(await worktrees.list(source.id)).toEqual([]);
  });

  it('retries final metadata confirmation without repeating completed artifact cleanup', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const native = vi.spyOn(gitModule, 'runGit');
    checkpointMetadata.mockRejectedValueOnce(new Error('Fixture metadata capture unavailable'));
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_REMOVAL_CONFIRMATION_FAILED' });
    expect(await exists(snapshot)).toBe(false);
    expect(await readWorktreeRecord(ctx, target.worktree.id)).toMatchObject({ phase: 'artifact-cleanup', removal: { artifactCleanup: 'complete' } });
    expect(await worktrees.list(source.id)).toEqual([expect.objectContaining({ removalPending: true, issue: expect.stringContaining('metadata confirmation') })]);
    await expect(worktrees.remove(source.id, target.worktree.id)).resolves.toMatchObject({ removed: true });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(native.mock.calls.filter(([, args]) => args[0] === 'worktree' && args[1] === 'remove')).toHaveLength(1);
  });

  it('retains pending artifacts with unavailable startup callbacks and finishes after a configured restart', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const native = vi.spyOn(gitModule, 'runGit');
    cleanup.mockRejectedValueOnce(new Error('Fixture first-attempt interruption'));
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_ARTIFACT_CLEANUP_FAILED' });
    await worktrees.close();
    const unavailable = service(context(false));
    await unavailable.initialize();
    expect(await exists(snapshot)).toBe(true);
    expect(await unavailable.list(source.id)).toEqual([expect.objectContaining({ removalPending: true })]);
    await expect(unavailable.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_UNAVAILABLE' });
    await unavailable.close();
    const restarted = service(context());
    await restarted.initialize();
    expect(await exists(snapshot)).toBe(false);
    expect(await restarted.list(source.id)).toEqual([]);
    expect(await readWorktreeRecord(ctx, target.worktree.id)).toMatchObject({ phase: 'removed', removal: { artifactCleanup: 'complete' } });
    expect(native.mock.calls.filter(([, args]) => args[0] === 'worktree' && args[1] === 'remove')).toHaveLength(1);
  });

  it('refuses cleanup after another archive generation replaces its authority', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const replacement = randomUUID().replaceAll('-', '');
    cleanup.mockImplementationOnce(async (owner, request) => {
      const key = `workspace-archived-${request.workspaceId}`;
      const current = await owner.store.read<Record<string, unknown>>(key, {});
      await owner.store.write(key, { ...current, generation: replacement });
      await request.assertCurrent();
      await cleanupWorkspaceArtifacts(owner, request);
    });
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(await exists(snapshot)).toBe(true);
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(await ctx.workspaces.getWorktreeArchive(target.workspace.id)).toMatchObject({ generation: replacement });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a newer removal journal or delete its retained artifacts', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const replacement = randomUUID();
    cleanup.mockImplementationOnce(async (owner, request) => {
      const current = (await readWorktreeRecord(owner, target.worktree.id))!;
      await owner.store.write(worktreeRecordKey(current.id), { ...current, removal: { ...current.removal!, deletionId: replacement },
        issue: 'New lifecycle fixture owns this row' });
      await request.assertCurrent();
      await cleanupWorkspaceArtifacts(owner, request);
    });
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(await exists(snapshot)).toBe(true);
    expect(await readWorktreeRecord(ctx, target.worktree.id)).toMatchObject({ removal: { deletionId: replacement, artifactCleanup: 'pending' },
      issue: 'New lifecycle fixture owns this row' });
  });

  it('preserves a recreated checkout path and retained snapshots instead of treating it as removal residue', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const native = vi.spyOn(gitModule, 'runGit');
    cleanup.mockImplementationOnce(async (owner, request) => {
      await fs.mkdir(target.workspace.path);
      await fs.writeFile(path.join(target.workspace.path, 'user-sentinel'), 'later user bytes');
      await request.assertCurrent();
      await cleanupWorkspaceArtifacts(owner, request);
    });
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(await fs.readFile(path.join(target.workspace.path, 'user-sentinel'), 'utf8')).toBe('later user bytes');
    expect(await exists(snapshot)).toBe(true);
    expect(native.mock.calls.filter(([, args]) => args[0] === 'worktree' && args[1] === 'remove')).toHaveLength(1);
  });

  it('blocks native deletion for signed unfinished family recovery even when all live barriers and markers are absent', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const rewind = await savedRewind(source, { pending: true, family: [source.id, target.workspace.id], markers: false });
    const native = vi.spyOn(gitModule, 'runGit');
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    expect(await fs.readFile(path.join(target.workspace.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
    expect(await fs.readFile(path.join(rewind.transaction, 'parked', '000000'), 'utf8')).toBe('parked original fixture bytes');
    expect(await exists(snapshot)).toBe(true);
    expect((await readWorktreeRecord(ctx, target.worktree.id))?.removal).toBeUndefined();
    expect(native.mock.calls.filter(([, args]) => args[0] === 'worktree' && args[1] === 'remove')).toHaveLength(0);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('recovers native completion before its receipt without replaying the uncertain Git command', async () => {
    const target = await branch(), snapshot = await capture(target.workspace);
    const original = gitModule.runGit;
    const native = vi.spyOn(gitModule, 'runGit').mockImplementation(async (cwd, args, options) => {
      const result = await original(cwd, args, options);
      if (args[0] === 'worktree' && args[1] === 'remove') throw new HttpError(504, 'Fixture response interrupted after native exit.', 'GIT_TIMEOUT');
      return result;
    });
    await expect(worktrees.remove(source.id, target.worktree.id)).rejects.toMatchObject({ code: 'GIT_TIMEOUT' });
    expect(await exists(target.workspace.path)).toBe(false);
    expect((await readWorktreeRecord(ctx, target.worktree.id))?.removal?.nativeRemovedAt).toBeUndefined();
    expect(await exists(snapshot)).toBe(true);
    await worktrees.close();
    const restarted = service(context());
    await restarted.initialize();
    expect(await exists(snapshot)).toBe(false);
    expect(await readWorktreeRecord(ctx, target.worktree.id)).toMatchObject({ phase: 'removed',
      removal: { nativeRemovedAt: expect.any(String), artifactCleanup: 'complete' } });
    expect(native.mock.calls.filter(([, args]) => args[0] === 'worktree' && args[1] === 'remove')).toHaveLength(1);
  });

  it('keeps completed removal terminal when an unrelated directory later uses the old path', async () => {
    const target = await branch();
    await worktrees.remove(source.id, target.worktree.id);
    const completed = await readWorktreeRecord(ctx, target.worktree.id);
    await fs.mkdir(target.workspace.path);
    await fs.writeFile(path.join(target.workspace.path, 'user-sentinel'), 'new unrelated bytes');
    await worktrees.close();
    const restarted = service(context());
    await restarted.initialize();
    expect(await readWorktreeRecord(ctx, target.worktree.id)).toEqual(completed);
    expect(await restarted.list(source.id)).toEqual([]);
    expect(await fs.readFile(path.join(target.workspace.path, 'user-sentinel'), 'utf8')).toBe('new unrelated bytes');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects cleanup records without exact removal ownership and native/archive receipts', async () => {
    const target = await branch(), record = (await readWorktreeRecord(ctx, target.worktree.id))!;
    const proof = { version: 1, deletionId: randomUUID(), deletedAt: new Date().toISOString(), artifactCleanup: 'pending' };
    for (const invalid of [
      { ...record, phase: 'artifact-cleanup' },
      { ...record, phase: 'artifact-cleanup', removal: proof },
      { ...record, phase: 'removed', removal: { ...proof, artifactCleanup: 'complete' } },
      { ...record, phase: 'archived', removal: proof },
      { ...record, phase: 'removing', workspaceId: source.id, removal: proof },
      { ...record, phase: 'removing', gitDirectory: undefined, removal: proof },
      { ...record, phase: 'removing', removal: { ...proof, deletionId: '../unowned' } },
    ]) expect(() => checkedWorktreeRecord(ctx, invalid)).toThrow(HttpError);
    expect(await fs.readFile(path.join(target.workspace.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
    expect(cleanup).not.toHaveBeenCalled();
  });
});
