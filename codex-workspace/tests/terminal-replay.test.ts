import { performance } from 'node:perf_hooks';
import headless from '@xterm/headless';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import { afterEach, expect, it } from 'vitest';
import { captureTerminalState, restoreTerminalState } from '../shared/terminal-replay';
import { TerminalReplay, terminalChunkEnd, TERMINAL_HISTORY_BYTES, TERMINAL_HISTORY_LINES, TERMINAL_OUTPUT_CHUNK,
  TERMINAL_PENDING_SEQUENCE, type TerminalSnapshot } from '../server/terminal-replay';

const resources: Array<{ dispose(): void }> = [];
const { Terminal } = headless;
afterEach(() => { for (const resource of resources.splice(0)) resource.dispose(); });
function emulator(cols = 80, rows = 24) {
  const terminal = new Terminal({ cols, rows, scrollback: TERMINAL_HISTORY_LINES, cursorStyle: 'bar', cursorBlink: true, allowProposedApi: true });
  resources.push(terminal); return terminal;
}
function replay(cols = 80, rows = 24, history = TERMINAL_HISTORY_LINES) {
  const source = new TerminalReplay(cols, rows, () => {}, history);
  resources.push(source); return source;
}
const write = (terminal: HeadlessTerminal, data: string) => new Promise<void>(resolve => terminal.write(data, resolve));
async function restore(snapshot: TerminalSnapshot) {
  const terminal = emulator(snapshot.cols, snapshot.rows);
  terminal.options.scrollback = Math.max(TERMINAL_HISTORY_LINES, snapshot.historyLines);
  terminal.options.disableStdin = true;
  await write(terminal, snapshot.data);
  restoreTerminalState(terminal, snapshot.state);
  await write(terminal, snapshot.pending);
  terminal.options.disableStdin = false;
  return terminal;
}
function screen(terminal: HeadlessTerminal, type: 'normal' | 'alternate' = terminal.buffer.active.type) {
  const buffer = terminal.buffer[type];
  return Array.from({ length: terminal.rows }, (_, y) => {
    const line = buffer.getLine(buffer.baseY + y);
    return { wrap: line?.isWrapped, cells: Array.from({ length: terminal.cols }, (_, x) => {
      const cell = line?.getCell(x);
      return cell && { text: cell.getChars(), width: cell.getWidth(), fg: cell.getFgColor(), bg: cell.getBgColor(),
        fgMode: cell.getFgColorMode(), bgMode: cell.getBgColorMode(), bold: cell.isBold(), inverse: cell.isInverse() };
    }) };
  });
}
function sameScreen(actual: HeadlessTerminal, expected: HeadlessTerminal) {
  expect(actual.buffer.active.type).toBe(expected.buffer.active.type);
  expect(screen(actual, 'normal')).toEqual(screen(expected, 'normal'));
  expect(screen(actual, 'alternate')).toEqual(screen(expected, 'alternate'));
  expect(captureTerminalState(actual)).toEqual(captureTerminalState(expected));
}

