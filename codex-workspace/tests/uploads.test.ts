import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import express, { type ErrorRequestHandler } from 'express';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { AuthService } from '../server/auth';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { MAX_UPLOAD_BYTES, WorkspaceService } from '../server/workspaces';
import { workspaceIsBusy } from '../server/worktrees/activity';
import { withWorkspaceFileMutation } from '../server/file-transfers/queue';
import { DOWNLOAD_RETENTION_MS, PUBLIC_DOWNLOAD_BUCKET } from '../server/downloads/bucket';
import type { BucketObject } from '../server/downloads/types';
import { createUploadRouter, initializeUploads } from '../server/uploads';
import { UploadService, type UploadServiceOptions } from '../server/uploads/service';
import { cleanUploadTemporary, installUploadFile, validateUploadDestination } from '../server/uploads/install';
import type { StoredUploadJob, UploadBucket, UploadJob, UploadJobState } from '../server/uploads/types';
import { UPLOAD_SESSION_MS } from '../server/uploads/validation';

const TOKEN = 'hf_SYNTHETIC_upload_test_writer_secret';
const CAPABILITY = 'eyJhbGciOiJSUzI1NiJ9.eyJ0ZXN0Ijp0cnVlfQ.c3ludGhldGlj';
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function abortable(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
    void promise.then(() => { signal.removeEventListener('abort', aborted); resolve(); }, reject);
  });
}

class MemoryUploadBucket implements UploadBucket {
  readonly id = PUBLIC_DOWNLOAD_BUCKET;
  readonly cas = new Map<string, Buffer>();
  readonly objects = new Map<string, BucketObject & { bytes: Buffer }>();
  readonly deletions: string[][] = [];
  readonly failedDeletes = new Set<string>();
  requests = 0;
  capabilityLifetimeSeconds = 900;
  publications = 0;
  listCalls = 0;
  reads = 0;
  listing = false;
  deleteWhileListing = false;
  failList = false;
  readGate?: ReturnType<typeof gate>;
  publishGate?: ReturnType<typeof gate>;
  capabilityGate?: ReturnType<typeof gate>;
  afterRead?: (objectPath: string) => Promise<Buffer | undefined>;
  afterListed?: (object: BucketObject) => void;
  constructor(private readonly now: () => number) {}
  stage(bytes: Buffer | string) {
    const content = Buffer.from(bytes);
    const xetHash = hash(Buffer.concat([Buffer.from('synthetic-xet:'), content]));
    this.cas.set(xetHash, content);
    return { xetHash, sha256: hash(content) };
  }
  add(objectPath: string, bytes: Buffer | string, timestamp = this.now()) {
    const content = Buffer.from(bytes);
    const { xetHash } = this.stage(content);
    this.objects.set(objectPath, { path: objectPath, type: 'file', size: content.length, uploadedAt: new Date(timestamp).toISOString(), xetHash, bytes: content });
  }
  async capability(_id: string, signal: AbortSignal) {
    this.requests++;
    if (this.capabilityGate) await abortable(this.capabilityGate.promise, signal);
    signal.throwIfAborted();
    return { accessToken: CAPABILITY, casUrl: 'https://cas-server-direct.xethub.hf.co', exp: Math.floor(this.now() / 1000) + this.capabilityLifetimeSeconds };
  }
  async *list(signal: AbortSignal) {
    this.listCalls++;
    if (this.failList) throw new Error(`Provider failed with ${TOKEN}`);
    const snapshot = [...this.objects.values()].map(object => ({ ...object }));
    this.listing = true;
    try {
      for (const object of snapshot) { signal.throwIfAborted(); yield object; this.afterListed?.(object); }
    } finally { this.listing = false; }
  }
  async get(objectPath: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const object = this.objects.get(objectPath);
    return object && { ...object };
  }
  async publish(input: Parameters<UploadBucket['publish']>[0]) {
    if (this.publishGate) await abortable(this.publishGate.promise, input.signal);
    input.signal.throwIfAborted();
    const bytes = this.cas.get(input.xetHash);
    if (!bytes) throw new Error('Unknown synthetic CAS object.');
    const object = { path: input.objectPath, type: 'file' as const, size: bytes.length, xetHash: input.xetHash, uploadedAt: new Date(this.now()).toISOString(), bytes };
    this.objects.set(object.path, object); this.publications++;
    return { ...object };
  }
  async read(input: Parameters<UploadBucket['read']>[0]) {
    this.reads++;
    if (this.readGate) await abortable(this.readGate.promise, input.signal);
    input.signal.throwIfAborted();
    const object = this.objects.get(input.objectPath);
    if (!object) throw new Error('Staged object missing.');
    input.onProgress?.(object.bytes.length);
    return (await this.afterRead?.(input.objectPath)) ?? Buffer.from(object.bytes);
  }
  async delete(objectPaths: string[], signal: AbortSignal) {
    signal.throwIfAborted();
    this.deleteWhileListing ||= this.listing;
    this.deletions.push([...objectPaths]);
    const failed = objectPaths.filter(item => this.failedDeletes.has(item));
    const deleted = objectPaths.filter(item => !this.failedDeletes.has(item));
    for (const key of deleted) this.objects.delete(key);
    return { deleted, failed };
  }
}

