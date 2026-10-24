import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadListPage, ThreadSummary } from '../../../shared/types';
import { api } from '../../api';
import type { MeasuredRange } from './MeasuredWindow';
import { errorMessage } from './state';

export const THREAD_CATALOG_PAGE_SIZE = 40;
export const THREAD_CATALOG_CACHE_PAGES = 3;
const MAX_PROTECTED_PAGES = 6;
const EMPTY_THREADS: readonly ThreadSummary[] = [];
export type ThreadCatalogDirection = 'latest' | 'older' | 'newer';
export type ThreadListResponse = ThreadListPage | ThreadSummary[];
export interface ThreadListFilters {
  workspaceId?: string;
  backend?: 'codex-cli' | 'legacy';
  selectedId?: string | null;
  archived?: 'active' | 'archived' | 'all';
  query?: string;
}

function isSummary(value: unknown): value is ThreadSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ThreadSummary>;
  return typeof item.id === 'string' && typeof item.workspaceId === 'string' && typeof item.title === 'string'
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string' && typeof item.status === 'string';
}

function matches(item: ThreadSummary, filters: ThreadListFilters) {
  return !item.parentThreadId && (!filters.workspaceId || item.workspaceId === filters.workspaceId)
    && (!filters.backend || item.backend === filters.backend)
    && (filters.archived !== 'active' || !item.archivedAt) && (filters.archived !== 'archived' || !!item.archivedAt)
    && (!filters.query?.trim() || item.title.toLowerCase().includes(filters.query.trim().toLowerCase()));
}

