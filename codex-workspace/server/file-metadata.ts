import fs, { type FileHandle } from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import type { EventEmitter } from 'node:events';
import type { AppConfig } from './config';
import type { JsonStore } from './store';

export const FILE_METADATA_KEY = 'filesystem-metadata';
const CAPTURE_INTERVAL_MS = 20_000;
const DEBOUNCE_MS = 750;
const MAX_DEBOUNCE_MS = 5_000;
const MAX_ENTRIES = 250_000;
const MAX_DEPTH = 128;
const MAX_SCAN_MS = 90_000;
const STAT_CONCURRENCY = 16;
const RESTORE_CONCURRENCY = 16;
// Includes the shared root and all parent/leaf handles in one restore batch.
const RESTORE_HANDLE_BUDGET = 256;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

type RootName = 'workspaces' | 'home' | 'native-codex';
type Config = Pick<AppConfig, 'workspacesDir' | 'homeDir'>;
type EntryKind = 'directory' | 'file' | 'symlink';
type RestorePhase = 'create-directories' | 'leaves' | 'directory-modes';

interface MetadataEntry {
  root: RootName;
  path: string;
  kind: EntryKind;
  mode: number;
  mtimeMs: number;
  size: number;
  target?: string;
  /** Directory-only: false preserves its mode without recreating an absent path.
   * Omission retains the legacy directory-restoration behavior. */
  restoreMissing?: boolean;
}

interface Manifest {
  /** v2 adds the explicitly configured native Codex home; v1 keeps its original two roots. */
  version: 1 | 2;
  revision: number;
  capturedAt: string;
  entries: MetadataEntry[];
  /** Top-level workspace trees known to contain durable regular-file bytes. */
  workspaceFileRoots?: string[];
}

interface ScanResult { entries: MetadataEntry[]; workspaceFileRoots: string[] }
export interface FileMetadataOptions {
  /** Durable deletion journals are consulted before any old metadata is restored. */
  workspaceRestoreExclusions?: () => Promise<readonly string[]>;
  /** Explicit application-owned CODEX_HOME, separate from workspaces and HOME.
   * This preserves metadata only, never reconstructs native state file bytes. */
  nativeCodexHomeDir?: string;
  /** Restore saved metadata before readiness, then refresh it when start() runs. */
  deferInitialCapture?: boolean;
  /** Slow remote volumes need a larger bounded traversal budget (at most 10 minutes). */
  scanTimeoutMs?: number;
}

export interface FileMetadataIssue {
  root: RootName;
  path: string;
  reason: 'existing-file' | 'different-symlink' | 'unsafe-parent' | 'missing-file' | 'permission-denied';
}

export interface FileMetadataStatus {
  initialized: boolean;
  capturing: boolean;
  entries: number;
  revision: number;
  lastCapturedAt: string | null;
  lastSavedAt: string | null;
  error: string | null;
  issues: FileMetadataIssue[];
  issueCount: number;
}

interface Directory {
  handle: FileHandle;
  absolute: string;
  access: string;
}

const errno = (error: unknown, code: string) => (error as NodeJS.ErrnoException | undefined)?.code === code;
const entryKey = (entry: Pick<MetadataEntry, 'root' | 'path'>) => `${entry.root}:${entry.path}`;
const permissions = (stat: Stats) => stat.mode & 0o7777;
const within = (root: string, candidate: string) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

/** Native Codex owns these process-scoped trees, including their directories,
 * lock files and helper symlinks. Restoring any of that metadata can resurrect
 * expired helpers or change live lock permissions. Verified in rust-v0.159.2:
 * codex-rs/rollout/src/writer_lock.rs, codex-rs/arg0/src/lib.rs and
 * codex-rs/core-plugins/src/startup_sync.rs. Plugin clone TempDirs are staging;
 * the activated catalog and backups kept after failed rollback stay durable.
 * This is deliberately not a general tmp, lock, SQLite/WAL/SHM exclusion. */
function nativeEphemeral(entry: Pick<MetadataEntry, 'root' | 'path'>): boolean {
  return entry.root === 'native-codex' && (['thread-writer-locks', 'tmp/arg0'].some(relative =>
    entry.path === relative || entry.path.startsWith(relative + '/'))
    || /^\.tmp\/plugins-clone-[^/]+(?:\/|$)/.test(entry.path));
}

// Native SQLite can remove these sidecars after a clean checkpoint and close.
// Existing WAL/SHM files can contain committed state and stay fully tracked.
const NATIVE_DATABASES = new Set(['state_5.sqlite', 'logs_2.sqlite', 'goals_1.sqlite', 'memories_1.sqlite',
  'memories_v2_1.sqlite', 'queue_1.sqlite', 'thread_history_1.sqlite']);

