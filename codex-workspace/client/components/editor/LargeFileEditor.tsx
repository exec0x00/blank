import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type Ref } from 'react';
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Copy, LoaderCircle, Search, X } from 'lucide-react';
import type { WorkspaceFileSearchResult } from '../../../shared/types';
import { api, json } from '../../api';
import { monaco } from '../../monaco';
import { markScrollActivity } from '../../scroll-activity';
import { SelectMenu } from '../ui/Dropdown';
import { EditorDialog } from './EditorDialog';
import { canReviewRange, largePageVisibleContent, type LargeFileDocuments } from './large-file-documents';
import { pagePositionLabel, pageRangeLabel, positionAtByte } from './large-file-position';
import { isDirty, errorMessage, type OpenDocument } from './useDocuments';
import './large-file-editor.css';

export interface LargeFileEditorHandle {
  find(): void;
  navigate(): void;
  findInPage(replace?: boolean): void;
}

interface Props {
  workspaceId: string;
  document: OpenDocument;
  controller: LargeFileDocuments;
  language: string;
  options: monaco.editor.IStandaloneEditorConstructionOptions;
  compare: 'saved' | 'disk' | null;
  onCompare: (value: 'saved' | 'disk' | null) => void;
  onChange: (path: string, value: string, pageToken?: string) => boolean;
  onSave: (path: string, reviewed?: boolean) => Promise<boolean>;
  onReload: (path: string) => Promise<void>;
  onMount: OnMount;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  ref?: Ref<LargeFileEditorHandle>;
}

