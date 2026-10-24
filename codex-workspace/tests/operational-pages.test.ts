import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceTrashService } from '../server/workspace-trash/service';
import type { WorkspaceTrashRecord, WorkspaceTrashRegistry } from '../server/workspace-trash/types';
import { TRASH_RETENTION_MS } from '../server/workspace-trash/records';
import { listWorkspaceFileTransfersPage } from '../server/file-transfers/service';
import type { StoredFileTransfer } from '../server/file-transfers/types';
import { operationalIndexPage, operationalPageQuery, parseOperationalPageQuery } from '../server/operational-pages';
import { fixture, type TrashFixture } from './workspace-trash-fixture';

let f: TrashFixture;
let trash: WorkspaceTrashService;
const observationalOnly = async (): Promise<never> => { throw new Error('A page must not invoke workspace lifecycle operations.'); };

beforeEach(async () => {
  f = await fixture();
  const registry: WorkspaceTrashRegistry = { registration: observationalOnly, registrations: observationalOnly,
    active: observationalOnly, archivedBy: observationalOnly, restoredBy: observationalOnly,
    archive: observationalOnly, restore: observationalOnly, repairSelection: observationalOnly };
  trash = new WorkspaceTrashService(f.config, f.store, registry);
});
afterEach(async () => { vi.restoreAllMocks(); await trash?.close(); await f?.close(); });

async function savedTrash(index: number, overrides: Partial<WorkspaceTrashRecord> = {}): Promise<WorkspaceTrashRecord> {
  const id = randomUUID(), workspaceId = `paged-trash-workspace-${index}`;
  const deletedAt = new Date(Date.now() - index * 60_000).toISOString();
  const record: WorkspaceTrashRecord = { version: 1, id,
    workspace: { id: workspaceId, name: `Saved project ${String(index).padStart(3, '0')}`, path: path.join(f.config.workspacesDir, workspaceId),
      createdAt: deletedAt, updatedAt: deletedAt, githubAccountId: 'saved-account-reference' },
    deletedAt, updatedAt: deletedAt, expiresAt: new Date(Date.parse(deletedAt) + TRASH_RETENTION_MS).toISOString(),
    reason: 'deleted', mode: 'trash', phase: 'ready', ...overrides };
  const directory = f.entryPath(id);
  await fs.mkdir(path.join(directory, 'content'), { recursive: true });
  await fs.writeFile(path.join(directory, 'owner.json'), JSON.stringify({ version: 1, id, workspaceId: record.workspace.id }));
  await fs.writeFile(path.join(directory, 'content/keep.txt'), `Retained native file ${index}.`);
  await f.store.write(`workspace-trash-record-${id}`, record);
  return record;
}

async function savedTransfer(index: number, overrides: Partial<StoredFileTransfer> = {}): Promise<StoredFileTransfer> {
  const id = randomUUID(), createdAt = new Date(Date.now() - index * 60_000).toISOString();
  const record: StoredFileTransfer = { version: 1, id, workspaceId: f.workspace.id, kind: 'move', path: `source-${index}.txt`,
    newPath: `destination/final-${index}.txt`, phase: 'interrupted', interruptedPhase: 'verifying', createdAt, updatedAt: createdAt,
    issue: 'Both native paths were retained for inspection.', ...overrides };
  await fs.writeFile(path.join(f.config.stateDir, `file-transfer-${id}.json`), JSON.stringify(record));
  return record;
}

