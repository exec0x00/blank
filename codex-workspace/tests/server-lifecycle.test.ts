import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { AuthService } from '../server/auth';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { FileMetadataManager } from '../server/file-metadata';
import { createApplication, startApplication } from '../server/index';
import { JsonStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import * as downloads from '../server/downloads';
import * as uploads from '../server/uploads';
import * as agents from '../server/agent';
import { shutdownWorktrees } from '../server/worktrees';
import { shutdownFilePages } from '../server/file-pages';
import { shutdownConversationFiles } from '../server/conversation-files';
import { shutdownImageAttachments } from '../server/agent/attachments';
import { shutdownGeneratedImages } from '../server/generated-images';

const directories: string[] = [];
const runtimes: Awaited<ReturnType<typeof createApplication>>[] = [];
const contexts = new Set<AppContext>();
const metadataManagers = new Set<FileMetadataManager>();
const authServices = new Set<AuthService>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(runtimes.splice(0).map(runtime => runtime.close()));
  // Keep failure-injection tests isolated even when the implementation fails
  // to unwind a partially started service or short-circuits normal shutdown.
  for (const ctx of contexts) {
    await Promise.allSettled([
      ctx.workspaces.closeTrashCleanup(), shutdownFilePages(ctx), ctx.workspaces.closeFileTrashPages(), ctx.workspaces.closeFileMutations(),
      uploads.shutdownUploads(ctx), shutdownWorktrees(ctx), agents.shutdownAgent(ctx),
      downloads.shutdownDownloads(ctx), shutdownConversationFiles(ctx),
      shutdownImageAttachments(ctx), shutdownGeneratedImages(ctx),
    ]);
  }
  await Promise.allSettled([...authServices].map(auth => auth.close()));
  await Promise.allSettled([...metadataManagers].map(metadata => metadata.close()));
  await Promise.allSettled([...contexts].map(ctx => ctx.store.flush()));
  contexts.clear(); metadataManagers.clear(); authServices.clear();
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function configuration() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-server-lifecycle-'));
  directories.push(directory);
  return loadConfig({ NODE_ENV: 'test', DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'),
    CODEX_CLI_TEST_START: '0', WORKSPACE_PASSWORD: 'lifecycle-test-password',
    SESSION_SECRET: 'lifecycle-session-secret-for-isolated-tests', ENCRYPTION_KEY: 'lifecycle-encryption-key-for-isolated-tests' });
}

