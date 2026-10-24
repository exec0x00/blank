import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readlink, rename, symlink, unlink, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { createTwoFilesPatch } from 'diff';
import type { GitDiff, GitFile, GitStatus, Workspace } from '../shared/types';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { getGithubAccount, withGitCredentials } from './github';
import { assertGitIdentity, GIT_IDENTITY_ARGS, inspectWorkspaceRepository } from './worktrees/validation';
import { acquireWorkspaceActivity } from './worktrees/activity';
import { emptyGitSummary, GitBranchScanner, GitStatusScanner, parseGitListQuery, type GitBranchPage, type GitFilePage, type GitStatusSummary } from './git-listing';

const OUTPUT_LIMIT = 8 * 1024 * 1024;
const PREVIEW_LIMIT = 2 * 1024 * 1024;
const DISCARD_LIMIT = 50 * 1024 * 1024;
const LIST_SCAN_LIMIT = 256 * 1024 * 1024;
const STATUS_ARGUMENTS = ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'];
const SAFE_ENVIRONMENT = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ', 'SystemRoot'];
export type GitResult = { code: number; stdout: Buffer; stderr: Buffer };
export type GitOptions = {
  env?: NodeJS.ProcessEnv; allowFailure?: boolean; timeout?: number; outputLimit?: number; signal?: AbortSignal;
  /** Internal only: a server-created disposable index for fresh content checks. */
  temporaryIndex?: string;
  /** Internal bounded reducer. Streaming output is never retained by runner. */
  onStdout?: (chunk: Buffer) => void;
};
type FileSnapshot = { kind: 'file' | 'symlink' | 'missing'; content?: string; mode?: number };
type DiscardBackup = {
  workspaceId: string;
  createdAt: string;
  state: 'pending' | 'ready' | 'restored';
  files: { path: string; before: FileSnapshot; after?: string }[];
};

function baseEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENVIRONMENT) if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_LFS_SKIP_SMUDGE: '1',
    LC_ALL: 'C.UTF-8',
  };
}

/** Redact even errors from an incorrectly configured remote before they reach the browser. */
function redact(value: string, env: NodeJS.ProcessEnv = {}): string {
  let clean = value
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@')
    .replace(/\b(?:github_pat_|gh[pousr]_|hf_)[A-Za-z0-9_]+\b/g, '[redacted]')
    .replace(/([?&](?:access_token|token|password|key)=)[^\s&]+/gi, '$1[redacted]');
  for (const [key, secret] of Object.entries(env)) {
    if (secret && secret.length >= 8 && /TOKEN|PASSWORD|SECRET|(?:^|_)KEY$/i.test(key)) clean = clean.split(secret).join('[redacted]');
  }
  return clean;
}

function gitFailure(result: GitResult, env: NodeJS.ProcessEnv): HttpError {
  const detail = redact((result.stderr.toString('utf8') || result.stdout.toString('utf8')).trim(), env).slice(0, 2800);
  if (/authentication failed|could not read Username|could not read Password|terminal prompts disabled|permission denied.*publickey/i.test(detail)) {
    return new HttpError(401, 'Git authentication failed. Choose a connected GitHub account with access to this repository.', 'GIT_AUTHENTICATION');
  }
  if (/would be overwritten|local changes.*overwritten|untracked working tree files|cannot pull.*unstaged changes/is.test(detail)) {
    return new HttpError(409, 'Git kept your local edits. Commit or discard the affected changes before continuing.\n' + detail, 'GIT_LOCAL_CHANGES');
  }
  if (/not possible to fast-forward|need to specify how to reconcile|divergent branches/i.test(detail)) {
    return new HttpError(409, 'The branches have diverged. Resolve the history in the terminal before pulling; your local commits were preserved.', 'GIT_DIVERGED');
  }
  if (/non-fast-forward|fetch first|failed to push some refs/i.test(detail)) {
    return new HttpError(409, 'The remote has changes. Pull before pushing, or resolve diverged history in the terminal.\n' + detail, 'GIT_PUSH_REJECTED');
  }
  if (/index\.lock.*exists|another git process/is.test(detail)) {
    return new HttpError(409, 'Another Git operation is using this repository. Wait for it to finish and try again.', 'GIT_LOCKED');
  }
  return new HttpError(422, detail || 'Git could not complete this operation.', 'GIT_FAILED');
}

/** Callers validate the repository first. This runner also supports an owned,
 * not-yet-registered checkout while the worktree manager is creating it. */
