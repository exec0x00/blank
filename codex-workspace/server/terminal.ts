import { createHash, randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, Server } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import { Router } from 'express';
import * as pty from 'node-pty';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { TerminalSession } from '../shared/types';
import type { TerminalReplayState } from '../shared/terminal-replay';
import type { AppConfig } from './config';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { gitWorkspaceEnvironment } from './git-environment';
import { prepareRuntimeStorage, runtimeEnvironment } from './runtime-storage';
import { TerminalReplay, terminalChunkEnd, TERMINAL_HISTORY_LINES, TERMINAL_PARSE_HIGH, TERMINAL_PARSE_LOW, TERMINAL_PARSE_HIGH_FRAMES, TERMINAL_PARSE_LOW_FRAMES, type TerminalSnapshot } from './terminal-replay';
import { acquireWorkspaceActivity } from './worktrees/activity';

const MAX_CLIENT_BUFFER = 1024 * 1024;
const MAX_INPUT_CHARACTERS = 64 * 1024;
const MAX_WORKSPACE_SESSIONS = 8;
const MAX_SESSIONS = 32;
const OUTPUT_HIGH_WATERMARK = 256 * 1024;
const OUTPUT_LOW_WATERMARK = 64 * 1024;
// Small TUI updates can exhaust a browser/auth operation queue long before
// byte credit. Stay below both queues' 1,024-operation limits.
const OUTPUT_HIGH_FRAMES = 256;
const OUTPUT_LOW_FRAMES = 64;
// node-pty closes its read socket 200 ms after the native root exits. Detect an
// ended root while reading is paused so that grace period drains its last bytes.
const PAUSED_EXIT_CHECK_MS = 40;
const EXIT_DRAIN_MAX_MS = 150;
const EXIT_DRAIN_MAX_BYTES = 256 * 1024;
const MAX_CONNECTIONS = 128;
const AUTHORIZATION_MAX_AGE_MS = 5000;
const AUTHORIZATION_TIMEOUT_MS = 3000;
const MAX_AUTHORIZATION_QUEUE_MESSAGES = 1024;
const PROCESS_SCAN_LIMIT = 8192;
const PROCESS_SCAN_TIMEOUT_MS = 1000;
const PROCESS_CLEANUP_INTERVAL_MS = 350;
const PROCESS_CLEANUP_MAX_INTERVAL_MS = 5000;
const managers = new WeakMap<AppContext, TerminalManager>();
const authorizations = new WeakMap<WebSocket, TerminalAuthorization>();

type UpgradeAuthenticator = (request: IncomingMessage) => boolean | Promise<boolean>;
export interface TerminalAuthorizationOptions {
  /** Internal service/test bounds; neither is a browser preference. */
  maxAgeMs?: number;
  timeoutMs?: number;
  /** Only the authenticated development server may claim this exact upgrade. */
  devHmrPath?: '/__codex_dev_hmr';
}
interface AuthorizationResult { status: 'allowed' | 'denied' | 'unavailable' | 'cancelled'; startedAt: number }
interface AuthorizationCheck { result: Promise<AuthorizationResult>; cancel(): void }

function checkAuthorization(request: IncomingMessage, authenticate: UpgradeAuthenticator, timeoutMs: number): AuthorizationCheck {
  const startedAt = performance.now();
  let complete = false;
  let finish!: (status: AuthorizationResult['status']) => void;
  const result = new Promise<AuthorizationResult>((resolve) => {
    const timeout = setTimeout(() => finish('unavailable'), timeoutMs);
    timeout.unref();
    finish = (status) => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      if (status === 'allowed' && performance.now() - startedAt >= timeoutMs) status = 'unavailable';
      resolve({ status, startedAt });
    };
  });
  // The callback can be asynchronous or throw before returning a promise.
  void Promise.resolve().then(() => complete ? false : authenticate(request)).then(
    (allowed) => finish(allowed === true ? 'allowed' : 'denied'),
    () => finish('unavailable'),
  );
  return { result, cancel: () => finish('cancelled') };
}

function transmit(socket: WebSocket, payload: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_CLIENT_BUFFER) {
    socket.close(1013, 'Output is moving too quickly. Reconnect to resume.');
    return;
  }
  socket.send(payload);
}

/** A short proof lease keeps native-storage reads off the PTY's hot path. */
class TerminalAuthorization {
  private validUntil: number;
  private version = 0;
  private disposed = false;
  private checking?: AuthorizationCheck;
  private timer?: ReturnType<typeof setTimeout>;
  private handler?: (data: RawData, binary: boolean) => void;
  private input: Array<{ data: RawData; binary: boolean; bytes: number }> = [];
  private output: Array<{ payload: string; bytes: number }> = [];
  private queuedBytes = 0;
  private draining = false;
  private finishing?: { code: number; reason: string };

  constructor(
    private readonly socket: WebSocket,
    private readonly request: IncomingMessage,
    private readonly authenticate: UpgradeAuthenticator,
    private readonly maxAgeMs: number,
    private readonly timeoutMs: number,
    initial: AuthorizationResult,
  ) {
    this.validUntil = initial.startedAt + maxAgeMs;
    socket.on('message', this.receive);
    socket.on('close', () => this.dispose());
    socket.on('error', () => this.dispose());
    this.schedule();
  }

  valid(): boolean {
    return !this.disposed && this.socket.readyState === WebSocket.OPEN && !this.checking && performance.now() < this.validUntil;
  }

  async authorizeAction(): Promise<boolean> {
    while (!this.disposed && this.socket.readyState === WebSocket.OPEN) {
      if (this.valid()) return true;
      this.verify();
      const check = this.checking;
      if (!check) return false;
      await check.result;
      // A local logout may replace an in-flight check. Only its newer proof
      // may authorize the action, never the canceled result we just awaited.
      if (this.checking && this.checking !== check) continue;
      return this.valid();
    }
    return false;
  }

  listen(handler: (data: RawData, binary: boolean) => void): void {
    if (this.disposed) return;
    this.handler = handler;
    this.drain();
  }

  send(payload: string): void {
    if (this.disposed || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.valid() && !this.draining && !this.output.length) { transmit(this.socket, payload); return; }
    const bytes = Buffer.byteLength(payload);
    if (!this.reserve(bytes)) return;
    this.output.push({ payload, bytes });
    this.drain();
  }

  finish(code: number, reason: string): void {
    if (this.disposed || this.socket.readyState !== WebSocket.OPEN) return;
    this.finishing = { code, reason };
    for (const entry of this.input) this.queuedBytes -= entry.bytes;
    this.input = [];
    this.drain();
  }

  /** Local logout invalidates the proof before any further input can be written. */
  invalidate(): void {
    if (this.disposed) return;
    this.validUntil = 0;
    this.version++;
    this.checking?.cancel();
    this.checking = undefined;
    clearTimeout(this.timer);
    this.verify();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.validUntil = 0;
    this.version++;
    clearTimeout(this.timer);
    this.checking?.cancel();
    this.checking = undefined;
    this.input = [];
    this.output = [];
    this.queuedBytes = 0;
    this.handler = undefined;
    this.finishing = undefined;
    this.socket.off('message', this.receive);
  }

