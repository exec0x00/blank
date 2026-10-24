import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { RequestOptions } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';
import { HttpError } from '../server/errors';
import { withWorkspaceRemoval, workspaceIsBusy } from '../server/worktrees/activity';
import type { GithubAccount, Workspace } from '../shared/types';

// Only the GitHub HTTPS boundary and Git's remote/upload-pack boundary are
// controlled. Imports run native Git against a real committed local repository.
const fixture = vi.hoisted(() => ({ source: '', uploadPack: '', clones: [] as string[][],
  directories: [] as Array<{ cwd: string; pwd: string | undefined }> }));
const TOKEN = 'github_pat_import_activity_fixture_not_real_1234567890123456';
const FULL_NAME = 'fixture/import-lifetime';
const execFile = promisify(execFileCallback);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

vi.mock('node:https', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:https')>();
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return {
    ...original,
    request: (options: RequestOptions, callback: (response: unknown) => void) => {
      const request = new EventEmitter() as InstanceType<typeof EventEmitter> & { end(): void; destroy(): void };
      request.destroy = () => {};
      request.end = () => queueMicrotask(() => {
        const user = options.path === '/user';
        const repository = options.path === '/repos/fixture/import-lifetime';
        const response = Object.assign(new PassThrough(), { statusCode: user || repository ? 200 : 404, headers: {} });
        callback(response);
        response.end(JSON.stringify(user
          ? { id: 501, login: 'fixture', name: 'Import fixture', avatar_url: 'https://avatars.githubusercontent.com/u/501' }
          : repository
            ? { id: 601, name: 'import-lifetime', full_name: 'fixture/import-lifetime', private: true,
              default_branch: 'main', updated_at: '2026-09-20T00:00:00Z', html_url: 'https://github.com/fixture/import-lifetime' }
            : { message: 'Unconfigured GitHub fixture route' }));
      });
      return request;
    },
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawn: (command: string, args: string[], options: import('node:child_process').SpawnOptions) => {
      if (command !== 'git' || !args.includes('clone')) return original.spawn(command, args, options);
      fixture.clones.push([...args]);
      fixture.directories.push({ cwd: String(options.cwd), pwd: options.env?.PWD });
      if (!fixture.source || !fixture.uploadPack) throw new Error('The real clone fixture is not ready.');
      const mapped = args.map(value => value.startsWith('https://github.com/') ? fixture.source : value);
      mapped.splice(mapped.indexOf('--'), 0, `--upload-pack=${fixture.uploadPack}`);
      return original.spawn(command, ['-c', 'protocol.file.allow=always', ...mapped], options);
    },
  };
});

let directory: string;
let app: Awaited<ReturnType<typeof createApplication>>;
let origin: string;
let cookie: string;
let account: GithubAccount;
let cloneReady: string;
let cloneGate: string;
let cloneFailure: string;
let published: Workspace[];
let onCreated: ((workspace: Workspace) => Promise<void>) | undefined;
let releases: Set<() => void>;
let pending: Set<Promise<unknown>>;

function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>(resolve => { finish = resolve; });
  const release = () => { releases.delete(release); finish(); };
  releases.add(release);
  return { promise, release };
}

