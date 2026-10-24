import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { access, lstat, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { GithubImportStage, githubImportRecovery, initializeGithubImports } from '../server/github-import-staging';
import { JsonStore, SecretStore } from '../server/store';
import { PinnedDirectory, removeTree } from '../server/workspace-trash/filesystem';
import { WorkspaceService } from '../server/workspaces';

const execFile = promisify(execFileCallback);
const project = fileURLToPath(new URL('..', import.meta.url));
const prefix = 'github-import-stage-';
let directory: string;
let ctx: AppContext;
let stages: GithubImportStage[];
let releaseAllocation: (() => void) | undefined;
const gitEnvironment = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, HOME: directory,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' });

async function context(dataDir: string): Promise<AppContext> {
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, WORKSPACE_PASSWORD: 'staging-fixture-password',
    SESSION_SECRET: 'staging-fixture-session-secret-over-32-characters', ENCRYPTION_KEY: 'staging-fixture-encryption-key-over-32-characters' });
  const store = new JsonStore(config.stateDir);
  const workspaces = new WorkspaceService(config, store);
  await workspaces.initialize();
  return { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter() } as AppContext;
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'github-staging-test-'));
  ctx = await context(path.join(directory, 'data'));
  stages = [];
  releaseAllocation = undefined;
});

afterEach(async () => {
  releaseAllocation?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.allSettled(stages.map(stage => stage.finish(false)));
  // The restart fixture waits for native Git to exit before killing its Node
  // owner, so these exact, recorded fixture inodes are safe to remove afterward.
  const allowedParent = path.join(await realpath('/tmp'), `codex-github-imports-${process.getuid?.() ?? 0}`);
  for (const file of await readdir(ctx.config.stateDir)) {
    if (!file.startsWith(prefix) || !file.endsWith('.json') || (await lstat(path.join(ctx.config.stateDir, file))).isSymbolicLink()) continue;
    try {
      const record = JSON.parse(await readFile(path.join(ctx.config.stateDir, file), 'utf8'));
      if (record?.parent === allowedParent && file === `${prefix}${record.id}.json` && /^[a-f0-9-]{36}$/.test(record.id)) {
        await removeTree(path.join(record.parent, record.id), record.native);
      }
    } catch { /* Invalid-record fixtures have no staging directory to remove. */ }
  }
  await ctx.store.flush();
  await rm(directory, { recursive: true, force: true });
});

