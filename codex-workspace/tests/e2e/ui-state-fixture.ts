import type { Route } from '@playwright/test';
import type { UiState, UiStatePatch } from '../../shared/types';

/** Only for suites that replace the entire API. Real persistence uses the actual server tests. */
export function uiStateFixture(initial?: UiState) {
  let saved: UiState = initial ? structuredClone(initial) : { version: 1, revision: 0, layouts: {}, editor: {}, workspaces: {}, fieldRevisions: {} };
  return {
    read: () => structuredClone(saved),
    async handle(route: Route): Promise<boolean> {
      if (new URL(route.request().url()).pathname !== '/api/ui-state') return false;
      if (route.request().method() === 'PATCH') {
        const input = route.request().postDataJSON() as UiStatePatch;
        if (!(input.migration && saved.revision > 0)) {
          const next = structuredClone(saved);
          const revision = next.revision + 1;
          for (const change of input.changes) {
            const key = change.section === 'layout' ? `layout.${change.profile}.${change.key}` : change.section === 'editor' ? `editor.${change.key}` : `workspace.${change.workspaceId}.${change.key}`;
            if (change.section === 'layout') next.layouts[change.profile] = { ...next.layouts[change.profile], [change.key]: change.value };
            else if (change.section === 'editor') next.editor = { ...next.editor, [change.key]: change.value };
            else next.workspaces[change.workspaceId] = { ...next.workspaces[change.workspaceId], [change.key]: change.value };
            next.fieldRevisions[key] = revision;
          }
          next.revision = revision;
          saved = next;
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) });
      return true;
    },
  };
}
