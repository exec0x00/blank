import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { AuthService } from '../server/auth';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import * as fileMutationQueue from '../server/file-transfers/queue';
import { getUploadService, shutdownUploads } from '../server/uploads';
import type { UploadBucket, UploadCapability } from '../server/uploads/types';
import { DOWNLOAD_RETENTION_MS, PUBLIC_DOWNLOAD_BUCKET } from '../server/downloads/bucket';
import type { BucketObject, DownloadBucket } from '../server/downloads/types';
import { initializeDownloads, getDownloadService, shutdownDownloads } from '../server/downloads';
import {
  ConversationFilesService, createConversationFilesRouter, initializeConversationFiles,
  shutdownConversationFiles, cleanupWorkspaceConversationFiles, FILE_ATTACHMENT_LIMITS, type FileAttachment, type FileAttachmentUploadJob,
} from '../server/conversation-files';
import { CONVERSATION_FILE_DIRECTORY, ConversationFileStorage } from '../server/conversation-files/storage';
import type { WorkspaceLifecycleOptions } from '../server/workspace-trash/service';
import { listTrashRecords } from '../server/workspace-trash/records';

const TOKEN = 'hf_SYNTHETIC_file_attachment_test_secret';
const CAPABILITY = 'eyJhbGciOiJSUzI1NiJ9.eyJ0ZXN0Ijp0cnVlfQ.c3ludGhldGlj';
const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const ref = (file: FileAttachment) => ({ id: file.id, sha256: file.sha256 });
const terminal = new Set(['ready', 'failed', 'cancelled', 'expired']);
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function waitGate(wait: ReturnType<typeof gate> | undefined, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!wait) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    void wait.promise.then(() => { signal.removeEventListener('abort', abort); resolve(); }, reject);
  });
  signal.throwIfAborted();
}

/** Only the remote transfer boundary is replaced; durable files and hashes are real. */
class MemoryBucket implements UploadBucket, DownloadBucket {
  readonly id = PUBLIC_DOWNLOAD_BUCKET;
  readonly cas = new Map<string, Buffer>();
  readonly objects = new Map<string, BucketObject & { content: Buffer }>();
  publications = 0;
  reads = 0;
  capabilityCalls = 0;
  readGate?: ReturnType<typeof gate>;
  capabilityGate?: ReturnType<typeof gate>;
  readReplacement?: Buffer;
  readError?: Error;
  readHook?: (object: BucketObject) => void;
  constructor(private readonly now: () => number) {}
  stage(value: Buffer | string) {
    const content = Buffer.from(value), xetHash = hash(Buffer.concat([Buffer.from('synthetic-xet:'), content]));
    this.cas.set(xetHash, content); return { xetHash, sha256: hash(content) };
  }
  async capability(_sessionId: string, signal: AbortSignal): Promise<UploadCapability> {
    this.capabilityCalls++; await waitGate(this.capabilityGate, signal);
    return { accessToken: CAPABILITY, casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(this.now() / 1000) + 600 };
  }
  async *list(signal: AbortSignal) { for (const item of [...this.objects.values()]) { signal.throwIfAborted(); yield { ...item }; } }
  async get(objectPath: string, signal: AbortSignal) { signal.throwIfAborted(); const item = this.objects.get(objectPath); return item && { ...item }; }
  async publish(input: Parameters<UploadBucket['publish']>[0]) {
    input.signal.throwIfAborted(); const content = this.cas.get(input.xetHash);
    if (!content) throw new Error('Unknown synthetic staged data.');
    const value = { path: input.objectPath, type: 'file' as const, size: content.length, xetHash: input.xetHash, uploadedAt: new Date(this.now()).toISOString(), content };
    this.objects.set(value.path, value); this.publications++; return { ...value };
  }
  async read(input: Parameters<UploadBucket['read']>[0]) {
    this.reads++; await waitGate(this.readGate, input.signal);
    if (this.readError) throw this.readError;
    const item = this.objects.get(input.objectPath);
    if (!item) throw new Error('Missing synthetic published file.');
    this.readHook?.(item); input.onProgress?.(item.content.length);
    return Buffer.from(this.readReplacement ?? item.content);
  }
  async upload(input: Parameters<DownloadBucket['upload']>[0]) {
    input.signal.throwIfAborted(); await input.beforePublish?.();
    const content = await fs.readFile(input.snapshotPath);
    const staged = this.stage(content);
    const value = { path: input.objectPath, type: 'file' as const, size: content.length, xetHash: staged.xetHash, uploadedAt: new Date(this.now()).toISOString(), content };
    this.objects.set(value.path, value); input.onProgress(content.length); return { ...value };
  }
  async delete(paths: string[], signal: AbortSignal) { signal.throwIfAborted(); for (const name of paths) this.objects.delete(name); return { deleted: paths, failed: [] }; }
}

let directory: string, ctx: AppContext, now: number, workspaceId: string, workspacePath: string, bucket: MemoryBucket;
let files: ConversationFilesService;
const contexts: AppContext[] = [], instances: ConversationFilesService[] = [], servers: Server[] = [], authServices: AuthService[] = [];

function context(options: { dataDir?: string; lifecycle?: WorkspaceLifecycleOptions } = {}): AppContext {
  const config = loadConfig({ DATA_DIR: options.dataDir ?? path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'), NODE_ENV: 'test',
    WORKSPACE_PASSWORD: 'synthetic-attachment-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64),
    HF_DOWNLOAD_BUCKET: PUBLIC_DOWNLOAD_BUCKET, HF_DOWNLOAD_TOKEN: TOKEN });
  const store = new JsonStore(config.stateDir);
  const value = { config, store, secrets: new SecretStore(store, config.encryptionKey), workspaces: new WorkspaceService(config, store, options.lifecycle),
    events: new EventEmitter(), settings: async () => ({ ...defaultSettings }), saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  contexts.push(value); return value;
}
async function service(selected = ctx): Promise<ConversationFilesService> {
  const instance = new ConversationFilesService(selected, { bucket, now: () => now, cleanupIntervalMs: 0 });
  instances.push(instance); await instance.initialize(); return instance;
}
const storageDir = () => path.join(ctx.config.stateDir, CONVERSATION_FILE_DIRECTORY, hash(workspaceId));
async function waitForJob(service: ConversationFilesService, id: string, states = terminal): Promise<FileAttachmentUploadJob> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = await service.get(id);
    if (states.has(job.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 3));
  }
  throw new Error('Attachment did not reach its expected state.');
}
async function upload(name: string, value: Buffer | string, mimeType?: string): Promise<FileAttachment> {
  const content = Buffer.from(value);
  const job = await files.reserve(workspaceId, { name, size: content.length, ...(mimeType ? { mimeType } : {}) });
  await files.complete(job.id, bucket.stage(content));
  const ready = await waitForJob(files, job.id);
  expect(ready.state, ready.error?.message).toBe('ready');
  return ready.attachment!;
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-files-')); now = Date.now();
  ctx = context(); await ctx.workspaces.initialize();
  const workspace = await ctx.workspaces.create({ name: 'Conversation files' });
  workspaceId = workspace.id; workspacePath = workspace.path; bucket = new MemoryBucket(() => now);
  files = await service();
});
afterEach(async () => {
  bucket.readGate?.resolve(); bucket.capabilityGate?.resolve();
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await Promise.allSettled(authServices.splice(0).map(auth => auth.close()));
  await Promise.allSettled(instances.splice(0).map(service => service.close()));
  for (const selected of contexts.splice(0)) {
    await shutdownConversationFiles(selected); await shutdownUploads(selected); await shutdownDownloads(selected);
    await selected.workspaces.closeTrashCleanup(); await selected.store.flush();
  }
  await fs.rm(directory, { recursive: true, force: true });
});

