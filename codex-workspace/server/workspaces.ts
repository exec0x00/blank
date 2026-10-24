import { randomUUID, createHash } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import express, { Router } from 'express';
import ignore from 'ignore';
import type { AppConfig } from './config';
import type { AppContext } from './context';
import type { JsonStore } from './store';
import { HttpError } from './errors';
import { HOST_RULES } from './agent/host-policy';
import type { FileContent, FileEntry, SearchMatch, Workspace } from '../shared/types';
import type { WorkspaceWorktree } from './worktrees/types';
import { acquireWorkspaceActivity } from './worktrees/activity';
import { WorkspaceTrashService, type WorkspaceArtifactCleanupRequest, type WorkspaceLifecycleOptions } from './workspace-trash/service';
import type { WorkspaceDeleteResult, WorkspaceDeletionPage, WorkspaceDeletionPlan, WorkspaceDeletionStatus, WorkspaceTrashDeleteResult, WorkspaceTrashEntry, WorkspaceTrashPage, WorkspaceTrashRecord } from './workspace-trash/types';
import { matchingTrashArchive, matchingTrashRestore, readTrashRecord, trashRestoreKey, TRASH_ID, TRASH_RETENTION_MS } from './workspace-trash/records';
import { GITHUB_REPOSITORY } from './workspace-trash/classification';
import { fileTrashIssueKey } from './workspace-trash/retention';
import { FileTrashPager, fileTrashPageInput, getFileTrashEntry, legacyFileTrashList, validFileTrashId, type FileTrashPage, type FileTrashPageInput } from './file-trash-pages';
import { checkedDirectory, inspectWorkspaceRoot } from './workspace-trash/filesystem';
import { getWorkspacePage, getWorkspacePageFor, workspaceMetadataChanged, workspacePageInput } from './workspace-pages';
import { parseOperationalPageQuery, type OperationalPageInput } from './operational-pages';
import { listWorkspaceFileTransfers, listWorkspaceFileTransfersPage, recoverFileTransfers, transferWorkspaceEntry } from './file-transfers/service';
import { fileIdentity, type FileTransferPage, type FileTransferStatus, type TransferKind } from './file-transfers/types';
import { withWorkspaceFileMutation } from './file-transfers/queue';

const runFile = promisify(execFile);
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_SEARCH_BYTES = 24 * 1024 * 1024;
const MAX_SEARCH_FILES = 2500;
const MAX_SEARCH_MATCHES = 1000;
const MAX_REPLACEMENTS = 20_000;
const WORKSPACE_RECORD_PREFIX = 'workspace-record-';
const WORKSPACE_LEGACY_PREFIX = 'workspace-legacy-';
const WORKSPACE_LEGACY_REVISION_PREFIX = 'workspace-legacy-v-';
const WORKSPACE_ARCHIVED_PREFIX = 'workspace-archived-';
const WORKTREE_RESTORED_PREFIX = 'workspace-restored-';
const WORKSPACE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_REGISTRY_RECORDS = 50_000;
const MAX_LEGACY_WORKSPACES = 5000;
const SEARCH_SKIP = new Set(['.git', 'node_modules', '.cache', '.next', '.venv', 'venv', 'dist', 'build', '.codex-trash']);
const STARTER_README_PREFIX = '# My workspace\n\nYour files, terminal, and coding agent share this workspace.\n\n- Open a file in the editor and save your changes.\n- Use the terminal to work on this instance.\n';
const STARTER_README_SUFFIX = '\nWorkspace files are stored in the configured persistent data directory.\n';
export const STARTER_README = `${STARTER_README_PREFIX}- Connect each GitHub account once to import repositories. Your connected accounts stay saved.\n- Choose a model and start a conversation. No provider sign-in is needed.\n${STARTER_README_SUFFIX}`;
const LEGACY_STARTER_READMES = [
  'Add your model API key in Settings to start an agent conversation.',
  'Connect ChatGPT or add an OpenAI API key in Settings to start an agent conversation.',
].map(instruction => Buffer.from(`${STARTER_README_PREFIX}- Connect a GitHub account to import an existing repository.\n- ${instruction}\n${STARTER_README_SUFFIX}`));
const LEGACY_STARTER_AGENTS = '# Workspace instructions\n\nWork in this workspace directory and preserve existing user changes.\n\n- Never use a proxy for model or provider requests.\n- Never mount a filesystem or invoke mount, umount, fusermount, or similar commands.\n- Never use proot, Docker, Podman, containers, or sandbox machinery.\n- Use the existing host directly. Persistent storage is configured by the hosting platform.\n- Never print credentials or include them in source code or Git remotes.\n';
const LEGACY_STARTER_AGENT_TEMPLATES = [
  LEGACY_STARTER_AGENTS,
  LEGACY_STARTER_AGENTS.replace('Never use a proxy for model or provider requests.', 'Use the configured model service; never create or configure additional proxies.'),
].map(template => Buffer.from(template));
export const STARTER_AGENTS = `# Workspace instructions\n\nWork in this workspace directory and preserve existing user changes.\n\n${HOST_RULES}\n`;
const isErrno = (error: unknown, code: string) => !!error && typeof error === 'object' && 'code' in error && error.code === code;
const versionOf = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

function relativePath(value: unknown, allowRoot = true): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(value)
    || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value) || value.split('/').includes('..')) {
    throw new HttpError(400, 'Use a relative path inside this workspace.', 'INVALID_PATH');
  }
  const normalized = path.posix.normalize(value || '.');
  const result = normalized === '.' ? '' : normalized.replace(/\/$/, '');
  if (!allowRoot && !result) throw new HttpError(400, 'Choose a file or folder, not the workspace root.', 'INVALID_PATH');
  if (result.split('/').some(part => part.startsWith('.codex-write-'))) {
    throw new HttpError(400, 'This file name is reserved for temporary saves.', 'INVALID_PATH');
  }
  return result;
}

function workspaceName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(400, 'Workspace names must contain 1–100 readable characters.', 'INVALID_NAME');
  }
  return value.trim();
}

function textContent(bytes: Buffer): string {
  if (bytes.includes(0)) throw new HttpError(415, 'This is a binary file. Download it to view its contents.', 'BINARY_FILE');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new HttpError(415, 'This file is not UTF-8 text. Download it to preserve its encoding.', 'BINARY_FILE'); }
}

function languageFor(filePath: string): string {
  const languages: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript',
    mjs: 'javascript', cjs: 'javascript', json: 'json', jsonc: 'json', ipynb: 'json', md: 'markdown', mdx: 'markdown',
    py: 'python', pyi: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', swift: 'swift', rb: 'ruby', php: 'php', html: 'html',
    htm: 'html', vue: 'html', svelte: 'html', css: 'css', scss: 'scss', less: 'less', xml: 'xml', svg: 'xml',
    yaml: 'yaml', yml: 'yaml', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', sql: 'sql',
    toml: 'ini', ini: 'ini', conf: 'ini', env: 'ini', r: 'r', dart: 'dart', lua: 'lua', graphql: 'graphql',
    gql: 'graphql', dockerfile: 'dockerfile', bat: 'bat', ps1: 'powershell', log: 'plaintext', txt: 'plaintext',
  };
  const name = path.posix.basename(filePath).toLowerCase();
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  if (name === '.gitignore' || name.startsWith('.env')) return 'ini';
  return languages[name.split('.').pop() ?? ''] ?? 'plaintext';
}

function fileResult(filePath: string, bytes: Buffer): FileContent {
  return { path: filePath, content: textContent(bytes), version: versionOf(bytes), language: languageFor(filePath), size: bytes.length };
}

function sameFileVersion(before: Stats, after: Stats): boolean {
  return before.isFile() && after.isFile() && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

/** Startup-only migration: compare exact generated bytes twice and never follow a workspace or file link. */
async function migrateStarterInstructions(config: AppConfig, workspaces: Workspace[]): Promise<void> {
  const configuredBase = path.resolve(config.workspacesDir);
  const base = await fs.realpath(configuredBase);
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace.path !== 'string') continue;
    const declaredRoot = path.resolve(workspace.path);
    if (!within(configuredBase, declaredRoot) || configuredBase === declaredRoot) continue;
    const expectedRoot = path.join(base, path.relative(configuredBase, declaredRoot));
    try {
      const rootStat = await fs.lstat(declaredRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(declaredRoot) !== expectedRoot) continue;
      for (const [name, previous, replacement] of [
        ['README.md', LEGACY_STARTER_READMES, STARTER_README],
        ['AGENTS.md', LEGACY_STARTER_AGENT_TEMPLATES, STARTER_AGENTS],
      ] as const) {
        const filePath = path.join(expectedRoot, name);
        let temporary: string | undefined;
        try {
          const before = await fs.lstat(filePath);
          if (!before.isFile() || before.isSymbolicLink() || before.size > 4096) continue;
          const original = await readBounded(filePath, 4096);
          if (!previous.some(template => template.equals(original)) || !sameFileVersion(before, await fs.lstat(filePath))) continue;
          temporary = path.join(expectedRoot, `.codex-write-${randomUUID()}`);
          await fs.writeFile(temporary, replacement, { flag: 'wx', mode: before.mode & 0o777 });
          // Initialization gates this service's writers. Recheck external edits after staging, before replacement.
          if (await fs.realpath(declaredRoot) !== expectedRoot) continue;
          const currentRoot = await fs.lstat(declaredRoot);
          if (!currentRoot.isDirectory() || currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino) continue;
          const current = await readBounded(filePath, 4096);
          if (!current.equals(original) || !sameFileVersion(before, await fs.lstat(filePath))) continue;
          await fs.rename(temporary, filePath);
        } catch (error) {
          // Optional copy updates must not prevent startup when files were removed, protected, or replaced.
          if (!(error instanceof HttpError) && !['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM', 'EROFS'].some(code => isErrno(error, code))) throw error;
        } finally {
          if (temporary) await fs.unlink(temporary).catch(error => { if (!isErrno(error, 'ENOENT')) throw error; });
        }
      }
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM', 'EROFS'].some(code => isErrno(error, code))) throw error;
    }
  }
}

async function lstatMaybe(filePath: string): Promise<Stats | null> {
  try { return await fs.lstat(filePath); }
  catch (error) { if (isErrno(error, 'ENOENT')) return null; throw error; }
}