  private readonly receive = (data: RawData, binary: boolean): void => {
    if (this.disposed || this.finishing || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.valid() && this.handler && !this.draining && !this.input.length && !this.output.length) {
      this.handler(data, binary);
      return;
    }
    const bytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0) : data.byteLength;
    if (!this.reserve(bytes)) return;
    this.input.push({ data, binary, bytes });
    this.drain();
  };

  private reserve(bytes: number): boolean {
    if (this.queuedBytes + bytes > MAX_CLIENT_BUFFER || this.input.length + this.output.length >= MAX_AUTHORIZATION_QUEUE_MESSAGES) {
      this.close(1013, 'Authentication is pending and the terminal buffer is full. Reconnect to resume.');
      return false;
    }
    this.queuedBytes += bytes;
    return true;
  }

  private drain(): void {
    if (this.disposed || this.draining) return;
    if (!this.valid()) { this.verify(); return; }
    this.draining = true;
    try {
      while (this.valid()) {
        const next = this.output.shift();
        if (next) { this.queuedBytes -= next.bytes; transmit(this.socket, next.payload); continue; }
        if (!this.handler) break;
        const incoming = this.input.shift();
        if (!incoming) break;
        this.queuedBytes -= incoming.bytes;
        this.handler(incoming.data, incoming.binary);
      }
    } finally { this.draining = false; }
    if (this.valid() && this.finishing && !this.output.length) {
      this.close(this.finishing.code, this.finishing.reason);
      return;
    }
    if (!this.valid()) this.verify();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.verify(), Math.max(1, this.validUntil - performance.now()));
    this.timer.unref();
  }

  private verify(): void {
    if (this.disposed || this.checking || this.socket.readyState !== WebSocket.OPEN) return;
    this.validUntil = 0;
    clearTimeout(this.timer);
    const version = this.version;
    const check = checkAuthorization(this.request, this.authenticate, this.timeoutMs);
    this.checking = check;
    void check.result.then((result) => {
      if (this.disposed || version !== this.version || this.checking !== check) return;
      this.checking = undefined;
      if (result.status !== 'allowed' || performance.now() >= result.startedAt + this.maxAgeMs) {
        // A slow/unavailable authority is not evidence of an expired login.
        // Both cases discard queued input, but a transient failure permits the
        // browser's bounded reconnect policy to obtain a fresh proof.
        this.close(result.status === 'denied' ? 1008 : 1013, result.status === 'denied' ? 'Your session has expired. Sign in again.' : 'Your session could not be verified. Reconnect to try again.');
        return;
      }
      // Measure age from the authority read's start, not its completion.
      this.validUntil = result.startedAt + this.maxAgeMs;
      this.schedule();
      this.drain();
    });
  }

  private close(code: number, reason: string): void {
    this.dispose();
    this.socket.close(code, reason);
  }
}

interface ClientState {
  flowControl: boolean;
  frameControl: boolean;
  pendingCharacters: number;
  pendingFrames: number[];
  replayUnacknowledged: number;
  /** Time when actual outstanding output stopped making consumption progress. */
  pressuredAt: number | null;
  preparing: boolean;
  replay?: TerminalSnapshot;
  replayOffset: number;
  queue: ServerMessage[];
  queuedCharacters: number;
  queuedFrames: number;
  draining: boolean;
  exitQueued?: boolean;
}

function outputPressure(state: ClientState, characters: number, frames: number): boolean {
  return state.pendingCharacters + state.queuedCharacters >= characters
    || state.frameControl && state.pendingFrames.length + state.queuedFrames >= frames;
}

function recordOutputProgress(state: ClientState, consumed = false): void {
  if (!state.flowControl || state.preparing || !outputPressure(state, OUTPUT_LOW_WATERMARK, OUTPUT_LOW_FRAMES)) {
    state.pressuredAt = null;
  } else if (state.pressuredAt === null || consumed) {
    state.pressuredAt = Date.now();
  }
}

interface OpenOptions {
  requestId: string;
  sessionId?: string;
  fresh: boolean;
  existingOnly: boolean;
  cols: number;
  rows: number;
}

interface SessionState {
  info: TerminalSession;
  process: pty.IPty;
  clients: Map<WebSocket, ClientState>;
  replay: TerminalReplay;
  outputSequence: number;
  replyOwners: Map<number, WebSocket>;
  cols: number;
  rows: number;
  exitCode?: number;
  forceKill?: ReturnType<typeof setTimeout>;
  paused: boolean;
  exitWatch?: ReturnType<typeof setInterval>;
  drainingExit?: { until: number; bytes: number; timer: ReturnType<typeof setTimeout> };
  activity: TerminalActivity;
  removed?: boolean;
  stopping?: Promise<void>;
}

interface NativeProcess {
  pid: number;
  parent: number;
  group: number;
  session: number;
  started: string;
  state: string;
}
interface ProcessScan { processes: Map<number, NativeProcess>; complete: boolean }
const processLive = (value: NativeProcess) => value.state !== 'Z' && value.state !== 'X';

async function nativeProcess(pid: number): Promise<NativeProcess | undefined> {
  const source = await readFile(`/proc/${pid}/stat`, 'utf8');
  const end = source.lastIndexOf(')');
  const fields = source.slice(end + 2).trim().split(/\s+/);
  const found = Number(source.slice(0, source.indexOf(' ')));
  if (end < 0 || found !== pid || !/^[0-9]+$/.test(fields[19] || '')) return undefined;
  const [parent, group, session] = fields.slice(1, 4).map(Number);
  if (![parent, group, session].every(Number.isSafeInteger)) return undefined;
  return { pid, parent, group, session, started: fields[19], state: fields[0] };
}

/** Lifecycle-only, bounded /proc reads. No scan is performed for keyboard/output frames. */
async function scanProcesses(): Promise<ProcessScan> {
  if (process.platform !== 'linux') return { processes: new Map(), complete: false };
  const names = (await readdir('/proc')).filter((name) => /^[0-9]+$/.test(name));
  if (names.length > PROCESS_SCAN_LIMIT) return { processes: new Map(), complete: false };
  const processes = new Map<number, NativeProcess>();
  let cursor = 0, complete = true;
  await Promise.all(Array.from({ length: Math.min(12, names.length) }, async () => {
    while (cursor < names.length) {
      try {
        const value = await nativeProcess(Number(names[cursor++]));
        if (value) processes.set(value.pid, value); else complete = false;
      } catch {
        // A vanished PID may have forked after readdir. Retry a clean scan;
        // treating the missing entry as proof of no descendants is unsafe.
        complete = false;
      }
    }
  }));
  const after = (await readdir('/proc')).filter((name) => /^[0-9]+$/.test(name));
  const before = new Set(names);
  if (after.some((name) => !before.has(name))) complete = false;
  return { processes, complete };
}

async function processHasMarker(identity: NativeProcess, marker: string): Promise<boolean> {
  const handle = await open(`/proc/${identity.pid}/environ`, 'r');
  try {
    const bytes = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const sought = Buffer.from(`CODEX_TERMINAL_ACTIVITY=${marker}\0`);
    const contents = bytes.subarray(0, bytesRead);
    const at = contents.indexOf(sought);
    if (at < 0 || at > 0 && contents[at - 1] !== 0) return false;
    // An environment read and PID-table scan can race PID reuse.
    return (await nativeProcess(identity.pid))?.started === identity.started;
  } finally { await handle.close(); }
}

class TerminalActivity {
  readonly initialized: Promise<void>;
  private root?: NativeProcess;
  private readonly ancestors = new Set<number>([1]);
  private completeAncestry = false;
  private readonly known = new Map<number, NativeProcess>();
  private released = false;
  private cleanScans = 0;

  constructor(readonly pid: number, readonly marker: string, private readonly release: () => void) {
    this.initialized = this.initialize();
  }

  private async initialize(): Promise<void> {
    if (process.platform !== 'linux') return;
    try {
      const root = await nativeProcess(this.pid);
      if (!root || root.session !== this.pid) return;
      this.root = root;
      this.known.set(root.pid, root);
      let parent = root.parent;
      for (let depth = 0; depth < 64; depth++) {
        if (parent <= 1) { this.completeAncestry = true; return; }
        if (this.ancestors.has(parent)) return;
        this.ancestors.add(parent);
        const identity = await nativeProcess(parent);
        if (!identity) return;
        parent = identity.parent;
      }
    } catch { /* Unprovable identity keeps the lease, including after shutdown. */ }
  }

