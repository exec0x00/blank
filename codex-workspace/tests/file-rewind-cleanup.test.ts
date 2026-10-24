import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { assertWorkspaceFileRewindDeletionAllowed, cleanupWorkspaceFileRewinds, readFileRewindMetadataExclusions } from '../server/agent/file-rewind-cleanup';
import { clearWorkspaceRecoveryBarrier, setWorkspaceRecoveryBarrier, workspaceRecoveryBarrier, withWorkspaceRemoval } from '../server/worktrees/activity';

type Value = Record<string, unknown>;
const threadId = () => `thr_${randomUUID().replaceAll('-', '')}`;
const turnId = () => `turn_${randomUUID().replaceAll('-', '')}`;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exists = (file: string) => fs.lstat(file).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  throw error;
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rewind-cleanup-'));
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), WORKSPACE_PASSWORD: 'fixture-only-password',
    SESSION_SECRET: 'rewind-cleanup-fixture-secret-'.repeat(3), ENCRYPTION_KEY: 'k'.repeat(64) });
  await fs.mkdir(config.stateDir, { recursive: true });
  const workspaceId = randomUUID(), siblingId = randomUUID(), foreignId = randomUUID();
  const store = new JsonStore(config.stateDir), ctx = { config, store };
  const sign = (value: unknown) => createHmac('sha256', config.sessionSecret).update(JSON.stringify(value)).digest('hex');
  const file = (key: string) => path.join(config.stateDir, `${key}.json`);
  const writeJSON = async (key: string, value: unknown) => fs.writeFile(file(key), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const writeSigned = async (key: string, value: Value) => writeJSON(key, { version: 1, value, signature: sign(value) });
  const ownedBarriers: Array<{ workspaceId: string; recoveryId: string }> = [];
  async function operation(options: { owner?: string; family?: string[]; state?: 'pending' | 'complete' | 'recovery_required' | 'kept_current'; blocking?: boolean; marker?: boolean } = {}) {
    const id = randomUUID(), owner = options.owner ?? workspaceId, thread = threadId(), turn = turnId();
    const backupId = `history_${randomUUID().replaceAll('-', '')}`;
    const family = options.family ?? [owner];
    const plan: Value = { version: 1, id, workspaceId: owner, threadId: thread, beforeTurnId: turn, sourceDigest: 'a'.repeat(64), turnIds: [turn],
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      current: { repository: { root: path.join(config.workspacesDir, owner), gitDirectory: path.join(config.workspacesDir, family[0], '.git') } },
      target: { workspaceId: owner, threadId: thread, turnId: turn }, restore: { files: [], rows: [] } };
    const value = { version: 1, workspaceId: owner, threadId: thread, recoveryId: id, selection: { planId: id, version: sign(plan) },
      state: options.state ?? 'complete', blocking: options.blocking ?? false, familyIds: family, sourceDigest: 'a'.repeat(64),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      completion: { workspaceId: owner, threadId: thread, recoveryId: id, beforeTurnId: turn, backupId,
        filesUnchanged: false, filesRewound: 1, restoredPrompt: 'Private original prompt' } };
    const transaction = path.join(config.stateDir, 'file-rewinds', id);
    const keys = { operation: `file-rewind-operation-${id}`, plan: `file-rewind-plan-${id}`, latest: `file-rewind-latest-${thread}`,
      turn: `file-rewind-turn-${digest([thread, turn])}`, review: `file-rewind-review-${id}`, backup: `thread-backup-${backupId}`, journal: `thread-turn-${thread}-${turn}` };
    await writeSigned(keys.plan, plan); await writeSigned(keys.operation, value);
    if (options.marker !== false) for (const member of family) await writeSigned(`file-rewind-block-${member}`, value);
    await writeSigned(keys.latest, value.selection);
    await writeSigned(keys.turn, { version: 1, workspaceId: owner, threadId: thread, turnId: turn,
      before: { status: 'unavailable', code: 'FIXTURE', reason: 'Cleanup does not execute checkpoints.' }, manualPaths: [] });
    await writeSigned(keys.review, { version: 1, recoveryId: id, workspaceId: owner,
      operationDigest: digest(value), fileToken: 'a'.repeat(64), threadDigest: 'b'.repeat(64), createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), rows: [], transcript: 'original', index: 'original' });
    await writeJSON(keys.backup, { version: 2, threadId: thread, beforeTurnId: turn, record: {
      thread: { id: thread, workspaceId: owner, messages: [{ role: 'user', content: 'Private original prompt' }] },
      turnJournals: { [turn]: keys.journal } }, turnInputs: [{ turnId: turn, input: [{ role: 'user', content: 'Private original prompt' }] }] });
    await writeJSON(keys.journal, { turnId: turn, input: [{ role: 'assistant', content: 'Saved original model input' }] });
    for (const name of ['before', 'after', 'parked', 'events', 'objects']) await fs.mkdir(path.join(transaction, name), { recursive: true });
    await fs.writeFile(path.join(transaction, 'identity.json'), JSON.stringify({ version: 1, id, workspaceId: owner, threadId: thread, createdAt: new Date().toISOString(), paths: ['source.ts'] }));
    await fs.writeFile(path.join(transaction, 'manifest.json'), JSON.stringify({ version: 1, id, workspaceId: owner, threadId: thread, units: [] }));
    await fs.writeFile(path.join(transaction, 'before', '000000'), 'raw original file');
    await fs.writeFile(path.join(transaction, 'after', '000000'), 'raw staged file');
    await fs.writeFile(path.join(transaction, 'parked', '000000'), 'parked actual original');
    await fs.writeFile(path.join(transaction, 'events', '00000001.json'), JSON.stringify({ id, state: value.state }));
    await fs.writeFile(path.join(transaction, 'objects', '000000'), 'staged Git object');
    return { id, owner, thread, turn, backupId, value, plan, keys, transaction, family };
  }
  return { directory, config, store, ctx, workspaceId, siblingId, foreignId, file, sign, writeJSON, writeSigned, operation,
    barrier(workspaceId: string, recoveryId: string) { setWorkspaceRecoveryBarrier(config.workspacesDir, workspaceId, { recoveryId, message: 'Retained fixture recovery' }); ownedBarriers.push({ workspaceId, recoveryId }); },
    async close() {
      for (const item of ownedBarriers) clearWorkspaceRecoveryBarrier(config.workspacesDir, item.workspaceId, item.recoveryId);
      await fs.rm(directory, { recursive: true, force: true });
    } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

describe('workspace-owned file rewind deletion', () => {
  let f: Fixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });

  it('preflights before workspace initialization and makes no files or live workspace calls', async () => {
    const before = await fs.readdir(f.config.stateDir);
    const ctx = Object.defineProperty({ config: f.config }, 'workspaces', { get() { throw new Error('Cleanup must not initialize a workspace.'); } });
    await assertWorkspaceFileRewindDeletionAllowed(ctx, f.workspaceId);
    await cleanupWorkspaceFileRewinds(ctx, f.workspaceId);
    expect(await fs.readdir(f.config.stateDir)).toEqual(before);
    expect(await exists(f.config.workspacesDir)).toBe(false);
    await fs.rmdir(f.config.stateDir);
    await assertWorkspaceFileRewindDeletionAllowed(ctx, f.workspaceId);
    expect(await exists(f.config.stateDir)).toBe(false);
  });

  it('blocks both preflight and cleanup for a canonical pending operation whose family markers were lost', async () => {
    const op = await f.operation({ state: 'pending', blocking: true, marker: false });
    await expect(assertWorkspaceFileRewindDeletionAllowed(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    expect(await fs.readFile(path.join(op.transaction, 'parked', '000000'), 'utf8')).toBe('parked actual original');
    expect(await exists(f.file(op.keys.backup))).toBe(true);
  });

  it('blocks a sibling checkout through signed family ownership even without that sibling marker', async () => {
    const op = await f.operation({ family: [f.workspaceId, f.siblingId], state: 'recovery_required', blocking: true });
    await fs.unlink(f.file(`file-rewind-block-${f.siblingId}`));
    await expect(assertWorkspaceFileRewindDeletionAllowed(f.ctx, f.siblingId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    expect(await exists(op.transaction)).toBe(true);
  });

  it('retains pending payloads even when an inconsistent signed pending record says blocking false', async () => {
    await f.operation({ state: 'pending', blocking: false });
    await expect(assertWorkspaceFileRewindDeletionAllowed(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
  });

  it('does not treat a partly persisted completion as permission to delete a still-blocking family marker', async () => {
    const op = await f.operation();
    await f.writeSigned(`file-rewind-block-${f.workspaceId}`, { ...op.value, state: 'recovery_required', blocking: true });
    await expect(assertWorkspaceFileRewindDeletionAllowed(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
  });

  it('rejects a forged canonical signature before any retained file can be removed', async () => {
    const op = await f.operation();
    await f.writeJSON(op.keys.operation, { version: 1, value: { ...op.value, blocking: false }, signature: '0'.repeat(64) });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(f.file(op.keys.backup))).toBe(true);
    expect(await exists(path.join(op.transaction, 'identity.json'))).toBe(true);
  });

  it('rejects a marker with missing canonical authority rather than using the marker as deletion authority', async () => {
    const op = await f.operation();
    await fs.unlink(f.file(op.keys.operation));
    await expect(assertWorkspaceFileRewindDeletionAllowed(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(op.transaction)).toBe(true);
  });

  it('removes raw originals, staging, transcript backup and exact journals after permanent deletion, preserving unrelated state', async () => {
    const op = await f.operation({ family: [f.workspaceId, f.siblingId] });
    const other = await f.operation({ owner: f.foreignId });
    const settings = { skills: ['user-skill'], workflows: ['release'], accounts: ['saved-account'] };
    await f.writeJSON('settings', settings); await f.writeJSON('protected-credentials', { encrypted: 'fixture' });
    await f.writeJSON(`thread-${op.thread}`, { thread: { id: op.thread, workspaceId: op.owner }, messages: ['Visible history is not this cleanup helper’s scope.'] });
    f.barrier(f.siblingId, op.id);
    await withWorkspaceRemoval(f.config.workspacesDir, f.workspaceId, () => cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId));
    expect(await exists(op.transaction)).toBe(false);
    for (const key of Object.values(op.keys)) expect(await exists(f.file(key)), key).toBe(false);
    for (const id of op.family) expect(await exists(f.file(`file-rewind-block-${id}`))).toBe(false);
    expect(workspaceRecoveryBarrier(f.config.workspacesDir, f.siblingId)).toBeNull();
    expect(await exists(other.transaction)).toBe(true);
    for (const key of Object.values(other.keys)) expect(await exists(f.file(key)), key).toBe(true);
    expect(JSON.parse(await fs.readFile(f.file('settings'), 'utf8'))).toEqual(settings);
    expect(JSON.parse(await fs.readFile(f.file('protected-credentials'), 'utf8'))).toEqual({ encrypted: 'fixture' });
    expect(await exists(f.file(`thread-${op.thread}`))).toBe(true);
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
  });

  it('cleans only a non-owner family workspace’s marker and never follows it to the primary’s backups', async () => {
    const op = await f.operation({ family: [f.workspaceId, f.siblingId], state: 'kept_current' });
    await cleanupWorkspaceFileRewinds(f.ctx, f.siblingId);
    expect(await exists(f.file(`file-rewind-block-${f.siblingId}`))).toBe(false);
    expect(await exists(f.file(`file-rewind-block-${f.workspaceId}`))).toBe(true);
    for (const key of Object.values(op.keys)) expect(await exists(f.file(key)), key).toBe(true);
    expect(await fs.readFile(path.join(op.transaction, 'parked', '000000'), 'utf8')).toBe('parked actual original');
  });

  it('preserves a sibling marker and in-memory barrier which now belongs to a different operation', async () => {
    const op = await f.operation({ family: [f.workspaceId, f.siblingId] });
    const newer = await f.operation({ owner: f.siblingId });
    f.barrier(f.siblingId, newer.id);
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    expect(await exists(op.transaction)).toBe(false);
    expect(await exists(newer.transaction)).toBe(true);
    expect(JSON.parse(await fs.readFile(f.file(`file-rewind-block-${f.siblingId}`), 'utf8')).value.recoveryId).toBe(newer.id);
    expect(workspaceRecoveryBarrier(f.config.workspacesDir, f.siblingId)?.recoveryId).toBe(newer.id);
  });

  it('unlinks parked symlinks as leaves without opening or deleting their external targets', async () => {
    const op = await f.operation();
    const external = path.join(f.directory, 'other-workspace');
    await fs.mkdir(external); await fs.writeFile(path.join(external, 'sentinel'), 'outside survives');
    await fs.symlink(external, path.join(op.transaction, 'parked', '000001'));
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    expect(await exists(op.transaction)).toBe(false);
    expect(await fs.readFile(path.join(external, 'sentinel'), 'utf8')).toBe('outside survives');
  });

  it('refuses a substituted transaction-root symlink and retains canonical recovery authority', async () => {
    const op = await f.operation();
    const retained = path.join(f.directory, 'retained-transaction');
    await fs.rename(op.transaction, retained); await fs.symlink(retained, op.transaction);
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_UNSAFE_PATH' });
    expect(await fs.readFile(path.join(retained, 'parked', '000000'), 'utf8')).toBe('parked actual original');
    expect(await exists(f.file(op.keys.operation))).toBe(true);
    expect(await exists(f.file(op.keys.backup))).toBe(true);
  });

  it('never reads a symlinked signed state record as deletion authority', async () => {
    const op = await f.operation();
    const outside = path.join(f.directory, 'external-operation.json');
    await fs.rename(f.file(op.keys.operation), outside); await fs.symlink(outside, f.file(op.keys.operation));
    await expect(assertWorkspaceFileRewindDeletionAllowed(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(outside)).toBe(true); expect(await exists(op.transaction)).toBe(true);
  });

  it('refuses mismatching transaction ownership while preserving its files and signed record', async () => {
    const op = await f.operation();
    await fs.writeFile(path.join(op.transaction, 'identity.json'), JSON.stringify({ version: 1, id: op.id, workspaceId: f.foreignId, threadId: op.thread }));
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(path.join(op.transaction, 'before', '000000'))).toBe(true);
    expect(await exists(f.file(op.keys.operation))).toBe(true);
  });

  it('validates transcript ownership and exact journal keys before deleting any raw recovery payload', async () => {
    const op = await f.operation();
    const foreignJournal = `thread-turn-${threadId()}-${turnId()}`;
    await f.writeJSON(foreignJournal, { turnId: op.turn, input: ['Keep foreign source'] });
    await f.writeJSON(op.keys.backup, { version: 2, threadId: op.thread, beforeTurnId: op.turn,
      record: { thread: { id: op.thread, workspaceId: op.owner }, turnJournals: { [op.turn]: foreignJournal } } });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(f.file(foreignJournal))).toBe(true);
    expect(await exists(path.join(op.transaction, 'parked', '000000'))).toBe(true);
  });

  it('checks actual journal turn identity instead of deleting an arbitrary record at an expected name', async () => {
    const op = await f.operation();
    await f.writeJSON(op.keys.journal, { turnId: turnId(), input: ['Foreign or changed turn'] });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(f.file(op.keys.journal))).toBe(true); expect(await exists(op.transaction)).toBe(true);
  });

  it('keeps the native identity and canonical record after a raw leaf deletion failure, then resumes safely', async () => {
    const op = await f.operation();
    const unlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (String(target).endsWith('/000000')) throw Object.assign(new Error('Injected storage failure'), { code: 'EIO' });
      return unlink(target);
    });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'EIO' });
    expect(await exists(path.join(op.transaction, 'identity.json'))).toBe(true);
    expect(await exists(f.file(op.keys.operation))).toBe(true); expect(await exists(f.file(op.keys.backup))).toBe(true);
    spy.mockRestore();
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    expect(await exists(op.transaction)).toBe(false); expect(await exists(f.file(op.keys.operation))).toBe(false);
  });

  it('can retry an empty transaction after identity removal succeeded but its final rmdir failed', async () => {
    const op = await f.operation(), rmdir = fs.rmdir.bind(fs);
    const spy = vi.spyOn(fs, 'rmdir').mockImplementation(async target => {
      if (String(target).endsWith(`/${op.id}`)) throw Object.assign(new Error('Injected rmdir failure'), { code: 'EIO' });
      return rmdir(target);
    });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'EIO' });
    expect(await fs.readdir(op.transaction)).toEqual([]);
    expect(await exists(f.file(op.keys.operation))).toBe(true);
    spy.mockRestore(); await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    expect(await exists(op.transaction)).toBe(false);
  });

  it('does not treat a nonempty transaction without identity as safe retry residue', async () => {
    const op = await f.operation();
    await fs.unlink(path.join(op.transaction, 'identity.json'));
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(path.join(op.transaction, 'before', '000000'))).toBe(true);
  });

  it('retains a canonical operation until metadata cleanup finishes and retries after earlier payloads disappeared', async () => {
    const op = await f.operation(), unlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (String(target).endsWith(`/${op.keys.plan}.json`)) throw Object.assign(new Error('Injected plan deletion failure'), { code: 'EIO' });
      return unlink(target);
    });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'EIO' });
    expect(await exists(op.transaction)).toBe(false);
    expect(await exists(f.file(op.keys.backup))).toBe(false);
    expect(await exists(f.file(op.keys.operation))).toBe(true);
    spy.mockRestore(); await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    for (const key of Object.values(op.keys)) expect(await exists(f.file(key)), key).toBe(false);
  });

  it('detects replacement of a verified canonical file before payload removal', async () => {
    const op = await f.operation(), open = fs.open.bind(fs);
    let reads = 0;
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (target, flags, mode) => {
      if (String(target).endsWith(`/${op.keys.operation}.json`) && ++reads === 3) {
        await fs.writeFile(f.file(op.keys.operation), JSON.stringify({ version: 1, value: { ...op.value, updatedAt: 'changed' }, signature: f.sign({ ...op.value, updatedAt: 'changed' }) }));
      }
      return open(target, flags, mode);
    });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_CLEANUP_CHANGED' });
    spy.mockRestore();
    expect(await exists(path.join(op.transaction, 'parked', '000000'))).toBe(true);
    expect(await exists(f.file(op.keys.backup))).toBe(true);
  });
});

