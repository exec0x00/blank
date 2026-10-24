import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { restoreLegacyRewindBarriers, LEGACY_REWIND_BARRIER_LIMITS } from '../server/legacy/rewind-barriers';
import { acquireWorkspaceActivity, clearWorkspaceRecoveryBarrier, setWorkspaceRecoveryBarrier,
  workspaceRecoveryBarrier } from '../server/worktrees/activity';

const id = (prefix: string) => prefix + '_' + randomUUID().replaceAll('-', '');
type Value = Record<string, unknown>;
describe('read-only legacy rewind startup barriers', () => {
  let directory: string, config: { dataDir: string; stateDir: string; workspacesDir: string; sessionSecret: string };
  let owned: Array<{ workspaceId: string; recoveryId: string }>;
  beforeEach(async () => {
    directory = await fs.mkdtemp('/tmp/codex-legacy-rewind-');
    config = { dataDir: path.join(directory, 'data'), stateDir: path.join(directory, 'data', 'state'),
      workspacesDir: path.join(directory, 'data', 'workspaces'), sessionSecret: 'owned-legacy-recovery-fixture-'.repeat(3) };
    owned = []; await fs.mkdir(config.stateDir, { recursive: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const entry of owned) clearWorkspaceRecoveryBarrier(config.workspacesDir, entry.workspaceId, entry.recoveryId);
    await fs.rm(directory, { recursive: true, force: true });
  });
  function record(options: { state?: string; blocking?: boolean; workspaceId?: string; family?: string[]; recoveryId?: string } = {}) {
    const workspaceId = options.workspaceId ?? randomUUID(), family = options.family ?? [workspaceId, randomUUID()];
    const recoveryId = options.recoveryId ?? randomUUID(), threadId = id('thr');
    for (const member of family) owned.push({ workspaceId: member, recoveryId });
    return { version: 1, workspaceId, threadId, recoveryId, familyIds: family,
      state: options.state ?? 'pending', blocking: options.blocking ?? true,
      selection: { planId: recoveryId, version: 'a'.repeat(64) },
      completion: { workspaceId, threadId, recoveryId, backupId: id('history'), beforeTurnId: id('turn'),
        restoredPrompt: 'PRIVATE_TRANSCRIPT_MUST_NOT_BE_RETURNED', filesRewound: 1 } };
  }
  function signed(value: Value) {
    return { version: 1, value, signature: createHmac('sha256', config.sessionSecret).update(JSON.stringify(value)).digest('hex') };
  }
  async function write(name: string, value: Value) {
    await fs.writeFile(path.join(config.stateDir, name), JSON.stringify(signed(value), null, 2) + '\n');
  }
  const operationName = (value: { recoveryId: string }) => 'file-rewind-operation-' + value.recoveryId + '.json';
  async function save(value = record(), markers = false) {
    await write(operationName(value), value);
    if (markers) for (const member of value.familyIds) await write('file-rewind-block-' + member + '.json', value);
    return value;
  }
  function expectBlocked(value: ReturnType<typeof record>) {
    for (const workspace of value.familyIds) {
      expect(workspaceRecoveryBarrier(config.workspacesDir, workspace)?.recoveryId).toBe(value.recoveryId);
      for (const kind of ['agent', 'terminal', 'git', 'files', 'extension', 'worktree'] as const) {
        expect(() => acquireWorkspaceActivity(config.workspacesDir, workspace, kind)).toThrowError(/unfinished previous file rewind/i);
      }
    }
    const release = acquireWorkspaceActivity(config.workspacesDir, randomUUID(), 'files');
    release();
  }
  async function stateSnapshot() {
    const result: Record<string, { bytes: string; mtime: string; ctime: string; mode: string }> = {};
    for (const name of await fs.readdir(config.stateDir)) {
      const file = path.join(config.stateDir, name), info = await fs.lstat(file, { bigint: true });
      if (!info.isFile()) continue;
      result[name] = { bytes: (await fs.readFile(file)).toString('base64'), mtime: String(info.mtimeNs),
        ctime: String(info.ctimeNs), mode: String(info.mode) };
    }
    return result;
  }

  it('does not create missing storage or a checkout and installs nothing for empty state', async () => {
    await fs.rm(config.dataDir, { recursive: true });
    const mkdir = vi.spyOn(fs, 'mkdir'), writeFile = vi.spyOn(fs, 'writeFile');
    expect(await restoreLegacyRewindBarriers(config)).toEqual({ pendingOperations: 0, blockedWorkspaces: [], recoveryIds: [] });
    expect(mkdir).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled();
    await expect(fs.lstat(config.dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { state: 'pending', blocking: true },
    { state: 'pending', blocking: false },
    { state: 'recovery_required', blocking: false },
    { state: 'complete', blocking: true },
  ])('restores conservative family barriers from signed $state/$blocking authority even with lost markers', async options => {
    const value = await save(record(options)), before = await stateSnapshot();
    const writeFile = vi.spyOn(fs, 'writeFile'), rename = vi.spyOn(fs, 'rename'), unlink = vi.spyOn(fs, 'unlink'), mkdir = vi.spyOn(fs, 'mkdir');
    const timer = vi.spyOn(globalThis, 'setInterval');
    const result = await restoreLegacyRewindBarriers(config);
    expect(result).toEqual({ pendingOperations: 1, blockedWorkspaces: [...value.familyIds].sort(), recoveryIds: [value.recoveryId] });
    expectBlocked(value);
    expect(await stateSnapshot()).toEqual(before);
    for (const mutation of [writeFile, rename, unlink, mkdir]) expect(mutation).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    await expect(fs.lstat(config.workspacesDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TRANSCRIPT');
  });

  it('reads no transcript, plan, backup or transaction payload and performs no repair/pruning', async () => {
    const value = await save(record(), true);
    for (const name of ['thread-' + value.threadId + '.json', 'thread-backup-' + value.completion.backupId + '.json',
      'file-rewind-plan-' + value.recoveryId + '.json', 'file-rewind-expired-previews.json', 'protected-credentials.json']) {
      await fs.writeFile(path.join(config.stateDir, name), 'PRIVATE_UNREADABLE_PAYLOAD');
    }
    const backup = path.join(config.stateDir, 'file-rewinds', value.recoveryId, 'before', '000000');
    await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.writeFile(backup, 'ORIGINAL_RECOVERY_BYTES');
    const before = await stateSnapshot(), open = vi.spyOn(fs, 'open'), unlink = vi.spyOn(fs, 'unlink'), rename = vi.spyOn(fs, 'rename');
    await restoreLegacyRewindBarriers(config);
    const files = open.mock.calls.map(([file]) => String(file));
    expect(files.every(file => file === config.stateDir || /\/file-rewind-(?:operation|block)-[a-z0-9_-]+\.json$/i.test(file))).toBe(true);
    expect(files.some(file => file.includes('file-rewind-plan') || file.includes('thread-') || file.includes('before'))).toBe(false);
    expect(unlink).not.toHaveBeenCalled(); expect(rename).not.toHaveBeenCalled();
    expect(await stateSnapshot()).toEqual(before); expect(await fs.readFile(backup, 'utf8')).toBe('ORIGINAL_RECOVERY_BYTES');
  });

  it.each(['complete', 'kept_current'])('does not create or clear barriers for settled $0 metadata', async state => {
    const value = await save(record({ state, blocking: false }), true);
    setWorkspaceRecoveryBarrier(config.workspacesDir, value.workspaceId, { recoveryId: value.recoveryId, message: 'Explicit settlement is still required.' });
    const before = await stateSnapshot();
    expect(await restoreLegacyRewindBarriers(config)).toEqual({ pendingOperations: 0, blockedWorkspaces: [], recoveryIds: [] });
    expect(workspaceRecoveryBarrier(config.workspacesDir, value.workspaceId)?.message).toBe('Explicit settlement is still required.');
    expect(await stateSnapshot()).toEqual(before);
  });

  it('keeps a partially published completion fenced when a matching signed family marker remains pending', async () => {
    const value = await save(record({ state: 'complete', blocking: false }));
    await write('file-rewind-block-' + value.familyIds[1] + '.json', { ...value, state: 'pending', blocking: false });
    expect((await restoreLegacyRewindBarriers(config)).pendingOperations).toBe(1); expectBlocked(value);
  });

  it('is idempotent for the same signed recovery and does not overwrite a different existing barrier', async () => {
    const value = await save();
    const first = await restoreLegacyRewindBarriers(config);
    expect(await restoreLegacyRewindBarriers(config)).toEqual(first); expectBlocked(value);
    for (const member of value.familyIds) clearWorkspaceRecoveryBarrier(config.workspacesDir, member, value.recoveryId);
    const otherId = randomUUID(); owned.push({ workspaceId: value.workspaceId, recoveryId: otherId });
    setWorkspaceRecoveryBarrier(config.workspacesDir, value.workspaceId, { recoveryId: otherId, message: 'Different owned recovery.' });
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_CONFLICT' });
    expect(workspaceRecoveryBarrier(config.workspacesDir, value.workspaceId)?.recoveryId).toBe(otherId);
    expect(workspaceRecoveryBarrier(config.workspacesDir, value.familyIds[1])).toBeNull();
  });

  it('refuses overlapping independently signed pending recoveries before publishing either new barrier', async () => {
    const first = await save(), second = await save(record({ workspaceId: first.workspaceId, family: first.familyIds }));
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_CONFLICT' });
    expect(first.recoveryId).not.toBe(second.recoveryId);
    for (const workspaceId of first.familyIds) expect(workspaceRecoveryBarrier(config.workspacesDir, workspaceId)).toBeNull();
  });

  it.each(['signature', 'family', 'selection', 'backup', 'thread', 'filename', 'json'] as const)(
    'fails closed on corrupt $0 authority and never partially restores valid peers', async kind => {
      const peer = await save(record()), value = record();
      const file = path.join(config.stateDir, operationName(value));
      if (kind === 'signature') await fs.writeFile(file, JSON.stringify({ ...signed(value), signature: '0'.repeat(64) }));
      else if (kind === 'json') await fs.writeFile(file, '{');
      else {
        const changed: Value = structuredClone(value);
        if (kind === 'family') changed.familyIds = [value.workspaceId, value.workspaceId];
        if (kind === 'selection') changed.selection = { planId: randomUUID(), version: 'a'.repeat(64) };
        if (kind === 'backup') changed.completion = { ...value.completion, backupId: '../private-file' };
        if (kind === 'thread') changed.threadId = 'foreign-thread';
        if (kind === 'filename') changed.recoveryId = randomUUID();
        await write(operationName(value), changed);
      }
      const before = await stateSnapshot();
      await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_INVALID' });
      expect(await stateSnapshot()).toEqual(before);
      for (const member of peer.familyIds) expect(workspaceRecoveryBarrier(config.workspacesDir, member)).toBeNull();
    });

  it('rejects an orphaned or conflicting family marker rather than trusting it as standalone authority', async () => {
    const value = record(); await write('file-rewind-block-' + value.workspaceId + '.json', value);
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_INVALID' });
    await save(value);
    await write('file-rewind-block-' + value.workspaceId + '.json', { ...value, selection: { ...value.selection, version: 'b'.repeat(64) } });
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_INVALID' });
    expect(workspaceRecoveryBarrier(config.workspacesDir, value.workspaceId)).toBeNull();
  });

  it.each(['symlink', 'hardlink', 'directory'] as const)('refuses a $0 authority leaf without following it', async kind => {
    const value = record(), file = path.join(config.stateDir, operationName(value)), outside = path.join(directory, 'outside-authority.json');
    await fs.writeFile(outside, JSON.stringify(signed(value)));
    if (kind === 'symlink') await fs.symlink(outside, file);
    else if (kind === 'hardlink') await fs.link(outside, file);
    else await fs.mkdir(file);
    const open = vi.spyOn(fs, 'open');
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_INVALID' });
    expect(open.mock.calls.map(([name]) => String(name))).not.toContain(outside);
    expect(workspaceRecoveryBarrier(config.workspacesDir, value.workspaceId)).toBeNull();
    expect(await fs.readFile(outside, 'utf8')).toBe(JSON.stringify(signed(value)));
  });

  it('rejects symlink storage parents and lexical roots outside the configured native data directory', async () => {
    const real = config.stateDir + '-owned'; await fs.rename(config.stateDir, real); await fs.symlink(real, config.stateDir);
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_INVALID' });
    await expect(restoreLegacyRewindBarriers({ ...config, stateDir: path.join(directory, 'outside') }))
      .rejects.toMatchObject({ code: 'LEGACY_REWIND_CONFIGURATION' });
  });

  it('rejects an atomic source replacement between open and read while retaining actual changed bytes', async () => {
    const value = await save(), file = path.join(config.stateDir, operationName(value));
    const replacement = JSON.stringify(signed({ ...value, state: 'complete', blocking: false }));
    const original = fs.open.bind(fs); let reached = false;
    vi.spyOn(fs, 'open').mockImplementation((async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (!reached && String(args[0]).endsWith('/' + operationName(value))) {
        reached = true; await fs.writeFile(file + '.owned', replacement); await fs.rename(file + '.owned', file);
      }
      return handle;
    }) as typeof fs.open);
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_CHANGED' });
    expect(reached).toBe(true); expect(await fs.readFile(file, 'utf8')).toBe(replacement);
    expect(workspaceRecoveryBarrier(config.workspacesDir, value.workspaceId)).toBeNull();
  });

  it('rejects a new canonical operation added during inspection instead of publishing an incomplete barrier set', async () => {
    const value = await save(), later = record(), opendir = fs.opendir.bind(fs); let calls = 0, reached = false;
    vi.spyOn(fs, 'opendir').mockImplementation((async (...args: Parameters<typeof fs.opendir>) => {
      if (++calls === 2) { reached = true; await write(operationName(later), later); }
      return opendir(...args);
    }) as typeof fs.opendir);
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_CHANGED' });
    expect(reached).toBe(true); expect(workspaceRecoveryBarrier(config.workspacesDir, value.workspaceId)).toBeNull();
    expect(workspaceRecoveryBarrier(config.workspacesDir, later.workspaceId)).toBeNull();
  });

  it('keeps parent swaps pinned and never opens the replacement namespace', async () => {
    const value = await save(), moved = config.stateDir + '-owned-moved', outside = path.join(directory, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, operationName(value)), 'FOREIGN_SENTINEL');
    const original = fs.open.bind(fs), opened: string[] = []; let swapped = false;
    vi.spyOn(fs, 'open').mockImplementation((async (...args: Parameters<typeof fs.open>) => {
      opened.push(String(args[0])); const handle = await original(...args);
      if (!swapped && String(args[0]).endsWith('/' + operationName(value))) {
        swapped = true; await fs.rename(config.stateDir, moved); await fs.symlink(outside, config.stateDir);
      }
      return handle;
    }) as typeof fs.open);
    try {
      await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_CHANGED' });
      expect(swapped).toBe(true); expect(opened.some(name => name.startsWith(outside))).toBe(false);
      expect(await fs.readFile(path.join(outside, operationName(value)), 'utf8')).toBe('FOREIGN_SENTINEL');
      expect(workspaceRecoveryBarrier(config.workspacesDir, value.workspaceId)).toBeNull();
    } finally { if (swapped) { await fs.unlink(config.stateDir); await fs.rename(moved, config.stateDir); } }
  });

  it('bounds registry count, aggregate bytes, wire size and elapsed work before mutation admission', async () => {
    const value = await save(); await save();
    await expect(restoreLegacyRewindBarriers(config, { maxRecords: 1 })).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_LIMIT' });
    await expect(restoreLegacyRewindBarriers(config, { maxReadBytes: 1 })).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_LIMIT' });
    await expect(restoreLegacyRewindBarriers(config, { maxDirectoryEntries: 1 })).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_LIMIT' });
    await fs.truncate(path.join(config.stateDir, operationName(value)), LEGACY_REWIND_BARRIER_LIMITS.recordWireBytes + 1);
    await expect(restoreLegacyRewindBarriers(config)).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_INVALID' });
    await write(operationName(value), value);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(100_000);
    await expect(restoreLegacyRewindBarriers(config, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'LEGACY_REWIND_STATE_LIMIT' });
    expect(workspaceRecoveryBarrier(config.workspacesDir, value.workspaceId)).toBeNull();
  });
});
