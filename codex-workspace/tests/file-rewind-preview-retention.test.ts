import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { JsonStore } from '../server/store';
import { FileRewindService, type FileRewindHistorySource } from '../server/agent/file-rewind';
import { FILE_REWIND_LIMITS, type FileRewindSelection } from '../server/agent/file-rewind-types';
import { clearWorkspaceRecoveryBarrier, withWorkspaceRemoval, workspaceIsBusy } from '../server/worktrees/activity';

const RECEIPTS = 'file-rewind-expired-previews';
interface Signed<T> { version: 1; value: T; signature: string }
interface Receipt { id: string; threadId: string; workspaceId: string; selectionVersion: string; discardedAt: string }
interface Receipts { version: 1; previews: Receipt[] }
const threadId = () => `thr_${randomUUID().replaceAll('-', '')}`;
const exists = (filename: string) => fs.lstat(filename).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  throw error;
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

class ObservedStore extends JsonStore {
  receiptUpdateRequested?: () => void;
  override update<T>(key: string, fallback: T, updater: (current: T) => T | Promise<T>): Promise<T> {
    if (key === RECEIPTS) this.receiptUpdateRequested?.();
    // Delays in these tests are inside the real JsonStore queue, not a replacement writer.
    return super.update(key, fallback, updater);
  }
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rewind-preview-retention-'));
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'),
    WORKSPACE_PASSWORD: 'test-only-retention-password', SESSION_SECRET: 'preview-retention-test-secret-'.repeat(3), ENCRYPTION_KEY: 'e'.repeat(64) });
  await fs.mkdir(config.stateDir, { recursive: true });
  const store = new ObservedStore(config.stateDir), events = new EventEmitter();
  const ctx = { config, store, events } as unknown as AppContext;
  Object.defineProperty(ctx, 'workspaces', { get() { throw new Error('Preview retention must not open or initialize a live workspace.'); } });
  const workspaceId = randomUUID(), services: FileRewindService[] = [], barriers: Array<{ workspaceId: string; recoveryId: string }> = [];
  const sign = (value: unknown) => createHmac('sha256', config.sessionSecret).update(JSON.stringify(value)).digest('hex');
  const envelope = <T>(value: T): Signed<T> => ({ version: 1, value, signature: sign(value) });
  const filename = (key: string) => path.join(config.stateDir, `${key}.json`);
  function service(): FileRewindService { const value = new FileRewindService(ctx); services.push(value); return value; }
  async function preview(options: { expiresAt?: number; workspaceId?: string; threadId?: string } = {}) {
    const id = randomUUID(), owner = options.workspaceId ?? workspaceId, thread = options.threadId ?? threadId();
    const source: FileRewindHistorySource = { workspaceId: owner, threadId: thread, beforeTurnId: 'turn-retention',
      turnIds: ['turn-retention'], sourceDigest: 'a'.repeat(64) };
    const value = { ...source, version: 1 as const, id, createdAt: new Date(Date.now() - 600_000).toISOString(),
      expiresAt: new Date(options.expiresAt ?? Date.now() - 1_000).toISOString(),
      target: { version: 1 as const, id: `gcp_${randomUUID().replaceAll('-', '')}`, workspaceId: owner, threadId: thread,
        turnId: source.beforeTurnId, phase: 'before' as const, createdAt: '2026-09-20T00:00:00.000Z', manifestHash: 'b'.repeat(64) },
      current: { repository: { root: path.join(config.workspacesDir, owner), gitDirectory: path.join(config.workspacesDir, owner, '.git'),
        commonDirectory: path.join(config.workspacesDir, owner, '.git'), rootIdentity: { dev: 1, ino: 100 },
        gitIdentity: { dev: 1, ino: 101 }, commonIdentity: { dev: 1, ino: 101 }, objectFormat: 'sha1' as const,
        head: '1'.repeat(40), headRef: 'refs/heads/main',
        generation: { version: 1 as const, repository: 'repository_' + 'a'.repeat(32), checkout: 'checkout_' + 'b'.repeat(32),
          workspaceId: owner, workspaceCreatedAt: '2026-09-20T00:00:00.000Z', repositoryWorkspaceId: owner,
          repositoryWorkspaceCreatedAt: '2026-09-20T00:00:00.000Z', worktreeId: null }, observedIn: 'boot_' + 'c'.repeat(32) }, files: [],
        index: { present: false, bytes: 0, sha256: null, blob: null, format: null, entries: [], extensions: [] }, token: 'c'.repeat(64) },
      restore: { files: [], index: [], rows: [], warnings: [], indexConflict: false } };
    const key = `file-rewind-plan-${id}`, selection: FileRewindSelection = { planId: id, version: sign(value) };
    await store.write(key, envelope(value));
    return { id, key, owner, thread, value, selection };
  }
  async function operation(plan: Awaited<ReturnType<typeof preview>>, state: 'pending' | 'complete' | 'recovery_required' = 'complete') {
    const blocking = state !== 'complete';
    const value = { version: 1, threadId: plan.thread, workspaceId: plan.owner, selection: plan.selection, recoveryId: plan.id,
      state, blocking, familyIds: [plan.owner], sourceDigest: plan.value.sourceDigest,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      completion: { beforeTurnId: plan.value.beforeTurnId, workspaceId: plan.owner, threadId: plan.thread,
        planId: plan.id, planVersion: plan.selection.version, restoredPrompt: 'Retained prompt', filesUnchanged: false,
        filesRewound: 1, backupId: `history_${randomUUID().replaceAll('-', '')}`, recoveryId: plan.id } };
    await store.write(`file-rewind-operation-${plan.id}`, envelope(value));
    if (blocking) barriers.push({ workspaceId: plan.owner, recoveryId: plan.id });
    return value;
  }
  return { directory, config, store, ctx, workspaceId, services, sign, envelope, filename, service, preview, operation,
    async close() {
      for (const value of services) await value.close();
      await store.flush();
      for (const value of barriers) clearWorkspaceRecoveryBarrier(config.workspacesDir, value.workspaceId, value.recoveryId);
      await fs.rm(directory, { recursive: true, force: true });
    } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
let f: Fixture;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });

