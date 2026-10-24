import fs from 'node:fs';
import type { Server } from 'node:net';

export interface BootstrapListenerConfig { fd: number; readyFd: number }

const LISTEN_ENV = 'CODEX_BOOTSTRAP_LISTEN_FD';
const READY_ENV = 'CODEX_BOOTSTRAP_READY_FD';
const READY = Buffer.from('codex-workspace-ready-v1\n');
const CLOEXEC = 0o2000000; // Linux fdinfo includes descriptor close-on-exec flags.

function invalid(): Error { return new Error('The inherited bootstrap listener configuration is invalid.'); }
function validFd(fd: number): boolean { return Number.isSafeInteger(fd) && fd >= 3 && fd <= 0x7fffffff; }

/** Consume these private values before application initialization can spawn children. */
export function consumeBootstrapListenerEnvironment(env: NodeJS.ProcessEnv): BootstrapListenerConfig | undefined {
  const listener = env[LISTEN_ENV];
  const ready = env[READY_ENV];
  delete env[LISTEN_ENV]; delete env[READY_ENV];
  if (listener === undefined && ready === undefined) return undefined;
  if (!listener || !ready || !/^[1-9]\d*$/.test(listener) || !/^[1-9]\d*$/.test(ready)) throw invalid();
  const fd = Number(listener); const readyFd = Number(ready);
  if (!validFd(fd) || !validFd(readyFd) || String(fd) !== listener || String(readyFd) !== ready || fd === readyFd) throw invalid();
  return { fd, readyFd };
}

interface Descriptor {
  fd: number;
  stat: fs.BigIntStats;
}

function sameIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.uid === right.uid;
}

function inspect(fd: number): { descriptor: Descriptor; flags: number; link: string } {
  const stat = fs.fstatSync(fd, { bigint: true });
  const info = fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8');
  const flagsText = /^flags:\s+([0-7]+)$/m.exec(info)?.[1];
  const inode = /^ino:\s+(\d+)$/m.exec(info)?.[1];
  if (!flagsText || !inode || BigInt(inode) !== stat.ino) throw invalid();
  const flags = Number.parseInt(flagsText, 8);
  // Node marks inherited handles close-on-exec before evaluating this module.
  // Retain that boundary even if a caller supplies descriptors programmatically.
  if (!(flags & CLOEXEC) || stat.uid !== BigInt(process.geteuid!())) throw invalid();
  return { descriptor: { fd, stat }, flags, link: fs.readlinkSync(`/proc/self/fd/${fd}`) };
}

function assertUnchanged(descriptor: Descriptor): void {
  if (!sameIdentity(descriptor.stat, fs.fstatSync(descriptor.fd, { bigint: true }))) throw invalid();
}

function assertReadyPipe(descriptor: Descriptor): void {
  const current = inspect(descriptor.fd);
  if (!sameIdentity(descriptor.stat, current.descriptor.stat) || (current.flags & 3) !== fs.constants.O_WRONLY
    || !(current.flags & fs.constants.O_NONBLOCK)) throw invalid();
}

function closeOwned(descriptor: Descriptor | undefined): void {
  if (!descriptor) return;
  let stat: fs.BigIntStats;
  try { stat = fs.fstatSync(descriptor.fd, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EBADF') return; throw error; }
  // A failed start or libuv may already have released this number. Never close
  // a later file that happens to reuse it, including during a long runtime drain.
  if (sameIdentity(descriptor.stat, stat)) fs.closeSync(descriptor.fd);
}

function assertTcpListener(descriptor: Descriptor, port: number): void {
  const inode = String(descriptor.stat.ino);
  for (const table of ['/proc/self/net/tcp', '/proc/self/net/tcp6']) {
    let contents: string;
    try { contents = fs.readFileSync(table, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const listening = contents.split('\n').some(line => {
      const fields = line.trim().split(/\s+/);
      return fields[9] === inode && fields[3] === '0A'
        && Number.parseInt(fields[1]?.split(':')[1] ?? '', 16) === port;
    });
    if (listening) return;
  }
  throw invalid();
}

/** Own only validated child copies; the Python parent's copies remain intact. */
export class BootstrapListener {
  private listener: Descriptor | undefined;
  private readyPipe: Descriptor | undefined;
  private adopted = false;

  constructor(config: BootstrapListenerConfig, private readonly port: number) {
    try {
      if (process.platform !== 'linux' || !validFd(config.fd) || !validFd(config.readyFd) || config.fd === config.readyFd) throw invalid();
      const listener = inspect(config.fd);
      const ready = inspect(config.readyFd);
      if (!listener.descriptor.stat.isSocket() || listener.link !== `socket:[${listener.descriptor.stat.ino}]`
        || (listener.flags & 3) !== fs.constants.O_RDWR || !(listener.flags & fs.constants.O_NONBLOCK)) throw invalid();
      if (!ready.descriptor.stat.isFIFO() || ready.link !== `pipe:[${ready.descriptor.stat.ino}]`
        || (ready.flags & 3) !== fs.constants.O_WRONLY || !(ready.flags & fs.constants.O_NONBLOCK)) throw invalid();
      assertTcpListener(listener.descriptor, port);
      assertUnchanged(listener.descriptor); assertUnchanged(ready.descriptor);
      // Do not assume ownership of either number until the entire pair passes.
      this.listener = listener.descriptor;
      this.readyPipe = ready.descriptor;
    } catch { throw invalid(); }
  }

  listen(server: Server): void {
    if (!this.listener || !this.readyPipe || this.adopted || server.listening) throw invalid();
    try {
      assertUnchanged(this.listener); assertReadyPipe(this.readyPipe);
      assertTcpListener(this.listener, this.port);
    } catch { throw invalid(); }
    try { server.listen({ fd: this.listener.fd, exclusive: true }); }
    finally {
      if (server.listening) {
        // From here only the server may close its libuv handle. In particular,
        // readiness failure must drain the runtime instead of closing it twice.
        this.adopted = true;
        this.listener = undefined;
      }
    }
  }

  signalReady(): void {
    if (!this.adopted || !this.readyPipe) throw invalid();
    try {
      assertReadyPipe(this.readyPipe);
      // One nonblocking write below PIPE_BUF either commits the exact complete
      // record or fails; it cannot hang startup on a stale/full readiness pipe.
      if (fs.writeSync(this.readyPipe.fd, READY) !== READY.length) throw invalid();
    } catch { throw new Error('The bootstrap listener readiness handoff failed.'); }
    finally {
      const ready = this.readyPipe; this.readyPipe = undefined;
      closeOwned(ready);
    }
  }

  close(): void {
    const listener = this.listener; const ready = this.readyPipe;
    this.listener = undefined; this.readyPipe = undefined;
    const errors: unknown[] = [];
    for (const descriptor of [ready, listener]) {
      try { closeOwned(descriptor); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new Error('The bootstrap listener cleanup could not be confirmed.');
  }
}