it('restores both screens, saved cursors, margins, colors, mouse, paste, keypad, charset and continuing TUI output', async () => {
  const source = replay(80, 24);
  source.write(Array.from({ length: 1600 }, (_, line) => `build ${line}: context\r\n`).join(''));
  source.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[1;38;2;10;160;230mTUI 你好 😀 e\u0301\x1b[0m'
    + '\x1b[2;4H\x1b[48;5;121m color \x1b[0m\x1b[3;20r\x1b[?6h\x1b[4;8H\x1b7'
    + '\x1b[?1h\x1b[?66h\x1b[?2004h\x1b[?1002h\x1b[?1006h\x1b[?25l\x1b[5 q'
    + '\x1b[6;2H\x1b(0lqqk');
  const snapshot = await source.snapshot();
  const restored = await restore(snapshot);
  sameScreen(restored, source.terminal);
  for (const continuation of ['qqq\x1b(B\x1b8SAVED\r\nnext\x1b[18;1Hscroll\nnext\nnext', '\x1b[?1049l\x1b[0m\r\nback in shell']) {
    source.write(continuation);
    await write(restored, continuation);
    await source.snapshot();
    sameScreen(restored, source.terminal);
  }
});

it('keeps a pending wrap column and custom tab stops after a snapshot', async () => {
  const source = replay(12, 6);
  source.write('\x1b[3g\x1b[1;4H\x1bH\x1b[1;9H\x1bH\x1b[1;1Habcdefghijkl');
  const target = await restore(await source.snapshot());
  expect(target.buffer.active.cursorX).toBe(12);
  source.write('Z\r\tT\tU');
  await write(target, 'Z\r\tT\tU');
  await source.snapshot();
  sameScreen(target, source.terminal);
});

it('preserves Unicode and unfinished CSI/OSC/DCS/ESC parser prefixes at every split', async () => {
  const sequences = ['\x1b[38;2;10;20;30m你好😀e\u0301', '\x1b]2;partial title\x1b\\X', '\x1bP$qm\x1b\\Z', '\x1b(0qq\x1b(B'];
  for (const sequence of sequences) {
    for (let offset = 1; offset < sequence.length; offset++) {
      const source = replay(24, 6);
      source.write(`before\r\n${sequence.slice(0, offset)}`);
      const target = await restore(await source.snapshot());
      source.write(sequence.slice(offset));
      await write(target, sequence.slice(offset));
      await source.snapshot();
      sameScreen(target, source.terminal);
      source.dispose(); target.dispose();
    }
  }
});

it('does not repeat executed controls inside a partial sequence, even across resize', async () => {
  const source = replay(20, 8);
  source.write('first\r\nsecond\x1b\n');
  source.resize(16, 6);
  const target = await restore(await source.snapshot());
  sameScreen(target, source.terminal);
  source.write('[2;3Hafter');
  await write(target, '[2;3Hafter');
  await source.snapshot();
  sameScreen(target, source.terminal);
});

it('replays no completed terminal queries and answers a newly completed live query once', async () => {
  const source = replay(20, 8);
  source.write('prompt\x1b[6n\x1b[6');
  const target = await restore(await source.snapshot());
  const replies: string[] = [];
  target.onData(data => replies.push(data));
  await write(target, 'n');
  expect(replies).toEqual(['\x1b[1;7R']);
  const again = await restore(await source.snapshot());
  const repeated: string[] = [];
  again.onData(data => repeated.push(data));
  await write(again, 'n');
  expect(repeated).toEqual(replies);
});

it('answers detached queries only for the output emitted before attachment', async () => {
  const replies: string[] = [];
  const source = new TerminalReplay(20, 8, () => {}, TERMINAL_HISTORY_LINES, data => replies.push(data));
  resources.push(source);
  source.write('x\x1b[6n', true);
  source.write('\x1b[6n', false);
  await source.snapshot();
  expect(replies).toEqual(['\x1b[1;2R']);
});

it('preserves bounded OSC palette/default colors and answers their queries only while detached', async () => {
  const replies: string[] = [];
  const source = new TerminalReplay(20, 8, () => {}, TERMINAL_HISTORY_LINES, data => replies.push(data));
  resources.push(source);
  source.write('\x1b]4;5;rgb:12/34/56\x1b\\\x1b]10;#abcdef\x1b\\', false);
  source.write('\x1b]4;5;?\x1b\\\x1b]10;?\x1b\\', false);
  await source.snapshot();
  expect(replies).toEqual([]);
  source.write('\x1b]4;5;?\x1b\\\x1b]10;?\x1b\\', true);
  const snapshot = await source.snapshot();
  expect(replies).toEqual(['\x1b]4;5;rgb:1212/3434/5656\x1b\\', '\x1b]10;rgb:abab/cdcd/efef\x1b\\']);
  expect(snapshot.data).toContain(replies[0]);
  expect(snapshot.data).toContain(replies[1]);
  expect(snapshot.data).not.toContain(';?');
  source.write('\x1b]104;5\x1b\\\x1b]110\x1b\\');
  const reset = await source.snapshot();
  expect(reset.data).not.toContain('1212/3434/5656');
  expect(reset.data).not.toContain('abab/cdcd/efef');
});

it('bounds recent normal rows and encoded history while preserving the complete current screen', async () => {
  const source = replay(100, 20);
  source.write('old context that must expire\r\n' + Array.from({ length: 3000 }, (_, index) => {
    const row = Array.from({ length: 90 }, (_, cell) => `\x1b[38;2;${index % 255};${cell};140m${cell % 10}`).join('');
    return `${index}: ${row}\x1b[0m\r\n`;
  }).join('') + 'recent prompt');
  const snapshot = await source.snapshot();
  const current = await source.snapshot(0);
  expect(snapshot.truncated).toBe(true);
  expect(snapshot.historyLines).toBeLessThanOrEqual(TERMINAL_HISTORY_LINES);
  expect(Buffer.byteLength(snapshot.data) - Buffer.byteLength(current.data)).toBeLessThanOrEqual(TERMINAL_HISTORY_BYTES);
  expect(snapshot.data).not.toContain('old context that must expire');
  expect(snapshot.data).toContain('recent prompt');
  expect(source.terminal.buffer.normal.length).toBeLessThanOrEqual(TERMINAL_HISTORY_LINES + source.terminal.rows);
  const target = await restore(snapshot);
  expect(screen(target)).toEqual(screen(source.terminal));
});

it('clears history without erasing the actual alternate-screen program or its modes', async () => {
  const source = replay(30, 8);
  source.write('old\r\n'.repeat(1000) + '\x1b[?1049h\x1b[H\x1b[?2004h\x1b[?1003h\x1b[?1006hTUI stays here');
  await source.snapshot();
  const before = screen(source.terminal);
  await source.clear();
  const snapshot = await source.snapshot();
  expect(snapshot.truncated).toBe(false);
  expect(snapshot.historyLines).toBe(0);
  expect(screen(source.terminal)).toEqual(before);
  const target = await restore(snapshot);
  expect(target.modes.bracketedPasteMode).toBe(true);
  expect(target.modes.mouseTrackingMode).toBe('any');
  expect(screen(target)).toEqual(before);
});

it('fails visibly during an oversized incomplete sequence and recovers after its real terminator', async () => {
  const source = replay();
  source.write('\x1b]2;' + 'x'.repeat(TERMINAL_PENDING_SEQUENCE + 1));
  await expect(source.snapshot()).rejects.toThrow('large control sequence');
  source.write('\x07recovered');
  expect((await source.snapshot()).data).toContain('recovered');
});

it('transport chunks are bounded and do not split UTF-16 pairs', () => {
  const input = 'a'.repeat(TERMINAL_OUTPUT_CHUNK - 1) + '😀'.repeat(TERMINAL_OUTPUT_CHUNK);
  const chunks: string[] = [];
  for (let offset = 0; offset < input.length;) {
    const end = terminalChunkEnd(input, offset);
    chunks.push(input.slice(offset, end)); offset = end;
  }
  expect(chunks.join('')).toBe(input);
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_CHUNK);
    expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  }
});

