import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FILE_METADATA_KEY, FileMetadataManager, type FileMetadataOptions } from '../server/file-metadata';
import { JsonStore } from '../server/store';

const execute = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
type Entry = { root: 'workspaces' | 'home' | 'native-codex'; path: string; kind: string; mode: number; mtimeMs: number; size: number;
  target?: string; restoreMissing?: boolean };
type Manifest = { version: number; revision: number; capturedAt: string; entries: Entry[]; workspaceFileRoots: string[] };
const mode = async (filename: string) => (await fs.lstat(filename)).mode & 0o7777;
const hash = async (filename: string) => createHash('sha256').update(await fs.readFile(filename)).digest('hex');

describe('explicit native CODEX_HOME metadata', () => {
  let root: string, config: { workspacesDir: string; homeDir: string }, nativeHome: string, store: JsonStore;
  const managers: FileMetadataManager[] = [];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-metadata-'));
    await fs.chmod(root, 0o700);
    config = { workspacesDir: path.join(root, 'workspaces'), homeDir: path.join(root, 'home') };
    nativeHome = path.join(root, 'native-codex'); store = new JsonStore(path.join(root, 'state'));
    await Promise.all([fs.mkdir(config.workspacesDir), fs.mkdir(config.homeDir)]);
  });
  afterEach(async () => {
    for (const manager of managers.splice(0)) await manager.close().catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  });
  const manager = (options: FileMetadataOptions = { nativeCodexHomeDir: nativeHome }) => {
    const value = new FileMetadataManager(config, store, undefined, options); managers.push(value); return value;
  };
  const manifest = () => store.read<Manifest>(FILE_METADATA_KEY, null as unknown as Manifest);
  const persisted = () => path.join(store.directory, `${FILE_METADATA_KEY}.json`);
  const file = async (filename: string, content: string, permissions: number) => {
    await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, content); await fs.chmod(filename, permissions);
  };

  it('retires native Codex metadata without changing saved workspace modes or legacy files', async () => {
    const workspaceFile = path.join(config.workspacesDir, 'project', 'run.sh');
    const legacyFile = path.join(nativeHome, 'sessions', 'old.jsonl');
    await file(workspaceFile, 'echo workspace', 0o750);
    await file(legacyFile, 'old conversation', 0o600);
    const original = manager(); await original.initialize(); await original.close();
    await fs.chmod(workspaceFile, 0o644);
    await fs.chmod(legacyFile, 0o644);

    const claude = manager({ deferInitialCapture: true }); await claude.initialize();
    expect(await mode(workspaceFile)).toBe(0o750);
    expect(await mode(legacyFile)).toBe(0o644);
    await claude.capture(); await claude.close();
    expect((await manifest()).entries.every(entry => entry.root !== 'native-codex')).toBe(true);
    expect(await fs.readFile(legacyFile, 'utf8')).toBe('old conversation');
  });

  it('omits only the reserved native writer-lock and arg0 trees while retaining durable state and matching ordinary paths', async () => {
    const ephemeral = ['thread-writer-locks/.coordination.lock', 'thread-writer-locks/01a0e2da-fdf1-7ff2-8a49-99ad6bdec192.lock',
      'tmp/arg0/codex-arg01Kz0Vz/.lock'];
    const durable = ['state_5.sqlite', 'state_5.sqlite-wal', 'state_5.sqlite-shm', 'config.toml', 'sessions/thread.jsonl',
      'skills/example/SKILL.md', 'rules/user.rules', 'persistent.lock', 'tmp/retained.txt', 'tmp/arg0-backup/.lock',
      'thread-writer-locks-backup/thread.lock', 'sessions/thread-writer-locks/retained.lock'];
    for (const relative of [...ephemeral, ...durable]) await file(path.join(nativeHome, relative), `Owned fixture: ${relative}`, 0o600);
    await fs.symlink('/owned-native-executable', path.join(nativeHome, 'tmp/arg0/codex-arg01Kz0Vz/apply_patch'));
    await fs.mkdir(path.join(nativeHome, 'tmp/arg0/empty-helper'));
    for (const relative of ephemeral) {
      await file(path.join(config.homeDir, relative), 'Ordinary home content.', 0o640);
      await file(path.join(config.workspacesDir, 'project', relative), 'Ordinary workspace content.', 0o640);
    }

    const instance = manager(); await instance.initialize();
    const saved = await manifest(), nativePaths = saved.entries.filter(entry => entry.root === 'native-codex').map(entry => entry.path);
    expect(nativePaths).not.toEqual(expect.arrayContaining(ephemeral));
    expect(nativePaths.filter(relative => relative === 'thread-writer-locks' || relative.startsWith('thread-writer-locks/')
      || relative === 'tmp/arg0' || relative.startsWith('tmp/arg0/'))).toEqual([]);
    for (const relative of durable) expect(nativePaths).toContain(relative);
    for (const relative of ephemeral) {
      expect(saved.entries).toContainEqual(expect.objectContaining({ root: 'home', path: relative, kind: 'file' }));
      expect(saved.entries).toContainEqual(expect.objectContaining({ root: 'workspaces', path: `project/${relative}`, kind: 'file' }));
      expect(await fs.readFile(path.join(nativeHome, relative), 'utf8')).toBe(`Owned fixture: ${relative}`);
    }
    expect(await fs.readlink(path.join(nativeHome, 'tmp/arg0/codex-arg01Kz0Vz/apply_patch'))).toBe('/owned-native-executable');
    expect(instance.status().issues).toEqual([]); expect(instance.status().issueCount).toBe(0);
  });

  it('omits native plugin clone staging but retains the activated catalog, recovery backups, installations and ordinary home paths', async () => {
    const staging = '.tmp/plugins-clone-Dwnl14', stagedScript = `${staging}/plugin/run.sh`;
    const retained = ['.tmp/plugins/.agents/plugins/marketplace.json', '.tmp/plugins/run.sh',
      '.tmp/plugins-backup-ZAE9Ai/repo/run.sh', '.tmp/plugins-backup-wj1om2/repo/skills/retained.md',
      'plugins/cache/example/plugin/1.0.0/run.sh', 'plugins/data/example/state.json',
      '.tmp/plugins-clone-/retained.txt', '.tmp/plugins-clones-other-name.json', 'sessions/.tmp/plugins-clone-Dwnl14/retained.txt'];
    await file(path.join(nativeHome, stagedScript), 'Temporary native checkout.', 0o700);
    for (const relative of retained) await file(path.join(nativeHome, relative), `Retained fixture: ${relative}`, 0o751);
    await file(path.join(config.homeDir, '.codex', stagedScript), 'Ordinary home native checkout remains tracked.', 0o640);
    await file(path.join(config.homeDir, stagedScript), 'Ordinary home folder.', 0o640);
    await file(path.join(config.workspacesDir, 'project', stagedScript), 'Ordinary workspace folder.', 0o640);

    const first = manager(); await first.initialize(); await first.close();
    const saved = await manifest();
    expect(saved.entries.some(entry => entry.root === 'native-codex' && (entry.path === staging || entry.path.startsWith(`${staging}/`)))).toBe(false);
    for (const relative of retained) expect(saved.entries).toContainEqual(expect.objectContaining({ root: 'native-codex', path: relative, mode: 0o751 }));
    for (const [entryRoot, relative] of [['home', `.codex/${stagedScript}`], ['home', stagedScript], ['workspaces', `project/${stagedScript}`]]) {
      expect(saved.entries).toContainEqual(expect.objectContaining({ root: entryRoot, path: relative, kind: 'file' }));
    }
    const hashBefore = await hash(path.join(nativeHome, stagedScript));
    await fs.chmod(path.join(nativeHome, stagedScript), 0o604);
    for (const relative of retained) await fs.chmod(path.join(nativeHome, relative), 0o666);
    const restored = manager({ nativeCodexHomeDir: nativeHome, deferInitialCapture: true }); await restored.initialize();
    expect(await mode(path.join(nativeHome, stagedScript))).toBe(0o604);
    expect(await hash(path.join(nativeHome, stagedScript))).toBe(hashBefore);
    for (const relative of retained) {
      expect(await mode(path.join(nativeHome, relative))).toBe(0o751);
      expect(await fs.readFile(path.join(nativeHome, relative), 'utf8')).toBe(`Retained fixture: ${relative}`);
    }
    expect(restored.status().issues).toEqual([]);
  });

  it.each(['present', 'missing'])('ignores and prunes old manifest ephemera without touching or reconstructing %s native locks, helpers and clone staging', async state => {
    const relatives = ['thread-writer-locks', 'thread-writer-locks/.coordination.lock',
      'thread-writer-locks/01a0e2da-fdf1-7ff2-8a49-99ad6bdec192.lock', 'tmp/arg0', 'tmp/arg0/codex-arg01Kz0Vz',
      'tmp/arg0/codex-arg01Kz0Vz/.lock', 'tmp/arg0/codex-arg01Kz0Vz/apply_patch', 'tmp/arg0/empty-helper',
      '.tmp/plugins-clone-Dwnl14', '.tmp/plugins-clone-Dwnl14/run.sh'];
    await file(path.join(nativeHome, relatives[1]!), 'Owned coordination lock fixture.', 0o600);
    await file(path.join(nativeHome, relatives[2]!), 'Owned writer lock fixture.', 0o600);
    await file(path.join(nativeHome, relatives[5]!), 'Owned helper lock fixture.', 0o600);
    await fs.symlink('/previous-native-executable', path.join(nativeHome, relatives[6]!));
    await fs.mkdir(path.join(nativeHome, relatives[7]!));
    await file(path.join(nativeHome, relatives[9]!), 'Owned staged plugin script.', 0o700);
    const durable = path.join(nativeHome, 'config.toml'); await file(durable, 'retained native preferences', 0o600);
    const first = manager(); await first.initialize(); await first.close();
    const before = await manifest();
    const oldEntries: Entry[] = await Promise.all(relatives.map(async relative => {
      const filename = path.join(nativeHome, relative), stat = await fs.lstat(filename);
      return { root: 'native-codex', path: relative, kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
        mode: stat.mode & 0o7777, mtimeMs: stat.mtimeMs, size: stat.size,
        ...(stat.isSymbolicLink() ? { target: await fs.readlink(filename) } : {}),
        // Legacy entries could authorize directory recreation, including
        // parents reconstructed while restoring native helper symlinks.
        ...(stat.isDirectory() ? { restoreMissing: true } : {}) };
    }));
    await store.write(FILE_METADATA_KEY, { ...before, revision: before.revision + 1, entries: [...before.entries, ...oldEntries] });
    if (state === 'missing') {
      await fs.rm(path.join(nativeHome, 'thread-writer-locks'), { recursive: true });
      await fs.rm(path.join(nativeHome, 'tmp/arg0'), { recursive: true });
      await fs.rm(path.join(nativeHome, '.tmp/plugins-clone-Dwnl14'), { recursive: true });
    } else {
      for (const relative of relatives) {
        const filename = path.join(nativeHome, relative), stat = await fs.lstat(filename);
        if (stat.isSymbolicLink()) { await fs.unlink(filename); await fs.symlink('/current-native-executable', filename); }
        else await fs.chmod(filename, stat.isDirectory() ? 0o751 : 0o640);
      }
    }
    await fs.chmod(durable, 0o666);
    const inspect = () => Promise.all(relatives.map(async relative => {
      const filename = path.join(nativeHome, relative), stat = await fs.lstat(filename);
      return { relative, ino: stat.ino, mode: stat.mode & 0o7777, ctimeMs: stat.ctimeMs, mtimeMs: stat.mtimeMs,
        ...(stat.isSymbolicLink() ? { target: await fs.readlink(filename) } : stat.isFile() ? { sha256: await hash(filename) } : {}) };
    }));
    const untouched = state === 'present' ? await inspect() : null;
    const restored = manager({ nativeCodexHomeDir: nativeHome, deferInitialCapture: true }); await restored.initialize();
    expect(restored.status().issues).toEqual([]); expect(restored.status().issueCount).toBe(0);
    expect(restored.status().entries).toBe(before.entries.length);
    expect(await mode(durable)).toBe(0o600); expect(await fs.readFile(durable, 'utf8')).toBe('retained native preferences');
    if (state === 'present') expect(await inspect()).toEqual(untouched);
    else for (const relative of ['thread-writer-locks', 'tmp/arg0', '.tmp/plugins-clone-Dwnl14']) await expect(fs.lstat(path.join(nativeHome, relative))).rejects.toMatchObject({ code: 'ENOENT' });

    // Deferred startup still excludes the entries immediately; its next
    // ordinary capture removes stale metadata without manipulating ephemera.
    expect((await manifest()).entries).toHaveLength(before.entries.length + oldEntries.length);
    await restored.capture();
    const pruned = await manifest(); expect(pruned.revision).toBeGreaterThan(before.revision + 1);
    expect(pruned.entries.some(entry => entry.root === 'native-codex' && relatives.includes(entry.path))).toBe(false);
    if (state === 'present') expect(await inspect()).toEqual(untouched);
    else for (const relative of ['thread-writer-locks', 'tmp/arg0', '.tmp/plugins-clone-Dwnl14']) await expect(fs.lstat(path.join(nativeHome, relative))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([false, true])('allows absent native tmp only when no retained descendants require it (durable descendant: %s)', async durable => {
    await file(path.join(nativeHome, 'tmp/arg0/codex-arg01Kz0Vz/.lock'), 'Owned transient lock.', 0o600);
    if (durable) await file(path.join(nativeHome, 'tmp/retained.txt'), 'Owned durable tmp file.', 0o640);
    const first = manager(); await first.initialize(); await first.close();
    const saved = await manifest();
    expect(saved.entries).toContainEqual(expect.objectContaining({ root: 'native-codex', path: 'tmp', restoreMissing: false }));
    const oldPath = 'tmp/arg0/codex-arg01Kz0Vz/.lock', oldStat = await fs.lstat(path.join(nativeHome, oldPath));
    await store.write(FILE_METADATA_KEY, { ...saved, revision: saved.revision + 1, entries: [...saved.entries,
      { root: 'native-codex', path: oldPath, kind: 'file', mode: 0o600, mtimeMs: oldStat.mtimeMs, size: oldStat.size }] });
    await fs.rm(path.join(nativeHome, 'tmp'), { recursive: true });

    const restored = manager({ nativeCodexHomeDir: nativeHome, deferInitialCapture: true }); await restored.initialize();
    await expect(fs.lstat(path.join(nativeHome, 'tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (durable) expect(restored.status().issues).toContainEqual({ root: 'native-codex', path: 'tmp/retained.txt', reason: 'missing-file' });
    else { expect(restored.status().issues).toEqual([]); expect(restored.status().issueCount).toBe(0); }
    expect(restored.status().issues).not.toContainEqual({ root: 'native-codex', path: oldPath, reason: 'missing-file' });
  });

  it('still restores the recorded mode of a present native tmp parent', async () => {
    await file(path.join(nativeHome, 'tmp/arg0/codex-arg01Kz0Vz/.lock'), 'Owned transient lock.', 0o600);
    await fs.chmod(path.join(nativeHome, 'tmp'), 0o710);
    const first = manager(); await first.initialize(); await first.close();
    await fs.chmod(path.join(nativeHome, 'tmp'), 0o777);
    const restored = manager({ nativeCodexHomeDir: nativeHome, deferInitialCapture: true }); await restored.initialize();
    expect(await mode(path.join(nativeHome, 'tmp'))).toBe(0o710); expect(restored.status().issues).toEqual([]);
  });

  it('still reports missing native durable bytes and ordinary lock-named files and restores ordinary matching directories and modes', async () => {
    const nativeFiles = ['state_5.sqlite', 'state_5.sqlite-wal', 'state_5.sqlite-shm', 'config.toml', 'sessions/thread.jsonl',
      'skills/example/SKILL.md', 'tmp/retained.lock', 'thread-writer-locks-backup/retained.lock'];
    for (const relative of nativeFiles) await file(path.join(nativeHome, relative), `Owned durable fixture: ${relative}`, 0o600);
    const homeLock = 'thread-writer-locks/01a0e2da-fdf1-7ff2-8a49-99ad6bdec192.lock';
    const workspaceLock = 'project/tmp/arg0/codex-arg01Kz0Vz/.lock';
    await file(path.join(config.homeDir, homeLock), 'Ordinary home file.', 0o600);
    await file(path.join(config.workspacesDir, workspaceLock), 'Ordinary workspace file.', 0o600);
    const retained = path.join(config.homeDir, 'tmp/arg0/retained.txt'); await file(retained, 'Retain these bytes and mode.', 0o640);
    const empty = path.join(config.workspacesDir, 'project/thread-writer-locks/empty'); await fs.mkdir(empty, { recursive: true, mode: 0o710 });
    const first = manager(); await first.initialize(); await first.close();
    for (const relative of nativeFiles) await fs.unlink(path.join(nativeHome, relative));
    await fs.unlink(path.join(config.homeDir, homeLock)); await fs.unlink(path.join(config.workspacesDir, workspaceLock));
    await fs.chmod(retained, 0o666); await fs.rmdir(empty);

    const restored = manager({ nativeCodexHomeDir: nativeHome, deferInitialCapture: true }); await restored.initialize();
    const status = restored.status();
    for (const relative of nativeFiles) {
      expect(status.issues).toContainEqual({ root: 'native-codex', path: relative, reason: 'missing-file' });
      await expect(fs.lstat(path.join(nativeHome, relative))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(status.issues).toContainEqual({ root: 'home', path: homeLock, reason: 'missing-file' });
    expect(status.issues).toContainEqual({ root: 'workspaces', path: workspaceLock, reason: 'missing-file' });
    expect(status.issueCount).toBe(nativeFiles.length + 2);
    expect(await mode(empty)).toBe(0o710); expect(await mode(retained)).toBe(0o640);
    expect(await fs.readFile(retained, 'utf8')).toBe('Retain these bytes and mode.');
  });

  it('upgrades existing v1 metadata without dropping prior roots, file bytes or restoration semantics', async () => {
    const script = path.join(config.workspacesDir, 'kept', 'run.sh');
    const preferences = path.join(config.homeDir, 'preferences.txt');
    await file(script, '#!/bin/sh\necho retained\n', 0o751); await file(preferences, 'retained user data', 0o640);
    const legacy = manager({}); await legacy.initialize(); await legacy.close();
    const before = await manifest(); expect(before.version).toBe(1);
    await fs.chmod(script, 0o666); await fs.chmod(preferences, 0o666);

    const upgraded = manager(); await upgraded.initialize();

    const after = await manifest(); expect(after.version).toBe(2); expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.workspaceFileRoots).toEqual(before.workspaceFileRoots);
    expect(after.entries.filter(entry => entry.root !== 'native-codex')).toEqual(before.entries);
    expect(after.entries).toContainEqual(expect.objectContaining({ root: 'native-codex', path: '', kind: 'directory', mode: 0o700 }));
    expect(await mode(script)).toBe(0o751); expect(await mode(preferences)).toBe(0o640);
    expect(await fs.readFile(script, 'utf8')).toBe('#!/bin/sh\necho retained\n');
    expect(await fs.readFile(preferences, 'utf8')).toBe('retained user data');
  });

  it.each(['state_5.sqlite', 'logs_2.sqlite'])('accepts SQLite checkpoint/close removing %s sidecars without changing its committed database bytes', async basename => {
    await fs.mkdir(nativeHome, { mode: 0o700 });
    const database = path.join(nativeHome, basename), readyFile = path.join(root, 'sqlite-ready.json');
    const sqlite = execute('python3', ['-u', '-c', [
      'import sqlite3, os, sys, json',
      'db=sqlite3.connect(sys.argv[1])',
      'assert db.execute("pragma journal_mode=wal").fetchone()[0] == "wal"',
      'db.execute("pragma wal_autocheckpoint=0")',
      'db.execute("create table marker(value text)")',
      'db.execute("insert into marker values (?)", ("committed checkpoint fixture",))',
      'db.commit()',
      'with open(sys.argv[2], "w") as signal: json.dump({"wal":os.path.isfile(sys.argv[1]+"-wal"),"shm":os.path.isfile(sys.argv[1]+"-shm")},signal)',
      'sys.stdin.readline()',
      'checkpoint=db.execute("pragma wal_checkpoint(truncate)").fetchone()',
      'db.close()',
      'print(json.dumps({"checkpoint":checkpoint,"wal":os.path.exists(sys.argv[1]+"-wal"),"shm":os.path.exists(sys.argv[1]+"-shm")}))',
    ].join('\n'), database, readyFile], { env: { PATH: process.env.PATH }, timeout: 10_000, maxBuffer: 128 * 1024 });
    // Observe failure immediately while the child waits for the capture barrier.
    void sqlite.catch(() => undefined);
    try {
      await vi.waitFor(async () => expect(JSON.parse(await fs.readFile(readyFile, 'utf8'))).toEqual({ wal: true, shm: true }));
      const first = manager(); await first.initialize(); await first.close();
      const saved = await manifest();
      for (const suffix of ['-wal', '-shm']) expect(saved.entries).toContainEqual(expect.objectContaining({ root: 'native-codex', path: basename + suffix, kind: 'file' }));
      sqlite.child.stdin!.end('\n');
      const closed = await sqlite;
      expect(closed.stderr).toBe(''); expect(JSON.parse(closed.stdout)).toEqual({ checkpoint: [0, 0, 0], wal: false, shm: false });
      const bytes = await hash(database);

      const restored = manager({ nativeCodexHomeDir: nativeHome, deferInitialCapture: true }); await restored.initialize();
      expect(restored.status().issues).toEqual([]); expect(restored.status().issueCount).toBe(0);
      expect(await hash(database)).toBe(bytes);
      for (const suffix of ['-wal', '-shm']) await expect(fs.lstat(database + suffix)).rejects.toMatchObject({ code: 'ENOENT' });
      const verified = await execute('python3', ['-c', [
        'import sqlite3,sys,json,pathlib',
        'db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro&immutable=1",uri=True)',
        'print(json.dumps({"value":db.execute("select value from marker").fetchone()[0],"integrity":db.execute("pragma integrity_check").fetchone()[0]}))',
        'db.close()',
      ].join('\n'), database], { env: { PATH: process.env.PATH }, timeout: 10_000 });
      expect(JSON.parse(verified.stdout)).toEqual({ value: 'committed checkpoint fixture', integrity: 'ok' });
      expect(await hash(database)).toBe(bytes);
    } finally {
      if (!sqlite.child.stdin?.destroyed) sqlite.child.stdin?.end('\n');
      await sqlite.catch(() => undefined);
    }
  });

  it.each(['missing', 'symlink'])('does not hide absent native sidecars when the primary database is %s', async primary => {
    const basename = 'state_5.sqlite', database = path.join(nativeHome, basename);
    await file(database, 'Owned primary-file fixture.', 0o600);
    for (const suffix of ['-wal', '-shm']) await file(database + suffix, 'Owned sidecar fixture.', 0o600);
    const first = manager(); await first.initialize(); await first.close();
    for (const filename of [database, database + '-wal', database + '-shm']) await fs.unlink(filename);
    const outside = path.join(root, 'outside.sqlite'); await file(outside, 'Independent data must remain untouched.', 0o604);
    if (primary === 'symlink') await fs.symlink(outside, database);

    const restored = manager({ nativeCodexHomeDir: nativeHome, deferInitialCapture: true }); await restored.initialize();
    expect(restored.status().issues).toContainEqual({ root: 'native-codex', path: basename, reason: primary === 'symlink' ? 'existing-file' : 'missing-file' });
    for (const suffix of ['-wal', '-shm']) expect(restored.status().issues).toContainEqual({ root: 'native-codex', path: basename + suffix, reason: 'missing-file' });
    expect(await mode(outside)).toBe(0o604); expect(await fs.readFile(outside, 'utf8')).toBe('Independent data must remain untouched.');
    if (primary === 'symlink') expect(await fs.readlink(database)).toBe(outside);
    else await expect(fs.lstat(database)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps missing custom, nested and ordinary-home/workspace SQLite sidecars visible', async () => {
    const roots = [
      { root: 'native-codex', directory: nativeHome, relative: 'custom.sqlite' },
      { root: 'native-codex', directory: nativeHome, relative: 'nested/state_5.sqlite' },
      { root: 'home', directory: config.homeDir, relative: '.codex/state_5.sqlite' },
      { root: 'workspaces', directory: config.workspacesDir, relative: 'project/state_5.sqlite' },
    ] as const;
    for (const item of roots) {
      await file(path.join(item.directory, item.relative), 'Retained ordinary primary-file fixture.', 0o640);
      for (const suffix of ['-wal', '-shm']) await file(path.join(item.directory, item.relative + suffix), 'Owned sidecar fixture.', 0o600);
    }
    const first = manager(); await first.initialize(); await first.close();
    for (const item of roots) for (const suffix of ['-wal', '-shm']) await fs.unlink(path.join(item.directory, item.relative + suffix));
    const restored = manager({ nativeCodexHomeDir: nativeHome, deferInitialCapture: true }); await restored.initialize();
    for (const item of roots) for (const suffix of ['-wal', '-shm']) {
      expect(restored.status().issues).toContainEqual({ root: item.root, path: item.relative + suffix, reason: 'missing-file' });
    }
    expect(restored.status().issueCount).toBe(roots.length * 2);
  });

  it('restores native modes, links and empty folders in a fresh process without rewriting committed SQLite/WAL or rollout bytes', async () => {
    await fs.mkdir(nativeHome, { mode: 0o700 });
    const database = path.join(nativeHome, 'state_5.sqlite');
    const sqlite = await execute('python3', ['-c', [
      'import sqlite3, os, sys',
      'db=sqlite3.connect(sys.argv[1])',
      'assert db.execute("pragma journal_mode=wal").fetchone()[0] == "wal"',
      'db.execute("create table marker(value text)")',
      'db.execute("insert into marker values (?)", ("committed native-like test state",))',
      'db.commit()',
      'os._exit(0)',
    ].join('\n'), database], { env: { PATH: process.env.PATH }, timeout: 10_000 });
    expect(sqlite.stderr).toBe('');
    const files = [database, `${database}-wal`, `${database}-shm`, path.join(nativeHome, 'config.toml'),
      path.join(nativeHome, 'rules', 'user.rules'), path.join(nativeHome, 'sessions', 'thread.jsonl')];
    await file(files[3]!, 'approval_policy = "never"\n', 0o640);
    await file(files[4]!, 'prefix_rule(pattern=["git", "status"], decision="allow")\n', 0o600);
    await file(files[5]!, '{"type":"synthetic_owned_test","message":"retained bytes"}\n', 0o600);
    for (const filename of files.slice(0, 3)) await fs.chmod(filename, 0o600);
    await fs.chmod(path.join(nativeHome, 'rules'), 0o700); await fs.chmod(path.join(nativeHome, 'sessions'), 0o750);
    await fs.mkdir(path.join(nativeHome, 'empty'), { mode: 0o710 });
    await fs.symlink('sessions/thread.jsonl', path.join(nativeHome, 'current'));
    await file(path.join(nativeHome, 'missing-mode-only', 'nested', 'removed.txt'), 'removed test bytes', 0o600);
    const baseline = Object.fromEntries(await Promise.all(files.map(async filename => [path.relative(nativeHome, filename), { sha256: await hash(filename), mode: await mode(filename) }])));
    const first = manager(); await first.initialize(); await first.close();
    for (const suffix of ['-wal', '-shm']) expect((await manifest()).entries).toContainEqual(expect.objectContaining({
      root: 'native-codex', path: 'state_5.sqlite' + suffix, kind: 'file', mode: 0o600,
    }));

    // This is a controlled metadata-loss fixture, not a claim of an HF reboot.
    for (const filename of files) await fs.chmod(filename, 0o666);
    for (const directory of [nativeHome, path.join(nativeHome, 'rules'), path.join(nativeHome, 'sessions')]) await fs.chmod(directory, 0o777);
    await fs.rmdir(path.join(nativeHome, 'empty')); await fs.unlink(path.join(nativeHome, 'current'));
    await fs.rm(path.join(nativeHome, 'missing-mode-only'), { recursive: true });
    const unlisted = path.join(nativeHome, 'new-user-path'); await file(unlisted, 'new independent bytes', 0o604);
    const childFile = path.join(root, 'restore-metadata.mjs');
    await fs.writeFile(childFile, [
      "import fs from 'node:fs/promises'; import path from 'node:path'; import { createHash } from 'node:crypto';",
      `import { FileMetadataManager } from ${JSON.stringify(path.join(projectRoot, 'server/file-metadata.ts'))};`,
      `import { JsonStore } from ${JSON.stringify(path.join(projectRoot, 'server/store.ts'))};`,
      'const root=process.env.NATIVE_METADATA_OWNED_ROOT, native=path.join(root,"native-codex");',
      'const manager=new FileMetadataManager({workspacesDir:path.join(root,"workspaces"),homeDir:path.join(root,"home")},new JsonStore(path.join(root,"state")),undefined,{nativeCodexHomeDir:native});',
      'await manager.initialize(); const records={};',
      `for (const relative of ${JSON.stringify(Object.keys(baseline))}) { const filename=path.join(native,relative); records[relative]={sha256:createHash("sha256").update(await fs.readFile(filename)).digest("hex"),mode:(await fs.stat(filename)).mode & 0o7777}; }`,
      'const report={pid:process.pid,records,status:manager.status()}; await manager.close(); console.log(JSON.stringify(report));',
    ].join('\n'));
    const child = await execute(process.execPath, ['--import', 'tsx', childFile], { cwd: projectRoot,
      env: { PATH: process.env.PATH, NATIVE_METADATA_OWNED_ROOT: root }, timeout: 15_000, maxBuffer: 128 * 1024 });
    const result = JSON.parse(child.stdout);
    expect(result.pid).not.toBe(process.pid); expect(result.records).toEqual(baseline);
    expect(await mode(nativeHome)).toBe(0o700); expect(await mode(path.join(nativeHome, 'rules'))).toBe(0o700);
    expect(await mode(path.join(nativeHome, 'sessions'))).toBe(0o750); expect(await mode(path.join(nativeHome, 'empty'))).toBe(0o710);
    expect(await fs.readlink(path.join(nativeHome, 'current'))).toBe('sessions/thread.jsonl');
    await expect(fs.lstat(path.join(nativeHome, 'missing-mode-only'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(result.status.issues).toContainEqual({ root: 'native-codex', path: 'missing-mode-only/nested/removed.txt', reason: 'missing-file' });
    expect(await fs.readFile(unlisted, 'utf8')).toBe('new independent bytes'); expect(await mode(unlisted)).toBe(0o604);
    const reopened = await execute('python3', ['-c',
      'import sqlite3,sys,json; db=sqlite3.connect(sys.argv[1]); print(json.dumps({"value":db.execute("select value from marker").fetchone()[0],"integrity":db.execute("pragma integrity_check").fetchone()[0]}))', database],
    { env: { PATH: process.env.PATH }, timeout: 10_000 });
    expect(JSON.parse(reopened.stdout)).toEqual({ value: 'committed native-like test state', integrity: 'ok' });
  });

  it('retains the prior manifest and refuses to recreate an entirely missing tracked native home', async () => {
    await file(path.join(nativeHome, 'state_5.sqlite'), 'owned synthetic native state bytes', 0o600);
    const first = manager(); await first.initialize(); await first.close(); const before = await hash(persisted());
    await fs.rm(nativeHome, { recursive: true });
    await expect(manager().initialize()).rejects.toThrow('root is missing');
    await expect(fs.lstat(nativeHome)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await hash(persisted())).toBe(before);
  });

  it('does not silently drop a saved native root when a later caller omits its explicit configuration', async () => {
    const first = manager(); await first.initialize(); await first.close(); const before = await hash(persisted());
    await expect(manager({}).initialize()).rejects.toThrow('must remain explicitly configured');
    expect(await hash(persisted())).toBe(before);
  });

  it('rejects native aliases and overlapping roots before following or creating native state through them', async () => {
    expect(() => manager({ nativeCodexHomeDir: path.join(config.homeDir, 'native') })).toThrow('separate metadata roots');
    const outside = path.join(root, 'other-owner'); await fs.mkdir(outside);
    const marker = path.join(outside, 'kept'); await file(marker, 'unchanged', 0o604);
    await fs.symlink(outside, nativeHome);
    await expect(manager().initialize()).rejects.toThrow('safe directory');
    await fs.unlink(nativeHome);
    const aliasParent = path.join(root, 'alias-parent'); await fs.symlink(outside, aliasParent);
    await expect(manager({ nativeCodexHomeDir: path.join(aliasParent, 'native') }).initialize()).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual(['kept']); expect(await mode(marker)).toBe(0o604);
  });

  it('never follows a native metadata symlink to restore modes on an outside file', async () => {
    const filename = path.join(nativeHome, 'sessions', 'thread.jsonl'); await file(filename, 'old captured bytes', 0o600);
    const first = manager(); await first.initialize(); await first.close();
    const outside = path.join(root, 'unrelated-data'); await file(outside, 'unrelated current bytes', 0o604);
    await fs.unlink(filename); await fs.symlink(outside, filename);
    const restarted = manager(); await restarted.initialize();
    expect(await fs.readlink(filename)).toBe(outside); expect(await mode(outside)).toBe(0o604);
    expect(await fs.readFile(outside, 'utf8')).toBe('unrelated current bytes');
    expect(restarted.status().issues).toContainEqual({ root: 'native-codex', path: 'sessions/thread.jsonl', reason: 'existing-file' });
  });
});
