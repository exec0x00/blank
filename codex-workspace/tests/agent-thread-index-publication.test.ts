import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { ThreadSummary } from '../shared/types';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { ThreadIndex } from '../server/agent/thread-index';

const id = (number: number) => `thr_${number.toString(16).padStart(32, '0')}`;
const timestamp = '2026-09-20T12:00:00.000Z';
const summary = (number: number, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({ id: id(number), workspaceId: 'workspace-test',
  title: `Conversation ${number}`, status: 'idle', createdAt: timestamp, updatedAt: timestamp, ...patch });
const full = (value: ThreadSummary) => ({ thread: { ...value, messages: [] }, input: [], revision: 1 });

describe('serialized compatibility publication and lifecycle drain', () => {
  let directory: string, contexts: AppContext[];
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-index-publication-'));
    const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'index-publication-test', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
    await fs.mkdir(config.stateDir, { recursive: true });
    contexts = Array.from({ length: 3 }, () => ({ config, store: new JsonStore(config.stateDir), events: new EventEmitter() } as AppContext));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await Promise.all(contexts.map(ctx => ctx.store.flush()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const file = (key: string) => path.join(contexts[0].config.stateDir, `${key}.json`);

  it('drains a fresh index without initializing, scanning or repairing its saved records', async () => {
    const value = full(summary(1)); await contexts[0].store.write(`thread-${id(1)}`, value);
    let recovered = 0;
    const index = new ThreadIndex(contexts[0], { onReconciledRecord: () => { recovered++; } });
    const initialize = vi.spyOn(index, 'initialize'), open = vi.spyOn(fs, 'open'), inventory = vi.spyOn(fs, 'opendir');
    const write = vi.spyOn(contexts[0].store, 'write');
    await index.drain();
    expect(initialize).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(inventory).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(recovered).toBe(0); expect(index.status().repaired).toBe(0);
    expect(await contexts[1].store.read(`thread-${id(1)}`, null)).toEqual(value);
    expect(await fs.lstat(file(`thread-summary-${id(1)}`)).catch(error => error.code)).toBe('ENOENT');
  });

  it('serializes independent deletion behind a delayed list publication and leaves no deleted title in the saved cache', async () => {
    const removed = summary(1), peer = summary(2, { workspaceId: 'peer-workspace' });
    const reader = new ThreadIndex(contexts[0]), deleting = new ThreadIndex(contexts[1]);
    await reader.upsert(removed); await reader.upsert(peer); await reader.initialize();
    await contexts[0].store.write('thread-index', []);
    const write = contexts[0].store.write.bind(contexts[0].store), remove = contexts[1].store.delete.bind(contexts[1].store);
    let reached!: () => void, release!: () => void, marked!: () => void, held = false, deleted = false, drained = false;
    const arrived = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const markerCommitted = new Promise<void>(resolve => { marked = resolve; });
    vi.spyOn(contexts[0].store, 'write').mockImplementation(async (key, value) => {
      if (!held && key === 'thread-index') { held = true; reached(); await gate; }
      await write(key, value);
    });
    vi.spyOn(contexts[1].store, 'delete').mockImplementation(async key => {
      if (key === `thread-summary-${removed.id}`) marked();
      await remove(key);
    });
    const listing = reader.list();
    let removal: Promise<void> | undefined, draining: Promise<void> | undefined;
    try {
      await arrived;
      removal = deleting.markDeleted(removed.id).then(() => { deleted = true; });
      await markerCommitted;
      draining = reader.drain().then(() => { drained = true; });
      await Promise.resolve(); await Promise.resolve();
      expect(deleted).toBe(false); expect(drained).toBe(false);
    } finally { release(); }
    await Promise.all([listing, removal, draining]);
    expect(deleted).toBe(true); expect(drained).toBe(true);
    // Inspect the actual aggregate before another list could repair it.
    expect(await contexts[2].store.read('thread-index', null)).toEqual([peer]);
    expect(await listing).toEqual([peer]);
    expect(await reader.isDeleted(removed.id)).toBe(true);
  });

  it('keeps a peer creation and same-timestamp rename committed after an older list snapshot', async () => {
    const original = summary(1), renamed = summary(1, { title: 'Peer rename in the same tick' });
    const peer = summary(2, { workspaceId: 'peer-workspace', title: 'New peer conversation' });
    const reader = new ThreadIndex(contexts[0]), writer = new ThreadIndex(contexts[1]);
    await reader.upsert(original); await reader.initialize();
    const open = fs.open.bind(fs);
    let reached!: () => void, release!: () => void, held = false;
    const arrived = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode);
      if (!held && String(filename) === file(`thread-summary-${original.id}`)) {
        held = true; const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); reached(); await gate; });
      }
      return handle;
    });
    const older = reader.list();
    try { await arrived; await writer.upsert(renamed); await writer.upsert(peer); }
    finally { release(); }
    await older; await reader.drain();
    expect(await contexts[2].store.read('thread-index', null)).toEqual([renamed, peer]);
    expect(await contexts[2].store.read(`thread-summary-${original.id}`, null)).toMatchObject({ summary: renamed });
    expect(await contexts[2].store.read(`thread-summary-${peer.id}`, null)).toMatchObject({ summary: peer });
  });

  it('filters a durable marker committed outside this index while its aggregate write is pending', async () => {
    const index = new ThreadIndex(contexts[0]), removed = summary(1), peer = summary(2);
    await index.upsert(removed); await index.upsert(peer); await index.initialize();
    await contexts[0].store.write('thread-index', []);
    const write = contexts[0].store.write.bind(contexts[0].store);
    let reached!: () => void, release!: () => void, held = false;
    const arrived = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(contexts[0].store, 'write').mockImplementation(async (key, value) => {
      if (!held && key === 'thread-index') { held = true; reached(); await gate; }
      await write(key, value);
    });
    const listing = index.list();
    try {
      await arrived;
      await contexts[1].store.write(`thread-deleted-${removed.id}`, { version: 1, id: removed.id, deletedAt: timestamp });
      await contexts[1].store.delete(`thread-summary-${removed.id}`);
    } finally { release(); }
    expect(await listing).toEqual([peer]);
    expect(await contexts[2].store.read('thread-index', null)).toEqual([peer]);
  });
});
