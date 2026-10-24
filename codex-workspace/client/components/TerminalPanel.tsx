import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Terminal as Xterm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Clipboard, Copy, Eraser, Keyboard, LoaderCircle, Plus, Terminal as TerminalIcon, TriangleAlert, X } from 'lucide-react';
import type { TerminalSession, Workspace } from '../../shared/types';
import { clearTerminalHistory, observeTerminalInput, restoreTerminalState, TERMINAL_SCROLLBACK_LINES, TERMINAL_THEME, type TerminalReplayState } from '../../shared/terminal-replay';
import { api, ApiError, json } from '../api';
import { synchronizeTerminalViewportResets } from '../terminal-viewport';
import { watchTerminalConnection, type TerminalConnectionWatchdog } from '../terminal-connection';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

interface TerminalPanelProps {
  workspace: Workspace;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  onCloseLast?: (workspaceId: string) => void;
  existingSessionsOnly?: boolean;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';
type ReadyMessage = { type: 'ready'; session: TerminalSession; sessions?: TerminalSession[]; cols: number; rows: number; truncated?: boolean; flowControl?: boolean;
  replay?: { historyLines: number; historyLimit: number } };
type TerminalMessage = ReadyMessage
  | { type: 'output'; data: string; sequence?: number; respond?: boolean }
  | { type: 'replay-complete'; state: TerminalReplayState; pending: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'exit'; exitCode: number }
  | { type: 'clear' }
  | { type: 'pong'; id: string }
  | { type: 'error'; message: string };
interface View { key: string; sessionId?: string; fresh?: boolean; focusOnReady?: boolean }
interface ViewStatus { connection: ConnectionState; hasSelection: boolean; sessionId?: string }
interface TerminalHandle {
  focus(): void;
  send(data: string): void;
  paste(data: string): void;
  selection(): string;
  clear(): void;
  prepareClose(): () => void;
}

const DARK_THEME: ITheme = TERMINAL_THEME;
function terminalTheme(host: HTMLElement): ITheme {
  const style = getComputedStyle(host);
  const background = style.getPropertyValue('--terminal-bg').trim() || DARK_THEME.background;
  const foreground = style.getPropertyValue('--terminal-text').trim() || DARK_THEME.foreground;
  return { ...DARK_THEME, background, foreground, cursor: foreground, cursorAccent: background };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The terminal could not connect.';
}
function readSelection(workspaceId: string): string | undefined {
  try { return localStorage.getItem(`codex.terminal.${workspaceId}`) || undefined; } catch { return undefined; }
}
function saveSelection(workspaceId: string, sessionId: string): void {
  try { localStorage.setItem(`codex.terminal.${workspaceId}`, sessionId); } catch { /* Storage can be disabled. */ }
}

/** A visited tab retains its xterm, scrollback and authenticated socket until closed. */
function TerminalView({ workspace, view, active, locked, existingSessionsOnly, ctrlRef, onCtrlUsed, onReady, onStatus, register, onNotify }: {
  workspace: Workspace;
  view: View;
  active: boolean;
  locked: boolean;
  existingSessionsOnly: boolean;
  ctrlRef: MutableRefObject<boolean>;
  onCtrlUsed(): void;
  onReady(key: string, message: ReadyMessage): void;
  onStatus(key: string, status: ViewStatus): void;
  register(key: string, handle: TerminalHandle | null): void;
  onNotify: TerminalPanelProps['onNotify'];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});
  const activeRef = useRef(active);
  const lockedRef = useRef(locked);
  const existingOnlyRef = useRef(existingSessionsOnly);
  const updateSessionPolicy = useRef<() => void>(() => {});
  const callbacks = useRef({ onReady, onStatus, onNotify, onCtrlUsed, register });
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState('');
  const [historyNotice, setHistoryNotice] = useState('');
  const reconnectRef = useRef<() => void>(() => {});
  activeRef.current = active;
  lockedRef.current = locked;
  existingOnlyRef.current = existingSessionsOnly;
  callbacks.current = { onReady, onStatus, onNotify, onCtrlUsed, register };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let exited = false;
    let closing = false;
    let hasSelection = false;
    let state: ConnectionState = 'connecting';
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let fitFrame = 0;
    let viewportFrame = 0;
    let socket: WebSocket | null = null;
    let connectionWatchdog: TerminalConnectionWatchdog | undefined;
    let retireConnection: ((reason: string) => void) | undefined;
    let connectionGeneration = 0;
    let sessionId = view.sessionId;
    let everReady = false;
    let ready = false;
    let warningAt = 0;
    let pendingInput = '';
    let pendingSince = 0;
    let requestedSize = '';
    let restoring = false;
    let writing = false;
    let writeGeneration = 0;
    let queuedCharacters = 0;
    let replyFrame: { sequence?: number; respond?: boolean } | undefined;
    let focusReplySequence: number | undefined;
    type WriteOperation = { data?: string; before?(): void; after?(): void; reply?: typeof replyFrame; generation: number };
    let writes: WriteOperation[] = [];
    type NormalViewport = { pinned: boolean; distance: number; anchor: string[] };
    let pendingViewport: { position: NormalViewport; connection: number; write: number } | undefined;
    const terminal = new Xterm({
      cursorBlink: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      cursorStyle: 'bar',
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size')) || 13,
      lineHeight: 1.32, scrollback: TERMINAL_SCROLLBACK_LINES, minimumContrastRatio: 4.5,
      allowProposedApi: true,
      theme: terminalTheme(host),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    const stopSynchronizingViewport = synchronizeTerminalViewportResets(terminal);
    terminal.textarea?.setAttribute('aria-label', 'Terminal input');
    const captureViewport = (): NormalViewport => {
      const normal = terminal.buffer.normal, top = normal.viewportY;
      const anchor = Array.from({ length: Math.min(3, normal.length - top) }, (_, offset) => normal.getLine(top + offset)?.translateToString(true) ?? '');
      return { pinned: top >= normal.baseY, distance: normal.baseY - top,
        anchor: anchor.some(line => line.trim()) ? anchor : [] };
    };
    const restoreViewport = () => {
      const pending = pendingViewport;
      if (!pending || disposed || closing || lockedRef.current || restoring
        || pending.connection !== connectionGeneration || pending.write !== writeGeneration
        || terminal.buffer.active.type !== 'normal') return;
      pendingViewport = undefined;
      if (pending.position.pinned) { terminal.scrollToBottom(); return; }
      const normal = terminal.buffer.normal;
      const fallback = Math.max(0, normal.baseY - pending.position.distance);
      let target = fallback, distance = Infinity;
      // The normal buffer is bounded to 500 recent rows plus its current screen.
      // Preserve actual visible rows when new output shifted their old offsets.
      if (pending.position.anchor.length) for (let line = 0; line <= normal.baseY; line++) {
        if (pending.position.anchor.every((text, offset) => normal.getLine(line + offset)?.translateToString(true) === text)
          && Math.abs(line - fallback) < distance) { target = line; distance = Math.abs(line - fallback); }
      }
      terminal.scrollToLine(target);
    };
    const scheduleViewportRestore = () => {
      cancelAnimationFrame(viewportFrame);
      const pending = pendingViewport;
      if (!pending) return;
      // xterm synchronizes its native scroll area in a render frame. Restoring
      // before that reset/resize scroll event settles can overwrite the target.
      viewportFrame = requestAnimationFrame(() => {
        viewportFrame = requestAnimationFrame(() => {
          viewportFrame = 0;
          if (disposed || pendingViewport !== pending) return;
          enqueueWrite({ before: () => { if (pendingViewport === pending) restoreViewport(); } });
        });
      });
    };
    const report = (next: ConnectionState) => {
      state = next;
      setConnection(next);
      callbacks.current.onStatus(view.key, { connection: next, hasSelection, sessionId });
    };
    const outputFailure = (message: string) => {
      ready = false; restoring = false;
      writes = []; queuedCharacters = 0; writeGeneration++;
      terminal.options.disableStdin = true;
      setError(message); report('error');
      socket?.close(1008, 'Terminal output needs to reconnect');
    };
    const pumpWrites = () => {
      if (writing || disposed) return;
      while (writes.length) {
        const operation = writes.shift()!;
        queuedCharacters -= operation.data?.length ?? 0;
        if (operation.generation !== writeGeneration) continue;
        try {
          operation.before?.();
          if (operation.data === undefined) { operation.after?.(); continue; }
          writing = true;
          replyFrame = operation.reply;
          if (replyFrame?.respond) focusReplySequence = replyFrame.sequence;
          terminal.write(operation.data, () => {
            writing = false; replyFrame = undefined;
            if (disposed) return;
            try { if (operation.generation === writeGeneration) operation.after?.(); }
            catch { outputFailure('The terminal could not restore its screen. Reconnect to try again.'); return; }
            pumpWrites();
          });
          return;
        } catch {
          writing = false; replyFrame = undefined;
          outputFailure('The terminal could not restore its screen. Reconnect to try again.');
          return;
        }
      }
    };
    const enqueueWrite = (operation: Omit<WriteOperation, 'generation'>) => {
      if (disposed) return;
      const characters = operation.data?.length ?? 0;
      if (queuedCharacters + characters > 1024 * 1024 || writes.length >= 1024) {
        outputFailure('Terminal output arrived faster than it could be displayed. Reconnect to resume the recent screen.');
        return;
      }
      writes.push({ ...operation, generation: writeGeneration });
      queuedCharacters += characters;
      pumpWrites();
    };
    const sendInput = (input: string) => {
      if (lockedRef.current || exited || closing) return;
      let data = input;
      if (ctrlRef.current && input.length === 1) {
        const key = input.toUpperCase().charCodeAt(0);
        if (key >= 64 && key <= 95) data = String.fromCharCode(key - 64);
        ctrlRef.current = false;
        callbacks.current.onCtrlUsed();
      }
      if (!ready || socket?.readyState !== WebSocket.OPEN) {
        // Preserve quick typing during the first handshake, never after a lost
        // connection. No predicted text is painted or treated as shell output.
        if (!everReady && (state === 'connecting' || state === 'reconnecting') && pendingInput.length + data.length <= 16 * 1024) {
          if (!pendingInput) pendingSince = Date.now();
          pendingInput += data;
          return;
        }
        if (Date.now() - warningAt > 4000) {
          callbacks.current.onNotify('The terminal is disconnected. Reconnect before typing.', 'info');
          warningAt = Date.now();
        }
        return;
      }
      if (socket.bufferedAmount > 256 * 1024) {
        callbacks.current.onNotify('The connection is still sending your previous input. Wait before pasting more.', 'info');
        return;
      }
      if (data.length > 1024 * 1024) {
        callbacks.current.onNotify('This paste is larger than 1 MB. Send smaller sections or upload it as a file.', 'info');
        return;
      }
      if (data && pendingViewport && terminal.buffer.active.type === 'normal') {
        pendingViewport.position = { pinned: true, distance: 0, anchor: [] };
      }
      // Ordered chunks preserve Unicode code points and bracketed paste.
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(offset + 16 * 1024, data.length);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]) && /[\uDC00-\uDFFF]/.test(data[end])) end -= 1;
        socket.send(JSON.stringify({ type: 'input', data: data.slice(offset, end) }));
        offset = end;
      }
    };
    const sendSize = (cols: number, rows: number) => {
      if (lockedRef.current || !activeRef.current || !ready || socket?.readyState !== WebSocket.OPEN) return;
      const size = `${cols}:${rows}`;
      // Keep the newest request while earlier resize replies are in flight.
      // Returning to the current size must still cancel an outstanding change.
      if (size === (requestedSize || `${terminal.cols}:${terminal.rows}`)) return;
      requestedSize = size;
      socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    };
    const fitNow = () => {
      if (disposed || restoring || !activeRef.current || host.clientWidth < 30 || host.clientHeight < 20 || !host.getClientRects().length) return;
      enqueueWrite({ before: () => {
        if (restoring || !activeRef.current) return;
        try {
          const proposed = fit.proposeDimensions();
          if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
          const cols = Math.max(2, Math.min(proposed.cols, 500));
          const rows = Math.max(1, Math.min(proposed.rows, 300));
          if (exited || !everReady && !ready) { terminal.resize(cols, rows); requestedSize = ''; }
          else sendSize(cols, rows);
          // FitAddon.fit() resizes the emulator before old PTY bytes have
          // arrived. Only the ordered server resize may change live geometry;
          // otherwise a narrow alternate screen wraps over existing TUI rows.
          if (!requestedSize) scheduleViewportRestore();
        } catch { /* The pane can leave the DOM during a resize. */ }
      } });
    };
    const fitTerminal = () => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(fitNow);
    };
    fitRef.current = fitTerminal;
    const updateAppearance = () => {
      const rootStyle = getComputedStyle(document.documentElement);
      terminal.options.fontSize = Number.parseFloat(rootStyle.getPropertyValue('--editor-font-size')) || 13;
      terminal.options.cursorBlink = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      fitTerminal();
    };
    const stopObservingInput = observeTerminalInput(terminal, (data, userInput) => {
      if (userInput) { sendInput(data); return; }
      // Queries in old output are never input. Live queries have one designated
      // viewer, so the headless model and a second browser cannot answer twice.
      const sequence = replyFrame?.respond ? replyFrame.sequence : !replyFrame && /^\x1b\[[IO]$/.test(data) ? focusReplySequence : undefined;
      if (!ready || restoring || !sequence || disposed || lockedRef.current || closing || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'reply', data, sequence }));
    });
    const binarySubscription = terminal.onBinary(data => {
      if (!ready || restoring || disposed || lockedRef.current || closing || exited || socket?.readyState !== WebSocket.OPEN) return;
      if (data.length <= 64 * 1024 && socket.bufferedAmount <= 256 * 1024) socket.send(JSON.stringify({ type: 'binary', data }));
    });
    const selectionSubscription = terminal.onSelectionChange(() => {
      const next = terminal.hasSelection();
      if (next === hasSelection) return;
      hasSelection = next;
      callbacks.current.onStatus(view.key, { connection: state, hasSelection });
    });
    const bufferSubscription = terminal.buffer.onBufferChange(buffer => {
      // An alternate-screen replay retains the normal viewport until the real
      // TUI exits. Apply it after that output has parsed, never mid-sequence.
      if (!restoring && pendingViewport && buffer.type === 'normal') enqueueWrite({ before: scheduleViewportRestore });
    });
    const userScroll = (event: WheelEvent) => {
      if (event.isTrusted && !restoring && terminal.buffer.active.type === 'normal' && terminal.modes.mouseTrackingMode === 'none') {
        pendingViewport = undefined; cancelAnimationFrame(viewportFrame);
      }
    };
    host.addEventListener('wheel', userScroll, { capture: true, passive: true });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey) || !event.shiftKey || !navigator.clipboard) return true;
      if (event.code === 'KeyC' && terminal.hasSelection()) {
        event.preventDefault();
        void navigator.clipboard.writeText(terminal.getSelection()).catch(() => callbacks.current.onNotify('Clipboard access is unavailable. Use your browser’s copy action.', 'error'));
        return false;
      }
      if (event.code === 'KeyV') {
        event.preventDefault();
        void navigator.clipboard.readText().then((text) => terminal.paste(text)).catch(() => callbacks.current.onNotify('Clipboard access is unavailable. Paste with your keyboard instead.', 'error'));
        return false;
      }
      return true;
    });

    const connect = () => {
      if (disposed || exited || closing || lockedRef.current) return;
      if (existingOnlyRef.current && !sessionId) {
        pendingInput = ''; report('error'); setError('This workspace is unavailable. Only an existing terminal can be reconnected.'); return;
      }
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
      if (!navigator.onLine) { report('reconnecting'); return; }
      ready = false;
      if (everReady) terminal.options.disableStdin = true;
      report(everReady || retries ? 'reconnecting' : 'connecting');
      // Fit before opening so the host shell starts with the correct dimensions.
      fitNow();
      const params = new URLSearchParams({ workspaceId: workspace.id, requestId: view.key,
        cols: String(Math.max(2, Math.min(terminal.cols, 500))), rows: String(Math.max(1, Math.min(terminal.rows, 300))), flow: '1', frames: '1' });
      if (sessionId) params.set('sessionId', sessionId);
      if (existingOnlyRef.current) params.set('existingOnly', '1');
      else if (view.fresh && !everReady) params.set('new', '1');
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const generation = ++connectionGeneration;
      const current = new WebSocket(`${protocol}//${location.host}/ws/terminal?${params}`);
      socket = current;
      const initialConnection = !everReady;
      const hadTerminalFocus = host.contains(document.activeElement);
      let detached = false;
      let acknowledged = 0;
      let acknowledgedFrames = 0;
      let flowControl = false;
      let handshake: ReadyMessage | undefined;
      const acknowledge = () => {
        if (!acknowledged || !flowControl || disposed || socket !== current || current.readyState !== WebSocket.OPEN || lockedRef.current) return;
        current.send(JSON.stringify({ type: 'ack', characters: acknowledged }));
        acknowledged = 0;
        acknowledgedFrames = 0;
      };
      // xterm already batches parsing/rendering. Short frames also release
      // credit, well before the server's 256-frame window can fill. At most 31
      // small frames remain unacknowledged when idle; no per-keystroke ACK or
      // output-delay timer is needed.
      const parsedSubscription = terminal.onWriteParsed(() => { if (acknowledgedFrames >= 32) acknowledge(); });
      const watchdog = watchTerminalConnection({
        visible: () => document.visibilityState !== 'hidden' && navigator.onLine,
        sendPing: id => {
          if (disposed || socket !== current || current.readyState !== WebSocket.OPEN || lockedRef.current || closing || exited) return false;
          try { current.send(JSON.stringify({ type: 'ping', id })); return true; } catch { return false; }
        },
        onTimeout: phase => {
          if (disposed || socket !== current || lockedRef.current || closing || exited) return;
          setError(phase === 'handshake' ? 'The terminal connection is taking too long. Reconnecting…' : 'Connection interrupted. Reconnecting to your shell…');
          // A WebSocket close handshake can itself hang on a dead link. Retire
          // this generation immediately; old output and late pongs are ignored.
          retire('Terminal connection timed out');
        },
      });
      connectionWatchdog = watchdog;
      const finishReplay = () => {
        if (disposed || lockedRef.current || socket !== current || !handshake) return;
        restoring = false;
        ready = !handshake.session.exited && !exited;
        everReady = true;
        retries = 0;
        if (handshake.session.exited || exited) watchdog.dispose();
        else watchdog.ready();
        terminal.options.disableStdin = lockedRef.current || closing || exited;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) terminal.options.cursorBlink = false;
        report(handshake.session.exited || exited ? 'closed' : 'connected');
        setError('');
        fitTerminal();
        terminal.refresh(0, terminal.rows - 1);
        const mayRestoreFocus = hadTerminalFocus && (document.activeElement === document.body || host.contains(document.activeElement));
        if ((initialConnection || mayRestoreFocus) && activeRef.current && view.focusOnReady !== false && host.getClientRects().length && matchMedia('(pointer: fine)').matches) terminal.focus();
        const queued = pendingInput;
        pendingInput = '';
        if (queued && Date.now() - pendingSince <= 5000) sendInput(queued);
      };
      current.onopen = () => { if (disposed || lockedRef.current) current.close(); };
      current.onmessage = (event) => {
        if (disposed || lockedRef.current || socket !== current) return;
        let message: TerminalMessage;
        try { message = JSON.parse(String(event.data)) as TerminalMessage; } catch { return; }
        if (message.type === 'pong') { if (typeof message.id === 'string') watchdog.pong(message.id); return; }
        if (message.type === 'ready' || message.type === 'output' || message.type === 'replay-complete') watchdog.progress();
        if (message.type === 'ready') {
          const position = !sessionId || sessionId === message.session.id
            ? pendingViewport?.position ?? captureViewport() : { pinned: true, distance: 0, anchor: [] };
          handshake = message;
          ready = false;
          restoring = true;
          sessionId = message.session.id;
          flowControl = Boolean(message.flowControl);
          terminal.options.disableStdin = true;
          writes = []; queuedCharacters = 0; writeGeneration++;
          pendingViewport = { position, connection: generation, write: writeGeneration };
          focusReplySequence = undefined;
          // An old write may still be parsing. Reset only after its callback;
          // CAN + RIS also discard unfinished parser/decoder state from it.
          enqueueWrite({ data: '\x18\x1bc', before: () => {
            terminal.reset();
            if (message.cols && message.rows) terminal.resize(message.cols, message.rows);
            requestedSize = '';
          }, after: () => { if (!message.replay) finishReplay(); } });
          setHistoryNotice(message.truncated ? `Showing the current screen and ${message.replay?.historyLines ?? 0} recent lines. Earlier output was trimmed.` : '');
          callbacks.current.onReady(view.key, message);
        } else if (message.type === 'output' && typeof message.data === 'string') {
          // xterm's parse callback supplies real consumption acknowledgements.
          // Output never enters React state and no batching timer delays echo.
          enqueueWrite({ data: message.data, reply: message, after: () => {
            if (!flowControl || disposed || socket !== current || current.readyState !== WebSocket.OPEN || lockedRef.current) return;
            acknowledged += message.data.length;
            acknowledgedFrames++;
            if (acknowledged >= 16 * 1024) acknowledge();
          } });
        } else if (message.type === 'replay-complete') {
          enqueueWrite({ data: message.pending, before: () => restoreTerminalState(terminal, message.state), after: finishReplay });
        } else if (message.type === 'resize') {
          enqueueWrite({ before: () => {
            terminal.resize(message.cols, message.rows);
            if (requestedSize === `${message.cols}:${message.rows}`) requestedSize = '';
            if (!requestedSize) scheduleViewportRestore();
          } });
        } else if (message.type === 'exit') {
          watchdog.dispose();
          exited = true;
          ready = false;
          report('closed');
          enqueueWrite({ data: `\r\n\x1b[90m[Process exited with code ${message.exitCode}]\x1b[0m\r\n` });
        } else if (message.type === 'clear') {
          setHistoryNotice('');
          enqueueWrite({ before: () => clearTerminalHistory(terminal) });
        } else if (message.type === 'error') {
          setError(message.message);
          callbacks.current.onNotify(message.message, 'error');
        }
      };
      current.onerror = () => { /* onclose handles retries and reports failures. */ };
      function disconnected(event: { code: number; reason: string }) {
        if (detached) return;
        detached = true;
        watchdog.dispose();
        if (connectionWatchdog === watchdog) connectionWatchdog = undefined;
        parsedSubscription.dispose();
        if (disposed || socket !== current) return;
        socket = null;
        retireConnection = undefined;
        ready = false;
        restoring = false;
        terminal.options.disableStdin = true;
        if (everReady) pendingInput = '';
        if (lockedRef.current) { report('idle'); return; }
        if (exited) { report('closed'); return; }
        if (event.code === 1008) {
          pendingInput = '';
          report('error');
          setError((previous) => previous || event.reason || 'Your session expired. Sign in again to reconnect.');
          if (/session.*expired/i.test(event.reason)) window.dispatchEvent(new CustomEvent('codex:session-expired'));
          return;
        }
        if (event.code === 1000 && event.reason === 'Terminal closed') {
          exited = true;
          report('closed');
          setError('This terminal was closed in another window.');
          return;
        }
        retries += 1;
        if (retries > 6) {
          pendingInput = '';
          report('error');
          setError(everReady ? 'Connection lost. Your shell continues running; reconnect to resume.' : 'This terminal is unavailable. Reconnect to try again.');
          return;
        }
        report('reconnecting');
        retryTimer = setTimeout(connect, Math.min(250 * 2 ** (retries - 1), 8000));
      }
      current.onclose = disconnected;
      function retire(reason: string) {
        if (socket !== current) return;
        disconnected({ code: 4000, reason });
        current.close(4000, reason);
      }
      retireConnection = retire;
    };
    updateSessionPolicy.current = () => {
      if (!existingOnlyRef.current || sessionId || disposed) return;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
      pendingInput = ''; ready = false;
      connectionWatchdog?.dispose(); connectionWatchdog = undefined;
      socket?.close(1000, 'Workspace is unavailable'); socket = null;
      report('error'); setError('This workspace is unavailable. Only an existing terminal can be reconnected.');
    };
    const pause = () => {
      lockedRef.current = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
      pendingInput = '';
      ready = false;
      connectionWatchdog?.dispose(); connectionWatchdog = undefined;
      terminal.options.disableStdin = true;
      socket?.close(1000, 'Workspace locked');
      socket = null;
      report('idle');
    };
    const resume = () => {
      if (disposed) return;
      lockedRef.current = false;
      terminal.options.disableStdin = closing;
      retries = 0;
      connect();
      fitTerminal();
    };
    const probeConnection = () => {
      if (disposed || lockedRef.current || closing || exited || document.visibilityState === 'hidden') return;
      if (!navigator.onLine) { connectionWatchdog?.suspend(); return; }
      if (!socket || socket.readyState === WebSocket.CLOSED) { connect(); return; }
      connectionWatchdog?.resume();
      fitTerminal();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') connectionWatchdog?.suspend();
      else probeConnection();
    };
    const offline = () => {
      if (disposed || lockedRef.current || closing || exited) return;
      connectionWatchdog?.suspend();
      ready = false; pendingInput = ''; terminal.options.disableStdin = true;
      report('reconnecting');
      // The underlying PTY survives. The stable session/request ID resumes it.
      retireConnection?.('Network offline');
    };
    reconnectRef.current = () => {
      if (!exited) { setError(''); retireConnection?.('Reconnect requested'); retries = 0; connect(); }
    };
    callbacks.current.register(view.key, {
      focus: () => terminal.focus(), send: data => sendInput(/^\x1b\[[ABCD]$/.test(data) && terminal.modes.applicationCursorKeysMode ? `\x1bO${data.at(-1)}` : data), paste: (text) => terminal.paste(text),
      selection: () => terminal.getSelection(),
      clear: () => { if (ready && !lockedRef.current && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'clear' })); },
      prepareClose: () => {
        closing = true;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
        pendingInput = '';
        ready = false;
        connectionWatchdog?.dispose(); connectionWatchdog = undefined;
        terminal.options.disableStdin = true;
        socket?.close(1000, 'Closing terminal');
        socket = null;
        report('idle');
        return () => {
          if (disposed) return;
          closing = false;
          terminal.options.disableStdin = lockedRef.current;
          connect();
        };
      },
    });
    window.addEventListener('codex:session-locked', pause);
    window.addEventListener('codex:session-unlocked', resume);
    window.addEventListener('online', probeConnection);
    window.addEventListener('offline', offline);
    window.addEventListener('pageshow', probeConnection);
    const resizeObserver = new ResizeObserver(fitTerminal);
    resizeObserver.observe(host);
    const intersectionObserver = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) fitTerminal(); });
    intersectionObserver.observe(host);
    const appearanceObserver = new MutationObserver(updateAppearance);
    appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener('change', updateAppearance);
    window.addEventListener('resize', fitTerminal);
    window.addEventListener('codex:settings-changed', updateAppearance);
    document.addEventListener('visibilitychange', visibilityChanged);
    window.visualViewport?.addEventListener('resize', fitTerminal);
    if (lockedRef.current) pause();
    else connect();

    return () => {
      disposed = true;
      connectionWatchdog?.dispose(); connectionWatchdog = undefined;
      updateSessionPolicy.current = () => {};
      if (retryTimer) clearTimeout(retryTimer);
      cancelAnimationFrame(fitFrame);
      cancelAnimationFrame(viewportFrame);
      window.removeEventListener('codex:session-locked', pause);
      window.removeEventListener('codex:session-unlocked', resume);
      window.removeEventListener('online', probeConnection);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pageshow', probeConnection);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      appearanceObserver.disconnect();
      motion.removeEventListener('change', updateAppearance);
      window.removeEventListener('resize', fitTerminal);
      window.removeEventListener('codex:settings-changed', updateAppearance);
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.visualViewport?.removeEventListener('resize', fitTerminal);
      socket?.close(1000, 'Leaving terminal view');
      socket = null;
      writes = []; queuedCharacters = 0; writeGeneration++;
      pendingViewport = undefined;
      stopObservingInput();
      binarySubscription.dispose();
      selectionSubscription.dispose();
      bufferSubscription.dispose();
      host.removeEventListener('wheel', userScroll, true);
      stopSynchronizingViewport();
      terminal.dispose();
      callbacks.current.register(view.key, null);
    };
  }, [workspace.id, view.key, ctrlRef]);

  useEffect(() => { if (active) fitRef.current(); }, [active]);
  useEffect(() => { updateSessionPolicy.current(); }, [existingSessionsOnly]);
  return <div className="terminal-surface" hidden={!active} data-connection={connection} role="tabpanel" id={`terminal-output-${view.key}`} aria-labelledby={view.sessionId ? `terminal-tab-${view.sessionId}` : undefined} aria-label={view.sessionId ? undefined : 'Opening terminal'}>
    <div className="terminal-xterm" ref={hostRef} />
    {historyNotice && !error && connection === 'connected' && <div className="terminal-history-note" role="status"><span>{historyNotice}</span><button aria-label="Dismiss terminal history notice" onClick={() => setHistoryNotice('')}><X size={12} /></button></div>}
    {(connection === 'connecting' || connection === 'reconnecting') && <div className="terminal-connection-note" role="status"><LoaderCircle size={13} className="terminal-spin" />{connection === 'reconnecting' ? 'Reconnecting to your shell…' : 'Opening your shell…'}</div>}
    {error && <div className="terminal-error-note" role="alert"><TriangleAlert size={14} /><span>{error}</span>{connection !== 'closed' && (!existingSessionsOnly || view.sessionId) && <button onClick={() => reconnectRef.current()}>Reconnect</button>}</div>}
  </div>;
}