describe('durable general conversation files', () => {
  it('imports verified public-transfer bytes without creating workspace files or persisting capabilities', async () => {
    const content = Buffer.from([0, 255, 128, 10, 17, 49]);
    const before = await fs.readdir(workspacePath);
    const job = await files.reserve(workspaceId, { name: 'rapport é 文.bin', size: content.length });
    expect(job).toMatchObject({ state: 'reserved', bucket: PUBLIC_DOWNLOAD_BUCKET, objectPath: `imports/${job.id}/rapport é 文.bin` });
    const capabilities = await Promise.all([files.capability(job.id), files.capability(job.id)]);
    expect(capabilities[0].accessToken).toBe(CAPABILITY); expect(capabilities[1]).toEqual(capabilities[0]); expect(bucket.capabilityCalls).toBe(1);
    const progress: FileAttachmentUploadJob[] = [];
    ctx.events.on(`file-attachment-upload:${job.id}`, value => progress.push(value));
    const hashes = bucket.stage(content);
    await files.complete(job.id, hashes);
    const ready = await waitForJob(files, job.id), attachment = ready.attachment!;
    expect(ready).toMatchObject({ state: 'ready', bytesProcessed: content.length, attachment: { name: job.name, bytes: job.size, sha256: hashes.sha256, workspaceId, createdAt: job.createdAt } });
    expect(await fs.readFile(path.join(storageDir(), `${attachment.id}.file`))).toEqual(content);
    expect(await fs.readdir(workspacePath)).toEqual(before);
    expect(progress.some(item => item.state === 'importing' && item.bytesProcessed === content.length)).toBe(true);
    expect(bucket.reads).toBe(1); expect(bucket.publications).toBe(1);
    const saved = await fs.readFile(path.join(ctx.config.stateDir, 'conversation-file-uploads-v1.json'), 'utf8');
    for (const secret of [TOKEN, CAPABILITY, ctx.config.password, ctx.config.encryptionKey]) { expect(saved).not.toContain(secret); expect(JSON.stringify(ready)).not.toContain(secret); }
    expect(JSON.stringify(attachment)).not.toMatch(/contentUrl|previewUrl|\/data|\/tmp|retainedAt|capabilityRequests|xetHash/);
    expect((await files.resolve(workspaceId, [ref(attachment)])).content).toEqual([{ type: 'input_text', text: expect.stringContaining('File contents have not yet been read') }]);
  });

  it('reads empty and actual UTF-8 code without breaking multibyte characters or rendering markup', async () => {
    const empty = await upload('empty.txt', '');
    expect(await files.inspect(workspaceId, ref(empty))).toMatchObject({ format: 'utf8', content: '', bytesRead: 0, totalBytes: 0, truncated: false });
    const file = await upload('script.ts', 'é🙂<script>not executable</script>\nexport const actual = 7;');
    const first = await files.inspect(workspaceId, ref(file), { offset: 0, maxBytes: 2 });
    expect(first).toMatchObject({ format: 'utf8', content: 'é', bytesRead: 2, nextOffset: 2, truncated: true });
    expect((await files.inspect(workspaceId, ref(file), { offset: 2, maxBytes: 1 })).content).toBe('🙂');
    expect((await files.inspect(workspaceId, ref(file), { offset: 3, maxBytes: 8 })).content).toBe('<script>');
    expect((await files.inspect(workspaceId, ref(file))).content).toContain('<script>not executable</script>');
    await expect(files.inspect(workspaceId, ref(file), { offset: file.bytes + 1 })).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_OFFSET' });
    await expect(files.inspect(workspaceId, ref(file), { maxBytes: FILE_ATTACHMENT_LIMITS.maxInspectionBytes + 1 })).rejects.toMatchObject({ status: 400 });
  });

  it('returns genuine binary bytes and honest PDF notice even when declared text/plain', async () => {
    const pdf = await upload('paper.pdf', '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF', 'text/plain');
    const inspected = await files.inspect(workspaceId, ref(pdf));
    expect(inspected).toMatchObject({ format: 'binary', notice: expect.stringContaining('PDF text has not been extracted') });
    expect(inspected.content).toBeUndefined();
    expect(Buffer.from(inspected.hex!, 'hex').toString()).toContain('%PDF-1.4');
    const binary = await upload('controls.txt', Buffer.alloc(5000, 0));
    const preview = await files.inspect(workspaceId, ref(binary));
    expect(preview).toMatchObject({ format: 'binary', bytesRead: 4096, nextOffset: 4096, truncated: true });
    expect(preview.hex).toHaveLength(8192);
    expect(preview.notice).toContain('not parsed document contents');
  });

  it.each([
    ['bad-size', 'wrong', 'UPLOAD_SIZE_MISMATCH'],
    ['bad-sha', '1234', 'UPLOAD_CONTENT_MISMATCH'],
  ])('rejects %s before saving originals', async (name, replacement, code) => {
    const job = await files.reserve(workspaceId, { name, size: 4 });
    bucket.readReplacement = Buffer.from(replacement);
    await files.complete(job.id, bucket.stage('real'));
    expect(await waitForJob(files, job.id)).toMatchObject({ state: 'failed', error: { code } });
    expect((await fs.readdir(storageDir())).filter(name => name.endsWith('.file'))).toEqual([]);
  });

  it('rejects replaced remote objects and sanitizes remote exceptions', async () => {
    const first = await files.reserve(workspaceId, { name: 'changed.txt', size: 4 });
    bucket.readHook = item => { bucket.objects.get(item.path)!.xetHash = 'b'.repeat(64); };
    await files.complete(first.id, bucket.stage('real'));
    expect(await waitForJob(files, first.id)).toMatchObject({ state: 'failed', error: { code: 'UPLOAD_STAGE_CONFLICT' } });
    bucket.readHook = undefined; bucket.readError = new Error(`Upstream leaked ${TOKEN} ${CAPABILITY}`);
    const second = await files.reserve(workspaceId, { name: 'error.txt', size: 4 });
    await files.complete(second.id, bucket.stage('real'));
    const failed = await waitForJob(files, second.id);
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'FILE_ATTACHMENT_UPLOAD_FAILED' } });
    expect(JSON.stringify(failed)).not.toContain(TOKEN); expect(JSON.stringify(failed)).not.toContain(CAPABILITY);
  });

  it('rejects oversized files, unsafe names, raw bodies, remote URLs and caller-selected staging paths', async () => {
    for (const input of [
      { name: '../outside', size: 1 }, { name: '/absolute', size: 1 }, { name: 'bad\\name', size: 1 },
      { name: 'https://example.invalid/file', size: 1 }, { name: '.codex-write-reserved', size: 1 },
      { name: 'file', size: -1 }, { name: 'file', size: 0.5 }, { name: 'file', size: 1, bytes: [1] },
      { name: 'file', size: 1, bucket: 'alvin3y12/data' }, { name: 'file', size: 1, objectPath: 'imports/arbitrary/file' },
      { name: 'file', size: 1, mimeType: 'text/plain\r\nX-Test:bad' }, Buffer.from('raw'),
    ]) await expect(files.reserve(workspaceId, input)).rejects.toBeInstanceOf(HttpError);
    await expect(files.reserve(workspaceId, { name: 'huge', size: FILE_ATTACHMENT_LIMITS.maxBytes + 1 })).rejects.toMatchObject({ status: 413 });
    const jobs = [];
    for (let index = 0; index < FILE_ATTACHMENT_LIMITS.maxActiveUploads; index++) jobs.push(await files.reserve(workspaceId, { name: `${index}.txt`, size: 1 }));
    await expect(files.reserve(workspaceId, { name: 'extra', size: 1 })).rejects.toMatchObject({ status: 429 });
    await files.cancel(jobs[0].id);
    expect((await files.reserve(workspaceId, { name: 'replacement', size: 1 })).state).toBe('reserved');
    expect(bucket.reads).toBe(0); expect(bucket.publications).toBe(0);
  });

  it('does not deliver a capability after reservation cancellation', async () => {
    const job = await files.reserve(workspaceId, { name: 'private.txt', size: 1 });
    bucket.capabilityGate = gate();
    const pending = files.capability(job.id);
    while (!bucket.capabilityCalls) await new Promise(resolve => setTimeout(resolve, 1));
    await files.cancel(job.id); bucket.capabilityGate.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_UPLOAD_CLOSED' });
  });

  it('cancels a remote import before commit without claiming ready', async () => {
    const job = await files.reserve(workspaceId, { name: 'cancel.txt', size: 4 });
    bucket.readGate = gate();
    await files.complete(job.id, bucket.stage('real'));
    await waitForJob(files, job.id, new Set(['importing']));
    const cancelled = await files.cancel(job.id);
    expect(cancelled.state).toBe('cancelled'); expect(cancelled.attachment).toBeUndefined();
    expect((await fs.readdir(storageDir())).filter(name => name.endsWith('.file'))).toEqual([]);
  });

  it('reports the committed attachment when cancellation arrives after its commit boundary', async () => {
    const boundary = gate(), entered = gate(), original = files.storage.commit.bind(files.storage);
    vi.spyOn(files.storage, 'commit').mockImplementation(async (...args) => { entered.resolve(); await boundary.promise; return original(...args); });
    const job = await files.reserve(workspaceId, { name: 'committed.txt', size: 4 });
    await files.complete(job.id, bucket.stage('real')); await entered.promise;
    const cancel = files.cancel(job.id); boundary.resolve();
    const ready = await cancel;
    expect(ready).toMatchObject({ state: 'ready', attachment: { name: 'committed.txt', sha256: hash('real') } });
    expect((await files.inspect(workspaceId, ref(ready.attachment!))).content).toBe('real');
  });

  it('reconciles a committed original after a transient final job-state write failure', async () => {
    const write = ctx.store.write.bind(ctx.store);
    let failed = false;
    vi.spyOn(ctx.store, 'write').mockImplementation(async (key, value) => {
      const state = value as { jobs?: Array<{ state?: string }> };
      if (key === 'conversation-file-uploads-v1' && !failed && state.jobs?.some(job => job.state === 'ready')) {
        failed = true; throw new Error('Synthetic interrupted metadata write.');
      }
      await write(key, value);
    });
    const job = await files.reserve(workspaceId, { name: 'saved.txt', size: 4 });
    await files.complete(job.id, bucket.stage('real'));
    const ready = await waitForJob(files, job.id);
    expect(failed).toBe(true); expect(ready.state).toBe('ready');
    expect((await files.inspect(workspaceId, ref(ready.attachment!))).content).toBe('real');
    expect((await files.cancel(job.id)).state).toBe('ready');
  });

  it('makes completion idempotent, rejects different contents, and expires unused reservations', async () => {
    const job = await files.reserve(workspaceId, { name: 'idempotent.txt', size: 4 }), hashes = bucket.stage('real');
    await files.complete(job.id, hashes); const ready = await waitForJob(files, job.id);
    expect(await files.complete(job.id, hashes)).toEqual(ready); expect(bucket.publications).toBe(1);
    await expect(files.complete(job.id, bucket.stage('else'))).rejects.toMatchObject({ status: 409 });
    const draft = await files.reserve(workspaceId, { name: 'expired.txt', size: 0 });
    now += FILE_ATTACHMENT_LIMITS.uploadSessionMs + 1;
    expect(await files.get(draft.id)).toMatchObject({ state: 'expired' });
    await expect(files.complete(draft.id, bucket.stage(''))).rejects.toMatchObject({ status: 409 });
  });

  it('reconciles completed job status when its unsubmitted original has expired', async () => {
    const job = await files.reserve(workspaceId, { name: 'expired-original.txt', size: 4 });
    const hashes = bucket.stage('real'); await files.complete(job.id, hashes);
    expect((await waitForJob(files, job.id)).state).toBe('ready');
    now += FILE_ATTACHMENT_LIMITS.draftLifetimeMs + 1;
    await files.cleanupExpired();
    const expired = await files.get(job.id);
    expect(expired).toMatchObject({ state: 'expired', error: { code: 'FILE_ATTACHMENT_EXPIRED' } });
    expect(expired.attachment).toBeUndefined();
    expect((await files.complete(job.id, hashes)).state).toBe('expired');
  });

  it('retains submitted originals across restart and removes only expired drafts and public staging copies', async () => {
    const kept = await upload('durable.md', '# Saved conversation\n'), draft = await upload('draft.md', 'not sent');
    await files.resolve(workspaceId, [ref(kept)], { retain: true });
    await expect(files.discard(workspaceId, ref(kept))).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_IN_USE' });
    await files.close(); await shutdownUploads(ctx);
    now += DOWNLOAD_RETENTION_MS + 1;
    const next = context(); await next.workspaces.initialize(); files = await service(next);
    expect((await files.inspect(workspaceId, ref(kept))).content).toBe('# Saved conversation\n');
    await expect(files.inspect(workspaceId, ref(draft))).rejects.toMatchObject({ status: 404 });
    expect(bucket.objects.size).toBe(0);
    // Reusing the exact preserved reference is how both fork and rewind stay immutable.
    expect((await files.resolve(workspaceId, [ref(kept)], { retain: true })).attachments).toEqual([kept]);
    expect(await fs.readFile(path.join(storageDir(), `${kept.id}.file`), 'utf8')).toBe('# Saved conversation\n');
  });

  it('recovers a durable interrupted commit without replaying any remote transfer', async () => {
    const original = await upload('recovered.txt', 'recover me');
    await files.close(); await shutdownUploads(ctx);
    const saved = await ctx.store.read<{ format: number; jobs: Record<string, unknown>[]; capabilityIssuedAt: number[] }>('conversation-file-uploads-v1', { format: 1, jobs: [], capabilityIssuedAt: [] });
    saved.jobs[0].state = 'importing'; delete saved.jobs[0].attachment;
    await ctx.store.write('conversation-file-uploads-v1', saved);
    const recordPath = path.join(storageDir(), `${original.id}.json`);
    const record = JSON.parse(await fs.readFile(recordPath, 'utf8')); record.state = 'uploading'; await fs.writeFile(recordPath, JSON.stringify(record));
    const readCount = bucket.reads, publications = bucket.publications;
    const next = context(); await next.workspaces.initialize(); files = await service(next);
    expect(await files.get(saved.jobs[0].id as string)).toMatchObject({ state: 'ready', attachment: original });
    expect(bucket.reads).toBe(readCount); expect(bucket.publications).toBe(publications);
    expect((await files.inspect(workspaceId, ref(original))).content).toBe('recover me');
  });

  it('rejects cross-workspace references, modified bytes and symlink replacements', async () => {
    const item = await upload('original.txt', 'safe');
    const other = await ctx.workspaces.create({ name: 'Another workspace' });
    await expect(files.inspect(other.id, ref(item))).rejects.toMatchObject({ status: 404 });
    await expect(files.resolve(workspaceId, [{ id: item.id, sha256: 'b'.repeat(64) }], { retain: true })).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_CHANGED' });
    const location = path.join(storageDir(), `${item.id}.file`);
    await fs.chmod(location, 0o600); await fs.writeFile(location, 'evil');
    await expect(files.inspect(workspaceId, ref(item))).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_CHANGED' });
    await fs.unlink(location);
    const external = path.join(directory, 'external.txt'); await fs.writeFile(external, 'private outside bytes'); await fs.symlink(external, location);
    await expect(files.inspect(workspaceId, ref(item))).rejects.toMatchObject({ code: 'UNSAFE_FILE_ATTACHMENT_STORAGE' });
    expect(await fs.readFile(external, 'utf8')).toBe('private outside bytes');
  });

  it('validates all refs before retaining any draft and enforces real aggregate byte limits', async () => {
    const small = await upload('small.txt', 'a');
    await expect(files.resolve(workspaceId, [ref(small), { id: `file_${'f'.repeat(32)}`, sha256: hash('missing') }], { retain: true })).rejects.toMatchObject({ status: 404 });
    expect(await files.discard(workspaceId, ref(small))).toEqual({ deleted: true });
    const content = Buffer.alloc(17 * 1024 * 1024, 65);
    const attachments: FileAttachment[] = [];
    for (let index = 0; index < 3; index++) attachments.push(await files.storage.commit({ id: `file_${randomUUID().replaceAll('-', '')}`,
      workspaceId, name: `${index}.txt`, mimeType: 'text/plain', bytes: content.length, sha256: hash(content), createdAt: new Date(now).toISOString() }, content));
    await expect(files.resolve(workspaceId, attachments.map(ref), { retain: true })).rejects.toMatchObject({ status: 413, code: 'FILE_ATTACHMENT_MESSAGE_TOO_LARGE' });
    for (const file of attachments) expect(JSON.parse(await fs.readFile(path.join(storageDir(), `${file.id}.json`), 'utf8')).retainedAt).toBeUndefined();
    await expect(files.resolve(workspaceId, Array.from({ length: 9 }, () => ref(attachments[0])))).rejects.toMatchObject({ status: 400 });
  });

  it('copies exact bytes to a new workspace file, keeps originals, and removes only its runtime scratch', async () => {
    const attachment = await upload('binary.bin', Buffer.from([0, 255, 5, 10]));
    await fs.mkdir(path.join(workspacePath, 'nested'));
    const result = await files.copyToWorkspace(workspaceId, ref(attachment), { path: 'nested/copied.bin' });
    expect(result).toMatchObject({ path: 'nested/copied.bin', version: attachment.sha256, entry: { kind: 'file', size: 4 } });
    expect(await fs.readFile(path.join(workspacePath, result.path))).toEqual(Buffer.from([0, 255, 5, 10]));
    expect(await fs.readFile(path.join(storageDir(), `${attachment.id}.file`))).toEqual(Buffer.from([0, 255, 5, 10]));
    expect((await fs.stat(path.join(workspacePath, result.path))).mode & 0o111).toBe(0);
    expect((await fs.readdir(path.join(ctx.config.runtimeDir, 'tmp'))).filter(name => name.startsWith('.conversation-file-'))).toEqual([]);
    await expect(files.copyToWorkspace(workspaceId, ref(attachment), { path: result.path })).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    await expect(files.copyToWorkspace(workspaceId, ref(attachment), { path: '../escape' })).rejects.toMatchObject({ code: 'INVALID_PATH' });
    const external = path.join(directory, 'outside'); await fs.mkdir(external); await fs.symlink(external, path.join(workspacePath, 'link'));
    await expect(files.copyToWorkspace(workspaceId, ref(attachment), { path: 'link/copied.bin' })).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await fs.readdir(external)).toEqual([]);
  });

  it('queues an attachment copy behind a native mutation and preserves its late-created destination', async () => {
    const attachment = await upload('queued.txt', 'attachment bytes');
    const entered = gate(), finish = gate(), queued = gate();
    const destination = 'queued-copy.txt';
    const nativeQueue = fileMutationQueue.withWorkspaceFileMutation;
    const preceding = nativeQueue(ctx.config.workspacesDir, workspaceId, async () => {
      entered.resolve(); await finish.promise;
      await fs.writeFile(path.join(workspacePath, destination), 'preceding native save');
    });
    await entered.promise;
    const beforeCommit = vi.fn(async () => undefined);
    vi.spyOn(fileMutationQueue, 'withWorkspaceFileMutation').mockImplementation((...args) => {
      const pending = nativeQueue(...args); queued.resolve(); return pending;
    });
    const copying = files.copyToWorkspace(workspaceId, ref(attachment), { path: destination }, { beforeCommit });
    const result = copying.then(() => undefined, error => error);
    try {
      await queued.promise;
      expect(beforeCommit).not.toHaveBeenCalled();
      await expect(fs.lstat(path.join(workspacePath, destination))).rejects.toMatchObject({ code: 'ENOENT' });
      finish.resolve(); await preceding;
      expect(await result).toMatchObject({ code: 'FILE_EXISTS' });
      expect(await fs.readFile(path.join(workspacePath, destination), 'utf8')).toBe('preceding native save');
      expect((await files.inspect(workspaceId, ref(attachment))).content).toBe('attachment bytes');
      expect((await fs.readdir(path.join(ctx.config.runtimeDir, 'tmp'))).filter(name => name.startsWith('.conversation-file-'))).toEqual([]);
    } finally { finish.resolve(); await preceding; await result; }
  });

  it('holds a real editor create behind the attachment commit and rejects its conflicting destination', async () => {
    const attachment = await upload('first.txt', 'attachment first');
    const entered = gate(), finish = gate(), destination = 'editor-collision.txt';
    const copying = files.copyToWorkspace(workspaceId, ref(attachment), { path: destination }, {
      beforeCommit: async () => { entered.resolve(); await finish.promise; },
    });
    const copied = copying.then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const resolves = vi.spyOn(ctx.workspaces, 'resolvePath');
    const editing = ctx.workspaces.upload(workspaceId, destination, Buffer.from('editor create'));
    const edited = editing.then(() => undefined, error => error);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(resolves).not.toHaveBeenCalled();
      finish.resolve();
      expect(await copied).toMatchObject({ value: { version: attachment.sha256 } });
      expect(await edited).toMatchObject({ code: 'FILE_EXISTS' });
      expect(await fs.readFile(path.join(workspacePath, destination), 'utf8')).toBe('attachment first');
    } finally { finish.resolve(); await copied; await edited; }
  });

  it('preserves immutable metadata and bytes when an internal caller mutates the upload input after admission', async () => {
    const input = { id: `file_${randomUUID().replaceAll('-', '')}`, workspaceId, name: 'owned.txt', mimeType: 'text/plain',
      bytes: 4, sha256: hash('real'), createdAt: new Date(now).toISOString() };
    const content = Buffer.from('real'), expectedId = input.id;
    const saving = files.storage.commit(input, content);
    input.id = '../escape'; input.name = 'renamed.txt'; input.sha256 = hash('evil'); content.fill(0);
    const committed = await saving;
    expect(committed).toMatchObject({ id: expectedId, name: 'owned.txt', sha256: hash('real') });
    expect((await files.inspect(workspaceId, ref(committed))).content).toBe('real');
  });

  it('leaves agent review attribution to the trusted adapter while still verifying the durable copied bytes', async () => {
    const item = await upload('agent.txt', 'created by an attachment tool');
    const manual = vi.fn(), changed = vi.fn(), beforeCommit = vi.fn(async () => undefined);
    ctx.events.on('workspace:manual-intent', manual); ctx.events.on('workspace:changed', changed);
    const result = await files.copyToWorkspace(workspaceId, ref(item), { path: 'agent-copy.txt' }, { source: 'agent', beforeCommit });
    expect(beforeCommit).toHaveBeenCalledOnce(); expect(manual).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
    expect(hash(await fs.readFile(path.join(workspacePath, result.path)))).toBe(item.sha256);
  });

  it('keeps corrupt job state intact and reports failure instead of overwriting it during cleanup', async () => {
    await files.close(); await shutdownUploads(ctx);
    await ctx.store.write('conversation-file-uploads-v1', { format: 'unexpected', jobs: [{ original: 'must remain' }] });
    const next = context(); await next.workspaces.initialize(); files = await service(next);
    expect(files.status()).toMatchObject({ ready: false, error: { code: 'FILE_ATTACHMENT_STATE_ERROR' } });
    await expect(files.cleanupExpired()).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_STATE_ERROR' });
    expect(await next.store.read('conversation-file-uploads-v1', null)).toEqual({ format: 'unexpected', jobs: [{ original: 'must remain' }] });
  });

  it('rejects a replaced storage parent before following it or writing outside durable storage', async () => {
    await files.close(); await shutdownUploads(ctx);
    const storage = path.join(ctx.config.stateDir, CONVERSATION_FILE_DIRECTORY), external = path.join(directory, 'unrelated');
    await fs.mkdir(external); await fs.rename(storage, `${storage}.previous`); await fs.symlink(external, storage);
    const next = context(); await next.workspaces.initialize(); files = await service(next);
    expect(files.status().ready).toBe(false);
    await expect(files.storage.commit({ id: `file_${randomUUID().replaceAll('-', '')}`, workspaceId,
      name: 'unsafe.txt', mimeType: 'text/plain', bytes: 4, sha256: hash('real'), createdAt: new Date(now).toISOString() }, Buffer.from('real')))
      .rejects.toMatchObject({ code: 'UNSAFE_FILE_ATTACHMENT_STORAGE' });
    expect(await fs.readdir(external)).toEqual([]);
  });
});