describe('shared expired rewind preview cleanup', () => {
  let f: Fixture;
  const key = 'file-rewind-expired-previews';
  const row = (workspaceId: string, discardedAt = new Date().toISOString()) => ({ id: randomUUID(), workspaceId,
    threadId: threadId(), selectionVersion: 'a'.repeat(64), discardedAt });
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });
  const table = async () => JSON.parse(await fs.readFile(f.file(key), 'utf8')) as {
    version: number; value: { version: number; previews: Array<ReturnType<typeof row>> }; signature: string;
  };

  it('removes only the deleted workspace rows and retains correctly signed unrelated rows even when older than 24 hours', async () => {
    const own = row(f.workspaceId), other = row(f.foreignId, '2020-01-01T00:00:00.000Z');
    await f.writeSigned(key, { version: 1, previews: [own, other, row(f.workspaceId)] });
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    const saved = await table();
    expect(saved.value).toEqual({ version: 1, previews: [other] });
    expect(saved.signature).toBe(f.sign(saved.value));
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    expect((await table()).value.previews).toEqual([other]);
  });

  it('keeps an empty signed global table instead of racing an unlink against another workspace’s writer', async () => {
    await f.writeSigned(key, { version: 1, previews: [row(f.workspaceId)] });
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    const saved = await table();
    expect(saved.value).toEqual({ version: 1, previews: [] });
    expect(saved.signature).toBe(f.sign(saved.value));
  });

  it('retries a guarded write and preserves a different workspace row added through the same live store after inspection', async () => {
    const own = row(f.workspaceId), first = row(f.foreignId), concurrent = row(f.siblingId);
    await f.writeSigned(key, { version: 1, previews: [own, first] });
    const write = f.store.writeWithVersion.bind(f.store);
    let injected = false;
    const spy = vi.spyOn(f.store, 'writeWithVersion').mockImplementation(async (name, value, options) => {
      if (name === key && !injected) {
        injected = true;
        const updated = { version: 1, previews: [own, first, concurrent] };
        await f.store.write(key, { version: 1, value: updated, signature: f.sign(updated) });
      }
      return write(name, value, options);
    });
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    expect(spy).toHaveBeenCalledTimes(2);
    const saved = await table();
    expect(saved.value.previews).toEqual([first, concurrent]);
    expect(saved.signature).toBe(f.sign(saved.value));
  });

  it('rejects a forged shared table before deleting raw recovery payloads or trusted ownership records', async () => {
    const op = await f.operation();
    await f.writeJSON(key, { version: 1, value: { version: 1, previews: [row(f.workspaceId)] }, signature: '0'.repeat(64) });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(path.join(op.transaction, 'parked', '000000'))).toBe(true);
    expect(await exists(f.file(op.keys.operation))).toBe(true);
  });

  it('requires the caller’s shared state store only when matching expired rows need a guarded update', async () => {
    const op = await f.operation();
    await f.writeSigned(key, { version: 1, previews: [row(f.workspaceId)] });
    const configOnly = { config: f.config };
    await assertWorkspaceFileRewindDeletionAllowed(configOnly, f.workspaceId);
    await expect(cleanupWorkspaceFileRewinds(configOnly, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_CLEANUP_STORE_REQUIRED' });
    expect(await exists(op.transaction)).toBe(true);
    const wrongStore = new JsonStore(path.join(f.directory, 'unrelated-state'));
    await expect(cleanupWorkspaceFileRewinds({ config: f.config, store: wrongStore }, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_CLEANUP_STORE_REQUIRED' });
    await f.writeSigned(key, { version: 1, previews: [row(f.foreignId)] });
    await cleanupWorkspaceFileRewinds(configOnly, f.workspaceId);
    expect(await exists(op.transaction)).toBe(false);
    expect((await table()).value.previews[0]?.workspaceId).toBe(f.foreignId);
    expect(await exists(wrongStore.directory)).toBe(false);
  });

  it('keeps canonical cleanup authority after a shared-table write failure and completes on a later retry', async () => {
    const op = await f.operation(), foreign = row(f.foreignId);
    await f.writeSigned(key, { version: 1, previews: [row(f.workspaceId), foreign] });
    const spy = vi.spyOn(f.store, 'writeWithVersion').mockRejectedValue(Object.assign(new Error('Injected shared state failure'), { code: 'EIO' }));
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'EIO' });
    expect(await exists(f.file(op.keys.operation))).toBe(true);
    expect((await table()).value.previews).toHaveLength(2);
    spy.mockRestore();
    await cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId);
    expect(await exists(f.file(op.keys.operation))).toBe(false);
    expect((await table()).value.previews).toEqual([foreign]);
  });

  it('rejects an over-cap signed table without silently dropping another workspace’s status rows', async () => {
    const rows = Array.from({ length: 513 }, () => row(f.foreignId));
    await f.writeSigned(key, { version: 1, previews: rows });
    await expect(cleanupWorkspaceFileRewinds(f.ctx, f.workspaceId)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect((await table()).value.previews).toHaveLength(513);
  });
});

