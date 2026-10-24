/**
 * Browser-safe compatibility adapter for the pinned xterm 5.5.0 pair.
 * SerializeAddon preserves cells, but omits saved cursors, scroll margins,
 * tab stops, charset selection, mouse encoding, and the pending-wrap column.
 * Keep private access in this one module and cover it with emulator-to-emulator
 * continuation tests before changing either xterm dependency.
 */
export const TERMINAL_SCROLLBACK_LINES = 500;
export const TERMINAL_THEME = {
  background: '#0a0a0a', foreground: '#ededed', cursor: '#ededed', cursorAccent: '#0a0a0a',
  selectionBackground: '#264f78', selectionInactiveBackground: '#3a3d41',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
  brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
} as const;
export type TerminalColorEvent = { type: 0 | 1 | 2; index?: number; color?: [number, number, number] };
type Charset = Record<string, string> | null;
interface Attributes { fg: number; bg: number; ext: number; urlId: number }
interface BufferState {
  x: number; y: number; scrollTop: number; scrollBottom: number;
  savedX: number; savedY: number; savedAttributes: Attributes;
  savedCharset: Charset; tabs: number[];
}
interface PrivateModes {
  applicationCursorKeys: boolean; applicationKeypad: boolean; bracketedPasteMode: boolean;
  origin: boolean; reverseWraparound: boolean; sendFocus: boolean; wraparound: boolean;
}
export interface TerminalReplayState {
  version: 1;
  normal: BufferState;
  alternate: BufferState;
  attributes: Attributes;
  charset: { active: Charset; level: number; sets: Charset[] };
  modes: PrivateModes & { insertMode: boolean };
  mouse: { protocol: string; encoding: string };
  cursor: { hidden: boolean; initialized: boolean; style: 'block' | 'underline' | 'bar'; blink: boolean };
  convertEol: boolean;
  joinState: number;
}

interface NativeAttributes {
  fg: number; bg: number;
  extended: { _ext: number; urlId: number; clone(): NativeAttributes['extended'] };
}
interface NativeBuffer {
  x: number; y: number; ybase: number; ydisp: number;
  scrollTop: number; scrollBottom: number; savedX: number; savedY: number;
  savedCurAttrData: NativeAttributes;
  savedCharset: Record<string, string> | undefined;
  tabs: Record<number, boolean | undefined>;
  lines: { onTrim(callback: (count: number) => void): { dispose(): void }; trimStart(count: number): void };
}
export interface TerminalCore {
  buffers: { normal: NativeBuffer; alt: NativeBuffer };
  _inputHandler: {
    _curAttrData: NativeAttributes;
    _parser: { _transitions: { table: Uint8Array }; precedingJoinState: number };
    onColor(callback: (events: TerminalColorEvent[]) => void): { dispose(): void };
  };
  _charsetService: { charset: Record<string, string> | undefined; glevel: number; _charsets: Array<Record<string, string> | undefined> };
  coreService: {
    isCursorHidden: boolean; isCursorInitialized: boolean;
    modes: { insertMode: boolean }; decPrivateModes: PrivateModes;
    triggerDataEvent(data: string, wasUserInput?: boolean): void;
  };
  coreMouseService: { activeProtocol: string; activeEncoding: string };
}
interface TerminalStateTarget {
  cols: number;
  rows: number;
  options: { convertEol?: boolean; cursorStyle?: 'block' | 'underline' | 'bar'; cursorBlink?: boolean };
}

export function clearTerminalHistory(terminal: TerminalStateTarget & { buffer: { active: { type: string } }; clear(): void }): void {
  if (terminal.buffer.active.type === 'normal') terminal.clear();
  const normal = terminalCore(terminal).buffers.normal;
  if (normal.ybase) {
    normal.lines.trimStart(normal.ybase);
    normal.savedY = Math.max(0, normal.savedY - normal.ybase);
    normal.ybase = 0; normal.ydisp = 0;
  }
}

export function terminalCore(terminal: unknown): TerminalCore {
  const core = (terminal as { _core?: TerminalCore })._core;
  if (!core?.buffers?.normal || !core.buffers.alt || !core._inputHandler?._curAttrData?.extended
    || !(core._inputHandler._parser?._transitions?.table instanceof Uint8Array)
    || core._inputHandler._parser._transitions.table.length !== 4095 || !core._charsetService
    || typeof core._inputHandler.onColor !== 'function' || !core.coreService?.decPrivateModes || !core.coreMouseService) {
    throw new Error('The terminal emulator cannot restore this session. Reload after updating the app.');
  }
  return core;
}

