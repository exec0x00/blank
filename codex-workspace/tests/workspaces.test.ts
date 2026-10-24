import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { loadConfig, type AppConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { HttpError } from '../server/errors';
import type { AppContext } from '../server/context';
import { HOST_RULES } from '../server/agent/host-policy';
import { WorkspaceService, createWorkspaceRouter, MAX_TEXT_FILE_BYTES, STARTER_README, STARTER_AGENTS } from '../server/workspaces';
import type { FileContent, Workspace } from '../shared/types';
import type { WorkspaceWorktree } from '../server/worktrees/types';
import { withWorkspaceRemoval } from '../server/worktrees/activity';

const executeFile = promisify(execFile);

const OLD_STARTER_README = '# My workspace\n\nYour files, terminal, and coding agent share this workspace.\n\n- Open a file in the editor and save your changes.\n- Use the terminal to work on this instance.\n- Connect a GitHub account to import an existing repository.\n- Add your model API key in Settings to start an agent conversation.\n\nWorkspace files are stored in the configured persistent data directory.\n';
const PREVIOUS_STARTER_README = OLD_STARTER_README.replace('Add your model API key', 'Connect ChatGPT or add an OpenAI API key');
const OLD_STARTER_AGENTS = '# Workspace instructions\n\nWork in this workspace directory and preserve existing user changes.\n\n- Never use a proxy for model or provider requests.\n- Never mount a filesystem or invoke mount, umount, fusermount, or similar commands.\n- Never use proot, Docker, Podman, containers, or sandbox machinery.\n- Use the existing host directly. Persistent storage is configured by the hosting platform.\n- Never print credentials or include them in source code or Git remotes.\n';
const PREVIOUS_STARTER_AGENTS = OLD_STARTER_AGENTS.replace('Never use a proxy for model or provider requests.', 'Use the configured model service; never create or configure additional proxies.');

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('persistent workspace files', () => {
  let directory: string;
  let config: AppConfig;
  let store: JsonStore;
  let service: WorkspaceService;
  let workspace: Workspace;
  const servers: Server[] = [];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-workspaces-test-'));
    config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'test-only-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    store = new JsonStore(config.stateDir);
    service = new WorkspaceService(config, store);
    await service.initialize();
    workspace = await service.create({ name: 'Project test' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function nativeWorktree(): Promise<{ repository: Workspace; worktree: Workspace & { worktree: WorkspaceWorktree } }> {
    const repository = await service.create({ name: 'Native repository', initializeGit: true });
    await service.update(repository.id, { githubAccountId: 'saved-account' });
    await fs.writeFile(path.join(repository.path, 'tracked.txt'), 'shared repository contents\n');
    await executeFile('git', ['-C', repository.path, 'add', 'tracked.txt']);
    await executeFile('git', ['-C', repository.path, '-c', 'user.name=Workspace test', '-c', 'user.email=workspace@example.invalid', 'commit', '-m', 'Initial test commit']);
    const id = randomUUID();
    const target = path.join(config.workspacesDir, id);
    await executeFile('git', ['-C', repository.path, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', target, 'HEAD']);
    const { stdout } = await executeFile('git', ['-C', target, 'rev-parse', '--absolute-git-dir']);
    const now = new Date().toISOString();
    return {
      repository,
      worktree: { id, name: 'Native worktree', path: target, createdAt: now, updatedAt: now, githubAccountId: 'saved-account',
        worktree: { id, sourceWorkspaceId: repository.id, repositoryWorkspaceId: repository.id, gitDirectory: stdout.trim(), commonDirectory: path.join(repository.path, '.git') } },
    };
  }

  it('starts with real files and preserves workspace registrations across service restarts', async () => {
    const listed = await service.list();
    const starter = listed.find(item => item.name === 'My workspace')!;
    expect((await service.readFile(starter.id, 'README.md')).content).toContain('# My workspace');
    expect((await service.readFile(starter.id, 'README.md')).content).toContain('Choose a model and start a conversation. No provider sign-in is needed.');
    expect((await service.readFile(starter.id, 'README.md')).content).toContain('Your connected accounts stay saved.');
    expect((await service.readFile(starter.id, 'AGENTS.md')).content).toBe(STARTER_AGENTS);
    expect((await service.readFile(starter.id, 'AGENTS.md')).content).toContain(HOST_RULES);
    expect(await fs.readdir(workspace.path)).toEqual([]);
    await service.update(workspace.id, { name: 'Renamed 🧪', githubAccountId: 'account-one', active: true });
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    expect((await restarted.get(workspace.id)).name).toBe('Renamed 🧪');
    expect(await store.read('active-workspace', null)).toBe(workspace.id);
    expect((await restarted.get(workspace.id)).githubAccountId).toBe('account-one');
    expect((await restarted.update(workspace.id, { githubAccountId: null })).githubAccountId).toBeUndefined();
    expect((await restarted.list()).length).toBe(2);
  });

  it('migrates only exact untouched starter instruction variants across startup', async () => {
    const starter = (await service.list()).find(item => item.name === 'My workspace')!;
    const previous = await service.create({ name: 'Previously generated workspace' });
    await fs.writeFile(path.join(starter.path, 'README.md'), OLD_STARTER_README);
    await fs.writeFile(path.join(starter.path, 'AGENTS.md'), OLD_STARTER_AGENTS);
    await fs.writeFile(path.join(previous.path, 'README.md'), PREVIOUS_STARTER_README);
    await fs.writeFile(path.join(previous.path, 'AGENTS.md'), PREVIOUS_STARTER_AGENTS);
    const customizedReadme = `${PREVIOUS_STARTER_README}\nUser-authored project notes.\n`;
    const customizedAgents = `${PREVIOUS_STARTER_AGENTS}\nUser-authored project rules.\n`;
    await fs.writeFile(path.join(workspace.path, 'README.md'), customizedReadme);
    await fs.writeFile(path.join(workspace.path, 'AGENTS.md'), customizedAgents);
    await new WorkspaceService(config, new JsonStore(config.stateDir)).initialize();
    expect(await fs.readFile(path.join(starter.path, 'README.md'), 'utf8')).toBe(STARTER_README);
    expect(await fs.readFile(path.join(previous.path, 'README.md'), 'utf8')).toBe(STARTER_README);
    expect(await fs.readFile(path.join(starter.path, 'AGENTS.md'), 'utf8')).toBe(STARTER_AGENTS);
    expect(await fs.readFile(path.join(previous.path, 'AGENTS.md'), 'utf8')).toBe(STARTER_AGENTS);
    expect(await fs.readFile(path.join(workspace.path, 'README.md'), 'utf8')).toBe(customizedReadme);
    expect(await fs.readFile(path.join(workspace.path, 'AGENTS.md'), 'utf8')).toBe(customizedAgents);
    const before = await fs.stat(path.join(starter.path, 'README.md'));
    await new WorkspaceService(config, new JsonStore(config.stateDir)).initialize();
    expect((await fs.stat(path.join(starter.path, 'README.md'))).mtimeMs).toBe(before.mtimeMs);
  });

  it('skips starter migration through symlinked files, symlinked roots, and outside registered roots', async () => {
    const outside = path.join(directory, 'outside-instructions');
    await fs.mkdir(outside);
    const outsideReadme = path.join(outside, 'README.md');
    await fs.writeFile(outsideReadme, OLD_STARTER_README);
    await fs.symlink(outsideReadme, path.join(workspace.path, 'README.md'));
    const linked = await service.create({ name: 'Linked root' });
    await fs.rmdir(linked.path);
    await fs.symlink(outside, linked.path);
    const external = await service.create({ name: 'Outside registered root' });
    await store.update<Workspace>(`workspace-record-${external.id}`, external, entry => ({ ...entry, path: outside }));
    await new WorkspaceService(config, new JsonStore(config.stateDir)).initialize();
    expect(await fs.readFile(outsideReadme, 'utf8')).toBe(OLD_STARTER_README);
    expect((await fs.lstat(path.join(workspace.path, 'README.md'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(linked.path)).isSymbolicLink()).toBe(true);
    expect(await fs.readdir(outside)).toEqual(['README.md']);
  });

  it.each([
    ['README.md', OLD_STARTER_README],
    ['AGENTS.md', PREVIOUS_STARTER_AGENTS],
  ])('preserves a concurrent %s edit made while its starter migration is staged', async (name, template) => {
    const target = path.join(workspace.path, name);
    await fs.writeFile(target, template);
    const edited = `${template}\nChanges from a concurrent editor.\n`;
    const writeFile = fs.writeFile.bind(fs);
    const stagedWrite = vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (file, content, options) => {
      await writeFile(target, edited);
      await writeFile(file, content, options);
    });
    await new WorkspaceService(config, new JsonStore(config.stateDir)).initialize();
    expect(stagedWrite).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(target, 'utf8')).toBe(edited);
    expect((await fs.readdir(workspace.path)).some(name => name.startsWith('.codex-write-'))).toBe(false);
  });

  it('creates a real Git repository only when requested', async () => {
    const gitWorkspace = await service.create({ name: 'Repository', initializeGit: true });
    expect(await fs.readFile(path.join(gitWorkspace.path, '.git/HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
    expect(await fs.stat(path.join(workspace.path, '.git')).catch(() => null)).toBeNull();
  });

  it('registers an existing native worktree without reallocating or deleting its files', async () => {
    const { repository, worktree } = await nativeWorktree();
    const before = await fs.stat(worktree.path);
    expect(await service.registerWorktree(worktree)).toEqual(worktree);
    expect((await fs.stat(worktree.path)).ino).toBe(before.ino);
    expect((await service.readFile(worktree.id, 'tracked.txt')).content).toBe('shared repository contents\n');
    expect((await service.get(worktree.id)).githubAccountId).toBe('saved-account');
    await expect(service.registerWorktree({ ...worktree, name: 'Must not replace metadata' })).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_EXISTS' });
    expect((await service.get(worktree.id)).name).toBe('Native worktree');
    await service.remove(repository.id);
    expect((await service.getRegistration(repository.id, { includeArchived: true })).path).toBe(repository.path);
    expect((await service.readFile(worktree.id, 'tracked.txt')).content).toBe('shared repository contents\n');
    await service.remove(worktree.id);
    await expect(service.registerWorktree(worktree)).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_ARCHIVED' });
    expect(await fs.readFile(path.join(worktree.path, 'tracked.txt'), 'utf8')).toBe('shared repository contents\n');
  });

  it('rejects forged worktree pointers and outside or symlinked directories without touching contents', async () => {
    const { worktree } = await nativeWorktree();
    const fakeId = randomUUID();
    const fakePath = path.join(config.workspacesDir, fakeId);
    await fs.mkdir(fakePath);
    await fs.writeFile(path.join(fakePath, '.git'), `gitdir: ${worktree.worktree.gitDirectory}\n`);
    await fs.writeFile(path.join(fakePath, 'keep.txt'), 'unregistered user content');
    const forged = { ...worktree, id: fakeId, path: fakePath, worktree: { ...worktree.worktree, id: fakeId } };
    await expect(service.registerWorktree(forged)).rejects.toMatchObject({ status: 409, code: 'INVALID_WORKTREE' });
    expect(await fs.readFile(path.join(fakePath, 'keep.txt'), 'utf8')).toBe('unregistered user content');
    await expect(service.get(fakeId)).rejects.toMatchObject({ status: 404 });
    const outside = path.join(directory, 'outside-worktree');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'outside content');
    await expect(service.registerWorktree({ ...worktree, path: outside })).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
    const moved = path.join(config.workspacesDir, `retained-${worktree.id}`);
    await fs.rename(worktree.path, moved);
    await fs.symlink(moved, worktree.path);
    await expect(service.registerWorktree(worktree)).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
    expect(await fs.readFile(path.join(moved, 'tracked.txt'), 'utf8')).toBe('shared repository contents\n');
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('outside content');
  });

  it('restores a managed worktree with its original workspace identity and fences a later archive', async () => {
    const { worktree } = await nativeWorktree();
    await service.registerWorktree(worktree);
    await service.writeFile(worktree.id, 'notes.txt', 'preserved worktree changes');
    await store.write('thread-worktree-identity', { workspaceId: worktree.id, messages: ['Retained conversation'] });
    await service.remove(worktree.id);
    const first = await service.getWorktreeArchive(worktree.id);
    const markerKey = `workspace-archived-${worktree.id}`;
    const marker = await store.read(markerKey, null);
    const restored = await service.restoreWorktree(worktree, first.generation);
    expect(restored.id).toBe(worktree.id);
    expect(await store.read(markerKey, null)).toEqual(marker);
    expect((await service.readFile(worktree.id, 'notes.txt')).content).toBe('preserved worktree changes');
    expect(await store.read('thread-worktree-identity', null)).toMatchObject({ workspaceId: restored.id, messages: ['Retained conversation'] });
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    expect((await restarted.get(worktree.id)).id).toBe(worktree.id);
    await restarted.remove(worktree.id);
    const second = await restarted.getWorktreeArchive(worktree.id);
    expect(second.generation).not.toBe(first.generation);
    await expect(service.restoreWorktree(worktree, first.generation)).rejects.toMatchObject({ status: 409, code: 'STALE_WORKTREE_RESTORE' });
    await expect(restarted.get(worktree.id)).rejects.toMatchObject({ status: 404 });
    await restarted.restoreWorktree(worktree, second.generation);
    expect((await restarted.readFile(worktree.id, 'notes.txt')).content).toBe('preserved worktree changes');
  });

  it('never reopens a later archive when a concurrent older restore acknowledgment finishes last', async () => {
    const { worktree } = await nativeWorktree();
    await service.registerWorktree(worktree);
    await service.remove(worktree.id);
    const first = await service.getWorktreeArchive(worktree.id);
    const concurrent = new WorkspaceService(config, new JsonStore(config.stateDir));
    await concurrent.initialize();
    const staged = deferred();
    const release = deferred();
    const rename = fs.rename.bind(fs);
    let held = false;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (path.basename(String(destination)) === `workspace-restored-${worktree.id}-${first.generation}.json` && !held) {
        held = true;
        staged.resolve();
        await release.promise;
      }
      return rename(source, destination);
    });
    const restoring = service.restoreWorktree(worktree, first.generation).then(value => ({ value }), error => ({ error }));
    try {
      await staged.promise;
      await concurrent.restoreWorktree(worktree, first.generation);
      await concurrent.remove(worktree.id);
      const later = await concurrent.getWorktreeArchive(worktree.id);
      expect(later.generation).not.toBe(first.generation);
      release.resolve();
      expect(await restoring).toMatchObject({ error: { status: 409, code: 'STALE_WORKTREE_RESTORE' } });
    } finally { release.resolve(); spy.mockRestore(); }
    await expect(service.get(worktree.id)).rejects.toMatchObject({ status: 404 });
    await expect(new WorkspaceService(config, new JsonStore(config.stateDir)).get(worktree.id)).rejects.toMatchObject({ status: 404 });
    await expect(withWorkspaceRemoval(config.workspacesDir, worktree.id, async () => 'leases released')).resolves.toBe('leases released');
  });

  it('keeps ordinary archives permanent and requires managed registration identity to restore', async () => {
    await service.remove(workspace.id);
    await expect(service.getWorktreeArchive(workspace.id)).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_NOT_RESTORABLE' });
    await expect(service.restoreWorktree(workspace, 'a'.repeat(32))).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_NOT_RESTORABLE' });
    await store.write(`workspace-restored-${workspace.id}-${'a'.repeat(32)}`, { version: 1, id: workspace.id, generation: 'a'.repeat(32) });
    await expect(service.get(workspace.id)).rejects.toMatchObject({ status: 404 });
    const { worktree } = await nativeWorktree();
    await service.registerWorktree(worktree);
    await service.remove(worktree.id);
    const archived = await service.getWorktreeArchive(worktree.id);
    await expect(service.restoreWorktree({ ...worktree, path: workspace.path }, archived.generation)).rejects.toMatchObject({ status: 409, code: 'WORKTREE_CHANGED' });
    await expect(service.get(worktree.id)).rejects.toMatchObject({ status: 404 });
  });

  it('restores a derived worktree after its provenance checkout has been safely removed', async () => {
    const { repository, worktree: source } = await nativeWorktree();
    await service.registerWorktree(source);
    const id = randomUUID();
    const target = path.join(config.workspacesDir, id);
    await executeFile('git', ['-C', source.path, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', target, 'HEAD']);
    const { stdout } = await executeFile('git', ['-C', target, 'rev-parse', '--absolute-git-dir']);
    const derived = { ...source, id, name: 'Derived checkout', path: target, worktree: { ...source.worktree, id, sourceWorkspaceId: source.id, gitDirectory: stdout.trim() } };
    await service.remove(source.id);
    await executeFile('git', ['-C', repository.path, 'worktree', 'remove', source.path]);
    await service.registerWorktree(derived);
    await service.remove(derived.id);
    const archive = await service.getWorktreeArchive(derived.id);
    await service.restoreWorktree(derived, archive.generation);
    expect((await service.readFile(derived.id, 'tracked.txt')).content).toBe('shared repository contents\n');
  });

  it('fences native file mutations and worktree activation while a checkout removal is admitted', async () => {
    await service.writeFile(workspace.id, 'keep.txt', 'retained content');
    await service.writeFile(workspace.id, 'trashed.txt', 'trash content');
    const trash = await service.trashEntry(workspace.id, 'trashed.txt');
    const attempts = [
      () => service.writeFile(workspace.id, 'keep.txt', 'overwrite'),
      () => service.upload(workspace.id, 'new.bin', Buffer.from('new')),
      () => service.createEntry(workspace.id, 'new-folder', 'directory'),
      () => service.renameEntry(workspace.id, 'keep.txt', 'moved.txt'),
      () => service.trashEntry(workspace.id, 'keep.txt'),
      () => service.restoreEntry(workspace.id, trash.id),
      () => service.replace(workspace.id, { query: 'retained', replacement: 'modified' }),
    ];
    await withWorkspaceRemoval(config.workspacesDir, workspace.id, async () => {
      for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ status: 409, code: 'WORKTREE_BUSY' });
      expect((await service.readFile(workspace.id, 'keep.txt')).content).toBe('retained content');
    });
    const { worktree } = await nativeWorktree();
    await withWorkspaceRemoval(config.workspacesDir, worktree.id, async () => {
      await expect(service.registerWorktree(worktree)).rejects.toMatchObject({ status: 409, code: 'WORKTREE_BUSY' });
    });
    await service.registerWorktree(worktree);
    await service.remove(worktree.id);
    const archive = await service.getWorktreeArchive(worktree.id);
    await withWorkspaceRemoval(config.workspacesDir, worktree.id, async () => {
      await expect(service.restoreWorktree(worktree, archive.generation)).rejects.toMatchObject({ status: 409, code: 'WORKTREE_BUSY' });
    });
    await expect(service.get(worktree.id)).rejects.toMatchObject({ status: 404 });
    expect(await fs.readFile(path.join(workspace.path, 'keep.txt'), 'utf8')).toBe('retained content');
  });

  it('keeps a file-write lease until the native save completes, then releases it', async () => {
    await service.writeFile(workspace.id, 'keep.txt', 'original');
    const staged = deferred();
    const release = deferred();
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (String(destination) === path.join(workspace.path, 'keep.txt')) {
        staged.resolve();
        await release.promise;
      }
      return rename(source, destination);
    });
    const saving = service.writeFile(workspace.id, 'keep.txt', 'completed save');
    let removed = false;
    try {
      await staged.promise;
      await expect(withWorkspaceRemoval(config.workspacesDir, workspace.id, async () => { removed = true; })).rejects.toMatchObject({ status: 409, code: 'WORKTREE_BUSY' });
      expect(removed).toBe(false);
      release.resolve();
      await saving;
    } finally { release.resolve(); spy.mockRestore(); }
    await withWorkspaceRemoval(config.workspacesDir, workspace.id, async () => { removed = true; });
    expect(removed).toBe(true);
    expect(await fs.readFile(path.join(workspace.path, 'keep.txt'), 'utf8')).toBe('completed save');
  });

  it('retains concurrent creates and archives with one real store and delayed filesystem writes', async () => {
    const baseline = await service.list();
    const archived = await Promise.all(Array.from({ length: 6 }, (_, index) => service.create({ name: `Archive ${index}` })));
    await Promise.all(archived.map(item => fs.writeFile(path.join(item.path, 'keep.txt'), item.id)));
    await service.list(); // Exercise mutations after normal reads have populated the store's caches.
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (path.basename(String(destination)).startsWith('workspace-')) await new Promise(resolve => setTimeout(resolve, 2));
      return rename(source, destination);
    });
    const creating = Array.from({ length: 12 }, (_, index) => service.create({ name: `Concurrent ${index}` }));
    const [created] = await Promise.all([Promise.all(creating), Promise.all(archived.map(item => service.remove(item.id)))]);
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    const listed = await restarted.list();
    expect(new Set(listed.map(item => item.id))).toEqual(new Set([...baseline, ...created].map(item => item.id)));
    for (const item of archived) expect(await fs.readFile(path.join(item.path, 'keep.txt'), 'utf8')).toBe(item.id);
  });

  it('lists without missing record-type probes and observes fresh independent mutations', async () => {
    const now = new Date().toISOString();
    const legacy: Workspace = { id: 'listed-legacy', name: 'Listed legacy', path: path.join(config.workspacesDir, 'listed-legacy'), createdAt: now, updatedAt: now };
    await fs.mkdir(legacy.path);
    await store.write('workspaces', [legacy]);
    await service.list();
    const archived = await service.create({ name: 'Archived before listing' });
    await service.remove(archived.id);
    const withdrawn = await service.create({ name: 'Removed metadata' });
    await fs.unlink(path.join(config.stateDir, `workspace-record-${withdrawn.id}.json`));
    const stat = vi.spyOn(fs, 'stat');
    const read = vi.spyOn(fs, 'readFile');
    const observeList = async () => {
      const names = new Set(await fs.readdir(config.stateDir));
      stat.mockClear();
      read.mockClear();
      const listed = await service.list();
      const probes = [...stat.mock.calls, ...read.mock.calls].map(call => String(call[0]))
        .filter(file => path.dirname(file) === config.stateDir && path.basename(file).startsWith('workspace-'));
      expect(probes.length).toBeGreaterThan(0);
      expect(probes.filter(file => !names.has(path.basename(file)))).toEqual([]);
      return { listed, probes };
    };
    const first = await observeList();
    expect(first.listed.map(item => item.id)).toEqual(expect.arrayContaining([workspace.id, legacy.id]));
    expect(first.listed.some(item => item.id === archived.id || item.id === withdrawn.id)).toBe(false);
    expect(first.probes).toContain(path.join(config.stateDir, `workspace-archived-${archived.id}.json`));
    expect(first.probes.some(file => path.basename(file).startsWith(`workspace-legacy-v-${legacy.id}-`))).toBe(true);
    const independent = new WorkspaceService(config, new JsonStore(config.stateDir));
    await independent.initialize();
    const created = await independent.create({ name: 'Created independently' });
    await independent.update(workspace.id, { name: 'Renamed independently' });
    const next = await observeList();
    expect(next.listed.some(item => item.id === created.id)).toBe(true);
    expect(next.listed.find(item => item.id === workspace.id)?.name).toBe('Renamed independently');
    const changed = { ...(await independent.get(workspace.id)), name: 'Manual metadata edit' };
    await fs.writeFile(path.join(config.stateDir, `workspace-record-${workspace.id}.json`), JSON.stringify(changed));
    await independent.remove(created.id);
    const last = await observeList();
    expect(last.listed.some(item => item.id === created.id)).toBe(false);
    expect(last.listed.find(item => item.id === workspace.id)?.name).toBe('Manual metadata edit');
  });

  it('keeps direct access and write guards authoritative after a directory-based list', async () => {
    await service.writeFile(workspace.id, 'keep.txt', 'preserve these bytes');
    await service.list();
    const archiveKey = `workspace-archived-${workspace.id}`;
    const archivePath = path.join(config.stateDir, `${archiveKey}.json`);
    const stat = vi.spyOn(fs, 'stat');
    await service.get(workspace.id);
    expect(stat.mock.calls.some(call => String(call[0]) === archivePath)).toBe(true);
    await new JsonStore(config.stateDir).write(archiveKey, { id: workspace.id, archivedAt: new Date().toISOString() });
    await expect(service.get(workspace.id)).rejects.toMatchObject({ status: 404, code: 'WORKSPACE_NOT_FOUND' });
    await expect(service.writeFile(workspace.id, 'keep.txt', 'must not write')).rejects.toMatchObject({ status: 404 });
    expect(await fs.readFile(path.join(workspace.path, 'keep.txt'), 'utf8')).toBe('preserve these bytes');
  });

  it.each(['directory', 'malformed-json', 'wrong-record-id'])('does not hide a present %s workspace record while listing', async kind => {
    const recordPath = path.join(config.stateDir, `workspace-record-${workspace.id}.json`);
    if (kind === 'directory') {
      await fs.unlink(recordPath);
      await fs.mkdir(recordPath);
      await expect(service.list()).rejects.toMatchObject({ code: 'EISDIR' });
    } else if (kind === 'malformed-json') {
      await fs.writeFile(recordPath, '{"id":');
      await expect(service.list()).rejects.toBeInstanceOf(SyntaxError);
    } else {
      await fs.writeFile(recordPath, JSON.stringify({ ...workspace, id: 'different-workspace' }));
      await expect(service.list()).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_STATE_INVALID' });
    }
  });

  it('does not skip a present symlinked archive marker while listing', async () => {
    await store.write('archive-evidence', { id: workspace.id, archivedAt: new Date().toISOString() });
    await fs.symlink('archive-evidence.json', path.join(config.stateDir, `workspace-archived-${workspace.id}.json`));
    expect((await service.list()).some(item => item.id === workspace.id)).toBe(false);
    await expect(service.get(workspace.id)).rejects.toMatchObject({ status: 404 });
  });

  it('preserves all successful creates and different-workspace renames across independent stores', async () => {
    const first = new WorkspaceService(config, new JsonStore(config.stateDir));
    const second = new WorkspaceService(config, new JsonStore(config.stateDir));
    await Promise.all([first.initialize(), second.initialize()]);
    const rename = fs.rename.bind(fs);
    const overlap = async <T>(operations: (() => Promise<T>)[]): Promise<T[]> => {
      const gate = deferred();
      let arrivals = 0;
      const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
        const name = path.basename(String(destination));
        if ((name === 'workspaces.json' || name.startsWith('workspace-record-')) && arrivals < 2) {
          if (++arrivals === 2) gate.resolve();
          await gate.promise;
        }
        return rename(source, destination);
      });
      try {
        const results = await Promise.all(operations.map(operation => operation()));
        expect(arrivals).toBe(2);
        return results;
      } finally { spy.mockRestore(); gate.resolve(); }
    };
    const created = await overlap([() => first.create({ name: 'Independent first' }), () => second.create({ name: 'Independent second' })]);
    const observer = new WorkspaceService(config, new JsonStore(config.stateDir));
    expect((await observer.list()).map(item => item.id)).toEqual(expect.arrayContaining(created.map(item => item.id)));
    await overlap([() => first.update(created[0].id, { name: 'Renamed first' }), () => second.update(created[1].id, { name: 'Renamed second' })]);
    expect((await observer.get(created[0].id)).name).toBe('Renamed first');
    expect((await observer.get(created[1].id)).name).toBe('Renamed second');
  });

  it('archives only its target while another independent instance creates a workspace', async () => {
    const first = new WorkspaceService(config, new JsonStore(config.stateDir));
    const second = new WorkspaceService(config, new JsonStore(config.stateDir));
    await Promise.all([first.initialize(), second.initialize()]);
    await service.writeFile(workspace.id, 'keep.txt', 'files survive archive');
    const before = await service.list();
    const gate = deferred();
    let arrivals = 0;
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      const name = path.basename(String(destination));
      if ((name === 'workspaces.json' || name.startsWith('workspace-record-') || name.startsWith('workspace-archived-')) && arrivals < 2) {
        if (++arrivals === 2) gate.resolve();
        await gate.promise;
      }
      return rename(source, destination);
    });
    let created: Workspace;
    try { [, created] = await Promise.all([first.remove(workspace.id), second.create({ name: 'Created during archive' })]); }
    finally { spy.mockRestore(); gate.resolve(); }
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    expect(new Set((await restarted.list()).map(item => item.id))).toEqual(new Set([...before.filter(item => item.id !== workspace.id), created!].map(item => item.id)));
    expect(await fs.readFile(path.join(workspace.path, 'keep.txt'), 'utf8')).toBe('files survive archive');
    await expect(restarted.get(workspace.id)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps a tombstone authoritative when another instance finishes a rename after archive', async () => {
    const first = new WorkspaceService(config, new JsonStore(config.stateDir));
    const second = new WorkspaceService(config, new JsonStore(config.stateDir));
    await Promise.all([first.initialize(), second.initialize()]);
    const pendingRename = deferred();
    const archived = deferred();
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      const name = path.basename(String(destination));
      if (name === `workspace-record-${workspace.id}.json`) {
        pendingRename.resolve();
        await archived.promise;
      }
      await rename(source, destination);
      if (name === `workspace-archived-${workspace.id}.json`) archived.resolve();
    });
    const updating = first.update(workspace.id, { name: 'Late rename' }).then(value => ({ value }), error => ({ error }));
    try {
      await pendingRename.promise;
      await second.remove(workspace.id);
      expect(await updating).toMatchObject({ error: { status: 409, code: 'WORKSPACE_ARCHIVED' } });
    } finally { archived.resolve(); spy.mockRestore(); }
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    expect((await restarted.list()).some(item => item.id === workspace.id)).toBe(false);
    await expect(restarted.get(workspace.id)).rejects.toMatchObject({ status: 404 });
  });

  it('imports legacy registrations without resurrecting tombstones or unregistered folders', async () => {
    const now = new Date().toISOString();
    const legacy: Workspace = { id: 'legacy-project', name: 'Legacy project', path: path.join(config.workspacesDir, 'legacy-project'), createdAt: now, updatedAt: now };
    await fs.mkdir(legacy.path);
    await fs.mkdir(path.join(config.workspacesDir, 'unregistered-folder'));
    await store.write('workspaces', [legacy]);
    expect((await service.get(legacy.id)).name).toBe('Legacy project');
    await service.update(legacy.id, { name: 'Current metadata' });
    await store.write('workspaces', [{ ...legacy, name: 'Late old-instance metadata' }]);
    expect((await service.get(legacy.id)).name).toBe('Current metadata');
    await service.remove(legacy.id);
    const newcomer: Workspace = { ...legacy, id: 'old-instance-new-project', name: 'New legacy registration', path: path.join(config.workspacesDir, 'old-instance-new-project') };
    await fs.mkdir(newcomer.path);
    await store.write('workspaces', [legacy, newcomer]);
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    expect((await restarted.get(newcomer.id)).name).toBe('New legacy registration');
    const listed = await restarted.list();
    expect(listed.some(item => item.id === legacy.id)).toBe(false);
    expect(listed.some(item => item.path.endsWith('/unregistered-folder'))).toBe(false);
    expect((await fs.stat(legacy.path)).isDirectory()).toBe(true);
  });

  it('imports old40 rename and GitHub account-selection updates while canonical metadata wins', async () => {
    const legacy: Workspace = { id: 'old40-metadata', name: 'Original name', path: path.join(config.workspacesDir, 'old40-metadata'), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    await fs.mkdir(legacy.path);
    await fs.writeFile(path.join(legacy.path, 'user.txt'), 'user bytes remain untouched');
    const oldStore = new JsonStore(config.stateDir);
    await oldStore.write('workspaces', [legacy]);
    const current = new WorkspaceService(config, new JsonStore(config.stateDir));
    await current.initialize();
    // This is the frozen40 update operation: map the shared array and persist accepted name/account fields.
    const old40Update = async (name: string, githubAccountId: string, updatedAt: string) => oldStore.update<Workspace[]>('workspaces', [], entries => entries.map(entry => entry.id === legacy.id ? { ...entry, name, githubAccountId, updatedAt } : entry));
    await old40Update('Old instance accepted rename', 'late-account', '2026-01-01T00:00:01.000Z');
    expect(await current.get(legacy.id)).toMatchObject({ name: 'Old instance accepted rename', githubAccountId: 'late-account' });
    const readdir = vi.spyOn(fs, 'readdir');
    for (let index = 0; index < 4; index++) await current.get(legacy.id);
    expect(readdir).not.toHaveBeenCalled();
    readdir.mockRestore();
    await current.update(legacy.id, { name: 'Canonical name', githubAccountId: 'canonical-account' });
    await old40Update('Later legacy name', 'later-legacy-account', '2099-01-01T00:00:00.000Z');
    expect(await current.get(legacy.id)).toMatchObject({ name: 'Canonical name', githubAccountId: 'canonical-account' });
    expect(await fs.readFile(path.join(legacy.path, 'user.txt'), 'utf8')).toBe('user bytes remain untouched');
  });

  it('never rolls newer legacy metadata back when an older migration finishes last', async () => {
    const legacy: Workspace = { id: 'out-of-order-legacy', name: 'Older name', githubAccountId: 'older-account', path: path.join(config.workspacesDir, 'out-of-order-legacy'), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const newer: Workspace = { ...legacy, name: 'Newer name', githubAccountId: 'newer-account', updatedAt: '2026-01-01T00:00:01.000Z' };
    await fs.mkdir(legacy.path);
    await store.write('workspaces', [legacy]);
    const staged = deferred();
    const release = deferred();
    const rename = fs.rename.bind(fs);
    let held = false;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (path.basename(String(destination)).startsWith(`workspace-legacy-v-${legacy.id}-`) && !held) {
        held = true;
        staged.resolve();
        await release.promise;
      }
      return rename(source, destination);
    });
    const importing = service.list();
    try {
      await staged.promise;
      await new JsonStore(config.stateDir).write('workspaces', [newer]);
      const concurrent = new WorkspaceService(config, new JsonStore(config.stateDir));
      await concurrent.initialize();
      expect(await concurrent.get(legacy.id)).toMatchObject(newer);
      release.resolve();
      expect((await importing).find(entry => entry.id === legacy.id)).toMatchObject(newer);
    } finally { release.resolve(); spy.mockRestore(); }
    await store.write('workspaces', [legacy]);
    expect(await service.get(legacy.id)).toMatchObject(newer);
    expect(await new WorkspaceService(config, new JsonStore(config.stateDir)).get(legacy.id)).toMatchObject(newer);
  });

  it('cannot resurrect an archive when a delayed legacy migration finishes after a current rename', async () => {
    const now = new Date().toISOString();
    const legacy: Workspace = { id: 'delayed-legacy', name: 'Old metadata', path: path.join(config.workspacesDir, 'delayed-legacy'), createdAt: now, updatedAt: now };
    await fs.mkdir(legacy.path);
    await store.write('workspaces', [legacy]);
    const staged = deferred();
    const release = deferred();
    const rename = fs.rename.bind(fs);
    let held = false;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (path.basename(String(destination)).startsWith(`workspace-legacy-v-${legacy.id}-`) && !held) {
        held = true;
        staged.resolve();
        await release.promise;
      }
      return rename(source, destination);
    });
    const importing = service.list();
    try {
      await staged.promise;
      const concurrent = new WorkspaceService(config, new JsonStore(config.stateDir));
      await concurrent.initialize();
      await concurrent.update(legacy.id, { name: 'Current metadata' });
      await concurrent.remove(legacy.id);
      release.resolve();
      expect((await importing).some(item => item.id === legacy.id)).toBe(false);
    } finally { release.resolve(); spy.mockRestore(); }
    expect(await new JsonStore(config.stateDir).read(`workspace-record-${legacy.id}`, null)).toMatchObject({ name: 'Current metadata' });
    await expect(new WorkspaceService(config, new JsonStore(config.stateDir)).get(legacy.id)).rejects.toMatchObject({ status: 404 });
  });

  it('preserves a new active selection made between archive selection read and update', async () => {
    const selected = await service.create({ name: 'New selection' });
    await service.update(workspace.id, { active: true });
    const read = store.read.bind(store);
    let switched = false;
    const spy = vi.spyOn(store, 'read').mockImplementation(async <T>(key: string, fallback: T): Promise<T> => {
      const value = await read(key, fallback);
      if (key === 'active-workspace' && !switched) {
        switched = true;
        await store.write('active-workspace', selected.id);
      }
      return value;
    });
    try { await service.remove(workspace.id); }
    finally { spy.mockRestore(); }
    expect(switched).toBe(true);
    expect(await store.read('active-workspace', null)).toBe(selected.id);
  });

  it('clears only the disconnected GitHub account and preserves a newer account selection', async () => {
    await service.update(workspace.id, { githubAccountId: 'account-a' });
    expect((await service.clearGithubAccount(workspace.id, 'account-a')).githubAccountId).toBeUndefined();
    expect((await service.get(workspace.id)).githubAccountId).toBeUndefined();
    await service.update(workspace.id, { githubAccountId: 'account-b' });
    expect((await service.clearGithubAccount(workspace.id, 'account-a')).githubAccountId).toBe('account-b');
    await service.update(workspace.id, { githubAccountId: 'account-a' });
    const update = store.update.bind(store);
    let switched = false;
    const spy = vi.spyOn(store, 'update').mockImplementation(async <T>(key: string, fallback: T, updater: (current: T) => T | Promise<T>): Promise<T> => {
      if (key === `workspace-record-${workspace.id}` && !switched) {
        switched = true;
        await update<Workspace>(key, workspace, current => ({ ...current, githubAccountId: 'account-b' }));
      }
      return update(key, fallback, updater);
    });
    try { expect((await service.clearGithubAccount(workspace.id, 'account-a')).githubAccountId).toBe('account-b'); }
    finally { spy.mockRestore(); }
    expect(switched).toBe(true);
    expect((await service.get(workspace.id)).githubAccountId).toBe('account-b');
    await service.remove(workspace.id);
    await expect(service.clearGithubAccount(workspace.id, 'account-b')).rejects.toMatchObject({ status: 404 });
  });

  it('round-trips Unicode paths and UTF-8 BOMs with stable content hashes', async () => {
    const original = '\ufeffconst greeting = "こんにちは 👋";\n';
    const saved = await service.writeFile(workspace.id, '组件/Hello 🌍.tsx', original);
    expect(saved.version).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.size).toBe(Buffer.byteLength(original));
    expect(saved.language).toBe('typescript');
    expect(await service.readFile(workspace.id, '组件/Hello 🌍.tsx')).toEqual(saved);
    expect((await service.listTree(workspace.id)).map(item => [item.name, item.kind])).toEqual([['组件', 'directory']]);
    expect((await service.listTree(workspace.id, '组件'))[0].path).toBe('组件/Hello 🌍.tsx');
  });

  it('rejects absolute paths, traversals, Windows separators, and root mutations', async () => {
    for (const unsafe of ['../secret', 'nested/../../secret', '/etc/passwd', 'C:\\Windows\\file', 'a\\..\\file', 'bad\0name']) {
      await expect(service.resolvePath(workspace.id, unsafe, { allowMissing: true })).rejects.toMatchObject({ status: 400, code: 'INVALID_PATH' });
    }
    await expect(service.trashEntry(workspace.id, '')).rejects.toMatchObject({ status: 400 });
    await expect(service.renameEntry(workspace.id, '.', 'root')).rejects.toMatchObject({ status: 400 });
    await expect(service.get('../bad')).rejects.toMatchObject({ status: 404 });
    await expect(service.get('missing-id')).rejects.toMatchObject({ status: 404 });
  });

  it('blocks both existing and missing targets behind an outside symlink', async () => {
    const outside = path.join(directory, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside data');
    await fs.symlink(outside, path.join(workspace.path, 'escape'));
    await expect(service.readFile(workspace.id, 'escape/secret.txt')).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
    await expect(service.resolvePath(workspace.id, 'escape/new/deep.txt', { allowMissing: true })).rejects.toMatchObject({ status: 403 });
    await expect(service.writeFile(workspace.id, 'escape/new.txt', 'unsafe')).rejects.toMatchObject({ status: 403 });
    expect(await fs.readdir(outside)).toEqual(['secret.txt']);
    expect((await service.listTree(workspace.id))[0]).toMatchObject({ name: 'escape', isSymlink: true });
  });

  it('allows internal symlinks, while deleting an outside symlink never follows it', async () => {
    await service.writeFile(workspace.id, 'actual/file.txt', 'original');
    await fs.symlink('actual', path.join(workspace.path, 'linked'));
    const read = await service.readFile(workspace.id, 'linked/file.txt');
    await service.writeFile(workspace.id, 'linked/file.txt', 'updated', read.version);
    expect(await fs.readFile(path.join(workspace.path, 'actual/file.txt'), 'utf8')).toBe('updated');
    const outside = path.join(directory, 'outside-target.txt');
    await fs.writeFile(outside, 'keep me');
    await fs.symlink(outside, path.join(workspace.path, 'outside-link'));
    await service.renameEntry(workspace.id, 'outside-link', 'renamed-link');
    expect((await fs.lstat(path.join(workspace.path, 'renamed-link'))).isSymbolicLink()).toBe(true);
    const trashed = await service.trashEntry(workspace.id, 'renamed-link');
    expect(await fs.readFile(outside, 'utf8')).toBe('keep me');
    await service.restoreEntry(workspace.id, trashed.id);
    expect((await fs.lstat(path.join(workspace.path, 'renamed-link'))).isSymbolicLink()).toBe(true);
  });

  it('refuses unsafe registered workspace roots and dangling symlinks', async () => {
    await fs.symlink('nonexistent', path.join(workspace.path, 'dangling'));
    await expect(service.resolvePath(workspace.id, 'dangling', { allowMissing: true })).rejects.toMatchObject({ status: 403 });
    await store.update<Workspace>(`workspace-record-${workspace.id}`, workspace, current => ({ ...current, path: directory }));
    await expect(service.resolvePath(workspace.id, '')).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
  });

  it('preserves terminal changes on stale saves and serializes competing versioned saves', async () => {
    const original = await service.writeFile(workspace.id, 'main.ts', 'first');
    await fs.writeFile(path.join(workspace.path, 'main.ts'), 'edited in terminal');
    await expect(service.writeFile(workspace.id, 'main.ts', 'stale editor', original.version)).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect((await service.readFile(workspace.id, 'main.ts')).content).toBe('edited in terminal');
    const refreshed = await service.readFile(workspace.id, 'main.ts');
    const results = await Promise.allSettled([
      service.writeFile(workspace.id, 'main.ts', 'editor one', refreshed.version),
      service.writeFile(workspace.id, 'main.ts', 'editor two', refreshed.version),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await service.readFile(workspace.id, 'main.ts')).content).toBe('editor one');
    await fs.unlink(path.join(workspace.path, 'main.ts'));
    await expect(service.writeFile(workspace.id, 'main.ts', 'resurrect stale file', refreshed.version)).rejects.toMatchObject({ status: 409 });
  });

  it('preserves existing file permissions across saves while new files respect umask', async () => {
    const originalUmask = process.umask(0o027);
    try {
      for (const mode of [0o646, 0o777]) {
        const relative = `mode-${mode.toString(8)}.txt`;
        const absolute = path.join(workspace.path, relative);
        await fs.writeFile(absolute, 'original');
        await fs.chmod(absolute, mode);
        const before = await service.readFile(workspace.id, relative);
        await service.writeFile(workspace.id, relative, 'saved content', before.version);
        expect((await fs.stat(absolute)).mode & 0o777).toBe(mode);
        expect(await fs.readFile(absolute, 'utf8')).toBe('saved content');
      }
      await service.writeFile(workspace.id, 'new-file.txt', 'created with default permissions');
      expect((await fs.stat(path.join(workspace.path, 'new-file.txt'))).mode & 0o777).toBe(0o640);
    } finally { process.umask(originalUmask); }
  });

  it('keeps uploads binary-safe and refuses accidental overwrites', async () => {
    const binary = Buffer.from([0, 255, 1, 2, 254]);
    const uploaded = await service.upload(workspace.id, 'assets/binary.dat', binary);
    expect(uploaded.size).toBe(binary.length);
    expect(await fs.readFile(path.join(workspace.path, 'assets/binary.dat'))).toEqual(binary);
    await expect(service.readFile(workspace.id, 'assets/binary.dat')).rejects.toMatchObject({ status: 415, code: 'BINARY_FILE' });
    await expect(service.upload(workspace.id, 'assets/binary.dat', Buffer.from('overwrite'))).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(path.join(workspace.path, 'assets/binary.dat'))).toEqual(binary);
    await fs.writeFile(path.join(workspace.path, 'large.txt'), Buffer.alloc(MAX_TEXT_FILE_BYTES + 1, 97));
    await expect(service.readFile(workspace.id, 'large.txt')).rejects.toMatchObject({ status: 413 });
    expect((await fs.readdir(path.join(workspace.path, 'assets'))).some(name => name.startsWith('.codex-write-'))).toBe(false);
  });

  it('rejects overwrite renames and moving directories inside themselves', async () => {
    await service.writeFile(workspace.id, 'from.txt', 'source');
    await service.writeFile(workspace.id, 'to.txt', 'destination');
    await expect(service.renameEntry(workspace.id, 'from.txt', 'to.txt')).rejects.toMatchObject({ status: 409 });
    expect((await service.readFile(workspace.id, 'from.txt')).content).toBe('source');
    expect((await service.readFile(workspace.id, 'to.txt')).content).toBe('destination');
    await service.createEntry(workspace.id, 'folder', 'directory');
    await expect(service.renameEntry(workspace.id, 'folder', 'folder/nested')).rejects.toMatchObject({ status: 400 });
    await service.renameEntry(workspace.id, 'from.txt', 'nested/renamed.txt');
    expect((await service.readFile(workspace.id, 'nested/renamed.txt')).content).toBe('source');
  });

  it('persists deleted directories and restores them without overwriting new files', async () => {
    await service.writeFile(workspace.id, 'nested/deep/file.txt', 'recoverable content');
    const deleted = await service.trashEntry(workspace.id, 'nested');
    expect(deleted.kind).toBe('directory');
    await expect(service.readFile(workspace.id, 'nested/deep/file.txt')).rejects.toMatchObject({ status: 404 });
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    expect(await restarted.listTrash(workspace.id)).toEqual([deleted]);
    await restarted.createEntry(workspace.id, 'nested', 'directory');
    await expect(restarted.restoreEntry(workspace.id, deleted.id)).rejects.toMatchObject({ status: 409 });
    await fs.rmdir(path.join(workspace.path, 'nested'));
    await restarted.restoreEntry(workspace.id, deleted.id);
    expect((await restarted.readFile(workspace.id, 'nested/deep/file.txt')).content).toBe('recoverable content');
    expect(await restarted.listTrash(workspace.id)).toEqual([]);
  });

  it('rejects a symlinked trash root before creating anything outside storage', async () => {
    const outside = path.join(directory, 'outside-trash');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(config.workspacesDir, '.trash'));
    await service.writeFile(workspace.id, 'keep.txt', 'untouched');
    await expect(service.trashEntry(workspace.id, 'keep.txt')).rejects.toMatchObject({ status: 403 });
    expect(await fs.readdir(outside)).toEqual([]);
    expect((await service.readFile(workspace.id, 'keep.txt')).content).toBe('untouched');
  });

  it('removes registrations while preserving files and an intentionally empty workspace list', async () => {
    await service.writeFile(workspace.id, 'keep.txt', 'remains on disk');
    for (const item of await service.list()) await service.remove(item.id);
    expect(await fs.readFile(path.join(workspace.path, 'keep.txt'), 'utf8')).toBe('remains on disk');
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    expect(await restarted.list()).toEqual([]);
    await expect(restarted.get(workspace.id)).rejects.toMatchObject({ status: 404 });
  });

  it('exposes retained archived registration metadata without restoring file access', async () => {
    await service.writeFile(workspace.id, 'keep.txt', 'retained user content');
    await service.remove(workspace.id);
    expect(await service.getRegistration(workspace.id, { includeArchived: true })).toEqual(workspace);
    await expect(service.getRegistration(workspace.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.get(workspace.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.resolvePath(workspace.id, 'keep.txt')).rejects.toMatchObject({ status: 404 });
    await expect(service.writeFile(workspace.id, 'keep.txt', 'unexpected overwrite')).rejects.toMatchObject({ status: 404 });
    await expect(service.getRegistration('../outside', { includeArchived: true })).rejects.toMatchObject({ status: 404 });
    expect(await fs.readFile(path.join(workspace.path, 'keep.txt'), 'utf8')).toBe('retained user content');
  });

  it('returns bounded quick-open paths, fuzzy matches, and respects root gitignore rules', async () => {
    await service.writeFile(workspace.id, '.gitignore', 'ignored/\n*.log\n');
    await service.writeFile(workspace.id, 'src/Component.tsx', 'export default 1;');
    await service.writeFile(workspace.id, 'ignored/secret.ts', 'ignored');
    await service.writeFile(workspace.id, 'node_modules/module/index.ts', 'dependency');
    await service.writeFile(workspace.id, 'debug.log', 'logs');
    await service.writeFile(workspace.id, 'README.md', 'docs');
    expect(await service.filePaths(workspace.id, 'cmp.ts')).toEqual(['src/Component.tsx']);
    expect(await service.filePaths(workspace.id)).toEqual(['.gitignore', 'README.md', 'src/Component.tsx']);
  });

  it('searches literals and bounded regular expressions with file filters and Unicode positions', async () => {
    await service.writeFile(workspace.id, 'src/test.ts', 'one\n👋 literal.*+?^${}()|[]\\\nHELLO hello\n');
    await service.writeFile(workspace.id, 'src/deep/test.ts', 'hello');
    await service.writeFile(workspace.id, 'notes.txt', 'hello');
    await service.writeFile(workspace.id, 'node_modules/skip.txt', 'hello');
    const literal = await service.search(workspace.id, 'literal.*+?^${}()|[]\\');
    expect(literal).toEqual([{ path: 'src/test.ts', line: 2, column: 4, text: '👋 literal.*+?^${}()|[]\\' }]);
    expect(await service.search(workspace.id, 'hello', { caseSensitive: true, include: 'src/**/*.ts' })).toHaveLength(2);
    expect(await service.search(workspace.id, 'HELLO', { caseSensitive: true, include: '*.ts' })).toHaveLength(1);
    expect(await service.search(workspace.id, 'hello', { include: '*.txt' })).toHaveLength(1);
    expect(await service.search(workspace.id, 'h.llo', { regex: true, include: 'src/*.ts' })).toHaveLength(2);
    await expect(service.search(workspace.id, '[invalid', { regex: true })).rejects.toMatchObject({ status: 400, code: 'INVALID_REGEX' });
    const zeroWidth = await service.search(workspace.id, '(?=.)', { regex: true, include: 'src/test.ts' });
    expect(zeroWidth.length).toBeGreaterThan(0);
    expect(zeroWidth.length).toBeLessThan(100);
  });

  it('terminates pathological regexes without blocking the server event loop', async () => {
    await service.writeFile(workspace.id, 'pathological.txt', `${'a'.repeat(200)}!`);
    const search = service.search(workspace.id, '^(a+)+$', { regex: true });
    // Install rejection handling immediately so timeout errors cannot become unhandled rejections.
    const outcome = search.then(() => 'completed', error => error);
    const tick = await Promise.race([
      new Promise<string>(resolve => setTimeout(() => resolve('event loop responsive'), 100)),
      outcome.then(() => 'search finished'),
    ]);
    expect(tick).toBe('event loop responsive');
    expect(await outcome).toMatchObject({ status: 400, code: 'SEARCH_TIMEOUT' });
  }, 10_000);

  it('replaces literal text using literal replacement strings and explicit file selection', async () => {
    await service.writeFile(workspace.id, 'one.txt', 'Hello hello HELLO');
    await service.writeFile(workspace.id, 'two.txt', 'hello');
    expect(await service.replace(workspace.id, { query: 'hello', replacement: '$&', paths: ['one.txt'] })).toEqual({ files: 1, replacements: 3 });
    expect((await service.readFile(workspace.id, 'one.txt')).content).toBe('$& $& $&');
    expect((await service.readFile(workspace.id, 'two.txt')).content).toBe('hello');
    await expect(service.replace(workspace.id, { query: 'hello', replacement: 'bad', paths: ['two.txt', '../outside.txt'] })).rejects.toMatchObject({ status: 400 });
    expect((await service.readFile(workspace.id, 'two.txt')).content).toBe('hello');
  });

  it('validates replacement expansion bounds before changing any files', async () => {
    await service.writeFile(workspace.id, 'a.txt', 'a');
    await service.writeFile(workspace.id, 'z.txt', 'a'.repeat(81));
    await expect(service.replace(workspace.id, { query: 'a', replacement: 'x'.repeat(64 * 1024) })).rejects.toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    expect((await service.readFile(workspace.id, 'a.txt')).content).toBe('a');
    expect((await service.readFile(workspace.id, 'z.txt')).content).toBe('a'.repeat(81));
  });

  it('bounds aggregate replacement output before changing any file', async () => {
    await Promise.all(Array.from({ length: 40 }, (_, index) => fs.writeFile(path.join(workspace.path, `file-${index}.txt`), 'a'.repeat(10))));
    await expect(service.replace(workspace.id, { query: 'a', replacement: 'x'.repeat(64 * 1024) })).rejects.toMatchObject({ status: 413, code: 'SEARCH_LIMIT' });
    expect((await service.readFile(workspace.id, 'file-0.txt')).content).toBe('a'.repeat(10));
    expect((await service.readFile(workspace.id, 'file-39.txt')).content).toBe('a'.repeat(10));
  });

  it('serves real editor, upload, download, trash, and restore HTTP routes', async () => {
    const app = express();
    const events = new EventEmitter();
    type ChangePayload = { workspaceId: string; paths?: string[]; operationId?: string; phase?: 'start' | 'end' };
    const observedEvents: { event: string; payload: ChangePayload }[] = [];
    const observedSaveContents: (string | null)[] = [];
    for (const event of ['workspace:manual-intent', 'workspace:changed']) events.on(event, (payload: ChangePayload) => {
      observedEvents.push({ event, payload });
      if (payload.paths?.includes('unicode 文.txt') && payload.phase !== 'end') {
        const file = path.join(workspace.path, 'unicode 文.txt');
        observedSaveContents.push(existsSync(file) ? readFileSync(file, 'utf8') : null);
      }
    });
    app.use(express.json({ limit: '8mb' }));
    app.use('/api', createWorkspaceRouter({ config, store, workspaces: service, events } as AppContext));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const known = error instanceof HttpError;
      res.status(known ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Unexpected error', code: known ? error.code : undefined });
    });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a port.');
    const base = `http://127.0.0.1:${address.port}/api/workspaces/${workspace.id}`;
    const save = await fetch(`${base}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'unicode 文.txt', content: 'round trip' }) });
    expect(save.status).toBe(200);
    const saved = await save.json() as FileContent;
    expect(saved.content).toBe('round trip');
    const read = await fetch(`${base}/file?path=${encodeURIComponent(saved.path)}`);
    expect(await read.json()).toEqual(saved);
    const conflict = await fetch(`${base}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: saved.path, content: 'stale', expectedVersion: '0'.repeat(64) }) });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    const binary = Buffer.from([0, 7, 128, 255]);
    const upload = await fetch(`${base}/upload?path=data.bin`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: binary });
    expect(upload.status).toBe(201);
    expect(await upload.json()).toMatchObject({ path: 'data.bin', size: 4 });
    const download = await fetch(`${base}/download?path=data.bin`);
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('no-store');
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await download.arrayBuffer())).toEqual(binary);
    const deletion = await fetch(`${base}/file?path=data.bin`, { method: 'DELETE' });
    const deleted = await deletion.json() as { trashId: string };
    expect(deletion.status).toBe(200);
    const trash = await fetch(`${base}/trash`);
    expect(await trash.json()).toMatchObject([{ id: deleted.trashId, path: 'data.bin' }]);
    const restore = await fetch(`${base}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashId: deleted.trashId }) });
    expect(restore.status).toBe(200);
    await restore.json();
    const quickOpen = await fetch(`${base}/file-paths?q=uni`);
    expect(await quickOpen.json()).toEqual(['unicode 文.txt']);
    const create = await fetch(`${base}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'folder/created.txt', kind: 'file' }) });
    expect(create.status).toBe(201);
    await create.json();
    const rename = await fetch(`${base}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'folder/created.txt', newPath: 'folder/renamed.txt' }) });
    expect(rename.status).toBe(200);
    await rename.json();
    await service.writeFile(workspace.id, 'actual.txt', 'initial content');
    await fs.symlink('actual.txt', path.join(workspace.path, 'alias.txt'));
    const aliasSave = await fetch(`${base}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: './alias.txt', content: 'manual edit through a symlink' }) });
    expect(aliasSave.status).toBe(200);
    await aliasSave.json();
    const replace = await fetch(`${base}/replace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'unmatched-find-text', replacement: 'unused' }) });
    expect(replace.status).toBe(200);
    expect(await replace.json()).toEqual({ files: 0, replacements: 0 });
    const metadata = await fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Updated project' }) });
    expect(metadata.status).toBe(200);
    await metadata.json();
    const mutationPaths: (string[] | undefined)[] = [
      ['unicode 文.txt'], ['unicode 文.txt'], ['data.bin'], ['data.bin'], ['data.bin'],
      ['folder/created.txt'], ['folder/created.txt', 'folder/renamed.txt'], ['alias.txt', 'actual.txt'], undefined,
    ];
    const operationIds = observedEvents.filter(entry => entry.payload.phase === 'start').map(entry => entry.payload.operationId);
    expect(operationIds).toHaveLength(mutationPaths.length);
    expect(new Set(operationIds).size).toBe(mutationPaths.length);
    for (const operationId of operationIds) expect(operationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(observedEvents).toEqual([
      ...mutationPaths.flatMap((paths, index) => {
        const payload = { workspaceId: workspace.id, ...(paths ? { paths } : {}) };
        return [
          { event: 'workspace:manual-intent', payload: { ...payload, operationId: operationIds[index], phase: 'start' } },
          ...(index === 1 ? [] : [{ event: 'workspace:changed', payload }]),
          { event: 'workspace:manual-intent', payload: { ...payload, operationId: operationIds[index], phase: 'end' } },
        ];
      }),
      { event: 'workspace:changed', payload: { workspaceId: workspace.id, paths: [] } },
    ]);
    expect(observedSaveContents).toEqual([null, 'round trip', 'round trip']);
  });
});