async function readBounded(filePath: string, limit: number): Promise<Buffer> {
  let handle;
  try { handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (isErrno(error, 'ELOOP')) throw new HttpError(403, 'The file changed into a symbolic link. Refresh and try again.', 'UNSAFE_PATH');
    if (isErrno(error, 'ENOENT')) throw new HttpError(404, 'File not found.', 'FILE_NOT_FOUND');
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HttpError(400, 'Choose a regular file.', 'NOT_A_FILE');
    if (stat.size > limit) throw new HttpError(413, `This file exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit.`, 'FILE_TOO_LARGE');
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw new HttpError(413, 'This file grew beyond the size limit while being read.', 'FILE_TOO_LARGE');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

export interface TrashEntry { id: string; path: string; kind: 'file' | 'directory'; deletedAt: string; expiresAt: string }
export interface SearchOptions { caseSensitive?: boolean; regex?: boolean; include?: string }
export interface ReplaceOptions { query: string; replacement: string; paths?: string[]; caseSensitive?: boolean }
interface SearchDocument { path: string; content: string }

/** Files are native host files. This service never mounts a filesystem or starts a sandbox. */
export class WorkspaceService {
  private initialization?: Promise<void>;
  private knownWorkspaceIds = new Set<string>();
  private legacyRevisions = new Map<string, Set<string>>();
  private legacySignature?: string;
  private legacyImport?: Promise<void>;
  private fileTrashPages?: FileTrashPager;
  private readonly fileMutationController = new AbortController();
  private readonly fileMutations = new Set<Promise<unknown>>();
  private fileMutationsClosed?: Promise<void>;
  private readonly workspaceTrash: WorkspaceTrashService;
  private readonly checkpointFileMetadata?: () => Promise<void>;
  private readonly lifecycleOptions: WorkspaceLifecycleOptions;

  constructor(private readonly config: AppConfig, private readonly store: JsonStore, options: WorkspaceLifecycleOptions = {}) {
    this.lifecycleOptions = options;
    this.checkpointFileMetadata = options.checkpointFileMetadata;
    this.workspaceTrash = new WorkspaceTrashService(config, store, {
      registration: id => this.retainedRegistration(id),
      registrations: () => this.retainedRegistrations(),
      active: async id => !!await this.readWorkspace(id),
      archivedBy: (id, trashId) => this.archivedByTrash(id, trashId),
      restoredBy: async (id, trashId) => {
        const acknowledged = matchingTrashRestore(await this.store.read<unknown>(trashRestoreKey(id, trashId), null), id, trashId);
        if (!acknowledged) return false;
        return matchingTrashArchive(await this.store.read<unknown>(`${WORKSPACE_ARCHIVED_PREFIX}${id}`, null), id, trashId) ? 'current' : 'previous';
      },
      archive: record => this.archiveForTrash(record),
      restore: record => this.restoreFromTrash(record),
      repairSelection: () => this.repairActiveSelection(),
    }, options);
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeOnce().catch(error => { this.initialization = undefined; throw error; });
    }
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    await fs.mkdir(this.config.workspacesDir, { recursive: true, mode: 0o700 });
    const saved = await this.store.read<Workspace[] | null>('workspaces', null);
    await this.importLegacy(saved);
    await this.workspaceTrash.initialize();
    const registered = await this.availableRegistry(await this.readRegistry());
    // Tombstones also count as initialized state: archiving every workspace must stay empty.
    if (saved !== null || this.knownWorkspaceIds.size) { await migrateStarterInstructions(this.config, registered); return; }
    const starter = await this.createRegistered({ name: 'My workspace' });
    await fs.writeFile(path.join(starter.path, 'README.md'), STARTER_README, { flag: 'wx' });
    await fs.writeFile(path.join(starter.path, 'AGENTS.md'), STARTER_AGENTS, { flag: 'wx' });
    await this.store.update<string | null>('active-workspace', null, current => current ?? starter.id);
  }

  async list(): Promise<Workspace[]> {
    await this.initialize();
    await this.refreshLegacy();
    return this.availableRegistry(await this.readRegistry());
  }

  /** Derived paging metadata only. Individual returned/selected roots are checked by getAvailable. */
  async listMetadata(): Promise<Workspace[]> {
    await this.initialize();
    await this.refreshLegacy();
    return this.readRegistry(32 * 1024 * 1024);
  }

  /** Internal durability barrier for an already admitted file recovery. This
   * captures ordinary Unix metadata; it does not restore or mutate file bytes. */
  async checkpointMetadataForRecovery(): Promise<void> {
    if (!this.checkpointFileMetadata) {
      if (this.config.requirePersistentData) throw new HttpError(503, 'Durable file metadata capture is unavailable. The file rewind was not confirmed.', 'FILE_REWIND_METADATA_UNAVAILABLE');
      return;
    }
    await this.checkpointFileMetadata();
  }

  private async availableRegistry(registered: Workspace[]): Promise<Workspace[]> {
    const available: Workspace[] = [];
    for (let start = 0; start < registered.length; start += 12) {
      const batch = await Promise.all(registered.slice(start, start + 12).map(async workspace =>
        await this.workspaceTrash.reconcileMissing(workspace) ? null : workspace));
      for (const workspace of batch) if (workspace) available.push(workspace);
    }
    return available;
  }

  private async retainedRegistration(id: string): Promise<Workspace | null> {
    if (typeof id !== 'string' || !WORKSPACE_ID.test(id)) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
    const value = await this.store.read<Workspace | null>(`${WORKSPACE_RECORD_PREFIX}${id}`, null) ?? await this.readLegacyWorkspace(id);
    return value ? this.checkedWorkspace(value, id) : null;
  }

  private async retainedRegistrations(): Promise<Workspace[]> {
    await this.scanRegistry();
    const registrations: Workspace[] = [];
    for (const id of this.knownWorkspaceIds) {
      const workspace = await this.retainedRegistration(id);
      if (workspace) registrations.push(workspace);
    }
    return registrations;
  }

  private async archivedByTrash(id: string, trashId: string): Promise<boolean> {
    const marker = await this.store.read<unknown>(`${WORKSPACE_ARCHIVED_PREFIX}${id}`, null);
    const managed = this.worktreeArchiveGeneration(marker, id);
    if (managed === trashId.replace(/-/g, '') && (marker as { trashId?: unknown })?.trashId === trashId) return this.isArchived(id);
    return matchingTrashArchive(marker, id, trashId) && await this.isArchived(id);
  }

  private async archiveForTrash(record: WorkspaceTrashRecord): Promise<void> {
    const id = record.workspace.id;
    const current = await this.retainedRegistration(id);
    if (!current || current.path !== record.workspace.path) throw new HttpError(409, 'The workspace registration changed before deletion. No files were moved.', 'WORKSPACE_TRASH_RECOVERY');
    const key = `${WORKSPACE_ARCHIVED_PREFIX}${id}`;
    const observed = await this.store.read<unknown>(key, null);
    const marker = { id, archivedAt: record.deletedAt, trashId: record.id,
      ...(record.workspace.worktree
        ? { kind: 'managed-worktree', generation: record.id.replace(/-/g, '') }
        : { kind: 'workspace-trash' }) };
    await this.store.update<unknown>(key, null, latest => {
      if (JSON.stringify(latest) !== JSON.stringify(observed)) throw new HttpError(409, 'Another workspace lifecycle change arrived before deletion. No files were moved.', 'WORKSPACE_TRASH_RECOVERY');
      return marker;
    });
    workspaceMetadataChanged(this, id);
  }

  private async restoreFromTrash(record: WorkspaceTrashRecord): Promise<Workspace> {
    const id = record.workspace.id;
    if (!await this.archivedByTrash(id, record.id)) throw new HttpError(409, 'A newer workspace lifecycle change superseded this restoration.', 'WORKSPACE_TRASH_RECOVERY');
    if (record.workspace.worktree) throw new HttpError(409, 'Reopen this managed worktree through the worktree manager.', 'WORKSPACE_MANAGED_WORKTREE');
    const latest = await this.retainedRegistration(id);
    if (!latest || latest.path !== record.workspace.path || latest.worktree) throw new HttpError(409, 'The saved workspace identity changed. No registration was overwritten.', 'WORKSPACE_TRASH_RECOVERY');
    // Keep any newer name/account selection in the retained registration.
    await this.store.update<Workspace>(`${WORKSPACE_RECORD_PREFIX}${id}`, latest, value => {
      const current = this.checkedWorkspace(value, id);
      if (current.path !== record.workspace.path || current.worktree) throw new HttpError(409, 'The workspace registration changed during restoration.', 'WORKSPACE_TRASH_RECOVERY');
      return { ...current, updatedAt: new Date().toISOString() };
    });
    workspaceMetadataChanged(this, id);
    const key = trashRestoreKey(id, record.id);
    await this.store.update<unknown>(key, null, value => {
      if (value !== null && !matchingTrashRestore(value, id, record.id)) throw new HttpError(409, 'The saved workspace restoration is invalid.', 'WORKSPACE_STATE_INVALID');
      return value ?? { version: 1, id, trashId: record.id };
    });
    workspaceMetadataChanged(this, id);
    const marker = await this.store.read<unknown>(`${WORKSPACE_ARCHIVED_PREFIX}${id}`, null);
    if (!matchingTrashArchive(marker, id, record.id)) throw new HttpError(409, 'A later deletion superseded this restoration.', 'WORKSPACE_TRASH_RECOVERY');
    const workspace = await this.readWorkspace(id);
    if (!workspace) throw new HttpError(409, 'The workspace was archived again during restoration.', 'WORKSPACE_TRASH_RECOVERY');
    return workspace;
  }

  private async repairActiveSelection(): Promise<void> {
    const active = await this.store.read<string | null>('active-workspace', null);
    if (active === null || await this.readWorkspace(active)) return;
    const next = (await this.readRegistry())[0]?.id ?? null;
    await this.store.update<string | null>('active-workspace', null, current => current === active ? next : current);
  }

  /** Internal lifecycle bridge; callers own their current journal/removal gate. */
  hasWorkspaceArtifactCleanup(): boolean { return typeof this.lifecycleOptions.cleanupWorkspaceArtifacts === 'function'; }

  async assertWorkspaceDeletionAllowed(id: string): Promise<void> {
    if (typeof id !== 'string' || !WORKSPACE_ID.test(id)) throw new HttpError(400, 'Choose a registered workspace.', 'INVALID_WORKSPACE');
    await this.lifecycleOptions.assertWorkspaceDeletionAllowed?.(id);
  }

  /** Explicit lifecycle side effect; never part of a pure deletion preflight.
   * The admitted caller keeps its current activity/journal gate and must
   * revalidate its own registration/removal authority after this await. */
  async quiesceWorkspace(id: string): Promise<void | (() => void)> {
    if (typeof id !== 'string' || !WORKSPACE_ID.test(id)) throw new HttpError(400, 'Choose a registered workspace.', 'INVALID_WORKSPACE');
    return this.lifecycleOptions.quiesceWorkspace?.(id);
  }

  async cleanupWorkspaceArtifacts(request: WorkspaceArtifactCleanupRequest): Promise<void> {
    if (!request || typeof request.workspaceId !== 'string' || !WORKSPACE_ID.test(request.workspaceId)
      || typeof request.deletionId !== 'string' || !WORKSPACE_ID.test(request.deletionId)
      || request.mode !== 'trash' && request.mode !== 'permanent'
      || typeof request.deletedAt !== 'string' || request.deletedAt.length > 64 || !Number.isFinite(Date.parse(request.deletedAt))
      || typeof request.assertCurrent !== 'function') {
      throw new HttpError(400, 'Provide an owned workspace deletion request.', 'INVALID_WORKSPACE_ARTIFACT_CLEANUP');
    }
    const cleanup = this.lifecycleOptions.cleanupWorkspaceArtifacts;
    if (!cleanup) throw new HttpError(503, 'Workspace artifact cleanup is not available yet. Remaining owned data was retained for retry.', 'WORKSPACE_ARTIFACT_CLEANUP_UNAVAILABLE');
    // No initialize(), live checkout lookup, activity or Git-lock acquisition:
    // managed worktrees supply their own exact removal-journal authority here.
    const assertCurrent = request.assertCurrent.bind(request);
    const owned = Object.freeze({ workspaceId: request.workspaceId, deletionId: request.deletionId,
      mode: request.mode, deletedAt: request.deletedAt, assertCurrent });
    await assertCurrent();
    await cleanup(owned);
    await assertCurrent();
  }

  async getWorkspaceDeletionPlan(id: string): Promise<WorkspaceDeletionPlan> {
    await this.initialize();
    return this.workspaceTrash.deletionPlan(id);
  }

  async trashWorkspace(id: string, options: { expectedMode?: 'trash' | 'permanent' } = {}): Promise<WorkspaceDeleteResult> {
    await this.initialize();
    return (await this.workspaceTrash.trash(id, false, options.expectedMode))!;
  }

  startTrashCleanup(): void { this.workspaceTrash.startCleanup(); }
  async closeTrashCleanup(): Promise<void> { await this.workspaceTrash.close(); }

  async listWorkspaceTrash(): Promise<WorkspaceTrashEntry[]> {
    await this.list(); // Refresh verified-missing registrations before showing their recovery metadata.
    return this.workspaceTrash.list();
  }

  async listWorkspaceTrashPage(input: OperationalPageInput = {}): Promise<WorkspaceTrashPage> {
    // Page-visible/selected workspaces receive exact availability checks. The
    // trash screen checks one bounded page too; it never walks every root.
    await getWorkspacePageFor(this, this.config.sessionSecret, { limit: 40 });
    return this.workspaceTrash.listPage(input);
  }

  async restoreWorkspaceTrash(id: string): Promise<Workspace> {
    await this.initialize();
    return this.workspaceTrash.restore(id);
  }

  async purgeWorkspaceTrash(id: string): Promise<WorkspaceTrashDeleteResult> {
    await this.initialize();
    return this.workspaceTrash.purge(id);
  }

  async listWorkspaceDeletions(): Promise<WorkspaceDeletionStatus[]> {
    await this.initialize();
    return this.workspaceTrash.deletionStatuses();
  }

  async listWorkspaceDeletionPage(input: OperationalPageInput = {}): Promise<WorkspaceDeletionPage> {
    await this.initialize();
    return this.workspaceTrash.deletionStatusPage(input);
  }

  async retryWorkspaceDeletion(id: string): Promise<Extract<WorkspaceDeleteResult, { mode: 'permanent' }>> {
    await this.initialize();
    return this.workspaceTrash.retryDeletion(id);
  }

  async get(id: string): Promise<Workspace> {
    if (typeof id !== 'string' || !WORKSPACE_ID.test(id)) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
    await this.initialize();
    let found = await this.readWorkspace(id, true);
    if (!found) {
      // During a rolling upgrade an older instance can still append a legacy registration.
      await this.refreshLegacy();
      found = await this.readWorkspace(id);
    }
    if (!found) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
    return found;
  }

  /** Exact public availability lookup; storage failures never masquerade as deletion. */
  async getAvailable(id: string): Promise<Workspace> {
    try {
      await this.initialize();
      await checkedDirectory(this.config.dataDir, this.config.stateDir);
      const workspace = await this.get(id);
      if (Buffer.byteLength(JSON.stringify(workspace)) > 32 * 1024) throw new HttpError(413, 'A saved workspace summary exceeds its size limit.', 'WORKSPACE_LIMIT');
      if (!await inspectWorkspaceRoot(this.config, workspace.path)) {
        if (await this.workspaceTrash.reconcileMissing(workspace)) {
          throw new HttpError(404, 'The workspace directory is missing from storage. Its saved metadata is available in workspace trash.', 'WORKSPACE_DIRECTORY_MISSING');
        }
        // The directory may have returned or become unreadable between checks.
        // Neither outcome proves deletion; require a fresh successful lookup.
        if (!await inspectWorkspaceRoot(this.config, workspace.path)) throw new HttpError(503, 'Workspace storage could not be verified. Try again.', 'WORKSPACE_UNAVAILABLE');
      }
      if (await this.isArchived(id)) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
      return workspace;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'Workspace storage could not be read. Try again when storage is available.', 'WORKSPACE_UNAVAILABLE');
    }
  }

  /** Registration metadata only; this never authorizes new file or terminal access.
   * Existing in-memory terminal sessions may consult it solely for recovery. */
  async getRegistration(id: string, options: { includeArchived?: boolean } = {}): Promise<Workspace> {
    if (!options.includeArchived) return this.get(id);
    if (typeof id !== 'string' || !WORKSPACE_ID.test(id)) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
    await this.initialize();
    let record = await this.store.read<Workspace | null>(`${WORKSPACE_RECORD_PREFIX}${id}`, null);
    if (!record) {
      await this.refreshLegacy();
      record = await this.store.read<Workspace | null>(`${WORKSPACE_RECORD_PREFIX}${id}`, null)
        ?? await this.readLegacyWorkspace(id);
    }
    if (!record) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
    return this.checkedWorkspace(record, id);
  }

  private checkedWorkspace(value: unknown, expectedId?: string): Workspace {
    const record = value as Partial<Workspace> | null;
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !WORKSPACE_ID.test(record.id)
      || expectedId !== undefined && record.id !== expectedId || typeof record.name !== 'string' || !record.name
      || typeof record.path !== 'string' || !record.path || record.path.length > 4096
      || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') {
      throw new HttpError(409, 'Saved workspace registration is invalid. Existing files were left unchanged.', 'WORKSPACE_STATE_INVALID');
    }
    return record as Workspace;
  }

  private worktreeArchiveGeneration(value: unknown, id: string): string | null {
    if (!value || typeof value !== 'object') return null;
    const marker = value as { id?: unknown; kind?: unknown; generation?: unknown };
    return marker.id === id && marker.kind === 'managed-worktree' && typeof marker.generation === 'string'
      && /^[a-f0-9]{32}$/.test(marker.generation) ? marker.generation : null;
  }

  private matchingWorktreeRestore(value: unknown, id: string, generation: string): boolean {
    if (!value || typeof value !== 'object') return false;
    const restored = value as { id?: unknown; generation?: unknown; version?: unknown };
    return restored.id === id && restored.generation === generation && restored.version === 1;
  }

  private async isArchived(id: string, listedNames?: ReadonlySet<string>): Promise<boolean> {
    const marker = await this.store.read<unknown>(`${WORKSPACE_ARCHIVED_PREFIX}${id}`, null);
    if (marker === null) return false;
    if (matchingTrashArchive(marker, id)) {
      const key = trashRestoreKey(id, marker.trashId);
      if (listedNames && !listedNames.has(`${key}.json`)) return true;
      return !matchingTrashRestore(await this.store.read<unknown>(key, null), id, marker.trashId);
    }
    const generation = this.worktreeArchiveGeneration(marker, id);
    // Ordinary tombstones remain permanent. Managed worktrees require an explicit acknowledgment of this exact archive.
    if (!generation) return true;
    const key = `${WORKTREE_RESTORED_PREFIX}${id}-${generation}`;
    if (listedNames && !listedNames.has(`${key}.json`)) return true;
    return !this.matchingWorktreeRestore(await this.store.read<unknown>(key, null), id, generation);
  }

  private async readWorkspace(id: string, refreshLegacy = false, listedNames?: ReadonlySet<string>): Promise<Workspace | null> {
    // A list already has a directory snapshot. Probing every absent variant on
    // the native bucket can trigger a separate remote lookup for each miss.
    // Only list display uses this snapshot; get/mutations still probe current
    // archive and record paths directly before operating on a workspace.
    let [archived, record] = await Promise.all([
      listedNames && !listedNames.has(`${WORKSPACE_ARCHIVED_PREFIX}${id}.json`) ? false : this.isArchived(id, listedNames),
      listedNames && !listedNames.has(`${WORKSPACE_RECORD_PREFIX}${id}.json`) ? null : this.store.read<Workspace | null>(`${WORKSPACE_RECORD_PREFIX}${id}`, null),
    ]);
    if (archived) return null;
    if (!record && refreshLegacy) {
      await this.refreshLegacy();
      // A current edit or archive can arrive while the older registry is being imported.
      [archived, record] = await Promise.all([
        this.isArchived(id), this.store.read<Workspace | null>(`${WORKSPACE_RECORD_PREFIX}${id}`, null),
      ]);
      if (archived) return null;
    }
    const found = record ?? await this.readLegacyWorkspace(id, listedNames);
    if (!found) return null;
    this.knownWorkspaceIds.add(id);
    return this.checkedWorkspace(found, id);
  }

  private async readLegacyWorkspace(id: string, listedNames?: ReadonlySet<string>): Promise<Workspace | null> {
    let latest = listedNames && !listedNames.has(`${WORKSPACE_LEGACY_PREFIX}${id}.json`)
      ? null : await this.store.read<Workspace | null>(`${WORKSPACE_LEGACY_PREFIX}${id}`, null);
    if (latest) latest = this.checkedWorkspace(latest, id);
    const keys = [...(this.legacyRevisions.get(id) ?? [])].filter(key => !listedNames || listedNames.has(`${key}.json`)).sort();
    for (let start = 0; start < keys.length; start += 12) {
      const revisions = await Promise.all(keys.slice(start, start + 12).map(key => this.store.read<Workspace | null>(key, null)));
      for (const value of revisions) {
        if (!value) continue;
        const revision = this.checkedWorkspace(value, id);
        if (!latest || Date.parse(revision.updatedAt) > Date.parse(latest.updatedAt)) latest = revision;
      }
    }
    return latest;
  }

  private async importLegacy(saved: Workspace[] | null): Promise<void> {
    if (saved !== null && (!Array.isArray(saved) || saved.length > MAX_LEGACY_WORKSPACES)) {
      throw new HttpError(409, 'Saved workspace registration is invalid or exceeds the migration limit.', 'WORKSPACE_STATE_INVALID');
    }
    const signature = versionOf(JSON.stringify(saved));
    if (signature === this.legacySignature) return;
    await this.scanRegistry();
    for (const input of saved ?? []) {
      const workspace = this.checkedWorkspace(input);
      this.knownWorkspaceIds.add(workspace.id);
      if (await this.isArchived(workspace.id)) continue;
      const previous = await this.readLegacyWorkspace(workspace.id);
      if (previous && !(Date.parse(workspace.updatedAt) > Date.parse(previous.updatedAt))) continue;
      // Immutable versions make legacy import monotonic across instances, even when an older rename finishes last.
      // The longest supported ID still leaves the complete key within JsonStore's 181-character bound.
      const key = `${WORKSPACE_LEGACY_REVISION_PREFIX}${workspace.id}-${versionOf(JSON.stringify(workspace)).slice(0, 32)}`;
      await this.store.write(key, workspace);
      workspaceMetadataChanged(this, workspace.id);
      const revisions = this.legacyRevisions.get(workspace.id) ?? new Set<string>();
      revisions.add(key);
      this.legacyRevisions.set(workspace.id, revisions);
    }
    // Discover concurrently committed versions once per changed legacy snapshot, never on every file access.
    await this.scanRegistry();
    this.legacySignature = signature;
  }

  private async refreshLegacy(): Promise<void> {
    if (this.legacyImport) return this.legacyImport;
    const importing = this.store.read<Workspace[] | null>('workspaces', null).then(saved => this.importLegacy(saved));
    this.legacyImport = importing;
    try { await importing; }
    finally { if (this.legacyImport === importing) this.legacyImport = undefined; }
  }

  private async scanRegistry(): Promise<ReadonlySet<string>> {
    const entries = await fs.readdir(this.store.directory, { withFileTypes: true }).catch(error => {
      if (isErrno(error, 'ENOENT')) return [];
      throw error;
    });
    // Include nonregular entries too. A present malformed file, directory, or
    // symbolic link must retain its existing read/validation behavior instead
    // of being mistaken for a missing record by the listing optimization.
    const names = new Set(entries.map(entry => entry.name));
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      if (entry.name.startsWith(WORKSPACE_LEGACY_REVISION_PREFIX)) {
        const key = entry.name.slice(0, -5);
        const suffix = key.slice(WORKSPACE_LEGACY_REVISION_PREFIX.length);
        const id = suffix.slice(0, -33);
        if (!WORKSPACE_ID.test(id) || !/^[a-f0-9]{32}$/.test(suffix.slice(-32)) || suffix.at(-33) !== '-') continue;
        this.knownWorkspaceIds.add(id);
        const revisions = this.legacyRevisions.get(id) ?? new Set<string>();
        revisions.add(key);
        this.legacyRevisions.set(id, revisions);
        continue;
      }
      for (const prefix of [WORKSPACE_RECORD_PREFIX, WORKSPACE_LEGACY_PREFIX, WORKSPACE_ARCHIVED_PREFIX]) {
        if (!entry.name.startsWith(prefix)) continue;
        const id = entry.name.slice(prefix.length, -5);
        if (WORKSPACE_ID.test(id)) this.knownWorkspaceIds.add(id);
        break;
      }
    }
    const revisionCount = [...this.legacyRevisions.values()].reduce((count, revisions) => count + revisions.size, 0);
    if (this.knownWorkspaceIds.size + revisionCount > MAX_REGISTRY_RECORDS) throw new HttpError(413, 'The saved workspace registry exceeds its record limit.', 'WORKSPACE_LIMIT');
    return names;
  }

  private async readRegistry(maxBytes = Number.POSITIVE_INFINITY): Promise<Workspace[]> {
    const listedNames = await this.scanRegistry();
    const ids = [...this.knownWorkspaceIds];
    const workspaces: Workspace[] = [];
    let bytes = 0;
    for (let start = 0; start < ids.length; start += 12) {
      const batch = await Promise.all(ids.slice(start, start + 12).map(id => this.readWorkspace(id, false, listedNames)));
      for (const workspace of batch) if (workspace) {
        if (Number.isFinite(maxBytes)) {
          bytes += Buffer.byteLength(JSON.stringify(workspace));
          if (bytes > maxBytes) throw new HttpError(413, 'The workspace summary index exceeds its size limit.', 'WORKSPACE_LIMIT');
        }
        workspaces.push(workspace);
      }
    }
    return workspaces.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async create(input: { name: string; initializeGit?: boolean }): Promise<Workspace> {
    const name = workspaceName(input?.name);
    if (input.initializeGit !== undefined && typeof input.initializeGit !== 'boolean') throw new HttpError(400, 'initializeGit must be a boolean.');
    await this.initialize();
    return this.createRegistered({ ...input, name });
  }

  private async checkedNativeDirectory(directory: string): Promise<string> {
    const configuredBase = path.resolve(this.config.workspacesDir);
    const declared = path.resolve(directory);
    if (declared === configuredBase || !within(configuredBase, declared)) throw new HttpError(403, 'The worktree path must remain inside workspace storage.', 'UNSAFE_PATH');
    const [base, actual, stat] = await Promise.all([fs.realpath(configuredBase), fs.realpath(declared), fs.lstat(declared)]);
    if (!stat.isDirectory() || stat.isSymbolicLink() || actual !== path.join(base, path.relative(configuredBase, declared))) {
      throw new HttpError(403, 'The worktree directory must not contain symbolic links.', 'UNSAFE_PATH');
    }
    return actual;
  }

  private async checkedWorktreeRegistration(input: Workspace): Promise<Workspace & { worktree: WorkspaceWorktree }> {
    const workspace = structuredClone(this.checkedWorkspace(input)) as Workspace & { worktree?: WorkspaceWorktree };
    workspace.name = workspaceName(workspace.name);
    const metadata = workspace.worktree;
    if (!metadata || typeof metadata !== 'object'
      || [metadata.id, metadata.sourceWorkspaceId, metadata.repositoryWorkspaceId].some(id => typeof id !== 'string' || !WORKSPACE_ID.test(id))
      || metadata.id !== workspace.id || metadata.sourceWorkspaceId === workspace.id || metadata.repositoryWorkspaceId === workspace.id
      || typeof metadata.gitDirectory !== 'string' || typeof metadata.commonDirectory !== 'string'
      || workspace.githubAccountId !== undefined && (typeof workspace.githubAccountId !== 'string' || !WORKSPACE_ID.test(workspace.githubAccountId))) {
      throw new HttpError(400, 'Provide a valid server-managed worktree registration.', 'INVALID_WORKTREE');
    }
    if (path.resolve(workspace.path) !== path.resolve(this.config.workspacesDir, metadata.id)) {
      throw new HttpError(403, 'The worktree must use its allocated workspace directory.', 'UNSAFE_PATH');
    }
    const [source, repository] = await Promise.all([
      this.getRegistration(metadata.sourceWorkspaceId, { includeArchived: true }),
      this.getRegistration(metadata.repositoryWorkspaceId, { includeArchived: true }),
    ]);
    if ((repository as Workspace & { worktree?: WorkspaceWorktree }).worktree) {
      throw new HttpError(409, 'The primary repository must be an independent workspace.', 'INVALID_WORKTREE');
    }
    const [directory, repositoryDirectory] = await Promise.all([
      this.checkedNativeDirectory(workspace.path), this.checkedNativeDirectory(repository.path),
    ]);
    const commonDirectory = await this.checkedNativeDirectory(path.join(repositoryDirectory, '.git'));
    if (path.resolve(metadata.commonDirectory) !== commonDirectory
      || path.dirname(path.resolve(metadata.gitDirectory)) !== path.join(commonDirectory, 'worktrees')) {
      throw new HttpError(403, 'The worktree Git metadata must belong to its registered repository.', 'INVALID_WORKTREE');
    }
    const gitDirectory = await this.checkedNativeDirectory(metadata.gitDirectory);
    if (source.id !== repository.id) {
      const sourceMetadata = (source as Workspace & { worktree?: WorkspaceWorktree }).worktree;
      if (!sourceMetadata || sourceMetadata.repositoryWorkspaceId !== repository.id || sourceMetadata.commonDirectory !== commonDirectory) {
        throw new HttpError(409, 'The worktree source belongs to a different repository.', 'INVALID_WORKTREE');
      }
    }
    const pointerPath = path.join(directory, '.git');
    const pointerStat = await fs.lstat(pointerPath);
    if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) throw new HttpError(409, 'A managed worktree must contain its original Git pointer file.', 'INVALID_WORKTREE');
    const pointer = textContent(await readBounded(pointerPath, 8192)).match(/^gitdir: ([^\r\n]+)\r?\n?$/);
    const commonPointer = textContent(await readBounded(path.join(gitDirectory, 'commondir'), 8192)).replace(/\r?\n$/, '');
    const backPointer = textContent(await readBounded(path.join(gitDirectory, 'gitdir'), 8192)).replace(/\r?\n$/, '');
    if (!pointer || path.resolve(directory, pointer[1]) !== gitDirectory
      || path.resolve(gitDirectory, commonPointer) !== commonDirectory || path.resolve(gitDirectory, backPointer) !== pointerPath) {
      throw new HttpError(409, 'The worktree Git pointers do not match its registered repository.', 'INVALID_WORKTREE');
    }
    return { ...workspace, path: directory, worktree: { ...metadata, gitDirectory, commonDirectory } };
  }

  /** Called only after the managed-worktree service has validated Git's own worktree records. */
  async registerWorktree(input: Workspace): Promise<Workspace> {
    await this.initialize();
    const release = acquireWorkspaceActivity(this.config.workspacesDir, this.checkedWorkspace(input).id, 'worktree');
    try {
      const workspace = await this.checkedWorktreeRegistration(input);
      if (await this.isArchived(workspace.id)) throw new HttpError(409, 'An archived registration requires an explicit worktree restore.', 'WORKSPACE_ARCHIVED');
      if (await this.readLegacyWorkspace(workspace.id)) throw new HttpError(409, 'This workspace ID is already registered.', 'WORKSPACE_EXISTS');
      const registered = await this.store.update<Workspace | null>(`${WORKSPACE_RECORD_PREFIX}${workspace.id}`, null, current => {
        if (current) throw new HttpError(409, 'This workspace ID is already registered.', 'WORKSPACE_EXISTS');
        return workspace;
      });
      this.knownWorkspaceIds.add(workspace.id);
      workspaceMetadataChanged(this, workspace.id);
      if (await this.isArchived(workspace.id)) throw new HttpError(409, 'This workspace was archived during registration.', 'WORKSPACE_ARCHIVED');
      return registered!;
    } finally { release(); }
  }

  /** Capture this token before the worktree service validates Git, then pass it unchanged to restoreWorktree. */
  async getWorktreeArchive(id: string): Promise<{ generation: string; archivedAt: string }> {
    const workspace = await this.getRegistration(id, { includeArchived: true });
    if (!(workspace as Workspace & { worktree?: WorkspaceWorktree }).worktree) throw new HttpError(409, 'Only managed worktrees support explicit restoration.', 'WORKSPACE_NOT_RESTORABLE');
    const marker = await this.store.read<unknown>(`${WORKSPACE_ARCHIVED_PREFIX}${id}`, null);
    const generation = this.worktreeArchiveGeneration(marker, id);
    if (!generation || !await this.isArchived(id)) throw new HttpError(409, 'This worktree does not have a restorable archive.', 'WORKSPACE_NOT_ARCHIVED');
    await this.assertManagedArchiveRestorable(workspace, marker);
    const archivedAt = (marker as { archivedAt?: unknown }).archivedAt;
    if (typeof archivedAt !== 'string') throw new HttpError(409, 'The worktree archive metadata is invalid.', 'WORKSPACE_STATE_INVALID');
    return { generation, archivedAt };
  }

  private async assertManagedArchiveRestorable(workspace: Workspace, value: unknown): Promise<void> {
    const marker = value as { id?: unknown; kind?: unknown; trashId?: unknown; generation?: unknown; archivedAt?: unknown } | null;
    if (!marker || marker.kind !== 'managed-worktree' || marker.trashId === undefined) return;
    if (typeof marker.trashId !== 'string' || !TRASH_ID.test(marker.trashId)) throw new HttpError(409, 'The saved worktree archive is invalid.', 'WORKSPACE_STATE_INVALID');
    const record = await readTrashRecord(this.config, marker.trashId);
    const metadata = record?.workspace.worktree;
    if (!record || record.workspace.id !== workspace.id || record.workspace.path !== workspace.path
      || record.reason !== 'missing' || !metadata || !workspace.worktree
      || marker.id !== workspace.id || marker.generation !== record.id.replace(/-/g, '') || marker.archivedAt !== record.deletedAt
      || (['id', 'sourceWorkspaceId', 'repositoryWorkspaceId', 'gitDirectory', 'commonDirectory'] as const)
        .some(key => metadata[key] !== workspace.worktree![key])) {
      throw new HttpError(409, 'The saved worktree archive no longer has matching recovery ownership. Existing files were preserved.', 'WORKSPACE_STATE_INVALID');
    }
    if (record.phase === 'purged' || record.artifactCleanup?.state === 'complete') {
      throw new HttpError(410, 'This worktree workspace was permanently deleted. Create a new checkout to continue; permanent artifact fences cannot be cleared by reopening it.', 'WORKSPACE_PERMANENTLY_DELETED');
    }
    if (record.phase === 'purging' || record.artifactCleanup !== undefined) {
      throw new HttpError(409, 'Permanent deletion has started for this worktree workspace. Its saved identity cannot be reopened.', 'WORKSPACE_PURGE_IN_PROGRESS');
    }
    if (!['preparing', 'ready', 'missing', 'recovery'].includes(record.phase)) throw new HttpError(409, 'This worktree archive was already consumed by another lifecycle action.', 'WORKSPACE_STATE_INVALID');
  }

  /** Restore only a structurally validated managed worktree; ordinary tombstones are never cleared. */
  async restoreWorktree(input: Workspace, expectedArchiveGeneration: string): Promise<Workspace> {
    if (typeof expectedArchiveGeneration !== 'string' || !/^[a-f0-9]{32}$/.test(expectedArchiveGeneration)) throw new HttpError(400, 'Provide the archive generation captured before validating this worktree.', 'INVALID_WORKTREE');
    const id = this.checkedWorkspace(input).id;
    await this.initialize();
    const release = acquireWorkspaceActivity(this.config.workspacesDir, id, 'worktree');
    try {
      const current = await this.getRegistration(id, { includeArchived: true });
      const currentMetadata = (current as Workspace & { worktree?: WorkspaceWorktree }).worktree;
      const suppliedMetadata = (input as Workspace & { worktree?: WorkspaceWorktree }).worktree;
      if (!currentMetadata || !suppliedMetadata) throw new HttpError(409, 'Only managed worktrees support explicit restoration.', 'WORKSPACE_NOT_RESTORABLE');
      if (current.path !== input.path || (['id', 'sourceWorkspaceId', 'repositoryWorkspaceId', 'gitDirectory', 'commonDirectory'] as const)
        .some(key => currentMetadata[key] !== suppliedMetadata[key])) {
        throw new HttpError(409, 'The worktree registration changed. Validate it again before restoring.', 'WORKTREE_CHANGED');
      }
      await this.assertManagedArchiveRestorable(current, await this.store.read<unknown>(`${WORKSPACE_ARCHIVED_PREFIX}${id}`, null));
      await this.checkedWorktreeRegistration(current);
      const archiveKey = `${WORKSPACE_ARCHIVED_PREFIX}${id}`;
      const marker = await this.store.read<unknown>(archiveKey, null);
      if (this.worktreeArchiveGeneration(marker, id) !== expectedArchiveGeneration) throw new HttpError(409, 'This worktree was archived again. Refresh before restoring.', 'STALE_WORKTREE_RESTORE');
      await this.assertManagedArchiveRestorable(current, marker);
      const restoreKey = `${WORKTREE_RESTORED_PREFIX}${id}-${expectedArchiveGeneration}`;
      await this.store.update<unknown>(restoreKey, null, previous => {
        if (previous !== null && !this.matchingWorktreeRestore(previous, id, expectedArchiveGeneration)) throw new HttpError(409, 'The saved worktree restoration is invalid.', 'WORKSPACE_STATE_INVALID');
        // Concurrent acknowledgments of one generation publish identical immutable evidence.
        return previous ?? { id, generation: expectedArchiveGeneration, version: 1 };
      });
      workspaceMetadataChanged(this, id);
      if (this.worktreeArchiveGeneration(await this.store.read<unknown>(archiveKey, null), id) !== expectedArchiveGeneration) throw new HttpError(409, 'A later archive superseded this restoration.', 'STALE_WORKTREE_RESTORE');
      return this.get(id);
    } finally { release(); }
  }

  private async createRegistered(input: { name: string; initializeGit?: boolean }): Promise<Workspace> {
    const id = randomUUID();
    const directory = path.resolve(this.config.workspacesDir, id);
    const now = new Date().toISOString();
    const workspace: Workspace = { id, name: workspaceName(input.name), path: directory, createdAt: now, updatedAt: now };
    await fs.mkdir(directory, { recursive: false, mode: 0o700 });
    try {
      if (input.initializeGit) {
        await runFile('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=main', directory], {
          timeout: 15_000, maxBuffer: 128 * 1024,
          env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
        });
      }
      // Distinct workspace records never share a replaceable index, including across overlapping app instances.
      await this.store.write(`${WORKSPACE_RECORD_PREFIX}${id}`, workspace);
      this.knownWorkspaceIds.add(id);
      workspaceMetadataChanged(this, id);
      return workspace;
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
      if (input.initializeGit && error instanceof Error && 'cmd' in error) throw new HttpError(500, 'Git could not initialize this workspace. Verify Git is installed.', 'GIT_INIT_FAILED');
      throw error;
    }
  }

  async update(id: string, patch: { name?: string; githubAccountId?: string | null; active?: boolean }): Promise<Workspace> {
    const original = patch?.active === true ? await this.getAvailable(id) : await this.get(id);
    const release = acquireWorkspaceActivity(this.config.workspacesDir, id, 'files');
    try {
    if (!patch || typeof patch !== 'object') throw new HttpError(400, 'Provide workspace settings.');
    const name = patch.name === undefined ? undefined : workspaceName(patch.name);
    if (patch.githubAccountId !== undefined && patch.githubAccountId !== null
      && (typeof patch.githubAccountId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(patch.githubAccountId))) {
      throw new HttpError(400, 'Invalid GitHub account.');
    }
    if (patch.active !== undefined && typeof patch.active !== 'boolean') throw new HttpError(400, 'active must be a boolean.');
    if (await this.isArchived(id)) throw new HttpError(409, 'This workspace was archived during the update.', 'WORKSPACE_ARCHIVED');
    // Metadata edits to the same record use JsonStore's optimistic checks; this is not a distributed global CAS.
    const result = await this.store.update<Workspace>(`${WORKSPACE_RECORD_PREFIX}${id}`, original, current => {
      const result = { ...this.checkedWorkspace(current, id), updatedAt: new Date().toISOString() };
      if (name !== undefined) result.name = name;
      if (patch.githubAccountId === null) delete result.githubAccountId;
      else if (patch.githubAccountId !== undefined) result.githubAccountId = patch.githubAccountId;
      return result;
    });
    workspaceMetadataChanged(this, id);
    if (await this.isArchived(id)) throw new HttpError(409, 'This workspace was archived during the update.', 'WORKSPACE_ARCHIVED');
    if (patch.active) await this.store.write('active-workspace', id);
    return result;
    } finally { release(); }
  }

  async clearGithubAccount(id: string, expectedAccountId: string): Promise<Workspace> {
    if (typeof expectedAccountId !== 'string' || !WORKSPACE_ID.test(expectedAccountId)) throw new HttpError(400, 'Invalid GitHub account.');
    const original = await this.get(id);
    if (original.githubAccountId !== expectedAccountId) return original;
    const release = acquireWorkspaceActivity(this.config.workspacesDir, id, 'files');
    try {
    if (await this.isArchived(id)) throw new HttpError(409, 'This workspace was archived during the update.', 'WORKSPACE_ARCHIVED');
    const result = await this.store.update<Workspace>(`${WORKSPACE_RECORD_PREFIX}${id}`, original, current => {
      const workspace = this.checkedWorkspace(current, id);
      // A disconnect may have listed this workspace before the user selected another account.
      if (workspace.githubAccountId !== expectedAccountId) return workspace;
      const { githubAccountId: _disconnected, ...retained } = workspace;
      return { ...retained, updatedAt: new Date().toISOString() };
    });
    workspaceMetadataChanged(this, id);
    if (await this.isArchived(id)) throw new HttpError(409, 'This workspace was archived during the update.', 'WORKSPACE_ARCHIVED');
    return result;
    } finally { release(); }
  }

  /** Internal import completion only; ordinary PATCH never accepts provenance. */
  async completeGithubImport(id: string, accountId: string, fullName: string): Promise<Workspace> {
    if (typeof accountId !== 'string' || !WORKSPACE_ID.test(accountId) || typeof fullName !== 'string' || !GITHUB_REPOSITORY.test(fullName)) {
      throw new HttpError(400, 'Provide a verified GitHub repository and connected account.', 'GITHUB_REPOSITORY');
    }
    const original = await this.get(id);
    const release = acquireWorkspaceActivity(this.config.workspacesDir, id, 'git');
    try {
      if (original.worktree) throw new HttpError(409, 'GitHub imports require an independent workspace.', 'WORKSPACE_MANAGED_WORKTREE');
      await this.root(id);
      if (await this.isArchived(id)) throw new HttpError(409, 'This workspace was removed during import.', 'WORKSPACE_ARCHIVED');
      const result = await this.store.update<Workspace>(`${WORKSPACE_RECORD_PREFIX}${id}`, original, value => {
        const current = this.checkedWorkspace(value, id);
        if (current.path !== original.path || current.worktree) throw new HttpError(409, 'The import workspace changed.', 'WORKSPACE_STATE_INVALID');
        return { ...current, githubAccountId: accountId, source: { kind: 'github' as const, fullName }, updatedAt: new Date().toISOString() };
      });
      workspaceMetadataChanged(this, id);
      if (await this.isArchived(id)) throw new HttpError(409, 'This workspace was removed during import.', 'WORKSPACE_ARCHIVED');
      return result;
    } finally { release(); }
  }

  async remove(id: string): Promise<void> {
    const workspace = await this.get(id);
    const release = await this.quiesceWorkspace(id);
    try {
      const current = await this.get(id);
      if (current.path !== workspace.path || current.createdAt !== workspace.createdAt) {
        throw new HttpError(409, 'The workspace registration changed while its active sessions were stopping. Its metadata and files were retained.', 'WORKSPACE_LIFECYCLE_CHANGED');
      }
      const metadata = (workspace as Workspace & { worktree?: WorkspaceWorktree }).worktree;
      const managed = metadata && typeof metadata === 'object' && metadata.id === id;
      const marker = { id, archivedAt: new Date().toISOString(), ...(managed ? { kind: 'managed-worktree', generation: randomUUID().replace(/-/g, '') } : {}) };
      await this.store.update<unknown>(`${WORKSPACE_ARCHIVED_PREFIX}${id}`, null, current => managed || matchingTrashArchive(current, id) ? marker : current ?? marker);
      workspaceMetadataChanged(this, id);
      if (await this.store.read<string | null>('active-workspace', null) === id) {
        await this.store.update<string | null>('active-workspace', null, async current => {
          if (current !== id) return current;
          // Metadata-only internal archival must not recurse into missing-root
          // reconciliation while the active-selection key is already locked.
          return (await this.readRegistry())[0]?.id ?? null;
        });
      }
      // Removing a registration deliberately leaves the workspace directory and trash recoverable.
    } finally { if (typeof release === 'function') release(); }
  }

  private async root(id: string): Promise<string> {
    const workspace = await this.get(id);
    const configuredBase = path.resolve(this.config.workspacesDir);
    const declared = path.resolve(workspace.path);
    if (!within(configuredBase, declared) || declared === configuredBase) throw new HttpError(403, 'The workspace path is outside the configured storage directory.', 'UNSAFE_PATH');
    try {
      const [base, root, stat] = await Promise.all([fs.realpath(configuredBase), fs.realpath(declared), fs.lstat(declared)]);
      if (!stat.isDirectory() || !within(base, root) || root === base) throw new HttpError(403, 'The workspace directory is not a safe storage location.', 'UNSAFE_PATH');
      return root;
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        await this.workspaceTrash.reconcileMissing(workspace);
        throw new HttpError(404, 'The workspace directory is missing from storage. Its saved metadata is available in workspace trash.', 'WORKSPACE_DIRECTORY_MISSING');
      }
      throw error;
    }
  }

  async resolvePath(id: string, input: string, options: { allowMissing?: boolean } = {}): Promise<string> {
    const relative = relativePath(input);
    const root = await this.root(id);
    if (!relative) return root;
    const parts = relative.split('/');
    let current = root;
    for (let index = 0; index < parts.length; index++) {
      const candidate = path.join(current, parts[index]);
      let stat: Stats;
      try { stat = await fs.lstat(candidate); }
      catch (error) {
        if (isErrno(error, 'ENOENT')) {
          if (options.allowMissing) return path.join(candidate, ...parts.slice(index + 1));
          throw new HttpError(404, 'File or folder not found.', 'FILE_NOT_FOUND');
        }
        if (isErrno(error, 'ENOTDIR')) throw new HttpError(400, 'A parent path is not a directory.', 'NOT_A_DIRECTORY');
        throw error;
      }
      if (stat.isSymbolicLink()) {
        try { current = await fs.realpath(candidate); }
        catch (error) {
          if (isErrno(error, 'ENOENT') || isErrno(error, 'ELOOP')) throw new HttpError(403, 'This symbolic link has no safe target.', 'UNSAFE_PATH');
          throw error;
        }
        if (!within(root, current)) throw new HttpError(403, 'This symbolic link points outside the workspace.', 'UNSAFE_PATH');
        stat = await fs.stat(current);
      } else current = candidate;
      if (index < parts.length - 1 && !stat.isDirectory()) throw new HttpError(400, 'A parent path is not a directory.', 'NOT_A_DIRECTORY');
    }
    return current;
  }

  private async entryPath(id: string, input: string, allowMissing = false): Promise<string> {
    const relative = relativePath(input, false);
    const parent = await this.resolvePath(id, path.posix.dirname(relative), { allowMissing });
    const target = path.join(parent, path.posix.basename(relative));
    if (!allowMissing && !await lstatMaybe(target)) throw new HttpError(404, 'File or folder not found.', 'FILE_NOT_FOUND');
    return target;
  }

  private async exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const signal = this.fileMutationController.signal;
    signal.throwIfAborted();
    const pending = withWorkspaceFileMutation(this.config.workspacesDir, id, operation, { signal });
    this.fileMutations.add(pending);
    void pending.then(() => this.fileMutations.delete(pending), () => this.fileMutations.delete(pending));
    return pending;
  }

  /** HTTP clients can disconnect before an admitted native file write settles. */
  closeFileMutations(): Promise<void> {
    if (!this.fileMutationController.signal.aborted) this.fileMutationController.abort(new HttpError(503,
      'Workspace file editing is shutting down. Keep your edits and reconnect after the workspace restarts.', 'WORKSPACE_FILES_CLOSING'));
    // Queued callbacks are cancelled by their signal. Already issued native
    // writes retain ownership until they settle, including cleanup and journals.
    return this.fileMutationsClosed ??= Promise.allSettled([...this.fileMutations]).then(() => undefined);
  }

  async listTree(id: string, input = ''): Promise<FileEntry[]> {
    const relative = relativePath(input);
    const directory = await this.resolvePath(id, relative);
    if (!(await fs.stat(directory)).isDirectory()) throw new HttpError(400, 'Choose a folder to list.', 'NOT_A_DIRECTORY');
    const children = await fs.readdir(directory, { withFileTypes: true });
    if (children.length > 10_000) throw new HttpError(413, 'This folder has too many entries to display at once.', 'TOO_MANY_FILES');
    const entries: FileEntry[] = [];
    // Bucket metadata calls have appreciable latency. Bound parallel work so a
    // folder does not pay that round trip once per entry or flood the IO pool.
    for (let offset = 0; offset < children.length; offset += 16) {
      const batch = await Promise.all(children.slice(offset, offset + 16).map(async (child): Promise<FileEntry | undefined> => {
        if (child.name === '.git' || child.name.startsWith('.codex-write-')) return undefined;
        const childPath = path.posix.join(relative, child.name);
        let stat: Stats;
        try { stat = await fs.lstat(path.join(directory, child.name)); }
        catch (error) { if (isErrno(error, 'ENOENT')) return undefined; throw error; }
        let kind: FileEntry['kind'] = stat.isDirectory() ? 'directory' : 'file';
        if (stat.isSymbolicLink()) {
          try { kind = (await fs.stat(await this.resolvePath(id, childPath))).isDirectory() ? 'directory' : 'file'; }
          catch { /* Unsafe links remain visible, but following one returns an actionable error. */ }
        } else if (!stat.isDirectory() && !stat.isFile()) return undefined;
        return { name: child.name, path: childPath, kind, size: stat.size, modifiedAt: stat.mtime.toISOString(), ...(stat.isSymbolicLink() ? { isSymlink: true } : {}) };
      }));
      for (const entry of batch) if (entry) entries.push(entry);
    }
    // Passing options to localeCompare constructs collation work repeatedly in
    // a large sort. One collator preserves natural ordering for the whole tree.
    const compareNames = new Intl.Collator(undefined, { numeric: true }).compare;
    return entries.sort((a, b) => a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : compareNames(a.name, b.name));
  }

  async readFile(id: string, input: string): Promise<FileContent> {
    const relative = relativePath(input, false);
    return fileResult(relative, await readBounded(await this.resolvePath(id, relative), MAX_TEXT_FILE_BYTES));
  }

  private async writeBytes(id: string, relative: string, bytes: Buffer, options: { expectedVersion?: string; exclusive?: boolean } = {}): Promise<void> {
    let destination = await this.resolvePath(id, relative, { allowMissing: true });
    const previous = await lstatMaybe(destination);
    if (previous && !previous.isFile()) throw new HttpError(400, 'The destination is not a regular file.', 'NOT_A_FILE');
    if (options.exclusive && previous) throw new HttpError(409, 'A file or folder already exists at that path.', 'FILE_EXISTS');
    let originalVersion: string | undefined;
    if (options.expectedVersion !== undefined) {
      originalVersion = previous ? versionOf(await readBounded(destination, MAX_TEXT_FILE_BYTES)) : undefined;
      if (originalVersion !== options.expectedVersion) throw new HttpError(409, 'This file changed outside the editor. Reload it before saving, or save a copy.', 'VERSION_CONFLICT');
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    destination = await this.resolvePath(id, relative, { allowMissing: true });
    const temporary = path.join(path.dirname(destination), `.codex-write-${randomUUID()}`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', previous ? previous.mode & 0o777 : 0o644);
      await handle.writeFile(bytes);
      // open() applies umask; existing files must retain their exact permission bits after replacement.
      if (previous) await handle.chmod(previous.mode & 0o777);
      await handle.close();
      handle = undefined;
      // Revalidate after writing the temporary file, including terminal or agent changes during the save.
      const liveDestination = await this.resolvePath(id, relative, { allowMissing: true });
      if (liveDestination !== destination) throw new HttpError(409, 'The file path changed while saving. Refresh and try again.', 'VERSION_CONFLICT');
      if (options.expectedVersion !== undefined) {
        const exists = await lstatMaybe(destination);
        const liveVersion = exists ? versionOf(await readBounded(destination, MAX_TEXT_FILE_BYTES)) : undefined;
        if (liveVersion !== originalVersion) throw new HttpError(409, 'This file changed while saving. Reload it before saving.', 'VERSION_CONFLICT');
      }
      this.fileMutationController.signal.throwIfAborted();
      if (options.exclusive) {
        // COPYFILE_EXCL works on native bucket mounts that do not implement hard links.
        try { await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL); }
        catch (error) { if (isErrno(error, 'EEXIST')) throw new HttpError(409, 'A file already exists at that path.', 'FILE_EXISTS'); throw error; }
      } else await fs.rename(temporary, destination);
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await fs.unlink(temporary).catch(error => { if (!isErrno(error, 'ENOENT')) throw error; });
    }
  }

  async writeFile(id: string, input: string, content: string, expectedVersion?: string): Promise<FileContent> {
    const relative = relativePath(input, false);
    if (typeof content !== 'string') throw new HttpError(400, 'File content must be text.');
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > MAX_TEXT_FILE_BYTES) throw new HttpError(413, 'Text files must be smaller than 5 MB.', 'FILE_TOO_LARGE');
    if (bytes.includes(0)) throw new HttpError(415, 'Use file upload to write binary data.', 'BINARY_FILE');
    if (expectedVersion !== undefined && (typeof expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(expectedVersion))) throw new HttpError(400, 'Invalid file version.');
    return this.exclusive(id, async () => {
      await this.writeBytes(id, relative, bytes, { expectedVersion });
      return fileResult(relative, bytes);
    });
  }

  async upload(id: string, input: string, bytes: Buffer): Promise<FileEntry> {
    const relative = relativePath(input, false);
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Uploads must be smaller than 25 MB.', 'FILE_TOO_LARGE');
    return this.exclusive(id, async () => {
      await this.writeBytes(id, relative, bytes, { exclusive: true });
      return { name: path.posix.basename(relative), path: relative, kind: 'file', size: bytes.length, modifiedAt: new Date().toISOString() };
    });
  }

  async createEntry(id: string, input: string, kind: 'file' | 'directory'): Promise<FileEntry> {
    const relative = relativePath(input, false);
    if (kind !== 'file' && kind !== 'directory') throw new HttpError(400, 'kind must be file or directory.');
    return this.exclusive(id, async () => {
      if (kind === 'file') await this.writeBytes(id, relative, Buffer.alloc(0), { exclusive: true });
      else {
        const destination = await this.resolvePath(id, relative, { allowMissing: true });
        if (await lstatMaybe(destination)) throw new HttpError(409, 'A file or folder already exists at that path.', 'FILE_EXISTS');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        try { await fs.mkdir(await this.resolvePath(id, relative, { allowMissing: true })); }
        catch (error) { if (isErrno(error, 'EEXIST')) throw new HttpError(409, 'A file or folder already exists at that path.', 'FILE_EXISTS'); throw error; }
      }
      return { name: path.posix.basename(relative), path: relative, kind, ...(kind === 'file' ? { size: 0 } : {}), modifiedAt: new Date().toISOString() };
    });
  }

  async renameEntry(id: string, input: string, newInput: string): Promise<void> {
    return this.transferEntry(id, input, newInput, 'move');
  }

  async copyEntry(id: string, input: string, newInput: string): Promise<void> {
    return this.transferEntry(id, input, newInput, 'copy');
  }

  async listFileTransfers(id: string): Promise<FileTransferStatus[]> {
    await this.get(id);
    return listWorkspaceFileTransfers(this.config, id);
  }

  async listFileTransfersPage(id: string, input: OperationalPageInput = {}): Promise<FileTransferPage> {
    await this.getAvailable(id);
    return listWorkspaceFileTransfersPage(this.config, id, input);
  }

  async recoverFileTransfers(): Promise<void> {
    await this.initialize();
    await recoverFileTransfers(this.config, this.store);
  }

  private async transferEntry(id: string, input: string, newInput: string, kind: TransferKind): Promise<void> {
    const relative = relativePath(input, false);
    const newRelative = relativePath(newInput, false);
    return this.exclusive(id, async () => {
      const source = await this.entryPath(id, relative);
      const destination = await this.entryPath(id, newRelative, true);
      if (source === destination) {
        if (kind === 'move') return;
        throw new HttpError(400, 'Choose a different destination for the copy.', 'INVALID_PATH');
      }
      if (await lstatMaybe(destination)) throw new HttpError(409, 'The destination already exists. Choose another name.', 'FILE_EXISTS');
      const stat = await fs.lstat(source);
      if (stat.isDirectory() && within(source, destination)) throw new HttpError(400, 'A folder cannot be transferred inside itself.', 'INVALID_PATH');
      const root = await this.root(id);
      await transferWorkspaceEntry(this.config, this.store, {
        workspaceId: id, path: relative, newPath: newRelative, root, source, destination, kind,
        expectedSource: fileIdentity(stat),
        checkpointFileMetadata: this.checkpointFileMetadata,
        checkAllowed: async () => {
          this.fileMutationController.signal.throwIfAborted();
          const liveRoot = await this.root(id);
          const liveSource = await this.entryPath(id, relative);
          const liveDestination = await this.entryPath(id, newRelative, true);
          if (liveRoot !== root || liveSource !== source || liveDestination !== destination) {
            throw new HttpError(409, 'The file path changed during the transfer. Refresh and inspect both locations.', 'FILE_TRANSFER_CONFLICT');
          }
        },
      });
    });
  }

  private async trashRoot(id: string): Promise<string> {
    await this.get(id);
    const base = await fs.realpath(this.config.workspacesDir);
    let directory = base;
    for (const component of ['.trash', id]) {
      directory = path.join(directory, component);
      let stat = await lstatMaybe(directory);
      if (!stat) {
        try { await fs.mkdir(directory, { mode: 0o700 }); }
        catch (error) { if (!isErrno(error, 'EEXIST')) throw error; }
        stat = await fs.lstat(directory);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) {
        throw new HttpError(403, 'The trash directory is not a safe storage location.', 'UNSAFE_PATH');
      }
    }
    return directory;
  }

  async trashEntry(id: string, input: string): Promise<TrashEntry> {
    const relative = relativePath(input, false);
    return this.exclusive(id, async () => {
      const source = await this.entryPath(id, relative);
      const stat = await fs.lstat(source);
      const deletedAt = new Date().toISOString();
      const entry: TrashEntry = { id: randomUUID(), path: relative, kind: stat.isDirectory() ? 'directory' : 'file', deletedAt,
        expiresAt: new Date(Date.parse(deletedAt) + TRASH_RETENTION_MS).toISOString() };
      const directory = path.join(await this.trashRoot(id), entry.id);
      await fs.mkdir(directory, { mode: 0o700 });
      try {
        await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(entry), { flag: 'wx', mode: 0o600 });
        await fs.rename(await this.entryPath(id, relative), path.join(directory, 'content'));
      } catch (error) { await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined); throw error; }
      this.fileTrashPages?.invalidate(id);
      return entry;
    });
  }

  async fileTrashStatus(id: string): Promise<{ issue: string | null }> {
    await this.get(id);
    const problem = await this.store.read<{ issue?: unknown } | null>(fileTrashIssueKey(id), null);
    return { issue: typeof problem?.issue === 'string' ? 'Some expired file trash could not be deleted safely. Those files were retained and cleanup will retry.' : null };
  }

  async listFileTrashPage(id: string, input: FileTrashPageInput = {}): Promise<FileTrashPage> {
    const directory = await this.trashRoot(id);
    this.fileTrashPages ??= new FileTrashPager(this.config.sessionSecret);
    return this.fileTrashPages.page(id, directory, input, value => relativePath(value, false));
  }

  async getTrashEntry(id: string, trashId: string): Promise<TrashEntry> {
    validFileTrashId(trashId);
    return getFileTrashEntry(await this.trashRoot(id), trashId, value => relativePath(value, false));
  }

  async closeFileTrashPages(): Promise<void> {
    // Keep the closed instance as an admission latch for late HTTP requests.
    this.fileTrashPages ??= new FileTrashPager(this.config.sessionSecret);
    await this.fileTrashPages.close();
  }

  async listTrash(id: string): Promise<TrashEntry[]> {
    return legacyFileTrashList(await this.trashRoot(id), value => relativePath(value, false));
  }

  async restoreEntry(id: string, trashId: string, observed?: TrashEntry): Promise<TrashEntry> {
    validFileTrashId(trashId);
    return this.exclusive(id, async () => {
      const entry = await this.getTrashEntry(id, trashId);
      if (observed && (['id', 'path', 'kind', 'deletedAt', 'expiresAt'] as const).some(key => entry[key] !== observed[key])) {
        throw new HttpError(409, 'This trash entry changed before restoration. Refresh it before continuing.', 'VERSION_CONFLICT');
      }
      if (Date.parse(entry.expiresAt) <= Date.now()) throw new HttpError(410, 'This file trash entry has reached its 30-day expiry and cannot be restored.', 'FILE_TRASH_EXPIRED');
      const relative = relativePath(entry.path, false);
      const destination = await this.entryPath(id, relative, true);
      if (await lstatMaybe(destination)) throw new HttpError(409, 'A file already exists at the original path. Rename it before restoring.', 'FILE_EXISTS');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const liveDestination = await this.entryPath(id, relative, true);
      if (destination !== liveDestination || await lstatMaybe(liveDestination)) throw new HttpError(409, 'The original path changed. Refresh before restoring.', 'VERSION_CONFLICT');
      const directory = path.join(await this.trashRoot(id), trashId);
      if ((await fs.lstat(directory)).isSymbolicLink()) throw new HttpError(403, 'The trash entry is not safe to restore.', 'UNSAFE_PATH');
      await fs.rename(path.join(directory, 'content'), destination);
      await fs.rm(directory, { recursive: true, force: true });
      this.fileTrashPages?.invalidate(id);
      return entry;
    });
  }

  async filePaths(id: string, query = ''): Promise<string[]> {
    if (typeof query !== 'string' || query.length > 256) throw new HttpError(400, 'File-name queries must be shorter than 256 characters.');
    const root = await this.root(id);
    const ignored = ignore();
    try { ignored.add(textContent(await readBounded(path.join(root, '.gitignore'), 128 * 1024))); }
    catch (error) { if (!(error instanceof HttpError && [403, 404, 413, 415].includes(error.status))) throw error; }
    const queryCharacters = [...query.toLocaleLowerCase()];
    const isMatch = (filePath: string) => {
      if (!queryCharacters.length) return true;
      const characters = [...filePath.toLocaleLowerCase()];
      let index = 0;
      for (const character of characters) if (character === queryCharacters[index]) index++;
      return index === queryCharacters.length;
    };
    const result: string[] = [];
    let visited = 0;
    const walk = async (relative: string, depth: number): Promise<void> => {
      if (result.length >= 5000 || visited >= 25_000 || depth > 32) return;
      let children;
      try { children = await fs.readdir(await this.resolvePath(id, relative), { withFileTypes: true }); }
      catch (error) {
        if (error instanceof HttpError && [403, 404].includes(error.status) || isErrno(error, 'EACCES') || isErrno(error, 'ENOENT')) return;
        throw error;
      }
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (++visited > 25_000 || result.length >= 5000) return;
        if (child.isSymbolicLink() || SEARCH_SKIP.has(child.name) || child.name.startsWith('.codex-write-')) continue;
        const childPath = path.posix.join(relative, child.name);
        if (ignored.ignores(child.isDirectory() ? `${childPath}/` : childPath)) continue;
        if (child.isDirectory()) await walk(childPath, depth + 1);
        else if (child.isFile() && isMatch(childPath)) result.push(childPath);
      }
    };
    await walk('', 0);
    if (query) result.sort((a, b) => {
      const needle = query.toLocaleLowerCase();
      const aDirect = path.posix.basename(a).toLocaleLowerCase().includes(needle);
      const bDirect = path.posix.basename(b).toLocaleLowerCase().includes(needle);
      return aDirect !== bDirect ? (aDirect ? -1 : 1) : a.length - b.length || a.localeCompare(b);
    });
    return result;
  }

  private async documents(id: string, include?: string, explicitPaths?: string[]): Promise<{ documents: SearchDocument[]; truncated: boolean }> {
    const root = await this.root(id);
    const documents: SearchDocument[] = [];
    const matchesInclude = includeMatcher(include);
    let inspected = 0;
    let bytes = 0;
    let truncated = false;
    const consider = async (relative: string, absolute: string) => {
      if (inspected >= MAX_SEARCH_FILES || bytes >= MAX_SEARCH_BYTES) { truncated = true; return; }
      inspected++;
      if (!matchesInclude(relative)) return;
      try {
        const buffer = await readBounded(absolute, Math.min(MAX_TEXT_FILE_BYTES, MAX_SEARCH_BYTES - bytes));
        bytes += buffer.length;
        documents.push({ path: relative, content: textContent(buffer) });
      } catch (error) {
        if (error instanceof HttpError && error.status === 413 && MAX_SEARCH_BYTES - bytes < MAX_TEXT_FILE_BYTES) truncated = true;
        if (error instanceof HttpError && [404, 413, 415].includes(error.status)) return;
        if (isErrno(error, 'EACCES') || isErrno(error, 'ENOENT')) return;
        throw error;
      }
    };
    if (explicitPaths) {
      for (const input of [...new Set(explicitPaths)]) {
        const relative = relativePath(input, false);
        await consider(relative, await this.resolvePath(id, relative));
        if (truncated) break;
      }
    } else {
      let directories = 0;
      const walk = async (directory: string, relative: string, depth: number): Promise<void> => {
        if (++directories > 2500 || depth > 32) { truncated = true; return; }
        let children;
        try { children = await fs.readdir(directory, { withFileTypes: true }); }
        catch (error) { if (isErrno(error, 'EACCES') || isErrno(error, 'ENOENT')) return; throw error; }
        children.sort((a, b) => a.name.localeCompare(b.name));
        for (const child of children) {
          if (truncated) break;
          if (child.isSymbolicLink() || SEARCH_SKIP.has(child.name) || child.name.startsWith('.codex-write-')) continue;
          const relativeChild = path.posix.join(relative, child.name);
          // Resolve every directory again: a terminal may have changed it since readdir().
          let absolute;
          try { absolute = await this.resolvePath(id, relativeChild); }
          catch (error) { if (error instanceof HttpError && [403, 404].includes(error.status)) continue; throw error; }
          if (child.isDirectory()) await walk(absolute, relativeChild, depth + 1);
          else if (child.isFile()) await consider(relativeChild, absolute);
        }
      };
      await walk(root, '', 0);
    }
    return { documents, truncated };
  }

  async search(id: string, query: string, options: SearchOptions = {}): Promise<SearchMatch[]> {
    validateQuery(query);
    if (!query) { await this.get(id); return []; }
    const { documents } = await this.documents(id, options.include);
    return runSearchWorker(documents, query, options);
  }

  async replace(id: string, options: ReplaceOptions): Promise<{ files: number; replacements: number }> {
    validateQuery(options.query);
    if (!options.query) throw new HttpError(400, 'Enter text to replace.');
    if (typeof options.replacement !== 'string' || Buffer.byteLength(options.replacement, 'utf8') > 64 * 1024) throw new HttpError(400, 'Replacement text must be smaller than 64 KB.');
    if (options.paths !== undefined && (!Array.isArray(options.paths) || options.paths.length > 1000 || options.paths.some(value => typeof value !== 'string'))) throw new HttpError(400, 'Choose at most 1,000 file paths to replace.');
    if (options.caseSensitive !== undefined && typeof options.caseSensitive !== 'boolean') throw new HttpError(400, 'caseSensitive must be a boolean.');
    return this.exclusive(id, async () => {
      const { documents, truncated } = await this.documents(id, undefined, options.paths);
      if (truncated) throw new HttpError(413, 'This replacement spans too many files. Select a smaller set of files.', 'SEARCH_LIMIT');
      const expression = new RegExp(escapeExpression(options.query), options.caseSensitive ? 'gu' : 'giu');
      const updates: { path: string; original: string; content: string }[] = [];
      let replacements = 0;
      let totalOutputBytes = 0;
      for (const document of documents) {
        let count = 0;
        let outputBytes = Buffer.byteLength(document.content, 'utf8');
        const replacementBytes = Buffer.byteLength(options.replacement, 'utf8');
        const content = document.content.replace(expression, (match: string) => {
          count++;
          if (++replacements > MAX_REPLACEMENTS) throw new HttpError(413, 'This replacement has too many matches. Select fewer files.', 'SEARCH_LIMIT');
          outputBytes += replacementBytes - Buffer.byteLength(match, 'utf8');
          if (outputBytes > MAX_TEXT_FILE_BYTES) throw new HttpError(413, `Replacing text would make ${document.path} exceed the 5 MB file limit.`, 'FILE_TOO_LARGE');
          return options.replacement;
        });
        if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_FILE_BYTES) throw new HttpError(413, `Replacing text would make ${document.path} exceed the 5 MB file limit.`, 'FILE_TOO_LARGE');
        if (count && content !== document.content) {
          totalOutputBytes += outputBytes;
          if (totalOutputBytes > MAX_SEARCH_BYTES) throw new HttpError(413, 'This replacement would create too much data at once. Select fewer files.', 'SEARCH_LIMIT');
          updates.push({ path: document.path, original: document.content, content });
        }
      }
      const written: typeof updates = [];
      try {
        for (const update of updates) {
          await this.writeBytes(id, update.path, Buffer.from(update.content), { expectedVersion: versionOf(update.original) });
          written.push(update);
        }
      } catch (error) {
        let restored = true;
        for (const update of written.reverse()) {
          try { await this.writeBytes(id, update.path, Buffer.from(update.original), { expectedVersion: versionOf(update.content) }); }
          catch { restored = false; }
        }
        if (!restored) throw new HttpError(409, 'Replacement stopped after a concurrent edit. Some files changed; refresh the editor before continuing.', 'PARTIAL_REPLACE');
        throw error;
      }
      return { files: updates.length, replacements };
    });
  }
}

