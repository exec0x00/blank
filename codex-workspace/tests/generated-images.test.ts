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
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { AuthService } from '../server/auth';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import {
  GeneratedImageService, GENERATED_IMAGE_LIMITS, createGeneratedImagesRouter, getGeneratedImageService,
  type CommitGeneratedImageInput, type GeneratedImageMetadata,
} from '../server/generated-images';

// Independently encoded real raster fixtures, shared in origin with view_image
// tests. They exercise filesystem bytes; production never manufactures a model result.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const webp = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoBAAEAAUAmJaACdLoAA5gA/urUf/cdgbrxb/97Bf+9AP+9AP6+AAAA', 'base64');
const gif = Buffer.from('R0lGODdhAQABAIEAAOc3PAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==', 'base64');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const reference = (image: GeneratedImageMetadata) => ({ id: image.id, sha256: image.sha256 });
const writing = (flags: Parameters<typeof fs.open>[1]) => typeof flags === 'number' && Boolean(flags & constants.O_WRONLY);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

let directory: string, workspaceId: string, ctx: AppContext, service: GeneratedImageService;
let auth: AuthService | undefined, server: Server | undefined, origin: string;
const root = () => path.join(ctx.config.dataDir, 'generated-images-v1');
const imageDirectory = (id = workspaceId) => path.join(root(), hash(id));
const fencePath = (id = workspaceId) => path.join(root(), `${hash(id)}.deleted.json`);
const input = (patch: Partial<CommitGeneratedImageInput> = {}): CommitGeneratedImageInput => ({
  workspaceId, threadId: 'thread_images', messageId: 'msg_images', runId: 'run_images', itemId: 'ig_image_one',
  resultBase64: png.toString('base64'), outputFormat: 'png', revisedPrompt: 'A small colored square.', ...patch,
});

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'codex-generated-images-'));
  const config = loadConfig({ DATA_DIR: directory, NODE_ENV: 'test', WORKSPACE_PASSWORD: 'generated-image-test-only', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store);
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: async () => ({ ...defaultSettings }), saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  await workspaces.initialize();
  workspaceId = (await workspaces.create({ name: 'Generated images' })).id;
  service = new GeneratedImageService(ctx, { now: () => Date.parse('2026-09-20T08:00:00.000Z') });
  auth = undefined; server = undefined; origin = '';
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  }
  await auth?.close(); await service.close(); await ctx.store.flush();
  await fs.rm(directory, { recursive: true, force: true });
});

async function restart() {
  await service.close();
  service = new GeneratedImageService({ ...ctx });
  await service.initialize();
}

