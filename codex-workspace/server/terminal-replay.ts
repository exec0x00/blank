import headless from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import { captureTerminalState, clearTerminalHistory, terminalCore, TERMINAL_SCROLLBACK_LINES, TERMINAL_THEME, type TerminalColorEvent, type TerminalReplayState } from '../shared/terminal-replay';
import { HttpError } from './errors';

const { Terminal } = headless;
const { SerializeAddon } = serializeAddon;
const ansiNames = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;
const hexRgb = (color: string) => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
function defaultColor(index: number): [number, number, number] {
  if (index < 16) return hexRgb(TERMINAL_THEME[ansiNames[index]]);
  if (index < 232) { const cell = index - 16, levels = [0, 95, 135, 175, 215, 255]; return [levels[Math.floor(cell / 36)], levels[Math.floor(cell / 6) % 6], levels[cell % 6]]; }
  if (index < 256) { const gray = 8 + (index - 232) * 10; return [gray, gray, gray]; }
  return hexRgb(index === 257 ? TERMINAL_THEME.background : index === 258 ? TERMINAL_THEME.cursor : TERMINAL_THEME.foreground);
}
const colorSequence = (index: number, color: [number, number, number]) => `\x1b]${index < 256 ? `4;${index}` : index - 246};rgb:${color.map(channel => channel.toString(16).padStart(2, '0').repeat(2)).join('/')}\x1b\\`;

/** Fixed application limits; the benchmark in terminal-replay.test.ts compares candidates. */
export const TERMINAL_HISTORY_LINES = TERMINAL_SCROLLBACK_LINES;
export const TERMINAL_HISTORY_BYTES = 64 * 1024;
export const TERMINAL_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const TERMINAL_PENDING_SEQUENCE = 64 * 1024;
export const TERMINAL_OUTPUT_CHUNK = 16 * 1024;
export const TERMINAL_PARSE_HIGH = 256 * 1024;
export const TERMINAL_PARSE_LOW = 64 * 1024;
export const TERMINAL_PARSE_HIGH_FRAMES = 2048;
export const TERMINAL_PARSE_LOW_FRAMES = 512;
const MAX_PENDING_ACTIONS = 256;

export interface TerminalSnapshot {
  data: string;
  state: TerminalReplayState;
  pending: string;
  cols: number;
  rows: number;
  historyLines: number;
  historyLimit: number;
  truncated: boolean;
}

/** Never split a surrogate pair, including in the transport's own chunking. */
export function terminalChunkEnd(data: string, offset: number, size = TERMINAL_OUTPUT_CHUNK): number {
  let end = Math.min(data.length, offset + size);
  if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]) && /[\uDC00-\uDFFF]/.test(data[end])) end--;
  return end;
}

/**
 * A ground-state boundary finder, using the pinned emulator's actual VT table.
 * It does not implement a second terminal. All data goes to xterm; only the
 * unfinished parser prefix is retained beside its screen snapshot. Executed
 * controls inside a prefix are omitted because their effects are in the screen.
 */
class TerminalBoundary {
  private state = 0;
  private pending = '';
  private highSurrogate = '';
  private unavailable = false;

  constructor(private readonly table: Uint8Array) {}

  push(data: string): void {
    const input = this.highSurrogate + data;
    this.highSurrogate = '';
    let end = input.length;
    if (end && /[\uD800-\uDBFF]/.test(input[end - 1])) this.highSurrogate = input[--end];
    for (let index = 0; index < end; index++) {
      const start = index;
      const code = input.codePointAt(index)!;
      if (code > 0xffff) index++;
      if (code === 0xfeff) continue; // The xterm string decoder ignores BOMs.
      if (this.state === 0 && (code >= 0x20 && code < 0x7f || code >= 0xa0)) continue;
      const transition = this.table[this.state << 8 | (code < 0xa0 ? code : 0xa0)];
      this.state = transition & 15;
      // OSC_END and DCS_UNHOOK consume ESC then leave it as a new ESC prefix.
      if (code === 0x1b) this.state = 1;
      if (this.state === 0) { this.pending = ''; this.unavailable = false; continue; }
      if ([0x1b, 0x90, 0x98, 0x9b, 0x9d, 0x9e, 0x9f].includes(code)) {
        this.pending = ''; this.unavailable = false;
      }
      if (!this.unavailable && transition >>> 4 !== 3) this.pending += input.slice(start, index + 1);
      if (this.pending.length > TERMINAL_PENDING_SEQUENCE) { this.pending = ''; this.unavailable = true; }
    }
  }

