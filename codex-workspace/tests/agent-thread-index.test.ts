import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { ThreadSummary } from '../shared/types';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { ThreadIndex, type ThreadIndexOptions, type ThreadIndexWarning } from '../server/agent/thread-index';

const id = (number: number) => `thr_${number.toString(16).padStart(32, '0')}`;
const timestamp = '2026-09-19T12:00:00.000Z';
const summary = (number: number, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: id(number), workspaceId: 'workspace-test', title: `Conversation ${number}`,
  createdAt: timestamp, updatedAt: timestamp, status: 'idle', ...patch,
});
const saved = (value: ThreadSummary, body = 'Saved conversation body') => ({ thread: { ...value,
  messages: [{ id: 'msg_original', role: 'user', content: body, createdAt: timestamp }] },
  input: [{ role: 'user', content: body }], revision: 4,
});

describe('durable per-conversation enumeration with independent JsonStore instances', () => {
  let directory: string, stateDir: string, contexts: AppContext[], logs: ReturnType<typeof vi.spyOn>;
  const warnings: ThreadIndexWarning[] = [];
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-thread-index-'));
    const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'thread-index-test-only', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
    stateDir = config.stateDir;
    await fs.mkdir(stateDir, { recursive: true });
    contexts = Array.from({ length: 3 }, () => {
      const events = new EventEmitter();
      events.on('thread-index:warning', warning => warnings.push(warning));
      return { config, store: new JsonStore(stateDir), events } as AppContext;
    });
    warnings.length = 0;
    logs = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await Promise.all(contexts.map(ctx => ctx.store.flush().catch(() => undefined)));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const index = (position = 0, options?: ThreadIndexOptions) => new ThreadIndex(contexts[position], options);
  const file = (key: string) => path.join(stateDir, `${key}.json`);
  const record = (number: number, patch?: Partial<ThreadSummary>) => contexts[0].store.write(`thread-${id(number)}`, saved(summary(number, patch)));
  const sortedIds = (items: ThreadSummary[]) => items.map(item => item.id).sort();

  it('keeps independent threads when two stores replace the shared aggregate with stale snapshots', async () => {
    const first = index(0), second = index(1), left = summary(1), right = summary(2);
    await Promise.all([first.initialize(), second.initialize()]);
    await Promise.all([contexts[0].store.write(`thread-${left.id}`, saved(left)), contexts[1].store.write(`thread-${right.id}`, saved(right))]);
    await Promise.all([first.upsert(left), second.upsert(right)]);
    await contexts[0].store.write('thread-index', [left]);
    expect(sortedIds(await second.list())).toEqual([left.id, right.id]);
    await contexts[1].store.write('thread-index', [right]);
    expect(sortedIds(await first.list())).toEqual([left.id, right.id]);
    await contexts[1].store.write('thread-index', []);
    expect(sortedIds(await index(2).list())).toEqual([left.id, right.id]);
    expect(sortedIds(await contexts[2].store.read<ThreadSummary[]>('thread-index', []))).toEqual([left.id, right.id]);
    expect(await contexts[2].store.read(`thread-${left.id}`, null)).toEqual(saved(left));
    expect(await contexts[2].store.read(`thread-${right.id}`, null)).toEqual(saved(right));
  });

  it('repairs unindexed full records and preserves archive, fork and child metadata without copying histories', async () => {
    const parent = summary(1, { archivedAt: timestamp, forkedFrom: { threadId: id(8), turnId: 'turn_original' } });
    const child = summary(2, { parentThreadId: parent.id, rootThreadId: parent.id, taskName: 'inspect_files', agentRole: 'explorer' });
    await contexts[0].store.write(`thread-${parent.id}`, saved(parent, 'DO_NOT_COPY_HISTORY_INTO_SUMMARY'));
    await contexts[0].store.write(`thread-${child.id}`, saved(child));
    await contexts[0].store.write('thread-index', [summary(9)]); // This identity has no saved record.
    const before = await fs.readFile(file(`thread-${parent.id}`), 'utf8');
    const recovered = index();
    await recovered.initialize();
    expect(sortedIds(await recovered.list())).toEqual([parent.id, child.id]);
    expect(await recovered.list()).toEqual([parent, child]);
    expect(recovered.status().repaired).toBe(2);
    const metadata = await contexts[0].store.read<{ version: number; summary: ThreadSummary } | null>(`thread-summary-${parent.id}`, null);
    expect(metadata?.summary).toEqual(parent);
    expect(JSON.stringify(metadata)).not.toContain('DO_NOT_COPY_HISTORY_INTO_SUMMARY');
    expect(JSON.stringify(metadata)).not.toContain('messages');
    expect(await fs.readFile(file(`thread-${parent.id}`), 'utf8')).toBe(before);
  });

  it('reconciles an older summary with a changed full record on startup, without altering its live status', async () => {
    const original = summary(1), first = index();
    await record(1); await first.upsert(original);
    const changed = summary(1, { status: 'awaiting_approval', title: 'Updated by another runtime', archivedAt: timestamp });
    await contexts[1].store.write(`thread-${changed.id}`, saved(changed));
    await contexts[1].store.write('thread-index', [changed]);
    const fresh = index(2);
    expect(await fresh.list()).toEqual([changed]);
    expect((await contexts[2].store.read<{ thread: ThreadSummary }>(`thread-${changed.id}`, { thread: original })).thread.status).toBe('awaiting_approval');
  });

  it('writes a deletion marker before cleanup and suppresses late full, summary and aggregate writes after restart', async () => {
    const first = index(0), second = index(1), original = summary(1);
    await record(1); await first.upsert(original);
    await second.initialize();
    expect(await second.isDeleted(original.id)).toBe(false);
    const originalDelete = contexts[0].store.delete.bind(contexts[0].store);
    const deletions = vi.spyOn(contexts[0].store, 'delete').mockImplementation(async key => {
      const marker = JSON.parse(await fs.readFile(file(`thread-deleted-${original.id}`), 'utf8'));
      expect(marker).toMatchObject({ version: 1, id: original.id });
      expect(Number.isFinite(Date.parse(marker.deletedAt))).toBe(true);
      await originalDelete(key);
    });
    await first.markDeleted(original.id);
    expect(deletions).toHaveBeenCalledWith(`thread-summary-${original.id}`);
    // The helper does not own full histories; the engine deletes them only now.
    expect(await contexts[0].store.read(`thread-${original.id}`, null)).toEqual(saved(original));
    await contexts[0].store.delete(`thread-${original.id}`);
    const later = { ...original, updatedAt: '2030-01-01T00:00:00.000Z' };
    await contexts[1].store.write(`thread-${original.id}`, saved(later));
    await contexts[1].store.write(`thread-summary-${original.id}`, later);
    await contexts[1].store.write('thread-index', [later]);
    expect(await second.isDeleted(original.id)).toBe(true);
    expect(await second.list()).toEqual([]);
    expect(await index(2).list()).toEqual([]);
    expect(await contexts[2].store.read('thread-index', null)).toEqual([]);
    await expect(second.upsert(later)).rejects.toMatchObject({ status: 409, code: 'THREAD_DELETED' });
    expect(await contexts[1].store.read(`thread-${original.id}`, null)).toEqual(saved(later));
  });

  it('does not remove any recoverable files when saving the deletion marker fails', async () => {
    const helper = index(), original = summary(1);
    await record(1); await helper.upsert(original);
    const previous = await fs.readFile(file(`thread-summary-${original.id}`), 'utf8');
    const originalWrite = contexts[0].store.write.bind(contexts[0].store);
    vi.spyOn(contexts[0].store, 'write').mockImplementation(async (key, value) => {
      if (key === `thread-deleted-${original.id}`) throw new Error('do-not-expose-storage-message');
      return originalWrite(key, value);
    });
    const remove = vi.spyOn(contexts[0].store, 'delete');
    await expect(helper.markDeleted(original.id)).rejects.toMatchObject({ status: 503, code: 'THREAD_DELETE_PERSISTENCE' });
    expect(remove).not.toHaveBeenCalled();
    expect(await fs.readFile(file(`thread-summary-${original.id}`), 'utf8')).toBe(previous);
    expect(await contexts[1].store.read(`thread-${original.id}`, null)).toEqual(saved(original));
    expect(await index(1).list()).toEqual([original]);
  });

  it('rejects a delayed upsert when another store deletes the same identity during its save', async () => {
    const deleting = index(0), writing = index(1), original = summary(1);
    await record(1); await deleting.upsert(original);
    let reached!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const actualWrite = contexts[1].store.write.bind(contexts[1].store);
    vi.spyOn(contexts[1].store, 'write').mockImplementation(async (key, value) => {
      if (key === `thread-summary-${original.id}`) { reached(); await hold; }
      return actualWrite(key, value);
    });
    const outcome = writing.upsert({ ...original, title: 'A queued stale save' }).then(() => null, error => error);
    await waiting;
    await deleting.markDeleted(original.id);
    release();
    expect(await outcome).toMatchObject({ code: 'THREAD_DELETED', status: 409 });
    expect(await writing.list()).toEqual([]);
    expect(await index(2).list()).toEqual([]);
  });

  it('reports malformed or mismatched records, ignores unsafe names, and leaves unrelated files untouched', async () => {
    const broken = '{"private_contents":"DO_NOT_LOG_THE_CONTENTS"';
    await fs.writeFile(file(`thread-${id(1)}`), broken);
    await contexts[0].store.write(`thread-${id(2)}`, saved(summary(3)));
    await fs.writeFile(file(`thread-summary-${id(4)}`), broken);
    await fs.writeFile(file('thread-summary-thr_INVALID'), '{}');
    await fs.writeFile(file('notes'), broken);
    await fs.writeFile(file('thread-index'), broken);
    await fs.writeFile(path.join(stateDir, `thread-${id(7)}.json.incomplete.tmp`), broken);
    await record(5);
    const helper = index();
    expect(await helper.list()).toEqual([summary(5)]);
    const codes = helper.status().warnings.map(warning => warning.code);
    expect(codes).toEqual(expect.arrayContaining(['THREAD_INDEX_MALFORMED', 'THREAD_INDEX_INVALID_CONVERSATION', 'THREAD_INDEX_UNSAFE_NAME']));
    expect(warnings.length).toBeGreaterThan(0);
    expect(logs).toHaveBeenCalled();
    expect(JSON.stringify(warnings)).not.toContain('DO_NOT_LOG_THE_CONTENTS');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('DO_NOT_LOG_THE_CONTENTS');
    expect(await fs.readFile(file('notes'), 'utf8')).toBe(broken);
    expect(await fs.readFile(file(`thread-${id(1)}`), 'utf8')).toBe(broken);
    expect(await fs.readFile(file('thread-summary-thr_INVALID'), 'utf8')).toBe('{}');
    expect(await fs.readFile(path.join(stateDir, `thread-${id(7)}.json.incomplete.tmp`), 'utf8')).toBe(broken);
    // Diagnostics returned to a caller cannot mutate the helper's own state.
    const status = helper.status(); status.warnings[0].message = 'modified';
    expect(helper.status().warnings[0].message).not.toBe('modified');
  });

  it('does not follow full-record, summary or deletion symlinks into foreign paths', async () => {
    const foreign = path.join(directory, 'foreign');
    await fs.mkdir(foreign);
    for (const number of [1, 2, 3]) await fs.writeFile(path.join(foreign, `${number}.json`), JSON.stringify(saved(summary(number), 'FOREIGN_DATA')));
    await fs.symlink(path.join(foreign, '1.json'), file(`thread-${id(1)}`));
    await contexts[0].store.write(`thread-summary-${id(1)}`, summary(1));
    await record(2);
    await fs.symlink(path.join(foreign, '2.json'), file(`thread-summary-${id(2)}`));
    await record(3);
    await contexts[0].store.write(`thread-summary-${id(3)}`, summary(3));
    await fs.symlink(path.join(foreign, '3.json'), file(`thread-deleted-${id(3)}`));
    const opens = vi.spyOn(fs, 'open'), helper = index();
    expect(await helper.list()).toEqual([]);
    expect(await helper.isDeleted(id(3))).toBe(true);
    const opened = opens.mock.calls.map(call => String(call[0]));
    expect(opened.some(target => target.startsWith(foreign))).toBe(false);
    expect(opened).not.toContain(file(`thread-${id(1)}`));
    expect(opened).not.toContain(file(`thread-summary-${id(2)}`));
    expect(opened).not.toContain(file(`thread-deleted-${id(3)}`));
    expect(helper.status().warnings.map(item => item.code)).toContain('THREAD_INDEX_UNSAFE_RECORD');
    expect((await fs.lstat(file(`thread-${id(1)}`))).isSymbolicLink()).toBe(true);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('FOREIGN_DATA');
  });

  it('refuses a state-directory symlink instead of scanning its target', async () => {
    const foreign = path.join(directory, 'foreign-state');
    await fs.mkdir(foreign);
    await fs.writeFile(path.join(foreign, `thread-${id(1)}.json`), JSON.stringify(saved(summary(1))));
    await fs.rmdir(stateDir);
    await fs.symlink(foreign, stateDir);
    const opens = vi.spyOn(fs, 'open');
    await expect(index().initialize()).rejects.toMatchObject({ code: 'THREAD_INDEX_UNSAFE_DIRECTORY', status: 503 });
    expect(opens).not.toHaveBeenCalled();
    expect(await fs.readdir(foreign)).toEqual([`thread-${id(1)}.json`]);
  });

  it('uses no-follow open flags against a regular-file to symlink race', async () => {
    const foreign = path.join(directory, 'foreign.json');
    await fs.writeFile(foreign, JSON.stringify(saved(summary(1), 'FOREIGN_DATA')));
    await record(1);
    const actualOpen = fs.open.bind(fs);
    let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      if (!replaced && String(filename) === file(`thread-${id(1)}`)) {
        replaced = true;
        expect(Number(flags) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
        await fs.unlink(String(filename)); await fs.symlink(foreign, String(filename));
      }
      return actualOpen(filename, flags, mode);
    });
    const helper = index();
    expect(await helper.list()).toEqual([]);
    expect(helper.status().warnings.map(item => item.code)).toContain('THREAD_INDEX_UNSAFE_RECORD');
    expect(await fs.readFile(foreign, 'utf8')).toContain('FOREIGN_DATA');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('FOREIGN_DATA');
  });

  it('treats a malformed deletion marker as a visible recovery block, never as a missing marker', async () => {
    await record(1);
    await fs.writeFile(file(`thread-deleted-${id(1)}`), '{');
    const helper = index();
    expect(await helper.isDeleted(id(1))).toBe(true);
    expect(await helper.list()).toEqual([]);
    expect(helper.status().warnings.map(item => item.code)).toContain('THREAD_INDEX_TOMBSTONE_INVALID');
    await expect(helper.upsert(summary(1))).rejects.toMatchObject({ code: 'THREAD_DELETED' });
    expect(await contexts[0].store.read(`thread-${id(1)}`, null)).toEqual(saved(summary(1)));
  });

  it('bounds repair work and continues deferred records without rereading large histories on normal lists', async () => {
    for (const number of [1, 2, 3]) await contexts[0].store.write(`thread-${id(number)}`, saved(summary(number), 'x'.repeat(500)));
    const helper = index(0, { maxRepairsPerPass: 2, maxRepairBytesPerPass: 2_000, maxFullRecordBytes: 2_000 });
    await helper.initialize();
    expect(helper.status().repaired).toBe(1);
    expect(helper.status().warnings.map(item => item.code)).toContain('THREAD_INDEX_REPAIR_DEFERRED');
    await helper.list();
    expect(sortedIds(await helper.list())).toEqual([id(1), id(2), id(3)]);
    expect(helper.status().repaired).toBe(3);
    const opens = vi.spyOn(fs, 'open');
    await helper.list(); await helper.list();
    expect(opens.mock.calls.filter(call => /\/thread-thr_[a-f0-9]{32}\.json$/.test(String(call[0])))).toEqual([]);
    const restarted = index(2);
    await restarted.initialize();
    expect(opens.mock.calls.filter(call => /\/thread-thr_[a-f0-9]{32}\.json$/.test(String(call[0])))).toEqual([]);
    expect(restarted.status().repaired).toBe(0);
  });

  it('reports oversized records, does not repeatedly parse them, and retries when their actual file changes', async () => {
    await record(1);
    await fs.truncate(file(`thread-${id(1)}`), 65_536);
    const helper = index(0, { maxFullRecordBytes: 2_000 });
    expect(await helper.list()).toEqual([]);
    expect(helper.status().warnings.map(item => item.code)).toContain('THREAD_INDEX_RECORD_LIMIT');
    const opens = vi.spyOn(fs, 'open');
    await helper.list();
    expect(opens.mock.calls.filter(call => /\/thread-thr_/.test(String(call[0])))).toEqual([]);
    await contexts[1].store.write(`thread-${id(1)}`, saved(summary(1)));
    expect(await helper.list()).toEqual([summary(1)]);
  });

  it('counts malformed history bytes toward the per-pass recovery budget', async () => {
    for (const number of [1, 2, 3]) await fs.writeFile(file(`thread-${id(number)}`), '{'.repeat(1_100));
    const helper = index(0, { maxRepairBytesPerPass: 2_000, maxFullRecordBytes: 2_000 });
    const opens = vi.spyOn(fs, 'open');
    await helper.initialize();
    expect(opens.mock.calls.filter(call => /\/thread-thr_[a-f0-9]{32}\.json$/.test(String(call[0])))).toHaveLength(1);
    expect(helper.status().warnings.map(item => item.code)).toEqual(expect.arrayContaining(['THREAD_INDEX_MALFORMED', 'THREAD_INDEX_REPAIR_DEFERRED']));
    opens.mockClear();
    await helper.list();
    expect(opens.mock.calls.filter(call => /\/thread-thr_[a-f0-9]{32}\.json$/.test(String(call[0])))).toHaveLength(1);
  });

  it('reports a directory scan limit instead of claiming its partial list is complete', async () => {
    for (const number of [1, 2, 3]) await record(number);
    const helper = index(0, { maxDirectoryEntries: 1 });
    await helper.initialize();
    expect(helper.status().warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'THREAD_INDEX_SCAN_LIMIT' })]));
    for (const number of [1, 2, 3]) expect(await contexts[0].store.read(`thread-${id(number)}`, null)).toEqual(saved(summary(number)));
  });

  it('repairs a summary removed or corrupted after a successful recovery', async () => {
    await record(1);
    const helper = index();
    expect(await helper.list()).toEqual([summary(1)]);
    await contexts[1].store.delete(`thread-summary-${id(1)}`);
    await contexts[1].store.write('thread-index', []);
    expect(await helper.list()).toEqual([summary(1)]);
    await fs.writeFile(file(`thread-summary-${id(1)}`), 'broken');
    expect(await helper.list()).toEqual([summary(1)]);
    expect(helper.status().repaired).toBe(3);
  });

  it('distinguishes a new empty directory from malformed state and rejects path-like identities', async () => {
    const helper = index();
    expect(await helper.list()).toEqual([]);
    expect(helper.status()).toEqual({ warnings: [], repaired: 0 });
    await fs.rmdir(stateDir);
    expect(await index(1).list()).toEqual([]);
    expect(await fs.stat(stateDir).catch(error => error.code)).toBe('ENOENT');
    await expect(helper.isDeleted('../outside')).rejects.toMatchObject({ code: 'THREAD_ID_INVALID' });
    await expect(helper.markDeleted('../outside')).rejects.toMatchObject({ code: 'THREAD_ID_INVALID' });
    await expect(helper.upsert({ ...summary(1), id: '../outside' })).rejects.toMatchObject({ code: 'THREAD_SUMMARY_INVALID' });
  });

  it('lists settled summaries without probing absent deletion markers, while direct access still checks them', async () => {
    const helper = index();
    for (let number = 1; number <= 12; number++) {
      const value = summary(number, { workspaceId: number % 2 ? 'workspace-test' : 'another-workspace' });
      await contexts[0].store.write(`thread-${id(number)}`, saved(value)); await helper.upsert(value);
    }
    await helper.initialize();
    const stats = vi.spyOn(fs, 'lstat');
    const listed = await helper.list();
    expect(listed).toHaveLength(12);
    expect(stats.mock.calls.filter(call => /\/thread-deleted-thr_[a-f0-9]{32}\.json$/.test(String(call[0])))).toEqual([]);
    expect(await helper.isDeleted(id(1))).toBe(false);
    expect(stats.mock.calls.some(call => String(call[0]) === file(`thread-deleted-${id(1)}`))).toBe(true);
    stats.mockClear();
    await helper.upsert(summary(1));
    expect(stats.mock.calls.filter(call => String(call[0]) === file(`thread-deleted-${id(1)}`)).length).toBeGreaterThanOrEqual(2);
  });

  it('observes independent creation, summary edits and deletion on each subsequent fresh list', async () => {
    const reader = index(0), writer = index(1);
    await record(1); await writer.upsert(summary(1));
    expect(await reader.list()).toEqual([summary(1)]);
    await contexts[1].store.write(`thread-${id(2)}`, saved(summary(2)));
    await writer.upsert(summary(2));
    expect(sortedIds(await reader.list())).toEqual([id(1), id(2)]);
    const changed = summary(1, { title: 'Updated by the other service', archivedAt: timestamp });
    await contexts[1].store.write(`thread-${id(1)}`, saved(changed));
    await writer.upsert(changed);
    expect((await reader.list()).find(item => item.id === id(1))).toEqual(changed);
    await writer.markDeleted(id(1));
    expect(await reader.list()).toEqual([summary(2)]);
    expect(await reader.isDeleted(id(1))).toBe(true);
  });

  it('discovers deletion committed during a summary read even if a late writer leaves the summary present', async () => {
    const reader = index(0), writer = index(1), original = summary(1);
    await record(1); await writer.upsert(original); await reader.initialize();
    const stale = await contexts[1].store.read(`thread-summary-${id(1)}`, null);
    const originalOpen = fs.open.bind(fs);
    let interleaved = false;
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await originalOpen(filename, flags, mode);
      if (!interleaved && String(filename) === file(`thread-summary-${id(1)}`)) {
        interleaved = true;
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          await close();
          // The first namespace snapshot and safe summary read have completed.
          // Another service now commits deletion, followed by an old queued save.
          await writer.markDeleted(id(1));
          await contexts[1].store.write(`thread-summary-${id(1)}`, stale);
        });
      }
      return handle;
    });
    expect(await reader.list()).toEqual([]);
    expect(interleaved).toBe(true);
    expect(await reader.isDeleted(id(1))).toBe(true);
    expect(await contexts[0].store.read(`thread-${id(1)}`, null)).toEqual(saved(original));
  });

  it('pins a marker observed in the directory even when its leaf disappears before diagnostics', async () => {
    await record(1); await index(0).upsert(summary(1));
    const marker = file(`thread-deleted-${id(1)}`);
    await contexts[1].store.write(`thread-deleted-${id(1)}`, { version: 1, id: id(1), deletedAt: timestamp });
    const actualStat = fs.lstat.bind(fs);
    let removed = false;
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      if (!removed && String(args[0]) === marker) { removed = true; await fs.unlink(marker); }
      return actualStat(...args);
    }) as typeof fs.lstat);
    const reader = index(2);
    expect(await reader.list()).toEqual([]);
    expect(removed).toBe(true);
    expect(await reader.isDeleted(id(1))).toBe(true);
    expect(reader.status().warnings.map(item => item.code)).toContain('THREAD_INDEX_TOMBSTONE_INVALID');
  });

  it('falls back to direct deletion probes when the final namespace scan is incomplete', async () => {
    await record(1); await index(0).upsert(summary(1));
    await contexts[1].store.write(`thread-deleted-${id(1)}`, { version: 1, id: id(1), deletedAt: timestamp });
    const openDirectory = fs.opendir.bind(fs);
    vi.spyOn(fs, 'opendir').mockImplementation(async (location, options) => {
      const actual = await openDirectory(location, options);
      if (String(location) !== stateDir) return actual;
      // Reorder actual filesystem entries so the marker falls beyond the scan
      // budget. This models a valid native directory enumeration order.
      return {
        [Symbol.asyncIterator]: async function* () {
          const entries = [];
          for await (const entry of actual) entries.push(entry);
          const order = (name: string) => name === `thread-summary-${id(1)}.json` ? 0 : name === `thread-${id(1)}.json` ? 1 : 2;
          entries.sort((left, right) => order(left.name) - order(right.name));
          yield* entries;
        },
      } as unknown as Awaited<ReturnType<typeof fs.opendir>>;
    });
    const stats = vi.spyOn(fs, 'lstat');
    const reader = index(2, { maxDirectoryEntries: 2 });
    expect(await reader.list()).toEqual([]);
    expect(reader.status().warnings.map(item => item.code)).toContain('THREAD_INDEX_SCAN_LIMIT');
    expect(stats.mock.calls.some(call => String(call[0]) === file(`thread-deleted-${id(1)}`))).toBe(true);
  });

  it('fails closed on a final namespace I/O failure rather than treating it as an empty marker set', async () => {
    await record(1); const helper = index(); await helper.upsert(summary(1)); await helper.initialize();
    const openDirectory = fs.opendir.bind(fs);
    let scans = 0;
    vi.spyOn(fs, 'opendir').mockImplementation(async (location, options) => {
      if (String(location) === stateDir && ++scans === 2) throw Object.assign(new Error('private filesystem diagnostic'), { code: 'EIO' });
      return openDirectory(location, options);
    });
    await expect(helper.list()).rejects.toMatchObject({ status: 503, code: 'THREAD_INDEX_STORAGE' });
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private filesystem diagnostic');
  });

  it('refilters local deletion committed while compatibility publication is awaiting storage', async () => {
    await record(1); const helper = index(); await helper.upsert(summary(1)); await helper.initialize();
    await contexts[0].store.write('thread-index', []);
    const write = contexts[0].store.write.bind(contexts[0].store);
    const remove = contexts[0].store.delete.bind(contexts[0].store);
    let reached!: () => void, release!: () => void, held = false;
    let marked!: () => void;
    const arrived = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const markerCommitted = new Promise<void>(resolve => { marked = resolve; });
    vi.spyOn(contexts[0].store, 'write').mockImplementation(async (key, value) => {
      if (key === 'thread-index' && !held) { held = true; reached(); await gate; }
      return write(key, value);
    });
    vi.spyOn(contexts[0].store, 'delete').mockImplementation(async key => {
      // markDeleted verifies its durable marker before removing this summary.
      if (key === `thread-summary-${id(1)}`) marked();
      await remove(key);
    });
    const pending = helper.list();
    let deleting: Promise<void> | undefined;
    try { await arrived; deleting = helper.markDeleted(id(1)); await markerCommitted; }
    finally { release(); }
    await deleting;
    expect(await pending).toEqual([]);
    expect(await helper.isDeleted(id(1))).toBe(true);
    expect(await contexts[0].store.read('thread-index', null)).toEqual([]);
    expect(await index(2).list()).toEqual([]);
  });
});