function invalidManifest(): Error { return new Error('The saved file metadata is invalid. Existing files were left unchanged.'); }

function partsOf(relative: string): string[] {
  if (relative === '') return [];
  if (relative.length > 4096 || relative.includes('\\') || /[\u0000-\u001f\u007f]/.test(relative)
    || path.posix.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw invalidManifest();
  const parts = relative.split('/');
  if (parts.length > MAX_DEPTH || parts.some(part => !part || part === '.' || part === '..')) throw invalidManifest();
  return parts;
}

function readManifest(value: unknown): Manifest | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw invalidManifest();
  const candidate = value as Partial<Manifest>;
  if ((candidate.version !== 1 && candidate.version !== 2) || !Number.isSafeInteger(candidate.revision) || candidate.revision! < 1
    || typeof candidate.capturedAt !== 'string' || candidate.capturedAt.length > 64 || !Number.isFinite(Date.parse(candidate.capturedAt))
    || !Array.isArray(candidate.entries) || candidate.entries.length > MAX_ENTRIES) throw invalidManifest();
  const keys = new Map<string, EntryKind>();
  const entries: MetadataEntry[] = [];
  const rootNames: RootName[] = candidate.version === 2 ? ['workspaces', 'home', 'native-codex'] : ['workspaces', 'home'];
  for (const input of candidate.entries) {
    if (!input || typeof input !== 'object' || !rootNames.includes(input.root)
      || typeof input.path !== 'string' || !['directory', 'file', 'symlink'].includes(input.kind)
      || !Number.isInteger(input.mode) || input.mode < 0 || input.mode > 0o7777
      || !Number.isFinite(input.mtimeMs) || Math.abs(input.mtimeMs) > 8.64e15
      || !Number.isSafeInteger(input.size) || input.size < 0) throw invalidManifest();
    const parts = partsOf(input.path);
    if (!parts.length && input.kind !== 'directory') throw invalidManifest();
    if (input.kind === 'symlink' && (typeof input.target !== 'string' || !input.target
      || input.target.includes('\0') || Buffer.byteLength(input.target) > 4096)) throw invalidManifest();
    if (input.restoreMissing !== undefined && (input.kind !== 'directory' || typeof input.restoreMissing !== 'boolean')) throw invalidManifest();
    const key = entryKey(input);
    if (keys.has(key)) throw invalidManifest();
    keys.set(key, input.kind);
    entries.push({ root: input.root, path: input.path, kind: input.kind, mode: input.mode,
      mtimeMs: input.mtimeMs, size: input.size, ...(input.kind === 'symlink' ? { target: input.target } : {}),
      ...(input.kind === 'directory' && input.restoreMissing !== undefined ? { restoreMissing: input.restoreMissing } : {}) });
  }
  for (const root of rootNames) if (keys.get(`${root}:`) !== 'directory') throw invalidManifest();
  for (const entry of entries) {
    const parts = partsOf(entry.path);
    for (let count = 1; count < parts.length; count++) {
      const ancestor = keys.get(`${entry.root}:${parts.slice(0, count).join('/')}`);
      if (ancestor && ancestor !== 'directory') throw invalidManifest();
    }
  }
  const workspaceFileRoots = candidate.workspaceFileRoots === undefined ? [] : candidate.workspaceFileRoots;
  if (!Array.isArray(workspaceFileRoots) || workspaceFileRoots.length > MAX_ENTRIES
    || workspaceFileRoots.some(value => typeof value !== 'string' || partsOf(value).length !== 1)
    || new Set(workspaceFileRoots).size !== workspaceFileRoots.length) throw invalidManifest();
  return { version: candidate.version, revision: candidate.revision!, capturedAt: candidate.capturedAt,
    entries: sortEntries(entries), workspaceFileRoots: [...workspaceFileRoots].sort() };
}

