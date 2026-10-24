import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { constants, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { transferNativeEntry, MAX_TRANSFER_BYTES, MAX_TRANSFER_ENTRIES, MAX_TRANSFER_MANIFEST_BYTES, TRANSFER_BUFFER_BYTES } from '../server/file-transfers/filesystem';
import { fileIdentity, type NativeTransferOptions, type TransferManifest } from '../server/file-transfers/types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('verified native file transfers', () => {
  let temporary: string;
  let root: string;
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-file-transfers-'));
    root = path.join(temporary, 'workspace');
    await fs.mkdir(root);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(temporary, { recursive: true, force: true });
  });

  function transfer(source: string, destination: string, options: Partial<NativeTransferOptions> = {}) {
    return transferNativeEntry({ root, source: path.join(root, source), destination: path.join(root, destination), kind: 'move', ...options });
  }

  async function exists(relative: string): Promise<boolean> {
    return fs.lstat(path.join(root, relative)).then(() => true, error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    });
  }

  async function tree() {
    await fs.mkdir(path.join(root, 'source/nested/empty'), { recursive: true });
    const bytes = Buffer.alloc(TRANSFER_BUFFER_BYTES * 3 + 71);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
    await fs.writeFile(path.join(root, 'source/nested/data.bin'), bytes, { mode: 0o640 });
    await fs.writeFile(path.join(root, 'source/run.sh'), '#!/bin/sh\nprintf ready\n', { mode: 0o755 });
    await fs.symlink('nested/data.bin', path.join(root, 'source/data-link'));
    return bytes;
  }

  it('copies exact binary bytes, nested empty folders, executable modes, and links without changing the source', async () => {
    const bytes = await tree();
    const before = await fs.stat(path.join(root, 'source/nested/data.bin'));
    const phases: string[] = [];
    const manifest = await transfer('source', 'new/duplicate', { kind: 'copy', checkpoint: async phase => { phases.push(phase); } });
    expect(await fs.readFile(path.join(root, 'source/nested/data.bin'))).toEqual(bytes);
    expect(await fs.readFile(path.join(root, 'new/duplicate/nested/data.bin'))).toEqual(bytes);
    expect(await fs.readdir(path.join(root, 'new/duplicate/nested/empty'))).toEqual([]);
    expect(await fs.readlink(path.join(root, 'new/duplicate/data-link'))).toBe('nested/data.bin');
    expect((await fs.stat(path.join(root, 'new/duplicate/run.sh'))).mode & 0o777).toBe(0o755);
    expect((await fs.stat(path.join(root, 'new/duplicate/nested/data.bin'))).mode & 0o777).toBe(0o640);
    expect((await fs.stat(path.join(root, 'source/nested/data.bin'))).ino).toBe(before.ino);
    expect(manifest.entries.find(entry => entry.path === 'nested/data.bin')?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(phases).toEqual(['copying', 'verifying', 'complete']);
  });

  it('moves a complete directory without relying on a native directory rename', async () => {
    const bytes = await tree();
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('Directory rename unsupported'), { code: 'ENOSYS' }));
    const phases: string[] = [];
    await transfer('source', 'moved', { checkpoint: async phase => {
      phases.push(phase);
      if (phase === 'removing') {
        expect(await fs.readFile(path.join(root, 'source/nested/data.bin'))).toEqual(bytes);
        expect(await fs.readFile(path.join(root, 'moved/nested/data.bin'))).toEqual(bytes);
      }
    } });
    expect(await exists('source')).toBe(false);
    expect(await fs.readFile(path.join(root, 'moved/nested/data.bin'))).toEqual(bytes);
    expect(await fs.readlink(path.join(root, 'moved/data-link'))).toBe('nested/data.bin');
    expect(phases).toEqual(['copying', 'verifying', 'removing', 'complete']);
    expect(rename).not.toHaveBeenCalled();
  });

  it('copies hard-linked contents but rejects repeated hard-link Move selections before payload writes', async () => {
    await fs.mkdir(path.join(root, 'source'));
    await fs.writeFile(path.join(root, 'source/first'), 'shared bytes');
    await fs.link(path.join(root, 'source/first'), path.join(root, 'source/second'));
    const original = await fs.stat(path.join(root, 'source/first'));
    await transfer('source', 'copy', { kind: 'copy' });
    expect(await fs.readFile(path.join(root, 'copy/first'), 'utf8')).toBe('shared bytes');
    expect(await fs.readFile(path.join(root, 'copy/second'), 'utf8')).toBe('shared bytes');
    await expect(transfer('source', 'moved')).rejects.toMatchObject({ code: 'FILE_TRANSFER_HARD_LINKS' });
    expect((await fs.stat(path.join(root, 'source/first'))).ino).toBe(original.ino);
    expect((await fs.stat(path.join(root, 'source/second'))).ino).toBe(original.ino);
    expect(await exists('moved')).toBe(false);
  });

  it('never overwrites an existing destination or merges an existing folder', async () => {
    await fs.writeFile(path.join(root, 'from.txt'), 'original');
    await fs.writeFile(path.join(root, 'to.txt'), 'destination edit');
    await expect(transfer('from.txt', 'to.txt')).rejects.toMatchObject({ status: 409, code: 'FILE_EXISTS' });
    expect(await fs.readFile(path.join(root, 'from.txt'), 'utf8')).toBe('original');
    expect(await fs.readFile(path.join(root, 'to.txt'), 'utf8')).toBe('destination edit');
    await tree();
    await fs.mkdir(path.join(root, 'existing'));
    await expect(transfer('source', 'existing')).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    expect(await fs.readdir(path.join(root, 'existing'))).toEqual([]);
  });

  it('uses exclusive creation even when another writer claims the destination after the preflight', async () => {
    await fs.writeFile(path.join(root, 'source'), 'source bytes');
    await expect(transfer('source', 'target', { checkpoint: async phase => {
      if (phase === 'copying') await fs.writeFile(path.join(root, 'target'), 'new user file', { flag: 'wx' });
    } })).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('source bytes');
    expect(await fs.readFile(path.join(root, 'target'), 'utf8')).toBe('new user file');
  });

  it('rejects a destination within the source, an ancestor, an identical path, and traversal outside the root', async () => {
    await fs.mkdir(path.join(root, 'source/child'), { recursive: true });
    await fs.writeFile(path.join(root, 'source/file'), 'retain');
    for (const [source, destination] of [['source', 'source/child/again'], ['source/child', 'source'], ['source', 'source']]) {
      await expect(transfer(source, destination)).rejects.toMatchObject({ status: 400, code: 'INVALID_PATH' });
    }
    await expect(transfer('source', '../escaped')).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
    expect(await fs.readFile(path.join(root, 'source/file'), 'utf8')).toBe('retain');
    expect(await fs.readdir(temporary)).toEqual(['workspace']);
  });

  it('moves an outside-pointing symlink itself without reading or changing its target', async () => {
    const outside = path.join(temporary, 'outside');
    await fs.writeFile(outside, 'outside bytes');
    await fs.symlink(outside, path.join(root, 'source-link'));
    await transfer('source-link', 'moved-link');
    expect(await exists('source-link')).toBe(false);
    expect((await fs.lstat(path.join(root, 'moved-link'))).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(path.join(root, 'moved-link'))).toBe(outside);
    expect(await fs.readFile(outside, 'utf8')).toBe('outside bytes');
  });

  it('refuses symlink ancestors on both source and destination paths', async () => {
    const outside = path.join(temporary, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep'), 'outside');
    await fs.symlink(outside, path.join(root, 'escape'));
    await fs.writeFile(path.join(root, 'inside'), 'inside');
    await expect(transfer('escape/keep', 'copied', { kind: 'copy' })).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(transfer('inside', 'escape/written')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await fs.readdir(outside)).toEqual(['keep']);
    expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('outside');
    expect(await exists('inside')).toBe(true);
  });

  it('keeps edited source bytes when an edit arrives after the destination was verified', async () => {
    await fs.writeFile(path.join(root, 'source'), 'before');
    await expect(transfer('source', 'target', { checkpoint: async phase => {
      if (phase === 'verifying') await fs.writeFile(path.join(root, 'source'), 'edited');
    } })).rejects.toMatchObject({ code: 'FILE_TRANSFER_CONFLICT' });
    expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('edited');
    expect(await fs.readFile(path.join(root, 'target'), 'utf8')).toBe('before');
  });

  it('rejects a source exchanged after the caller captured its identity but before copying begins', async () => {
    await fs.writeFile(path.join(root, 'source'), 'original');
    const expectedSource = fileIdentity(await fs.lstat(path.join(root, 'source')));
    await fs.rename(path.join(root, 'source'), path.join(root, 'previous'));
    await fs.writeFile(path.join(root, 'source'), 'replaced');
    await expect(transfer('source', 'target', { expectedSource })).rejects.toMatchObject({ code: 'FILE_TRANSFER_CONFLICT' });
    expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('replaced');
    expect(await fs.readFile(path.join(root, 'previous'), 'utf8')).toBe('original');
    expect(await exists('target')).toBe(false);
  });

  it('preserves a same-path source replacement with the same size and restored mtime', async () => {
    await fs.writeFile(path.join(root, 'source'), 'before');
    const initial = await fs.stat(path.join(root, 'source'));
    await expect(transfer('source', 'target', { checkpoint: async phase => {
      if (phase !== 'verifying') return;
      await fs.rename(path.join(root, 'source'), path.join(root, 'previous'));
      await fs.writeFile(path.join(root, 'source'), 'newest');
      await fs.utimes(path.join(root, 'source'), initial.atime, initial.mtime);
    } })).rejects.toMatchObject({ code: 'FILE_TRANSFER_CONFLICT' });
    expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('newest');
    expect(await fs.readFile(path.join(root, 'previous'), 'utf8')).toBe('before');
    expect(await fs.readFile(path.join(root, 'target'), 'utf8')).toBe('before');
  });

  it('keeps the source when a durability check fails or the destination changes while it waits', async () => {
    await fs.writeFile(path.join(root, 'source'), 'original bytes');
    await expect(transfer('source', 'pending', { verifyDurable: async () => { throw new Error('Remote receipt unavailable'); } })).rejects.toThrow('Remote receipt unavailable');
    expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('original bytes');
    await expect(transfer('source', 'edited', { verifyDurable: async () => {
      await fs.writeFile(path.join(root, 'edited'), 'manual destination edit');
    } })).rejects.toMatchObject({ code: 'FILE_TRANSFER_CONFLICT' });
    expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('original bytes');
    expect(await fs.readFile(path.join(root, 'edited'), 'utf8')).toBe('manual destination edit');
  });

  it('checks the complete destination tree, including unexpected extra files, before removing a source', async () => {
    await tree();
    await expect(transfer('source', 'target', { verifyDurable: async () => {
      await fs.writeFile(path.join(root, 'target/new-user-file'), 'keep this');
    } })).rejects.toMatchObject({ code: 'FILE_TRANSFER_CONFLICT' });
    expect(await exists('source/run.sh')).toBe(true);
    expect(await fs.readFile(path.join(root, 'target/new-user-file'), 'utf8')).toBe('keep this');
  });

  it('does not follow a destination directory exchanged for an outside link during transfer', async () => {
    const outside = path.join(temporary, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep'), 'untouched');
    await fs.writeFile(path.join(root, 'source'), 'original');
    await expect(transfer('source', 'parent/target', { checkpoint: async phase => {
      if (phase !== 'verifying') return;
      await fs.rename(path.join(root, 'parent'), path.join(root, 'moved-parent'));
      await fs.symlink(outside, path.join(root, 'parent'));
    } })).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('original');
    expect(await fs.readFile(path.join(root, 'moved-parent/target'), 'utf8')).toBe('original');
    expect(await fs.readdir(outside)).toEqual(['keep']);
  });

  it('stops per-entry removal on a later source edit and preserves all newer source bytes', async () => {
    await fs.mkdir(path.join(root, 'source'));
    await fs.writeFile(path.join(root, 'source/a'), 'first');
    await fs.writeFile(path.join(root, 'source/b'), 'second');
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      await unlink(target);
      if (String(target).endsWith('/a')) await fs.writeFile(path.join(root, 'source/b'), 'newest second');
    });
    await expect(transfer('source', 'target')).rejects.toMatchObject({ code: 'FILE_TRANSFER_CONFLICT' });
    expect(await exists('source/a')).toBe(false);
    expect(await fs.readFile(path.join(root, 'source/b'), 'utf8')).toBe('newest second');
    expect(await fs.readFile(path.join(root, 'target/a'), 'utf8')).toBe('first');
    expect(await fs.readFile(path.join(root, 'target/b'), 'utf8')).toBe('second');
  });

  it('never removes newly added entries when the source changes during per-entry cleanup', async () => {
    await fs.mkdir(path.join(root, 'source'));
    await fs.writeFile(path.join(root, 'source/a'), 'first');
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      await unlink(target);
      if (String(target).endsWith('/a')) await fs.writeFile(path.join(root, 'source/new-file'), 'user edit');
    });
    await expect(transfer('source', 'target')).rejects.toMatchObject({ code: 'FILE_TRANSFER_CONFLICT' });
    expect(await fs.readFile(path.join(root, 'source/new-file'), 'utf8')).toBe('user edit');
    expect(await fs.readFile(path.join(root, 'target/a'), 'utf8')).toBe('first');
  });

  it('retains a partial destination after a real partial write failure and never begins source removal', async () => {
    await fs.writeFile(path.join(root, 'source'), Buffer.alloc(TRANSFER_BUFFER_BYTES + 31, 173));
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (typeof flags !== 'number' || (flags & constants.O_EXCL) === 0 || !String(file).endsWith('/target')) return handle;
      return new Proxy(handle, { get(object, property) {
        if (property === 'write') return async (buffer: Buffer, offset: number, length: number, position: number | null) => {
          await object.write(buffer, offset, Math.min(length, 73), position);
          throw Object.assign(new Error('Injected storage failure after writing bytes'), { code: 'EIO' });
        };
        const member = Reflect.get(object, property, object);
        return typeof member === 'function' ? member.bind(object) : member;
      } }) as FileHandle;
    });
    const phases: string[] = [];
    await expect(transfer('source', 'target', { checkpoint: async phase => { phases.push(phase); } })).rejects.toMatchObject({ code: 'EIO' });
    expect((await fs.readFile(path.join(root, 'source'))).length).toBe(TRANSFER_BUFFER_BYTES + 31);
    expect(await fs.readFile(path.join(root, 'target'))).toEqual(Buffer.alloc(73, 173));
    expect(phases).toEqual(['copying']);
  });

  it('rejects an oversized sparse file from metadata before allocating or reading its contents', async () => {
    const source = await fs.open(path.join(root, 'source'), 'wx');
    try { await source.truncate(MAX_TRANSFER_BYTES + 1); } finally { await source.close(); }
    await expect(transfer('source', 'target')).rejects.toMatchObject({ status: 413, code: 'FILE_TRANSFER_LIMIT' });
    expect((await fs.stat(path.join(root, 'source'))).size).toBe(MAX_TRANSFER_BYTES + 1);
    expect(await exists('target')).toBe(false);
  });

  it('reserves unvisited sibling names globally while walking a deep first-child chain', async () => {
    const source = path.join(root, 'source');
    await fs.mkdir(path.join(source, 'a/a/a/a/a/a'), { recursive: true });
    const openDirectory = fs.opendir.bind(fs);
    let enumerated = 0;
    vi.spyOn(fs, 'opendir').mockImplementation(async (target, options) => {
      const resolved = await fs.realpath(target);
      if (resolved !== source && !resolved.startsWith(`${source}${path.sep}`)) return openDirectory(target, options);
      // A controlled metadata iterator models many pending siblings. The first
      // child chain and all directory-descriptor traversal use actual files.
      return { async *[Symbol.asyncIterator]() {
        enumerated++; yield { name: 'a' };
        for (let index = 0; index < 20_000; index++) { enumerated++; yield { name: `z-${index}` }; }
      } } as unknown as Awaited<ReturnType<typeof fs.opendir>>;
    });
    await expect(transfer('source', 'target')).rejects.toMatchObject({ code: 'FILE_TRANSFER_LIMIT' });
    expect(enumerated).toBeLessThanOrEqual(MAX_TRANSFER_ENTRIES);
    expect(await exists('source/a/a/a/a/a/a')).toBe(true);
    expect(await exists('target')).toBe(false);
  });

  it('bounds serialized symlink metadata incrementally before retaining the whole oversized tree', async () => {
    await fs.mkdir(path.join(root, 'source'));
    // Stay below even small native symlink limits; grow the number of real
    // links instead. Their escaped target text alone exceeds the unchanged
    // production metadata budget, before identity/path overhead is included.
    const target = '\u0001'.repeat(200);
    const targetJsonBytes = Buffer.byteLength(JSON.stringify(target)) - 2;
    const count = Math.ceil(MAX_TRANSFER_MANIFEST_BYTES / targetJsonBytes) + 1;
    expect(count).toBeLessThan(MAX_TRANSFER_ENTRIES);
    for (let start = 0; start < count; start += 64) {
      await Promise.all(Array.from({ length: Math.min(64, count - start) }, (_, offset) =>
        fs.symlink(target, path.join(root, 'source', `link-${start + offset}`))));
    }
    const reads = vi.spyOn(fs, 'readlink');
    await expect(transfer('source', 'target', { kind: 'copy' })).rejects.toMatchObject({ code: 'FILE_TRANSFER_LIMIT' });
    expect(reads.mock.calls.length).toBeLessThan(count);
    expect((await fs.readdir(path.join(root, 'source'))).length).toBe(count);
    expect(await exists('target')).toBe(false);
  }, 60_000);

  it('stops an expired transfer before writing destination contents', async () => {
    await fs.writeFile(path.join(root, 'source'), 'original');
    await expect(transfer('source', 'target', { deadline: Date.now() - 1 })).rejects.toMatchObject({ code: 'FILE_TRANSFER_LIMIT' });
    expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('original');
    expect(await exists('target')).toBe(false);
  });

  it('keeps both files intact while the durability barrier is pending', async () => {
    await fs.writeFile(path.join(root, 'source'), 'important bytes');
    const reached = deferred();
    const release = deferred();
    let verified: TransferManifest | undefined;
    const pending = transfer('source', 'target', { verifyDurable: async manifest => {
      verified = manifest; reached.resolve(); await release.promise;
    } });
    try {
      await reached.promise;
      expect(await fs.readFile(path.join(root, 'source'), 'utf8')).toBe('important bytes');
      expect(await fs.readFile(path.join(root, 'target'), 'utf8')).toBe('important bytes');
      expect(verified?.entries[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally { release.resolve(); }
    await pending;
    expect(await exists('source')).toBe(false);
  });
});
