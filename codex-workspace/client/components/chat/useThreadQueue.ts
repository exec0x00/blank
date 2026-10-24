import { useCallback, useEffect, useRef, useState } from 'react';
import type { Thread } from '../../../shared/types';
import type { CodexQueueEntry } from '../../../shared/codex-cli';
import { api, ApiError, json } from '../../api';
import { inputAcceptance, nativeQueueEntry } from './input-shortcuts';
import { errorMessage, isThreadBusy } from './state';

type QueueAction = 'cancel' | 'resume';
interface Options {
  workspaceId: string; threadId: string | null; thread: Thread | null; locked: boolean; disabled?: boolean;
  onSnapshot: (thread: Thread) => void; onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
}
const EMPTY: CodexQueueEntry[] = [];
const encode = encodeURIComponent;
const workspaceLocked = () => document.body.dataset.workspaceLocked === 'true';

/** Native queue/list and acknowledgments own state; this hook does not schedule turns. */
export function useThreadQueue(options: Options) {
  const { workspaceId, threadId, locked, thread } = options;
  const key = JSON.stringify([workspaceId, threadId]);
  const latest = useRef(options); latest.current = options;
  const scope = useRef({ key, workspaceId, threadId, locked }); scope.current = { key, workspaceId, threadId, locked };
  const requests = useRef(new Map<string, AbortController>());
  const refreshRequest = useRef<AbortController | null>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const [page, setPage] = useState<{ key: string; cursor: string; previous: Array<string | null>; items: CodexQueueEntry[]; nextCursor: string | null } | null>(null);
  const pageRef = useRef(page); pageRef.current = page;
  const [paging, setPaging] = useState(false);
  const [actions, setActions] = useState<Record<string, QueueAction>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const stop = useCallback(() => {
    for (const request of requests.current.values()) request.abort();
    requests.current.clear(); refreshRequest.current?.abort(); refreshRequest.current = null; pageRequest.current?.abort(); pageRequest.current = null;
  }, []);
  useEffect(() => { stop(); setActions({}); setRefreshing(false); setPaging(false); setPage(null); setError(null); setRemoved(new Set()); return stop; }, [key, locked, stop]);
  useEffect(() => {
    const onLock = () => { scope.current.locked = true; stop(); setActions({}); setRefreshing(false); setPaging(false); setPage(null); };
    window.addEventListener('codex:session-locked', onLock); window.addEventListener('codex:session-expired', onLock);
    return () => { stop(); window.removeEventListener('codex:session-locked', onLock); window.removeEventListener('codex:session-expired', onLock); };
  }, [stop]);
  const current = useCallback((captured: typeof scope.current, controller: AbortController) => !controller.signal.aborted
    && captured.key === scope.current.key && !scope.current.locked && !workspaceLocked(), []);
  const refresh = useCallback(async () => {
    const captured = { ...scope.current };
    if (!captured.threadId || captured.locked || workspaceLocked()) return;
    refreshRequest.current?.abort();
    const controller = new AbortController(); refreshRequest.current = controller; setRefreshing(true);
    try {
      const snapshot = await api<Thread>('/threads/' + encode(captured.threadId), { signal: controller.signal });
      if (!current(captured, controller)) return;
      if (snapshot.id !== captured.threadId || snapshot.workspaceId !== captured.workspaceId || snapshot.backend !== 'codex-cli'
        || snapshot.readOnly || !snapshot.native) throw new Error('The queue did not match this native conversation.');
      latest.current.onSnapshot(snapshot);
      setPage(null);
    } catch (failure) { if (current(captured, controller)) setError('Could not refresh the Codex queue: ' + errorMessage(failure)); }
    finally { if (refreshRequest.current === controller) { refreshRequest.current = null; setRefreshing(false); } }
  }, [current]);
  const loadPage = useCallback(async (cursor: string | null, previous: Array<string | null>) => {
    if (!cursor) { pageRequest.current?.abort(); pageRequest.current = null; setPaging(false); setPage(null); return; }
    const captured = { ...scope.current };
    if (!captured.threadId || captured.locked || workspaceLocked() || latest.current.disabled || pageRequest.current) return;
    const controller = new AbortController(); pageRequest.current = controller; setPaging(true); setError(null);
    try {
      const response = await api<{ items: CodexQueueEntry[]; nextCursor: string | null }>('/threads/' + encode(captured.threadId) + '/queue?limit=20&cursor=' + encode(cursor), { signal: controller.signal });
      if (!current(captured, controller)) return;
      if (!Array.isArray(response.items) || response.items.length > 20 || !response.items.every(nativeQueueEntry)
        || new Set(response.items.map(item => item.id)).size !== response.items.length
        || response.nextCursor !== null && (typeof response.nextCursor !== 'string' || !response.nextCursor || response.nextCursor.length > 8192)) {
        throw new Error('The next native queue page could not be confirmed.');
      }
      setPage({ key: captured.key, cursor, previous: previous.slice(-32), items: response.items, nextCursor: response.nextCursor });
    } catch (failure) { if (current(captured, controller)) setError(errorMessage(failure)); }
    finally { if (pageRequest.current === controller) { pageRequest.current = null; setPaging(false); } }
  }, [current]);
  const act = useCallback(async (id: string, action: QueueAction) => {
    const captured = { ...scope.current }, selected = latest.current.thread;
    if (!captured.threadId || captured.locked || latest.current.disabled || workspaceLocked() || requests.current.has(id)
      || selected?.id !== captured.threadId || selected.workspaceId !== captured.workspaceId || selected.backend !== 'codex-cli'
      || selected.readOnly || !selected.native?.capabilities.queue || ![...selected.native.queue, ...(pageRef.current?.key === captured.key ? pageRef.current.items : [])].some(entry => entry.id === id)
      || action === 'resume' && (isThreadBusy(selected) || !!selected.native.activeTurnId)) return;
    const controller = new AbortController(); requests.current.set(id, controller);
    setActions(previous => ({ ...previous, [id]: action })); setError(null);
    try {
      const base = '/threads/' + encode(captured.threadId) + '/queue/' + encode(id);
      const reply = await api<unknown>(base + (action === 'resume' ? '/resume' : ''),
        { ...json(action === 'resume' ? 'POST' : 'DELETE', action === 'resume' ? {} : undefined), signal: controller.signal });
      if (!current(captured, controller)) return;
      if (action === 'cancel') {
        if ((reply as { deleted?: unknown } | null)?.deleted !== true) throw new Error('Codex did not confirm removal. Refresh the queue before retrying.');
      } else inputAcceptance(reply, 'run', captured.threadId);
      setRemoved(previous => { const next = new Set(previous); next.add(id); while (next.size > 128) next.delete(next.values().next().value!); return next; });
      latest.current.onNotify(action === 'cancel' ? 'Queued message removed.' : 'Queued turn started.', 'info');
      void refresh();
    } catch (failure) {
      if (!current(captured, controller)) return;
      setError(failure instanceof ApiError && [404, 409].includes(failure.status)
        ? 'This queue entry changed. ' + errorMessage(failure) : errorMessage(failure));
      void refresh();
    } finally {
      if (requests.current.get(id) === controller) { requests.current.delete(id); setActions(previous => { const next = { ...previous }; delete next[id]; return next; }); }
    }
  }, [current, refresh]);
  const native = thread?.id === threadId && thread.workspaceId === workspaceId && thread.backend === 'codex-cli' && !thread.readOnly ? thread.native : undefined;
  const visiblePage = page?.key === key ? page : null;
  const items = native && !locked ? (visiblePage?.items ?? native.queue).filter(item => !removed.has(item.id)) : EMPTY;
  const nextCursor = visiblePage ? visiblePage.nextCursor : native?.queueCursor;
  return { items, actions, refreshing, paging, error, refresh, hasMore: !!nextCursor, pageKey: visiblePage?.cursor ?? '',
    hasPreviousPage: !!visiblePage, nextPage: () => loadPage(nextCursor ?? null, [...(visiblePage?.previous ?? []), visiblePage?.cursor ?? null]),
    previousPage: () => loadPage(visiblePage?.previous.at(-1) ?? null, visiblePage?.previous.slice(0, -1) ?? []),
    canStart: !!native && !native.activeTurnId && !isThreadBusy(thread), cancel: (id: string) => act(id, 'cancel'),
    resume: (id: string) => act(id, 'resume'), clearError: () => setError(null) };
}
export type ThreadQueueController = ReturnType<typeof useThreadQueue>;
