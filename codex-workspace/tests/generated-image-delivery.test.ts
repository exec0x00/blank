import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { AuthService } from '../server/auth';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import {
  getGeneratedImageService, shutdownGeneratedImages, type GeneratedImageMetadata,
} from '../server/generated-images';
import {
  getGeneratedImageDeliveryService, createGeneratedImageDeliveryRouter, shutdownGeneratedImageDelivery,
} from '../server/generated-images/delivery';
import { createDownloadRouter, initializeDownloads, shutdownDownloads, type DownloadService } from '../server/downloads';
import { DOWNLOAD_RETENTION_MS, PUBLIC_DOWNLOAD_BUCKET } from '../server/downloads/bucket';
import type { BucketObject, DownloadBucket, DownloadJob, DownloadJobState } from '../server/downloads/types';
import {
  clearWorkspaceRecoveryBarrier, setWorkspaceRecoveryBarrier, workspaceIsBusy,
} from '../server/worktrees/activity';

// Real, independently encoded raster fixtures; no model call or image encoder is
// replaced. Only the external download bucket is substituted in these tests.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLooorxz9OP//Z', 'base64');
const webp = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoBAAEAAUAmJaACdLoAA5gA/urUf/cdgbrxb/97Bf+9AP+9AP6+AAAA', 'base64');
const SYNTHETIC_TOKEN = 'hf_TEST_ONLY_generated_image_delivery_not_a_real_credential';
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const reference = (image: GeneratedImageMetadata) => ({ id: image.id, sha256: image.sha256 });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

/** Preserve real PNG pixels and add a valid ancillary chunk before IEND. */
function pngWithLargeComment(): Buffer {
  const payload = Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(2 * 1024 * 1024, 0x78)]);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0); chunk.write('tEXt', 4, 'ascii'); payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}

class MemoryBucket implements DownloadBucket {
  readonly id = PUBLIC_DOWNLOAD_BUCKET;
  readonly objects = new Map<string, BucketObject & { bytes: Buffer }>();
  readonly deletions: string[][] = [];
  publications = 0;
  uploadError?: Error;
  uploadGate?: ReturnType<typeof gate>;
  uploadEntered?: ReturnType<typeof gate>;
  constructor(private readonly now: () => number) {}
  async *list(signal: AbortSignal): AsyncIterable<BucketObject> {
    for (const object of [...this.objects.values()]) { signal.throwIfAborted(); yield { ...object }; }
  }
  async get(objectPath: string, signal: AbortSignal): Promise<BucketObject | undefined> {
    signal.throwIfAborted(); const object = this.objects.get(objectPath); return object && { ...object };
  }
  async upload(input: Parameters<DownloadBucket['upload']>[0]): Promise<BucketObject> {
    input.signal.throwIfAborted();
    if (this.uploadError) throw this.uploadError;
    const bytes = await fs.readFile(input.snapshotPath);
    expect(bytes.length).toBe(input.size);
    input.onProgress(bytes.length); this.uploadEntered?.resolve();
    if (this.uploadGate) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { input.signal.removeEventListener('abort', abort); reject(input.signal.reason); };
        input.signal.addEventListener('abort', abort, { once: true });
        if (input.signal.aborted) { abort(); return; }
        void this.uploadGate!.promise.then(() => { input.signal.removeEventListener('abort', abort); resolve(); }, reject);
      });
    }
    await input.beforePublish?.(); input.signal.throwIfAborted();
    const result = { path: input.objectPath, type: 'file' as const, size: bytes.length,
      uploadedAt: new Date(this.now()).toISOString(), xetHash: hash(bytes), bytes };
    this.publications++; this.objects.set(result.path, result); return result;
  }
  async delete(objectPaths: string[], signal: AbortSignal) {
    signal.throwIfAborted(); this.deletions.push([...objectPaths]);
    for (const objectPath of objectPaths) this.objects.delete(objectPath);
    return { deleted: [...objectPaths], failed: [] };
  }
}

