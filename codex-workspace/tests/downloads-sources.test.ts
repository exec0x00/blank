import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { DownloadService, type DownloadServiceOptions, type DownloadSourceRequest } from '../server/downloads/service';
import { MAX_DOWNLOAD_BYTES, type DownloadSource } from '../server/downloads/snapshot';
import { DOWNLOAD_RETENTION_MS, PUBLIC_DOWNLOAD_BUCKET } from '../server/downloads/bucket';
import type { BucketObject, DownloadBucket, DownloadJob, DownloadJobState, DownloadSourceIdentity } from '../server/downloads/types';

const digest = (content: Buffer | string) => createHash('sha256').update(content).digest('hex');
const attachmentId = () => `file_${randomUUID().replaceAll('-', '')}`;
const TOKEN = 'hf_SYNTHETIC_trusted_download_test_secret';

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

class FixtureBucket implements DownloadBucket {
  readonly id = PUBLIC_DOWNLOAD_BUCKET;
  readonly objects = new Map<string, BucketObject & { bytes: Buffer }>();
  readonly snapshotPaths: string[] = [];
  readonly publications: { mimeType: string; bytes: Buffer }[] = [];
  uploadGate?: ReturnType<typeof gate>;
  constructor(private readonly now: () => number) {}
  async *list(signal: AbortSignal) { for (const item of [...this.objects.values()]) { signal.throwIfAborted(); yield { ...item }; } }
  async get(objectPath: string, signal: AbortSignal) { signal.throwIfAborted(); return this.objects.get(objectPath); }
  async upload(input: Parameters<DownloadBucket['upload']>[0]) {
    this.snapshotPaths.push(input.snapshotPath);
    const bytes = await fs.readFile(input.snapshotPath);
    input.onProgress(bytes.length);
    if (this.uploadGate) await withAbort(this.uploadGate.promise, input.signal);
    await input.beforePublish?.(); input.signal.throwIfAborted();
    const object = { path: input.objectPath, type: 'file' as const, size: bytes.length, uploadedAt: new Date(this.now()).toISOString(), xetHash: digest(bytes), bytes };
    this.publications.push({ mimeType: input.mimeType, bytes });
    this.objects.set(object.path, object);
    return object;
  }
  async delete(paths: string[], signal: AbortSignal) {
    signal.throwIfAborted(); for (const item of paths) this.objects.delete(item);
    return { deleted: paths, failed: [] };
  }
}

function makeContext(directory: string): AppContext {
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, WORKSPACE_PASSWORD: 'download-source-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
  config.downloadBucket = PUBLIC_DOWNLOAD_BUCKET; config.downloadToken = TOKEN;
  const store = new JsonStore(config.stateDir);
  return { config, store, secrets: new SecretStore(store, config.encryptionKey), workspaces: new WorkspaceService(config, store), events: new EventEmitter(),
    settings: async () => ({ ...defaultSettings }), saveSettings: async patch => ({ ...defaultSettings, ...patch }), providerKey: async () => undefined };
}

let directory: string;
let originals: string;
let workspaceId: string;
let workspacePath: string;
let ctx: AppContext;
let bucket: FixtureBucket;
let now: number;
const services: DownloadService[] = [];
const openedSources: DownloadSource[] = [];

async function sourceFixture(bytes: Buffer | string, overrides: Partial<DownloadSourceRequest> = {}) {
  const content = Buffer.from(bytes);
  const name = `${randomUUID()}.blob`;
  const location = path.join(originals, name);
  await fs.writeFile(location, content, { mode: 0o600, flag: 'wx' });
  const parent = await fs.open(originals, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const handle = await fs.open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const stat = await handle.stat({ bigint: true });
  let closed = false;
  const source: DownloadSource = {
    parent, handle, name, stat, size: content.length,
    async close() { if (closed) return; closed = true; await Promise.allSettled([parent.close(), handle.close()]); },
  };
  openedSources.push(source);
  const sourceIdentity: DownloadSourceIdentity = { type: 'attachment', id: attachmentId(), sha256: digest(content) };
  const input: DownloadSourceRequest = { fileName: 'report.bin', mimeType: 'application/octet-stream', expectedVersion: digest(content), sourceIdentity, ...overrides };
  return { source, input, location, content };
}
async function service(options: DownloadServiceOptions = {}, context = ctx) {
  const instance = new DownloadService(context, { bucket, now: () => now, startupAttempts: 1, ...options });
  services.push(instance); await instance.initialize(); return instance;
}
function waitForJob(downloads: DownloadService, id: string, states: DownloadJobState[] = ['ready', 'failed', 'cancelled', 'expired']): Promise<DownloadJob> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => { stop?.(); reject(new Error('Trusted download did not finish.')); }, 8000);
    stop = downloads.subscribe(id, job => {
      if (states.includes(job.state)) queueMicrotask(() => { clearTimeout(timer); stop?.(); resolve(job); });
    });
  });
}
async function closed(source: DownloadSource) {
  await expect(source.handle.stat()).rejects.toThrow();
  await expect(source.parent.stat()).rejects.toThrow();
}
async function ready(downloads: DownloadService, fixture: Awaited<ReturnType<typeof sourceFixture>>) {
  const job = await downloads.prepareSource(workspaceId, fixture.input, fixture.source);
  return waitForJob(downloads, job.id);
}

