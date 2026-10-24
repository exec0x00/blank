import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { defaultSettings } from '../server/settings';
import { HttpError } from '../server/errors';
import { cleanupWorkspaceImageAttachments, ImageAttachmentService, type ImageAttachment } from '../server/agent/attachments';
import { cleanupWorkspaceGeneratedImages, GeneratedImageService } from '../server/generated-images';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const webp = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoBAAEAAUAmJaACdLoAA5gA/urUf/cdgbrxb/97Bf+9AP+9AP6+AAAA', 'base64');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const ref = (image: ImageAttachment) => ({ id: image.id, sha256: image.sha256 });
const writes = (flags: Parameters<typeof fs.open>[1]) => typeof flags === 'number' && Boolean(flags & constants.O_WRONLY);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

let directory: string, ctx: AppContext, workspaceId: string, clock: number;
let attachments: ImageAttachmentService, generated: GeneratedImageService;
let extras: Array<{ close(): Promise<void> }>;
let cleanupCalls: string[];
const attachmentRoot = () => path.join(ctx.config.stateDir, 'image-attachments-v1');
const attachmentDirectory = (id = workspaceId) => path.join(attachmentRoot(), hash(id));
const generatedRoot = () => path.join(ctx.config.dataDir, 'generated-images-v1');
const generatedDirectory = (id = workspaceId) => path.join(generatedRoot(), hash(id));
const uploadedFence = () => path.join(attachmentRoot(), `${hash(workspaceId)}.deleted.json`);

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'codex-image-original-cleanup-'));
  const config = loadConfig({ DATA_DIR: directory, NODE_ENV: 'test', WORKSPACE_PASSWORD: 'image-cleanup-test-only', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
  const store = new JsonStore(config.stateDir); cleanupCalls = [];
  const cleanup = async (request: WorkspaceArtifactCleanupRequest) => {
    cleanupCalls.push(request.workspaceId);
    await request.assertCurrent();
    await cleanupWorkspaceImageAttachments(config, request.workspaceId, { assertCurrent: request.assertCurrent });
    await request.assertCurrent();
    await cleanupWorkspaceGeneratedImages(config, request.workspaceId, { assertCurrent: request.assertCurrent });
    await request.assertCurrent();
  };
  const workspaces = new WorkspaceService(config, store, { cleanupWorkspaceArtifacts: cleanup });
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: async () => ({ ...defaultSettings }), saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  await workspaces.initialize(); workspaceId = (await workspaces.create({ name: 'Image cleanup' })).id;
  clock = Date.now(); extras = [];
  attachments = new ImageAttachmentService(ctx, { now: () => clock, cleanupIntervalMs: 0 });
  generated = new GeneratedImageService(ctx);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([attachments.close(), generated.close(), ...extras.map(service => service.close())]);
  await ctx.workspaces.closeTrashCleanup(); await ctx.store.flush();
  await fs.rm(directory, { recursive: true, force: true });
});

async function retained(id = workspaceId, service = attachments): Promise<ImageAttachment> {
  const image = await service.upload(id, { name: 'retained.png', bytes: png });
  await service.resolve(id, [ref(image)], { retain: true });
  return image;
}
async function imageGeneration(id = workspaceId, itemId = 'ig_cleanup') {
  return generated.commit({ workspaceId: id, threadId: 'thread_cleanup', messageId: 'msg_cleanup', runId: 'run_cleanup', itemId,
    resultBase64: png.toString('base64'), outputFormat: 'png' });
}

