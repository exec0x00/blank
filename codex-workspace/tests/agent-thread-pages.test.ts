import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import type { ThreadListPage, ThreadSummary } from '../shared/types';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { ThreadIndex, type ThreadIndexPageInput } from '../server/agent/thread-index';
import { THREAD_LIST_LIMITS, ThreadPageIndex } from '../server/agent/thread-pages';

const id = (number: number) => `thr_${number.toString(16).padStart(32, '0')}`;
const timestamp = '2026-09-20T12:00:00.000Z';
const summary = (number: number, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: id(number), workspaceId: 'workspace-test', title: `Conversation ${number}`,
  createdAt: timestamp, updatedAt: timestamp, status: 'idle', ...patch,
});
const ids = (page: ThreadListPage) => page.items.map(item => item.id);
const saved = (value: ThreadSummary) => ({ thread: { ...value,
  messages: [{ id: 'msg_original', role: 'user', content: 'PRIVATE_FULL_HISTORY', createdAt: timestamp }] },
  input: [{ role: 'user', content: 'PRIVATE_FULL_HISTORY' }], revision: 1,
});

describe('bounded thread metadata pages', () => {
  const make = (values: ThreadSummary[]) => {
    const result = new ThreadPageIndex('thread-list-test-secret', 100_000);
    result.reconcile(values.map(summary => ({ summary })));
    return result;
  };
  const page = (index: ThreadPageIndex, input: ThreadIndexPageInput = {}) => index.page(index.query(input));

  it('walks tied timestamps completely in both directions without offset drift', () => {
    const values = Array.from({ length: 237 }, (_, number) => summary(number + 1));
    const index = make([...values].reverse()), initial = page(index);
    expect(initial.items).toHaveLength(40);
    expect(initial).toMatchObject({ hasOlder: true, hasNewer: false, newerCursor: expect.any(String) });
    const pages = [initial];
    while (pages.at(-1)!.hasOlder) pages.push(page(index, { before: pages.at(-1)!.olderCursor! }));
    expect(pages.flatMap(ids)).toEqual(values.map(item => item.id));
    expect(new Set(pages.flatMap(ids)).size).toBe(values.length);
    const previous = page(index, { after: pages[2].newerCursor! });
    expect(ids(previous)).toEqual(ids(pages[1]));
    expect(page(index, { after: pages[1].newerCursor! })).toEqual(initial);
    // Consumers receive copies, including nested fork metadata.
    initial.items[0].title = 'Changed by a caller';
    expect(page(index).items[0].title).toBe('Conversation 1');
  });

  it('scopes title search, archives and child visibility while keeping one current selection', () => {
    const values = [summary(1, { title: 'Needle newest' }), summary(2),
      summary(3, { title: 'NEEDLE archived', archivedAt: timestamp }),
      summary(4, { title: 'Needle child', parentThreadId: id(1), taskName: 'inspect' }),
      summary(5, { title: 'Needle in another workspace', workspaceId: 'elsewhere' })];
    const index = make(values);
    expect(page(index, { workspaceId: 'workspace-test', query: '  nEeDlE  ', selectedId: id(2) })).toMatchObject({
      items: [values[0]], selected: values[1], hasOlder: false, hasNewer: false,
    });
    expect(page(index, { workspaceId: 'workspace-test', query: 'Needle', selectedId: id(5) }).selected).toBeUndefined();
    expect(page(index, { query: 'needle', selectedId: id(3), workspaceId: 'workspace-test' }).selected).toBeUndefined();
    expect(page(index, { query: 'needle', selectedId: id(4), workspaceId: 'workspace-test' }).selected).toBeUndefined();
    expect(ids(page(index, { workspaceId: 'workspace-test', archived: 'archived', includeAgents: true }))).toEqual([id(3)]);
    expect(ids(page(index, { workspaceId: 'workspace-test', archived: 'all', includeAgents: true, query: 'needle' }))).toEqual([id(1), id(3), id(4)]);
    expect(page(index, { selectedId: id(1) }).selected).toBeUndefined();
  });

  it('authenticates every cursor and binds it to normalized filters', () => {
    const index = make(Array.from({ length: 80 }, (_, number) => summary(number)));
    const input = { workspaceId: 'workspace-test', query: 'conversation', limit: 10 };
    const first = page(index, input), cursor = first.olderCursor!;
    expect(ids(page(index, { ...input, query: ' CONVERSATION ', before: cursor }))).toEqual(Array.from({ length: 10 }, (_, number) => id(number + 10)));
    for (const patch of [{ workspaceId: 'elsewhere' }, { archived: 'all' as const }, { includeAgents: true }, { query: 'different' }]) {
      expect(() => page(index, { ...input, ...patch, before: cursor })).toThrow(/different filters/);
    }
    expect(() => page(index, { ...input, before: `${cursor.slice(0, -3)}xxx` })).toThrow(/cursor is invalid/);
    expect(() => page(index, { ...input, before: '../secrets' })).toThrow(/cursor is invalid/);
    expect(() => page(index, { before: 'x'.repeat(1401) })).toThrow(/cursor is invalid/);
    expect(() => page(index, { before: cursor, after: cursor })).toThrow(/direction/);
    for (const limit of [0, -1, 61, 1.5, Infinity]) expect(() => page(index, { limit })).toThrow(/page size/);
    expect(() => page(index, { query: 'x'.repeat(201) })).toThrow(/filters/);
    expect(() => page(index, { query: 'bad\u0000query' })).toThrow(/filters/);
    expect(() => page(index, { selectedId: '../outside' })).toThrow(/filters/);
    expect(() => page(index, { workspaceId: '../outside' })).toThrow(/workspace/);
    const another = new ThreadPageIndex('different-session-secret', 100_000);
    expect(() => page(another, { ...input, before: cursor })).toThrow(/cursor is invalid/);
    const unicode = make([summary(1, { title: '🙂'.repeat(100) }), summary(2, { title: '🙂'.repeat(100) })]);
    const unicodeFirst = page(unicode, { query: '🙂'.repeat(100), limit: 1 });
    expect(unicodeFirst.olderCursor!.length).toBeLessThan(1400);
    expect(ids(page(unicode, { query: '🙂'.repeat(100), limit: 1, before: unicodeFirst.olderCursor! }))).toEqual([id(2)]);
  });

  it('keeps cursor boundaries usable after deletion, rename and newly arriving threads', () => {
    const index = make(Array.from({ length: 100 }, (_, number) => summary(number + 1)));
    const first = page(index), expected = Array.from({ length: 40 }, (_, number) => id(number + 41));
    index.delete(id(40));
    index.set(summary(101, { updatedAt: '2027-01-01T00:00:00.000Z', title: 'New arrival' }));
    expect(ids(page(index, { before: first.olderCursor! }))).toEqual(expected);
    expect(ids(page(index, { after: first.newerCursor! }))).toEqual([id(101)]);
    index.set(summary(99, { updatedAt: '2028-01-01T00:00:00.000Z', title: 'Renamed newest' }));
    expect(ids(page(index, { query: 'renamed' }))).toEqual([id(99)]);
    expect(ids(page(index, { before: first.olderCursor! }))).toEqual(expected);
  });

  it('bounds wire bytes and metadata memory without dropping saved title contents', () => {
    const title = '\ud800'.repeat(4096); // Escaping makes the JSON much larger than the character count.
    const index = make(Array.from({ length: 100 }, (_, number) => summary(number, { title })));
    const result = page(index, { limit: 60, selectedId: id(99) });
    expect(result.items.length).toBeGreaterThan(1);
    expect(result.items.length).toBeLessThan(60);
    expect(result.items.every(item => item.title === title)).toBe(true);
    expect(result.selected?.id).toBe(id(99));
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(THREAD_LIST_LIMITS.pageBytes);
    const small = new ThreadPageIndex('test-secret', 2, 4096);
    small.set(summary(1)); small.set(summary(2));
    expect(() => small.set(summary(3))).toThrow(/memory limit/);
    expect(() => small.set(summary(1, { title }))).toThrow(/memory limit/);
    expect(ids(page(small))).toEqual([id(1), id(2)]);
    small.clear(); small.set(summary(3));
    expect(ids(page(small))).toEqual([id(3)]);
  });
});

