import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { api } from '../../api';
import type { DirectoryPage, FileEntry } from '../../../shared/types';
import { DirectoryPageCache, EXPLORER_PAGE_SIZE } from './directory-pages';

export function useDirectoryPages(workspaceId: string, canRead: () => boolean) {
  const scope = useRef({ workspaceId, canRead });
  scope.current = { workspaceId, canRead };
  const cache = useMemo(() => {
    const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
    return new DirectoryPageCache({
      canRead: () => scope.current.workspaceId === workspaceId && scope.current.canRead(),
      page: (path, { cursor, snapshot, signal }) => {
        const query = new URLSearchParams({ path, limit: String(EXPLORER_PAGE_SIZE) });
        if (cursor) query.set('cursor', cursor);
        if (snapshot) query.set('snapshot', snapshot);
        return api<DirectoryPage>(`${base}/tree-page?${query}`, { signal });
      },
      entry: (path, signal) => api<FileEntry>(`${base}/tree-entry?${new URLSearchParams({ path })}`, { signal }),
    });
  }, [workspaceId]);
  const state = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  const treeRef = useRef(state.tree);
  treeRef.current = state.tree;
  useEffect(() => { cache.setActive(true); return () => { cache.setActive(false); }; }, [cache]);
  return { ...state, cache, treeRef, loadDirectory: cache.loadDirectory, loadMore: cache.loadMore, retryDirectory: cache.retry };
}