describe('uploaded image originals at permanent workspace deletion', () => {
  it('removes retained originals without a live root and preserves other workspace IDs, settings, accounts and separate download copies', async () => {
    const image = await retained(), other = await ctx.workspaces.create({ name: 'Images to keep' });
    const otherImage = await retained(other.id);
    await ctx.store.write('settings', { fontSize: 19 });
    await ctx.store.write('github-accounts', [{ id: 'gh_fixture', login: 'fixture-user' }]);
    const downloadCopy = path.join(ctx.config.dataDir, 'separate-download-snapshot.png'); await fs.writeFile(downloadCopy, png);
    const stateBefore = await Promise.all(['settings.json', 'github-accounts.json'].map(name => fs.readFile(path.join(ctx.config.stateDir, name))));
    const project = await ctx.workspaces.get(workspaceId); await fs.rm(project.path, { recursive: true });
    const get = vi.spyOn(ctx.workspaces, 'get').mockRejectedValue(new Error('No live workspace root is available'));
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).toEqual({ workspaceId, attachmentsRemoved: 1, filesRemoved: 2, permanentlyFenced: true });
    expect(get).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(await fs.readdir(attachmentDirectory())).toEqual([]);
    expect(await fs.readFile(path.join(attachmentDirectory(other.id), `${otherImage.id}.image`))).toEqual(png);
    expect(await fs.readFile(downloadCopy)).toEqual(png);
    expect(await Promise.all(['settings.json', 'github-accounts.json'].map(name => fs.readFile(path.join(ctx.config.stateDir, name))))).toEqual(stateBefore);
    await expect(attachments.preview(workspaceId, image.id, image.sha256)).rejects.toMatchObject({ code: 'ATTACHMENT_WORKSPACE_DELETED' });
  });

  it('retains originals through real ordinary trash and restore without invoking permanent cleanup', async () => {
    const uploaded = await retained(), produced = await imageGeneration();
    const result = await ctx.workspaces.trashWorkspace(workspaceId, { expectedMode: 'trash' });
    if (result.mode !== 'trash') throw new Error('Expected ordinary workspace trash.');
    clock += 31 * 24 * 60 * 60_000; await attachments.cleanupExpired();
    expect(cleanupCalls).toEqual([]);
    expect(await fs.readFile(path.join(attachmentDirectory(), `${uploaded.id}.image`))).toEqual(png);
    expect(await fs.readFile(path.join(generatedDirectory(), `${produced.id}.image`))).toEqual(png);
    await ctx.workspaces.restoreWorkspaceTrash(result.trash.id);
    expect((await attachments.preview(workspaceId, uploaded.id, uploaded.sha256)).bytes).toEqual(png);
    expect((await generated.read(workspaceId, produced.id, produced.sha256)).bytes).toEqual(png);
  });

  it('uses the real permanent-purge callback after a trashed root is gone', async () => {
    await retained(); await imageGeneration();
    const result = await ctx.workspaces.trashWorkspace(workspaceId, { expectedMode: 'trash' });
    if (result.mode !== 'trash') throw new Error('Expected ordinary workspace trash.');
    expect(cleanupCalls).toEqual([]);
    await ctx.workspaces.purgeWorkspaceTrash(result.trash.id);
    expect(cleanupCalls).toEqual([workspaceId]);
    expect(await fs.readdir(attachmentDirectory())).toEqual([]);
    expect(await fs.readdir(generatedDirectory())).toEqual([]);
  });

  it('cleans image originals when an actual GitHub-backed workspace is permanently deleted locally', async () => {
    const github = await ctx.workspaces.create({ name: 'Local GitHub image project', initializeGit: true });
    await fs.appendFile(path.join(github.path, '.git', 'config'), '\n[remote "origin"]\n\turl = https://github.com/example/image-cleanup.git\n');
    await retained(github.id); await imageGeneration(github.id);
    const result = await ctx.workspaces.trashWorkspace(github.id, { expectedMode: 'permanent' });
    expect(result).toEqual({ removed: true, mode: 'permanent', workspaceId: github.id });
    expect(cleanupCalls).toEqual([github.id]);
    expect(await fs.readdir(attachmentDirectory(github.id))).toEqual([]);
    expect(await fs.readdir(generatedDirectory(github.id))).toEqual([]);
    await expect(fs.lstat(github.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves a durable fence across a fresh service and permits genuine new workspace IDs', async () => {
    await retained(); await cleanupWorkspaceImageAttachments(ctx.config, workspaceId); await attachments.close();
    attachments = new ImageAttachmentService({ ...ctx }, { cleanupIntervalMs: 0 });
    await expect(attachments.upload(workspaceId, { name: 'late.png', bytes: png })).rejects.toMatchObject({ code: 'ATTACHMENT_WORKSPACE_DELETED' });
    const other = await ctx.workspaces.create({ name: 'New image workspace' });
    expect(await attachments.upload(other.id, { name: 'new.png', bytes: png })).toMatchObject({ workspaceId: other.id });
    expect(await cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).toMatchObject({ attachmentsRemoved: 0, filesRemoved: 0 });
  });

  it('retains ownership metadata after an interrupted unlink so cleanup can retry idempotently', async () => {
    const image = await retained(), unlink = fs.unlink.bind(fs); let failed = false;
    vi.spyOn(fs, 'unlink').mockImplementation(async file => {
      if (!failed && String(file).endsWith(`${image.id}.json`)) { failed = true; throw Object.assign(new Error('Injected storage interruption'), { code: 'EIO' }); }
      return unlink(file);
    });
    await expect(cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).rejects.toMatchObject({ code: 'ATTACHMENT_CLEANUP_CONFLICT' });
    expect(await fs.readdir(attachmentDirectory())).toEqual([`${image.id}.json`]);
    vi.restoreAllMocks();
    expect(await cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).toMatchObject({ attachmentsRemoved: 1, filesRemoved: 1 });
    expect(await cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).toMatchObject({ attachmentsRemoved: 0, filesRemoved: 0 });
  });

  it('validates every owning record before deleting any leaf and rejects a copied foreign owner', async () => {
    const first = await retained(), second = await retained(), file = path.join(attachmentDirectory(), `${second.id}.json`);
    const original = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...original, workspaceId: 'ws_foreign' }));
    await expect(cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).rejects.toMatchObject({ code: 'ATTACHMENT_CLEANUP_CONFLICT' });
    expect(await fs.readFile(path.join(attachmentDirectory(), `${first.id}.image`))).toEqual(png);
    expect(await fs.readFile(path.join(attachmentDirectory(), `${second.id}.image`))).toEqual(png);
    await fs.writeFile(file, JSON.stringify(original));
    expect(await cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).toMatchObject({ attachmentsRemoved: 2, filesRemoved: 4 });
  });

  it.each(['orphan', 'unknown', 'symlink'] as const)('preserves %s entries instead of treating a matching prefix as ownership', async kind => {
    const image = await retained(), extra = path.join(attachmentDirectory(), kind === 'orphan' ? `att_${'f'.repeat(32)}.image` : 'unowned.txt');
    const external = path.join(directory, 'outside.png'); await fs.writeFile(external, png);
    if (kind === 'symlink') await fs.symlink(external, extra); else await fs.writeFile(extra, 'Unverified data.');
    await expect(cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).rejects.toMatchObject({ code: 'ATTACHMENT_CLEANUP_CONFLICT' });
    expect(await fs.readFile(path.join(attachmentDirectory(), `${image.id}.image`))).toEqual(png);
    expect(await fs.readFile(external)).toEqual(png);
    expect((await fs.lstat(extra)).isSymbolicLink()).toBe(kind === 'symlink');
  });

  it('does not follow a workspace attachment directory replaced by a symlink', async () => {
    const image = await retained(), external = path.join(directory, 'outside-assets'); await fs.mkdir(external);
    await fs.writeFile(path.join(external, `${image.id}.json`), 'Unrelated external data.');
    await fs.rename(attachmentDirectory(), `${attachmentDirectory()}-old`); await fs.symlink(external, attachmentDirectory());
    await expect(cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).rejects.toMatchObject({ code: 'ATTACHMENT_CLEANUP_CONFLICT' });
    expect(await fs.readFile(path.join(external, `${image.id}.json`), 'utf8')).toBe('Unrelated external data.');
    expect(await fs.readFile(path.join(`${attachmentDirectory()}-old`, `${image.id}.image`))).toEqual(png);
  });

  it('honors revoked deletion authority before fencing or removing anything', async () => {
    const image = await retained(), stale = new HttpError(409, 'Deletion changed.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
    await expect(cleanupWorkspaceImageAttachments(ctx.config, workspaceId, { assertCurrent: async () => { throw stale; } })).rejects.toBe(stale);
    await expect(fs.lstat(uploadedFence())).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await attachments.preview(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
  });

  it('removes a verified interrupted upload while retaining unrelated images', async () => {
    const image = await attachments.upload(workspaceId, { name: 'interrupted.png', bytes: png });
    const file = path.join(attachmentDirectory(), `${image.id}.json`), record = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...record, state: 'uploading' }));
    await fs.rename(path.join(attachmentDirectory(), `${image.id}.image`), path.join(attachmentDirectory(), `${image.id}.upload`));
    await fs.writeFile(path.join(attachmentDirectory(), `${image.id}.upload`), png.subarray(0, 12));
    expect(await cleanupWorkspaceImageAttachments(ctx.config, workspaceId)).toMatchObject({ attachmentsRemoved: 1, filesRemoved: 2 });
    expect(await fs.readdir(attachmentDirectory())).toEqual([]);
  });

  it.each(['uploaded', 'generated'] as const)('accepts a torn legacy %s fence only as deny intent under current cleanup authority', async kind => {
    if (kind === 'uploaded') await retained(); else await imageGeneration();
    const storage = kind === 'uploaded' ? attachmentRoot() : generatedRoot();
    const marker = path.join(storage, `${hash(workspaceId)}.deleted.json`); await fs.writeFile(marker, '{');
    if (kind === 'uploaded') await cleanupWorkspaceImageAttachments(ctx.config, workspaceId);
    else await cleanupWorkspaceGeneratedImages(ctx.config, workspaceId);
    expect(await fs.readdir(kind === 'uploaded' ? attachmentDirectory() : generatedDirectory())).toEqual([]);
    expect(await fs.readFile(marker, 'utf8')).toBe('{');
  });

  it.each(['uploaded', 'generated'] as const)('retries a %s fence creation interrupted during durability sync', async kind => {
    if (kind === 'uploaded') await retained(); else await imageGeneration();
    const open = fs.open.bind(fs); let remainingFailures = 2;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (remainingFailures && String(file).endsWith('.deleted.json')) {
        remainingFailures--; vi.spyOn(handle, 'sync').mockRejectedValueOnce(Object.assign(new Error('Fence sync interrupted'), { code: 'ENOSPC' }));
      }
      return handle;
    });
    const remove = () => kind === 'uploaded' ? cleanupWorkspaceImageAttachments(ctx.config, workspaceId) : cleanupWorkspaceGeneratedImages(ctx.config, workspaceId);
    await expect(remove()).rejects.toMatchObject({ code: kind === 'uploaded' ? 'ENOSPC' : 'GENERATED_IMAGE_STORAGE_FULL' });
    const marker = path.join(kind === 'uploaded' ? attachmentRoot() : generatedRoot(), `${hash(workspaceId)}.deleted.json`);
    expect((await fs.stat(marker)).size).toBe(0);
    await expect(remove()).rejects.toMatchObject({ code: kind === 'uploaded' ? 'ENOSPC' : 'GENERATED_IMAGE_STORAGE_FULL' });
    expect((await fs.readdir(kind === 'uploaded' ? attachmentDirectory() : generatedDirectory())).length).toBe(kind === 'uploaded' ? 2 : 3);
    vi.restoreAllMocks(); await remove();
    expect(await fs.readdir(kind === 'uploaded' ? attachmentDirectory() : generatedDirectory())).toEqual([]);
  });
});

