import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { defaultSettings } from '../server/settings';
import { createApplication } from '../server/index';
import { ImageAttachmentService, IMAGE_ATTACHMENT_LIMITS, getImageAttachments, type ImageAttachment } from '../server/agent/attachments';

// Real independently encoded one-pixel fixtures. The app never runs an image
// decoder or shell process to validate, store, preview, or forward them.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLooorxz9OP//Z', 'base64');
const gif = Buffer.from('R0lGODdhAQABAIEAAOc3PAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==', 'base64');
const webp = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoBAAEAAUAmJaACdLoAA5gA/urUf/cdgbrxb/97Bf+9AP+9AP6+AAAA', 'base64');
const animatedGif = Buffer.from('R0lGODlhAQABAIEAAOc3PAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQABQAAACwAAAAAAQABAAAIBAABBAQAIfkEAQUAAQAsAAAAAAEAAQCBKissAAAAAAAAAAAACAQAAQQEADs=', 'base64');
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const ref = (attachment: ImageAttachment) => ({ id: attachment.id, sha256: attachment.sha256 });

// Add a valid ancillary text chunk to exercise real byte limits without
// constructing a huge raster or teaching the test to bypass image validation.
function paddedPng(size: number): Buffer {
  const chunk = Buffer.alloc(size - png.length, 0x78);
  chunk.writeUInt32BE(chunk.length - 12, 0);
  chunk.write('tEXt', 4, 'ascii'); chunk.write('padding\0', 8, 'ascii');
  let checksum = 0xffffffff;
  const table = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  for (let index = 4; index < chunk.length - 4; index++) checksum = table[(checksum ^ chunk[index]) & 255] ^ (checksum >>> 8);
  chunk.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
}

let directory: string, runtimeDirectory: string, ctx: AppContext, workspaceId: string, workspacePath: string, now: number;
let service: ImageAttachmentService;
let application: Awaited<ReturnType<typeof createApplication>> | undefined;
let origin: string, cookie: string;
const assetDirectory = () => path.join(ctx.config.stateDir, 'image-attachments-v1', digest(workspaceId));

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-attachments-test-'));
  runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-attachments-test-runtime-'));
  const config = { ...loadConfig({ DATA_DIR: directory, NODE_ENV: 'test', WORKSPACE_PASSWORD: 'attachment-test-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) }), runtimeDir: runtimeDirectory };
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store);
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(), settings: async () => ({ ...defaultSettings }), saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  await workspaces.initialize();
  const workspace = await workspaces.create({ name: 'Image attachment tests' });
  workspaceId = workspace.id; workspacePath = workspace.path;
  now = Date.now();
  service = new ImageAttachmentService(ctx, { now: () => now, cleanupIntervalMs: 0 });
  application = undefined; cookie = '';
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (application) { application.server.closeAllConnections(); await application.close(); }
  await service.close(); await ctx.store.flush();
  await Promise.all([directory, runtimeDirectory].map(root => fs.rm(root, { recursive: true, force: true })));
});

