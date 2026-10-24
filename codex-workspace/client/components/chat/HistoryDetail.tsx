import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ConversationHistoryDetail } from '../../../shared/types';
import { api, ApiError } from '../../api';
import Modal from '../Modal';
import { SelectMenu } from '../ui/Dropdown';
import { CopyButton } from './MarkdownMessage';
import { errorMessage } from './state';
import './history-detail.css';

export interface HistoryDetailTarget {
  threadId: string;
  epoch: string;
  entryId?: string;
  messageId?: string;
  activityId?: string;
  field: 'text' | 'content' | 'input' | 'output' | 'citations';
  label: string;
  toolLabel?: string;
}

export interface HistoryDetailProps {
  target: HistoryDetailTarget | null;
  onClose: () => void;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  locked?: boolean;
  inline?: boolean;
  active?: boolean;
  sourceVersion?: string;
}

export const HISTORY_DETAIL_PAGE_CHARS = 16_384;

type DetailPresentation = NonNullable<ConversationHistoryDetail['presentation']>;
type Cursor = { key: string | null; offset: number; part?: string; version?: string; totalChars?: number; attempt: number };
type Failure = { kind: 'changed' | 'stale' | 'unavailable' | 'error'; message: string };
type Load = { key: string; offset: number; part?: string; sourceVersion?: string } & (
  | { status: 'loading' }
  | { status: 'ready'; page: ConversationHistoryDetail }
  | { status: 'error'; failure: Failure }
);

const initialCursor: Cursor = { key: null, offset: 0, attempt: 0 };
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const partId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
const readableLabel = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);

function detailPath(target: HistoryDetailTarget, offset: number, version?: string, part?: string): string {
  const selectorIsValid = target.field === 'text'
    ? identifier(target.entryId) && target.messageId === undefined && target.activityId === undefined
    : target.field === 'content' || target.field === 'citations'
      ? identifier(target.messageId) && target.entryId === undefined && target.activityId === undefined
      : (target.field === 'input' || target.field === 'output') && identifier(target.messageId) && identifier(target.activityId) && target.entryId === undefined;
  if (!identifier(target.threadId) || !identifier(target.epoch) || !selectorIsValid || !integer(offset) || offset < 0
    || (version !== undefined && (!version || version.length > 128))
    || (part !== undefined && (!partId(part) || target.field !== 'input' && target.field !== 'output'))) {
    throw new Error('This content cannot be opened. Return to the conversation and open it again.');
  }
  const query = new URLSearchParams({ epoch: target.epoch, field: target.field, offset: String(offset), limit: String(HISTORY_DETAIL_PAGE_CHARS) });
  if (target.entryId !== undefined) query.set('entryId', target.entryId);
  if (target.messageId !== undefined) query.set('messageId', target.messageId);
  if (target.activityId !== undefined) query.set('activityId', target.activityId);
  if (version !== undefined) query.set('version', version);
  if (part !== undefined) query.set('part', part);
  return `/threads/${encodeURIComponent(target.threadId)}/history/detail?${query}`;
}

function toolPresentation(value: unknown, requestedPart?: string): DetailPresentation {
  const detail = value as Partial<DetailPresentation> | null;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail) || !readableLabel(detail.label)
    || !['text', 'code', 'path'].includes(detail.kind ?? '') || !partId(detail.partId)
    || (requestedPart !== undefined && detail.partId !== requestedPart)
    || (detail.language !== undefined && detail.language !== 'shell' && detail.language !== 'diff')
    || (detail.path !== undefined && (typeof detail.path !== 'string' || detail.path.length > 4096 || /[\u0000-\u001f\u007f]/.test(detail.path)))
    || !Array.isArray(detail.parts) || detail.parts.length === 0 || detail.parts.length > 8
    || (detail.notices !== undefined && (!Array.isArray(detail.notices) || detail.notices.length > 8
      || detail.notices.some(notice => typeof notice !== 'string' || notice.length > 4000)))) {
    throw new Error('The saved tool details did not include a readable content section. Try again.');
  }
  const ids = new Set<string>();
  const parts = detail.parts.map(part => {
    if (!part || typeof part !== 'object' || !partId(part.id) || !readableLabel(part.label) || ids.has(part.id)) {
      throw new Error('The saved tool content choices were incomplete. Try again.');
    }
    ids.add(part.id);
    return { id: part.id, label: part.label };
  });
  if (!ids.has(detail.partId)) throw new Error('The saved tool section did not match its content choices. Try again.');
  return { label: detail.label, kind: detail.kind as DetailPresentation['kind'], partId: detail.partId, parts,
    ...(detail.language ? { language: detail.language } : {}), ...(detail.path !== undefined ? { path: detail.path } : {}),
    ...(detail.notices ? { notices: [...detail.notices] } : {}) };
}