function ordered(items: readonly ThreadSummary[], filters: ThreadListFilters): ThreadSummary[] {
  const unique = new Map<string, ThreadSummary>();
  for (const item of items) {
    if (!isSummary(item) || !matches(item, filters)) continue;
    const previous = unique.get(item.id);
    if (!previous || item.updatedAt >= previous.updatedAt) unique.set(item.id, item);
  }
  // Keep the server's order for equal timestamps; cursors are opaque.
  return [...unique.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function pageItems(response: ThreadListResponse) {
  const items = Array.isArray(response) ? response : response?.items;
  if (!Array.isArray(items)) throw new Error('The conversation list could not be read. Try again.');
  return items;
}

/** A small header/background snapshot, including an explicitly selected older thread. */
export function threadListItems(response: ThreadListResponse, filters: ThreadListFilters = {}): ThreadSummary[] {
  const source = pageItems(response);
  const items = ordered(source, filters).slice(0, THREAD_CATALOG_PAGE_SIZE);
  const selected = Array.isArray(response) ? source.find(item => isSummary(item) && item.id === filters.selectedId) : response.selected;
  if (selected && isSummary(selected) && matches(selected, filters) && !items.some(item => item.id === selected.id)) items.push(selected);
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizePage(response: ThreadListResponse, filters: ThreadListFilters): ThreadListPage {
  const items = ordered(pageItems(response), filters).slice(0, THREAD_CATALOG_PAGE_SIZE);
  // Older fixtures have no cursor contract. Do not retain their complete array
  // or fabricate cursors which the real endpoint would reject.
  if (Array.isArray(response)) return { items, olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false };
  const cursor = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null;
  const olderCursor = cursor(response.olderCursor), newerCursor = cursor(response.newerCursor);
  if (response.hasOlder && !olderCursor || response.hasNewer && !newerCursor) throw new Error('The conversation list returned an invalid page. Refresh to try again.');
  return { items, olderCursor, newerCursor, hasOlder: !!response.hasOlder, hasNewer: !!response.hasNewer };
}

function sameSummary(a: ThreadSummary, b: ThreadSummary) {
  return a.id === b.id && a.workspaceId === b.workspaceId && a.title === b.title && a.status === b.status
    && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt && a.archivedAt === b.archivedAt && a.backend === b.backend && a.readOnly === b.readOnly
    && a.parentThreadId === b.parentThreadId && a.rootThreadId === b.rootThreadId && a.taskName === b.taskName
    && a.agentRole === b.agentRole && a.forkedFrom?.threadId === b.forkedFrom?.threadId && a.forkedFrom?.turnId === b.forkedFrom?.turnId;
}

/** Contiguous pages only: an evicted edge can be fetched again with its cursor. */
export class ThreadCatalogCache {
  private pages: ThreadListPage[] = [];
  private protectedIds = new Set<string>();
  private lastDirection: 'older' | 'newer' = 'older';

  constructor(private readonly filters: ThreadListFilters = {}) {}

  snapshot() {
    const first = this.pages[0], last = this.pages.at(-1);
    return {
      items: ordered(this.pages.flatMap(page => page.items), this.filters),
      hasOlder: !!last?.hasOlder, hasNewer: !!first?.hasNewer,
      olderCursor: last?.olderCursor ?? null, newerCursor: first?.newerCursor ?? null,
    };
  }

  replace(response: ThreadListResponse) {
    this.pages = [normalizePage(response, this.filters)];
    this.lastDirection = 'older';
  }

  private trim(pages: ThreadListPage[], direction: 'older' | 'newer') {
    while (pages.length > THREAD_CATALOG_CACHE_PAGES) {
      const index = direction === 'older' ? 0 : pages.length - 1;
      if (pages[index].items.some(item => this.protectedIds.has(item.id))) {
        if (pages.length > MAX_PROTECTED_PAGES) throw new Error('Move keyboard focus or clear the text selection to load more conversations.');
        break;
      }
      pages.splice(index, 1);
    }
    return pages;
  }

  page(response: ThreadListResponse, direction: 'older' | 'newer') {
    const incoming = normalizePage(response, this.filters);
    if (!this.pages.length) { this.pages = [incoming]; return; }
    if (!incoming.items.length) {
      const index = direction === 'older' ? this.pages.length - 1 : 0;
      this.pages = this.pages.map((page, current) => current !== index ? page : { ...page,
        ...(direction === 'older' ? { hasOlder: false, olderCursor: null } : { hasNewer: false, newerCursor: null }) });
      return;
    }
    const pages = direction === 'older' ? [...this.pages, incoming] : [incoming, ...this.pages];
    // Trim before committing, so a protected-cap failure leaves the old window intact.
    this.pages = this.trim(pages, direction);
    this.lastDirection = direction;
  }

  anchor(range: MeasuredRange) {
    this.protectedIds = new Set([...range.pinnedKeys].slice(0, MAX_PROTECTED_PAGES * THREAD_CATALOG_PAGE_SIZE));
    if (range.firstKey) this.protectedIds.add(range.firstKey);
    if (range.lastKey) this.protectedIds.add(range.lastKey);
    const previous = this.pages.length;
    this.pages = this.trim([...this.pages], this.lastDirection);
    return previous !== this.pages.length;
  }

  remove(id: string) {
    let changed = false;
    this.pages = this.pages.map(page => {
      const items = page.items.filter(item => item.id !== id);
      if (items.length === page.items.length) return page;
      changed = true;
      return { ...page, items };
    });
    return changed;
  }

  patch(summary: ThreadSummary) {
    if (!matches(summary, this.filters)) return this.remove(summary.id);
    let changed = false;
    this.pages = this.pages.map(page => ({ ...page, items: page.items.map(item => {
      if (item.id !== summary.id || sameSummary(item, summary)) return item;
      changed = true;
      return summary;
    }) }));
    return changed;
  }
}

interface CatalogState {
  key: string;
  items: ThreadSummary[];
  hasOlder: boolean;
  hasNewer: boolean;
  loading: ThreadCatalogDirection | null;
  error: string | null;
  failed: ThreadCatalogDirection | null;
}

export interface ThreadCatalogOptions {
  workspaceId: string;
  backend?: 'codex-cli' | 'legacy';
  selectedId: string | null;
  open: boolean;
  locked: boolean;
  query: string;
  archived: 'active' | 'archived' | 'all';
  known?: readonly ThreadSummary[];
}

export function useThreadCatalog({ workspaceId, backend = 'codex-cli', selectedId, open, locked, query, archived, known = EMPTY_THREADS }: ThreadCatalogOptions) {
  const normalizedQuery = query.trim();
  const key = JSON.stringify([workspaceId, backend, selectedId, archived, normalizedQuery]);
  const scope = useRef({ key, workspaceId, backend, selectedId, open, locked, query: normalizedQuery, archived });
  scope.current = { key, workspaceId, backend, selectedId, open, locked, query: normalizedQuery, archived };
  const knownRef = useRef(known);
  knownRef.current = known;
  const previousKnown = useRef(known);
  const cache = useRef(new ThreadCatalogCache({ workspaceId, backend, archived, query: normalizedQuery }));
  const cacheKey = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewport = useRef<MeasuredRange | null>(null);
  const edgeVisit = useRef({ older: false, newer: false });
  const pendingUpdates = useRef(new Map<string, ThreadSummary | null>());
  const [state, publish] = useState<CatalogState>({ key, items: [], hasOlder: false, hasNewer: false, loading: null, error: null, failed: null });
  const stateRef = useRef(state);

  const commit = useCallback((patch: Partial<CatalogState> = {}) => {
    const next = { ...stateRef.current, ...cache.current.snapshot(), ...patch, key: scope.current.key };
    stateRef.current = next;
    publish(next);
  }, []);

  const cancel = useCallback(() => {
    generation.current++;
    request.current?.abort(); request.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pendingUpdates.current.clear();
  }, []);

  const nearEdge = useCallback((direction: 'older' | 'newer', range: MeasuredRange | null) => {
    if (!range || !stateRef.current.items.length) return false;
    return direction === 'older' ? range.atEnd || range.end >= stateRef.current.items.length - 4 : range.atStart || range.start <= 4;
  }, []);

  const load = useCallback(async (direction: ThreadCatalogDirection, automatic = false) => {
    const selected = scope.current;
    if (!selected.workspaceId || !selected.open || selected.locked || document.body.dataset.workspaceLocked === 'true'
      || selected.key !== cacheKey.current || request.current || automatic && stateRef.current.error) return;
    const boundary = cache.current.snapshot();
    const cursor = direction === 'older' ? boundary.olderCursor : boundary.newerCursor;
    if (direction !== 'latest' && (!cursor || !(direction === 'older' ? boundary.hasOlder : boundary.hasNewer))) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const controller = new AbortController();
    const version = ++generation.current;
    request.current = controller;
    pendingUpdates.current.clear();
    commit({ loading: direction, error: null, failed: null });
    const params = new URLSearchParams({ workspaceId: selected.workspaceId, backend: selected.backend, archived: selected.archived, limit: String(THREAD_CATALOG_PAGE_SIZE) });
    if (selected.query) params.set('query', selected.query);
    if (selected.selectedId) params.set('selectedId', selected.selectedId);
    if (direction !== 'latest') params.set(direction === 'older' ? 'before' : 'after', cursor!);
    try {
      const response = await api<ThreadListResponse>(`/threads?${params}`, { signal: controller.signal });
      if (version !== generation.current || controller.signal.aborted || selected.key !== scope.current.key || !scope.current.open || scope.current.locked
        || document.body.dataset.workspaceLocked === 'true') return;
      if (direction !== 'latest' && automatic && !nearEdge(direction, viewport.current)) { commit({ loading: null }); return; }
      const incoming = normalizePage(response, selected);
      if (direction !== 'latest' && incoming.items.length
        && (direction === 'older' ? incoming.hasOlder && incoming.olderCursor === cursor : incoming.hasNewer && incoming.newerCursor === cursor)) {
        throw new Error('The conversation list did not advance. Refresh to try again.');
      }
      if (direction === 'latest') cache.current.replace(incoming);
      else cache.current.page(incoming, direction);
      // Mutations completed after this request started must not be resurrected by it.
      for (const [id, summary] of pendingUpdates.current) summary ? cache.current.patch(summary) : cache.current.remove(id);
      commit({ loading: null, error: null, failed: null });
    } catch (error) {
      if (version === generation.current && !controller.signal.aborted && selected.key === scope.current.key && scope.current.open && !scope.current.locked) {
        commit({ loading: null, error: errorMessage(error), failed: direction });
      }
    } finally {
      if (request.current === controller) { request.current = null; pendingUpdates.current.clear(); }
    }
  }, [commit, nearEdge]);

  useEffect(() => {
    cancel();
    cacheKey.current = key;
    cache.current = new ThreadCatalogCache({ workspaceId, backend, archived, query: normalizedQuery });
    cache.current.replace([...knownRef.current]);
    viewport.current = null;
    edgeVisit.current = { older: false, newer: false };
    const enabled = open && !locked && !!workspaceId;
    commit({ loading: enabled ? 'latest' : null, error: null, failed: null });
    if (enabled) {
      // Abort on each edit immediately; send only the settled server search.
      if (normalizedQuery) timer.current = setTimeout(() => { timer.current = null; void load('latest'); }, 180);
      else void load('latest');
    }
    return cancel;
  }, [key, workspaceId, backend, archived, normalizedQuery, open, locked, cancel, commit, load]);

  const recordMutation = useCallback((id: string, summary: ThreadSummary | null) => {
    if (!request.current) return;
    pendingUpdates.current.set(id, summary);
    if (pendingUpdates.current.size > MAX_PROTECTED_PAGES * THREAD_CATALOG_PAGE_SIZE) {
      // An unusually large mutation burst invalidates the snapshot instead of
      // keeping an unbounded overlay of deleted or changed summaries.
      cancel();
      commit({ loading: null });
    }
  }, [cancel, commit]);

  const remove = useCallback((id: string) => {
    if (cacheKey.current !== scope.current.key || scope.current.locked) return;
    recordMutation(id, null);
    if (cache.current.remove(id)) commit();
  }, [commit, recordMutation]);

  const patch = useCallback((summary: ThreadSummary) => {
    if (cacheKey.current !== scope.current.key || scope.current.locked || summary.workspaceId !== scope.current.workspaceId) return;
    recordMutation(summary.id, summary);
    if (cache.current.patch(summary)) commit();
  }, [commit, recordMutation]);

  useEffect(() => {
    const previous = new Map(previousKnown.current.slice(0, THREAD_CATALOG_PAGE_SIZE + 1).map(item => [item.id, item]));
    previousKnown.current = known;
    if (cacheKey.current !== key || locked) return;
    let changed = false;
    for (const summary of known.slice(0, THREAD_CATALOG_PAGE_SIZE + 1)) {
      if (summary.workspaceId !== workspaceId) continue;
      const before = previous.get(summary.id);
      if (before && sameSummary(before, summary)) continue;
      recordMutation(summary.id, summary);
      changed = cache.current.patch(summary) || changed;
    }
    if (changed) commit();
  }, [known, key, locked, workspaceId, commit, recordMutation]);

  const onRangeChange = useCallback((range: MeasuredRange) => {
    if (cacheKey.current !== scope.current.key || !scope.current.open || scope.current.locked) return;
    viewport.current = range;
    if (cache.current.anchor(range)) commit();
    const older = nearEdge('older', range), newer = nearEdge('newer', range);
    if (!older) edgeVisit.current.older = false;
    if (!newer) edgeVisit.current.newer = false;
    if (stateRef.current.loading || stateRef.current.error) return;
    // One automatic request per visit to an edge. A large viewport must not
    // chain requests merely because added content still fits on screen.
    if (older && stateRef.current.hasOlder && !edgeVisit.current.older) {
      edgeVisit.current.older = true;
      void load('older', true);
    } else if (newer && stateRef.current.hasNewer && !edgeVisit.current.newer) {
      edgeVisit.current.newer = true;
      void load('newer', true);
    }
  }, [commit, load, nearEdge]);

  const refresh = useCallback(async () => {
    cancel();
    edgeVisit.current = { older: false, newer: false };
    await load('latest');
  }, [cancel, load]);
  const retry = useCallback(() => load(stateRef.current.failed ?? 'latest'), [load]);
  const loadOlder = useCallback(() => load('older'), [load]);
  const loadNewer = useCallback(() => load('newer'), [load]);
  const fallback = useMemo(() => threadListItems([...known], { workspaceId, backend, archived, query: normalizedQuery }).slice(0, THREAD_CATALOG_PAGE_SIZE), [known, workspaceId, backend, archived, normalizedQuery]);
  const visible = state.key === key ? state : { items: fallback, loading: open && !locked ? 'latest' as const : null, error: null, hasOlder: false, hasNewer: false };
  return { items: visible.items, loading: visible.loading, error: visible.error, hasOlder: visible.hasOlder, hasNewer: visible.hasNewer,
    loadOlder, loadNewer, retry, refresh, remove, patch, onRangeChange };
}
