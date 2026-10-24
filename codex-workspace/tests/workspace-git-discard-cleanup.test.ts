import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../server/config';
import { HttpError } from '../server/errors';
import { JsonStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { cleanupWorkspaceGitDiscardBackups, GIT_DISCARD_CLEANUP_LIMITS } from '../server/git-discard-cleanup';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';
import { clearWorkspaceRecoveryBarrier, setWorkspaceRecoveryBarrier, withWorkspaceRemoval } from '../server/worktrees/activity';

const target = 'deleted-workspace', peer = 'retained-workspace';
const createdAt = '2026-09-20T10:00:00.000Z', deletedAt = '2026-09-20T11:00:00.000Z';
const ownedText = 'OWNED_DISCARD_SNAPSHOT_delete_after_permanent_workspace_purge';
const peerText = 'PEER_DISCARD_SNAPSHOT_preserve';
const id = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const key = (n: number) => `git-discard-${id(n)}`;
type BackupState = 'pending' | 'ready' | 'restored';
const backup = (workspaceId = target, state: BackupState = 'ready') => ({ workspaceId, createdAt, state, files: [
  { path: 'src/original.txt', before: { kind: 'file', mode: 0o644,
    content: Buffer.from(workspaceId === target ? ownedText : peerText).toString('base64') },
  ...(state === 'pending' ? {} : { after: 'a'.repeat(64) }) },
] });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

describe('permanent workspace Git discard backup cleanup', () => {
  let directory: string, ctx: Parameters<typeof cleanupWorkspaceGitDiscardBackups>[0], request: WorkspaceArtifactCleanupRequest;
  const services: WorkspaceService[] = [];
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-discard-purge-'));
    const config = loadConfig({ DATA_DIR: directory, RUNTIME_DIR: path.join(directory, 'runtime'),
      WORKSPACE_PASSWORD: 'discard-fixture-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    await fs.mkdir(config.stateDir, { recursive: true });
    ctx = { config, store: new JsonStore(config.stateDir) };
    request = { workspaceId: target, deletionId: randomUUID(), mode: 'permanent', deletedAt,
      assertCurrent: vi.fn(async () => undefined) };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const service of services.splice(0)) { await service.closeFileTrashPages(); await service.closeTrashCleanup(); }
    await ctx.store.flush();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const file = (n: number) => path.join(ctx.config.stateDir, `${key(n)}.json`);
  const run = (context = ctx, authority = request) => withWorkspaceRemoval(context.config.workspacesDir, authority.workspaceId,
    () => cleanupWorkspaceGitDiscardBackups(context, authority));
  const seed = (n: number, value: unknown = backup()) => ctx.store.write(key(n), value);

  it('removes pending, ready and restored source snapshots, invalidates warm caches, and preserves peer/global bytes', async () => {
    await seed(1, backup(target, 'pending')); await seed(2); await seed(3, backup(target, 'restored')); await seed(4, backup(peer));
    const peerBefore = await fs.readFile(file(4));
    await ctx.store.read(key(2), null);
    const globals = ['protected-credentials', 'github-accounts', 'settings', 'model-registry', 'extension-state'];
    for (const name of globals) await ctx.store.write(name, { value: `keep-${name}` });
    const guard = vi.spyOn(ctx.store, 'mutateGuarded');
    await run();
    for (const n of [1, 2, 3]) {
      await expect(fs.lstat(file(n))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await ctx.store.read(key(n), null)).toBeNull();
      expect(guard).toHaveBeenCalledWith(key(n), expect.any(Function));
    }
    expect(await fs.readFile(file(4))).toEqual(peerBefore);
    for (const name of globals) expect(await ctx.store.read(name, null)).toEqual({ value: `keep-${name}` });
    expect(request.assertCurrent).toHaveBeenCalled();
    await expect(fs.lstat(path.join(ctx.config.workspacesDir, target))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recognizes binary, executable, symbolic-link and absent-file snapshots without touching their original paths', async () => {
    const value = backup();
    const files = [
      { path: 'binary.bin', before: { kind: 'file', mode: 0o755, content: Buffer.from([0, 255, 1, 128]).toString('base64') }, after: '1'.repeat(64) },
      { path: 'external-link', before: { kind: 'symlink', mode: 0o777, content: Buffer.from('/outside/retained').toString('base64') }, after: '2'.repeat(64) },
      { path: 'previously-absent', before: { kind: 'missing' }, after: '3'.repeat(64) },
    ];
    await seed(1, { ...value, files });
    await run();
    await expect(fs.lstat(file(1))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires an existing removal gate and does not treat a recovery block as deletion authority', async () => {
    await seed(1);
    await expect(cleanupWorkspaceGitDiscardBackups(ctx, request)).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_REMOVAL_REQUIRED' });
    setWorkspaceRecoveryBarrier(ctx.config.workspacesDir, target, { recoveryId: 'pending-rewind', message: 'Keep recovery source.' });
    try {
      await expect(cleanupWorkspaceGitDiscardBackups(ctx, request)).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_REMOVAL_REQUIRED' });
    } finally { clearWorkspaceRecoveryBarrier(ctx.config.workspacesDir, target, 'pending-rewind'); }
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
  });

  it('retains every backup when the lifecycle generation was already superseded', async () => {
    await seed(1);
    const stale = new HttpError(409, 'The workspace was restored.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
    request.assertCurrent = vi.fn(async () => { throw stale; });
    await expect(run()).rejects.toBe(stale);
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
  });

  it('checks the generation between records and stops before deleting a replacement lifetime', async () => {
    await seed(1); await seed(2);
    let current = true;
    request.assertCurrent = async () => { if (!current) throw new HttpError(409, 'New lifetime.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED'); };
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async location => {
      await unlink(location);
      if (String(location).endsWith(`/${key(1)}.json`)) current = false;
    });
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    await expect(fs.lstat(file(1))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await ctx.store.read(key(2), null)).toEqual(backup());
  });

  it('rejects a newer-lifetime timestamp before removing any older backup', async () => {
    await seed(1); await seed(2, { ...backup(), createdAt: '2026-09-20T12:00:00.000Z' });
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_CHANGED' });
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
    expect(await ctx.store.read(key(2), null)).toMatchObject({ createdAt: '2026-09-20T12:00:00.000Z' });
  });

  it('retries a partially completed purge with a fresh store and no live workspace service', async () => {
    await seed(1); await seed(2); await seed(3, backup(peer));
    const unlink = fs.unlink.bind(fs);
    const injected = vi.spyOn(fs, 'unlink').mockImplementation(async location => {
      if (String(location).endsWith(`/${key(2)}.json`)) throw Object.assign(new Error('Fixture storage outage'), { code: 'EIO' });
      return unlink(location);
    });
    await expect(run()).rejects.toMatchObject({ code: 'EIO' });
    await expect(fs.lstat(file(1))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await ctx.store.read(key(2), null)).toEqual(backup());
    injected.mockRestore();
    const fresh = { config: ctx.config, store: new JsonStore(ctx.config.stateDir) };
    await run(fresh);
    await expect(fs.lstat(file(2))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fresh.store.read(key(3), null)).toEqual(backup(peer));
    await run(fresh);
  });

  it('removes exact interrupted JsonStore write copies while retaining peer temporary files', async () => {
    await seed(1); await seed(2, backup(peer));
    const ownedTemporary = `${file(1)}.${randomUUID()}.tmp`, peerTemporary = `${file(2)}.${randomUUID()}.tmp`;
    await fs.writeFile(ownedTemporary, JSON.stringify(backup(target, 'pending')));
    await fs.writeFile(peerTemporary, JSON.stringify(backup(peer, 'pending')));
    const before = await fs.readFile(peerTemporary);
    await run();
    await expect(fs.lstat(file(1))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(ownedTemporary)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(peerTemporary)).toEqual(before);
    expect(await ctx.store.read(key(2), null)).toEqual(backup(peer));
  });

  it('refuses a conflicting temporary owner for the same canonical backup key', async () => {
    await seed(1);
    const temporary = `${file(1)}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(backup(peer)));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_OWNERSHIP' });
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
    expect(JSON.parse(await fs.readFile(temporary, 'utf8'))).toEqual(backup(peer));
  });

  it('serializes deletion behind a real same-key writer and preserves the changed record', async () => {
    await seed(1);
    const entered = deferred(), release = deferred(), guarded = deferred();
    const original = ctx.store.mutateGuarded.bind(ctx.store);
    vi.spyOn(ctx.store, 'mutateGuarded').mockImplementation((name, operation) => {
      if (name === key(1)) guarded.resolve();
      return original(name, operation);
    });
    const replacement = { ...backup(), state: 'restored' };
    const writing = ctx.store.update(key(1), backup(), async () => { entered.resolve(); await release.promise; return replacement; });
    await entered.promise;
    const purging = run();
    // Attach the rejection assertion before releasing the actual queued writer.
    const result = expect(purging).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_CHANGED' });
    try { await guarded.promise; } finally { release.resolve(); }
    await writing; await result;
    expect(await ctx.store.read(key(1), null)).toEqual(replacement);
  });

  it('rejects a state-directory replacement after inventory and preserves both directories', async () => {
    await seed(1);
    const oldDirectory = `${ctx.config.stateDir}-original`;
    const original = ctx.store.mutateGuarded.bind(ctx.store);
    let replaced = false;
    vi.spyOn(ctx.store, 'mutateGuarded').mockImplementation((name, operation) => original(name, async () => {
      if (!replaced) {
        replaced = true;
        await fs.rename(ctx.config.stateDir, oldDirectory);
        await fs.mkdir(ctx.config.stateDir);
        await fs.writeFile(file(1), JSON.stringify(backup(peer)));
      }
      return operation();
    }));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_CHANGED' });
    expect(JSON.parse(await fs.readFile(path.join(oldDirectory, `${key(1)}.json`), 'utf8'))).toEqual(backup());
    expect(JSON.parse(await fs.readFile(file(1), 'utf8'))).toEqual(backup(peer));
  });

  it('refuses symlink records and leaves the external target untouched', async () => {
    const external = path.join(directory, 'external-record.json');
    await fs.writeFile(external, JSON.stringify(backup(peer)));
    await fs.symlink(external, file(1));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_UNSAFE' });
    expect(await fs.readlink(file(1))).toBe(external);
    expect(JSON.parse(await fs.readFile(external, 'utf8'))).toEqual(backup(peer));
  });

  it('refuses a symlink state directory without following it', async () => {
    await seed(1);
    const parked = `${ctx.config.stateDir}-real`;
    await fs.rename(ctx.config.stateDir, parked);
    await fs.symlink(parked, ctx.config.stateDir);
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_UNSAFE' });
    expect(JSON.parse(await fs.readFile(path.join(parked, `${key(1)}.json`), 'utf8'))).toEqual(backup());
  });

  it('refuses hard-linked records and mismatched JsonStore directories', async () => {
    await seed(1);
    const linked = path.join(directory, 'retained-hard-link.json');
    await fs.link(file(1), linked);
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_UNSAFE' });
    expect(JSON.parse(await fs.readFile(linked, 'utf8'))).toEqual(backup());
    const other = { config: ctx.config, store: new JsonStore(path.join(directory, 'other-store')) };
    await expect(run(other)).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_UNSAFE' });
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
  });

  it('retains malformed and oversized files before any safe backup is removed', async () => {
    await seed(1);
    await fs.writeFile(file(2), '{ incomplete backup');
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_OWNERSHIP' });
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
    const sparse = await fs.open(file(2), 'w');
    try { await sparse.truncate(GIT_DISCARD_CLEANUP_LIMITS.recordBytes + 1); } finally { await sparse.close(); }
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_LIMIT' });
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
  });

  it('retains ambiguous backup names while leaving unrelated state names out of the inventory', async () => {
    await seed(1);
    const ambiguous = path.join(ctx.config.stateDir, 'git-discard-not-an-owned-uuid.json');
    await fs.writeFile(ambiguous, JSON.stringify(backup()));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_OWNERSHIP' });
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
    await fs.unlink(ambiguous);
    const unrelated = path.join(ctx.config.stateDir, 'project-backup.json');
    await fs.writeFile(unrelated, 'Unrelated opaque state');
    await run();
    expect(await fs.readFile(unrelated, 'utf8')).toBe('Unrelated opaque state');
  });

  it.each([
    ['missing owner', { ...backup(), workspaceId: undefined }],
    ['unsafe owner', { ...backup(), workspaceId: '../peer' }],
    ['noncanonical date', { ...backup(), createdAt: '2026-09-20' }],
    ['invalid state', { ...backup(), state: ['ready'] }],
    ['unknown fields', { ...backup(), retainedElsewhere: true }],
    ['empty snapshots', { ...backup(), files: [] }],
    ['duplicate paths', { ...backup(), files: [backup().files[0], backup().files[0]] }],
    ['traversal', { ...backup(), files: [{ ...backup().files[0], path: '../peer/private.txt' }] }],
    ['Git metadata', { ...backup(), files: [{ ...backup().files[0], path: '.GiT/config' }] }],
    ['absolute path', { ...backup(), files: [{ ...backup().files[0], path: '/outside/source' }] }],
    ['noncanonical path', { ...backup(), files: [{ ...backup().files[0], path: 'src/./original.txt' }] }],
    ['missing fingerprint', { ...backup(), files: [{ path: 'src/original.txt', before: backup().files[0].before }] }],
    ['pending fingerprint', { ...backup(), state: 'pending' }],
    ['invalid mode', { ...backup(), files: [{ ...backup().files[0], before: { ...backup().files[0].before, mode: 0o7777 } }] }],
    ['invalid base64', { ...backup(), files: [{ ...backup().files[0], before: { ...backup().files[0].before, content: 'c291cmNl!!==' } }] }],
    ['noncanonical padding', { ...backup(), files: [{ ...backup().files[0], before: { ...backup().files[0].before, content: 'Zh==' } }] }],
    ['source on missing snapshot', { ...backup(), files: [{ ...backup().files[0], before: { kind: 'missing', content: 'eA==' } }] }],
  ])('rejects corrupt %s ownership without removing other valid backups', async (_name, value) => {
    await seed(1); await seed(2, value);
    const invalidBefore = await fs.readFile(file(2));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_GIT_DISCARD_CLEANUP_OWNERSHIP' });
    expect(await ctx.store.read(key(1), null)).toEqual(backup());
    expect(await fs.readFile(file(2))).toEqual(invalidBefore);
  });

  async function openService() {
    const context = { config: ctx.config, store: new JsonStore(ctx.config.stateDir) };
    const service = new WorkspaceService(context.config, context.store, {
      cleanupWorkspaceArtifacts: authority => cleanupWorkspaceGitDiscardBackups(context, authority),
    });
    services.push(service); await service.initialize();
    return { service, context };
  }

  it('keeps originals through ordinary trash/restore and removes them at the real 30-day startup purge', async () => {
    const { service, context } = await openService();
    const workspace = await service.create({ name: 'Discard recovery lifetime' });
    await context.store.write(key(1), { ...backup(workspace.id), createdAt: workspace.createdAt });
    const original = await fs.readFile(file(1));
    const first = await service.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    if (first.mode !== 'trash') throw new Error('Expected ordinary trash.');
    expect(await fs.readFile(file(1))).toEqual(original);
    await service.restoreWorkspaceTrash(first.trash.id);
    expect(await fs.readFile(file(1))).toEqual(original);
    const second = await service.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    if (second.mode !== 'trash') throw new Error('Expected ordinary trash.');
    expect(await fs.readFile(file(1))).toEqual(original);
    await service.closeFileTrashPages(); await service.closeTrashCleanup();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(second.trash.expiresAt) + 1);
    const restarted = await openService();
    await expect(fs.lstat(file(1))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await restarted.service.listWorkspaceTrash()).toEqual([]);
    expect(await restarted.context.store.read(`workspace-trash-record-${second.trash.id}`, null)).toMatchObject({
      phase: 'purged', artifactCleanup: { state: 'complete' },
    });
  });
});
