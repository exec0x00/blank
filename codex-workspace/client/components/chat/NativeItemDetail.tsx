import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import type { NativeItemDetail as NativeItemDetailReply, NativeItemDetailPart as NativeItemPart, NativeItemDetailUnavailable as Unavailable } from '../../../shared/types';
import { api, ApiError } from '../../api';
import Modal from '../Modal';
import { SelectMenu } from '../ui/Dropdown';
import { CopyButton } from './MarkdownMessage';
import './history-detail.css';

export const NATIVE_ITEM_DETAIL_PAGE_CHARS = 16_000;
export interface NativeItemDetailTarget {
  workspaceId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  field: 'text' | 'input' | 'output';
  label: string;
}
type Identity = Pick<NativeItemDetailReply, 'threadId' | 'turnId' | 'itemId' | 'field'>;
interface Query { key: string | null; cursor?: string | null; part?: number; offset: number; version?: string; attempt: number }
type Failure = { kind: 'changed' | 'unavailable' | 'error'; message: string };
type Load = { key: string; query: string; sourceVersion?: string } & ({ status: 'loading' } | { status: 'loaded'; reply: NativeItemDetailReply } | { status: 'error'; failure: Failure });
const empty: Query = { key: null, offset: 0, attempt: 0 };
const fields = new Set(['text', 'input', 'output']);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const readable = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const cursor = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && new TextEncoder().encode(value).byteLength <= 16_384 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const version = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableCursor = (value: unknown): value is string | null => value === null || cursor(value);
const cleanKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const identityKeys = ['status', 'threadId', 'turnId', 'itemId', 'field'];
const malformed = () => new Error('The native item response could not be verified. No content was displayed.');

export function nativeItemDetailPath(target: NativeItemDetailTarget, query: Omit<Query, 'key' | 'attempt'>): string {
  if (!identifier(target.workspaceId) || !identifier(target.threadId) || !identifier(target.turnId) || !identifier(target.itemId)
    || !fields.has(target.field) || !integer(query.offset) || query.part !== undefined && (!integer(query.part) || query.part >= 128)
    || query.cursor !== undefined && !nullableCursor(query.cursor) || query.version !== undefined && !version(query.version)) {
    throw new Error('This native item cannot be opened. Return to the conversation and choose it again.');
  }
  const search = new URLSearchParams({ turnId: target.turnId, itemId: target.itemId, field: target.field, offset: String(query.offset), limit: String(NATIVE_ITEM_DETAIL_PAGE_CHARS) });
  if (query.cursor !== undefined) search.set('cursor', query.cursor ?? '');
  if (query.part !== undefined) search.set('part', String(query.part));
  if (query.version !== undefined) search.set('version', query.version);
  return '/threads/' + encodeURIComponent(target.threadId) + '/native-item-detail?' + search;
}