function WorkspaceTerminal({ workspace, onNotify, onCloseLast, existingSessionsOnly = false }: TerminalPanelProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [views, setViews] = useState<View[]>(() => { const sessionId = readSelection(workspace.id); return existingSessionsOnly && !sessionId ? [] : [{ key: crypto.randomUUID(), sessionId }]; });
  const [activeKey, setActiveKey] = useState<string | null>(() => views[0]?.key ?? null);
  const [statuses, setStatuses] = useState<Record<string, ViewStatus>>({});
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [locked, setLocked] = useState(() => document.body.dataset.workspaceLocked === 'true');
  const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set());
  const handles = useRef(new Map<string, TerminalHandle>());
  const mounted = useRef(true);
  const closeRequests = useRef(new Set<string>());
  const closedSessions = useRef(new Set<string>());
  const sessionsRef = useRef(sessions);
  const viewsRef = useRef(views);
  const activeRef = useRef(activeKey);
  const onCloseLastRef = useRef(onCloseLast);
  const ctrlRef = useRef(false);
  const existingOnlyRef = useRef(existingSessionsOnly);
  viewsRef.current = views;
  sessionsRef.current = sessions;
  activeRef.current = activeKey;
  onCloseLastRef.current = onCloseLast;
  existingOnlyRef.current = existingSessionsOnly;
  const activeView = views.find((item) => item.key === activeKey);
  const activeSession = sessions.find((item) => item.id === activeView?.sessionId);
  const status = activeKey ? statuses[activeKey] : undefined;
  const connection = status?.connection ?? (activeKey ? 'connecting' : 'idle');
  const creating = views.some((item) => !sessions.some((session) => session.id === item.sessionId) && !['closed', 'error'].includes(statuses[item.key]?.connection || 'connecting'));
  const connected = !locked && connection === 'connected';
  const handle = () => activeKey ? handles.current.get(activeKey) : undefined;

  useEffect(() => {
    mounted.current = true;
    const lock = () => { setLocked(true); ctrlRef.current = false; setCtrlPressed(false); };
    const unlock = () => setLocked(false);
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-unlocked', unlock);
    return () => { mounted.current = false; window.removeEventListener('codex:session-locked', lock); window.removeEventListener('codex:session-unlocked', unlock); };
  }, []);

  const register = useCallback((key: string, terminal: TerminalHandle | null) => {
    if (terminal) handles.current.set(key, terminal);
    else {
      handles.current.delete(key);
      setStatuses((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }, []);
  const ready = useCallback((key: string, message: ReadyMessage) => {
    setSessions((current) => [...new Map([...current, ...(message.sessions || []), message.session].map((session) => [session.id, session])).values()]);
    setViews((current) => current.filter((item) => item.key === key || item.sessionId !== message.session.id)
      .map((item) => item.key === key ? { ...item, sessionId: message.session.id } : item));
    if (activeRef.current === key) saveSelection(workspace.id, message.session.id);
  }, [workspace.id]);
  const report = useCallback((key: string, next: ViewStatus) => {
    setStatuses((current) => current[key]?.connection === next.connection && current[key]?.hasSelection === next.hasSelection ? current : { ...current, [key]: next });
    if (next.connection === 'closed') {
      const id = next.sessionId ?? viewsRef.current.find((item) => item.key === key)?.sessionId;
      if (id) setSessions((current) => current.map((session) => session.id === id ? { ...session, exited: true } : session));
    }
  }, []);
  const ctrlUsed = useCallback(() => setCtrlPressed(false), []);
  const select = (id: string, focus = true) => {
    if (closeRequests.current.has(id)) return;
    const existing = viewsRef.current.find((item) => item.sessionId === id);
    const next = existing || { key: crypto.randomUUID(), sessionId: id, focusOnReady: focus };
    if (!existing) { viewsRef.current = [...viewsRef.current, next]; setViews(viewsRef.current); }
    activeRef.current = next.key;
    setActiveKey(next.key);
    saveSelection(workspace.id, id);
    ctrlRef.current = false;
    setCtrlPressed(false);
    if (focus) requestAnimationFrame(() => handles.current.get(next.key)?.focus());
  };
  const create = () => {
    if (existingOnlyRef.current || locked || creating || sessions.length >= 8) return;
    const view = { key: crypto.randomUUID(), fresh: true };
    viewsRef.current = [...viewsRef.current.filter((item) => item.sessionId), view];
    setViews(viewsRef.current);
    activeRef.current = view.key;
    setActiveKey(view.key);
    ctrlRef.current = false;
    setCtrlPressed(false);
  };
  useEffect(() => {
    if (!existingSessionsOnly || locked) return;
    const controller = new AbortController();
    const workspaceId = workspace.id;
    void api<TerminalSession[]>(`/workspaces/${encodeURIComponent(workspaceId)}/terminals?existingOnly=1`, { signal: controller.signal }).then(retained => {
      if (controller.signal.aborted || !mounted.current || !existingOnlyRef.current || document.body.dataset.workspaceLocked === 'true') return;
      const available = retained.filter(session => !closedSessions.current.has(session.id));
      const sessions = [...new Map([...sessionsRef.current, ...available].map(session => [session.id, session])).values()];
      sessionsRef.current = sessions; setSessions(sessions);
      // An interrupted first handshake may have created a host session before
      // its directory vanished. Recover that explicit identity; never start one.
      if (!viewsRef.current.some(view => view.sessionId) && available.length) {
        const next = { key: crypto.randomUUID(), sessionId: available[0].id, focusOnReady: false };
        viewsRef.current = [next]; setViews([next]); activeRef.current = next.key; setActiveKey(next.key);
      }
    }).catch(error => { if (!controller.signal.aborted && mounted.current && existingOnlyRef.current && document.body.dataset.workspaceLocked !== 'true') onNotify(`Could not list retained terminals. ${errorMessage(error)}`, 'error'); });
    return () => controller.abort();
  }, [workspace.id, existingSessionsOnly, locked, onNotify]);
  const close = async (id: string) => {
    if (locked || closeRequests.current.has(id)) return;
    closeRequests.current.add(id);
    setClosingIds(new Set(closeRequests.current));
    const closingView = viewsRef.current.find((item) => item.sessionId === id);
    const restore = closingView ? handles.current.get(closingView.key)?.prepareClose() : undefined;
    try {
      try { await api(`/terminals/${id}`, json('DELETE', {})); }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
      closedSessions.current.add(id);
      const remainingSessions = sessionsRef.current.filter((session) => session.id !== id);
      const remaining = viewsRef.current.filter((item) => item.sessionId !== id);
      if (!remainingSessions.length && !remaining.length) {
        try {
          const key = `codex.terminal.${workspace.id}`;
          if (localStorage.getItem(key) === id) localStorage.removeItem(key);
        } catch { /* Storage can be disabled. */ }
      }
      if (!mounted.current) return;
      sessionsRef.current = remainingSessions;
      viewsRef.current = remaining;
      setSessions(remainingSessions);
      setViews(remaining);
      if (!remainingSessions.length && !remaining.length) {
        activeRef.current = null;
        setActiveKey(null);
        onCloseLastRef.current?.(workspace.id);
      } else if (!remaining.some((item) => item.key === activeRef.current)) {
        const next = remaining.filter((item) => !item.sessionId || !closeRequests.current.has(item.sessionId)).at(-1);
        if (next) {
          activeRef.current = next.key;
          setActiveKey(next.key);
          if (next.sessionId) saveSelection(workspace.id, next.sessionId);
        } else {
          const existing = remainingSessions.filter((session) => !closeRequests.current.has(session.id)).at(-1);
          if (existing) select(existing.id);
          else { activeRef.current = null; setActiveKey(null); }
        }
      }
    } catch (error) {
      restore?.();
      if (mounted.current) onNotify(errorMessage(error), 'error');
    } finally {
      closeRequests.current.delete(id);
      if (mounted.current) setClosingIds(new Set(closeRequests.current));
    }
  };
  const copy = async () => {
    const text = handle()?.selection();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); onNotify('Selection copied.', 'success'); }
    catch { onNotify('Clipboard access is unavailable. Use your browser’s copy action.', 'error'); }
  };
  const paste = async () => {
    try { const text = await navigator.clipboard.readText(); handle()?.paste(text); handle()?.focus(); }
    catch { onNotify('Clipboard access is unavailable. Paste with your keyboard instead.', 'error'); }
  };
  const touchKey = (value: string) => { handle()?.send(value); handle()?.focus(); };
  const exited = Boolean(activeSession?.exited || connection === 'closed');

  return <section className="terminal-panel" aria-label="Terminal sessions and output">
    <header className="terminal-topbar">
      <div className="terminal-tabs" role="tablist" aria-label="Terminal sessions">
        {sessions.map((session, index) => {
          const selected = session.id === activeView?.sessionId;
          const view = views.find((item) => item.sessionId === session.id);
          return <div className={`terminal-tab-group ${selected ? 'is-active' : ''}`} key={session.id} role="presentation">
            <button className="terminal-tab" role="tab" id={`terminal-tab-${session.id}`} aria-selected={selected} aria-controls={view ? `terminal-output-${view.key}` : undefined} aria-label={session.title} aria-description={session.exited ? 'Exited' : undefined} data-tooltip={session.title} tabIndex={selected ? 0 : -1} disabled={closingIds.has(session.id)} onClick={() => select(session.id)} onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % sessions.length;
              else if (event.key === 'ArrowLeft') next = (index + sessions.length - 1) % sessions.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = sessions.length - 1;
              else return;
              event.preventDefault();
              select(sessions[next].id, false);
              document.getElementById(`terminal-tab-${sessions[next].id}`)?.focus();
            }}><span className={`terminal-session-dot ${session.exited ? 'is-exited' : ''}`} /><span className="terminal-tab-title text-ellipsis" dir="auto">{session.title}</span>{session.exited && <span className="terminal-tab-status">Exited</span>}</button>
            <button className="terminal-tab-close" aria-label={`Close ${session.title}`} title="Close terminal and stop its shell" disabled={locked || closingIds.has(session.id)} onClick={() => void close(session.id)}>{closingIds.has(session.id) ? <LoaderCircle size={12} className="terminal-spin" /> : <X size={12} />}</button>
          </div>;
        })}
      </div>
      <div className="terminal-toolbar">
        <button className="icon-button terminal-extra-action" aria-label="Copy terminal selection" title="Copy selection" disabled={locked || !status?.hasSelection} onClick={() => void copy()}><Copy size={14} /></button>
        <button className="icon-button terminal-extra-action" aria-label="Paste into terminal" title="Paste" disabled={!connected} onClick={() => void paste()}><Clipboard size={14} /></button>
        <button className="icon-button" aria-label="Clear terminal output" title="Clear output" disabled={!connected} onClick={() => handle()?.clear()}><Eraser size={15} /></button>
        {existingSessionsOnly && !sessions.length && <button className="icon-button" aria-label="Close terminal view" title="Close terminal view" onClick={() => onCloseLastRef.current?.(workspace.id)} disabled={locked}><X size={16} /></button>}
        <button className={`icon-button terminal-new${exited ? ' terminal-new-after-exit' : ''}`} aria-label="New terminal" title={existingSessionsOnly ? 'Restore or choose a workspace before opening a new shell' : exited ? 'Open a new shell' : 'New terminal'} disabled={existingSessionsOnly || locked || creating || sessions.length >= 8} onClick={create}>{creating ? <LoaderCircle size={16} className="terminal-spin" /> : <Plus size={16} />}{exited && <span>New shell</span>}</button>
      </div>
    </header>
    {!activeKey && <div className="terminal-empty"><span className="terminal-empty-icon"><TerminalIcon size={24} /></span><div><h3>{existingSessionsOnly ? 'No retained terminals.' : 'Your workspace, one command away.'}</h3><p>{existingSessionsOnly ? 'Restore or choose a workspace before opening a shell.' : <>Open a shell in <strong>{workspace.name}</strong>.</>}</p>{!existingSessionsOnly && <code>{workspace.path}</code>}</div>{!existingSessionsOnly && <button className="button" disabled={locked || creating} onClick={create}><Plus size={14} />Open terminal</button>}</div>}
    {views.map((view) => <TerminalView key={view.key} workspace={workspace} view={view} active={view.key === activeKey} locked={locked} existingSessionsOnly={existingSessionsOnly} ctrlRef={ctrlRef} onCtrlUsed={ctrlUsed} onReady={ready} onStatus={report} register={register} onNotify={onNotify} />)}
    {activeKey &&
      <div className="terminal-touch-controls" aria-label="Terminal keyboard shortcuts">
        <button className={ctrlPressed ? 'is-pressed' : ''} aria-pressed={ctrlPressed} disabled={!connected} onPointerDown={(event) => event.preventDefault()} onClick={() => { ctrlRef.current = !ctrlRef.current; setCtrlPressed(ctrlRef.current); handle()?.focus(); }}>Ctrl</button>
        <button disabled={!connected} onPointerDown={(event) => event.preventDefault()} onClick={() => touchKey('\x03')} aria-label="Interrupt command, Control C">Ctrl C</button>
        <button disabled={!connected} onPointerDown={(event) => event.preventDefault()} onClick={() => touchKey('\t')}>Tab</button>
        <button disabled={!connected} onPointerDown={(event) => event.preventDefault()} onClick={() => touchKey('\x1b')}>Esc</button>
        <span className="terminal-touch-divider" />
        <button disabled={!connected} aria-label="Previous command, arrow up" onPointerDown={(event) => event.preventDefault()} onClick={() => touchKey('\x1b[A')}><ArrowUp size={16} /></button>
        <button disabled={!connected} aria-label="Next command, arrow down" onPointerDown={(event) => event.preventDefault()} onClick={() => touchKey('\x1b[B')}><ArrowDown size={16} /></button>
        <button disabled={!connected} aria-label="Arrow left" onPointerDown={(event) => event.preventDefault()} onClick={() => touchKey('\x1b[D')}><ArrowLeft size={16} /></button>
        <button disabled={!connected} aria-label="Arrow right" onPointerDown={(event) => event.preventDefault()} onClick={() => touchKey('\x1b[C')}><ArrowRight size={16} /></button>
        <button className="terminal-show-keyboard" aria-label="Show terminal keyboard" disabled={!connected} onClick={() => handle()?.focus()}><Keyboard size={17} /></button>
      </div>
    }
  </section>;
}

export function TerminalPanel(props: TerminalPanelProps) { return <WorkspaceTerminal key={props.workspace.id} {...props} />; }
export default TerminalPanel;
