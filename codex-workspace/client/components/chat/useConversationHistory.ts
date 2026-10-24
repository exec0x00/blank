import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { AgentEvent, Thread } from '../../../shared/types';
import { api } from '../../api';
import { ConversationHistoryCache } from './history-cache';
import { errorMessage } from './state';
import type { MeasuredRange } from './MeasuredWindow';

export type HistoryDirection = 'older' | 'newer' | 'latest';
export interface HistoryLoadingState { loading: HistoryDirection | null; error: string | null; failed: HistoryDirection | null }
const idle: HistoryLoadingState = { loading: null, error: null, failed: null };

/** The saved model conversation is untouched; this owns only a small public viewport cache. */
export function useConversationHistory({ threadId, workspaceId, locked, followRef }: { threadId: string | null; workspaceId?: string; locked: boolean; followRef: RefObject<boolean> }) {
  const [thread, publish] = useState<Thread | null>(null);
  const current = useRef<Thread | null>(null);
  const cache = useRef(new ConversationHistoryCache());
  const [paging, setPaging] = useState<HistoryLoadingState>(idle);
  const pagingRef = useRef(paging);
  const [unseen, setUnseen] = useState(0);
  const [away, setAway] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const liveRevision = useRef(0);
  const selection = useRef({ threadId, workspaceId, locked });
  selection.current = { threadId, workspaceId, locked };
  const viewport = useRef<MeasuredRange | null>(null);
  const failedAutomatic = useRef(false);
  const loadRef = useRef<((direction: HistoryDirection, automatic?: boolean) => Promise<void>) | null>(null);

  const updatePaging = useCallback((next: HistoryLoadingState) => { pagingRef.current = next; setPaging(next); }, []);
  const commit = useCallback((next: Thread | null) => {
    current.current = next;
    publish(next);
    setUnseen(cache.current.unseen);
  }, []);

  const cancelRequest = useCallback(() => {
    generation.current++;
    request.current?.abort(); request.current = null;
    failedAutomatic.current = false;
    updatePaging(idle);
  }, [updatePaging]);

  useEffect(() => {
    cancelRequest();
    viewport.current = null;
    if (current.current?.id !== threadId || workspaceId && current.current?.workspaceId !== workspaceId) { cache.current.reset(null); commit(null); setAway(false); }
    return () => { generation.current++; request.current?.abort(); request.current = null; };
  }, [threadId, workspaceId, locked, cancelRequest, commit]);

  const setThread = useCallback<Dispatch<SetStateAction<Thread | null>>>(update => {
    const previous = current.current;
    let next = typeof update === 'function' ? update(previous) : update;
    if (next?.id !== previous?.id || next?.backend !== previous?.backend || next?.history?.epoch !== previous?.history?.epoch || !next) {
      cancelRequest();
      if (previous && next && previous.id === next.id && previous.history && next.history) next = cache.current.snapshot(previous, next, followRef.current, true);
      else cache.current.reset(next);
    }
    liveRevision.current++; commit(next);
  }, [commit, cancelRequest, followRef]);

  const receiveSnapshot = useCallback((snapshot: Thread, replace = false) => {
    if (selection.current.threadId !== snapshot.id || selection.current.workspaceId && snapshot.workspaceId !== selection.current.workspaceId
      || selection.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    const oldEpoch = current.current?.history?.epoch;
    const next = cache.current.snapshot(current.current, snapshot, followRef.current, replace, { canonical: !replace });
    if (oldEpoch && next.history?.epoch !== oldEpoch || replace) cancelRequest();
    liveRevision.current++; commit(next);
  }, [commit, followRef, cancelRequest]);

  const drainLatestRefresh = useCallback(() => {
    if (!loadRef.current || !followRef.current || !selection.current.threadId || selection.current.locked
      || document.body.dataset.workspaceLocked === 'true' || request.current || pagingRef.current.loading || pagingRef.current.error) return;
    if (cache.current.takeLatestRefresh(current.current)) void loadRef.current('latest', true);
  }, [followRef]);

  const load = useCallback(async (direction: HistoryDirection, automatic = false) => {
    const before = current.current;
    const id = selection.current.threadId;
    if (!id || selection.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    if (request.current || pagingRef.current.loading || automatic && pagingRef.current.error) return;
    const history = before?.history, native = before?.backend === 'codex-cli';
    const cursor = direction === 'latest' ? null : cache.current.cursor(before, direction);
    const more = direction === 'older' ? cache.current.hasOlder(before) : cache.current.hasNewer(before);
    if (direction !== 'latest' && (!more || !cursor)) return;
    const startedAtRevision = liveRevision.current;
    const controller = new AbortController();
    const version = ++generation.current;
    request.current = controller;
    failedAutomatic.current = false;
    if (direction === 'latest' && automatic) cache.current.refreshLatest = false;
    updatePaging({ loading: direction, error: null, failed: null });
    try {
      const path = `/threads/${encodeURIComponent(id)}` + (direction === 'latest' ? '' : `/history?${direction === 'older' ? 'before' : 'after'}=${encodeURIComponent(cursor!)}&limit=40`);
      const incoming = await api<Thread>(path, { signal: controller.signal });
      const currentThread = current.current;
      if (version !== generation.current || controller.signal.aborted || selection.current.threadId !== id || selection.current.locked
        || document.body.dataset.workspaceLocked === 'true') return;
      if (incoming.id !== id || selection.current.workspaceId && incoming.workspaceId !== selection.current.workspaceId
        || before && incoming.workspaceId !== before.workspaceId || native && incoming.backend !== 'codex-cli') {
        throw new Error('The history response does not match this conversation. Refresh history to try again.');
      }
      if (native && (!incoming.nativePage || !Array.isArray(incoming.messages))) throw new Error('The native history response did not include its pagination cursors.');
      if (direction !== 'latest' && (native ? currentThread?.backend !== 'codex-cli' || cache.current.cursor(currentThread, direction) !== cursor
        : currentThread?.history?.epoch !== history?.epoch)) return;
      if (direction === 'latest') {
        if (!automatic) followRef.current = true;
        // A background refill has no authority to evict an active selection.
        commit(cache.current.snapshot(currentThread, incoming, followRef.current, !automatic,
          { canonical: true, preserveMetadata: native && liveRevision.current !== startedAtRevision }));
        if (!automatic) setAway(false);
      } else if (currentThread && (!automatic || (direction === 'older' ? viewport.current?.atStart : viewport.current?.atEnd))) {
        const next = cache.current.page(currentThread, incoming, direction);
        commit(next);
      }
      updatePaging(idle);
    } catch (error) {
      if (version === generation.current && !controller.signal.aborted) {
        failedAutomatic.current = direction === 'latest' && automatic;
        updatePaging({ loading: null, error: errorMessage(error), failed: direction });
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (version === generation.current && !controller.signal.aborted && pagingRef.current.loading === direction) updatePaging(idle);
      }
      if (version === generation.current && !controller.signal.aborted && selection.current.threadId === id) drainLatestRefresh();
    }
  }, [commit, followRef, updatePaging, drainLatestRefresh]);
  loadRef.current = load;

  const processEvents = useCallback((events: readonly AgentEvent[]) => {
    if (selection.current.locked || document.body.dataset.workspaceLocked === 'true') return;
    let next = current.current;
    const previousEpoch = next?.history?.epoch;
    for (const event of events) {
      if (event.threadId !== selection.current.threadId) continue;
      if (event.type === 'snapshot' && selection.current.workspaceId && (event.thread as Thread | undefined)?.workspaceId !== selection.current.workspaceId) continue;
      next = cache.current.event(next, event, followRef.current);
    }
    if (previousEpoch && next?.history?.epoch !== previousEpoch) cancelRequest();
    liveRevision.current++; commit(next);
    drainLatestRefresh();
  }, [commit, followRef, drainLatestRefresh, cancelRequest]);

  const onRangeChange = useCallback((range: MeasuredRange) => {
    viewport.current = range;
    const saved = current.current;
    cache.current.anchor(saved, range.firstKey, range.pinnedKeys, range.viewportKeys);
    const atLatest = range.atEnd && !cache.current.hasNewer(saved);
    followRef.current = atLatest;
    setAway(!atLatest);
    if (atLatest) { cache.current.markRead(); setUnseen(0); }
    if (range.atStart && cache.current.hasOlder(saved)) void load('older', true);
    else if (range.atEnd && cache.current.hasNewer(saved)) void load('newer', true);
    else drainLatestRefresh();
  }, [followRef, load, drainLatestRefresh]);

  const jumpToLatest = useCallback(async () => {
    cancelRequest();
    followRef.current = true;
    cache.current.markRead(); setUnseen(0);
    if (cache.current.hasNewer(current.current) || cache.current.refreshLatest) await load('latest');
    else { setAway(false); commit(current.current ? { ...current.current } : null); }
  }, [cancelRequest, commit, followRef, load]);

  const visible = thread?.id === threadId && (!workspaceId || thread.workspaceId === workspaceId) ? thread : null;
  return { thread: visible, hasOlder: cache.current.hasOlder(visible), hasNewer: cache.current.hasNewer(visible), setThread, receiveSnapshot, processEvents, paging, unseen, away, onRangeChange, jumpToLatest,
    loadOlder: () => load('older'), loadNewer: () => load('newer'), retryHistory: () => {
      const direction = pagingRef.current.failed ?? 'latest', automatic = failedAutomatic.current;
      updatePaging({ ...pagingRef.current, error: null, failed: null });
      return load(direction, automatic);
    } };
}