describe('real immutable generated image storage', () => {
  it.each([['png', png, 'image/png'], ['webp', webp, 'image/webp']] as const)(
    'commits exact %s bytes and exposes metadata without payloads or server paths', async (format, bytes, mimeType) => {
      const emit = vi.spyOn(ctx.events, 'emit');
      const result = await service.commit(input({ resultBase64: bytes.toString('base64'), outputFormat: format }));
      expect(result).toEqual({ id: expect.stringMatching(/^img_[a-f0-9]{64}$/), sha256: hash(bytes), workspaceId,
        threadId: 'thread_images', messageId: 'msg_images', runId: 'run_images', itemId: 'ig_image_one', state: 'completed',
        mimeType, bytes: bytes.length, width: 1, height: 1, createdAt: '2026-09-20T08:00:00.000Z', revisedPrompt: 'A small colored square.',
        previewUrl: expect.stringContaining(`/api/workspaces/${workspaceId}/generated-images/`) });
      expect(result.previewUrl).toContain(`?sha256=${hash(bytes)}`);
      expect((await service.read(workspaceId, result.id, result.sha256)).bytes).toEqual(bytes);
      expect(await fs.readFile(path.join(imageDirectory(), `${result.id}.image`))).toEqual(bytes);
      expect(await service.modelContent(workspaceId, reference(result), { threadId: 'thread_images', detail: 'original' })).toEqual({
        type: 'input_image', image_url: `data:${mimeType};base64,${bytes.toString('base64')}`, detail: 'original',
      });
      for (const value of [bytes.toString('base64'), 'resultBase64', directory, ctx.config.password, ctx.config.sessionSecret, ctx.config.encryptionKey, 'kind']) {
        expect(JSON.stringify(result)).not.toContain(value);
      }
      const persisted = await fs.readFile(path.join(imageDirectory(), `${result.id}.json`), 'utf8');
      expect(persisted).not.toContain(bytes.toString('base64'));
      expect(emit).not.toHaveBeenCalled();
    });

  it('deduplicates repeated final items concurrently and after a fresh service starts', async () => {
    const saved = await Promise.all([service.commit(input()), service.commit(input()), service.commit(input())]);
    expect(saved[1]).toEqual(saved[0]); expect(saved[2]).toEqual(saved[0]);
    expect((await fs.readdir(imageDirectory())).sort()).toEqual([`${saved[0].id}.image`, `${saved[0].id}.json`, `${saved[0].id}.ready`]);
    await restart();
    expect(await service.commit(input())).toEqual(saved[0]);
    expect((await service.read(workspaceId, saved[0].id, saved[0].sha256)).bytes).toEqual(png);
  });

  it('rejects conflicting bytes for an existing call and preserves its original artifact', async () => {
    const saved = await service.commit(input());
    await expect(service.commit(input({ resultBase64: webp.toString('base64'), outputFormat: 'webp' }))).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CONFLICT' });
    await expect(service.commit(input({ messageId: 'msg_different' }))).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CONFLICT' });
    expect((await service.read(workspaceId, saved.id)).bytes).toEqual(png);
  });

  it('gives separate threads and runs separate artifacts without relying on provider IDs as filenames', async () => {
    const first = await service.commit(input());
    const second = await service.commit(input({ runId: 'run_second' }));
    const third = await service.commit(input({ threadId: 'thread_second' }));
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect((await fs.readdir(imageDirectory())).every(name => !name.includes('ig_image_one'))).toBe(true);
    await expect(service.commit(input({ itemId: '../../outside' }))).rejects.toMatchObject({ code: 'INVALID_GENERATED_IMAGE_INPUT' });
  });

  it('captures caller metadata and base64 before asynchronous workspace admission', async () => {
    const gate = deferred(), entered = deferred(), get = ctx.workspaces.get.bind(ctx.workspaces);
    vi.spyOn(ctx.workspaces, 'get').mockImplementationOnce(async id => { entered.resolve(); await gate.promise; return get(id); });
    const source = input(), pending = service.commit(source);
    await entered.promise;
    source.resultBase64 = webp.toString('base64'); source.outputFormat = 'webp'; source.revisedPrompt = 'changed'; source.itemId = 'ig_other';
    gate.resolve();
    const saved = await pending;
    expect(saved).toMatchObject({ itemId: 'ig_image_one', revisedPrompt: 'A small colored square.', sha256: hash(png) });
  });

  it.each(['', '!!!!', 'AA=A', '/x==', `${png.toString('base64')}\n`])('rejects malformed/noncanonical base64 before creating storage (%s)', async resultBase64 => {
    await expect(service.commit(input({ resultBase64 }))).rejects.toMatchObject({ code: 'INVALID_GENERATED_IMAGE_DATA' });
    await expect(fs.lstat(root())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces its encoded/decoded limit and format independently of claimed output format', async () => {
    const encoded = 'A'.repeat(Math.ceil(GENERATED_IMAGE_LIMITS.maxBytes / 3) * 4 + 4);
    await expect(service.commit(input({ resultBase64: encoded }))).rejects.toMatchObject({ status: 413, code: 'GENERATED_IMAGE_TOO_LARGE' });
    await expect(service.commit(input({ outputFormat: 'webp' }))).rejects.toMatchObject({ status: 415, code: 'INVALID_GENERATED_IMAGE_FORMAT' });
    await expect(service.commit(input({ outputFormat: undefined, resultBase64: gif.toString('base64') }))).rejects.toMatchObject({ status: 415, code: 'INVALID_GENERATED_IMAGE_FORMAT' });
    await expect(service.commit(input({ resultBase64: png.subarray(0, png.length - 1).toString('base64') }))).rejects.toMatchObject({ status: 415, code: 'INVALID_IMAGE' });
    await expect(fs.lstat(root())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires matching workspace, hash and optional thread scope before returning model content', async () => {
    const saved = await service.commit(input());
    const other = await ctx.workspaces.create({ name: 'Other image workspace' });
    await expect(service.read(other.id, saved.id, saved.sha256)).rejects.toMatchObject({ status: 404 });
    await expect(service.read(workspaceId, saved.id, '0'.repeat(64))).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CHANGED' });
    await expect(service.modelContent(workspaceId, reference(saved), { threadId: 'thread_unrelated' })).rejects.toMatchObject({ status: 404 });
    await expect(service.modelContent(workspaceId, { ...reference(saved), sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CHANGED' });
    // A validated explicit fork may reuse the immutable original, with its hash.
    expect(await service.modelContent(workspaceId, reference(saved))).toMatchObject({ type: 'input_image', detail: 'high' });
  });

  it('detects changed bytes even when size and modification time are restored', async () => {
    const saved = await service.commit(input()), file = path.join(imageDirectory(), `${saved.id}.image`);
    const before = await fs.stat(file), replacement = Buffer.from(png); replacement[45] ^= 1;
    await fs.writeFile(file, replacement); await fs.utimes(file, before.atime, before.mtime);
    await expect(service.read(workspaceId, saved.id, saved.sha256)).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CHANGED' });
    await expect(service.modelContent(workspaceId, reference(saved))).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CHANGED' });
  });

  it('rejects altered metadata instead of exposing an injected path or trusting another workspace', async () => {
    const saved = await service.commit(input()), file = path.join(imageDirectory(), `${saved.id}.json`);
    const original = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...original, storagePath: '/private/outside.png' }));
    await expect(service.metadata(workspaceId, saved.id)).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CHANGED' });
    await fs.writeFile(file, JSON.stringify({ ...original, workspaceId: 'workspace_elsewhere' }));
    await expect(service.read(workspaceId, saved.id)).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CHANGED' });
  });
});

describe('generated image interruption, descriptors and startup recovery', () => {
  it('does no workspace or filesystem work for an already aborted generation', async () => {
    const controller = new AbortController(), reason = new Error('Stopped before admission'); controller.abort(reason);
    const get = vi.spyOn(ctx.workspaces, 'get');
    await expect(service.commit(input(), controller.signal)).rejects.toBe(reason);
    expect(get).not.toHaveBeenCalled(); await expect(fs.lstat(root())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes its own aborted byte write and releases the descriptor and admission slot', async () => {
    const controller = new AbortController(), reason = new Error('Stopped during image write'), open = fs.open.bind(fs);
    let descriptor: FileHandle | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.image') && writing(flags)) { descriptor = handle; controller.abort(reason); }
      return handle;
    });
    await expect(service.commit(input(), controller.signal)).rejects.toBe(reason);
    expect(descriptor?.fd).toBe(-1); expect(await fs.readdir(imageDirectory())).toEqual([]);
    vi.restoreAllMocks();
    expect(await service.commit(input())).toMatchObject({ state: 'completed', sha256: hash(png) });
  });

  it('rolls back a cancellation racing metadata publication and keeps earlier committed images', async () => {
    const earlier = await service.commit(input({ itemId: 'ig_earlier' }));
    const controller = new AbortController(), reason = new Error('Stopped during publication'), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.ready') && writing(flags)) controller.abort(reason);
      return handle;
    });
    await expect(service.commit(input(), controller.signal)).rejects.toBe(reason);
    expect((await fs.readdir(imageDirectory())).sort()).toEqual([`${earlier.id}.image`, `${earlier.id}.json`, `${earlier.id}.ready`]);
    expect((await service.read(workspaceId, earlier.id)).bytes).toEqual(png);
  });

  it('preserves an artifact once commit returned, even if its generation signal later aborts', async () => {
    const controller = new AbortController(), saved = await service.commit(input(), controller.signal);
    controller.abort(new Error('Stopped after commit'));
    expect((await service.read(workspaceId, saved.id, saved.sha256)).bytes).toEqual(png);
    await restart(); expect(await service.metadata(workspaceId, saved.id)).toEqual(saved);
  });

  it('cancels an image read and closes its descriptor without changing the committed artifact', async () => {
    const saved = await service.commit(input()), controller = new AbortController(), reason = new Error('Preview stopped');
    const open = fs.open.bind(fs); let descriptor: FileHandle | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.image') && !writing(flags)) { descriptor = handle; controller.abort(reason); }
      return handle;
    });
    await expect(service.read(workspaceId, saved.id, saved.sha256, controller.signal)).rejects.toBe(reason);
    expect(descriptor?.fd).toBe(-1);
    vi.restoreAllMocks(); expect((await service.read(workspaceId, saved.id)).bytes).toEqual(png);
  });

  it('reports a storage failure and cleans incomplete bytes without announcing a saved image', async () => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (String(file).endsWith('.ready') && writing(flags)) throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
      return open(file, flags, mode);
    });
    await expect(service.commit(input())).rejects.toMatchObject({ status: 507, code: 'GENERATED_IMAGE_STORAGE_FULL' });
    expect(await fs.readdir(imageDirectory())).toEqual([]);
  });

  it('never overwrites or removes a different record raced into its final destination', async () => {
    const open = fs.open.bind(fs); let destination = '';
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (!destination && String(file).endsWith('.json') && writing(flags)) {
        destination = String(file); await fs.writeFile(file, 'Unrelated replacement.');
      }
      return open(file, flags, mode);
    });
    await expect(service.commit(input())).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CONFLICT' });
    // Resolve its basename through the current real directory, not a now-closed fd.
    expect(await fs.readFile(path.join(imageDirectory(), path.basename(destination)), 'utf8')).toBe('Unrelated replacement.');
    expect(await fs.readdir(imageDirectory())).toEqual([path.basename(destination)]);
  });

  it.each(['image', 'json'] as const)('does not follow a replaced %s symlink', async suffix => {
    const saved = await service.commit(input()), file = path.join(imageDirectory(), `${saved.id}.${suffix}`), outside = path.join(directory, `outside.${suffix}`);
    await fs.rename(file, outside); const original = await fs.readFile(outside); await fs.symlink(outside, file);
    await expect(service.read(workspaceId, saved.id, saved.sha256)).rejects.toMatchObject({ status: 403, code: 'UNSAFE_GENERATED_IMAGE_STORAGE' });
    expect(await fs.readFile(outside)).toEqual(original);
  });

  it('refuses a hardlinked blob even when its image and hash are valid', async () => {
    const saved = await service.commit(input()), file = path.join(imageDirectory(), `${saved.id}.image`);
    await fs.link(file, path.join(directory, 'outside-link.png'));
    await expect(service.read(workspaceId, saved.id, saved.sha256)).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CHANGED' });
  });

  it('rejects a symlinked storage root without writing outside its owned directory', async () => {
    const outside = path.join(directory, 'outside-storage'); await fs.mkdir(outside); await fs.symlink(outside, root());
    await expect(service.commit(input())).rejects.toMatchObject({ status: 403, code: 'UNSAFE_GENERATED_IMAGE_STORAGE' });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('detects a parent replacement before opening bytes and preserves the external target', async () => {
    const saved = await service.commit(input()), outside = path.join(directory, 'outside-assets'); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'Keep external data.');
    const open = fs.open.bind(fs); let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (!replaced && String(file).endsWith(`/${hash(workspaceId)}`)) {
        replaced = true; await fs.rename(imageDirectory(), `${imageDirectory()}-original`); await fs.symlink(outside, imageDirectory());
      }
      return open(file, flags, mode);
    });
    await expect(service.read(workspaceId, saved.id, saved.sha256)).rejects.toMatchObject({ status: 403, code: 'UNSAFE_GENERATED_IMAGE_STORAGE' });
    expect(replaced).toBe(true); expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('Keep external data.');
  });

  it('recovers orphan bytes and linked publication temporaries while retaining unrelated files and completed images', async () => {
    const saved = await service.commit(input()); await service.close();
    const orphanId = `img_${'f'.repeat(64)}`, temporary = `${saved.id}.${'a'.repeat(32)}.json.tmp`;
    await fs.writeFile(path.join(imageDirectory(), `${orphanId}.image`), png);
    await fs.link(path.join(imageDirectory(), `${saved.id}.json`), path.join(imageDirectory(), temporary));
    const external = path.join(directory, 'external-keep.txt'); await fs.writeFile(external, 'Keep external data.');
    await fs.symlink(external, path.join(imageDirectory(), `${orphanId}.${'b'.repeat(32)}.json.tmp`));
    await fs.writeFile(path.join(imageDirectory(), 'notes.txt'), 'Keep local notes.');
    service = new GeneratedImageService({ ...ctx }); await service.initialize();
    expect(service.recovery()).toMatchObject({ removedTemporaryFiles: 2, removedUncommittedImages: 1, retainedUnexpectedEntries: 1 });
    expect((await service.read(workspaceId, saved.id, saved.sha256)).bytes).toEqual(png);
    expect(await fs.readFile(external, 'utf8')).toBe('Keep external data.');
    expect(await fs.readFile(path.join(imageDirectory(), 'notes.txt'), 'utf8')).toBe('Keep local notes.');
  });

  it('drains an operation still awaiting workspace admission before closing its directory handle', async () => {
    await service.initialize();
    const entered = deferred(), release = deferred(), get = ctx.workspaces.get.bind(ctx.workspaces);
    vi.spyOn(ctx.workspaces, 'get').mockImplementationOnce(async id => { entered.resolve(); await release.promise; return get(id); });
    const pending = service.commit(input()).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    let closed = false; const stopping = service.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    release.resolve();
    expect(await pending).toMatchObject({ error: { code: 'GENERATED_IMAGES_CLOSING' } });
    await stopping; expect(closed).toBe(true);
    await expect(service.read(workspaceId, `img_${'a'.repeat(64)}`)).rejects.toMatchObject({ code: 'GENERATED_IMAGES_CLOSING' });
  });
});

