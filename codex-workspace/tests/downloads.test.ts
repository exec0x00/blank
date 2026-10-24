import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createReadStream, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import compression from 'compression';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { AuthService } from '../server/auth';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { createDownloadRouter, initializeDownloads } from '../server/downloads';
import { DownloadService, type DownloadServiceOptions } from '../server/downloads/service';
import { DOWNLOAD_RETENTION_MS, PUBLIC_DOWNLOAD_BUCKET } from '../server/downloads/bucket';
import { openDownloadSource, snapshotDownloadSource, SNAPSHOT_CHUNK_BYTES } from '../server/downloads/snapshot';
import type { BucketObject, DownloadBucket, DownloadJob, DownloadJobState } from '../server/downloads/types';

const SYNTHETIC_TOKEN = 'hf_TEST_ONLY_download_token_not_a_real_credential';
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function withAbort(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(() => { signal.removeEventListener('abort', abort); resolve(); }, reject);
  });
}

class MemoryBucket implements DownloadBucket {
  readonly id = PUBLIC_DOWNLOAD_BUCKET;
  readonly objects = new Map<string, BucketObject & { bytes?: Buffer; digest?: string; mtime?: string }>();
  readonly deletions: string[][] = [];
  readonly failures = new Set<string>();
  listCalls = 0;
  uploads = 0;
  publications = 0;
  listing = false;
  deleteWhileListing = false;
  failList = false;
  uploadGate?: ReturnType<typeof gate>;
  listGate?: ReturnType<typeof gate>;
  afterListed?: (object: BucketObject, index: number) => Promise<void> | void;
  constructor(private readonly now: () => number) {}
  add(objectPath: string, bytes: Buffer | string, timestamp = this.now()) {
    const content = Buffer.from(bytes);
    this.objects.set(objectPath, { path: objectPath, type: 'file', size: content.length, uploadedAt: new Date(timestamp).toISOString(), xetHash: hash(content), bytes: content, digest: hash(content) });
  }
  async *list(signal: AbortSignal): AsyncIterable<BucketObject> {
    this.listCalls++;
    if (this.failList) throw new Error(`Upstream failed with bearer ${SYNTHETIC_TOKEN}`);
    if (this.listGate) await withAbort(this.listGate.promise, signal);
    const snapshot = [...this.objects.values()].map(object => ({ ...object }));
    this.listing = true;
    try {
      for (let index = 0; index < snapshot.length; index++) {
        signal.throwIfAborted();
        yield snapshot[index];
        await this.afterListed?.(snapshot[index], index);
      }
    } finally { this.listing = false; }
  }
  async get(objectPath: string, signal: AbortSignal): Promise<BucketObject | undefined> {
    signal.throwIfAborted();
    const item = this.objects.get(objectPath);
    return item ? { ...item } : undefined;
  }
  async getMany(objectPaths: string[], signal: AbortSignal): Promise<BucketObject[]> {
    const objects = await Promise.all(objectPaths.map(item => this.get(item, signal)));
    return objects.filter((object): object is BucketObject => !!object);
  }
  async upload(input: Parameters<DownloadBucket['upload']>[0]): Promise<BucketObject> {
    this.uploads++;
    const chunks: Buffer[] = [];
    const digest = createHash('sha256');
    let total = 0;
    for await (const chunk of createReadStream(input.snapshotPath, { highWaterMark: 64 * 1024 })) {
      input.signal.throwIfAborted();
      const bytes = chunk as Buffer;
      digest.update(bytes); total += bytes.length;
      if (input.size < 1024 * 1024) chunks.push(bytes);
      input.onProgress(total);
    }
    if (this.uploadGate) await withAbort(this.uploadGate.promise, input.signal);
    await input.beforePublish?.();
    input.signal.throwIfAborted();
    const version = digest.digest('hex');
    const result = {
      path: input.objectPath, type: 'file' as const, size: total, uploadedAt: new Date(this.now()).toISOString(), xetHash: version,
      digest: version, ...(input.size < 1024 * 1024 ? { bytes: Buffer.concat(chunks) } : {}),
    };
    this.publications++;
    this.objects.set(result.path, result);
    return result;
  }
  async delete(objectPaths: string[], signal: AbortSignal) {
    signal.throwIfAborted();
    this.deleteWhileListing ||= this.listing;
    this.deletions.push([...objectPaths]);
    const failed = objectPaths.filter(item => this.failures.has(item));
    const deleted = objectPaths.filter(item => !this.failures.has(item));
    for (const item of deleted) this.objects.delete(item);
    return { deleted, failed };
  }
}

