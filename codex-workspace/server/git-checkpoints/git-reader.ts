import { spawn } from 'node:child_process';
import { HttpError } from '../errors';
import type { CheckpointDirectory } from './filesystem';

export interface CheckpointGitDirectories { root: CheckpointDirectory; git: CheckpointDirectory; common: CheckpointDirectory }
export interface CheckpointGitReadOptions { input?: Buffer; maximum?: number; signal?: AbortSignal; allowFailure?: boolean; indexFile?: string; timeout?: number }

/** Only read-only native plumbing; callers supply fixed operations and validated OIDs, never user argv. */
export async function readGit(directories: CheckpointGitDirectories, args: string[], options: CheckpointGitReadOptions = {}): Promise<{ code: number; bytes: Buffer }> {
  options.signal?.throwIfAborted();
  if (!['rev-parse', 'symbolic-ref', 'ls-files', 'ls-tree', 'cat-file', 'config'].includes(args[0])
    || args[0] === 'config' && (args.length !== 4 || args[1] !== '--null' || args[2] !== '--get-regexp'
      || args[3] !== '^(extensions\\.partialclone|remote\\..*\\.promisor)$')) throw new Error('Checkpoint Git is read-only.');
  await directories.root.check(); await directories.git.check(); await directories.common.check();
  const maximum = options.maximum ?? 8 * 1024 * 1024;
  const environment: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    GIT_DIR: '/proc/self/fd/4', GIT_COMMON_DIR: '/proc/self/fd/5', GIT_WORK_TREE: '/proc/self/fd/3',
    GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1', GIT_ALLOW_PROTOCOL: '',
    ...(options.indexFile ? { GIT_INDEX_FILE: options.indexFile } : {}),
  };
  const command = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null', '-c', 'credential.helper=',
    '-c', 'core.gitProxy=', '-c', 'http.proxy=', '-c', 'protocol.allow=never', '-c', 'submodule.recurse=false',
    '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'safe.directory=*', ...args];
  const result = await new Promise<{ code: number; bytes: Buffer }>((resolve, reject) => {
    const child = spawn('/usr/bin/git', command, { cwd: directories.root.absolute, env: environment,
      stdio: ['pipe', 'pipe', 'pipe', directories.root.handle.fd, directories.git.handle.fd, directories.common.handle.fd], windowsHide: true });
    const chunks: Buffer[] = [];
    let count = 0, stderr = 0, failure: unknown, killTimer: NodeJS.Timeout | undefined;
    const stop = (error: unknown) => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 500);
      killTimer.unref();
    };
    const abort = () => stop(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(new HttpError(504, 'Reading the repository for its checkpoint timed out. No files were changed.', 'CHECKPOINT_GIT_TIMEOUT')), options.timeout ?? 20_000);
    timer.unref();
    child.stdout!.on('data', (chunk: Buffer) => {
      count += chunk.length;
      if (count > maximum) { stop(new HttpError(413, 'Git checkpoint output exceeds its capture budget.', 'CHECKPOINT_LIMIT')); return; }
      if (!failure) chunks.push(chunk);
    });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.length; if (stderr > 64 * 1024) stop(new HttpError(413, 'Git checkpoint diagnostics exceeded their limit.', 'CHECKPOINT_LIMIT')); });
    child.stdin!.on('error', () => undefined);
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0 && !options.allowFailure) reject(new HttpError(409, 'Git could not read an exact checkpoint. Repository files and metadata were left unchanged.', 'CHECKPOINT_GIT_FAILED'));
      else resolve({ code: code ?? -1, bytes: Buffer.concat(chunks, count) });
    });
    child.stdin!.end(options.input);
    if (options.signal?.aborted) abort();
  });
  await directories.root.check(); await directories.git.check(); await directories.common.check();
  return result;
}