describe('private GitHub import staging and durable recovery', () => {
  it('reserves all eight import slots before asynchronous allocation and refuses a ninth without allocating', async () => {
    const workspace = await ctx.workspaces.create({ name: 'Allocation fixture' });
    await initializeGithubImports(ctx);
    const base = await realpath(tmpdir());
    let arrivals = 0;
    const gate = new Promise<void>(resolve => { releaseAllocation = resolve; });
    const open = PinnedDirectory.open.bind(PinnedDirectory);
    vi.spyOn(PinnedDirectory, 'open').mockImplementation(async (absolute, access) => {
      if (absolute === base) { arrivals++; await gate; }
      return open(absolute, access);
    });
    const allocations = Array.from({ length: 8 }, () => GithubImportStage.create(ctx, workspace.id, 'fixture/allocation').then(stage => { stages.push(stage); return stage; }));
    await expect.poll(() => arrivals, { timeout: 5000 }).toBe(8);
    await expect(GithubImportStage.create(ctx, workspace.id, 'fixture/ninth')).rejects.toMatchObject({ code: 'GITHUB_IMPORT_LIMIT' });
    expect(arrivals).toBe(8);
    expect((await readdir(ctx.config.stateDir)).filter(file => file.startsWith(prefix))).toEqual([]);
    releaseAllocation!();
    await Promise.all(allocations);
    expect(stages).toHaveLength(8);
  });

  it('rejects a TMPDIR under durable workspace storage before native Git can receive a destination', async () => {
    const workspace = await ctx.workspaces.create({ name: 'Temporary storage fixture' });
    vi.stubEnv('TMPDIR', ctx.config.dataDir);
    await expect(GithubImportStage.create(ctx, workspace.id, 'fixture/unsafe-tmp')).rejects.toMatchObject({ code: 'GITHUB_IMPORT_STAGING_UNSAFE' });
    expect((await readdir(ctx.config.stateDir)).filter(file => file.startsWith(prefix))).toEqual([]);
    expect(await ctx.workspaces.get(workspace.id)).toMatchObject({ id: workspace.id });
  });

  it('refuses a publication collision without replacing the existing user file', async () => {
    const workspace = await ctx.workspaces.create({ name: 'Publication fixture' });
    const stage = await GithubImportStage.create(ctx, workspace.id, 'fixture/collision');
    stages.push(stage);
    const source = path.join(directory, 'source');
    await execFile('git', ['-c', 'init.templateDir=', 'init', source], { env: gitEnvironment(), timeout: 5000 });
    await writeFile(path.join(source, 'README.md'), 'Native repository content\n');
    await execFile('git', ['-C', source, 'add', 'README.md'], { env: gitEnvironment(), timeout: 5000 });
    await execFile('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { env: gitEnvironment(), timeout: 5000 });
    await stage.clone(destination => execFile('git', ['clone', '--quiet', '--no-hardlinks', '--', source, destination], { env: gitEnvironment(), timeout: 5000 }).then(() => undefined));
    await ctx.workspaces.writeFile(workspace.id, 'README.md', 'User content wins\n');
    const root = await lstat(workspace.path);
    await expect(stage.publish(workspace.path, { dev: root.dev, ino: root.ino })).rejects.toMatchObject({ code: 'WORKSPACE_RESTORE_CONFLICT' });
    expect(await readFile(path.join(workspace.path, 'README.md'), 'utf8')).toBe('User content wins\n');
    expect((await ctx.workspaces.get(workspace.id)).source).toBeUndefined();
  });

  it.each([true, false])('recovers after a real Node exit without native replay (durable clone-exit proof=%s)', async confirmed => {
    const source = path.join(directory, 'restart-source');
    const environment = gitEnvironment();
    await execFile('git', ['-c', 'init.templateDir=', 'init', source], { env: environment, timeout: 5000 });
    await writeFile(path.join(source, 'README.md'), 'Actual restart fixture bytes\n');
    await execFile('git', ['-C', source, 'add', 'README.md'], { env: environment, timeout: 5000 });
    await execFile('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { env: environment, timeout: 5000 });
    const worker = path.join(directory, 'prepare-stage.mts');
    await writeFile(worker, `
      import { execFile as runFile } from 'node:child_process';
      import { promisify } from 'node:util';
      import { EventEmitter } from 'node:events';
      import { readdir } from 'node:fs/promises';
      import { loadConfig } from ${JSON.stringify(path.join(project, 'server/config.ts'))};
      import { JsonStore, SecretStore } from ${JSON.stringify(path.join(project, 'server/store.ts'))};
      import { WorkspaceService } from ${JSON.stringify(path.join(project, 'server/workspaces.ts'))};
      import { GithubImportStage } from ${JSON.stringify(path.join(project, 'server/github-import-staging.ts'))};
      const [dataDir, source, confirmed] = process.argv.slice(2);
      const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, WORKSPACE_PASSWORD: 'staging-fixture-password', SESSION_SECRET: 'staging-fixture-session-secret-over-32-characters', ENCRYPTION_KEY: 'staging-fixture-encryption-key-over-32-characters' });
      const store = new JsonStore(config.stateDir);
      const workspaces = new WorkspaceService(config, store); await workspaces.initialize();
      const ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter() };
      const workspace = await workspaces.create({ name: 'Interrupted GitHub fixture' });
      await workspaces.writeFile(workspace.id, 'keep.txt', 'User workspace remains unchanged\\n');
      const stage = await GithubImportStage.create(ctx, workspace.id, 'fixture/restart');
      const exit = async () => {
        await store.flush();
        const file = (await readdir(config.stateDir)).find(name => name.startsWith('github-import-stage-') && name.endsWith('.json'));
        await new Promise(resolve => process.stdout.write(JSON.stringify({ workspaceId: workspace.id, file }), resolve));
        process.exit(0);
      };
      await stage.clone(async destination => {
        await promisify(runFile)('git', ['clone', '--quiet', '--no-hardlinks', '--', source, destination], { timeout: 5000 });
        if (confirmed === 'false') await exit();
      });
      await exit();
    `);
    const child = await execFile(process.execPath, ['--import', path.join(project, 'node_modules/tsx/dist/loader.mjs'), worker, ctx.config.dataDir, source, String(confirmed)], {
      cwd: project, timeout: 15_000, maxBuffer: 16 * 1024,
      env: { ...environment, NODE_OPTIONS: '--v8-pool-size=1', UV_THREADPOOL_SIZE: '1', GOMAXPROCS: '2' },
    });
    const result = JSON.parse(child.stdout);
    const record = JSON.parse(await readFile(path.join(ctx.config.stateDir, result.file), 'utf8'));
    const staged = path.join(record.parent, record.id);
    expect(record.cloneExited).toBe(confirmed);
    expect(await readFile(path.join(staged, 'repository', 'README.md'), 'utf8')).toBe('Actual restart fixture bytes\n');
    const recoveredContext = await context(ctx.config.dataDir);
    const recovered = await initializeGithubImports(recoveredContext);
    expect(recovered).toEqual([expect.objectContaining({ workspaceId: result.workspaceId, workspaceName: 'Interrupted GitHub fixture', stageId: record.id })]);
    if (confirmed) await expect(access(staged)).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await readFile(path.join(staged, 'repository', 'README.md'), 'utf8')).toBe('Actual restart fixture bytes\n');
    expect(await readFile(path.join((await recoveredContext.workspaces.get(result.workspaceId)).path, 'keep.txt'), 'utf8')).toBe('User workspace remains unchanged\n');
    expect(JSON.stringify(recovered)).not.toContain(record.parent);
    await recoveredContext.store.flush();
  });

  it('bounds corrupt and symlinked recovery records without blocking ordinary workspace access', async () => {
    const workspace = await ctx.workspaces.create({ name: 'Unaffected workspace' });
    const secretFixture = path.join(directory, 'private-fixture.txt');
    await writeFile(secretFixture, 'private-fixture-marker');
    await symlink(secretFixture, path.join(ctx.config.stateDir, `${prefix}${randomUUID()}.json`));
    await writeFile(path.join(ctx.config.stateDir, `${prefix}${randomUUID()}.json`), 'x'.repeat(16 * 1024 + 1));
    const recovered = await githubImportRecovery(ctx);
    expect(recovered).toHaveLength(2);
    expect(recovered.every(item => item.workspaceName === 'GitHub import')).toBe(true);
    expect(JSON.stringify(recovered)).not.toContain('private-fixture-marker');
    expect(JSON.stringify(recovered)).not.toContain(directory);
    await ctx.workspaces.writeFile(workspace.id, 'still-usable.txt', 'ordinary files work');
    expect(await readFile(path.join(workspace.path, 'still-usable.txt'), 'utf8')).toBe('ordinary files work');
  });
});