let directory: string;
let ctx: AppContext;
let workspaceId: string;
let workspacePath: string;
let now: number;
let bucket: MemoryBucket;
const services: DownloadService[] = [];
const servers: Server[] = [];

function context(dataDir: string): AppContext {
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, WORKSPACE_PASSWORD: 'test-download-password', SESSION_SECRET: 'download-test-session-key-32-characters-long', ENCRYPTION_KEY: 'download-test-encryption-key-32-characters', HF_DOWNLOAD_BUCKET: PUBLIC_DOWNLOAD_BUCKET, HF_DOWNLOAD_TOKEN: SYNTHETIC_TOKEN });
  const store = new JsonStore(config.stateDir);
  return {
    config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter().setMaxListeners(100),
    workspaces: new WorkspaceService(config, store), settings: async () => ({ ...defaultSettings }),
    saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined,
  };
}

async function service(options: DownloadServiceOptions = {}, selectedContext = ctx): Promise<DownloadService> {
  const result = new DownloadService(selectedContext, { bucket, now: () => now, startupAttempts: 1, ...options });
  services.push(result);
  await result.initialize();
  return result;
}

function waitForJob(downloads: DownloadService, id: string, states: DownloadJobState[] = ['ready', 'failed', 'cancelled', 'expired']): Promise<DownloadJob> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    const timeout = setTimeout(() => { unsubscribe?.(); reject(new Error('Download did not reach the expected state.')); }, 10_000);
    unsubscribe = downloads.subscribe(id, job => {
      if (states.includes(job.state)) queueMicrotask(() => { clearTimeout(timeout); unsubscribe?.(); resolve(job); });
    });
  });
}

async function prepareFile(downloads: DownloadService, filePath = 'sample.txt', content: Buffer | string = 'sample') {
  await fs.writeFile(path.join(workspacePath, filePath), content);
  const job = await downloads.prepare(workspaceId, { path: filePath, expectedVersion: hash(content) });
  return waitForJob(downloads, job.id);
}