export async function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = {
    ...baseEnvironment(), ...options.env,
    GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1',
    GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ATTR_NOSYSTEM: '1', GIT_LFS_SKIP_SMUDGE: '1',
    // Repository protocol.<helper>.allow overrides protocol.allow. The explicit
    // allowlist still blocks a selected remote.<name>.vcs helper from inheriting
    // an authenticated askpass environment after its HTTPS URL was validated.
    GIT_ALLOW_PROTOCOL: options.env?.CW_GITHUB_TOKEN ? 'https' : 'https:file',
  };
  for (const key of Object.keys(env)) if (/^(?:https?|all|ftp|no)_proxy$/i.test(key)) delete env[key];
  for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_CONFIG',
    'GIT_CONFIG_PARAMETERS', 'GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
    'GIT_EXTERNAL_DIFF', 'GIT_DIFF_OPTS']) delete env[key];
  if (options.temporaryIndex !== undefined) {
    if (!path.isAbsolute(options.temporaryIndex) || path.resolve(options.temporaryIndex) !== options.temporaryIndex
      || options.temporaryIndex.length > 4096 || /[\u0000-\u001f\u007f]/.test(options.temporaryIndex)
      || env.CW_GITHUB_TOKEN) throw new HttpError(409, 'A temporary Git inspection index is invalid.', 'INVALID_GIT_INSPECTION');
    // This explicit trusted option is separate from inherited environment and
    // is never supplied by a client or a credentialed network operation.
    env.GIT_INDEX_FILE = options.temporaryIndex;
  }
  // Keep the trusted askpass helper's command-local HTTPS restrictions. Only
  // the public configured key names are inspected; credentials never enter argv.
  const command = [
    '-c', 'color.ui=false', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'http.proxy=',
    '-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true', '-c', 'http.extraHeader=',
    '-c', 'core.gitProxy=', '-c', 'safe.directory=', '-c', `safe.directory=${cwd}`,
    '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null', '-c', 'attr.tree=',
    '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'push.gpgSign=false', '-c', 'submodule.recurse=false',
    '-c', 'fetch.recurseSubmodules=false', '-c', 'push.recurseSubmodules=no',
    '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'gc.autoDetach=false',
  ];
  const filters = await executeGit(cwd, [...command, 'config', '--null', '--name-only', '--get-regexp', options.env ? '^(filter\\.|http\\.)' : '^filter\\.'], {
    ...options, onStdout: undefined, env, allowFailure: true, timeout: Math.min(options.timeout ?? 10_000, 10_000), outputLimit: 256 * 1024,
  });
  if (filters.code !== 0 && filters.code !== 1) throw gitFailure(filters, env);
  const drivers = new Set<string>();
  for (const key of filters.stdout.toString('utf8').split('\0')) {
    if (options.env && /^http\./i.test(key)) {
      // URL-scoped scalar settings outrank a later generic -c override. Reset
      // every configured scope before any helper receives account credentials.
      const attribute = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
      if (env.CW_GITHUB_TOKEN && ['sslcainfo', 'sslcapath', 'sslcert', 'sslkey'].includes(attribute)) {
        throw new HttpError(409, 'Remove repository-specific TLS certificate and key paths before using a connected GitHub account.', 'UNSAFE_GIT_TLS');
      }
      const override = ({ proxy: '', followredirects: 'false', extraheader: '', sslverify: 'true' } as Record<string, string | undefined>)[attribute];
      if (override !== undefined) {
        if (key.length > 8192 || /[=\u0000-\u001f\u007f]/.test(key)) throw new HttpError(409, 'A scoped Git HTTP setting has an unsupported name.', 'UNSAFE_GIT_HTTP');
        command.push('-c', `${key}=${override}`);
      }
    }
    const match = /^filter\.(.+)\.(?:process|clean|smudge|required)$/i.exec(key);
    if (!match) continue;
    if (match[1].length > 1024 || /[=\u0000-\u001f\u007f]/.test(match[1])) throw new HttpError(409, 'A Git filter has an unsupported name. Remove that filter before using this repository here.', 'UNSAFE_GIT_FILTER');
    drivers.add(match[1]);
    if (drivers.size > 512) throw new HttpError(413, 'This repository has too many configured Git filters.', 'GIT_FILTER_LIMIT');
  }
  for (const driver of drivers) for (const [attribute, value] of [['process', ''], ['clean', ''], ['smudge', ''], ['required', 'false']]) {
    command.push('-c', `filter.${driver}.${attribute}=${value}`);
  }
  return executeGit(cwd, [...command, ...args], { ...options, env });
}

async function executeGit(cwd: string, command: string[], options: GitOptions & { env: NodeJS.ProcessEnv }): Promise<GitResult> {
  const env = options.env;
  const interrupted = () => new HttpError(503, 'The Git operation was stopped while the server was restarting. Existing files were preserved; inspect the checkout before continuing.', 'GIT_INTERRUPTED');
  if (options.signal?.aborted) throw interrupted();
  return await new Promise<GitResult>((resolve, reject) => {
    const child = spawn('git', command, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let stderrSize = 0;
    let problem: HttpError | undefined;
    let forceTimer: NodeJS.Timeout | undefined;
    let stopping: Promise<void> | undefined;
    let finishStopping: (() => void) | undefined;
    const stop = () => {
      if (stopping) return;
      stopping = new Promise<void>(done => { finishStopping = done; });
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch { /* Already exited. */ }
      forceTimer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* Already exited. */ }
        finishStopping?.();
      }, 1000);
      // Keep shutdown escalation alive even if Git exits before a descendant
      // which already closed its stdio. Awaiting a Promise alone cannot do that.
    };
    const timer = setTimeout(() => {
      problem = new HttpError(504, 'The Git operation timed out. Check the repository or network connection and try again.', 'GIT_TIMEOUT');
      stop();
    }, options.timeout ?? 30_000);
    timer.unref();
    const abort = () => { problem = interrupted(); stop(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const collect = (chunks: Buffer[], data: Buffer, streaming = false) => {
      if (problem) return;
      size += data.length;
      if (chunks === stderr) stderrSize += data.length;
      if (size > (options.outputLimit ?? OUTPUT_LIMIT) || (options.onStdout && stderrSize > 256 * 1024)) {
        problem = new HttpError(413, 'This Git result is too large to display. Narrow the change or use the terminal.', 'GIT_OUTPUT_LIMIT');
        stop();
      } else if (streaming && options.onStdout) {
        try { options.onStdout(data); }
        catch (error) { problem = error instanceof HttpError ? error : new HttpError(422, 'The Git list could not be read. Refresh and try again.', 'GIT_LIST_INVALID'); stop(); }
      } else chunks.push(data);
    };
    child.stdout.on('data', (data: Buffer) => collect(stdout, data, true));
    child.stderr.on('data', (data: Buffer) => collect(stderr, data));
    child.on('error', () => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      finishStopping?.();
      options.signal?.removeEventListener('abort', abort);
      reject(new HttpError(503, 'Git could not be started on this instance.', 'GIT_UNAVAILABLE'));
    });
    child.on('close', async code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      // On interruption retain the escalation even if Git exits before its
      // same-group native children. The manager waits until this drain ends.
      if (stopping) await stopping;
      if (forceTimer) clearTimeout(forceTimer);
      if (problem) return reject(problem);
      const result = { code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (result.code !== 0 && !options.allowFailure) reject(gitFailure(result, env));
      else resolve(result);
    });
  });
}

