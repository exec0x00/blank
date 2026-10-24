import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { JsonStore } from '../server/store';
import { cleanupThreadFileRewinds } from '../server/agent/file-rewind-thread-cleanup';
import { CHECKPOINT_LIMITS, CheckpointStore, GitObjectWriter, checkpointReference, manifestHash, writeTree } from '../server/git-checkpoints/store';
import type { GitCheckpointManifest, GitCheckpointReference } from '../server/git-checkpoints';
import { clearWorkspaceRecoveryBarrier, setWorkspaceRecoveryBarrier, workspaceRecoveryBarrier, withWorkspaceRemoval } from '../server/worktrees/activity';

type Value = Record<string, unknown>;
const identifier = () => randomUUID().replaceAll('-', '');
const threadId = () => `thr_${identifier()}`;
const turnId = () => `turn_${identifier()}`;
const createdAt = '2026-09-20T12:00:00.000Z';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exists = (filename: string) => fs.lstat(filename).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  throw error;
});
const saved = (workspaceId: string, id: string, extra: Value = {}) => ({
  thread: { id, workspaceId, title: 'Saved user conversation', status: 'idle', createdAt, updatedAt: createdAt,
    messages: [{ id: `msg_${identifier()}`, role: 'user', content: 'Preserve this user request.', createdAt }], turns: [] },
  input: [{ role: 'user', content: 'Preserve this user request.' }], revision: 1, ...extra,
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-thread-rewind-cleanup-'));
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'),
    WORKSPACE_PASSWORD: 'thread-cleanup-fixture-password', SESSION_SECRET: 'thread-cleanup-fixture-secret-'.repeat(3), ENCRYPTION_KEY: 'c'.repeat(64) });
  await fs.mkdir(config.stateDir, { recursive: true });
  const workspaceId = randomUUID(), siblingId = randomUUID(), foreignId = randomUUID();
  const store = new JsonStore(config.stateDir);
  // This deletion leaf must work after the caller quiesces its family; it must
  // not start a workspace service or consult model/provider configuration.
  const ctx = Object.defineProperties({ config, store }, Object.fromEntries(['workspaces', 'settings', 'providerKey'].map(name => [name,
    { get() { throw new Error(`Thread cleanup must not access ${name}.`); } }]))) as AppContext;
  const sign = (value: unknown) => createHmac('sha256', config.sessionSecret).update(JSON.stringify(value)).digest('hex');
  const file = (key: string) => path.join(config.stateDir, `${key}.json`);
  const writeJSON = (key: string, value: unknown) => fs.writeFile(file(key), encode(value), { mode: 0o600 });
  const writeSigned = (key: string, value: Value) => writeJSON(key, { version: 1, value, signature: sign(value) });
  const barriers: Array<{ workspaceId: string; recoveryId: string }> = [];

  async function journal(owner: string, thread: string, turn = turnId()) {
    const key = `thread-turn-${thread}-${turn}`;
    await writeJSON(key, { version: 2, workspaceId: owner, threadId: thread, turnId: turn, input: [{ role: 'user', content: 'Original turn input.' }] });
    return { key, turn };
  }

  async function cas(owner: string, thread: string, sourceValue: unknown = saved(owner, thread), candidateValue: unknown = sourceValue) {
    const id = identifier(), key = `thread-${thread}`, name = `.state-cas-${key}-${id}`, bundle = path.join(config.stateDir, name);
    const source = encode(sourceValue), candidate = encode(candidateValue);
    const manifest = { version: 1, id, key, createdAt, expectedVersion: `1:2:${source.length}:4:5`,
      expectedSha256: sha256(source), expectedBytes: source.length, desiredSha256: sha256(candidate), desiredBytes: candidate.length };
    await fs.mkdir(bundle, { mode: 0o700 });
    await fs.writeFile(path.join(bundle, 'manifest.json'), encode(manifest));
    await fs.writeFile(path.join(bundle, 'source.json'), source);
    await fs.writeFile(path.join(bundle, 'candidate.json'), candidate);
    await fs.writeFile(path.join(bundle, 'parked.json'), encode({ version: 1, id, key, createdAt, sourcePreserved: true }));
    return { bundle, name, source, candidate };
  }

  async function checkpoint(owner: string, thread: string, turn = turnId()) {
    const checkpointStore = new CheckpointStore({ config }, { ...CHECKPOINT_LIMITS });
    const root = path.join(config.workspacesDir, owner), git = path.join(root, '.git');
    await fs.mkdir(git, { recursive: true });
    const rootStat = await fs.stat(root), gitStat = await fs.stat(git);
    const capture = await checkpointStore.create({ workspaceId: owner, threadId: thread, turnId: turn });
    try {
      const writer = new GitObjectWriter(capture.directory, CHECKPOINT_LIMITS.totalBytes);
      const bytes = Buffer.from(`Saved file bytes for ${thread}\n`), blob = await writer.write('blob', bytes);
      const tree = await writeTree(writer, [{ path: 'source.txt', mode: '100644', oid: blob }]);
      const completed = await writer.finish(tree, capture.owner.createdAt);
      const value: Omit<GitCheckpointManifest, 'manifestHash'> = {
        version: 1, id: capture.owner.id, workspaceId: owner, threadId: thread, turnId: turn, phase: 'before', createdAt: capture.owner.createdAt,
        repository: { root, gitDirectory: git, commonDirectory: git, rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
          gitIdentity: { dev: gitStat.dev, ino: gitStat.ino }, commonIdentity: { dev: gitStat.dev, ino: gitStat.ino },
          generation: { version: 1, repository: `repository_${identifier()}`, checkout: `checkout_${identifier()}`, workspaceId: owner,
            workspaceCreatedAt: createdAt, repositoryWorkspaceId: owner, repositoryWorkspaceCreatedAt: createdAt, worktreeId: null },
          observedIn: `boot_${identifier()}`, objectFormat: 'sha1', head: null, headRef: 'refs/heads/main' },
        files: [{ path: 'source.txt', kind: 'file', mode: 0o644, bytes: bytes.length, sha256: sha256(bytes), blob, tracked: true }],
        index: { present: false, sha256: null, bytes: 0, blob: null, format: null, extensions: [], entries: [] },
        commit: completed.commit, tree, contentBytes: bytes.length, storedBytes: completed.storedBytes, limitations: [],
      };
      const manifest = { ...value, manifestHash: manifestHash(value) };
      await checkpointStore.publish(capture.directory, manifest);
      return { reference: checkpointReference(manifest), manifest, bytes, blob, checkpointStore,
        directory: path.join(config.stateDir, 'git-checkpoints-v1', owner, capture.owner.id) };
    } finally { await capture.directory.close(); }
  }

  async function operation(options: { owner?: string; thread?: string; family?: string[]; state?: 'pending' | 'complete' | 'recovery_required' | 'kept_current';
    blocking?: boolean; marker?: boolean; threadUnchanged?: boolean; checkpoint?: GitCheckpointReference } = {}) {
    const id = randomUUID(), owner = options.owner ?? workspaceId, thread = options.thread ?? threadId();
    const turn = options.checkpoint?.turnId ?? turnId(), backupId = `history_${identifier()}`, family = options.family ?? [owner];
    const reference: GitCheckpointReference = options.checkpoint ?? { version: 1, id: `gcp_${identifier()}`, workspaceId: owner,
      threadId: thread, turnId: turn, phase: 'before', createdAt, manifestHash: 'a'.repeat(64) };
    const plan = { version: 1, id, workspaceId: owner, threadId: thread, beforeTurnId: turn, sourceDigest: 'a'.repeat(64), turnIds: [turn],
      createdAt, expiresAt: '2026-09-20T12:01:00.000Z', target: reference,
      current: { repository: { root: path.join(config.workspacesDir, owner), gitDirectory: path.join(config.workspacesDir, family[0], '.git') } },
      restore: { files: [], index: [] } };
    const keys = { operation: `file-rewind-operation-${id}`, plan: `file-rewind-plan-${id}`, latest: `file-rewind-latest-${thread}`,
      turn: `file-rewind-turn-${hash([thread, turn])}`, review: `file-rewind-review-${id}`, backup: `thread-backup-${backupId}`,
      journal: `thread-turn-${thread}-${turn}` };
    const backup = { version: 2, threadId: thread, beforeTurnId: turn,
      record: saved(owner, thread, { turnJournals: { [turn]: keys.journal } }), turnInputs: [{ turnId: turn, input: [{ role: 'user', content: 'Original request.' }] }] };
    const value = { version: 1, workspaceId: owner, threadId: thread, recoveryId: id, selection: { planId: id, version: sign(plan) },
      state: options.state ?? 'complete', blocking: options.blocking ?? false, familyIds: family, sourceDigest: 'a'.repeat(64), createdAt, updatedAt: createdAt,
      ...(options.threadUnchanged === undefined ? {} : { threadUnchanged: options.threadUnchanged }), historyBackupDigest: hash(backup),
      completion: { workspaceId: owner, threadId: thread, recoveryId: id, beforeTurnId: turn, backupId, filesUnchanged: false, filesRewound: 1 } };
    await writeSigned(keys.plan, plan); await writeSigned(keys.operation, value);
    if (options.marker !== false) for (const member of family) await writeSigned(`file-rewind-block-${member}`, value);
    await writeSigned(keys.latest, value.selection);
    await writeSigned(keys.turn, { version: 1, workspaceId: owner, threadId: thread, turnId: turn,
      before: { status: 'ready', checkpoint: reference }, manualPaths: [] });
    await writeSigned(keys.review, { version: 1, recoveryId: id, workspaceId: owner, createdAt, rows: [], transcript: 'original', index: 'original' });
    await writeJSON(keys.backup, backup); await journal(owner, thread, turn);
    const record = saved(owner, thread, { historyBackups: [keys.backup], turnJournals: { [turn]: keys.journal } });
    await writeJSON(`thread-${thread}`, record);
    const transaction = path.join(config.stateDir, 'file-rewinds', id);
    for (const name of ['before', 'after', 'parked', 'events', 'objects']) await fs.mkdir(path.join(transaction, name), { recursive: true });
    await fs.writeFile(path.join(transaction, 'identity.json'), encode({ version: 1, id, workspaceId: owner, threadId: thread, createdAt, paths: ['source.txt'] }));
    await fs.writeFile(path.join(transaction, 'before', '000000'), 'Original file bytes');
    await fs.writeFile(path.join(transaction, 'after', '000000'), 'Prepared file bytes');
    await fs.writeFile(path.join(transaction, 'parked', '000000'), 'Parked original bytes');
    await fs.writeFile(path.join(transaction, 'events', '00000001.json'), encode({ id, state: value.state }));
    await fs.writeFile(path.join(transaction, 'objects', '000000'), 'Owned staging bytes');
    return { id, owner, thread, turn, family, value, plan, keys, record, backup, transaction, reference };
  }

  return { directory, config, ctx, store, workspaceId, siblingId, foreignId, file, sign, writeJSON, writeSigned, journal, cas, checkpoint, operation,
    barrier(owner: string, recoveryId: string) {
      setWorkspaceRecoveryBarrier(config.workspacesDir, owner, { recoveryId, message: 'Retained fixture recovery.' });
      barriers.push({ workspaceId: owner, recoveryId });
    },
    async close() {
      for (const item of barriers) clearWorkspaceRecoveryBarrier(config.workspacesDir, item.workspaceId, item.recoveryId);
      await store.flush(); await fs.rm(directory, { recursive: true, force: true });
    } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Operation = Awaited<ReturnType<Fixture['operation']>>;

describe('exact-thread file rewind cleanup', () => {
  let f: Fixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });
  const run = (operation: Pick<Operation, 'owner' | 'thread'>) => cleanupThreadFileRewinds(f.ctx, { workspaceId: operation.owner, threadId: operation.thread });
  const retained = async (op: Operation) => {
    expect(await fs.readFile(path.join(op.transaction, 'parked', '000000'), 'utf8')).toBe('Parked original bytes');
    expect(await exists(f.file(op.keys.operation))).toBe(true);
    expect(await exists(f.file(op.keys.backup))).toBe(true);
  };

  it('cleans one thread under an existing activity gate while preserving peer/fork state, real checkpoints, working files and preferences', async () => {
    const selectedThread = threadId(), selectedCheckpoint = await f.checkpoint(f.workspaceId, selectedThread);
    const own = await f.operation({ thread: selectedThread, family: [f.workspaceId, f.siblingId], checkpoint: selectedCheckpoint.reference });
    const peer = await f.operation({ marker: false }), foreign = await f.operation({ owner: f.foreignId });
    const peerCheckpoint = await f.checkpoint(peer.owner, peer.thread), foreignCheckpoint = await f.checkpoint(foreign.owner, foreign.thread);
    const ownCas = await f.cas(own.owner, own.thread, own.record), peerCas = await f.cas(peer.owner, peer.thread, peer.record);
    const foreignCas = await f.cas(foreign.owner, foreign.thread, foreign.record);
    const reviewId = `review_${identifier()}`, reviewKey = `review-snapshot-${reviewId}`;
    await f.writeJSON(reviewKey, { id: reviewId, files: [{ path: 'source.txt', before: 'Retained review bytes.' }] });
    // Engine.fork writes its own journals; it does not copy historyBackups or
    // checkpoint ownership. Quoted IDs and shared review snapshots are not refs.
    const fork = saved(f.workspaceId, peer.thread, { turnJournals: { [peer.turn]: peer.keys.journal }, reviewSnapshots: { [reviewId]: reviewKey } });
    Object.assign(fork.thread, { forkedFrom: { threadId: own.thread, turnId: own.turn },
      messages: [{ id: `msg_${identifier()}`, role: 'user', content: `${own.keys.backup} ${own.keys.journal} ${own.reference.id}`, createdAt }] });
    await f.writeJSON(`thread-${peer.thread}`, fork);
    const preferences = { skills: ['personal-skill'], workflows: ['release'], accounts: ['saved-account'], fontSize: 14 };
    await f.writeJSON('settings', preferences);
    const working = path.join(f.config.workspacesDir, f.workspaceId, 'source.txt');
    await fs.writeFile(working, 'Current manual working file.');
    const protectedFiles = [f.file(`thread-${own.thread}`), f.file(`thread-${peer.thread}`), f.file(`thread-${foreign.thread}`),
      f.file(reviewKey), f.file('settings'), working];
    const bytes = await Promise.all(protectedFiles.map(filename => fs.readFile(filename)));
    f.barrier(f.foreignId, foreign.id);
    await withWorkspaceRemoval(f.config.workspacesDir, f.workspaceId, async () => {
      f.barrier(f.workspaceId, own.id); f.barrier(f.siblingId, own.id);
      await run(own);
    });
    for (const key of Object.values(own.keys)) expect(await exists(f.file(key)), key).toBe(false);
    for (const directory of [own.transaction, ownCas.bundle, selectedCheckpoint.directory]) expect(await exists(directory)).toBe(false);
    for (const other of [peer, foreign]) await retained(other);
    for (const bundle of [peerCas, foreignCas]) expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
    for (const checkpoint of [peerCheckpoint, foreignCheckpoint]) {
      const opened = await checkpoint.checkpointStore.open(checkpoint.reference);
      try { expect(await checkpoint.checkpointStore.blob(opened.directory, checkpoint.blob, 4096)).toEqual(checkpoint.bytes); }
      finally { await opened.directory.close(); }
    }
    for (let index = 0; index < protectedFiles.length; index++) expect(await fs.readFile(protectedFiles[index])).toEqual(bytes[index]);
    expect(workspaceRecoveryBarrier(f.config.workspacesDir, f.workspaceId)).toBeNull();
    expect(workspaceRecoveryBarrier(f.config.workspacesDir, f.siblingId)).toBeNull();
    expect(workspaceRecoveryBarrier(f.config.workspacesDir, f.foreignId)?.recoveryId).toBe(foreign.id);
    await run(own);
  });

  it('finds standalone v1/v2 backups and exact journals absent from current historyBackups, including CAS-only and pending inputs', async () => {
    const thread = threadId(), canonicalJournal = await f.journal(f.workspaceId, thread), pending = await f.journal(f.workspaceId, thread);
    const canonical = saved(f.workspaceId, thread, { historyBackups: [], turnJournals: { [canonicalJournal.turn]: canonicalJournal.key },
      pendingJournal: { turnId: pending.turn, input: [{ role: 'user', content: 'Accepted pending source input.' }] } });
    await f.writeJSON(`thread-${thread}`, canonical);
    const removed = [canonicalJournal.key, pending.key];
    for (const version of [1, 2]) {
      const journal = await f.journal(f.workspaceId, thread), extraInput = await f.journal(f.workspaceId, thread);
      const key = `thread-backup-history_${identifier()}`;
      await f.writeJSON(key, { version, threadId: thread, beforeTurnId: journal.turn,
        record: saved(f.workspaceId, thread, { turnJournals: { [journal.turn]: journal.key } }),
        ...(version === 2 ? { turnInputs: [{ turnId: extraInput.turn, input: [] }] } : {}) });
      removed.push(key, journal.key);
      if (version === 2) removed.push(extraInput.key);
      else await fs.unlink(f.file(extraInput.key));
    }
    const casJournal = await f.journal(f.workspaceId, thread);
    const cas = await f.cas(f.workspaceId, thread, saved(f.workspaceId, thread, { turnJournals: { [casJournal.turn]: casJournal.key } }));
    const otherThread = threadId(), foreignBackup = `thread-backup-history_${identifier()}`;
    await f.writeJSON(foreignBackup, { version: 1, threadId: otherThread, record: saved(f.workspaceId, otherThread) });
    await run({ owner: f.workspaceId, thread });
    for (const key of [...removed, casJournal.key]) expect(await exists(f.file(key)), key).toBe(false);
    expect(await exists(cas.bundle)).toBe(false);
    expect(await exists(f.file(foreignBackup))).toBe(true);
    expect(JSON.parse(await fs.readFile(f.file(`thread-${thread}`), 'utf8'))).toEqual(canonical);
  });

  it('allows acknowledged kept-current and proven unchanged nonblocking recovery records to settle', async () => {
    for (const state of ['kept_current', 'recovery_required'] as const) {
      const op = await f.operation({ state, threadUnchanged: true });
      await run(op);
      expect(await exists(op.transaction)).toBe(false);
      expect(await exists(f.file(op.keys.operation))).toBe(false);
    }
  });

  it.each(['pending-canonical', 'unsettled-recovery', 'pending-marker'] as const)('retains all source bytes for %s before CAS/checkpoint deletion', async scenario => {
    const thread = threadId(), checkpoint = await f.checkpoint(f.workspaceId, thread);
    const op = await f.operation({ thread, checkpoint: checkpoint.reference,
      ...(scenario === 'pending-canonical' ? { state: 'pending' as const, blocking: false, marker: false }
        : scenario === 'unsettled-recovery' ? { state: 'recovery_required' as const, blocking: false } : {}) });
    if (scenario === 'pending-marker') await f.writeSigned(`file-rewind-block-${f.workspaceId}`, { ...op.value, state: 'pending', blocking: true });
    const cas = await f.cas(op.owner, op.thread, op.record);
    await expect(run(op)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    await retained(op);
    expect(await exists(checkpoint.directory)).toBe(true);
    expect(await fs.readFile(path.join(cas.bundle, 'source.json'))).toEqual(cas.source);
  });

  it('refuses a surviving foreign canonical conversation that still references the selected transcript backup', async () => {
    const op = await f.operation(), survivorId = threadId();
    const survivor = saved(f.foreignId, survivorId, { historyBackups: [op.keys.backup] });
    await f.writeJSON(`thread-${survivorId}`, survivor);
    const cas = await f.cas(op.owner, op.thread, op.record);
    await expect(run(op)).rejects.toMatchObject({ code: 'FILE_REWIND_REFERENCED' });
    await retained(op);
    expect(await exists(cas.bundle)).toBe(true);
    expect(JSON.parse(await fs.readFile(f.file(`thread-${survivorId}`), 'utf8'))).toEqual(survivor);
  });

  it.each(['turn', 'plan'] as const)('rejects a signed foreign %s that references a selected checkpoint', async kind => {
    const op = await f.operation(), foreignThread = threadId(), foreignTurn = turnId(), foreignPlanId = randomUUID();
    const key = kind === 'turn' ? `file-rewind-turn-${hash([foreignThread, foreignTurn])}` : `file-rewind-plan-${foreignPlanId}`;
    await f.writeSigned(key, kind === 'turn'
      ? { version: 1, workspaceId: f.foreignId, threadId: foreignThread, turnId: foreignTurn, before: { status: 'ready', checkpoint: op.reference } }
      : { ...op.plan, id: foreignPlanId, workspaceId: f.foreignId, threadId: foreignThread });
    await expect(run(op)).rejects.toMatchObject({ code: 'FILE_REWIND_REFERENCED' });
    await retained(op);
    expect(await exists(f.file(key))).toBe(true);
  });

  it('detects a foreign workspace reference present only in a verified CAS candidate without deleting either bundle', async () => {
    const op = await f.operation(), survivor = threadId();
    const ownCas = await f.cas(op.owner, op.thread, op.record);
    const foreignCas = await f.cas(f.foreignId, survivor, saved(f.foreignId, survivor),
      saved(f.foreignId, survivor, { historyBackups: [op.keys.backup] }));
    expect(await exists(f.file(`thread-${survivor}`))).toBe(false);
    await expect(run(op)).rejects.toMatchObject({ code: 'FILE_REWIND_REFERENCED' });
    await retained(op);
    expect(await fs.readFile(path.join(ownCas.bundle, 'source.json'))).toEqual(ownCas.source);
    expect(await fs.readFile(path.join(foreignCas.bundle, 'candidate.json'))).toEqual(foreignCas.candidate);
  });

  it('unlinks an owned parked symlink as a leaf while preserving its external working target', async () => {
    const op = await f.operation(), outside = path.join(f.directory, 'other-task');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), 'Unrelated working bytes.');
    await fs.symlink(outside, path.join(op.transaction, 'parked', '000001'));
    await run(op);
    expect(await exists(op.transaction)).toBe(false);
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('Unrelated working bytes.');
  });

  it('rejects a substituted transaction-root symlink before deleting CAS recovery or canonical ownership', async () => {
    const op = await f.operation(), outside = path.join(f.directory, 'retained-transaction'), cas = await f.cas(op.owner, op.thread, op.record);
    await fs.rename(op.transaction, outside); await fs.symlink(outside, op.transaction);
    await expect(run(op)).rejects.toMatchObject({ code: 'FILE_REWIND_UNSAFE_PATH' });
    expect(await fs.readFile(path.join(outside, 'parked', '000000'), 'utf8')).toBe('Parked original bytes');
    expect(await exists(f.file(op.keys.operation))).toBe(true);
    expect(await exists(cas.bundle)).toBe(true);
  });

  it('rejects mismatched raw ownership before deleting otherwise valid checkpoints or backups', async () => {
    const thread = threadId(), checkpoint = await f.checkpoint(f.workspaceId, thread);
    const op = await f.operation({ thread, checkpoint: checkpoint.reference });
    await fs.writeFile(path.join(op.transaction, 'identity.json'), encode({ version: 1, id: op.id, workspaceId: f.foreignId, threadId: op.thread }));
    await expect(run(op)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    await retained(op);
    expect(await exists(checkpoint.directory)).toBe(true);
  });

  it('rejects a forged signed operation without using its claimed settled state as deletion authority', async () => {
    const op = await f.operation(), cas = await f.cas(op.owner, op.thread, op.record);
    await f.writeJSON(op.keys.operation, { version: 1, value: { ...op.value, state: 'kept_current', blocking: false }, signature: '0'.repeat(64) });
    await expect(run(op)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    await retained(op);
    expect(await exists(cas.bundle)).toBe(true);
  });

  it('never follows a signed state-record symlink to acquire deletion authority', async () => {
    const op = await f.operation(), outside = path.join(f.directory, 'external-signed-record.json');
    await fs.rename(f.file(op.keys.operation), outside); await fs.symlink(outside, f.file(op.keys.operation));
    await expect(run(op)).rejects.toMatchObject({ code: 'FILE_REWIND_RECORD_INVALID' });
    await retained(op);
    expect(await exists(outside)).toBe(true);
  });

  it('retains native identity and signed ownership after a raw unlink failure and completes an exact retry', async () => {
    const op = await f.operation(), peer = await f.operation({ marker: false }), unlink = fs.unlink.bind(fs);
    const fault = vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      if (String(filename).endsWith('/000000')) throw Object.assign(new Error('Injected storage failure'), { code: 'EIO' });
      return unlink(filename);
    });
    await expect(run(op)).rejects.toMatchObject({ code: 'EIO' });
    expect(await exists(path.join(op.transaction, 'identity.json'))).toBe(true);
    expect(await exists(f.file(op.keys.operation))).toBe(true);
    expect(await exists(f.file(op.keys.backup))).toBe(true);
    fault.mockRestore();
    await run(op);
    expect(await exists(op.transaction)).toBe(false);
    expect(await exists(f.file(op.keys.operation))).toBe(false);
    await retained(peer);
  });

  it('keeps canonical operation authority until metadata removal succeeds, even after raw payloads and backups are gone', async () => {
    const op = await f.operation(), unlink = fs.unlink.bind(fs);
    const fault = vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      if (String(filename).endsWith(`/${op.keys.plan}.json`)) throw Object.assign(new Error('Injected metadata failure'), { code: 'EIO' });
      return unlink(filename);
    });
    await expect(run(op)).rejects.toMatchObject({ code: 'EIO' });
    expect(await exists(op.transaction)).toBe(false);
    expect(await exists(f.file(op.keys.backup))).toBe(false);
    expect(await exists(f.file(op.keys.operation))).toBe(true);
    expect(await exists(f.file(`thread-${op.thread}`))).toBe(true);
    fault.mockRestore();
    await run(op);
    for (const key of Object.values(op.keys)) expect(await exists(f.file(key)), key).toBe(false);
  });

  it('prunes only exact-thread expired previews and preserves a concurrent same-workspace row through a guarded retry', async () => {
    const op = await f.operation(), key = 'file-rewind-expired-previews';
    const row = (workspaceId: string, thread: string) => ({ id: randomUUID(), workspaceId, threadId: thread,
      selectionVersion: 'a'.repeat(64), discardedAt: createdAt });
    const own = row(op.owner, op.thread), peer = row(op.owner, threadId()), foreign = row(f.foreignId, threadId()), added = row(op.owner, threadId());
    await f.writeSigned(key, { version: 1, previews: [own, peer, foreign] });
    const write = f.store.writeWithVersion.bind(f.store);
    let injected = false;
    const fault = vi.spyOn(f.store, 'writeWithVersion').mockImplementation(async (name, value, options) => {
      if (name === key && !injected) {
        injected = true;
        const current = { version: 1, previews: [own, peer, foreign, added] };
        await f.store.write(key, { version: 1, value: current, signature: f.sign(current) });
      }
      return write(name, value, options);
    });
    await run(op);
    expect(fault).toHaveBeenCalledTimes(2);
    const table = JSON.parse(await fs.readFile(f.file(key), 'utf8'));
    expect(table.value).toEqual({ version: 1, previews: [peer, foreign, added] });
    expect(table.signature).toBe(f.sign(table.value));
    await run(op);
    expect(JSON.parse(await fs.readFile(f.file(key), 'utf8'))).toEqual(table);
  });
});