const deletionFencePath = (id = workspaceId, selected = ctx) => path.join(selected.config.stateDir, CONVERSATION_FILE_DIRECTORY, `${hash(id)}.deleted.json`);
async function waitForFence(id = workspaceId, selected = ctx): Promise<void> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    try { await fs.lstat(deletionFencePath(id, selected)); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('The permanent attachment fence was not saved.');
}

describe('permanent workspace conversation-file lifecycle', () => {
  it('clears only exact workspace originals/jobs without a live root, preserving accounts, settings and published bucket copies', async () => {
    const own = await upload('owned.txt', 'permanently deleted');
    await files.resolve(workspaceId, [ref(own)], { retain: true });
    const other = await ctx.workspaces.create({ name: 'Unrelated files' });
    const job = await files.reserve(other.id, { name: 'other.txt', size: 4 });
    await files.complete(job.id, bucket.stage('keep'));
    const otherFile = (await waitForJob(files, job.id)).attachment!;
    await files.resolve(other.id, [ref(otherFile)], { retain: true });
    await ctx.store.write('settings', { model: 'preserved-model-choice', editorFontSize: 15 });
    await ctx.store.write('github-accounts', [{ id: 'synthetic-account', login: 'saved-owner' }]);
    await ctx.secrets.set('github-token-synthetic', 'synthetic-protected-account-value');
    const settings = await fs.readFile(path.join(ctx.config.stateDir, 'settings.json'));
    const accounts = await fs.readFile(path.join(ctx.config.stateDir, 'github-accounts.json'));
    const secrets = await fs.readFile(path.join(ctx.config.stateDir, 'protected-credentials.json'));
    const publishedBefore = [...bucket.objects.keys()].sort(), remoteDelete = vi.spyOn(bucket, 'delete'), remoteRead = vi.spyOn(bucket, 'read');
    remoteRead.mockClear();
    await fs.rm(workspacePath, { recursive: true, force: true });
    const liveLookup = vi.spyOn(ctx.workspaces, 'get').mockRejectedValue(new Error('No live workspace lookup is allowed during cleanup.'));
    const result = await cleanupWorkspaceConversationFiles(ctx, workspaceId);
    expect(result.filesRemoved).toBe(2); expect(liveLookup).not.toHaveBeenCalled(); liveLookup.mockRestore();
    await expect(fs.lstat(storageDir())).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await files.inspect(other.id, ref(otherFile))).content).toBe('keep');
    const saved = await ctx.store.read<{ jobs: Array<{ workspaceId: string; id: string }> }>('conversation-file-uploads-v1', { jobs: [] });
    expect(saved.jobs.map(item => item.id)).toEqual([job.id]);
    expect(await fs.readFile(path.join(ctx.config.stateDir, 'settings.json'))).toEqual(settings);
    expect(await fs.readFile(path.join(ctx.config.stateDir, 'github-accounts.json'))).toEqual(accounts);
    expect(await fs.readFile(path.join(ctx.config.stateDir, 'protected-credentials.json'))).toEqual(secrets);
    expect([...bucket.objects.keys()].sort()).toEqual(publishedBefore); expect(remoteDelete).not.toHaveBeenCalled(); expect(remoteRead).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(deletionFencePath(), 'utf8'))).toMatchObject({ workspaceId, version: 1 });
    expect(await cleanupWorkspaceConversationFiles(ctx, workspaceId)).toEqual({ filesRemoved: 0 });
  });

  it('works during cold startup before workspace or transfer initialization and rejects old references after restart', async () => {
    const attachment = await upload('cold.txt', 'cold startup original');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    await files.close(); await shutdownUploads(ctx); await fs.rm(workspacePath, { recursive: true, force: true });
    const cold = context();
    const get = vi.spyOn(cold.workspaces, 'get').mockRejectedValue(new Error('Workspace startup must not be reentered.'));
    const initialize = vi.spyOn(cold.workspaces, 'initialize').mockRejectedValue(new Error('Workspace startup must not be reentered.'));
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Permanent local cleanup must not contact a provider.'));
    expect((await cleanupWorkspaceConversationFiles(cold, workspaceId)).filesRemoved).toBe(2);
    expect(get).not.toHaveBeenCalled(); expect(initialize).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    const fresh = new ConversationFileStorage(cold);
    try { await expect(fresh.read(workspaceId, ref(attachment))).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' }); }
    finally { await fresh.close(); }
  });

  it('loads the durable fence in a fresh storage scope instead of trusting only an in-memory deletion set', async () => {
    const attachment = await upload('late.txt', 'must never return');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const record = await fs.readFile(path.join(storageDir(), `${attachment.id}.json`));
    await cleanupWorkspaceConversationFiles(ctx, workspaceId);
    const cold = context({ dataDir: path.join(directory, 'fresh-instance-data') });
    const root = path.join(cold.config.stateDir, CONVERSATION_FILE_DIRECTORY), owned = path.join(root, hash(workspaceId));
    await fs.mkdir(owned, { recursive: true });
    await fs.copyFile(deletionFencePath(), deletionFencePath(workspaceId, cold));
    // Simulate a stale state/snapshot replay after a whole process restart.
    await fs.writeFile(path.join(owned, `${attachment.id}.json`), record);
    await fs.writeFile(path.join(owned, `${attachment.id}.file`), 'must never return');
    const lookup = vi.spyOn(cold.workspaces, 'get').mockRejectedValue(new Error('The persistent fence must run first.'));
    const fresh = new ConversationFileStorage(cold);
    try {
      await expect(fresh.read(workspaceId, ref(attachment))).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' });
      await expect(fresh.commit({ ...attachment, id: `file_${randomUUID().replaceAll('-', '')}` }, Buffer.from('must never return')))
        .rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' });
      expect(lookup).not.toHaveBeenCalled();
      expect((await cleanupWorkspaceConversationFiles(cold, workspaceId)).filesRemoved).toBe(2);
    } finally { await fresh.close(); }
  });

  it('cancels an owned import and never accepts a late public-transfer callback after fencing', async () => {
    const entered = gate(), finish = gate();
    vi.spyOn(bucket, 'read').mockImplementation(async () => { entered.resolve(); await finish.promise; return Buffer.from('late'); });
    const job = await files.reserve(workspaceId, { name: 'late-import.txt', size: 4 });
    const staged = bucket.stage('late'); await files.complete(job.id, staged); await entered.promise;
    let finished = false;
    const deleting = cleanupWorkspaceConversationFiles(ctx, workspaceId).then(value => { finished = true; return value; });
    try {
      await waitForFence(); expect(finished).toBe(false);
      await expect(files.reserve(workspaceId, { name: 'new.txt', size: 1 })).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' });
      finish.resolve(); await deleting;
      await expect(fs.lstat(storageDir())).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await ctx.store.read<{ jobs: unknown[] }>('conversation-file-uploads-v1', { jobs: [] })).jobs).toEqual([]);
      expect(bucket.objects.has(job.objectPath)).toBe(true);
      await expect(files.complete(job.id, staged)).rejects.toBeInstanceOf(HttpError);
    } finally { finish.resolve(); await deleting; }
  });

  it('does not cancel or wait for a different workspace’s in-flight import', async () => {
    const own = await upload('delete-only-this.txt', 'owned');
    await files.resolve(workspaceId, [ref(own)], { retain: true });
    const other = await ctx.workspaces.create({ name: 'Still importing' });
    bucket.readGate = gate();
    const job = await files.reserve(other.id, { name: 'kept.txt', size: 4 });
    await files.complete(job.id, bucket.stage('keep')); await waitForJob(files, job.id, new Set(['importing']));
    const deleting = cleanupWorkspaceConversationFiles(ctx, workspaceId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([deleting, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Cleanup waited for another workspace’s import.')), 5000);
      })]);
      expect((await files.get(job.id)).state).toBe('importing');
      bucket.readGate.resolve();
      const ready = await waitForJob(files, job.id);
      expect(ready.state).toBe('ready'); expect((await files.inspect(other.id, ref(ready.attachment!))).content).toBe('keep');
    } finally { clearTimeout(timer); bucket.readGate.resolve(); await deleting; await waitForJob(files, job.id); }
  });

  it('never returns an owned capability that arrives after permanent deletion starts', async () => {
    const entered = gate(), finish = gate();
    vi.spyOn(bucket, 'capability').mockImplementation(async () => {
      entered.resolve(); await finish.promise;
      return { accessToken: CAPABILITY, casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(now / 1000) + 600 };
    });
    const job = await files.reserve(workspaceId, { name: 'late-capability.txt', size: 1 });
    const capability = files.capability(job.id).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const deleting = cleanupWorkspaceConversationFiles(ctx, workspaceId);
    try {
      await waitForFence(); finish.resolve();
      expect(await capability).toMatchObject({ error: { code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' } }); await deleting;
      expect((await ctx.store.read<{ jobs: unknown[] }>('conversation-file-uploads-v1', { jobs: [] })).jobs).toEqual([]);
      expect(JSON.stringify(await ctx.store.read('conversation-file-uploads-v1', null))).not.toContain(CAPABILITY);
    } finally { finish.resolve(); await capability; await deleting; }
  });

  it('rechecks a capability after its final asynchronous availability check', async () => {
    const entered = gate(), finish = gate(); let received = false;
    vi.spyOn(bucket, 'capability').mockImplementation(async () => {
      received = true;
      return { accessToken: CAPABILITY, casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(now / 1000) + 600 };
    });
    const check = files.storage.assertWorkspaceAvailable.bind(files.storage);
    vi.spyOn(files.storage, 'assertWorkspaceAvailable').mockImplementation(async id => {
      await check(id);
      if (received && id === workspaceId) { entered.resolve(); await finish.promise; }
    });
    const job = await files.reserve(workspaceId, { name: 'capability-final-gap.txt', size: 1 });
    const capability = files.capability(job.id).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const deleting = cleanupWorkspaceConversationFiles(ctx, workspaceId);
    try {
      await waitForFence(); finish.resolve();
      expect(await capability).toMatchObject({ error: { code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' } }); await deleting;
      expect((await ctx.store.read<{ jobs: unknown[] }>('conversation-file-uploads-v1', { jobs: [] })).jobs).toEqual([]);
    } finally { finish.resolve(); await capability; await deleting; }
  });

  it('fences a delayed native commit and drains it before reporting permanent cleanup', async () => {
    const entered = gate(), finish = gate(), commit = files.storage.commit.bind(files.storage);
    vi.spyOn(files.storage, 'commit').mockImplementation(async (...args) => { entered.resolve(); await finish.promise; return commit(...args); });
    const job = await files.reserve(workspaceId, { name: 'commit-race.txt', size: 4 });
    await files.complete(job.id, bucket.stage('real')); await entered.promise;
    let finished = false;
    const deleting = cleanupWorkspaceConversationFiles(ctx, workspaceId).then(value => { finished = true; return value; });
    try {
      await waitForFence(); expect(finished).toBe(false);
      finish.resolve(); await deleting;
      await expect(fs.lstat(storageDir())).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await ctx.store.read<{ jobs: unknown[] }>('conversation-file-uploads-v1', { jobs: [] })).jobs).toEqual([]);
    } finally { finish.resolve(); await deleting; }
  });

  it('drains a reviewed copy waiting at its commit hook and removes only its disposable scratch', async () => {
    const attachment = await upload('copy-race.txt', 'copy should stop');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const entered = gate(), finish = gate();
    const copying = files.copyToWorkspace(workspaceId, ref(attachment), { path: 'never-created.txt' }, {
      source: 'agent', beforeCommit: async () => { entered.resolve(); await finish.promise; },
    }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    let finished = false;
    const deleting = cleanupWorkspaceConversationFiles(ctx, workspaceId).then(value => { finished = true; return value; });
    try {
      await waitForFence(); expect(finished).toBe(false);
      finish.resolve();
      expect(await copying).toMatchObject({ error: { code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' } }); await deleting;
      await expect(fs.lstat(path.join(workspacePath, 'never-created.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await fs.readdir(path.join(ctx.config.runtimeDir, 'tmp'))).filter(name => name.startsWith('.conversation-file-'))).toEqual([]);
    } finally { finish.resolve(); await copying; await deleting; }
  });

  it('drains a pending inspection and closes issued download descriptors before unlinking originals', async () => {
    const attachment = await upload('open.txt', 'readable before deletion');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const opened = await files.openDownloadSource(workspaceId, ref(attachment));
    const entered = gate(), finish = gate(), read = files.storage.read.bind(files.storage);
    vi.spyOn(files.storage, 'read').mockImplementation(async (...args) => { entered.resolve(); await finish.promise; return read(...args); });
    const reading = files.inspect(workspaceId, ref(attachment)).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const deleting = cleanupWorkspaceConversationFiles(ctx, workspaceId);
    try {
      await waitForFence(); finish.resolve();
      expect(await reading).toMatchObject({ error: { code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' } }); await deleting;
      await expect(opened.source.handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
      await opened.source.close(); await opened.source.close();
    } finally { finish.resolve(); await reading; await deleting; await opened.source.close(); }
  });

  it('preserves foreign ownership, unknown leaves and outside link targets until an exact safe retry', async () => {
    const attachment = await upload('foreign.txt', 'owned original');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const recordPath = path.join(storageDir(), `${attachment.id}.json`), originalRecord = await fs.readFile(recordPath);
    const changed = JSON.parse(originalRecord.toString()); changed.workspaceId = `foreign_${randomUUID().replaceAll('-', '')}`;
    await fs.writeFile(recordPath, JSON.stringify(changed));
    await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId)).rejects.toBeInstanceOf(HttpError);
    expect(await fs.readFile(path.join(storageDir(), `${attachment.id}.file`), 'utf8')).toBe('owned original');
    await fs.writeFile(recordPath, originalRecord);
    const external = path.join(directory, 'unrelated-outside.txt'); await fs.writeFile(external, 'keep outside');
    const unknown = path.join(storageDir(), 'not-an-attachment'); await fs.symlink(external, unknown);
    await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId)).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_CLEANUP_UNSAFE' });
    expect(await fs.readFile(external, 'utf8')).toBe('keep outside');
    expect(await fs.readFile(path.join(storageDir(), `${attachment.id}.file`), 'utf8')).toBe('owned original');
    await fs.unlink(unknown);
    expect((await cleanupWorkspaceConversationFiles(ctx, workspaceId)).filesRemoved).toBe(2);
    expect(await fs.readFile(external, 'utf8')).toBe('keep outside');
  });

  it('preserves corrupted immutable originals and wrong owner directories without following them', async () => {
    const attachment = await upload('corrupt.txt', 'original');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const blob = path.join(storageDir(), `${attachment.id}.file`);
    await fs.chmod(blob, 0o600); await fs.writeFile(blob, 'modified');
    await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId)).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_CLEANUP_UNSAFE' });
    expect(await fs.readFile(blob, 'utf8')).toBe('modified');
    await fs.writeFile(blob, 'original');
    const moved = `${storageDir()}.owned`; await fs.rename(storageDir(), moved);
    const outside = path.join(directory, 'outside-folder'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'preserve'), 'outside');
    await fs.symlink(outside, storageDir());
    await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId)).rejects.toMatchObject({ code: 'UNSAFE_FILE_ATTACHMENT_STORAGE' });
    expect(await fs.readFile(path.join(outside, 'preserve'), 'utf8')).toBe('outside');
    await fs.unlink(storageDir()); await fs.rename(moved, storageDir());
    await cleanupWorkspaceConversationFiles(ctx, workspaceId);
  });

  it('retries an interrupted payload/metadata unlink with its owning metadata still present', async () => {
    const attachment = await upload('retry.txt', 'payload before owner record');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const unlink = fs.unlink.bind(fs); let failed = false;
    vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (!failed && String(target).endsWith(`/${attachment.id}.json`)) { failed = true; throw Object.assign(new Error('Synthetic metadata unlink failure.'), { code: 'EACCES' }); }
      return unlink(target);
    });
    await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId)).rejects.toThrow('Synthetic metadata unlink failure.');
    await expect(fs.lstat(path.join(storageDir(), `${attachment.id}.file`))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await fs.readFile(path.join(storageDir(), `${attachment.id}.json`), 'utf8')).workspaceId).toBe(workspaceId);
    expect((await cleanupWorkspaceConversationFiles(ctx, workspaceId)).filesRemoved).toBe(1);
    expect(await cleanupWorkspaceConversationFiles(ctx, workspaceId)).toEqual({ filesRemoved: 0 });
  });

  it('keeps originals when the fence write fails and safely recognizes an interrupted deterministic marker on retry', async () => {
    const attachment = await upload('fence.txt', 'original until fenced');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const nativeOpen = fs.open.bind(fs); let failed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (!failed && String(args[0]).endsWith(`/${hash(workspaceId)}.deleted.json`) && typeof args[1] === 'number' && (args[1] & constants.O_CREAT)) {
        failed = true; throw Object.assign(new Error('Synthetic fence write failure.'), { code: 'EIO' });
      }
      return nativeOpen(...args);
    });
    await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId)).rejects.toThrow('Synthetic fence write failure.');
    expect(await fs.readFile(path.join(storageDir(), `${attachment.id}.file`), 'utf8')).toBe('original until fenced');
    await expect(files.storage.commit({ ...attachment, id: `file_${randomUUID().replaceAll('-', '')}` }, Buffer.from('original until fenced')))
      .rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_DELETED' });
    // A crash can leave an empty create-only marker. It remains an admission
    // fence; cleanup does not overwrite it or need a live workspace to retry.
    await fs.writeFile(deletionFencePath(), '', { flag: 'wx', mode: 0o600 });
    expect((await cleanupWorkspaceConversationFiles(ctx, workspaceId)).filesRemoved).toBe(2);
    expect(await fs.readFile(deletionFencePath(), 'utf8')).toBe('');
  });

  it('rechecks permanent-deletion authority and leaves originals when the caller becomes stale', async () => {
    const attachment = await upload('authority.txt', 'keep when superseded');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    let checks = 0;
    const assertCurrent = vi.fn(async () => {
      if (++checks >= 4) throw new HttpError(409, 'Synthetic superseded deletion.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
    });
    await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId, { assertCurrent })).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(await fs.readFile(path.join(storageDir(), `${attachment.id}.file`), 'utf8')).toBe('keep when superseded');
    expect((await cleanupWorkspaceConversationFiles(ctx, workspaceId, { assertCurrent: async () => undefined })).filesRemoved).toBe(2);
  });

  it('pins the original state directory through job cleanup instead of rewriting a substituted outside copy', async () => {
    const attachment = await upload('state-parent.txt', 'scope-protected original');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const stateFile = 'conversation-file-uploads-v1.json', state = ctx.config.stateDir, moved = `${state}.owned`;
    const original = await fs.readFile(path.join(state, stateFile));
    const outside = path.join(directory, 'outside-job-state'); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, stateFile), original);
    await fs.writeFile(path.join(outside, 'unrelated.json'), '{"keep":true}\n');
    const rename = fs.rename.bind(fs); let swapped = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (!swapped && String(to).endsWith(`/${stateFile}`)) {
        swapped = true; await rename(state, moved); await fs.symlink(outside, state);
      }
      return rename(from, to);
    });
    try {
      await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId)).rejects.toMatchObject({ code: 'UNSAFE_FILE_ATTACHMENT_STORAGE' });
      expect(swapped).toBe(true);
      expect(await fs.readFile(path.join(outside, stateFile))).toEqual(original);
      expect(await fs.readFile(path.join(outside, 'unrelated.json'), 'utf8')).toBe('{"keep":true}\n');
    } finally {
      if (swapped) { await fs.unlink(state); await rename(moved, state); }
    }
    await cleanupWorkspaceConversationFiles(ctx, workspaceId);
    expect(await fs.readFile(path.join(outside, stateFile))).toEqual(original);
  });

  it.each(['symlink', 'directory'] as const)('rejects a late %s replacement of upload history before the bounded CAS reread', async kind => {
    const attachment = await upload('state-leaf.txt', 'leaf-protected original');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const target = path.join(ctx.config.stateDir, 'conversation-file-uploads-v1.json'), saved = `${target}.owned`;
    const original = await fs.readFile(target), outside = path.join(directory, 'outside-history.json');
    await fs.writeFile(outside, original);
    const open = fs.open.bind(fs); let swapped = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (!swapped && /\/conversation-file-uploads-v1\.json\.[a-f0-9-]{36}\.tmp$/.test(String(args[0]))
        && typeof args[1] === 'number' && (args[1] & constants.O_CREAT)) {
        swapped = true; await fs.rename(target, saved);
        if (kind === 'symlink') await fs.symlink(outside, target); else await fs.mkdir(target);
      }
      return open(...args);
    });
    try {
      await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId)).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_CLEANUP_UNSAFE' });
      expect(swapped).toBe(true); expect(await fs.readFile(outside)).toEqual(original);
      const retained = await fs.lstat(target);
      expect(kind === 'symlink' ? retained.isSymbolicLink() : retained.isDirectory()).toBe(true);
    } finally {
      if (swapped) {
        if (kind === 'symlink') await fs.unlink(target); else await fs.rmdir(target);
        await fs.rename(saved, target);
      }
    }
    await cleanupWorkspaceConversationFiles(ctx, workspaceId);
    expect(await fs.readFile(outside)).toEqual(original);
  });

  it.each(['replacement', 'content edit'] as const)('rejects a staged history %s before overwriting authoritative history', async kind => {
    const attachment = await upload('staged-state.txt', 'owned');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const other = await ctx.workspaces.create({ name: 'Unrelated history' });
    const otherJob = await files.reserve(other.id, { name: 'unrelated.txt', size: 1 });
    const historyPath = path.join(ctx.config.stateDir, 'conversation-file-uploads-v1.json');
    const original = await fs.readFile(historyPath);
    let changed = false, temporaryPath: string | undefined, savedPath: string | undefined;
    const assertCurrent = async () => {
      if (changed) return;
      const name = (await fs.readdir(ctx.config.stateDir)).find(name => /^conversation-file-uploads-v1\.json\.[a-f0-9-]{36}\.tmp$/.test(name));
      if (!name) return;
      changed = true; temporaryPath = path.join(ctx.config.stateDir, name);
      if (kind === 'replacement') {
        savedPath = `${temporaryPath}.saved`; await fs.rename(temporaryPath, savedPath);
        await fs.writeFile(temporaryPath, '{"not":"the verified temporary"}\n');
      } else {
        const stat = await fs.stat(temporaryPath);
        await fs.writeFile(temporaryPath, Buffer.alloc(stat.size, 0x78));
        await fs.utimes(temporaryPath, stat.atime, stat.mtime);
      }
    };
    try {
      await expect(cleanupWorkspaceConversationFiles(ctx, workspaceId, { assertCurrent })).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_WORKSPACE_CLEANUP_UNSAFE' });
      expect(changed).toBe(true); expect(await fs.readFile(historyPath)).toEqual(original);
      expect((await files.get(otherJob.id)).state).toBe('reserved');
    } finally {
      if (temporaryPath) await fs.unlink(temporaryPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      if (savedPath) await fs.unlink(savedPath);
    }
    await cleanupWorkspaceConversationFiles(ctx, workspaceId);
    expect((await ctx.store.read<{ jobs: Array<{ id: string }> }>('conversation-file-uploads-v1', { jobs: [] })).jobs.map(job => job.id)).toEqual([otherJob.id]);
  });

  it('admits cold lazy reads before joining the expiry cleanup drain', async () => {
    const attachment = await upload('lazy-read.txt', 'retained through trash');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const trashed = await ctx.workspaces.trashWorkspace(workspaceId, { expectedMode: 'trash' });
    if (trashed.mode !== 'trash') throw new Error('Expected ordinary trash.');
    await files.close(); await shutdownUploads(ctx);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(trashed.trash.expiresAt) + 1);
    let cold!: AppContext; let cleanupCalls = 0;
    cold = context({ lifecycle: { cleanupWorkspaceArtifacts: async request => {
      cleanupCalls++; await cleanupWorkspaceConversationFiles(cold, request.workspaceId, { assertCurrent: request.assertCurrent });
    } } });
    const lazy = new ConversationFilesService(cold, { bucket, now: () => now, cleanupIntervalMs: 0 }); instances.push(lazy);
    const escape = gate(), get = cold.workspaces.get.bind(cold.workspaces);
    vi.spyOn(cold.workspaces, 'get').mockImplementation((...args) => Promise.race([
      get(...args), escape.promise.then(() => { throw new Error('Fixture admission was interrupted after its deadline.'); }),
    ]));
    const reading = lazy.resolve(workspaceId, []).then(value => ({ value }), error => ({ error }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([reading, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Cold read and permanent cleanup deadlocked.')), 5000);
      })]);
      expect('error' in result && result.error).toBeInstanceOf(HttpError); expect(cleanupCalls).toBe(1);
      await expect(fs.lstat(storageDir())).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { clearTimeout(timer); escape.resolve(); await reading; await cold.workspaces.initialize(); }
  });

  it('admits cold completion before its mutation queue can block another workspace’s startup purge', async () => {
    const own = await upload('lazy-complete-deleted.txt', 'expired workspace');
    await files.resolve(workspaceId, [ref(own)], { retain: true });
    const other = await ctx.workspaces.create({ name: 'Surviving completion' });
    const job = await files.reserve(other.id, { name: 'surviving.txt', size: 4 }), hashes = bucket.stage('keep');
    await files.complete(job.id, hashes); const ready = await waitForJob(files, job.id);
    await files.resolve(other.id, [ref(ready.attachment!)], { retain: true });
    const trashed = await ctx.workspaces.trashWorkspace(workspaceId, { expectedMode: 'trash' });
    if (trashed.mode !== 'trash') throw new Error('Expected ordinary trash.');
    await files.close(); await shutdownUploads(ctx);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(trashed.trash.expiresAt) + 1);
    let cold!: AppContext; let cleanupCalls = 0;
    cold = context({ lifecycle: { cleanupWorkspaceArtifacts: async request => {
      cleanupCalls++; await cleanupWorkspaceConversationFiles(cold, request.workspaceId, { assertCurrent: request.assertCurrent });
    } } });
    const lazy = new ConversationFilesService(cold, { bucket, now: () => now, cleanupIntervalMs: 0 }); instances.push(lazy);
    await lazy.initialize(); expect(cleanupCalls).toBe(0);
    const escape = gate(), get = cold.workspaces.get.bind(cold.workspaces);
    vi.spyOn(cold.workspaces, 'get').mockImplementation((...args) => Promise.race([
      get(...args), escape.promise.then(() => { throw new Error('Fixture admission was interrupted after its deadline.'); }),
    ]));
    const completing = lazy.complete(job.id, hashes);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([completing, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Cold completion and another workspace’s purge deadlocked.')), 5000);
      })]);
      expect(result).toMatchObject({ state: 'ready', workspaceId: other.id, attachment: ready.attachment });
      expect(cleanupCalls).toBe(1);
      await expect(fs.lstat(storageDir())).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { clearTimeout(timer); escape.resolve(); await completing.catch(() => undefined); await cold.workspaces.initialize(); }
  });

  it('preserves ordinary workspace trash and restore, then cleans originals only on explicit permanent purge', async () => {
    const attachment = await upload('restorable.txt', 'restorable conversation original');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const cleaned: string[] = [];
    let lifecycle!: AppContext;
    lifecycle = context({ lifecycle: { cleanupWorkspaceArtifacts: async request => {
      cleaned.push(request.workspaceId);
      await cleanupWorkspaceConversationFiles(lifecycle, request.workspaceId, { assertCurrent: request.assertCurrent });
    } } });
    await lifecycle.workspaces.initialize();
    const trashed = await lifecycle.workspaces.trashWorkspace(workspaceId, { expectedMode: 'trash' });
    if (trashed.mode !== 'trash') throw new Error('Expected restorable ordinary workspace trash.');
    expect(cleaned).toEqual([]);
    expect(await fs.readFile(path.join(storageDir(), `${attachment.id}.file`), 'utf8')).toBe('restorable conversation original');
    await expect(fs.lstat(deletionFencePath())).rejects.toMatchObject({ code: 'ENOENT' });
    await lifecycle.workspaces.restoreWorkspaceTrash(trashed.trash.id);
    expect((await files.inspect(workspaceId, ref(attachment))).content).toBe('restorable conversation original');
    const again = await lifecycle.workspaces.trashWorkspace(workspaceId, { expectedMode: 'trash' });
    if (again.mode !== 'trash') throw new Error('Expected ordinary trash.');
    await lifecycle.workspaces.purgeWorkspaceTrash(again.trash.id);
    expect(cleaned).toEqual([workspaceId]);
    await expect(fs.lstat(storageDir())).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await listTrashRecords(lifecycle.config)).find(record => record.id === again.trash.id)?.artifactCleanup?.state).toBe('complete');
  });

  it('purges retained originals on the native 30-day startup expiry path without reentering live workspace lookup', async () => {
    const attachment = await upload('expiry.txt', 'retained until workspace expiry');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const trashed = await ctx.workspaces.trashWorkspace(workspaceId, { expectedMode: 'trash' });
    if (trashed.mode !== 'trash') throw new Error('Expected ordinary trash.');
    await files.close(); await shutdownUploads(ctx);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(trashed.trash.expiresAt) + 1);
    let cold!: AppContext; let cleanupCalls = 0;
    cold = context({ lifecycle: { cleanupWorkspaceArtifacts: async request => {
      cleanupCalls++;
      const get = vi.spyOn(cold.workspaces, 'get').mockRejectedValue(new Error('No lookup during startup replay.'));
      try { await cleanupWorkspaceConversationFiles(cold, request.workspaceId, { assertCurrent: request.assertCurrent }); expect(get).not.toHaveBeenCalled(); }
      finally { get.mockRestore(); }
    } } });
    await cold.workspaces.initialize();
    expect(cleanupCalls).toBe(1); expect(await cold.workspaces.listWorkspaceTrash()).toEqual([]);
    await expect(fs.lstat(storageDir())).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await listTrashRecords(cold.config)).find(record => record.id === trashed.trash.id)?.phase).toBe('purged');
  });
});

