import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import { validObjectPath } from '../downloads/bucket';
import { MAX_TRANSFER_BYTES, TRANSFER_BUFFER_BYTES } from './filesystem';
import { fileIdentity, sameVersion } from './types';

const PUBLIC_HUB = 'https://huggingface.co';
const VERIFY_DEADLINE_MS = 5 * 60 * 1000;
const FILE_WAIT_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60_000;
type DurableConfig = Pick<AppConfig, 'dataDir' | 'bucket'>;

export interface DurableFileReceipt { absolute: string; size: number; sha256: string }
export interface PublicBucketVerifierOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  checkResources?: () => Promise<void>;
  deadline?: number;
  signal?: AbortSignal;
}

function pending(): HttpError {
  return new HttpError(503, 'Durable storage has not confirmed every copied file and recovery record yet. Source files were retained. Inspect both paths before trying again.', 'FILE_TRANSFER_DURABILITY_PENDING');
}

function objectPath(config: DurableConfig, absolute: string): string {
  const relative = path.relative(config.dataDir, absolute).split(path.sep).join('/');
  if (!path.isAbsolute(absolute) || path.resolve(absolute) !== absolute || !validObjectPath(relative)) {
    throw new HttpError(403, 'The durability check is outside the configured data directory.', 'UNSAFE_PATH');
  }
  return relative;
}

// Same public-provider redirect boundary as incoming staged-file reads. No credentials are sent.
function allowedPublicUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
    && (url.hostname === 'huggingface.co' || url.hostname.endsWith('.huggingface.co') || url.hostname.endsWith('.hf.co'));
}