describe('thread pages derived from independent native summary records', () => {
  let directory: string, stateDir: string, contexts: AppContext[];
  beforeEach(async () => {
    // A coordinator can run only the large-set case on the native /data volume.
    // Each test owns a new directory; existing application state is never used.
    directory = await fs.mkdtemp(path.join(process.env.CODEX_THREAD_PAGE_TEST_ROOT || os.tmpdir(), 'codex-thread-pages-'));
    const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'thread-page-test-only', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
    stateDir = config.stateDir;
    await fs.mkdir(stateDir, { recursive: true });
    contexts = Array.from({ length: 3 }, () => ({ config, store: new JsonStore(stateDir), events: new EventEmitter() } as AppContext));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  }, 180_000);
  afterEach(async () => {
    await Promise.all(contexts.map(ctx => ctx.store.flush().catch(() => undefined)));
    await fs.rm(directory, { recursive: true, force: true });
  }, 180_000);
  const file = (key: string) => path.join(stateDir, `${key}.json`);
  const put = (value: ThreadSummary, context = 0) => contexts[context].store.write(`thread-summary-${value.id}`, { version: 1, summary: value });
  const settle = () => vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
  const openedSummaries = (calls: unknown[][]) => calls.filter(call => /\/thread-summary-thr_[a-f0-9]{32}\.json$/.test(String(call[0])));

  it('pages and searches a large real summary set with bounded canonical row reads after active updates', async () => {
    const count = Number(process.env.CODEX_THREAD_PAGE_NATIVE_RECORDS || 1500);
    if (!Number.isSafeInteger(count) || count < 500 || count > 20_000) throw new Error('Native thread page fixture size must be between 500 and 20000.');
    const prepared = performance.now();
    for (let start = 1; start <= count; start += 16) {
      await Promise.all(Array.from({ length: Math.min(16, count - start + 1) }, (_, offset) => {
        const number = start + offset, value = summary(number, { title: number % 49 === 0 ? `Needle ${number}` : `Conversation ${number}` });
        return fs.writeFile(file(`thread-summary-${value.id}`), JSON.stringify({ version: 1, summary: value }));
      }));
    }
    // Native timing uses the actual filesystem clock. Unit runs only advance
    // cache admission time, avoiding an otherwise unnecessary two-second wait.
    if (process.env.CODEX_THREAD_PAGE_TEST_ROOT) await new Promise(resolve => setTimeout(resolve, 2_100));
    else settle();
    const helper = new ThreadIndex(contexts[0]), coldStart = performance.now();
    const first = await helper.page();
    const coldMs = performance.now() - coldStart;
    expect(first.items).toHaveLength(40);
    const opens = vi.spyOn(fs, 'open'), stats = vi.spyOn(fs, 'lstat');
    const warmStart = performance.now();
    const older = await helper.page({ before: first.olderCursor! });
    const warmMs = performance.now() - warmStart;
    expect(ids(older)).toEqual(Array.from({ length: 40 }, (_, number) => id(number + 41)));
    const warmSummaryOpens = openedSummaries(opens.mock.calls).length;
    expect(warmSummaryOpens).toBe(older.items.length);
    opens.mockClear();
    const searchStart = performance.now(), searched = await helper.page({ query: 'needle' });
    const searchMs = performance.now() - searchStart;
    expect(searched.items.every(item => item.title.startsWith('Needle '))).toBe(true);
    expect(searched.items.length).toBe(Math.min(40, Math.floor(count / 49)));
    const searchSummaryOpens = openedSummaries(opens.mock.calls).length;
    expect(searchSummaryOpens).toBe(searched.items.length);
    const warmStats = stats.mock.calls.length;
    const changed = summary(count, { title: 'Active conversation renamed', status: 'running', updatedAt: '2027-01-01T00:00:00.000Z' });
    await helper.upsert(changed);
    opens.mockClear(); stats.mockClear();
    const activeStart = performance.now(), active = await helper.page();
    const activeMs = performance.now() - activeStart;
    expect(active.items[0]).toEqual(changed);
    const activeReads = openedSummaries(opens.mock.calls);
    expect(activeReads.length).toBeGreaterThanOrEqual(active.items.length);
    expect(activeReads.length).toBeLessThanOrEqual(active.items.length + 1);
    expect(new Set(activeReads.map(call => String(call[0])))).toEqual(new Set(active.items.map(item => file(`thread-summary-${item.id}`))));
    expect(opens.mock.calls.some(call => /\/thread-thr_|\/thread-index\.json$/.test(String(call[0])))).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(active))).toBeLessThan(THREAD_LIST_LIMITS.pageBytes);
    if (process.env.CODEX_THREAD_PAGE_TEST_ROOT) {
      console.info(JSON.stringify({ benchmark: 'thread-pages-native', storageRoot: path.resolve(process.env.CODEX_THREAD_PAGE_TEST_ROOT),
        settledForMs: 2_100, records: count, fixtureMs: coldStart - prepared,
        coldMs, warmMs, searchMs, activeMs, warmSummaryOpens, searchSummaryOpens, activeSummaryOpens: activeReads.length,
        warmAndSearchMetadataStats: warmStats, responseBytes: Buffer.byteLength(JSON.stringify(active)) }));
    }
  }, 180_000);

  it('observes external creation, same-size in-place edits, unsafe replacements and deletion independently of the aggregate', async () => {
    await put(summary(1, { title: 'Before' })); await put(summary(2)); settle();
    const reader = new ThreadIndex(contexts[0]);
    await reader.page();
    const originalDirectory = await fs.stat(stateDir, { bigint: true });
    const originalSummary = await fs.readFile(file(`thread-summary-${id(1)}`), 'utf8');
    await fs.writeFile(file(`thread-summary-${id(1)}`), originalSummary.replace('"Before"', '"Edited"'));
    expect((await fs.stat(file(`thread-summary-${id(1)}`))).size).toBe(Buffer.byteLength(originalSummary));
    expect((await fs.stat(stateDir, { bigint: true })).mtimeNs).toBe(originalDirectory.mtimeNs);
    expect(ids(await reader.page({ query: 'edited', selectedId: id(1) }))).toEqual([id(1)]);
    await put(summary(3), 1);
    await contexts[1].store.write('thread-index', []);
    expect(ids(await reader.page())).toEqual([id(1), id(2), id(3)]);
    const foreign = path.join(directory, 'foreign-summary.json');
    await fs.writeFile(foreign, JSON.stringify({ version: 1, summary: summary(2, { title: 'FOREIGN_DATA' }) }));
    await fs.unlink(file(`thread-summary-${id(2)}`)); await fs.symlink(foreign, file(`thread-summary-${id(2)}`));
    const opens = vi.spyOn(fs, 'open');
    expect(ids(await reader.page())).toEqual([id(1), id(3)]);
    expect(opens.mock.calls.map(call => String(call[0]))).not.toContain(foreign);
    const writer = new ThreadIndex(contexts[1]);
    await writer.markDeleted(id(1));
    await put(summary(1, { updatedAt: '2030-01-01T00:00:00.000Z' }), 1);
    expect(ids(await reader.page({ selectedId: id(1) }))).toEqual([id(3)]);
    expect((await reader.page({ selectedId: id(1) })).selected).toBeUndefined();
    expect(ids(await new ThreadIndex(contexts[2]).page())).toEqual([id(3)]);
  });

  it('reads visible and selected canonical bytes when same-size edits preserve every stat fingerprint field', async () => {
    await put(summary(1, { title: 'Before' })); await put(summary(2, { title: 'Before' }));
    // Use real wall time to admit a genuinely settled snapshot. The collision
    // below is deliberate filesystem metadata behavior, not a future Date.now.
    await new Promise(resolve => setTimeout(resolve, 2_100));
    let monotonic = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    const reader = new ThreadIndex(contexts[0]); await reader.page({ limit: 1, selectedId: id(2) });
    const names = [file(`thread-summary-${id(1)}`), file(`thread-summary-${id(2)}`)];
    const originals = new Map(await Promise.all(names.map(async name => [name, await fs.lstat(name, { bigint: true })] as const)));
    const stat = fs.lstat.bind(fs), open = fs.open.bind(fs);
    const unchangedTimes = (current: BigIntStats, original: BigIntStats) => Object.assign(current, {
      mtimeNs: original.mtimeNs, ctimeNs: original.ctimeNs, mtimeMs: original.mtimeMs, ctimeMs: original.ctimeMs,
      mtime: original.mtime, ctime: original.ctime,
    });
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const current = await stat(...args), original = originals.get(String(args[0]));
      return original && 'mtimeNs' in current ? unchangedTimes(current as BigIntStats, original) : current;
    }) as typeof fs.lstat);
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode), original = originals.get(String(filename));
      if (original) {
        const handleStat = handle.stat.bind(handle);
        vi.spyOn(handle, 'stat').mockImplementation((async (...args: Parameters<typeof handle.stat>) => {
          const current = await handleStat(...args);
          return 'mtimeNs' in current ? unchangedTimes(current as BigIntStats, original) : current;
        }) as typeof handle.stat);
      }
      return handle;
    });
    const edit = async (previous: string, next: string) => {
      for (const name of names) {
        const before = await fs.readFile(name, 'utf8'), after = before.replace(`"${previous}"`, `"${next}"`);
        expect(after).not.toBe(before); expect(Buffer.byteLength(after)).toBe(Buffer.byteLength(before));
        await fs.writeFile(name, after);
        const actual = await stat(name, { bigint: true }), original = originals.get(name)!;
        expect(actual.ino).toBe(original.ino); expect(actual.size).toBe(original.size);
        const exposed = await fs.lstat(name, { bigint: true });
        expect([exposed.dev, exposed.ino, exposed.size, exposed.mtimeNs, exposed.ctimeNs])
          .toEqual([original.dev, original.ino, original.size, original.mtimeNs, original.ctimeNs]);
      }
    };
    await edit('Before', 'Edited');
    const warm = await reader.page({ limit: 1, selectedId: id(2) });
    expect(warm.items.map(item => item.title)).toEqual(['Edited']); expect(warm.selected?.title).toBe('Edited');
    await edit('Edited', 'Latest');
    monotonic += THREAD_LIST_LIMITS.reconcileMs + 1;
    const reconciled = await reader.page({ limit: 1, selectedId: id(2) });
    expect(reconciled.items.map(item => item.title)).toEqual(['Latest']); expect(reconciled.selected?.title).toBe('Latest');
    expect(ids(await reader.page({ query: 'latest' }))).toEqual([id(1), id(2)]);
  });

  it('repairs missing summaries within the existing recovery budget and avoids full histories on settled pages and restart', async () => {
    for (let number = 1; number <= 4; number++) await contexts[0].store.write(`thread-${id(number)}`, saved(summary(number)));
    const reader = new ThreadIndex(contexts[0], { maxRepairsPerPass: 1 });
    await reader.initialize();
    expect(reader.status().repaired).toBe(1);
    await expect(reader.page()).rejects.toMatchObject({ status: 503, code: 'THREAD_INDEX_RECOVERY_PENDING' });
    await expect(reader.page()).rejects.toMatchObject({ status: 503, code: 'THREAD_INDEX_RECOVERY_PENDING' });
    const page = await reader.page();
    expect(reader.status().repaired).toBe(4);
    settle(); await reader.page();
    const opens = vi.spyOn(fs, 'open');
    expect(ids(await reader.page())).toEqual([id(1), id(2), id(3), id(4)]);
    expect(openedSummaries(opens.mock.calls)).toHaveLength(4);
    await new ThreadIndex(contexts[1]).page();
    expect(opens.mock.calls.filter(call => /\/thread-thr_[a-f0-9]{32}\.json$/.test(String(call[0])))).toEqual([]);
    await contexts[1].store.delete(`thread-summary-${id(2)}`);
    expect(ids(await reader.page())).toContain(id(2));
    expect(reader.status().repaired).toBe(5);
    expect(JSON.stringify(page)).not.toContain('PRIVATE_FULL_HISTORY');
    expect(await contexts[0].store.read(`thread-${id(2)}`, null)).toEqual(saved(summary(2)));
  });

  it('bounds off-screen external staleness while validating visible and selected rows without an all-record stat sweep', async () => {
    for (let number = 1; number <= 120; number++) await put(summary(number));
    settle();
    let now = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const reader = new ThreadIndex(contexts[0]); await reader.page();
    await put(summary(100, { title: 'External needle' }), 1);
    const stats = vi.spyOn(fs, 'lstat'), opens = vi.spyOn(fs, 'open');
    expect((await reader.page({ query: 'needle' })).items).toEqual([]);
    expect(opens).not.toHaveBeenCalled();
    expect(stats.mock.calls.length).toBeLessThan(20);
    now += THREAD_LIST_LIMITS.reconcileMs + 1;
    expect(ids(await reader.page({ query: 'needle' }))).toEqual([id(100)]);
    const refreshed = openedSummaries(opens.mock.calls);
    expect(refreshed.length).toBeGreaterThanOrEqual(1); expect(refreshed.length).toBeLessThanOrEqual(2);
    expect(refreshed.every(call => String(call[0]) === file(`thread-summary-${id(100)}`))).toBe(true);
    await put(summary(1, { title: 'External visible title' }), 1);
    opens.mockClear(); stats.mockClear();
    expect((await reader.page({ limit: 1 })).items[0].title).toBe('External visible title');
    expect(stats.mock.calls.length).toBeLessThan(20);
    expect(openedSummaries(opens.mock.calls)).toHaveLength(1);
    await reader.upsert(summary(120, { title: 'Own immediate update' }));
    opens.mockClear(); stats.mockClear();
    expect(ids(await reader.page({ query: 'immediate' }))).toEqual([id(120)]);
    expect(stats.mock.calls.length).toBeLessThan(20);
    expect(openedSummaries(opens.mock.calls)).toHaveLength(1);
    await put(summary(110, { title: 'Selected external update' }), 1);
    expect((await reader.page({ query: 'absent', selectedId: id(110) })).selected?.title).toBe('Selected external update');
  });

  it('does not reuse a recent timestamp identity during off-screen reconciliation until a settled read occurs', async () => {
    await put(summary(1));
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let monotonic = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    const reader = new ThreadIndex(contexts[0]); await reader.page({ query: 'not present' });
    const opens = vi.spyOn(fs, 'open');
    monotonic += THREAD_LIST_LIMITS.reconcileMs + 1;
    await reader.page({ query: 'not present' });
    expect(openedSummaries(opens.mock.calls)).toHaveLength(1);
    opens.mockClear(); now += 3_000; monotonic += THREAD_LIST_LIMITS.reconcileMs + 1;
    await reader.page({ query: 'not present' });
    expect(openedSummaries(opens.mock.calls)).toHaveLength(1);
    opens.mockClear(); monotonic += THREAD_LIST_LIMITS.reconcileMs + 1;
    await reader.page({ query: 'not present' });
    expect(opens).not.toHaveBeenCalled();
  });

  it('keeps internal list reads strict when they overlap a warm browser page', async () => {
    await put(summary(1)); await put(summary(2)); settle();
    const reader = new ThreadIndex(contexts[0]); await reader.page();
    await put(summary(2, { title: 'External off-screen edit' }), 1);
    const open = fs.opendir.bind(fs);
    let reached!: () => void, release!: () => void, held = false;
    const waiting = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs, 'opendir').mockImplementation(async (location, options) => {
      if (!held && String(location) === stateDir) { held = true; reached(); await gate; }
      return open(location, options);
    });
    const browser = reader.page({ limit: 1 });
    await waiting;
    const internal = reader.list(); release();
    expect(ids(await browser)).toEqual([id(1)]);
    expect((await internal)[1].title).toBe('External off-screen edit');
  });

  it('does not overwrite a completed local rename with a scan that began before its save', async () => {
    await put(summary(1)); settle();
    const reader = new ThreadIndex(contexts[0]); await reader.page();
    await put(summary(1, { title: 'External intermediate title' }), 1);
    const open = fs.open.bind(fs);
    let reached!: () => void, release!: () => void, held = false;
    const waiting = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode);
      if (!held && String(filename) === file(`thread-summary-${id(1)}`)) {
        held = true; const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); reached(); await gate; });
      }
      return handle;
    });
    const pending = reader.page(), renamed = summary(1, { title: 'User completed rename', updatedAt: '2027-01-01T00:00:00.000Z' });
    try { await waiting; await reader.upsert(renamed); } finally { release(); }
    expect((await pending).items).toEqual([renamed]);
    expect((await reader.page()).items).toEqual([renamed]);
  });

  it('preserves a same-timestamp summary published while a missing-summary recovery is reading its full record', async () => {
    await contexts[0].store.write(`thread-${id(1)}`, saved(summary(1)));
    const reader = new ThreadIndex(contexts[0]), open = fs.open.bind(fs);
    let reached!: () => void, release!: () => void, held = false;
    const waiting = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode);
      if (!held && String(filename) === file(`thread-${id(1)}`)) {
        held = true; const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); reached(); await gate; });
      }
      return handle;
    });
    const pending = reader.page(), renamed = summary(1, { title: 'Completed rename with a tied clock' });
    try { await waiting; await reader.upsert(renamed); } finally { release(); }
    expect((await pending).items).toEqual([renamed]);
    expect(await contexts[0].store.read(`thread-summary-${id(1)}`, null)).toMatchObject({ summary: renamed });
    expect((await new ThreadIndex(contexts[1]).page()).items).toEqual([renamed]);
  });

  it('suppresses a marker committed during visible-summary validation, including a late stale summary write', async () => {
    const original = summary(1); await put(original); settle();
    const reader = new ThreadIndex(contexts[0]), writer = new ThreadIndex(contexts[1]); await reader.page();
    const stat = fs.lstat.bind(fs); let interleaved = false;
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const value = await stat(...args);
      if (!interleaved && String(args[0]) === file(`thread-summary-${id(1)}`)) {
        interleaved = true; await writer.markDeleted(id(1)); await put(original, 1);
      }
      return value;
    }) as typeof fs.lstat);
    expect(await reader.page({ selectedId: id(1) })).toMatchObject({ items: [], hasOlder: false, hasNewer: false });
    expect((await reader.page({ selectedId: id(1) })).selected).toBeUndefined();
    expect(interleaved).toBe(true);
    expect(await reader.isDeleted(id(1))).toBe(true);
  });

  it('drains overlapping reads after storage failure so they cannot publish behind a completed rename', async () => {
    await put(summary(1)); await put(summary(2)); settle();
    const reader = new ThreadIndex(contexts[0]); await reader.page();
    await put(summary(2, { title: 'External intermediate title' }), 1);
    const stat = fs.lstat.bind(fs), open = fs.open.bind(fs);
    let failedOnce = false, reached!: () => void, release!: () => void, held = false, settled = false;
    const waiting = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      if (!failedOnce && String(args[0]) === file(`thread-summary-${id(1)}`)) {
        failedOnce = true; throw Object.assign(new Error('private storage failure'), { code: 'EIO' });
      }
      return stat(...args);
    }) as typeof fs.lstat);
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode);
      if (!held && String(filename) === file(`thread-summary-${id(2)}`)) {
        held = true; const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); reached(); await gate; });
      }
      return handle;
    });
    const pending = reader.page().then(value => { settled = true; return value; }, error => { settled = true; return error; });
    const latest = summary(2, { title: 'Completed local rename' });
    try { await waiting; expect(settled).toBe(false); await reader.upsert(latest); }
    finally { release(); }
    expect(await pending).toMatchObject({ status: 503, code: 'THREAD_INDEX_STORAGE' });
    expect((await reader.page()).items.find(item => item.id === id(2))).toEqual(latest);
  });

  it('rejects incomplete scans and oversized caches visibly while leaving internal lists and source records available', async () => {
    await put(summary(1)); await put(summary(2));
    const limited = new ThreadIndex(contexts[0], { maxPageMetadataBytes: 1 });
    await expect(limited.page()).rejects.toMatchObject({ status: 503, code: 'THREAD_INDEX_CAPACITY' });
    expect(await limited.list()).toEqual([summary(1), summary(2)]);
    expect(await contexts[0].store.read(`thread-summary-${id(1)}`, null)).toEqual({ version: 1, summary: summary(1) });
    await expect(new ThreadIndex(contexts[1], { maxDirectoryEntries: 1 }).page()).rejects.toMatchObject({ status: 503, code: 'THREAD_INDEX_SCAN_LIMIT' });
  });

  it('fails closed when the final namespace cannot be read instead of serving a previously cached page', async () => {
    await put(summary(1)); settle();
    const reader = new ThreadIndex(contexts[0]); await reader.page();
    const open = fs.opendir.bind(fs); let scans = 0;
    vi.spyOn(fs, 'opendir').mockImplementation(async (location, options) => {
      if (String(location) === stateDir && ++scans === 1) throw Object.assign(new Error('private filesystem detail'), { code: 'EIO' });
      return open(location, options);
    });
    await expect(reader.page()).rejects.toMatchObject({ status: 503, code: 'THREAD_INDEX_STORAGE' });
  });

  it('rejects invalid requests before filesystem work begins', async () => {
    const reader = new ThreadIndex(contexts[0]), open = vi.spyOn(fs, 'opendir');
    await expect(reader.page({ query: 'x'.repeat(201) })).rejects.toMatchObject({ status: 400 });
    await expect(reader.page({ before: 'forged' })).rejects.toMatchObject({ status: 400 });
    expect(open).not.toHaveBeenCalled();
  });
});
