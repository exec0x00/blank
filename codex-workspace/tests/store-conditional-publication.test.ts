import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JsonStore } from '../server/store';
import type { ConditionalJsonRecoveryInput } from '../server/store-conditional';
import * as atomic from '../server/native-atomic-rename';
import { STATE_CAS_LIMITS } from '../server/store-conditional';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const raw = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const identity = `thr_${'a'.repeat(32)}`;
const isCreate = (flags: string | number | undefined) => typeof flags === 'number' && !!(flags & constants.O_EXCL);

describe('source-preserving conditional JSON publication', () => {
  let directory: string, store: JsonStore;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-state-cas-')); store = new JsonStore(directory); });
  afterEach(async () => { vi.restoreAllMocks(); await store.flush(); await fs.rm(directory, { recursive: true, force: true }); });
  async function bundles(key: string) {
    return (await fs.readdir(directory)).filter(name => name.startsWith(`.state-cas-${key}-`)).sort();
  }

  it.each(['in place', 'replacement inode'] as const)('preserves a last-moment %s source before the actual parking syscall', async mode => {
    const original = { revision: 1, title: 'Original transcript' }, desired = { revision: 2, title: 'Requested rewind' };
    const external = { revision: 9, title: 'This later external transcript must survive' }, target = path.join(directory, 'record.json');
    await store.write('record', original);
    const rename = fs.rename.bind(fs), move = atomic.renameNoReplace; let injected = false;
    vi.spyOn(atomic, 'renameNoReplace').mockImplementation(async (fromFd, from, toFd, to) => {
      if (!injected && from === 'record.json' && to === 'source.json') {
        injected = true;
        if (mode === 'in place') await fs.writeFile(target, raw(external));
        else { const replacement = path.join(directory, 'outside-writer.tmp'); await fs.writeFile(replacement, raw(external)); await rename(replacement, target); }
      }
      return move(fromFd, from, toFd, to);
    });
    await expect(store.writeWithVersion('record', desired, { expectedDigest: digest(original) })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(injected).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe(raw(external));
    expect(await store.read('record', null)).toEqual(external);
    const retained = await bundles('record'); expect(retained).toHaveLength(1);
    expect(await fs.readFile(path.join(directory, retained[0], 'source.json'), 'utf8')).toBe(raw(external));
    expect(await fs.readFile(path.join(directory, retained[0], 'candidate.json'), 'utf8')).toBe(raw(desired));
  });

  it('keeps a newer destination claimed immediately after parking and retains the original separately', async () => {
    const original = { revision: 1 }, desired = { revision: 2 }, later = { revision: 99, source: 'new namespace claimant' };
    const target = path.join(directory, 'record.json'); await store.write('record', original);
    const move = atomic.renameNoReplace; let claimed = false;
    vi.spyOn(atomic, 'renameNoReplace').mockImplementation(async (fromFd, from, toFd, to) => {
      await move(fromFd, from, toFd, to);
      if (!claimed && from === 'record.json' && to === 'source.json') {
        claimed = true; await fs.writeFile(target, raw(later), { flag: 'wx' });
      }
    });
    await expect(store.writeWithVersion('record', desired, { expectedDigest: digest(original) })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await fs.readFile(target, 'utf8')).toBe(raw(later));
    const retained = await bundles('record');
    expect(await fs.readFile(path.join(directory, retained[0], 'source.json'), 'utf8')).toBe(raw(original));
  });

  it('retains the inode that a previously opened external descriptor keeps modifying after it is parked', async () => {
    const original = { revision: 1 }, target = path.join(directory, 'record.json'); await store.write('record', original);
    const descriptor = await fs.open(target, 'r+'), move = atomic.renameNoReplace; let parked = false;
    vi.spyOn(atomic, 'renameNoReplace').mockImplementation(async (fromFd, from, toFd, to) => {
      await move(fromFd, from, toFd, to);
      if (!parked && from === 'record.json' && to === 'source.json') {
        parked = true;
        await descriptor.truncate(0); await descriptor.writeFile(raw({ revision: 7, external: 'kept through the original fd' }));
      }
    });
    try {
      await expect(store.writeWithVersion('record', { revision: 2 }, { expectedDigest: digest(original) })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      const retained = await bundles('record');
      expect(JSON.parse(await fs.readFile(path.join(directory, retained[0], 'source.json'), 'utf8'))).toEqual({ revision: 7, external: 'kept through the original fd' });
    } finally { await descriptor.close(); }
  });

  it.each(['before', 'after'] as const)('preserves or restores the actual source when parking reports failure %s the syscall', async phase => {
    const original = { revision: 1 }, target = path.join(directory, 'record.json'); await store.write('record', original);
    const move = atomic.renameNoReplace; let injected = false;
    vi.spyOn(atomic, 'renameNoReplace').mockImplementation(async (fromFd, from, toFd, to) => {
      if (!injected && from === 'record.json' && to === 'source.json') {
        injected = true;
        if (phase === 'after') await move(fromFd, from, toFd, to);
        throw Object.assign(new Error('Injected parking failure'), { code: 'EIO' });
      }
      return move(fromFd, from, toFd, to);
    });
    await expect(store.writeWithVersion('record', { revision: 2 }, { expectedDigest: digest(original) })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(injected).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe(raw(original));
    const retained = await bundles('record'); expect(retained).toHaveLength(1);
    expect(await fs.readFile(path.join(directory, retained[0], 'candidate.json'), 'utf8')).toBe(raw({ revision: 2 }));
  });

  it('publishes only the verified desired value and keeps complete recovery bytes after success', async () => {
    const original = { revision: 1 }, desired = { revision: 2 }; await store.write('record', original);
    const receipt = await store.writeWithVersion('record', desired, { expectedDigest: digest(original) });
    expect(await store.readWithVersion('record', null)).toEqual({ value: desired, version: receipt.version });
    const retained = await bundles('record'); expect(retained).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(path.join(directory, retained[0], 'source.json'), 'utf8'))).toEqual(original);
    expect(JSON.parse(await fs.readFile(path.join(directory, retained[0], 'candidate.json'), 'utf8'))).toEqual(desired);
    expect(JSON.parse(await fs.readFile(path.join(directory, retained[0], 'committed.json'), 'utf8'))).toMatchObject({ version: 1, key: 'record' });
  });

  it('never chunk-writes the canonical name and preserves an edit immediately after atomic publication', async () => {
    const original = { revision: 1 }, desired = { revision: 2 }, later = { revision: 7, edit: 'Written after the complete inode appeared.' };
    const target = path.join(directory, 'record.json'); await store.write('record', original);
    const opened = vi.spyOn(fs, 'open'), move = atomic.renameNoReplace; let injected = false;
    vi.spyOn(atomic, 'renameNoReplace').mockImplementation(async (fromFd, from, toFd, to) => {
      await move(fromFd, from, toFd, to);
      if (!injected && from === 'publication.json' && to === 'record.json') { injected = true; await fs.writeFile(target, raw(later)); }
    });
    await expect(store.writeWithVersion('record', desired, { expectedDigest: digest(original) })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(injected).toBe(true); expect(await fs.readFile(target, 'utf8')).toBe(raw(later));
    expect(opened.mock.calls.some(([file, flags]) => String(file).endsWith('/record.json') && isCreate(flags))).toBe(false);
  });

  it('fails closed before displacing the source when the atomic primitive is unavailable and leaves no unmanaged temporary', async () => {
    const original = { revision: 1 }; await store.write('record', original);
    vi.spyOn(atomic, 'renameNoReplace').mockRejectedValue(Object.assign(new Error('Missing native primitive.'), { code: 'ERR_ATOMIC_RENAME_UNAVAILABLE' }));
    await expect(store.writeWithVersion('record', { revision: 2 }, { expectedDigest: digest(original) })).rejects.toMatchObject({ code: 'STATE_ATOMIC_UNAVAILABLE' });
    expect(await store.read('record', null)).toEqual(original);
    expect((await fs.readdir(directory)).filter(name => name.startsWith('record.json.') && name.endsWith('.tmp'))).toEqual([]);
  });

  it('enforces conditional source and replacement size limits before reading or creating large prepared files', async () => {
    const target = path.join(directory, 'record.json'), original = { revision: 1 }; await store.write('record', original);
    await expect(store.writeWithVersion('record', { body: 'x'.repeat(STATE_CAS_LIMITS.bytes) }, { expectedDigest: digest(original) })).rejects.toMatchObject({ code: 'STATE_CAS_LIMIT' });
    expect((await fs.readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    const handle = await fs.open(target, 'r+'); await handle.truncate(8 * 1024 ** 3); await handle.close();
    const opened = vi.spyOn(fs, 'open');
    await expect(store.writeWithVersion('record', { revision: 2 }, { expectedDigest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'STATE_CAS_LIMIT' });
    expect(opened.mock.calls.some(([file]) => String(file).endsWith('/record.json'))).toBe(false);
  }, 15_000);

  async function unfinishedThread() {
    const key = `thread-${identity}`, workspaceId = 'workspace_recovery';
    const original = { thread: { id: identity, workspaceId, messages: [{ role: 'user', content: 'Original request.' }] }, revision: 1 };
    const desired = { thread: { ...original.thread, messages: [] }, revision: 2 };
    await store.write(key, original);
    const move = atomic.renameNoReplace;
    const denied = vi.spyOn(atomic, 'renameNoReplace').mockImplementation(async (fromFd, from, toFd, to) => {
      if (to === `${key}.json`) throw Object.assign(new Error('Injected unavailable publication'), { code: 'EACCES' });
      return move(fromFd, from, toFd, to);
    });
    await expect(store.writeWithVersion(key, desired, { expectedDigest: digest(original) })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    denied.mockRestore();
    await expect(fs.lstat(path.join(directory, `${key}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
    const input: ConditionalJsonRecoveryInput = { threadId: identity, workspaceId, expectedLogicalDigest: digest(original),
      expectedRawSha256: sha(raw(original)), desiredRawSha256: sha(raw(desired)), checkAllowed: async () => undefined };
    return { key, original, desired, input };
  }

  it('restores only a unique receipt-matched original into absence on a fresh store, retaining the rewind barrier artifacts', async () => {
    const fixture = await unfinishedThread(), restarted = new JsonStore(directory);
    const allowed = vi.fn(async () => undefined);
    expect(await restarted.recoverConditionalKey(fixture.key, { ...fixture.input, checkAllowed: allowed })).toBe(true);
    expect(allowed.mock.calls.length).toBeGreaterThan(1);
    expect(await restarted.read(fixture.key, null)).toEqual(fixture.original);
    const retained = await bundles(fixture.key); expect(retained).toHaveLength(1);
    expect(await fs.readFile(path.join(directory, retained[0], 'candidate.json'), 'utf8')).toBe(raw(fixture.desired));
    expect(await restarted.recoverConditionalKey(fixture.key, fixture.input)).toBe(false);
    await fs.unlink(path.join(directory, `${fixture.key}.json`));
    expect(await restarted.recoverConditionalKey(fixture.key, fixture.input)).toBe(false);
  });

  it('refuses missing signed authority, ownership mismatch, ambiguity and permanent deletion markers', async () => {
    const fixture = await unfinishedThread();
    await expect(store.recoverConditionalKey(fixture.key, { ...fixture.input, checkAllowed: async () => { throw new Error('Signed operation was revoked.'); } })).rejects.toThrow('revoked');
    expect(await store.recoverConditionalKey(fixture.key, { ...fixture.input, expectedRawSha256: '0'.repeat(64) })).toBe(false);
    await expect(store.recoverConditionalKey(fixture.key, { ...fixture.input, workspaceId: 'another_workspace' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const [retained] = await bundles(fixture.key), duplicateId = 'b'.repeat(32), duplicate = `.state-cas-${fixture.key}-${duplicateId}`;
    await fs.cp(path.join(directory, retained), path.join(directory, duplicate), { recursive: true });
    const metadataFile = path.join(directory, duplicate, 'manifest.json'), metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
    metadata.id = duplicateId; await fs.writeFile(metadataFile, raw(metadata));
    await expect(store.recoverConditionalKey(fixture.key, fixture.input)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await fs.rm(path.join(directory, duplicate), { recursive: true });
    await store.write(`thread-deleted-${identity}`, { version: 1, id: identity, deletedAt: new Date().toISOString() });
    await expect(store.recoverConditionalKey(fixture.key, fixture.input)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(fs.lstat(path.join(directory, `${fixture.key}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never replaces a canonical destination created between recovery checks and atomic publication', async () => {
    const fixture = await unfinishedThread(), target = path.join(directory, `${fixture.key}.json`);
    const later = { thread: { id: identity, workspaceId: fixture.input.workspaceId, messages: ['A later user edit.'] }, revision: 99 };
    const move = atomic.renameNoReplace; let injected = false;
    vi.spyOn(atomic, 'renameNoReplace').mockImplementation(async (fromFd, from, toFd, to) => {
      if (!injected && to === `${fixture.key}.json`) { injected = true; await fs.writeFile(target, raw(later), { flag: 'wx' }); }
      return move(fromFd, from, toFd, to);
    });
    expect(await store.recoverConditionalKey(fixture.key, fixture.input)).toBe(false);
    expect(injected).toBe(true); expect(await fs.readFile(target, 'utf8')).toBe(raw(later));
  });
});
