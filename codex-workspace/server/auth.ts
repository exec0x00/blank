import { createHash, createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { constants, type Dir } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { EventEmitter } from 'node:events';
import { parse, serialize } from 'cookie';
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { JsonStore } from './store';

const cookieName = 'codex_workspace_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const day = 24 * 60 * 60 * 1000;
const cleanupInterval = 60 * 60 * 1000;
// An entire expiry day must be over, followed by a full day of grace, before
// removing its grants or revocations. Expiry is also checked before every read.
const cleanupGrace = day;
const cleanupBudget = 128;
interface SessionIdentity { hash: string; expiresAt: number }
interface SessionRecord extends SessionIdentity { version: 2; epoch: string }
interface RevocationRecord extends SessionRecord { revoked: true }
interface MigrationRecord { version: 2; epoch: string; complete: true }
interface SessionAuthority { active: boolean; revoked: boolean }
interface CleanupDirectory { handle: FileHandle; entries: Dir; access: string }
interface CleanupBucket extends CleanupDirectory { name: string; day: number }

const streamMaxAge = 5_000;
const streamTimeout = 3_000;
const streamLifetime = 30 * 60_000;
const streamBufferLimit = 4 * 1024 * 1024;
const streamSnapshotLimit = 32 * 1024 * 1024;
const streamSnapshotChunk = 64 * 1024;
const streamQueueLimit = 1024;
const streamConnectionLimit = 128;
export interface AuthServiceOptions {
  /** Internal bounds for streaming authority checks, never client preferences. */
  streamMaxAgeMs?: number;
  streamTimeoutMs?: number;
}
interface StreamProof { allowed: boolean; startedAt: number }
interface StreamAuthorization {
  owner: object;
  hash: string;
  expiresAt: number;
  startedAt: number;
  maxAgeMs: number;
  timeoutMs: number;
  events: EventEmitter;
  active(): boolean;
  verify(): Promise<StreamProof>;
  register(stream: SessionEventStream): void;
  unregister(stream: SessionEventStream): void;
}
// Only successful middleware authentication can issue this server-side binding.
// No capability, cookie, or session identity is added to the response or JSON.
const streamAuthorizations = new WeakMap<IncomingMessage, StreamAuthorization>();

export interface SessionEventStream {
  readonly closed: boolean;
  send(frame: string): void;
  /** One large conversation snapshot has its own bound; false means oversized. */
  sendSnapshot(frame: string): boolean;
  /** Progress streams need only their latest pending state under backpressure. */
  sendLatest(frame: string): void;
  onClose(cleanup: () => void): void;
  /** Deliver a final authorized notice, then close after it drains. */
  finish(frame: string): void;
  close(): void;
  /** Release a reserved stream without committing a response, e.g. a 429 error. */
  dispose(): void;
}

/** A request-local authorization lifetime. It never exposes session credentials. */
export interface SessionControl {
  readonly signal: AbortSignal;
  authorize(): Promise<void>;
  dispose(): void;
}

class AuthorizedSessionControl implements SessionControl {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private disposed = false;
  private pending?: Promise<void>;
  private refresh?: ReturnType<typeof setTimeout>;
  private readonly expiry: ReturnType<typeof setTimeout>;

  constructor(private readonly authorization: StreamAuthorization, private readonly onDispose: () => void) {
    if (!authorization.active()) throw this.denied();
    authorization.events.on('auth:logout', this.onLogout);
    this.expiry = setTimeout(() => this.dispose(), Math.max(1, authorization.expiresAt - Date.now()));
    this.expiry.unref();
    this.schedule();
  }

  private denied(): HttpError { return new HttpError(401, 'Sign in to access your workspace.', 'AUTH_REQUIRED'); }

  private readonly onLogout = (event?: { hash?: string }): void => {
    if (!event?.hash || event.hash === this.authorization.hash) this.dispose();
  };

  authorize(): Promise<void> {
    if (this.disposed || !this.authorization.active()) {
      this.dispose();
      return Promise.reject(this.denied());
    }
    // Every dispatch/result asks the durable authority again. Only concurrent
    // reads share work; a successful earlier request never becomes a grant.
    if (!this.pending) {
      this.pending = this.verify().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  private async verify(): Promise<void> {
    clearTimeout(this.refresh);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const result = await new Promise<StreamProof>((resolve, reject) => {
        abort = () => reject(this.denied());
        this.signal.addEventListener('abort', abort, { once: true });
        if (this.signal.aborted) { abort(); return; }
        deadline = setTimeout(() => this.dispose(), Math.max(1,
          Math.min(this.authorization.timeoutMs, this.authorization.expiresAt - Date.now())));
        deadline.unref();
        // AuthService already bounds and coalesces in-flight native reads. The
        // timeout revokes this control even if the OS read cannot be cancelled.
        this.authorization.verify().then(resolve, reject);
      });
      if (!result.allowed || this.disposed || !this.authorization.active()
        || performance.now() - result.startedAt >= this.authorization.maxAgeMs) throw this.denied();
      this.schedule();
    } catch {
      this.dispose();
      throw this.denied();
    } finally {
      clearTimeout(deadline);
      if (abort) this.signal.removeEventListener('abort', abort);
    }
  }

  private schedule(): void {
    clearTimeout(this.refresh);
    if (this.disposed) return;
    this.refresh = setTimeout(() => { void this.authorize().catch(() => undefined); },
      Math.max(1, Math.min(this.authorization.maxAgeMs, this.authorization.expiresAt - Date.now())));
    this.refresh.unref();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.refresh);
    clearTimeout(this.expiry);
    this.authorization.events.off('auth:logout', this.onLogout);
    this.controller.abort(this.denied());
    this.onDispose();
  }
}

interface StreamFrame { frame: string | Buffer; bytes: number; offset: number }

class AuthorizedEventStream implements SessionEventStream {
  closed = false;
  private validUntil: number;
  private readonly endAt = performance.now() + streamLifetime;
  private checking = false;
  private blocked = false;
  private draining = false;
  private finishing = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private queue: StreamFrame[] = [];
  private snapshot?: StreamFrame;
  private queuedBytes = 0;
  private cleanups = new Set<() => void>();

  constructor(private readonly res: Response, private readonly authorization: StreamAuthorization) {
    this.validUntil = authorization.startedAt + authorization.maxAgeMs;
    authorization.register(this);
    authorization.events.on('auth:logout', this.onLogout);
    res.once('close', this.close);
    res.once('error', this.close);
    res.on('drain', this.onDrain);
    this.heartbeat = setInterval(() => {
      if (!this.blocked && !this.queue.length && !this.checking) this.send(': heartbeat\n\n');
    }, 15_000);
    this.heartbeat.unref();
    this.schedule();
  }

  send(frame: string): void { this.enqueue(frame, false); }
  sendLatest(frame: string): void { this.enqueue(frame, true); }
  sendSnapshot(frame: string): boolean {
    const bytes = Buffer.byteLength(frame);
    if (bytes > streamSnapshotLimit) return false;
    this.enqueue(frame, false, bytes > streamBufferLimit, bytes);
    return true;
  }

  finish(frame: string): void {
    if (this.finishing || !this.active()) return;
    this.enqueue(frame, false);
    this.finishing = true;
    this.drain();
  }

  onClose(cleanup: () => void): void {
    if (this.closed) cleanup();
    else this.cleanups.add(cleanup);
  }

  close = (): void => {
    this.dispose();
    if (!this.res.writableEnded && !this.res.destroyed) this.res.end();
  };

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    this.authorization.events.off('auth:logout', this.onLogout);
    this.res.off('close', this.close);
    this.res.off('error', this.close);
    this.res.off('drain', this.onDrain);
    this.authorization.unregister(this);
    this.queue = []; this.snapshot = undefined; this.queuedBytes = 0;
    for (const cleanup of this.cleanups) { try { cleanup(); } catch { /* Always release the remaining subscriptions. */ } }
    this.cleanups.clear();
  }

  private readonly onLogout = (event?: { hash?: string }): void => {
    if (!event?.hash || event.hash === this.authorization.hash) this.close();
  };
  private readonly onDrain = (): void => { this.blocked = false; this.drain(); };

  private active(): boolean {
    if (this.closed) return false;
    if (!this.authorization.active() || performance.now() >= this.endAt || this.res.writableEnded || this.res.destroyed) {
      this.close(); return false;
    }
    return true;
  }

  private enqueue(frame: string, latest: boolean, snapshot = false, bytes = Buffer.byteLength(frame)): void {
    if (this.finishing || !this.active()) return;
    if (latest) { this.queue = this.snapshot ? [this.snapshot] : []; this.queuedBytes = 0; }
    const tailCount = this.queue.length - Number(!!this.snapshot);
    if (snapshot ? !!this.snapshot : tailCount >= streamQueueLimit || this.queuedBytes + bytes + this.res.writableLength > streamBufferLimit) {
      this.close(); return;
    }
    const entry: StreamFrame = { frame: snapshot ? Buffer.from(frame) : frame, bytes, offset: 0 };
    // The single snapshot is separate from the ordinary 4 MiB/1024-frame tail.
    // It may also wait for authority; a second oversized snapshot fails closed.
    if (snapshot) this.snapshot = entry;
    else this.queuedBytes += bytes;
    this.queue.push(entry);
    this.drain();
  }

  private drain(): void {
    if (this.draining || !this.active()) return;
    if (this.checking) return;
    if (performance.now() >= this.validUntil) { this.verify(); return; }
    this.draining = true;
    try {
      // Recheck expiry/local revocation before each write, including queued data.
      while (!this.blocked && this.queue.length && this.active() && performance.now() < this.validUntil) {
        const next = this.queue[0];
        if (next === this.snapshot) {
          const end = Math.min(next.bytes, next.offset + streamSnapshotChunk);
          // UTF-8 bytes can cross HTTP chunks without splitting JS surrogates.
          // Copy each chunk so a socket cannot retain the whole snapshot buffer.
          const chunk = Buffer.from((next.frame as Buffer).subarray(next.offset, end));
          next.offset = end;
          if (end === next.bytes) { this.queue.shift(); this.snapshot = undefined; }
          this.blocked = !this.res.write(chunk);
        } else {
          this.queue.shift(); this.queuedBytes -= next.bytes;
          this.blocked = !this.res.write(next.frame);
        }
      }
    } catch { this.close(); }
    finally { this.draining = false; }
    if (this.finishing && !this.queue.length && !this.blocked) { this.close(); return; }
    if (!this.closed && !this.checking && performance.now() >= this.validUntil) this.verify();
  }

  private remaining(): number { return Math.min(this.endAt - performance.now(), this.authorization.expiresAt - Date.now()); }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.active()) return;
    this.timer = setTimeout(() => { if (this.active()) this.verify(); }, Math.max(1, Math.min(this.remaining(), this.validUntil - performance.now())));
    this.timer.unref();
  }

  private verify(): void {
    if (this.checking || !this.active()) return;
    this.checking = true;
    clearTimeout(this.timer);
    // A slow/unavailable mount cannot leave an authorized stream open forever.
    // Only one check is in flight; no events are emitted while it is pending.
    this.timer = setTimeout(this.close, Math.max(1, Math.min(this.remaining(), this.authorization.timeoutMs)));
    this.timer.unref();
    void this.authorization.verify().then(proof => {
      if (!this.active()) return;
      this.checking = false;
      this.validUntil = proof.startedAt + this.authorization.maxAgeMs;
      // A delayed event loop may deliver IO before an already-due timeout.
      // Never accept that late proof simply because its timer has not run yet.
      if (!proof.allowed || performance.now() - proof.startedAt >= this.authorization.timeoutMs
        || performance.now() >= this.validUntil) { this.close(); return; }
      this.schedule();
      this.drain();
    }, () => this.close());
  }
}