function relativeFile(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0') || path.posix.isAbsolute(value)) {
    throw new HttpError(400, 'Choose a valid file inside this workspace.', 'INVALID_PATH');
  }
  const parts = value.split('/');
  if (parts.some(part => part === '..' || part.toLowerCase() === '.git')) throw new HttpError(400, 'Git metadata and paths outside the workspace cannot be changed here.', 'INVALID_PATH');
  const clean = parts.filter(part => part !== '' && part !== '.').join('/');
  if (!clean) throw new HttpError(400, 'Choose individual files, not the workspace root.', 'INVALID_PATH');
  return clean;
}

function requestedPaths(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 5000) throw new HttpError(400, 'Choose between 1 and 5,000 files.', 'INVALID_PATHS');
  const paths = [...new Set(value.map(relativeFile))];
  if (paths.reduce((bytes, entry) => bytes + Buffer.byteLength(entry) + 1, 0) > 512 * 1024) throw new HttpError(413, 'Choose fewer files for a single Git operation.', 'GIT_PATH_LIMIT');
  return paths;
}

function parseStatus(output: string): Pick<GitStatus, 'branch' | 'ahead' | 'behind' | 'files'> {
  const entries = output.split('\0');
  const header = entries[0]?.startsWith('## ') ? entries.shift()!.slice(3) : '';
  let branch = header.replace(/^(?:No commits yet on|Initial commit on) /, '').split('...')[0].split(' [')[0];
  if (branch.startsWith('HEAD ')) branch = 'HEAD';
  const files: GitFile[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.length < 4) continue;
    const index = entry[0];
    const working = entry[1];
    const filePath = entry.slice(3);
    const originalPath = /[RC]/.test(index + working) ? entries[++i] : undefined;
    if (index === '?' && working === '?') {
      files.push({ path: filePath, status: '?', staged: false });
    } else if (index === 'U' || working === 'U' || ['AA', 'DD'].includes(index + working)) {
      files.push({ path: filePath, status: 'U', staged: false, ...(originalPath ? { originalPath } : {}) });
    } else {
      if (index !== ' ' && index !== '!') files.push({ path: filePath, status: index, staged: true, ...(originalPath ? { originalPath } : {}) });
      if (working !== ' ' && working !== '!') files.push({ path: filePath, status: working, staged: false, ...(originalPath ? { originalPath } : {}) });
    }
  }
  return { branch, ahead: Number(header.match(/ahead (\d+)/)?.[1] ?? 0), behind: Number(header.match(/behind (\d+)/)?.[1] ?? 0), files };
}

function snapshotVersion(snapshot: FileSnapshot): string {
  return createHash('sha256').update(snapshot.kind).update('\0').update(String(snapshot.mode ?? '')).update('\0').update(snapshot.content ?? '').digest('hex');
}