/** Retain only the specified public text DTO, never a native protocol object. */
export function parseNativeItemDetail(value: unknown, target: NativeItemDetailTarget, requested: Omit<Query, 'key' | 'attempt'>): NativeItemDetailReply {
  if (!record(value) || value.threadId !== target.threadId || value.turnId !== target.turnId || value.itemId !== target.itemId || value.field !== target.field) throw malformed();
  const identity: Identity = { threadId: target.threadId, turnId: target.turnId, itemId: target.itemId, field: target.field };
  if (value.status === 'searching') {
    if (!cleanKeys(value, [...identityKeys, 'nextCursor', 'pagesScanned']) || !cursor(value.nextCursor)
      || !integer(value.pagesScanned) || value.pagesScanned < 1 || value.pagesScanned > 8
      || value.nextCursor === requested.cursor || requested.version !== undefined) throw malformed();
    return { ...identity, status: 'searching', nextCursor: value.nextCursor, pagesScanned: value.pagesScanned };
  }
  if (value.status === 'notFound') {
    if (!cleanKeys(value, [...identityKeys, 'nextCursor', 'message']) || value.nextCursor !== null || !readable(value.message, 2000) || requested.version !== undefined) throw malformed();
    return { ...identity, status: 'notFound', nextCursor: null, message: value.message };
  }
  if (value.status === 'unavailable') {
    if (!cleanKeys(value, [...identityKeys, 'itemType', 'itemCursor', 'reason', 'message']) || !identifier(value.itemType) || !nullableCursor(value.itemCursor)
      || !['unsupported-field', 'no-public-content'].includes(String(value.reason)) || !readable(value.message, 2000)) throw malformed();
    return { ...identity, status: 'unavailable', itemType: value.itemType, itemCursor: value.itemCursor,
      reason: value.reason as Unavailable['reason'], message: value.message };
  }
  if (value.status !== 'ready' || !cleanKeys(value, [...identityKeys, 'itemType', 'itemCursor', 'parts', 'part', 'label', 'text', 'totalChars', 'offset', 'limit', 'previousOffset', 'nextOffset', 'version'])
    || !identifier(value.itemType) || !nullableCursor(value.itemCursor) || !version(value.version)
    || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 128
    || !integer(value.part) || value.part !== (requested.part ?? 0) || !readable(value.label, 240)
    || !integer(value.totalChars) || !integer(value.offset) || value.offset > value.totalChars
    || value.limit !== NATIVE_ITEM_DETAIL_PAGE_CHARS || typeof value.text !== 'string' || value.text.length > NATIVE_ITEM_DETAIL_PAGE_CHARS) throw malformed();
  if (requested.version !== undefined && (value.version !== requested.version || value.itemCursor !== (requested.cursor ?? null))) {
    throw new ApiError('The native item changed while it was being read.', 409, 'CODEX_DETAIL_STALE');
  }
  if (value.offset !== requested.offset && !(requested.offset > 0 && value.offset === requested.offset - 1
    && /^[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(value.text))) throw malformed();
  const parts = value.parts.map((part, index) => {
    if (!record(part) || !cleanKeys(part, ['part', 'label', 'totalChars']) || part.part !== index || !readable(part.label, 240) || !integer(part.totalChars)) throw malformed();
    return { part: index, label: part.label, totalChars: part.totalChars };
  });
  const selected = parts[value.part], end = value.offset + value.text.length;
  if (!selected || selected.label !== value.label || selected.totalChars !== value.totalChars || !Number.isSafeInteger(end) || end > value.totalChars
    || (value.offset === 0 ? value.previousOffset !== null : !integer(value.previousOffset) || value.previousOffset >= value.offset || value.previousOffset < Math.max(0, value.offset - NATIVE_ITEM_DETAIL_PAGE_CHARS - 1))
    || (end === value.totalChars ? value.nextOffset !== null : value.nextOffset !== end || end <= value.offset)
    || value.text.length > 0 && (value.offset > 0 && /[\uDC00-\uDFFF]/.test(value.text[0]) || end < value.totalChars && /[\uD800-\uDBFF]/.test(value.text.at(-1)!))) throw malformed();
  return { ...identity, status: 'ready', itemType: value.itemType, itemCursor: value.itemCursor, parts, part: value.part, label: value.label,
    text: value.text, totalChars: value.totalChars, offset: value.offset, limit: value.limit, previousOffset: value.previousOffset as number | null,
    nextOffset: value.nextOffset as number | null, version: value.version };
}

export function NativeItemDetail({ target, locked = false, inline = false, active = true, sourceVersion, onClose, onNotify }: {
  target: NativeItemDetailTarget | null; locked?: boolean; onClose: () => void;
  inline?: boolean; active?: boolean; sourceVersion?: string;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
}) {
  const uid = useId();
  const key = target ? JSON.stringify([target.workspaceId, target.threadId, target.turnId, target.itemId, target.field]) : null;
  const [sessionLocked, setSessionLocked] = useState(() => typeof document !== 'undefined' && document.body.dataset.workspaceLocked === 'true');
  const [query, setQuery] = useState<Query>(empty), [load, setLoad] = useState<Load | null>(null);
  const retained = useRef(load); retained.current = load;
  const [parts, setParts] = useState<{ key: string; parts: NativeItemPart[] } | null>(null);
  const blocked = locked || sessionLocked, selected = query.key === key ? query : empty;
  const queryKey = JSON.stringify([selected.cursor ?? null, selected.part ?? 0, selected.offset, selected.version, selected.attempt]);
  const current = load?.key === key && load.query === queryKey ? load : null;
  const reply = !blocked && current?.status === 'loaded' ? current.reply : null;
  const page = reply?.status === 'ready' ? reply : null;
  const failure = !blocked && current?.status === 'error' ? current.failure : null;
  const loading = !!target && active && !blocked && (!current || current.status === 'loading');
  const live = useRef({ key, blocked }), request = useRef<AbortController | null>(null), generation = useRef(0);
  const close = useRef(onClose); close.current = onClose;
  const viewport = useRef<HTMLDivElement>(null);
  const cancel = useCallback(() => { generation.current++; request.current?.abort(); request.current = null; }, []);
  useLayoutEffect(() => {
    live.current = { key, blocked }; setQuery(previous => previous.key === key ? previous : empty); setParts(previous => previous?.key === key ? previous : null);
    return cancel;
  }, [key, blocked, cancel]);
  useEffect(() => {
    const stop = () => { live.current.blocked = true; cancel(); setLoad(null); setParts(null); setQuery(empty); setSessionLocked(true); close.current(); };
    const unlock = () => setSessionLocked(false);
    window.addEventListener('codex:session-locked', stop); window.addEventListener('codex:session-expired', stop); window.addEventListener('codex:session-unlocked', unlock);
    return () => { window.removeEventListener('codex:session-locked', stop); window.removeEventListener('codex:session-expired', stop); window.removeEventListener('codex:session-unlocked', unlock); };
  }, [cancel]);
  useEffect(() => {
    if (!target || !key || blocked) { cancel(); setLoad(null); setParts(null); return; }
    if (!active) { cancel(); setLoad(previous => previous?.status === 'loading' ? null : previous); return; }
    // Collapsing a tool cancels pending work, but preserves an already-read page.
    if (retained.current?.key === key && retained.current.query === queryKey && retained.current.status === 'loaded') return;
    const controller = new AbortController(), revision = ++generation.current;
    request.current = controller;
    const isCurrent = () => !controller.signal.aborted && generation.current === revision && live.current.key === key && !live.current.blocked && document.body.dataset.workspaceLocked !== 'true';
    const timeout = setTimeout(() => {
      if (!isCurrent()) return;
      controller.abort(); setParts(null);
      setLoad({ key, query: queryKey, status: 'error', failure: { kind: 'error', message: inline ? 'Loading this content timed out. Try again.' : 'Reading this native item timed out. You can retry this read or return to the conversation.' } });
    }, 20_000);
    setLoad({ key, query: queryKey, status: 'loading' });
    void (async () => {
      try {
        // Let a same-commit cleanup (including Strict Mode's mount replay)
        // cancel before starting a potentially expensive native history read.
        await Promise.resolve();
        if (!isCurrent()) return;
        const result = await api<unknown>(nativeItemDetailPath(target, selected), { signal: controller.signal, cache: 'no-store' });
        if (!isCurrent()) return;
        const parsed = parseNativeItemDetail(result, target, selected);
        if (parsed.status === 'ready') setParts({ key, parts: parsed.parts });
        else setParts(null);
        setLoad({ key, query: queryKey, sourceVersion, status: 'loaded', reply: parsed });
      } catch (error) {
        if (!isCurrent()) return;
        setParts(null);
        const changed = error instanceof ApiError && error.status === 409;
        setLoad({ key, query: queryKey, status: 'error', failure: { kind: changed ? 'changed' : error instanceof ApiError && error.status === 404 ? 'unavailable' : 'error',
          message: changed ? 'The saved content changed. Load its latest version from the beginning.' : error instanceof Error ? error.message.slice(0, 1000) : 'This content could not be read.' } });
      } finally { clearTimeout(timeout); }
    })();
    return () => { clearTimeout(timeout); controller.abort(); if (request.current === controller) request.current = null; if (generation.current === revision) generation.current++; };
    // A newer streaming preview offers an explicit refresh without replacing a
    // page the user is reading. Every page remains pinned to its saved version.
  }, [key, queryKey, blocked, active, cancel]);
  useEffect(() => {
    if (!key || blocked || inline) return;
    const frame = requestAnimationFrame(() => viewport.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [key, blocked, inline]);
  useLayoutEffect(() => { if (viewport.current && reply) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; } }, [reply]);
  function dismiss() { cancel(); setLoad(null); setParts(null); setQuery(empty); onClose(); }
  function navigate(offset: number, part = page?.part) {
    if (!page || !key || loading || blocked || part === undefined || !page.parts.some(value => value.part === part)) return;
    cancel(); setLoad(null); setQuery({ key, cursor: page.itemCursor, version: page.version, part, offset, attempt: 0 });
  }
  function restart() { if (!key || blocked) return; cancel(); setLoad(null); setParts(null); setQuery({ key, offset: 0, attempt: selected.attempt + 1 }); }
  function retry() { if (!key || blocked) return; cancel(); setLoad(null); setQuery({ ...selected, key, attempt: selected.attempt + 1 }); }
  function continueSearch() {
    if (!key || blocked || loading || reply?.status !== 'searching') return;
    cancel(); setLoad(null); setQuery({ ...selected, key, cursor: reply.nextCursor, attempt: selected.attempt + 1 });
  }
  if (!target || blocked) return null;
  const options = parts?.key === key ? parts.parts : [];
  const updated = inline && current?.status === 'loaded' && current.sourceVersion !== sourceVersion;
  const copyGeneration = generation.current;
  const previousDisabled = !page || loading || page.previousOffset === null;
  const nextDisabled = !page || loading || page.nextOffset === null;
  const range = page ? page.totalChars === 0 ? 'No public text in this part'
    : 'Characters ' + (page.offset + 1).toLocaleString() + '–' + (page.offset + page.text.length).toLocaleString() + ' of ' + page.totalChars.toLocaleString()
    : loading ? 'Loading content…' : reply?.status === 'searching' ? 'More history to search' : 'Section unavailable';
  const body = <div className="chat-history-detail-body">
      <div className="chat-history-detail-toolbar">
        {options.length > 1 ? <SelectMenu className="chat-history-detail-part" aria-label={inline ? 'Content section' : 'Content to inspect'} value={String(page?.part ?? selected.part ?? 0)}
          options={options.map(part => ({ value: String(part.part), label: part.label }))} disabled={loading || !page}
          onValueChange={value => navigate(0, Number(value))} /> : <span>{page?.label ?? (inline ? target.label : 'Public text')}{!inline && ' · Read-only'}</span>}
        {page && <CopyButton key={key + ':' + page.version + ':' + page.part + ':' + page.offset} text={page.text} label="Copy this section" onNotify={(message, kind) => {
          if (generation.current === copyGeneration && live.current.key === key && !live.current.blocked) onNotify(message, kind);
        }} />}
      </div>
      {updated && <div className="chat-history-detail-update" role="status"><span>Newer content is available.</span><button type="button" className="button ghost" onClick={restart}><RefreshCw size={13} aria-hidden="true" />Refresh</button></div>}
      <div className="chat-history-detail-scroll" role="region" aria-label={target.label + ' section'} aria-describedby={uid + '-range'} aria-busy={loading} ref={viewport} tabIndex={0} data-autofocus={!inline || undefined}>
        {loading && <div className="chat-history-detail-message" role="status"><LoaderCircle size={21} className="chat-history-detail-spinner" /><p>{inline ? 'Loading content…' : 'Reading native content…'}</p></div>}
        {reply?.status === 'searching' && <div className="chat-history-detail-message" role="status"><Search size={21} /><strong>More history to search</strong>
          <p>The selected content is farther back in the conversation. Continue searching older history.</p>
          <button type="button" className="button" onClick={continueSearch}>Continue search</button></div>}
        {(reply?.status === 'notFound' || reply?.status === 'unavailable') && <div className="chat-history-detail-message" role="status"><CircleAlert size={21} />
          <strong>{reply.status === 'notFound' ? inline ? 'Saved content not found' : 'Native item not found' : 'No public content for this field'}</strong><p>{reply.message}</p>
          {inline ? <button type="button" className="button" onClick={restart}><RefreshCw size={14} aria-hidden="true" />Try again</button>
            : <button type="button" className="button" onClick={dismiss}>Back to conversation</button>}</div>}
        {failure && <div className="chat-history-detail-message" role="alert"><CircleAlert size={21} /><strong>{failure.kind === 'changed' ? inline ? 'Content changed' : 'Native content changed' : failure.kind === 'unavailable' ? 'Saved content is unavailable' : 'Could not load this section'}</strong>
          <p>{failure.message}</p><button type="button" className="button" onClick={failure.kind === 'changed' ? restart : retry}><RefreshCw size={14} />{failure.kind === 'changed' ? 'Restart from beginning' : 'Try again'}</button></div>}
        {page && (page.text ? <pre className={'chat-history-detail-text' + (target.field === 'text' ? ' is-prose' : '')} aria-label={page.label}><code>{page.text}</code></pre>
          : <div className="chat-history-detail-message"><p>There is no public text in this part.</p></div>)}
      </div>
      <nav className="chat-history-detail-pagination" aria-label="Native content sections">
        <button type="button" className="button ghost" aria-label="Previous section" disabled={!inline && previousDisabled} aria-disabled={inline ? previousDisabled : undefined} onClick={() => { if (page?.previousOffset != null) navigate(page.previousOffset); }}><ChevronLeft size={15} />Previous</button>
        <span id={uid + '-range'} role="status" aria-live="polite" aria-atomic="true">{range}</span>
        <button type="button" className="button ghost" aria-label="Next section" disabled={!inline && nextDisabled} aria-disabled={inline ? nextDisabled : undefined} onClick={() => { if (page?.nextOffset != null) navigate(page.nextOffset); }}>Next<ChevronRight size={15} /></button>
      </nav>
    </div>;
  return inline ? <section className="chat-history-detail-inline" aria-label={target.label}>{body}</section>
    : <Modal open title={target.label} titleId={uid + '-title'} onClose={dismiss} description="Read-only public content from the native conversation." className="chat-history-detail-dialog">{body}</Modal>;
}
