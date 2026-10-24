import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs, { type FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileMetadataManager, FILE_METADATA_KEY } from '../server/file-metadata';
import { JsonStore } from '../server/store';

interface Entry { root: string; path: string; kind: string; mode: number; restoreMissing?: boolean }
interface Manifest { entries: Entry[]; [key: string]: unknown }
let directory: string, config: { workspacesDir: string; homeDir: string }, store: JsonStore;
const managers: FileMetadataManager[] = [];
const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  releases.push(resolve);
  return { promise, resolve };
}
function manager() {
  const value = new FileMetadataManager(config, store, undefined, { deferInitialCapture: true });
  managers.push(value);
  return value;
}
async function capture() {
  const value = manager();
  await value.initialize(); await value.capture(); await value.close();
}
async function makeFile(relative: string, mode = 0o600) {
  const filename = path.join(config.homeDir, relative);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, 'retained contents: ' + relative);
  await fs.chmod(filename, mode);
  return filename;
}
async function writableTree(root: string) {
  await fs.chmod(root, 0o700);
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await writableTree(path.join(root, entry.name));
  }
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-metadata-restore-'));
  config = { workspacesDir: path.join(directory, 'workspaces'), homeDir: path.join(directory, 'home') };
  await fs.mkdir(config.workspacesDir); await fs.mkdir(config.homeDir);
  store = new JsonStore(path.join(directory, 'state'));
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0));
  vi.restoreAllMocks();
  for (const value of managers.splice(0)) await value.close().catch(() => undefined);
  await writableTree(directory);
  await fs.rm(directory, { recursive: true, force: true });
});

