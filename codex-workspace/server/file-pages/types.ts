/** Metadata never implies that the entire file has been read or validated. */
export interface WorkspaceFileInfo {
  path: string;
  size: number;
  /** Path-bound native identity, distinct from the small-file content digest. */
  version: string;
  language: string;
  paged: boolean;
  maxPageBytes: number;
  editable: boolean;
  readOnlyReason: string | null;
  /** Exact only after a contiguous scan reaches EOF; otherwise unknown. */
  totalLines: number | null;
}

export interface WorkspaceFilePage extends WorkspaceFileInfo {
  content: string;
  byteStart: number;
  /** Exclusive UTF-8 byte boundary. */
  byteEnd: number;
  startLine: number | null;
  /** The line containing the end boundary, including a final empty line. */
  endLine: number | null;
  startsMidLine: boolean;
  endsMidLine: boolean;
  /** Signed source identity, original range digest, and exact range. */
  pageToken: string;
  nextCursor: string | null;
  previousOffset: number | null;
}

export interface WorkspaceFileSearchMatch {
  byteStart: number;
  byteEnd: number;
  line: number;
  preview: string;
}

export interface WorkspaceFileSearchResult {
  path: string;
  size: number;
  version: string;
  query: string;
  caseSensitive: boolean;
  matches: WorkspaceFileSearchMatch[];
  /** Continue the same query with this cursor, never an unbounded server job. */
  nextCursor: string | null;
  complete: boolean;
  searchedFrom: number;
  scannedThrough: number;
  totalLines: number | null;
}

export interface FilePageReadInput { path: unknown; version?: unknown; offset?: unknown; cursor?: unknown }
export interface FilePageSearchInput { path: unknown; version: unknown; query: unknown; cursor?: unknown; caseSensitive?: unknown }
export interface FileRangeSaveInput { path: unknown; pageToken: unknown; content: unknown }

export interface WorkspaceFileRecovery {
  id: string;
  workspaceId: string;
  path: string;
  recoveryPath: string;
  completeCopy: boolean;
  state: 'running' | 'retained';
  phase: 'preparing' | 'ready' | 'committing' | 'confirming' | 'complete' | 'interrupted';
  createdAt: string;
  issue: string | null;
}