let directory: string, ctx: AppContext, workspaceId: string, workspacePath: string;
let now: number, bucket: MemoryBucket, downloads: DownloadService;
let auth: AuthService | undefined, server: Server | undefined, origin: string, cookie: string;
const contexts: AppContext[] = [];
const images = () => getGeneratedImageService(ctx);
const delivery = () => getGeneratedImageDeliveryService(ctx);

function context(): AppContext {
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'), NODE_ENV: 'test',
    WORKSPACE_PASSWORD: 'generated-delivery-test-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64),
    HF_DOWNLOAD_BUCKET: PUBLIC_DOWNLOAD_BUCKET, HF_DOWNLOAD_TOKEN: SYNTHETIC_TOKEN });
  const store = new JsonStore(config.stateDir);
  const result: AppContext = { config, store, workspaces: new WorkspaceService(config, store), secrets: new SecretStore(store, config.encryptionKey),
    events: new EventEmitter(), settings: async () => ({ ...defaultSettings }), saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  contexts.push(result); return result;
}

async function initializeDownloadService(): Promise<void> {
  downloads = await initializeDownloads(ctx, { bucket, now: () => now, startupAttempts: 1, cleanupIntervalMs: 60 * 60 * 1000 });
}

async function commit(bytes: Buffer = png, format: 'png' | 'jpeg' | 'webp' = 'png'): Promise<GeneratedImageMetadata> {
  return images().commit({ workspaceId, threadId: 'thread_delivery', messageId: 'msg_delivery', runId: 'run_delivery', itemId: 'ig_delivery',
    resultBase64: bytes.toString('base64'), outputFormat: format, revisedPrompt: 'A small real raster fixture.' });
}

function waitForJob(id: string, states: DownloadJobState[] = ['ready', 'failed', 'cancelled', 'expired']): Promise<DownloadJob> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    const timeout = setTimeout(() => { unsubscribe?.(); reject(new Error('Generated image delivery did not settle.')); }, 5000);
    try {
      unsubscribe = downloads.subscribe(id, job => {
        if (states.includes(job.state)) queueMicrotask(() => { clearTimeout(timeout); unsubscribe?.(); resolve(job); });
      });
    } catch (error) { clearTimeout(timeout); reject(error); }
  });
}

async function restart(): Promise<void> {
  await shutdownGeneratedImageDelivery(ctx); await shutdownDownloads(ctx); await shutdownGeneratedImages(ctx); await ctx.store.flush();
  ctx = context(); await ctx.workspaces.initialize(); await initializeDownloadService();
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'codex-generated-delivery-'));
  now = Date.now(); ctx = context(); await ctx.workspaces.initialize();
  const workspace = await ctx.workspaces.create({ name: 'Generated image delivery' });
  workspaceId = workspace.id; workspacePath = workspace.path;
  bucket = new MemoryBucket(() => now); await initializeDownloadService();
  auth = undefined; server = undefined; origin = ''; cookie = '';
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
  }
  await auth?.close();
  for (const current of contexts.splice(0)) {
    await shutdownGeneratedImageDelivery(current); await shutdownDownloads(current); await shutdownGeneratedImages(current); await current.store.flush();
  }
  // Every durable file and disposable directory used here belongs to this fixture.
  await fs.rm(directory, { recursive: true, force: true });
});