function validateQuery(query: unknown): asserts query is string {
  if (typeof query !== 'string' || query.length > 1024 || query.includes('\0')) throw new HttpError(400, 'Search queries must be text shorter than 1,024 characters.');
}

function escapeExpression(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function includeMatcher(input?: string): (filePath: string) => boolean {
  if (!input) return () => true;
  if (typeof input !== 'string' || input.length > 2048) throw new HttpError(400, 'File filters must be shorter than 2,048 characters.');
  const patterns = input.split(',').map(pattern => pattern.trim()).filter(Boolean);
  if (patterns.length > 30) throw new HttpError(400, 'Use at most 30 file filters.');
  const segmentMatch = (pattern: string, name: string): boolean => {
    const tokens = [...pattern];
    const characters = [...name];
    let states = new Uint8Array(characters.length + 1);
    states[0] = 1;
    for (const token of tokens) {
      const next = new Uint8Array(characters.length + 1);
      if (token === '*') next[0] = states[0];
      for (let index = 1; index <= characters.length; index++) {
        next[index] = token === '*' ? (states[index] || next[index - 1]) : states[index - 1] && (token === '?' || token === characters[index - 1]) ? 1 : 0;
      }
      states = next;
    }
    return states[characters.length] === 1;
  };
  const patternMatch = (pattern: string, filePath: string): boolean => {
    if (!pattern.includes('/')) return segmentMatch(pattern, path.posix.basename(filePath));
    const patternParts = pattern.replace(/^\.\//, '').split('/');
    const fileParts = filePath.split('/');
    const memo = new Map<string, boolean>();
    const match = (patternIndex: number, fileIndex: number): boolean => {
      const key = `${patternIndex}:${fileIndex}`;
      if (memo.has(key)) return memo.get(key)!;
      let result: boolean;
      if (patternIndex === patternParts.length) result = fileIndex === fileParts.length;
      else if (patternParts[patternIndex] === '**') result = match(patternIndex + 1, fileIndex) || fileIndex < fileParts.length && match(patternIndex, fileIndex + 1);
      else result = fileIndex < fileParts.length && segmentMatch(patternParts[patternIndex], fileParts[fileIndex]) && match(patternIndex + 1, fileIndex + 1);
      memo.set(key, result);
      return result;
    };
    return match(0, 0);
  };
  return filePath => !patterns.length || patterns.some(pattern => patternMatch(pattern, filePath));
}

// Untrusted regular expressions run off the server event loop and have a hard deadline.
const SEARCH_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
try {
  const { documents, query, regex, caseSensitive, limit } = workerData;
  const source = regex ? query : query.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, '\\$&');
  const expression = new RegExp(source, caseSensitive ? 'gu' : 'giu');
  const matches = [];
  outer: for (const document of documents) {
    const lines = document.content.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
      expression.lastIndex = 0;
      let match;
      while ((match = expression.exec(lines[line])) !== null) {
        matches.push({ path: document.path, line: line + 1, column: match.index + 1, text: lines[line].slice(0, 1200) });
        if (matches.length >= limit) break outer;
        if (!match[0].length) expression.lastIndex += lines[line].codePointAt(expression.lastIndex) > 0xffff ? 2 : 1;
      }
    }
  }
  parentPort.postMessage({ matches });
} catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : 'Invalid search expression.' }); }
`;

async function runSearchWorker(documents: SearchDocument[], query: string, options: SearchOptions): Promise<SearchMatch[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(SEARCH_WORKER, {
      eval: true,
      workerData: { documents, query, regex: options.regex === true, caseSensitive: options.caseSensitive === true, limit: MAX_SEARCH_MATCHES },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const finish = (error?: Error, matches?: SearchMatch[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(matches ?? []);
    };
    const timer = setTimeout(() => finish(new HttpError(400, 'This search expression took too long. Use a simpler expression or a narrower file filter.', 'SEARCH_TIMEOUT')), 2000);
    worker.once('message', (result: { error?: string; matches?: SearchMatch[] }) => {
      if (result.error) finish(new HttpError(400, `Invalid search expression: ${result.error}`, 'INVALID_REGEX'));
      else finish(undefined, result.matches);
    });
    worker.once('error', () => finish(new HttpError(400, 'The search exceeded its resource limit. Narrow the search and try again.', 'SEARCH_LIMIT')));
    worker.once('exit', code => { if (!settled) finish(new HttpError(500, `Search stopped unexpectedly (${code}).`, 'SEARCH_FAILED')); });
  });
}

function queryString(value: unknown, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new HttpError(400, 'Query parameters must be single text values.');
  return value;
}

function queryBoolean(value: unknown): boolean {
  if (value === undefined || value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  throw new HttpError(400, 'Boolean query parameters must be true or false.');
}

export function createWorkspaceRouter(ctx: AppContext): Router {
  const router = Router();
  const service = ctx.workspaces;
  const changed = (workspaceId: string, paths?: string[]) => ctx.events.emit('workspace:changed', { workspaceId, ...(paths ? { paths } : {}) });
  const manualPaths = async (workspaceId: string, inputs: unknown[], followLeaf = true): Promise<string[]> => {
    const paths = new Set(inputs.map(input => relativePath(input, false)));
    const root = await service.resolvePath(workspaceId, '');
    for (const relative of [...paths]) {
      // Saves follow internal links, while rename/trash/restore move the link itself.
      const absolute = followLeaf
        ? await service.resolvePath(workspaceId, relative, { allowMissing: true })
        : path.join(await service.resolvePath(workspaceId, path.posix.dirname(relative), { allowMissing: true }), path.posix.basename(relative));
      paths.add(path.relative(root, absolute).split(path.sep).join('/'));
    }
    return [...paths];
  };
  const manualMutation = async <T>(workspaceId: string, paths: string[] | undefined, operation: () => Promise<T>): Promise<T> => {
    const payload = { workspaceId, operationId: randomUUID(), ...(paths ? { paths } : {}) };
    // Announce intent before any awaited write so a concurrent shell checkpoint cannot claim an editor save.
    ctx.events.emit('workspace:manual-intent', { ...payload, phase: 'start' });
    try {
      const result = await operation();
      changed(workspaceId, paths);
      return result;
    } finally { ctx.events.emit('workspace:manual-intent', { ...payload, phase: 'end' }); }
  };
  router.get('/workspaces', async (req, res) => {
    res.json(Object.keys(req.query).length ? await getWorkspacePage(ctx, workspacePageInput(req.query)) : await service.list());
  });
  router.get('/workspaces/:id', async (req, res) => { res.json(await service.getAvailable(req.params.id)); });
  router.post('/workspaces', async (req, res) => {
    const workspace = await service.create({ name: req.body?.name, initializeGit: req.body?.initializeGit });
    changed(workspace.id, []);
    res.status(201).json(workspace);
  });
  router.patch('/workspaces/:id', async (req, res) => {
    const workspace = await service.update(req.params.id, req.body);
    changed(workspace.id, []);
    res.json(workspace);
  });
  const emptyTrashBody = (value: unknown) => {
    if (value === undefined || value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return;
    throw new HttpError(400, 'This workspace trash action does not accept options or a force flag.', 'INVALID_WORKSPACE_TRASH_INPUT');
  };
  router.delete('/workspaces/:id', async (req, res) => {
    const body = req.body ?? {};
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'expectedMode')
      || body.expectedMode !== undefined && !['trash', 'permanent'].includes(body.expectedMode)) {
      throw new HttpError(400, 'Provide only the expected workspace deletion mode.', 'INVALID_WORKSPACE_TRASH_INPUT');
    }
    const result = await service.trashWorkspace(req.params.id, body);
    changed(req.params.id, []);
    res.json(result);
  });
  router.get('/workspaces/:id/deletion', async (req, res) => { res.json(await service.getWorkspaceDeletionPlan(req.params.id)); });
  router.get('/workspace-trash', async (_req, res) => { res.json(await service.listWorkspaceTrash()); });
  router.get('/workspace-trash/page', async (req, res) => { res.json(await service.listWorkspaceTrashPage(parseOperationalPageQuery(req.query))); });
  router.get('/workspace-deletions', async (_req, res) => { res.json(await service.listWorkspaceDeletions()); });
  router.get('/workspace-deletions/page', async (req, res) => { res.json(await service.listWorkspaceDeletionPage(parseOperationalPageQuery(req.query))); });
  router.post('/workspace-deletions/:id/retry', async (req, res) => {
    emptyTrashBody(req.body);
    res.json(await service.retryWorkspaceDeletion(req.params.id));
  });
  router.post('/workspace-trash/:id/restore', async (req, res) => {
    emptyTrashBody(req.body);
    const workspace = await service.restoreWorkspaceTrash(req.params.id);
    changed(workspace.id, []);
    res.json(workspace);
  });
  router.delete('/workspace-trash/:id', async (req, res) => {
    emptyTrashBody(req.body);
    res.json(await service.purgeWorkspaceTrash(req.params.id));
  });
  router.get('/workspaces/:id/tree', async (req, res) => { res.json(await service.listTree(req.params.id, queryString(req.query.path))); });
  router.get('/workspaces/:id/file-paths', async (req, res) => { res.json(await service.filePaths(req.params.id, queryString(req.query.q))); });
  router.get('/workspaces/:id/file', async (req, res) => { res.json(await service.readFile(req.params.id, queryString(req.query.path))); });
  router.put('/workspaces/:id/file', async (req, res) => {
    const paths = await manualPaths(req.params.id, [req.body?.path]);
    const file = await manualMutation(req.params.id, paths, () => service.writeFile(req.params.id, req.body?.path, req.body?.content, req.body?.expectedVersion));
    res.json(file);
  });
  router.post('/workspaces/:id/files', async (req, res) => {
    const paths = await manualPaths(req.params.id, [req.body?.path]);
    const entry = await manualMutation(req.params.id, paths, () => service.createEntry(req.params.id, req.body?.path, req.body?.kind));
    res.status(201).json(entry);
  });
  router.post('/workspaces/:id/rename', async (req, res) => {
    const paths = await manualPaths(req.params.id, [req.body?.path, req.body?.newPath], false);
    await manualMutation(req.params.id, paths, async () => {
      try { await service.renameEntry(req.params.id, req.body?.path, req.body?.newPath); }
      catch (error) { changed(req.params.id, paths); throw error; }
    });
    res.json({ renamed: true });
  });
  router.post('/workspaces/:id/copy', async (req, res) => {
    const newPath = relativePath(req.body?.newPath, false);
    const paths = await manualPaths(req.params.id, [newPath], false);
    await manualMutation(req.params.id, paths, async () => {
      try { await service.copyEntry(req.params.id, req.body?.path, newPath); }
      catch (error) { changed(req.params.id, paths); throw error; }
    });
    res.json({ copied: true, path: newPath });
  });
  router.get('/workspaces/:id/file-transfers', async (req, res) => { res.json(await service.listFileTransfers(req.params.id)); });
  router.get('/workspaces/:id/file-transfers/page', async (req, res) => { res.json(await service.listFileTransfersPage(req.params.id, parseOperationalPageQuery(req.query))); });
  router.delete('/workspaces/:id/file', async (req, res) => {
    const relative = queryString(req.query.path);
    const paths = await manualPaths(req.params.id, [relative], false);
    const entry = await manualMutation(req.params.id, paths, () => service.trashEntry(req.params.id, relative));
    res.json({ trashed: true, trashId: entry.id });
  });
  router.get('/workspaces/:id/trash', async (req, res) => { res.json(await service.listTrash(req.params.id)); });
  router.get('/workspaces/:id/trash/page', async (req, res) => { res.json(await service.listFileTrashPage(req.params.id, fileTrashPageInput(req.query))); });
  router.get('/workspaces/:id/trash-status', async (req, res) => { res.json(await service.fileTrashStatus(req.params.id)); });
  router.post('/workspaces/:id/restore', async (req, res) => {
    const original = await service.getTrashEntry(req.params.id, req.body?.trashId);
    const paths = await manualPaths(req.params.id, [original.path], false);
    const entry = await manualMutation(req.params.id, paths, () => service.restoreEntry(req.params.id, req.body?.trashId, original));
    res.json(entry);
  });
  router.get('/workspaces/:id/search', async (req, res) => {
    const matches = await service.search(req.params.id, queryString(req.query.q), {
      caseSensitive: queryBoolean(req.query.caseSensitive), regex: queryBoolean(req.query.regex), include: queryString(req.query.include),
    });
    res.json(matches);
  });
  router.post('/workspaces/:id/replace', async (req, res) => {
    res.json(await manualMutation(req.params.id, undefined, () => service.replace(req.params.id, req.body ?? {})));
  });
  router.get('/workspaces/:id/download', async (req, res, next) => {
    const relative = relativePath(queryString(req.query.path), false);
    const absolute = await service.resolvePath(req.params.id, relative);
    let handle;
    try { handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if (isErrno(error, 'ELOOP')) throw new HttpError(403, 'The file changed into a symbolic link. Refresh and try again.', 'UNSAFE_PATH');
      if (isErrno(error, 'ENOENT')) throw new HttpError(404, 'File not found.', 'FILE_NOT_FOUND');
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new HttpError(400, 'Choose a regular file to download.', 'NOT_A_FILE');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', stat.size);
      res.attachment(path.posix.basename(relative));
      const stream = handle.createReadStream();
      res.once('close', () => stream.destroy());
      stream.once('error', error => next(error));
      stream.pipe(res);
    } catch (error) { await handle.close(); throw error; }
  });
  router.put('/workspaces/:id/upload', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send upload contents as raw bytes with Content-Type: application/octet-stream.');
    const relative = queryString(req.query.path);
    const paths = await manualPaths(req.params.id, [relative]);
    const entry = await manualMutation(req.params.id, paths, () => service.upload(req.params.id, relative, req.body));
    res.status(201).json(entry);
  });
  return router;
}