  tail(): string {
    if (this.unavailable) throw new Error('The terminal is finishing a large control sequence. Reconnect when its output has settled.');
    return this.pending + this.highSurrogate;
  }
}

/** Server emulator. Only output emitted without a viewer may use its replies. */
export class TerminalReplay {
  readonly terminal: HeadlessTerminal;
  private readonly serialize = new SerializeAddon();
  private readonly boundary: TerminalBoundary;
  private disposed = false;
  private trimmed = false;
  private trimLines: unknown;
  private trimSubscription?: { dispose(): void };
  private readonly bufferSubscription: { dispose(): void };
  private readonly replySubscription: { dispose(): void };
  private readonly colorSubscription: { dispose(): void };
  private readonly colors = new Map<number, [number, number, number]>();
  private readonly detachedWrites: boolean[] = [];
  private readonly operations = new Set<(error?: Error) => void>();
  pendingCharacters = 0;
  get pendingFrames(): number { return this.detachedWrites.length; }

  constructor(cols: number, rows: number, private readonly onDrain: () => void, historyLimit = TERMINAL_HISTORY_LINES, onDetachedReply?: (data: string) => void) {
    this.terminal = new Terminal({ cols, rows, scrollback: historyLimit, allowProposedApi: true, cursorStyle: 'bar', cursorBlink: true });
    this.terminal.loadAddon(this.serialize);
    this.boundary = new TerminalBoundary(terminalCore(this.terminal)._inputHandler._parser._transitions.table);
    this.bufferSubscription = this.terminal.buffer.onBufferChange(() => this.observeTrim());
    // Capture attachment at emission, not at the asynchronous parser callback:
    // a newly connecting viewer receives a snapshot without old query commands.
    this.replySubscription = this.terminal.onData(data => { if (this.detachedWrites[0]) onDetachedReply?.(data); });
    this.colorSubscription = terminalCore(this.terminal)._inputHandler.onColor(events => {
      for (const event of events) this.color(event, onDetachedReply);
    });
    this.observeTrim();
  }

  private color(event: TerminalColorEvent, reply?: (data: string) => void): void {
    if (event.type === 2 && event.index === undefined) {
      // OSC 104 with no index resets ANSI colors, not the default foreground.
      for (const index of this.colors.keys()) if (index < 256) this.colors.delete(index);
      return;
    }
    const index = event.index;
    if (index === undefined || !Number.isInteger(index) || index < 0 || index > 258) return;
    if (event.type === 1 && event.color) this.colors.set(index, [...event.color]);
    else if (event.type === 2) this.colors.delete(index);
    else if (event.type === 0 && this.detachedWrites[0]) reply?.(colorSequence(index, this.colors.get(index) ?? defaultColor(index)));
  }

  private colorSnapshot(): string {
    return '\x1b]104\x1b\\\x1b]110\x1b\\\x1b]111\x1b\\\x1b]112\x1b\\'
      + [...this.colors].map(([index, color]) => colorSequence(index, color)).join('');
  }

  private observeTrim(): void {
    const lines = terminalCore(this.terminal).buffers.normal.lines;
    if (this.trimLines === lines) return;
    this.trimSubscription?.dispose();
    this.trimLines = lines;
    this.trimmed = false;
    this.trimSubscription = lines.onTrim(() => { this.trimmed = true; });
  }