/** Call before flushing SSE headers, behind requireSession. All frames use send. */
export function createSessionEventStream(req: IncomingMessage, res: Response): SessionEventStream {
  const authorization = streamAuthorizations.get(req);
  if (!authorization?.active()) throw new HttpError(401, 'Sign in to access your workspace.', 'AUTH_REQUIRED');
  return new AuthorizedEventStream(res, authorization);
}

function compare(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function identity(value: unknown): SessionIdentity | undefined {
  const item = object(value);
  if (!item || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash)
    || typeof item.expiresAt !== 'number' || !Number.isSafeInteger(item.expiresAt) || item.expiresAt <= 0) return undefined;
  return { hash: item.hash, expiresAt: item.expiresAt };
}

export class AuthService {
  private readonly directory: string;
  private stores = new Map<string, JsonStore>();
  // Negative local knowledge survives slow/failed writes and regressing native
  // mount views. Positive membership is never authorized from an in-memory map.
  private revokedHere = new Map<string, number>();
  private failures = new Map<string, { attempts: number; expiresAt: number }>();
  private epoch: string;
  private passwordHash: Buffer;
  private activeLogins = 0;
  private initialization?: Promise<void>;
  private maintenance?: Promise<void>;
  private nextCleanup = 0;
  private closed = false;
  private closing?: Promise<void>;
  private cleanupRoot?: CleanupDirectory;
  private cleanupBucket?: CleanupBucket;
  private streams = new Set<SessionEventStream>();
  private controls = new Set<SessionControl>();
  private streamChecks = new Map<string, Promise<StreamProof>>();
  private readonly streamMaxAgeMs: number;
  private readonly streamTimeoutMs: number;

