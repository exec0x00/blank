import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Page<T> { items: T[]; offset: number; limit: number; total: number; hasMore: boolean }
const PAGE_SIZE = 25;
const locked = () => document.body.dataset.workspaceLocked === 'true';

/** One successful page per collection. A failed next/previous request retains
 * that page, while a new search clears old matches immediately. Mutations stay
 * outside this hook: resuming only refreshes observational state. */
export function useOperationalPage<T, P extends Page<T>>(path: string, enabled: boolean) {
  const [page, setPage] = useState<P | null>(null);
  const pageRef = useRef<P | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  const [error, setError] = useState('');
  const [loadedQuery, setLoadedQuery] = useState('');
  const mounted = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requested = useRef({ offset: 0, q: '' });
  const latest = useRef({ path, enabled });
  latest.current = { path, enabled };
  const previousEnabled = useRef(enabled);
  const [resumeVersion, setResumeVersion] = useState(0);
  const resumeRequested = useRef(false);
  const resumeWaiters = useRef(new Set<() => void>());

  const pause = useCallback(() => {
    request.current++;
    controller.current?.abort(); controller.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; loadingRef.current = false;
    if (mounted.current) setLoading(false);
  }, []);

  const cancel = useCallback(() => {
    pause();
    resumeRequested.current = false;
    for (const settle of resumeWaiters.current) settle();
    resumeWaiters.current.clear();
  }, [pause]);

  const load = useCallback(async (offset: number, q: string) => {
    if (!mounted.current || !latest.current.enabled || locked()) return;
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    controller.current?.abort();
    const read = new AbortController(); controller.current = read;
    const number = ++request.current, collection = latest.current.path;
    requested.current = { offset, q };
    loadingRef.current = true; setLoading(true); setError('');
    const valid = () => mounted.current && number === request.current && controller.current === read
      && collection === latest.current.path && latest.current.enabled && !read.signal.aborted && !locked();
    try {
      const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
      if (q) params.set('q', q);
      const next = await api<P>(`${collection}${collection.includes('?') ? '&' : '?'}${params}`, { signal: read.signal });
      if (!valid()) return;
      if (!next || !Array.isArray(next.items) || next.items.length > PAGE_SIZE || next.limit !== PAGE_SIZE
        || !Number.isSafeInteger(next.offset) || next.offset < 0 || next.offset > 10_000
        || !Number.isSafeInteger(next.total) || next.total < 0 || next.total > 10_000
        || next.offset + next.items.length > next.total || typeof next.hasMore !== 'boolean') {
        throw new Error('The server returned an unreadable list page. Refresh to try again.');
      }
      pageRef.current = next; setPage(next); setLoadedQuery(q);
      requested.current = { offset: next.offset, q };
    } catch (failure) {
      if (valid()) setError(failure instanceof Error ? failure.message : 'This list could not be loaded. Try again.');
    } finally {
      if (mounted.current && number === request.current && controller.current === read) {
        controller.current = null; loadingRef.current = false; setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    pageRef.current = null; setPage(null); setQuery(''); setLoadedQuery(''); setError('');
    requested.current = { offset: 0, q: '' };
    previousEnabled.current = latest.current.enabled;
    if (latest.current.enabled) void load(0, '');
    else { loadingRef.current = false; setLoading(false); }
    return () => { mounted.current = false; cancel(); };
  }, [path, cancel, load]);

  useEffect(() => {
    const resumed = previousEnabled.current !== enabled;
    previousEnabled.current = enabled;
    // A fast mutation may have queued its completion waiter before this older
    // paused render's effect runs. Pausing stops reads but keeps that waiter for
    // the following enabled render; explicit cancellation discards it instead.
    if (!enabled) { if (resumed) pause(); return; }
    if (!resumed && !resumeRequested.current) return;
    resumeRequested.current = false;
    const waiting = [...resumeWaiters.current]; resumeWaiters.current.clear();
    void load(requested.current.offset, requested.current.q).finally(() => { for (const settle of waiting) settle(); });
  }, [enabled, resumeVersion, pause, load]);

  // An explicit completion barrier also handles a fast mutation whose pending
  // render was batched away. Focus can wait for the fresh read to enable rows.
  const refreshAfterPause = useCallback(() => {
    if (!mounted.current || locked()) return Promise.resolve();
    resumeRequested.current = true;
    const finished = new Promise<void>(resolve => { resumeWaiters.current.add(resolve); });
    setResumeVersion(value => value + 1);
    return finished;
  }, []);

  const changeQuery = useCallback((value: string) => {
    if (!latest.current.enabled || locked()) return;
    const next = value.slice(0, 160);
    cancel(); setQuery(next); setError(''); setLoadedQuery('');
    pageRef.current = null; setPage(null);
    requested.current = { offset: 0, q: next.trim() };
    loadingRef.current = true; setLoading(true);
    timer.current = setTimeout(() => { timer.current = null; void load(0, next.trim()); }, 220);
  }, [cancel, load]);

  const refresh = useCallback(() => load(requested.current.offset, requested.current.q), [load]);
  const first = useCallback(() => load(0, requested.current.q), [load]);
  const previous = useCallback(() => {
    if (loadingRef.current || !pageRef.current || pageRef.current.offset === 0) return;
    void load(Math.max(0, pageRef.current.offset - PAGE_SIZE), requested.current.q);
  }, [load]);
  const next = useCallback(() => {
    if (loadingRef.current || !pageRef.current?.hasMore) return;
    void load(pageRef.current.offset + pageRef.current.limit, requested.current.q);
  }, [load]);
  const replaceItems = useCallback((updater: (items: T[]) => T[]) => {
    const current = pageRef.current;
    if (!current) return;
    const items = updater(current.items);
    const total = Math.max(0, current.total + items.length - current.items.length);
    const next = { ...current, items, total, hasMore: current.offset + items.length < total };
    pageRef.current = next; setPage(next);
  }, []);

  return { page, pageRef, query, changeQuery, loading, loadingRef, error, refresh, refreshAfterPause, first, previous, next, cancel, replaceItems,
    resetKey: `${path}\n${loadedQuery}\n${page?.offset ?? 0}` };
}
