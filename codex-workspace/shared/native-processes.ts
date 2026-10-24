/** Site-owned process handles are scoped to one workspace and native connection.
 * Raw app-server process IDs are never accepted for standalone task controls. */
export type NativeProcessKind = 'command' | 'process';
export type NativeProcessState = 'starting' | 'running' | 'stopping' | 'exited' | 'failed' | 'disconnected';

export interface NativeProcessSession {
  id: string;
  workspaceId: string;
  generation: string;
  kind: NativeProcessKind;
  command: string;
  tty: boolean;
  state: NativeProcessState;
  stdinOpen: boolean;
  rows: number;
  cols: number;
  createdAt: string;
  updatedAt: string;
  exitCode: number | null;
  error: string | null;
  outputLimited: boolean;
  latestSequence: number;
}

export interface NativeProcessCapabilities {
  command: boolean;
  process: boolean;
  shell: boolean;
  background: boolean;
}

export interface NativeProcessList {
  sessions: NativeProcessSession[];
  capabilities: NativeProcessCapabilities;
  generation: string | null;
  maxActive: number;
}

export interface NativeProcessOutputChunk {
  sequence: number;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface NativeProcessOutputPage {
  session: NativeProcessSession;
  chunks: NativeProcessOutputChunk[];
  nextSequence: number;
  oldestSequence: number;
  latestSequence: number;
  hasMore: boolean;
  truncatedBefore: boolean;
}

export interface NativeProcessStart {
  kind: NativeProcessKind;
  command: string;
  tty?: boolean;
  timeoutMs?: number;
  rows?: number;
  cols?: number;
}

export interface NativeBackgroundTerminal {
  itemId: string;
  processId: string;
  command: string;
  cwd: string;
  osPid: number | null;
  cpuPercent: number | null;
  /** Native integer normalized for JSON without unsafe bigint rounding. */
  rssKb: string | null;
}

export interface NativeBackgroundTerminalPage {
  data: NativeBackgroundTerminal[];
  nextCursor: string | null;
  generation: string;
}

export interface NativeThreadShellAcknowledgement {
  accepted: true;
  threadId: string;
  generation: string;
}