describe('owned image operations racing permanent cleanup', () => {
  it('fences and drains an upload from another live context before cleanup completes', async () => {
    const peer = new ImageAttachmentService({ ...ctx }, { cleanupIntervalMs: 0 }); extras.push(peer);
    const entered = deferred(), release = deferred(), fenced = deferred(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.upload') && writes(flags)) { entered.resolve(); await release.promise; }
      if (String(file).endsWith('.deleted.json') && writes(flags)) fenced.resolve();
      return handle;
    });
    const pending = peer.upload(workspaceId, { name: 'late.png', bytes: png }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    let removed = false; const purge = cleanupWorkspaceImageAttachments(ctx.config, workspaceId).then(value => { removed = true; return value; });
    await fenced.promise; await Promise.resolve(); expect(removed).toBe(false);
    release.resolve();
    expect(await pending).toMatchObject({ error: { code: 'ATTACHMENT_WORKSPACE_DELETED' } });
    expect(await purge).toMatchObject({ permanentlyFenced: true });
    expect(await fs.readdir(attachmentDirectory())).toEqual([]);
  });

  it('drains a from-workspace import that has not entered its storage queue', async () => {
    const workspace = await ctx.workspaces.get(workspaceId), source = path.join(workspace.path, 'source.png'); await fs.writeFile(source, png);
    const entered = deferred(), release = deferred(), fenced = deferred(), open = fs.open.bind(fs); let held = false;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (!held && String(file) === source) { held = true; entered.resolve(); await release.promise; }
      if (String(file).endsWith('.deleted.json') && writes(flags)) fenced.resolve();
      return handle;
    });
    const pending = attachments.fromWorkspace(workspaceId, { path: 'source.png' }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    let removed = false; const purge = cleanupWorkspaceImageAttachments(ctx.config, workspaceId).then(value => { removed = true; return value; });
    await fenced.promise; await Promise.resolve(); expect(removed).toBe(false);
    release.resolve();
    expect(await pending).toMatchObject({ error: { code: 'ATTACHMENT_WORKSPACE_DELETED' } });
    expect(await purge).toMatchObject({ filesRemoved: 0, permanentlyFenced: true });
    expect(await fs.readFile(source)).toEqual(png);
  });

  it('cancels retention before it can publish a late metadata update', async () => {
    const image = await attachments.upload(workspaceId, { name: 'pending.png', bytes: png });
    const entered = deferred(), release = deferred(), fenced = deferred(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.meta.tmp') && writes(flags)) { entered.resolve(); await release.promise; }
      if (String(file).endsWith('.deleted.json') && writes(flags)) fenced.resolve();
      return handle;
    });
    const pending = attachments.resolve(workspaceId, [ref(image)], { retain: true }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const purge = cleanupWorkspaceImageAttachments(ctx.config, workspaceId);
    await fenced.promise; release.resolve();
    expect(await pending).toMatchObject({ error: { code: 'ATTACHMENT_WORKSPACE_DELETED' } });
    expect(await purge).toMatchObject({ attachmentsRemoved: 1, filesRemoved: 2 });
    expect(await fs.readdir(attachmentDirectory())).toEqual([]);
  });
});