describe('permanent workspace image cleanup fences', () => {
  it('removes only the selected workspace artifacts and keeps its fence across restart', async () => {
    const first = await service.commit(input()), other = await ctx.workspaces.create({ name: 'Surviving images' });
    const second = await service.commit(input({ workspaceId: other.id }));
    const project = await ctx.workspaces.get(workspaceId), projectFile = path.join(project.path, 'keep.txt');
    await fs.writeFile(projectFile, 'Workspace files are owned by the workspace cleanup coordinator.');
    expect(await service.deleteWorkspace(workspaceId)).toEqual({ workspaceId, deletedFiles: 3, permanentlyFenced: true });
    expect(await fs.readdir(imageDirectory())).toEqual([]);
    expect((await fs.lstat(fencePath())).isFile()).toBe(true);
    expect(await fs.readFile(projectFile, 'utf8')).toContain('coordinator');
    await expect(service.read(workspaceId, first.id)).rejects.toMatchObject({ code: 'GENERATED_IMAGE_WORKSPACE_DELETED' });
    await restart();
    await expect(service.commit(input({ runId: 'run_late' }))).rejects.toMatchObject({ code: 'GENERATED_IMAGE_WORKSPACE_DELETED' });
    expect((await service.read(other.id, second.id, second.sha256)).bytes).toEqual(png);
    const fresh = await ctx.workspaces.create({ name: 'New independent workspace' });
    expect(await service.commit(input({ workspaceId: fresh.id }))).toMatchObject({ workspaceId: fresh.id, state: 'completed' });
  });

  it('fences an in-flight completion before it can publish and keeps that fence after restart', async () => {
    await service.initialize();
    const entered = deferred(), release = deferred(), fenced = deferred(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (String(file).endsWith('.image') && writing(flags)) { entered.resolve(); await release.promise; }
      if (String(file).endsWith('.deleted.json') && writing(flags)) fenced.resolve();
      return handle;
    });
    const pending = service.commit(input()).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const removing = service.deleteWorkspace(workspaceId);
    await fenced.promise; expect((await fs.lstat(fencePath())).isFile()).toBe(true);
    release.resolve();
    expect(await pending).toMatchObject({ error: { code: 'GENERATED_IMAGE_WORKSPACE_DELETED' } });
    expect(await removing).toMatchObject({ permanentlyFenced: true });
    expect(await fs.readdir(imageDirectory())).toEqual([]);
    vi.restoreAllMocks(); await restart();
    await expect(service.commit(input())).rejects.toMatchObject({ code: 'GENERATED_IMAGE_WORKSPACE_DELETED' });
  });

  it('persists a fence before deleting committed bytes when cleanup is the first call after restart', async () => {
    await service.commit(input()); await service.close(); service = new GeneratedImageService({ ...ctx });
    const unlink = fs.unlink.bind(fs), observations: boolean[] = [];
    vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      if (String(filename).endsWith('.image')) observations.push(await fs.lstat(fencePath()).then(() => true, () => false));
      return unlink(filename);
    });
    await service.deleteWorkspace(workspaceId);
    expect(observations).toEqual([true]);
  });

  it('treats an interrupted empty fence as permanent until authoritative cleanup replays', async () => {
    const saved = await service.commit(input()); await service.close();
    await fs.writeFile(fencePath(), '');
    service = new GeneratedImageService({ ...ctx }); await service.initialize();
    expect(service.recovery().removedDeletedWorkspaceFiles).toBe(0);
    expect(await fs.readFile(path.join(imageDirectory(), `${saved.id}.image`))).toEqual(png);
    await expect(service.commit(input())).rejects.toMatchObject({ code: 'GENERATED_IMAGE_WORKSPACE_DELETED' });
    expect((await fs.lstat(fencePath())).isFile()).toBe(true);
    expect(await service.deleteWorkspace(workspaceId)).toMatchObject({ deletedFiles: 3, permanentlyFenced: true });
    expect(await fs.readdir(imageDirectory())).toEqual([]);
  });

  it('preserves unverified entries and external symlink targets with a visible cleanup failure', async () => {
    const saved = await service.commit(input()), external = path.join(directory, 'outside-keep.png');
    await fs.writeFile(external, webp); await fs.unlink(path.join(imageDirectory(), `${saved.id}.image`));
    await fs.symlink(external, path.join(imageDirectory(), `${saved.id}.image`));
    await fs.writeFile(path.join(imageDirectory(), 'unrelated.txt'), 'Do not remove.');
    await expect(service.deleteWorkspace(workspaceId)).rejects.toMatchObject({ code: 'GENERATED_IMAGE_CLEANUP_INCOMPLETE' });
    expect(await fs.readFile(external)).toEqual(webp);
    expect((await fs.readdir(imageDirectory())).sort()).toEqual([`${saved.id}.image`, `${saved.id}.json`, `${saved.id}.ready`, 'unrelated.txt'].sort());
    expect((await fs.lstat(path.join(imageDirectory(), `${saved.id}.image`))).isSymbolicLink()).toBe(true);
    await restart();
    await expect(service.commit(input())).rejects.toMatchObject({ code: 'GENERATED_IMAGE_WORKSPACE_DELETED' });
  });
});

