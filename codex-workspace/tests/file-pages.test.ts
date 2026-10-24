import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from '../server/errors';
import { FILE_PAGE_READ_BYTES, MAX_PAGE_BYTES, MAX_RANGE_SAVE_FILE_BYTES, PAGE_BYTES, SEARCH_SCAN_BYTES } from '../server/file-pages/limits';
import { FilePagesService } from '../server/file-pages/service';
import { FileSource } from '../server/file-pages/source';
import { fileSaveRecords } from '../server/file-pages/recovery';
import { filePagesFixture, repeatedFile, digestFile, deferred, type FilePagesFixture } from './file-pages-fixture';

describe('bounded native large-file reads and search', () => {
  let fixture: FilePagesFixture;
  beforeEach(async () => { fixture = await filePagesFixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.close(); });

  function observeSourceReads(name: string): { lengths: number[]; total: () => number } {
    const lengths: number[] = [];
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode);
      if (String(filename).endsWith(`/${name}`)) {
        const read = handle.read;
        handle.read = ((...args: unknown[]) => {
          if (typeof args[2] === 'number') lengths.push(args[2]);
          return Reflect.apply(read, handle, args);
        }) as FileHandle['read'];
      }
      return handle;
    });
    return { lengths, total: () => lengths.reduce((total, length) => total + length, 0) };
  }

  it('opens metadata and one small window of an 8 GiB sparse file without reading its body', async () => {
    const absolute = path.join(fixture.workspace.path, 'huge.txt');
    const handle = await fs.open(absolute, 'wx');
    try { await handle.write(Buffer.alloc(PAGE_BYTES * 2, 0x78)); await handle.truncate(8 * 1024 * 1024 * 1024); }
    finally { await handle.close(); }
    const reads = observeSourceReads('huge.txt');
    const readFile = fs.readFile.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementation(((filename: Parameters<typeof fs.readFile>[0], ...args: unknown[]) => {
      if (String(filename).endsWith('/huge.txt')) throw new Error('A giant body read is forbidden.');
      return Reflect.apply(readFile, fs, [filename, ...args]);
    }) as typeof fs.readFile);
    const info = await fixture.service.info(fixture.workspace.id, 'huge.txt');
    expect(info).toMatchObject({ size: 8 * 1024 * 1024 * 1024, editable: false, totalLines: null, paged: true });
    expect(info.readOnlyReason).toContain('64 MiB');
    expect(reads.lengths).toEqual([]);
    const page = await fixture.service.page(fixture.workspace.id, { path: 'huge.txt', version: info.version });
    expect(Buffer.byteLength(page.content)).toBe(PAGE_BYTES);
    expect(page).toMatchObject({ byteStart: 0, byteEnd: PAGE_BYTES, startLine: 1, endLine: 1, endsMidLine: true, totalLines: null });
    expect(reads.total()).toBeLessThanOrEqual(PAGE_BYTES + 4);
    expect(reads.lengths.every(length => length <= FILE_PAGE_READ_BYTES)).toBe(true);
    await expect(fixture.ctx.workspaces.readFile(fixture.workspace.id, 'huge.txt')).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('keeps multibyte characters, CRLF pairs, and an arbitrarily long line intact across bounded windows', async () => {
    const bytes = Buffer.from(`${'x'.repeat(PAGE_BYTES - 2)}🧪${'α'.repeat(PAGE_BYTES)}\r\nlast line\r\n`);
    await fs.writeFile(path.join(fixture.workspace.path, 'unicode.txt'), bytes);
    let page = await fixture.service.page(fixture.workspace.id, { path: 'unicode.txt' });
    let combined = page.content;
    let end = page.byteEnd;
    expect(page.endsMidLine).toBe(true);
    let count = 1;
    while (page.nextCursor) {
      page = await fixture.service.page(fixture.workspace.id, { path: 'unicode.txt', version: page.version, cursor: page.nextCursor });
      expect(page.byteStart).toBe(end);
      expect(Buffer.byteLength(page.content)).toBeLessThanOrEqual(PAGE_BYTES);
      expect(page.content).not.toContain('\uFFFD');
      combined += page.content; end = page.byteEnd; count++;
      expect(count).toBeLessThan(10);
    }
    expect(Buffer.from(combined)).toEqual(bytes);
    expect(page.totalLines).toBe(3);
    expect(end).toBe(bytes.length);

    await fs.writeFile(path.join(fixture.workspace.path, 'crlf.txt'), `${'x'.repeat(PAGE_BYTES - 1)}\r\nz`);
    const first = await fixture.service.page(fixture.workspace.id, { path: 'crlf.txt' });
    expect(first.content.endsWith('\r')).toBe(false);
    const next = await fixture.service.page(fixture.workspace.id, { path: 'crlf.txt', cursor: first.nextCursor });
    expect(next.content).toBe('\r\nz');
    expect(first.content + next.content).toBe(`${'x'.repeat(PAGE_BYTES - 1)}\r\nz`);
    expect(next.totalLines).toBe(2);
  });

  it('reports unknown global lines for unindexed jumps and exact lines after sequential traversal', async () => {
    const content = 'a\r\nb\rc\n'.repeat(PAGE_BYTES);
    await fs.writeFile(path.join(fixture.workspace.path, 'lines.txt'), content);
    const jumped = await fixture.service.page(fixture.workspace.id, { path: 'lines.txt', offset: PAGE_BYTES * 3 });
    expect(jumped.startLine).toBeNull(); expect(jumped.totalLines).toBeNull();
    let page = await fixture.service.page(fixture.workspace.id, { path: 'lines.txt' });
    expect(page.startLine).toBe(1);
    while (page.nextCursor) {
      const line = page.endLine;
      page = await fixture.service.page(fixture.workspace.id, { path: 'lines.txt', cursor: page.nextCursor });
      expect(page.startLine).toBe(line);
    }
    expect(page.totalLines).toBe(3 * PAGE_BYTES + 1);
    expect((await fixture.service.info(fixture.workspace.id, 'lines.txt')).totalLines).toBe(page.totalLines);
    const restarted = new FilePagesService(fixture.ctx);
    expect((await restarted.info(fixture.workspace.id, 'lines.txt')).totalLines).toBeNull();
  });

  it('pins continuation across restart and rejects changed files, paths, tampered cursors, and invalid offsets', async () => {
    const absolute = path.join(fixture.workspace.path, 'pinned.txt');
    await repeatedFile(absolute, PAGE_BYTES * 3);
    const page = await fixture.service.page(fixture.workspace.id, { path: 'pinned.txt' });
    const restarted = new FilePagesService(fixture.ctx);
    const next = await restarted.page(fixture.workspace.id, { path: 'pinned.txt', cursor: page.nextCursor });
    expect(next.byteStart).toBe(page.byteEnd);
    await expect(restarted.page(fixture.workspace.id, { path: 'pinned.txt', cursor: `${page.nextCursor}x` })).rejects.toMatchObject({ code: 'INVALID_FILE_CURSOR' });
    await expect(restarted.page(fixture.workspace.id, { path: 'pinned.txt', offset: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(restarted.page(fixture.workspace.id, { path: 'pinned.txt', offset: Number.MAX_SAFE_INTEGER })).rejects.toMatchObject({ status: 416 });
    await fs.appendFile(absolute, 'new tail');
    await expect(restarted.page(fixture.workspace.id, { path: 'pinned.txt', cursor: page.nextCursor })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const fresh = await fixture.service.page(fixture.workspace.id, { path: 'pinned.txt' });
    await fs.rename(absolute, path.join(fixture.workspace.path, 'renamed.txt'));
    await expect(restarted.page(fixture.workspace.id, { path: 'renamed.txt', cursor: fresh.nextCursor })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(restarted.page(fixture.workspace.id, { path: 'pinned.txt', version: fresh.version })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('detects binary and invalid UTF-8 honestly without decoding replacement characters', async () => {
    await fs.writeFile(path.join(fixture.workspace.path, 'binary.txt'), Buffer.from([0x61, 0, 0x62]));
    await fs.writeFile(path.join(fixture.workspace.path, 'latin.txt'), Buffer.from([0x61, 0xe9, 0x62]));
    await expect(fixture.service.page(fixture.workspace.id, { path: 'binary.txt' })).rejects.toMatchObject({ code: 'BINARY_FILE' });
    await expect(fixture.service.page(fixture.workspace.id, { path: 'latin.txt' })).rejects.toMatchObject({ code: 'BINARY_FILE' });
    const afterPage = path.join(fixture.workspace.path, 'late-binary.txt');
    await fs.writeFile(afterPage, Buffer.concat([Buffer.alloc(PAGE_BYTES * 2, 0x61), Buffer.from([0])]));
    const first = await fixture.service.page(fixture.workspace.id, { path: 'late-binary.txt' });
    const previous = await digestFile(afterPage);
    await expect(fixture.service.save(fixture.workspace.id, { path: 'late-binary.txt', pageToken: first.pageToken, content: 'text edit' }))
      .rejects.toMatchObject({ code: 'BINARY_FILE' });
    expect(await digestFile(afterPage)).toBe(previous);
  });

  it('rejects an in-flight page after real truncation instead of returning a mixed-version view', async () => {
    const absolute = path.join(fixture.workspace.path, 'truncate.txt');
    await repeatedFile(absolute, PAGE_BYTES * 3);
    const read = FileSource.prototype.read;
    let changed = false;
    vi.spyOn(FileSource.prototype, 'read').mockImplementation(async function (this: FileSource, offset, length) {
      const bytes = await read.call(this, offset, length);
      if (!changed) { changed = true; await fs.truncate(absolute, 1); }
      return bytes;
    });
    await expect(fixture.service.page(fixture.workspace.id, { path: 'truncate.txt' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await fs.stat(absolute)).size).toBe(1);
  });

  it('searches literal Unicode across windows with exact byte positions and bounded progress', async () => {
    const absolute = path.join(fixture.workspace.path, 'search.txt');
    const size = SEARCH_SCAN_BYTES + PAGE_BYTES;
    await repeatedFile(absolute, size, 'x');
    const handle = await fs.open(absolute, 'r+');
    const needle = Buffer.from('🧪Needle');
    try { await handle.write(needle, 0, needle.length, SEARCH_SCAN_BYTES - 3); }
    finally { await handle.close(); }
    const info = await fixture.service.info(fixture.workspace.id, 'search.txt');
    const reads = observeSourceReads('search.txt');
    const first = await fixture.service.search(fixture.workspace.id, { path: 'search.txt', version: info.version, query: '🧪NEEDLE', caseSensitive: false });
    expect(first.complete).toBe(false);
    expect(first.matches).toEqual([]);
    expect(first.scannedThrough).toBeLessThanOrEqual(SEARCH_SCAN_BYTES);
    expect(reads.lengths.every(length => length <= FILE_PAGE_READ_BYTES)).toBe(true);
    expect(reads.total()).toBeLessThan(SEARCH_SCAN_BYTES + 128 * 1024);
    const last = await fixture.service.search(fixture.workspace.id, { path: 'search.txt', version: info.version, query: '🧪NEEDLE', caseSensitive: false, cursor: first.nextCursor });
    expect(last.complete).toBe(true); expect(last.totalLines).toBe(1);
    expect(last.matches).toMatchObject([{ byteStart: SEARCH_SCAN_BYTES - 3, byteEnd: SEARCH_SCAN_BYTES - 3 + needle.length, line: 1 }]);
    await expect(fixture.service.search(fixture.workspace.id, { path: 'search.txt', version: info.version, query: 'other', cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: 'INVALID_FILE_CURSOR' });
  });

  it('caps dense matches and resumes without missing or duplicating literal occurrences', async () => {
    await fs.writeFile(path.join(fixture.workspace.path, 'matches.txt'), '[x]\r\n'.repeat(103));
    const info = await fixture.service.info(fixture.workspace.id, 'matches.txt');
    const first = await fixture.service.search(fixture.workspace.id, { path: 'matches.txt', version: info.version, query: '[x]' });
    expect(first.matches).toHaveLength(100); expect(first.complete).toBe(false);
    const second = await fixture.service.search(fixture.workspace.id, { path: 'matches.txt', version: info.version, query: '[x]', cursor: first.nextCursor });
    expect(second.matches).toHaveLength(3); expect(second.complete).toBe(true); expect(second.totalLines).toBe(104);
    expect([...first.matches, ...second.matches].map(match => match.line)).toEqual(Array.from({ length: 103 }, (_, i) => i + 1));
    expect(new Set([...first.matches, ...second.matches].map(match => match.byteStart)).size).toBe(103);
  });

  it('allows internal resolved links while preventing traversal and exchanged parent links', async () => {
    await fs.mkdir(path.join(fixture.workspace.path, 'real'));
    await fs.writeFile(path.join(fixture.workspace.path, 'real/file.txt'), 'inside');
    await fs.symlink('real', path.join(fixture.workspace.path, 'alias'));
    expect((await fixture.service.page(fixture.workspace.id, { path: 'alias/file.txt' })).content).toBe('inside');
    await expect(fixture.service.info(fixture.workspace.id, '../outside')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    const outside = path.join(fixture.directory, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'file.txt'), 'outside');
    const source = await FileSource.open(fixture.ctx, fixture.workspace.id, 'real/file.txt');
    try {
      await fs.rename(path.join(fixture.workspace.path, 'real'), path.join(fixture.workspace.path, 'moved'));
      await fs.symlink(outside, path.join(fixture.workspace.path, 'real'));
      await expect(source.check()).rejects.toMatchObject({ status: 409 });
      await expect(fixture.service.info(fixture.workspace.id, 'real/file.txt')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      expect(await fs.readFile(path.join(outside, 'file.txt'), 'utf8')).toBe('outside');
    } finally { await source.close(); }
  });
});

describe('range saves preserve the complete native file', () => {
  let fixture: FilePagesFixture;
  beforeEach(async () => { fixture = await filePagesFixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.close(); });

  it('stream-replaces one page of an 8 MiB file and returns exactly the edited range', async () => {
    const absolute = path.join(fixture.workspace.path, 'large.txt');
    await repeatedFile(absolute, 8 * 1024 * 1024);
    await fs.chmod(absolute, 0o751);
    const page = await fixture.service.page(fixture.workspace.id, { path: 'large.txt', offset: PAGE_BYTES * 3 });
    const content = `edited α 🧪\r\n${page.content.slice(20)}`;
    const expected = await digestFile(absolute, { start: page.byteStart, end: page.byteEnd, replacement: content });
    const result = await fixture.service.save(fixture.workspace.id, { path: 'large.txt', pageToken: page.pageToken, content });
    expect(result.content).toBe(content);
    expect(result.byteStart).toBe(page.byteStart);
    expect(result.byteEnd).toBe(page.byteStart + Buffer.byteLength(content));
    expect(result.version).not.toBe(page.version);
    expect(await digestFile(absolute)).toBe(expected);
    expect((await fs.stat(absolute)).mode & 0o777).toBe(0o751);
    expect(await fixture.service.recoveries(fixture.workspace.id)).toEqual([]);
    expect(await fs.readdir(fixture.workspace.path)).toEqual(['large.txt']);
  });

  it('supports insertion, deletion, empty files, and exact replies larger than the initial page', async () => {
    const absolute = path.join(fixture.workspace.path, 'empty.txt');
    await fs.writeFile(absolute, '');
    const initial = await fixture.service.page(fixture.workspace.id, { path: 'empty.txt' });
    const content = 'α'.repeat(100_000);
    const inserted = await fixture.service.save(fixture.workspace.id, { path: 'empty.txt', pageToken: initial.pageToken, content });
    expect(inserted.content).toBe(content); expect(inserted.byteEnd).toBe(200_000);
    const deleted = await fixture.service.save(fixture.workspace.id, { path: 'empty.txt', pageToken: inserted.pageToken, content: '' });
    expect(deleted.content).toBe(''); expect((await fs.stat(absolute)).size).toBe(0); expect(deleted.totalLines).toBe(1);
  });

  it('rejects stale, renamed, deleted, changed-encoding, and oversized ranges without truncating a source', async () => {
    const absolute = path.join(fixture.workspace.path, 'guarded.txt');
    await repeatedFile(absolute, PAGE_BYTES * 2);
    const page = await fixture.service.page(fixture.workspace.id, { path: 'guarded.txt' });
    await expect(fixture.service.save(fixture.workspace.id, { path: 'guarded.txt', pageToken: page.pageToken, content: 'x'.repeat(MAX_PAGE_BYTES + 1) }))
      .rejects.toMatchObject({ code: 'FILE_PAGE_TOO_LARGE' });
    await expect(fixture.service.save(fixture.workspace.id, { path: 'guarded.txt', pageToken: page.pageToken, content: '\ud800' }))
      .rejects.toMatchObject({ code: 'BINARY_FILE' });
    await fs.appendFile(absolute, 'concurrent tail');
    const hash = await digestFile(absolute);
    await expect(fixture.service.save(fixture.workspace.id, { path: 'guarded.txt', pageToken: page.pageToken, content: 'changed page' }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await digestFile(absolute)).toBe(hash);
    const fresh = await fixture.service.page(fixture.workspace.id, { path: 'guarded.txt' });
    await fs.rename(absolute, path.join(fixture.workspace.path, 'renamed.txt'));
    await expect(fixture.service.save(fixture.workspace.id, { path: 'renamed.txt', pageToken: fresh.pageToken, content: 'edit' }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(fixture.service.save(fixture.workspace.id, { path: 'guarded.txt', pageToken: fresh.pageToken, content: 'edit' }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await digestFile(path.join(fixture.workspace.path, 'renamed.txt'))).toBe(hash);
  });

  it('keeps files above the 64 MiB cap read-only without copying their contents', async () => {
    const absolute = path.join(fixture.workspace.path, 'too-large.txt');
    const handle = await fs.open(absolute, 'wx');
    try { await handle.write(Buffer.alloc(PAGE_BYTES * 2, 0x61)); await handle.truncate(MAX_RANGE_SAVE_FILE_BYTES + 1); }
    finally { await handle.close(); }
    const page = await fixture.service.page(fixture.workspace.id, { path: 'too-large.txt' });
    expect(page.editable).toBe(false);
    await expect(fixture.service.save(fixture.workspace.id, { path: 'too-large.txt', pageToken: page.pageToken, content: 'edit' }))
      .rejects.toMatchObject({ code: 'FILE_RANGE_SAVE_LIMIT' });
    expect((await fs.stat(absolute)).size).toBe(MAX_RANGE_SAVE_FILE_BYTES + 1);
    expect(await fixture.service.recoveries(fixture.workspace.id)).toEqual([]);
  });

  it('refuses insufficient headroom before creating recovery bytes or changing the source', async () => {
    const absolute = path.join(fixture.workspace.path, 'admission.txt');
    await repeatedFile(absolute, PAGE_BYTES * 2);
    const expected = await digestFile(absolute);
    const service = new FilePagesService(fixture.ctx, { checkResources: async estimate => {
      expect(estimate).toBeGreaterThanOrEqual(PAGE_BYTES * 2 * 3);
      throw new HttpError(503, 'Not enough admitted headroom.', 'FILE_SAVE_RESOURCES');
    } });
    const page = await service.page(fixture.workspace.id, { path: 'admission.txt' });
    await expect(service.save(fixture.workspace.id, { path: 'admission.txt', pageToken: page.pageToken, content: 'edit' }))
      .rejects.toMatchObject({ code: 'FILE_SAVE_RESOURCES' });
    expect(await digestFile(absolute)).toBe(expected);
    expect(await fs.readdir(fixture.workspace.path)).toEqual(['admission.txt']);
    expect(await service.recoveries(fixture.workspace.id)).toEqual([]);
  });

  it('retains a complete recovery copy when durability is unavailable before replacement', async () => {
    const absolute = path.join(fixture.workspace.path, 'durable.txt');
    await fs.writeFile(absolute, 'original contents\r\n');
    fixture.config.requirePersistentData = true;
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined,
      verifyDurable: async () => { throw new HttpError(503, 'Public receipt pending.', 'FILE_TRANSFER_DURABILITY_PENDING'); } });
    const page = await service.page(fixture.workspace.id, { path: 'durable.txt' });
    await expect(service.save(fixture.workspace.id, { path: 'durable.txt', pageToken: page.pageToken, content: 'edited 🧪\r\n' }))
      .rejects.toMatchObject({ code: 'FILE_TRANSFER_DURABILITY_PENDING' });
    expect(await fs.readFile(absolute, 'utf8')).toBe('original contents\r\n');
    const [recovery] = await service.recoveries(fixture.workspace.id);
    expect(recovery).toMatchObject({ state: 'retained', phase: 'interrupted', completeCopy: true });
    expect(await fs.readFile(path.join(fixture.workspace.path, recovery!.recoveryPath), 'utf8')).toBe('edited 🧪\r\n');
    const rename = vi.spyOn(fs, 'rename');
    const unlink = vi.spyOn(fs, 'unlink');
    const restarted = new FilePagesService(fixture.ctx);
    await restarted.initialize();
    expect((await restarted.recoveries(fixture.workspace.id))[0]).toMatchObject({ id: recovery!.id, completeCopy: true });
    expect(rename).not.toHaveBeenCalled(); expect(unlink).not.toHaveBeenCalled();
  });

  it('preserves terminal edits made while a staged save waits for confirmation', async () => {
    const absolute = path.join(fixture.workspace.path, 'concurrent.txt');
    await fs.writeFile(absolute, 'original');
    fixture.config.requirePersistentData = true;
    let calls = 0;
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined, verifyDurable: async () => {
      if (++calls === 1) await fs.writeFile(absolute, 'terminal edit');
    } });
    const page = await service.page(fixture.workspace.id, { path: 'concurrent.txt' });
    await expect(service.save(fixture.workspace.id, { path: 'concurrent.txt', pageToken: page.pageToken, content: 'editor edit' }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await fs.readFile(absolute, 'utf8')).toBe('terminal edit');
    const [recovery] = await service.recoveries(fixture.workspace.id);
    expect(await fs.readFile(path.join(fixture.workspace.path, recovery!.recoveryPath), 'utf8')).toBe('editor edit');
  });

  it('rejects a changed install copy before it can replace the original, retaining independently changed bytes', async () => {
    const absolute = path.join(fixture.workspace.path, 'install-change.txt');
    await fs.writeFile(absolute, 'original');
    fixture.config.requirePersistentData = true;
    let calls = 0;
    let installPath = '';
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined, verifyDurable: async () => {
      if (++calls === 2) {
        const [record] = await fileSaveRecords(fixture.ctx);
        installPath = path.join(fixture.workspace.path, record!.installName!);
        await fs.writeFile(installPath, 'independent install edit');
      }
    } });
    const page = await service.page(fixture.workspace.id, { path: 'install-change.txt' });
    await expect(service.save(fixture.workspace.id, { path: 'install-change.txt', pageToken: page.pageToken, content: 'editor edit' }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await fs.readFile(absolute, 'utf8')).toBe('original');
    expect(await fs.readFile(installPath, 'utf8')).toBe('independent install edit');
    const [recovery] = await service.recoveries(fixture.workspace.id);
    expect(await fs.readFile(path.join(fixture.workspace.path, recovery!.recoveryPath), 'utf8')).toBe('editor edit');
  });

  it('retains durable edits if destination confirmation fails after native replacement', async () => {
    const absolute = path.join(fixture.workspace.path, 'uncertain.txt');
    await fs.writeFile(absolute, 'original');
    fixture.config.requirePersistentData = true;
    let calls = 0;
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined, verifyDurable: async receipts => {
      for (const receipt of receipts) expect(await digestFile(receipt.absolute)).toBe(receipt.sha256);
      if (++calls === 3) throw new Error('Destination has not reached the public bucket.');
    } });
    const page = await service.page(fixture.workspace.id, { path: 'uncertain.txt' });
    await expect(service.save(fixture.workspace.id, { path: 'uncertain.txt', pageToken: page.pageToken, content: 'edited' }))
      .rejects.toMatchObject({ code: 'FILE_SAVE_CONFIRMATION_PENDING' });
    expect(await fs.readFile(absolute, 'utf8')).toBe('edited');
    const [record] = await fileSaveRecords(fixture.ctx);
    expect(record).toMatchObject({ completeCopy: true, phase: 'interrupted', sha256: createHash('sha256').update('edited').digest('hex') });
    expect(await fs.readFile(path.join(fixture.workspace.path, record!.recoveryPath), 'utf8')).toBe('edited');
  });

  it('never cleans up a recovery copy changed independently after a successful replacement', async () => {
    const absolute = path.join(fixture.workspace.path, 'recovery-change.txt');
    await fs.writeFile(absolute, 'original');
    fixture.config.requirePersistentData = true;
    let calls = 0;
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined, verifyDurable: async () => {
      if (++calls === 3) {
        const [record] = await fileSaveRecords(fixture.ctx);
        await fs.writeFile(path.join(fixture.workspace.path, record!.recoveryPath), 'manual recovery edit');
      }
    } });
    const page = await service.page(fixture.workspace.id, { path: 'recovery-change.txt' });
    const saved = await service.save(fixture.workspace.id, { path: 'recovery-change.txt', pageToken: page.pageToken, content: 'edited' });
    expect(saved.content).toBe('edited');
    const [recovery] = await service.recoveries(fixture.workspace.id);
    expect(recovery).toMatchObject({ phase: 'complete', state: 'retained' });
    expect(await fs.readFile(path.join(fixture.workspace.path, recovery!.recoveryPath), 'utf8')).toBe('manual recovery edit');
  });

  it('shares the native mutation queue with ordinary editor saves', async () => {
    const absolute = path.join(fixture.workspace.path, 'queued.txt');
    const old = await fixture.ctx.workspaces.writeFile(fixture.workspace.id, 'queued.txt', 'before');
    fixture.config.requirePersistentData = true;
    const entered = deferred(); const release = deferred();
    let calls = 0;
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined, verifyDurable: async () => {
      if (++calls === 1) { entered.resolve(); await release.promise; }
    } });
    const page = await service.page(fixture.workspace.id, { path: 'queued.txt' });
    const saving = service.save(fixture.workspace.id, { path: 'queued.txt', pageToken: page.pageToken, content: 'paged save' });
    await entered.promise;
    let ordinaryDone = false;
    const ordinary = fixture.ctx.workspaces.writeFile(fixture.workspace.id, 'queued.txt', 'late small save', old.version)
      .finally(() => { ordinaryDone = true; });
    const rejected = expect(ordinary).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    try { await new Promise<void>(done => { setImmediate(done); }); expect(ordinaryDone).toBe(false); }
    finally { release.resolve(); }
    await saving; await rejected;
    expect(await fs.readFile(absolute, 'utf8')).toBe('paged save');
  });
});
