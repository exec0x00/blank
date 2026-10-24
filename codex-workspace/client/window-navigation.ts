import { useEffect, useMemo, useState } from 'react';
import type { Bootstrap } from '../shared/types';
import { applyWorkspace, lookupWorkspace, resolveBootstrapWorkspace } from './workspace-selection';

export type WindowView = 'agent' | 'editor';
export interface WindowLocation {
  workspaceId?: string;
  /** Undefined uses the saved selection; null explicitly opens an empty draft. */
  threadId?: string | null;
  view?: WindowView;
  error?: string;
}
const locationEvent = 'codex:window-location';
const invalidLink = 'This workspace link is invalid. Choose a workspace to continue.';
export const validNavigationId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Links contain only identities and presentation preferences, never history or credentials. */
export function parseWindowLocation(search: string): WindowLocation {
  const params = new URLSearchParams(search);
  for (const key of ['workspace', 'thread', 'view']) if (params.getAll(key).length > 1) return { error: invalidLink };
  const workspaceId = params.get('workspace'), threadId = params.get('thread'), view = params.get('view');
  if (workspaceId !== null && !validNavigationId(workspaceId)
    || threadId !== null && (threadId !== '$new' && !validNavigationId(threadId) || !workspaceId)
    || view !== null && view !== 'agent' && view !== 'editor') return { error: invalidLink };
  return { ...(workspaceId ? { workspaceId } : {}), ...(threadId !== null ? { threadId: threadId === '$new' ? null : threadId } : {}),
    ...(view ? { view: view as WindowView } : {}) };
}

export function windowLink(location: WindowLocation, pathname = '/work'): string {
  if (!validNavigationId(location.workspaceId) || location.threadId != null && !validNavigationId(location.threadId)
    || location.view !== undefined && location.view !== 'agent' && location.view !== 'editor'
    || !pathname.startsWith('/') || pathname.startsWith('//') || /[\\?#\u0000-\u001f\u007f]/.test(pathname)) throw new Error('The window link is invalid.');
  const params = new URLSearchParams({ workspace: location.workspaceId });
  if (location.threadId !== undefined) params.set('thread', location.threadId ?? '$new');
  if (location.view) params.set('view', location.view);
  return `${pathname === '/' ? '/work' : pathname}?${params}`;
}

export function readWindowLocation(): WindowLocation { return parseWindowLocation(typeof window === 'undefined' ? '' : window.location.search); }

/** Browser back/forward and in-app choices use the same local selection. */
export function writeWindowLocation(location: WindowLocation, replace = false): void {
  const href = windowLink(location) + window.location.hash;
  if (href === window.location.pathname + window.location.search + window.location.hash) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
  window.dispatchEvent(new Event(locationEvent));
}

export function useWindowLocation(): WindowLocation {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const changed = () => setSearch(window.location.search);
    window.addEventListener('popstate', changed); window.addEventListener(locationEvent, changed);
    return () => { window.removeEventListener('popstate', changed); window.removeEventListener(locationEvent, changed); };
  }, []);
  return useMemo(() => parseWindowLocation(search), [search]);
}

export async function resolveWindowWorkspace(boot: Bootstrap, location: WindowLocation): Promise<{ boot: Bootstrap; error?: string }> {
  if (location.error) return { boot: { ...boot, activeWorkspace: null, activeWorkspaceId: null }, error: location.error };
  if (!location.workspaceId) return { boot: await resolveBootstrapWorkspace(boot) };
  // Opening a focused window is a read. It must not change another window's
  // workspace, nor treat a partial first page as proof that a workspace is gone.
  const workspace = await lookupWorkspace(location.workspaceId);
  if (!workspace) return { boot: { ...boot, activeWorkspace: null, activeWorkspaceId: null }, error: 'The workspace in this link is no longer available. Choose a workspace to continue.' };
  if (workspace.id !== location.workspaceId) throw new Error('The workspace did not match this link.');
  return { boot: applyWorkspace(boot, workspace, true) };
}
