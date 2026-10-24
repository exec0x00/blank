import type { Bootstrap, Workspace, WorkspacePage } from '../shared/types';
import { ApiError, api } from './api';

export const WORKSPACE_PAGE_SIZE = 40;

/** A page is a display window, never the authority for the mounted workspace. */
export function selectedWorkspace(boot: Bootstrap | null): Workspace | null {
  if (!boot?.activeWorkspaceId) return null;
  if (boot.activeWorkspace?.id === boot.activeWorkspaceId) return boot.activeWorkspace;
  return boot.workspaces.find(workspace => workspace.id === boot.activeWorkspaceId) || null;
}

export function hydrationWorkspaces(boot: Bootstrap, current?: Workspace | null): Workspace[] {
  const unique = new Map(boot.workspaces.map(workspace => [workspace.id, workspace]));
  const active = selectedWorkspace(boot);
  if (active) unique.set(active.id, active);
  if (current) unique.set(current.id, current);
  return [...unique.values()];
}

export function applyWorkspacePage(boot: Bootstrap, page: WorkspacePage): Bootstrap {
  const { workspaces, selected: _selected, ...workspacePage } = page;
  return { ...boot, activeWorkspace: selectedWorkspace(boot), workspaces, workspacePage };
}

export function applyWorkspace(boot: Bootstrap, workspace: Workspace, activate = false): Bootstrap {
  return { ...boot,
    workspaces: boot.workspaces.map(current => current.id === workspace.id ? workspace : current),
    ...(activate || boot.activeWorkspaceId === workspace.id ? { activeWorkspace: workspace, activeWorkspaceId: workspace.id } : {}),
  };
}

/** Only this exact, authenticated lookup can establish that a selection is gone. */
export async function lookupWorkspace(id: string, signal?: AbortSignal): Promise<Workspace | null> {
  try { return await api<Workspace>(`/workspaces/${encodeURIComponent(id)}`, { signal }); }
  catch (failure) {
    if (failure instanceof ApiError && failure.status === 404
      && ['WORKSPACE_NOT_FOUND', 'WORKSPACE_DIRECTORY_MISSING'].includes(failure.code || '')) return null;
    throw failure;
  }
}

/** Transitional bootstrap fixtures may omit the explicit selection field. */
export async function resolveBootstrapWorkspace(boot: Bootstrap): Promise<Bootstrap> {
  const activeWorkspace = selectedWorkspace(boot) || (boot.activeWorkspaceId ? await lookupWorkspace(boot.activeWorkspaceId) : null);
  return { ...boot, activeWorkspace, activeWorkspaceId: activeWorkspace?.id || null };
}
