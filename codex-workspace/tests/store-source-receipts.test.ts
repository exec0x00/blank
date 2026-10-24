import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JsonStore } from '../server/store';

const version = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};

describe('JSON source receipts bound to exact read and queued write snapshots', () => {
  let directory: string, state: string, store: JsonStore;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-store-receipt-'));
    state = path.join(directory, 'state'); await fs.mkdir(state);
    store = new JsonStore(state);
  });
  afterEach(async () => {
    vi.restoreAllMocks(); await store.flush(); await fs.rm(directory, { recursive: true, force: true });
  });

  it('returns the exact written and read fingerprint without changing the existing JSON format or cache isolation', async () => {
    const value = { revision: 1, nested: { tokens: 40 } };
    const receipt = await store.writeWithVersion('record', value);
    expect(receipt.version).toBe(version(await fs.lstat(path.join(state, 'record.json'), { bigint: true })));
    expect(await fs.readFile(path.join(state, 'record.json'), 'utf8')).toBe(JSON.stringify(value, null, 2) + '\n');
    const first = await store.readWithVersion('record', null);
    expect(first).toEqual({ value, version: receipt.version });
    (first.value as unknown as typeof value).nested.tokens = 999;
    expect(await store.read('record', null)).toEqual(value);
    const fallback = { values: [1] }, missing = await store.readWithVersion('absent', fallback);
    expect(missing).toEqual({ value: fallback });
    missing.value.values.push(2); expect(fallback.values).toEqual([1]);
  });

  it('pairs two queued writes with their immutable values despite later changes to the same live object', async () => {
    const entered = deferred(), release = deferred(), observed: Array<{ revision: number; nested: { tokens: number } }> = [];
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to);
      if (String(to).endsWith('/record.json')) {
        observed.push(JSON.parse(await fs.readFile(to, 'utf8')) as typeof observed[number]);
        if (observed.length === 1) { entered.resolve(); await release.promise; }
      }
    });
    const live = { revision: 1, nested: { tokens: 20 } };
    const first = store.writeWithVersion('record', live);
    await entered.promise;
    live.revision = 2; live.nested.tokens = 50;
    const second = store.writeWithVersion('record', live);
    live.revision = 3; live.nested.tokens = 900;
    release.resolve();
    const [one, two] = await Promise.all([first, second]);
    expect(observed).toEqual([{ revision: 1, nested: { tokens: 20 } }, { revision: 2, nested: { tokens: 50 } }]);
    expect(one.version).not.toBe(two.version);
    expect(await store.readWithVersion('record', null)).toEqual({ value: observed[1], version: two.version });
  });

  it('keeps failure-before and failure-after replacement instrumentation on the existing write method', async () => {
    await store.write('record', { revision: 0 });
    const actual = store.write.bind(store);
    const spy = vi.spyOn(store, 'write').mockImplementation(async (key, value) => {
      if ((value as { revision: number }).revision === 1) throw new Error('Injected failure before replacement.');
      await actual(key, value);
      if ((value as { revision: number }).revision === 2) throw new Error('Injected failure after replacement.');
    });
    await expect(store.writeWithVersion('record', { revision: 1 })).rejects.toThrow('before replacement');
    expect(await store.read('record', null)).toEqual({ revision: 0 });
    await expect(store.writeWithVersion('record', { revision: 2 })).rejects.toThrow('after replacement');
    expect(await store.read('record', null)).toEqual({ revision: 2 });
    const third = await store.writeWithVersion('record', { revision: 3 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await store.readWithVersion('record', null)).toEqual({ value: { revision: 3 }, version: third.version });
  });

  it('guards the complete logical JSON value inside the write queue and returns the actual conditional write receipt', async () => {
    const original = { revision: 1, nested: { tokens: 20 } }, next = { revision: 2, nested: { tokens: 40 } };
    await store.write('record', original);
    const expectedDigest = createHash('sha256').update(JSON.stringify(original)).digest('hex');
    const receipt = await store.writeWithVersion('record', next, { expectedDigest });
    expect(await store.readWithVersion('record', null)).toEqual({ value: next, version: receipt.version });
    await expect(store.writeWithVersion('record', { revision: 3 }, { expectedDigest })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await store.read('record', null)).toEqual(next);
    await expect(store.writeWithVersion('absent', next, { expectedDigest })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(store.writeWithVersion('record', next, { expectedDigest: 'invalid' })).rejects.toThrow('SHA-256');
  });

  it('does not overwrite a direct filesystem edit occurring after the digest read but before conditional replacement', async () => {
    const original = { revision: 1 }, file = path.join(state, 'record.json');
    await store.write('record', original);
    const expectedDigest = createHash('sha256').update(JSON.stringify(original)).digest('hex'), open = fs.open.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, mode) => {
      const handle = await open(target, flags, mode);
      if (!changed && flags === 'wx' && String(target).includes('/record.json.')) {
        changed = true; await fs.writeFile(file, JSON.stringify({ concurrent: 'preserve this exact update' }));
      }
      return handle;
    });
    await expect(store.writeWithVersion('record', { revision: 2 }, { expectedDigest })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(changed).toBe(true);
    expect(await store.read('record', null)).toEqual({ concurrent: 'preserve this exact update' });
  });

  it('does not issue a receipt for a different inode installed over the named destination during replacement', async () => {
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to);
      if (String(to).endsWith('/record.json')) { await fs.unlink(to); await fs.writeFile(to, JSON.stringify({ foreign: true })); }
    });
    await expect(store.writeWithVersion('record', { revision: 1 })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await fs.readFile(path.join(state, 'record.json'), 'utf8')).toBe(JSON.stringify({ foreign: true }));
  });

  it('rejects a same-inode, same-length edit whose exact original mtime is restored during rename', async () => {
    const fixed = new Date('2020-01-01T00:00:00.000Z'), open = fs.open.bind(fs), rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (flags === 'wx' && String(file).includes('/record.json.') && String(file).endsWith('.tmp')) {
        const writeFile = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => {
          await writeFile(data, options); await handle.utimes(fixed, fixed);
        });
      }
      return handle;
    });
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to);
      if (String(to).endsWith('/record.json')) {
        const original = await fs.readFile(to, 'utf8'), changed = original.replace('"tokens": 20', '"tokens": 90');
        expect(changed).not.toBe(original); expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));
        await fs.writeFile(to, changed); await fs.utimes(to, fixed, fixed);
      }
    });
    await expect(store.writeWithVersion('record', { tokens: 20 })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await store.read('record', null)).toEqual({ tokens: 90 });
  });

  it('pins the receipt write namespace when the state directory changes after the temporary file was written', async () => {
    const outside = path.join(directory, 'outside'), moved = state + '-detached';
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'record.json'), 'OUTSIDE_SENTINEL');
    const rename = fs.rename.bind(fs); let swapped = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (!swapped && String(to).endsWith('/record.json')) {
        swapped = true; await rename(state, moved); await fs.symlink(outside, state);
      }
      return rename(from, to);
    });
    try {
      await expect(store.writeWithVersion('record', { revision: 1 })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      expect(swapped).toBe(true);
      expect(await fs.readFile(path.join(outside, 'record.json'), 'utf8')).toBe('OUTSIDE_SENTINEL');
      expect(await fs.readdir(outside)).toEqual(['record.json']);
    } finally {
      vi.restoreAllMocks();
      if (swapped) { await fs.unlink(state); await rename(moved, state); }
    }
  });

  it('rejects an unsafe directory without following it for receipt writes or cleanup', async () => {
    const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'record.json'), 'PRESERVE_OUTSIDE');
    await fs.rmdir(state); await fs.symlink(outside, state);
    await expect(store.writeWithVersion('record', { revision: 1 })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await fs.readFile(path.join(outside, 'record.json'), 'utf8')).toBe('PRESERVE_OUTSIDE');
    expect(await fs.readdir(outside)).toEqual(['record.json']);
  });

  it('shares exact-key serialization and cache invalidation with pinned guarded lifecycle mutations', async () => {
    await store.write('record', { value: 'before' }); await store.read('record', null);
    const entered = deferred(), release = deferred(); let calls = 0, updaterStarted = false;
    const guarded = store.mutateGuarded('record', async () => {
      calls++; await fs.writeFile(path.join(state, 'record.json'), JSON.stringify({ value: 'guarded' }));
      entered.resolve(); await release.promise; return 42;
    });
    await entered.promise;
    const updating = store.update('record', { value: '' }, current => { updaterStarted = true; expect(current.value).toBe('guarded'); return { value: 'after' }; });
    await Promise.resolve(); expect(updaterStarted).toBe(false);
    release.resolve(); expect(await guarded).toBe(42); await updating;
    expect(calls).toBe(1); expect(await store.read('record', null)).toEqual({ value: 'after' });
    await expect(store.mutateGuarded('record', async () => {
      await fs.writeFile(path.join(state, 'record.json'), JSON.stringify({ value: 'retained after failure' })); throw new Error('Guarded cleanup stopped.');
    })).rejects.toThrow('stopped');
    expect(await store.read('record', null)).toEqual({ value: 'retained after failure' });
    expect(() => store.mutateGuarded('../outside', async () => undefined)).toThrow('Invalid storage key');
  });
});