async function httpService() {
  const selected = context(); await selected.workspaces.initialize();
  await initializeConversationFiles(selected, { bucket, now: () => now, cleanupIntervalMs: 0 });
  await initializeDownloads(selected, { bucket, now: () => now, cleanupIntervalMs: 60_000, startupAttempts: 1 });
  const auth = new AuthService(selected); authServices.push(auth); await auth.initialize();
  const app = express(); app.use('/api', auth.protectMutations, express.json({ limit: '1mb' }), auth.router());
  app.use('/api', auth.requireSession, createConversationFilesRouter(selected));
  const handler: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof HttpError ? error.status : 500)
      .json({ error: error instanceof HttpError ? error.message : 'Internal server error', code: error instanceof HttpError ? error.code : 'INTERNAL' });
  };
  app.use(handler); const server = createServer(app); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  const request = (route: string, options: { method?: string; body?: unknown; authenticated?: boolean; origin?: string; raw?: string } = {}) => fetch(`${origin}/api${route}`, {
    method: options.method ?? 'GET', headers: { Origin: options.origin ?? origin, 'X-Codex-Workspace': '1',
      ...(options.authenticated === false || !cookie ? {} : { Cookie: cookie }),
      ...(options.raw !== undefined ? { 'Content-Type': 'application/octet-stream' } : options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.raw !== undefined ? { body: options.raw } : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const login = await request('/session', { method: 'POST', body: { password: selected.config.password } });
  expect(login.status).toBe(200); cookie = login.headers.get('set-cookie')!.split(';')[0];
  return { ctx: selected, request };
}

describe('authenticated file attachment HTTP contracts', () => {
  it('gates reserve, inspection, downloads and discard with sessions/origin while rejecting raw upload bodies', async () => {
    const attachment = await upload('markup.html', '<script>not run</script>');
    const { request } = await httpService(), base = `/workspaces/${workspaceId}/file-attachments`;
    expect((await request(`${base}/uploads`, { method: 'POST', body: { name: 'x', size: 1 }, authenticated: false })).status).toBe(401);
    expect((await request(`${base}/uploads`, { method: 'POST', body: { name: 'x', size: 1 }, origin: 'https://untrusted.invalid' })).status).toBe(403);
    expect((await request(`${base}/uploads`, { method: 'POST', raw: 'no raw bytes through app' })).status).toBe(400);
    expect((await request(`${base}/${attachment.id}/inspect?sha256=${attachment.sha256}`, { authenticated: false })).status).toBe(401);
    expect((await request(`${base}/${attachment.id}/downloads`, { method: 'POST', body: { sha256: attachment.sha256 }, authenticated: false })).status).toBe(401);
    expect((await request(`${base}/${attachment.id}?sha256=${attachment.sha256}`, { method: 'DELETE', origin: 'https://untrusted.invalid' })).status).toBe(403);
    const preview = await request(`${base}/${attachment.id}/inspect?sha256=${attachment.sha256}`);
    expect(preview.headers.get('content-type')).toContain('application/json'); expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    expect(preview.headers.get('cache-control')).toContain('no-store'); expect(await preview.json()).toMatchObject({ format: 'utf8', content: '<script>not run</script>' });
    expect((await request(`${base}/${attachment.id}/content?sha256=${attachment.sha256}`)).status).toBe(404);
    expect((await request(`${base}/${attachment.id}?sha256=${attachment.sha256}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('prepares attachment downloads through the existing immutable public link lifecycle', async () => {
    const attachment = await upload('download.html', '<h1>the real attachment</h1>');
    await files.resolve(workspaceId, [ref(attachment)], { retain: true });
    const { ctx: selected, request } = await httpService();
    const response = await request(`/workspaces/${workspaceId}/file-attachments/${attachment.id}/downloads`, { method: 'POST', body: { sha256: attachment.sha256 } });
    expect(response.status).toBe(202);
    const started = await response.json() as { id: string }, downloads = getDownloadService(selected);
    let result = await downloads.get(started.id);
    const deadline = Date.now() + 5000;
    while (!terminal.has(result.state) && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 3)); result = await downloads.get(started.id); }
    expect(result).toMatchObject({ state: 'ready', version: attachment.sha256, source: { type: 'attachment', id: attachment.id, sha256: attachment.sha256 }, mimeType: 'application/octet-stream' });
    expect(result.url).toMatch(/^https:\/\/huggingface.co\/buckets\/alvin3y12\/codex-downloads\/resolve\/exports\//);
    expect(Date.parse(result.expiresAt!) - Date.parse(result.uploadedAt!)).toBe(DOWNLOAD_RETENTION_MS);
    expect([...bucket.objects.values()].find(value => value.path.startsWith('exports/'))?.content.toString()).toBe('<h1>the real attachment</h1>');
    expect(JSON.stringify(result)).not.toContain(ctx.config.stateDir);
    now += DOWNLOAD_RETENTION_MS + 1; await downloads.cleanup(); await getUploadService(selected).cleanup();
    expect((await files.inspect(workspaceId, ref(attachment))).content).toBe('<h1>the real attachment</h1>');
  });
});