  constructor(private ctx: AppContext, options: AuthServiceOptions = {}) {
    this.streamMaxAgeMs = options.streamMaxAgeMs ?? streamMaxAge;
    this.streamTimeoutMs = options.streamTimeoutMs ?? Math.min(streamTimeout, this.streamMaxAgeMs);
    if (!Number.isSafeInteger(this.streamMaxAgeMs) || this.streamMaxAgeMs < 50 || this.streamMaxAgeMs > streamMaxAge
      || !Number.isSafeInteger(this.streamTimeoutMs) || this.streamTimeoutMs < 10 || this.streamTimeoutMs > Math.min(streamTimeout, this.streamMaxAgeMs)) {
      throw new Error('Stream authorization timing exceeds its allowed bounds.');
    }
    this.directory = path.join(ctx.store.directory, 'auth-sessions-v2');
    this.epoch = createHmac('sha256', ctx.config.sessionSecret).update(ctx.config.password).digest('hex');
    this.passwordHash = scryptSync(ctx.config.password, this.epoch, 64);
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeOnce().catch(error => { this.initialization = undefined; throw error; });
    }
    return this.initialization;
  }

  private sessionStore(expiresAt: number): JsonStore {
    const bucket = `d-${Math.floor(expiresAt / day)}`;
    let store = this.stores.get(bucket);
    if (!store) {
      store = new JsonStore(path.join(this.directory, bucket));
      this.stores.set(bucket, store);
      // Legitimate sessions normally span at most eight UTC expiry days.
      while (this.stores.size > 16) this.stores.delete(this.stores.keys().next().value!);
    }
    return store;
  }

  private record(session: SessionIdentity): SessionRecord {
    return { version: 2, epoch: this.epoch, hash: session.hash, expiresAt: session.expiresAt };
  }

  private async revocationPresent(store: JsonStore, hash: string): Promise<boolean> {
    try { await fs.lstat(path.join(store.directory, `revoked-${hash}.json`)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }

  private async initializeOnce(): Promise<void> {
    // A completed migration is a permanent, per-epoch cutover. A delayed legacy
    // snapshot must never become authoritative again after that cutover.
    const migrationKey = `session-migration-${this.epoch}`;
    const migrated = await this.ctx.store.read<unknown>(migrationKey, undefined);
    if (migrated === undefined) {
      const saved = object(await this.ctx.store.read<unknown>('sessions', undefined));
      if (saved?.epoch === this.epoch) {
        if (!Array.isArray(saved.sessions) || saved.sessions.length > 10_000) {
          throw new HttpError(503, 'Saved session metadata could not be migrated.', 'SESSION_STATE_INVALID');
        }
        const sessions = new Map<string, SessionIdentity>();
        for (const value of saved.sessions) {
          const session = identity(value);
          if (session && session.expiresAt > Date.now()) sessions.set(session.hash, session);
        }
        for (const session of sessions.values()) {
          const store = this.sessionStore(session.expiresAt);
          const [existing, revoked] = await Promise.all([
            store.read<unknown>(`session-${session.hash}`, undefined),
            this.revocationPresent(store, session.hash),
          ]);
          // Existing new-format state wins, including malformed/denying state.
          // A concurrent import may write the same immutable grant later, but
          // cannot remove or overwrite a separate revocation marker.
          if (existing === undefined && !revoked) await store.write(`session-${session.hash}`, this.record(session));
        }
      }
      await this.ctx.store.write<MigrationRecord>(migrationKey, { version: 2, epoch: this.epoch, complete: true });
    } else {
      const marker = object(migrated);
      if (marker?.version !== 2 || marker.epoch !== this.epoch || marker.complete !== true) {
        throw new HttpError(503, 'Saved session metadata could not be read.', 'SESSION_STATE_INVALID');
      }
    }
    // Maintenance is bounded and never rewrites the legacy snapshot or a live
    // session. There is no timer, distributed lock, or claimed remote CAS.
    this.scheduleCleanup();
    await this.maintenance;
  }

  private scheduleCleanup(): void {
    if (this.closed || this.maintenance || Date.now() < this.nextCleanup) return;
    this.nextCleanup = Date.now() + cleanupInterval;
    const job = this.cleanupExpired().catch(async () => {
      await this.closeCleanupCursors();
      this.ctx.events.emit('auth:maintenance-error');
    }).finally(() => { if (this.maintenance === job) this.maintenance = undefined; });
    this.maintenance = job;
  }

  private async openCleanupDirectory(location: string): Promise<CleanupDirectory> {
    const handle = await fs.open(location, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    // Pin each traversed directory. A bucket renamed/replaced with a symlink
    // after enumeration must not redirect cleanup into a different directory.
    const access = `${process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'}/${handle.fd}`;
    try { return { handle, access, entries: await fs.opendir(access) }; }
    catch (error) { await handle.close(); throw error; }
  }

  private async closeCleanupDirectory(directory?: CleanupDirectory): Promise<void> {
    if (!directory) return;
    await directory.entries.close().catch(() => undefined);
    await directory.handle.close().catch(() => undefined);
  }

  private async closeCleanupCursors(): Promise<void> {
    const bucket = this.cleanupBucket, root = this.cleanupRoot;
    this.cleanupBucket = undefined; this.cleanupRoot = undefined;
    await this.closeCleanupDirectory(bucket);
    await this.closeCleanupDirectory(root);
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [hash, expiresAt] of this.revokedHere) if (expiresAt + cleanupGrace < now) this.revokedHere.delete(hash);
    const cutoff = Math.floor((now - cleanupGrace) / day);
    // Preserve cursors across bounded passes: a prefix of unknown files must
    // not prevent later expired records from ever being inspected.
    if (this.cleanupBucket && this.cleanupBucket.day >= cutoff) {
      const bucket = this.cleanupBucket; this.cleanupBucket = undefined;
      await this.closeCleanupDirectory(bucket);
    }
    let scanned = 0;
    while (scanned < cleanupBudget && !this.closed) {
      if (this.cleanupBucket) {
        const bucket = this.cleanupBucket;
        const file = await bucket.entries.read(); scanned++;
        if (!file) {
          this.cleanupBucket = undefined;
          await this.closeCleanupDirectory(bucket);
          await fs.rmdir(path.join(this.cleanupRoot!.access, bucket.name)).catch(error => {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
          });
        } else if ((file.isFile() || file.isSymbolicLink()) && /^(?:session|revoked)-[a-f0-9]{64}\.json(?:\.[a-f0-9-]{36}\.tmp)?$/.test(file.name)) {
          await fs.unlink(path.join(bucket.access, file.name)).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          });
        }
        continue;
      }
      if (!this.cleanupRoot) {
        try { this.cleanupRoot = await this.openCleanupDirectory(this.directory); }
        catch (error) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code || '')) return; throw error; }
      }
      const bucket = await this.cleanupRoot.entries.read(); scanned++;
      if (!bucket) { await this.closeCleanupCursors(); return; }
      const bucketDay = Number(bucket.name.slice(2));
      if (!bucket.isDirectory() || !/^d-\d+$/.test(bucket.name) || !Number.isSafeInteger(bucketDay) || bucketDay >= cutoff) continue;
      try {
        this.cleanupBucket = { ...await this.openCleanupDirectory(path.join(this.cleanupRoot.access, bucket.name)), name: bucket.name, day: bucketDay };
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      }
    }
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      for (const stream of this.streams) stream.close();
      for (const control of this.controls) control.dispose();
      this.closing = this.closeOnce();
    }
    return this.closing;
  }

  private async closeOnce(): Promise<void> {
    await this.initialization?.catch(() => undefined);
    await this.maintenance;
    await this.closeCleanupCursors();
    await Promise.all([...this.stores.values()].map(store => store.flush()));
  }

  private signature(data: string): string { return createHmac('sha256', this.ctx.config.sessionSecret).update(data).digest('base64url'); }

  private token(req: IncomingMessage): string | undefined {
    try { return parse(req.headers.cookie || '')[cookieName]; } catch { return undefined; }
  }

  private signedSession(req: IncomingMessage): SessionIdentity | undefined {
    const token = this.token(req);
    if (!token || token.length > 512) return undefined;
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const data = `${parts[0]}.${parts[1]}`;
    if (!compare(parts[2], this.signature(data))) return undefined;
    const expiresAt = Number(parts[1]);
    if (!Number.isSafeInteger(expiresAt) || String(expiresAt) !== parts[1] || expiresAt <= Date.now()) return undefined;
    return { hash: digest(token), expiresAt };
  }

  private async authority(session: SessionIdentity): Promise<SessionAuthority> {
    try {
      const store = this.sessionStore(session.expiresAt);
      const [value, revoked] = await Promise.allSettled([
        store.read<unknown>(`session-${session.hash}`, undefined),
        this.revocationPresent(store, session.hash),
      ]);
      if (revoked.status === 'fulfilled' && revoked.value) return { active: false, revoked: true };
      if (value.status === 'rejected' || revoked.status === 'rejected') return { active: false, revoked: false };
      const member = object(value.value);
      // Any existing revocation value denies access, even null or malformed
      // metadata. JSON/read errors also fail closed; they are never absence.
      return {
        active: member?.version === 2 && member.epoch === this.epoch
          && member.hash === session.hash && member.expiresAt === session.expiresAt,
        revoked: false,
      };
    } catch { return { active: false, revoked: false }; }
  }

  authenticated = async (req: IncomingMessage): Promise<boolean> => {
    if (this.closed) return false;
    const session = this.signedSession(req);
    return session ? this.authenticateSession(session) : false;
  };

  /** Acquire only after this instance's successful requireSession middleware. */
  acquireSessionControl = (req: IncomingMessage): SessionControl => {
    const authorization = streamAuthorizations.get(req);
    if (this.closed || !authorization?.active() || authorization.owner !== this) {
      throw new HttpError(401, 'Sign in to access your workspace.', 'AUTH_REQUIRED');
    }
    if (this.controls.size >= streamConnectionLimit) {
      throw new HttpError(429, 'Too many controls are active. Wait for another operation to finish.', 'SESSION_CONTROL_LIMIT');
    }
    const control = new AuthorizedSessionControl(authorization, () => { this.controls.delete(control); });
    this.controls.add(control);
    return control;
  };

  private activeSession(session: SessionIdentity): boolean {
    return !this.closed && !this.revokedHere.has(session.hash) && session.expiresAt > Date.now();
  }

  private async authenticateSession(session: SessionIdentity): Promise<boolean> {
    if (!this.activeSession(session)) return false;
    const result = await this.authority(session);
    if (result.revoked && !this.revokedHere.has(session.hash)) {
      this.revokedHere.set(session.hash, session.expiresAt);
      if (!this.closed) this.ctx.events.emit('auth:logout', { hash: session.hash });
    }
    // A same-process logout or expiry may occur while filesystem reads await.
    return result.active && this.activeSession(session);
  }

  private verifyStream(session: SessionIdentity): Promise<StreamProof> {
    let pending = this.streamChecks.get(session.hash);
    if (!pending) {
      const startedAt = performance.now();
      // A timed-out native read may still be stuck in the OS after its stream
      // closes. Keep those reads single-flight and cap retained pending work.
      if (this.streamChecks.size >= streamConnectionLimit) return Promise.resolve({ allowed: false, startedAt });
      pending = this.authenticateSession(session).then(allowed => ({ allowed, startedAt })).finally(() => {
        if (this.streamChecks.get(session.hash) === pending) this.streamChecks.delete(session.hash);
      });
      this.streamChecks.set(session.hash, pending);
    }
    // Coalesce simultaneous streams, without caching a positive authority read.
    return pending;
  }

  originAllowed = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (origin === 'null') return false;
    try {
      const url = new URL(origin);
      const host = req.headers.host;
      return Boolean(host && url.host === host && (this.ctx.config.production ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol)));
    } catch { return false; }
  };

  authenticateUpgrade = async (req: IncomingMessage): Promise<boolean> => this.originAllowed(req) && await this.authenticated(req);

  requireSession = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const startedAt = performance.now();
    if (!await this.authenticated(req)) return next(new HttpError(401, 'Sign in to access your workspace.', 'AUTH_REQUIRED'));
    const session = this.signedSession(req);
    if (!session || !this.activeSession(session)) return next(new HttpError(401, 'Sign in to access your workspace.', 'AUTH_REQUIRED'));
    streamAuthorizations.set(req, {
      ...session, owner: this, startedAt, events: this.ctx.events, maxAgeMs: this.streamMaxAgeMs, timeoutMs: this.streamTimeoutMs,
      active: () => this.activeSession(session), verify: () => this.verifyStream(session),
      register: stream => {
        if (this.streams.size >= streamConnectionLimit) throw new HttpError(429, 'Too many event streams are open. Close an unused view and retry.', 'STREAM_LIMIT');
        this.streams.add(stream);
      },
      unregister: stream => { this.streams.delete(stream); },
    });
    next();
  };

  protectMutations = (req: Request, _res: Response, next: NextFunction): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!this.originAllowed(req) || req.headers['x-codex-workspace'] !== '1') return next(new HttpError(403, 'This request must come from the workspace application.', 'ORIGIN_REQUIRED'));
    next();
  };

  private cookie(token: string, maxAge: number): string {
    return serialize(cookieName, token, {
      httpOnly: true, secure: this.ctx.config.production,
      sameSite: this.ctx.config.production ? 'none' : 'lax',
      partitioned: this.ctx.config.production,
      path: '/', maxAge,
    });
  }

  router(): Router {
    const router = Router();
    router.get('/session', async (req, res) => res.json({ authenticated: await this.authenticated(req) }));
    router.post('/session', async (req, res) => {
      if (this.closed) throw new HttpError(503, 'The workspace is shutting down.');
      await this.initialize();
      const address = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const recent = this.failures.get(address);
      if (recent && recent.expiresAt > now && recent.attempts >= 8) throw new HttpError(429, 'Too many incorrect passwords. Please try again in 10 minutes.', 'LOGIN_RATE_LIMITED');
      const password = req.body?.password;
      if (typeof password !== 'string' || password.length > 1024) throw new HttpError(400, 'Enter your workspace password.');
      if (this.activeLogins >= 4) throw new HttpError(429, 'Sign-in is busy. Please try again in a moment.', 'LOGIN_BUSY');
      this.activeLogins++;
      let hash: Buffer;
      try { hash = await new Promise<Buffer>((resolve, reject) => scrypt(password, this.epoch, 64, (error, derived) => error ? reject(error) : resolve(derived))); }
      finally { this.activeLogins--; }
      if (this.closed) throw new HttpError(503, 'The workspace is shutting down.');
      if (!timingSafeEqual(hash, this.passwordHash)) {
        const latest = this.failures.get(address);
        const attempts = latest && latest.expiresAt > now ? latest.attempts + 1 : 1;
        this.failures.set(address, { attempts, expiresAt: now + 10 * 60 * 1000 });
        for (const [key, item] of this.failures) if (item.expiresAt < now) this.failures.delete(key);
        while (this.failures.size > 10000) this.failures.delete(this.failures.keys().next().value!);
        throw new HttpError(401, 'That password is incorrect.', 'INVALID_PASSWORD');
      }
      this.failures.delete(address);
      const expiresAt = now + lifetime;
      const data = `${randomBytes(32).toString('base64url')}.${expiresAt}`;
      const token = `${data}.${this.signature(data)}`;
      const session = { hash: digest(token), expiresAt };
      await this.sessionStore(expiresAt).write(`session-${session.hash}`, this.record(session));
      this.scheduleCleanup();
      res.setHeader('Set-Cookie', this.cookie(token, lifetime / 1000));
      res.json({ authenticated: true });
    });
    router.delete('/session', async (req, res) => {
      if (this.closed) throw new HttpError(503, 'The workspace is shutting down.');
      const session = this.signedSession(req);
      if (session) {
        const alreadyRevoked = this.revokedHere.has(session.hash);
        this.revokedHere.set(session.hash, session.expiresAt);
        // Possession of a valid signed cookie permits revoking that cookie,
        // even while a mount cannot see its grant. Notify local streams once,
        // before slow IO; anonymous/unsigned/expired cookies do not reach here.
        if (!alreadyRevoked) this.ctx.events.emit('auth:logout', { hash: session.hash });
        const result = await this.authority(session);
        if (this.closed) throw new HttpError(503, 'The workspace is shutting down.');
        if (!result.revoked) {
          // A signed cookie can be revoked even if this mount cannot currently
          // see its membership record. Otherwise a stale/missing read could
          // acknowledge logout and later restore access when the grant appears.
          const revoked: RevocationRecord = { ...this.record(session), revoked: true };
          await this.sessionStore(session.expiresAt).write(`revoked-${session.hash}`, revoked);
        }
        this.scheduleCleanup();
      }
      res.setHeader('Set-Cookie', this.cookie('', 0));
      res.json({ authenticated: false });
    });
    return router;
  }
}