describe('bounded native metadata restoration', () => {
  it('shares deep directory parents for three bounded creation and permission rounds', async () => {
    const parent = 'a/b/c/d/e/f/g';
    const directories = Array.from({ length: 48 }, (_, index) =>
      path.join(config.homeDir, parent, 'dir-' + String(index).padStart(2, '0')));
    for (const target of directories) { await fs.mkdir(target, { recursive: true }); await fs.chmod(target, 0o700); }
    await capture();
    await Promise.all(directories.map(target => fs.chmod(target, 0o755)));
    const open = fs.open.bind(fs), mkdir = fs.mkdir.bind(fs);
    const creates: Array<() => void> = [], modes: Array<() => void> = [];
    let unblocked = false, ancestors = 0, targetOpens = 0;
    const releaseAll = () => {
      unblocked = true;
      for (const release of [...creates.splice(0), ...modes.splice(0)]) release();
    };
    releases.push(releaseAll);
    vi.spyOn(fs, 'mkdir').mockImplementation((async (...args: Parameters<typeof fs.mkdir>) => {
      if (!unblocked && /^dir-\d+$/.test(path.basename(String(args[0])))) await new Promise<void>(resolve => creates.push(resolve));
      return mkdir(...args);
    }) as typeof fs.mkdir);
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args), name = path.basename(String(args[0]));
      if (typeof args[1] === 'number' && (args[1] & constants.O_DIRECTORY)) {
        if (/^[a-g]$/.test(name)) ancestors++;
        if (/^dir-\d+$/.test(name)) {
          targetOpens++;
          const chmod = handle.chmod.bind(handle);
          handle.chmod = async mode => {
            if (!unblocked) await new Promise<void>(resolve => modes.push(resolve));
            await chmod(mode);
          };
        }
      }
      return handle;
    });
    const restoring = manager().initialize(); pending.push(restoring); void restoring.catch(() => undefined);
    try {
      for (let round = 0; round < 3; round++) {
        await vi.waitFor(() => expect(creates).toHaveLength(16));
        expect(ancestors).toBe((round + 1) * 7); expect(targetOpens).toBe(0);
        for (const release of creates.splice(0)) release();
      }
      for (let round = 0; round < 3; round++) {
        await vi.waitFor(() => expect(modes).toHaveLength(16));
        expect(ancestors).toBe(21 + (round + 1) * 7);
        expect(targetOpens).toBe((round + 1) * 16);
        for (const release of modes.splice(0)) release();
      }
      await restoring;
    } finally { releaseAll(); await restoring.catch(() => undefined); }
    for (const target of directories) expect((await fs.stat(target)).mode & 0o7777).toBe(0o700);
  });

  it.each([true, false])('preserves sparse missing-parent creation authority when restoreMissing is %s', async restoreMissing => {
    const children = ['sparse/missing/a', 'sparse/missing/b'];
    for (const relative of children) await fs.mkdir(path.join(config.homeDir, relative), { recursive: true });
    await capture();
    await store.update<Manifest>(FILE_METADATA_KEY, { entries: [] }, value => ({
      ...value, entries: value.entries.filter(entry => entry.root !== 'home' || !['sparse', 'sparse/missing'].includes(entry.path))
        .map(entry => entry.root === 'home' && children.includes(entry.path) ? { ...entry, mode: 0o700, restoreMissing } : entry),
    }));
    await fs.rm(path.join(config.homeDir, 'sparse'), { recursive: true });
    const metadata = manager(); await metadata.initialize();
    if (restoreMissing) {
      for (const relative of children) expect((await fs.stat(path.join(config.homeDir, relative))).mode & 0o7777).toBe(0o700);
      expect(metadata.status().issues).toEqual([]);
    } else {
      await expect(fs.lstat(path.join(config.homeDir, 'sparse'))).rejects.toMatchObject({ code: 'ENOENT' });
      for (const relative of children) expect(metadata.status().issues)
        .toContainEqual({ root: 'home', path: relative, reason: 'missing-file' });
    }
  });

  it.each(['symlink', 'file'] as const)('refuses a directory target replaced with a %s before its mode handle opens', async replacement => {
    const parent = path.join(config.homeDir, 'target-group');
    for (const name of ['a', 'b']) {
      await fs.mkdir(path.join(parent, name), { recursive: true });
      await fs.chmod(path.join(parent, name), 0o700);
    }
    await capture();
    for (const name of ['a', 'b']) await fs.chmod(path.join(parent, name), 0o755);
    const outside = path.join(directory, 'outside-target');
    await fs.mkdir(outside, { mode: 0o710 });
    await fs.writeFile(path.join(outside, 'retained.txt'), 'outside retained bytes');
    const open = fs.open.bind(fs);
    let swapped = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (!swapped && path.basename(String(args[0])) === 'a') {
        swapped = true;
        await fs.rename(path.join(parent, 'a'), path.join(directory, 'original-target'));
        if (replacement === 'symlink') await fs.symlink(outside, path.join(parent, 'a'));
        else await fs.writeFile(path.join(parent, 'a'), 'new independent file', { mode: 0o640, flag: 'wx' });
      }
      return open(...args);
    });
    const metadata = manager(); await metadata.initialize();
    expect(swapped).toBe(true);
    expect(metadata.status().issues).toContainEqual({ root: 'home', path: 'target-group/a', reason: 'unsafe-parent' });
    expect((await fs.stat(path.join(parent, 'b'))).mode & 0o7777).toBe(0o700);
    expect(await fs.readFile(path.join(outside, 'retained.txt'), 'utf8')).toBe('outside retained bytes');
    expect((await fs.stat(outside)).mode & 0o777).toBe(0o710);
    if (replacement === 'file') {
      expect(await fs.readFile(path.join(parent, 'a'), 'utf8')).toBe('new independent file');
      expect((await fs.stat(path.join(parent, 'a'))).mode & 0o7777).toBe(0o640);
    }
  });

  it('revalidates shared directory parents after rename and symlink substitution', async () => {
    const parent = path.join(config.homeDir, 'mode-group'), outside = path.join(directory, 'outside-modes');
    for (const name of ['a', 'b']) {
      await fs.mkdir(path.join(parent, name), { recursive: true });
      await fs.chmod(path.join(parent, name), 0o700);
    }
    await capture();
    await store.update<Manifest>(FILE_METADATA_KEY, { entries: [] }, value => ({
      ...value, entries: value.entries.map(entry => entry.root === 'home' ? { ...entry, restoreMissing: false } : entry),
    }));
    for (const name of ['a', 'b']) {
      await fs.chmod(path.join(parent, name), 0o755);
      await fs.mkdir(path.join(outside, name), { recursive: true });
      await fs.chmod(path.join(outside, name), 0o710);
      await fs.writeFile(path.join(outside, name, 'kept'), 'retained outside bytes');
    }
    const open = fs.open.bind(fs), realpath = fs.realpath.bind(fs);
    let access = '', checks = 0, swapped = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (!access && path.basename(String(args[0])) === 'mode-group') access = '/proc/self/fd/' + handle.fd;
      return handle;
    });
    vi.spyOn(fs, 'realpath').mockImplementation(async (...args: Parameters<typeof fs.realpath>) => {
      if (String(args[0]) === access && ++checks === 4) {
        swapped = true;
        await fs.rename(parent, path.join(directory, 'moved-mode-group'));
        await fs.symlink(outside, parent);
      }
      return realpath(...args);
    });
    const metadata = manager(); await metadata.initialize();
    expect(swapped).toBe(true);
    expect(metadata.status().issues.some(issue => issue.reason === 'unsafe-parent' && issue.path.startsWith('mode-group/'))).toBe(true);
    for (const name of ['a', 'b']) {
      expect((await fs.stat(path.join(outside, name))).mode & 0o7777).toBe(0o710);
      expect(await fs.readFile(path.join(outside, name, 'kept'), 'utf8')).toBe('retained outside bytes');
    }
  });

  it.each(['create', 'mode'] as const)('drains a failing directory %s group without replay or later permission levels', async phase => {
    const parent = path.join(config.homeDir, 'drain-group');
    for (const name of ['a', 'b', 'c']) {
      await fs.mkdir(path.join(parent, name), { recursive: true });
      await fs.chmod(path.join(parent, name), 0o700);
    }
    await fs.chmod(parent, 0o700);
    await capture();
    if (phase === 'create') for (const name of ['a', 'b', 'c']) await fs.rmdir(path.join(parent, name));
    else {
      await store.update<Manifest>(FILE_METADATA_KEY, { entries: [] }, value => ({
        ...value, entries: value.entries.map(entry => entry.root === 'home' ? { ...entry, restoreMissing: false } : entry),
      }));
      for (const name of ['a', 'b', 'c']) await fs.chmod(path.join(parent, name), 0o755);
    }
    await fs.chmod(parent, 0o755);
    const held = deferred(), firstDone = deferred(), open = fs.open.bind(fs), mkdir = fs.mkdir.bind(fs);
    const failure = Object.assign(new Error('Owned directory restoration failed.'), { code: 'EIO' });
    let parentOpens = 0, parentClosed = false, firstEffects = 0, blocked = false, failureIssued = false, settled = false, ancestorModes = 0;
    const before = async (name: string) => {
      if (name === 'b') { blocked = true; await held.promise; }
      if (name === 'c') { await firstDone.promise; failureIssued = true; throw failure; }
    };
    vi.spyOn(fs, 'mkdir').mockImplementation((async (...args: Parameters<typeof fs.mkdir>) => {
      const name = path.basename(String(args[0]));
      if (phase === 'create') await before(name);
      const value = await mkdir(...args);
      if (phase === 'create' && name === 'a') { firstEffects++; firstDone.resolve(); }
      return value;
    }) as typeof fs.mkdir);
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args), name = path.basename(String(args[0]));
      if (name === 'drain-group') {
        parentOpens++;
        const close = handle.close.bind(handle);
        handle.close = async () => { parentClosed = true; await close(); };
      }
      const chmod = handle.chmod.bind(handle);
      handle.chmod = async mode => {
        if (['drain-group', 'home'].includes(name)) ancestorModes++;
        if (phase === 'mode') await before(name);
        await chmod(mode);
        if (phase === 'mode' && name === 'a') { firstEffects++; firstDone.resolve(); }
      };
      return handle;
    });
    const restoring = manager().initialize(); pending.push(restoring);
    const result = restoring.then(() => { settled = true; }, error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(blocked && failureIssued).toBe(true));
      await tick();
      expect(settled).toBe(false); expect(parentClosed).toBe(false); expect(parentOpens).toBe(1);
    } finally { held.resolve(); firstDone.resolve(); }
    expect(await result).toBe(failure);
    expect(parentClosed).toBe(true); expect(firstEffects).toBe(1); expect(ancestorModes).toBe(0);
    expect((await fs.stat(parent)).mode & 0o7777).toBe(0o755);
  });

  it('opens one deep parent chain per sibling window while preserving 16 concurrent leaves', async () => {
    const parent = 'a/b/c/d/e/f/g';
    await Promise.all(Array.from({ length: 48 }, (_, index) => makeFile(parent + '/record-' + String(index).padStart(2, '0'))));
    await capture();
    const open = fs.open.bind(fs), lstat = fs.lstat.bind(fs), held = deferred();
    let ancestors = 0, lastEntered = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (typeof args[1] === 'number' && (args[1] & constants.O_DIRECTORY) && /^[a-g]$/.test(path.basename(String(args[0])))) ancestors++;
      return handle;
    });
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const value = await lstat(...args);
      if (path.basename(String(args[0])) === 'record-47') { lastEntered = true; await held.promise; }
      return value;
    }) as typeof fs.lstat);
    const restoring = manager().initialize(); pending.push(restoring); void restoring.catch(() => undefined);
    try {
      await vi.waitFor(() => expect(lastEntered).toBe(true));
      // Directory permissions cannot start while the final leaf is held.
      // Forty-eight independent traversals used 336 ancestor opens here.
      expect(ancestors).toBe(3 * 7);
    } finally { held.resolve(); }
    await restoring;
  });

  it('restores 48 leaves in three controlled I/O rounds instead of 48 serial waits', async () => {
    const files = await Promise.all(Array.from({ length: 48 }, (_, index) => makeFile('files/record-' + String(index).padStart(2, '0'))));
    await capture();
    await Promise.all(files.map(file => fs.chmod(file, 0o644)));
    const lstat = fs.lstat.bind(fs), waiting: Array<() => void> = [];
    let released = false, active = 0, peak = 0, reads = 0;
    const releaseAll = () => { released = true; for (const release of waiting.splice(0)) release(); };
    releases.push(releaseAll);
    const observed = vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const value = await lstat(...args);
      if (/^record-\d+$/.test(path.basename(String(args[0])))) {
        reads++; active++; peak = Math.max(peak, active);
        try { if (!released) await new Promise<void>(resolve => waiting.push(resolve)); }
        finally { active--; }
      }
      return value;
    }) as typeof fs.lstat);
    const restoring = manager().initialize(); pending.push(restoring); void restoring.catch(() => undefined);
    try {
      for (let round = 0; round < 3; round++) {
        await vi.waitFor(() => expect(waiting).toHaveLength(16));
        expect(reads).toBe((round + 1) * 16);
        for (const release of waiting.splice(0)) release();
      }
      await restoring;
    } finally { releaseAll(); await restoring.catch(() => undefined); observed.mockRestore(); }
    expect(peak).toBe(16); expect(reads).toBe(48);
    for (const file of files) {
      expect((await fs.stat(file)).mode & 0o7777).toBe(0o600);
      expect(await fs.readFile(file, 'utf8')).toBe('retained contents: files/' + path.basename(file));
    }
  });

  it('drains blocked siblings before reporting an unexpected failure or closing their root', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => makeFile('files/record-' + String(index).padStart(2, '0'))));
    await capture();
    const held = deferred(), entered = deferred();
    const lstat = fs.lstat.bind(fs), open = fs.open.bind(fs);
    const failure = Object.assign(new Error('Owned metadata read failed.'), { code: 'EIO' });
    const inspected: string[] = [];
    let blocked = false, failureIssued = false, settled = false, rootClosed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (String(args[0]) === config.homeDir) {
        const close = handle.close.bind(handle);
        handle.close = async () => { rootClosed = true; await close(); };
      }
      return handle;
    });
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const name = path.basename(String(args[0]));
      if (/^record-\d+$/.test(name)) inspected.push(name);
      if (name === 'record-01') { blocked = true; entered.resolve(); await held.promise; }
      if (name === 'record-00') { await entered.promise; failureIssued = true; throw failure; }
      return lstat(...args);
    }) as typeof fs.lstat);
    const restoring = manager().initialize(); pending.push(restoring);
    const result = restoring.then(() => { settled = true; }, error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(blocked && failureIssued).toBe(true));
      await tick();
      expect(settled).toBe(false); expect(rootClosed).toBe(false);
      expect(inspected).not.toContain('record-16');
    } finally { entered.resolve(); held.resolve(); }
    expect(await result).toBe(failure);
    expect(rootClosed).toBe(true);
    expect(inspected).not.toContain('record-16');
  });

  it('preserves canonical hard-link mode decisions even when an earlier chmod is delayed', async () => {
    const first = await makeFile('aliases/a');
    const second = path.join(config.homeDir, 'aliases/b');
    await fs.link(first, second);
    await capture();
    await store.update<Manifest>(FILE_METADATA_KEY, { entries: [] }, value => ({
      ...value, entries: value.entries.map(entry => entry.root === 'home' && entry.path === 'aliases/a' ? { ...entry, mode: 0o700 } : entry),
    }));
    const held = deferred(), open = fs.open.bind(fs), lstat = fs.lstat.bind(fs);
    let changingFirst = false, inspectedSecond = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (path.basename(String(args[0])) === 'a') {
        const chmod = handle.chmod.bind(handle);
        handle.chmod = async mode => { changingFirst = true; await held.promise; await chmod(mode); };
      }
      return handle;
    });
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const value = await lstat(...args);
      if (path.basename(String(args[0])) === 'b') inspectedSecond = true;
      return value;
    }) as typeof fs.lstat);
    const restoring = manager().initialize(); pending.push(restoring); void restoring.catch(() => undefined);
    try { await vi.waitFor(() => expect(changingFirst && inspectedSecond).toBe(true)); }
    finally { held.resolve(); }
    await restoring;
    expect((await fs.stat(first)).ino).toBe((await fs.stat(second)).ino);
    expect((await fs.stat(first)).mode & 0o7777).toBe(0o600);
    expect((await fs.stat(second)).mode & 0o7777).toBe(0o600);
    expect(await fs.readFile(first, 'utf8')).toBe('retained contents: aliases/a');
  });

  it('keeps separated parent runs and cross-group hard links in canonical order', async () => {
    const names = ['group/a0', 'group/a1', 'group/inside/b0', 'group/inside/b1', 'group/z0', 'group/z1'];
    const first = await makeFile(names[0]);
    for (const name of names.slice(1)) {
      const target = path.join(config.homeDir, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.link(first, target);
    }
    await capture();
    await store.update<Manifest>(FILE_METADATA_KEY, { entries: [] }, value => ({
      ...value, entries: value.entries.map(entry => entry.kind === 'file' ? { ...entry,
        mode: entry.path.startsWith('group/a') ? 0o700 : entry.path.startsWith('group/inside/') ? 0o640 : 0o600 } : entry),
    }));
    const open = fs.open.bind(fs), lstat = fs.lstat.bind(fs), held = deferred();
    const changed: number[] = [], inspected = new Set<string>();
    let firstWaiting = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if ((await handle.stat()).isFile()) {
        const chmod = handle.chmod.bind(handle);
        handle.chmod = async mode => {
          if (path.basename(String(args[0])) === 'a0') { firstWaiting = true; await held.promise; }
          changed.push(Number(mode)); await chmod(mode);
        };
      }
      return handle;
    });
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const value = await lstat(...args);
      if (/^[abz][01]$/.test(path.basename(String(args[0])))) inspected.add(path.basename(String(args[0])));
      return value;
    }) as typeof fs.lstat);
    const restoring = manager().initialize(); pending.push(restoring); void restoring.catch(() => undefined);
    try { await vi.waitFor(() => { expect(firstWaiting).toBe(true); expect(inspected.size).toBe(6); }); }
    finally { held.resolve(); }
    await restoring;
    expect(changed).toEqual([0o700, 0o640, 0o600]);
    for (const name of names) {
      expect((await fs.stat(path.join(config.homeDir, name))).mode & 0o7777).toBe(0o600);
      expect(await fs.readFile(path.join(config.homeDir, name), 'utf8')).toBe('retained contents: group/a0');
    }
  });

  it('uses the original per-entry fallback for a missing parent with mixed files and symlinks', async () => {
    await makeFile('missing/a-regular'); await makeFile('missing/c-regular');
    await fs.symlink('a-regular', path.join(config.homeDir, 'missing/b-link'));
    await fs.symlink('c-regular', path.join(config.homeDir, 'missing/d-link'));
    await capture();
    await fs.rm(path.join(config.homeDir, 'missing'), { recursive: true });
    const metadata = manager(); await metadata.initialize();
    expect((await fs.readdir(path.join(config.homeDir, 'missing'))).sort()).toEqual(['b-link', 'd-link']);
    expect(await fs.readlink(path.join(config.homeDir, 'missing/b-link'))).toBe('a-regular');
    expect(await fs.readlink(path.join(config.homeDir, 'missing/d-link'))).toBe('c-regular');
    for (const name of ['a-regular', 'c-regular']) expect(metadata.status().issues)
      .toContainEqual({ root: 'home', path: 'missing/' + name, reason: 'missing-file' });
  });

  it('reports every affected leaf when shared parent traversal is unsafe', async () => {
    await makeFile('group/a'); await makeFile('group/b');
    await capture();
    const outside = path.join(directory, 'outside');
    await fs.mkdir(outside);
    for (const name of ['a', 'b']) await fs.writeFile(path.join(outside, name), 'outside-' + name, { mode: 0o640 });
    await fs.rm(path.join(config.homeDir, 'group'), { recursive: true });
    await fs.symlink(outside, path.join(config.homeDir, 'group'));
    const metadata = manager(); await metadata.initialize();
    for (const name of ['a', 'b']) {
      expect(metadata.status().issues).toContainEqual({ root: 'home', path: 'group/' + name, reason: 'unsafe-parent' });
      expect(await fs.readFile(path.join(outside, name), 'utf8')).toBe('outside-' + name);
      expect((await fs.stat(path.join(outside, name))).mode & 0o7777).toBe(0o640);
    }
  });

  it('revalidates a shared parent for every leaf after a rename and symlink substitution', async () => {
    const source = path.join(config.homeDir, 'group'), outside = path.join(directory, 'outside');
    await makeFile('group/a'); await makeFile('group/b');
    await capture();
    await fs.chmod(path.join(source, 'a'), 0o644); await fs.chmod(path.join(source, 'b'), 0o644);
    await fs.mkdir(outside);
    for (const name of ['a', 'b']) await fs.writeFile(path.join(outside, name), 'outside-' + name, { mode: 0o640 });
    const open = fs.open.bind(fs), realpath = fs.realpath.bind(fs);
    let parentAccess = '', checks = 0, swapped = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (!parentAccess && path.basename(String(args[0])) === 'group') parentAccess = '/proc/self/fd/' + handle.fd;
      return handle;
    });
    vi.spyOn(fs, 'realpath').mockImplementation(async (...args: Parameters<typeof fs.realpath>) => {
      // openDirectory and withParent supply the first two checks. The next
      // checks must still validate the pinned parent separately for each leaf.
      if (String(args[0]) === parentAccess && ++checks === 4) {
        swapped = true;
        await fs.rename(source, path.join(directory, 'moved-original'));
        await fs.symlink(outside, source);
      }
      return realpath(...args);
    });
    const metadata = manager(); await metadata.initialize();
    expect(swapped).toBe(true);
    expect(metadata.status().issues.some(issue => issue.reason === 'unsafe-parent' && issue.path.startsWith('group/'))).toBe(true);
    for (const name of ['a', 'b']) {
      expect(await fs.readFile(path.join(outside, name), 'utf8')).toBe('outside-' + name);
      expect((await fs.stat(path.join(outside, name))).mode & 0o7777).toBe(0o640);
    }
  });

  it('drains a shared parent after callback failure without replaying a completed sibling', async () => {
    const files = await Promise.all(['a', 'b', 'c'].map(name => makeFile('group/' + name)));
    await capture(); await Promise.all(files.map(file => fs.chmod(file, 0o644)));
    const open = fs.open.bind(fs), lstat = fs.lstat.bind(fs), held = deferred(), changedFirst = deferred();
    const failure = Object.assign(new Error('Owned shared-parent callback failed.'), { code: 'EIO' });
    let firstReads = 0, firstChanges = 0, parentOpens = 0, parentClosed = false, blocked = false, failureIssued = false, settled = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args), name = path.basename(String(args[0]));
      if (name === 'group') {
        parentOpens++;
        const close = handle.close.bind(handle);
        handle.close = async () => { parentClosed = true; await close(); };
      } else if (name === 'a') {
        const chmod = handle.chmod.bind(handle);
        handle.chmod = async mode => { await chmod(mode); firstChanges++; changedFirst.resolve(); };
      }
      return handle;
    });
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const name = path.basename(String(args[0]));
      if (name === 'a') firstReads++;
      if (name === 'b') { blocked = true; await held.promise; }
      if (name === 'c') { await changedFirst.promise; failureIssued = true; throw failure; }
      return lstat(...args);
    }) as typeof fs.lstat);
    const restoring = manager().initialize(); pending.push(restoring);
    const result = restoring.then(() => { settled = true; }, error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(blocked && failureIssued).toBe(true));
      await tick();
      expect(settled).toBe(false); expect(parentClosed).toBe(false); expect(parentOpens).toBe(1);
    } finally { held.resolve(); changedFirst.resolve(); }
    expect(await result).toBe(failure);
    expect(parentClosed).toBe(true);
    expect(firstReads).toBe(1); expect(firstChanges).toBe(1);
  });

  it('creates parents before descendants and applies restrictive modes deepest-first and root-last', async () => {
    for (const relative of ['tree/a/deep/end', 'tree/b/deep/end']) await fs.mkdir(path.join(config.homeDir, relative), { recursive: true });
    await capture();
    await store.update<Manifest>(FILE_METADATA_KEY, { entries: [] }, value => ({
      ...value, entries: value.entries.map(entry => entry.root === 'home' && entry.kind === 'directory'
        ? { ...entry, mode: 0o500, restoreMissing: true } : entry),
    }));
    await fs.rm(path.join(config.homeDir, 'tree'), { recursive: true });
    const mkdir = fs.mkdir.bind(fs), open = fs.open.bind(fs);
    const created: string[] = [], chmodded: string[] = [];
    const relative = async (access: string) => path.relative(config.homeDir, await fs.realpath(access));
    vi.spyOn(fs, 'mkdir').mockImplementation((async (...args: Parameters<typeof fs.mkdir>) => {
      const value = await mkdir(...args);
      const name = await relative(String(args[0]));
      if (name && !name.startsWith('..')) created.push(name);
      return value;
    }) as typeof fs.mkdir);
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if ((await handle.stat()).isDirectory()) {
        const chmod = handle.chmod.bind(handle);
        handle.chmod = async mode => {
          const name = await relative('/proc/self/fd/' + handle.fd);
          if (!name.startsWith('..')) {
            expect(created).toHaveLength(7);
            chmodded.push(name);
          }
          await chmod(mode);
        };
      }
      return handle;
    });
    await manager().initialize();
    expect(new Set(created).size).toBe(7);
    for (const child of created) {
      const parent = path.dirname(child);
      if (parent !== '.') expect(created.indexOf(parent)).toBeLessThan(created.indexOf(child));
    }
    const depths = chmodded.map(relative => relative ? relative.split('/').length : 0);
    expect(depths).toEqual([...depths].sort((left, right) => right - left));
    expect(chmodded.at(-1)).toBe('');
    expect(chmodded).toHaveLength(8);
    for (const entry of created) expect((await fs.stat(path.join(config.homeDir, entry))).mode & 0o7777).toBe(0o500);
  });

  it('bounds pinned descriptors for mixed paths including the maximum supported depth', async () => {
    for (const base of ['deep-a', 'deep-b']) {
      const relative = [base, ...Array.from({ length: 126 }, () => 'd'), 'leaf'].join('/');
      await makeFile(relative);
    }
    await Promise.all(Array.from({ length: 24 }, (_, index) => makeFile('shallow/item-' + index)));
    await capture();
    const open = fs.open.bind(fs), opened = new Set<FileHandle>();
    let peak = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      opened.add(handle); peak = Math.max(peak, opened.size);
      const close = handle.close.bind(handle);
      handle.close = async () => { try { await close(); } finally { opened.delete(handle); } };
      return handle;
    });
    await manager().initialize();
    expect(peak).toBeGreaterThan(120);
    expect(peak).toBeLessThanOrEqual(256);
    expect(opened.size).toBe(0);
  });

  it('preserves a replacement inode and mode when a leaf changes before its descriptor opens', async () => {
    const filename = await makeFile('target');
    await capture();
    await fs.chmod(filename, 0o644);
    const open = fs.open.bind(fs);
    let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (!replaced && path.basename(String(args[0])) === 'target') {
        replaced = true;
        const replacement = path.join(config.homeDir, 'replacement');
        await fs.writeFile(replacement, 'new independent bytes', { mode: 0o640 });
        await fs.rename(replacement, filename);
      }
      return open(...args);
    });
    const metadata = manager(); await metadata.initialize();
    expect(replaced).toBe(true);
    expect((await fs.stat(filename)).mode & 0o7777).toBe(0o640);
    expect(await fs.readFile(filename, 'utf8')).toBe('new independent bytes');
    expect(metadata.status().issues).toContainEqual({ root: 'home', path: 'target', reason: 'existing-file' });
  });
});
