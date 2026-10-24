/** Browser projections. Native paths, payload envelopes and RPC methods stay on the server. */
export const NATIVE_FILE_BYTES = 256 * 1024;
export const NATIVE_FILES_PAGE_SIZE = 40;
export const NATIVE_FILES_PAGE_MAX = 80;

export interface NativeFileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface NativeDirectoryPage {
  path: string;
  entries: NativeFileEntry[];
  nextCursor: string | null;
  total: number;
}

export interface NativeFileMetadata {
  path: string;
  kind: 'file' | 'directory';
  bytes: number;
  createdAtMs: number;
  modifiedAtMs: number;
  version: string | null;
  canReadWholeFile: boolean;
}

export interface NativeFileContents {
  path: string;
  dataBase64: string;
  bytes: number;
  /** SHA-256 of the complete file, never a window of a large file. */
  version: string;
}

export interface NativeFileMutationResult {
  path: string;
  version?: string;
  bytes?: number;
  /** Native removal retains the checked file in the existing file trash. */
  trashId?: string;
}

export interface NativeWatchPage {
  id: string;
  path: string;
  revision: number;
  paths: string[];
  truncated: boolean;
}

export interface NativeFileSearchMatch extends NativeFileEntry { score: number }
export interface NativeFileSearchPage {
  query: string;
  root: string;
  files: NativeFileSearchMatch[];
  nextCursor: string | null;
  total: number;
  truncated: boolean;
}

export interface NativeFileSearchSession extends NativeFileSearchPage {
  id: string;
  revision: number;
  status: 'searching' | 'ready' | 'complete' | 'error';
  error?: string;
}

export interface NativeThreadSearchMatch {
  threadId: string;
  title: string;
  snippet: string;
  updatedAt: string;
}

export interface NativeThreadSearchPage {
  matches: NativeThreadSearchMatch[];
  nextCursor: string | null;
}

export interface NativeThreadOccurrence {
  turnId: string;
  itemId: string;
  snippet: string;
  matchRange: { start: number; end: number };
  turnCursor: string;
}

export interface NativeThreadOccurrencePage {
  occurrences: NativeThreadOccurrence[];
  nextCursor: string | null;
}

export interface NativeThreadReference {
  id: string;
  kind: 'note' | 'workspace-file' | 'other';
  title: string;
  text?: string;
  path?: string;
  createdAt: number;
  /** Opaque, scoped deletion authority for this metadata record only. */
  reference: string;
}

export interface NativeThreadReferencesPage {
  references: NativeThreadReference[];
  nextCursor: string | null;
  revision: number;
}

export type NativeThreadReferenceInput = {
  kind: 'note'; clientId: string; title: string; text: string;
} | {
  kind: 'workspace-file'; clientId: string; title: string; path: string;
};
