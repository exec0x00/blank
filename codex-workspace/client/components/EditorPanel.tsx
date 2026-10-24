import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react';
import { AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, Braces, CaseSensitive, Check, CheckCheck, ChevronDown, ChevronRight, ChevronsDownUp, Circle, ClipboardPaste, Columns2, Copy, FileCode2, FilePlus2, Files, Folder, FolderInput, FolderOpen, FolderPlus, GitCompareArrows, LoaderCircle, Pencil, Plus, RefreshCw, Regex, Replace, RotateCcw, Scissors, Search, Settings2, Trash2, Upload, WrapText, X } from 'lucide-react';
import type { AppSettings, FileContent, FileEntry, FileTransferPage, FileTrashPage, FileTrashStatus, SearchMatch, Workspace } from '../../shared/types';
import { ApiError, api, json } from '../api';
import { getUiEditor, setUiEditor, useUiState } from '../ui-state';
import { startWorkspaceDownload } from '../downloads';
import { MAX_WORKSPACE_FOLDER_UPLOAD_FILES, MAX_WORKSPACE_UPLOAD_FILES, uploadWorkspaceFiles, WorkspaceUploadError, type WorkspaceUploadProgress } from '../uploads';
import { markScrollActivity } from '../scroll-activity';
import { comparisonUri, documentUri, monaco } from '../monaco';
import { EditorDialog } from './editor/EditorDialog';
import { ChangeReviewPanel } from './editor/ChangeReviewPanel';
import { validChangeReviewTarget, type ChangeReviewRequest } from './editor/change-review';
import { FileTransferHistory } from './editor/FileTransferHistory';
import { FILE_TRANSFER_PAGE_SIZE, fileTransferStatusLabel, readFileTransferPage, type FileTransferPageRequest, type FileTransferPageSnapshot } from './editor/file-transfer-pages';
import { ExplorerTree } from './editor/ExplorerTree';
import { LargeFileEditor, type LargeFileEditorHandle } from './editor/LargeFileEditor';
import { useDirectoryPages } from './editor/useDirectoryPages';
import { directoryAncestors, findDirectoryEntries } from './editor/directory-pages';
import { collectDirectoryHandle, collectExternalDrop, planSelectedFiles, prepareFolderUpload, uploadDestination, validateExplorerPath, type DroppedHandle, type FolderScanOptions, type FolderUploadPlan } from './editor/folder-drop';
import { FileIcon } from './editor/FileIcon';
import { EditorTabs } from './editor/EditorTabs';
import { EditorSkeleton } from './ui/Loading';
import UploadProgress from './UploadProgress';
import { createEditorInstanceId, matchesEditorCommandScope, type EditorActionDetail, type EditorToolbarState } from './editor/editor-actions';
import { DropdownContextMenu, DropdownMenu, SelectMenu } from './ui/Dropdown';
import { errorMessage, isDirty, isWithin, useDocuments, type OpenDocument } from './editor/useDocuments';
import PaneSplitter from './PaneSplitter';
import type { EditorPaneSizing } from '../usePaneSizing';
import './editor.css';

export interface EditorPanelProps {
  workspace: Workspace;
  settings: AppSettings;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  openPath?: string | null;
  onOpenPath?: (path: string) => void;
  onToolbarStateChange?: (state: EditorToolbarState) => void;
  paneSizing?: EditorPaneSizing;
  changeReview?: ChangeReviewRequest | null;
  visible?: boolean;
}

type Operation = { kind: 'file' | 'directory' | 'rename' | 'copy' | 'duplicate'; entry?: FileEntry; initialContent?: string };
type ContextMenu = { entry: FileEntry; x: number; y: number };
type TransferAction = 'move' | 'copy';
type ExplorerClipboard = { workspaceId: string; entry: FileEntry; action: TransferAction };
type ExplorerDrag = { id: string; workspaceId: string; entry: FileEntry };
type DropTarget = { directory: string; action: TransferAction; external: boolean; blocked?: string };
type UploadNotice = { message: string; active?: boolean; error?: boolean; fallback?: boolean; directory?: string };
type TrashEntry = FileTrashPage['items'][number];
type TrashRequestKind = 'entries' | 'status' | 'restore';
type TrashPageLocation = { cursor: string | null; page: number };
type ViewOptions = { minimap: boolean; lineNumbers: boolean; wrap: boolean | null };

const TRASH_PAGE_SIZE = 25;
const firstTrashPage = (): TrashPageLocation => ({ cursor: null, page: 1 });

const parentPath = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const baseName = (path: string) => path.split('/').at(-1) || path;
const EXPLORER_DRAG_TYPE = 'application/x-codex-workspace-entry';
const copyPath = (entry: FileEntry) => `${parentPath(entry.path) ? `${parentPath(entry.path)}/` : ''}${entry.kind === 'directory' ? `${entry.name}-copy` : entry.name.replace(/(\.[^.]*)?$/, '-copy$1')}`;
const visibleContent = (content: string) => content.startsWith('\uFEFF') ? content.slice(1) : content;
const platformShortcut = () => /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const languageLabels: Record<string, string> = {
  plaintext: 'Plain text', typescript: 'TypeScript', javascript: 'JavaScript',
  json: 'JSON', html: 'HTML', css: 'CSS', scss: 'SCSS', markdown: 'Markdown',
  python: 'Python', shell: 'Shell', yaml: 'YAML', sql: 'SQL', rust: 'Rust',
  go: 'Go', java: 'Java', cpp: 'C++', c: 'C', php: 'PHP', ruby: 'Ruby',
  xml: 'XML', dockerfile: 'Dockerfile', graphql: 'GraphQL', ini: 'INI',
  swift: 'Swift', kotlin: 'Kotlin', powershell: 'PowerShell', diff: 'Diff',
  csharp: 'C#', fsharp: 'F#', objectivec: 'Objective-C', lua: 'Lua', r: 'R',
};

function initialOptions(): ViewOptions {
  const value = getUiEditor();
  return { minimap: value.minimap === true, lineNumbers: value.lineNumbers !== false, wrap: typeof value.wrap === 'boolean' ? value.wrap : null };
}

function fuzzyScore(path: string, input: string) {
  const query = input.toLocaleLowerCase().trim();
  if (!query) return 0;
  const lower = path.toLocaleLowerCase();
  const name = baseName(lower);
  if (name === query) return 10000;
  if (name.startsWith(query)) return 8000 - name.length;
  if (name.includes(query)) return 6000 - name.indexOf(query) - name.length;
  if (lower.includes(query)) return 4000 - lower.indexOf(query) - lower.length;
  let cursor = -1;
  let score = 0;
  for (const character of query) {
    const found = lower.indexOf(character, cursor + 1);
    if (found === -1) return -1;
    score += found === cursor + 1 ? 8 : 1;
    cursor = found;
  }
  return score - lower.length / 1000;
}

function languageFor(document: OpenDocument) {
  const extension = baseName(document.path).split('.').at(-1)?.toLowerCase() || '';
  const aliases: Record<string, string> = { tsx: 'typescript', ts: 'typescript', mts: 'typescript', cts: 'typescript', jsx: 'javascript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', md: 'markdown', mdx: 'markdown', py: 'python', yml: 'yaml', jsonc: 'json', sh: 'shell', bash: 'shell', zsh: 'shell', rs: 'rust', rb: 'ruby', cs: 'csharp', h: 'c', svg: 'xml', html: 'html', css: 'css', scss: 'scss', json: 'json', go: 'go', java: 'java', cpp: 'cpp', txt: 'plaintext' };
  const guessed = aliases[extension] || document.language;
  return monaco.languages.getLanguages().some((language) => language.id === guessed) ? guessed : 'plaintext';
}

function watchEditorScroll(editor: monaco.editor.ICodeEditor): monaco.IDisposable {
  return editor.onDidScrollChange((event) => {
    if (!event.scrollTopChanged && !event.scrollLeftChanged) return;
    const element = editor.getDomNode();
    if (element) markScrollActivity(element);
  });
}