describe('bounded operational list queries', () => {
  it('validates direct and HTTP bounds instead of accepting array, fractional, control or path inputs', () => {
    expect(parseOperationalPageQuery({ offset: '25', limit: '25', q: '  Saved PROJECT  ' })).toEqual({ offset: 25, limit: 25, q: 'saved project' });
    for (const input of [{ limit: '51' }, { offset: '-1' }, { offset: '1.5' }, { offset: '10001' }, { q: ['one', 'two'] }, { q: 'x\0y' }, { q: 'x'.repeat(161) }, { path: '../outside' }]) {
      expect(() => parseOperationalPageQuery(input)).toThrowError(expect.objectContaining({ status: 400, code: 'INVALID_OPERATIONAL_PAGE' }));
    }
    expect(() => operationalPageQuery({ limit: 0 })).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('bounds concurrent discovery and releases admissions after a failed scan', async () => {
    const release: Array<() => void> = [];
    const paused = async function* (fail = false) {
      await new Promise<void>(resolve => { release.push(resolve); });
      if (fail) throw new Error('Injected native metadata outage.');
      yield { id: 'saved', order: '2026-09-20T12:00:00.000Z' };
    };
    const running = Array.from({ length: 4 }, (_, index) => operationalIndexPage(paused(index === 0), operationalPageQuery(), item => item)
      .then(value => ({ ok: true, value }), error => ({ ok: false, error })));
    try {
      await expect(operationalIndexPage(paused(), operationalPageQuery(), item => item)).rejects.toMatchObject({ status: 429, code: 'OPERATIONAL_LIST_BUSY' });
    } finally { for (const resume of release) resume(); }
    const settled = await Promise.all(running);
    expect(settled.filter(result => result.ok)).toHaveLength(3);
    const available = async function* () { yield { id: 'read-after-failure', order: '2026-09-20T12:00:00.000Z' }; };
    expect(await operationalIndexPage(available(), operationalPageQuery(), item => item)).toMatchObject({ ids: ['read-after-failure'], total: 1 });
  });
});

describe('workspace trash and permanent-deletion pages over native journals', () => {
  it('returns disjoint ordered pages and validates native trash roots only for the requested page', async () => {
    const saved: WorkspaceTrashRecord[] = [];
    for (let index = 0; index < 58; index++) saved.push(await savedTrash(index));
    const inspected: string[] = [];
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(((file: Parameters<typeof fs.lstat>[0], options?: unknown) => {
      if (String(file).endsWith('/content')) inspected.push(String(file));
      return lstat(file, options as never);
    }) as typeof fs.lstat);
    const first = await trash.listPage();
    expect(first).toMatchObject({ offset: 0, limit: 25, total: 58, hasMore: true });
    expect(first.items.map(item => item.id)).toEqual(saved.slice(0, 25).map(item => item.id));
    expect(new Set(inspected)).toEqual(new Set(saved.slice(0, 25).map(item => path.join(f.entryPath(item.id), 'content'))));
    inspected.length = 0;
    const second = await trash.listPage({ offset: 25 });
    expect(second.items.map(item => item.id)).toEqual(saved.slice(25, 50).map(item => item.id));
    expect(new Set(inspected)).toEqual(new Set(saved.slice(25, 50).map(item => path.join(f.entryPath(item.id), 'content'))));
    const last = await trash.listPage({ offset: 50 });
    expect(last.items.map(item => item.id)).toEqual(saved.slice(50).map(item => item.id));
    expect(last.hasMore).toBe(false);
    expect((await trash.listPage({ offset: 10_000 })).offset).toBe(50);
    expect(JSON.stringify(first)).not.toContain('saved-account-reference');
    expect(JSON.stringify(first)).not.toContain(f.config.workspacesDir);
  });

  it('searches beyond the first page, separates permanent journals, and never resumes a saved deletion while listing', async () => {
    for (let index = 0; index < 28; index++) await savedTrash(index);
    const permanent = await savedTrash(100, { mode: 'permanent', phase: 'purging', issue: 'Retained local files need another explicit safe retry.' });
    const finished = await savedTrash(101, { mode: 'permanent', phase: 'purged' });
    const restored = await savedTrash(102, { phase: 'restored' });
    const before = await fs.readFile(path.join(f.entryPath(permanent.id), 'content/keep.txt'), 'utf8');
    const found = await trash.listPage({ q: 'project 027', limit: 10 });
    expect(found.items.map(item => item.name)).toEqual(['Saved project 027']);
    expect(found.total).toBe(1);
    const statuses = await trash.deletionStatusPage();
    expect(statuses.items).toEqual([expect.objectContaining({ id: permanent.id, mode: 'permanent', state: 'error' })]);
    expect(statuses.items[0]).not.toHaveProperty('canRestore');
    expect(statuses.items[0]).not.toHaveProperty('expiresAt');
    expect((await trash.listPage({ limit: 50 })).items.some(item => [permanent.id, finished.id, restored.id].includes(item.id))).toBe(false);
    expect(await fs.readFile(path.join(f.entryPath(permanent.id), 'content/keep.txt'), 'utf8')).toBe(before);
    expect(await f.store.read(`workspace-trash-record-${permanent.id}`, null)).toEqual(permanent);
    expect(Date.parse(permanent.expiresAt) - Date.parse(permanent.deletedAt)).toBe(TRASH_RETENTION_MS);
  });

  it('keeps missing and replaced page roots honest without following a symlink or altering its target', async () => {
    const first = await savedTrash(0), missing = await savedTrash(1);
    const outside = path.join(f.directory, 'outside-page-root');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'sentinel'), 'outside bytes');
    await fs.rm(path.join(f.entryPath(first.id), 'content'), { recursive: true });
    await fs.symlink(outside, path.join(f.entryPath(first.id), 'content'));
    await fs.rm(path.join(f.entryPath(missing.id), 'content'), { recursive: true });
    const result = await trash.listPage();
    expect(result.items).toEqual([
      expect.objectContaining({ id: first.id, state: 'recovery', canRestore: false }),
      expect.objectContaining({ id: missing.id, state: 'missing', canRestore: false }),
    ]);
    expect(await fs.readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('outside bytes');
    expect((await f.store.read<WorkspaceTrashRecord>(`workspace-trash-record-${first.id}`, first)).phase).toBe('ready');
  });

  it('does not conceal malformed off-page journals or weaken restore expiry when searching', async () => {
    const expiredAt = new Date(Date.now() - TRASH_RETENTION_MS - 60_000).toISOString();
    const expired = await savedTrash(0, { deletedAt: expiredAt, expiresAt: new Date(Date.parse(expiredAt) + TRASH_RETENTION_MS).toISOString() });
    expect((await trash.listPage()).items[0]).toMatchObject({ id: expired.id, canRestore: false });
    const malformed = await savedTrash(1);
    await fs.writeFile(path.join(f.config.stateDir, `workspace-trash-record-${malformed.id}.json`), JSON.stringify({ ...malformed, expiresAt: malformed.deletedAt }));
    await expect(trash.listPage({ q: 'project 000', limit: 1 })).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_UNSAFE' });
    await expect(trash.deletionStatusPage()).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_UNSAFE' });
    expect(await fs.readFile(path.join(f.entryPath(malformed.id), 'content/keep.txt'), 'utf8')).toBe('Retained native file 1.');
  });
});

describe('file operation status pages are observation only', () => {
  it('searches all retained statuses while returning one bounded page and preserving every source, destination and journal', async () => {
    const saved: StoredFileTransfer[] = [];
    for (let index = 0; index < 61; index++) saved.push(await savedTransfer(index));
    await savedTransfer(62, { workspaceId: 'other-workspace' });
    await savedTransfer(63, { phase: 'complete' });
    await fs.writeFile(path.join(f.workspace.path, 'source-60.txt'), 'original source');
    await fs.mkdir(path.join(f.workspace.path, 'destination'));
    await fs.writeFile(path.join(f.workspace.path, 'destination/final-60.txt'), 'retained destination');
    const noEagerDirectoryRead = vi.spyOn(fs, 'readdir');
    const first = await listWorkspaceFileTransfersPage(f.config, f.workspace.id);
    expect(first).toMatchObject({ offset: 0, limit: 25, total: 61, hasMore: true });
    expect(first.items.map(item => item.id)).toEqual(saved.slice(0, 25).map(item => item.id));
    const second = await listWorkspaceFileTransfersPage(f.config, f.workspace.id, { offset: 25 });
    expect(second.items.map(item => item.id)).toEqual(saved.slice(25, 50).map(item => item.id));
    const found = await listWorkspaceFileTransfersPage(f.config, f.workspace.id, { q: 'final-60' });
    expect(found.items).toEqual([expect.objectContaining({ id: saved[60].id, state: 'interrupted', phase: 'verifying' })]);
    expect(noEagerDirectoryRead).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(f.workspace.path, 'source-60.txt'), 'utf8')).toBe('original source');
    expect(await fs.readFile(path.join(f.workspace.path, 'destination/final-60.txt'), 'utf8')).toBe('retained destination');
    expect(JSON.parse(await fs.readFile(path.join(f.config.stateDir, `file-transfer-${saved[60].id}.json`), 'utf8'))).toEqual(saved[60]);
  });

  it('rejects unsafe or corrupt metadata even outside the selected workspace without reading through links', async () => {
    const foreign = await savedTransfer(0, { workspaceId: 'different-workspace' });
    const outside = path.join(f.directory, 'outside-status.json');
    await fs.writeFile(outside, JSON.stringify(foreign));
    const journal = path.join(f.config.stateDir, `file-transfer-${foreign.id}.json`);
    await fs.unlink(journal); await fs.symlink(outside, journal);
    await expect(listWorkspaceFileTransfersPage(f.config, f.workspace.id)).rejects.toMatchObject({ status: 409, code: 'FILE_TRANSFER_STATE_INVALID' });
    expect(JSON.parse(await fs.readFile(outside, 'utf8'))).toEqual(foreign);
    await fs.unlink(journal); await fs.writeFile(journal, '{broken JSON');
    await expect(listWorkspaceFileTransfersPage(f.config, f.workspace.id, { q: 'not present' })).rejects.toMatchObject({ code: 'FILE_TRANSFER_STATE_INVALID' });
  });
});
