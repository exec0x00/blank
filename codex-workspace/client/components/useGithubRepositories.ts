import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { GithubRepoPage } from '../../shared/types';
import { api, ApiError } from '../api';

type Direction = 'next' | 'previous';
type PauseReason = 'user' | 'hidden' | null;
interface RequestPosition { cursor?: string; direction: Direction; refresh?: boolean }

/** Sparse search advances one authenticated provider batch at a time. Only a
 * single displayed result page and current progress are retained in memory. */
export function useGithubRepositories(accountId: string, query: string, enabled: boolean, host: RefObject<HTMLElement | null>) {
  const scope = `${accountId}\0${query}`;
  const [loaded, setLoaded] = useState<{ scope: string; page: GithubRepoPage } | null>(null);
  const [progress, setProgress] = useState<{ scope: string; page: GithubRepoPage } | null>(null);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState<PauseReason>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [hadMatches, setHadMatches] = useState(false);
  const current = useRef({ accountId, query, scope, enabled });
  current.current = { accountId, query, scope, enabled };
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pauseReason = useRef<PauseReason>(null);
  const requested = useRef<RequestPosition>({ direction: 'next' });
  const locked = useRef(false);
  const pending = useRef(false);
  const visible = useCallback(() => !document.hidden && !!host.current?.getClientRects().length, [host]);

  const stop = useCallback((reason: PauseReason = null) => {
    controller.current?.abort(); sequence.current++; pending.current = false;
    pauseReason.current = reason; setPaused(reason); setLoading(false);
  }, []);

  const load = useCallback(async (position: RequestPosition = { direction: 'next' }) => {
    const target = { ...current.current };
    if (!target.accountId || !target.enabled || locked.current || document.body.dataset.workspaceLocked === 'true') return;
    requested.current = position;
    if (!visible()) { stop('hidden'); return; }
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const id = ++sequence.current;
    pending.current = true; pauseReason.current = null;
    setPaused(null); setLoading(true); setError(''); setStale(false);
    if (!position.cursor) setHadMatches(false);
    let next = position.cursor;
    let refresh = position.refresh;
    try {
      while (!request.signal.aborted) {
        requested.current = { cursor: next, direction: position.direction, refresh };
        const parameters = new URLSearchParams({ paged: '1', query: target.query });
        if (next) parameters.set('cursor', next);
        if (refresh && !next) parameters.set('refresh', '1');
        const page = await api<GithubRepoPage>(`/github/accounts/${encodeURIComponent(target.accountId)}/repos?${parameters}`, { signal: request.signal });
        if (request.signal.aborted || id !== sequence.current || current.current.scope !== target.scope || !current.current.enabled || locked.current) return;
        if (!page || !Array.isArray(page.repositories) || page.repositories.length > 30 || !Number.isSafeInteger(page.page) || page.page < 1 || page.page > 10_000
          || !Number.isSafeInteger(page.scanned) || page.scanned < 0 || page.scanned > 300_000
          || typeof page.hasMore !== 'boolean' || typeof page.searchComplete !== 'boolean' || page.searchComplete === page.hasMore
          || page.nextCursor !== null && typeof page.nextCursor !== 'string' || page.previousCursor !== null && typeof page.previousCursor !== 'string'
          || page.hasMore !== !!page.nextCursor) throw new Error('This repository page could not be read. Refresh the list.');
        setProgress({ scope: target.scope, page });
        if (page.repositories.length) setHadMatches(true);
        const continuation = position.direction === 'previous' ? page.previousCursor : page.nextCursor;
        if (!target.query || page.repositories.length || !continuation) {
          setLoaded({ scope: target.scope, page });
          return;
        }
        // No matches in this provider batch is not a global empty search. Keep
        // any displayed page while checking the next bounded batch.
        next = continuation; refresh = false;
        requested.current = { cursor: next, direction: position.direction };
        if (!visible()) { pauseReason.current = 'hidden'; setPaused('hidden'); return; }
        await new Promise<void>(resolve => {
          const finish = () => { window.clearTimeout(timer); request.signal.removeEventListener('abort', finish); resolve(); };
          const timer = window.setTimeout(finish, 250);
          request.signal.addEventListener('abort', finish, { once: true });
        });
        if (!visible() && !request.signal.aborted) { pauseReason.current = 'hidden'; setPaused('hidden'); return; }
      }
    } catch (failure) {
      if (!request.signal.aborted && id === sequence.current && current.current.scope === target.scope && !locked.current) {
        setError(failure instanceof Error ? failure.message : 'Repositories could not be loaded. Try again.');
        setStale(failure instanceof ApiError && failure.code === 'GITHUB_REPOSITORY_LIST_CHANGED');
      }
    } finally {
      if (id === sequence.current) { pending.current = false; setLoading(false); }
    }
  }, [stop, visible]);

  useEffect(() => {
    stop(); setLoaded(null); setProgress(null); setHadMatches(false); setError(''); setStale(false);
    requested.current = { direction: 'next' };
    if (accountId && enabled) void load();
    return () => { controller.current?.abort(); sequence.current++; pending.current = false; };
  }, [scope, enabled, load, stop]);

  useEffect(() => {
    const onLock = () => { locked.current = true; stop(); };
    const onUnlock = () => { locked.current = false; void load(); };
    const visibility = () => {
      if (!visible()) { if (pending.current) stop('hidden'); }
      else if (pauseReason.current === 'hidden') void load(requested.current);
    };
    const observer = new ResizeObserver(visibility);
    if (host.current) observer.observe(host.current);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('codex:session-locked', onLock);
    window.addEventListener('codex:session-expired', onLock);
    window.addEventListener('codex:session-unlocked', onUnlock);
    return () => {
      observer.disconnect(); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('codex:session-locked', onLock);
      window.removeEventListener('codex:session-expired', onLock);
      window.removeEventListener('codex:session-unlocked', onUnlock);
    };
  }, [host, load, stop, visible]);

  const page = loaded?.scope === scope ? loaded.page : null;
  const latest = progress?.scope === scope ? progress.page : null;
  return {
    page, progress: latest, loading, paused: !!paused, error, stale, hadMatches,
    reload: () => { void load({ direction: 'next', refresh: true }); },
    retry: () => { if (!pending.current) void load(stale ? { direction: 'next', refresh: true } : requested.current); },
    pause: () => stop('user'),
    resume: () => { if (!pending.current) void load(requested.current); },
    previous: () => { if (page?.previousCursor && !pending.current) void load({ cursor: page.previousCursor, direction: 'previous' }); },
    next: () => { if (page?.nextCursor && !pending.current) void load({ cursor: page.nextCursor, direction: 'next' }); },
  };
}