const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KiB`
  : bytes < 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;

export function LargeFileEditor({ workspaceId, document: file, controller, language, options, compare, onCompare, onChange, onSave, onReload, onMount, onNotify, ref }: Props) {
  const state = file.largeFile!;
  const page = state.page;
  const dirty = isDirty(file);
  const blocked = Boolean(state.loading || file.saving || file.transferring);
  const navigationBlocked = blocked || dirty || Boolean(state.conflict);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const fileRef = useRef(file);
  const changeRef = useRef(onChange);
  const notifyRef = useRef(onNotify);
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [dialog, setDialog] = useState<'find' | 'navigate' | null>(null);
  const [destinationKind, setDestinationKind] = useState('byte');
  const [destination, setDestination] = useState('0');
  const [navigationError, setNavigationError] = useState('');
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [search, setSearch] = useState<WorkspaceFileSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const rejectedChangeRef = useRef(false);
  const viewRef = useRef<{ offset: number; lineNumber: number; column: number; scrollTop: number; scrollLeft: number } | null>(null);
  fileRef.current = file;
  changeRef.current = onChange;
  notifyRef.current = onNotify;

  const findInPage = useCallback((replace = false) => {
    setDialog(null);
    const editor = editorRef.current;
    editor?.focus();
    void editor?.getAction(replace ? 'editor.action.startFindReplaceAction' : 'actions.find')?.run().catch(error => {
      if (aliveRef.current) notifyRef.current(errorMessage(error), 'error');
    });
  }, []);

  useImperativeHandle(ref, () => ({
    find: () => setDialog('find'),
    navigate: () => { setDestinationKind('byte'); setDestination(String(fileRef.current.largeFile?.page?.byteStart ?? 0)); setNavigationError(''); setDialog('navigate'); },
    findInPage,
  }), [findInPage]);

  useEffect(() => {
    aliveRef.current = true;
    const cancel = () => { requestRef.current?.abort(); requestRef.current = null; setSearching(false); setDialog(null); };
    window.addEventListener('codex:session-locked', cancel);
    window.addEventListener('codex:session-expired', cancel);
    return () => {
      aliveRef.current = false; requestRef.current?.abort();
      window.removeEventListener('codex:session-locked', cancel);
      window.removeEventListener('codex:session-expired', cancel);
    };
  }, [workspaceId, file.path, state.id]);

  useEffect(() => {
    requestRef.current?.abort(); requestRef.current = null;
    setSearching(false); setSearch(null); setSearchError('');
  }, [file.version, file.path, workspaceId, query, caseSensitive]);

  useEffect(() => {
    if (file.transferring) { requestRef.current?.abort(); requestRef.current = null; setSearching(false); }
  }, [file.transferring]);

  const lastInspection = useRef('');
  useEffect(() => {
    if (compare !== 'disk' || !page || !state.conflict || state.remote || state.reviewing) return;
    const key = `${workspaceId}:${file.path}:${state.id}:${page.pageToken}`;
    if (lastInspection.current === key) return;
    lastInspection.current = key;
    void controller.inspectConflict(file.path);
  }, [compare, page, state.conflict, state.remote, state.reviewing, state.id, workspaceId, file.path, controller]);

  const reveal = useCallback(() => {
    const current = fileRef.current;
    const target = current.largeFile?.reveal;
    const window = current.largeFile?.page;
    const editor = editorRef.current;
    if (!target || !window || !editor || editor.getModel()?.getValue() !== largePageVisibleContent(current)) return;
    const hasBom = window.byteStart === 0 && current.content.startsWith('\uFEFF');
    const local = target.byte !== undefined
      ? positionAtByte(largePageVisibleContent(current), Math.max(0, target.byte - window.byteStart - (hasBom ? 3 : 0)))
      : { lineNumber: Math.max(1, (target.line ?? window.startLine ?? 1) - (window.startLine ?? 1) + 1), column: Math.max(1, (target.column ?? 1) - (hasBom && target.line === 1 ? 1 : 0)) };
    const position = editor.getModel()!.validatePosition(local);
    editor.setPosition(position); editor.revealPositionInCenter(position, monaco.editor.ScrollType.Immediate); editor.focus();
  }, []);

  useEffect(() => { reveal(); }, [state.reveal?.sequence, page?.pageToken, reveal]);

  const edit = (value: string, pageToken: string) => {
    if (rejectedChangeRef.current) return;
    const current = fileRef.current;
    if (current.largeFile?.page?.pageToken !== pageToken) return;
    if (changeRef.current(current.path, value, pageToken)) return;
    // A rejected paste must also be removed from Monaco's own buffer and undo
    // history. Merely keeping React's old value can leave the rejected edit visible.
    const editor = editorRef.current;
    if (!editor) return;
    const position = editor.getPosition();
    rejectedChangeRef.current = true;
    try { editor.setValue(largePageVisibleContent(current)); if (position) editor.setPosition(position); }
    finally { rejectedChangeRef.current = false; }
  };

  const mount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;
    const offset = fileRef.current.largeFile?.page?.byteStart ?? 0;
    const retained = viewRef.current?.offset === offset ? viewRef.current : null;
    setPosition({ line: retained?.lineNumber ?? 1, column: retained?.column ?? 1 });
    onMount(editor, monacoInstance);
    if (retained) {
      editor.setPosition({ lineNumber: retained.lineNumber, column: retained.column });
      editor.setScrollPosition({ scrollTop: retained.scrollTop, scrollLeft: retained.scrollLeft });
    }
    const remember = () => {
      const position = editor.getPosition();
      if (position) viewRef.current = { offset, ...position, scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft() };
    };
    const actions = [
      editor.addAction({ id: 'codex.large.find', label: 'Find in saved large file', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF], run: () => setDialog('find') }),
      editor.addAction({ id: 'codex.large.goto', label: 'Go to byte or global line', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG], run: () => { setDestinationKind('byte'); setDestination(String(fileRef.current.largeFile?.page?.byteStart ?? 0)); setDialog('navigate'); } }),
      editor.addAction({ id: 'codex.large.next', label: 'Next file page', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.PageDown], run: () => { const current = fileRef.current; const page = current.largeFile?.page; if (page?.nextCursor) void controller.load(current.path, { offset: page.byteEnd, cursor: page.nextCursor }); } }),
      editor.addAction({ id: 'codex.large.previous', label: 'Previous file page', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.PageUp], run: () => { const current = fileRef.current; const page = current.largeFile?.page; if (page?.previousOffset !== null && page?.previousOffset !== undefined) void controller.load(current.path, { offset: page.previousOffset }); } }),
      editor.onDidChangeCursorPosition(event => { setPosition({ line: event.position.lineNumber, column: event.position.column }); remember(); }),
      editor.onDidScrollChange(remember),
    ];
    editor.onDidDispose(() => { for (const action of actions) action.dispose(); if (editorRef.current === editor) editorRef.current = null; });
    reveal();
  };

  const windowOptions = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
    ...options, ariaLabel: `Loaded page of ${file.path}`,
    readOnly: Boolean(options.readOnly || blocked || !page?.editable || file.missing),
    minimap: { enabled: false }, folding: false, codeLens: false, glyphMargin: false,
    renderValidationDecorations: 'off', lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
    quickSuggestions: false, suggestOnTriggerCharacters: false, parameterHints: { enabled: false },
    wordBasedSuggestions: 'currentDocument', hover: { enabled: false }, 'semanticHighlighting.enabled': false,
    lineNumbers: options.lineNumbers === 'off' ? 'off' : local => {
      if (page?.startLine === null || page?.startLine === undefined) return `${local}·`;
      if (!dirty && page.endsMidLine && file.content.endsWith('\r') && page.endLine !== null && page.startLine + local - 1 > page.endLine) return '↳';
      return String(page.startLine + local - 1);
    },
    lineNumbersMinChars: Math.max(4, String(page?.endLine ?? 0).length),
    renderWhitespace: 'none', largeFileOptimizations: true, scrollbar: { ...options.scrollbar, useShadows: false },
  }), [options, file.path, file.missing, file.content, dirty, blocked, page?.editable, page?.startLine, page?.endLine, page?.endsMidLine]);

  const runSearch = async (continuation = false) => {
    if (!query.length || file.transferring || window.document.body.dataset.workspaceLocked === 'true') return;
    requestRef.current?.abort();
    const request = new AbortController(); requestRef.current = request;
    const identity = { path: file.path, id: state.id, version: file.version };
    const nextCursor = continuation ? search?.nextCursor : undefined;
    setSearching(true); setSearchError('');
    try {
      const result = await api<WorkspaceFileSearchResult>(`/workspaces/${encodeURIComponent(workspaceId)}/file-search`, {
        ...json('POST', { path: identity.path, version: identity.version, query, caseSensitive, ...(nextCursor ? { cursor: nextCursor } : {}) }), signal: request.signal,
      });
      if (request.signal.aborted || !aliveRef.current || requestRef.current !== request
        || fileRef.current.path !== identity.path || fileRef.current.version !== identity.version || fileRef.current.largeFile?.id !== identity.id) return;
      if (result.path !== identity.path || result.version !== identity.version || result.query !== query || !Array.isArray(result.matches) || result.matches.length > 100) throw new Error('The server returned an invalid search page. Please retry.');
      setSearch(result);
    } catch (error) { if (!request.signal.aborted && aliveRef.current && requestRef.current === request) setSearchError(errorMessage(error)); }
    finally { if (requestRef.current === request && aliveRef.current) { requestRef.current = null; setSearching(false); } }
  };

  const navigate = async (event: FormEvent) => {
    event.preventDefault(); setNavigationError('');
    if (!/^\d+$/.test(destination)) { setNavigationError('Enter a whole number.'); return; }
    const number = Number(destination);
    if (!Number.isSafeInteger(number) || number < (destinationKind === 'line' ? 1 : 0) || (destinationKind === 'byte' && number > file.size)) {
      setNavigationError(destinationKind === 'line' ? 'Enter a line number of 1 or greater.' : `Enter a byte offset from 0 to ${file.size.toLocaleString()}.`); return;
    }
    if (navigationBlocked) { setNavigationError('Save or discard the current page before navigating.'); return; }
    setDialog(null);
    if (destinationKind === 'line') await controller.seekLine(file.path, number);
    else await controller.load(file.path, { offset: number }, { revealByte: number });
  };

  const copyPage = () => void navigator.clipboard.writeText(file.content)
    .then(() => { if (aliveRef.current) notifyRef.current('Edited page copied. Other file bytes are not included.', 'success'); })
    .catch(() => { if (aliveRef.current) notifyRef.current('Clipboard access failed. Select and copy the page text in the editor.', 'error'); });

  const modelKey = `${workspaceId}/${encodeURIComponent(file.path)}/${state.id}/${encodeURIComponent(page?.version ?? '')}/${page?.byteStart ?? 0}`;
  const modelPath = `codex-page://${modelKey}`;
  const original = compare === 'disk' ? state.remote : undefined;
  const showDiff = Boolean(compare && page && (compare === 'saved' || original));
  const range = page ? pageRangeLabel(page) : `${sizeLabel(file.size)} · Pages load as needed`;

  return <section className="large-file-editor" aria-label={`Paged editor for ${file.path}`} data-page-start={page?.byteStart} data-page-end={page?.byteEnd}>
    {(state.conflict || file.missing) && <div className="large-file-notice large-file-conflict" role="alert">
      <AlertCircle size={16} /><div><strong>{file.missing ? 'This file was removed from disk.' : state.conflict}</strong><p>Your edited page stays in this tab.</p></div>
      <div className="large-file-notice-actions"><button className="button ghost" onClick={copyPage}><Copy size={13} />Copy edited page</button>
        {!file.missing && <button className="button" disabled={blocked} onClick={() => { lastInspection.current = `${workspaceId}:${file.path}:${state.id}:${page?.pageToken ?? ''}`; onCompare('disk'); void controller.inspectConflict(file.path); }}>Review current range</button>}
        <button className="button ghost" disabled={blocked} onClick={() => void onReload(file.path)}>Discard and reload</button>
      </div>
    </div>}
    {(state.remote?.readOnlyReason || state.info.readOnlyReason) && <div className="large-file-notice" role="status"><AlertCircle size={15} /><p>{state.remote?.readOnlyReason || state.info.readOnlyReason}</p></div>}
    {state.error && <div className="large-file-notice" role="alert"><AlertCircle size={15} /><p>{state.error}</p><button className="button" disabled={blocked || dirty || Boolean(state.conflict)} onClick={() => void controller.load(file.path)}>Retry page</button></div>}
    {compare && <div className="large-file-comparison">
      <span>{compare === 'disk' ? 'Current saved range' : 'Last saved page'} → Edited page</span>
      {compare === 'disk' && state.reviewing && <span role="status"><LoaderCircle size={13} className="editor-spin" />Reading current range…</span>}
      {compare === 'disk' && state.remote && <span>{state.remote.readOnlyReason || (canReviewRange(file) ? `Compared bytes ${state.remote.byteStart.toLocaleString()}–${state.remote.byteEnd.toLocaleString()}` : 'Page boundaries changed. Copy your edits, then reload.')}</span>}
      {compare === 'disk' && canReviewRange(file) && <button className="button" disabled={blocked || !dirty} onClick={() => {
        if (window.confirm(`Replace bytes ${state.remote!.byteStart.toLocaleString()}–${state.remote!.byteEnd.toLocaleString()} of the current ${file.path} with this edited page? All other bytes will be preserved.`)) {
          void onSave(file.path, true).then(saved => { if (saved && aliveRef.current) onCompare(null); });
        }
      }}>Apply reviewed page</button>}
      <button className="icon-button" aria-label="Close page comparison" onClick={() => onCompare(null)}><X size={14} /></button>
    </div>}
    {state.reviewError && compare === 'disk' && <div className="large-file-notice" role="alert"><p>{state.reviewError}</p><button className="button" disabled={state.reviewing || blocked} onClick={() => void controller.inspectConflict(file.path)}>Retry comparison</button></div>}
    {state.seek && <div className="large-file-notice" role="status"><p>Read through line {page?.endLine?.toLocaleString() ?? 'unknown'}. Continue toward line {state.seek.line.toLocaleString()}.</p><button className="button" disabled={navigationBlocked} onClick={() => void controller.seekLine(file.path, state.seek!.line, state.seek!.column, true)}>Continue to line</button><button className="button ghost" onClick={() => { setDestinationKind('byte'); setDestination(String(page?.byteEnd ?? 0)); setDialog('navigate'); }}>Go to byte instead</button></div>}
    <div className="large-file-surface" aria-busy={Boolean(state.loading)}>
      {!page ? <div className="editor-loading"><LoaderCircle size={18} className={state.loading ? 'editor-spin' : ''} /><span>{state.loading ? 'Loading file page…' : state.error ? 'The page is unavailable. Retry when ready.' : 'Preparing file page…'}</span></div>
        : showDiff ? <DiffEditor
          key={`compare:${modelKey}:${original?.version ?? 'saved'}`}
          original={original ? (original.byteStart === 0 && original.content.startsWith('\uFEFF') ? original.content.slice(1) : original.content) : largePageVisibleContent(file, file.savedContent)}
          modified={largePageVisibleContent(file)} language={language} theme="codex-dark"
          originalModelPath={`codex-page-original://${modelKey}/${encodeURIComponent(original?.version ?? 'saved')}`}
          modifiedModelPath={`codex-page-diff://${modelKey}`} keepCurrentOriginalModel={false} keepCurrentModifiedModel={false}
          options={{ ...windowOptions, originalEditable: false, renderSideBySide: window.innerWidth >= 840, renderOverviewRuler: false, enableSplitViewResizing: true, diffWordWrap: options.wordWrap === 'on' ? 'on' : 'off' }}
          onMount={(diff) => {
            const modified = diff.getModifiedEditor(); mount(modified, monaco);
            const subscription = modified.onDidChangeModelContent(() => edit(modified.getValue(), page.pageToken));
            const scroll = diff.getOriginalEditor().onDidScrollChange(event => { if (event.scrollTopChanged || event.scrollLeftChanged) { const element = diff.getOriginalEditor().getDomNode(); if (element) markScrollActivity(element); } });
            modified.onDidDispose(() => { subscription.dispose(); scroll.dispose(); });
          }}
          loading={<div className="editor-loading">Opening page comparison…</div>}
        /> : <Editor
          key={`page:${modelKey}`} path={modelPath} value={largePageVisibleContent(file)} language={language} theme="codex-dark"
          keepCurrentModel={false} saveViewState={false} options={windowOptions}
          onMount={mount} onChange={value => edit(value ?? '', page.pageToken)}
          loading={<div className="editor-loading">Opening file page…</div>}
        />}
      {page && state.loading && <div className="large-file-loading" role="status"><LoaderCircle size={15} className="editor-spin" />Loading next page…</div>}
    </div>
    <footer className="large-file-footer">
      <div className="large-file-range"><span className="large-file-mode">Paged · {sizeLabel(file.size)}</span><span title={range} aria-live="polite">{range}</span></div>
      <div className="large-file-page-navigation" aria-label="File pages">
        <button className="icon-button" aria-label="Previous file page" title="Previous page · Ctrl/⌘ Alt Page Up" disabled={navigationBlocked || page?.previousOffset == null} onClick={() => { if (page?.previousOffset != null) void controller.load(file.path, { offset: page.previousOffset }); }}><ArrowLeft size={16} /></button>
        <button className="button ghost" disabled={blocked} onClick={() => { setDestinationKind('byte'); setDestination(String(page?.byteStart ?? 0)); setNavigationError(''); setDialog('navigate'); }}>Go to…</button>
        <button className="icon-button" aria-label="Next file page" title="Next page · Ctrl/⌘ Alt Page Down" disabled={navigationBlocked || !page?.nextCursor} onClick={() => { if (page?.nextCursor) void controller.load(file.path, { offset: page.byteEnd, cursor: page.nextCursor }); }}><ArrowRight size={16} /></button>
      </div>
      <div className="large-file-position"><span className="editor-save-state">{file.transferring ? 'File operation…' : file.saving ? 'Saving and verifying file…' : state.conflict ? 'Changed on disk' : dirty ? 'Unsaved page' : <><Check size={11} />Saved page</>}</span><span>{page ? pagePositionLabel(page, file.content, position.line, position.column, dirty) : 'UTF-8 text'}</span></div>
      <div className="large-file-limit">{dirty ? <>Save or <button disabled={blocked} onClick={() => void onReload(file.path)}>discard this page</button> before navigating.</> : 'Page syntax only · Full-file diagnostics unavailable'}{page?.startsMidLine || page?.endsMidLine ? ' · A line continues outside this page.' : ''}</div>
    </footer>

    {dialog === 'navigate' && <EditorDialog label="Go to position in large file" onClose={() => setDialog(null)} className="large-file-dialog">
      <form onSubmit={event => void navigate(event)}><div className="large-file-dialog-heading"><h3>Go to position</h3><button type="button" className="icon-button" aria-label="Close position dialog" onClick={() => setDialog(null)}><X size={17} /></button></div>
        <SelectMenu aria-label="Position type" value={destinationKind} onValueChange={setDestinationKind} options={[{ value: 'byte', label: 'Byte offset', description: 'Direct, bounded access' }, { value: 'line', label: 'Global line', description: 'Read bounded sections until the line is found' }]} />
        <label className="large-file-field">{destinationKind === 'byte' ? 'Byte offset (starts at 0)' : 'Global line number'}<input data-autofocus className="input" inputMode="numeric" maxLength={16} value={destination} onChange={event => setDestination(event.target.value)} /></label>
        <p>{destinationKind === 'byte' ? `File size: ${file.size.toLocaleString()} bytes. Global line numbers may be unknown after a direct byte jump.` : 'Reads up to eight pages per action. For distant lines, continue the scan or use a byte offset.'}</p>
        {(navigationError || navigationBlocked) && <p role="alert">{navigationError || 'Save or discard the loaded page before navigating.'}</p>}
        <button type="submit" className="button primary" disabled={navigationBlocked}>Go to position</button>
      </form>
    </EditorDialog>}

    {dialog === 'find' && <EditorDialog label="Find in large file" onClose={() => { requestRef.current?.abort(); setSearching(false); setDialog(null); }} className="large-file-dialog">
      <form onSubmit={event => { event.preventDefault(); void runSearch(); }}><div className="large-file-dialog-heading"><h3>Find in saved file</h3><button type="button" className="icon-button" aria-label="Close large file search" onClick={() => { requestRef.current?.abort(); setSearching(false); setDialog(null); }}><X size={17} /></button></div>
        <label className="large-file-field">Find text<input data-autofocus className="input" maxLength={1024} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="large-file-find-options"><label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />Match case</label><button className="button" type="submit" disabled={!query.length || searching || file.transferring}>{searching ? <LoaderCircle size={14} className="editor-spin" /> : <Search size={14} />}Search</button></div>
      </form>
      <p>Literal search reads a bounded part of the saved file per request. Unsaved edits are available through <button className="large-file-text-button" onClick={() => findInPage()}>Find in loaded page</button>.</p>
      {searchError && <p role="alert">{searchError}</p>}
      {search && <><p className="large-file-search-progress" role="status">{search.matches.length} {search.matches.length === 1 ? 'match' : 'matches'} in bytes {search.searchedFrom.toLocaleString()}–{search.scannedThrough.toLocaleString()} of {search.size.toLocaleString()}{search.complete ? ' · End of file reached' : ' · More remains to search'}.</p>
        <div className="large-file-search-results" aria-label="Large file search results">{search.matches.map((match, index) => <button key={`${match.byteStart}:${index}`} disabled={navigationBlocked} title={`Line ${match.line}, byte ${match.byteStart}`} onClick={() => { setDialog(null); void controller.load(file.path, { offset: match.byteStart }, { revealByte: match.byteStart }); }}><span>Ln {match.line.toLocaleString()} · byte {match.byteStart.toLocaleString()}</span><code>{match.preview}</code></button>)}</div>
        {navigationBlocked && search.matches.length > 0 && <p>Save or discard this page before opening a search result.</p>}
        {search.nextCursor && <button className="button" disabled={searching || file.transferring} onClick={() => void runSearch(true)}>{searching ? 'Searching…' : 'Search next section'}</button>}
      </>}
    </EditorDialog>}
  </section>;
}
