import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, Folder, Loader2, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { Workspace, WorkspaceDeleteResult, WorkspaceDeletionStatus, WorkspaceDeletionPage, WorkspaceTrashEntry, WorkspaceTrashPage } from '../../shared/types';
import { api, json } from '../api';
import Modal from './Modal';
import PageNavigation from './ui/PageNavigation';
import { MeasuredWindow } from './chat/MeasuredWindow';
import { useOperationalPage } from './useOperationalPage';
import './WorkspaceTrash.css';

interface Props {
  onBack: () => void;
  onRestored: (workspace: Workspace) => void;
  onBusyChange: (busy: boolean) => void;
  onDeletionCompleted?: () => void;
}
type TrashAction = 'restore' | 'delete';
type Pending = { id: string; action: TrashAction | 'retry-permanent' };
const message = (error: unknown) => error instanceof Error ? error.message : 'Workspace trash could not be updated. Try again.';
const locked = () => document.body.dataset.workspaceLocked === 'true';
const emptyPageMessage = (offset = 0) => offset > 0 ? 'This page is empty. Choose Previous or refresh the list.' : 'This page is empty. Refresh the list.';

export function workspaceTrashStatus(entry: WorkspaceTrashEntry): string {
  if (entry.state === 'missing') return 'Original files are missing';
  if (entry.state === 'recovery') return 'Recovery needs attention';
  return entry.canRestore ? 'Files saved in trash' : 'Restore unavailable';
}

