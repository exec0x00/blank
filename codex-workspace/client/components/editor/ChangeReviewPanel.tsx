import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, CircleAlert, FileDiff, LoaderCircle, LockKeyhole, RefreshCw, Search } from 'lucide-react';
import { ApiError } from '../../api';
import { monaco } from '../../monaco';
import { markScrollActivity } from '../../scroll-activity';
import { CopyButton } from '../chat/MarkdownMessage';
import { SelectMenu } from '../ui/Dropdown';
import { changeReviewKey, changeReviewModelUri, type ChangeReviewTarget } from './change-review';
import { changeReviewPageQuery, readChangeReview, type ChangeReviewFile, type ChangeReviewQuery, type ChangeReviewResult } from './change-review-reader';
import './change-review.css';

type Load = { key: string } & ({ status: 'loading' } | { status: 'loaded'; result: ChangeReviewResult } | { status: 'error'; message: string; changed: boolean });
export interface ChangeReviewPanelProps {
  target: ChangeReviewTarget;
  instanceId: string;
  active: boolean;
  locked: boolean;
  fontSize: number;
  wordWrap: boolean;
  reduceMotion: boolean;
  onShowFiles: () => void;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
}

/** A single bounded recorded page. Working-file models are never read or changed. */
export function ChangeReviewPanel({ target, instanceId, active, locked, fontSize, wordWrap, reduceMotion, onShowFiles, onNotify }: ChangeReviewPanelProps) {
  const uid = useId();
  const identity = changeReviewKey(target);
  const [query, setQuery] = useState<ChangeReviewQuery>({ offset: 0 });
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);
  const [fileList, setFileList] = useState<{ identity: string; files: ChangeReviewFile[] } | null>(null);
  const retained = useRef(load); retained.current = load;
  const [sessionLocked, setSessionLocked] = useState(() => document.body.dataset.workspaceLocked === 'true');
  const blocked = locked || sessionLocked;
  const queryKey = JSON.stringify([identity, query, attempt]);
  const current = load?.key === queryKey ? load : null;
  const result = !blocked && current?.status === 'loaded' ? current.result : null;
  const page = result?.status === 'ready' ? result : null;
  const loading = active && !blocked && (!current || current.status === 'loading');
  const failure = !blocked && current?.status === 'error' ? current : null;
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const live = useRef({ key: queryKey, active, blocked });
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const initialFocus = useRef(true);
  const cancel = useCallback(() => { generation.current++; request.current?.abort(); request.current = null; }, []);
  useLayoutEffect(() => { live.current = { key: queryKey, active, blocked }; return cancel; }, [queryKey, active, blocked, cancel]);
  useEffect(() => {
    const stop = () => { live.current.blocked = true; cancel(); setLoad(null); setFileList(null); setQuery({ offset: 0 }); setSessionLocked(true); };
    const unlock = () => setSessionLocked(false);
    window.addEventListener('codex:session-locked', stop); window.addEventListener('codex:session-expired', stop); window.addEventListener('codex:session-unlocked', unlock);
    return () => { window.removeEventListener('codex:session-locked', stop); window.removeEventListener('codex:session-expired', stop); window.removeEventListener('codex:session-unlocked', unlock); };
  }, [cancel]);
  useEffect(() => {
    if (blocked) { cancel(); setLoad(null); return; }
    if (!active) { cancel(); setLoad(previous => previous?.status === 'loading' ? null : previous); return; }
    if (retained.current?.key === queryKey && retained.current.status === 'loaded') return;
    const controller = new AbortController(), revision = ++generation.current;
    request.current = controller;
    const isCurrent = () => !controller.signal.aborted && generation.current === revision && live.current.key === queryKey && live.current.active
      && !live.current.blocked && document.body.dataset.workspaceLocked !== 'true';
    setLoad({ key: queryKey, status: 'loading' });
    const timer = window.setTimeout(() => {
      if (!isCurrent()) return;
      controller.abort();
      setLoad({ key: queryKey, status: 'error', changed: false, message: 'Reading this recorded patch timed out. Try again.' });
    }, 20_000);
    void (async () => {
      try {
        await Promise.resolve();
        if (!isCurrent()) return;
        const result = await readChangeReview(target, query, controller.signal);
        if (!isCurrent()) return;
        setFileList(result.status === 'ready' ? { identity, files: result.parts } : null);
        if (result.status === 'ready' && query.part === undefined && target.path) {
          const match = result.parts.find(part => part.path === target.path);
          if (match && match.id !== result.part) { setQuery(changeReviewPageQuery(result, 0, match.id)); return; }
        }
        setLoad({ key: queryKey, status: 'loaded', result });
      } catch (error) {
        if (!isCurrent()) return;
        setFileList(null);
        setLoad({ key: queryKey, status: 'error', changed: error instanceof ApiError && error.status === 409,
          message: error instanceof Error ? error.message.slice(0, 1000) : 'This recorded patch could not be read.' });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { window.clearTimeout(timer); controller.abort(); if (request.current === controller) request.current = null; if (generation.current === revision) generation.current++; };
  }, [queryKey, active, blocked, cancel, target, query]);

  const hunks = useMemo(() => page?.text.split('\n').flatMap((line, index) => /^@@(?:\s|$)|^\*\*\* (?:Add|Update|Delete) File:|^Binary files |^GIT binary patch$/.test(line) ? [index + 1] : []) ?? [], [page?.text]);
  const uri = page ? changeReviewModelUri(target, instanceId, page.version, page.part, page.offset) : undefined;
  function restart() { if (blocked || !active) return; cancel(); setLoad(null); setFileList(null); setQuery({ offset: 0 }); setAttempt(value => value + 1); }
  function navigate(offset: number, part = page?.part) {
    if (!page || !part || blocked || loading || !active || !page.parts.some(file => file.id === part)) return;
    cancel(); setLoad(null);
    // Saved legacy versions are scoped to each content part; native versions cover the whole item.
    setQuery(target.source === 'saved-tool' && part !== page.part ? { part, offset } : changeReviewPageQuery(page, offset, part));
  }
  function revealHunk(direction: -1 | 1) {
    const surface = editor.current;
    if (!surface || !hunks.length) return;
    const line = surface.getPosition()?.lineNumber ?? 1;
    const next = direction === 1 ? hunks.find(value => value > line) ?? hunks[0] : [...hunks].reverse().find(value => value < line) ?? hunks[hunks.length - 1];
    surface.setPosition({ lineNumber: next, column: 1 }); surface.revealLineInCenter(next, reduceMotion ? monaco.editor.ScrollType.Immediate : monaco.editor.ScrollType.Smooth); surface.focus();
  }
  const range = page ? page.totalChars ? `Characters ${(page.offset + 1).toLocaleString()}–${(page.offset + page.text.length).toLocaleString()} of ${page.totalChars.toLocaleString()}` : 'No recorded text'
    : loading ? 'Loading recorded patch…' : 'Patch unavailable';
  const wholePage = !!page && page.offset === 0 && page.nextOffset === null;
  const copyGeneration = generation.current;
  const files = !blocked && fileList?.identity === identity ? fileList.files : [];
  const selectedPart = page?.part ?? query.part ?? (target.source === 'native-item' && target.part !== undefined ? String(target.part) : files[0]?.id ?? '0');
  const selectedFile = files.find(file => file.id === selectedPart);

  return <section className="change-review" aria-label="Recorded change review" aria-busy={loading}>
    <div className="change-review-heading">
      <button type="button" className="editor-mobile-files-button" aria-label="Show files" title="Show files" onClick={onShowFiles}><ArrowLeft size={15} /></button>
      <FileDiff size={15} aria-hidden="true" /><strong className="text-ellipsis" data-tooltip={target.label || 'Recorded file changes'}>{target.label || 'Recorded file changes'}</strong>
      <span className="change-review-readonly"><LockKeyhole size={12} aria-hidden="true" />Read-only</span>
      {target.source !== 'recorded-patch' && <button type="button" className="icon-button" aria-label="Refresh recorded patch" title="Refresh recorded patch" disabled={loading || blocked} onClick={restart}><RefreshCw size={14} /></button>}
    </div>
    <div className="change-review-toolbar">
      {files.length > 1 ? <SelectMenu className="change-review-file-select" aria-label="Changed file or patch section" value={selectedPart}
        options={files.map(part => ({ value: part.id, label: part.label }))} searchable={files.length > 8} disabled={loading || blocked || !page}
        onValueChange={part => navigate(0, part)} /> : <span className="change-review-file-label" title={page?.path ?? page?.label}>{page?.path ?? page?.label ?? selectedFile?.path ?? selectedFile?.label ?? target.path ?? 'Recorded patch'}</span>}
      <div className="change-review-tools">
        <button type="button" className="icon-button" aria-label="Find in recorded patch" title="Find in recorded patch" disabled={!page?.text} onClick={() => { editor.current?.focus(); void editor.current?.getAction('actions.find')?.run(); }}><Search size={14} /></button>
        <button type="button" className="icon-button" aria-label="Previous change in this page" title="Previous change in this page" disabled={!hunks.length} onClick={() => revealHunk(-1)}><ArrowUp size={14} /></button>
        <button type="button" className="icon-button" aria-label="Next change in this page" title="Next change in this page" disabled={!hunks.length} onClick={() => revealHunk(1)}><ArrowDown size={14} /></button>
        {page && <CopyButton key={uri} text={page.text} label={wholePage ? 'Copy recorded patch' : 'Copy patch page'} onNotify={(message, kind) => {
          if (generation.current === copyGeneration && live.current.key === queryKey && live.current.active && !live.current.blocked) onNotify(message, kind);
        }} />}
      </div>
    </div>
    {page && (page.notices.length > 0 || !wholePage) && <div className="change-review-notices" role="status">
      {!wholePage && <p>This patch is shown one page at a time. Lines outside this page are available with Previous and Next.</p>}
      {page.notices.map((notice, index) => <p key={index}>{notice}</p>)}
    </div>}
    <div className="change-review-surface">
      {loading && <div className="change-review-message" role="status"><LoaderCircle size={21} className="editor-spin" /><p>Reading recorded changes…</p></div>}
      {result?.status === 'searching' && <div className="change-review-message" role="status"><Search size={21} /><strong>More history to search</strong><p>The selected change is farther back in this conversation.</p><button type="button" className="button" onClick={() => { cancel(); setLoad(null); setQuery({ ...query, cursor: result.nextCursor }); }}>Continue search</button></div>}
      {result?.status === 'unavailable' && <div className="change-review-message" role="status"><CircleAlert size={21} /><strong>Recorded patch unavailable</strong><p>{result.message}</p><button type="button" className="button" onClick={restart}><RefreshCw size={14} />Try again</button></div>}
      {failure && <div className="change-review-message" role="alert"><CircleAlert size={21} /><strong>{failure.changed ? 'Recorded content changed' : 'Could not read this patch'}</strong><p>{failure.changed ? 'Load the latest saved version from the beginning.' : failure.message}</p><button type="button" className="button" onClick={() => { if (failure.changed) restart(); else { cancel(); setLoad(null); setAttempt(value => value + 1); } }}><RefreshCw size={14} />{failure.changed ? 'Restart from beginning' : 'Try again'}</button></div>}
      {page && (page.text ? <Editor key={uri} path={uri} value={page.text} language={page.language} theme="codex-dark" keepCurrentModel={false} saveViewState={false}
        options={{ readOnly: true, domReadOnly: true, automaticLayout: true, fontSize, lineHeight: Math.round(fontSize * 1.65),
          fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace', minimap: { enabled: false },
          wordWrap: wordWrap ? 'on' : 'off', lineNumbers: 'on', scrollBeyondLastLine: false, smoothScrolling: !reduceMotion,
          cursorSmoothCaretAnimation: reduceMotion ? 'off' : 'on', cursorBlinking: reduceMotion ? 'solid' : 'smooth',
          renderLineHighlight: 'none', folding: false, contextmenu: false, links: false, padding: { top: 14, bottom: 14 },
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
          ariaLabel: `Recorded ${page.language === 'diff' ? 'patch' : 'file content'} for ${page.path ?? page.label}; read-only` }}
        loading={<div className="change-review-message" role="status"><LoaderCircle size={20} className="editor-spin" /><p>Opening patch editor…</p></div>}
        onMount={surface => {
          editor.current = surface;
          const scroll = surface.onDidScrollChange(event => { if (event.scrollTopChanged || event.scrollLeftChanged) { const node = surface.getDomNode(); if (node) markScrollActivity(node); } });
          const save = surface.addAction({ id: 'codex.reviewReadOnly', label: 'Recorded changes are read-only', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS], run: () => undefined });
          surface.onDidDispose(() => { scroll.dispose(); save.dispose(); if (editor.current === surface) editor.current = null; });
          if (initialFocus.current && live.current.active && !live.current.blocked) { initialFocus.current = false; surface.focus(); }
        }} /> : <div className="change-review-message" role="status"><FileDiff size={21} /><strong>No text patch was recorded</strong><p>This file change may contain only file metadata or binary content.</p></div>)}
      {blocked && <div className="change-review-message"><LockKeyhole size={21} /><p>Unlock the workspace to read recorded changes.</p></div>}
    </div>
    <nav className="change-review-pagination" aria-label="Recorded patch pages">
      <button type="button" className="button ghost" aria-label="Previous patch page" disabled={!page || loading || page.previousOffset === null} onClick={() => { if (page?.previousOffset !== null && page?.previousOffset !== undefined) navigate(page.previousOffset); }}><ChevronLeft size={15} /><span>Previous</span></button>
      <span id={uid + '-range'} role="status" aria-live="polite">{range}</span>
      <button type="button" className="button ghost" aria-label="Next patch page" disabled={!page || loading || page.nextOffset === null} onClick={() => { if (page?.nextOffset !== null && page?.nextOffset !== undefined) navigate(page.nextOffset); }}><span>Next</span><ChevronRight size={15} /></button>
    </nav>
  </section>;
}