beforeEach(async () => {
  now = Date.now();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-download-tests-'));
  ctx = context(directory);
  await ctx.workspaces.initialize();
  const workspace = await ctx.workspaces.create({ name: 'Download tests' });
  workspaceId = workspace.id; workspacePath = workspace.path;
  bucket = new MemoryBucket(() => now);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await Promise.allSettled(services.splice(0).map(item => item.close()));
  vi.useRealTimers();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('public bucket file delivery', () => {
  it('prepares only clicked files, preserves binary bytes/Unicode names, and stores ordinary durable metadata without credentials', async () => {
    const downloads = await service();
    expect(bucket.uploads).toBe(0);
    const bytes = Buffer.from([0, 255, 17, 9, 128, 2]);
    const job = await prepareFile(downloads, 'rapport é 文.bin', bytes);
    expect(job).toMatchObject({ state: 'ready', fileName: 'rapport é 文.bin', mimeType: 'application/octet-stream', size: bytes.length, version: hash(bytes), bytesProcessed: bytes.length });
    expect(job.url).toBe(`https://huggingface.co/buckets/${PUBLIC_DOWNLOAD_BUCKET}/resolve/exports/${job.id}/rapport%20%C3%A9%20%E6%96%87.bin?download=true`);
    expect([...bucket.objects.values()][0].bytes).toEqual(bytes);
    expect(await fs.readFile(path.join(workspacePath, job.path))).toEqual(bytes);
    const saved = await fs.readFile(path.join(ctx.config.stateDir, 'download-jobs-v1.json'), 'utf8');
    expect(saved).toContain('rapport é 文.bin');
    expect(saved).toContain(hash(bytes));
    expect(saved).not.toContain(SYNTHETIC_TOKEN);
    expect(JSON.stringify(job)).not.toMatch(/remoteHash|objectPath|expectedVersion|snapshotPath|accessToken/);
  });

  it('returns a queued job without waiting for upload and streams real preparation progress', async () => {
    bucket.uploadGate = gate();
    const downloads = await service();
    await fs.writeFile(path.join(workspacePath, 'large.bin'), Buffer.alloc(2 * 1024 * 1024, 37));
    const job = await downloads.prepare(workspaceId, { path: 'large.bin' });
    expect(job.state).toBe('queued');
    expect(bucket.publications).toBe(0);
    const states: DownloadJob[] = [];
    const unsubscribe = downloads.subscribe(job.id, value => states.push(value));
    await waitForJob(downloads, job.id, ['uploading']);
    expect((await downloads.get(job.id)).url).toBeUndefined();
    const completion = waitForJob(downloads, job.id);
    bucket.uploadGate.resolve();
    expect((await completion).state).toBe('ready');
    unsubscribe();
    expect(states.some(item => item.state === 'snapshotting' && item.bytesProcessed > 0)).toBe(true);
    expect(states.some(item => item.state === 'uploading' && item.bytesProcessed > 0)).toBe(true);
  });

  it('reuses identical captured bytes without extending original expiry, and uploads changed versions', async () => {
    const downloads = await service();
    const first = await prepareFile(downloads, 'cache.txt', 'first bytes');
    now += 60_000;
    const repeated = await downloads.prepare(workspaceId, { path: 'cache.txt' });
    const second = await waitForJob(downloads, repeated.id);
    expect(second.url).toBe(first.url);
    expect(second.expiresAt).toBe(first.expiresAt);
    expect(second.uploadedAt).toBe(first.uploadedAt);
    expect(bucket.uploads).toBe(1);
    const third = await prepareFile(downloads, 'cache.txt', 'other bytes');
    expect(third.version).not.toBe(first.version);
    expect(third.url).not.toBe(first.url);
    expect(bucket.uploads).toBe(2);
  });

  it('never reuses a same-size remote replacement as the original content', async () => {
    const downloads = await service();
    const first = await prepareFile(downloads, 'immutable.txt', 'AAA');
    const remotePath = [...bucket.objects.keys()][0];
    now += 1000;
    bucket.add(remotePath, 'BBB');
    await downloads.cleanup();
    expect((await downloads.get(first.id)).state).toBe('expired');
    const next = await downloads.prepare(workspaceId, { path: 'immutable.txt' });
    const ready = await waitForJob(downloads, next.id);
    expect(ready.url).not.toBe(first.url);
    expect(bucket.uploads).toBe(2);
    expect(bucket.objects.get(`exports/${ready.id}/immutable.txt`)?.bytes?.toString()).toBe('AAA');
  });

  it('rejects stale editor versions before publishing and preserves the source', async () => {
    const downloads = await service();
    await fs.writeFile(path.join(workspacePath, 'edited.txt'), 'terminal edit');
    const job = await downloads.prepare(workspaceId, { path: 'edited.txt', expectedVersion: hash('editor version') });
    expect(await waitForJob(downloads, job.id)).toMatchObject({ state: 'failed', error: { code: 'VERSION_CONFLICT' } });
    expect(bucket.uploads).toBe(0);
    expect(await fs.readFile(path.join(workspacePath, 'edited.txt'), 'utf8')).toBe('terminal edit');
  });

  it('cancels active uploads, rejects traversal/outside links, and never treats a directory as a file', async () => {
    const downloads = await service();
    await fs.writeFile(path.join(directory, 'secret.txt'), 'outside workspace');
    await fs.symlink(directory, path.join(workspacePath, 'escape'));
    for (const selected of ['../secret.txt', '/etc/passwd', 'escape/secret.txt']) await expect(downloads.prepare(workspaceId, { path: selected })).rejects.toBeInstanceOf(HttpError);
    await expect(downloads.prepare(workspaceId, { path: '.' })).rejects.toMatchObject({ code: 'NOT_A_FILE' });
    bucket.uploadGate = gate();
    await fs.writeFile(path.join(workspacePath, 'cancel.txt'), 'keep source');
    const job = await downloads.prepare(workspaceId, { path: 'cancel.txt' });
    await waitForJob(downloads, job.id, ['uploading']);
    expect(await downloads.cancel(job.id)).toMatchObject({ state: 'cancelled', error: { code: 'DOWNLOAD_CANCELLED' } });
    bucket.uploadGate.resolve();
    await downloads.close();
    expect(bucket.publications).toBe(0);
    expect(await fs.readFile(path.join(workspacePath, 'cancel.txt'), 'utf8')).toBe('keep source');
  });

  it('keeps cached links and Git/workspace state intact after a service restart', async () => {
    const downloads = await service();
    const first = await prepareFile(downloads, 'persist.txt', 'persistent bytes');
    await ctx.store.write('unrelated-workspace-state', { githubAccountId: 'saved-account' });
    await downloads.close();
    now += 10_000;
    const restartedContext = context(directory);
    const restarted = await service({}, restartedContext);
    expect(await restarted.get(first.id)).toMatchObject({ state: 'ready', url: first.url, expiresAt: first.expiresAt });
    const second = await waitForJob(restarted, (await restarted.prepare(workspaceId, { path: 'persist.txt' })).id);
    expect(second.url).toBe(first.url);
    expect(bucket.uploads).toBe(1);
    expect(await restartedContext.store.read('unrelated-workspace-state', {})).toEqual({ githubAccountId: 'saved-account' });
  });

  it('does not enqueue a request whose durable state write completes after shutdown', async () => {
    const downloads = await service();
    await fs.writeFile(path.join(workspacePath, 'closing.txt'), 'keep');
    const entered = gate();
    const release = gate();
    const original = ctx.store.write.bind(ctx.store);
    let delayed = false;
    vi.spyOn(ctx.store, 'write').mockImplementation(async (key, value) => {
      await original(key, value);
      if (!delayed && key === 'download-jobs-v1' && JSON.stringify(value).includes('"state":"queued"')) {
        delayed = true; entered.resolve(); await release.promise;
      }
    });
    const preparing = downloads.prepare(workspaceId, { path: 'closing.txt' });
    const observed = preparing.then(() => 'unexpected success', error => error as HttpError);
    await entered.promise;
    await downloads.close();
    release.resolve();
    expect(await observed).toMatchObject({ status: 503, code: 'DOWNLOAD_CLEANUP_PENDING' });
    expect(bucket.uploads).toBe(0);
    const saved = await ctx.store.read<{ jobs: DownloadJob[] }>('download-jobs-v1', { jobs: [] });
    expect(saved.jobs).toMatchObject([{ state: 'failed', error: { code: 'DOWNLOAD_INTERRUPTED' } }]);
  });
});

describe('download retention and startup gates', () => {
  it('uses upload time, finishes every page before deletion, and deletes only expired objects from the separate bucket', async () => {
    for (let index = 0; index < 205; index++) bucket.add(`old/${index}.txt`, String(index), now - DOWNLOAD_RETENTION_MS - 1);
    bucket.add('fresh.txt', 'fresh');
    bucket.objects.get('fresh.txt')!.mtime = new Date(now - 10 * DOWNLOAD_RETENTION_MS).toISOString();
    bucket.objects.set('folder', { path: 'folder', size: 0, type: 'directory' });
    const downloads = await service();
    expect(downloads.status()).toMatchObject({ ready: true, state: 'ready' });
    expect(bucket.deletions.map(batch => batch.length)).toEqual([100, 100, 5]);
    expect(bucket.deleteWhileListing).toBe(false);
    expect([...bucket.objects.keys()].sort()).toEqual(['folder', 'fresh.txt']);
    expect(await fs.readFile(path.join(workspacePath, 'README.md'), 'utf8').catch(() => 'workspace still exists')).toBe('workspace still exists');
    expect((await ctx.workspaces.get(workspaceId)).id).toBe(workspaceId);
  });

  it('keeps unknown timestamps, reports cleanup failure, and does not publish while the first scan is unfinished', async () => {
    bucket.listGate = gate();
    bucket.objects.set('unknown.txt', { path: 'unknown.txt', type: 'file', size: 3 });
    bucket.add('future.txt', 'future', now + DOWNLOAD_RETENTION_MS);
    const downloads = new DownloadService(ctx, { bucket, now: () => now, startupAttempts: 1 });
    services.push(downloads);
    const initializing = downloads.initialize();
    await expect(downloads.prepare(workspaceId, { path: 'file.txt' })).rejects.toMatchObject({ status: 503 });
    expect(downloads.status().ready).toBe(false);
    bucket.listGate.resolve();
    await initializing;
    expect(downloads.status()).toMatchObject({ ready: false, state: 'error', unknownTimestampCount: 2, error: { code: 'DOWNLOAD_TIMESTAMP_UNKNOWN' } });
    expect(bucket.deletions).toEqual([]);
    expect(bucket.objects.has('unknown.txt')).toBe(true);
    expect(bucket.objects.has('future.txt')).toBe(true);
    await expect(downloads.prepare(workspaceId, { path: 'README.md' })).rejects.toMatchObject({ code: 'DOWNLOAD_CLEANUP_PENDING' });
  });

  it('retains partial-deletion failures for an idempotent retry and does not expose upstream secrets', async () => {
    bucket.add('expired-one.txt', 'one', now - DOWNLOAD_RETENTION_MS - 1);
    bucket.add('expired-two.txt', 'two', now - DOWNLOAD_RETENTION_MS - 1);
    bucket.failures.add('expired-two.txt');
    const downloads = await service();
    expect(downloads.status()).toMatchObject({ ready: false, error: { code: 'DOWNLOAD_CLEANUP_FAILED' } });
    expect(bucket.objects.has('expired-one.txt')).toBe(false);
    expect(bucket.objects.has('expired-two.txt')).toBe(true);
    bucket.failures.clear();
    expect((await downloads.cleanup()).ready).toBe(true);
    expect(bucket.deletions[1]).toEqual(['expired-two.txt']);
    bucket.failList = true;
    expect((await downloads.cleanup()).ready).toBe(false);
    expect(JSON.stringify(downloads.status())).not.toContain(SYNTHETIC_TOKEN);
  });

  it('rechecks objects refreshed during listing and preserves the new upload', async () => {
    bucket.add('refresh.txt', 'old', now - DOWNLOAD_RETENTION_MS - 1);
    bucket.add('other.txt', 'also old', now - DOWNLOAD_RETENTION_MS - 1);
    bucket.afterListed = object => { if (object.path === 'refresh.txt') bucket.add('refresh.txt', 'fresh'); };
    const downloads = await service();
    expect(downloads.status().ready).toBe(true);
    expect(bucket.objects.get('refresh.txt')?.bytes?.toString()).toBe('fresh');
    expect(bucket.objects.has('other.txt')).toBe(false);
    expect(bucket.deletions.flat()).toEqual(['other.txt']);
  });

  it('does not publish an in-flight upload after cleanup fails and resumes queued jobs after recovery', async () => {
    bucket.uploadGate = gate();
    const downloads = await service();
    await fs.writeFile(path.join(workspacePath, 'one.txt'), 'one');
    await fs.writeFile(path.join(workspacePath, 'two.txt'), 'two');
    const first = await downloads.prepare(workspaceId, { path: 'one.txt' });
    await waitForJob(downloads, first.id, ['uploading']);
    const second = await downloads.prepare(workspaceId, { path: 'two.txt' });
    bucket.failList = true;
    await downloads.cleanup();
    bucket.uploadGate.resolve();
    expect(await waitForJob(downloads, first.id)).toMatchObject({ state: 'failed', error: { code: 'DOWNLOAD_CLEANUP_FAILED' } });
    expect(bucket.publications).toBe(0);
    expect((await downloads.get(second.id)).state).toBe('queued');
    bucket.failList = false;
    await downloads.cleanup();
    expect((await waitForJob(downloads, second.id)).state).toBe('ready');
    expect(bucket.publications).toBe(1);
  });

  it('expires links, catches missed expiries before restart readiness, and preserves source files', async () => {
    const downloads = await service();
    const first = await prepareFile(downloads, 'retained.txt', 'permanent workspace file');
    await downloads.close();
    now += DOWNLOAD_RETENTION_MS + 1;
    const restarted = await service({}, context(directory));
    expect(bucket.objects.size).toBe(0);
    expect(await restarted.get(first.id)).toMatchObject({ state: 'expired', error: { code: 'DOWNLOAD_EXPIRED' } });
    expect((await restarted.get(first.id)).url).toBeUndefined();
    expect(await fs.readFile(path.join(workspacePath, 'retained.txt'), 'utf8')).toBe('permanent workspace file');
    expect(restarted.status().ready).toBe(true);
  });

  it('schedules individual object expiry while the process remains running', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const downloads = await service({ cleanupIntervalMs: 2 * DOWNLOAD_RETENTION_MS });
    const ready = await prepareFile(downloads, 'timer.txt', 'expires by timer');
    const passes = bucket.listCalls;
    now += DOWNLOAD_RETENTION_MS + 1;
    await vi.advanceTimersByTimeAsync(DOWNLOAD_RETENTION_MS + 1);
    expect(downloads.status().state === 'checking' || bucket.listCalls > passes).toBe(true);
    await downloads.cleanup();
    expect(bucket.objects.size).toBe(0);
    expect((await downloads.get(ready.id)).state).toBe('expired');
  });

  it('does not postpone periodic cleanup when more jobs finish', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const downloads = await service({ cleanupIntervalMs: 1000 });
    const passes = bucket.listCalls;
    now += 600;
    await vi.advanceTimersByTimeAsync(600);
    await prepareFile(downloads, 'mid-cycle.txt', 'finished during interval');
    now += 401;
    await vi.advanceTimersByTimeAsync(401);
    expect(downloads.status().state === 'checking' || bucket.listCalls > passes).toBe(true);
    await downloads.cleanup();
    expect(bucket.listCalls).toBeGreaterThan(passes);
  });

  it('finishes startup with unavailable download state on a storage error, then recovers transient write failures', async () => {
    const savedWrite = ctx.store.write.bind(ctx.store);
    const failing = vi.spyOn(ctx.store, 'write').mockRejectedValue(new Error('storage unavailable'));
    const downloads = await service();
    expect(downloads.status()).toMatchObject({ ready: false, state: 'error', error: { code: 'DOWNLOAD_STATE_ERROR' } });
    failing.mockImplementation(savedWrite);
    expect((await downloads.cleanup()).ready).toBe(true);
    expect((await prepareFile(downloads)).state).toBe('ready');
  });

  it('does not overwrite an unreadable prior download state during initialization or shutdown', async () => {
    const location = path.join(ctx.config.stateDir, 'download-jobs-v1.json');
    const invalid = '{ a broken state that must be preserved';
    await fs.mkdir(ctx.config.stateDir, { recursive: true });
    await fs.writeFile(location, invalid);
    const downloads = await service();
    expect(downloads.status()).toMatchObject({ ready: false, error: { code: 'DOWNLOAD_STATE_ERROR' } });
    await downloads.close();
    expect(await fs.readFile(location, 'utf8')).toBe(invalid);
    expect(bucket.publications).toBe(0);
  });

  it('recovers interrupted jobs as visible failures without automatically exporting changed files', async () => {
    const downloads = await service();
    const ready = await prepareFile(downloads, 'interrupted.txt', 'previous bytes');
    await downloads.close();
    const saved = await ctx.store.read<{ format: 1; jobs: Record<string, unknown>[] }>('download-jobs-v1', { format: 1, jobs: [] });
    saved.jobs[0].state = 'uploading';
    delete saved.jobs[0].uploadedAt; delete saved.jobs[0].expiresAt;
    await ctx.store.write('download-jobs-v1', saved);
    await fs.writeFile(path.join(workspacePath, 'interrupted.txt'), 'new terminal bytes');
    const restarted = await service({}, context(directory));
    expect(await restarted.get(ready.id)).toMatchObject({ state: 'failed', error: { code: 'DOWNLOAD_INTERRUPTED' } });
    expect(bucket.uploads).toBe(1);
    expect(await fs.readFile(path.join(workspacePath, 'interrupted.txt'), 'utf8')).toBe('new terminal bytes');
  });

  it('refuses a data-bucket configuration before making any network request', async () => {
    const unsafeContext = context(directory);
    unsafeContext.config.downloadBucket = 'alvin3y12/data';
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not be called.'));
    const downloads = new DownloadService(unsafeContext);
    services.push(downloads);
    await downloads.initialize();
    expect(downloads.status()).toMatchObject({ enabled: false, ready: false, state: 'error', error: { code: 'DOWNLOAD_BUCKET_UNSAFE' } });
    expect(network).not.toHaveBeenCalled();
  });
});