/** Snapshot the exact ordinary metadata bytes expected to survive a remount. */
export async function captureDurableReceipt(config: DurableConfig, absolute: string, maximum: number): Promise<DurableFileReceipt> {
  objectPath(config, absolute);
  if (await fs.realpath(path.dirname(absolute)) !== path.dirname(absolute)) throw pending();
  const handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw pending();
    const identity = fileIdentity(stat);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(TRANSFER_BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > stat.size || bytes > maximum) throw pending();
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (bytes !== stat.size || !sameVersion(await handle.stat(), identity) || !sameVersion(await fs.lstat(absolute), identity)) throw pending();
    return { absolute, size: bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

/**
 * Public readback is a durability barrier, not another storage writer. The
 * native mount performs every write. Provider redirects are bounded and never
 * receive a token, cookie, request body, or response-provided authentication.
 */
export class PublicBucketVerifier {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep?: PublicBucketVerifierOptions['sleep'];
  private readonly deadline: number;
  private nextResourceCheck = 0;

  constructor(private readonly config: DurableConfig, private readonly options: PublicBucketVerifierOptions = {}) {
    options.signal?.throwIfAborted();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(config.bucket)) {
      throw new HttpError(503, 'The public data bucket is not configured for durable file transfers.', 'FILE_TRANSFER_DURABILITY_UNAVAILABLE');
    }
    if (options.deadline !== undefined && (!Number.isFinite(options.deadline) || options.deadline <= 0)) throw pending();
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep;
    this.deadline = Math.min(this.now() + VERIFY_DEADLINE_MS, options.deadline ?? Infinity);
  }

  private async resourceCheck(): Promise<void> {
    this.options.signal?.throwIfAborted();
    if (this.options.checkResources && this.now() >= this.nextResourceCheck) {
      await this.options.checkResources();
      this.nextResourceCheck = this.now() + 5_000;
    }
    this.options.signal?.throwIfAborted();
  }

  private requestSignal(remaining: number): AbortSignal {
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remaining)));
    return this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout;
  }

  private async pause(milliseconds: number): Promise<void> {
    const signal = this.options.signal;
    signal?.throwIfAborted();
    if (this.sleep) {
      // Injected hooks own their work: pass cancellation, but still await them
      // if they ignore it so a caller cannot mistake an unfinished hook for drain.
      await this.sleep(milliseconds, signal);
      signal?.throwIfAborted();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const aborted = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', aborted);
        resolve();
      }, milliseconds);
    });
    signal?.throwIfAborted();
  }

  private url(receipt: DurableFileReceipt): URL {
    const relative = objectPath(this.config, receipt.absolute);
    if (!Number.isSafeInteger(receipt.size) || receipt.size < 0 || receipt.size > MAX_TRANSFER_BYTES || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw pending();
    const url = new URL(`${PUBLIC_HUB}/buckets/${this.config.bucket}/resolve/${relative.split('/').map(encodeURIComponent).join('/')}`);
    url.searchParams.set('download', 'true');
    // A unique request avoids accepting a cached negative or an earlier mutable object.
    url.searchParams.set('verify', randomUUID());
    return url;
  }

  private async matches(receipt: DurableFileReceipt, signal: AbortSignal): Promise<boolean> {
    let url = this.url(receipt);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowedPublicUrl(url)) throw pending();
      signal.throwIfAborted();
      const response = await this.fetchImpl(url, {
        method: 'GET', headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
        credentials: 'omit', redirect: 'manual', cache: 'no-store', signal,
      });
      if (signal.aborted) {
        await response.body?.cancel().catch(() => undefined);
        signal.throwIfAborted();
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location || location.length > 16_384) throw pending();
        url = new URL(location, url);
        continue;
      }
      if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); return false; }
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== receipt.size)) {
        await response.body?.cancel().catch(() => undefined); return false;
      }
      const hash = createHash('sha256');
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            signal.throwIfAborted(); await this.resourceCheck();
            const item = await reader.read();
            if (item.done) break;
            size += item.value.byteLength;
            if (size > receipt.size) return false;
            hash.update(item.value);
          }
          signal.throwIfAborted();
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      }
      signal.throwIfAborted();
      return size === receipt.size && hash.digest('hex') === receipt.sha256;
    }
    throw pending();
  }

  async verify(receipts: readonly DurableFileReceipt[]): Promise<void> {
    this.options.signal?.throwIfAborted();
    for (const receipt of receipts) {
      const deadline = Math.min(this.deadline, this.now() + FILE_WAIT_MS);
      let backoff = 250;
      while (true) {
        await this.resourceCheck();
        const remaining = deadline - this.now();
        if (remaining <= 0) throw pending();
        try {
          const matches = await this.matches(receipt, this.requestSignal(remaining));
          this.options.signal?.throwIfAborted();
          if (matches) break;
        } catch (error) {
          this.options.signal?.throwIfAborted();
          if (error instanceof HttpError && error.code === 'FILE_TRANSFER_RESOURCES') throw error;
          // Provider bodies, signed URLs and transport exception text are never exposed.
        }
        if (this.now() >= deadline) throw pending();
        await this.pause(Math.min(backoff, deadline - this.now()));
        backoff = Math.min(backoff * 2, 2_000);
      }
    }
  }

  /** A successful Move must not leave old regular-file objects to reappear on remount. */
  async verifyAbsent(absolutePaths: readonly string[]): Promise<void> {
    this.options.signal?.throwIfAborted();
    for (const absolute of absolutePaths) {
      const deadline = Math.min(this.deadline, this.now() + FILE_WAIT_MS);
      let backoff = 250;
      while (true) {
        await this.resourceCheck();
        const remaining = deadline - this.now();
        if (remaining <= 0) throw pending();
        try {
          const signal = this.requestSignal(remaining);
          signal.throwIfAborted();
          const response = await this.fetchImpl(this.url({ absolute, size: 0, sha256: createHash('sha256').digest('hex') }), {
            method: 'HEAD', headers: { 'Cache-Control': 'no-cache' }, credentials: 'omit', redirect: 'manual', cache: 'no-store',
            signal,
          });
          await response.body?.cancel().catch(() => undefined);
          signal.throwIfAborted();
          // Only the fixed Hub path can confirm absence. A redirect still names an existing object.
          if (response.status === 404) break;
        } catch (error) {
          this.options.signal?.throwIfAborted();
          if (error instanceof HttpError && error.code === 'FILE_TRANSFER_RESOURCES') throw error;
        }
        if (this.now() >= deadline) throw pending();
        await this.pause(Math.min(backoff, deadline - this.now()));
        backoff = Math.min(backoff * 2, 2_000);
      }
    }
  }
}