beforeEach(async () => {
  now = Date.now(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-download-source-test-'));
  ctx = makeContext(directory); await ctx.workspaces.initialize();
  const workspace = await ctx.workspaces.create({ name: 'Trusted attachment downloads' });
  workspaceId = workspace.id; workspacePath = workspace.path;
  originals = path.join(ctx.config.dataDir, 'attachment-originals-fixture'); await fs.mkdir(originals);
  bucket = new FixtureBucket(() => now);
});
afterEach(async () => {
  vi.restoreAllMocks(); bucket.uploadGate?.resolve();
  await Promise.allSettled(services.splice(0).map(instance => instance.close()));
  await Promise.allSettled(openedSources.splice(0).map(source => source.close()));
  await fs.rm(directory, { recursive: true, force: true });
});

describe('trusted immutable attachment download sources', () => {
  it('delivers exact external bytes through the common job stream without a workspace copy or a durable processing snapshot', async () => {
    const downloads = await service();
    const fixture = await sourceFixture(Buffer.from([0, 128, 255, 10, 18]), { fileName: 'rapport é 文.bin' });
    await fs.writeFile(path.join(workspacePath, fixture.input.fileName), 'different workspace file');
    const resolve = vi.spyOn(ctx.workspaces, 'resolvePath').mockRejectedValue(new Error('Trusted descriptors must not resolve a workspace filename.'));
    const job = await downloads.prepareSource(workspaceId, fixture.input, fixture.source);
    expect(job).toMatchObject({ path: fixture.input.fileName, fileName: fixture.input.fileName, size: fixture.content.length, source: fixture.input.sourceIdentity, state: 'queued' });
    const events: DownloadJob[] = []; const unsubscribe = downloads.subscribe(job.id, event => events.push(event));
    const result = await waitForJob(downloads, job.id); unsubscribe();
    expect(result).toMatchObject({ state: 'ready', version: digest(fixture.content), source: fixture.input.sourceIdentity, size: fixture.content.length });
    expect(result.url).toContain(`/resolve/exports/${job.id}/rapport%20%C3%A9%20%E6%96%87.bin?download=true`);
    expect(bucket.publications[0].bytes).toEqual(fixture.content);
    expect(resolve).not.toHaveBeenCalled();
    expect(events.some(event => event.state === 'snapshotting')).toBe(true);
    expect(events.every(event => event.source?.id === fixture.input.sourceIdentity.id)).toBe(true);
    expect(await fs.readFile(path.join(workspacePath, fixture.input.fileName), 'utf8')).toBe('different workspace file');
    expect(await fs.readFile(fixture.location)).toEqual(fixture.content);
    for (const snapshot of bucket.snapshotPaths) expect(path.relative(ctx.config.dataDir, snapshot).startsWith('..')).toBe(true);
    await closed(fixture.source);
    const saved = await fs.readFile(path.join(ctx.config.stateDir, 'download-jobs-v1.json'), 'utf8');
    expect(saved).toContain(fixture.input.sourceIdentity.id);
    for (const privateValue of [fixture.location, originals, TOKEN, ...bucket.snapshotPaths]) expect(saved).not.toContain(privateValue);
    expect(JSON.stringify(result)).not.toMatch(/objectPath|expectedVersion|remoteHash|snapshotPath|accessToken/);
  });

  it('retains retry identity and safe MIME across restart and expiry while preserving original attachment bytes', async () => {
    const downloads = await service();
    const fixture = await sourceFixture('a,b\n1,2\n', { fileName: 'unknown-extension.bin', mimeType: 'text/csv' });
    const first = await ready(downloads, fixture); await downloads.close();
    const restarted = await service({}, makeContext(directory));
    expect(await restarted.get(first.id)).toMatchObject({ state: 'ready', path: fixture.input.fileName, mimeType: 'text/csv', version: fixture.input.expectedVersion, source: fixture.input.sourceIdentity, size: fixture.content.length });
    await restarted.close(); now += DOWNLOAD_RETENTION_MS + 1;
    const expired = await service({}, makeContext(directory));
    expect(await expired.get(first.id)).toMatchObject({ state: 'expired', source: fixture.input.sourceIdentity, size: fixture.content.length });
    expect(bucket.objects.size).toBe(0);
    expect(await fs.readFile(fixture.location)).toEqual(fixture.content);
  });

  it('checks required source hashes before publication and handles empty attachment files', async () => {
    const downloads = await service();
    const fixture = await sourceFixture('actual bytes');
    fixture.input.expectedVersion = digest('other bytes'); fixture.input.sourceIdentity.sha256 = fixture.input.expectedVersion;
    const failed = await ready(downloads, fixture);
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'VERSION_CONFLICT' }, source: fixture.input.sourceIdentity });
    expect(bucket.publications).toHaveLength(0); await closed(fixture.source);
    const empty = await sourceFixture('');
    expect(await ready(downloads, empty)).toMatchObject({ state: 'ready', size: 0, version: digest(''), source: empty.input.sourceIdentity });
    expect(bucket.publications[0].bytes.length).toBe(0);
  });

  it('closes owned descriptors for invalid filenames, versions, identities, MIME and injected path/URL fields', async () => {
    const downloads = await service();
    for (const patch of [
      { fileName: '../secret.txt' }, { fileName: '/absolute' }, { fileName: 'a/b.txt' }, { fileName: '.codex-write-owned' },
      { expectedVersion: '' }, { mimeType: 'text/plain\r\nInjected: true' },
      { sourceIdentity: { type: 'attachment', id: 'not-an-attachment', sha256: digest('safe') } },
      { sourceIdentity: { type: 'attachment', id: attachmentId(), sha256: digest('mismatched') } },
      { path: '/private/blob' }, { url: 'https://evil.example/content' },
    ]) {
      const fixture = await sourceFixture('safe');
      await expect(downloads.prepareSource(workspaceId, { ...fixture.input, ...patch } as DownloadSourceRequest, fixture.source)).rejects.toMatchObject({ code: 'INVALID_DOWNLOAD_SOURCE' });
      await closed(fixture.source); expect(await fs.readFile(fixture.location, 'utf8')).toBe('safe');
    }
    expect(bucket.publications).toHaveLength(0);
  });

  it('closes sources on unavailable service, missing workspace, full admission and cancelled queued jobs', async () => {
    const notInitialized = new DownloadService(ctx, { bucket }); services.push(notInitialized);
    const unavailable = await sourceFixture('safe');
    await expect(notInitialized.prepareSource(workspaceId, unavailable.input, unavailable.source)).rejects.toMatchObject({ code: 'DOWNLOADS_UNAVAILABLE' });
    await closed(unavailable.source);
    const downloads = await service({ maxQueued: 2 });
    const missing = await sourceFixture('safe');
    await expect(downloads.prepareSource('missing-workspace', missing.input, missing.source)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    await closed(missing.source);
    bucket.uploadGate = gate();
    const first = await sourceFixture('first'); const firstJob = await downloads.prepareSource(workspaceId, first.input, first.source);
    await waitForJob(downloads, firstJob.id, ['uploading']);
    const queued = await sourceFixture('queued'); const queuedJob = await downloads.prepareSource(workspaceId, queued.input, queued.source);
    const rejected = await sourceFixture('rejected');
    await expect(downloads.prepareSource(workspaceId, rejected.input, rejected.source)).rejects.toMatchObject({ code: 'DOWNLOAD_QUEUE_FULL' });
    await closed(rejected.source);
    expect((await downloads.cancel(queuedJob.id)).state).toBe('cancelled'); await closed(queued.source);
    expect(await fs.readFile(queued.location, 'utf8')).toBe('queued');
    await downloads.cancel(firstJob.id); bucket.uploadGate.resolve();
  });

  it('rejects replaced or oversized source descriptors before admitting a job', async () => {
    const downloads = await service();
    const replaced = await sourceFixture('original');
    await fs.rename(replaced.location, `${replaced.location}.previous`); await fs.writeFile(replaced.location, 'replaced');
    await expect(downloads.prepareSource(workspaceId, replaced.input, replaced.source)).rejects.toMatchObject({ code: 'DOWNLOAD_FILE_CHANGED' });
    await closed(replaced.source);
    const oversize = await sourceFixture('small'); oversize.source.size = MAX_DOWNLOAD_BYTES + 1;
    await expect(downloads.prepareSource(workspaceId, oversize.input, oversize.source)).rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' });
    await closed(oversize.source);
    const inconsistent = await sourceFixture('small'); inconsistent.source.size++;
    await expect(downloads.prepareSource(workspaceId, inconsistent.input, inconsistent.source)).rejects.toMatchObject({ code: 'DOWNLOAD_FILE_CHANGED' });
    await closed(inconsistent.source);
    expect(bucket.publications).toHaveLength(0);
  });

  it('detects source changes after admission before exporting queued attachment bytes', async () => {
    const downloads = await service(); bucket.uploadGate = gate();
    const first = await sourceFixture('first'); const firstJob = await downloads.prepareSource(workspaceId, first.input, first.source);
    await waitForJob(downloads, firstJob.id, ['uploading']);
    const changed = await sourceFixture('safe'); const changedJob = await downloads.prepareSource(workspaceId, changed.input, changed.source);
    await fs.writeFile(changed.location, 'evil'); bucket.uploadGate.resolve();
    expect((await waitForJob(downloads, firstJob.id)).state).toBe('ready');
    const rejected = await waitForJob(downloads, changedJob.id);
    expect(rejected).toMatchObject({ state: 'failed', source: changed.input.sourceIdentity });
    // A same-size edit can retain the metadata version on coarse filesystems. In that case
    // the required SHA-256 check rejects it as VERSION_CONFLICT before publication instead.
    expect(['DOWNLOAD_FILE_CHANGED', 'VERSION_CONFLICT']).toContain(rejected.error?.code);
    expect(rejected.version).toBeUndefined(); expect(rejected.url).toBeUndefined();
    expect(bucket.publications.map(publication => publication.bytes)).toEqual([Buffer.from('first')]);
    expect(await fs.readFile(changed.location, 'utf8')).toBe('evil');
    await closed(changed.source);
  });

  it('does not publish or retain descriptors after failed persistence and accepts a fresh verified retry', async () => {
    const downloads = await service(); const failed = await sourceFixture('safe');
    const write = vi.spyOn(ctx.store, 'write').mockRejectedValueOnce(new Error(`State failure ${TOKEN}`));
    await expect(downloads.prepareSource(workspaceId, failed.input, failed.source)).rejects.toMatchObject({ code: 'DOWNLOAD_STATE_ERROR' });
    await closed(failed.source); expect(bucket.publications).toHaveLength(0);
    write.mockRestore(); await downloads.cleanup();
    const retry = await sourceFixture('safe', { sourceIdentity: failed.input.sourceIdentity });
    expect((await ready(downloads, retry)).state).toBe('ready'); expect(bucket.publications).toHaveLength(1);
  });

  it('reuses identical safe representations while keeping each attachment identity and separating MIME variants', async () => {
    const downloads = await service();
    const original = await sourceFixture('same bytes'); const first = await ready(downloads, original);
    now += 1000;
    const identical = await sourceFixture('same bytes'); const second = await ready(downloads, identical);
    expect(second.url).toBe(first.url); expect(second.expiresAt).toBe(first.expiresAt);
    expect(second.source).toEqual(identical.input.sourceIdentity); expect(second.source?.id).not.toBe(first.source?.id);
    expect(bucket.publications).toHaveLength(1);
    const plain = await sourceFixture('same bytes', { mimeType: 'text/plain' }); const third = await ready(downloads, plain);
    expect(third.url).not.toBe(first.url); expect(third.mimeType).toBe('text/plain'); expect(bucket.publications).toHaveLength(2);
    const active = await sourceFixture('same bytes', { mimeType: 'text/html' }); const fourth = await ready(downloads, active);
    expect(fourth.mimeType).toBe('application/octet-stream'); expect(fourth.url).toBe(first.url);
    expect(bucket.publications.map(item => item.mimeType)).toEqual(['application/octet-stream', 'text/plain']);
  });

  it('fails interrupted source jobs after restart without retrying a storage filename as a workspace path', async () => {
    const downloads = await service(); const fixture = await sourceFixture('persistent bytes');
    const job = await ready(downloads, fixture); await downloads.close();
    const saved = await ctx.store.read<{ format: 1; jobs: Record<string, unknown>[] }>('download-jobs-v1', { format: 1, jobs: [] });
    saved.jobs[0].state = 'snapshotting'; await ctx.store.write('download-jobs-v1', saved);
    const restarted = await service({}, makeContext(directory));
    expect(await restarted.get(job.id)).toMatchObject({ state: 'failed', error: { code: 'DOWNLOAD_INTERRUPTED' }, source: fixture.input.sourceIdentity, path: fixture.input.fileName });
    expect(bucket.publications).toHaveLength(1);
    await expect(fs.stat(path.join(workspacePath, fixture.input.fileName))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(fixture.location)).toEqual(fixture.content);
  });
});
