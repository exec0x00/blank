import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanupStateCasForThreads, discoverStateCasThreadIds, STATE_CAS_CLEANUP_LIMITS } from '../server/state-cas-cleanup';

const workspaceId = 'workspace-target', foreignWorkspaceId = 'workspace-other';
const createdAt = '2026-09-20T12:00:00.000Z';
const thread = (n: number) => `thr_${n.toString(16).padStart(32, '0')}`;
const id = () => randomUUID().replaceAll('-', '');
const encode = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const saved = (threadId = thread(1), owner = workspaceId, content = 'initial conversation') => ({
  thread: { id: threadId, workspaceId: owner, title: 'Retained conversation',
    messages: [{ id: 'message-one', role: 'user', content, createdAt }], turns: [], createdAt, updatedAt: createdAt },
  input: [{ role: 'user', content }], revision: 1,
});

describe('exact permanent thread CAS recovery cleanup', () => {
  let directory: string, stateDir: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-state-cas-cleanup-'));
    stateDir = path.join(directory, 'state');
    await fs.mkdir(stateDir);
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });

  async function seed(options: { threadId?: string; owner?: string; source?: boolean; candidate?: boolean;
    sourceValue?: unknown; candidateValue?: unknown; phases?: boolean; publications?: boolean } = {}) {
    const threadId = options.threadId ?? thread(1), owner = options.owner ?? workspaceId;
    const operationId = id(), key = `thread-${threadId}`, name = `.state-cas-${key}-${operationId}`;
    const bundle = path.join(stateDir, name);
    const source = encode(options.sourceValue ?? saved(threadId, owner));
    const candidate = encode(options.candidateValue ?? saved(threadId, owner, 'prepared conversation'));
    const manifest = { version: 1, id: operationId, key, createdAt, expectedVersion: `1:2:${source.length}:4:5`,
      expectedSha256: hash(source), expectedBytes: source.length, desiredSha256: hash(candidate), desiredBytes: candidate.length };
    await fs.mkdir(bundle);
    await fs.writeFile(path.join(bundle, 'manifest.json'), encode(manifest));
    if (options.source !== false) await fs.writeFile(path.join(bundle, 'source.json'), source);
    if (options.candidate !== false) await fs.writeFile(path.join(bundle, 'candidate.json'), candidate);
    if (options.publications) {
      await fs.writeFile(path.join(bundle, 'publication.json'), candidate);
      await fs.writeFile(path.join(bundle, 'restore-publication.json'), source);
    }
    if (options.phases) for (const phase of ['parked', 'committed', 'conflict', 'restored']) {
      await fs.writeFile(path.join(bundle, `${phase}.json`), encode({ version: 1, id: operationId, key, createdAt, sourcePreserved: true }));
    }
    return { name, bundle, id: operationId, key, threadId, owner, source, candidate, manifest };
  }
  const run = (threadIds = [thread(1)]) => cleanupStateCasForThreads({ stateDir }, { workspaceId, threadIds });
  async function quarantines(): Promise<string[]> {
    return (await fs.readdir(stateDir)).filter(name => name.startsWith('.state-cas-cleanup-')).map(name => path.join(stateDir, name));
  }
  async function parkedBundle(): Promise<string> {
    const entries = await quarantines();
    expect(entries).toHaveLength(1);
    return path.join(entries[0], 'bundle');
  }

  it('removes only requested complete bundles and keeps peer and unrelated state byte-for-byte', async () => {
    const first = await seed({ phases: true }), second = await seed({ threadId: thread(2) });
    const foreign = await seed({ threadId: thread(3), owner: foreignWorkspaceId });
    const ordinary = path.join(stateDir, `thread-${thread(1)}.json`), unrelated = path.join(stateDir, 'settings.json');
    await fs.writeFile(ordinary, first.source); await fs.writeFile(unrelated, 'unrelated state');
    // A parent CAS operation can retain actual raced bytes unlike its expected
    // source hash. Permanent deletion still requires their real owner to agree.
    await fs.writeFile(path.join(second.bundle, 'source.json'), encode(saved(thread(2), workspaceId, 'raced but owned conversation')));
    expect(await run([thread(1), thread(2)])).toEqual({ removed: 2 });
    expect(await fs.readFile(path.join(foreign.bundle, 'source.json'))).toEqual(foreign.source);
    expect(await fs.readFile(ordinary)).toEqual(first.source);
    expect(await fs.readFile(unrelated, 'utf8')).toBe('unrelated state');
    await expect(fs.lstat(first.bundle)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(second.bundle)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await quarantines()).toEqual([]);
  });

  it.each([{ source: false, candidate: true }, { source: true, candidate: false }, { source: false, candidate: false }])(
    'accepts absent publication leaves with established thread ownership: %j', async options => {
      const bundle = await seed({ ...options, phases: true });
      expect(await run()).toEqual({ removed: 1 });
      await expect(fs.lstat(bundle.bundle)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it('removes complete publication copies and same-owner raced restore copies', async () => {
    const bundle = await seed({ phases: true, publications: true });
    await fs.writeFile(path.join(bundle.bundle, 'restore-publication.json'), encode(saved(thread(1), workspaceId, 'raced original source')));
    expect(await run()).toEqual({ removed: 1 });
    expect(await fs.readdir(stateDir)).toEqual([]);
  });

  it('can prove a complete publication owner without inventing source callbacks from that copy', async () => {
    await seed({ source: false, candidate: false, publications: true });
    const onOwnedSource = vi.fn(), onVerifiedSource = vi.fn();
    expect(await discoverStateCasThreadIds(stateDir, { workspaceId, onOwnedSource, onVerifiedSource })).toEqual([thread(1)]);
    expect(onOwnedSource).not.toHaveBeenCalled(); expect(onVerifiedSource).not.toHaveBeenCalled();
    expect(await run()).toEqual({ removed: 1 });
  });

  it.each(['publication.json', 'restore-publication.json'] as const)(
    'accepts bounded byte-for-byte partial prefixes in %s, including empty and split UTF-8 copies', async name => {
      for (const length of ['empty', 'one-byte', 'split-utf8', 'missing-newline'] as const) {
        const sourceValue = saved(thread(1), workspaceId, 'original 🧪 content');
        const candidateValue = saved(thread(1), workspaceId, 'prepared 🧪 content');
        const bundle = await seed({ sourceValue, candidateValue });
        const reference = name === 'publication.json' ? bundle.candidate : bundle.source;
        const bytes = length === 'empty' ? 0 : length === 'one-byte' ? 1
          : length === 'split-utf8' ? reference.indexOf(Buffer.from('🧪')) + 1 : reference.length - 1;
        await fs.writeFile(path.join(bundle.bundle, name), reference.subarray(0, bytes));
        const onOwnedSource = vi.fn(), onVerifiedSource = vi.fn();
        expect(await discoverStateCasThreadIds(stateDir, { workspaceId, onOwnedSource, onVerifiedSource })).toEqual([thread(1)]);
        expect(onOwnedSource.mock.calls).toEqual([[thread(1), sourceValue], [thread(1), candidateValue]]);
        expect(onVerifiedSource.mock.calls).toEqual([[thread(1), workspaceId, sourceValue], [thread(1), workspaceId, candidateValue]]);
        expect(await run()).toEqual({ removed: 1 });
      }
    });

  it.each(['publication.json', 'restore-publication.json'] as const)(
    'retains foreign or nonmatching incomplete bytes in %s before mutation', async name => {
      const bundle = await seed(), foreign = encode(saved(thread(1), foreignWorkspaceId));
      for (const bytes of [Buffer.from('unowned partial source'), foreign]) {
        await fs.writeFile(path.join(bundle.bundle, name), bytes);
        const onOwnedSource = vi.fn(), onVerifiedSource = vi.fn();
        await expect(discoverStateCasThreadIds(stateDir, { workspaceId, onOwnedSource, onVerifiedSource }))
          .rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
        expect(onOwnedSource).not.toHaveBeenCalled(); expect(onVerifiedSource).not.toHaveBeenCalled();
        await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
        expect(await fs.readFile(path.join(bundle.bundle, name))).toEqual(bytes);
        expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
      }
    });

  it.each(['publication.json', 'restore-publication.json'] as const)(
    'refuses an incomplete %s without its complete corresponding reference', async name => {
      const bundle = await seed(name === 'publication.json' ? { candidate: false } : { source: false });
      const bytes = (name === 'publication.json' ? bundle.candidate : bundle.source).subarray(0, 24);
      await fs.writeFile(path.join(bundle.bundle, name), bytes);
      await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
      expect(await fs.readFile(path.join(bundle.bundle, name))).toEqual(bytes);
    });

  it('requires complete publication bytes to match the desired manifest, even with the same owner', async () => {
    const bundle = await seed({ publications: true });
    const bytes = encode(saved(thread(1), workspaceId, 'foreign prepared version'));
    await fs.writeFile(path.join(bundle.bundle, 'publication.json'), bytes);
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(path.join(bundle.bundle, 'publication.json'))).toEqual(bytes);
  });

  it('revalidates complete reference identity and bytes while proving an incomplete publication', async () => {
    const bundle = await seed(), candidate = path.join(bundle.bundle, 'candidate.json');
    await fs.writeFile(path.join(bundle.bundle, 'publication.json'), bundle.candidate.subarray(0, 24));
    const open = fs.open.bind(fs), onVerifiedSource = vi.fn(); let candidateOpens = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/candidate.json') && ++candidateOpens === 2) {
        await fs.writeFile(candidate, encode(saved(thread(1), foreignWorkspaceId)));
      }
      return open(...args);
    });
    await expect(discoverStateCasThreadIds(stateDir, { workspaceId, onVerifiedSource })).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_CHANGED' });
    expect(onVerifiedSource).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(bundle.bundle, 'publication.json'))).toEqual(bundle.candidate.subarray(0, 24));
  });

  it.each(['publication.json', 'restore-publication.json'] as const)(
    'preserves both reference transcripts when retirement of %s is interrupted', async name => {
      const bundle = await seed();
      await fs.writeFile(path.join(bundle.bundle, 'publication.json'), bundle.candidate.subarray(0, 24));
      await fs.writeFile(path.join(bundle.bundle, 'restore-publication.json'), bundle.source.subarray(0, 24));
      const unlink = fs.unlink.bind(fs); let interrupted = false;
      const fault = vi.spyOn(fs, 'unlink').mockImplementation(async file => {
        if (!interrupted && String(file).endsWith(`/${name}`)) { interrupted = true; throw new Error('Interrupted partial copy cleanup'); }
        return unlink(file);
      });
      await expect(run()).rejects.toThrow('Interrupted partial copy cleanup');
      const parked = await parkedBundle();
      expect(await fs.readFile(path.join(parked, 'source.json'))).toEqual(bundle.source);
      expect(await fs.readFile(path.join(parked, 'candidate.json'))).toEqual(bundle.candidate);
      fault.mockRestore();
      expect(await discoverStateCasThreadIds(stateDir, { workspaceId })).toEqual([thread(1)]);
      expect(await run()).toEqual({ removed: 1 });
      expect(await fs.readdir(stateDir)).toEqual([]);
    });

  it('discovers orphan thread IDs from agreeing raw owners, ignoring proven peer workspaces and metadata-only names', async () => {
    await seed({ threadId: thread(7) });
    await seed({ threadId: thread(8), owner: foreignWorkspaceId });
    await seed({ threadId: thread(9), source: false, candidate: false, phases: true });
    const before = await fs.readdir(stateDir);
    expect(await discoverStateCasThreadIds(stateDir, { workspaceId })).toEqual([thread(7)]);
    expect(await fs.readdir(stateDir)).toEqual(before);
  });

  it('audits verified foreign sources without expanding deletion IDs or target-only callbacks', async () => {
    const bundle = await seed({ threadId: thread(8), owner: foreignWorkspaceId, publications: true });
    const onOwnedSource = vi.fn(), onVerifiedSource = vi.fn();
    const threadIds = await discoverStateCasThreadIds(stateDir, { workspaceId, onOwnedSource, onVerifiedSource });
    expect(threadIds).toEqual([]); expect(onOwnedSource).not.toHaveBeenCalled();
    expect(onVerifiedSource.mock.calls).toEqual([
      [thread(8), foreignWorkspaceId, JSON.parse(bundle.source.toString('utf8'))],
      [thread(8), foreignWorkspaceId, JSON.parse(bundle.candidate.toString('utf8'))],
    ]);
    expect(await run(threadIds)).toEqual({ removed: 0 });
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
  });

  it('never passes changed foreign-source bytes to the verified reference audit callback', async () => {
    const bundle = await seed({ threadId: thread(8), owner: foreignWorkspaceId });
    const source = path.join(bundle.bundle, 'source.json'), open = fs.open.bind(fs), onVerifiedSource = vi.fn(); let sourceOpens = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/source.json') && ++sourceOpens === 2) await fs.writeFile(source, encode(saved(thread(8), workspaceId)));
      return open(...args);
    });
    await expect(discoverStateCasThreadIds(stateDir, { workspaceId, onVerifiedSource })).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_CHANGED' });
    expect(onVerifiedSource).not.toHaveBeenCalled();
  });

  it('exposes individually bounded owned bodies for exact legacy reference extraction only after the whole bundle validates', async () => {
    const sourceValue = { ...saved(), turnJournals: { turn_one: `thread-turn-${thread(1)}-turn_one` } };
    const candidateValue = { ...saved(), historyBackups: [{ key: 'thread-backup-history_one' }] };
    await seed({ sourceValue, candidateValue });
    const onOwnedSource = vi.fn();
    expect(await discoverStateCasThreadIds(stateDir, { workspaceId, onOwnedSource })).toEqual([thread(1)]);
    expect(onOwnedSource.mock.calls).toEqual([[thread(1), sourceValue], [thread(1), candidateValue]]);
    await seed({ threadId: thread(2), sourceValue: saved(thread(2)), candidateValue: saved(thread(2), foreignWorkspaceId) });
    onOwnedSource.mockClear();
    await expect(discoverStateCasThreadIds(stateDir, { workspaceId, onOwnedSource })).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(onOwnedSource.mock.calls.every(([id]) => id !== thread(2))).toBe(true);
  });

  it('does not expose bytes replaced between owner preflight and the bounded extraction re-read', async () => {
    const bundle = await seed(), source = path.join(bundle.bundle, 'source.json');
    const open = fs.open.bind(fs), onOwnedSource = vi.fn(); let sourceOpens = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/source.json') && ++sourceOpens === 2) {
        await fs.writeFile(source, encode(saved(thread(1), foreignWorkspaceId)));
      }
      return open(...args);
    });
    await expect(discoverStateCasThreadIds(stateDir, { workspaceId, onOwnedSource })).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_CHANGED' });
    expect(onOwnedSource).not.toHaveBeenCalled();
    expect((JSON.parse(await fs.readFile(source, 'utf8')) as { thread: { workspaceId: string } }).thread.workspaceId).toBe(foreignWorkspaceId);
  });

  it('discovers and removes an interrupted whole-bundle quarantine', async () => {
    const bundle = await seed({ threadId: thread(4) });
    const quarantine = path.join(stateDir, `.state-cas-cleanup-${bundle.key}-${bundle.id}-${id()}`);
    await fs.mkdir(quarantine);
    await fs.rename(bundle.bundle, path.join(quarantine, 'bundle'));
    expect(await discoverStateCasThreadIds({ stateDir }, { workspaceId })).toEqual([thread(4)]);
    expect(await run([thread(4)])).toEqual({ removed: 1 });
    expect(await fs.readdir(stateDir)).toEqual([]);
  });

  it('does not invent ownership for a named target whose complete raw owner is foreign', async () => {
    const bundle = await seed({ owner: foreignWorkspaceId });
    await expect(discoverStateCasThreadIds(stateDir, { workspaceId, threadIds: [thread(1)] }))
      .rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
  });

  it.each(['source', 'candidate'] as const)('rejects mixed ownership in the %s, including a parked raced source', async which => {
    const bundle = await seed({ [which === 'source' ? 'sourceValue' : 'candidateValue']: saved(thread(1), foreignWorkspaceId) });
    await expect(discoverStateCasThreadIds(stateDir, { workspaceId })).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(path.join(bundle.bundle, `${which}.json`))).toEqual(which === 'source' ? bundle.source : bundle.candidate);
    expect(await quarantines()).toEqual([]);
  });

  it('rejects a raw transcript for a different thread even in the requested workspace', async () => {
    const bundle = await seed({ sourceValue: saved(thread(2)) });
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
  });

  it('requires immutable desired bytes to match the prepared candidate', async () => {
    const bundle = await seed();
    const changed = encode(saved(thread(1), workspaceId, 'another prepared conversation'));
    await fs.writeFile(path.join(bundle.bundle, 'candidate.json'), changed);
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(path.join(bundle.bundle, 'candidate.json'))).toEqual(changed);
  });

  it.each(['wrong-key', 'wrong-id', 'extra-field', 'unsafe-version'] as const)('retains invalid immutable manifests: %s', async kind => {
    const bundle = await seed();
    const value = { ...bundle.manifest, ...(kind === 'wrong-key' ? { key: `thread-${thread(2)}` }
      : kind === 'wrong-id' ? { id: id() } : kind === 'extra-field' ? { hiddenTranscript: 'unowned bytes' }
        : { expectedVersion: 'bad\u0000version' }) };
    await fs.writeFile(path.join(bundle.bundle, 'manifest.json'), encode(value));
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
  });

  it('refuses unknown leaf names and unknown structured phase data before any unlink', async () => {
    const bundle = await seed({ phases: true });
    await fs.writeFile(path.join(bundle.bundle, 'other.json'), 'do not remove');
    const unlink = vi.spyOn(fs, 'unlink');
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_UNSAFE' });
    expect(unlink).not.toHaveBeenCalled();
    await fs.unlink(path.join(bundle.bundle, 'other.json'));
    await fs.writeFile(path.join(bundle.bundle, 'parked.json'), encode({ version: 1, id: bundle.id, key: bundle.key,
      createdAt, unsafe: { content: 'unknown owner' } }));
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
  });

  it.each(['symlink', 'hardlink', 'directory'] as const)('refuses a %s transcript without touching outside data', async kind => {
    const bundle = await seed(), source = path.join(bundle.bundle, 'source.json'), outside = path.join(directory, 'outside.json');
    await fs.rename(source, outside);
    if (kind === 'symlink') await fs.symlink(outside, source);
    else if (kind === 'hardlink') await fs.link(outside, source);
    else await fs.mkdir(source);
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_UNSAFE' });
    expect(await fs.readFile(outside)).toEqual(bundle.source);
  });

  it('refuses a symlink bundle and a symlink state root', async () => {
    const bundle = await seed(), outside = path.join(directory, 'outside-bundle');
    await fs.rename(bundle.bundle, outside); await fs.symlink(outside, bundle.bundle);
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_UNSAFE' });
    expect(await fs.readFile(path.join(outside, 'source.json'))).toEqual(bundle.source);
    await fs.unlink(bundle.bundle); await fs.rename(outside, bundle.bundle);
    const retainedState = path.join(directory, 'retained-state');
    await fs.rename(stateDir, retainedState); await fs.symlink(retainedState, stateDir);
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_UNSAFE' });
    expect(await fs.readFile(path.join(retainedState, bundle.name, 'source.json'))).toEqual(bundle.source);
  });

  it('bounds sparse transcript reads before loading oversized contents', async () => {
    const bundle = await seed(), source = path.join(bundle.bundle, 'source.json');
    await fs.truncate(source, STATE_CAS_CLEANUP_LIMITS.recordBytes + 1);
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_LIMIT' });
    expect((await fs.lstat(source)).size).toBe(STATE_CAS_CLEANUP_LIMITS.recordBytes + 1);
    expect(await quarantines()).toEqual([]);
  });

  it('checks current deletion authority before any mutation and queues retirement by original source key', async () => {
    const bundle = await seed();
    const denied = new Error('Deletion authority was revoked');
    await expect(cleanupStateCasForThreads(stateDir, { workspaceId, threadIds: [thread(1)],
      checkAllowed: async () => { throw denied; } })).rejects.toBe(denied);
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
    let currentKey: string | undefined;
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      expect(currentKey).toBe(bundle.key);
      return rename(from, to);
    });
    const queued = vi.fn();
    const withSourceMutation = async <T,>(key: string, operation: () => Promise<T>): Promise<T> => {
      queued(key);
      expect(currentKey).toBeUndefined(); currentKey = key;
      try { return await operation(); } finally { currentKey = undefined; }
    };
    expect(await cleanupStateCasForThreads(stateDir, { workspaceId, threadIds: [thread(1)], withSourceMutation })).toEqual({ removed: 1 });
    expect(queued).toHaveBeenCalledTimes(1); expect(queued).toHaveBeenCalledWith(bundle.key);
  });

  it('retains the actual raced foreign source moved after preflight instead of unlinking it', async () => {
    const bundle = await seed(), replacement = encode(saved(thread(1), foreignWorkspaceId, 'foreign raced transcript'));
    const rename = fs.rename.bind(fs), unlink = vi.spyOn(fs, 'unlink');
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith(`/${bundle.name}`)) await fs.writeFile(path.join(bundle.bundle, 'source.json'), replacement);
      return rename(from, to);
    });
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(await parkedBundle(), 'source.json'))).toEqual(replacement);
    await expect(fs.lstat(bundle.bundle)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('hash-checks same-inode same-size source edits with restored mtime after parking', async () => {
    const bundle = await seed(), source = path.join(bundle.bundle, 'source.json');
    const replacement = Buffer.from(bundle.source.toString('utf8').replaceAll('initial conversation', 'altered conversation'));
    expect(replacement.length).toBe(bundle.source.length);
    const fixed = new Date(createdAt); await fs.utimes(source, fixed, fixed);
    const before = await fs.stat(source, { bigint: true }), rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith(`/${bundle.name}`)) { await fs.writeFile(source, replacement); await fs.utimes(source, fixed, fixed); }
      return rename(from, to);
    });
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_CHANGED' });
    const parked = path.join(await parkedBundle(), 'source.json'), after = await fs.stat(parked, { bigint: true });
    expect(after.ino).toBe(before.ino); expect(after.size).toBe(before.size); expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(await fs.readFile(parked)).toEqual(replacement);
  });

  it('retains a foreign directory that wins the original bundle name before rename', async () => {
    const bundle = await seed(), displaced = path.join(directory, 'displaced-original'), foreign = encode(saved(thread(1), foreignWorkspaceId));
    const rename = fs.rename.bind(fs), unlink = vi.spyOn(fs, 'unlink');
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith(`/${bundle.name}`)) {
        await rename(bundle.bundle, displaced); await fs.mkdir(bundle.bundle);
        await fs.writeFile(path.join(bundle.bundle, 'manifest.json'), encode(bundle.manifest));
        await fs.writeFile(path.join(bundle.bundle, 'source.json'), foreign);
      }
      return rename(from, to);
    });
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_CHANGED' });
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(await parkedBundle(), 'source.json'))).toEqual(foreign);
    expect(await fs.readFile(path.join(displaced, 'source.json'))).toEqual(bundle.source);
  });

  it('never overwrites a nonempty foreign destination appearing in the fresh quarantine', async () => {
    const bundle = await seed(), rename = fs.rename.bind(fs), unlink = vi.spyOn(fs, 'unlink');
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith(`/${bundle.name}`)) {
        await fs.mkdir(to); await fs.writeFile(path.join(String(to), 'foreign.txt'), 'foreign destination bytes');
      }
      return rename(from, to);
    });
    await expect(run()).rejects.toThrow();
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
    expect(await fs.readFile(path.join(await parkedBundle(), 'foreign.txt'), 'utf8')).toBe('foreign destination bytes');
  });

  it('pins the state ancestor when its public name is replaced after parking', async () => {
    const bundle = await seed(), retained = path.join(directory, 'retained-state'), foreign = path.join(directory, 'foreign-state');
    await fs.mkdir(foreign); await fs.writeFile(path.join(foreign, 'source.json'), 'foreign ancestor bytes');
    const rename = fs.rename.bind(fs), unlink = vi.spyOn(fs, 'unlink'); let replaced = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to);
      if (!replaced && String(from).endsWith(`/${bundle.name}`)) {
        replaced = true; await rename(stateDir, retained); await fs.symlink(foreign, stateDir);
      }
    });
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_CHANGED' });
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(foreign, 'source.json'), 'utf8')).toBe('foreign ancestor bytes');
    const quarantine = (await fs.readdir(retained)).find(name => name.startsWith('.state-cas-cleanup-'));
    expect(quarantine).toBeDefined();
    expect(await fs.readFile(path.join(retained, quarantine!, 'bundle', 'source.json'))).toEqual(bundle.source);
  });

  it('does not report completion when a new matching bundle appears during the last directory removal', async () => {
    const bundle = await seed(), rmdir = fs.rmdir.bind(fs); let recreated = false;
    vi.spyOn(fs, 'rmdir').mockImplementation(async name => {
      await rmdir(name);
      if (!recreated && String(name).includes('/.state-cas-cleanup-')) {
        recreated = true; await fs.mkdir(bundle.bundle);
        await fs.writeFile(path.join(bundle.bundle, 'manifest.json'), encode(bundle.manifest));
        await fs.writeFile(path.join(bundle.bundle, 'source.json'), bundle.source);
      }
    });
    await expect(run()).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_CHANGED' });
    expect(recreated).toBe(true);
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
  });

  it('resumes partial exact deletion from a durable quarantine without a live thread record', async () => {
    await seed({ phases: true });
    const unlink = fs.unlink.bind(fs); let interrupted = false;
    const fault = vi.spyOn(fs, 'unlink').mockImplementation(async file => {
      if (!interrupted && String(file).endsWith('/candidate.json')) {
        interrupted = true; throw Object.assign(new Error('Injected removal outage'), { code: 'EIO' });
      }
      return unlink(file);
    });
    await expect(run()).rejects.toThrow('Injected removal outage');
    const parked = await parkedBundle();
    await expect(fs.lstat(path.join(parked, 'source.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await discoverStateCasThreadIds(stateDir, { workspaceId })).toEqual([thread(1)]);
    fault.mockRestore();
    expect(await run()).toEqual({ removed: 1 });
    expect(await fs.readdir(stateDir)).toEqual([]);
  });

  it('finishes an empty quarantined bundle left after its final manifest unlink', async () => {
    await seed();
    const rmdir = fs.rmdir.bind(fs); let interrupted = false;
    const fault = vi.spyOn(fs, 'rmdir').mockImplementation(async directory => {
      if (!interrupted && String(directory).endsWith('/bundle')) {
        interrupted = true; throw Object.assign(new Error('Injected directory outage'), { code: 'EIO' });
      }
      return rmdir(directory);
    });
    await expect(run()).rejects.toThrow('Injected directory outage');
    expect(await fs.readdir(await parkedBundle())).toEqual([]);
    fault.mockRestore();
    expect(await run()).toEqual({ removed: 1 });
    expect(await fs.readdir(stateDir)).toEqual([]);
  });

  it('ignores inexact and non-thread namespaces and validates requested IDs before touching disk', async () => {
    const bundle = await seed(), inexact = `${bundle.bundle}-extra`, other = path.join(stateDir, `.state-cas-settings-${id()}`);
    await fs.mkdir(inexact); await fs.writeFile(path.join(inexact, 'source.json'), 'not authorized by this namespace');
    await fs.mkdir(other); await fs.writeFile(path.join(other, 'source.json'), 'global state');
    await expect(run(['../outside'])).rejects.toMatchObject({ code: 'STATE_CAS_CLEANUP_OWNERSHIP' });
    expect(await run()).toEqual({ removed: 1 });
    expect(await fs.readFile(path.join(inexact, 'source.json'), 'utf8')).toBe('not authorized by this namespace');
    expect(await fs.readFile(path.join(other, 'source.json'), 'utf8')).toBe('global state');
  });

  it('does not create missing state directories or touch an empty request', async () => {
    const bundle = await seed();
    expect(await run([])).toEqual({ removed: 0 });
    expect(await fs.readFile(path.join(bundle.bundle, 'source.json'))).toEqual(bundle.source);
    const missing = path.join(directory, 'missing-state');
    expect(await cleanupStateCasForThreads(missing, { workspaceId, threadIds: [thread(1)] })).toEqual({ removed: 0 });
    expect(await discoverStateCasThreadIds(missing, { workspaceId })).toEqual([]);
    await expect(fs.lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
