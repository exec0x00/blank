/** Lightweight shell/editor contracts. Importing this module never loads Monaco. */
export interface EditorCommandScope {
  workspaceId: string;
  editorInstanceId: string;
  /** Changes when the session locks, without disposing any unsaved editor buffers. */
  generation: number;
}

export interface EditorToolbarState extends EditorCommandScope {
  ready: boolean;
  activePath: string | null;
  dirtyCount: number;
  dirty: boolean;
  saveDisabled: boolean;
  saving: boolean;
  hasConflict: boolean;
  missing: boolean;
  explorerVisible: boolean;
  explorerToggleDisabled: boolean;
}

export interface EditorActionDetail extends Partial<EditorCommandScope> {
  path?: string;
  line?: number;
  column?: number;
}

export interface EditorSaveFileDetail extends EditorCommandScope {
  path: string;
}

export type EditorActionType =
  | 'codex:quick-open'
  | 'codex:search-files'
  | 'codex:open-file'
  | 'codex:save-file'
  | 'codex:toggle-explorer';

let instanceSequence = 0;
export function createEditorInstanceId(): string {
  instanceSequence += 1;
  return `editor-${Date.now().toString(36)}-${instanceSequence.toString(36)}`;
}

/** Legacy navigation events may omit scope; toolbar mutations require all of it. */
export function matchesEditorCommandScope(detail: unknown, current: EditorCommandScope, requireScope = false): boolean {
  if (detail === undefined || detail === null) return !requireScope;
  if (typeof detail !== 'object' || Array.isArray(detail)) return false;
  const target = detail as Partial<EditorCommandScope>;
  return (target.workspaceId === undefined ? !requireScope : target.workspaceId === current.workspaceId)
    && (target.editorInstanceId === undefined ? !requireScope : target.editorInstanceId === current.editorInstanceId)
    && (target.generation === undefined ? !requireScope : target.generation === current.generation);
}