async function startPreviewServer() {
  await service.close(); service = getGeneratedImageService(ctx);
  auth = new AuthService(ctx); await auth.initialize();
  const app = express();
  app.use('/api', auth.protectMutations);
  app.use('/api/session', express.json({ limit: '4kb' }));
  app.use('/api', auth.router());
  app.use('/api', auth.requireSession, createGeneratedImagesRouter(ctx));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const known = error instanceof HttpError ? error : new HttpError(500, 'Unexpected test error.');
    res.status(known.status).json({ error: known.message, code: known.code });
  };
  app.use(errors);
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

describe('generated image previews with real session middleware', () => {
  it('gates bytes by login, saved hash and workspace scope and revokes reads after logout', async () => {
    await startPreviewServer();
    const image = await service.commit(input());
    expect((await fetch(`${origin}${image.previewUrl}`)).status).toBe(401);
    const login = await fetch(`${origin}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1', Origin: origin }, body: JSON.stringify({ password: ctx.config.password }) });
    expect(login.status).toBe(200); const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const get = (url: string) => fetch(`${origin}${url}`, { headers: { Cookie: cookie } });
    const preview = await get(image.previewUrl);
    expect(preview.status).toBe(200); expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
    expect(preview.headers.get('content-type')).toBe('image/png');
    expect(preview.headers.get('cache-control')).toContain('no-store');
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    expect(preview.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(preview.headers.get('content-disposition')).toBe('inline; filename="generated-image.png"');
    expect(preview.headers.get('etag')).toBe(`"${image.sha256}"`);
    expect((await get(image.previewUrl.replace(image.sha256, '0'.repeat(64)))).status).toBe(409);
    expect((await get(image.previewUrl.split('?')[0])).status).toBe(400);
    expect((await get(`${image.previewUrl}&source=https://example.invalid/image.png`)).status).toBe(400);
    const other = await ctx.workspaces.create({ name: 'Preview scope' });
    expect((await get(image.previewUrl.replace(workspaceId, other.id))).status).toBe(404);
    const logout = await fetch(`${origin}/api/session`, { method: 'DELETE', headers: { Cookie: cookie, 'X-Codex-Workspace': '1', Origin: origin } });
    expect(logout.ok).toBe(true); expect((await get(image.previewUrl)).status).toBe(401);
    expect((await service.read(workspaceId, image.id, image.sha256)).bytes).toEqual(png);
  });
});