/** Validate before retaining any text; unknown response fields never enter UI state. */
export function parseHistoryDetail(value: unknown, target: HistoryDetailTarget, offset: number, version?: string, totalChars?: number, part?: string): ConversationHistoryDetail {
  const page = value as Partial<ConversationHistoryDetail> | null;
  if (!page || typeof page !== 'object' || Array.isArray(page) || page.threadId !== target.threadId) {
    throw new Error('The content response did not match this conversation. Try again.');
  }
  if (page.epoch !== target.epoch) throw new ApiError('This conversation changed. Return to the conversation and open the content again.', 409, 'HISTORY_EPOCH_CHANGED');
  if (version !== undefined && page.version !== version) throw new ApiError('This content changed while you were reading it.', 409, 'HISTORY_ITEM_CHANGED');
  if (!integer(page.revision) || page.revision < 0 || typeof page.version !== 'string' || !page.version || page.version.length > 128
    || page.offset !== offset || !integer(page.totalChars) || page.totalChars < offset || (totalChars !== undefined && totalChars !== page.totalChars)
    || typeof page.text !== 'string' || page.text.length > HISTORY_DETAIL_PAGE_CHARS) {
    throw new Error('The content response was incomplete or exceeded the section limit. Try again.');
  }
  const end = offset + page.text.length;
  if (!Number.isSafeInteger(end) || end > page.totalChars
    || (offset === 0 ? page.previousOffset !== null : !integer(page.previousOffset) || page.previousOffset < Math.max(0, offset - HISTORY_DETAIL_PAGE_CHARS) || page.previousOffset >= offset)
    || (end === page.totalChars ? page.nextOffset !== null : page.nextOffset !== end || end <= offset)) {
    throw new Error('The content response did not include the reported character range. Try again.');
  }
  const presentation = target.field === 'input' || target.field === 'output' ? toolPresentation(page.presentation, part) : undefined;
  return { threadId: target.threadId, epoch: target.epoch, revision: page.revision, version: page.version,
    text: page.text, totalChars: page.totalChars, offset, previousOffset: page.previousOffset as number | null, nextOffset: page.nextOffset as number | null,
    ...(presentation ? { presentation } : {}) };
}

function failureFor(error: unknown): Failure {
  const message = errorMessage(error).slice(0, 1000);
  if (error instanceof ApiError) {
    if (error.status === 409) return { kind: error.code === 'HISTORY_ITEM_CHANGED' ? 'changed' : 'stale', message };
    if (error.status === 404) return { kind: 'unavailable', message };
  }
  return { kind: 'error', message };
}