async function startApplication() {
  application = await createApplication({ ...ctx.config, codexCliAutoStart: false });
  await new Promise<void>(resolve => application!.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(application.server.address() as { port: number }).port}`;
}

function request(route: string, options: { method?: string; body?: unknown; bytes?: Buffer; authenticated?: boolean; requestOrigin?: string; marker?: boolean; headers?: Record<string, string> } = {}) {
  return fetch(`${origin}${route.startsWith('/api/') ? route : `/api${route}`}`, {
    method: options.method ?? 'GET',
    headers: { Origin: options.requestOrigin ?? origin,
      ...(options.marker === false ? {} : { 'X-Codex-Workspace': '1' }),
      ...(options.authenticated === false || !cookie ? {} : { Cookie: cookie }),
      ...(options.bytes ? { 'Content-Type': 'application/octet-stream' } : options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers },
    ...(options.bytes ? { body: new Uint8Array(options.bytes) } : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function login() {
  const response = await request('/session', { method: 'POST', authenticated: false, body: { password: ctx.config.password } });
  expect(response.status).toBe(200); cookie = response.headers.get('set-cookie')!.split(';')[0];
}

describe('durable user Image / LocalImage attachment bytes', () => {
  it.each([['png', png, 'image/png'], ['jpeg', jpeg, 'image/jpeg'], ['gif', gif, 'image/gif'], ['webp', webp, 'image/webp']] as const)(
    'stores and resolves actual %s bytes as user input_image parts without a public path or secret in metadata', async (extension, bytes, mimeType) => {
      const uploaded = await service.upload(workspaceId, { name: `picture.${extension}`, bytes, detail: 'original' });
      expect(uploaded).toEqual({ id: expect.stringMatching(/^att_[a-f0-9]{32}$/), workspaceId, name: `picture.${extension}`, mimeType,
        bytes: bytes.length, width: 1, height: 1, detail: 'original', sha256: digest(bytes), createdAt: new Date(now).toISOString(),
        previewUrl: expect.stringMatching(new RegExp(`/attachments/att_[a-f0-9]{32}/content\\?sha256=${digest(bytes)}$`)) });
      const resolved = await service.resolve(workspaceId, [ref(uploaded)], { retain: true });
      expect(resolved.attachments).toEqual([uploaded]);
      expect(resolved.content).toEqual([{ type: 'input_image', image_url: `data:${mimeType};base64,${bytes.toString('base64')}`, detail: 'original' }]);
      expect((await service.preview(workspaceId, uploaded.id, uploaded.sha256)).bytes).toEqual(bytes);
      expect(await fs.readFile(path.join(assetDirectory(), `${uploaded.id}.image`))).toEqual(bytes);
      const publicMetadata = JSON.stringify(uploaded);
      for (const value of [ctx.config.password, ctx.config.sessionSecret, ctx.config.encryptionKey, ctx.config.stateDir, bytes.toString('base64'), 'retainedAt', 'state', 'kind']) expect(publicMetadata).not.toContain(value);
    });

  it('takes an immutable upload snapshot before an awaiting caller can mutate its buffer', async () => {
    const caller = Buffer.from(png);
    const pending = service.upload(workspaceId, { name: 'snapshot.png', bytes: caller });
    caller.fill(0);
    const uploaded = await pending;
    expect((await service.preview(workspaceId, uploaded.id, uploaded.sha256)).bytes).toEqual(png);
  });

  it('snapshots an authorized workspace path and leaves source files untouched after removal or later edits', async () => {
    const source = path.join(workspacePath, 'diagram.png'); await fs.writeFile(source, png);
    const uploaded = await service.fromWorkspace(workspaceId, { path: 'diagram.png', expectedVersion: digest(png) });
    await fs.writeFile(source, gif);
    expect((await service.preview(workspaceId, uploaded.id, uploaded.sha256)).bytes).toEqual(png);
    expect(await service.discard(workspaceId, uploaded.id)).toEqual({ deleted: true });
    expect(await fs.readFile(source)).toEqual(gif);
    await expect(service.preview(workspaceId, uploaded.id, uploaded.sha256)).rejects.toMatchObject({ status: 404, code: 'ATTACHMENT_NOT_FOUND' });
  });

  it('accepts safe internal file links but rejects external files, traversal, URLs, and stale versions', async () => {
    await fs.writeFile(path.join(workspacePath, 'safe.png'), png);
    await fs.symlink('safe.png', path.join(workspacePath, 'internal.png'));
    expect((await service.fromWorkspace(workspaceId, { path: 'internal.png' })).sha256).toBe(digest(png));
    await fs.writeFile(path.join(directory, 'outside.png'), png);
    await fs.symlink(path.join(directory, 'outside.png'), path.join(workspacePath, 'outside.png'));
    for (const selected of ['outside.png', path.join(directory, 'outside.png')]) await expect(service.fromWorkspace(workspaceId, { path: selected })).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
    await expect(service.fromWorkspace(workspaceId, { path: '../outside.png' })).rejects.toMatchObject({ status: 400, code: 'INVALID_PATH' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const selected of ['https://example.invalid/private.png', 'file:///etc/passwd', 'data:image/png;base64,AAAA']) await expect(service.fromWorkspace(workspaceId, { path: selected })).rejects.toMatchObject({ status: 400, code: 'INVALID_PATH' });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(service.fromWorkspace(workspaceId, { path: 'safe.png', expectedVersion: '0'.repeat(64) })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
  });

  it('detects a source change between its two complete reads instead of silently selecting newer bytes', async () => {
    const source = path.join(workspacePath, 'changing.png'); await fs.writeFile(source, png);
    const originalOpen = fs.open.bind(fs); let sourceOpens = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      if (filename === source && ++sourceOpens === 2) await fs.writeFile(source, gif);
      return originalOpen(filename, flags, mode);
    });
    await expect(service.fromWorkspace(workspaceId, { path: 'changing.png' })).rejects.toMatchObject({ status: 409, code: 'IMAGE_CHANGED' });
    expect(sourceOpens).toBe(2);
  });

  it.each([
    ['svg.png', Buffer.from('<svg><script>alert(1)</script></svg>'), 'UNSUPPORTED_IMAGE'],
    ['empty.png', Buffer.alloc(0), 'INVALID_IMAGE'],
    ['broken.png', png.subarray(0, png.length - 1), 'INVALID_IMAGE'],
    ['animated.gif', animatedGif, 'ANIMATED_IMAGE'],
  ] as const)('rejects unsupported or invalid %s before creating storage', async (name, bytes, code) => {
    await expect(service.upload(workspaceId, { name, bytes })).rejects.toMatchObject({ status: 415, code });
    await expect(fs.stat(path.join(ctx.config.stateDir, 'image-attachments-v1'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces byte/dimension limits and readable basename validation independently of file extensions', async () => {
    await expect(service.upload(workspaceId, { name: 'too-big.png', bytes: Buffer.alloc(IMAGE_ATTACHMENT_LIMITS.maxBytes + 1) })).rejects.toMatchObject({ status: 413, code: 'IMAGE_TOO_LARGE' });
    const wide = Buffer.from(png); wide.writeUInt32BE(IMAGE_ATTACHMENT_LIMITS.maxDimension + 1, 16);
    await expect(service.upload(workspaceId, { name: 'wide.png', bytes: wide })).rejects.toMatchObject({ status: 413, code: 'IMAGE_DIMENSIONS_EXCEEDED' });
    for (const name of ['../private.png', '/secret.png', 'one\\two.png', 'bad\r\nname.png', '', '..', 'x'.repeat(256)]) await expect(service.upload(workspaceId, { name, bytes: png })).rejects.toMatchObject({ status: 400, code: 'INVALID_ATTACHMENT_NAME' });
    expect((await service.upload(workspaceId, { name: 'picture.unknown', bytes: png })).mimeType).toBe('image/png');
  });

  it('pins preview/model data to both the submitted SHA and the actual content on disk', async () => {
    const uploaded = await service.upload(workspaceId, { name: 'immutable.png', bytes: png });
    await expect(service.preview(workspaceId, uploaded.id, '0'.repeat(64))).rejects.toMatchObject({ status: 409, code: 'ATTACHMENT_CHANGED' });
    await fs.writeFile(path.join(assetDirectory(), `${uploaded.id}.image`), gif);
    await expect(service.resolve(workspaceId, [ref(uploaded)])).rejects.toMatchObject({ status: 409, code: 'ATTACHMENT_CHANGED' });
    await expect(service.preview(workspaceId, uploaded.id, uploaded.sha256)).rejects.toMatchObject({ status: 409, code: 'ATTACHMENT_CHANGED' });
    const filename = path.join(assetDirectory(), `${uploaded.id}.json`), record = JSON.parse(await fs.readFile(filename, 'utf8'));
    await fs.writeFile(filename, JSON.stringify({ ...record, sha256: digest(gif), bytes: gif.length, mimeType: 'image/gif' }));
    await expect(service.preview(workspaceId, uploaded.id, uploaded.sha256)).rejects.toMatchObject({ status: 409, code: 'ATTACHMENT_CHANGED' });
  });

  it('requires references from the same workspace and rejects repeated or forged reference fields', async () => {
    const uploaded = await service.upload(workspaceId, { name: 'one.png', bytes: png });
    const other = await ctx.workspaces.create({ name: 'Other workspace' });
    await expect(service.resolve(other.id, [ref(uploaded)])).rejects.toMatchObject({ status: 404, code: 'ATTACHMENT_NOT_FOUND' });
    await expect(service.resolve(workspaceId, [ref(uploaded), ref(uploaded)])).rejects.toMatchObject({ status: 400, code: 'INVALID_ATTACHMENT_INPUT' });
    const forgedReference = { ...ref(uploaded), image_url: 'https://example.invalid' };
    await expect(service.resolve(workspaceId, [forgedReference])).rejects.toMatchObject({ status: 400, code: 'INVALID_ATTACHMENT_INPUT' });
    await expect(service.resolve(workspaceId, Array.from({ length: 9 }, () => ({ id: `att_${randomUUID().replaceAll('-', '')}`, sha256: digest(png) })))).rejects.toMatchObject({ status: 400, code: 'INVALID_ATTACHMENT_INPUT' });
    await expect(service.discard(workspaceId, '../elsewhere')).rejects.toMatchObject({ status: 404, code: 'ATTACHMENT_NOT_FOUND' });
  });

  it('rejects an oversized image batch without retaining any draft in the failed batch', async () => {
    const bytes = paddedPng(6 * 1024 * 1024), images: ImageAttachment[] = [];
    for (let index = 0; index < 3; index++) images.push(await service.upload(workspaceId, { name: `six-megabytes-${index}.png`, bytes }));
    await expect(service.resolve(workspaceId, images.map(ref), { retain: true })).rejects.toMatchObject({ status: 413, code: 'ATTACHMENT_MESSAGE_TOO_LARGE' });
    now += IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs;
    expect(await service.cleanupExpired()).toMatchObject({ deleted: 3 });
  });

  it('bounds unsubmitted drafts and concurrent upload work while allowing cleanup to make room', async () => {
    const simultaneous = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => service.upload(workspaceId, { name: `${index}.png`, bytes: png })));
    expect(simultaneous.filter(item => item.status === 'fulfilled')).toHaveLength(4);
    expect(simultaneous.find(item => item.status === 'rejected')).toMatchObject({ status: 'rejected', reason: { status: 429, code: 'ATTACHMENT_UPLOAD_BUSY' } });
    for (let index = 4; index < IMAGE_ATTACHMENT_LIMITS.maxDrafts; index++) await service.upload(workspaceId, { name: `${index}.png`, bytes: png });
    await expect(service.upload(workspaceId, { name: 'full.png', bytes: png })).rejects.toMatchObject({ status: 429, code: 'ATTACHMENT_DRAFT_LIMIT' });
    now += IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs;
    expect((await service.upload(workspaceId, { name: 'after-expiry.png', bytes: png })).name).toBe('after-expiry.png');
  });

  it('retains accepted images across a real fresh Node process and never exposes bytes through public metadata', async () => {
    const uploaded = await service.upload(workspaceId, { name: 'persistent.png', bytes: png });
    await service.resolve(workspaceId, [ref(uploaded)], { retain: true });
    await service.close();
    const source = `
      import { loadConfig } from './server/config.ts';
      import { JsonStore } from './server/store.ts';
      import { WorkspaceService } from './server/workspaces.ts';
      import { ImageAttachmentService } from './server/agent/attachments.ts';
      const [data, workspaceId, id, sha256] = process.argv.slice(1);
      const config = loadConfig({ DATA_DIR: data, WORKSPACE_PASSWORD: 'attachment-test-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
      const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store);
      const service = new ImageAttachmentService({config,store,workspaces}, {cleanupIntervalMs:0,now:()=>Date.now()+48*60*60*1000});
      const result = await service.preview(workspaceId,id,sha256);
      const resolved = await service.resolve(workspaceId,[{id,sha256}]);
      process.stdout.write(JSON.stringify({metadata:result.attachment,bytes:result.bytes.toString('base64'),content:resolved.content}));
      await service.close();
    `;
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, directory, workspaceId, uploaded.id, uploaded.sha256], {
      cwd: path.resolve('.'), env: { PATH: process.env.PATH }, timeout: 15_000, maxBuffer: 128 * 1024,
    });
    const restored = JSON.parse(result.stdout);
    expect(restored.metadata).toEqual(uploaded); expect(Buffer.from(restored.bytes, 'base64')).toEqual(png);
    expect(restored.content).toEqual([{ type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}`, detail: 'high' }]);
  });
});