function request(route: string, method = 'GET', body?: unknown): Promise<Response> {
  const response = fetch(`${origin}/api${route}`, {
    method,
    headers: { Origin: origin, Cookie: cookie, 'X-Codex-Workspace': '1', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  pending.add(response);
  void response.then(() => pending.delete(response), () => pending.delete(response));
  return response;
}

const startImport = () => request('/github/import', 'POST', { accountId: account.id, fullName: FULL_NAME });
const busy = (workspace: Workspace) => workspaceIsBusy(app.ctx.config.workspacesDir, workspace.id);
const allowClone = () => writeFile(cloneGate, 'continue');

async function waitForClone(): Promise<Workspace> {
  await expect.poll(async () => access(cloneReady).then(() => true, () => false), { timeout: 5000 }).toBe(true);
  expect(published).toHaveLength(1);
  return published[0];
}

async function expectDeletionBusy(workspace: Workspace) {
  const response = await request(`/workspaces/${workspace.id}`, 'DELETE');
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'WORKSPACE_BUSY' });
  expect(busy(workspace)).toBe(true);
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'codex-github-import-activity-'));
  releases = new Set();
  pending = new Set();
  published = [];
  onCreated = undefined;
  fixture.clones = [];
  fixture.directories = [];
  cloneReady = path.join(directory, 'clone-ready');
  cloneGate = path.join(directory, 'clone-continue');
  cloneFailure = path.join(directory, 'clone-fail');
  const source = path.join(directory, 'source');
  const gitEnvironment = { PATH: process.env.PATH, HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  await execFile('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=main', source], { env: gitEnvironment, timeout: 5000 });
  await writeFile(path.join(source, 'README.md'), 'Real imported repository content\n');
  await execFile('git', ['-C', source, 'add', 'README.md'], { env: gitEnvironment, timeout: 5000 });
  await execFile('git', ['-C', source, '-c', 'user.name=Import fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture commit'], { env: gitEnvironment, timeout: 5000 });
  fixture.source = pathToFileURL(source).href;
  fixture.uploadPack = path.join(directory, 'gated-upload-pack');
  await writeFile(fixture.uploadPack, [
    '#!/bin/sh', 'set -eu', `printf ready > ${quote(cloneReady)}`,
    `while [ ! -f ${quote(cloneGate)} ]; do sleep 0.01; done`,
    `if [ -f ${quote(cloneFailure)} ]; then printf 'deliberate fixture clone failure\\n' >&2; exit 23; fi`,
    'exec git-upload-pack "$@"', '',
  ].join('\n'), { mode: 0o700 });
  await chmod(fixture.uploadPack, 0o700);
  app = await createApplication(loadConfig({ NODE_ENV: 'test', DATA_DIR: path.join(directory, 'data'),
    WORKSPACE_PASSWORD: 'github-import-activity-password', SESSION_SECRET: 'github-import-activity-session-secret-over-32-characters',
    ENCRYPTION_KEY: 'github-import-activity-encryption-key-over-32-characters' }));
  const create = app.ctx.workspaces.create.bind(app.ctx.workspaces);
  vi.spyOn(app.ctx.workspaces, 'create').mockImplementation(async input => {
    const workspace = await create(input);
    published.push(workspace);
    await onCreated?.(workspace);
    return workspace;
  });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  cookie = '';
  const login = await request('/session', 'POST', { password: app.ctx.config.password });
  expect(login.status).toBe(200);
  cookie = login.headers.get('set-cookie')!.split(';')[0];
  const connected = await request('/github/accounts', 'POST', { token: TOKEN });
  expect(connected.status).toBe(201);
  account = await connected.json();
});