describe('bounded descriptor-bound source snapshots', () => {
  it('rejects a parent directory swapped to an outside symlink after workspace validation', async () => {
    await fs.mkdir(path.join(workspacePath, 'folder'));
    await fs.writeFile(path.join(workspacePath, 'folder/file.txt'), 'safe');
    const outside = path.join(directory, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'file.txt'), 'application secret');
    const original = ctx.workspaces.resolvePath.bind(ctx.workspaces);
    vi.spyOn(ctx.workspaces, 'resolvePath').mockImplementation(async (id, selected, options) => {
      const result = await original(id, selected, options);
      if (selected === 'folder/file.txt') {
        await fs.rename(path.join(workspacePath, 'folder'), path.join(workspacePath, 'previous'));
        await fs.symlink(outside, path.join(workspacePath, 'folder'));
      }
      return result;
    });
    await expect(openDownloadSource(ctx.workspaces, workspaceId, 'folder/file.txt')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await fs.readFile(path.join(outside, 'file.txt'), 'utf8')).toBe('application secret');
  });

  it('rejects source mutation and inode replacement during snapshotting, with no successful upload', async () => {
    const file = path.join(workspacePath, 'changing.bin');
    await fs.writeFile(file, Buffer.alloc(2 * SNAPSHOT_CHUNK_BYTES, 12));
    const source = await openDownloadSource(ctx.workspaces, workspaceId, 'changing.bin');
    let changed = false;
    await expect(snapshotDownloadSource({
      source, destination: path.join(directory, 'unsafe.snapshot'), signal: new AbortController().signal,
      onProgress: () => { if (!changed) { changed = true; writeFileSync(file, Buffer.alloc(2 * SNAPSHOT_CHUNK_BYTES, 29)); } },
    })).rejects.toMatchObject({ code: 'DOWNLOAD_FILE_CHANGED' });
    await expect(source.handle.stat()).rejects.toThrow();
    const opened = await openDownloadSource(ctx.workspaces, workspaceId, 'changing.bin');
    await fs.rename(file, path.join(workspacePath, 'original.bin'));
    await fs.writeFile(file, Buffer.alloc(2 * SNAPSHOT_CHUNK_BYTES, 29));
    await expect(snapshotDownloadSource({ source: opened, destination: path.join(directory, 'replaced.snapshot'), signal: new AbortController().signal })).rejects.toMatchObject({ code: 'DOWNLOAD_FILE_CHANGED' });
    expect(bucket.uploads).toBe(0);
  });

  it('rejects a final file swapped to a symlink between metadata validation and descriptor open', async () => {
    const leaf = path.join(workspacePath, 'leaf.txt');
    const outside = path.join(directory, 'outside-secret.txt');
    await fs.writeFile(leaf, 'safe original'); await fs.writeFile(outside, 'protected outside file');
    const original = fs.open.bind(fs);
    let swapped = false;
    vi.spyOn(fs, 'open').mockImplementation(async (location, flags, mode) => {
      if (!swapped && typeof location === 'string' && /^\/proc\/self\/fd\/\d+\/leaf\.txt$/.test(location)) {
        swapped = true; await fs.unlink(leaf); await fs.symlink(outside, leaf);
      }
      return original(location, flags, mode);
    });
    await expect(openDownloadSource(ctx.workspaces, workspaceId, 'leaf.txt')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(swapped).toBe(true);
    expect(await fs.readFile(outside, 'utf8')).toBe('protected outside file');
  });

  it('copies a large file with bounded reads, preserves exact digest, and honors cancellation', async () => {
    const file = path.join(workspacePath, 'bounded.bin');
    const handle = await fs.open(file, 'wx');
    const expected = createHash('sha256');
    const chunk = Buffer.alloc(1024 * 1024, 17);
    for (let index = 0; index < 40; index++) { await handle.write(chunk); expected.update(chunk); }
    await handle.close();
    const source = await openDownloadSource(ctx.workspaces, workspaceId, 'bounded.bin');
    const read = vi.spyOn(source.handle, 'read');
    const captured = await snapshotDownloadSource({ source, destination: path.join(directory, 'bounded.snapshot'), signal: new AbortController().signal });
    expect(captured).toEqual({ size: 40 * 1024 * 1024, version: expected.digest('hex') });
    expect(read.mock.calls.length).toBeGreaterThan(100);
    for (const call of read.mock.calls) {
      const buffer: unknown = call[0];
      if (!Buffer.isBuffer(buffer)) throw new Error('Expected a bounded source read buffer.');
      expect(buffer.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    }
    const abort = new AbortController();
    const second = await openDownloadSource(ctx.workspaces, workspaceId, 'bounded.bin');
    await expect(snapshotDownloadSource({ source: second, destination: path.join(directory, 'cancel.snapshot'), signal: abort.signal, onProgress: () => abort.abort() })).rejects.toThrow();
    await expect(second.handle.stat()).rejects.toThrow();
  });
});

describe('authenticated asynchronous download HTTP and SSE', () => {
  it('protects prepare/status/events/cancel with the workspace password and same-origin mutation rules', async () => {
    bucket.uploadGate = gate();
    const downloads = await initializeDownloads(ctx, { bucket, now: () => now, startupAttempts: 1 });
    services.push(downloads);
    const auth = new AuthService(ctx); await auth.initialize();
    const app = express();
    // Model an intermediary that would compress any eligible event frame, even a tiny one.
    // no-transform must keep the stream uncompressed before the first event is delivered.
    app.use(compression({ threshold: 0 }));
    app.use('/api', auth.protectMutations);
    app.use('/api/session', express.json({ limit: '4kb' }));
    app.use('/api', auth.router(), auth.requireSession, express.json({ limit: '8kb' }), createDownloadRouter(ctx));
    const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
      if (error instanceof HttpError) res.status(error.status).json({ error: error.message, code: error.code });
      else res.status(500).json({ error: 'Test request failed.' });
    };
    app.use(errors);
    const server = createServer(app); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture listener.');
    const origin = `http://127.0.0.1:${address.port}`;
    const pathFor = `/api/workspaces/${workspaceId}/downloads`;
    expect((await fetch(`${origin}/api/downloads/status`)).status).toBe(401);
    const login = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' }, body: JSON.stringify({ password: ctx.config.password }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' };
    await fs.writeFile(path.join(workspacePath, 'http.txt'), 'http bytes');
    const wrongOrigin = await fetch(`${origin}${pathFor}`, { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body: JSON.stringify({ path: 'http.txt' }) });
    expect(wrongOrigin.status).toBe(403);
    const response = await fetch(`${origin}${pathFor}`, { method: 'POST', headers, body: JSON.stringify({ path: 'http.txt' }) });
    expect(response.status).toBe(202);
    const job = await response.json() as DownloadJob;
    expect(response.headers.get('location')).toBe(`/api/downloads/${job.id}`);
    expect(bucket.publications).toBe(0);
    expect((await fetch(`${origin}/api/downloads/${job.id}`)).status).toBe(401);
    expect((await fetch(`${origin}/api/downloads/${job.id}/events`)).status).toBe(401);
    const occupied = Array.from({ length: 32 }, () => downloads.subscribe(job.id, () => undefined));
    const exhausted = await fetch(`${origin}/api/downloads/${job.id}/events`, { headers: { Cookie: cookie } });
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toMatchObject({ code: 'DOWNLOAD_SUBSCRIBERS_FULL' });
    for (const unsubscribe of occupied) unsubscribe();
    const streamController = new AbortController();
    const events = await fetch(`${origin}/api/downloads/${job.id}/events`, { headers: { Cookie: cookie, 'Accept-Encoding': 'gzip, deflate, br' }, signal: streamController.signal });
    expect(events.status).toBe(200);
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    expect(events.headers.get('cache-control')).toContain('no-transform');
    expect(events.headers.get('content-encoding')).toBeNull();
    const reader = events.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: download');
    await reader.cancel(); streamController.abort();
    const stop = await fetch(`${origin}/api/downloads/${job.id}`, { method: 'DELETE', headers });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ state: 'cancelled' });
    bucket.uploadGate.resolve();
    const status = await fetch(`${origin}/api/downloads/status`, { headers: { Cookie: cookie } });
    expect(await status.json()).toMatchObject({ enabled: true, ready: true, bucket: PUBLIC_DOWNLOAD_BUCKET });
  });
});