describe('generated image publication through the real download service', () => {
  it.each([['png', png, 'image/png', 'png'], ['jpeg', jpeg, 'image/jpeg', 'jpg'], ['webp', webp, 'image/webp', 'webp']] as const)(
    'publishes the exact %s bytes and pinned identity without exposing storage paths or credentials', async (format, bytes, mimeType, extension) => {
      const image = await commit(bytes, format), before = await fs.readdir(workspacePath);
      const manual = vi.fn(); ctx.events.on('workspace:manual-intent', manual);
      const queued = await delivery().download(workspaceId, reference(image));
      expect(queued).toMatchObject({ state: 'queued', source: { type: 'generated_image', ...reference(image) } });
      const ready = await waitForJob(queued.id), name = `generated-image-${image.id.slice(4, 16)}.${extension}`;
      expect(ready).toMatchObject({ state: 'ready', fileName: name, path: name, mimeType,
        size: bytes.length, version: hash(bytes), source: { type: 'generated_image', ...reference(image) } });
      expect(ready.url).toBe(`https://huggingface.co/buckets/${PUBLIC_DOWNLOAD_BUCKET}/resolve/exports/${ready.id}/${name}?download=true`);
      expect(Date.parse(ready.expiresAt!) - Date.parse(ready.uploadedAt!)).toBe(DOWNLOAD_RETENTION_MS);
      expect(bucket.publications).toBe(1); expect([...bucket.objects.values()][0].bytes).toEqual(bytes);
      expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(bytes);
      expect(await fs.readdir(workspacePath)).toEqual(before); expect(manual).not.toHaveBeenCalled();
      const publicValue = JSON.stringify(ready), persisted = await fs.readFile(path.join(ctx.config.stateDir, 'download-jobs-v1.json'), 'utf8');
      for (const forbidden of [SYNTHETIC_TOKEN, ctx.config.password, ctx.config.sessionSecret, ctx.config.encryptionKey, directory, bytes.toString('base64')]) {
        expect(publicValue).not.toContain(forbidden); expect(persisted).not.toContain(forbidden);
      }
      expect(publicValue).not.toMatch(/snapshotPath|objectPath|remoteHash|accessToken|resultBase64/);
    });

  it('expires only the temporary download after 24 hours and preserves its original and identity across restart', async () => {
    const image = await commit(), queued = await delivery().download(workspaceId, reference(image));
    const ready = await waitForJob(queued.id);
    now = Date.parse(ready.uploadedAt!) + DOWNLOAD_RETENTION_MS - 60_000;
    await downloads.cleanup(); expect((await downloads.get(ready.id)).state).toBe('ready'); expect(bucket.objects.size).toBe(1);
    await restart();
    expect(await downloads.get(ready.id)).toMatchObject({ state: 'ready', source: { type: 'generated_image', ...reference(image) } });
    expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
    now += 60_000;
    await restart(); // Actual startup cleanup sees the existing remote timestamp.
    expect(await downloads.get(ready.id)).toMatchObject({ state: 'expired', source: { type: 'generated_image', ...reference(image) } });
    expect((await downloads.get(ready.id)).url).toBeUndefined(); expect(bucket.objects.size).toBe(0);
    expect(bucket.deletions.flat()).toContain(`exports/${ready.id}/${ready.fileName}`);
    expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
    const saved = await delivery().save(workspaceId, reference(image), { path: 'after-expiry.png' });
    expect(hash(await fs.readFile(path.join(workspacePath, saved.path)))).toBe(image.sha256);
  });

  it('cancels a publication before its bucket commit and retains the generated original', async () => {
    const image = await commit(); bucket.uploadGate = gate(); bucket.uploadEntered = gate();
    const queued = await delivery().download(workspaceId, reference(image));
    try {
      await bucket.uploadEntered.promise;
      expect((await downloads.cancel(queued.id)).state).toBe('cancelled');
      bucket.uploadGate.resolve(); await shutdownDownloads(ctx);
      expect(bucket.publications).toBe(0); expect(bucket.objects.size).toBe(0);
      expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
    } finally { bucket.uploadGate.resolve(); }
  });

  it('reports a failed publication without leaking the upstream error or deleting saved bytes', async () => {
    const image = await commit(); bucket.uploadError = new Error(`Synthetic upstream failure ${SYNTHETIC_TOKEN} ${directory}`);
    const queued = await delivery().download(workspaceId, reference(image)), failed = await waitForJob(queued.id);
    expect(failed.state).toBe('failed'); expect(failed.error?.message).toBeTruthy(); expect(failed.url).toBeUndefined();
    expect(JSON.stringify(failed)).not.toContain(SYNTHETIC_TOKEN); expect(JSON.stringify(failed)).not.toContain(directory);
    expect(bucket.publications).toBe(0); expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
  });
});