const charset = (value: Record<string, string> | undefined | null): Charset => value ? { ...value } : null;
const attributes = (value: NativeAttributes): Attributes => ({ fg: value.fg, bg: value.bg, ext: value.extended._ext, urlId: value.extended.urlId });
function bufferState(value: NativeBuffer, cols: number): BufferState {
  return { x: value.x, y: value.y, scrollTop: value.scrollTop, scrollBottom: value.scrollBottom,
    savedX: value.savedX, savedY: value.savedY - value.ybase, savedAttributes: attributes(value.savedCurAttrData),
    savedCharset: charset(value.savedCharset), tabs: Object.keys(value.tabs).map(Number).filter(column => value.tabs[column] && column >= 0 && column < cols) };
}

export function captureTerminalState(terminal: TerminalStateTarget): TerminalReplayState {
  const core = terminalCore(terminal);
  const currentCharset = core._charsetService;
  return {
    version: 1,
    normal: bufferState(core.buffers.normal, terminal.cols), alternate: bufferState(core.buffers.alt, terminal.cols),
    attributes: attributes(core._inputHandler._curAttrData),
    charset: { active: charset(currentCharset.charset), level: currentCharset.glevel, sets: currentCharset._charsets.slice(0, 4).map(charset) },
    modes: { ...core.coreService.decPrivateModes, insertMode: core.coreService.modes.insertMode },
    mouse: { protocol: core.coreMouseService.activeProtocol, encoding: core.coreMouseService.activeEncoding },
    cursor: { hidden: core.coreService.isCursorHidden, initialized: core.coreService.isCursorInitialized,
      style: terminal.options.cursorStyle ?? 'bar', blink: Boolean(terminal.options.cursorBlink) },
    convertEol: Boolean(terminal.options.convertEol), joinState: core._inputHandler._parser.precedingJoinState,
  };
}

function restoreAttributes(target: NativeAttributes, value: Attributes): void {
  target.fg = value.fg; target.bg = value.bg;
  target.extended = target.extended.clone();
  target.extended._ext = value.ext;
  // The addon does not transfer OSC hyperlink registrations. Never reuse an ID
  // belonging to the previous connection's link registry for new output.
  target.extended.urlId = 0;
}
function restoreBuffer(target: NativeBuffer, value: BufferState): void {
  target.x = value.x; target.y = value.y;
  target.scrollTop = value.scrollTop; target.scrollBottom = value.scrollBottom;
  target.savedX = value.savedX; target.savedY = target.ybase + value.savedY;
  restoreAttributes(target.savedCurAttrData, value.savedAttributes);
  target.savedCharset = charset(value.savedCharset) ?? undefined;
  target.tabs = Object.fromEntries(value.tabs.map(column => [column, true]));
}

/** Run only in the callback after the snapshot ANSI has been parsed. */
export function restoreTerminalState(terminal: TerminalStateTarget, value: TerminalReplayState): void {
  if (value.version !== 1 || !['NONE', 'X10', 'VT200', 'DRAG', 'ANY'].includes(value.mouse.protocol)
    || !['DEFAULT', 'SGR', 'SGR_PIXELS'].includes(value.mouse.encoding)) {
    throw new Error('This terminal snapshot is not supported. Reload the app to reconnect.');
  }
  const core = terminalCore(terminal);
  restoreBuffer(core.buffers.normal, value.normal);
  restoreBuffer(core.buffers.alt, value.alternate);
  restoreAttributes(core._inputHandler._curAttrData, value.attributes);
  core._charsetService.glevel = value.charset.level;
  core._charsetService._charsets = value.charset.sets.map(set => charset(set) ?? undefined);
  core._charsetService.charset = charset(value.charset.active) ?? undefined;
  const { insertMode, ...privateModes } = value.modes;
  core.coreService.modes.insertMode = insertMode;
  core.coreService.decPrivateModes = { ...privateModes };
  core.coreService.isCursorHidden = value.cursor.hidden;
  core.coreService.isCursorInitialized = value.cursor.initialized;
  core.coreMouseService.activeEncoding = value.mouse.encoding;
  // The native setter emits the event which installs actual browser handlers.
  core.coreMouseService.activeProtocol = value.mouse.protocol;
  terminal.options.cursorStyle = value.cursor.style;
  terminal.options.cursorBlink = value.cursor.blink;
  terminal.options.convertEol = value.convertEol;
  core._inputHandler._parser.precedingJoinState = value.joinState;
}

/** Classify xterm-generated replies without guessing from escape-string content. */
export function observeTerminalInput(terminal: unknown, listener: (data: string, userInput: boolean) => void): () => void {
  const service = terminalCore(terminal).coreService;
  const original = service.triggerDataEvent;
  service.triggerDataEvent = function(data, userInput = false) {
    listener(data, userInput);
    original.call(this, data, userInput);
  };
  return () => { service.triggerDataEvent = original; };
}