/** One bounded section is retained. Every later page is pinned to its content version. */
export function HistoryDetail({ target, onClose, onNotify, locked = false, inline = false, active = true, sourceVersion }: HistoryDetailProps) {
  const uid = useId();
  const key = target ? JSON.stringify([target.threadId, target.epoch, target.entryId, target.messageId, target.activityId, target.field]) : null;
  const [sessionLocked, setSessionLocked] = useState(() => typeof document !== 'undefined' && document.body.dataset.workspaceLocked === 'true');
  const [cursor, setCursor] = useState<Cursor>(initialCursor);
  const [load, setLoad] = useState<Load | null>(null);
  const retained = useRef(load); retained.current = load;
  const [savedPresentation, setSavedPresentation] = useState<{ key: string; value: DetailPresentation } | null>(null);
  const blocked = locked || sessionLocked;
  const live = useRef({ key, blocked });
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const viewport = useRef<HTMLDivElement>(null);
  const selectedCursor = cursor.key === key ? cursor : initialCursor;
  const { offset, part, version, totalChars, attempt } = selectedCursor;
  const current = load?.key === key && load.offset === offset && load.part === part ? load : null;
  const page = !blocked && current?.status === 'ready' ? current.page : null;
  const failure = !blocked && current?.status === 'error' ? current.failure : null;
  const loading = !!target && active && !blocked && (!current || current.status === 'loading');
  const presentation = savedPresentation?.key === key ? savedPresentation.value : null;

  const cancel = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
  }, []);

  // Invalidate at commit, including unmount, before a late response can be used.
  useLayoutEffect(() => {
    live.current = { key, blocked };
    setCursor(previous => previous.key === key ? previous : initialCursor);
    setSavedPresentation(previous => previous?.key === key ? previous : null);
    return () => cancel();
  }, [key, blocked, cancel]);

  useEffect(() => {
    const lock = () => {
      live.current.blocked = true;
      cancel();
      setLoad(null);
      setSavedPresentation(null);
      setCursor(initialCursor);
      setSessionLocked(true);
      close.current();
    };
    const unlock = () => setSessionLocked(false);
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-expired', lock);
    window.addEventListener('codex:session-unlocked', unlock);
    return () => {
      window.removeEventListener('codex:session-locked', lock);
      window.removeEventListener('codex:session-expired', lock);
      window.removeEventListener('codex:session-unlocked', unlock);
    };
  }, [cancel]);

  useEffect(() => {
    if (!target || !key || blocked) {
      cancel();
      setLoad(null);
      setSavedPresentation(null);
      setCursor(previous => previous.key === null ? previous : initialCursor);
      return;
    }
    if (!active) { cancel(); setLoad(previous => previous?.status === 'loading' ? null : previous); return; }
    if (retained.current?.key === key && retained.current.offset === offset && retained.current.part === part && retained.current.status === 'ready') return;
    const controller = new AbortController();
    const ownGeneration = ++generation.current;
    request.current = controller;
    const isCurrent = () => !controller.signal.aborted && generation.current === ownGeneration && live.current.key === key && !live.current.blocked;
    setLoad({ key, offset, part, status: 'loading' });
    void (async () => {
      try {
        await Promise.resolve();
        if (!isCurrent()) return;
        const value = await api<unknown>(detailPath(target, offset, version, part), { signal: controller.signal, cache: 'no-store' });
        if (!isCurrent()) return;
        const result = parseHistoryDetail(value, target, offset, version, totalChars, part);
        setSavedPresentation(result.presentation ? { key, value: result.presentation } : null);
        setLoad({ key, offset, part, sourceVersion, status: 'ready', page: result });
      } catch (error) {
        if (isCurrent()) setLoad({ key, offset, part, status: 'error', failure: failureFor(error) });
      }
    })();
    return () => {
      controller.abort();
      if (request.current === controller) request.current = null;
      if (generation.current === ownGeneration) generation.current++;
    };
    // The key includes every request selector; changing only its label does not refetch.
  }, [key, blocked, active, offset, part, version, totalChars, attempt, cancel]);

  useEffect(() => {
    if (!key || blocked || inline) return;
    const frame = requestAnimationFrame(() => viewport.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [key, blocked, inline]);

  useLayoutEffect(() => {
    if (!page || !viewport.current) return;
    viewport.current.scrollTop = 0;
    viewport.current.scrollLeft = 0;
  }, [page]);

  function dismiss() {
    cancel();
    setLoad(null);
    setSavedPresentation(null);
    setCursor(initialCursor);
    onClose();
  }

  function navigate(nextOffset: number) {
    if (!page || !key || blocked || loading) return;
    cancel();
    setCursor({ key, offset: nextOffset, part: page.presentation?.partId, version: page.version, totalChars: page.totalChars, attempt: 0 });
  }

  function selectPart(nextPart: string) {
    if (!key || blocked || loading || !presentation?.parts.some(option => option.id === nextPart) || nextPart === (part ?? presentation.partId)) return;
    cancel();
    setLoad(null);
    setCursor({ key, part: nextPart, offset: 0, attempt: attempt + 1 });
  }

  function retry(restart: boolean) {
    if (!key || blocked) return;
    cancel();
    setLoad(null);
    if (restart) setSavedPresentation(null);
    setCursor({ key, offset: restart ? 0 : offset, part, ...(restart ? {} : { version, totalChars }), attempt: attempt + 1 });
  }

  if (!target || blocked) return null;

  const notificationGeneration = generation.current;
  const updated = inline && current?.status === 'ready' && current.sourceVersion !== sourceVersion;
  const previousDisabled = !page || loading || page.previousOffset === null;
  const nextDisabled = !page || loading || page.nextOffset === null;
  const range = page ? page.totalChars === 0 ? 'No saved text' : page.text.length === 0 ? `No characters in this section (${page.totalChars.toLocaleString()} total)` : `Characters ${(page.offset + 1).toLocaleString()}–${(page.offset + page.text.length).toLocaleString()} of ${page.totalChars.toLocaleString()}` : loading ? 'Loading section…' : 'Section unavailable';

  const body = <div className="chat-history-detail-body">
      <div className="chat-history-detail-toolbar">
        {presentation && presentation.parts.length > 1 ? <SelectMenu className="chat-history-detail-part" value={part ?? presentation.partId}
          options={presentation.parts.map(option => ({ value: option.id, label: option.label }))} onValueChange={selectPart} disabled={loading}
          aria-label={inline ? 'Content section' : 'Content to inspect'} /> : <span>{presentation?.label ?? (inline ? target.label : 'Plain text')}{!inline && ' · Read-only'}</span>}
        {page && <CopyButton key={`${key}:${page.version}:${page.presentation?.partId ?? ''}:${page.offset}`} text={page.text} label="Copy this section" onNotify={(message, kind) => {
          if (generation.current === notificationGeneration && live.current.key === key && !live.current.blocked) onNotify(message, kind);
        }} />}
      </div>
      {updated && <div className="chat-history-detail-update" role="status"><span>Newer content is available.</span><button type="button" className="button ghost" onClick={() => retry(true)}><RefreshCw size={13} aria-hidden="true" />Refresh</button></div>}
      {page?.presentation && !!(page.presentation.path || page.presentation.notices?.length) && <div className="chat-history-detail-context" tabIndex={0} aria-label="Saved tool context">
        {page.presentation.path && <p className="chat-history-detail-path"><span>File</span><code>{page.presentation.path}</code></p>}
        {!!page.presentation.notices?.length && <ul aria-label="Saved tool notices">{page.presentation.notices.map((notice, index) => <li key={index}><CircleAlert size={14} aria-hidden="true" /><span>{notice}</span></li>)}</ul>}
      </div>}
      <div ref={viewport} className="chat-history-detail-scroll" role="region" aria-label={`${target?.label || 'Conversation detail'} section`}
        aria-describedby={`${uid}-range`} aria-busy={loading} tabIndex={0} data-autofocus={!inline || undefined}>
        {loading && <div className="chat-history-detail-message" role="status"><LoaderCircle size={21} className="chat-history-detail-spinner" aria-hidden="true" /><p>Loading saved content…</p></div>}
        {failure && <div className="chat-history-detail-message" role="alert">
          <CircleAlert size={22} aria-hidden="true" />
          <strong>{failure.kind === 'changed' ? 'This content changed' : failure.kind === 'stale' ? 'This conversation changed' : failure.kind === 'unavailable' ? 'Saved content is unavailable' : 'Could not load this section'}</strong>
          <p>{failure.kind === 'changed' ? 'Load the latest saved version from the beginning.' : failure.kind === 'stale' ? 'Return to the conversation and open the content again.' : failure.message}</p>
          {failure.kind === 'stale' ? !inline && <button type="button" className="button" onClick={dismiss}>Back to conversation</button>
            : <button type="button" className="button" onClick={() => retry(failure.kind === 'changed')}><RefreshCw size={15} aria-hidden="true" />{failure.kind === 'changed' ? 'Restart from beginning' : 'Try again'}</button>}
        </div>}
        {page && (page.text ? page.presentation?.kind === 'text'
          ? <div className="chat-history-detail-text is-prose" aria-label={page.presentation.label}>{page.text}</div>
          : <pre className="chat-history-detail-text" aria-label={page.presentation?.label} data-language={page.presentation?.language}><code>{page.text}</code></pre>
          : <div className="chat-history-detail-message"><p>There is no saved text in this section.</p></div>)}
      </div>
      <nav className="chat-history-detail-pagination" aria-label="Saved content sections">
        <button type="button" className="button ghost" aria-label="Previous section" onClick={() => { if (page?.previousOffset !== null && page?.previousOffset !== undefined) navigate(page.previousOffset); }} disabled={!inline && previousDisabled} aria-disabled={inline ? previousDisabled : undefined}><ChevronLeft size={15} aria-hidden="true" /><span>Previous</span></button>
        <span id={`${uid}-range`} role="status" aria-live="polite" aria-atomic="true">{range}</span>
        <button type="button" className="button ghost" aria-label="Next section" onClick={() => { if (page?.nextOffset !== null && page?.nextOffset !== undefined) navigate(page.nextOffset); }} disabled={!inline && nextDisabled} aria-disabled={inline ? nextDisabled : undefined}><span>Next</span><ChevronRight size={15} aria-hidden="true" /></button>
      </nav>
    </div>;
  return inline ? <section className="chat-history-detail-inline" aria-label={target.label}>{body}</section>
    : <Modal open title={target.label} titleId={`${uid}-title`} onClose={dismiss}
      description={target.toolLabel ? `${target.toolLabel} · Saved content, one section at a time.` : 'Read the saved content one section at a time.'} className="chat-history-detail-dialog">{body}</Modal>;
}

export default HistoryDetail;