  write(data: string, detached = false): void {
    if (this.disposed || !data) return;
    this.boundary.push(data);
    this.detachedWrites.push(detached);
    this.pendingCharacters += data.length;
    this.terminal.write(data, () => {
      if (this.disposed) return;
      this.detachedWrites.shift();
      this.pendingCharacters -= data.length;
      this.observeTrim();
      this.onDrain();
    });
  }

  /** xterm's empty-write callback is an ordered parser barrier, without a timer. */
  private barrier<T>(operation: () => T): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('This terminal is no longer available.'));
    if (this.operations.size >= MAX_PENDING_ACTIONS) return Promise.reject(this.busy());
    return new Promise<T>((resolve, reject) => {
      const cancel = (error?: Error) => { this.operations.delete(cancel); if (error) reject(error); };
      this.operations.add(cancel);
      this.terminal.write('', () => {
        if (this.disposed) return;
        this.operations.delete(cancel);
        try { this.observeTrim(); resolve(operation()); } catch (error) { reject(error); }
      });
    });
  }

  private busy(): HttpError { return new HttpError(429, 'Terminal output is still being processed. Try again shortly.', 'TERMINAL_BUSY'); }

  resize(cols: number, rows: number): void {
    if (this.disposed || this.operations.size >= MAX_PENDING_ACTIONS) throw this.busy();
    void this.barrier(() => this.terminal.resize(cols, rows)).catch(() => undefined);
  }

  clear(): Promise<void> {
    if (this.disposed || this.operations.size >= MAX_PENDING_ACTIONS) throw this.busy();
    return this.barrier(() => {
      // Clearing a viewer must never switch off the running application's modes
      // or erase its alternate screen. A normal shell keeps its prompt line.
      clearTerminalHistory(this.terminal);
      this.trimmed = false;
    });
  }

  snapshot(historyLimit = TERMINAL_HISTORY_LINES, historyBytes = TERMINAL_HISTORY_BYTES): Promise<TerminalSnapshot> {
    let pending: string;
    try { pending = this.boundary.tail(); } catch (error) { return Promise.reject(error); }
    return this.barrier(() => {
      const terminal = this.terminal;
      const available = terminal.buffer.normal.baseY;
      let historyLines = Math.min(historyLimit, available);
      const colors = this.colorSnapshot();
      const screen = colors + this.serialize.serialize({ scrollback: 0, excludeModes: true });
      let data = historyLines ? colors + this.serialize.serialize({ scrollback: historyLines, excludeModes: true }) : screen;
      const screenBytes = Buffer.byteLength(screen);
      if (screenBytes + Buffer.byteLength(pending) > TERMINAL_SNAPSHOT_BYTES) {
        throw new Error('This terminal screen is too large to restore safely. Its shell is still running. Reduce its output and reconnect.');
      }
      // The same fixed line/byte ceiling applies to every reconnect. Drop only
      // complete normal scrollback rows; the current normal/alternate screens
      // are always kept intact, even when they are larger than the history cap.
      if (Buffer.byteLength(data) > screenBytes + historyBytes) {
        let low = 0, high = historyLines;
        data = screen;
        while (low < high) {
          const candidate = Math.ceil((low + high) / 2);
          const serialized = colors + this.serialize.serialize({ scrollback: candidate, excludeModes: true });
          if (Buffer.byteLength(serialized) <= screenBytes + historyBytes) { low = candidate; data = serialized; }
          else high = candidate - 1;
        }
        historyLines = low;
      }
      return { data, state: captureTerminalState(terminal), pending, cols: terminal.cols, rows: terminal.rows,
        historyLines, historyLimit, truncated: this.trimmed || historyLines < available };
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.trimSubscription?.dispose();
    this.bufferSubscription.dispose();
    this.replySubscription.dispose();
    this.colorSubscription.dispose();
    this.colors.clear();
    this.detachedWrites.length = 0;
    for (const cancel of this.operations) cancel(new Error('This terminal is no longer available.'));
    this.operations.clear();
    this.terminal.dispose();
  }
}
