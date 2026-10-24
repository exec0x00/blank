import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { AuthService } from '../server/auth';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { PUBLIC_DOWNLOAD_BUCKET } from '../server/downloads/bucket';
import type { BucketObject } from '../server/downloads/types';
import type { UploadBucket } from '../server/uploads/types';
import { getUploadService, shutdownUploads } from '../server/uploads';
import { getConversationFiles, shutdownConversationFiles, type ConversationFilesService, type FileAttachmentUploadJob } from '../server/conversation-files';
import { createImageAttachmentsRouter, ImageAttachmentService, IMAGE_ATTACHMENT_LIMITS, shutdownImageAttachments } from '../server/agent/attachments';
import { uploadImageAttachment } from '../client/components/chat/image-attachment-transfer';

// The remote CAS/publication boundary is controlled; all source/image files,
// validation, immutable references, HTTP guards and cleanup operations are real.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const animatedGif = Buffer.from('R0lGODlhAQABAIEAAOc3PAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQABQAAACwAAAAAAQABAAAIBAABBAQAIfkEAQUAAQAsAAAAAAEAAQCBKissAAAAAAAAAAAACAQAAQQEADs=', 'base64');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function oversizedRaster(width: number, height: number): Buffer {
  const bytes = Buffer.from(png); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29); return bytes;
}

class ControlledBucket implements UploadBucket {
  readonly id = PUBLIC_DOWNLOAD_BUCKET;
  readonly chunks = new Map<string, Buffer>();
  readonly objects = new Map<string, BucketObject & { bytes: Buffer }>();
  publications = 0;
  constructor(private readonly now: () => number) {}
  stage(bytes: Buffer) { const xetHash = hash(Buffer.concat([Buffer.from('controlled-xet:'), bytes])); this.chunks.set(xetHash, Buffer.from(bytes)); return { xetHash, sha256: hash(bytes) }; }
  async capability() { return { accessToken: 'controlled-temporary-cas-capability', casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(this.now() / 1000) + 600 }; }
  async *list(signal: AbortSignal) { for (const item of this.objects.values()) { signal.throwIfAborted(); yield { ...item }; } }
  async get(key: string, signal: AbortSignal) { signal.throwIfAborted(); const value = this.objects.get(key); return value && { ...value }; }
  async publish(input: Parameters<UploadBucket['publish']>[0]) {
    input.signal.throwIfAborted(); const bytes = this.chunks.get(input.xetHash);
    if (!bytes) throw new Error('Missing controlled upload bytes.');
    const object = { path: input.objectPath, type: 'file' as const, size: bytes.length, xetHash: input.xetHash,
      uploadedAt: new Date(this.now()).toISOString(), bytes: Buffer.from(bytes) };
    this.objects.set(input.objectPath, object); this.publications++; return { ...object };
  }
  async read(input: Parameters<UploadBucket['read']>[0]) {
    input.signal.throwIfAborted(); const object = this.objects.get(input.objectPath);
    if (!object) throw new Error('Missing controlled published file.');
    input.onProgress?.(object.bytes.length); return Buffer.from(object.bytes);
  }
  async delete(keys: string[], signal: AbortSignal) { signal.throwIfAborted(); for (const key of keys) this.objects.delete(key); return { deleted: keys, failed: [] }; }
}

let root: string, ctx: AppContext, workspaceId: string, now: number, files: ConversationFilesService, images: ImageAttachmentService, bucket: ControlledBucket;
const services: ImageAttachmentService[] = [], servers: Server[] = [], auths: AuthService[] = [];
const imageDirectory = () => path.join(ctx.config.stateDir, 'image-attachments-v1', hash(workspaceId));
const imageFiles = async () => (await fs.readdir(imageDirectory()).catch(() => [] as string[])).filter(name => name.endsWith('.image'));
const recordFiles = async () => (await fs.readdir(imageDirectory()).catch(() => [] as string[])).filter(name => /^att_[a-f0-9]{32}\.json$/.test(name));
const input = (job: FileAttachmentUploadJob, detail?: 'high' | 'original') => ({ uploadId: job.id, sha256: job.attachment!.sha256, ...(detail ? { detail } : {}) });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-photo-staging-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: path.join(root, 'data'), RUNTIME_DIR: path.join(root, 'runtime'),
    WORKSPACE_PASSWORD: 'photo-staging-fixture-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store);
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: async () => ({ ...defaultSettings }), saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  await workspaces.initialize(); workspaceId = (await workspaces.create({ name: 'Photo staging fixture', initializeGit: false })).id;
  now = Date.now(); bucket = new ControlledBucket(() => now);
  files = getConversationFiles(ctx, { bucket, now: () => now, cleanupIntervalMs: 0 }); await files.initialize();
  images = new ImageAttachmentService(ctx, { now: () => now, cleanupIntervalMs: 0 }); services.push(images); await images.initialize();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  for (const auth of auths.splice(0)) await auth.close();
  for (const image of services.splice(0)) await image.close();
  await shutdownImageAttachments(ctx); await shutdownConversationFiles(ctx); await shutdownUploads(ctx); await ctx.store.flush();
  await fs.rm(root, { recursive: true, force: true });
});