  async inspect(scan: ProcessScan, otherRoots: ReadonlyMap<number, string>): Promise<{ owned: NativeProcess[]; uncertain: boolean }> {
    await this.initialized;
    if (!this.root) return { owned: [], uncertain: true };
    const root = this.root;
    const currentRoot = scan.processes.get(root.pid);
    const rootReused = currentRoot && currentRoot.started !== root.started;
    const owned = new Map<number, NativeProcess>();
    const candidates: NativeProcess[] = [];
    const started = BigInt(root.started);
    for (const identity of scan.processes.values()) {
      if (!processLive(identity) || identity.pid <= 1 || identity.pid === process.pid || BigInt(identity.started) < started) continue;
      if (this.known.get(identity.pid)?.started === identity.started || !rootReused && identity.session === root.pid) owned.set(identity.pid, identity);
      else candidates.push(identity);
    }
    let uncertain = !scan.complete || !this.completeAncestry;
    let markerReads = 0;
    for (const identity of candidates) {
      let cursor: NativeProcess | undefined = identity;
      const seen = new Set<number>();
      let unrelated = false, related = false;
      for (let depth = 0; cursor && depth < 64 && !seen.has(cursor.pid); depth++) {
        seen.add(cursor.pid);
        if (owned.has(cursor.pid) || this.known.get(cursor.pid)?.started === cursor.started) { related = true; break; }
        if (otherRoots.get(cursor.pid) === cursor.started || BigInt(cursor.started) < started && !this.ancestors.has(cursor.pid)) { unrelated = this.completeAncestry; break; }
        if (this.ancestors.has(cursor.pid)) break; // An orphan can be adopted by an ancestor/subreaper.
        cursor = scan.processes.get(cursor.parent);
      }
      if (unrelated) continue;
      if (!related && markerReads++ < 128) {
        try { related = await processHasMarker(identity, this.marker); } catch { /* Ambiguous stays busy. */ }
      }
      if (related) owned.set(identity.pid, identity);
      else uncertain = true;
    }
    if (scan.complete) this.known.clear();
    for (const identity of owned.values()) {
      if (this.known.size >= PROCESS_SCAN_LIMIT && !this.known.has(identity.pid)) { uncertain = true; break; }
      this.known.set(identity.pid, identity);
    }
    return { owned: [...owned.values()], uncertain };
  }

  rootIdentity(): NativeProcess | undefined { return this.root; }

  confirmEnded(exited: boolean, owned: NativeProcess[], uncertain: boolean): boolean {
    if (this.released) return true;
    if (!exited || owned.length || uncertain) { this.cleanScans = 0; return false; }
    // Two complete, quiescent scans avoid releasing on a single racing proc read.
    if (++this.cleanScans < 2) return false;
    this.released = true;
    this.release();
    return true;
  }

  async signalOwned(owned: NativeProcess[], signal: NodeJS.Signals): Promise<void> {
    const groups = new Set<number>();
    for (const original of [...owned].sort((left, right) => Number(left.pid === this.pid) - Number(right.pid === this.pid))) {
      let current: NativeProcess | undefined;
      try { current = await nativeProcess(original.pid); } catch { continue; }
      if (!current || current.started !== original.started || !processLive(current) || current.pid === process.pid) continue;
      if (current.group > 1 && !groups.has(current.group)) {
        groups.add(current.group);
        try { process.kill(-current.group, signal); continue; } catch { /* Retry the verified member only. */ }
      }
      try { process.kill(current.pid, signal); } catch { /* Exited or inaccessible: do not claim a release. */ }
    }
  }
}

type ServerMessage =
  | { type: 'ready'; session: TerminalSession; sessions?: TerminalSession[]; cols: number; rows: number; truncated: boolean; flowControl?: boolean;
      replay: { historyLines: number; historyLimit: number } }
  | { type: 'output'; data: string; sequence?: number; respond?: boolean }
  | { type: 'replay-complete'; state: TerminalReplayState; pending: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'exit'; exitCode: number }
  | { type: 'clear' }
  | { type: 'pong'; id: string }
  | { type: 'error'; message: string };

/** Start from an allowlist: deployment, provider, GitHub and proxy credentials never reach shells. */
export async function createTerminalEnvironment(config: Pick<AppConfig, 'dataDir' | 'homeDir' | 'runtimeDir'>, terminalId: string): Promise<Record<string, string>> {
  await prepareRuntimeStorage(config);
  const environment = runtimeEnvironment(config);
  const homeDir = config.homeDir;
  // Runtime paths are created through the canonical, no-follow preparation
  // above. Only user setup and persistent state are initialized under HOME.
  await Promise.all(['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'HF_HOME', 'CARGO_HOME', 'RUSTUP_HOME']
    .map(key => mkdir(environment[key], { recursive: true, mode: 0o700 })));
  const historyDir = path.join(homeDir, '.local', 'state', 'terminal-history');
  await mkdir(historyDir, { recursive: true, mode: 0o700 });
  // Install a small, editable default once. Never overwrite a user's shell setup.
  await writeFile(path.join(homeDir, '.bashrc'), [
    '# Interactive terminal settings. Edit this file to customize your shell.',
    "PS1='\\[\\e[38;5;110m\\]\\W\\[\\e[0m\\] \\$ '",
    'shopt -s histappend',
    "PROMPT_COMMAND='history -a'",
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });

  return {
    PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    LANG: process.env.LANG || 'C.UTF-8',
    ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}),
    ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...environment,
    HISTFILE: path.join(historyDir, `${terminalId}.history`),
    HISTSIZE: '5000',
    HISTFILESIZE: '10000',
    HISTCONTROL: 'ignoreboth',
    // Flush each command to the durable home instead of waiting for the process to exit.
    PROMPT_COMMAND: 'history -a',
    PS1: '\\[\\e[38;5;110m\\]\\w\\[\\e[0m\\] \\$ ',
  };
}

function chooseShell(): { shell: string; args: string[]; name: string } {
  for (const shell of ['/bin/bash', '/usr/bin/bash']) {
    try {
      accessSync(shell, constants.X_OK);
      return { shell, args: ['--noprofile', '-i'], name: 'bash' };
    } catch { /* Try the next available host shell. */ }
  }
  return { shell: '/bin/sh', args: ['-i'], name: 'sh' };
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  const payload = JSON.stringify(message);
  const authorization = authorizations.get(socket);
  if (authorization) authorization.send(payload);
  else transmit(socket, payload);
}

function finishSocket(socket: WebSocket, code: number, reason: string): void {
  const authorization = authorizations.get(socket);
  if (authorization) authorization.finish(code, reason);
  else socket.close(code, reason);
}