export class GitService {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly ctx: AppContext) {}

  private async locked<T>(workspaceId: string, callback: () => Promise<T>): Promise<T> {
    const releaseActivity = acquireWorkspaceActivity(this.ctx.config.workspacesDir, workspaceId, 'git');
    const previous = this.locks.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => wait);
    this.locks.set(workspaceId, tail);
    try {
      await previous.catch(() => undefined);
      return await callback();
    }
    finally {
      release();
      if (this.locks.get(workspaceId) === tail) this.locks.delete(workspaceId);
      releaseActivity();
    }
  }

  private changed(workspaceId: string, paths?: string[]): void {
    this.ctx.events.emit('workspace:changed', { workspaceId, ...(paths ? { paths } : {}) });
  }

  /** Keep manual mutations excluded from agent review throughout long-running Git commands. */
  private async manualMutation<T>(workspaceId: string, paths: string[] | undefined, operation: () => Promise<T>): Promise<T> {
    const detail = { workspaceId, operationId: randomUUID(), ...(paths ? { paths } : {}) };
    this.ctx.events.emit('workspace:manual-intent', { ...detail, phase: 'start' });
    try {
      const result = await operation();
      this.changed(workspaceId, paths);
      return result;
    } finally {
      this.ctx.events.emit('workspace:manual-intent', { ...detail, phase: 'end' });
    }
  }

  private async workspace(workspaceId: string, required = true): Promise<{ workspace: Workspace; repository: boolean }> {
    const workspace = await this.ctx.workspaces.get(workspaceId);
    const identity = await inspectWorkspaceRepository(this.ctx, workspace, required);
    if (!identity) return { workspace, repository: false };
    assertGitIdentity(identity, (await runGit(identity.root, GIT_IDENTITY_ARGS)).stdout);
    return { workspace, repository: true };
  }

  private async filePath(workspaceId: string, filePath: string): Promise<string> {
    const valid = relativeFile(filePath);
    const directory = path.posix.dirname(valid);
    const parent = await this.ctx.workspaces.resolvePath(workspaceId, directory === '.' ? '' : directory, { allowMissing: true });
    return path.join(parent, path.posix.basename(valid));
  }

  private async snapshot(workspaceId: string, filePath: string, limit = DISCARD_LIMIT): Promise<FileSnapshot> {
    const target = await this.filePath(workspaceId, filePath);
    const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return { kind: 'missing' };
    if (stat.isDirectory()) throw new HttpError(422, 'Inspect nested repositories and submodules from the terminal.', 'GIT_SUBMODULE');
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new HttpError(422, 'Only regular files and symbolic links are supported.', 'UNSUPPORTED_FILE');
    if (stat.size > limit) throw new HttpError(413, `This file exceeds the ${Math.round(limit / 1024 / 1024)} MiB limit for this operation.`, 'FILE_TOO_LARGE');
    let bytes: Buffer;
    if (stat.isSymbolicLink()) bytes = Buffer.from(await readlink(target), 'utf8');
    else {
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ELOOP') throw new HttpError(409, 'This file changed into a symbolic link. Refresh and try again.', 'GIT_STATUS_CHANGED');
        throw error;
      });
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.size > limit) throw new HttpError(413, 'This entry changed or grew beyond the preview limit. Refresh and try again.', 'FILE_TOO_LARGE');
        const chunks: Buffer[] = [];
        let total = 0;
        while (true) {
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - total));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          total += bytesRead;
          if (total > limit) throw new HttpError(413, 'This file grew beyond the size limit while it was being read.', 'FILE_TOO_LARGE');
          chunks.push(buffer.subarray(0, bytesRead));
        }
        bytes = Buffer.concat(chunks, total);
      } finally { await handle.close(); }
    }
    if (bytes.length > limit) throw new HttpError(413, 'This file is too large for this operation.', 'FILE_TOO_LARGE');
    return { kind: stat.isSymbolicLink() ? 'symlink' : 'file', content: bytes.toString('base64'), mode: stat.mode & 0o777 };
  }

  private async writeSnapshot(workspaceId: string, filePath: string, snapshot: FileSnapshot): Promise<void> {
    const target = await this.filePath(workspaceId, filePath);
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing?.isDirectory()) throw new HttpError(409, `“${filePath}” is now a directory. Move it before restoring this file.`, 'RESTORE_CONFLICT');
    if (snapshot.kind === 'missing') {
      if (existing) await unlink(target);
      return;
    }
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = path.join(path.dirname(target), `.codex-restore-${randomUUID()}`);
    try {
      const bytes = Buffer.from(snapshot.content ?? '', 'base64');
      if (snapshot.kind === 'symlink') await symlink(bytes.toString('utf8'), temporary);
      else {
        await writeFile(temporary, bytes, { flag: 'wx', mode: snapshot.mode ?? 0o644 });
        await chmod(temporary, snapshot.mode ?? 0o644);
      }
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async status(workspaceId: string): Promise<GitStatus> {
    const { workspace, repository } = await this.workspace(workspaceId, false);
    if (!repository) return { isRepository: false, branch: '', ahead: 0, behind: 0, files: [], branches: [] };
    const [result, refs, remotes] = await Promise.all([
      runGit(workspace.path, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all']),
      runGit(workspace.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']),
      runGit(workspace.path, ['remote']),
    ]);
    const parsed = parseStatus(result.stdout.toString('utf8'));
    const remoteNames = remotes.stdout.toString('utf8').trim().split('\n').filter(Boolean);
    const remoteName = remoteNames.includes('origin') ? 'origin' : remoteNames[0];
    const remote = remoteName ? await runGit(workspace.path, ['remote', 'get-url', '--', remoteName], { allowFailure: true }) : undefined;
    const branches = [...new Set(refs.stdout.toString('utf8').trim().split('\n').filter(name => name && !name.endsWith('/HEAD')))];
    if (parsed.branch && parsed.branch !== 'HEAD' && !branches.includes(parsed.branch)) branches.unshift(parsed.branch);
    return {
      isRepository: true, ...parsed, branches,
      ...(remote && remote.code === 0 ? { remote: redact(remote.stdout.toString('utf8').trim()) } : {}),
    };
  }

  private async scanStatus(workspace: Workspace, scanner = new GitStatusScanner(workspace.id), signal?: AbortSignal) {
    await runGit(workspace.path, STATUS_ARGUMENTS, { onStdout: chunk => scanner.write(chunk), outputLimit: LIST_SCAN_LIMIT, signal });
    return scanner.finish();
  }

  private async selectedChanges(workspace: Workspace, paths: readonly string[]): Promise<GitFile[]> {
    const scanner = new GitStatusScanner(workspace.id, undefined, new Set(paths));
    return (await this.scanStatus(workspace, scanner)).selectedFiles;
  }

  async summary(workspaceId: string, signal?: AbortSignal): Promise<GitStatusSummary> {
    const { workspace, repository } = await this.workspace(workspaceId, false);
    if (!repository) return emptyGitSummary();
    const [{ summary }, remotes] = await Promise.all([this.scanStatus(workspace, undefined, signal), runGit(workspace.path, ['remote'], { outputLimit: 256 * 1024, signal })]);
    const remoteNames = remotes.stdout.toString('utf8').trim().split('\n').filter(Boolean);
    const remoteName = remoteNames.includes('origin') ? 'origin' : remoteNames[0];
    const remote = remoteName ? await runGit(workspace.path, ['remote', 'get-url', '--', remoteName], { allowFailure: true, outputLimit: 256 * 1024, signal }) : undefined;
    return { ...summary, ...(remote?.code === 0 ? { remote: redact(remote.stdout.toString('utf8').trim()) } : {}) };
  }

  async changesPage(workspaceId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<GitFilePage> {
    if (input.staged !== 'true' && input.staged !== 'false') throw new HttpError(400, 'Choose staged or working changes.', 'INVALID_GIT_PAGE');
    const staged = input.staged === 'true';
    const query = parseGitListQuery(input, `${workspaceId}:${staged ? 'staged' : 'working'}`);
    const { workspace } = await this.workspace(workspaceId);
    const scanner = new GitStatusScanner(workspaceId, { query, staged });
    return (await this.scanStatus(workspace, scanner, signal)).page!;
  }

  async branchesPage(workspaceId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<GitBranchPage> {
    const query = parseGitListQuery(input, `${workspaceId}:branches`);
    const { workspace } = await this.workspace(workspaceId);
    const scanner = new GitBranchScanner(query);
    await runGit(workspace.path, ['for-each-ref', '--sort=refname', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], { onStdout: chunk => scanner.write(chunk), outputLimit: LIST_SCAN_LIMIT, signal });
    return scanner.finish();
  }

  async stageAll(workspaceId: string, staged: boolean): Promise<GitStatusSummary> {
    return this.locked(workspaceId, async () => {
      const { workspace } = await this.workspace(workspaceId);
      await this.manualMutation(workspaceId, undefined, async () => {
        if (staged) await runGit(workspace.path, ['add', '--all', '--', '.']);
        else {
          const head = await runGit(workspace.path, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
          await runGit(workspace.path, head.code === 0 ? ['restore', '--staged', '--', '.'] : ['rm', '--cached', '-r', '--force', '--ignore-unmatch', '--', '.']);
        }
      });
      return this.summary(workspaceId);
    });
  }

  async init(workspaceId: string): Promise<GitStatus>;
  async init(workspaceId: string, compact: boolean): Promise<GitStatus | GitStatusSummary>;
  async init(workspaceId: string, compact = false): Promise<GitStatus | GitStatusSummary> {
    return await this.locked(workspaceId, async () => {
      const { workspace, repository } = await this.workspace(workspaceId, false);
      if (!repository) await this.manualMutation(workspaceId, undefined, () => runGit(workspace.path, ['-c', 'init.templateDir=', 'init', '--quiet', '--initial-branch=main']));
      return compact ? this.summary(workspaceId) : this.status(workspaceId);
    });
  }

  async diff(workspaceId: string, rawPath: unknown, staged: boolean): Promise<GitDiff> {
    const filePath = relativeFile(rawPath);
    const { workspace } = await this.workspace(workspaceId);
    await this.filePath(workspaceId, filePath);
    const files = await this.selectedChanges(workspace, [filePath]);
    const file = files.find(entry => entry.path === filePath && entry.staged === staged);
    const originalPath = staged ? file?.originalPath ?? filePath : filePath;
    const originalResult = await runGit(workspace.path, ['show', staged ? `HEAD:${originalPath}` : `:${filePath}`], { allowFailure: true, outputLimit: PREVIEW_LIMIT });
    let original = originalResult.code === 0 ? originalResult.stdout : Buffer.alloc(0);
    if (file?.status === 'U' && !staged && originalResult.code !== 0) {
      const ours = await runGit(workspace.path, ['show', `:2:${filePath}`], { allowFailure: true, outputLimit: PREVIEW_LIMIT });
      if (ours.code === 0) original = ours.stdout;
    }
    let modified: Buffer;
    if (staged) {
      const index = await runGit(workspace.path, ['show', `:${filePath}`], { allowFailure: true, outputLimit: PREVIEW_LIMIT });
      modified = index.code === 0 ? index.stdout : Buffer.alloc(0);
    } else {
      const snapshot = await this.snapshot(workspaceId, filePath, PREVIEW_LIMIT);
      modified = Buffer.from(snapshot.content ?? '', 'base64');
    }
    const paths = [...new Set([filePath, ...(file?.originalPath ? [file.originalPath] : [])])];
    const result = await runGit(workspace.path, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all', ...(staged ? ['--cached'] : []), '--', ...paths], { outputLimit: 2 * PREVIEW_LIMIT });
    const binary = original.includes(0) || modified.includes(0) || /^Binary files /m.test(result.stdout.toString('utf8'));
    if (binary) return { path: filePath, patch: 'Binary file contents differ. Download or open the file to inspect it.', original: '', modified: '', binary: true };
    const before = original.toString('utf8');
    const after = modified.toString('utf8');
    const patch = result.stdout.length ? result.stdout.toString('utf8') : before !== after ? createTwoFilesPatch(`a/${originalPath}`, `b/${filePath}`, before, after, undefined, undefined, { context: 3 }) : '';
    return { path: filePath, patch, original: before, modified: after };
  }

  async stage(workspaceId: string, pathsInput: unknown): Promise<GitStatus>;
  async stage(workspaceId: string, pathsInput: unknown, compact: boolean): Promise<GitStatus | GitStatusSummary>;
  async stage(workspaceId: string, pathsInput: unknown, compact = false): Promise<GitStatus | GitStatusSummary> {
    const paths = requestedPaths(pathsInput);
    return await this.locked(workspaceId, async () => {
      const { workspace } = await this.workspace(workspaceId);
      const files = await this.selectedChanges(workspace, paths);
      const unstaged = new Set(files.filter(file => !file.staged).map(file => file.path));
      for (const filePath of paths) {
        await this.filePath(workspaceId, filePath);
        if (!unstaged.has(filePath)) throw new HttpError(409, `“${filePath}” no longer has unstaged changes. Refresh the changes list.`, 'GIT_STATUS_CHANGED');
      }
      await this.manualMutation(workspaceId, paths, () => runGit(workspace.path, ['add', '--all', '--', ...paths]));
      return compact ? this.summary(workspaceId) : this.status(workspaceId);
    });
  }

  async unstage(workspaceId: string, pathsInput: unknown): Promise<GitStatus>;
  async unstage(workspaceId: string, pathsInput: unknown, compact: boolean): Promise<GitStatus | GitStatusSummary>;
  async unstage(workspaceId: string, pathsInput: unknown, compact = false): Promise<GitStatus | GitStatusSummary> {
    const paths = requestedPaths(pathsInput);
    return await this.locked(workspaceId, async () => {
      const { workspace } = await this.workspace(workspaceId);
      const files = await this.selectedChanges(workspace, paths);
      const targets = new Set<string>();
      for (const filePath of paths) {
        await this.filePath(workspaceId, filePath);
        const file = files.find(entry => entry.path === filePath && entry.staged);
        if (!file) throw new HttpError(409, `“${filePath}” no longer has staged changes. Refresh the changes list.`, 'GIT_STATUS_CHANGED');
        targets.add(filePath);
        if (file.originalPath) targets.add(file.originalPath);
      }
      const head = await runGit(workspace.path, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
      await this.manualMutation(workspaceId, [...targets], () => head.code === 0
        ? runGit(workspace.path, ['restore', '--staged', '--', ...targets])
        : runGit(workspace.path, ['rm', '--cached', '--force', '--ignore-unmatch', '--', ...targets]));
      return compact ? this.summary(workspaceId) : this.status(workspaceId);
    });
  }

  async commit(workspaceId: string, messageInput: unknown): Promise<{ commit: string }> {
    if (typeof messageInput !== 'string' || !messageInput.trim() || messageInput.length > 20_000 || messageInput.includes('\0')) {
      throw new HttpError(400, 'Write a commit message of up to 20,000 characters.', 'INVALID_COMMIT_MESSAGE');
    }
    return await this.locked(workspaceId, async () => {
      const { workspace } = await this.workspace(workspaceId);
      const { summary } = await this.scanStatus(workspace);
      if (summary.conflictCount > 0) throw new HttpError(409, 'Resolve and stage the conflicted files before committing.', 'GIT_CONFLICT');
      if (!summary.stagedCount) throw new HttpError(409, 'Stage at least one change before committing.', 'NOTHING_STAGED');
      const [name, email] = await Promise.all([
        runGit(workspace.path, ['config', '--get', 'user.name'], { allowFailure: true }),
        runGit(workspace.path, ['config', '--get', 'user.email'], { allowFailure: true }),
      ]);
      const account = workspace.githubAccountId ? await getGithubAccount(this.ctx, workspace.githubAccountId) : undefined;
      const identity: string[] = [];
      if (!name.stdout.toString('utf8').trim()) identity.push('-c', `user.name=${account?.name || account?.login || 'Arc Workspace'}`);
      if (!email.stdout.toString('utf8').trim()) identity.push('-c', `user.email=${account ? `${account.login}@users.noreply.github.com` : 'workspace@localhost'}`);
      const result = await this.manualMutation(workspaceId, undefined, async () => {
        await runGit(workspace.path, [...identity, 'commit', '--message', messageInput.trim()]);
        return await runGit(workspace.path, ['rev-parse', 'HEAD']);
      });
      return { commit: result.stdout.toString('utf8').trim() };
    });
  }

  async discard(workspaceId: string, pathsInput: unknown): Promise<{ discardId: string; count: number }> {
    const paths = requestedPaths(pathsInput);
    return await this.locked(workspaceId, async () => {
      const { workspace } = await this.workspace(workspaceId);
      const changed = (await this.selectedChanges(workspace, paths)).filter(file => !file.staged);
      const tracked: string[] = [];
      const untracked: string[] = [];
      const files: DiscardBackup['files'] = [];
      let total = 0;
      for (const filePath of paths) {
        const file = changed.find(entry => entry.path === filePath);
        if (!file) throw new HttpError(409, `“${filePath}” no longer has unstaged changes.`, 'GIT_STATUS_CHANGED');
        if (file.status === 'U') throw new HttpError(409, 'Resolve merge conflicts in the editor or terminal. Discard is unavailable for conflicted files.', 'GIT_CONFLICT');
        const before = await this.snapshot(workspaceId, filePath);
        total += Buffer.byteLength(before.content ?? '', 'base64');
        if (total > DISCARD_LIMIT) throw new HttpError(413, 'Discard at most 50 MiB at a time so a recovery backup can be saved.', 'BACKUP_TOO_LARGE');
        files.push({ path: filePath, before });
        (file.status === '?' ? untracked : tracked).push(filePath);
      }
      const discardId = randomUUID();
      const backup: DiscardBackup = { workspaceId, createdAt: new Date().toISOString(), state: 'pending', files };
      await this.ctx.store.write(`git-discard-${discardId}`, backup);
      for (const entry of files) {
        if (snapshotVersion(await this.snapshot(workspaceId, entry.path)) !== snapshotVersion(entry.before)) {
          throw new HttpError(409, 'A selected file changed while preparing the backup. Refresh and try again.', 'GIT_STATUS_CHANGED');
        }
      }
      await this.manualMutation(workspaceId, paths, async () => {
        if (tracked.length) await runGit(workspace.path, ['restore', '--worktree', '--', ...tracked]);
        for (const filePath of untracked) await this.writeSnapshot(workspaceId, filePath, { kind: 'missing' });
        for (const entry of files) entry.after = snapshotVersion(await this.snapshot(workspaceId, entry.path));
        backup.state = 'ready';
        await this.ctx.store.write(`git-discard-${discardId}`, backup);
      });
      return { discardId, count: paths.length };
    });
  }

  async restoreDiscard(workspaceId: string, discardId: unknown): Promise<{ restored: number }> {
    if (typeof discardId !== 'string' || !/^[a-f\d-]{36}$/.test(discardId)) throw new HttpError(400, 'Choose a valid discard backup.', 'INVALID_BACKUP');
    return await this.locked(workspaceId, async () => {
      await this.workspace(workspaceId);
      const backup = await this.ctx.store.read<DiscardBackup | null>(`git-discard-${discardId}`, null);
      if (!backup || backup.workspaceId !== workspaceId || backup.state !== 'ready') throw new HttpError(404, 'This discard backup is unavailable or has already been restored.', 'BACKUP_NOT_FOUND');
      const current: FileSnapshot[] = [];
      for (const entry of backup.files) {
        const snapshot = await this.snapshot(workspaceId, entry.path);
        if (snapshotVersion(snapshot) !== entry.after) throw new HttpError(409, `“${entry.path}” has newer edits. Move or save those edits before undoing this discard.`, 'RESTORE_CONFLICT');
        current.push(snapshot);
      }
      return await this.manualMutation(workspaceId, backup.files.map(entry => entry.path), async () => {
        let restored = 0;
        try {
          for (const entry of backup.files) {
            await this.writeSnapshot(workspaceId, entry.path, entry.before);
            restored++;
          }
        } catch (error) {
          for (let i = restored - 1; i >= 0; i--) await this.writeSnapshot(workspaceId, backup.files[i].path, current[i]).catch(() => undefined);
          throw error;
        }
        backup.state = 'restored';
        await this.ctx.store.write(`git-discard-${discardId}`, backup);
        return { restored };
      });
    });
  }

  async branch(workspaceId: string, nameInput: unknown, create: boolean): Promise<GitStatus>;
  async branch(workspaceId: string, nameInput: unknown, create: boolean, compact: boolean): Promise<GitStatus | GitStatusSummary>;
  async branch(workspaceId: string, nameInput: unknown, create: boolean, compact = false): Promise<GitStatus | GitStatusSummary> {
    if (typeof nameInput !== 'string' || !nameInput || nameInput.length > 255 || nameInput.startsWith('-') || nameInput.includes('\0')) throw new HttpError(400, 'Enter a valid branch name.', 'INVALID_BRANCH');
    return await this.locked(workspaceId, async () => {
      const { workspace } = await this.workspace(workspaceId);
      const valid = await runGit(workspace.path, ['check-ref-format', '--branch', nameInput], { allowFailure: true });
      if (valid.code !== 0 || nameInput === 'HEAD') throw new HttpError(400, 'Branch names cannot contain spaces, “..”, or Git control characters.', 'INVALID_BRANCH');
      if (create) await this.manualMutation(workspaceId, undefined, () => runGit(workspace.path, ['switch', '--create', nameInput]));
      else {
        const local = await runGit(workspace.path, ['show-ref', '--verify', `refs/heads/${nameInput}`], { allowFailure: true });
        const remote = local.code !== 0 ? await runGit(workspace.path, ['show-ref', '--verify', `refs/remotes/${nameInput}`], { allowFailure: true }) : undefined;
        await this.manualMutation(workspaceId, undefined, () => runGit(workspace.path, ['switch', ...(remote?.code === 0 ? ['--track'] : []), '--', nameInput]));
      }
      return compact ? this.summary(workspaceId) : this.status(workspaceId);
    });
  }

  async network(workspaceId: string, operation: 'push' | 'pull' | 'fetch', accountInput?: unknown): Promise<GitStatus>;
  async network(workspaceId: string, operation: 'push' | 'pull' | 'fetch', accountInput: unknown, compact: boolean): Promise<GitStatus | GitStatusSummary>;
  async network(workspaceId: string, operation: 'push' | 'pull' | 'fetch', accountInput?: unknown, compact = false): Promise<GitStatus | GitStatusSummary> {
    if (accountInput !== undefined && (typeof accountInput !== 'string' || accountInput.length > 128)) throw new HttpError(400, 'Choose a valid GitHub account.', 'INVALID_ACCOUNT');
    return await this.locked(workspaceId, async () => {
      const { workspace } = await this.workspace(workspaceId);
      const current = await runGit(workspace.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
      const branch = current.stdout.toString('utf8').trim();
      if (!branch && operation !== 'fetch') throw new HttpError(409, 'Switch to a branch before pushing or pulling.', 'DETACHED_HEAD');
      const configured = branch ? await runGit(workspace.path, ['config', '--get', `branch.${branch}.remote`], { allowFailure: true }) : undefined;
      const remotes = (await runGit(workspace.path, ['remote'])).stdout.toString('utf8').trim().split('\n').filter(Boolean);
      const remote = configured?.stdout.toString('utf8').trim() || (remotes.includes('origin') ? 'origin' : remotes[0]);
      if (!remote || !remotes.includes(remote) || !/^[A-Za-z0-9_.-]+$/.test(remote) || remote.startsWith('-')) throw new HttpError(409, 'This repository has no supported remote. Import a GitHub repository or add an origin remote in the terminal.', 'NO_REMOTE');
      const helper = await runGit(workspace.path, ['config', '--get', `remote.${remote}.vcs`], { allowFailure: true });
      if (helper.code === 0) throw new HttpError(409, 'Remove this remote’s custom Git helper configuration before using repository network actions.', 'UNSAFE_GIT_HELPER');
      const address = await runGit(workspace.path, ['remote', 'get-url', ...(operation === 'push' ? ['--push', '--all'] : []), '--', remote]);
      const destinations = address.stdout.toString('utf8').trim().split('\n');
      if (destinations.length !== 1 || /[\u0000-\u001f\u007f]/.test(destinations[0])) throw new HttpError(409, 'Configure one explicit destination for this remote before using repository network actions.', 'MULTIPLE_GIT_DESTINATIONS');
      const remoteUrl = destinations[0];
      const accountId = typeof accountInput === 'string' ? accountInput || undefined : workspace.githubAccountId;
      if (/^https?:\/\/[^/]*@/i.test(remoteUrl) || /[?&](?:token|access_token|password)=/i.test(remoteUrl)) throw new HttpError(409, 'Remove credentials from the Git remote URL and choose a connected GitHub account instead.', 'CREDENTIALS_IN_REMOTE');
      if (accountId) {
        let parsed: URL;
        try { parsed = new URL(remoteUrl); } catch { throw new HttpError(409, 'Connected GitHub accounts require an HTTPS github.com remote.', 'UNSUPPORTED_REMOTE'); }
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password || parsed.port || parsed.search) throw new HttpError(409, 'Connected GitHub accounts can only authenticate HTTPS github.com repositories.', 'UNSUPPORTED_REMOTE');
        const rewrites = await runGit(workspace.path, ['config', '--get-regexp', '^url\\..*\\.(insteadof|pushinsteadof)$'], { allowFailure: true });
        if (rewrites.stdout.length) throw new HttpError(409, 'Remove Git URL rewrite rules before using a connected GitHub account.', 'UNSAFE_GIT_REWRITE');
      }
      const mergeRef = branch ? await runGit(workspace.path, ['config', '--get', `branch.${branch}.merge`], { allowFailure: true }) : undefined;
      const upstreamBranch = mergeRef?.stdout.toString('utf8').trim().replace(/^refs\/heads\//, '') || branch;
      const proxyKeys = await runGit(workspace.path, ['config', '--null', '--name-only', '--get-regexp', '^http\\..*\\.proxy$'], { allowFailure: true });
      await withGitCredentials(this.ctx, accountId, async env => {
        const command = ['-c', `remote.${remote}.proxy=`];
        for (const key of proxyKeys.stdout.toString('utf8').split('\0').filter(Boolean)) command.push('-c', `${key}=`);
        if (!accountId && (path.isAbsolute(remoteUrl) || remoteUrl.startsWith('file://'))) command.push('-c', 'protocol.file.allow=always');
        if (operation === 'fetch') command.push('fetch', '--prune', '--', remote);
        if (operation === 'push') command.push('push', '--set-upstream', '--', remote, `refs/heads/${branch}:refs/heads/${upstreamBranch}`);
        if (operation === 'pull') command.push('pull', '--ff-only', '--no-rebase', '--no-autostash', '--', remote, upstreamBranch);
        await this.manualMutation(workspaceId, undefined, () => runGit(workspace.path, command, { env, timeout: 120_000 }));
      });
      return compact ? this.summary(workspaceId) : this.status(workspaceId);
    });
  }
}

export function createGitRouter(ctx: AppContext): Router {
  const router = Router();
  const git = new GitService(ctx);
  const compact = (value: unknown) => {
    if (value !== undefined && value !== 'true' && value !== 'false') throw new HttpError(400, 'Choose a valid Git summary option.', 'INVALID_GIT_PAGE');
    return value === 'true';
  };
  const read = async (req: Request, res: Response, operation: (signal: AbortSignal) => Promise<unknown>) => {
    const controller = new AbortController();
    const stop = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', stop); res.once('close', stop);
    try { const result = await operation(controller.signal); if (!controller.signal.aborted) res.json(result); }
    finally { req.off('aborted', stop); res.off('close', stop); }
  };
  router.get('/workspaces/:id/git/status', async (req, res) => { if (compact(req.query.summary)) await read(req, res, signal => git.summary(req.params.id, signal)); else res.json(await git.status(req.params.id)); });
  router.get('/workspaces/:id/git/changes', async (req, res) => { await read(req, res, signal => git.changesPage(req.params.id, req.query, signal)); });
  router.get('/workspaces/:id/git/branches', async (req, res) => { await read(req, res, signal => git.branchesPage(req.params.id, req.query, signal)); });
  router.post('/workspaces/:id/git/init', async (req, res) => { res.json(await git.init(req.params.id, compact(req.query.summary))); });
  router.get('/workspaces/:id/git/diff', async (req, res) => { res.json(await git.diff(req.params.id, req.query.path, req.query.staged === 'true')); });
  for (const action of ['stage', 'unstage'] as const) router.post(`/workspaces/:id/git/${action}`, async (req, res) => {
    if (req.body?.all !== undefined && (req.body.all !== true || req.body.paths !== undefined)) throw new HttpError(400, 'Choose individual files or all changes for this operation.', 'INVALID_PATHS');
    const summary = compact(req.query.summary);
    res.json(req.body?.all === true ? await git.stageAll(req.params.id, action === 'stage') : await git[action](req.params.id, req.body?.paths, summary));
  });
  router.post('/workspaces/:id/git/commit', async (req, res) => { res.json(await git.commit(req.params.id, req.body?.message)); });
  router.post('/workspaces/:id/git/discard', async (req, res) => { res.json(await git.discard(req.params.id, req.body?.paths)); });
  router.post('/workspaces/:id/git/restore-discard', async (req, res) => { res.json(await git.restoreDiscard(req.params.id, req.body?.discardId)); });
  router.post('/workspaces/:id/git/branch', async (req, res) => {
    if (req.body?.create !== undefined && typeof req.body.create !== 'boolean') throw new HttpError(400, 'Choose whether to create or switch a branch.', 'INVALID_BRANCH');
    res.json(await git.branch(req.params.id, req.body?.name, req.body?.create === true, compact(req.query.summary)));
  });
  for (const operation of ['push', 'pull', 'fetch'] as const) router.post(`/workspaces/:id/git/${operation}`, async (req, res) => { res.json(await git.network(req.params.id, operation, req.body?.accountId, compact(req.query.summary))); });
  return router;
}