afterEach(async () => {
  for (const release of [...releases]) release();
  await allowClone();
  await Promise.allSettled([...pending]);
  await app?.close();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('GitHub import ownership through native clone and workspace deletion', () => {
  it('blocks deletion through the real clone and account completion, then records durable GitHub provenance', async () => {
    const completing = deferred();
    const finishCompletion = deferred();
    const complete = app.ctx.workspaces.completeGithubImport.bind(app.ctx.workspaces);
    vi.spyOn(app.ctx.workspaces, 'completeGithubImport').mockImplementation(async (...args) => {
      completing.release();
      await finishCompletion.promise;
      return complete(...args);
    });
    const imported = startImport();
    const workspace = await waitForClone();
    expect((await request('/workspaces').then(response => response.json())).some((item: Workspace) => item.id === workspace.id)).toBe(true);
    await expectDeletionBusy(workspace);
    const nativeDestination = fixture.clones[0].at(-1)!;
    expect(nativeDestination).not.toBe(workspace.path);
    expect(path.relative(app.ctx.config.dataDir, nativeDestination).startsWith('..')).toBe(true);
    expect(fixture.directories[0]).toEqual({ cwd: path.dirname(nativeDestination), pwd: path.dirname(nativeDestination) });
    await expect(access(path.join(workspace.path, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(nativeDestination, '.git', 'config'), 'utf8')).not.toContain(TOKEN);
    await allowClone();
    await completing.promise;
    expect(await readFile(path.join(workspace.path, 'README.md'), 'utf8')).toBe('Real imported repository content\n');
    await expectDeletionBusy(workspace);
    finishCompletion.release();
    const response = await imported;
    expect(response.status).toBe(201);
    const result: Workspace = await response.json();
    expect(result).toMatchObject({ id: workspace.id, githubAccountId: account.id, source: { kind: 'github', fullName: FULL_NAME } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(fixture.clones[0].join(' ')).not.toContain(TOKEN);
    expect(busy(workspace)).toBe(false);
    await expect(access(path.dirname(nativeDestination))).rejects.toMatchObject({ code: 'ENOENT' });
    await app.ctx.workspaces.clearGithubAccount(workspace.id, account.id);
    expect(await app.ctx.workspaces.getWorkspaceDeletionPlan(workspace.id)).toMatchObject({ workspaceId: workspace.id, mode: 'permanent' });
    const deleted = await request(`/workspaces/${workspace.id}`, 'DELETE', { expectedMode: 'permanent' });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ removed: true, mode: 'permanent' });
    expect((await app.ctx.workspaces.listWorkspaceTrash()).some(item => item.workspaceId === workspace.id)).toBe(false);
  });

  it('retains admission through empty failed-clone cleanup and releases it afterward', async () => {
    const rollingBack = deferred();
    const finishRollback = deferred();
    const remove = app.ctx.workspaces.remove.bind(app.ctx.workspaces);
    vi.spyOn(app.ctx.workspaces, 'remove').mockImplementation(async id => {
      expect(busy(published[0])).toBe(true);
      rollingBack.release();
      await finishRollback.promise;
      return remove(id);
    });
    const imported = startImport();
    const workspace = await waitForClone();
    await writeFile(cloneFailure, 'fail');
    await allowClone();
    await rollingBack.promise;
    await expectDeletionBusy(workspace);
    finishRollback.release();
    const response = await imported;
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'GIT_CLONE_FAILED' });
    expect(busy(workspace)).toBe(false);
    expect(await request('/github/imports/recovery').then(result => result.json())).toEqual([]);
    await expect(access(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(app.ctx.workspaces.get(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    await expect(withWorkspaceRemoval(app.ctx.config.workspacesDir, workspace.id, async () => 'released')).resolves.toBe('released');
    expect((await request('/github/accounts').then(response => response.json()))).toMatchObject([{ id: account.id }]);
  });

  it('retains a real clone and concurrent user edits when account completion fails', async () => {
    const completing = deferred();
    const failCompletion = deferred();
    vi.spyOn(app.ctx.workspaces, 'completeGithubImport').mockImplementation(async () => {
      completing.release();
      await failCompletion.promise;
      throw new HttpError(503, 'Fixture account completion failed.', 'FIXTURE_COMPLETION_FAILED');
    });
    const remove = vi.spyOn(app.ctx.workspaces, 'remove');
    const imported = startImport();
    const workspace = await waitForClone();
    await allowClone();
    await completing.promise;
    await expectDeletionBusy(workspace);
    await app.ctx.workspaces.writeFile(workspace.id, 'user.txt', 'User edit during account completion\n');
    failCompletion.release();
    const response = await imported;
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result).toMatchObject({ code: 'GITHUB_IMPORT_RETAINED' });
    expect(result.error).toContain('retained');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(await readFile(path.join(workspace.path, 'README.md'), 'utf8')).toBe('Real imported repository content\n');
    expect(await readFile(path.join(workspace.path, 'user.txt'), 'utf8')).toBe('User edit during account completion\n');
    expect(remove).not.toHaveBeenCalled();
    expect(await app.ctx.workspaces.get(workspace.id)).toMatchObject({ id: workspace.id });
    expect(busy(workspace)).toBe(false);
    const recoveries = await request('/github/imports/recovery').then(result => result.json());
    expect(recoveries).toEqual([expect.objectContaining({ workspaceId: workspace.id, workspaceName: workspace.name, reason: expect.stringContaining('retained') })]);
    expect(JSON.stringify(recoveries)).not.toContain(TOKEN);
    expect(JSON.stringify(recoveries)).not.toContain(directory);
  });

  it('retains a user file written during the real native clone when that clone fails', async () => {
    const remove = vi.spyOn(app.ctx.workspaces, 'remove');
    const imported = startImport();
    const workspace = await waitForClone();
    await app.ctx.workspaces.writeFile(workspace.id, 'user-during-clone.txt', 'User-owned bytes\n');
    expect(await readFile(path.join(workspace.path, 'user-during-clone.txt'), 'utf8')).toBe('User-owned bytes\n');
    await writeFile(cloneFailure, 'fail');
    await allowClone();
    const response = await imported;
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'GITHUB_IMPORT_RETAINED' });
    expect(await readFile(path.join(workspace.path, 'user-during-clone.txt'), 'utf8')).toBe('User-owned bytes\n');
    expect(remove).not.toHaveBeenCalled();
    expect(await app.ctx.workspaces.get(workspace.id)).toMatchObject({ id: workspace.id });
    expect(busy(workspace)).toBe(false);
  });

  it('does not clone or roll back a published directory when removal already owns admission', async () => {
    const created = deferred();
    const returnCreation = deferred();
    const finishRemoval = deferred();
    onCreated = async workspace => {
      await writeFile(path.join(workspace.path, 'owner.txt'), 'Owned by the removal lifecycle\n');
      created.release();
      await returnCreation.promise;
    };
    const imported = startImport();
    await created.promise;
    const workspace = published[0];
    const removal = withWorkspaceRemoval(app.ctx.config.workspacesDir, workspace.id, () => finishRemoval.promise);
    const remove = vi.spyOn(app.ctx.workspaces, 'remove');
    returnCreation.release();
    const response = await imported;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'WORKTREE_BUSY' });
    expect(fixture.clones).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    expect(await readFile(path.join(workspace.path, 'owner.txt'), 'utf8')).toBe('Owned by the removal lifecycle\n');
    expect(busy(workspace)).toBe(true);
    finishRemoval.release();
    await removal;
    expect(busy(workspace)).toBe(false);
  });

  it('preserves a user file created after publication but before clone admission', async () => {
    onCreated = async workspace => { await writeFile(path.join(workspace.path, 'user.txt'), 'User-authored content\n'); };
    const remove = vi.spyOn(app.ctx.workspaces, 'remove');
    const response = await startImport();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'GITHUB_IMPORT_CHANGED' });
    expect(fixture.clones).toEqual([]);
    const workspace = published[0];
    expect(await readFile(path.join(workspace.path, 'user.txt'), 'utf8')).toBe('User-authored content\n');
    expect(remove).not.toHaveBeenCalled();
    expect(await app.ctx.workspaces.get(workspace.id)).toMatchObject({ id: workspace.id });
    expect(busy(workspace)).toBe(false);
  });

  it('refuses a create-to-trash-to-restore race before clone admission and preserves recovered bytes', async () => {
    const created = deferred();
    const returnCreation = deferred();
    onCreated = async workspace => {
      await writeFile(path.join(workspace.path, 'recovered.txt'), 'Original recoverable content\n');
      created.release();
      await returnCreation.promise;
    };
    const imported = startImport();
    await created.promise;
    const workspace = published[0];
    const deleted = await app.ctx.workspaces.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    expect(deleted.mode).toBe('trash');
    if (deleted.mode !== 'trash') throw new Error('The ordinary fixture must enter workspace trash.');
    await app.ctx.workspaces.restoreWorkspaceTrash(deleted.trash.id);
    await app.ctx.workspaces.writeFile(workspace.id, 'recovered.txt', 'User restored and edited this workspace\n');
    const remove = vi.spyOn(app.ctx.workspaces, 'remove');
    returnCreation.release();
    const response = await imported;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'GITHUB_IMPORT_CHANGED' });
    expect(fixture.clones).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    expect(await readFile(path.join(workspace.path, 'recovered.txt'), 'utf8')).toBe('User restored and edited this workspace\n');
    expect(await app.ctx.workspaces.get(workspace.id)).toMatchObject({ id: workspace.id, path: workspace.path });
    expect(busy(workspace)).toBe(false);
  });

  it('does not delete a replacement directory or archive its registration after the clone has ended', async () => {
    const retained = path.join(directory, 'retained-import');
    vi.spyOn(app.ctx.workspaces, 'completeGithubImport').mockImplementation(async id => {
      const workspace = await app.ctx.workspaces.get(id);
      await rename(workspace.path, retained);
      await mkdir(workspace.path);
      await writeFile(path.join(workspace.path, 'precious.txt'), 'Replacement directory content\n');
      throw new HttpError(503, 'Fixture completion rejected.', 'FIXTURE_COMPLETION_FAILED');
    });
    const remove = vi.spyOn(app.ctx.workspaces, 'remove');
    const imported = startImport();
    const workspace = await waitForClone();
    await allowClone();
    const response = await imported;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'GITHUB_IMPORT_CHANGED' });
    expect(await readFile(path.join(workspace.path, 'precious.txt'), 'utf8')).toBe('Replacement directory content\n');
    expect(await readFile(path.join(retained, 'README.md'), 'utf8')).toBe('Real imported repository content\n');
    expect(remove).not.toHaveBeenCalled();
    expect(await app.ctx.workspaces.get(workspace.id)).toMatchObject({ id: workspace.id });
    expect(busy(workspace)).toBe(false);
  });
});