describe('attachment storage boundaries and abandoned draft recovery', () => {
  it('cleans only expired unsubmitted assets during startup and preserves accepted images', async () => {
    const abandoned = await service.upload(workspaceId, { name: 'draft.png', bytes: png });
    const accepted = await service.upload(workspaceId, { name: 'accepted.png', bytes: png });
    await service.resolve(workspaceId, [ref(accepted)], { retain: true });
    await expect(service.discard(workspaceId, accepted.id)).rejects.toMatchObject({ status: 409, code: 'ATTACHMENT_IN_USE' });
    now += IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs - 1;
    expect((await service.cleanupExpired()).deleted).toBe(0);
    expect((await service.preview(workspaceId, abandoned.id, abandoned.sha256)).bytes).toEqual(png);
    now++;
    await expect(service.preview(workspaceId, abandoned.id, abandoned.sha256)).rejects.toMatchObject({ status: 410, code: 'ATTACHMENT_EXPIRED' });
    await service.close();
    service = new ImageAttachmentService(ctx, { now: () => now, cleanupIntervalMs: 0 });
    await service.initialize();
    await expect(fs.stat(path.join(assetDirectory(), `${abandoned.id}.image`))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await service.preview(workspaceId, accepted.id, accepted.sha256)).bytes).toEqual(png);
  });

  it('recovers its own interrupted upload marker without deleting unrelated files, folders, or external symlink targets', async () => {
    const uploaded = await service.upload(workspaceId, { name: 'interrupted.png', bytes: png });
    const filename = path.join(assetDirectory(), `${uploaded.id}.json`), record = JSON.parse(await fs.readFile(filename, 'utf8'));
    await fs.writeFile(filename, JSON.stringify({ ...record, state: 'uploading' }));
    await fs.rename(path.join(assetDirectory(), `${uploaded.id}.image`), path.join(assetDirectory(), `${uploaded.id}.upload`));
    const outside = path.join(directory, 'keep-me.png'); await fs.writeFile(outside, png);
    const unrelated = path.join(assetDirectory(), 'user-notes.txt'); await fs.writeFile(unrelated, 'Do not remove me.');
    const forgedId = `att_${randomUUID().replaceAll('-', '')}`;
    await fs.writeFile(path.join(assetDirectory(), `${forgedId}.json`), JSON.stringify({ ...record, id: forgedId, createdAt: new Date(now - IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs).toISOString(), storagePath: outside }));
    await fs.symlink(outside, path.join(assetDirectory(), `${forgedId}.image`));
    await fs.mkdir(path.join(assetDirectory(), 'unrelated-directory'));
    now += IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs;
    expect(await service.cleanupExpired()).toMatchObject({ deleted: 1, skipped: 1 });
    expect(await fs.readFile(outside)).toEqual(png); expect(await fs.readFile(unrelated, 'utf8')).toBe('Do not remove me.');
    expect((await fs.lstat(path.join(assetDirectory(), `${forgedId}.image`))).isSymbolicLink()).toBe(true);
    expect((await fs.stat(path.join(assetDirectory(), 'unrelated-directory'))).isDirectory()).toBe(true);
  });

  it('does not follow blob or metadata symlinks even when they contain otherwise valid image records', async () => {
    const uploaded = await service.upload(workspaceId, { name: 'safe.png', bytes: png });
    const outside = path.join(directory, 'outside.png'); await fs.writeFile(outside, png);
    const blob = path.join(assetDirectory(), `${uploaded.id}.image`);
    await fs.unlink(blob); await fs.symlink(outside, blob);
    await expect(service.preview(workspaceId, uploaded.id, uploaded.sha256)).rejects.toMatchObject({ status: 403, code: 'UNSAFE_ATTACHMENT_STORAGE' });
    await service.discard(workspaceId, uploaded.id);
    expect(await fs.readFile(outside)).toEqual(png);
    const next = await service.upload(workspaceId, { name: 'another.png', bytes: png });
    const record = path.join(assetDirectory(), `${next.id}.json`), foreign = path.join(directory, 'outside-record.json');
    await fs.rename(record, foreign); await fs.symlink(foreign, record);
    await expect(service.resolve(workspaceId, [ref(next)])).rejects.toMatchObject({ status: 403, code: 'UNSAFE_ATTACHMENT_STORAGE' });
  });

  it('rejects attachment directory replacement between resolution and open without reading an external file', async () => {
    const uploaded = await service.upload(workspaceId, { name: 'safe.png', bytes: png });
    const external = path.join(directory, 'outside-assets'); await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'keep.txt'), 'Private external fixture.');
    const originalOpen = fs.open.bind(fs); let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      if (!replaced && String(filename).endsWith(`/${digest(workspaceId)}`)) {
        replaced = true; await fs.rename(assetDirectory(), `${assetDirectory()}-original`); await fs.symlink(external, assetDirectory());
      }
      return originalOpen(filename, flags, mode);
    });
    await expect(service.preview(workspaceId, uploaded.id, uploaded.sha256)).rejects.toMatchObject({ status: 403, code: 'UNSAFE_ATTACHMENT_STORAGE' });
    expect(replaced).toBe(true); expect(await fs.readFile(path.join(external, 'keep.txt'), 'utf8')).toBe('Private external fixture.');
  });

  it('rejects symlinked attachment roots and data-state escape before creating files elsewhere', async () => {
    const outside = path.join(directory, 'outside-storage'); await fs.mkdir(outside);
    const root = path.join(ctx.config.stateDir, 'image-attachments-v1'); await fs.symlink(outside, root);
    await expect(service.upload(workspaceId, { name: 'unsafe.png', bytes: png })).rejects.toMatchObject({ status: 403, code: 'UNSAFE_ATTACHMENT_STORAGE' });
    expect(await fs.readdir(outside)).toEqual([]);
    await service.close();
    service = new ImageAttachmentService({ ...ctx, config: { ...ctx.config, stateDir: path.join(directory, '..', 'unowned-state') } }, { cleanupIntervalMs: 0 });
    await expect(service.initialize()).rejects.toMatchObject({ status: 403, code: 'UNSAFE_ATTACHMENT_STORAGE' });
  });

  it('cleans its own aborted write and releases upload capacity without deleting the source bytes', async () => {
    const abort = new AbortController(), originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const result = await originalOpen(filename, flags, mode);
      if (String(filename).endsWith('.upload')) abort.abort(new Error('Cancelled fixture upload'));
      return result;
    });
    await expect(service.upload(workspaceId, { name: 'cancel.png', bytes: png }, { signal: abort.signal })).rejects.toThrow('Cancelled fixture upload');
    expect(await fs.readdir(assetDirectory())).toEqual([]);
    vi.restoreAllMocks();
    expect((await service.upload(workspaceId, { name: 'retry.png', bytes: png })).sha256).toBe(digest(png));
  });
});