function context(directory: string): AppContext {
  const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'synthetic-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
  config.downloadBucket = PUBLIC_DOWNLOAD_BUCKET; config.downloadToken = TOKEN;
  const store = new JsonStore(config.stateDir);
  return {
    config, store, secrets: new SecretStore(store, config.encryptionKey), workspaces: new WorkspaceService(config, store), events: new EventEmitter(),
    settings: async () => ({ ...defaultSettings }), saveSettings: async patch => ({ ...defaultSettings, ...patch }), providerKey: async () => undefined,
  };
}

let directory: string;
let ctx: AppContext;
let workspaceId: string;
let workspacePath: string;
let now: number;
let bucket: MemoryUploadBucket;
const services: UploadService[] = [];
const servers: Server[] = [];
const authServices: AuthService[] = [];

async function service(options: UploadServiceOptions = {}, selected = ctx): Promise<UploadService> {
  const uploads = new UploadService(selected, { bucket, now: () => now, ...options });
  services.push(uploads); await uploads.initialize(); return uploads;
}
async function waitForJob(uploads: UploadService, id: string, accepted: UploadJobState[] = ['ready', 'failed', 'cancelled', 'expired']): Promise<UploadJob> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const job = await uploads.get(id);
    if (accepted.includes(job.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Upload did not reach expected state: ${(await uploads.get(id)).state}`);
}
async function importBytes(uploads: UploadService, name: string, bytes: Buffer | string): Promise<UploadJob> {
  const content = Buffer.from(bytes);
  const job = await uploads.reserve(workspaceId, { path: name, size: content.length });
  await uploads.complete(job.id, bucket.stage(content));
  return waitForJob(uploads, job.id);
}

beforeEach(async () => {
  now = Date.now(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-incoming-upload-tests-'));
  ctx = context(directory); await ctx.workspaces.initialize();
  const workspace = await ctx.workspaces.create({ name: 'Incoming uploads' });
  workspaceId = workspace.id; workspacePath = workspace.path; bucket = new MemoryUploadBucket(() => now);
});
afterEach(async () => {
  vi.restoreAllMocks();
  bucket.readGate?.resolve(); bucket.publishGate?.resolve(); bucket.capabilityGate?.resolve();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await Promise.allSettled(authServices.splice(0).map(auth => auth.close()));
  await Promise.allSettled(services.splice(0).map(uploads => uploads.close()));
  vi.useRealTimers();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('persistent incoming uploads', () => {
  it('imports exact binary/Unicode bytes, reports real progress and manual file intent, and never persists capabilities', async () => {
    const uploads = await service();
    const content = Buffer.from([0, 255, 128, 10, 17, 49]);
    const job = await uploads.reserve(workspaceId, { path: 'rapport é 文.bin', size: content.length });
    expect(job).toMatchObject({ state: 'reserved', bytesProcessed: 0, bucket: PUBLIC_DOWNLOAD_BUCKET });
    expect(bucket.publications).toBe(0);
    expect((await uploads.capability(job.id)).accessToken).toBe(CAPABILITY);
    const events: UploadJob[] = [];
    const manual: unknown[] = [];
    ctx.events.on(`upload:${job.id}`, event => events.push(event));
    ctx.events.on('workspace:manual-intent', event => manual.push(event));
    const complete = bucket.stage(content);
    await uploads.complete(job.id, complete);
    const ready = await waitForJob(uploads, job.id);
    expect(ready).toMatchObject({ state: 'ready', size: content.length, bytesProcessed: content.length, version: hash(content), entry: { path: job.path, kind: 'file', size: content.length } });
    expect(await fs.readFile(path.join(workspacePath, job.path))).toEqual(content);
    expect(events.some(event => event.state === 'importing' && event.bytesProcessed === content.length)).toBe(true);
    expect(manual).toEqual([
      { workspaceId, operationId: job.id, paths: [job.path], phase: 'start' },
      { workspaceId, operationId: job.id, paths: [job.path], phase: 'end' },
    ]);
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspaceId)).toBe(false);
    const saved = await fs.readFile(path.join(ctx.config.stateDir, 'upload-jobs-v1.json'), 'utf8');
    expect(saved).toContain(job.path); expect(saved).toContain(hash(content));
    expect(saved).not.toContain(TOKEN); expect(saved).not.toContain(CAPABILITY);
    expect(JSON.stringify(ready)).not.toMatch(/accessToken|capabilityRequests|commitStartedAt|xetHash|sha256/);
    expect((await fs.readdir(workspacePath)).some(name => name.startsWith('.codex-write-'))).toBe(false);
  });

  it('supports empty files, bounds input/session counts, and never accepts client-selected publication fields', async () => {
    const uploads = await service({ maxActiveSessions: 2 });
    expect((await importBytes(uploads, 'empty.txt', '')).state).toBe('ready');
    for (const input of [
      { path: '../escape', size: 1 }, { path: '/absolute', size: 1 }, { path: 'bad\\name', size: 1 },
      { path: '.codex-write-owned', size: 1 }, { path: 'file', size: -1 }, { path: 'file', size: 0.5 },
      { path: 'file', size: 1, objectPath: 'exports/stolen' }, { path: 'file', size: 1, bucket: 'alvin3y12/data' },
    ]) await expect(uploads.reserve(workspaceId, input)).rejects.toBeInstanceOf(HttpError);
    await expect(uploads.reserve(workspaceId, { path: 'big', size: MAX_UPLOAD_BYTES + 1 })).rejects.toMatchObject({ status: 413 });
    const first = await uploads.reserve(workspaceId, { path: 'one', size: 1 });
    await expect(uploads.reserve(workspaceId, { path: 'one', size: 1 })).rejects.toMatchObject({ code: 'UPLOAD_DESTINATION_BUSY' });
    await uploads.reserve(workspaceId, { path: 'two', size: 1 });
    await expect(uploads.reserve(workspaceId, { path: 'three', size: 1 })).rejects.toMatchObject({ status: 429 });
    await uploads.cancel(first.id);
    expect((await uploads.reserve(workspaceId, { path: 'three', size: 1 })).state).toBe('reserved');
  });

  it('caches concurrent capabilities per reservation and denies delivery after cancellation or session expiry', async () => {
    const uploads = await service();
    const job = await uploads.reserve(workspaceId, { path: 'capability.txt', size: 1 });
    bucket.capabilityGate = gate();
    const pending = [uploads.capability(job.id), uploads.capability(job.id)];
    while (bucket.requests === 0) await new Promise(resolve => setTimeout(resolve, 1));
    bucket.capabilityGate.resolve();
    const result = await Promise.all(pending);
    expect(result[0]).toEqual(result[1]); expect(bucket.requests).toBe(1);
    await uploads.capability(job.id); expect(bucket.requests).toBe(1);
    // Force real expiry before another provider issuance; a new file normally reuses the
    // already bucket-scoped permission without minting another credential.
    now += 15 * 60_000;
    const second = await uploads.reserve(workspaceId, { path: 'cancel-capability', size: 1 });
    bucket.capabilityGate = gate();
    const denied = uploads.capability(second.id);
    while (bucket.requests < 2) await new Promise(resolve => setTimeout(resolve, 1));
    await uploads.cancel(second.id); bucket.capabilityGate.resolve();
    await expect(denied).rejects.toMatchObject({ code: 'UPLOAD_SESSION_CLOSED' });
    now += UPLOAD_SESSION_MS + 1;
    expect((await uploads.get(job.id)).state).toBe('expired');
    await expect(uploads.capability(job.id)).rejects.toMatchObject({ code: 'UPLOAD_SESSION_CLOSED' });
  });

  it('rejects actual size, byte digest and remote hash changes before any workspace write', async () => {
    const uploads = await service();
    const oversized = await uploads.reserve(workspaceId, { path: 'wrong-size.bin', size: 2 });
    await uploads.complete(oversized.id, bucket.stage('four'));
    expect(await waitForJob(uploads, oversized.id)).toMatchObject({ state: 'failed', error: { code: 'UPLOAD_SIZE_MISMATCH' } });
    const wrongBytes = await uploads.reserve(workspaceId, { path: 'wrong-bytes.bin', size: 4 });
    bucket.afterRead = async () => Buffer.from('evil');
    await uploads.complete(wrongBytes.id, bucket.stage('safe'));
    expect(await waitForJob(uploads, wrongBytes.id)).toMatchObject({ state: 'failed', error: { code: 'UPLOAD_CONTENT_MISMATCH' } });
    bucket.afterRead = async objectPath => { bucket.objects.get(objectPath)!.xetHash = 'f'.repeat(64); return Buffer.from('safe'); };
    const replaced = await uploads.reserve(workspaceId, { path: 'replaced.bin', size: 4 });
    await uploads.complete(replaced.id, bucket.stage('safe'));
    expect(await waitForJob(uploads, replaced.id)).toMatchObject({ state: 'failed', error: { code: 'UPLOAD_STAGE_CONFLICT' } });
    for (const job of [oversized, wrongBytes, replaced]) await expect(fs.stat(path.join(workspacePath, job.path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists the capability issuance budget across cancellation and restart', async () => {
    const uploads = await service({ maxActiveSessions: 1 });
    // Very short but valid provider capabilities exercise actual reissuance, rather than reuse.
    bucket.capabilityLifetimeSeconds = 62;
    for (let index = 0; index < 4; index++) {
      const job = await uploads.reserve(workspaceId, { path: `capability-${index}.txt`, size: 1 });
      await uploads.capability(job.id); await uploads.cancel(job.id);
      now += 3000;
    }
    const limited = await uploads.reserve(workspaceId, { path: 'limited.txt', size: 1 });
    await expect(uploads.capability(limited.id)).rejects.toMatchObject({ status: 429, code: 'UPLOAD_CAPABILITY_LIMIT' });
    expect(bucket.requests).toBe(4);
    await uploads.close();
    const restarted = await service({ maxActiveSessions: 1 }, context(directory));
    await expect(restarted.capability(limited.id)).rejects.toMatchObject({ code: 'UPLOAD_CAPABILITY_LIMIT' });
    expect(bucket.requests).toBe(4);
  });

  it('coalesces bucket-scoped permissions across concurrent file reservations', async () => {
    const uploads = await service();
    const jobs = await Promise.all(['a', 'b', 'c'].map(name => uploads.reserve(workspaceId, { path: `${name}.txt`, size: 1 })));
    bucket.capabilityGate = gate();
    const pending = Promise.all(jobs.map(job => uploads.capability(job.id)));
    while (bucket.requests === 0) await new Promise(resolve => setTimeout(resolve, 1));
    bucket.capabilityGate.resolve();
    const capabilities = await pending;
    expect(bucket.requests).toBe(1);
    expect(capabilities.every(value => value.accessToken === CAPABILITY && value.exp === capabilities[0].exp)).toBe(true);
    const saved = await ctx.store.read<{ capabilityIssuedAt: number[] }>('upload-jobs-v1', { capabilityIssuedAt: [] });
    expect(saved.capabilityIssuedAt).toHaveLength(1);
  });

  it('supports 1000 sequential folder reservations without extending or persisting the reused JWT', async () => {
    const uploads = await service();
    let first: { accessToken: string; exp: number } | undefined;
    for (let index = 0; index < 1000; index++) {
      const job = await uploads.reserve(workspaceId, { path: `folder-file-${index}.txt`, size: 1 });
      const capability = await uploads.capability(job.id);
      first ??= capability;
      expect(capability.accessToken).toBe(first.accessToken); expect(capability.exp).toBe(first.exp);
      await uploads.cancel(job.id);
    }
    expect(bucket.requests).toBe(1);
    const saved = await fs.readFile(path.join(ctx.config.stateDir, 'upload-jobs-v1.json'), 'utf8');
    expect(JSON.parse(saved).capabilityIssuedAt).toHaveLength(1);
    expect(saved).not.toContain(CAPABILITY); expect(saved).not.toContain(TOKEN);
  }, 60_000);

  it('reissues stale or failed bucket capabilities and keeps the per-reservation grant limit', async () => {
    const uploads = await service();
    const first = await uploads.reserve(workspaceId, { path: 'first-permission.txt', size: 1 });
    const original = await uploads.capability(first.id); await uploads.cancel(first.id);
    now += 15 * 60_000;
    const next = await uploads.reserve(workspaceId, { path: 'new-permission.txt', size: 1 });
    const issue = vi.spyOn(bucket, 'capability').mockRejectedValueOnce(new Error(`Provider failed with ${TOKEN}`));
    await expect(uploads.capability(next.id)).rejects.toMatchObject({ code: 'UPLOAD_BUCKET_REQUEST_FAILED' });
    expect((await uploads.capability(next.id)).exp).toBeGreaterThan(original.exp);
    expect(issue).toHaveBeenCalledTimes(2);
    issue.mockRestore(); await uploads.cancel(next.id);
    now += 15 * 60_000;
    bucket.capabilityLifetimeSeconds = 62;
    const limited = await uploads.reserve(workspaceId, { path: 'bounded-refresh.txt', size: 1 });
    for (let index = 0; index < 4; index++) { await uploads.capability(limited.id); now += 3000; }
    await expect(uploads.capability(limited.id)).rejects.toMatchObject({ code: 'UPLOAD_CAPABILITY_LIMIT' });
  });

  it('rolls back failed durable admission and imports the same session on retry after storage recovery', async () => {
    const uploads = await service();
    const job = await uploads.reserve(workspaceId, { path: 'store-failed.txt', size: 4 });
    const write = vi.spyOn(ctx.store, 'write').mockRejectedValueOnce(new Error(`Storage failed with ${TOKEN}`));
    const contents = bucket.stage('safe');
    await expect(uploads.complete(job.id, contents)).rejects.toMatchObject({ code: 'UPLOAD_STATE_ERROR' });
    expect(await uploads.get(job.id)).toMatchObject({ state: 'reserved' });
    expect(uploads.status()).toMatchObject({ ready: false, error: { code: 'UPLOAD_STATE_ERROR' } });
    expect(bucket.publications).toBe(0); expect(JSON.stringify(await uploads.get(job.id))).not.toContain(TOKEN);
    write.mockRestore(); expect((await uploads.cleanup()).ready).toBe(true);
    await uploads.complete(job.id, contents);
    expect((await waitForJob(uploads, job.id)).state).toBe('ready');
    expect(bucket.publications).toBe(1);
    expect(await fs.readFile(path.join(workspacePath, job.path), 'utf8')).toBe('safe');
  });

  it('protects existing and late-created files and makes finalization idempotent only for the same contents', async () => {
    const uploads = await service();
    await fs.writeFile(path.join(workspacePath, 'existing.txt'), 'user edits');
    await expect(uploads.reserve(workspaceId, { path: 'existing.txt', size: 4 })).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    const job = await uploads.reserve(workspaceId, { path: 'late.txt', size: 4 });
    bucket.readGate = gate();
    const content = bucket.stage('safe');
    await uploads.complete(job.id, content);
    await waitForJob(uploads, job.id, ['importing']);
    await uploads.complete(job.id, content);
    await expect(uploads.complete(job.id, bucket.stage('else'))).rejects.toMatchObject({ code: 'UPLOAD_ALREADY_SUBMITTED' });
    await fs.writeFile(path.join(workspacePath, 'late.txt'), 'terminal content');
    bucket.readGate.resolve();
    expect(await waitForJob(uploads, job.id)).toMatchObject({ state: 'failed', error: { code: 'FILE_EXISTS' } });
    expect(bucket.publications).toBe(1);
    expect(await fs.readFile(path.join(workspacePath, 'late.txt'), 'utf8')).toBe('terminal content');
  });

  it('limits parallel imports, cancels staged transfers, and cannot cancel a saved workspace result', async () => {
    const uploads = await service({ concurrency: 1 });
    bucket.readGate = gate();
    const first = await uploads.reserve(workspaceId, { path: 'first.txt', size: 4 });
    const second = await uploads.reserve(workspaceId, { path: 'second.txt', size: 4 });
    const content = bucket.stage('safe');
    await uploads.complete(first.id, content); await uploads.complete(second.id, content);
    await waitForJob(uploads, first.id, ['importing']);
    expect((await uploads.get(second.id)).state).toBe('queued'); expect(bucket.publications).toBe(1);
    expect((await uploads.cancel(first.id)).state).toBe('cancelled');
    bucket.readGate.resolve();
    const ready = await waitForJob(uploads, second.id);
    expect(ready.state).toBe('ready'); expect((await uploads.cancel(second.id)).state).toBe('ready');
    await uploads.cleanup();
    expect(bucket.objects.has(first.objectPath)).toBe(false);
    expect(bucket.objects.has(second.objectPath)).toBe(true);
    await expect(fs.stat(path.join(workspacePath, first.path))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(workspacePath, second.path), 'utf8')).toBe('safe');
  });

  it('waits for a create-only commit already in progress when cancelled and drains it on shutdown', async () => {
    const uploads = await service();
    const entered = gate(); const finish = gate();
    const nativeCopy = fs.copyFile.bind(fs);
    vi.spyOn(fs, 'copyFile').mockImplementation(async (...args) => { entered.resolve(); await finish.promise; return nativeCopy(...args); });
    const job = await uploads.reserve(workspaceId, { path: 'committed.txt', size: 4 });
    await uploads.complete(job.id, bucket.stage('safe')); await entered.promise;
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspaceId)).toBe(true);
    let closed = false;
    const cancelled = uploads.cancel(job.id);
    const shutdown = uploads.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    finish.resolve();
    expect((await cancelled).state).toBe('ready'); await shutdown;
    expect(closed).toBe(true);
    expect(await fs.readFile(path.join(workspacePath, job.path), 'utf8')).toBe('safe');
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspaceId)).toBe(false);
  });

  it('waits for an admitted workspace mutation and preserves its late-created destination', async () => {
    const uploads = await service();
    const entered = gate(); const finish = gate(); const waiting = gate();
    let importAnnounced = false, precedingFinished = false, enteredWhileBlocked = false;
    const resolvePath = ctx.workspaces.resolvePath.bind(ctx.workspaces);
    vi.spyOn(ctx.workspaces, 'resolvePath').mockImplementation((...args) => {
      if (importAnnounced && !precedingFinished) enteredWhileBlocked = true;
      return resolvePath(...args);
    });
    const job = await uploads.reserve(workspaceId, { path: 'queued-destination.txt', size: 4 });
    const preceding = withWorkspaceFileMutation(ctx.config.workspacesDir, workspaceId, async () => {
      entered.resolve(); await finish.promise;
      await fs.writeFile(path.join(workspacePath, job.path), 'preceding mutation');
      precedingFinished = true;
    });
    await entered.promise;
    const intent = (event: { operationId: string; phase: string }) => {
      if (event.operationId === job.id && event.phase === 'start') { importAnnounced = true; waiting.resolve(); }
    };
    ctx.events.on('workspace:manual-intent', intent);
    try {
      await uploads.complete(job.id, bucket.stage('safe')); await waiting.promise;
      expect(enteredWhileBlocked).toBe(false);
      expect((await fs.readdir(workspacePath)).some(name => name.startsWith('.codex-write-upload-'))).toBe(false);
      finish.resolve(); await preceding;
      expect(await waitForJob(uploads, job.id)).toMatchObject({ state: 'failed', error: { code: 'FILE_EXISTS' } });
      expect(await fs.readFile(path.join(workspacePath, job.path), 'utf8')).toBe('preceding mutation');
    } finally { finish.resolve(); await preceding; ctx.events.off('workspace:manual-intent', intent); }
  });

  it('serializes a real editor save behind the upload filesystem commit', async () => {
    const uploads = await service();
    const entered = gate(); const finish = gate();
    const nativeCopy = fs.copyFile.bind(fs);
    vi.spyOn(fs, 'copyFile').mockImplementation(async (...args) => { entered.resolve(); await finish.promise; return nativeCopy(...args); });
    const job = await uploads.reserve(workspaceId, { path: 'editor-after-upload.txt', size: 4 });
    await uploads.complete(job.id, bucket.stage('safe')); await entered.promise;
    const editorReads = vi.spyOn(ctx.workspaces, 'resolvePath');
    let saved = false;
    const editing = ctx.workspaces.writeFile(workspaceId, job.path, 'editor content').then(result => { saved = true; return result; });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(saved).toBe(false); expect(editorReads).not.toHaveBeenCalled();
      finish.resolve();
      expect((await waitForJob(uploads, job.id)).state).toBe('ready');
      await editing;
      expect(await fs.readFile(path.join(workspacePath, job.path), 'utf8')).toBe('editor content');
    } finally { finish.resolve(); await editing; }
  });

  it('aborts pending imports on shutdown and does not write when a stalled external request later finishes', async () => {
    const uploads = await service();
    bucket.readGate = gate();
    const job = await uploads.reserve(workspaceId, { path: 'stopped.txt', size: 4 });
    await uploads.complete(job.id, bucket.stage('safe')); await waitForJob(uploads, job.id, ['importing']);
    await uploads.close(); bucket.readGate.resolve();
    expect(await uploads.get(job.id)).toMatchObject({ state: 'failed', error: { code: 'UPLOAD_INTERRUPTED' } });
    await expect(fs.stat(path.join(workspacePath, job.path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('expires public staging after 24 hours on startup while keeping the imported file and ready status', async () => {
    const uploads = await service();
    const ready = await importBytes(uploads, 'persistent.txt', 'permanent workspace bytes');
    await uploads.close(); now += DOWNLOAD_RETENTION_MS + 1;
    const restarted = await service({}, context(directory));
    expect(bucket.objects.size).toBe(0);
    expect(await restarted.get(ready.id)).toMatchObject({ state: 'ready', version: ready.version, stagingRemovedAt: new Date(now).toISOString() });
    expect(await fs.readFile(path.join(workspacePath, ready.path), 'utf8')).toBe('permanent workspace bytes');
    expect(restarted.status().ready).toBe(true);
  });

  it('cleans orphan staging by actual upload time, excludes downloads/data, and retries partial failures visibly', async () => {
    const oldPath = `imports/${randomUUID()}/orphan.txt`;
    const retryPath = `imports/${randomUUID()}/retry.txt`;
    const fresh = `imports/${randomUUID()}/fresh.txt`;
    bucket.add(oldPath, 'old', now - DOWNLOAD_RETENTION_MS - 1);
    bucket.add(retryPath, 'old', now - DOWNLOAD_RETENTION_MS - 1);
    bucket.add(fresh, 'new'); bucket.add('exports/unrelated/file.txt', 'old download', now - DOWNLOAD_RETENTION_MS - 1);
    bucket.failedDeletes.add(retryPath);
    const uploads = await service();
    expect(bucket.objects.has(oldPath)).toBe(false); expect(bucket.objects.has(retryPath)).toBe(true);
    expect(bucket.objects.has(fresh)).toBe(true); expect(bucket.objects.has('exports/unrelated/file.txt')).toBe(true);
    expect(uploads.status()).toMatchObject({ ready: false, error: { code: 'UPLOAD_CLEANUP_FAILED' } });
    expect(bucket.deleteWhileListing).toBe(false);
    bucket.failedDeletes.clear(); expect((await uploads.cleanup()).ready).toBe(true);
    expect(bucket.objects.has(retryPath)).toBe(false);
    bucket.failList = true; await uploads.cleanup();
    expect(JSON.stringify(uploads.status())).not.toContain(TOKEN);
    await expect(uploads.reserve(workspaceId, { path: 'blocked.txt', size: 1 })).rejects.toMatchObject({ status: 503 });
  });

  it('preserves unknown-timestamp staging and remote objects replaced during a cleanup scan', async () => {
    const unknown = `imports/${randomUUID()}/unknown.txt`;
    const refreshed = `imports/${randomUUID()}/refresh.txt`;
    bucket.add(unknown, 'unknown'); delete bucket.objects.get(unknown)!.uploadedAt;
    bucket.add(refreshed, 'old', now - DOWNLOAD_RETENTION_MS - 1);
    bucket.afterListed = object => { if (object.path === refreshed) bucket.add(refreshed, 'new'); };
    const uploads = await service();
    expect(uploads.status()).toMatchObject({ ready: false, unknownTimestampCount: 1, error: { code: 'UPLOAD_TIMESTAMP_UNKNOWN' } });
    expect(bucket.objects.get(refreshed)?.bytes.toString()).toBe('new'); expect(bucket.objects.has(unknown)).toBe(true);
    expect(bucket.deletions.flat()).toEqual([]);
  });

  it('runs scheduled cleanup without requiring another upload request', async () => {
    const uploads = await service({ cleanupIntervalMs: 30 });
    const ready = await importBytes(uploads, 'timer.txt', 'temporary public copy');
    const calls = bucket.listCalls;
    now += DOWNLOAD_RETENTION_MS + 1;
    const deadline = Date.now() + 1000;
    while (bucket.objects.has(ready.objectPath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    expect(bucket.listCalls).toBeGreaterThan(calls); expect(bucket.objects.has(ready.objectPath)).toBe(false);
    expect((await uploads.get(ready.id)).state).toBe('ready');
    expect(await fs.readFile(path.join(workspacePath, ready.path), 'utf8')).toBe('temporary public copy');
  });

  it('reconciles a completed commit from durable intent after restart without replaying or replacing any write', async () => {
    const uploads = await service();
    const completed = await uploads.reserve(workspaceId, { path: 'completed-before-crash.txt', size: 4 });
    const changed = await uploads.reserve(workspaceId, { path: 'changed-after-crash.txt', size: 4 });
    const notCreated = await uploads.reserve(workspaceId, { path: 'not-created.txt', size: 4 });
    const digests = bucket.stage('safe');
    await uploads.close();
    const saved = await ctx.store.read<{ format: 1; jobs: StoredUploadJob[]; capabilityIssuedAt: number[] }>('upload-jobs-v1', { format: 1, jobs: [], capabilityIssuedAt: [] });
    for (const job of saved.jobs) {
      Object.assign(job, digests, { state: 'importing', publishStartedAt: new Date(now).toISOString(), commitStartedAt: new Date(now).toISOString() });
      bucket.add(job.objectPath, 'safe');
      await fs.writeFile(path.join(workspacePath, `.codex-write-upload-${job.id}`), 'temporary');
    }
    await ctx.store.write('upload-jobs-v1', saved);
    await fs.writeFile(path.join(workspacePath, completed.path), 'safe');
    await fs.writeFile(path.join(workspacePath, changed.path), 'user edits');
    const restarted = await service({}, context(directory));
    expect(await restarted.get(completed.id)).toMatchObject({ state: 'ready', version: digests.sha256 });
    expect(await restarted.get(changed.id)).toMatchObject({ state: 'failed', error: { code: 'UPLOAD_INTERRUPTED' } });
    expect(await restarted.get(notCreated.id)).toMatchObject({ state: 'failed', error: { code: 'UPLOAD_INTERRUPTED' } });
    expect(await fs.readFile(path.join(workspacePath, changed.path), 'utf8')).toBe('user edits');
    await expect(fs.stat(path.join(workspacePath, notCreated.path))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(workspacePath)).some(name => name.startsWith('.codex-write-'))).toBe(false);
    expect(bucket.publications).toBe(0);
  });

  it('preserves unreadable prior state and refuses data-bucket configuration without network access', async () => {
    await fs.writeFile(path.join(ctx.config.stateDir, 'upload-jobs-v1.json'), '{broken data');
    const uploads = await service(); await uploads.close();
    expect(uploads.status()).toMatchObject({ ready: false, error: { code: 'UPLOAD_STATE_ERROR' } });
    expect(await fs.readFile(path.join(ctx.config.stateDir, 'upload-jobs-v1.json'), 'utf8')).toBe('{broken data');
    await fs.unlink(path.join(ctx.config.stateDir, 'upload-jobs-v1.json'));
    const selected = context(directory); selected.config.downloadBucket = 'alvin3y12/data';
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not be called.'));
    const unsafe = new UploadService(selected); services.push(unsafe); await unsafe.initialize();
    expect(unsafe.status()).toMatchObject({ enabled: false, error: { code: 'UPLOAD_BUCKET_UNSAFE' } });
    expect(network).not.toHaveBeenCalled();
  });
});

describe('descriptor-bound create-only upload installation', () => {
  it('rejects symlink parents and a final symlink, including links pointing inside the workspace', async () => {
    const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
    await fs.mkdir(path.join(workspacePath, 'real'));
    await fs.symlink(outside, path.join(workspacePath, 'outside-link'));
    await fs.symlink(path.join(workspacePath, 'real'), path.join(workspacePath, 'inside-link'));
    await fs.symlink(path.join(outside, 'new.txt'), path.join(workspacePath, 'leaf-link'));
    for (const input of ['outside-link/new.txt', 'inside-link/new.txt', 'leaf-link']) {
      await expect(validateUploadDestination(ctx.workspaces, workspaceId, input)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    }
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('rechecks a parent replaced by an outside symlink during persisted commit intent', async () => {
    const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
    await fs.mkdir(path.join(workspacePath, 'folder'));
    await expect(installUploadFile({
      workspaces: ctx.workspaces, workspaceId, path: 'folder/file.txt', id: randomUUID(), bytes: Buffer.from('safe'), sha256: hash('safe'), signal: new AbortController().signal,
      beforeCommit: async () => {
        await fs.rename(path.join(workspacePath, 'folder'), path.join(workspacePath, 'old-folder'));
        await fs.symlink(outside, path.join(workspacePath, 'folder'));
      },
    })).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await fs.readdir(outside)).toEqual([]);
    expect(await fs.readdir(path.join(workspacePath, 'old-folder'))).toEqual([]);
  });

  it('keeps a file created at the destination during commit and a preexisting temporary-name conflict', async () => {
    await expect(installUploadFile({
      workspaces: ctx.workspaces, workspaceId, path: 'race.txt', id: randomUUID(), bytes: Buffer.from('safe'), sha256: hash('safe'), signal: new AbortController().signal,
      beforeCommit: async () => { await fs.writeFile(path.join(workspacePath, 'race.txt'), 'late user edits'); },
    })).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    expect(await fs.readFile(path.join(workspacePath, 'race.txt'), 'utf8')).toBe('late user edits');
    const id = randomUUID(); const temporary = path.join(workspacePath, `.codex-write-upload-${id}`);
    await fs.writeFile(temporary, 'preexisting owned file');
    await expect(installUploadFile({
      workspaces: ctx.workspaces, workspaceId, path: 'never-created.txt', id, bytes: Buffer.from('safe'), sha256: hash('safe'), signal: new AbortController().signal, beforeCommit: async () => undefined,
    })).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    expect(await fs.readFile(temporary, 'utf8')).toBe('preexisting owned file');
    await fs.unlink(temporary);
    await fs.symlink(path.join(workspacePath, 'race.txt'), temporary);
    await cleanUploadTemporary(ctx.workspaces, workspaceId, 'never-created.txt', id);
    expect((await fs.lstat(temporary)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(workspacePath, 'race.txt'), 'utf8')).toBe('late user edits');
  });
});

describe('authenticated upload reservation and capability HTTP API', () => {
  it('protects every job route, rejects cross-origin mutation, exposes only no-store temporary permission, and returns saved bytes', async () => {
    const uploads = await initializeUploads(ctx, { bucket, now: () => now }); services.push(uploads);
    const auth = new AuthService(ctx); authServices.push(auth); await auth.initialize();
    const app = express();
    app.use('/api', auth.protectMutations);
    app.use('/api/session', express.json({ limit: '4kb' }));
    app.use('/api', auth.router(), auth.requireSession, express.json({ limit: '8kb' }), createUploadRouter(ctx));
    const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
      if (error instanceof HttpError) res.status(error.status).json({ error: error.message, code: error.code });
      else res.status(500).json({ error: 'Test request failed.' });
    };
    app.use(errors);
    const server = createServer(app); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture listener.');
    const origin = `http://127.0.0.1:${address.port}`;
    const reserve = `/api/workspaces/${workspaceId}/uploads`;
    expect((await fetch(`${origin}/api/uploads/status`)).status).toBe(401);
    const login = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' }, body: JSON.stringify({ password: ctx.config.password }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' };
    const body = JSON.stringify({ path: 'http.txt', size: 4 });
    expect((await fetch(`${origin}${reserve}`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body })).status).toBe(403);
    const response = await fetch(`${origin}${reserve}`, { method: 'POST', headers, body });
    expect(response.status).toBe(201);
    const job = await response.json() as UploadJob;
    expect(response.headers.get('location')).toBe(`/api/uploads/${job.id}`);
    for (const [method, suffix] of [['GET', ''], ['POST', '/capability'], ['POST', '/complete'], ['DELETE', '']]) {
      expect((await fetch(`${origin}/api/uploads/${job.id}${suffix}`, { method, headers: { Origin: origin, 'X-Codex-Workspace': '1' } })).status).toBe(401);
    }
    const cap = await fetch(`${origin}/api/uploads/${job.id}/capability`, { method: 'POST', headers });
    expect(cap.status).toBe(200); expect(cap.headers.get('cache-control')).toContain('no-store');
    expect(await cap.json()).toMatchObject({ accessToken: CAPABILITY, casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(now / 1000) + 900 });
    const finalize = await fetch(`${origin}/api/uploads/${job.id}/complete`, { method: 'POST', headers, body: JSON.stringify(bucket.stage('safe')) });
    expect(finalize.status).toBe(202); expect((await waitForJob(uploads, job.id)).state).toBe('ready');
    const saved = await fetch(`${origin}/api/uploads/${job.id}`, { headers: { Cookie: cookie } });
    expect(saved.headers.get('cache-control')).toContain('no-store');
    const payload = await saved.text(); expect(payload).not.toContain(TOKEN); expect(payload).not.toContain(CAPABILITY);
    expect(JSON.parse(payload)).toMatchObject({ state: 'ready', version: hash('safe') });
    expect(await fs.readFile(path.join(workspacePath, job.path), 'utf8')).toBe('safe');
  });
});