it('reports measured snapshot/parse cost for fixed history candidates and the former raw-tail baseline', async () => {
  const source = replay(100, 28, 5000);
  const output = Array.from({ length: 9000 }, (_, index) => `\x1b[38;5;${index % 255}m${String(index).padStart(5)}\x1b[0m build src/features/item-${index}.ts done, 你好 😀 useful recent context\r\n`).join('');
  source.write(output);
  await source.snapshot();
  const measurements: Array<{ lines: number | string; bytes: number; retainedLines?: number; snapshotMs: number; parseMs: number }> = [];
  for (const [lines, bytes] of [[100, 16 * 1024], [250, 32 * 1024], [500, 64 * 1024], [1000, 128 * 1024], [2000, 256 * 1024]]) {
    for (let sample = 0; sample < 3; sample++) {
      const start = performance.now();
      const snapshot = await source.snapshot(lines, bytes);
      const encoded = performance.now();
      const target = await restore(snapshot);
      const parsed = performance.now();
      measurements.push({ lines, bytes: Buffer.byteLength(snapshot.data), retainedLines: snapshot.historyLines, snapshotMs: encoded - start, parseMs: parsed - encoded });
      target.dispose();
    }
  }
  for (let sample = 0; sample < 3; sample++) {
    const target = emulator(100, 28);
    target.options.scrollback = 5000;
    const start = performance.now();
    await write(target, output.slice(-256 * 1024));
    measurements.push({ lines: 'previous-raw-tail', bytes: Buffer.byteLength(output.slice(-256 * 1024)), snapshotMs: 0, parseMs: performance.now() - start });
    target.dispose();
  }
  expect(measurements.every(result => Number.isFinite(result.parseMs) && result.parseMs >= 0)).toBe(true);
  console.info('Terminal replay candidates (local measured ms)', JSON.stringify(measurements));
});
