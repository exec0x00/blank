import path from 'node:path';
import { HttpError } from '../errors';
import { acquireWorkspaceActivity } from '../worktrees/activity';

const queues = new Map<string, Promise<void>>();

/**
 * Shared admission for native file writes across service instances. A callback
 * must perform direct filesystem work, not call a WorkspaceService mutator that
 * already acquires this same queue. Read/resolve methods are safe inside it.
 */
async function queuedWorkspaceMutation<T>(workspacesDir: string, workspaceId: string, operation: () => Promise<T>,
  options: { signal?: AbortSignal }, activityLease: boolean): Promise<T> {
  if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId)) {
    throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
  }
  const signal = options.signal;
  signal?.throwIfAborted();
  const directory = path.resolve(workspacesDir);
  const key = `${directory}\0${workspaceId}`;
  const previous = queues.get(key) ?? Promise.resolve();
  let started = false;
  const guarded = async () => {
    signal?.throwIfAborted();
    const release = activityLease ? acquireWorkspaceActivity(directory, workspaceId, 'files') : () => undefined;
    try {
      signal?.throwIfAborted();
      started = true;
      return await operation();
    }
    finally { release(); }
  };
  const current = previous.then(guarded, guarded);
  const tail = current.then(() => undefined, () => undefined);
  queues.set(key, tail);
  // A cancelled waiter can return before its predecessor ends. Its queue tail
  // must remain until then so another app context cannot enter the same files.
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  if (!signal) return current;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      // Once native work starts, cancellation is cooperative. Retain its lease
      // and returned promise through the callback's cleanup for truthful drain.
      if (!started) { signal.removeEventListener('abort', aborted); reject(signal.reason); }
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    void current.then(value => {
      signal.removeEventListener('abort', aborted); resolve(value);
    }, error => {
      signal.removeEventListener('abort', aborted); reject(error);
    });
  });
}

export function withWorkspaceFileMutation<T>(workspacesDir: string, workspaceId: string, operation: () => Promise<T>,
  options: { signal?: AbortSignal } = {}): Promise<T> {
  return queuedWorkspaceMutation(workspacesDir, workspaceId, operation, options, true);
}

/** Exclusive history/file transactions take this same FIFO first, then acquire
 * the repository family's activity barriers in sorted workspace-ID order. The
 * callback MUST acquire those barriers before mutation. Omitting this queue's
 * ordinary files lease avoids self-conflict with the exclusive activity gate.
 * Do not call an ordinary queued mutator from the callback. */
export function withWorkspaceFileMutationFence<T>(workspacesDir: string, workspaceId: string, operation: () => Promise<T>,
  options: { signal?: AbortSignal } = {}): Promise<T> {
  return queuedWorkspaceMutation(workspacesDir, workspaceId, operation, options, false);
}
