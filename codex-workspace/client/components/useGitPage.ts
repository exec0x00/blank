import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitBranchPage, GitFilePage } from '../../shared/types';
import { api, ApiError } from '../api';

type Page = GitFilePage | GitBranchPage;

/** A single page replaces the previous page only after a successful read. */
export function useGitPage<T extends Page>(path: string | null, revision?: string) {
  const [page, setPage] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const currentPath = useRef(path);
  currentPath.current = path;
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const lastCursor = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  const pagePath = useRef<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    if (!path || document.body.dataset.workspaceLocked === 'true') return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const id = ++sequence.current;
    lastCursor.current = cursor; pending.current = true;
    setLoading(true); setError(''); setStale(false);
    try {
      const next = await api<T>(`${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal: request.signal });
      if (request.signal.aborted || id !== sequence.current || currentPath.current !== path) return;
      const rows = 'files' in next ? next.files : next.branches;
      if (!Array.isArray(rows) || rows.length > 100 || !Number.isSafeInteger(next.offset) || next.offset < 0 || !Number.isSafeInteger(next.total) || next.total < 0) throw new Error('This Git page could not be read. Refresh to try again.');
      pagePath.current = path; setPage(next);
    } catch (failure) {
      if (!request.signal.aborted && id === sequence.current && currentPath.current === path) {
        setError(failure instanceof Error ? failure.message : 'This Git page could not be loaded. Try again.');
        setStale(failure instanceof ApiError && failure.code === 'GIT_LIST_CHANGED');
      }
    } finally { if (id === sequence.current) { pending.current = false; setLoading(false); } }
  }, [path]);

  useEffect(() => {
    if (pagePath.current !== path) { setPage(null); pagePath.current = null; }
    setError(''); setStale(false);
    if (path) void load(); else setLoading(false);
    return () => { controller.current?.abort(); sequence.current++; pending.current = false; };
  }, [revision, path, load]);
  useEffect(() => {
    const stop = () => { controller.current?.abort(); sequence.current++; pending.current = false; setLoading(false); };
    const resume = () => { if (currentPath.current) void load(); };
    window.addEventListener('codex:session-locked', stop);
    window.addEventListener('codex:session-expired', stop);
    window.addEventListener('codex:session-unlocked', resume);
    return () => { stop(); window.removeEventListener('codex:session-locked', stop); window.removeEventListener('codex:session-expired', stop); window.removeEventListener('codex:session-unlocked', resume); };
  }, [load]);

  return {
    page: pagePath.current === path ? page : null, loading, error, stale,
    reload: () => { if (!pending.current) void load(); },
    retry: () => { if (!pending.current) void load(stale ? undefined : lastCursor.current); },
    previous: () => { if (page?.previousCursor && !pending.current) void load(page.previousCursor); },
    next: () => { if (page?.nextCursor && !pending.current) void load(page.nextCursor); },
  };
}