function integerSize(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

class TerminalManager {
  readonly sessions = new Map<string, SessionState>();
  private readonly activities = new Map<string, SessionState>();
  private readonly numbering = new Map<string, number>();
  private readonly pending = new Map<string, number>();
  private readonly opening = new Map<string, Promise<unknown>>();
  private environment?: Promise<Record<string, string>>;
  private lifecycle?: Promise<void>;
  private cleanupTimer?: ReturnType<typeof setTimeout>;
  private cleanupInterval = PROCESS_CLEANUP_INTERVAL_MS;
  private shutdownSignal?: NodeJS.Signals;
  private closed = false;
  private closing?: Promise<void>;

  constructor(private readonly ctx: AppContext) {}

  async list(workspaceId: string, existingOnly = false): Promise<TerminalSession[]> {
    if (existingOnly) await this.existingWorkspace(workspaceId);
    else await this.ctx.workspaces.get(workspaceId);
    return [...this.sessions.values()]
      .filter((session) => session.info.workspaceId === workspaceId)
      .map((session) => ({ ...session.info }));
  }

  private async existingWorkspace(workspaceId: string): Promise<void> {
    // Retained metadata can authorize access to an already-owned PTY, never
    // resolve a cwd or admit a new shell. Active-only registries fail closed.
    const workspaces = this.ctx.workspaces;
    if (typeof workspaces.getRegistration === 'function') await workspaces.getRegistration(workspaceId, { includeArchived: true });
    else await workspaces.get(workspaceId);
  }

  async existing(workspaceId: string, sessionId: string, available?: () => boolean, authorize?: () => Promise<boolean>): Promise<TerminalSession> {
    const session = this.sessions.get(sessionId);
    if (!session || session.info.workspaceId !== workspaceId) throw new HttpError(404, 'Terminal not found.');
    await this.existingWorkspace(workspaceId);
    if (authorize && !await authorize()) throw new HttpError(409, 'Terminal connection was cancelled.');
    if ((available && !available()) || this.closed) throw new HttpError(409, 'Terminal connection was cancelled.');
    // An awaited registration/auth check may race closing the tab. Never fall
    // back to another session or a replacement shell for a stale recovery ID.
    if (this.sessions.get(sessionId) !== session) throw new HttpError(404, 'Terminal not found.');
    return { ...session.info };
  }

  private prepareEnvironment(): Promise<Record<string, string>> {
    // Native bucket metadata is slower than memory. Initialize shared HOME once,
    // then let each interactive shell read the user's current .bashrc normally.
    if (!this.environment) {
      this.environment = createTerminalEnvironment(this.ctx.config, 'shared').catch((error: unknown) => {
        this.environment = undefined;
        throw error;
      });
    }
    return this.environment;
  }

  async create(workspaceId: string, options?: { id?: string; cols?: number; rows?: number; available?: () => boolean; authorize?: () => Promise<boolean>; releaseActivity?: () => void }): Promise<TerminalSession> {
    if (this.closed) throw new HttpError(503, 'Terminal service is shutting down.');
    const pendingForWorkspace = this.pending.get(workspaceId) ?? 0;
    const existing = [...this.sessions.values()].filter((session) => session.info.workspaceId === workspaceId);
    const totalPending = [...this.pending.values()].reduce((sum, value) => sum + value, 0);
    if (existing.length + pendingForWorkspace >= MAX_WORKSPACE_SESSIONS || this.sessions.size + totalPending >= MAX_SESSIONS || this.activities.size + totalPending >= MAX_CONNECTIONS) {
      throw new HttpError(409, 'Close an existing terminal before opening another.', 'TERMINAL_LIMIT');
    }
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId)) throw new HttpError(404, 'Workspace not found.');
    // Synchronous admission precedes every path lookup, environment setup and
    // spawn, so native worktree removal cannot pass its fence during startup.
    const releaseActivity = options?.releaseActivity ?? acquireWorkspaceActivity(this.ctx.config.workspacesDir, workspaceId, 'terminal');
    let admitted = false;
    this.pending.set(workspaceId, pendingForWorkspace + 1);
    try {
      let workspaceRoot: string;
      try { workspaceRoot = await this.ctx.workspaces.resolvePath(workspaceId, ''); }
      catch (error) {
        if ((error instanceof HttpError && error.code === 'WORKSPACE_DIRECTORY_MISSING') || (error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new HttpError(409, 'The workspace directory is unavailable.');
        }
        throw error;
      }
      const directory = await stat(workspaceRoot).catch(() => null);
      if (!directory?.isDirectory()) throw new HttpError(409, 'The workspace directory is unavailable.');
      const id = options?.id ?? randomUUID();
      const marker = randomUUID();
      const env = await this.prepareEnvironment();
      const { shell, args, name } = chooseShell();
      if (this.closed) throw new HttpError(503, 'Terminal service is shutting down.');
      if (options?.authorize && !await options.authorize()) throw new HttpError(409, 'Terminal connection was cancelled.');
      if (options?.available && !options.available()) throw new HttpError(409, 'Terminal connection was cancelled.');
      const cols = options?.cols ?? 100;
      const rows = options?.rows ?? 28;
      let liveSession: SessionState | undefined;
      const replay = new TerminalReplay(cols, rows, () => { if (liveSession) this.flow(liveSession); }, TERMINAL_HISTORY_LINES, data => {
        if (!liveSession || liveSession.removed || liveSession.info.exited || data.length > MAX_INPUT_CHARACTERS) return;
        try { liveSession.process.write(data); } catch { /* The native PTY can exit during its final query. */ }
      });
      // The history file is stable across new shells and full instance restarts.
      // Hashing also keeps arbitrary workspace names out of filesystem paths.
      const historyName = createHash('sha256').update(workspaceId).digest('hex').slice(0, 32);
      let shellProcess: pty.IPty;
      try {
        shellProcess = pty.spawn(shell, args, {
          name: 'xterm-256color', cwd: workspaceRoot,
          env: { ...env, ...gitWorkspaceEnvironment(workspaceRoot), SHELL: shell, CODEX_TERMINAL_ACTIVITY: marker,
            HISTFILE: path.join(this.ctx.config.homeDir, '.local', 'state', 'terminal-history', `${historyName}.history`) },
          cols, rows,
        });
      } catch (error) {
        replay.dispose();
        const failure = new HttpError(503, 'The host shell could not start. Please try again.', 'PTY_UNAVAILABLE');
        failure.cause = error;
        throw failure;
      }
      const number = (this.numbering.get(workspaceId) ?? 0) + 1;
      this.numbering.set(workspaceId, number);
      const info: TerminalSession = {
        id, workspaceId, title: `${name} ${number}`, createdAt: new Date().toISOString(), pid: shellProcess.pid,
      };
      const session: SessionState = {
        info, process: shellProcess, clients: new Map(),
        replay, outputSequence: 0, replyOwners: new Map(),
        cols, rows, paused: false,
        activity: new TerminalActivity(shellProcess.pid, marker, releaseActivity),
      };
      liveSession = session;
      this.activities.set(id, session);
      admitted = true;
      this.sessions.set(id, session);
      shellProcess.onData((data) => {
        if (session.removed) return;
        if (session.drainingExit) session.drainingExit.bytes += Buffer.byteLength(data);
        session.replay.write(data, ![...session.clients.keys()].some(client => client.readyState === WebSocket.OPEN));
        // Unique frames keep a query from being answered by every attached
        // browser. The server emulator answers only output emitted while detached.
        for (let offset = 0; offset < data.length;) {
          const end = terminalChunkEnd(data, offset);
          const message: ServerMessage = { type: 'output', data: data.slice(offset, end), sequence: ++session.outputSequence };
          for (const [client, state] of session.clients) this.enqueue(session, client, state, message);
          offset = end;
        }
        this.flow(session);
      });
      shellProcess.onExit(({ exitCode }) => {
        clearInterval(session.exitWatch);
        session.exitWatch = undefined;
        clearTimeout(session.drainingExit?.timer);
        session.info.exited = true;
        session.exitCode = exitCode;
        if (session.forceKill) clearTimeout(session.forceKill);
        this.scheduleCleanup(true);
        for (const [client, state] of session.clients) {
          state.exitQueued = true;
          this.enqueue(session, client, state, { type: 'exit', exitCode });
        }
        // An unrestricted shell can leave native jobs alive after its PTY exits.
        // Only verified lifecycle cleanup may release activity and emit an end.
        this.ctx.events.emit('workspace:changed', { workspaceId });
      });
      return { ...info };
    } finally {
      if (!admitted) releaseActivity();
      const remaining = (this.pending.get(workspaceId) ?? 1) - 1;
      if (remaining > 0) this.pending.set(workspaceId, remaining);
      else this.pending.delete(workspaceId);
    }
  }

  /** Open/resume in one upgrade. A stable request ID makes retries idempotent. */
  async open(workspaceId: string, options: OpenOptions, available: () => boolean, authorize?: () => Promise<boolean>): Promise<TerminalSession> {
    if (this.closed) throw new HttpError(503, 'Terminal service is shutting down.');
    if (options.existingOnly) {
      if (!options.sessionId || options.fresh) throw new HttpError(400, 'Choose an existing terminal to reconnect.');
      return this.existing(workspaceId, options.sessionId, available, authorize);
    }
    const releaseActivity = acquireWorkspaceActivity(this.ctx.config.workspacesDir, workspaceId, 'terminal');
    let retained = false;
    const previous = this.opening.get(workspaceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      await this.ctx.workspaces.get(workspaceId);
      if (authorize && !await authorize()) throw new HttpError(409, 'Terminal connection was cancelled.');
      if (!available() || this.closed) throw new HttpError(409, 'Terminal connection was cancelled.');
      const requested = this.sessions.get(options.requestId);
      if (requested && requested.info.workspaceId !== workspaceId) throw new HttpError(409, 'Invalid terminal request.');
      if (requested) return { ...requested.info };
      if (!options.fresh) {
        const existing = options.sessionId ? this.sessions.get(options.sessionId) : undefined;
        if (existing && existing.info.workspaceId !== workspaceId) throw new HttpError(404, 'Terminal not found.');
        const session = existing ?? (!options.sessionId ? [...this.sessions.values()].find((item) => item.info.workspaceId === workspaceId && !item.info.exited) : undefined);
        if (session) return { ...session.info };
      }
      const created = await this.create(workspaceId, { id: options.requestId, cols: options.cols, rows: options.rows, available, authorize, releaseActivity });
      retained = true;
      return created;
    });
    this.opening.set(workspaceId, operation);
    try { return await operation; }
    finally {
      if (!retained) releaseActivity();
      if (this.opening.get(workspaceId) === operation) this.opening.delete(workspaceId);
    }
  }

  private output(session: SessionState, socket: WebSocket, state: ClientState, message: Extract<ServerMessage, { type: 'output' }>): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (state.flowControl) {
      state.pendingCharacters += message.data.length;
      if (state.frameControl) state.pendingFrames.push(message.data.length);
      if (message.sequence === undefined) state.replayUnacknowledged += message.data.length;
    }
    recordOutputProgress(state);
    let respond = false;
    if (message.sequence !== undefined) {
      // A single viewer owns replies for a particular output frame, even if
      // another window catches up later. Do not replay already-consumed queries.
      if (!session.replyOwners.has(message.sequence)) session.replyOwners.set(message.sequence, socket);
      respond = session.replyOwners.get(message.sequence) === socket;
      while (session.replyOwners.size > 512) session.replyOwners.delete(session.replyOwners.keys().next().value!);
    }
    send(socket, { ...message, ...(message.sequence !== undefined ? { respond } : {}) });
  }

  private enqueue(session: SessionState, socket: WebSocket, state: ClientState, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    const characters = message.type === 'output' ? message.data.length : 0;
    if (state.queuedCharacters + characters > MAX_CLIENT_BUFFER || state.queue.length >= 2048) {
      socket.close(1013, 'Terminal output is moving too quickly. Reconnect to resume.');
      session.clients.delete(socket);
      return;
    }
    state.queue.push(message);
    state.queuedCharacters += characters;
    if (message.type === 'output') state.queuedFrames++;
    recordOutputProgress(state);
    this.drainClient(session, socket, state);
  }

  private drainClient(session: SessionState, socket: WebSocket, state: ClientState): void {
    if (state.draining || state.preparing || socket.readyState !== WebSocket.OPEN) return;
    state.draining = true;
    try {
      while (socket.readyState === WebSocket.OPEN && (!state.flowControl || state.pendingCharacters < OUTPUT_HIGH_WATERMARK
        && (!state.frameControl || state.pendingFrames.length < OUTPUT_HIGH_FRAMES))) {
        if (state.replay) {
          const snapshot = state.replay;
          if (state.replayOffset < snapshot.data.length) {
            const end = terminalChunkEnd(snapshot.data, state.replayOffset);
            this.output(session, socket, state, { type: 'output', data: snapshot.data.slice(state.replayOffset, end) });
            state.replayOffset = end;
            continue;
          }
          send(socket, { type: 'replay-complete', state: snapshot.state, pending: snapshot.pending });
          state.replay = undefined;
        }
        const message = state.queue.shift();
        if (!message) break;
        if (message.type === 'output') {
          state.queuedCharacters -= message.data.length;
          state.queuedFrames--;
          this.output(session, socket, state, message);
        } else {
          send(socket, message);
          if (message.type === 'exit') { finishSocket(socket, 1000, 'Shell exited'); break; }
        }
      }
    } finally { state.draining = false; }
  }

  private flow(session: SessionState): void {
    let clients = [...session.clients].filter(([socket, state]) => socket.readyState === WebSocket.OPEN && state.flowControl);
    let blocked = clients.filter(([, state]) => outputPressure(state, OUTPUT_HIGH_WATERMARK, OUTPUT_HIGH_FRAMES));
    // A stalled second window must not hold up another window consuming the
    // same PTY. Disconnect the lagging viewer; its shell and bounded replay live on.
    const hasResponsiveViewer = [...session.clients].some(([socket, state]) => socket.readyState === WebSocket.OPEN
      && (!state.flowControl || !outputPressure(state, OUTPUT_LOW_WATERMARK, OUTPUT_LOW_FRAMES)));
    if (blocked.length && hasResponsiveViewer) {
      for (const [socket, state] of blocked) {
        // A large current screen may legitimately fill the replay window.
        // Keep its bounded window open while it parses; evict only if newer
        // live output itself falls a full window behind the responsive viewer.
        if (state.pendingCharacters - state.replayUnacknowledged + state.queuedCharacters < OUTPUT_HIGH_WATERMARK
          && (!state.frameControl || state.pendingFrames.length + state.queuedFrames < OUTPUT_HIGH_FRAMES)) continue;
        session.clients.delete(socket);
        socket.close(1013, 'Terminal output is moving too quickly. Reconnect to resume.');
      }
      clients = clients.filter(([socket]) => session.clients.has(socket));
      blocked = [];
    }
    const drainingExit = session.drainingExit && performance.now() < session.drainingExit.until
      && session.drainingExit.bytes < EXIT_DRAIN_MAX_BYTES;
    const shouldPause = (!drainingExit && blocked.length > 0)
      || session.replay.pendingCharacters >= TERMINAL_PARSE_HIGH || session.replay.pendingFrames >= TERMINAL_PARSE_HIGH_FRAMES;
    if (shouldPause && !session.paused && !session.info.exited) {
      session.process.pause();
      session.paused = true;
      this.watchPausedExit(session);
    } else if (session.paused && session.replay.pendingCharacters < TERMINAL_PARSE_LOW && session.replay.pendingFrames < TERMINAL_PARSE_LOW_FRAMES
      && (drainingExit || hasResponsiveViewer || !clients.length || clients.every(([, state]) => !outputPressure(state, OUTPUT_LOW_WATERMARK, OUTPUT_LOW_FRAMES)))) {
      session.process.resume();
      session.paused = false;
      clearInterval(session.exitWatch);
      session.exitWatch = undefined;
    }
  }

  private watchPausedExit(session: SessionState): void {
    if (session.exitWatch || session.drainingExit) return;
    session.exitWatch = setInterval(() => {
      if (!session.paused || session.removed || session.info.exited) {
        clearInterval(session.exitWatch); session.exitWatch = undefined;
        return;
      }
      try { process.kill(session.info.pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return;
        clearInterval(session.exitWatch); session.exitWatch = undefined;
        // A descendant may still hold the TTY. This exception lasts at most
        // 150 ms / 256 KiB (+ one native read), preserving parser/queue bounds.
        // It never releases the activity guard or signals any descendant.
        session.drainingExit = { until: performance.now() + EXIT_DRAIN_MAX_MS, bytes: 0, timer: setTimeout(() => {
          if (!session.removed && !session.info.exited) this.flow(session);
        }, EXIT_DRAIN_MAX_MS) };
        session.drainingExit.timer.unref();
        this.flow(session);
      }
    }, PAUSED_EXIT_CHECK_MS);
    session.exitWatch.unref();
  }

  checkSlowClients(): void {
    for (const session of this.sessions.values()) {
      for (const [socket, state] of session.clients) {
        recordOutputProgress(state);
        if (state.pressuredAt !== null && Date.now() - state.pressuredAt > 30_000) {
          socket.close(1013, 'Terminal output paused too long. Reconnect to resume.');
          session.clients.delete(socket);
        }
      }
      this.flow(session);
    }
  }

  connect(id: string, socket: WebSocket, authorization: TerminalAuthorization, flowControl = false, includeSessions = false, frameControl = false): void {
    const session = this.sessions.get(id);
    if (!session || this.closed) {
      socket.close(1008, 'Terminal is no longer available');
      return;
    }
    const state: ClientState = { flowControl, frameControl, pendingCharacters: 0, pendingFrames: [], replayUnacknowledged: 0, pressuredAt: null, preparing: true,
      replayOffset: 0, queue: [], queuedCharacters: 0, queuedFrames: 0, draining: false };
    session.clients.set(socket, state);
    // Attach before requesting the parser barrier. The snapshot includes only
    // earlier data; later output is queued once and follows replay-complete.
    void session.replay.snapshot().then(snapshot => {
      if (socket.readyState !== WebSocket.OPEN || session.clients.get(socket) !== state || session.removed) return;
      send(socket, { type: 'ready', session: { ...session.info }, cols: snapshot.cols, rows: snapshot.rows, truncated: snapshot.truncated,
        replay: { historyLines: snapshot.historyLines, historyLimit: snapshot.historyLimit },
        ...(includeSessions ? { sessions: [...this.sessions.values()].filter((item) => item.info.workspaceId === session.info.workspaceId).map((item) => ({ ...item.info })) } : {}),
        ...(flowControl ? { flowControl: true } : {}),
      });
      state.preparing = false; state.replay = snapshot;
      if (session.info.exited && !state.exitQueued) {
        state.exitQueued = true; state.queue.push({ type: 'exit', exitCode: session.exitCode ?? 0 });
      }
      this.drainClient(session, socket, state);
      this.flow(session);
    }).catch(error => {
      if (socket.readyState !== WebSocket.OPEN) return;
      send(socket, { type: 'error', message: error instanceof Error ? error.message : 'The terminal could not restore its current screen.' });
      finishSocket(socket, 1013, 'Terminal restoration is temporarily unavailable');
    });
    authorization.listen((data: RawData, isBinary: boolean) => {
      if (isBinary) {
        socket.close(1008, 'Terminal messages must be JSON text');
        return;
      }
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(data.toString());
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid message');
        message = parsed as Record<string, unknown>;
      } catch {
        socket.close(1008, 'Invalid terminal message');
        return;
      }
      try {
        if (message.type === 'input' || message.type === 'binary' || message.type === 'reply') {
          if (typeof message.data !== 'string' || message.data.length > MAX_INPUT_CHARACTERS) {
            socket.close(1008, 'Terminal input is too large or invalid');
            return;
          }
          if (message.type === 'binary' && /[^\u0000-\u00ff]/.test(message.data)) {
            socket.close(1008, 'Invalid terminal binary input');
            return;
          }
          if (message.type === 'reply' && (!integerSize(message.sequence, 1, Number.MAX_SAFE_INTEGER)
            || session.replyOwners.get(message.sequence) !== socket)) return;
          if (!session.info.exited) {
            // Record before writing to the PTY, so a new review group cannot
            // capture resulting human writes before seeing this session's marker.
            if (message.type !== 'reply') this.ctx.events.emit('workspace:user-terminal', { workspaceId: session.info.workspaceId, sessionId: session.info.id });
            session.process.write(message.type === 'binary' ? Buffer.from(message.data, 'latin1') : message.data);
          }
        } else if (message.type === 'resize') {
          if (!integerSize(message.cols, 2, 500) || !integerSize(message.rows, 1, 300)) {
            send(socket, { type: 'error', message: 'Invalid terminal size.' });
            return;
          }
          if (session.cols !== message.cols || session.rows !== message.rows) {
            session.replay.resize(message.cols, message.rows);
            session.cols = message.cols;
            session.rows = message.rows;
            for (const [client, next] of session.clients) this.enqueue(session, client, next, { type: 'resize', cols: message.cols, rows: message.rows });
            if (!session.info.exited) session.process.resize(message.cols, message.rows);
          }
        } else if (message.type === 'ack' && state.flowControl) {
          if (!integerSize(message.characters, 1, state.pendingCharacters)) {
            socket.close(1008, 'Invalid terminal acknowledgement');
            return;
          }
          state.pendingCharacters -= message.characters;
          if (state.frameControl) {
            let consumed = message.characters;
            while (consumed > 0) {
              const characters = state.pendingFrames[0];
              if (characters <= consumed) { state.pendingFrames.shift(); consumed -= characters; }
              else { state.pendingFrames[0] -= consumed; consumed = 0; }
            }
          }
          state.replayUnacknowledged = Math.max(0, state.replayUnacknowledged - message.characters);
          recordOutputProgress(state, true);
          this.drainClient(session, socket, state);
          this.flow(session);
        } else if (message.type === 'ping' && typeof message.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(message.id)) {
          send(socket, { type: 'pong', id: message.id });
        } else if (message.type === 'clear') {
          void session.replay.clear().catch(() => undefined);
          for (const [client, next] of session.clients) this.enqueue(session, client, next, { type: 'clear' });
          if (!session.info.exited) session.process.write('\x0c');
        } else {
          send(socket, { type: 'error', message: 'Unknown terminal action.' });
        }
      } catch (error) {
        send(socket, { type: 'error', message: error instanceof HttpError ? error.message : 'This shell is no longer accepting input.' });
      }
    });
    const detach = () => {
      session.clients.delete(socket);
      state.replay = undefined; state.queue = []; state.queuedCharacters = 0; state.queuedFrames = 0; state.pendingFrames = [];
      this.flow(session);
    };
    socket.on('close', detach);
    socket.on('error', detach);
  }

  remove(id: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new HttpError(404, 'Terminal not found.');
    this.sessions.delete(id);
    session.removed = true;
    clearInterval(session.exitWatch);
    session.exitWatch = undefined;
    clearTimeout(session.drainingExit?.timer);
    session.replay.dispose();
    session.replyOwners.clear();
    for (const client of session.clients.keys()) client.close(1000, 'Terminal closed');
    session.clients.clear();
    void this.stop(session);
    this.ctx.events.emit('workspace:changed', { workspaceId: session.info.workspaceId });
  }

  private stop(session: SessionState): Promise<void> {
    if (session.stopping) return session.stopping;
    session.stopping = (async () => {
      // Capture still-visible ancestry before sending the shell a hangup.
      // Detached work remains guarded until it ends, even after its tab closes.
      await this.sweepActivities();
      if (session.info.exited) { this.scheduleCleanup(true); return; }
      if (session.paused) { session.process.resume(); session.paused = false; }
      try { session.process.kill('SIGHUP'); } catch { /* The shell may already have exited. */ }
      session.forceKill = setTimeout(() => {
        if (!session.info.exited) {
          try { session.process.kill('SIGKILL'); } catch { /* Already stopped. */ }
        }
        this.scheduleCleanup(true);
      }, 1500);
      session.forceKill.unref();
    })();
    // Killing the shell PID does not prove all work ended; only the lifecycle
    // guard below may release its activity lease and emit terminal-end.
    return session.stopping;
  }

  private scheduleCleanup(reset = false): void {
    if (reset) { this.cleanupInterval = PROCESS_CLEANUP_INTERVAL_MS; clearTimeout(this.cleanupTimer); this.cleanupTimer = undefined; }
    if (this.closed || this.cleanupTimer || ![...this.activities.values()].some((session) => session.info.exited || session.stopping)) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = undefined;
      void this.sweepActivities();
    }, this.cleanupInterval);
    this.cleanupTimer.unref();
  }

  private sweepActivities(): Promise<void> {
    if (!this.lifecycle) {
      const work = (async () => {
        const scan = await scanProcesses();
        let progressing = false;
        const roots = new Map<number, string>();
        for (const session of this.activities.values()) {
          await session.activity.initialized;
          const root = session.activity.rootIdentity();
          if (root) roots.set(root.pid, root.started);
        }
        for (const [id, session] of this.activities) {
          if (!session.info.exited && !session.stopping && !this.closed) continue;
          const others = new Map(roots); others.delete(session.info.pid);
          const { owned, uncertain } = await session.activity.inspect(scan, others);
          if (this.shutdownSignal) await session.activity.signalOwned(owned, this.shutdownSignal);
          if (session.info.exited && !owned.length && !uncertain) progressing = true;
          if (session.activity.confirmEnded(Boolean(session.info.exited), owned, uncertain)) {
            this.activities.delete(id);
            this.ctx.events.emit('workspace:user-terminal-end', { workspaceId: session.info.workspaceId, sessionId: session.info.id });
            this.ctx.events.emit('workspace:changed', { workspaceId: session.info.workspaceId });
          }
        }
        this.cleanupInterval = progressing ? PROCESS_CLEANUP_INTERVAL_MS : Math.min(PROCESS_CLEANUP_MAX_INTERVAL_MS, this.cleanupInterval * 2);
      })();
      this.lifecycle = work;
      void work.catch(() => undefined).finally(() => {
        if (this.lifecycle === work) this.lifecycle = undefined;
        this.scheduleCleanup();
      });
    }
    // A slow or unavailable /proc never releases a lease or blocks shutdown
    // forever. Keep the original job until it settles instead of spawning scans.
    const work = this.lifecycle;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PROCESS_SCAN_TIMEOUT_MS); timer.unref();
      void work.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = Promise.resolve().then(() => this.finishClose());
    return this.closing;
  }

  private async finishClose(): Promise<void> {
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.shutdownSignal = 'SIGTERM';
    const processes = [...this.activities.values()];
    const retained = new Set([...this.sessions.values(), ...processes]);
    this.sessions.clear();
    for (const session of retained) {
      session.removed = true;
      clearInterval(session.exitWatch);
      session.exitWatch = undefined;
      clearTimeout(session.drainingExit?.timer);
      session.replay.dispose();
      session.replyOwners.clear();
      for (const client of session.clients.keys()) client.terminate();
      session.clients.clear();
    }
    await Promise.allSettled(processes.map((session) => this.stop(session)));
    this.shutdownSignal = 'SIGKILL';
    const deadline = performance.now() + 2500;
    while (this.activities.size && performance.now() < deadline) {
      await this.sweepActivities();
      if (this.activities.size) await new Promise<void>((resolve) => setTimeout(resolve, 35));
    }
    // Uncertain ownership deliberately retains the process-local lease. A fresh
    // Node process does not prove that escaped native jobs ended; only full host
    // teardown or an authoritative cleanup can establish that across restarts.
  }
}

