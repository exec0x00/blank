import type { AppContext } from '../context';
import { HttpError } from '../errors';

export const FILE_PAGES_SHUTDOWN_TIMEOUT_MS = 15_000;

function closing(): HttpError {
  return new HttpError(503, 'File editing is shutting down. Keep your edits and reconnect after the workspace restarts.', 'FILE_PAGES_CLOSING');
}

/** A context owns its admitted work even after its HTTP connections disappear. */
export class FilePagesLifecycle {
  private readonly controller = new AbortController();
  private readonly admitted = new Set<Promise<unknown>>();
  private waiting?: Promise<void>;

  get signal(): AbortSignal { return this.controller.signal; }
  assertOpen(): void { this.signal.throwIfAborted(); }

  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.signal.aborted) return Promise.reject(this.signal.reason);
    // Register before invoking any asynchronous callback. An immediate close
    // cannot miss a request accepted in the same JavaScript turn.
    const work = Promise.resolve().then(() => { this.assertOpen(); return operation(this.signal); });
    this.admitted.add(work);
    void work.then(() => this.admitted.delete(work), () => this.admitted.delete(work));
    return work;
  }

  /**
   * Latch admission synchronously. A timeout rejects honestly; it never drops
   * tracked work. Calling close again waits for the remaining native operations.
   */
  close(timeoutMs = FILE_PAGES_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    if (!this.signal.aborted) this.controller.abort(closing());
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return Promise.reject(new RangeError('File-page shutdown timeout must be 1–60000 milliseconds.'));
    if (this.waiting) return this.waiting;
    if (!this.admitted.size) return Promise.resolve();
    const drained = Promise.allSettled([...this.admitted]).then(() => undefined);
    let timer: ReturnType<typeof setTimeout>;
    const waiting = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new HttpError(503,
        'File operations have stopped accepting work, but an admitted operation has not settled. Existing recovery files are retained. Wait for the remaining operation before finishing shutdown.',
        'FILE_PAGES_SHUTDOWN_PENDING')), timeoutMs);
      void drained.then(resolve, reject);
    });
    this.waiting = waiting;
    void waiting.then(() => {
      clearTimeout(timer);
      if (this.waiting === waiting) this.waiting = undefined;
    }, () => {
      clearTimeout(timer);
      if (this.waiting === waiting) this.waiting = undefined;
    });
    return waiting;
  }
}

const lifecycles = new WeakMap<AppContext, FilePagesLifecycle>();

/** Shutdown must also latch contexts whose router/service has not been created. */
export function filePagesLifecycleFor(ctx: AppContext): FilePagesLifecycle {
  let lifecycle = lifecycles.get(ctx);
  if (!lifecycle) { lifecycle = new FilePagesLifecycle(); lifecycles.set(ctx, lifecycle); }
  return lifecycle;
}