function sortEntries(entries: MetadataEntry[]): MetadataEntry[] {
  return entries.sort((a, b) => a.root < b.root ? -1 : a.root > b.root ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function record(root: RootName, relative: string, kind: EntryKind, stat: Stats, target?: string): MetadataEntry {
  partsOf(relative);
  return { root, path: relative, kind, mode: permissions(stat), mtimeMs: stat.mtimeMs,
    size: stat.size, ...(target === undefined ? {} : { target }) };
}

/**
 * Preserve metadata that HF's native bucket volume does not store remotely.
 * File contents remain ordinary files in the public bucket. This class never
 * mounts anything, copies file contents, or restores a live filesystem snapshot.
 */
export class FileMetadataManager {
  private readonly roots: Record<'workspaces' | 'home', string> & Partial<Record<'native-codex', string>>;
  private readonly rootNames: RootName[];
  private readonly scanTimeoutMs: number;
  private readonly descriptorRoot = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd';
  private manifest: Manifest | null = null;
  private signature = '';
  private initialized = false;
  private initialization?: Promise<void>;
  private activeCapture?: Promise<void>;
  private requested = 0;
  private completed = 0;
  private interval?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private scheduledSince = 0;
  private started = false;
  private closing = false;
  private closed = false;
  private closingPromise?: Promise<void>;
  private lastCapturedAt: string | null = null;
  private error: string | null = null;
  private issues: FileMetadataIssue[] = [];
  private issueKeys = new Set<string>();
  private issueCount = 0;

  constructor(config: Config, private readonly store: JsonStore, private readonly events?: EventEmitter,
    private readonly options: FileMetadataOptions = {}) {
    this.scanTimeoutMs = options.scanTimeoutMs ?? MAX_SCAN_MS;
    if (!Number.isSafeInteger(this.scanTimeoutMs) || this.scanTimeoutMs <= 0 || this.scanTimeoutMs > 600_000) {
      throw new Error('The file metadata scan timeout must be a positive integer of at most 600000 milliseconds.');
    }
    this.roots = { workspaces: path.resolve(config.workspacesDir), home: path.resolve(config.homeDir),
      ...(options.nativeCodexHomeDir === undefined ? {} : { 'native-codex': path.resolve(options.nativeCodexHomeDir) }) };
    this.rootNames = Object.keys(this.roots) as RootName[];
    const directories = Object.values(this.roots);
    for (let i = 0; i < directories.length; i++) for (let j = i + 1; j < directories.length; j++) {
      if (within(directories[i]!, directories[j]!) || within(directories[j]!, directories[i]!)) {
        throw new Error('Workspace, home and native Codex directories must be separate metadata roots.');
      }
    }
  }

  initialize(): Promise<void> {
    if (this.closed || this.closing) return Promise.reject(new Error('File metadata manager is closed.'));
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeOnce().catch(error => {
      this.initialization = undefined;
      this.initialized = false;
      this.reportError(error);
      throw error;
    });
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    // Validate the entire manifest before creating or changing any user path.
    this.manifest = readManifest(await this.store.read<unknown>(FILE_METADATA_KEY, null));
    this.signature = this.manifest ? JSON.stringify({ entries: this.manifest.entries, workspaceFileRoots: this.manifest.workspaceFileRoots ?? [] }) : '';
    // Claude Workspace no longer runs the native Codex service. Keep the
    // historical files in the bucket, but retire their metadata root so startup
    // does not walk that large tree on every restart.
    if (this.manifest && !this.roots['native-codex']) {
      this.manifest = { ...this.manifest, entries: this.manifest.entries.filter(entry => entry.root !== 'native-codex') };
    }
    // Older captures included native process ephemera. Validate the complete
    // manifest first, then omit those entries before any filesystem restore.
    // Keep the original signature so the next normal capture also prunes the
    // saved manifest, even when all remaining durable metadata is unchanged.
    if (this.manifest) this.manifest = { ...this.manifest, entries: this.manifest.entries.filter(entry => !nativeEphemeral(entry)) };
    const excluded = await this.workspaceRestoreExclusions();
    await fs.access(this.descriptorRoot);
    for (const rootName of this.rootNames) {
      const root = this.roots[rootName]!;
      const existing = await fs.lstat(root).catch(error => { if (errno(error, 'ENOENT')) return null; throw error; });
      if (!existing) {
        const tracked = this.manifest?.entries.some(entry => entry.root === rootName && entry.path === '');
        if (tracked) throw new Error('A configured metadata root is missing. The previous snapshot was retained.');
        if (rootName === 'native-codex') await this.createNativeRoot(root);
        else await fs.mkdir(root, { recursive: true, mode: 0o755 });
      } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new Error('A configured metadata root is not a safe directory.');
      }
      if (rootName === 'native-codex' && await fs.realpath(root) !== root) {
        throw new Error('The native Codex metadata root must not use symbolic-link ancestors.');
      }
    }
    if (this.manifest) await this.restore(this.manifest, excluded);
    this.initialized = true;
    if (!this.options.deferInitialCapture) await this.capture();
  }

  start(): void {
    if (!this.initialized) throw new Error('Initialize file metadata before starting periodic capture.');
    if (this.started || this.closing || this.closed) return;
    this.started = true;
    this.events?.on('workspace:changed', this.schedule);
    this.events?.on('terminal:exit', this.schedule);
    // A slow scan already observes the filesystem; periodic ticks must not keep
    // it running forever. Explicit mutation events still queue a follow-up pass.
    this.interval = setInterval(() => { if (!this.activeCapture) this.backgroundCapture(); }, CAPTURE_INTERVAL_MS);
    this.interval.unref();
    if (this.lastCapturedAt === null) this.backgroundCapture();
  }

  private schedule = (): void => {
    if (this.closing || this.closed) return;
    if (this.activeCapture) { this.backgroundCapture(); return; }
    if (!this.scheduledSince) this.scheduledSince = Date.now();
    if (this.debounce) clearTimeout(this.debounce);
    const delay = Math.min(DEBOUNCE_MS, Math.max(0, MAX_DEBOUNCE_MS - (Date.now() - this.scheduledSince)));
    this.debounce = setTimeout(() => this.backgroundCapture(), delay);
    this.debounce.unref();
  };

  private backgroundCapture(): void {
    if (this.closing || this.closed) return;
    void this.capture().catch(() => undefined); // capture reports errors through status and the event emitter.
  }

  /** Explicit captures queue behind a capture already in progress. */
  capture(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('File metadata manager is closed.'));
    if (!this.initialized) return this.initialize().then(() => {
      // Explicit capture remains a durability barrier even when startup opts
      // out of the initial refresh. It must wait for a complete saved scan.
      if (this.options.deferInitialCapture) return this.capture();
    });
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
    this.scheduledSince = 0;
    this.requested++;
    if (!this.activeCapture) {
      const running = this.drainCaptures();
      this.activeCapture = running;
      void running.finally(() => { if (this.activeCapture === running) this.activeCapture = undefined; }).catch(() => undefined);
    }
    return this.activeCapture;
  }

  private async drainCaptures(): Promise<void> {
    try {
      while (this.completed < this.requested) {
        const generation = this.requested;
        const scanned = await this.scan();
        const capturedAt = new Date().toISOString();
        const signature = JSON.stringify(scanned);
        if (signature !== this.signature) {
          const next: Manifest = { version: this.roots['native-codex'] ? 2 : 1,
            revision: (this.manifest?.revision ?? 0) + 1, capturedAt, ...scanned };
          await this.store.write(FILE_METADATA_KEY, next);
          this.manifest = next;
          this.signature = signature;
        }
        this.lastCapturedAt = capturedAt;
        this.error = null;
        this.completed = generation;
      }
    } catch (error) { this.reportError(error); throw error; }
  }

  status(): FileMetadataStatus {
    return { initialized: this.initialized, capturing: Boolean(this.activeCapture), entries: this.manifest?.entries.length ?? 0,
      revision: this.manifest?.revision ?? 0, lastCapturedAt: this.lastCapturedAt,
      lastSavedAt: this.manifest?.capturedAt ?? null, error: this.error,
      issues: this.issues.map(issue => ({ ...issue })), issueCount: this.issueCount };
  }

  close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise;
    this.closing = true;
    if (this.interval) clearInterval(this.interval);
    if (this.debounce) clearTimeout(this.debounce);
    this.interval = undefined;
    this.debounce = undefined;
    this.events?.off('workspace:changed', this.schedule);
    this.events?.off('terminal:exit', this.schedule);
    this.closingPromise = (async () => {
      if (this.initialization) await this.initialization;
      if (this.initialized) await this.capture();
      this.closed = true;
    })();
    return this.closingPromise;
  }

  private reportError(error: unknown): void {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    this.error = 'File metadata could not be saved or restored. The last saved metadata was retained.';
    this.events?.emit('file-metadata:error', { message: this.error, ...(code ? { code } : {}) });
  }

  private issue(entry: Pick<MetadataEntry, 'root' | 'path'>, reason: FileMetadataIssue['reason']): void {
    if (nativeEphemeral(entry)) return;
    const key = `${entryKey(entry)}:${reason}`;
    if (this.issueKeys.has(key)) return;
    this.issueKeys.add(key);
    this.issueCount++;
    const issue = { root: entry.root, path: entry.path, reason };
    if (this.issues.length < 50) this.issues.push(issue);
    this.events?.emit('file-metadata:conflict', issue);
  }

  private async openDirectory(absolute: string, access = absolute): Promise<Directory> {
    const handle = await fs.open(access, DIRECTORY_FLAGS);
    const directory = { handle, absolute, access: `${this.descriptorRoot}/${handle.fd}` };
    try {
      if (!(await handle.stat()).isDirectory()) throw new Error('The metadata path is not a directory.');
      await this.assertLocation(directory);
      return directory;
    } catch (error) { await handle.close(); throw error; }
  }

  private async assertLocation(directory: Directory): Promise<void> {
    // Kernel descriptor paths keep traversals pinned to a verified directory.
    // A rename out of the expected tree aborts the scan instead of following it.
    if (await fs.realpath(directory.access) !== directory.absolute) {
      const error = new Error('A directory moved during file metadata processing.') as NodeJS.ErrnoException;
      error.code = 'METADATA_CHANGED';
      throw error;
    }
  }

  private async rootDirectory(root: RootName): Promise<Directory> {
    const absolute = this.roots[root];
    if (!absolute) throw invalidManifest();
    // A symlink at the configured root must not redirect the descriptor open.
    if ((await fs.lstat(absolute)).isSymbolicLink()) throw new Error('A configured metadata root is a symbolic link.');
    const canonical = await fs.realpath(absolute);
    if (root === 'native-codex' && canonical !== absolute) throw new Error('The native Codex metadata root is no longer canonical.');
    return this.openDirectory(canonical, absolute);
  }

  private async createNativeRoot(absolute: string): Promise<void> {
    const segments = absolute.split(path.sep).filter(Boolean);
    if (segments.length > MAX_DEPTH || absolute.length > 4096 || /[\u0000-\u001f\u007f]/.test(absolute)) throw invalidManifest();
    let directory = await this.openDirectory(path.parse(absolute).root);
    try {
      for (const segment of segments) {
        await this.assertLocation(directory);
        const access = `${directory.access}/${segment}`;
        await fs.mkdir(access, { mode: 0o700 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
        const next = await this.openDirectory(path.join(directory.absolute, segment), access);
        await directory.handle.close(); directory = next;
      }
      await this.assertLocation(directory);
    } finally { await directory.handle.close(); }
  }

  private async withParent<T>(root: Directory, relative: string, create: boolean,
    work: (parent: Directory, name: string) => Promise<T>): Promise<T> {
    const parts = partsOf(relative);
    if (!parts.length) throw invalidManifest();
    let current = root;
    const opened: Directory[] = [];
    try {
      await this.assertLocation(root);
      for (const name of parts.slice(0, -1)) {
        await this.assertLocation(current);
        const access = `${current.access}/${name}`;
        let next: Directory;
        try { next = await this.openDirectory(path.join(current.absolute, name), access); }
        catch (error) {
          if (!create || !errno(error, 'ENOENT')) throw error;
          await fs.mkdir(access, { mode: 0o755 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
          next = await this.openDirectory(path.join(current.absolute, name), access);
        }
        opened.push(next);
        current = next;
      }
      await this.assertLocation(current);
      return await work(current, parts[parts.length - 1]);
    } finally { for (const directory of opened.reverse()) await directory.handle.close(); }
  }

  private async workspaceRestoreExclusions(): Promise<Set<string>> {
    const values = await this.options.workspaceRestoreExclusions?.() ?? [];
    if (!Array.isArray(values) || values.length > MAX_ENTRIES) throw invalidManifest();
    const excluded = new Set<string>();
    for (const value of values) {
      if (typeof value !== 'string' || !partsOf(value).length) throw invalidManifest();
      excluded.add(value);
    }
    return excluded;
  }

  private restoreWindowEnd(entries: readonly MetadataEntry[], offset: number): number {
    let end = offset, handles = 1;
    while (end < entries.length && end - offset < RESTORE_CONCURRENCY) {
      const needed = partsOf(entries[end].path).length;
      if (end > offset && handles + needed > RESTORE_HANDLE_BUDGET) break;
      handles += needed; end++;
    }
    return end;
  }

  private async restoreWork<T>(items: readonly T[],
    operation: (item: T, previous: () => Promise<void>) => Promise<void>): Promise<void> {
    let preceding: Promise<unknown> = Promise.resolve();
    let failed = false, failure: unknown;
    const tasks: Promise<void>[] = [];
    for (const item of items) {
      const before = preceding;
      const task = Promise.resolve().then(() => operation(item, async () => {
        await before;
        if (failed) throw failure;
      })).catch(error => { if (!failed) { failed = true; failure = error; } throw error; });
      tasks.push(task);
      preceding = Promise.allSettled([before, task]);
    }
    // Every started sibling must release its handles before the owner closes
    // the shared parent/root or propagates an unexpected native I/O failure.
    await Promise.allSettled(tasks);
    if (failed) throw failure;
  }

  private async restoreDepths(root: Directory, entries: readonly MetadataEntry[],
    phase: 'create-directories' | 'directory-modes', emptyNativeTmp = false): Promise<void> {
    for (let offset = 0; offset < entries.length;) {
      const depth = partsOf(entries[offset].path).length;
      let end = offset + 1;
      while (end < entries.length && partsOf(entries[end].path).length === depth) end++;
      await this.restoreGrouped(root, entries.slice(offset, end), phase, emptyNativeTmp);
      offset = end;
    }
  }

  private async absentNativeSidecar(entry: MetadataEntry, parent: Directory): Promise<boolean> {
    if (entry.root !== 'native-codex' || entry.kind !== 'file' || entry.path.includes('/')) return false;
    const base = /^(.*)-(?:wal|shm)$/.exec(entry.path)?.[1];
    if (!base || !NATIVE_DATABASES.has(base)) return false;
    const primary = await fs.lstat(parent.access + '/' + base).catch(error => {
      if (errno(error, 'ENOENT')) return null;
      throw error;
    });
    await this.assertLocation(parent);
    return Boolean(primary?.isFile() && !primary.isSymbolicLink());
  }

  private async restoreLeaf(root: Directory, parent: Directory, name: string, entry: MetadataEntry,
    previous: () => Promise<void>): Promise<void> {
    const access = parent.access + '/' + name;
    let stat = await fs.lstat(access).catch(error => { if (errno(error, 'ENOENT')) return null; throw error; });
    if (entry.kind === 'file' && stat?.isFile() && stat.nlink > 1) {
      // Aliases can have different captured modes. Wait in canonical
      // manifest order, then re-read before deciding to skip or chmod.
      await previous();
      await this.assertLocation(root); await this.assertLocation(parent);
      stat = await fs.lstat(access).catch(error => { if (errno(error, 'ENOENT')) return null; throw error; });
    }
    if (entry.kind === 'symlink') {
      if (!stat) {
        // Atomic no-clobber creation; an independently created file always wins.
        try { await fs.symlink(entry.target!, access); }
        catch (error) { if (errno(error, 'EEXIST')) this.issue(entry, 'existing-file'); else throw error; }
      } else if (!stat.isSymbolicLink()) this.issue(entry, 'existing-file');
      else if (await fs.readlink(access) !== entry.target) this.issue(entry, 'different-symlink');
    } else if (!stat) {
      if (!await this.absentNativeSidecar(entry, parent)) this.issue(entry, 'missing-file');
    } else if (!stat.isFile()) this.issue(entry, 'existing-file');
    else if (permissions(stat) !== entry.mode) {
      const file = await fs.open(access, FILE_FLAGS);
      try {
        const actual = await file.stat();
        if (!actual.isFile() || actual.dev !== stat.dev || actual.ino !== stat.ino) this.issue(entry, 'existing-file');
        else if (permissions(actual) !== entry.mode) await file.chmod(entry.mode);
      } finally { await file.close(); }
    }
  }

  private async restoreAtParent(root: Directory, parent: Directory, name: string, entry: MetadataEntry,
    phase: RestorePhase, previous: () => Promise<void>): Promise<void> {
    if (phase === 'leaves') { await this.restoreLeaf(root, parent, name, entry, previous); return; }
    if (entry.kind !== 'directory') throw invalidManifest();
    const access = parent.access + '/' + name;
    if (phase === 'create-directories') {
      await fs.mkdir(access, { mode: 0o755 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
      const stat = await fs.lstat(access);
      if (!stat.isDirectory() || stat.isSymbolicLink()) this.issue(entry, 'existing-file');
    } else {
      const directory = await this.openDirectory(path.join(parent.absolute, name), access);
      try { if (permissions(await directory.handle.stat()) !== entry.mode) await directory.handle.chmod(entry.mode); }
      finally { await directory.handle.close(); }
    }
  }

  private async restoreGroup(root: Directory, entries: readonly MetadataEntry[], phase: RestorePhase,
    previousGroups: () => Promise<void>, emptyNativeTmp: boolean): Promise<void> {
    const parentPath = path.posix.dirname(entries[0].path);
    const ordered = (previousEntries: () => Promise<void>) => async () => {
      await previousEntries();
      await previousGroups();
    };
    const allowMissing = (entry: MetadataEntry) => phase === 'directory-modes' && emptyNativeTmp
      && entry.path === 'tmp' && entry.restoreMissing === false;
    const individual = () => this.restoreWork(entries, (entry, previousEntries) => this.restoreEntry(entry, async () => {
      if (!entry.path) {
        if (phase !== 'directory-modes' || entry.kind !== 'directory') throw invalidManifest();
        await this.assertLocation(root);
        if (permissions(await root.handle.stat()) !== entry.mode) await root.handle.chmod(entry.mode);
        return;
      }
      const createParents = phase === 'create-directories' || phase === 'leaves' && entry.kind === 'symlink';
      await this.withParent(root, entry.path, createParents, (parent, name) =>
        this.restoreAtParent(root, parent, name, entry, phase, ordered(previousEntries)));
    }, allowMissing(entry)));
    // Root entries stay individual. Direct root children have no ancestor chain
    // to share; singletons keep their original traversal cost and authority.
    if (entries.length === 1 || parentPath === '.') { await individual(); return; }
    let opened = false;
    try {
      // Reuse exists only within this contiguous run of one admitted window.
      // A group never gains authority to create a missing ancestor directory.
      await this.withParent(root, entries[0].path, false, async parent => {
        opened = true;
        await this.restoreWork(entries, (entry, previousEntries) => this.restoreEntry(entry, async () => {
          await this.assertLocation(root); await this.assertLocation(parent);
          await this.restoreAtParent(root, parent, path.posix.basename(entry.path), entry, phase, ordered(previousEntries));
        }, allowMissing(entry)));
      });
    } catch (error) {
      if (opened || !['ELOOP', 'ENOTDIR', 'METADATA_CHANGED', 'ENOENT', 'EACCES', 'EPERM'].some(code => errno(error, code))) throw error;
      // Retain each entry's issue reporting and original creation policy.
      // Callback/close failures never replay work which already began.
      await individual();
    }
  }

  private async restoreGrouped(root: Directory, entries: readonly MetadataEntry[], phase: RestorePhase,
    emptyNativeTmp = false): Promise<void> {
    for (let offset = 0; offset < entries.length;) {
      const end = this.restoreWindowEnd(entries, offset);
      const groups: MetadataEntry[][] = [];
      for (const entry of entries.slice(offset, end)) {
        const previous = groups.at(-1);
        if (previous && path.posix.dirname(previous[0].path) === path.posix.dirname(entry.path)) previous.push(entry);
        else groups.push([entry]);
      }
      // Directory callers preserve their depth barriers. Leaf callers preserve
      // canonical contiguous runs, so hard-link waits only point backward.
      await this.restoreWork(groups, (group, previousGroups) => this.restoreGroup(root, group, phase, previousGroups, emptyNativeTmp));
      offset = end;
    }
  }

  private async restore(manifest: Manifest, excluded: ReadonlySet<string>): Promise<void> {
    this.issues = [];
    this.issueKeys.clear();
    this.issueCount = 0;
    // Directory/link metadata cannot replace lost ordinary file contents. Retain
    // that distinction even when all missing files had the default sparse mode.
    const fileRoots = new Set(manifest.workspaceFileRoots ?? []);
    for (const entry of manifest.entries) {
      if (entry.root === 'workspaces' && entry.kind === 'file' && entry.path.includes('/')) fileRoots.add(entry.path.split('/')[0]!);
    }
    const missingFileRoots = new Set<string>();
    for (const relative of fileRoots) {
      const existing = await fs.lstat(path.join(this.roots.workspaces, relative)).catch(error => {
        if (errno(error, 'ENOENT')) return null;
        throw error;
      });
      if (!existing) missingFileRoots.add(relative);
    }
    const isExcluded = (relative: string): boolean => {
      const parts = partsOf(relative);
      for (let length = 1; length <= parts.length; length++) {
        if (excluded.has(parts.slice(0, length).join('/'))) return true;
      }
      return false;
    };
    for (const rootName of this.rootNames) {
      const root = await this.rootDirectory(rootName);
      try {
        const entries = manifest.entries.filter(entry => {
          if (entry.root !== rootName) return false;
          if (rootName !== 'workspaces' || !entry.path) return true;
          if (isExcluded(entry.path)) return false;
          if (!missingFileRoots.has(entry.path.split('/')[0]!)) return true;
          this.issue(entry, 'missing-file');
          return false;
        });
        const directories = entries.filter(entry => entry.kind === 'directory').sort((a, b) => partsOf(a.path).length - partsOf(b.path).length);
        await this.restoreDepths(root, directories.filter(entry => entry.path && entry.restoreMissing !== false), 'create-directories');
        await this.restoreGrouped(root, entries.filter(entry => entry.kind !== 'directory'), 'leaves');
        // All leaves settle before any directory restriction; each deeper level
        // settles before its ancestors, and the root descriptor is applied last.
        const emptyNativeTmp = rootName === 'native-codex' && !entries.some(entry => entry.path.startsWith('tmp/'));
        await this.restoreDepths(root, directories.reverse(), 'directory-modes', emptyNativeTmp);
      } finally { await root.handle.close(); }
    }
  }

  private async restoreEntry(entry: MetadataEntry, operation: () => Promise<unknown>, allowMissing = false): Promise<void> {
    try { await operation(); }
    catch (error) {
      if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR') || errno(error, 'METADATA_CHANGED')) this.issue(entry, 'unsafe-parent');
      else if (errno(error, 'ENOENT')) { if (!allowMissing) this.issue(entry, 'missing-file'); }
      else if (errno(error, 'EACCES') || errno(error, 'EPERM')) this.issue(entry, 'permission-denied');
      else throw error;
    }
  }

  private async scan(): Promise<ScanResult> {
    const entries = new Map<string, MetadataEntry>();
    const workspaceFileRoots = new Set<string>();
    const started = Date.now();
    let visited = 0;
    const checkBudget = (relative: string) => {
      if (++visited > MAX_ENTRIES || partsOf(relative).length > MAX_DEPTH) {
        throw new Error('File metadata scan exceeded its size limit. The previous snapshot was retained.');
      }
      if (Date.now() - started > this.scanTimeoutMs) {
        const error = new Error('File metadata scan exceeded its time limit. The previous snapshot was retained.') as NodeJS.ErrnoException;
        error.code = 'FILE_METADATA_SCAN_TIMEOUT';
        throw error;
      }
    };
    const add = (entry: MetadataEntry) => { if (!nativeEphemeral(entry)) entries.set(entryKey(entry), entry); };
    const retainUnobserved = (root: RootName, relative: string, stat: Stats) => {
      const previous = this.manifest?.entries.find(entry => entry.root === root && entry.path === relative && entry.kind === 'directory');
      // Unreadable contents cannot authorize new directory reconstruction.
      // Preserve an existing record's explicit or legacy restoration intent.
      const restoreMissing = previous ? previous.restoreMissing : false;
      add({ ...record(root, relative, 'directory', stat), ...(restoreMissing === undefined ? {} : { restoreMissing }) });
      for (const previous of this.manifest?.entries ?? []) {
        if (previous.root === root && previous.path !== relative && (relative === '' || previous.path.startsWith(`${relative}/`))) add(previous);
      }
      if (root === 'workspaces') for (const previous of this.manifest?.workspaceFileRoots ?? []) {
        if (!relative || relative === previous || relative.startsWith(`${previous}/`)) workspaceFileRoots.add(previous);
      }
      this.issue({ root, path: relative }, 'permission-denied');
    };
    const walk = async (root: RootName, directory: Directory, relative: string): Promise<void> => {
      await this.assertLocation(directory);
      const stat = await directory.handle.stat();
      let children;
      try { children = await fs.readdir(directory.access, { withFileTypes: true }); }
      catch (error) {
        if (errno(error, 'EACCES') || errno(error, 'EPERM')) { retainUnobserved(root, relative, stat); return; }
        throw error;
      }
      // Native bucket defaults can differ after a fresh mount. Record every
      // observed mode, but only an observed empty folder authorizes recreation.
      add({ ...record(root, relative, 'directory', stat), restoreMissing: children.length === 0 });
      children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (let offset = 0; offset < children.length; offset += STAT_CONCURRENCY) {
        await this.assertLocation(directory);
        const batch = children.slice(offset, offset + STAT_CONCURRENCY);
        const stats = await Promise.all(batch.map(async child => {
          const childRelative = relative ? `${relative}/${child.name}` : child.name;
          // Skip before stat/open/readlink: transient native paths can vanish
          // during a scan and must never enter traversal or restoration.
          if (nativeEphemeral({ root, path: childRelative })) return null;
          checkBudget(childRelative);
          try { return { child, childRelative, stat: await fs.lstat(`${directory.access}/${child.name}`) }; }
          catch (error) { if (errno(error, 'ENOENT')) return null; throw error; }
        }));
        for (const item of stats) {
          if (!item) continue;
          const { child, childRelative, stat } = item;
          const access = `${directory.access}/${child.name}`;
          if (stat.isSymbolicLink()) {
            try {
              const target = await fs.readlink(access);
              const after = await fs.lstat(access);
              if (!after.isSymbolicLink() || after.ino !== stat.ino || after.dev !== stat.dev || after.ctimeMs !== stat.ctimeMs) {
                const error = new Error('A symbolic link changed during file metadata capture.') as NodeJS.ErrnoException;
                error.code = 'METADATA_CHANGED'; throw error;
              }
              add(record(root, childRelative, 'symlink', stat, target));
            } catch (error) { if (!errno(error, 'ENOENT')) throw error; }
          } else if (stat.isDirectory()) {
            let nested: Directory;
            try { nested = await this.openDirectory(path.join(directory.absolute, child.name), access); }
            catch (error) {
              if (errno(error, 'ENOENT')) continue;
              if (errno(error, 'EACCES') || errno(error, 'EPERM')) { retainUnobserved(root, childRelative, stat); continue; }
              throw error;
            }
            try { await walk(root, nested, childRelative); }
            finally { await nested.handle.close(); }
          } else if (stat.isFile()) {
            if (root === 'workspaces' && childRelative.includes('/')) workspaceFileRoots.add(childRelative.split('/')[0]!);
            add(record(root, childRelative, 'file', stat));
          }
          // Sockets, FIFOs, devices, and live processes have no durable bucket representation.
        }
      }
      await this.assertLocation(directory);
    };
    for (const rootName of this.rootNames) {
      const root = await this.rootDirectory(rootName);
      try { checkBudget(''); await walk(rootName, root, ''); }
      finally { await root.handle.close(); }
    }
    if (entries.size > MAX_ENTRIES) throw new Error('The file metadata manifest exceeds its entry limit.');
    return { entries: sortEntries([...entries.values()]), workspaceFileRoots: [...workspaceFileRoots].sort() };
  }
}