function managerFor(ctx: AppContext): TerminalManager {
  let manager = managers.get(ctx);
  if (!manager) { manager = new TerminalManager(ctx); managers.set(ctx, manager); }
  return manager;
}

export function createTerminalRouter(ctx: AppContext): Router {
  const router = Router();
  const manager = managerFor(ctx);
  router.get('/workspaces/:id/terminals', async (req, res) => {
    if (req.query.existingOnly !== undefined && req.query.existingOnly !== '1') throw new HttpError(400, 'Invalid terminal recovery option.');
    res.json(await manager.list(String(req.params.id), req.query.existingOnly === '1'));
  });
  router.post('/workspaces/:id/terminals', async (req, res) => {
    res.status(201).json(await manager.create(String(req.params.id)));
  });
  router.delete('/terminals/:id', (req, res) => {
    manager.remove(String(req.params.id));
    res.json({ ok: true });
  });
  return router;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  // HTTP no longer owns an upgraded transport. End alone leaves an attacker
  // with a half-open socket that closeAllConnections() does not clean up.
  const onError = () => socket.destroy();
  const deadline = setTimeout(() => socket.destroy(), 1000);
  deadline.unref();
  socket.on('error', onError);
  socket.once('close', () => { clearTimeout(deadline); socket.off('error', onError); });
  try {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
  } catch { socket.destroy(); }
}