describe('file rewind metadata restoration exclusions', () => {
  let f: Fixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });

  it('excludes a pending worktree root and its captured primary Git administration without live workspace access', async () => {
    const op = await f.operation({ owner: f.siblingId, family: [f.workspaceId, f.siblingId], state: 'pending', blocking: true, marker: false });
    expect(await readFileRewindMetadataExclusions(f.config)).toEqual([`${f.workspaceId}/.git`, f.siblingId].sort());
    expect(await exists(f.config.workspacesDir)).toBe(false);
    expect(await exists(op.transaction)).toBe(true);
  });

  it('does not suppress ordinary metadata restoration after completed or acknowledged rewinds', async () => {
    await f.operation(); await f.operation({ owner: f.siblingId, state: 'kept_current' });
    expect(await readFileRewindMetadataExclusions(f.config)).toEqual([]);
  });

  it('keeps exclusions while a blocking family marker remains after a partial completion save', async () => {
    const op = await f.operation();
    await f.writeSigned(`file-rewind-block-${f.workspaceId}`, { ...op.value, state: 'pending', blocking: true });
    expect(await readFileRewindMetadataExclusions(f.config)).toEqual([f.workspaceId, `${f.workspaceId}/.git`].sort());
  });

  it('rejects an unsigned or mismatched plan instead of trusting repository paths during startup', async () => {
    const op = await f.operation({ state: 'recovery_required', blocking: true });
    await f.writeSigned(op.keys.plan, { ...op.plan, threadId: threadId() });
    await expect(readFileRewindMetadataExclusions(f.config)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await exists(op.transaction)).toBe(true);
  });

  it('rejects a signed outside-workspaces repository path without touching its target', async () => {
    const op = await f.operation({ state: 'recovery_required', blocking: true });
    const outside = path.join(f.directory, 'outside'); await fs.mkdir(outside);
    const plan = { ...op.plan, current: { repository: { root: outside, gitDirectory: path.join(outside, '.git') } } };
    const changed = { ...op.value, selection: { planId: op.id, version: f.sign(plan) } };
    await f.writeSigned(op.keys.plan, plan); await f.writeSigned(op.keys.operation, changed);
    await f.writeSigned(`file-rewind-block-${f.workspaceId}`, changed);
    await expect(readFileRewindMetadataExclusions(f.config)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    expect(await fs.readdir(outside)).toEqual([]);
  });
});
