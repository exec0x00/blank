import headless from '@xterm/headless';
import { clearTerminalHistory, restoreTerminalState, TERMINAL_SCROLLBACK_LINES, type TerminalReplayState } from '../shared/terminal-replay';

type RenderMessage =
  | { type: 'ready' | 'resize'; cols: number; rows: number }
  | { type: 'output'; data: string }
  | { type: 'replay-complete'; state: TerminalReplayState; pending: string }
  | { type: 'clear' | 'exit' | 'error' | 'pong' };

/** Inspect the actual terminal screen, not control bytes consumed by its parser. */
export async function renderedTerminal(messages: readonly RenderMessage[]): Promise<{ active: 'normal' | 'alternate'; normal: string[]; alternate: string[] }> {
  const ready = messages.find((message): message is Extract<RenderMessage, { type: 'ready' | 'resize' }> => message.type === 'ready');
  if (!ready) throw new Error('The terminal never sent screen dimensions.');
  const terminal = new headless.Terminal({ cols: ready.cols, rows: ready.rows, scrollback: TERMINAL_SCROLLBACK_LINES, allowProposedApi: true, disableStdin: true });
  const write = (data: string) => new Promise<void>(resolve => terminal.write(data, resolve));
  let completed = false;
  try {
    for (const message of messages) {
      if (message.type === 'output') await write(message.data);
      else if (message.type === 'replay-complete') {
        restoreTerminalState(terminal, message.state);
        await write(message.pending);
        completed = true;
      } else if (message.type === 'resize') terminal.resize(message.cols, message.rows);
      else if (message.type === 'clear') clearTerminalHistory(terminal);
    }
    if (!completed) throw new Error('The terminal did not finish restoring its screen.');
    const lines = (type: 'normal' | 'alternate') => Array.from({ length: terminal.buffer[type].length }, (_, index) => terminal.buffer[type].getLine(index)!.translateToString(true));
    return { active: terminal.buffer.active.type, normal: lines('normal'), alternate: lines('alternate') };
  } finally { terminal.dispose(); }
}