describe('create-only workspace copies of generated originals', () => {
  it('validates without writing and emits honest manual-save provenance around the verified copy', async () => {
    const image = await commit(); await fs.mkdir(path.join(workspacePath, 'images'));
    const events: Array<{ name: string; value: Record<string, unknown> }> = [];
    ctx.events.on('workspace:manual-intent', value => events.push({ name: 'intent', value }));
    ctx.events.on('workspace:changed', value => events.push({ name: 'changed', value }));
    expect(await delivery().validateCopy(workspaceId, reference(image), { path: 'images/saved.png', threadId: image.threadId })).toEqual(image);
    expect(await fs.readdir(path.join(workspacePath, 'images'))).toEqual([]); expect(events).toEqual([]);
    const saved = await delivery().save(workspaceId, reference(image), { path: 'images/saved.png', threadId: image.threadId });
    expect(saved).toMatchObject({ image, path: 'images/saved.png', version: image.sha256,
      entry: { name: 'saved.png', path: 'images/saved.png', kind: 'file', size: png.length } });
    expect(await fs.readFile(path.join(workspacePath, saved.path))).toEqual(png);
    expect(events.map(event => event.name)).toEqual(['intent', 'changed', 'intent']);
    expect(events[0].value).toMatchObject({ workspaceId, paths: [saved.path], phase: 'start', operationId: expect.any(String) });
    expect(events[1].value).toEqual({ workspaceId, paths: [saved.path] });
    expect(events[2].value).toMatchObject({ workspaceId, paths: [saved.path], phase: 'end', committed: true, operationId: events[0].value.operationId });
    expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
  });

  it('leaves agent review attribution with its adapter and checks authorization immediately before creation', async () => {
    const image = await commit(), manual = vi.fn(), changed = vi.fn(), beforeCommit = vi.fn(async () => undefined);
    ctx.events.on('workspace:manual-intent', manual); ctx.events.on('workspace:changed', changed);
    const saved = await delivery().save(workspaceId, reference(image), { path: 'agent.png', threadId: image.threadId }, { source: 'agent', beforeCommit });
    expect(beforeCommit).toHaveBeenCalledOnce(); expect(manual).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
    expect(hash(await fs.readFile(path.join(workspacePath, saved.path)))).toBe(image.sha256);
    const rejection = new HttpError(403, 'The reviewed action is no longer authorized.', 'TEST_APPROVAL_REVOKED');
    await expect(delivery().save(workspaceId, reference(image), { path: 'revoked.png' }, {
      source: 'agent', beforeCommit: async () => { throw rejection; },
    })).rejects.toBe(rejection);
    await expect(fs.lstat(path.join(workspacePath, 'revoked.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('permits a valid image above 2 MiB for manual save but rejects agent copies before opening any output', async () => {
    const bytes = pngWithLargeComment(), image = await commit(bytes), beforeCommit = vi.fn(async () => undefined);
    expect(image.bytes).toBeGreaterThan(2 * 1024 * 1024); expect(image.bytes).toBeLessThan(8 * 1024 * 1024);
    const opened = vi.spyOn(fs, 'open');
    await expect(delivery().validateCopy(workspaceId, reference(image), { path: 'too-large.png' }, { source: 'agent' })).rejects.toMatchObject({ status: 413 });
    await expect(delivery().save(workspaceId, reference(image), { path: 'too-large.png' }, { source: 'agent', beforeCommit })).rejects.toMatchObject({ status: 413 });
    expect(beforeCommit).not.toHaveBeenCalled();
    // fs.open's omitted flags mean read-only, just like the explicit 'r' form.
    expect(opened.mock.calls.filter(([, flags]) => typeof flags === 'number'
      ? Boolean(flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT)) : /[wa+]/.test(flags ?? 'r'))).toEqual([]);
    opened.mockRestore();
    await expect(fs.lstat(path.join(workspacePath, 'too-large.png'))).rejects.toMatchObject({ code: 'ENOENT' });
    const saved = await delivery().save(workspaceId, reference(image), { path: 'manual-large.png' });
    expect(await fs.readFile(path.join(workspacePath, saved.path))).toEqual(bytes);
    expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(bytes);
  });

  it('requires the pinned hash, owning workspace, and any explicitly supplied owner thread', async () => {
    const image = await commit(), other = await ctx.workspaces.create({ name: 'Other image owner' });
    const changed = { ...reference(image), sha256: '0'.repeat(64) };
    await expect(delivery().download(workspaceId, changed)).rejects.toMatchObject({ status: 409 });
    await expect(delivery().save(workspaceId, changed, { path: 'changed.png' })).rejects.toMatchObject({ status: 409 });
    await expect(delivery().download(other.id, reference(image))).rejects.toMatchObject({ status: 404 });
    await expect(delivery().save(other.id, reference(image), { path: 'other.png' })).rejects.toMatchObject({ status: 404 });
    await expect(delivery().validateCopy(workspaceId, reference(image), { path: 'foreign-thread.png', threadId: 'thread_other' })).rejects.toMatchObject({ status: 404 });
    await expect(delivery().save(workspaceId, reference(image), { path: 'foreign-thread.png', threadId: 'thread_other' })).rejects.toMatchObject({ status: 404 });
    expect(bucket.publications).toBe(0);
    for (const name of ['changed.png', 'foreign-thread.png']) await expect(fs.lstat(path.join(workspacePath, name))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(other.path, 'other.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never overwrites existing files, directories, or a final symbolic link', async () => {
    const image = await commit(), outside = path.join(directory, 'outside-original.png');
    await fs.writeFile(path.join(workspacePath, 'keep.png'), webp); await fs.mkdir(path.join(workspacePath, 'keep-directory'));
    await fs.writeFile(outside, 'Keep this external file.'); await fs.symlink(outside, path.join(workspacePath, 'keep-link.png'));
    for (const destination of ['keep.png', 'keep-directory']) {
      await expect(delivery().save(workspaceId, reference(image), { path: destination })).rejects.toMatchObject({ status: 409 });
    }
    const linkFailure = await delivery().save(workspaceId, reference(image), { path: 'keep-link.png' }).then(() => undefined, (error: unknown) => error);
    expect(linkFailure).toBeInstanceOf(HttpError); expect([403, 409]).toContain((linkFailure as HttpError).status);
    expect(await fs.readFile(path.join(workspacePath, 'keep.png'))).toEqual(webp);
    expect(await fs.readdir(path.join(workspacePath, 'keep-directory'))).toEqual([]);
    expect((await fs.lstat(path.join(workspacePath, 'keep-link.png'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(outside, 'utf8')).toBe('Keep this external file.');
  });

  it('rejects traversal and absent or linked destination parents without creating folders', async () => {
    const image = await commit(), external = path.join(directory, 'external'); await fs.mkdir(external);
    await fs.symlink(external, path.join(workspacePath, 'linked'));
    for (const destination of ['', '../escape.png', '/absolute.png', 'nested/../../escape.png', 'nested\\escape.png', 'https://example.invalid/image.png']) {
      await expect(delivery().save(workspaceId, reference(image), { path: destination })).rejects.toMatchObject({ status: 400 });
    }
    await expect(delivery().save(workspaceId, reference(image), { path: 'missing/image.png' })).rejects.toMatchObject({ status: 404 });
    await expect(delivery().save(workspaceId, reference(image), { path: 'linked/image.png' })).rejects.toMatchObject({ status: 403 });
    await expect(fs.lstat(path.join(workspacePath, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(external)).toEqual([]); await expect(fs.lstat(path.join(directory, 'escape.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('detects a replaced parent after review and preserves both the former folder and external target', async () => {
    const image = await commit(), parent = path.join(workspacePath, 'destination'), former = path.join(workspacePath, 'former');
    const outside = path.join(directory, 'outside-parent'); await fs.mkdir(parent); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'Keep outside data.');
    const beforeCommit = vi.fn(async () => { await fs.rename(parent, former); await fs.symlink(outside, parent); });
    await expect(delivery().save(workspaceId, reference(image), { path: 'destination/image.png' }, { beforeCommit })).rejects.toMatchObject({ status: 403 });
    expect(beforeCommit).toHaveBeenCalledOnce(); expect(await fs.readdir(former)).toEqual([]);
    expect(await fs.readdir(outside)).toEqual(['keep.txt']); expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('Keep outside data.');
    expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
  });
});

describe('generated image copy admission and cancellation', () => {
  it('honors already-aborted requests and cancellation before creation without a destination or manual event', async () => {
    const image = await commit(), controller = new AbortController(), reason = new Error('Fixture request stopped');
    const manual = vi.fn(); ctx.events.on('workspace:manual-intent', manual); controller.abort(reason);
    await expect(delivery().download(workspaceId, reference(image), { signal: controller.signal })).rejects.toBe(reason);
    await expect(delivery().save(workspaceId, reference(image), { path: 'before.png' }, { signal: controller.signal })).rejects.toBe(reason);
    const pending = new AbortController();
    await expect(delivery().save(workspaceId, reference(image), { path: 'during.png' }, {
      signal: pending.signal, beforeCommit: async () => { pending.abort(reason); },
    })).rejects.toBe(reason);
    for (const name of ['before.png', 'during.png']) await expect(fs.lstat(path.join(workspacePath, name))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(manual).not.toHaveBeenCalled(); expect(bucket.publications).toBe(0);
    expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
  });

  it('drains creation already admitted to the host and preserves its verified file after cancellation', async () => {
    const image = await commit(), entered = gate(), release = gate(), controller = new AbortController();
    const reason = new Error('Stopped after the native create began'), open = fs.open.bind(fs), manual = vi.fn(), changed = vi.fn();
    ctx.events.on('workspace:manual-intent', manual); ctx.events.on('workspace:changed', changed);
    let descriptor: FileHandle | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('/native-drain.png') && typeof flags === 'number' && Boolean(flags & constants.O_CREAT)) {
        descriptor = handle; entered.resolve(); await release.promise;
      }
      return handle;
    });
    const current = delivery(), copying = current.save(workspaceId, reference(image), { path: 'native-drain.png' }, {
      signal: controller.signal,
    }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    controller.abort(reason);
    let closed = false; const closing = shutdownGeneratedImageDelivery(ctx).then(() => { closed = true; });
    try {
      await expect(current.save(workspaceId, reference(image), { path: 'late-drain.png' })).rejects.toMatchObject({ status: 503 });
      expect(closed).toBe(false); expect(workspaceIsBusy(ctx.config.workspacesDir, workspaceId)).toBe(true);
      expect(descriptor!.fd).toBeGreaterThanOrEqual(0); expect(changed).not.toHaveBeenCalled();
      release.resolve(); expect(await copying).toEqual({ error: reason }); await closing;
      expect(descriptor!.fd).toBe(-1); expect(workspaceIsBusy(ctx.config.workspacesDir, workspaceId)).toBe(false);
      expect(await fs.readFile(path.join(workspacePath, 'native-drain.png'))).toEqual(png);
      expect(changed).toHaveBeenCalledWith({ workspaceId, paths: ['native-drain.png'] });
      expect(manual).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'end', committed: true }));
      expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
    } finally { release.resolve(); await copying; await closing; }
  });

  it('serializes with actual editor file creation and preserves the first verified writer', async () => {
    const image = await commit(), entered = gate(), release = gate(), destination = 'shared-destination.png';
    const copying = delivery().save(workspaceId, reference(image), { path: destination }, {
      beforeCommit: async () => { entered.resolve(); await release.promise; },
    }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const editing = ctx.workspaces.upload(workspaceId, destination, Buffer.from('competing editor bytes')).then(value => ({ value }), error => ({ error }));
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      await expect(fs.lstat(path.join(workspacePath, destination))).rejects.toMatchObject({ code: 'ENOENT' });
      release.resolve();
      expect(await copying).toMatchObject({ value: { version: image.sha256 } });
      expect(await editing).toMatchObject({ error: { status: 409 } });
      expect(await fs.readFile(path.join(workspacePath, destination))).toEqual(png);
    } finally { release.resolve(); await copying; await editing; }
  });

  it('refuses a copy behind an unresolved file-recovery barrier and permits it after acknowledgement', async () => {
    const image = await commit(), beforeCommit = vi.fn(async () => undefined), recoveryId = 'recovery_generated_delivery';
    setWorkspaceRecoveryBarrier(ctx.config.workspacesDir, workspaceId, { recoveryId, message: 'Review fixture file recovery before writing.' });
    try {
      await expect(delivery().save(workspaceId, reference(image), { path: 'recovered.png' }, { beforeCommit })).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
      expect(beforeCommit).not.toHaveBeenCalled();
      await expect(fs.lstat(path.join(workspacePath, 'recovered.png'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
    } finally { clearWorkspaceRecoveryBarrier(ctx.config.workspacesDir, workspaceId, recoveryId); }
    const saved = await delivery().save(workspaceId, reference(image), { path: 'recovered.png' });
    expect(hash(await fs.readFile(path.join(workspacePath, saved.path)))).toBe(image.sha256);
  });

  it('drains an admitted callback during shutdown and releases its real workspace activity lease', async () => {
    const image = await commit(), entered = gate(), release = gate(), current = delivery();
    const copying = current.save(workspaceId, reference(image), { path: 'stopped.png' }, {
      beforeCommit: async () => { entered.resolve(); await release.promise; },
    }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspaceId)).toBe(true);
    let closed = false; const closing = shutdownGeneratedImageDelivery(ctx).then(() => { closed = true; });
    try {
      await expect(current.save(workspaceId, reference(image), { path: 'late.png' })).rejects.toMatchObject({ status: 503 });
      expect(closed).toBe(false); release.resolve();
      expect(await copying).toHaveProperty('error'); await closing;
      expect(workspaceIsBusy(ctx.config.workspacesDir, workspaceId)).toBe(false);
      for (const name of ['stopped.png', 'late.png']) await expect(fs.lstat(path.join(workspacePath, name))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
    } finally { release.resolve(); await copying; await closing; }
  });
});

async function startServer(): Promise<void> {
  auth = new AuthService(ctx); await auth.initialize();
  const app = express(); app.use('/api', auth.protectMutations);
  app.use('/api/session', express.json({ limit: '4kb' })); app.use('/api', auth.router());
  app.use('/api', auth.requireSession, express.json({ limit: '8kb' }), createGeneratedImageDeliveryRouter(ctx), createDownloadRouter(ctx));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const known = error instanceof HttpError ? error : new HttpError((error as { status?: number })?.status ?? 500, 'Invalid request.');
    res.status(known.status).json({ error: known.message, code: known.code });
  };
  app.use(errors); server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

function request(route: string, body?: unknown, options: { method?: string; authenticated?: boolean; requestOrigin?: string; marker?: boolean } = {}): Promise<Response> {
  return fetch(`${origin}/api${route}`, { method: options.method ?? 'POST', headers: {
    Origin: options.requestOrigin ?? origin, ...(options.marker === false ? {} : { 'X-Codex-Workspace': '1' }),
    ...(options.authenticated === false || !cookie ? {} : { Cookie: cookie }),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function login(): Promise<void> {
  const response = await request('/session', { password: ctx.config.password });
  expect(response.status).toBe(200); cookie = response.headers.get('set-cookie')!.split(';')[0];
}

describe('generated image delivery routes behind real session and mutation protection', () => {
  it('requires login and same-origin requests, returns real jobs/copies, and revokes admission after logout', async () => {
    const image = await commit(); await startServer();
    const route = `/workspaces/${workspaceId}/generated-images/${image.id}`;
    expect((await request(`${route}/download`, { sha256: image.sha256 })).status).toBe(401);
    expect((await request(`${route}/save`, { sha256: image.sha256, path: 'anonymous.png' })).status).toBe(401);
    await login();
    expect((await request(`${route}/download`, { sha256: image.sha256 }, { requestOrigin: 'https://unrelated.invalid' })).status).toBe(403);
    expect((await request(`${route}/save`, { sha256: image.sha256, path: 'unmarked.png' }, { marker: false })).status).toBe(403);
    expect(bucket.publications).toBe(0);
    const accepted = await request(`${route}/download`, { sha256: image.sha256 });
    expect(accepted.status).toBe(202); const job = await accepted.json() as DownloadJob;
    expect(accepted.headers.get('location')).toBe(`/api/downloads/${job.id}`);
    expect(job.source).toEqual({ type: 'generated_image', ...reference(image) }); expect((await waitForJob(job.id)).state).toBe('ready');
    const copied = await request(`${route}/save`, { sha256: image.sha256, path: 'browser.png', threadId: image.threadId });
    expect(copied.status).toBe(201); expect(await copied.json()).toMatchObject({ image, path: 'browser.png', version: image.sha256 });
    expect(await fs.readFile(path.join(workspacePath, 'browser.png'))).toEqual(png);
    expect((await request('/session', undefined, { method: 'DELETE' })).ok).toBe(true);
    expect((await request(`${route}/save`, { sha256: image.sha256, path: 'logged-out.png' })).status).toBe(401);
    expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
  });

  it('rejects malformed bodies, changed hashes, and foreign workspace/thread references without side effects', async () => {
    const image = await commit(), other = await ctx.workspaces.create({ name: 'Other delivery routes' });
    await startServer(); await login(); const route = `/workspaces/${workspaceId}/generated-images/${image.id}`;
    for (const body of [undefined, null, [], {}, { sha256: 'invalid' }, { sha256: image.sha256, url: 'https://example.invalid/image.png' }, { sha256: image.sha256, path: 'injected.png' }]) {
      expect((await request(`${route}/download`, body)).status).toBe(400);
    }
    for (const body of [undefined, null, [], { sha256: image.sha256 }, { sha256: image.sha256, path: 42 },
      { sha256: image.sha256, path: 'spoofed.png', source: 'agent' }, { sha256: image.sha256, path: 'invalid-thread.png', threadId: {} }]) {
      expect((await request(`${route}/save`, body)).status).toBe(400);
    }
    expect((await request(`${route}/download`, { sha256: '0'.repeat(64) })).status).toBe(409);
    expect((await request(`${route}/save`, { sha256: '0'.repeat(64), path: 'changed.png' })).status).toBe(409);
    expect((await request(`${route}/save`, { sha256: image.sha256, path: 'foreign.png', threadId: 'thread_other' })).status).toBe(404);
    expect((await request(`/workspaces/${other.id}/generated-images/${image.id}/download`, { sha256: image.sha256 })).status).toBe(404);
    expect(bucket.publications).toBe(0);
    for (const name of ['spoofed.png', 'changed.png', 'foreign.png']) await expect(fs.lstat(path.join(workspacePath, name))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await images().read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
  });
});
