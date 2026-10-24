import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FileMetadataManager, FILE_METADATA_KEY, type FileMetadataOptions } from '../server/file-metadata';
import { JsonStore } from '../server/store';

interface SavedEntry {
  root: 'workspaces' | 'home'; path: string; kind: string; mode: number; mtimeMs: number; size: number; target?: string;
  restoreMissing?: boolean;
}
interface SavedManifest { version: number; revision: number; capturedAt: string; entries: SavedEntry[]; workspaceFileRoots?: string[] }
const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

class ObservedStore extends JsonStore {
  writes = 0;
  failNext = false;
  blockNext?: { entered: () => void; release: Promise<void> };
  override async write<T>(key: string, value: T): Promise<void> {
    if (key === FILE_METADATA_KEY) {
      this.writes++;
      if (this.failNext) { this.failNext = false; throw new Error('simulated storage failure'); }
      if (this.blockNext) {
        const gate = this.blockNext;
        this.blockNext = undefined;
        gate.entered();
        await gate.release;
      }
    }
    await super.write(key, value);
  }
}

let temporary: string;
let config: { workspacesDir: string; homeDir: string };
let store: ObservedStore;
let events: EventEmitter;
let managers: FileMetadataManager[];

const workspace = (relative = '') => path.join(config.workspacesDir, relative);
const home = (relative = '') => path.join(config.homeDir, relative);
const mode = async (filename: string) => (await fs.lstat(filename)).mode & 0o7777;
const exists = async (filename: string) => fs.lstat(filename).then(() => true, () => false);
const snapshot = async () => (await store.read<SavedManifest | null>(FILE_METADATA_KEY, null))!;

function manager(options: FileMetadataOptions = {}): FileMetadataManager {
  const instance = new FileMetadataManager(config, store, events, options);
  managers.push(instance);
  return instance;
}

async function file(filename: string, content = 'ordinary public file contents', permissions = 0o644): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, content);
  await fs.chmod(filename, permissions);
}

async function link(filename: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.symlink(target, filename);
}

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-file-metadata-'));
  // /tmp may carry setgid in CI; keep default-mode fixtures independent of it.
  await fs.chmod(temporary, 0o700);
  config = { workspacesDir: path.join(temporary, 'workspaces'), homeDir: path.join(temporary, 'home') };
  await Promise.all([fs.mkdir(config.workspacesDir), fs.mkdir(config.homeDir)]);
  store = new ObservedStore(path.join(temporary, 'state'));
  events = new EventEmitter();
  managers = [];
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const instance of managers) await instance.close().catch(() => undefined);
  await fs.rm(temporary, { recursive: true, force: true });
});

