import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, File, ListOrdered, LoaderCircle, PencilLine, Play, RefreshCw, X } from 'lucide-react';
import PageNavigation from '../ui/PageNavigation';
import { NativeQueueEditor } from '../native/NativeOrganizationPanel';
import { RequestDialog } from './RequestDialog';
import type { ThreadQueueController } from './useThreadQueue';
import './queued-inputs.css';

const PAGE_SIZE = 4;
export function QueuedInputs({ controller, disabled = false, hidden = false, scopeKey, workspaceId, threadId }: {
  controller: ThreadQueueController; disabled?: boolean; hidden?: boolean; scopeKey: string; workspaceId?: string; threadId?: string | null;
}) {
  const currentPage = scopeKey + ':' + controller.pageKey;
  const [page, setPage] = useState({ scopeKey: currentPage, offset: 0 });
  const [editingScope, setEditingScope] = useState<string | null>(null), [eventLocked, setEventLocked] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState<string | undefined>();
  const group = useRef<HTMLDivElement>(null), title = useId();
  const last = Math.max(0, Math.ceil(controller.items.length / PAGE_SIZE) - 1) * PAGE_SIZE;
  const offset = page.scopeKey === currentPage ? Math.min(page.offset, last) : 0;
  useEffect(() => { setPage(previous => previous.scopeKey === currentPage ? { ...previous, offset: Math.min(previous.offset, last) } : { scopeKey: currentPage, offset: 0 }); }, [currentPage, last]);
  useEffect(() => { setEditingScope(null); }, [scopeKey, hidden]);
  useEffect(() => {
    const lock = () => { setEditingScope(null); setEventLocked(true); };
    const unlock = () => setEventLocked(false);
    window.addEventListener('codex:session-locked', lock); window.addEventListener('codex:session-expired', lock); window.addEventListener('codex:session-unlocked', unlock);
    return () => { window.removeEventListener('codex:session-locked', lock); window.removeEventListener('codex:session-expired', lock); window.removeEventListener('codex:session-unlocked', unlock); };
  }, []);
  async function act(id: string, action: 'cancel' | 'resume') {
    const focused = document.activeElement;
    const ownedFocus = focused instanceof Element && focused.closest('[data-submission-id]')?.getAttribute('data-submission-id') === id;
    await controller[action](id);
    if (ownedFocus && document.activeElement === document.body) group.current?.focus();
  }
  if (hidden || eventLocked || !controller.items.length && !controller.error && !controller.hasPreviousPage && !controller.hasMore) return null;
  return <><section className="turn-queue" aria-label="Pending messages">
    {controller.error && <div className="turn-queue-error" role="alert"><AlertCircle size={13} /><span>{controller.error}</span>
      <button type="button" disabled={disabled || controller.refreshing} onClick={() => { controller.clearError(); void controller.refresh(); }}>Refresh</button>
      <button type="button" aria-label="Dismiss pending message error" onClick={controller.clearError}><X size={12} /></button>
    </div>}
    {(!!controller.items.length || controller.hasPreviousPage || controller.hasMore) && <div className="turn-queue-group" role="group" aria-label="Next turn" ref={group} tabIndex={-1}>
      <div className="turn-queue-heading"><ListOrdered size={16} aria-hidden="true" /><strong id={title}>Next turn</strong><span className="turn-queue-count">{controller.items.length}{controller.hasMore ? '+' : ''}</span>
        <div className="turn-queue-heading-actions">{workspaceId && threadId && <button type="button" className="turn-queue-action" disabled={disabled} aria-haspopup="dialog" onClick={() => {
          if (document.body.dataset.workspaceLocked !== 'true') { setEditingSubmission(undefined); setEditingScope(scopeKey); }
        }}>Manage queue</button>}
          <button type="button" className="turn-queue-action" aria-label="Refresh pending messages" disabled={disabled || controller.refreshing} onClick={() => void controller.refresh()}><RefreshCw size={15} aria-hidden="true" /></button>
        </div>
      </div>
      <ol className="turn-queue-list" aria-labelledby={title} start={offset + 1}>{controller.items.slice(offset, offset + PAGE_SIZE).map((item, index) => {
        const pending = controller.actions[item.id], label = 'queued turn ' + (offset + index + 1);
        const prompt = item.prompt.slice(0, 320);
        return <li key={item.id} data-submission-id={item.id} className="turn-queue-item is-pending">
          <div className="turn-queue-content"><div className="turn-queue-entry-heading"><span>{offset + index + 1}</span><strong>{pending === 'cancel' ? 'Removing…' : pending === 'resume' ? 'Starting…' : 'Queued'}</strong>
            {!pending && <small>{controller.canStart ? 'Ready to start' : 'Next turn'}</small>}</div>
            {prompt && <p>{prompt}{item.prompt.length > prompt.length ? '…' : ''}</p>}
            {!!item.attachmentNames.length && <div className="turn-queue-attachments">{item.attachmentNames.slice(0, 8).map((name, ordinal) => <span key={ordinal}><File size={12} aria-hidden="true" />{name.slice(0, 100)}</span>)}</div>}
          </div>
          <div className="turn-queue-actions">
            {workspaceId && threadId && <button type="button" className="turn-queue-action" aria-label={'Edit ' + label} disabled={disabled || !!pending} aria-haspopup="dialog" onClick={() => {
              if (document.body.dataset.workspaceLocked !== 'true') { setEditingSubmission(item.id); setEditingScope(scopeKey); }
            }}><PencilLine size={15} aria-hidden="true" />Edit</button>}
            {controller.canStart && <button type="button" className="turn-queue-action" aria-label={'Start ' + label} disabled={disabled || !!pending} onClick={() => void act(item.id, 'resume')}>
              {pending === 'resume' ? <LoaderCircle size={15} className="chat-spin" /> : <Play size={15} />}Start
            </button>}
            <button type="button" className="turn-queue-action" aria-label={'Cancel ' + label} disabled={disabled || !!pending} onClick={() => void act(item.id, 'cancel')}>
              {pending === 'cancel' ? <LoaderCircle size={15} className="chat-spin" /> : <X size={15} />}Cancel
            </button>
          </div>
        </li>;
      })}</ol>
      <PageNavigation label="Queued turns" offset={offset} count={Math.min(PAGE_SIZE, controller.items.length - offset)} total={controller.items.length}
        hasPrevious={offset > 0} hasNext={offset < last} disabled={disabled} onPrevious={() => setPage({ scopeKey: currentPage, offset: Math.max(0, offset - PAGE_SIZE) })}
        onNext={() => setPage({ scopeKey: currentPage, offset: Math.min(last, offset + PAGE_SIZE) })} />
      {(controller.hasMore || controller.hasPreviousPage) && <div className="turn-queue-native-pages">
        {controller.hasPreviousPage && <button type="button" className="button ghost" disabled={disabled || controller.paging} onClick={() => void controller.previousPage()}>Previous queued messages</button>}
        {controller.hasMore && <button type="button" className="button ghost" disabled={disabled || controller.paging} onClick={() => void controller.nextPage()}>Next queued messages</button>}
      </div>}
    </div>}
  </section>
    {editingScope === scopeKey && workspaceId && threadId && <RequestDialog open onClose={() => setEditingScope(null)} title="Queued messages" titleId={title + '-editor'}
      description="Edit pending messages or change their order before Codex starts them." className="native-queue-dialog">
      <div className="native-request-body"><NativeQueueEditor workspaceId={workspaceId} threadId={threadId} initialSubmissionId={editingSubmission} onChanged={() => void controller.refresh()} /></div>
      <div className="modal-footer native-request-footer"><button type="button" className="button ghost" onClick={() => setEditingScope(null)}>Close</button></div>
    </RequestDialog>}
  </>;
}