describe('unused signed rewind preview retention', () => {
  it('prunes only expired unused plans while retaining live plans, checkpoints and unrelated persistent state', async () => {
    const expired = await f.preview(), live = await f.preview({ expiresAt: Date.now() + 60_000 });
    await f.store.write('settings', { skills: ['durable skill'], workflows: ['release'] });
    await f.store.write('protected-credentials', { encrypted: 'unrelated fixture credential' });
    const checkpoint = path.join(f.config.stateDir, 'git-checkpoints', 'retained-checkpoint');
    await fs.mkdir(checkpoint, { recursive: true }); await fs.writeFile(path.join(checkpoint, 'original'), 'keep checkpoint bytes');
    const service = f.service(); await service.initialize();

    expect(await exists(f.filename(expired.key))).toBe(false);
    expect(await exists(f.filename(live.key))).toBe(true);
    expect(await service.status(expired.thread, expired.selection)).toEqual({ status: 'not_started', ...expired.selection });
    expect(await service.status(live.thread, live.selection)).toEqual({ status: 'not_started', ...live.selection });
    expect(await f.store.read('settings', null)).toEqual({ skills: ['durable skill'], workflows: ['release'] });
    expect(await f.store.read('protected-credentials', null)).toEqual({ encrypted: 'unrelated fixture credential' });
    expect(await fs.readFile(path.join(checkpoint, 'original'), 'utf8')).toBe('keep checkpoint bytes');
    const saved = (await f.store.read<Signed<Receipts> | null>(RECEIPTS, null))!;
    expect(saved.signature).toBe(f.sign(saved.value));
    expect(saved.value.previews).toMatchObject([{ id: expired.id, threadId: expired.thread, workspaceId: expired.owner,
      selectionVersion: expired.selection.version }]);
  });

  it.each(['pending', 'complete', 'recovery_required'] as const)('never expires an attempted %s operation or its source plan', async state => {
    const plan = await f.preview(); await f.operation(plan, state);
    const service = f.service(); await service.initialize();
    expect(await exists(f.filename(plan.key))).toBe(true);
    expect(await exists(f.filename(`file-rewind-operation-${plan.id}`))).toBe(true);
    expect(await f.store.read(RECEIPTS, null)).toBeNull();
    expect((await service.status(plan.thread, plan.selection)).status).toBe(state === 'complete' ? 'complete' : 'recovery_required');
  });

  it('keeps an expired plan with transaction material even when its operation receipt is absent', async () => {
    const plan = await f.preview(), transaction = path.join(f.config.stateDir, 'file-rewinds', plan.id);
    await fs.mkdir(path.join(transaction, 'parked'), { recursive: true });
    await fs.writeFile(path.join(transaction, 'parked', '000000'), 'original bytes retained after interruption');
    const service = f.service(); await service.initialize();
    expect(await exists(f.filename(plan.key))).toBe(true);
    expect(await fs.readFile(path.join(transaction, 'parked', '000000'), 'utf8')).toBe('original bytes retained after interruption');
    expect(await f.store.read(RECEIPTS, null)).toBeNull();
  });

  it('does not follow a transaction-path symlink or use it as permission to remove a plan', async () => {
    const plan = await f.preview(), outside = path.join(f.directory, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'sentinel'), 'outside survives');
    await fs.mkdir(path.join(f.config.stateDir, 'file-rewinds'));
    await fs.symlink(outside, path.join(f.config.stateDir, 'file-rewinds', plan.id));
    await f.service().initialize();
    expect(await exists(f.filename(plan.key))).toBe(true);
    expect(await fs.readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('outside survives');
    expect(await f.store.read(RECEIPTS, null)).toBeNull();
  });

  it('keeps at most 512 signed recent receipts and removes receipts older than 24 hours when pruning', async () => {
    const now = Date.now();
    const receipt = (discardedAt: number): Receipt => ({ id: randomUUID(), threadId: threadId(), workspaceId: f.workspaceId,
      selectionVersion: 'd'.repeat(64), discardedAt: new Date(discardedAt).toISOString() });
    const stale = receipt(now - FILE_REWIND_LIMITS.expiredPreviewReceiptMilliseconds - 1_000);
    const recent = Array.from({ length: 512 }, (_, index) => receipt(now - 10_000 + index));
    await f.store.write(RECEIPTS, f.envelope<Receipts>({ version: 1, previews: [stale, ...recent] }));
    const plan = await f.preview(); await f.service().initialize();
    const saved = (await f.store.read<Signed<Receipts> | null>(RECEIPTS, null))!;
    expect(saved.signature).toBe(f.sign(saved.value));
    expect(saved.value.previews).toHaveLength(512);
    const ids = saved.value.previews.map(item => item.id);
    expect(new Set(ids).size).toBe(512);
    expect(ids).not.toContain(stale.id);
    expect(ids).not.toContain(recent[0].id);
    expect(ids).toContain(recent.at(-1)!.id);
    expect(ids.at(-1)).toBe(plan.id);
  });

  it('answers only the exact owning thread and signed selection, including after restart and receipt expiry', async () => {
    const plan = await f.preview(), first = f.service(); await first.initialize(); await first.close();
    const restarted = f.service(); await restarted.initialize();
    expect(await restarted.status(plan.thread, plan.selection)).toEqual({ status: 'not_started', ...plan.selection });
    await expect(restarted.status(threadId(), plan.selection)).rejects.toMatchObject({ code: 'FILE_REWIND_NOT_FOUND' });
    await expect(restarted.status(plan.thread, { ...plan.selection, version: '0'.repeat(64) })).rejects.toMatchObject({ code: 'FILE_REWIND_NOT_FOUND' });
    const receipts = (await f.store.read<Signed<Receipts> | null>(RECEIPTS, null))!;
    const expiry = Date.parse(receipts.value.previews[0].discardedAt) + FILE_REWIND_LIMITS.expiredPreviewReceiptMilliseconds;
    vi.spyOn(Date, 'now').mockReturnValue(expiry);
    await expect(restarted.status(plan.thread, plan.selection)).rejects.toMatchObject({ code: 'FILE_REWIND_NOT_FOUND' });
  });

  it('rejects forged preview signatures and forged receipt tables before deleting preview evidence', async () => {
    const plan = await f.preview();
    await f.store.write(plan.key, { ...f.envelope(plan.value), signature: '0'.repeat(64) });
    await expect(f.service().initialize()).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(f.filename(plan.key))).toBe(true);
    await f.store.write(plan.key, f.envelope(plan.value));
    await f.store.write(RECEIPTS, { version: 1, value: { version: 1, previews: [] }, signature: '0'.repeat(64) });
    await expect(f.service().initialize()).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(f.filename(plan.key))).toBe(true);
  });

  it('does not remove a preview while permanent workspace cleanup has exclusive admission', async () => {
    const plan = await f.preview(), first = f.service();
    await withWorkspaceRemoval(f.config.workspacesDir, plan.owner, async () => {
      await first.initialize();
      expect(await exists(f.filename(plan.key))).toBe(true);
      expect(await f.store.read(RECEIPTS, null)).toBeNull();
    });
    await first.close();
    await f.service().initialize();
    expect(await exists(f.filename(plan.key))).toBe(false);
    expect(workspaceIsBusy(f.config.workspacesDir, plan.owner)).toBe(false);
  });

  it('keeps workspace admission through the actual serialized receipt write and preserves a queued writer’s receipt', async () => {
    const plan = await f.preview(), queued = deferred(), release = deferred(), pruning = deferred();
    const other: Receipt = { id: randomUUID(), threadId: threadId(), workspaceId: randomUUID(),
      selectionVersion: 'e'.repeat(64), discardedAt: new Date().toISOString() };
    const preceding = f.store.update<Signed<Receipts> | null>(RECEIPTS, null, async () => {
      queued.resolve(); await release.promise; return f.envelope<Receipts>({ version: 1, previews: [other] });
    });
    await queued.promise;
    f.store.receiptUpdateRequested = pruning.resolve;
    const initializing = f.service().initialize();
    try {
      await pruning.promise;
      await expect(withWorkspaceRemoval(f.config.workspacesDir, plan.owner, async () => 'must not enter')).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
      expect(await exists(f.filename(plan.key))).toBe(true);
    } finally { release.resolve(); await preceding; await initializing; }
    const saved = (await f.store.read<Signed<Receipts> | null>(RECEIPTS, null))!;
    expect(saved.value.previews.map(item => item.id)).toEqual([other.id, plan.id]);
    expect(saved.signature).toBe(f.sign(saved.value));
    expect(workspaceIsBusy(f.config.workspacesDir, plan.owner)).toBe(false);
  });

  it('rechecks for an operation saved while its unused-plan receipt is waiting in the store queue', async () => {
    const plan = await f.preview(), queued = deferred(), release = deferred(), pruning = deferred();
    const preceding = f.store.update<Signed<Receipts> | null>(RECEIPTS, null, async () => {
      queued.resolve(); await release.promise; return f.envelope<Receipts>({ version: 1, previews: [] });
    });
    await queued.promise; f.store.receiptUpdateRequested = pruning.resolve;
    const service = f.service(), initializing = service.initialize();
    try { await pruning.promise; await f.operation(plan); }
    finally { release.resolve(); await preceding; await initializing; }
    expect(await exists(f.filename(plan.key))).toBe(true);
    expect((await service.status(plan.thread, plan.selection)).status).toBe('complete');
    expect(workspaceIsBusy(f.config.workspacesDir, plan.owner)).toBe(false);
  });

  it('preserves every receipt when two startup scans share the real store queue', async () => {
    const one = await f.preview(), two = await f.preview({ workspaceId: randomUUID() });
    const first = f.service(), second = f.service();
    await Promise.all([first.initialize(), second.initialize()]);
    const saved = (await f.store.read<Signed<Receipts> | null>(RECEIPTS, null))!;
    expect(saved.signature).toBe(f.sign(saved.value));
    expect(new Set(saved.value.previews.map(item => item.id))).toEqual(new Set([one.id, two.id]));
    expect(saved.value.previews).toHaveLength(2);
    expect(await exists(f.filename(one.key))).toBe(false);
    expect(await exists(f.filename(two.key))).toBe(false);
    expect(await first.status(one.thread, one.selection)).toEqual({ status: 'not_started', ...one.selection });
    expect(await second.status(two.thread, two.selection)).toEqual({ status: 'not_started', ...two.selection });
  });
});