describe('native bucket POSIX metadata', () => {
  it('stores every observed mode in a readable manifest including home, Git, dependency links, empty folders, and trash', async () => {
    await file(workspace('project/plain.ts'));
    await file(workspace('project/bin/run.sh'), '#!/bin/sh\necho works\n', 0o755);
    await file(workspace('project/.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n', 0o755);
    await link(workspace('project/node_modules/.bin/tool'), '../tool/cli.js');
    await link(workspace('.trash/removed-link'), '../project/bin/run.sh');
    await link(home('.local/bin/tool'), '../../../workspaces/project/bin/run.sh');
    await fs.mkdir(workspace('project/empty'));
    await fs.mkdir(home('.private'), { mode: 0o700 });
    const instance = manager();
    await instance.initialize();

    const saved = await snapshot();
    expect(saved.version).toBe(1);
    expect(Number.isFinite(Date.parse(saved.capturedAt))).toBe(true);
    expect(saved.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ root: 'workspaces', path: 'project/plain.ts', kind: 'file', mode: 0o644 }),
      expect.objectContaining({ root: 'workspaces', path: 'project', kind: 'directory', mode: 0o755, restoreMissing: false }),
      expect.objectContaining({ root: 'workspaces', path: 'project/bin/run.sh', kind: 'file', mode: 0o755 }),
      expect.objectContaining({ root: 'workspaces', path: 'project/.git/hooks/pre-commit', kind: 'file', mode: 0o755 }),
      expect.objectContaining({ root: 'workspaces', path: 'project/node_modules/.bin/tool', kind: 'symlink', target: '../tool/cli.js' }),
      expect.objectContaining({ root: 'workspaces', path: '.trash/removed-link', kind: 'symlink' }),
      expect.objectContaining({ root: 'home', path: '.local/bin/tool', kind: 'symlink' }),
      expect.objectContaining({ root: 'home', path: '.private', kind: 'directory', mode: 0o700 }),
      expect.objectContaining({ root: 'workspaces', path: 'project/empty', kind: 'directory', restoreMissing: true }),
    ]));
    const onDisk = await fs.readFile(path.join(store.directory, `${FILE_METADATA_KEY}.json`), 'utf8');
    expect(JSON.parse(onDisk)).toEqual(saved);
    expect(onDisk).toContain('project/node_modules/.bin/tool');
    expect(onDisk).not.toContain('ordinary public file contents');
    expect(await fs.readFile(workspace('project/plain.ts'), 'utf8')).toBe('ordinary public file contents');
  });

  it('reconstructs links and empty folders and restores executable and directory modes after a simulated remount', async () => {
    await file(workspace('project/bin/run.sh'), '#!/bin/sh\necho durable\n', 0o751);
    await link(workspace('project/node_modules/.bin/tool'), '../../bin/run.sh');
    await link(workspace('.trash/old-link'), '../project/bin/run.sh');
    await link(home('.local/bin/tool'), '../../../workspaces/project/bin/run.sh');
    await fs.mkdir(workspace('project/empty'));
    await fs.mkdir(home('.private'), { mode: 0o700 });
    const first = manager();
    await first.initialize();
    await first.close();

    // Native object storage keeps file contents, but can lose links, modes, and empty directories.
    await fs.rm(workspace('project/node_modules'), { recursive: true });
    await fs.rm(workspace('.trash'), { recursive: true });
    await fs.rm(home('.local'), { recursive: true });
    await fs.rmdir(workspace('project/empty'));
    await fs.chmod(workspace('project/bin/run.sh'), 0o644);
    await fs.chmod(home('.private'), 0o755);
    const restored = manager();
    await restored.initialize();

    expect(await fs.readlink(workspace('project/node_modules/.bin/tool'))).toBe('../../bin/run.sh');
    expect(await fs.readlink(workspace('.trash/old-link'))).toBe('../project/bin/run.sh');
    expect(await fs.readlink(home('.local/bin/tool'))).toBe('../../../workspaces/project/bin/run.sh');
    expect((await fs.lstat(workspace('project/empty'))).isDirectory()).toBe(true);
    expect(await mode(workspace('project/bin/run.sh'))).toBe(0o751);
    expect(await mode(home('.private'))).toBe(0o700);
    expect(await fs.readFile(workspace('project/bin/run.sh'), 'utf8')).toBe('#!/bin/sh\necho durable\n');
  });

  it('does not recreate vanished file contents or infer missing directories from a missing executable', async () => {
    await file(workspace('deleted-project/run.sh'), 'original contents', 0o755);
    const first = manager();
    await first.initialize();
    await first.close();
    await fs.rm(workspace('deleted-project'), { recursive: true });
    const restored = manager();
    await restored.initialize();
    expect(await exists(workspace('deleted-project'))).toBe(false);
    expect((await snapshot()).entries.some(entry => entry.path.startsWith('deleted-project'))).toBe(false);
    expect(restored.status().issues).toContainEqual({ root: 'workspaces', path: 'deleted-project/run.sh', reason: 'missing-file' });
  });

  it('does not rebuild a misleading directory and link skeleton when default-mode workspace files disappear', async () => {
    await file(workspace('removed-project/main.ts'), 'the real source bytes');
    await fs.mkdir(workspace('removed-project/empty'));
    await link(workspace('removed-project/current'), 'main.ts');
    const first = manager();
    await first.initialize();
    await first.close();
    expect((await snapshot()).workspaceFileRoots).toContain('removed-project');
    expect((await snapshot()).entries).toContainEqual(expect.objectContaining({ path: 'removed-project/main.ts', kind: 'file', mode: 0o644 }));

    await fs.rm(workspace('removed-project'), { recursive: true });
    const restarted = manager();
    await restarted.initialize();

    expect(await exists(workspace('removed-project'))).toBe(false);
    expect(restarted.status().issues).toContainEqual({ root: 'workspaces', path: 'removed-project/current', reason: 'missing-file' });
    expect((await snapshot()).entries.some(entry => entry.path.startsWith('removed-project/'))).toBe(false);
  });

  it('honors a durable workspace deletion before restoring old empty-directory and symlink metadata', async () => {
    await fs.mkdir(workspace('removed-project/empty'), { recursive: true });
    await link(workspace('removed-project/link'), 'empty');
    await fs.mkdir(workspace('retained-project/empty'), { recursive: true });
    const first = manager();
    await first.initialize();
    await first.close();
    await fs.rm(workspace('removed-project'), { recursive: true });
    await fs.rm(workspace('retained-project'), { recursive: true });

    await manager({ workspaceRestoreExclusions: async () => ['removed-project'] }).initialize();

    expect(await exists(workspace('removed-project'))).toBe(false);
    expect((await fs.lstat(workspace('retained-project/empty'))).isDirectory()).toBe(true);
    expect((await snapshot()).entries.some(entry => entry.path.startsWith('removed-project/'))).toBe(false);
  });

  it('keeps a purged trash entry absent while restoring metadata for another entry', async () => {
    await file(workspace('.workspace-trash/retained/content/real.txt'), 'retained file');
    await fs.mkdir(workspace('.workspace-trash/retained/content/empty'));
    await fs.mkdir(workspace('.workspace-trash/purged/content/empty'), { recursive: true });
    await link(workspace('.workspace-trash/purged/content/link'), 'empty');
    const first = manager();
    await first.initialize();
    await first.close();
    await fs.rm(workspace('.workspace-trash/purged'), { recursive: true });
    await fs.rmdir(workspace('.workspace-trash/retained/content/empty'));

    await manager({ workspaceRestoreExclusions: async () => ['.workspace-trash/purged'] }).initialize();

    expect(await exists(workspace('.workspace-trash/purged'))).toBe(false);
    expect((await fs.lstat(workspace('.workspace-trash/retained/content/empty'))).isDirectory()).toBe(true);
    expect(await fs.readFile(workspace('.workspace-trash/retained/content/real.txt'), 'utf8')).toBe('retained file');
  });

  it('rejects unsafe restore exclusions before changing any metadata path', async () => {
    await fs.mkdir(workspace('project/empty'), { recursive: true });
    const first = manager();
    await first.initialize();
    await first.close();
    await fs.rm(workspace('project'), { recursive: true });

    await expect(manager({ workspaceRestoreExclusions: async () => ['../outside'] }).initialize()).rejects.toThrow('invalid');
    expect(await exists(workspace('project'))).toBe(false);
  });

  it('restores persisted metadata in a separate Node process', async () => {
    await file(workspace('project/run.sh'), 'persistent ordinary script', 0o755);
    await link(workspace('project/link'), 'run.sh');
    const source = String.raw`
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import { FileMetadataManager } from './server/file-metadata.ts';
      import { JsonStore } from './server/store.ts';
      const root = process.env.METADATA_TEST_ROOT;
      const config = { workspacesDir: path.join(root, 'workspaces'), homeDir: path.join(root, 'home') };
      const manager = new FileMetadataManager(config, new JsonStore(path.join(root, 'state')));
      await manager.initialize();
      await manager.close();
      console.log(JSON.stringify({
        mode: (await fs.lstat(path.join(config.workspacesDir, 'project/run.sh'))).mode & 0o7777,
        target: await fs.readlink(path.join(config.workspacesDir, 'project/link')),
      }));
    `;
    const options = { cwd: projectRoot, env: { PATH: process.env.PATH, METADATA_TEST_ROOT: temporary }, timeout: 15_000 };
    await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], options);
    await fs.unlink(workspace('project/link'));
    await fs.chmod(workspace('project/run.sh'), 0o644);
    const { stdout } = await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], options);
    expect(JSON.parse(stdout.trim())).toEqual({ mode: 0o755, target: 'run.sh' });
    expect(await fs.readFile(workspace('project/run.sh'), 'utf8')).toBe('persistent ordinary script');
  }, 30_000);

  it('restores captured default modes in a fresh process without normalizing unlisted paths or following links', async () => {
    const files = [
      { path: 'workspaces/project/plain.ts', contents: 'export const durable = "café";\n', mode: 0o644 },
      { path: 'workspaces/project/.git/index', contents: 'saved binary index\0\u00ff\n', mode: 0o644 },
      { path: 'workspaces/project/bin/run.sh', contents: '#!/bin/sh\nexit 0\n', mode: 0o755 },
      { path: 'home/.config/settings', contents: 'ordinary home configuration\n', mode: 0o644 },
      { path: 'home/.config/owner-only', contents: 'owner-only fixture data\n', mode: 0o600 },
    ];
    for (const entry of files) await file(path.join(temporary, entry.path), entry.contents, entry.mode);
    const directories = ['workspaces/project', 'workspaces/project/.git', 'workspaces/project/bin', 'home/.config'];
    for (const relative of directories) await fs.chmod(path.join(temporary, relative), 0o755);
    await fs.mkdir(workspace('project/empty'), { mode: 0o700 });
    await link(workspace('project/link'), 'plain.ts');
    const linkBefore = await fs.lstat(workspace('project/link'));
    await file(workspace('project/vanished/leaf.txt'), 'missing bytes must not become a directory skeleton');
    await file(home('vanished/leaf.txt'), 'missing home bytes must not be recreated');
    await file(workspace('project/excluded/leaf.txt'), 'excluded generation stays unchanged');
    const first = manager();
    await first.initialize();
    await first.close();

    // Only these owned fixture paths model the native fresh-mount defaults.
    for (const entry of files) await fs.chmod(path.join(temporary, entry.path), 0o666);
    for (const relative of directories) await fs.chmod(path.join(temporary, relative), 0o777);
    await fs.rmdir(workspace('project/empty'));
    await fs.rm(workspace('project/vanished'), { recursive: true });
    await fs.rm(home('vanished'), { recursive: true });
    await fs.chmod(workspace('project/excluded'), 0o777);
    await fs.chmod(workspace('project/excluded/leaf.txt'), 0o666);
    await file(workspace('project/unlisted/new.txt'), 'new owner bytes', 0o666);
    await fs.chmod(workspace('project/unlisted'), 0o777);
    await file(path.join(temporary, 'outside.txt'), 'outside target bytes', 0o660);
    await link(workspace('project/unlisted-link'), path.join(temporary, 'outside.txt'));
    const unlistedLinkBefore = await fs.lstat(workspace('project/unlisted-link'));
    const expectedFiles = files.map(entry => ({ path: entry.path, mode: entry.mode,
      sha256: createHash('sha256').update(entry.contents).digest('hex') }));
    const source = String.raw`
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import { createHash } from 'node:crypto';
      import { FileMetadataManager } from './server/file-metadata.ts';
      import { JsonStore } from './server/store.ts';
      const root = process.env.METADATA_TEST_ROOT;
      const paths = JSON.parse(process.env.METADATA_TEST_PATHS);
      const at = relative => path.join(root, relative);
      const mode = async relative => (await fs.lstat(at(relative))).mode & 0o7777;
      const missing = async relative => fs.lstat(at(relative)).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
      const metadata = new FileMetadataManager({ workspacesDir: at('workspaces'), homeDir: at('home') },
        new JsonStore(at('state')), undefined, { workspaceRestoreExclusions: async () => ['project/excluded'] });
      await metadata.initialize();
      await metadata.close();
      console.log(JSON.stringify({ pid: process.pid,
        files: await Promise.all(paths.files.map(async relative => ({ path: relative, mode: await mode(relative),
          sha256: createHash('sha256').update(await fs.readFile(at(relative))).digest('hex') }))),
        directories: await Promise.all(paths.directories.map(mode)), empty: await mode('workspaces/project/empty'),
        missing: await Promise.all(['workspaces/project/vanished', 'home/vanished'].map(missing)),
        untouched: await Promise.all(['workspaces/project/unlisted', 'workspaces/project/unlisted/new.txt',
          'workspaces/project/excluded', 'workspaces/project/excluded/leaf.txt', 'outside.txt'].map(mode)),
        newBytes: await fs.readFile(at('workspaces/project/unlisted/new.txt'), 'utf8'),
        outsideBytes: await fs.readFile(at('outside.txt'), 'utf8'),
        links: await Promise.all(['workspaces/project/link', 'workspaces/project/unlisted-link'].map(async relative => ({
          target: await fs.readlink(at(relative)), ino: (await fs.lstat(at(relative))).ino,
        }))),
      }));
    `;
    const { stdout } = await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
      cwd: projectRoot, timeout: 15_000,
      env: { PATH: process.env.PATH, METADATA_TEST_ROOT: temporary,
        METADATA_TEST_PATHS: JSON.stringify({ files: files.map(entry => entry.path), directories }) },
    });
    const result = JSON.parse(stdout.trim());
    expect(result.pid).not.toBe(process.pid);
    expect(result.files).toEqual(expectedFiles);
    expect(result.directories).toEqual(directories.map(() => 0o755));
    expect(result.empty).toBe(0o700); expect(result.missing).toEqual([true, true]);
    expect(result.untouched).toEqual([0o777, 0o666, 0o777, 0o666, 0o660]);
    expect(result.newBytes).toBe('new owner bytes'); expect(result.outsideBytes).toBe('outside target bytes');
    expect(result.links).toEqual([
      { target: 'plain.ts', ino: linkBefore.ino },
      { target: path.join(temporary, 'outside.txt'), ino: unlistedLinkBefore.ino },
    ]);
  }, 30_000);

  it('accepts legacy sparse directory records without inferring modes for their unlisted files or folders', async () => {
    await file(workspace('project/plain.ts'), 'legacy unlisted bytes');
    await fs.mkdir(workspace('project/legacy-empty'), { mode: 0o700 });
    await link(workspace('project/legacy-link'), 'plain.ts');
    const first = manager();
    await first.initialize();
    await first.close();
    const saved = await snapshot();
    saved.entries = saved.entries.filter(entry => entry.kind !== 'file' || entry.mode !== 0o644)
      .filter(entry => entry.kind !== 'directory' || !entry.path || entry.restoreMissing || entry.mode !== 0o755)
      .map(({ restoreMissing: _restoreMissing, ...entry }) => entry);
    await store.write(FILE_METADATA_KEY, saved);
    await fs.chmod(workspace('project'), 0o777);
    await fs.chmod(workspace('project/plain.ts'), 0o666);
    await fs.rmdir(workspace('project/legacy-empty'));
    await fs.unlink(workspace('project/legacy-link'));
    await file(workspace('new-unlisted/new.txt'), 'new tree bytes', 0o666);
    await fs.chmod(workspace('new-unlisted'), 0o777);

    await manager().initialize();

    expect(await mode(workspace('project'))).toBe(0o777);
    expect(await mode(workspace('project/plain.ts'))).toBe(0o666);
    expect(await fs.readFile(workspace('project/plain.ts'), 'utf8')).toBe('legacy unlisted bytes');
    expect(await mode(workspace('new-unlisted'))).toBe(0o777);
    expect(await mode(workspace('new-unlisted/new.txt'))).toBe(0o666);
    expect(await mode(workspace('project/legacy-empty'))).toBe(0o700);
    expect(await fs.readlink(workspace('project/legacy-link'))).toBe('plain.ts');
  });

  it('preserves special POSIX permission bits on directories', async () => {
    await fs.mkdir(workspace('shared'));
    await fs.chmod(workspace('shared'), 0o2750);
    const first = manager();
    await first.initialize();
    await first.close();
    await fs.chmod(workspace('shared'), 0o755);
    await manager().initialize();
    expect(await mode(workspace('shared'))).toBe(0o2750);
  });

  it('captures deletions and mode resets so they stay deleted during this boot and the next one', async () => {
    await file(workspace('project/run.sh'), 'public script', 0o755);
    await link(workspace('project/link'), 'run.sh');
    await fs.mkdir(workspace('project/empty'));
    const first = manager();
    await first.initialize();
    await fs.unlink(workspace('project/link'));
    await fs.rmdir(workspace('project/empty'));
    await fs.chmod(workspace('project/run.sh'), 0o644);
    await first.capture();
    expect(await exists(workspace('project/link'))).toBe(false);
    expect((await snapshot()).entries.some(entry => ['project/link', 'project/empty'].includes(entry.path))).toBe(false);
    expect((await snapshot()).entries).toContainEqual(expect.objectContaining({ path: 'project/run.sh', kind: 'file', mode: 0o644 }));
    await first.close();
    await fs.chmod(workspace('project/run.sh'), 0o666);
    const restarted = manager();
    await restarted.initialize();
    expect(await exists(workspace('project/link'))).toBe(false);
    expect(await exists(workspace('project/empty'))).toBe(false);
    expect(await mode(workspace('project/run.sh'))).toBe(0o644);
  });

  it('captures renamed paths and changed link targets instead of restoring the previous names', async () => {
    await file(workspace('before/run.sh'), 'public script', 0o755);
    await link(workspace('before/link'), 'run.sh');
    const first = manager();
    await first.initialize();
    await fs.rename(workspace('before'), workspace('after'));
    await fs.unlink(workspace('after/link'));
    await fs.symlink('../elsewhere.sh', workspace('after/link'));
    await first.capture();
    await first.close();
    await fs.unlink(workspace('after/link'));
    await fs.chmod(workspace('after/run.sh'), 0o644);
    await manager().initialize();
    expect(await exists(workspace('before'))).toBe(false);
    expect(await fs.readlink(workspace('after/link'))).toBe('../elsewhere.sh');
    expect(await mode(workspace('after/run.sh'))).toBe(0o755);
    expect((await snapshot()).entries.some(entry => entry.path.startsWith('before/'))).toBe(false);
  });

  it('keeps an existing regular file when a previously saved symlink conflicts with it', async () => {
    await link(workspace('project/link'), 'target.ts');
    const first = manager();
    await first.initialize();
    await first.close();
    await fs.unlink(workspace('project/link'));
    await file(workspace('project/link'), 'new owner edits must survive');
    const restarted = manager();
    await restarted.initialize();
    expect(await fs.readFile(workspace('project/link'), 'utf8')).toBe('new owner edits must survive');
    expect((await fs.lstat(workspace('project/link'))).isFile()).toBe(true);
    expect(restarted.status().issues).toContainEqual({ root: 'workspaces', path: 'project/link', reason: 'existing-file' });
    expect((await snapshot()).entries.some(entry => entry.path === 'project/link' && entry.kind === 'symlink')).toBe(false);
  });

  it('adopts an existing changed symlink rather than overwriting its current target', async () => {
    await link(workspace('project/link'), 'before.ts');
    const first = manager();
    await first.initialize();
    await first.close();
    await fs.unlink(workspace('project/link'));
    await fs.symlink('after.ts', workspace('project/link'));
    const restarted = manager();
    await restarted.initialize();
    expect(await fs.readlink(workspace('project/link'))).toBe('after.ts');
    expect((await snapshot()).entries.find(entry => entry.path === 'project/link')?.target).toBe('after.ts');
    expect(restarted.status().issues).toContainEqual({ root: 'workspaces', path: 'project/link', reason: 'different-symlink' });
  });

  it('does not scan symlink targets, including external targets and cyclic links', async () => {
    const outside = path.join(temporary, 'outside');
    await file(path.join(outside, 'private-marker.sh'), 'this file must not be scanned', 0o755);
    await link(workspace('project/external'), outside);
    await link(workspace('project/a'), 'b');
    await link(workspace('project/b'), 'a');
    const first = manager();
    await first.initialize();
    const saved = await snapshot();
    expect(saved.entries.some(entry => entry.path.includes('private-marker'))).toBe(false);
    expect(saved.entries.find(entry => entry.path === 'project/external')?.target).toBe(outside);
    await first.close();
    await Promise.all(['external', 'a', 'b'].map(name => fs.unlink(workspace(`project/${name}`))));
    await manager().initialize();
    expect(await fs.readlink(workspace('project/external'))).toBe(outside);
    expect(await fs.readlink(workspace('project/a'))).toBe('b');
    expect(await fs.readlink(workspace('project/b'))).toBe('a');
  });

  it('never traverses a symlink ancestor while restoring nested modes or missing links', async () => {
    await file(workspace('project/nested/run.sh'), 'inside', 0o755);
    await link(workspace('project/nested/link'), 'run.sh');
    const first = manager();
    await first.initialize();
    await first.close();
    const outside = path.join(temporary, 'outside');
    await file(path.join(outside, 'run.sh'), 'outside owner contents', 0o644);
    await fs.rm(workspace('project/nested'), { recursive: true });
    await fs.symlink(outside, workspace('project/nested'));
    const restarted = manager();
    await restarted.initialize();
    expect(await mode(path.join(outside, 'run.sh'))).toBe(0o644);
    expect(await fs.readFile(path.join(outside, 'run.sh'), 'utf8')).toBe('outside owner contents');
    expect(await exists(path.join(outside, 'link'))).toBe(false);
    expect(restarted.status().issues.some(issue => issue.reason === 'unsafe-parent')).toBe(true);
  });

  it('does not chmod an external file when the saved regular file is now a symlink', async () => {
    await file(workspace('project/run.sh'), 'inside', 0o755);
    const first = manager();
    await first.initialize();
    await first.close();
    const outside = path.join(temporary, 'outside.sh');
    await file(outside, 'outside', 0o644);
    await fs.unlink(workspace('project/run.sh'));
    await fs.symlink(outside, workspace('project/run.sh'));
    await manager().initialize();
    expect(await mode(outside)).toBe(0o644);
    expect(await fs.readlink(workspace('project/run.sh'))).toBe(outside);
  });

  it('rejects a symbolic-link root and preserves the previous manifest', async () => {
    await file(workspace('project/run.sh'), 'inside', 0o755);
    const first = manager();
    await first.initialize();
    await first.close();
    const before = await snapshot();
    const outside = path.join(temporary, 'outside');
    await fs.mkdir(outside);
    await fs.rm(config.workspacesDir, { recursive: true });
    await fs.symlink(outside, config.workspacesDir);
    await expect(manager().initialize()).rejects.toThrow('safe directory');
    expect(await snapshot()).toEqual(before);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it.each(['../outside', '/outside', 'project/../../outside', 'project//run.sh', 'project/./run.sh', 'project\\outside', 'C:/outside', 'project/bad\0name'])(
    'validates every manifest path before restoring anything: %j', async hostilePath => {
      await file(workspace('project/run.sh'), 'inside', 0o755);
      const first = manager();
      await first.initialize();
      await first.close();
      await fs.chmod(workspace('project/run.sh'), 0o644);
      const saved = await snapshot();
      saved.entries.push({ root: 'workspaces', path: hostilePath, kind: 'symlink', target: 'target', mode: 0o777, mtimeMs: 0, size: 6 });
      await store.write(FILE_METADATA_KEY, saved);
      await expect(manager().initialize()).rejects.toThrow('metadata is invalid');
      expect(await mode(workspace('project/run.sh'))).toBe(0o644);
      expect(await snapshot()).toEqual(saved);
    },
  );

  it('rejects manifests that claim descendants under a saved symlink', async () => {
    const first = manager();
    await first.initialize();
    await first.close();
    const saved = await snapshot();
    saved.entries.push(
      { root: 'workspaces', path: 'link', kind: 'symlink', mode: 0o777, mtimeMs: 0, size: 8, target: '/outside' },
      { root: 'workspaces', path: 'link/run.sh', kind: 'file', mode: 0o755, mtimeMs: 0, size: 0 },
    );
    await store.write(FILE_METADATA_KEY, saved);
    await expect(manager().initialize()).rejects.toThrow('metadata is invalid');
    expect(await exists(workspace('link'))).toBe(false);
  });

  it.each(['unknown-root', 'unsupported-version', 'duplicate-path', 'invalid-mode'])(
    'refuses an invalid manifest shape without replacing it: %s', async variation => {
      const first = manager();
      await first.initialize();
      await first.close();
      const saved = await snapshot();
      if (variation === 'unknown-root') (saved.entries[0] as { root: string }).root = 'outside';
      if (variation === 'unsupported-version') saved.version = 999;
      if (variation === 'duplicate-path') saved.entries.push({ ...saved.entries[0] });
      if (variation === 'invalid-mode') saved.entries[0].mode = 0o17777;
      await store.write(FILE_METADATA_KEY, saved);
      await expect(manager().initialize()).rejects.toThrow('metadata is invalid');
      expect(await snapshot()).toEqual(saved);
    },
  );

  it.each([
    ['directory', 'false'], ['file', false], ['symlink', true],
  ] as const)('rejects an invalid directory recreation flag on %s before changing any mode', async (kind, value) => {
    await file(workspace('project/plain.ts'));
    await link(workspace('project/link'), 'plain.ts');
    const first = manager();
    await first.initialize();
    await first.close();
    const saved = await snapshot();
    (saved.entries.find(entry => entry.kind === kind)! as { restoreMissing?: unknown }).restoreMissing = value;
    await store.write(FILE_METADATA_KEY, saved);
    await fs.chmod(workspace('project/plain.ts'), 0o666);

    await expect(manager().initialize()).rejects.toThrow('metadata is invalid');

    expect(await mode(workspace('project/plain.ts'))).toBe(0o666);
    expect(await snapshot()).toEqual(saved);
  });

  it('avoids bucket writes when metadata has not changed and versions changed stat metadata', async () => {
    await file(workspace('project/run.sh'), 'first', 0o755);
    const instance = manager();
    await instance.initialize();
    const before = await snapshot();
    const writes = store.writes;
    await instance.capture();
    await instance.capture();
    expect(store.writes).toBe(writes);
    expect(await snapshot()).toEqual(before);
    await fs.writeFile(workspace('project/run.sh'), 'new file version with different length');
    await instance.capture();
    const after = await snapshot();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.entries.find(entry => entry.path === 'project/run.sh')).toMatchObject({
      size: (await fs.stat(workspace('project/run.sh'))).size,
      mtimeMs: (await fs.stat(workspace('project/run.sh'))).mtimeMs,
    });
  });

  it('queues another capture when a workspace event arrives during a save', async () => {
    const instance = manager();
    await instance.initialize();
    instance.start();
    let entered!: () => void;
    let release!: () => void;
    const saving = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    store.blockNext = { entered, release: blocked };
    await link(workspace('project/first'), 'first.ts');
    const capture = instance.capture();
    await saving;
    await link(workspace('project/second'), 'second.ts');
    events.emit('workspace:changed', { workspaceId: 'project' });
    release();
    await capture;
    expect((await snapshot()).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'project/first', target: 'first.ts' }),
      expect.objectContaining({ path: 'project/second', target: 'second.ts' }),
    ]));
  });

  it('retains the previous snapshot after a failed save and recovers on retry', async () => {
    const onError = vi.fn();
    events.on('file-metadata:error', onError);
    const instance = manager();
    await instance.initialize();
    const before = await snapshot();
    await link(workspace('project/new-link'), 'target.ts');
    store.failNext = true;
    await expect(instance.capture()).rejects.toThrow('simulated storage failure');
    expect(await snapshot()).toEqual(before);
    expect(instance.status().error).not.toBeNull();
    expect(onError).toHaveBeenCalled();
    await instance.capture();
    expect((await snapshot()).entries.some(entry => entry.path === 'project/new-link')).toBe(true);
    expect(instance.status().error).toBeNull();
  });

  it('restores saved metadata before readiness while deferring a blocked initial refresh until start', async () => {
    await file(workspace('project/run.sh'), '#!/bin/sh\necho retained\n', 0o751);
    await fs.chmod(workspace('project'), 0o750);
    await link(workspace('project/current'), 'run.sh');
    await fs.mkdir(workspace('project/empty'), { mode: 0o710 });
    const first = manager();
    await first.initialize();
    await first.close();
    const manifestFile = path.join(store.directory, `${FILE_METADATA_KEY}.json`);
    const before = await fs.readFile(manifestFile);
    const writes = store.writes;
    await fs.chmod(workspace('project/run.sh'), 0o666);
    await fs.chmod(workspace('project'), 0o777);
    await fs.unlink(workspace('project/current'));
    await fs.rmdir(workspace('project/empty'));

    let blockNext = false, entered = false;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const originalReaddir = fs.readdir;
    const readdir = vi.spyOn(fs, 'readdir').mockImplementation((async (...args: Parameters<typeof fs.readdir>) => {
      if (blockNext) { blockNext = false; entered = true; await blocked; }
      return Reflect.apply(originalReaddir, fs, args);
    }) as typeof fs.readdir);
    const restarted = manager({ deferInitialCapture: true });
    try {
      await restarted.initialize();
      expect(readdir).not.toHaveBeenCalled();
      expect(restarted.status()).toMatchObject({ initialized: true, capturing: false, lastCapturedAt: null, error: null });
      expect(await mode(workspace('project/run.sh'))).toBe(0o751);
      expect(await mode(workspace('project'))).toBe(0o750);
      expect(await mode(workspace('project/empty'))).toBe(0o710);
      expect(await fs.readlink(workspace('project/current'))).toBe('run.sh');
      expect(await fs.readFile(workspace('project/run.sh'), 'utf8')).toBe('#!/bin/sh\necho retained\n');
      expect(await fs.readFile(manifestFile)).toEqual(before);
      expect(store.writes).toBe(writes);

      blockNext = true;
      restarted.start();
      await vi.waitFor(() => expect(entered).toBe(true));
      expect(restarted.status()).toMatchObject({ initialized: true, capturing: true, lastCapturedAt: null });
      expect(await fs.readFile(manifestFile)).toEqual(before);
    } finally { release(); readdir.mockRestore(); }
    await restarted.capture();
    expect(restarted.status().lastCapturedAt).not.toBeNull();
  });

  it('retains the complete snapshot after a deferred refresh times out and retries without restoring deleted links', async () => {
    await file(workspace('project/run.sh'), 'retained ordinary bytes', 0o751);
    await link(workspace('project/current'), 'run.sh');
    const first = manager();
    await first.initialize();
    await first.close();
    const before = await snapshot();
    const manifestFile = path.join(store.directory, `${FILE_METADATA_KEY}.json`);
    const beforeBytes = await fs.readFile(manifestFile);
    await fs.chmod(workspace('project/run.sh'), 0o666);
    const restarted = manager({ deferInitialCapture: true, scanTimeoutMs: 1_000 });
    await restarted.initialize();
    expect(await mode(workspace('project/run.sh'))).toBe(0o751);
    await fs.unlink(workspace('project/current'));
    const onError = vi.fn();
    events.on('file-metadata:error', onError);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const realNow = Date.now;
    let elapsed = 0, delayed = false;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + elapsed);
    const originalReaddir = fs.readdir;
    const readdir = vi.spyOn(fs, 'readdir').mockImplementation((async (...args: Parameters<typeof fs.readdir>) => {
      const children = await Reflect.apply(originalReaddir, fs, args);
      if (!delayed) { delayed = true; elapsed += 1_001; }
      return children;
    }) as typeof fs.readdir);
    try {
      restarted.start();
      await vi.waitFor(() => expect(restarted.status()).toMatchObject({
        initialized: true, capturing: false, revision: before.revision, lastCapturedAt: null, error: expect.any(String),
      }), { timeout: 3_000 });
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'FILE_METADATA_SCAN_TIMEOUT' }));
      expect(await fs.readFile(manifestFile)).toEqual(beforeBytes);
      await restarted.initialize();
      expect(await exists(workspace('project/current'))).toBe(false);
    } finally { clock.mockRestore(); readdir.mockRestore(); }

    await vi.advanceTimersByTimeAsync(20_000);
    await vi.waitFor(() => expect(restarted.status()).toMatchObject({ capturing: false, error: null, lastCapturedAt: expect.any(String) }));
    expect((await snapshot()).revision).toBeGreaterThan(before.revision);
    expect((await snapshot()).entries.some(entry => entry.path === 'project/current')).toBe(false);
    expect(await exists(workspace('project/current'))).toBe(false);
    expect(await fs.readFile(workspace('project/run.sh'), 'utf8')).toBe('retained ordinary bytes');
    expect(await mode(workspace('project/run.sh'))).toBe(0o751);
  });

  it.each([
    { label: 'default budget', options: {}, acceptsDelay: false },
    { label: 'larger bucket budget', options: { scanTimeoutMs: 300_000 }, acceptsDelay: true },
  ])('enforces explicit capture durability with the $label', async ({ options, acceptsDelay }) => {
    await file(workspace('project/retained.txt'), 'previously captured bytes');
    const first = manager();
    await first.initialize();
    await first.close();
    const manifestFile = path.join(store.directory, `${FILE_METADATA_KEY}.json`);
    const before = await fs.readFile(manifestFile);
    const instance = manager({ deferInitialCapture: true, ...options });
    await instance.initialize();
    await file(workspace('project/new.txt'), 'new bytes require a complete capture');
    const realNow = Date.now;
    let elapsed = 0, delayed = false;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + elapsed);
    const originalReaddir = fs.readdir;
    const readdir = vi.spyOn(fs, 'readdir').mockImplementation((async (...args: Parameters<typeof fs.readdir>) => {
      const children = await Reflect.apply(originalReaddir, fs, args);
      if (!delayed) { delayed = true; elapsed += 90_001; }
      return children;
    }) as typeof fs.readdir);
    try {
      if (acceptsDelay) {
        await instance.capture();
        expect((await snapshot()).entries).toContainEqual(expect.objectContaining({ path: 'project/new.txt', kind: 'file' }));
        expect(instance.status().error).toBeNull();
      } else {
        await expect(instance.capture()).rejects.toMatchObject({ code: 'FILE_METADATA_SCAN_TIMEOUT' });
        expect(await fs.readFile(manifestFile)).toEqual(before);
        expect(instance.status()).toMatchObject({ initialized: true, lastCapturedAt: null, error: expect.any(String) });
      }
      expect(await fs.readFile(workspace('project/new.txt'), 'utf8')).toBe('new bytes require a complete capture');
    } finally { clock.mockRestore(); readdir.mockRestore(); }
  });

  it('rejects an invalid manifest before restoring files even when the initial capture is deferred', async () => {
    await file(workspace('project/run.sh'), 'unchanged owner bytes', 0o755);
    const first = manager();
    await first.initialize();
    await first.close();
    const saved = await snapshot();
    saved.entries.push({ root: 'workspaces', path: '../outside', kind: 'symlink', target: 'target', mode: 0o777, mtimeMs: 0, size: 6 });
    await store.write(FILE_METADATA_KEY, saved);
    await fs.chmod(workspace('project/run.sh'), 0o666);
    const manifestFile = path.join(store.directory, `${FILE_METADATA_KEY}.json`);
    const before = await fs.readFile(manifestFile);
    const instance = manager({ deferInitialCapture: true });

    await expect(instance.initialize()).rejects.toThrow('metadata is invalid');

    expect(instance.status().initialized).toBe(false);
    expect(await mode(workspace('project/run.sh'))).toBe(0o666);
    expect(await fs.readFile(workspace('project/run.sh'), 'utf8')).toBe('unchanged owner bytes');
    expect(await fs.readFile(manifestFile)).toEqual(before);
    expect(await exists(path.join(temporary, 'outside'))).toBe(false);
  });

  it('waits for a saved snapshot when explicit capture initializes a manager with deferred startup capture', async () => {
    await file(workspace('project/run.sh'), 'ordinary durable bytes', 0o755);
    await link(workspace('project/current'), 'run.sh');
    const instance = manager({ deferInitialCapture: true });
    let entered = false, settled = false;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    store.blockNext = { entered: () => { entered = true; }, release: blocked };
    const capture = instance.capture();
    void capture.then(() => { settled = true; }, () => { settled = true; });
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      expect(settled).toBe(false);
      expect(instance.status()).toMatchObject({ initialized: true, capturing: true, lastCapturedAt: null });
      expect(await store.read(FILE_METADATA_KEY, null)).toBeNull();
    } finally { release(); }
    await capture;
    expect((await snapshot()).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'project/run.sh', kind: 'file', mode: 0o755 }),
      expect.objectContaining({ path: 'project/current', kind: 'symlink', target: 'run.sh' }),
    ]));
    expect(instance.status().lastCapturedAt).not.toBeNull();
  });

  it('never replaces a complete snapshot with the results of a failed or oversized scan', async () => {
    await link(workspace('project/link'), 'target.ts');
    const instance = manager();
    await instance.initialize();
    const before = await snapshot();
    const readdir = vi.spyOn(fs, 'readdir').mockRejectedValueOnce(Object.assign(new Error('remote I/O failed'), { code: 'EIO' }));
    await expect(instance.capture()).rejects.toThrow('remote I/O failed');
    expect(await snapshot()).toEqual(before);
    readdir.mockRestore();
    await fs.mkdir(workspace(`deep/${Array.from({ length: 129 }, () => 'x').join('/')}`), { recursive: true });
    await expect(instance.capture()).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await fs.rm(workspace('deep'), { recursive: true });
    await instance.capture();
  });

  it('retains the complete manifest when a scanned default-mode directory moves out of the managed tree', async () => {
    await file(workspace('project/plain.ts'), 'captured source bytes');
    const instance = manager();
    await instance.initialize();
    const before = await snapshot();
    const displaced = path.join(temporary, 'displaced-project');
    let moved = false;
    const originalLstat = fs.lstat;
    const lstat = vi.spyOn(fs, 'lstat').mockImplementation((async filename => {
      const stat = await originalLstat(filename);
      if (!moved && String(filename).endsWith('/plain.ts')) {
        moved = true;
        await fs.rename(workspace('project'), displaced);
        await file(workspace('project/manual.ts'), 'new owner bytes', 0o666);
        await fs.chmod(workspace('project'), 0o777);
      }
      return stat;
    }) as typeof fs.lstat);

    await expect(instance.capture()).rejects.toMatchObject({ code: 'METADATA_CHANGED' });
    lstat.mockRestore();

    expect(moved).toBe(true); expect(await snapshot()).toEqual(before);
    expect(await fs.readFile(path.join(displaced, 'plain.ts'), 'utf8')).toBe('captured source bytes');
    expect(await mode(workspace('project'))).toBe(0o777);
    expect(await mode(workspace('project/manual.ts'))).toBe(0o666);
    expect(await fs.readFile(workspace('project/manual.ts'), 'utf8')).toBe('new owner bytes');
  });

  it('retains last-known metadata for an unreadable subtree instead of inferring deletions', async () => {
    await link(workspace('project/link'), 'target.ts');
    const instance = manager();
    await instance.initialize();
    await fs.chmod(config.workspacesDir, 0o700);
    const readdir = vi.spyOn(fs, 'readdir').mockRejectedValueOnce(Object.assign(new Error('unreadable subtree'), { code: 'EACCES' }));
    await instance.capture();
    readdir.mockRestore();
    const saved = await snapshot();
    expect(saved.entries.find(entry => entry.root === 'workspaces' && entry.path === '')?.mode).toBe(0o700);
    expect(saved.entries.find(entry => entry.root === 'workspaces' && entry.path === '')?.restoreMissing).toBe(false);
    expect(saved.entries.find(entry => entry.path === 'project')?.restoreMissing).toBe(false);
    expect(saved.entries.find(entry => entry.path === 'project/link')?.target).toBe('target.ts');
    expect(instance.status().issues).toContainEqual({ root: 'workspaces', path: '', reason: 'permission-denied' });
  });

  it('does not infer empty-directory recreation for a newly encountered unreadable directory', async () => {
    const instance = manager();
    await instance.initialize();
    await file(workspace('unreadable/plain.ts'), 'unobserved bytes');
    const originalReaddir = fs.readdir;
    const readdir = vi.spyOn(fs, 'readdir').mockImplementation((async (...args: Parameters<typeof fs.readdir>) => {
      if (await fs.realpath(args[0]) === workspace('unreadable')) throw Object.assign(new Error('Fixture permission denied'), { code: 'EACCES' });
      return Reflect.apply(originalReaddir, fs, args);
    }) as typeof fs.readdir);
    await instance.capture();
    await instance.close();
    readdir.mockRestore();
    expect((await snapshot()).entries).toContainEqual(expect.objectContaining({ path: 'unreadable', kind: 'directory', restoreMissing: false }));
    await fs.rm(workspace('unreadable'), { recursive: true });

    await manager().initialize();

    await expect(fs.lstat(workspace('unreadable'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('debounces workspace events, detects terminal-only changes periodically, and captures before close', async () => {
    const instance = manager();
    await instance.initialize();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    instance.start();
    const initialRevision = instance.status().revision;
    await link(workspace('project/from-api'), 'target.ts');
    for (let index = 0; index < 8; index++) events.emit('workspace:changed', { workspaceId: 'project' });
    await vi.advanceTimersByTimeAsync(749);
    expect(instance.status().revision).toBe(initialRevision);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(instance.status().revision).toBeGreaterThan(initialRevision));

    await link(workspace('project/from-terminal'), 'terminal.ts');
    const beforePeriodic = instance.status().revision;
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.waitFor(() => expect(instance.status().revision).toBeGreaterThan(beforePeriodic));
    expect((await snapshot()).entries.some(entry => entry.path === 'project/from-terminal')).toBe(true);

    await link(workspace('project/before-close'), 'closing.ts');
    await instance.close();
    expect((await snapshot()).entries.some(entry => entry.path === 'project/before-close')).toBe(true);
    expect(events.listenerCount('workspace:changed')).toBe(0);
    await expect(instance.capture()).rejects.toThrow('closed');
  });
});
