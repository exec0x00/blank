import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Workspace, WorkspacePage } from '../shared/types';
import { applyWorkspace, applyWorkspacePage, hydrationWorkspaces, lookupWorkspace, resolveBootstrapWorkspace, selectedWorkspace } from '../client/workspace-selection';
import { defaultSettings } from '../server/settings';

const workspace = (id: string): Workspace => ({ id, name: id, path: `/data/workspaces/${id}`, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' });
const firstPage = Array.from({ length: 40 }, (_, index) => workspace(`visible-${index}`));
const current = { ...workspace('off-page-current'), githubAccountId: 'preserved-account' };
const boot = (): Bootstrap => ({ workspaces: firstPage, activeWorkspace: current, activeWorkspaceId: current.id, settings: defaultSettings, githubAccounts: [], storage: { path: '/data', persistent: true, bucket: 'public-fixture', writable: true } });
const page = (workspaces: Workspace[]): WorkspacePage => ({ workspaces, nextCursor: null, previousCursor: 'earlier', offset: 40, total: 42 });

afterEach(() => vi.unstubAllGlobals());

describe('selection independent of a workspace page', () => {
  it('keeps off-page metadata and preferences available across page replacement and selected renames', () => {
    const next = applyWorkspacePage(boot(), page([workspace('another-page')]));
    expect(selectedWorkspace(next)).toEqual(current);
    expect(next.workspaces).toHaveLength(1);
    const renamed = applyWorkspace(next, { ...current, name: 'Renamed while outside this page' });
    expect(selectedWorkspace(renamed)?.githubAccountId).toBe('preserved-account');
    expect(selectedWorkspace(renamed)?.name).toBe('Renamed while outside this page');
    expect(hydrationWorkspaces(renamed).map(workspace => workspace.id)).toEqual(['another-page', current.id]);
    const selected = applyWorkspace(boot(), workspace('created-outside-the-first-page'), true);
    expect(selected.workspaces).toHaveLength(40);
    expect(selectedWorkspace(selected)?.id).toBe('created-outside-the-first-page');
  });

  it('does not fall back to the first page when an older bootstrap needs an exact off-page lookup', async () => {
    const legacy = { ...boot(), activeWorkspace: undefined };
    const fetch = vi.fn(async (_url: string) => Response.json(current)); vi.stubGlobal('fetch', fetch);
    const next = await resolveBootstrapWorkspace(legacy);
    expect(fetch.mock.calls[0][0]).toBe(`/api/workspaces/${current.id}`);
    expect(selectedWorkspace(next)).toEqual(current);
    expect(next.workspaces).toEqual(firstPage);
    expect(hydrationWorkspaces(next)).toHaveLength(41);
  });

  it('only accepts explicit missing-workspace responses as absence, preserving transient and generic failures', async () => {
    for (const [status, code] of [[503, 'WORKSPACE_UNAVAILABLE'], [403, 'UNSAFE_PATH'], [404, undefined], [409, 'WORKSPACE_TRASH_UNSAFE']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Workspace check failed.', ...(code ? { code } : {}) }, { status })));
      await expect(lookupWorkspace(current.id)).rejects.toMatchObject({ status });
      expect(selectedWorkspace(boot())).toEqual(current);
    }
    for (const code of ['WORKSPACE_NOT_FOUND', 'WORKSPACE_DIRECTORY_MISSING']) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unavailable workspace.', code }, { status: 404 })));
      expect(await lookupWorkspace(current.id)).toBeNull();
    }
  });
});
