import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { filePagesFor, shutdownFilePages } from '../server/file-pages';
import { FilePagesService } from '../server/file-pages/service';
import { fileSaveRecords } from '../server/file-pages/recovery';
import { withWorkspaceFileMutation } from '../server/file-transfers/queue';
import { deferred, filePagesFixture, type FilePagesFixture } from './file-pages-fixture';

function aborted(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
}

const nextTurn = () => new Promise<void>(resolve => { setImmediate(resolve); });

describe('file-page mutation shutdown lifecycle', () => {
  let fixture: FilePagesFixture;
  beforeEach(async () => { fixture = await filePagesFixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.close(); });

  async function original() {
    const absolute = path.join(fixture.workspace.path, 'file.txt');
    await fs.writeFile(absolute, 'original\r\n');
    return absolute;
  }

  it('latches shutdown before factory creation without closing another app context', async () => {
    const absolute = await original();
    const unopened = { ...fixture.ctx };
    const closing = shutdownFilePages(unopened);
    expect(() => filePagesFor(unopened)).toThrowError(/shutting down/);
    const late = new FilePagesService(unopened);
    await expect(late.info(fixture.workspace.id, 'file.txt')).rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    await expect(late.save(fixture.workspace.id, { path: 'file.txt', pageToken: 'unused', content: 'must not run' }))
      .rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    await closing;
    const page = await fixture.service.page(fixture.workspace.id, { path: 'file.txt' });
    await fixture.service.save(fixture.workspace.id, { path: 'file.txt', pageToken: page.pageToken, content: 'other context stays open' });
    expect(await fs.readFile(absolute, 'utf8')).toBe('other context stays open');
  });

  it('aborts an active precommit durability wait, retains the full copy, and drains file handles', async () => {
    const absolute = await original();
    fixture.config.requirePersistentData = true;
    const entered = deferred();
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined, verifyDurable: async (_receipts, signal) => {
      entered.resolve(); await aborted(signal);
    } });
    const page = await service.page(fixture.workspace.id, { path: 'file.txt' });
    const saving = service.save(fixture.workspace.id, { path: 'file.txt', pageToken: page.pageToken, content: 'edited\r\n' });
    const rejected = expect(saving).rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    await entered.promise;
    const unlink = vi.spyOn(fs, 'unlink');
    const closed = shutdownFilePages(fixture.ctx);
    await expect(service.page(fixture.workspace.id, { path: 'file.txt' })).rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    await closed; await rejected;
    expect(await fs.readFile(absolute, 'utf8')).toBe('original\r\n');
    const [record] = await fileSaveRecords(fixture.ctx);
    expect(record).toMatchObject({ completeCopy: true, phase: 'interrupted' });
    expect(await fs.readFile(path.join(fixture.workspace.path, record!.recoveryPath), 'utf8')).toBe('edited\r\n');
    expect(unlink).not.toHaveBeenCalled();
    expect((await fs.readdir(fixture.workspace.path)).some(name => name.startsWith('.codex-write-'))).toBe(false);
    const after = await fs.readdir(fixture.workspace.path);
    await nextTurn();
    expect(await fs.readdir(fixture.workspace.path)).toEqual(after);
  });

  it('does not wait for another queue owner and never runs the cancelled queued callback later', async () => {
    const absolute = await original();
    const page = await fixture.service.page(fixture.workspace.id, { path: 'file.txt' });
    const entered = deferred(); const release = deferred();
    const owner = withWorkspaceFileMutation(fixture.config.workspacesDir, fixture.workspace.id, async () => {
      entered.resolve(); await release.promise; await fs.writeFile(absolute, 'other admitted writer');
    });
    await entered.promise;
    const saving = fixture.service.save(fixture.workspace.id, { path: 'file.txt', pageToken: page.pageToken, content: 'cancelled edit' });
    const rejected = expect(saving).rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    try {
      await nextTurn();
      await fixture.service.close(1_000);
      await rejected;
      expect(await fs.readFile(absolute, 'utf8')).toBe('original\r\n');
      expect(await fileSaveRecords(fixture.ctx)).toEqual([]);
    } finally { release.resolve(); await owner; }
    await nextTurn();
    expect(await fs.readFile(absolute, 'utf8')).toBe('other admitted writer');
    expect(await fs.readdir(fixture.workspace.path)).toEqual(['file.txt']);
    expect(await fileSaveRecords(fixture.ctx)).toEqual([]);
  });

  it('rejects a drain timeout truthfully and allows another wait for an uncooperative active callback', async () => {
    const absolute = await original();
    fixture.config.requirePersistentData = true;
    const entered = deferred(); const release = deferred();
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined, verifyDurable: async () => {
      entered.resolve(); await release.promise;
    } });
    const page = await service.page(fixture.workspace.id, { path: 'file.txt' });
    const saving = service.save(fixture.workspace.id, { path: 'file.txt', pageToken: page.pageToken, content: 'edited' });
    const rejected = expect(saving).rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    await entered.promise;
    let waiting: Promise<void> | undefined;
    try {
      await expect(service.close(10)).rejects.toMatchObject({ code: 'FILE_PAGES_SHUTDOWN_PENDING' });
      let drained = false;
      waiting = service.close(1_000).then(() => { drained = true; });
      await nextTurn();
      expect(drained).toBe(false);
      expect(await fs.readFile(absolute, 'utf8')).toBe('original\r\n');
      await expect(service.save(fixture.workspace.id, { path: 'file.txt', pageToken: page.pageToken, content: 'late edit' }))
        .rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    } finally { release.resolve(); await waiting; await rejected; }
    expect(await fs.readFile(absolute, 'utf8')).toBe('original\r\n');
    expect((await fileSaveRecords(fixture.ctx))[0]).toMatchObject({ phase: 'interrupted', completeCopy: true });
    expect((await fs.readdir(fixture.workspace.path)).some(name => name.startsWith('.codex-write-'))).toBe(false);
    await service.close();
  });

  it('waits for an issued native write, then retains its partial recovery without a later replacement', async () => {
    const absolute = await original();
    const page = await fixture.service.page(fixture.workspace.id, { path: 'file.txt' });
    const entered = deferred(); const release = deferred();
    const open = fs.open.bind(fs);
    let held = false;
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode);
      if (String(filename).includes('/.codex-recovery-')) {
        const write = handle.write;
        handle.write = (async (...args: unknown[]) => {
          const result = await Reflect.apply(write, handle, args);
          if (!held) { held = true; entered.resolve(); await release.promise; }
          return result;
        }) as FileHandle['write'];
      }
      return handle;
    });
    const saving = fixture.service.save(fixture.workspace.id, { path: 'file.txt', pageToken: page.pageToken, content: 'issued bytes' });
    const rejected = expect(saving).rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    await entered.promise;
    let waiting: Promise<void> | undefined;
    try {
      await expect(fixture.service.close(10)).rejects.toMatchObject({ code: 'FILE_PAGES_SHUTDOWN_PENDING' });
      waiting = fixture.service.close(1_000);
      expect(await fs.readFile(absolute, 'utf8')).toBe('original\r\n');
    } finally { release.resolve(); await waiting; await rejected; }
    const [record] = await fileSaveRecords(fixture.ctx);
    expect(record).toMatchObject({ completeCopy: false, phase: 'interrupted' });
    expect(await fs.readFile(path.join(fixture.workspace.path, record!.recoveryPath), 'utf8')).toBe('issued bytes');
    expect(await fs.readFile(absolute, 'utf8')).toBe('original\r\n');
  });

  it('retains the durable full copy when shutdown interrupts destination confirmation after replacement', async () => {
    const absolute = await original();
    fixture.config.requirePersistentData = true;
    const entered = deferred();
    let checks = 0;
    const service = new FilePagesService(fixture.ctx, { checkResources: async () => undefined, verifyDurable: async (_receipts, signal) => {
      if (++checks === 3) { entered.resolve(); await aborted(signal); }
    } });
    const page = await service.page(fixture.workspace.id, { path: 'file.txt' });
    const saving = service.save(fixture.workspace.id, { path: 'file.txt', pageToken: page.pageToken, content: 'replacement' });
    const rejected = expect(saving).rejects.toMatchObject({ code: 'FILE_PAGES_CLOSING' });
    await entered.promise;
    const unlink = vi.spyOn(fs, 'unlink');
    await service.close(); await rejected;
    expect(await fs.readFile(absolute, 'utf8')).toBe('replacement');
    const [record] = await fileSaveRecords(fixture.ctx);
    expect(record).toMatchObject({ completeCopy: true, phase: 'interrupted' });
    expect(record!.issue).toContain('confirmation did not finish');
    expect(await fs.readFile(path.join(fixture.workspace.path, record!.recoveryPath), 'utf8')).toBe('replacement');
    expect(unlink).not.toHaveBeenCalled();
    const restarted = new FilePagesService({ ...fixture.ctx });
    await restarted.initialize();
    expect((await restarted.recoveries(fixture.workspace.id))[0]).toMatchObject({ state: 'retained', completeCopy: true });
    await restarted.close();
  });
});
