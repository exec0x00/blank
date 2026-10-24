import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceDeletionStatus, WorkspaceTrashEntry } from '../shared/types';
import { PermanentWorkspaceDeletionItem, WorkspaceTrashItem } from '../client/components/WorkspaceTrash';

const entry: WorkspaceTrashEntry = { id: 'trash-project', workspaceId: 'project', name: 'Project', deletedAt: '2026-09-20T12:00:00.000Z', expiresAt: '2026-10-20T12:00:00.000Z', reason: 'deleted', state: 'ready', canRestore: true };
const render = (overrides: Partial<WorkspaceTrashEntry> = {}) => renderToStaticMarkup(<WorkspaceTrashItem entry={{ ...entry, ...overrides }} pending={null} disabled={false} onRestore={() => undefined} onDelete={() => undefined} />);
const deletion: WorkspaceDeletionStatus = { id: 'permanent-journal', workspaceId: 'github-project', name: 'GitHub project', mode: 'permanent', state: 'error', updatedAt: '2026-09-20T12:00:00.000Z', issue: 'Local storage is busy. Close the retained terminal before retrying.' };

describe('workspace trash presentation', () => {
  it('provides restore for saved files and a clearly named permanent-delete action', () => {
    const html = render();
    expect(html).toContain('Files saved in trash');
    expect(html).toContain('aria-label="Restore Project"');
    expect(html).toContain('aria-label="Permanently delete Project"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('Permanently deleted on');
    expect(html).toMatch(/datetime="2026-10-20T12:00:00.000Z"/i);
  });

  it('never offers a working restore for a missing workspace root', () => {
    const html = render({ reason: 'missing', state: 'missing', canRestore: false });
    expect(html).toContain('Original files are missing');
    expect(html).toContain('Trash cannot restore the missing files.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Restore Project"/);
    expect(html).not.toContain('Files saved in trash');
  });

  it('keeps incomplete recovery failures readable without promising restored files', () => {
    const html = render({ state: 'recovery', canRestore: false, issue: 'The original location is occupied. Keep both copies until recovery is reviewed.' });
    expect(html).toContain('Recovery needs attention');
    expect(html).toContain('Keep both copies until recovery is reviewed.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Restore Project"/);
    expect(html).not.toContain('Original files are missing');
  });

  it('uses server restore eligibility even when a saved entry is unavailable', () => {
    const html = render({ canRestore: false });
    expect(html).toContain('Restore unavailable');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Restore Project"/);
  });

  it('makes incomplete permanent deletion and retained bytes visible without offering restore or a trash expiry', () => {
    const html = renderToStaticMarkup(<PermanentWorkspaceDeletionItem entry={deletion} retrying={false} disabled={false} onRetry={() => undefined} />);
    expect(html).toContain('Permanent deletion needs attention');
    expect(html).toContain('Local files may remain');
    expect(html).toContain('this workspace cannot be restored');
    expect(html).toContain('Close the retained terminal before retrying.');
    expect(html).toContain('aria-label="Retry permanent deletion of GitHub project"');
    expect(html).not.toContain('aria-label="Restore');
    expect(html).not.toContain('30 days');
    expect(html).not.toContain('workspace-trash-expiry');
  });

  it('allows a pending permanent operation to be retried only when no client request is in flight', () => {
    const pending = { ...deletion, state: 'pending' as const, issue: undefined };
    const ready = renderToStaticMarkup(<PermanentWorkspaceDeletionItem entry={pending} retrying={false} disabled={false} onRetry={() => undefined} />);
    const busy = renderToStaticMarkup(<PermanentWorkspaceDeletionItem entry={pending} retrying disabled onRetry={() => undefined} />);
    expect(ready).toContain('Permanent deletion pending');
    expect(ready).not.toContain('disabled=""');
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('Retrying deletion');
  });
});