export function WorkspaceTrashItem({ entry, pending, disabled, onRestore, onDelete, position, total }: {
  entry: WorkspaceTrashEntry;
  pending: Pending | null;
  disabled: boolean;
  onRestore: () => void;
  onDelete: () => void;
  position?: number;
  total?: number;
}) {
  const date = new Date(entry.deletedAt);
  const expiry = new Date(entry.expiresAt);
  const pendingHere = pending?.id === entry.id;
  return <div role="listitem" aria-posinset={position} aria-setsize={total} className="workspace-trash-item">
    <div className="workspace-trash-item-heading"><span className="workspace-trash-folder"><Folder size={18} /></span><div><strong className="text-ellipsis" data-tooltip={entry.name}>{entry.name}</strong><span>{workspaceTrashStatus(entry)}</span></div></div>
    <div className="workspace-trash-item-detail">
      <p>{entry.state === 'missing' ? 'Only the saved workspace record remains. Trash cannot restore the missing files.' : entry.state === 'recovery' ? 'The saved files need recovery before this workspace can be restored.' : 'Restore returns this workspace to your workspace list.'}</p>
      {entry.issue && <p className="workspace-trash-issue"><CircleAlert size={14} /><span>{entry.issue}</span></p>}
      {!Number.isNaN(date.valueOf()) && <time dateTime={entry.deletedAt}>{entry.reason === 'missing' ? 'Missing since' : 'Moved to trash'} {date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>}
      {!Number.isNaN(expiry.valueOf()) && <time className="workspace-trash-expiry" dateTime={entry.expiresAt}>Permanently deleted on {expiry.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>}
    </div>
    <div className="workspace-trash-item-actions">
      <button className="button ghost" type="button" data-trash-action onClick={onDelete} disabled={disabled} aria-label={`Permanently delete ${entry.name}`}><Trash2 size={14} />Permanently delete</button>
      <button className="button" type="button" data-trash-action onClick={onRestore} disabled={disabled || !entry.canRestore} aria-label={`Restore ${entry.name}`} title={!entry.canRestore ? workspaceTrashStatus(entry) : undefined}>{pendingHere && pending.action === 'restore' ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}{pendingHere && pending.action === 'restore' ? 'Restoring…' : 'Restore'}</button>
    </div>
  </div>;
}

export function PermanentWorkspaceDeletionItem({ entry, retrying, disabled, onRetry, position, total }: {
  entry: WorkspaceDeletionStatus;
  retrying: boolean;
  disabled: boolean;
  onRetry: () => void;
  position?: number;
  total?: number;
}) {
  const updated = new Date(entry.updatedAt);
  return <div role="listitem" aria-posinset={position} aria-setsize={total} className="workspace-permanent-deletion-item">
    <div className="workspace-trash-item-heading"><span className="workspace-trash-folder"><Trash2 size={17} /></span><div><strong className="text-ellipsis" data-tooltip={entry.name}>{entry.name}</strong><span>{entry.state === 'pending' ? 'Permanent deletion pending' : 'Permanent deletion needs attention'}</span></div></div>
    <div className="workspace-trash-item-detail"><p>Deletion is not complete. Local files may remain, and this workspace cannot be restored. The repository on GitHub is unchanged.</p>{entry.issue && <p className="workspace-trash-issue"><CircleAlert size={14} /><span>{entry.issue}</span></p>}{!Number.isNaN(updated.valueOf()) && <time dateTime={entry.updatedAt}>Last updated {updated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>}</div>
    <div className="workspace-trash-item-actions"><button className="button" type="button" data-deletion-action disabled={disabled} onClick={onRetry} aria-label={`Retry permanent deletion of ${entry.name}`}>{retrying ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}{retrying ? 'Retrying deletion…' : 'Retry deletion'}</button></div>
  </div>;
}

export default function WorkspaceTrash({ onBack, onRestored, onBusyChange, onDeletionCompleted }: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [sessionLocked, setSessionLocked] = useState(locked);
  const [removal, setRemoval] = useState<WorkspaceTrashEntry | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletionError, setDeletionError] = useState('');
  const trashPage = useOperationalPage<WorkspaceTrashEntry, WorkspaceTrashPage>('/workspace-trash/page', !sessionLocked && !pending);
  const deletionPage = useOperationalPage<WorkspaceDeletionStatus, WorkspaceDeletionPage>('/workspace-deletions/page', !sessionLocked && !pending);
  const pendingRef = useRef<Pending | null>(null);
  const removalRef = useRef(removal);
  const generation = useRef(0);
  const actionNumber = useRef(0);
  const mounted = useRef(false);
  const backButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const deletionList = useRef<HTMLDivElement>(null);
  const latest = useRef({ onBack, onRestored, onBusyChange, onDeletionCompleted, trashPage, deletionPage });
  latest.current = { onBack, onRestored, onBusyChange, onDeletionCompleted, trashPage, deletionPage };
  removalRef.current = removal;
  const entries = trashPage.page?.items ?? null;
  const deletions = deletionPage.page?.items ?? null;
  const loading = trashPage.loading || deletionPage.loading;

  const refresh = useCallback(async () => {
    if (!mounted.current || locked() || pendingRef.current) return;
    await Promise.allSettled([latest.current.trashPage.refresh(), latest.current.deletionPage.refresh()]);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const stop = () => {
      generation.current++;
      latest.current.trashPage.cancel(); latest.current.deletionPage.cancel();
      pendingRef.current = null; latest.current.onBusyChange(false);
    };
    const lock = () => { stop(); setSessionLocked(true); setPending(null); removalRef.current = null; setRemoval(null); };
    const unlock = () => { setSessionLocked(false); };
    const recheck = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-expired', lock);
    window.addEventListener('codex:session-unlocked', unlock);
    window.addEventListener('focus', recheck);
    window.addEventListener('online', recheck);
    backButton.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false; stop();
      window.removeEventListener('codex:session-locked', lock);
      window.removeEventListener('codex:session-expired', lock);
      window.removeEventListener('codex:session-unlocked', unlock);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('online', recheck);
    };
  }, [refresh]);

  useEffect(() => {
    if (removalRef.current && entries && !entries.some(entry => entry.id === removalRef.current!.id)) {
      removalRef.current = null; setRemoval(null);
    }
  }, [entries]);

  const run = async (entry: WorkspaceTrashEntry, action: TrashAction) => {
    if (!mounted.current || locked() || pendingRef.current || latest.current.trashPage.loadingRef.current) return;
    const currentEntry = latest.current.trashPage.pageRef.current?.items.find(item => item.id === entry.id);
    if (!currentEntry || (action === 'restore' && !currentEntry.canRestore) || (action === 'delete' && removalRef.current?.id !== entry.id)) return;
    const operation = { id: entry.id, action };
    const actionScope = ++actionNumber.current;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scope = generation.current;
    pendingRef.current = operation; setPending(operation); latest.current.onBusyChange(true);
    setError(''); setNotice('');
    const current = () => mounted.current && scope === generation.current && !locked() && pendingRef.current === operation;
    try {
      if (action === 'restore') {
        const restored = await api<Workspace>(`/workspace-trash/${encodeURIComponent(entry.id)}/restore`, json('POST', {}));
        if (!current()) return;
        latest.current.onRestored(restored);
        setNotice(`${restored.name} was restored to your workspaces.`);
      } else {
        await api<{ deleted: true; id: string }>(`/workspace-trash/${encodeURIComponent(entry.id)}`, json('DELETE'));
        if (!current()) return;
        removalRef.current = null; setRemoval(null);
        setNotice(`${entry.name} was permanently deleted from workspace trash.`);
      }
      latest.current.trashPage.replaceItems(items => items.filter(item => item.id !== entry.id));
    } catch (failure) { if (current()) setError(message(failure)); }
    finally {
      if (current()) {
        const refreshed = latest.current.trashPage.refreshAfterPause();
        pendingRef.current = null; setPending(null); latest.current.onBusyChange(false);
        void refreshed.finally(() => requestAnimationFrame(() => {
          if (!mounted.current || scope !== generation.current || actionScope !== actionNumber.current || pendingRef.current || locked() || latest.current.trashPage.loadingRef.current || document.activeElement !== document.body) return;
          const target = focus?.isConnected && !focus.matches(':disabled') ? focus : list.current?.querySelector<HTMLButtonElement>('button[data-trash-action]:not(:disabled)') || backButton.current;
          target?.focus({ preventScroll: true });
        }));
      }
    }
  };

  const retryPermanentDeletion = async (entry: WorkspaceDeletionStatus) => {
    if (!mounted.current || locked() || pendingRef.current || latest.current.deletionPage.loadingRef.current) return;
    const saved = latest.current.deletionPage.pageRef.current?.items.find(item => item.id === entry.id);
    if (!saved || saved.workspaceId !== entry.workspaceId || saved.mode !== 'permanent') return;
    const operation: Pending = { id: entry.id, action: 'retry-permanent' };
    const actionScope = ++actionNumber.current;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scope = generation.current;
    pendingRef.current = operation; setPending(operation); latest.current.onBusyChange(true);
    setDeletionError(''); setNotice('');
    const current = () => mounted.current && scope === generation.current && !locked() && pendingRef.current === operation;
    try {
      // A journal ID targets only its confirmed deletion, never a newer workspace.
      const result = await api<WorkspaceDeleteResult>(`/workspace-deletions/${encodeURIComponent(entry.id)}/retry`, json('POST', {}));
      if (!current()) return;
      if (result.mode !== 'permanent' || result.workspaceId !== saved.workspaceId) throw new Error('The permanent deletion could not be confirmed. Refresh its status before retrying.');
      latest.current.deletionPage.replaceItems(items => items.filter(item => item.id !== entry.id));
      setNotice(`${saved.name} was deleted permanently from local storage. The repository on GitHub is unchanged.`);
      latest.current.onDeletionCompleted?.();
    } catch (failure) {
      if (current()) {
        const issue = failure instanceof Error ? failure.message : 'The permanent deletion could not be completed. Try again.';
        latest.current.deletionPage.replaceItems(items => items.map(item => item.id === entry.id ? { ...item, state: 'error' as const, issue } : item));
        setDeletionError(issue);
      }
    } finally {
      if (current()) {
        const refreshed = latest.current.deletionPage.refreshAfterPause();
        pendingRef.current = null; setPending(null); latest.current.onBusyChange(false);
        void refreshed.finally(() => requestAnimationFrame(() => {
          if (!mounted.current || scope !== generation.current || actionScope !== actionNumber.current || pendingRef.current || locked() || latest.current.deletionPage.loadingRef.current || document.activeElement !== document.body) return;
          const target = focus?.isConnected && !focus.matches(':disabled') ? focus : deletionList.current?.querySelector<HTMLButtonElement>('button[data-deletion-action]:not(:disabled)') || backButton.current;
          target?.focus({ preventScroll: true });
        }));
      }
    }
  };

  const disabled = loading || !!pending || sessionLocked;
  const trashDisabled = trashPage.loading || !!pending || sessionLocked;
  const deletionDisabled = deletionPage.loading || !!pending || sessionLocked;
  return <section className="workspace-trash" aria-label="Workspace trash" aria-busy={loading || !!pending}>
    <div className="workspace-trash-toolbar"><button ref={backButton} className="button ghost" type="button" onClick={onBack} disabled={!!pending || sessionLocked}><ArrowLeft size={15} />All workspaces</button><button className="icon-button" type="button" onClick={() => void refresh()} disabled={disabled} aria-label="Refresh workspace trash">{loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}</button></div>
    <p className="workspace-trash-intro">Workspaces in trash are permanently deleted after 30 days. Restore them before their expiry date. Files removed outside the app may no longer be recoverable.</p>
    <label className="workspace-operational-search"><Search size={15} /><input type="search" value={trashPage.query} onChange={event => { removalRef.current = null; setRemoval(null); trashPage.changeQuery(event.target.value); }} aria-label="Search workspace trash" placeholder="Search workspace trash" maxLength={160} disabled={!!pending || sessionLocked} /></label>
    {trashPage.error && <div className="workspace-trash-feedback" role="alert"><CircleAlert size={16} /><p>{trashPage.error}</p><button className="button ghost" type="button" onClick={() => void trashPage.refresh()} disabled={trashDisabled}>Try again</button></div>}
    {notice && <p className="workspace-trash-notice" role="status">{notice}</p>}
    {error && !removal && <p className="form-error" role="alert">{error}</p>}
    {trashPage.loading && <p className="workspace-operational-loading" role="status"><Loader2 size={15} className="spin" />Loading workspace trash…</p>}
    {entries !== null && (entries.length === 0 ? !trashPage.loading && <div className="workspace-trash-empty"><Trash2 size={25} /><strong>{(trashPage.page?.offset ?? 0) > 0 || (trashPage.page?.total ?? 0) > 0 || trashPage.error ? emptyPageMessage(trashPage.page?.offset) : trashPage.query.trim() ? 'No deleted workspaces match this search.' : 'Workspace trash is empty.'}</strong>{!trashPage.query.trim() && trashPage.page?.total === 0 && !trashPage.error && <p>Workspaces moved to trash will appear here.</p>}</div> : <div ref={list} className="workspace-trash-list workspace-operational-scroll" role="list" tabIndex={0} aria-label="Deleted workspaces"><MeasuredWindow items={entries} itemKey={entry => entry.id} estimateHeight={() => 236} scrollRef={list} resetKey={trashPage.resetKey} overscan={280} itemClassName={() => 'workspace-operational-row'} renderItem={(entry, index) => <WorkspaceTrashItem position={(trashPage.page?.offset ?? 0) + index + 1} total={trashPage.page?.total} entry={entry} pending={pending} disabled={trashDisabled} onRestore={() => void run(entry, 'restore')} onDelete={() => { if (!pendingRef.current && !latest.current.trashPage.loadingRef.current) { setError(''); removalRef.current = entry; setRemoval(entry); } }} />} /></div>)}
    <PageNavigation label="Workspace trash" offset={trashPage.page?.offset ?? 0} count={entries?.length ?? 0} total={trashPage.page?.total} hasPrevious={(trashPage.page?.offset ?? 0) > 0} hasNext={trashPage.page?.hasMore ?? false} loading={trashPage.loading} disabled={!!pending || sessionLocked} onPrevious={trashPage.previous} onNext={trashPage.next} />
    <section className="workspace-permanent-deletions" aria-labelledby="workspace-permanent-deletions-title"><h3 id="workspace-permanent-deletions-title">Permanent deletions</h3><p>Unfinished permanent deletions appear here until their local files are removed. These workspaces are outside recoverable trash.</p>
      <label className="workspace-operational-search"><Search size={15} /><input type="search" value={deletionPage.query} onChange={event => deletionPage.changeQuery(event.target.value)} aria-label="Search permanent deletions" placeholder="Search permanent deletions" maxLength={160} disabled={!!pending || sessionLocked} /></label>
      {deletionPage.error && <div className="workspace-trash-feedback" role="alert"><CircleAlert size={16} /><p>{deletionPage.error}</p><button className="button ghost" type="button" onClick={() => void deletionPage.refresh()} disabled={deletionDisabled}>Try again</button></div>}
      {deletionError && <p className="form-error" role="alert">{deletionError}</p>}
      {deletionPage.loading && <p className="workspace-operational-loading" role="status"><Loader2 size={15} className="spin" />Loading permanent deletion status…</p>}
      {deletions !== null && (deletions.length === 0 ? !deletionPage.loading && <p className="workspace-permanent-deletions-empty">{(deletionPage.page?.offset ?? 0) > 0 || (deletionPage.page?.total ?? 0) > 0 || deletionPage.error ? emptyPageMessage(deletionPage.page?.offset) : deletionPage.query.trim() ? 'No permanent deletions match this search.' : 'No unfinished permanent deletions.'}</p> : <div ref={deletionList} className="workspace-trash-list workspace-operational-scroll" role="list" tabIndex={0} aria-label="Unfinished permanent deletions"><MeasuredWindow items={deletions} itemKey={entry => entry.id} estimateHeight={() => 220} scrollRef={deletionList} resetKey={deletionPage.resetKey} overscan={280} itemClassName={() => 'workspace-operational-row'} renderItem={(entry, index) => <PermanentWorkspaceDeletionItem position={(deletionPage.page?.offset ?? 0) + index + 1} total={deletionPage.page?.total} entry={entry} retrying={pending?.action === 'retry-permanent' && pending.id === entry.id} disabled={deletionDisabled} onRetry={() => void retryPermanentDeletion(entry)} />} /></div>)}
      <PageNavigation label="Permanent deletions" offset={deletionPage.page?.offset ?? 0} count={deletions?.length ?? 0} total={deletionPage.page?.total} hasPrevious={(deletionPage.page?.offset ?? 0) > 0} hasNext={deletionPage.page?.hasMore ?? false} loading={deletionPage.loading} disabled={!!pending || sessionLocked} onPrevious={deletionPage.previous} onNext={deletionPage.next} />
    </section>
    <Modal open={!!removal} onClose={() => { if (!pendingRef.current) { removalRef.current = null; setRemoval(null); setError(''); } }} title={`Permanently delete ${removal?.name || 'workspace'}?`} titleId="workspace-trash-delete-title" className="workspace-trash-delete-dialog">
      <div className="workspace-trash-delete-body"><p>{removal?.state === 'missing' ? 'The original workspace files are missing. This removes its saved trash record and cannot recover those files.' : 'Any files saved in workspace trash will be permanently deleted.'} This cannot be undone.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="workspace-trash-delete-actions"><button className="button ghost" type="button" data-autofocus disabled={!!pending} onClick={() => { removalRef.current = null; setRemoval(null); setError(''); }}>Cancel</button><button className="button danger" type="button" disabled={trashDisabled} onClick={() => { if (removal) void run(removal, 'delete'); }}>{pending?.action === 'delete' ? <><Loader2 size={15} className="spin" />Deleting…</> : <><Trash2 size={15} />Permanently delete</>}</button></div></div>
    </Modal>
  </section>;
}