describe('application startup and shutdown failure recovery', () => {
  it('drains the initialized application when the HTTP port cannot be bound', async () => {
    const runtime = await createApplication(await configuration());
    runtimes.push(runtime); contexts.add(runtime.ctx); metadataManagers.add(runtime.metadata); authServices.add(runtime.auth);
    await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
    const config = await configuration();
    config.port = (runtime.server.address() as AddressInfo).port; config.host = '127.0.0.1';
    const authClosed = vi.spyOn(AuthService.prototype, 'close');
    const metadataClosed = vi.spyOn(FileMetadataManager.prototype, 'close');
    const agentStopped = vi.spyOn(agents, 'shutdownAgent');
    await expect(startApplication(config)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(authClosed).toHaveBeenCalledTimes(1);
    expect(metadataClosed).toHaveBeenCalledTimes(1);
    expect(agentStopped).toHaveBeenCalledTimes(1);
    expect(runtime.server.listening).toBe(true);
  });

  it('waits for an admitted ordinary file write and refuses another write during shutdown', async () => {
    const runtime = await createApplication(await configuration());
    runtimes.push(runtime); contexts.add(runtime.ctx); metadataManagers.add(runtime.metadata); authServices.add(runtime.auth);
    const [workspace] = await runtime.ctx.workspaces.list();
    const filename = path.join(workspace.path, 'ordinary-save.txt');
    await fs.writeFile(filename, 'original');
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const writing = new Promise<void>(resolve => { entered = resolve; });
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === filename) { entered(); await blocked; }
      return rename(from, to);
    });
    const saving = runtime.ctx.workspaces.writeFile(workspace.id, 'ordinary-save.txt', 'saved before shutdown');
    await writing;
    let closed = false;
    const closing = runtime.close().then(() => { closed = true; });
    let lateFailure: unknown;
    const late = runtime.ctx.workspaces.writeFile(workspace.id, 'ordinary-save.txt', 'must not overwrite').catch(error => { lateFailure = error; });
    try {
      await vi.waitFor(() => expect(lateFailure).toMatchObject({ code: 'WORKSPACE_FILES_CLOSING' }));
      expect(closed).toBe(false);
      expect(await fs.readFile(filename, 'utf8')).toBe('original');
    } finally { release(); await Promise.allSettled([saving, late, closing]); }
    expect(closed).toBe(true);
    expect(await fs.readFile(filename, 'utf8')).toBe('saved before shutdown');
  });

  it('preserves an existing write-probe symlink and its target on startup', async () => {
    const config = await configuration();
    await fs.mkdir(config.stateDir, { recursive: true });
    const target = path.join(config.dataDir, 'retained-user-file.txt');
    const probe = path.join(config.stateDir, '.write-probe');
    await fs.writeFile(target, 'Durable user bytes must survive startup.\n');
    await fs.symlink(target, probe);
    const runtime = await createApplication(config);
    runtimes.push(runtime); contexts.add(runtime.ctx); metadataManagers.add(runtime.metadata); authServices.add(runtime.auth);
    expect(await fs.readFile(target, 'utf8')).toBe('Durable user bytes must survive startup.\n');
    expect((await fs.lstat(probe)).isSymbolicLink()).toBe(true);
  });

  it('finishes the remaining service drains after an earlier cleanup fails', async () => {
    const runtime = await createApplication(await configuration());
    runtimes.push(runtime); contexts.add(runtime.ctx); metadataManagers.add(runtime.metadata); authServices.add(runtime.auth);
    const failure = new Error('Synthetic trash cleanup failure.');
    const original = runtime.ctx.workspaces.closeTrashCleanup.bind(runtime.ctx.workspaces);
    vi.spyOn(runtime.ctx.workspaces, 'closeTrashCleanup').mockImplementation(async () => { await original(); throw failure; });
    const authClosed = vi.spyOn(runtime.auth, 'close');
    const metadataClosed = vi.spyOn(runtime.metadata, 'close');
    const flushed = vi.spyOn(runtime.ctx.store, 'flush');
    const agentStopped = vi.spyOn(agents, 'shutdownAgent');
    const first = runtime.close();
    expect(runtime.close()).toBe(first);
    await expect(first).rejects.toBeInstanceOf(Error);
    expect(agentStopped).toHaveBeenCalledWith(runtime.ctx);
    expect(authClosed).toHaveBeenCalledTimes(1);
    expect(metadataClosed).toHaveBeenCalledTimes(1);
    expect(flushed).toHaveBeenCalledTimes(1);
    expect(runtime.ctx.events.listenerCount('workspace:changed')).toBe(0);
    expect(await runtime.auth.authenticated({ headers: {} } as never)).toBe(false);
  });

  it('unwinds initialized services when a later startup stage fails and retains the startup error', async () => {
    const config = await configuration();
    const initializeDownloads = downloads.initializeDownloads;
    vi.spyOn(downloads, 'initializeDownloads').mockImplementation(async (ctx, options) => {
      contexts.add(ctx); return initializeDownloads(ctx, options);
    });
    const initializeMetadata = FileMetadataManager.prototype.initialize;
    vi.spyOn(FileMetadataManager.prototype, 'initialize').mockImplementation(function (this: FileMetadataManager) {
      metadataManagers.add(this); return initializeMetadata.call(this);
    });
    const initializeAuth = AuthService.prototype.initialize;
    const failure = new Error('Synthetic authentication initialization failure.');
    vi.spyOn(AuthService.prototype, 'initialize').mockImplementation(async function (this: AuthService) {
      authServices.add(this); await initializeAuth.call(this); throw failure;
    });
    const authClosed = vi.spyOn(AuthService.prototype, 'close');
    const metadataClosed = vi.spyOn(FileMetadataManager.prototype, 'close');
    const trashClosed = vi.spyOn(WorkspaceService.prototype, 'closeTrashCleanup');
    const uploadStopped = vi.spyOn(uploads, 'shutdownUploads');
    const flushed = vi.spyOn(JsonStore.prototype, 'flush');
    await expect(createApplication(config)).rejects.toBe(failure);
    expect(authClosed).toHaveBeenCalledTimes(1);
    expect(metadataClosed).toHaveBeenCalledTimes(1);
    expect(trashClosed).toHaveBeenCalledTimes(1);
    expect(uploadStopped).toHaveBeenCalledTimes(1);
    expect(flushed).toHaveBeenCalled();
    for (const ctx of contexts) expect(ctx.events.listenerCount('workspace:changed')).toBe(0);
  });
});