describe('startup-safe generated image cleanup', () => {
  it('drains a generated commit waiting for workspace admission in a different context', async () => {
    const peer = new GeneratedImageService({ ...ctx }); extras.push(peer);
    const entered = deferred(), release = deferred(), fenced = deferred(), get = ctx.workspaces.get.bind(ctx.workspaces), open = fs.open.bind(fs);
    const lookup = vi.spyOn(ctx.workspaces, 'get').mockImplementationOnce(async id => { entered.resolve(); await release.promise; return get(id); });
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.deleted.json') && writes(flags)) fenced.resolve();
      return handle;
    });
    const pending = peer.commit({ workspaceId, threadId: 'thread_cleanup', messageId: 'msg_cleanup', runId: 'run_cleanup', itemId: 'ig_late',
      resultBase64: png.toString('base64'), outputFormat: 'png' }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    let removed = false; const purge = cleanupWorkspaceGeneratedImages(ctx.config, workspaceId).then(value => { removed = true; return value; });
    await fenced.promise; await Promise.resolve(); expect(removed).toBe(false);
    release.resolve();
    expect(await pending).toMatchObject({ error: { code: 'GENERATED_IMAGE_WORKSPACE_DELETED' } });
    expect(await purge).toMatchObject({ deletedFiles: 0, permanentlyFenced: true });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('purges only verified generated originals without a live workspace or unrelated startup sweep', async () => {
    const image = await imageGeneration(), other = await ctx.workspaces.create({ name: 'Generated images to keep' });
    const kept = await imageGeneration(other.id, 'ig_keep');
    const orphan = path.join(generatedDirectory(other.id), `img_${'f'.repeat(64)}.image`); await fs.writeFile(orphan, 'Unrelated interrupted data.');
    await generated.close();
    const get = vi.spyOn(ctx.workspaces, 'get').mockRejectedValue(new Error('No live root'));
    expect(await cleanupWorkspaceGeneratedImages({ dataDir: ctx.config.dataDir }, workspaceId)).toMatchObject({ deletedFiles: 3, permanentlyFenced: true });
    expect(get).not.toHaveBeenCalled();
    expect(await fs.readdir(generatedDirectory())).toEqual([]);
    expect(await fs.readFile(path.join(generatedDirectory(other.id), `${kept.id}.image`))).toEqual(png);
    expect(await fs.readFile(orphan, 'utf8')).toBe('Unrelated interrupted data.');
    expect(await cleanupWorkspaceGeneratedImages(ctx.config, workspaceId)).toMatchObject({ deletedFiles: 0 });
    expect(image.workspaceId).toBe(workspaceId);
  });

  it('refuses an unowned generated prefix before deleting verified images', async () => {
    const image = await imageGeneration(), orphan = path.join(generatedDirectory(), `img_${'f'.repeat(64)}.image`);
    await fs.writeFile(orphan, 'Unverified bytes.');
    await expect(cleanupWorkspaceGeneratedImages(ctx.config, workspaceId)).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CLEANUP_INCOMPLETE' });
    expect(await fs.readFile(path.join(generatedDirectory(), `${image.id}.image`))).toEqual(png);
    expect(await fs.readFile(orphan, 'utf8')).toBe('Unverified bytes.');
  });

  it('retries a generated purge with missing payload bytes using the still-owned record', async () => {
    const image = await imageGeneration(), unlink = fs.unlink.bind(fs); let failed = false;
    vi.spyOn(fs, 'unlink').mockImplementation(async file => {
      if (!failed && String(file).endsWith(`${image.id}.json`)) { failed = true; throw Object.assign(new Error('Injected metadata interruption'), { code: 'EIO' }); }
      return unlink(file);
    });
    await expect(cleanupWorkspaceGeneratedImages(ctx.config, workspaceId)).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CLEANUP_INCOMPLETE' });
    expect(await fs.readdir(generatedDirectory())).toEqual([`${image.id}.json`]);
    vi.restoreAllMocks();
    expect(await cleanupWorkspaceGeneratedImages(ctx.config, workspaceId)).toMatchObject({ deletedFiles: 1 });
    expect(await cleanupWorkspaceGeneratedImages(ctx.config, workspaceId)).toMatchObject({ deletedFiles: 0 });
  });

  it('preserves generated ownership metadata when cancelled byte-write rollback fails', async () => {
    const entered = deferred(), release = deferred(), fenced = deferred(), open = fs.open.bind(fs), unlink = fs.unlink.bind(fs);
    let failRollback = true;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.image') && writes(flags)) { entered.resolve(); await release.promise; }
      if (String(file).endsWith('.deleted.json') && writes(flags)) fenced.resolve();
      return handle;
    });
    vi.spyOn(fs, 'unlink').mockImplementation(async file => {
      if (failRollback && String(file).endsWith('.image')) throw Object.assign(new Error('Interrupted rollback'), { code: 'EIO' });
      return unlink(file);
    });
    const pending = imageGeneration(workspaceId, 'ig_rollback').then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const purge = cleanupWorkspaceGeneratedImages(ctx.config, workspaceId).then(value => ({ value }), error => ({ error }));
    await fenced.promise; release.resolve();
    expect(await pending).toMatchObject({ error: { code: 'GENERATED_IMAGE_WORKSPACE_DELETED' } });
    expect(await purge).toMatchObject({ error: { code: 'GENERATED_IMAGE_CLEANUP_INCOMPLETE' } });
    const names = await fs.readdir(generatedDirectory());
    expect(names.filter(name => name.endsWith('.json'))).toHaveLength(1);
    expect(names.filter(name => name.endsWith('.image'))).toHaveLength(1);
    failRollback = false;
    expect(await cleanupWorkspaceGeneratedImages(ctx.config, workspaceId)).toMatchObject({ deletedFiles: 2 });
    expect(await fs.readdir(generatedDirectory())).toEqual([]);
  });

  it('drains overlapping startup recovery before removing committed markers', async () => {
    const saved = await imageGeneration(); await generated.close();
    const peer = new GeneratedImageService({ ...ctx }); extras.push(peer);
    const entered = deferred(), release = deferred(), fenced = deferred(), opendir = fs.opendir.bind(fs), open = fs.open.bind(fs); let held = false;
    vi.spyOn(fs, 'opendir').mockImplementation(async (file, options) => {
      if (!held && await fs.realpath(file) === generatedDirectory()) { held = true; entered.resolve(); await release.promise; }
      return opendir(file, options);
    });
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.deleted.json') && writes(flags)) fenced.resolve();
      return handle;
    });
    const initializing = peer.initialize(); await entered.promise;
    const purge = cleanupWorkspaceGeneratedImages(ctx.config, workspaceId);
    await fenced.promise;
    expect(await Promise.race([purge.then(() => 'completed'), new Promise<string>(resolve => setTimeout(() => resolve('waiting'), 100))])).toBe('waiting');
    expect((await fs.lstat(path.join(generatedDirectory(), `${saved.id}.ready`))).isFile()).toBe(true);
    release.resolve(); await initializing;
    expect(await purge).toMatchObject({ deletedFiles: 3 });
  });

  it('aborts and drains a verified-read lease before original cleanup', async () => {
    const image = await imageGeneration(), entered = deferred(), release = deferred(), fenced = deferred(), open = fs.open.bind(fs);
    let leaseSignal: AbortSignal | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.deleted.json') && writes(flags)) fenced.resolve();
      return handle;
    });
    const pending = generated.withRead(workspaceId, image, async (read, signal) => {
      expect(read.bytes).toEqual(png); leaseSignal = signal; entered.resolve(); await release.promise; signal.throwIfAborted(); return 'copied';
    }, { threadId: image.threadId }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    let removed = false; const purge = cleanupWorkspaceGeneratedImages(ctx.config, workspaceId).then(value => { removed = true; return value; });
    await fenced.promise; expect(leaseSignal?.aborted).toBe(true); expect(removed).toBe(false);
    release.resolve();
    expect(await pending).toMatchObject({ error: { code: 'GENERATED_IMAGE_WORKSPACE_DELETED' } });
    expect(await purge).toMatchObject({ deletedFiles: 3 });
  });

  it('keeps an independently verified delivery snapshot after the original lease ends', async () => {
    const image = await imageGeneration(), snapshot = path.join(directory, 'independent-download.png');
    await generated.withRead(workspaceId, image, async (read, signal) => {
      signal.throwIfAborted(); await fs.writeFile(snapshot, read.bytes, { flag: 'wx' });
      expect(hash(await fs.readFile(snapshot))).toBe(read.metadata.sha256); signal.throwIfAborted();
    });
    await cleanupWorkspaceGeneratedImages(ctx.config, workspaceId);
    expect(await fs.readFile(snapshot)).toEqual(png);
  });
});
