export const TERMINAL_HANDSHAKE_TIMEOUT_MS = 20_000;
export const TERMINAL_REPLAY_TIMEOUT_MS = 60_000;
export const TERMINAL_HEARTBEAT_INTERVAL_MS = 15_000;
export const TERMINAL_HEARTBEAT_TIMEOUT_MS = 10_000;

export interface TerminalConnectionWatchdog {
  progress(): void;
  ready(): void;
  pong(id: string): void;
  resume(): void;
  suspend(): void;
  dispose(): void;
}

/** One connection owns its timers. A resumed browser gets a fresh round-trip probe. */
export function watchTerminalConnection(options: {
  sendPing(id: string): boolean;
  onTimeout(phase: 'handshake' | 'heartbeat'): void;
  visible(): boolean;
}): TerminalConnectionWatchdog {
  let phase: 'handshake' | 'active' | 'stopped' = 'handshake';
  let startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | undefined;
  let sequence = 0;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const timeout = (reason: 'handshake' | 'heartbeat') => {
    if (phase === 'stopped') return;
    cancel(); phase = 'stopped'; pending = undefined;
    options.onTimeout(reason);
  };
  const arm = (delay: number, callback: () => void) => {
    cancel();
    if (phase === 'stopped' || !options.visible()) return;
    const deadline = Date.now() + Math.max(0, delay);
    timer = setTimeout(() => {
      timer = undefined;
      // Timers delayed by a background tab or suspended machine aren't proof
      // of transport failure. Visibility/pageshow starts a fresh probe.
      if (phase !== 'stopped' && options.visible()) {
        if (Date.now() - deadline > 5000) resume();
        else callback();
      }
    }, Math.max(0, delay));
  };
  const handshake = () => arm(Math.min(TERMINAL_HANDSHAKE_TIMEOUT_MS,
    Math.max(0, TERMINAL_REPLAY_TIMEOUT_MS - (Date.now() - startedAt))), () => timeout('handshake'));
  const probe = () => {
    if (phase !== 'active' || !options.visible()) return;
    const id = `terminal-${++sequence}`;
    pending = id;
    if (!options.sendPing(id)) { timeout('heartbeat'); return; }
    arm(TERMINAL_HEARTBEAT_TIMEOUT_MS, () => { if (pending === id) timeout('heartbeat'); });
  };
  const next = () => arm(TERMINAL_HEARTBEAT_INTERVAL_MS, probe);
  const resume = () => {
    if (phase === 'stopped') return;
    cancel(); pending = undefined;
    if (phase === 'handshake') { startedAt = Date.now(); handshake(); }
    else probe();
  };
  handshake();
  return {
    progress() { if (phase === 'handshake') handshake(); },
    ready() { if (phase === 'stopped') return; phase = 'active'; pending = undefined; next(); },
    pong(id) { if (phase !== 'active' || !pending || id !== pending) return; pending = undefined; next(); },
    resume,
    suspend() { cancel(); pending = undefined; },
    dispose() { cancel(); pending = undefined; phase = 'stopped'; },
  };
}
