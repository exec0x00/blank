import { useCallback, useEffect, useRef, useState } from 'react';
import type { GithubAccountPage } from '../../shared/types';
import { api, ApiError } from '../api';

const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : 'GitHub accounts could not be loaded. Try again.';

/** One successful public account page, plus its exact selected metadata. */
export function useGithubAccountPage(query: string, selectedId = '', scope = '') {
  const scopeKey = `${scope}\0${query}`;
  const [loaded, setLoaded] = useState<{ scope: string; selectedId: string; page: GithubAccountPage } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const current = useRef({ scope: scopeKey, selectedId, query });
  current.current = { scope: scopeKey, selectedId, query };
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const requestedCursor = useRef<string | undefined>(undefined);
  const successfulCursor = useRef<string | undefined>(undefined);
  const previousScope = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  const locked = useRef(false);

  const load = useCallback(async (cursor?: string) => {
    if (locked.current || document.body.dataset.workspaceLocked === 'true') return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const id = ++sequence.current;
    const requested = { ...current.current };
    requestedCursor.current = cursor; pending.current = true;
    setLoading(true); setError(''); setStale(false);
    const parameters = new URLSearchParams({ paged: '1', limit: '24', query: requested.query });
    if (requested.selectedId) parameters.set('selectedId', requested.selectedId);
    if (cursor) parameters.set('cursor', cursor);
    try {
      const page = await api<GithubAccountPage>(`/github/accounts?${parameters}`, { signal: request.signal });
      if (request.signal.aborted || id !== sequence.current || current.current.scope !== requested.scope || current.current.selectedId !== requested.selectedId) return;
      if (!page || !Array.isArray(page.accounts) || page.accounts.length > 24 || !Number.isSafeInteger(page.offset)
        || page.offset < 0 || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 512
        || page.nextCursor !== null && typeof page.nextCursor !== 'string' || page.previousCursor !== null && typeof page.previousCursor !== 'string'
        || page.selected && page.selected.id !== requested.selectedId) throw new Error('This GitHub account page could not be read. Refresh the list.');
      successfulCursor.current = cursor;
      setLoaded({ scope: requested.scope, selectedId: requested.selectedId, page });
    } catch (failure) {
      if (!request.signal.aborted && id === sequence.current && current.current.scope === requested.scope && current.current.selectedId === requested.selectedId) {
        setError(failureMessage(failure));
        setStale(failure instanceof ApiError && failure.code === 'GITHUB_ACCOUNT_LIST_CHANGED');
      }
    } finally {
      if (id === sequence.current) { pending.current = false; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    if (previousScope.current !== scopeKey) {
      previousScope.current = scopeKey; successfulCursor.current = undefined; requestedCursor.current = undefined;
      setLoaded(null);
    }
    void load(successfulCursor.current);
    return () => { controller.current?.abort(); sequence.current++; pending.current = false; };
  }, [scopeKey, selectedId, load]);

  useEffect(() => {
    const stop = () => { locked.current = true; controller.current?.abort(); sequence.current++; pending.current = false; setLoading(false); };
    const resume = () => { locked.current = false; void load(); };
    const reload = () => { void load(); };
    window.addEventListener('codex:session-locked', stop);
    window.addEventListener('codex:session-expired', stop);
    window.addEventListener('codex:session-unlocked', resume);
    window.addEventListener('codex:github-accounts-changed', reload);
    return () => {
      controller.current?.abort(); sequence.current++; pending.current = false;
      window.removeEventListener('codex:session-locked', stop);
      window.removeEventListener('codex:session-expired', stop);
      window.removeEventListener('codex:session-unlocked', resume);
      window.removeEventListener('codex:github-accounts-changed', reload);
    };
  }, [load]);

  const page = loaded?.scope === scopeKey ? loaded.page : null;
  return {
    page, loading, error, stale, selectionChecked: loaded?.scope === scopeKey && loaded.selectedId === selectedId,
    reload: () => { if (!pending.current) void load(); },
    retry: () => { if (!pending.current) void load(stale ? undefined : requestedCursor.current); },
    previous: () => { if (page?.previousCursor && !pending.current) void load(page.previousCursor); },
    next: () => { if (page?.nextCursor && !pending.current) void load(page.nextCursor); },
  };
}