async function ready(bytes: Buffer = png, name = 'photo.png', selected = workspaceId): Promise<FileAttachmentUploadJob> {
  const job = await files.reserve(selected, { name, size: bytes.length, mimeType: 'image/png' });
  await files.complete(job.id, bucket.stage(bytes));
  await expect.poll(async () => (await files.get(job.id)).state).toBe('ready');
  return files.get(job.id);
}

describe('photo promotion from direct bucket uploads', () => {
  it.each(['照'.repeat(100) + '.png', '.codex-write-photo.png'])('reports filename refusal without claiming an uploaded job for %s', async name => {
    const network = vi.spyOn(globalThis, 'fetch');
    const result = await uploadImageAttachment({ workspaceId, file: new File([png], name, { type: 'image/png' }) });
    expect(result).toMatchObject({ stage: 'failed', error: 'Use a filename of up to 255 bytes without slashes or control characters.' });
    expect(result.error).not.toMatch(/confirm|retry|uploaded/i);
    expect(result.job).toBeUndefined(); expect(result.image).toBeUndefined(); expect(result.promotionStarted).toBeUndefined();
    expect(network).not.toHaveBeenCalled(); expect(await imageFiles()).toEqual([]); expect(await recordFiles()).toEqual([]);
  });

  it('promotes verified original bytes and dimensions into the existing real input_image contract', async () => {
    const job = await ready(), result = await images.fromUpload(workspaceId, input(job, 'original'));
    expect(result).toMatchObject({ workspaceId, name: 'photo.png', sha256: hash(png), bytes: png.length, width: 1, height: 1, mimeType: 'image/png', detail: 'original', createdAt: job.createdAt });
    expect(result.previewUrl).toBe(`/api/workspaces/${workspaceId}/attachments/${result.id}/content?sha256=${hash(png)}`);
    expect(await fs.readFile(path.join(imageDirectory(), `${result.id}.image`))).toEqual(png);
    expect((await files.inspect(workspaceId, { id: job.attachment!.id, sha256: hash(png) })).attachment.sha256).toBe(hash(png));
    expect(JSON.stringify(result)).not.toMatch(/promotion|uploadId|objectPath|capability|accessToken/);
    const resolved = await images.resolve(workspaceId, [{ id: result.id, sha256: result.sha256 }], { retain: true });
    expect(resolved.content).toEqual([{ type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}`, detail: 'original' }]);
    expect((await images.preview(workspaceId, result.id, result.sha256)).bytes).toEqual(png);
    expect(bucket.publications).toBe(1);
    expect(Date.parse(job.expiresAt!) - Date.parse(job.uploadedAt!)).toBe(24 * 60 * 60 * 1000);
  });

  it('returns one actual image for concurrent retries and for a lost receipt after source disposal and service restart', async () => {
    const job = await ready();
    const results = await Promise.all(Array.from({ length: 3 }, () => images.fromUpload(workspaceId, input(job))));
    expect(new Set(results.map(value => value.id)).size).toBe(1);
    expect(await imageFiles()).toEqual([`${results[0].id}.image`]); expect(await recordFiles()).toEqual([`${results[0].id}.json`]);
    await files.discard(workspaceId, { id: job.attachment!.id, sha256: job.attachment!.sha256 });
    await images.close();
    const restarted = new ImageAttachmentService(ctx, { now: () => now, cleanupIntervalMs: 0 }); services.push(restarted);
    const sourceRead = vi.spyOn(files, 'get');
    const retried = await restarted.fromUpload(workspaceId, input(job));
    expect(retried).toEqual(results[0]); expect(sourceRead).not.toHaveBeenCalled();
    expect((await restarted.preview(workspaceId, retried.id, retried.sha256)).bytes).toEqual(png);
    expect(await imageFiles()).toHaveLength(1); expect(bucket.publications).toBe(1);
  });

  it('keeps public staging expiry tracked after verified promotion and optional generic-original disposal', async () => {
    const job = await ready(), image = await images.fromUpload(workspaceId, input(job));
    await images.resolve(workspaceId, [{ id: image.id, sha256: image.sha256 }], { retain: true });
    await files.discard(workspaceId, { id: job.attachment!.id, sha256: job.attachment!.sha256 });
    expect(bucket.objects.get(job.objectPath)?.bytes).toEqual(png);
    await getUploadService(ctx).cleanup();
    expect(bucket.objects.has(job.objectPath)).toBe(true);
    now += IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs + 1;
    await getUploadService(ctx).cleanup(); await files.cleanupExpired(); await images.cleanupExpired();
    expect(bucket.objects.has(job.objectPath)).toBe(false);
    expect((await images.preview(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
    expect(await images.fromUpload(workspaceId, input(job))).toEqual(image);
    expect(await imageFiles()).toEqual([`${image.id}.image`]);
    expect(bucket.publications).toBe(1);
  });

  it('binds retry identity to exact source hash, workspace and detail without exposing a foreign upload', async () => {
    const other = await ctx.workspaces.create({ name: 'Other photo workspace', initializeGit: false });
    const foreign = await ready(png, 'foreign.png', other.id);
    await expect(images.fromUpload(workspaceId, input(foreign))).rejects.toMatchObject({ status: 403, code: 'IMAGE_UPLOAD_WORKSPACE_MISMATCH' });
    expect(await recordFiles()).toEqual([]);
    const job = await ready();
    await expect(images.fromUpload(workspaceId, { ...input(job), sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'IMAGE_UPLOAD_CHANGED' });
    const high = await images.fromUpload(workspaceId, input(job));
    expect(await images.fromUpload(workspaceId, input(job, 'high'))).toEqual(high);
    const original = await images.fromUpload(workspaceId, input(job, 'original'));
    expect(original.id).not.toBe(high.id); expect(original.detail).toBe('original');
    expect(await imageFiles()).toHaveLength(2);
  });

  it('requires a ready job and rejects URLs, paths, extra capabilities and unsupported detail before source access', async () => {
    const job = await files.reserve(workspaceId, { name: 'pending.png', size: png.length, mimeType: 'image/png' });
    await expect(images.fromUpload(workspaceId, { uploadId: job.id, sha256: hash(png) })).rejects.toMatchObject({ code: 'IMAGE_UPLOAD_NOT_READY' });
    const reads = vi.spyOn(files, 'get');
    for (const bad of [{ uploadId: job.id, sha256: hash(png), url: 'https://example.invalid/photo' },
      { uploadId: job.id, sha256: hash(png), path: '../outside' }, { uploadId: job.id, sha256: hash(png), accessToken: 'not-authority' },
      { uploadId: job.id, sha256: hash(png), detail: 'low' }]) {
      await expect(async () => images.fromUpload(workspaceId, bad as never)).rejects.toMatchObject({ status: 400, code: 'INVALID_IMAGE_UPLOAD' });
    }
    expect(reads).not.toHaveBeenCalled(); expect(await recordFiles()).toEqual([]);
  });

  it.each(['not an image', 'animated image', 'over byte limit', 'over dimension limit', 'over pixel limit'] as const)('keeps the generic original and creates no image for %s', async failure => {
    const bytes = failure === 'not an image' ? Buffer.from('<svg>untrusted</svg>') : failure === 'animated image' ? animatedGif
      : failure === 'over dimension limit' ? oversizedRaster(16385, 1) : failure === 'over pixel limit' ? oversizedRaster(8192, 8192)
        : Buffer.alloc(IMAGE_ATTACHMENT_LIMITS.maxBytes + 1, 0x61);
    const job = await ready(bytes);
    await expect(images.fromUpload(workspaceId, input(job))).rejects.toBeInstanceOf(HttpError);
    expect(await imageFiles()).toEqual([]); expect(await recordFiles()).toEqual([]);
    const source = await files.openDownloadSource(workspaceId, { id: job.attachment!.id, sha256: hash(bytes) });
    try { expect(hash(await source.source.handle.readFile())).toBe(hash(bytes)); }
    finally { await source.source.close(); }
  });

  it('refuses source mutation after descriptor capture without repairing or converting the changed file', async () => {
    const job = await ready(), open = files.openDownloadSource.bind(files);
    const edited = Buffer.from(png); edited[edited.length - 1] ^= 1;
    let sourcePath = '';
    vi.spyOn(files, 'openDownloadSource').mockImplementation(async (...args) => {
      const result = await open(...args); sourcePath = `/proc/self/fd/${result.source.parent.fd}/${result.source.name}`;
      await fs.chmod(sourcePath, 0o600); await fs.writeFile(sourcePath, edited); return result;
    });
    await expect(images.fromUpload(workspaceId, input(job))).rejects.toMatchObject({ status: 409 });
    expect(await imageFiles()).toEqual([]); expect(await recordFiles()).toEqual([]);
  });

  it('checks the actual saved image on retry and never substitutes a new conversion for changed bytes', async () => {
    const job = await ready(), image = await images.fromUpload(workspaceId, input(job));
    const target = path.join(imageDirectory(), `${image.id}.image`), tampered = Buffer.from(png); tampered[tampered.length - 1] ^= 1;
    await fs.writeFile(target, tampered);
    await expect(images.fromUpload(workspaceId, input(job))).rejects.toMatchObject({ code: 'ATTACHMENT_CHANGED' });
    expect(await fs.readFile(target)).toEqual(tampered); expect(await imageFiles()).toHaveLength(1);
  });

  it('retains a cancellation-uncertain image and recovers its exact ID and bytes without another conversion', async () => {
    const job = await ready(), entered = gate(), release = gate(), controller = new AbortController();
    const rename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith('.upload')) { entered.release(); await release.promise; }
      await rename(from, to);
    });
    const pending = images.fromUpload(workspaceId, input(job), { signal: controller.signal });
    void pending.catch(() => undefined);
    await entered.promise; controller.abort(new Error('Controlled response disconnected.')); release.release();
    await expect(pending).rejects.toThrow('Controlled response disconnected.');
    const names = await recordFiles(); expect(names).toHaveLength(1);
    const before = JSON.parse(await fs.readFile(path.join(imageDirectory(), names[0]), 'utf8'));
    expect(before.state).toBe('uploading'); expect(await fs.readFile(path.join(imageDirectory(), `${before.id}.image`))).toEqual(png);
    await files.discard(workspaceId, { id: job.attachment!.id, sha256: hash(png) });
    const recovered = await images.fromUpload(workspaceId, input(job));
    expect(recovered.id).toBe(before.id); expect(recovered.sha256).toBe(hash(png));
    expect(await imageFiles()).toEqual([`${before.id}.image`]);
    expect(JSON.parse(await fs.readFile(path.join(imageDirectory(), names[0]), 'utf8')).state).toBe('ready');
  });

  it('preserves incomplete work as unconfirmed and does not recreate an explicitly discarded promotion', async () => {
    const job = await ready(), image = await images.fromUpload(workspaceId, input(job));
    // Keep the generic source valid beyond 24 hours so the final refusal must
    // come from the original promotion age, not a missing/expired source file.
    await files.resolve(workspaceId, [{ id: job.attachment!.id, sha256: job.attachment!.sha256 }], { retain: true });
    const recordPath = path.join(imageDirectory(), `${image.id}.json`), record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    record.state = 'uploading'; await fs.writeFile(recordPath, JSON.stringify(record));
    await fs.unlink(path.join(imageDirectory(), `${image.id}.image`));
    await fs.writeFile(path.join(imageDirectory(), `${image.id}.upload`), png.subarray(0, 12));
    await expect(images.fromUpload(workspaceId, input(job))).rejects.toMatchObject({ code: 'IMAGE_PROMOTION_UNCONFIRMED' });
    expect(await fs.readFile(path.join(imageDirectory(), `${image.id}.upload`))).toEqual(png.subarray(0, 12));
    expect(await recordFiles()).toHaveLength(1);
    await images.discard(workspaceId, image.id);
    expect(await imageFiles()).toEqual([]);
    expect(JSON.parse(await fs.readFile(recordPath, 'utf8')).state).toBe('discarded');
    for (const result of await Promise.allSettled([images.fromUpload(workspaceId, input(job)), images.fromUpload(workspaceId, input(job))])) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 410, code: 'IMAGE_UPLOAD_DISCARDED' });
    }
    expect(await imageFiles()).toEqual([]); expect(await recordFiles()).toHaveLength(1);
    now += IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs + 1; await images.cleanupExpired();
    expect(await recordFiles()).toEqual([]);
    expect((await files.get(job.id)).state).toBe('ready');
    await expect(images.fromUpload(workspaceId, input(job))).rejects.toMatchObject({ status: 410, code: 'IMAGE_UPLOAD_EXPIRED' });
    expect(await recordFiles()).toEqual([]); expect(await imageFiles()).toEqual([]); expect(bucket.publications).toBe(1);
    const source = await files.openDownloadSource(workspaceId, { id: job.attachment!.id, sha256: job.attachment!.sha256 });
    try { expect(await source.source.handle.readFile()).toEqual(png); }
    finally { await source.source.close(); }
  });

  it('fences an in-flight source read during permanent workspace cleanup and never resurrects its image', async () => {
    const job = await ready(), entered = gate(), release = gate(), open = files.openDownloadSource.bind(files);
    vi.spyOn(files, 'openDownloadSource').mockImplementation(async (...args) => { const result = await open(...args); entered.release(); await release.promise; return result; });
    const pending = images.fromUpload(workspaceId, input(job)); void pending.catch(() => undefined);
    await entered.promise;
    const cleaned = ImageAttachmentService.cleanupWorkspace(ctx, workspaceId);
    try {
      await expect.poll(async () => fs.lstat(path.join(ctx.config.stateDir, 'image-attachments-v1', `${hash(workspaceId)}.deleted.json`)).then(() => true, () => false)).toBe(true);
    } finally { release.release(); }
    await expect(pending).rejects.toBeInstanceOf(Error);
    expect(await cleaned).toMatchObject({ workspaceId, permanentlyFenced: true });
    expect(await imageFiles()).toEqual([]); expect(await recordFiles()).toEqual([]);
    await expect(images.fromUpload(workspaceId, input(job))).rejects.toMatchObject({ status: 410, code: 'ATTACHMENT_WORKSPACE_DELETED' });
  });

  it('cleans retained promoted images and discard receipts without touching another workspace', async () => {
    const first = await ready(), second = await ready(png, 'second.png');
    const retained = await images.fromUpload(workspaceId, input(first)), removed = await images.fromUpload(workspaceId, input(second));
    await images.resolve(workspaceId, [{ id: retained.id, sha256: retained.sha256 }], { retain: true });
    await images.discard(workspaceId, removed.id);
    const other = await ctx.workspaces.create({ name: 'Unrelated photos', initializeGit: false });
    const otherUpload = await ready(png, 'other.png', other.id), otherImage = await images.fromUpload(other.id, input(otherUpload));
    expect(await recordFiles()).toHaveLength(2);
    const cleanup = await ImageAttachmentService.cleanupWorkspace(ctx, workspaceId);
    expect(cleanup).toMatchObject({ attachmentsRemoved: 2, permanentlyFenced: true });
    expect(await recordFiles()).toEqual([]); expect(await imageFiles()).toEqual([]);
    expect((await images.preview(other.id, otherImage.id, otherImage.sha256)).bytes).toEqual(png);
  });

  it('authenticates the JSON promotion route, rejects foreign origins and serves exact bytes from its returned reference', async () => {
    const job = await ready(), auth = new AuthService(ctx); auths.push(auth); await auth.initialize();
    const app = express(); app.use('/api', auth.protectMutations); app.use('/api/session', express.json({ limit: '4kb' }));
    app.use('/api', auth.router(), auth.requireSession, express.json({ limit: '4kb' }), createImageAttachmentsRouter(ctx));
    const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
      if (error instanceof HttpError) res.status(error.status).json({ error: error.message, code: error.code });
      else res.status(500).json({ error: 'Controlled HTTP failure.' });
    }; app.use(errors);
    const server = createServer(app); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, route = `${origin}/api/workspaces/${workspaceId}/attachments/from-upload`;
    const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' };
    expect((await fetch(route, { method: 'POST', headers, body: JSON.stringify(input(job)) })).status).toBe(401);
    const login = await fetch(`${origin}/api/session`, { method: 'POST', headers, body: JSON.stringify({ password: ctx.config.password }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0], authorized = { ...headers, Cookie: cookie };
    expect((await fetch(route, { method: 'POST', headers: { ...authorized, Origin: 'https://other.invalid' }, body: JSON.stringify(input(job)) })).status).toBe(403);
    expect((await fetch(route, { method: 'POST', headers: authorized, body: JSON.stringify({ ...input(job), bytes: png.toString('base64') }) })).status).toBe(400);
    const response = await fetch(route, { method: 'POST', headers: authorized, body: JSON.stringify(input(job)) });
    expect(response.status).toBe(201); const image = await response.json();
    expect(image.sha256).toBe(hash(png));
    const preview = await fetch(origin + image.previewUrl, { headers: { Cookie: cookie } });
    expect(preview.status).toBe(200); expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
    expect((await fetch(origin + image.previewUrl)).status).toBe(401);
    expect(await recordFiles()).toEqual([`${image.id}.json`]);
  });
});