export function EditorPanel({ workspace, settings, onNotify, openPath, onOpenPath, onToolbarStateChange, paneSizing, changeReview, visible = true }: EditorPanelProps) {
  const documents = useDocuments(workspace, onNotify, {
    mutationPending: () => Boolean(fileOperationController.current || uploadController.current || trashRequests.current.restore),
    freezeWrites: () => {
      const workspaceId = workspace.id;
      const generation = fileScopeGeneration.current;
      const sessionGeneration = sessionRef.current.generation;
      const editors = [editorRef, splitEditorRef].flatMap(ref => ref.current
        ? [{ ref, editor: ref.current, readOnly: ref.current.getOption(monaco.editor.EditorOption.readOnly) }] : []);
      const release = () => {
        if (!fileScopeMounted.current || workspaceRef.current !== workspaceId || fileScopeGeneration.current !== generation
          || sessionRef.current.generation !== sessionGeneration || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
        for (const { ref, editor, readOnly } of editors) if (ref.current === editor) editor.updateOptions({ readOnly });
      };
      try { for (const { editor } of editors) editor.updateOptions({ readOnly: true, domReadOnly: true }); }
      catch (error) { release(); throw error; }
      return release;
    },
  });
  const active = documents.documents.find((document) => document.path === documents.activePath);
  const [editorInstanceId] = useState(createEditorInstanceId);
  const generationRef = useRef(0);
  const sessionRef = useRef({ locked: document.body.dataset.workspaceLocked === 'true', generation: 0 });
  const [editorSession, setEditorSession] = useState(sessionRef.current);
  const toolbarCallbackRef = useRef(onToolbarStateChange);
  toolbarCallbackRef.current = onToolbarStateChange;
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const largeEditorRef = useRef<LargeFileEditorHandle | null>(null);
  const splitEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const notifyRef = useRef(onNotify);
  const pathCallback = useRef(onOpenPath);
  const workspaceRef = useRef(workspace.id);
  const fileScopeMounted = useRef(true);
  const fileScopeGeneration = useRef(0);
  const fileOperationController = useRef<AbortController | null>(null);
  const saveRef = useRef(documents.saveDocument);
  const saveAllRef = useRef(documents.saveAll);
  const activePathRef = useRef(documents.activePath);
  const contentRef = useRef(documents.updateContent);
  const revealRef = useRef<{ path: string; line: number; column: number } | null>(null);
  notifyRef.current = onNotify;
  pathCallback.current = onOpenPath;
  workspaceRef.current = workspace.id;
  saveRef.current = documents.saveDocument;
  saveAllRef.current = documents.saveAll;
  activePathRef.current = documents.activePath;
  contentRef.current = (path, content) => {
    const accepted = documents.updateContent(path, content);
    if (!accepted && fileScopeMounted.current && workspaceRef.current === workspace.id) {
      const current = documents.documentsRef.current.find(file => file.path === path);
      const model = monaco.editor.getModel(monaco.Uri.parse(documentUri(workspace.id, path)));
      // A delayed formatter/model event must not leave a rejected write visible
      // or available in Monaco's undo history while React keeps the old buffer.
      if (current && model && !model.isDisposed() && model.getValue() !== visibleContent(current.content)) model.setValue(visibleContent(current.content));
    }
    return accepted;
  };
  const base = `/workspaces/${encodeURIComponent(workspace.id)}`;

  const { tree, treeRef, loading: loadingDirectories, errors: treeErrors, paging: directoryPaging,
    cache: directoryCache, loadDirectory, loadMore, retryDirectory } = useDirectoryPages(workspace.id,
    () => fileScopeMounted.current && !sessionRef.current.locked && document.body.dataset.workspaceLocked !== 'true');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  directoryCache.preservePaths([documents.activePath, selectedEntry?.path]);
  const [sidebarTab, setSidebarTab] = useState<'files' | 'search'>('files');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [mobileView, setMobileView] = useState<'files' | 'editor'>('files');
  const [width, setWidth] = useState(900);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const internalDrag = useRef<ExplorerDrag | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const dragExpandTimer = useRef<{ directory: string; timer: number } | null>(null);
  const [fileClipboard, setFileClipboard] = useState<ExplorerClipboard | null>(null);
  const [transferNotice, setTransferNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [fileTransferSnapshot, setFileTransferSnapshot] = useState<FileTransferPageSnapshot | null>(null);
  const fileTransfersPage = fileTransferSnapshot?.workspaceId === workspace.id ? fileTransferSnapshot.page : null;
  const fileTransfers = fileTransfersPage?.items ?? [];
  const fileTransfersPageRef = useRef<FileTransferPage | null>(null);
  fileTransfersPageRef.current = fileTransfersPage;
  const [fileTransfersQuery, setFileTransfersQuery] = useState('');
  const fileTransfersRequest = useRef<FileTransferPageRequest>({ offset: 0, q: '' });
  const fileTransfersSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fileTransfersError, setFileTransfersError] = useState('');
  const [fileTransfersLoading, setFileTransfersLoading] = useState(false);
  const [fileTransfersOpen, setFileTransfersOpen] = useState(false);
  const fileTransfersRead = useRef<AbortController | null>(null);
  const fileTransferInspectRead = useRef<AbortController | null>(null);
  const [fileTransferInspecting, setFileTransferInspecting] = useState<string | null>(null);
  const [fileTransferInspectError, setFileTransferInspectError] = useState('');
  const fileTransferRevealSequence = useRef(0);
  const [fileTransferReveal, setFileTransferReveal] = useState<{ id: number; path: string; workspaceId: string; generation: number } | null>(null);
  const fileTransfersRef = useRef(fileTransfers);
  fileTransfersRef.current = fileTransfers;
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<UploadNotice | null>(null);
  const [uploadTransfers, setUploadTransfers] = useState<WorkspaceUploadProgress[]>([]);
  const uploadController = useRef<AbortController | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const folderUploadRef = useRef<HTMLInputElement>(null);
  const uploadChoice = useRef<{ workspaceId: string; generation: number; directory: string; folder: boolean } | null>(null);

  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [include, setInclude] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchSignature, setSearchSignature] = useState('');
  const [searchRevision, setSearchRevision] = useState(0);
  const [showReplace, setShowReplace] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [replacing, setReplacing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const signature = JSON.stringify([query, caseSensitive, regex, include]);

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [quickPaths, setQuickPaths] = useState<string[]>([]);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [quickSelection, setQuickSelection] = useState(0);
  const quickResults = useMemo(() => quickPaths.map((path) => ({ path, score: fuzzyScore(path, quickQuery) })).filter((item) => item.score >= 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 70).map((item) => item.path), [quickPaths, quickQuery]);

  const [operation, setOperation] = useState<Operation | null>(null);
  const [operationPath, setOperationPath] = useState('');
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextTriggerRef = useRef<HTMLElement | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState('');
  const [trashPage, setTrashPage] = useState<TrashPageLocation>(firstTrashPage);
  const [trashPreviousCursor, setTrashPreviousCursor] = useState<string | null>(null);
  const [trashNextCursor, setTrashNextCursor] = useState<string | null>(null);
  const [trashUnavailable, setTrashUnavailable] = useState(0);
  const [trashRestartRequired, setTrashRestartRequired] = useState(false);
  const trashPageAttempt = useRef<TrashPageLocation>(firstTrashPage());
  const [trashIssue, setTrashIssue] = useState('');
  const [trashStatusError, setTrashStatusError] = useState('');
  const [trashStatusLoading, setTrashStatusLoading] = useState(false);
  const [trashRestoreError, setTrashRestoreError] = useState('');
  const [trashNow, setTrashNow] = useState(Date.now);
  const [restoringId, setRestoringId] = useState('');
  const trashMounted = useRef(true);
  const trashOpenRef = useRef(false);
  const trashGeneration = useRef(0);
  const trashRequests = useRef<Record<TrashRequestKind, AbortController | null>>({ entries: null, status: null, restore: null });

  const cancelTrashRequests = useCallback(() => {
    trashGeneration.current += 1;
    for (const kind of ['entries', 'status', 'restore'] as const) {
      trashRequests.current[kind]?.abort();
      trashRequests.current[kind] = null;
    }
  }, []);

  useEffect(() => {
    trashMounted.current = true;
    const reset = () => {
      cancelTrashRequests();
      trashOpenRef.current = false;
      setTrashOpen(false); setTrash([]); setTrashLoading(false); setTrashError('');
      setTrashPage(firstTrashPage()); setTrashPreviousCursor(null); setTrashNextCursor(null); setTrashUnavailable(0); setTrashRestartRequired(false);
      trashPageAttempt.current = firstTrashPage();
      setTrashIssue(''); setTrashStatusError(''); setTrashStatusLoading(false); setTrashRestoreError(''); setRestoringId('');
    };
    reset();
    window.addEventListener('codex:session-locked', reset);
    window.addEventListener('codex:session-expired', reset);
    return () => {
      trashMounted.current = false;
      trashOpenRef.current = false;
      cancelTrashRequests();
      window.removeEventListener('codex:session-locked', reset);
      window.removeEventListener('codex:session-expired', reset);
    };
  }, [workspace.id, cancelTrashRequests]);

  useEffect(() => {
    if (!trashOpen) return;
    let timer = 0;
    const tick = () => {
      const now = Date.now();
      setTrashNow(now);
      const delay = trash.reduce((delay, entry) => {
        const remaining = Date.parse(entry.expiresAt) - now;
        return remaining > 0 ? Math.min(delay, remaining + 1) : delay;
      }, 60_000);
      timer = window.setTimeout(tick, delay);
    };
    const refresh = () => { window.clearTimeout(timer); tick(); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    tick();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [trashOpen, trash]);

  useUiState();
  const viewOptions = initialOptions();
  const setViewOptions = (update: (value: ViewOptions) => ViewOptions) => setUiEditor(update(initialOptions()));
  const [compare, setCompare] = useState<'saved' | 'disk' | null>(null);
  const [review, setReview] = useState<ChangeReviewRequest | null>(null);
  const [reviewActive, setReviewActive] = useState(false);
  const reviewActiveRef = useRef(reviewActive);
  reviewActiveRef.current = reviewActive;
  const comparisonModelRef = useRef<string | null>(null);
  comparisonModelRef.current = compare && active ? comparisonUri(workspace.id, active.path) : null;
  const [split, setSplit] = useState(false);
  const [splitPath, setSplitPath] = useState('');
  const [languageOverrides, setLanguageOverrides] = useState<Record<string, string>>({});
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [diagnostics, setDiagnostics] = useState({ errors: 0, warnings: 0 });
  const [reduceMotion, setReduceMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const theme = 'codex-dark';
  const activeLanguage = active ? (Object.hasOwn(languageOverrides, active.path) ? languageOverrides[active.path] : undefined) || languageFor(active) : 'plaintext';
  const splitDocument = documents.documents.find((document) => document.path === splitPath) || active;
  const dirtyCount = documents.documents.filter(isDirty).length;
  const dirtyPaths = useMemo(() => new Set(documents.documents.filter(isDirty).map((document) => document.path)), [documents.documents]);
  const selectedDirectory = selectedEntry?.kind === 'directory' ? selectedEntry.path : selectedEntry ? parentPath(selectedEntry.path) : '';
  const activeDirty = Boolean(active && isDirty(active));
  const activeSaving = Boolean(active?.saving);
  const activeTransferring = Boolean(active?.transferring);
  const activeConflict = Boolean(active?.external || active?.externalInfo || active?.largeFile?.conflict);
  const activeMissing = Boolean(active?.missing);
  const activeReadOnly = Boolean(active?.externalInfo || (active?.largeFile && (!active.largeFile.page?.editable || active.largeFile.loading)));
  const compactNavigation = !paneSizing?.wide && width <= 640;
  const toolbarState = useMemo<EditorToolbarState>(() => ({
    workspaceId: workspace.id,
    editorInstanceId,
    generation: editorSession.generation,
    ready: !editorSession.locked,
    activePath: reviewActive ? null : active?.path || null,
    dirtyCount,
    dirty: !reviewActive && activeDirty,
    saveDisabled: reviewActive || editorSession.locked || !active || activeSaving || activeTransferring || activeReadOnly || (!activeDirty && !activeConflict),
    saving: !reviewActive && activeSaving,
    hasConflict: !reviewActive && (activeConflict || activeMissing),
    missing: !reviewActive && activeMissing,
    explorerVisible: compactNavigation ? mobileView === 'files' : !sidebarHidden,
    explorerToggleDisabled: editorSession.locked || (compactNavigation && !active && !reviewActive),
  }), [workspace.id, editorInstanceId, editorSession, active?.path, dirtyCount, activeDirty, activeSaving, activeTransferring, activeConflict, activeMissing, activeReadOnly, compactNavigation, mobileView, sidebarHidden, reviewActive]);
  const toolbarStateRef = useRef(toolbarState);
  toolbarStateRef.current = toolbarState;

  const clearDrag = useCallback(() => {
    if (dragExpandTimer.current) window.clearTimeout(dragExpandTimer.current.timer);
    dragExpandTimer.current = null;
    internalDrag.current = null;
    dropTargetRef.current = null;
    setDropTarget(null); setDragPath(null);
  }, []);

  const toggleExplorer = useCallback(() => {
    if (compactNavigation) {
      const hasActiveFile = reviewActiveRef.current || documents.documentsRef.current.some((document) => document.path === activePathRef.current);
      setMobileView((view) => view === 'files' && hasActiveFile ? 'editor' : 'files');
      setSidebarHidden(false);
    } else setSidebarHidden((hidden) => !hidden);
  }, [compactNavigation, documents.documentsRef]);

  const refreshTree = useCallback(() => {
    void loadDirectory('', true);
    for (const path of expandedRef.current) void loadDirectory(path, true);
  }, [loadDirectory]);

  const revealTreePath = useCallback((path: string) => {
    const parents = directoryAncestors(path).filter(Boolean);
    setExpanded(previous => new Set([...previous, ...parents]));
    void directoryCache.revealPath(path);
  }, [directoryCache]);

  const announceChange = useCallback(() => {
    window.dispatchEvent(new CustomEvent('codex:workspace-changed', { detail: { workspaceId: workspace.id, source: 'editor' } }));
  }, [workspace.id]);

  const refreshFileTransfers = useCallback(async (force = false, input: FileTransferPageRequest = fileTransfersRequest.current) => {
    if (!fileScopeMounted.current || workspaceRef.current !== workspace.id || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    if ((fileTransfersRead.current || fileTransfersSearchTimer.current) && !force) return;
    if (fileTransfersSearchTimer.current) clearTimeout(fileTransfersSearchTimer.current);
    fileTransfersSearchTimer.current = null;
    fileTransfersRead.current?.abort();
    const controller = new AbortController(); fileTransfersRead.current = controller;
    const workspaceId = workspace.id; const generation = fileScopeGeneration.current;
    const requested = { offset: input.offset, q: input.q };
    fileTransfersRequest.current = requested;
    const current = () => fileScopeMounted.current && !controller.signal.aborted && fileTransfersRead.current === controller
      && workspaceRef.current === workspaceId && generation === fileScopeGeneration.current && !sessionRef.current.locked && document.body.dataset.workspaceLocked !== 'true';
    setFileTransfersLoading(true); setFileTransfersError('');
    try {
      const parameters = new URLSearchParams({ offset: String(requested.offset), limit: String(FILE_TRANSFER_PAGE_SIZE) });
      if (requested.q) parameters.set('q', requested.q);
      const response = await api<FileTransferPage>(`${base}/file-transfers/page?${parameters}`, { signal: controller.signal });
      if (!current()) return;
      const page = readFileTransferPage(response, workspaceId);
      fileTransfersPageRef.current = page;
      fileTransfersRequest.current = { offset: page.offset, q: requested.q };
      setFileTransferSnapshot({ workspaceId, query: requested.q, page });
    } catch (error) { if (current()) setFileTransfersError(errorMessage(error)); }
    finally { if (current()) { fileTransfersRead.current = null; setFileTransfersLoading(false); } }
  }, [workspace.id, base]);

  const cancelFileTransferInspection = useCallback(() => {
    fileTransferInspectRead.current?.abort(); fileTransferInspectRead.current = null;
    fileTransferRevealSequence.current++;
    if (fileScopeMounted.current) { setFileTransferInspecting(null); setFileTransferInspectError(''); setFileTransferReveal(null); }
  }, []);

  const searchFileTransfers = (value: string) => {
    if (!fileScopeMounted.current || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    const query = value.slice(0, 160), request = { offset: 0, q: query.trim() };
    cancelFileTransferInspection();
    fileTransfersRead.current?.abort(); fileTransfersRead.current = null;
    if (fileTransfersSearchTimer.current) clearTimeout(fileTransfersSearchTimer.current);
    fileTransfersRequest.current = request; fileTransfersPageRef.current = null;
    setFileTransferSnapshot(null); setFileTransfersQuery(query); setFileTransfersError(''); setFileTransfersLoading(true);
    const scope = fileScopeGeneration.current, workspaceId = workspace.id;
    fileTransfersSearchTimer.current = setTimeout(() => {
      fileTransfersSearchTimer.current = null;
      if (fileScopeMounted.current && scope === fileScopeGeneration.current && workspaceRef.current === workspaceId) void refreshFileTransfers(true, request);
    }, 220);
  };

  const pageFileTransfers = (direction: -1 | 1) => {
    const page = fileTransfersPageRef.current;
    if (!page || fileTransfersRead.current || fileTransfersSearchTimer.current || direction === -1 && page.offset === 0 || direction === 1 && !page.hasMore) return;
    cancelFileTransferInspection();
    void refreshFileTransfers(true, { offset: Math.max(0, page.offset + direction * page.limit), q: fileTransfersRequest.current.q });
  };

  const openFileTransfers = () => {
    if (!fileScopeMounted.current || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    cancelFileTransferInspection();
    setFileTransfersOpen(true);
    void refreshFileTransfers(true);
  };

  const closeFileTransfers = () => {
    cancelFileTransferInspection();
    setFileTransfersOpen(false);
    // Closed-dialog status checks always describe all unfinished operations,
    // never a search result or an older page masquerading as a global count.
    if (fileTransfersRequest.current.q || fileTransfersRequest.current.offset || fileTransfersPageRef.current?.offset) {
      fileTransfersRequest.current = { offset: 0, q: '' }; fileTransfersPageRef.current = null;
      setFileTransfersQuery(''); setFileTransferSnapshot(null);
      void refreshFileTransfers(true, { offset: 0, q: '' });
    }
  };

  const inspectFileTransferPath = async (path: string) => {
    if (!fileScopeMounted.current || workspaceRef.current !== workspace.id || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    // Inspect only a path from the current validated page. A stale dialog cannot
    // choose an unrelated workspace path after a search or page replacement.
    if (!fileTransfersPageRef.current?.items.some(entry => entry.path === path || entry.newPath === path)) return;
    cancelFileTransferInspection();
    const controller = new AbortController(); fileTransferInspectRead.current = controller;
    const workspaceId = workspace.id, generation = fileScopeGeneration.current;
    setFileTransferInspecting(path);
    const current = () => fileScopeMounted.current && fileTransferInspectRead.current === controller && !controller.signal.aborted
      && workspaceRef.current === workspaceId && fileScopeGeneration.current === generation && !!rootRef.current?.getClientRects().length
      && !sessionRef.current.locked && document.body.dataset.workspaceLocked !== 'true';
    try {
      const entry = await directoryCache.revealEntry(path, controller.signal);
      if (!current()) return;
      if (!entry) { setFileTransferInspectError(`${path} is unavailable. Inspect the other location or refresh the file list.`); return; }
      // Keep the actual editor model and active tab. Selecting a tree row is a
      // separate action from opening its file or replacing an unsaved buffer.
      closeFileTransfers();
      directoryCache.focusPath(entry.path);
      setExpanded(previous => new Set([...previous, ...directoryAncestors(entry.path).filter(Boolean)]));
      setSelectedEntry(entry); setSidebarHidden(false); setSidebarTab('files'); setMobileView('files');
      setFileTransferReveal({ id: ++fileTransferRevealSequence.current, path: entry.path, workspaceId, generation });
    } catch (error) { if (current()) setFileTransferInspectError(errorMessage(error)); }
    finally { if (fileTransferInspectRead.current === controller) { fileTransferInspectRead.current = null; setFileTransferInspecting(null); } }
  };

  const fileTransfersStatus = fileTransferStatusLabel(fileTransfersPage, fileTransfersError);

  useEffect(() => {
    fileScopeMounted.current = true;
    fileScopeGeneration.current += 1;
    cancelFileTransferInspection();
    const cancelRequests = () => {
      fileScopeGeneration.current += 1;
      directoryCache.cancel();
      fileOperationController.current?.abort(); fileOperationController.current = null;
      fileTransfersRead.current?.abort(); fileTransfersRead.current = null;
      cancelFileTransferInspection();
      if (fileTransfersSearchTimer.current) clearTimeout(fileTransfersSearchTimer.current);
      fileTransfersSearchTimer.current = null;
      uploadController.current?.abort(); uploadController.current = null;
      uploadChoice.current = null;
      if (dragExpandTimer.current) window.clearTimeout(dragExpandTimer.current.timer);
      dragExpandTimer.current = null;
      internalDrag.current = null; dropTargetRef.current = null;
    };
    const cancelForLock = () => {
      cancelRequests();
      setUploading(false); setUploadTransfers([]); setUploadNotice(null); setDropTarget(null); setDragPath(null);
      setFileClipboard(null); setTransferNotice(null); setOperationBusy(false); setOperation(null); setReplacing(false);
      fileTransfersRequest.current = { offset: 0, q: '' }; fileTransfersPageRef.current = null;
      setFileTransferSnapshot(null); setFileTransfersQuery(''); setFileTransfersError(''); setFileTransfersLoading(false); setFileTransfersOpen(false);
    };
    setUploading(false); setUploadTransfers([]); setUploadNotice(null); setDropTarget(null); setDragPath(null);
    setFileClipboard(null); setTransferNotice(null); setOperationBusy(false); setReplacing(false);
    fileTransfersRequest.current = { offset: 0, q: '' }; fileTransfersPageRef.current = null;
    setFileTransferSnapshot(null); setFileTransfersQuery(''); setFileTransfersError(''); setFileTransfersLoading(false); setFileTransfersOpen(false);
    window.addEventListener('codex:session-locked', cancelForLock);
    window.addEventListener('codex:session-expired', cancelForLock);
    window.addEventListener('dragend', clearDrag);
    window.addEventListener('drop', clearDrag);
    return () => {
      fileScopeMounted.current = false;
      cancelRequests();
      window.removeEventListener('codex:session-locked', cancelForLock);
      window.removeEventListener('codex:session-expired', cancelForLock);
      window.removeEventListener('dragend', clearDrag);
      window.removeEventListener('drop', clearDrag);
    };
  }, [workspace.id, clearDrag, directoryCache, cancelFileTransferInspection]);

  useEffect(() => {
    const refresh = () => { void refreshFileTransfers(); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('codex:session-unlocked', refresh);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && rootRef.current?.getClientRects().length
        && (fileOperationController.current || fileTransfersRef.current.some(entry => entry.state === 'running'))) refresh();
    }, 5000);
    return () => {
      window.clearInterval(timer); fileTransfersRead.current?.abort(); fileTransfersRead.current = null;
      window.removeEventListener('focus', refresh); window.removeEventListener('codex:session-unlocked', refresh);
    };
  }, [refreshFileTransfers]);

  useEffect(() => {
    directoryCache.reset();
    expandedRef.current = new Set();
    setExpanded(new Set());
    setSelectedEntry(null); setMobileView('files'); setQuery(''); setMatches([]); setSearchError('');
    setQuickOpen(false); setQuickPaths([]); setContextMenu(null); setOperation(null); setTrashOpen(false);
    setCompare(null); setSplit(false); setSplitPath(''); setLanguageOverrides({}); setUploading(false);
    setReview(null); setReviewActive(false);
    revealRef.current = null;
    void loadDirectory('', true);
  }, [workspace.id, loadDirectory, directoryCache]);

  useEffect(() => {
    if (!changeReview) { setReview(null); setReviewActive(false); return; }
    if (!validChangeReviewTarget(changeReview.target) || changeReview.target.workspaceId !== workspace.id
      || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    setReview(changeReview); setReviewActive(true); setMobileView('editor');
    revealRef.current = null;
  }, [changeReview, workspace.id]);

  useEffect(() => {
    if (documents.activePath && documents.documentsRef.current.some(file => file.path === documents.activePath)) revealTreePath(documents.activePath);
  }, [documents.activePath, Boolean(active), revealTreePath, documents.documentsRef]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => { const width = entries[0]?.contentRect.width; if (width) setWidth(width); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReduceMotion(motion.matches);
    motion.addEventListener('change', onMotion);
    return () => motion.removeEventListener('change', onMotion);
  }, []);

  useEffect(() => { monaco.editor.setTheme(theme); }, [theme]);

  useEffect(() => {
    const uri = comparisonModelRef.current;
    if (!uri) return;
    return () => {
      // @monaco-editor/react otherwise disposes this model before its diff widget.
      window.setTimeout(() => {
        if (comparisonModelRef.current !== uri) monaco.editor.getModel(monaco.Uri.parse(uri))?.dispose();
      }, 0);
    };
  }, [Boolean(compare), active?.path, workspace.id]);

  const revealPending = useCallback(() => {
    if (reviewActiveRef.current) return;
    const pending = revealRef.current;
    const editor = editorRef.current;
    if (!pending || !editor || editor.getModel()?.uri.toString() !== documentUri(workspaceRef.current, pending.path)) return;
    const file = documents.documentsRef.current.find((document) => document.path === pending.path);
    const position = { lineNumber: pending.line, column: Math.max(1, pending.column - (pending.line === 1 && file?.content.startsWith('\uFEFF') ? 1 : 0)) };
    editor.setPosition(position);
    editor.revealPositionInCenter(position, reduceMotion ? monaco.editor.ScrollType.Immediate : monaco.editor.ScrollType.Smooth);
    editor.focus();
    revealRef.current = null;
  }, [reduceMotion, documents.documentsRef]);

  const activatePath = useCallback(async (path: string, line?: number, column?: number) => {
    setReviewActive(false);
    if (line) revealRef.current = { path, line, column: column || 1 };
    else revealRef.current = null;
    setMobileView('editor');
    const file = await documents.openDocument(path);
    if (file) {
      pathCallback.current?.(path);
      if (file.largeFile && line) {
        revealRef.current = null;
        void documents.largeDocuments.seekLine(path, line, column || 1);
        return;
      }
      // Reopening the active file at a new location does not change path state.
      requestAnimationFrame(revealPending);
    }
  }, [documents.openDocument, documents.largeDocuments, revealPending]);

  useEffect(() => { const frame = requestAnimationFrame(revealPending); return () => cancelAnimationFrame(frame); }, [documents.activePath, active?.content, revealPending, compare]);
  useEffect(() => { if (openPath) void activatePath(openPath); }, [openPath, workspace.id, activatePath]);

  useEffect(() => {
    const accepts = (event: Event, requireScope = false) => document.body.dataset.workspaceLocked !== 'true'
      && !sessionRef.current.locked
      && matchesEditorCommandScope((event as CustomEvent<EditorActionDetail>).detail, {
        workspaceId: workspace.id, editorInstanceId, generation: generationRef.current,
      }, requireScope);
    const quick = (event: Event) => { if (!accepts(event)) return; setQuickQuery(''); setQuickSelection(0); setQuickOpen(true); };
    const open = (event: Event) => {
      if (!accepts(event)) return;
      const detail = (event as CustomEvent<EditorActionDetail>).detail;
      if (typeof detail?.path !== 'string' || !detail.path) return;
      const line = Number.isInteger(detail.line) && Number(detail.line) > 0 ? detail.line : undefined;
      const column = Number.isInteger(detail.column) && Number(detail.column) > 0 ? detail.column : undefined;
      void activatePath(detail.path, line, column);
    };
    const search = (event: Event) => { if (!accepts(event)) return; setSidebarHidden(false); setSidebarTab('search'); setMobileView('files'); window.setTimeout(() => searchRef.current?.focus(), 0); };
    const save = (event: Event) => {
      if (!accepts(event, true) || reviewActiveRef.current) return;
      const detail = (event as CustomEvent<EditorActionDetail>).detail;
      const file = documents.documentsRef.current.find((document) => document.path === activePathRef.current);
      if (!file || detail?.path !== file.path || file.saving || file.transferring || (!isDirty(file) && !file.external && !file.externalInfo && !file.largeFile?.conflict)) return;
      void saveRef.current(file.path);
    };
    const explorer = (event: Event) => {
      if (!accepts(event, true) || toolbarStateRef.current.explorerToggleDisabled) return;
      toggleExplorer();
    };
    const change = (event: Event) => {
      if (document.body.dataset.workspaceLocked === 'true') return;
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail;
      if (!detail?.workspaceId || detail.workspaceId === workspace.id) { refreshTree(); setSearchRevision((value) => value + 1); }
    };
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || document.body.dataset.workspaceLocked === 'true') return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
      if (!rootRef.current?.getClientRects().length || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (reviewActiveRef.current) return;
      if (event.shiftKey) void saveAllRef.current();
      else if (activePathRef.current) void saveRef.current(activePathRef.current);
    };
    window.addEventListener('codex:quick-open', quick);
    window.addEventListener('codex:open-file', open);
    window.addEventListener('codex:search-files', search);
    window.addEventListener('codex:save-file', save);
    window.addEventListener('codex:toggle-explorer', explorer);
    window.addEventListener('codex:workspace-changed', change);
    window.addEventListener('codex:files-changed', change);
    const lock = () => {
      generationRef.current += 1;
      sessionRef.current = { locked: true, generation: generationRef.current };
      setEditorSession(sessionRef.current);
      const unavailable: EditorToolbarState = { ...toolbarStateRef.current, generation: generationRef.current, ready: false, saveDisabled: true, explorerToggleDisabled: true };
      toolbarStateRef.current = unavailable;
      toolbarCallbackRef.current?.(unavailable);
      setQuickOpen(false); setContextMenu(null); setOperation(null); setTrashOpen(false);
      setReview(null); setReviewActive(false);
    };
    const unlock = () => {
      sessionRef.current = { locked: false, generation: generationRef.current };
      setEditorSession(sessionRef.current);
      refreshTree(); void refreshFileTransfers(); setSearchRevision((value) => value + 1);
    };
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-expired', lock);
    window.addEventListener('codex:session-unlocked', unlock);
    window.addEventListener('keydown', keydown);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible' && rootRef.current?.getClientRects().length) refreshTree(); }, 20000);
    return () => {
      window.removeEventListener('codex:quick-open', quick); window.removeEventListener('codex:open-file', open);
      window.removeEventListener('codex:search-files', search); window.removeEventListener('codex:workspace-changed', change);
      window.removeEventListener('codex:save-file', save); window.removeEventListener('codex:toggle-explorer', explorer);
      window.removeEventListener('codex:files-changed', change); window.removeEventListener('keydown', keydown); window.clearInterval(interval);
      window.removeEventListener('codex:session-locked', lock); window.removeEventListener('codex:session-unlocked', unlock);
      window.removeEventListener('codex:session-expired', lock);
    };
  }, [workspace.id, editorInstanceId, activatePath, refreshTree, refreshFileTransfers, toggleExplorer, documents.documentsRef]);

  // Publish only after command listeners are installed, including the first lazy mount.
  useEffect(() => { toolbarCallbackRef.current?.(toolbarState); }, [toolbarState]);
  useEffect(() => {
    const workspaceId = workspace.id;
    return () => toolbarCallbackRef.current?.({
      ...toolbarStateRef.current, workspaceId, editorInstanceId,
      ready: false, saveDisabled: true, explorerToggleDisabled: true,
    });
  }, [workspace.id, editorInstanceId]);

  useEffect(() => {
    if (document.body.dataset.workspaceLocked === 'true') return;
    if (!query) { setMatches([]); setSearchError(''); setSearching(false); setSearchSignature(''); return; }
    const controller = new AbortController();
    const workspaceId = workspace.id;
    setSearching(true);
    const timeout = window.setTimeout(() => {
      if (document.body.dataset.workspaceLocked === 'true') { setSearching(false); return; }
      const params = new URLSearchParams({ q: query, caseSensitive: String(caseSensitive), regex: String(regex), ...(include ? { include } : {}) });
      void api<SearchMatch[]>(`${base}/search?${params}`, { signal: controller.signal }).then((results) => {
        if (controller.signal.aborted || workspaceRef.current !== workspaceId) return;
        setMatches(results); setSearchError(''); setSearchSignature(signature);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && workspaceRef.current === workspaceId) { setSearchError(errorMessage(error)); setMatches([]); }
      }).finally(() => { if (!controller.signal.aborted && workspaceRef.current === workspaceId) setSearching(false); });
    }, 350);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [query, caseSensitive, regex, include, signature, searchRevision, workspace.id, base]);

  useEffect(() => {
    if (!quickOpen) return;
    const controller = new AbortController();
    setQuickLoading(true); setQuickError('');
    const timeout = window.setTimeout(() => {
      void api<string[]>(`${base}/file-paths?q=${encodeURIComponent(quickQuery.trim())}`, { signal: controller.signal })
        .then((paths) => { if (!controller.signal.aborted) { setQuickPaths(paths); setQuickSelection(0); } })
        .catch((error: unknown) => { if (!controller.signal.aborted) setQuickError(errorMessage(error)); })
        .finally(() => { if (!controller.signal.aborted) setQuickLoading(false); });
    }, quickQuery ? 100 : 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [quickOpen, quickQuery, base]);

  useEffect(() => {
    if (!quickOpen) return;
    document.getElementById(`editor-quick-result-${quickSelection}`)?.scrollIntoView({ block: 'nearest' });
  }, [quickSelection, quickOpen]);

  const openOperation = (kind: Operation['kind'], entry?: FileEntry, initialContent?: string) => {
    if (!documents.canMutateWorkspace()) return;
    if (fileOperationController.current || uploadController.current) { notifyRef.current('Wait for the current file operation to finish.', 'info'); return; }
    if (!fileScopeMounted.current || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    setContextMenu(null);
    setOperation({ kind, entry, initialContent });
    const directory = entry?.kind === 'directory' ? entry.path : selectedDirectory;
    setOperationPath(kind === 'rename' ? entry?.path || '' : (kind === 'copy' || kind === 'duplicate') && entry ? copyPath(entry) : directory ? `${directory}/` : '');
    setOperationError('');
    setOperationBusy(false);
  };

  const startFileOperation = () => {
    if (!documents.canMutateWorkspace()) return null;
    if (!fileScopeMounted.current || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return null;
    if (fileOperationController.current || uploadController.current) { notifyRef.current('Wait for the current file operation to finish.', 'info'); return null; }
    const workspaceId = workspace.id;
    const generation = fileScopeGeneration.current;
    const controller = new AbortController();
    fileOperationController.current = controller;
    setOperationBusy(true); setOperationError(''); setTransferNotice(null);
    return {
      signal: controller.signal,
      current: () => fileScopeMounted.current && workspaceRef.current === workspaceId && generation === fileScopeGeneration.current
        && fileOperationController.current === controller && !controller.signal.aborted
        && !sessionRef.current.locked && document.body.dataset.workspaceLocked !== 'true',
    };
  };

  const remapMovedEntry = (entry: FileEntry, newPath: string) => {
    const oldPath = entry.path;
    const remap = (path: string) => isWithin(path, oldPath) ? newPath + path.slice(oldPath.length) : path;
    const previousActive = activePathRef.current;
    const generation = fileScopeGeneration.current;
    const editorStates = [editorRef, splitEditorRef].flatMap(ref => {
      const editor = ref.current;
      const model = editor?.getModel();
      const file = model ? documents.documentsRef.current.find(file => documentUri(workspace.id, file.path) === model.uri.toString() && isWithin(file.path, oldPath)) : undefined;
      const state = file ? editor?.saveViewState() : null;
      return file && state ? [{ ref, state, uri: documentUri(workspace.id, remap(file.path)) }] : [];
    });
    documents.renameDocuments(oldPath, newPath);
    requestAnimationFrame(() => {
      if (!fileScopeMounted.current || generation !== fileScopeGeneration.current || sessionRef.current.locked) return;
      for (const state of editorStates) if (state.ref.current?.getModel()?.uri.toString() === state.uri) state.ref.current.restoreViewState(state.state);
    });
    // Preserve expanded subtree caches while fencing requests for the old path.
    directoryCache.remapMovedEntry(entry, newPath);
    treeRef.current = directoryCache.getSnapshot().tree;
    const nextExpanded = new Set([...expandedRef.current].map(remap));
    expandedRef.current = nextExpanded; setExpanded(nextExpanded);
    setSplitPath(remap);
    setLanguageOverrides(previous => Object.fromEntries(Object.entries(previous).map(([path, language]) => [remap(path), language])));
    if (revealRef.current) revealRef.current = { ...revealRef.current, path: remap(revealRef.current.path) };
    setSelectedEntry({ ...entry, path: newPath, name: baseName(newPath) });
    setFileClipboard(previous => !previous || !isWithin(previous.entry.path, oldPath) ? previous
      : previous.action === 'move' ? null : { ...previous, entry: { ...previous.entry, path: remap(previous.entry.path), name: baseName(remap(previous.entry.path)) } });
    if (previousActive && isWithin(previousActive, oldPath)) pathCallback.current?.(remap(previousActive));
    void loadDirectory(parentPath(oldPath), true);
  };

  const transferEntry = async (entry: FileEntry, destination: string, action: TransferAction, inDialog = false): Promise<boolean> => {
    const request = startFileOperation();
    if (!request) return false;
    let releasePaths: () => void = () => undefined;
    let requested = false;
    setTransferNotice({ message: `${action === 'move' ? 'Moving' : 'Copying saved'} ${entry.name}…` });
    try {
      const path = validateExplorerPath(destination);
      validateExplorerPath(entry.path);
      if (entry.path === path) throw new Error(action === 'move' ? 'This item is already at that location.' : 'Choose a different path for the saved copy.');
      if (entry.kind === 'directory' && isWithin(path, entry.path)) throw new Error('A folder cannot be moved or copied into itself.');
      if (documents.documentsRef.current.some(file => isWithin(file.path, entry.path) && file.saving)) throw new Error('Wait for these files to finish saving before moving or copying them.');
      if (documents.documentsRef.current.some(file => isWithin(file.path, path))) throw new Error('The destination has an open editor buffer. Choose a new path to keep those contents safe.');
      releasePaths = documents.beginPathTransfer([entry.path, path]);
      requested = true;
      const result = await api<{ renamed?: boolean; copied?: boolean; path?: string }>(`${base}/${action === 'move' ? 'rename' : 'copy'}`, {
        ...json('POST', { path: entry.path, newPath: path }), signal: request.signal,
      });
      if (!request.current()) return false;
      if (action === 'move' ? result?.renamed !== true : result?.copied !== true || result.path !== path) throw new Error('The server did not confirm the requested file operation. Check both locations before retrying.');
      if (action === 'move') remapMovedEntry(entry, path);
      else {
        setSelectedEntry({ ...entry, path, name: baseName(path) });
        if (entry.kind === 'directory') setExpanded(previous => new Set(previous).add(path));
      }
      releasePaths();
      revealTreePath(path); announceChange();
      const message = action === 'move' ? `Moved to ${path}. Unsaved editor contents were kept.` : `Copied saved ${entry.kind === 'directory' ? 'files' : 'file'} to ${path}.`;
      setTransferNotice(null); notifyRef.current(message, 'success');
      return true;
    } catch (error) {
      if (request.current()) {
        releasePaths();
        const needsInspection = requested && (!(error instanceof ApiError) || error.code?.startsWith('FILE_TRANSFER_'));
        const message = `${errorMessage(error)}${needsInspection ? ` Check ${entry.path} and ${destination} before retrying. Your editor buffers were kept.` : ''}`;
        setTransferNotice({ message, error: true });
        if (inDialog) setOperationError(message); else notifyRef.current(message, 'error');
        refreshTree(); void documents.refreshDocuments(true);
      }
      return false;
    } finally {
      releasePaths();
      if (request.current()) { fileOperationController.current = null; setOperationBusy(false); void refreshFileTransfers(true); }
    }
  };

  const submitOperation = async (event: FormEvent) => {
    event.preventDefault();
    if (!operation || operationBusy) return;
    const path = operationPath.trim();
    if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '..' || part === '.') || path.includes('\\') || path.includes('\0')) {
      setOperationError('Enter a relative path, such as src/app.ts. Empty names and “..” are not allowed.'); return;
    }
    if ((operation.kind === 'rename' || operation.kind === 'duplicate') && operation.entry) {
      if (await transferEntry(operation.entry, path, operation.kind === 'rename' ? 'move' : 'copy', true)) setOperation(null);
      return;
    }
    const request = startFileOperation();
    if (!request) return;
    try {
      validateExplorerPath(path);
      const kind = operation.kind === 'directory' ? 'directory' : 'file';
      const entry = await api<FileEntry>(`${base}/files`, { ...json('POST', { path, kind }), signal: request.signal });
      if (!request.current()) return;
      if (operation.kind === 'copy' && operation.initialContent !== undefined) {
        const created = await api<FileContent>(`${base}/file?path=${encodeURIComponent(path)}`, { signal: request.signal });
        if (!request.current()) return;
        await api(`${base}/file`, { ...json('PUT', { path, content: operation.initialContent, expectedVersion: created.version }), signal: request.signal });
      }
      if (!request.current()) return;
      setSelectedEntry(entry);
      if (kind === 'file') await activatePath(path);
      else { setExpanded((previous) => new Set(previous).add(path)); void loadDirectory(path, true); }
      if (!request.current()) return;
      notifyRef.current(`${kind === 'file' ? 'File' : 'Folder'} created.`, 'success');
      revealTreePath(path); announceChange(); setOperation(null);
    } catch (error) {
      if (request.current()) setOperationError(errorMessage(error));
    } finally { if (request.current()) { fileOperationController.current = null; setOperationBusy(false); } }
  };

  const trashEntry = async (entry: FileEntry) => {
    if (!documents.canMutateWorkspace()) return;
    setContextMenu(null);
    if (fileOperationController.current || uploadController.current) return notifyRef.current('Wait for the current file operation to finish.', 'info');
    const affected = documents.documentsRef.current.filter((document) => isWithin(document.path, entry.path));
    if (affected.some((document) => document.saving)) return notifyRef.current('Wait for these files to finish saving.', 'info');
    const dirty = affected.filter(isDirty).length;
    if (!window.confirm(`Move “${entry.path}” to trash?${dirty ? ` Unsaved edits in ${dirty} ${dirty === 1 ? 'file' : 'files'} will be discarded.` : ''} You can restore it from Recently deleted.`)) return;
    const request = startFileOperation();
    if (!request) return;
    try {
      await api(`${base}/file?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE', signal: request.signal });
      if (!request.current()) return;
      documents.removeDocuments(entry.path);
      setFileClipboard(previous => previous && isWithin(previous.entry.path, entry.path) ? null : previous);
      setExpanded((previous) => new Set([...previous].filter((path) => !isWithin(path, entry.path))));
      if (selectedEntry && isWithin(selectedEntry.path, entry.path)) setSelectedEntry(null);
      void loadDirectory(parentPath(entry.path), true); announceChange();
      notifyRef.current(`Moved ${entry.name} to trash.`, 'success');
    } catch (error) { if (request.current()) notifyRef.current(errorMessage(error), 'error'); }
    finally { if (request.current()) { fileOperationController.current = null; setOperationBusy(false); } }
  };

  const downloadFile = (path: string) => {
    const file = documents.documentsRef.current.find((item) => item.path === path);
    if (file?.saving || file?.transferring) { notifyRef.current('Wait for this file operation to finish before downloading.', 'info'); return; }
    const entry = Object.values(treeRef.current).flat().find((item) => item.path === path);
    startWorkspaceDownload({ workspaceId: workspace.id, path, expectedVersion: file?.largeFile ? undefined : file?.version, size: file?.size ?? entry?.size, hasUnsavedChanges: file ? isDirty(file) : false });
    setContextMenu(null);
  };

  const uploadPlan = async (buildPlan: (options: FolderScanOptions) => FolderUploadPlan | Promise<FolderUploadPlan>, directory: string, pickerFallback = false) => {
    if (!documents.canMutateWorkspace()) return;
    if (!fileScopeMounted.current || document.body.dataset.workspaceLocked === 'true' || sessionRef.current.locked) return;
    if (uploadController.current || fileOperationController.current) { notifyRef.current('Wait for the current file operation to finish.', 'info'); return; }
    const workspaceId = workspace.id;
    const generation = fileScopeGeneration.current;
    const controller = new AbortController();
    uploadController.current = controller;
    const isCurrent = () => fileScopeMounted.current && workspaceRef.current === workspaceId && uploadController.current === controller
      && generation === fileScopeGeneration.current && !sessionRef.current.locked && document.body.dataset.workspaceLocked !== 'true';
    const createdDirectories: string[] = [];
    let pendingDirectory = '';
    let planned: FolderUploadPlan | undefined;
    let transferStarted = false;
    const checkTarget = (path: string) => {
      const file = documents.documentsRef.current.find(item => isWithin(item.path, path) && (isDirty(item) || item.saving || item.external || item.missing));
      if (file) throw new WorkspaceUploadError('UPLOAD_BUFFER_CONFLICT', 'Save or close the edited file before uploading to this path.');
    };
    setUploading(true); clearDrag(); setSidebarTab('files'); setUploadTransfers([]);
    setUploadNotice({ message: 'Reading files and folders…', active: true, directory });
    try {
      validateExplorerPath(directory, true);
      // buildPlan runs immediately inside the drop event so handles are captured
      // before the browser protects its DataTransfer object.
      const plan = await buildPlan({
        signal: controller.signal,
        onProgress: progress => {
          if (isCurrent()) setUploadNotice({ message: `Reading ${progress.files} ${progress.files === 1 ? 'file' : 'files'} and ${progress.directories} ${progress.directories === 1 ? 'folder' : 'folders'}…`, active: true, directory });
        },
      });
      planned = plan;
      if (!isCurrent()) return;
      if (controller.signal.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
      // Validate every complete path before the first mkdir, including the
      // destination prefix rather than only the browser's relative file paths.
      for (const path of [...plan.directories, ...plan.files.map(file => file.relativePath)]) uploadDestination(directory, path);
      if (plan.directories.length) {
        setUploadNotice({ message: `Checking ${directory || 'workspace root'} before creating ${plan.directories.length} ${plan.directories.length === 1 ? 'folder' : 'folders'}…`, active: true, directory });
        await prepareFolderUpload(plan, {
          directory, signal: controller.signal, checkTarget,
          list: path => findDirectoryEntries(path, new Set([...plan.directories, ...plan.files.map(file => file.relativePath)].map(path => path.split('/')[0])),
            (entryPath, signal) => api<FileEntry>(`${base}/tree-entry?path=${encodeURIComponent(entryPath)}`, { signal }), controller.signal),
          createDirectory: async path => {
            pendingDirectory = path;
            return api<FileEntry>(`${base}/files`, { ...json('POST', { path, kind: 'directory' }), signal: controller.signal });
          },
          onCreated: (path, count) => {
            pendingDirectory = ''; createdDirectories.push(path);
            if (isCurrent()) setUploadNotice({ message: `Created ${count} of ${plan.directories.length} folders…`, active: true, directory });
          },
        });
      }
      if (!isCurrent()) return;
      if (controller.signal.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
      const firstFolder = plan.directories.find(path => !path.includes('/'));
      const visibleFolder = firstFolder ? uploadDestination(directory, firstFolder) : undefined;
      setExpanded(previous => new Set([...previous, ...(directory ? [directory] : []), ...(visibleFolder ? [visibleFolder] : [])]));
      if (visibleFolder) revealTreePath(visibleFolder);
      void loadDirectory(directory, true);
      setUploadNotice(plan.directories.length ? { message: `Created ${createdDirectories.length} ${createdDirectories.length === 1 ? 'folder' : 'folders'}. ${plan.files.length ? 'Uploading files…' : ''}`, directory } : null);
      transferStarted = plan.files.length > 0;
      const result = await uploadWorkspaceFiles({
        workspaceId, directory, files: plan.files.map(item => item.file), relativePaths: plan.files.map(item => item.relativePath), signal: controller.signal,
        onProgress: (progress) => {
          if (isCurrent()) setUploadTransfers(plan.directories.length ? progress.map(item => ({ ...item, fileName: plan.files[item.index]?.relativePath || item.fileName })) : progress);
        },
        checkTarget,
      });
      if (!isCurrent()) return;
      if (result.uploaded || createdDirectories.length) {
        void loadDirectory(directory, true);
        announceChange();
        if (result.uploaded) notifyRef.current(`Saved ${result.uploaded} uploaded ${result.uploaded === 1 ? 'file' : 'files'}.`, 'success');
        else if (!plan.files.length) notifyRef.current(`Created ${createdDirectories.length} ${createdDirectories.length === 1 ? 'folder' : 'folders'} in ${directory || workspace.name}.`, 'success');
      }
      if (plan.directories.length || pickerFallback) {
        const message = `Created ${createdDirectories.length} ${createdDirectories.length === 1 ? 'folder' : 'folders'}${plan.files.length ? `; saved ${result.uploaded} of ${plan.files.length} files` : ''} in ${directory || 'workspace root'}.`;
        setUploadNotice({ message: message + (pickerFallback ? ' This browser’s folder picker may omit empty folders.' : ''), error: Boolean(result.failed || result.unconfirmed), directory });
      }
      const errors = result.files.filter((file) => file.stage === 'failed').map((file) => `${plan.directories.length ? file.path : file.fileName}: ${file.error || 'Upload failed.'}`);
      if (errors.length) notifyRef.current(errors.slice(0, 2).join(' ') + (errors.length > 2 ? ` ${errors.length - 2} other uploads failed.` : ''), 'error');
      if (result.unconfirmed) notifyRef.current('Some saves could not be confirmed. Check the upload details before retrying.', 'error');
      else if (result.cancelled && !result.failed) notifyRef.current('Upload cancelled.', 'info');
    } catch (error) {
      if (isCurrent()) {
        const cancelled = error instanceof DOMException && error.name === 'AbortError';
        const detail = cancelled ? 'Upload cancelled.' : errorMessage(error);
        const partial = createdDirectories.length || pendingDirectory
          ? ` ${createdDirectories.length} ${createdDirectories.length === 1 ? 'folder was' : 'folders were'} confirmed created.${pendingDirectory ? ` Creation of “${pendingDirectory}” was not confirmed.` : ''} Check ${directory || 'workspace root'} before retrying.`
          : !transferStarted ? ' No workspace files were uploaded.' : '';
        setUploadNotice({ message: detail + partial, error: !cancelled, fallback: !cancelled && !planned, directory });
        notifyRef.current(detail + partial, cancelled ? 'info' : 'error');
        if (createdDirectories.length || pendingDirectory) { void loadDirectory(directory, true); announceChange(); }
      }
    } finally {
      if (isCurrent()) {
        uploadController.current = null;
        setUploading(false);
      }
    }
  };

  const chooseUpload = (directory = selectedDirectory, folder = false) => {
    if (uploadController.current || fileOperationController.current || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    setContextMenu(null);
    uploadChoice.current = { workspaceId: workspace.id, generation: fileScopeGeneration.current, directory, folder };
    (folder ? folderUploadRef : uploadRef).current?.click();
  };

  const chooseFolderUpload = (directory = selectedDirectory) => {
    if (uploadController.current || fileOperationController.current || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: 'read' }) => Promise<DroppedHandle> }).showDirectoryPicker;
    if (!picker) { chooseUpload(directory, true); return; }
    setContextMenu(null);
    // Call the picker during the user gesture. Its result is still fenced by
    // uploadPlan's workspace/session generation if the user locks or switches.
    let selection: Promise<DroppedHandle>;
    try { selection = picker.call(window, { mode: 'read' }); }
    catch { chooseUpload(directory, true); return; }
    void uploadPlan(async options => collectDirectoryHandle(await selection, options), directory);
  };

  const receiveUploadSelection = (files: FileList) => {
    const choice = uploadChoice.current;
    uploadChoice.current = null;
    if (!choice || choice.workspaceId !== workspaceRef.current || choice.generation !== fileScopeGeneration.current) return;
    if (!files.length) {
      if (choice.folder) setUploadNotice({ message: 'This browser’s folder picker did not expose any files or empty folders. Drag the folder here to include empty folders.', error: true, fallback: true, directory: choice.directory });
      return;
    }
    const maxFiles = choice.folder ? MAX_WORKSPACE_FOLDER_UPLOAD_FILES : MAX_WORKSPACE_UPLOAD_FILES;
    // Bound the FileList before copying it, including very large native picks.
    const selected = files.length <= maxFiles ? Array.from(files) : null;
    void uploadPlan(options => {
      if (!selected) throw new WorkspaceUploadError('UPLOAD_BATCH_TOO_LARGE', `Choose no more than ${maxFiles} files at a time.`);
      return planSelectedFiles(selected, choice.folder, options);
    }, choice.directory, choice.folder);
  };

  const selectClipboard = (entry: FileEntry, action: TransferAction) => {
    if (fileOperationController.current || uploadController.current || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    setContextMenu(null); setSelectedEntry(entry); setTransferNotice(null);
    setFileClipboard({ workspaceId: workspace.id, entry, action });
  };

  const pasteEntry = (directory: string, target?: FileEntry) => {
    setContextMenu(null);
    if (target?.kind === 'directory' && target.isSymlink) { notifyRef.current('Choose an ordinary folder instead of a symbolic link.', 'error'); return; }
    if (!fileClipboard || fileClipboard.workspaceId !== workspace.id) { notifyRef.current('Choose Copy or Cut on a workspace item first.', 'info'); return; }
    let path: string;
    try { path = uploadDestination(directory, fileClipboard.entry.name); }
    catch (error) { notifyRef.current(errorMessage(error), 'error'); return; }
    if (fileClipboard.action === 'copy' && path === fileClipboard.entry.path) path = copyPath(fileClipboard.entry);
    void transferEntry(fileClipboard.entry, path, fileClipboard.action);
  };

  const beginDrag = (entry: FileEntry, event: DragEvent<HTMLButtonElement>) => {
    if (fileOperationController.current || uploadController.current || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') { event.preventDefault(); return; }
    const drag = { id: crypto.randomUUID(), workspaceId: workspace.id, entry };
    internalDrag.current = drag;
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData(EXPLORER_DRAG_TYPE, JSON.stringify({ id: drag.id, workspaceId: drag.workspaceId, path: entry.path }));
    event.dataTransfer.setData('text/plain', entry.path);
    setDragPath(entry.path); setSelectedEntry(entry); setContextMenu(null);
  };

  const dragDirectory = (event: DragEvent<HTMLElement>) => {
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-explorer-drop-directory]') : null;
    return node && event.currentTarget.contains(node) ? node.dataset.explorerDropDirectory || '' : '';
  };

  const dragOverExplorer = (event: DragEvent<HTMLElement>) => {
    const internal = event.dataTransfer.types.includes(EXPLORER_DRAG_TYPE);
    if (!internal && !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); event.stopPropagation();
    if (sidebarTab !== 'files') setSidebarTab('files');
    const directory = dragDirectory(event);
    const source = internal ? internalDrag.current : null;
    const action: TransferAction = internal && !event.ctrlKey && !event.altKey ? 'move' : 'copy';
    let blocked: string | undefined;
    if (sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') blocked = 'Unlock the workspace to drop files.';
    else if (uploadController.current || fileOperationController.current) blocked = 'Wait for the current file operation.';
    else if (event.target instanceof Element && event.target.closest('[data-explorer-drop-rejected]')) blocked = event.target.closest('[data-explorer-drop-rejected="unrendered"]')
      ? 'Wait for the folder list to finish scrolling before dropping.' : 'Choose an ordinary folder instead of a symbolic link.';
    else if (internal && (!source || source.workspaceId !== workspace.id)) blocked = 'Drag an item from this workspace.';
    else if (source?.entry.kind === 'directory' && isWithin(directory, source.entry.path)) blocked = 'Choose a folder outside this item.';
    else if (source && action === 'move' && parentPath(source.entry.path) === directory) blocked = 'This item is already in this folder.';
    const target: DropTarget = { directory, action, external: !internal, blocked };
    const previous = dropTargetRef.current;
    if (!previous || previous.directory !== directory || previous.action !== action || previous.external !== !internal || previous.blocked !== blocked) {
      dropTargetRef.current = target; setDropTarget(target);
    }
    event.dataTransfer.dropEffect = blocked ? 'none' : action;
    if (dragExpandTimer.current?.directory !== directory || blocked) {
      if (dragExpandTimer.current) window.clearTimeout(dragExpandTimer.current.timer);
      dragExpandTimer.current = null;
    }
    if (!blocked && directory && !expandedRef.current.has(directory) && !dragExpandTimer.current) {
      const generation = fileScopeGeneration.current;
      dragExpandTimer.current = { directory, timer: window.setTimeout(() => {
        dragExpandTimer.current = null;
        if (!fileScopeMounted.current || generation !== fileScopeGeneration.current || dropTargetRef.current?.directory !== directory || sessionRef.current.locked) return;
        setExpanded(previous => new Set(previous).add(directory)); void loadDirectory(directory, true);
      }, 650) };
    }
    const scroll = event.currentTarget.querySelector<HTMLElement>('.editor-tree-scroll');
    if (scroll) {
      const bounds = scroll.getBoundingClientRect();
      if (event.clientY >= bounds.top && event.clientY < bounds.top + 32) scroll.scrollTop -= 18;
      else if (event.clientY <= bounds.bottom && event.clientY > bounds.bottom - 32) scroll.scrollTop += 18;
    }
  };

  const dropInExplorer = (event: DragEvent<HTMLElement>) => {
    const internal = event.dataTransfer.types.includes(EXPLORER_DRAG_TYPE);
    if (!internal && !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); event.stopPropagation();
    if (event.target instanceof Element && event.target.closest('[data-explorer-drop-rejected]')) {
      const message = event.target.closest('[data-explorer-drop-rejected="unrendered"]')
        ? 'Wait for the folder list to finish scrolling before dropping.' : 'Choose an ordinary folder instead of a symbolic link.';
      clearDrag(); notifyRef.current(message, 'error'); return;
    }
    const directory = dragDirectory(event);
    if (internal) {
      const source = internalDrag.current;
      let payload: { id?: unknown; workspaceId?: unknown; path?: unknown } | null = null;
      try { const data = event.dataTransfer.getData(EXPLORER_DRAG_TYPE); if (data.length <= 8192) payload = JSON.parse(data); } catch { /* Reject unknown drag payloads rather than treating them as OS files. */ }
      clearDrag();
      if (!source || !payload || source.workspaceId !== workspace.id || payload.id !== source.id || payload.workspaceId !== workspace.id || payload.path !== source.entry.path) {
        notifyRef.current('That drag is no longer active. Drag the workspace item again.', 'error'); return;
      }
      const action: TransferAction = event.ctrlKey || event.altKey || event.dataTransfer.dropEffect === 'copy' ? 'copy' : 'move';
      let path: string;
      try { path = uploadDestination(directory, source.entry.name); }
      catch (error) { notifyRef.current(errorMessage(error), 'error'); return; }
      if (action === 'copy' && path === source.entry.path) path = copyPath(source.entry);
      void transferEntry(source.entry, path, action);
    } else {
      const transfer = event.dataTransfer;
      void uploadPlan(options => collectExternalDrop(transfer, options), directory);
    }
  };

  const startTrashRequest = (kind: TrashRequestKind) => {
    if (!trashMounted.current || !trashOpenRef.current || workspaceRef.current !== workspace.id
      || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return null;
    trashRequests.current[kind]?.abort();
    const controller = new AbortController();
    trashRequests.current[kind] = controller;
    const workspaceId = workspace.id;
    const generation = trashGeneration.current;
    return {
      signal: controller.signal,
      current: () => !controller.signal.aborted && trashMounted.current && trashOpenRef.current
        && trashRequests.current[kind] === controller && generation === trashGeneration.current && workspaceRef.current === workspaceId
        && !sessionRef.current.locked && document.body.dataset.workspaceLocked !== 'true',
    };
  };

  const refreshTrashEntries = async (location: TrashPageLocation = trashPageAttempt.current) => {
    if (trashRequests.current.restore) return;
    const request = startTrashRequest('entries');
    if (!request) return;
    trashPageAttempt.current = location;
    setTrashLoading(true); setTrashError('');
    try {
      const query = new URLSearchParams({ limit: String(TRASH_PAGE_SIZE) });
      if (location.cursor) query.set('cursor', location.cursor);
      const page = await api<FileTrashPage>(`${base}/trash/page?${query}`, { signal: request.signal });
      const cursor = (value: unknown) => value === null || typeof value === 'string' && value.length > 0 && value.length <= 8192;
      if (!page || !Array.isArray(page.items) || page.items.length > TRASH_PAGE_SIZE
        || !cursor(page.previousCursor) || !cursor(page.nextCursor) || page.hasMore !== (page.nextCursor !== null)
        || page.order !== 'filesystem' || !Number.isSafeInteger(page.scanned) || page.scanned < 0 || page.scanned > 100
        || !Number.isSafeInteger(page.unavailable) || page.unavailable < 0 || page.unavailable > page.scanned) throw new Error('This page of deleted files could not be read.');
      if (request.current()) {
        setTrash(page.items); setTrashNow(Date.now());
        setTrashPage({ cursor: location.cursor, page: page.previousCursor === null ? 1 : location.page });
        setTrashPreviousCursor(page.previousCursor); setTrashNextCursor(page.nextCursor);
        setTrashUnavailable(page.unavailable); setTrashRestartRequired(false);
        rootRef.current?.querySelector('.editor-trash-list')?.scrollTo({ top: 0 });
      }
    } catch (error) {
      if (request.current()) {
        const restart = error instanceof ApiError && ['FILE_TRASH_CURSOR_STALE', 'FILE_TRASH_CURSOR_EXPIRED', 'INVALID_FILE_TRASH_CURSOR'].includes(error.code || '');
        if (restart) setTrashRestartRequired(true);
        setTrashError(restart ? 'This page of deleted files changed or expired. Start from the first page to continue.' : errorMessage(error));
      }
    }
    finally {
      if (request.current()) { trashRequests.current.entries = null; setTrashLoading(false); }
    }
  };

  const refreshTrashStatus = async () => {
    const request = startTrashRequest('status');
    if (!request) return;
    setTrashStatusLoading(true);
    try {
      const status = await api<FileTrashStatus>(`${base}/trash-status`, { signal: request.signal });
      if (!status || (status.issue !== null && typeof status.issue !== 'string')) throw new Error('Trash cleanup status could not be read.');
      if (request.current()) { setTrashIssue(typeof status.issue === 'string' ? status.issue.slice(0, 600) : ''); setTrashStatusError(''); }
    } catch (error) {
      if (request.current()) { setTrashIssue(''); setTrashStatusError(errorMessage(error)); }
    } finally {
      if (request.current()) { trashRequests.current.status = null; setTrashStatusLoading(false); }
    }
  };

  const loadTrash = async () => {
    if (!trashMounted.current || workspaceRef.current !== workspace.id || trashRequests.current.restore || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    if (!trashOpenRef.current) {
      setTrash([]); setTrashPage(firstTrashPage()); setTrashPreviousCursor(null); setTrashNextCursor(null); setTrashUnavailable(0); setTrashRestartRequired(false);
    }
    trashOpenRef.current = true;
    setTrashOpen(true); setTrashNow(Date.now()); setTrashRestoreError('');
    await Promise.allSettled([refreshTrashEntries(firstTrashPage()), refreshTrashStatus()]);
  };

  const closeTrash = () => {
    if (trashRequests.current.restore) return;
    trashOpenRef.current = false;
    cancelTrashRequests();
    setTrashOpen(false); setTrashLoading(false); setTrashStatusLoading(false);
  };

  const restoreTrash = async (entry: TrashEntry) => {
    if (!documents.canMutateWorkspace()) return;
    if (!trashMounted.current || !trashOpenRef.current || workspaceRef.current !== workspace.id || trashRequests.current.restore
      || sessionRef.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    if (fileOperationController.current || uploadController.current) { setTrashRestoreError('Wait for the current file operation to finish before restoring.'); return; }
    const expiresAt = Date.parse(entry.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      setTrashNow(Date.now());
      setTrashRestoreError(Number.isFinite(expiresAt) ? 'This item has reached its 30-day expiry and cannot be restored.' : 'The expiry date could not be verified. This item cannot be restored.');
      return;
    }
    if (documents.documentsRef.current.some((document) => isWithin(document.path, entry.path) && document.saving)) {
      setTrashRestoreError('Wait for these files to finish saving before restoring.');
      return;
    }
    const request = startTrashRequest('restore');
    if (!request) return;
    // A listing started before this mutation must not reintroduce the restored entry.
    trashRequests.current.entries?.abort(); trashRequests.current.entries = null;
    setTrashLoading(false); setRestoringId(entry.id); setTrashRestoreError('');
    let reloadPage = false;
    try {
      await api(`${base}/restore`, { ...json('POST', { trashId: entry.id }), signal: request.signal });
      if (!request.current()) return;
      setTrash((previous) => previous.filter((item) => item.id !== entry.id));
      setTrashRestartRequired(true); reloadPage = true;
      revealTreePath(entry.path); announceChange(); notifyRef.current(`Restored ${entry.path}.`, 'success');
    } catch (error) {
      if (request.current()) {
        setTrashRestoreError(errorMessage(error));
        if (error instanceof ApiError && error.code === 'FILE_TRASH_EXPIRED') {
          setTrash((previous) => previous.filter((item) => item.id !== entry.id));
          setTrashRestartRequired(true); reloadPage = true;
        }
      }
    } finally {
      if (request.current()) {
        trashRequests.current.restore = null; setRestoringId('');
        if (reloadPage) void refreshTrashEntries(firstTrashPage());
      }
    }
  };

  const replaceWorkspace = async () => {
    if (!documents.canMutateWorkspace()) return;
    if (regex || !query || searching || searchSignature !== signature || !matches.length || replacing) return;
    const paths = [...new Set(matches.map((match) => match.path))];
    const unsaved = documents.documentsRef.current.filter((document) => paths.includes(document.path) && isDirty(document));
    if (unsaved.length) return notifyRef.current('Save or close unsaved files in the results before replacing text across the workspace.', 'error');
    if (!window.confirm(`Replace every occurrence of “${query}” in ${paths.length} matching ${paths.length === 1 ? 'file' : 'files'}?`)) return;
    const request = startFileOperation();
    if (!request) return;
    setReplacing(true);
    try {
      const result = await api<{ files: number; replacements: number }>(`${base}/replace`, { ...json('POST', { query, replacement, paths, caseSensitive }), signal: request.signal });
      if (!request.current()) return;
      notifyRef.current(`Replaced ${result.replacements} occurrences in ${result.files} ${result.files === 1 ? 'file' : 'files'}.`, 'success');
      announceChange(); setSearchRevision((value) => value + 1);
    } catch (error) { if (request.current()) notifyRef.current(errorMessage(error), 'error'); }
    finally { if (request.current()) { fileOperationController.current = null; setOperationBusy(false); setReplacing(false); } }
  };

  const mountEditor: OnMount = (editor) => {
    editorRef.current = editor;
    if (!documents.canMutateWorkspace(false)) editor.updateOptions({ readOnly: true });
    const file = documents.documentsRef.current.find((document) => documentUri(workspaceRef.current, document.path) === editor.getModel()?.uri.toString());
    if (file && editor.getValue() !== visibleContent(file.content)) editor.setValue(visibleContent(file.content));
    const disposables: monaco.IDisposable[] = [
      watchEditorScroll(editor),
      editor.addAction({ id: 'codex.save', label: 'Save file', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => { const path = activePathRef.current; if (path && !reviewActiveRef.current) void saveRef.current(path); } }),
      editor.addAction({ id: 'codex.saveAll', label: 'Save all files', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS], run: () => { if (!reviewActiveRef.current) void saveAllRef.current(); } }),
      editor.addAction({ id: 'codex.openFile', label: 'Go to file', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP], run: () => { setQuickQuery(''); setQuickOpen(true); } }),
      editor.addAction({ id: 'codex.searchWorkspace', label: 'Search in workspace', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF], run: () => { setSidebarTab('search'); setSidebarHidden(false); setMobileView('files'); window.setTimeout(() => searchRef.current?.focus(), 0); } }),
      editor.onDidChangeCursorPosition((event) => setPosition({ line: event.position.lineNumber, column: event.position.column })),
    ];
    editor.onDidDispose(() => { for (const disposable of disposables) disposable.dispose(); if (editorRef.current === editor) editorRef.current = null; });
    revealPending();
  };

  const runAction = async (action: string) => {
    if (active?.largeFile) {
      if (action === 'actions.find') { largeEditorRef.current?.find(); return; }
      if (action === 'editor.action.gotoLine') { largeEditorRef.current?.navigate(); return; }
      if (action === 'editor.action.startFindReplaceAction') { largeEditorRef.current?.findInPage(true); return; }
      if (action === 'editor.action.formatDocument') { notifyRef.current('Large files are edited one page at a time. Full-document formatting is unavailable.', 'info'); return; }
    }
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const command = editor.getAction(action);
    if (command && command.isSupported()) {
      try { await command.run(); }
      catch (error) { notifyRef.current(errorMessage(error), 'error'); }
    } else if (action === 'editor.action.formatDocument') notifyRef.current('Formatting is available for JavaScript, TypeScript, JSON, HTML, and CSS.', 'info');
    else editor.trigger('toolbar', action, null);
  };

  const options: monaco.editor.IStandaloneEditorConstructionOptions = {
    automaticLayout: true,
    readOnly: documents.writeHeld || editorSession.locked,
    domReadOnly: true,
    fontSize: settings.fontSize,
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontLigatures: false,
    lineHeight: Math.round(settings.fontSize * 1.65),
    padding: { top: 16, bottom: 16 },
    minimap: { enabled: viewOptions.minimap && width > 760, maxColumn: 100, renderCharacters: false },
    lineNumbers: viewOptions.lineNumbers ? 'on' : 'off',
    wordWrap: (viewOptions.wrap ?? settings.wordWrap) ? 'on' : 'off',
    scrollBeyondLastLine: false,
    smoothScrolling: !reduceMotion,
    cursorSmoothCaretAnimation: reduceMotion ? 'off' : 'on',
    cursorBlinking: reduceMotion ? 'solid' : 'smooth',
    renderLineHighlight: 'line',
    renderWhitespace: 'selection',
    roundedSelection: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    tabSize: 2,
    detectIndentation: true,
    insertSpaces: true,
    folding: true,
    fixedOverflowWidgets: true,
    contextmenu: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    // Monaco uses this option to measure/virtualize rows; CSS-only heights would
    // desynchronize hit targets and keyboard selection from the visible items.
    suggestLineHeight: Math.max(window.matchMedia('(any-pointer: coarse)').matches ? 44 : 30, Math.round(settings.fontSize * 1.65)),
    suggest: { showStatusBar: true },
    wordBasedSuggestions: 'matchingDocuments',
    mouseWheelZoom: true,
    scrollbar: { verticalScrollbarSize: width < 640 ? 8 : 10, horizontalScrollbarSize: 10, useShadows: false },
    overviewRulerBorder: false,
    accessibilitySupport: 'auto',
  };

  const toggleDirectory = (entry: FileEntry) => {
    setSelectedEntry(entry);
    setExpanded((previous) => { const next = new Set(previous); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next; });
    if (!expanded.has(entry.path)) void loadDirectory(entry.path, true);
  };

  const revealActiveDocument = () => {
    if (!active || active.missing || editorSession.locked || document.body.dataset.workspaceLocked === 'true') return;
    revealTreePath(active.path);
    setSelectedEntry({ name: baseName(active.path), path: active.path, kind: 'file' });
    setSidebarHidden(false); setSidebarTab('files'); setMobileView('files');
    setFileTransferReveal({ id: ++fileTransferRevealSequence.current, path: active.path, workspaceId: workspace.id, generation: fileScopeGeneration.current });
  };

  const groupedMatches = useMemo(() => {
    const groups = new Map<string, SearchMatch[]>();
    for (const match of matches) groups.set(match.path, [...(groups.get(match.path) || []), match]);
    return [...groups];
  }, [matches]);

  const matchText = (match: SearchMatch) => {
    const start = Math.max(0, match.column - 1);
    let length = query.length;
    if (regex) {
      try { length = new RegExp(`^(?:${query})`, caseSensitive ? '' : 'i').exec(match.text.slice(start))?.[0].length || length; }
      catch { /* The server reports invalid regular expressions. */ }
    }
    const left = Math.max(0, start - 35);
    return <>{left ? '…' : ''}{match.text.slice(left, start)}<mark>{match.text.slice(start, start + length)}</mark>{match.text.slice(start + length, start + length + 110)}</>;
  };

  return <div ref={rootRef} className={`editor-panel ${sidebarHidden ? 'editor-sidebar-hidden' : ''} ${paneSizing?.wide ? 'editor-panel-resizable' : ''}`} data-mobile-view={mobileView} data-editor-theme={theme}
    style={paneSizing?.wide ? { '--resizable-explorer-width': `${paneSizing.explorerWidth}px` } as CSSProperties : undefined}>
    <div className="editor-body">
      <div className="editor-main" id={`${editorInstanceId}-surface`}>
        {(documents.documents.length > 0 || review) && <EditorTabs
          files={documents.documents.map(document => ({ path: document.path, dirty: isDirty(document), conflict: Boolean(document.external || document.externalInfo || document.largeFile?.conflict), pending: Boolean(document.saving || document.transferring) }))}
          activePath={documents.activePath} review={Boolean(review)} reviewActive={reviewActive} visible={visible && (!compactNavigation || mobileView === 'editor')}
          onSelect={path => { setReviewActive(false); documents.setActivePath(path); setMobileView('editor'); setCompare(null); }}
          onClose={path => { void documents.closeDocument(path); }} onOpen={() => { setQuickQuery(''); setQuickOpen(true); }}
          onSelectReview={() => { setReviewActive(true); setMobileView('editor'); }} onCloseReview={() => { setReview(null); setReviewActive(false); }} />}

        {review && <div className="editor-review-area" hidden={!reviewActive}><ChangeReviewPanel key={`${workspace.id}:${review.sequence}`} target={review.target}
          instanceId={`${editorInstanceId}:${review.sequence}`} active={reviewActive && visible && (!compactNavigation || mobileView === 'editor')} locked={editorSession.locked}
          fontSize={settings.fontSize} wordWrap={viewOptions.wrap ?? settings.wordWrap} reduceMotion={reduceMotion}
          onShowFiles={() => { setMobileView('files'); setSidebarHidden(false); }} onNotify={onNotify} /></div>}
        <div className="editor-document-area" hidden={reviewActive} inert={reviewActive}>
        {active ? <>
          <div className="editor-file-toolbar">
            <button className="editor-mobile-files-button" title="Show files" aria-label="Show files" onClick={() => { setMobileView('files'); setSidebarHidden(false); }}><ArrowLeft size={15} /></button>
            <button type="button" className="editor-breadcrumb" title={`${active.path} · Reveal in Files`} aria-label={`Reveal ${active.path} in Files`} disabled={active.missing} onClick={revealActiveDocument}>{active.path.split('/').map((part, index, segments) => <span key={`${part}:${index}`}><span>{part}</span>{index < segments.length - 1 && <ChevronRight size={11} aria-hidden="true" />}</span>)}</button>
            <div className="editor-file-actions">
              <button className="icon-button" title="Find in file" aria-label="Find in file" onClick={() => void runAction('actions.find')}><Search size={14} /></button>
              <button className="icon-button editor-format-button" title={active.largeFile ? 'Full-file formatting is unavailable in page mode' : 'Format document'} aria-label="Format document" disabled={Boolean(active.largeFile)} onClick={() => void runAction('editor.action.formatDocument')}><Braces size={14} /></button>
              <button className={`icon-button ${compare ? 'active' : ''}`} title={compare ? 'Back to editing' : 'Compare with saved version'} aria-label={compare ? 'Back to editing' : 'Compare with saved version'} aria-pressed={Boolean(compare)} onClick={() => { setCompare((value) => value ? null : (active.external || active.largeFile?.conflict) ? 'disk' : 'saved'); setSplit(false); }}><GitCompareArrows size={15} /></button>
              <button className={`icon-button editor-split-button ${split ? 'active' : ''}`} title="Split editor" aria-label="Split editor" aria-pressed={split} disabled={Boolean(active.largeFile)} onClick={() => { setSplit((value) => !value); setSplitPath(documents.documents.find((document) => document.path !== active.path && !document.largeFile)?.path || active.path); setCompare(null); }}><Columns2 size={14} /></button>
              <DropdownMenu aria-label="Editor options" trigger={<button className="icon-button editor-options-trigger" title="Editor options" aria-label="Editor options"><Settings2 size={14} /></button>} items={[
                { id: 'wrap', label: 'Word wrap', icon: <WrapText size={14} />, checked: viewOptions.wrap ?? settings.wordWrap, closeOnSelect: false, onSelect: () => setViewOptions((value) => ({ ...value, wrap: !(value.wrap ?? settings.wordWrap) })) },
                { id: 'numbers', label: 'Line numbers', icon: <span className="editor-menu-number">12</span>, checked: viewOptions.lineNumbers, closeOnSelect: false, onSelect: () => setViewOptions((value) => ({ ...value, lineNumbers: !value.lineNumbers })) },
                { id: 'minimap', label: 'Minimap', icon: <Columns2 size={14} />, checked: viewOptions.minimap, closeOnSelect: false, onSelect: () => setViewOptions((value) => ({ ...value, minimap: !value.minimap })) },
                { type: 'separator', id: 'view-separator' },
                { id: 'reveal', label: 'Reveal in Files', icon: <Files size={14} />, disabled: active.missing, onSelect: revealActiveDocument },
                { id: 'format', label: 'Format document', icon: <Braces size={14} />, disabled: Boolean(active.largeFile), onSelect: () => { void runAction('editor.action.formatDocument'); } },
                { id: 'replace', label: active.largeFile ? 'Find and replace in loaded page' : 'Find and replace', icon: <Replace size={14} />, shortcut: `${platformShortcut()} H`, onSelect: () => { void runAction('editor.action.startFindReplaceAction'); } },
                { id: 'save-all', label: 'Save all files', icon: <CheckCheck size={14} />, shortcut: `${platformShortcut()} ⇧ S`, disabled: reviewActive || !dirtyCount, onSelect: () => { if (!reviewActiveRef.current) void documents.saveAll(); } },
                { id: 'save-copy', label: active.largeFile ? 'Copy saved file…' : 'Save a copy…', icon: <Copy size={14} />, onSelect: () => active.largeFile ? openOperation('duplicate', { name: baseName(active.path), path: active.path, kind: 'file' }) : openOperation('copy', { name: baseName(active.path), path: active.path, kind: 'file' }, active.content) },
                { id: 'download', label: 'Download saved file', icon: <ArrowDownToLine size={14} />, onSelect: () => downloadFile(active.path) },
                { id: 'reload', label: 'Reload from disk', icon: <RefreshCw size={14} />, onSelect: () => { void documents.reloadDocument(active.path); } },
              ]} />
            </div>
          </div>
          {!active.largeFile && (active.external || active.externalInfo || active.missing) && <div className="editor-conflict-banner" role="alert"><AlertCircle size={16} /><div><strong>{active.missing ? 'This file was removed from disk.' : active.externalInfo ? 'This file grew beyond the full editor limit.' : 'This file changed on disk.'}</strong><span>Your editor buffer is safe.</span></div><div className="editor-conflict-actions">{active.missing || active.externalInfo ? <><button className="button" onClick={() => openOperation('copy', { name: baseName(active.path), path: active.path, kind: 'file' }, active.content)}>Save a copy</button>{active.externalInfo && <button className="button ghost" onClick={() => void documents.reloadDocument(active.path)}>Reload in pages</button>}</> : <><button className="button ghost" onClick={() => { setCompare('disk'); setSplit(false); }}>Compare</button><button className="button ghost" onClick={() => void documents.reloadDocument(active.path)}>Use disk version</button><button className="button" disabled={active.saving || active.transferring} onClick={() => { if (window.confirm(`Replace the saved version of ${active.path} with your editor contents?`)) void documents.saveDocument(active.path, true); }}>Use my edits</button></>}</div></div>}
          {compare && !active.largeFile && <div className="editor-compare-heading"><span><Circle size={8} />{compare === 'disk' && active.external ? 'Latest on disk' : 'Last saved version'}</span><ArrowRight size={13} /><span>Your editor{isDirty(active) ? ' · unsaved' : ''}</span><button className="icon-button" aria-label="Close comparison" onClick={() => setCompare(null)}><X size={13} /></button></div>}
          <div className={`editor-surface ${split && width >= 960 && !compare && !active.largeFile && !splitDocument?.largeFile ? 'editor-surface-split' : ''}`}>
            {active.largeFile ? <LargeFileEditor
              key={`large:${workspace.id}:${active.path}:${active.largeFile.id}`} ref={largeEditorRef}
              workspaceId={workspace.id} document={active} controller={documents.largeDocuments}
              language={activeLanguage} options={options} compare={compare} onCompare={setCompare}
              onChange={documents.updateContent} onSave={documents.saveDocument} onReload={documents.reloadDocument}
              onMount={mountEditor} onNotify={onNotify}
            /> : compare ? <DiffEditor
              key={`diff:${workspace.id}:${active.path}`}
              original={visibleContent(compare === 'disk' && active.external ? active.external.content : active.savedContent)}
              modified={visibleContent(active.content)} language={activeLanguage}
              originalModelPath={comparisonUri(workspace.id, active.path)} modifiedModelPath={documentUri(workspace.id, active.path)}
              keepCurrentOriginalModel keepCurrentModifiedModel theme={theme}
              options={{ ...options, renderSideBySide: width >= 840, originalEditable: false, readOnly: Boolean(options.readOnly || active.transferring), enableSplitViewResizing: true, renderOverviewRuler: false, diffWordWrap: (viewOptions.wrap ?? settings.wordWrap) ? 'on' : 'off' }}
              loading={<EditorSkeleton label="Opening comparison…" comparison />}
              onMount={(diff) => {
                const modified = diff.getModifiedEditor(); mountEditor(modified, monaco);
                const original = diff.getOriginalEditor();
                const originalScroll = watchEditorScroll(original);
                original.onDidDispose(() => originalScroll.dispose());
                const subscription = modified.onDidChangeModelContent(() => contentRef.current(active.path, modified.getValue()));
                modified.onDidDispose(() => subscription.dispose());
              }}
            /> : <div className="editor-code-pane"><Editor
              path={documentUri(workspace.id, active.path)} value={visibleContent(active.content)} language={activeLanguage}
              theme={theme} keepCurrentModel saveViewState
              options={{ ...options, readOnly: Boolean(options.readOnly || active.transferring), ariaLabel: `Source code for ${active.path}` }}
              onMount={mountEditor} onChange={(value) => contentRef.current(active.path, value || '')}
              onValidate={(markers) => setDiagnostics({ errors: markers.filter((marker) => marker.severity === monaco.MarkerSeverity.Error).length, warnings: markers.filter((marker) => marker.severity === monaco.MarkerSeverity.Warning).length })}
              loading={<EditorSkeleton label="Opening editor…" />}
            /></div>}
            {split && width >= 960 && !compare && !active.largeFile && splitDocument && !splitDocument.largeFile && <div className="editor-code-pane editor-second-pane"><div className="editor-split-selector"><FileIcon path={splitDocument.path} /><SelectMenu aria-label="File in second editor" className="editor-split-select" compact searchable={documents.documents.length > 6} value={splitDocument.path} onValueChange={setSplitPath} options={documents.documents.filter((document) => !document.largeFile).map((document) => ({ value: document.path, label: document.path, description: isDirty(document) ? 'Unsaved changes' : undefined, icon: <FileIcon path={document.path} /> }))} /><button className="icon-button" aria-label="Close split editor" onClick={() => setSplit(false)}><X size={13} /></button></div><Editor
              path={documentUri(workspace.id, splitDocument.path)} value={visibleContent(splitDocument.content)} language={(Object.hasOwn(languageOverrides, splitDocument.path) ? languageOverrides[splitDocument.path] : undefined) || languageFor(splitDocument)}
              keepCurrentModel saveViewState theme={theme} options={{ ...options, readOnly: Boolean(options.readOnly || splitDocument.transferring), minimap: { enabled: false }, ariaLabel: `Second editor for ${splitDocument.path}` }}
              onChange={(value) => contentRef.current(splitDocument.path, value || '')}
              onMount={(editor) => {
                splitEditorRef.current = editor;
                if (!documents.canMutateWorkspace(false)) editor.updateOptions({ readOnly: true });
                const scroll = watchEditorScroll(editor);
                const action = editor.addAction({ id: 'codex.saveSplit', label: 'Save file', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => { if (reviewActiveRef.current) return; const uri = editor.getModel()?.uri.toString(); const document = documents.documentsRef.current.find((entry) => documentUri(workspaceRef.current, entry.path) === uri); if (document) void saveRef.current(document.path); } });
                editor.onDidDispose(() => { action.dispose(); scroll.dispose(); if (splitEditorRef.current === editor) splitEditorRef.current = null; });
              }}
              loading={<EditorSkeleton label="Opening second editor…" />}
            /></div>}
          </div>
          {!active.largeFile && <footer className="editor-statusbar"><div><button className={`editor-diagnostics ${diagnostics.errors ? 'has-errors' : ''}`} title={`${diagnostics.errors} errors, ${diagnostics.warnings} warnings in this file`} aria-label={`${diagnostics.errors} errors and ${diagnostics.warnings} warnings. Go to next problem.`} onClick={() => void runAction('editor.action.marker.next')}><AlertCircle size={12} />{diagnostics.errors}<span>△ {diagnostics.warnings}</span></button><span className={`editor-save-state ${active.saving ? 'saving' : ''}`}>{active.transferring ? 'File operation…' : active.saving ? 'Saving…' : active.external ? 'Changed on disk' : isDirty(active) ? 'Unsaved changes' : <><Check size={11} />Saved</>}</span></div><div><button className="editor-cursor-position" onClick={() => void runAction('editor.action.gotoLine')}>Ln {position.line}, Col {position.column}</button><span className="editor-encoding">UTF-8</span><span className="editor-file-size">{sizeLabel(active.size)}</span><SelectMenu aria-label="Language mode" title="Language mode" className="editor-language-select" compact searchable searchPlaceholder="Find a language…" align="end" value={activeLanguage} onValueChange={(language) => setLanguageOverrides((previous) => ({ ...previous, [active.path]: language }))} options={monaco.languages.getLanguages().map((language) => ({ value: language.id, label: languageLabels[language.id] || language.aliases?.[0] || language.id, keywords: language.aliases?.join(' ') })).sort((a, b) => a.label.localeCompare(b.label))} /></div></footer>}
        </> : documents.opening.length ? <EditorSkeleton label="Opening file…" /> : <div className="editor-welcome">
          <div className="editor-welcome-content">
            <div className="editor-welcome-mark" aria-hidden="true"><FileCode2 size={24} strokeWidth={1.4} /></div>
            <p className="editor-eyebrow">EDITOR</p><h2>Your files, in focus.</h2>
            <p>Open a file from the explorer, or jump straight to the one you need.</p>
            <div className="editor-welcome-actions"><button className="button primary" onClick={() => { setQuickQuery(''); setQuickOpen(true); }}><Search size={14} /><span>Open a file</span><kbd>{platformShortcut()} P</kbd></button><button className="button ghost" onClick={() => openOperation('file')}><FilePlus2 size={14} />New file</button></div>
            <div className="editor-welcome-shortcuts"><span>Save changes<kbd>{platformShortcut()} S</kbd></span><span>Find in file<kbd>{platformShortcut()} F</kbd></span></div>
            <button className="editor-mobile-browse button ghost" onClick={() => { setMobileView('files'); setSidebarHidden(false); }}><Files size={15} />Browse workspace files</button>
          </div>
        </div>}
        </div>
      </div>

      {paneSizing?.wide && !sidebarHidden && <PaneSplitter {...paneSizing.explorerControl} disabled={paneSizing.explorerControl.disabled || editorSession.locked}
        label="Resize editor and explorer" controls={`${editorInstanceId}-surface ${editorInstanceId}-explorer`} direction={-1} />}
      <aside id={`${editorInstanceId}-explorer`} className={`editor-sidebar ${dropTarget && !dropTarget.blocked ? 'editor-drop-active' : ''}`} aria-label="Workspace files" data-explorer-drop-directory=""
        onDragOver={dragOverExplorer}
        onDragLeave={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          if (dragExpandTimer.current) window.clearTimeout(dragExpandTimer.current.timer);
          dragExpandTimer.current = null; dropTargetRef.current = null; setDropTarget(null);
        }}
        onDrop={dropInExplorer}>
        <div className="editor-sidebar-header">
          <div className="editor-sidebar-tabs" role="tablist" aria-label="File navigation">
            <button role="tab" aria-selected={sidebarTab === 'files'} className={sidebarTab === 'files' ? 'active' : ''} onClick={() => setSidebarTab('files')}>Files</button>
            <button role="tab" aria-selected={sidebarTab === 'search'} className={sidebarTab === 'search' ? 'active' : ''} onClick={() => { setSidebarTab('search'); window.setTimeout(() => searchRef.current?.focus(), 0); }}>Search</button>
          </div>
          {sidebarTab === 'files' && <div className="editor-sidebar-header-actions">
            <button className="icon-button" title={`New file${selectedDirectory ? ` in ${selectedDirectory}` : ''}`} aria-label="New file" onClick={() => openOperation('file')}><FilePlus2 size={14} /></button>
            <button className="icon-button" title={`New folder${selectedDirectory ? ` in ${selectedDirectory}` : ''}`} aria-label="New folder" onClick={() => openOperation('directory')}><FolderPlus size={14} /></button>
          </div>}
          {(active || review) && <button className="icon-button editor-mobile-back" title="Back to editor" aria-label="Back to editor" onClick={() => setMobileView('editor')}><ArrowRight size={15} /></button>}
        </div>
        {sidebarTab === 'files' ? <>
          <div className={`editor-explorer-toolbar${dropTarget?.directory === '' && !dropTarget.blocked ? ' editor-folder-drop-target' : ''}`} data-explorer-drop-directory=""><button className="editor-workspace-name" title={`${workspace.name} · workspace root`} aria-label={`Workspace root: ${workspace.name}`} onClick={() => setSelectedEntry(null)}
            onContextMenu={(event) => { event.preventDefault(); setSelectedEntry(null); contextTriggerRef.current = event.currentTarget; setContextMenu({ entry: { name: workspace.name, path: '', kind: 'directory' }, x: event.clientX, y: event.clientY }); }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteEntry(''); }
              else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault(); setSelectedEntry(null); contextTriggerRef.current = event.currentTarget;
                const bounds = event.currentTarget.getBoundingClientRect(); setContextMenu({ entry: { name: workspace.name, path: '', kind: 'directory' }, x: bounds.left, y: bounds.bottom });
              }
            }}><Folder size={14} aria-hidden="true" /><span>{workspace.name}</span></button><div>
            <button className="icon-button" title="Refresh files" aria-label="Refresh files" onClick={() => { refreshTree(); void documents.refreshDocuments(true); }}><RefreshCw size={13} className={loadingDirectories.has('') ? 'editor-spin' : ''} /></button>
          </div></div>
          <ExplorerTree key={workspace.id} label={`${workspace.name} files`} tree={tree} expanded={expanded} loading={loadingDirectories} errors={treeErrors} paging={directoryPaging}
            emptyContent={<div className="editor-explorer-empty"><FolderOpen size={24} strokeWidth={1.3} aria-hidden="true" /><strong>No files yet</strong><p>Create a file, upload your project, or drop a folder here.</p><button className="button" onClick={() => openOperation('file')}><Plus size={14} />Create a file</button></div>}
            selectedPath={selectedEntry?.path ?? documents.activePath} activePath={documents.activePath} dirtyPaths={dirtyPaths}
            revealRequest={fileTransferReveal?.workspaceId === workspace.id && fileTransferReveal.generation === fileScopeGeneration.current ? fileTransferReveal : null}
            onRevealHandled={id => setFileTransferReveal(current => current?.id === id ? null : current)}
            cutPath={fileClipboard?.action === 'move' ? fileClipboard.entry.path : null} dragPath={dragPath}
            dropDirectory={dropTarget?.directory ?? null} dropAllowed={!dropTarget?.blocked} transferBusy={operationBusy || uploading}
            onSelect={setSelectedEntry} onOpen={(entry) => { void activatePath(entry.path); }} onToggleDirectory={toggleDirectory}
            onRetry={(path) => { void retryDirectory(path); }} onLoadMore={(path) => { void loadMore(path); }} onFocusPath={(path) => directoryCache.focusPath(path)}
            onRename={(entry) => openOperation('rename', entry)} onDelete={(entry) => { void trashEntry(entry); }}
            onClipboard={selectClipboard} onPaste={pasteEntry} onClearClipboard={() => setFileClipboard(null)} onDragStart={beginDrag} onDragEnd={clearDrag}
            onContextMenu={(entry, anchor, point) => { setSelectedEntry(entry); contextTriggerRef.current = anchor; setContextMenu({ entry, ...point }); }} />
          {fileTransfersStatus && (fileTransfersError || !operationBusy || fileTransfers.some(entry => entry.state === 'interrupted')) && <button className="editor-transfers-status" onClick={openFileTransfers}>
            <AlertCircle size={14} /><span>{fileTransfersStatus}</span><ChevronRight size={13} />
          </button>}
          {fileClipboard && <div className="editor-clipboard" role="status">
            <div>{fileClipboard.action === 'move' ? <Scissors size={13} /> : <Copy size={13} />}<span title={fileClipboard.entry.path}>{fileClipboard.action === 'move' ? 'Move' : 'Copy saved'} {fileClipboard.entry.name}</span><button className="icon-button" aria-label="Clear file clipboard" onClick={() => setFileClipboard(null)}><X size={13} /></button></div>
            <button className="button ghost" disabled={operationBusy || uploading} onClick={() => pasteEntry(selectedDirectory, selectedEntry || undefined)} title={`Paste into ${selectedDirectory || 'workspace root'}`}><ClipboardPaste size={13} /><span>Paste into {selectedDirectory ? baseName(selectedDirectory) : 'workspace root'}</span></button>
          </div>}
          {transferNotice && <div className={`editor-transfer-notice${transferNotice.error ? ' has-error' : ''}`} role={transferNotice.error ? 'alert' : 'status'}>
            {operationBusy ? <LoaderCircle size={14} className="editor-spin" /> : <AlertCircle size={14} />}<span>{transferNotice.message}</span>
            {!operationBusy && <button className="icon-button" aria-label="Dismiss file operation status" onClick={() => setTransferNotice(null)}><X size={13} /></button>}
          </div>}
          {uploadNotice && <div className={`editor-upload-notice${uploadNotice.error ? ' has-error' : ''}`} role={uploadNotice.error ? 'alert' : 'status'}>
            <div>{uploadNotice.active ? <LoaderCircle size={14} className="editor-spin" /> : uploadNotice.error ? <AlertCircle size={14} /> : <Upload size={14} />}<span>{uploadNotice.message}</span>
              {uploadNotice.active ? <button className="icon-button" aria-label="Cancel folder preparation" onClick={() => uploadController.current?.abort()}><X size={13} /></button>
                : !uploading && <button className="icon-button" aria-label="Dismiss folder upload status" onClick={() => setUploadNotice(null)}><X size={13} /></button>}</div>
            {uploadNotice.fallback && !uploading && <div className="editor-upload-fallback"><button className="button ghost" onClick={() => chooseUpload(uploadNotice.directory || '')}>Upload files</button><button className="button ghost" onClick={() => chooseFolderUpload(uploadNotice.directory || '')}>Upload folder</button></div>}
          </div>}
          <UploadProgress files={uploadTransfers} onCancel={() => uploadController.current?.abort()} onDismiss={() => setUploadTransfers([])} />
          <div className="editor-explorer-footer"><button className="editor-subtle-button" aria-label={uploading ? 'Uploading files' : 'Upload files'} disabled={uploading || operationBusy} onClick={() => chooseUpload()} title={`Upload files${selectedDirectory ? ` to ${selectedDirectory}` : ''}`}>{uploading ? <LoaderCircle className="editor-spin" size={13} /> : <Upload size={13} />}<span>{uploading ? 'Uploading…' : 'Upload'}</span></button>
            <DropdownMenu aria-label="File actions" trigger={<button className="icon-button" aria-label="File actions" title="File actions"><ChevronDown size={13} /></button>} items={[
              { id: 'files', label: 'Upload files', description: 'Up to 50 files per selection', icon: <Upload size={14} />, disabled: uploading || operationBusy, onSelect: () => chooseUpload() },
              { id: 'folder', label: 'Upload folder', description: 'Up to 1,000 files · 250 MB total', icon: <FolderInput size={14} />, disabled: uploading || operationBusy, onSelect: () => chooseFolderUpload() },
              { type: 'separator', id: 'transfer-status' },
              { id: 'transfers', label: 'File operations', icon: <FolderInput size={14} />, onSelect: openFileTransfers },
            ]} />
            <button className="icon-button" title="Collapse folders" aria-label="Collapse folders" onClick={() => setExpanded(new Set())}><ChevronsDownUp size={13} /></button><button className="icon-button" title="Recently deleted" aria-label="Recently deleted" onClick={() => void loadTrash()}><Trash2 size={13} /></button></div>
          {dropTarget && <div className={`editor-drop-hint${dropTarget.blocked ? ' is-blocked' : ''}`} role="status">
            {dropTarget.external ? <Upload size={16} /> : dropTarget.action === 'copy' ? <Copy size={16} /> : <FolderInput size={16} />}
            <div><strong>{dropTarget.blocked || (dropTarget.external ? 'Upload files and folders here' : dropTarget.action === 'copy' ? 'Copy saved files here' : 'Move here')}</strong><span>{dropTarget.directory || `${workspace.name} (root)`}</span>{!dropTarget.external && !dropTarget.blocked && <small>{dropTarget.action === 'move' ? 'Hold Ctrl or Option to copy' : 'Unsaved edits stay in the original'}</small>}</div>
          </div>}
        </> : <>
          <div className="editor-search-controls">
            <div className="editor-search-field"><Search size={14} /><input ref={searchRef} aria-label="Search workspace text" placeholder="Search in files…" value={query} maxLength={500} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setSearchRevision((value) => value + 1); }} />{searching ? <LoaderCircle size={13} className="editor-spin" /> : query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button>}</div>
            <div className="editor-search-options"><button title="Match case" aria-label="Match case" aria-pressed={caseSensitive} className={caseSensitive ? 'active' : ''} onClick={() => setCaseSensitive((value) => !value)}><CaseSensitive size={17} /></button><button title="Use regular expression" aria-label="Use regular expression" aria-pressed={regex} className={regex ? 'active' : ''} onClick={() => setRegex((value) => !value)}><Regex size={15} /></button><button className={`editor-replace-toggle ${showReplace ? 'active' : ''}`} aria-expanded={showReplace} onClick={() => setShowReplace((value) => !value)}><Replace size={14} /><span>Replace</span><ChevronDown size={12} /></button></div>
            <input className="editor-include-input" aria-label="Files to include" placeholder="Files to include, e.g. src/**" value={include} maxLength={300} onChange={(event) => setInclude(event.target.value)} />
            {showReplace && <div className="editor-replace-controls"><input className="input" aria-label="Replacement text" placeholder="Replace with…" value={replacement} maxLength={10000} onChange={(event) => setReplacement(event.target.value)} /><button className="button" disabled={regex || !matches.length || replacing || searching || searchSignature !== signature} onClick={() => void replaceWorkspace()}>{replacing ? <LoaderCircle size={13} className="editor-spin" /> : <Replace size={13} />}Replace in {groupedMatches.length} {groupedMatches.length === 1 ? 'file' : 'files'}</button>{regex && <p>Turn off regular expressions to replace text across files.</p>}</div>}
          </div>
          <div className="editor-search-results" aria-live="polite">
            {searchError ? <div className="editor-inline-error" role="alert"><AlertCircle size={15} /><span>{searchError}</span></div> : !query ? <div className="editor-search-empty"><Search size={24} /><strong>Find it in your workspace</strong><p>Search file contents, then open any result to jump straight to the line.</p></div> : !searching && matches.length === 0 ? <div className="editor-search-empty"><span>No matches found.</span><p>Try a different phrase or file pattern.</p></div> : <>
              <div className="editor-result-count">{searching ? 'Searching…' : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} in ${groupedMatches.length} ${groupedMatches.length === 1 ? 'file' : 'files'}`}</div>
              {groupedMatches.map(([path, results]) => <div className="editor-result-group" key={path}><button className="editor-result-file" title={path} onClick={() => void activatePath(path, results[0].line, results[0].column)}><FileIcon path={path} /><span>{baseName(path)}</span><span className="editor-result-badge">{results.length}</span></button>{parentPath(path) && <span className="editor-result-directory">{parentPath(path)}</span>}{results.map((match, index) => <button key={`${match.line}:${match.column}:${index}`} className="editor-search-match" title={`${path}:${match.line} — ${match.text}`} onClick={() => void activatePath(path, match.line, match.column)}><span>{match.line}</span><code>{matchText(match)}</code></button>)}</div>)}
              {matches.length >= 1000 && <p className="editor-result-limit">Showing the first matches. Narrow your search for more specific results.</p>}
            </>}
          </div>
        </>}
      </aside>
    </div>
    <input ref={uploadRef} type="file" multiple className="editor-hidden-input" aria-label="Upload workspace files" onChange={(event) => { if (event.target.files) receiveUploadSelection(event.target.files); event.currentTarget.value = ''; }} />
    <input ref={folderUploadRef} type="file" multiple {...{ webkitdirectory: '', directory: '' }} className="editor-hidden-input" aria-label="Upload workspace folder" onChange={(event) => { if (event.target.files) receiveUploadSelection(event.target.files); event.currentTarget.value = ''; }} />

    {contextMenu && <DropdownContextMenu point={{ x: contextMenu.x, y: contextMenu.y }} anchor={contextTriggerRef} aria-label={`Actions for ${contextMenu.entry.name}`} onClose={() => setContextMenu(null)} items={[
      { type: 'label', id: 'file-name', label: contextMenu.entry.name },
      ...(contextMenu.entry.kind === 'directory' && !contextMenu.entry.isSymlink ? [
        { id: 'new-file', label: 'New file here', icon: <FilePlus2 size={14} />, disabled: operationBusy || uploading, onSelect: () => openOperation('file', contextMenu.entry) },
        { id: 'new-folder', label: 'New folder here', icon: <FolderPlus size={14} />, disabled: operationBusy || uploading, onSelect: () => openOperation('directory', contextMenu.entry) },
        { id: 'upload', label: 'Upload here', icon: <Upload size={14} />, disabled: operationBusy || uploading, onSelect: () => chooseUpload(contextMenu.entry.path) },
        { id: 'upload-folder', label: 'Upload folder here', icon: <FolderInput size={14} />, disabled: operationBusy || uploading, onSelect: () => chooseFolderUpload(contextMenu.entry.path) },
        { id: 'paste', label: 'Paste into folder', icon: <ClipboardPaste size={14} />, shortcut: `${platformShortcut()} V`, disabled: !fileClipboard || operationBusy || uploading, onSelect: () => pasteEntry(contextMenu.entry.path) },
        { type: 'separator' as const, id: 'folder-actions' },
      ] : []),
      ...(contextMenu.entry.path ? [
        { id: 'rename', label: 'Rename or move', icon: <Pencil size={14} />, shortcut: 'F2', disabled: operationBusy || uploading, onSelect: () => openOperation('rename', contextMenu.entry) },
        { id: 'copy-to', label: 'Copy to…', description: 'Choose a new path for saved contents', icon: <Copy size={14} />, disabled: operationBusy || uploading, onSelect: () => openOperation('duplicate', contextMenu.entry) },
        { id: 'cut', label: 'Cut', icon: <Scissors size={14} />, shortcut: `${platformShortcut()} X`, disabled: operationBusy || uploading, onSelect: () => selectClipboard(contextMenu.entry, 'move') },
        { id: 'copy', label: 'Copy', description: 'Saved contents only', icon: <Copy size={14} />, shortcut: `${platformShortcut()} C`, disabled: operationBusy || uploading, onSelect: () => selectClipboard(contextMenu.entry, 'copy') },
      ] : []),
      ...(contextMenu.entry.kind === 'file' ? [
        { id: 'open', label: 'Open in editor', icon: <FileCode2 size={14} />, onSelect: () => { void activatePath(contextMenu.entry.path); } },
        { id: 'download', label: 'Download', icon: <ArrowDownToLine size={14} />, onSelect: () => downloadFile(contextMenu.entry.path) },
      ] : []),
      ...(contextMenu.entry.path ? [
        { id: 'copy-path', label: 'Copy path', icon: <Copy size={14} />, onSelect: () => { void navigator.clipboard.writeText(contextMenu.entry.path).then(() => notifyRef.current('Path copied.', 'success')).catch(() => notifyRef.current('Could not access the clipboard.', 'error')); } },
        { type: 'separator' as const, id: 'file-actions' },
        { id: 'trash', label: 'Move to trash', icon: <Trash2 size={14} />, danger: true, disabled: operationBusy || uploading, onSelect: () => { void trashEntry(contextMenu.entry); } },
      ] : []),
    ]} />}

    {quickOpen && <EditorDialog label="Go to file" className="editor-quick-dialog" onClose={() => setQuickOpen(false)}><div className="editor-quick-search"><Search size={18} /><input data-autofocus value={quickQuery} onChange={(event) => { setQuickQuery(event.target.value); setQuickSelection(0); }} placeholder="Find a file by name or path…" aria-label="Find a file by name or path" role="combobox" aria-expanded="true" aria-controls="editor-quick-results" aria-activedescendant={quickResults.length ? `editor-quick-result-${quickSelection}` : undefined} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setQuickSelection((value) => Math.min(quickResults.length - 1, value + 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setQuickSelection((value) => Math.max(0, value - 1)); }
      if (event.key === 'Enter' && quickResults[quickSelection]) { event.preventDefault(); void activatePath(quickResults[quickSelection]); setQuickOpen(false); }
    }} />{quickLoading ? <LoaderCircle size={16} className="editor-spin" /> : <button className="icon-button" aria-label="Close file search" onClick={() => setQuickOpen(false)}><X size={16} /></button>}</div><div className="editor-quick-caption"><span className="text-ellipsis" data-tooltip={`Files in ${workspace.name}`}>Files in {workspace.name}</span><span>{quickResults.length ? `${quickResults.length}${quickPaths.length > 70 ? '+' : ''}` : ''}</span></div><div id="editor-quick-results" className="editor-quick-results" role="listbox" aria-label="Matching files">{quickError ? <p className="editor-inline-error" role="alert">{quickError}</p> : !quickResults.length ? <div className="editor-quick-empty">{quickLoading ? 'Finding files…' : quickQuery ? 'No files match your search.' : 'This workspace has no files yet.'}</div> : quickResults.map((path, index) => <button id={`editor-quick-result-${index}`} key={path} role="option" aria-selected={quickSelection === index} aria-description={path} data-tooltip={path} className={quickSelection === index ? 'selected' : ''} onMouseEnter={() => setQuickSelection(index)} onClick={() => { void activatePath(path); setQuickOpen(false); }}><FileIcon path={path} size={17} /><span><strong>{baseName(path)}</strong><small>{parentPath(path) || workspace.name}</small></span>{documents.documents.some((document) => document.path === path) && <span className="editor-quick-open-label">open</span>}{quickSelection === index && <ArrowRight size={14} />}</button>)}</div><div className="editor-quick-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div></EditorDialog>}

    {operation && <EditorDialog label={operation.kind === 'rename' ? 'Rename or move' : operation.kind === 'directory' ? 'Create folder' : operation.kind === 'copy' ? 'Save a copy' : operation.kind === 'duplicate' ? 'Copy saved contents' : 'Create file'} onClose={() => setOperation(null)} busy={operationBusy}>
      <form onSubmit={(event) => void submitOperation(event)}>
        <div className="editor-dialog-heading"><span className="editor-dialog-icon">{operation.kind === 'directory' ? <FolderPlus size={20} /> : operation.kind === 'rename' ? <Pencil size={20} /> : operation.kind === 'duplicate' ? <Copy size={20} /> : <FilePlus2 size={20} />}</span><button type="button" className="icon-button" aria-label="Close dialog" disabled={operationBusy} onClick={() => setOperation(null)}><X size={17} /></button></div>
        <h2>{operation.kind === 'rename' ? 'Rename or move' : operation.kind === 'directory' ? 'Create a folder' : operation.kind === 'copy' ? 'Save a copy' : operation.kind === 'duplicate' ? 'Copy saved contents' : 'Create a file'}</h2>
        <p>{operation.kind === 'rename' ? `Choose a new path for ${operation.entry?.name}. Open files keep their unsaved edits at the new location.`
          : operation.kind === 'copy' ? 'Keep the current editor contents in a new file.'
            : operation.kind === 'duplicate' ? `Copy ${operation.entry?.name} from disk. Unsaved editor changes stay in the original. Existing files and folders are never overwritten or merged.`
              : `Add a ${operation.kind === 'directory' ? 'folder' : 'file'} to ${workspace.name}.`}</p>
        <label className="editor-field-label" htmlFor="editor-operation-path">{operation.kind === 'rename' || operation.kind === 'duplicate' ? 'New path' : operation.kind === 'directory' ? 'Folder path' : 'File path'}</label>
        <input data-autofocus data-select-filename={['rename', 'copy', 'duplicate'].includes(operation.kind) ? 'true' : undefined} id="editor-operation-path" className="input editor-operation-input" value={operationPath} onChange={(event) => setOperationPath(event.target.value)} placeholder={operation.kind === 'directory' || operation.entry?.kind === 'directory' ? 'src/components' : 'src/app.ts'} autoComplete="off" spellCheck={false} maxLength={1800} disabled={operationBusy} />
        <span className="editor-field-hint">Paths are relative to the current workspace.</span>
        {operationError && <div className="editor-operation-error" role="alert"><AlertCircle size={14} />{operationError}</div>}
        <div className="editor-dialog-footer"><button type="button" className="button ghost" onClick={() => setOperation(null)} disabled={operationBusy}>Cancel</button><button type="submit" className="button primary" disabled={!operationPath.trim() || operationBusy}>{operationBusy && <LoaderCircle className="editor-spin" size={14} />}{operation.kind === 'rename' ? 'Move' : operation.kind === 'copy' ? 'Save copy' : operation.kind === 'duplicate' ? 'Copy' : 'Create'}</button></div>
      </form>
    </EditorDialog>}

    {fileTransfersOpen && <FileTransferHistory key={workspace.id} workspaceId={workspace.id} page={fileTransfersPage} query={fileTransfersQuery}
      loadedQuery={fileTransferSnapshot?.workspaceId === workspace.id ? fileTransferSnapshot.query : ''} loading={fileTransfersLoading} error={fileTransfersError}
      inspectingPath={fileTransferInspecting} inspectError={fileTransferInspectError}
      onQueryChange={searchFileTransfers} onPrevious={() => pageFileTransfers(-1)} onNext={() => pageFileTransfers(1)} onRefresh={() => { cancelFileTransferInspection(); void refreshFileTransfers(true); }} onClose={closeFileTransfers}
      onInspect={path => { void inspectFileTransferPath(path); }} />}

    {trashOpen && <EditorDialog label="Recently deleted" className="editor-trash-dialog" onClose={closeTrash} busy={Boolean(restoringId)}>
      <div className="editor-dialog-heading"><span className="editor-dialog-icon"><Trash2 size={20} /></span><button className="icon-button" aria-label="Close recently deleted" onClick={closeTrash} disabled={Boolean(restoringId)}><X size={17} /></button></div>
      <h2>Recently deleted</h2>
      <p>Deleted files and folders are permanently deleted after 30 days. Restore them to their original locations before they expire.</p>
      {trashStatusLoading && !trashIssue && !trashStatusError && <div className="editor-trash-check" role="status"><LoaderCircle size={13} className="editor-spin" aria-hidden="true" />Checking automatic cleanup…</div>}
      {(trashIssue || trashStatusError) && <div className="editor-trash-warning" role="alert">
        <AlertCircle size={16} aria-hidden="true" />
        <div><strong>{trashIssue ? 'Automatic cleanup needs attention' : 'Could not check automatic cleanup'}</strong><p>{trashIssue || trashStatusError}</p></div>
        <button className="button ghost" aria-label="Retry cleanup status" aria-busy={trashStatusLoading || undefined} disabled={trashStatusLoading || Boolean(restoringId)} onClick={() => void refreshTrashStatus()}>{trashStatusLoading ? 'Checking…' : 'Check again'}</button>
      </div>}
      {trashRestoreError && <div className="editor-inline-error" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{trashRestoreError}</span></div>}
      <div className="editor-trash-list" aria-busy={trashLoading || undefined}>
        {trashLoading && !trash.length && <div className="editor-loading" role="status"><LoaderCircle className="editor-spin" size={18} aria-hidden="true" />Loading deleted files…</div>}
        {trashError && <div className="editor-inline-error" role="alert"><span>{trashError}</span><button className="button" aria-label={trashRestartRequired ? 'Reload deleted files from first page' : 'Retry loading deleted files'} disabled={trashLoading || Boolean(restoringId)} onClick={() => void refreshTrashEntries(trashRestartRequired ? firstTrashPage() : trashPageAttempt.current)}>{trashRestartRequired ? 'Reload first page' : 'Retry'}</button></div>}
        {trashUnavailable > 0 && <div className="editor-trash-page-note" role="status"><AlertCircle size={14} aria-hidden="true" /><span>{trashUnavailable} {trashUnavailable === 1 ? 'deleted item on this page could' : 'deleted items on this page could'} not be read. Other files can still be restored.</span></div>}
        {!trashLoading && !trashError && !trash.length && <div className="editor-trash-empty"><Check size={24} /><strong>{trashNextCursor || trashPreviousCursor || trashUnavailable ? 'No recoverable files on this page' : 'Nothing in the trash'}</strong><span>{trashNextCursor ? 'Choose Next to continue through deleted files.' : trashPreviousCursor ? 'Use Previous or First page to browse earlier files.' : trashUnavailable ? 'Some deleted items could not be read.' : 'Deleted files will appear here.'}</span></div>}
        {trash.map((entry) => {
          const expiry = Date.parse(entry.expiresAt);
          const expiryKnown = Number.isFinite(expiry);
          const expired = expiryKnown && expiry <= trashNow;
          return <div className="editor-trash-entry" key={entry.id}>
            <FileIcon path={entry.path} directory={entry.kind === 'directory'} size={18} />
            <div><strong title={entry.path}>{entry.path}</strong><span>Deleted <time dateTime={entry.deletedAt}>{new Date(entry.deletedAt).toLocaleString()}</time></span>
              <span className={`editor-trash-expiry${expired ? ' is-expired' : ''}`}>{expiryKnown ? <>{expired ? 'Expired on' : 'Permanently deleted on'} <time dateTime={entry.expiresAt}>{new Date(expiry).toLocaleString()}</time></> : 'Expiry unavailable'}</span>
            </div>
            <button className="button" disabled={Boolean(restoringId) || !expiryKnown || expired} aria-busy={restoringId === entry.id || undefined}
              title={expired ? 'The 30-day recovery period has ended.' : !expiryKnown ? 'The expiry date could not be verified.' : undefined}
              onClick={() => void restoreTrash(entry)}>{restoringId === entry.id ? <LoaderCircle size={13} className="editor-spin" /> : <RotateCcw size={13} />}Restore</button>
          </div>;
        })}
      </div>
      {(trashPreviousCursor || trashNextCursor || trashRestartRequired || trashUnavailable > 0) && <nav className="editor-trash-pagination" aria-label="Deleted file pages">
        <button className="button ghost" aria-label="First trash page" disabled={trashLoading || Boolean(restoringId) || (trashPage.page === 1 && !trashRestartRequired && !trashUnavailable)} onClick={() => void refreshTrashEntries(firstTrashPage())}>First page</button>
        <span className="editor-trash-page-caption" role="status" aria-live="polite">Page {trashPage.page}</span>
        <button className="button" aria-label="Previous trash page" disabled={trashLoading || Boolean(restoringId) || trashRestartRequired || !trashPreviousCursor} onClick={() => { if (trashPreviousCursor) void refreshTrashEntries({ cursor: trashPreviousCursor, page: Math.max(1, trashPage.page - 1) }); }}><ArrowLeft size={13} aria-hidden="true" />Previous</button>
        <button className="button" aria-label="Next trash page" disabled={trashLoading || Boolean(restoringId) || trashRestartRequired || !trashNextCursor} onClick={() => { if (trashNextCursor) void refreshTrashEntries({ cursor: trashNextCursor, page: trashPage.page + 1 }); }}>Next<ArrowRight size={13} aria-hidden="true" /></button>
      </nav>}
      <div className="editor-dialog-footer"><button className="button" onClick={closeTrash} disabled={Boolean(restoringId)}>Done</button></div>
    </EditorDialog>}
  </div>;
}

export default EditorPanel;