/** A browser disconnect leaves its shell alive; closing this handle shuts down every PTY. */
export function attachTerminalServer(
  server: Server,
  ctx: AppContext,
  authenticateUpgrade: UpgradeAuthenticator,
  authorizationOptions: TerminalAuthorizationOptions = {},
): { close: () => Promise<void> } {
  const maxAgeMs = authorizationOptions.maxAgeMs ?? AUTHORIZATION_MAX_AGE_MS;
  const timeoutMs = authorizationOptions.timeoutMs ?? Math.min(AUTHORIZATION_TIMEOUT_MS, maxAgeMs);
  if (!integerSize(maxAgeMs, 50, AUTHORIZATION_MAX_AGE_MS) || !integerSize(timeoutMs, 10, Math.min(AUTHORIZATION_TIMEOUT_MS, maxAgeMs))) {
    throw new Error('Terminal authorization timing exceeds its allowed bounds.');
  }
  const manager = managerFor(ctx);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  const living = new Map<WebSocket, { alive: boolean; authorization: TerminalAuthorization }>();
  const pending = new Map<Duplex, { check?: AuthorizationCheck }>();
  let authenticationVersion = 0;
  let closed = false;
  let closing: Promise<void> | undefined;

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void (async () => {
      let url: URL;
      try { url = new URL(request.url || '/', 'http://localhost'); }
      catch { rejectUpgrade(socket, 400, 'Bad Request'); return; }
      const requestPath = url.pathname;
      const direct = requestPath === '/ws/terminal';
      if (authorizationOptions.devHmrPath === '/__codex_dev_hmr' && requestPath === authorizationOptions.devHmrPath
        && ['vite-hmr', 'vite-ping'].includes(request.headers['sec-websocket-protocol'] ?? '')) return;
      if (!direct && !requestPath.startsWith('/ws/terminal/')) { rejectUpgrade(socket, 404, 'Not Found'); return; }
      if (closed) { rejectUpgrade(socket, 503, 'Service Unavailable'); return; }
      if (living.size + pending.size >= MAX_CONNECTIONS) { rejectUpgrade(socket, 429, 'Too Many Requests'); return; }
      const pendingState: { check?: AuthorizationCheck } = {};
      pending.set(socket, pendingState);
      const cancel = () => { pendingState.check?.cancel(); pending.delete(socket); };
      const ignoreSocketError = () => { cancel(); };
      const endBeforeUpgrade = () => { cancel(); socket.destroy(); };
      const readBeforeUpgrade = () => {
        // Observe EOF while awaiting authority. Without consuming readiness,
        // an upgraded HTTP socket can hide a peer's FIN until handleUpgrade.
        // Further bytes before the handshake are not accepted as terminal input.
        if (socket.readableLength) { endBeforeUpgrade(); return; }
        socket.read(0);
      };
      socket.once('close', cancel);
      socket.once('end', endBeforeUpgrade);
      socket.on('readable', readBeforeUpgrade);
      socket.on('error', ignoreSocketError);
      socket.read(0);
      const verifyUpgrade = async () => {
        const version = authenticationVersion;
        const check = checkAuthorization(request, authenticateUpgrade, timeoutMs);
        pendingState.check = check;
        const result = await check.result;
        if (pendingState.check === check) pendingState.check = undefined;
        return { ...result, version };
      };
      try {
        const initial = await verifyUpgrade();
        if (socket.destroyed || closed) return;
        if (initial.status !== 'allowed' || initial.version !== authenticationVersion) { rejectUpgrade(socket, 401, 'Unauthorized'); return; }
        const flowControl = url.searchParams.get('flow') === '1';
        // Opt in separately: older flow=1 clients acknowledge only after 16 KiB
        // and cannot release a smaller window without short-frame acknowledgements.
        const frameControl = flowControl && url.searchParams.get('frames') === '1';
        if (url.searchParams.has('frames') && !frameControl) { rejectUpgrade(socket, 400, 'Bad Request'); return; }
        const existingOnlyValue = url.searchParams.get('existingOnly');
        const existingOnly = existingOnlyValue === '1';
        if (existingOnlyValue !== null && !existingOnly) { rejectUpgrade(socket, 400, 'Bad Request'); return; }
        let workspaceId: string | undefined;
        let options: OpenOptions | undefined;
        if (direct) {
          workspaceId = url.searchParams.get('workspaceId') ?? '';
          const requestId = url.searchParams.get('requestId') ?? '';
          const sessionId = url.searchParams.get('sessionId') || undefined;
          const cols = Number(url.searchParams.get('cols') ?? '100');
          const rows = Number(url.searchParams.get('rows') ?? '28');
          const newValue = url.searchParams.get('new');
          if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId) || !/^[a-f0-9-]{36}$/.test(requestId)
            || (sessionId && !/^[a-f0-9-]{36}$/.test(sessionId)) || !integerSize(cols, 2, 500) || !integerSize(rows, 1, 300)
            || (newValue !== null && newValue !== '1') || (url.searchParams.has('flow') && !flowControl)
            || (existingOnly && (!sessionId || newValue !== null))) {
            rejectUpgrade(socket, 400, 'Bad Request'); return;
          }
          options = { requestId, sessionId, fresh: newValue === '1', existingOnly, cols, rows };
        }
        const match = /^\/ws\/terminal\/([a-f0-9-]{36})$/.exec(requestPath);
        const knownSessionId = direct && existingOnly ? options!.sessionId : match?.[1];
        const session = knownSessionId ? manager.sessions.get(knownSessionId) : undefined;
        if (!direct || existingOnly) {
          if (!session) { rejectUpgrade(socket, 404, 'Not Found'); return; }
          try { await manager.existing(workspaceId ?? session.info.workspaceId, session.info.id); }
          catch { rejectUpgrade(socket, 404, 'Not Found'); return; }
        }
        if (socket.destroyed || closed) return;
        // Await a fresh signed-session/Origin proof after asynchronous lookup and
        // reject a proof that raced a same-process logout event.
        const final = await verifyUpgrade();
        if (socket.destroyed || closed) return;
        if (final.status !== 'allowed' || final.version !== authenticationVersion) { rejectUpgrade(socket, 401, 'Unauthorized'); return; }
        if (session && manager.sessions.get(session.info.id) !== session) { rejectUpgrade(socket, 404, 'Not Found'); return; }
        // ws also enables TCP_NODELAY. Make the no-deliberate-delay policy explicit
        // on the upgraded transport without adding compression or batching timers.
        if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
        socket.off('readable', readBeforeUpgrade);
        socket.off('end', endBeforeUpgrade);
        sockets.handleUpgrade(request, socket, head, (websocket) => {
          const authorization = new TerminalAuthorization(websocket, request, authenticateUpgrade, maxAgeMs, timeoutMs, final);
          authorizations.set(websocket, authorization);
          living.set(websocket, { alive: true, authorization });
          websocket.on('pong', () => { const state = living.get(websocket); if (state) state.alive = true; });
          websocket.on('close', () => living.delete(websocket));
          websocket.on('error', () => living.delete(websocket));
          if (!direct) { manager.connect(session!.info.id, websocket, authorization, flowControl, false, frameControl); return; }
          const available = () => !closed && authorization.valid();
          void manager.open(workspaceId!, options!, available, () => authorization.authorizeAction()).then(async (info) => {
            await authorization.authorizeAction();
            if (!available()) {
              if (websocket.readyState === WebSocket.OPEN) websocket.close(1008, 'Your session has expired. Sign in again.');
              return;
            }
            if (options!.existingOnly && manager.sessions.get(info.id) !== session) {
              send(websocket, { type: 'error', message: 'Terminal not found.' });
              websocket.close(1008, 'Terminal is unavailable');
              return;
            }
            manager.connect(info.id, websocket, authorization, flowControl, true, frameControl);
          }).catch((error: unknown) => {
            if (websocket.readyState !== WebSocket.OPEN) return;
            send(websocket, { type: 'error', message: error instanceof HttpError ? error.message : 'The terminal could not start. Please try again.' });
            websocket.close(1008, 'Terminal is unavailable');
          });
        });
        socket.resume();
      } finally {
        pendingState.check?.cancel();
        pending.delete(socket);
        socket.off('close', cancel);
        socket.off('end', endBeforeUpgrade);
        socket.off('readable', readBeforeUpgrade);
        socket.off('error', ignoreSocketError);
      }
    })().catch(() => rejectUpgrade(socket, 500, 'Internal Server Error'));
  };
  server.on('upgrade', onUpgrade);
  const heartbeat = setInterval(() => {
    manager.checkSlowClients();
    for (const [socket, state] of living) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (!state.alive) { socket.terminate(); living.delete(socket); continue; }
      state.alive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  const closeRevokedSessions = (event?: { hash?: string }): void => {
    authenticationVersion++;
    // Invalidate synchronously. A result started before logout cannot restore
    // access; affected cookies fail the fresh local-revocation check immediately.
    for (const state of pending.values()) state.check?.cancel();
    for (const [socket, state] of living) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (!event?.hash) {
        // The application uses a global logout event during shutdown. Retain
        // PTYs until normal terminal cleanup, but close every socket immediately.
        state.authorization.dispose();
        socket.close(1008, 'Your session has expired. Sign in again.');
      } else state.authorization.invalidate();
    }
  };
  const checkWorkspace = (event: { workspaceId?: string }): void => {
    const workspaceId = event?.workspaceId;
    if (!workspaceId || ![...manager.sessions.values()].some((session) => session.info.workspaceId === workspaceId)) return;
    // Missing-root reconciliation archives metadata without stopping native
    // work. Only a genuinely removed registration invalidates an owned PTY.
    void manager.list(workspaceId, true).catch((error: unknown) => {
      if (!(error instanceof HttpError) || error.status !== 404) return;
      for (const [id, session] of manager.sessions) if (session.info.workspaceId === workspaceId) manager.remove(id);
    });
  };
  ctx.events.on('auth:logout', closeRevokedSessions);
  ctx.events.on('workspace:changed', checkWorkspace);

  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    closing = Promise.resolve().then(async () => {
      clearInterval(heartbeat);
      ctx.events.off('auth:logout', closeRevokedSessions);
      ctx.events.off('workspace:changed', checkWorkspace);
      server.off('upgrade', onUpgrade);
      for (const [socket, state] of pending) { state.check?.cancel(); socket.destroy(); }
      pending.clear();
      for (const socket of sockets.clients) { authorizations.get(socket)?.dispose(); socket.terminate(); }
      living.clear();
      await manager.close();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
    });
    return closing;
  };
  server.once('close', () => { void close().catch(() => undefined); });
  return { close };
}