describe('real createApplication authenticated attachment REST lifecycle', () => {
  it('uses the actual app session/mutation middleware and serves immutable Unicode-named raster bytes with safe headers', async () => {
    await startApplication();
    const endpoint = `/workspaces/${workspaceId}/attachments?name=${encodeURIComponent('design café 🟡.png')}`;
    expect((await request(endpoint, { method: 'POST', bytes: png, authenticated: false })).status).toBe(401);
    await login();
    expect((await request(endpoint, { method: 'POST', bytes: png, requestOrigin: 'https://example.invalid' })).status).toBe(403);
    expect((await request(endpoint, { method: 'POST', bytes: png, marker: false })).status).toBe(403);
    const uploadedResponse = await request(endpoint, { method: 'POST', bytes: png });
    expect(uploadedResponse.status).toBe(201);
    const uploaded = await uploadedResponse.json() as ImageAttachment;
    expect(uploaded.name).toBe('design café 🟡.png'); expect(uploaded.sha256).toBe(digest(png));
    expect((await request(uploaded.previewUrl, { authenticated: false })).status).toBe(401);
    const preview = await request(uploaded.previewUrl);
    expect(preview.status).toBe(200); expect(preview.headers.get('content-type')).toBe('image/png');
    expect(preview.headers.get('cache-control')).toContain('no-store'); expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    expect(preview.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(preview.headers.get('content-disposition')).toContain("filename*=UTF-8''design%20caf%C3%A9%20%F0%9F%9F%A1.png");
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
    expect((await request(uploaded.previewUrl.replace(uploaded.sha256, '0'.repeat(64)))).status).toBe(409);
    expect((await request(`/workspaces/${workspaceId}/attachments/${uploaded.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await request(uploaded.previewUrl)).status).toBe(404);
  });

  it('validates raw upload/query shapes, local path snapshots, and actual payload bounds through app middleware', async () => {
    await startApplication(); await login();
    const endpoint = `/workspaces/${workspaceId}/attachments?name=image.png`;
    expect((await request(endpoint, { method: 'POST', body: { image_url: 'https://example.invalid' } })).status).toBe(415);
    expect((await request(`${endpoint}&remoteUrl=https://example.invalid`, { method: 'POST', bytes: png })).status).toBe(400);
    expect((await request(`${endpoint}&detail=low`, { method: 'POST', bytes: png })).status).toBe(400);
    expect((await request(endpoint, { method: 'POST', bytes: Buffer.alloc(IMAGE_ATTACHMENT_LIMITS.maxBytes + 1) })).status).toBe(413);
    await fs.writeFile(path.join(workspacePath, 'local.png'), png);
    const fromWorkspace = await request(`/workspaces/${workspaceId}/attachments/from-workspace`, { method: 'POST', body: { path: 'local.png', expectedVersion: digest(png), detail: 'original' } });
    expect(fromWorkspace.status).toBe(201); expect(await fromWorkspace.json()).toMatchObject({ name: 'local.png', detail: 'original', sha256: digest(png) });
    expect((await request(`/workspaces/${workspaceId}/attachments/from-workspace`, { method: 'POST', body: { path: 'local.png', expectedVersion: '0'.repeat(64) } })).status).toBe(409);
  });

  it('preserves the old signed session and retained image through a full application stop/start', async () => {
    await startApplication(); await login();
    const response = await request(`/workspaces/${workspaceId}/attachments?name=restart.png`, { method: 'POST', bytes: png });
    expect(response.status).toBe(201); const uploaded = await response.json() as ImageAttachment;
    await getImageAttachments(application!.ctx).resolve(workspaceId, [ref(uploaded)], { retain: true });
    const oldCookie = cookie;
    application!.server.closeAllConnections(); await application!.close(); application = undefined;
    await startApplication();
    expect(cookie).toBe(oldCookie);
    const restored = await request(uploaded.previewUrl);
    expect(restored.status).toBe(200); expect(Buffer.from(await restored.arrayBuffer())).toEqual(png);
    const removed = await request(`/workspaces/${workspaceId}/attachments/${uploaded.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(409); expect(await removed.json()).toMatchObject({ code: 'ATTACHMENT_IN_USE' });
    await request('/session', { method: 'DELETE' });
    expect((await request(uploaded.previewUrl)).status).toBe(401);
  });
});
