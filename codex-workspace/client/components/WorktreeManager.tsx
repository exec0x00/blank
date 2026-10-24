import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowLeft, ArrowRight, Check, Folder, GitBranch, Loader2, MoreHorizontal, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { CreatedWorktree, CreateWorktreeInput, ManagedWorktree, ManagedWorktreePage, Workspace } from '../../shared/types';
import { api, json } from '../api';
import Modal from './Modal';
import PageNavigation from './ui/PageNavigation';
import { MeasuredWindow } from './chat/MeasuredWindow';
import { useOperationalPage } from './useOperationalPage';
import { DropdownMenu, SelectMenu, type SelectOption } from './ui/Dropdown';
import './worktree-manager.css';

export interface WorktreeManagerProps {
  workspace: Workspace;
  currentWorkspace: Workspace | null;
  onBack: () => void;
  /** Register the exact response before asking the parent's dirty guard to switch. */
  onWorkspaceReady: (workspace: Workspace) => void;
  /** Only an inactive worktree is removed from the parent's workspace list. */
  onWorkspaceArchived: (workspaceId: string) => void;
  onSelect: (workspace: Workspace) => Promise<boolean>;
  onSelected: () => void;
  onBusyChange: (busy: boolean) => void;
}

type CheckoutMode = 'new' | 'existing' | 'detached';
type Action = 'create' | 'open' | 'switch' | 'archive' | 'remove' | 'finish-remove';
interface Operation { action: Action; id?: string; refreshSourceId?: string; generation: number; controller: AbortController; focus: HTMLElement | null }
interface Removal { worktree: ManagedWorktree; version: string }

const checkoutOptions: readonly SelectOption<CheckoutMode>[] = [
  { value: 'new', label: 'New branch', description: 'Start a separate branch for your changes.' },
  { value: 'existing', label: 'Existing branch', description: 'Use a local branch that is not checked out elsewhere.' },
  { value: 'detached', label: 'Detached checkout', description: 'Inspect a commit without selecting a branch.' },
];
const stateLabels: Record<ManagedWorktree['state'], string> = { ready: 'Ready', archived: 'Archived', recovery: 'Needs attention', missing: 'Missing files' };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The worktree could not be updated.';
const sessionLocked = () => document.body.dataset.workspaceLocked === 'true';
const collection = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/worktrees`;
const itemPath = (workspaceId: string, id: string) => `${collection(workspaceId)}/${encodeURIComponent(id)}`;

function version(worktree: ManagedWorktree): string {
  return JSON.stringify([worktree.id, worktree.workspaceId, worktree.name, worktree.path, worktree.updatedAt, worktree.state, worktree.removalPending === true, worktree.branch, worktree.head, worktree.dirty, worktree.locked, worktree.issue]);
}

/** All records and mutations come from the managed Git worktree API. */
export default function WorktreeManager(props: WorktreeManagerProps) {
  const latest = useRef(props);
  latest.current = props;
  const { workspace, currentWorkspace } = props;
  const activeWorkspaceId = currentWorkspace?.id ?? null;
  const repositoryId = workspace.worktree?.repositoryWorkspaceId || workspace.id;
  const uid = useId();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Operation | null>(null);
  const pendingRef = useRef<Operation | null>(null);
  const [locked, setLocked] = useState(sessionLocked);
  const listing = useOperationalPage<ManagedWorktree, ManagedWorktreePage>(`${collection(repositoryId)}/page?sourceWorkspaceId=${encodeURIComponent(workspace.id)}`, !locked && !pending);
  const listingRef = useRef(listing); listingRef.current = listing;
  const records = listing.page?.items ?? null;
  const recordsRef = useRef(records); recordsRef.current = records;
  const loading = listing.loading;
  const loadingRef = listing.loadingRef;
  const loadError = listing.error;
  const primary = listing.page?.repository;
  const primaryActive = !!primary && !!listing.page?.sources.some(source => source.id === primary.id);
  const list = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<CheckoutMode>('new');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState('');
  const [removal, setRemoval] = useState<Removal | null>(null);
  const removalRef = useRef<Removal | null>(null);
  removalRef.current = removal;
  const mounted = useRef(false);
  const generation = useRef(0);
  const actionNumber = useRef(0);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);

  // The chosen checkout supplies HEAD for creation. Destructive actions use
  // another live checkout as their route source, preferably the primary one.
  const sourceFor = useCallback((exclude?: string): Workspace | undefined => {
    const current = latest.current;
    const rootId = current.workspace.worktree?.repositoryWorkspaceId || current.workspace.id;
    const family = (listingRef.current.pageRef.current?.sources ?? []).filter(candidate => candidate.id === rootId || candidate.worktree?.repositoryWorkspaceId === rootId);
    const order = exclude
      ? [rootId, current.currentWorkspace?.id, current.workspace.id]
      : [current.workspace.id, rootId, current.currentWorkspace?.id];
    for (const id of order) {
      const candidate = family.find(member => member.id === id && member.id !== exclude);
      if (candidate) return candidate;
    }
    return family.find(member => member.id !== exclude);
  }, []);

  const valid = useCallback((operation: Operation) => mounted.current && generation.current === operation.generation && pendingRef.current === operation && !sessionLocked(), []);

  const replaceRecords = useCallback((next: ManagedWorktree[]) => {
    recordsRef.current = next;
    listingRef.current.replaceItems(() => next);
  }, []);

  useEffect(() => {
    const confirmation = removalRef.current;
    if (confirmation && records && !records.some(item => item.id === confirmation.worktree.id && version(item) === confirmation.version)) {
      removalRef.current = null; setRemoval(null);
      setNotice('This checkout changed. Review its current state before removing it.');
    }
  }, [records]);

  const refresh = useCallback(async (_sourceOverride?: string) => {
    if (!mounted.current || sessionLocked() || pendingRef.current) return;
    await listingRef.current.refresh();
  }, []);

  useEffect(() => {
    mounted.current = true;
    recordsRef.current = null;
    setPending(null); setError(''); setNotice('');
    setCreating(false); setName(''); setBranch(''); setBase(''); setMode('new');
    setRemoval(null); removalRef.current = null;
    const stop = () => {
      generation.current++;
      listingRef.current.cancel();
      pendingRef.current?.controller.abort();
      pendingRef.current = null;
      loadingRef.current = false;
      latest.current.onBusyChange(false);
    };
    const lock = () => {
      stop(); setPending(null); setLocked(true);
      setRemoval(null); removalRef.current = null;
    };
    const unlock = () => { setLocked(false); };
    const recheck = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-expired', lock);
    window.addEventListener('codex:session-unlocked', unlock);
    window.addEventListener('online', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      mounted.current = false; stop();
      window.removeEventListener('codex:session-locked', lock);
      window.removeEventListener('codex:session-expired', lock);
      window.removeEventListener('codex:session-unlocked', unlock);
      window.removeEventListener('online', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [workspace.id, refresh]);

  // The enclosing modal stays mounted while its contents change.
  useEffect(() => { backButton.current?.focus({ preventScroll: true }); }, []);

  const run = async (action: Action, execute: (operation: Operation) => Promise<void>, id?: string, refreshSourceId?: string) => {
    if (!mounted.current || sessionLocked() || pendingRef.current || loadingRef.current) return;
    const operation: Operation = { action, id, refreshSourceId, generation: generation.current, controller: new AbortController(), focus: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    const actionScope = ++actionNumber.current;
    pendingRef.current = operation; setPending(operation);
    latest.current.onBusyChange(true); setError(''); setNotice('');
    try { await execute(operation); }
    catch (failure) { if (valid(operation)) setError(errorMessage(failure)); }
    finally {
      if (pendingRef.current === operation) {
        const refreshed = listingRef.current.refreshAfterPause();
        pendingRef.current = null;
        if (mounted.current) {
          setPending(null); latest.current.onBusyChange(false);
          // Recheck after success and failure; a response can be lost after the
          // server has completed an operation. Never invent a successful result.
          const restoreFocus = () => requestAnimationFrame(() => {
            const focused = document.activeElement;
            const parentDialog = backButton.current?.closest('[role="dialog"]');
            // A closed nested dialog can leave its parent root focused while
            // the list refreshes. Preserve any control the user chose instead.
            if (!mounted.current || operation.generation !== generation.current || actionScope !== actionNumber.current || pendingRef.current || sessionLocked() || listingRef.current.loadingRef.current
              || focused !== document.body && focused !== parentDialog) return;
            const previous = operation.focus;
            (previous?.isConnected && !previous.matches(':disabled') ? previous : backButton.current)?.focus({ preventScroll: true });
          });
          // Resuming the read hook refreshes the current page without replaying
          // this mutation, including when its response was lost.
          void refreshed.finally(restoreFocus);
        }
      }
    }
  };

  const select = async (next: Workspace, operation: Operation, message: string) => {
    if (!valid(operation)) return;
    latest.current.onWorkspaceReady(next); setNotice(message);
    try {
      const selected = await latest.current.onSelect(next);
      if (!valid(operation)) return;
      if (selected) latest.current.onSelected();
      else setNotice(`${message} Your current workspace is still open. Switch when you are ready.`);
    } catch (failure) {
      if (valid(operation)) setError(`${message} Switching failed: ${errorMessage(failure)}`);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (mode !== 'detached' && !branch.trim()) return;
    const source = sourceFor();
    if (!source) { setError('Open a workspace in this repository before creating another checkout.'); return; }
    const input: CreateWorktreeInput = {
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(mode !== 'detached' ? { branch: branch.trim() } : {}),
      ...(mode === 'new' ? { createBranch: true } : {}),
      ...(mode !== 'existing' && base.trim() ? { base: base.trim() } : {}),
    };
    void run('create', async operation => {
      const created = await api<CreatedWorktree>(collection(source.id), { ...json('POST', input), signal: operation.controller.signal });
      if (!valid(operation)) return;
      setCreating(false); setName(''); setBranch(''); setBase('');
      await select(created.workspace, operation, `${created.workspace.name} was created.`);
    }, undefined, source.id);
  };

  const open = (worktree: ManagedWorktree) => {
    const current = recordsRef.current?.find(item => item.id === worktree.id);
    if (!current || current.removalPending === true || worktree.removalPending === true) return;
    const sourceId = repositoryId;
    void run('open', async operation => {
      const opened = await api<Workspace>(`${itemPath(sourceId, worktree.id)}/open`, { ...json('POST', {}), signal: operation.controller.signal });
      if (!valid(operation)) return;
      if (opened.id !== worktree.workspaceId) throw new Error('The returned workspace does not match this checkout. Refresh the worktree list.');
      await select(opened, operation, `${opened.name} is ready.`);
    }, worktree.id, sourceId);
  };

  const archive = (worktree: ManagedWorktree) => {
    const current = recordsRef.current?.find(item => item.id === worktree.id);
    if (!current || current.removalPending === true || worktree.removalPending === true) return;
    if (worktree.workspaceId === latest.current.currentWorkspace?.id) return;
    const source = sourceFor(worktree.workspaceId);
    if (!source) { setError('Keep another workspace in this repository open before archiving this checkout.'); return; }
    void run('archive', async operation => {
      const archived = await api<ManagedWorktree>(`${itemPath(source.id, worktree.id)}/archive`, { ...json('POST', {}), signal: operation.controller.signal });
      if (!valid(operation)) return;
      replaceRecords((recordsRef.current || []).map(item => item.id === archived.id ? { ...item, ...archived } : item));
      if (latest.current.currentWorkspace?.id !== archived.workspaceId) latest.current.onWorkspaceArchived(archived.workspaceId);
      setNotice(`${archived.name} was archived. Its files and conversations are preserved.`);
    }, worktree.id, source.id);
  };

  const remove = () => {
    const confirmation = removalRef.current;
    if (!confirmation) return;
    const current = recordsRef.current?.find(item => item.id === confirmation.worktree.id);
    if (!current || version(current) !== confirmation.version) {
      setRemoval(null); removalRef.current = null;
      setNotice('This checkout changed. Review its current state before removing it.'); return;
    }
    if (current.workspaceId === latest.current.currentWorkspace?.id) { setError('Switch to another workspace before removing this checkout.'); return; }
    const source = sourceFor(current.workspaceId);
    if (!source) { setError('Open another workspace in this repository before removing this checkout.'); return; }
    void run(current.removalPending === true ? 'finish-remove' : 'remove', async operation => {
      const result = await api<{ removed: true; workspaceId: string }>(itemPath(source.id, current.id), { ...json('DELETE'), signal: operation.controller.signal });
      if (!valid(operation)) return;
      if (result.removed !== true || result.workspaceId !== current.workspaceId) throw new Error('Removal could not be confirmed. Refresh the worktree list.');
      setRemoval(null); removalRef.current = null;
      replaceRecords((recordsRef.current || []).filter(item => item.id !== current.id));
      if (latest.current.currentWorkspace?.id !== result.workspaceId) latest.current.onWorkspaceArchived(result.workspaceId);
      setNotice(current.removalPending === true ? `${current.name} removal is complete. Its Git branches are preserved.` : `${current.name} was removed. Its Git branches are preserved.`);
    }, current.id, source.id);
  };

  const removalReason = (worktree: ManagedWorktree) => {
    if (worktree.workspaceId === activeWorkspaceId) return 'Switch to another workspace first.';
    if (!sourceFor(worktree.workspaceId)) return 'Open another checkout in this repository first.';
    // The durable receipt proves native removal already finished. Its retry
    // needs server cleanup checks, not status from a checkout that is gone.
    if (worktree.removalPending === true) return '';
    if (worktree.locked) return 'This checkout is locked in Git.';
    if (worktree.dirty) return 'This checkout has local or ignored files.';
    if (worktree.state === 'missing' || worktree.state === 'recovery') return 'Resolve the checkout problem first.';
    if (worktree.dirty !== false || worktree.locked !== false) return 'Refresh to check this checkout’s files and lock.';
    return '';
  };

  const reviewRemoval = (worktree: ManagedWorktree) => {
    if (pendingRef.current || loadingRef.current || sessionLocked()) return;
    const current = recordsRef.current?.find(item => item.id === worktree.id);
    if (!current || version(current) !== version(worktree) || removalReason(current)) return;
    setError(''); const next = { worktree: current, version: version(current) };
    removalRef.current = next; setRemoval(next);
  };

  const busy = locked || !!pending || loading;
  const disabled = busy || !!loadError;
  const creationSource = sourceFor();
  const cancelCreate = () => { setCreating(false); setError(''); requestAnimationFrame(() => createTrigger.current?.focus()); };
  const closeRemoval = () => { if (!pendingRef.current) { setRemoval(null); removalRef.current = null; setError(''); } };
  const status = pending ? ({ create: 'Creating worktree…', open: 'Opening worktree…', switch: 'Switching workspace…', archive: 'Archiving worktree…', remove: 'Removing worktree…', 'finish-remove': 'Finishing removal…' } as const)[pending.action] : notice;
  const finishingRemoval = removal?.worktree.removalPending === true;
  const removing = pending?.action === 'remove' || pending?.action === 'finish-remove';

  return <section className="worktree-manager" aria-label={`Worktrees for ${workspace.name}`} aria-busy={!!pending || loading}>
    <div className="worktree-navigation"><button ref={backButton} type="button" className="button ghost" onClick={props.onBack} disabled={!!pending || locked}><ArrowLeft size={15} />All workspaces</button><button type="button" className="icon-button" aria-label="Refresh worktrees" title="Refresh worktrees" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div>
    <div className="worktree-introduction"><h3>Worktrees</h3><p>Separate checkouts for <strong>{primary?.name || workspace.name}</strong>, with shared Git history and their own files and conversations.</p></div>
    {primary && <div className="worktree-primary"><span className="worktree-primary-icon"><Folder size={18} /></span><div><strong>{primary.name}</strong><span>{primaryActive ? 'Main checkout' : 'Main checkout · Archived'}</span></div>{primary.id === activeWorkspaceId ? <span className="worktree-current"><Check size={13} />Current</span> : <button className="button ghost" type="button" disabled={disabled || !primaryActive} onClick={() => void run('switch', async operation => { const selected = await latest.current.onSelect(primary); if (valid(operation) && selected) latest.current.onSelected(); })}>Open<ArrowRight size={14} /></button>}</div>}
    <label className="worktree-search"><Search size={15} /><input type="search" value={listing.query} onChange={event => { setRemoval(null); removalRef.current = null; listing.changeQuery(event.target.value); }} aria-label="Search worktrees" placeholder="Search worktrees" maxLength={160} disabled={!!pending || locked} /></label>
    {loading && <p className="worktree-loading" role="status"><Loader2 size={15} className="spin" />{records ? 'Checking worktrees…' : 'Loading worktrees…'}</p>}
    {loadError && <div className="worktree-error" role="alert"><p>{loadError}</p><button type="button" className="button ghost" onClick={() => void refresh()} disabled={busy}>Try again</button></div>}
    {records && <div ref={list} className="worktree-list" role="list" tabIndex={0} aria-label="Repository worktrees">
      <MeasuredWindow items={records} itemKey={worktree => worktree.id} estimateHeight={() => 188} scrollRef={list} resetKey={listing.resetKey} overscan={280} renderItem={(worktree, index) => {
        const current = worktree.workspaceId === activeWorkspaceId;
        const removeReason = removalReason(worktree);
        const otherSource = sourceFor(worktree.workspaceId);
        const isOpening = pending?.action === 'open' && pending.id === worktree.id;
        const removalPending = worktree.removalPending === true;
        return <div className={`worktree-item${current ? ' is-current' : ''}`} role="listitem" aria-posinset={(listing.page?.offset ?? 0) + index + 1} aria-setsize={listing.page?.total} key={worktree.id} data-worktree-id={worktree.id}>
          <div className="worktree-item-heading"><GitBranch size={17} /><strong className="text-ellipsis" title={worktree.name}>{worktree.name}</strong>{current && <span className="worktree-current"><Check size={13} />Current</span>}</div>
          <div className="worktree-item-details">{!removalPending && <span className="worktree-branch" title={worktree.branch || worktree.head}>{worktree.branch || (worktree.head ? `Detached · ${worktree.head.slice(0, 8)}` : 'Branch unavailable')}</span>}<span className="worktree-state">{removalPending ? 'Removal pending' : stateLabels[worktree.state]}</span>{!removalPending && worktree.dirty !== undefined && <span>{worktree.dirty ? 'Local files' : 'Clean'}</span>}{!removalPending && worktree.locked && <span>Locked</span>}</div>
          <p className="worktree-path text-ellipsis" title={worktree.path}>{worktree.path}</p>
          {worktree.issue && <p className="worktree-issue">{worktree.issue}</p>}
          <div className="worktree-item-actions"><span className="worktree-action-note">{removalPending ? 'The original checkout has been removed.' : current ? 'Switch workspaces before archiving or removing.' : worktree.state === 'archived' ? 'Reopening restores the same workspace and conversations.' : ''}</span>{removalPending
            ? <button type="button" className="button" disabled={disabled || !!removeReason} title={removeReason || undefined} onClick={() => reviewRemoval(worktree)} aria-label={`Finish removal of ${worktree.name}`}><RefreshCw size={14} />Finish removal</button>
            : <button type="button" className="button" disabled={disabled || current && worktree.state === 'ready' || worktree.state === 'missing'} onClick={() => open(worktree)} aria-label={`${worktree.state === 'archived' ? 'Reopen' : worktree.state === 'recovery' ? 'Recover' : 'Open'} ${worktree.name}`}>{isOpening ? <Loader2 size={14} className="spin" /> : <ArrowRight size={14} />}{worktree.state === 'archived' ? 'Reopen' : worktree.state === 'recovery' ? 'Recover' : 'Open'}</button>}<DropdownMenu aria-label={`Worktree actions for ${worktree.name}`} trigger={<button type="button" className="icon-button cw-menu-trigger" disabled={disabled} aria-label={`Actions for worktree ${worktree.name}`}><MoreHorizontal size={17} /></button>} items={[
            { id: 'archive', label: 'Archive worktree', icon: <Archive size={15} />, description: removalPending ? 'The checkout has already been removed.' : current ? 'Switch to another workspace first.' : !otherSource ? 'Keep another checkout in this repository open.' : 'Hide this workspace and keep its files and conversations.', disabled: removalPending || current || !otherSource || worktree.state !== 'ready', onSelect: () => archive(worktree) },
            { type: 'separator', id: 'remove-separator' },
            { id: 'remove', label: removalPending ? 'Finish removal' : 'Remove worktree', icon: removalPending ? <RefreshCw size={15} /> : <Trash2 size={15} />, danger: true, description: removeReason || (removalPending ? 'Complete the remaining cleanup for this removed checkout.' : 'Permanently delete this clean checkout’s files.'), disabled: !!removeReason, onSelect: () => reviewRemoval(worktree) },
          ]} /></div>
        </div>;
      }} />
      {records.length === 0 && !loading && !loadError && <p className="worktree-empty">{(listing.page?.offset ?? 0) > 0 || (listing.page?.total ?? 0) > 0 ? 'This page is empty. Choose Previous or refresh the list.' : listing.query.trim() ? 'No worktrees match this search.' : 'No worktrees yet. Create another checkout to work on this project separately.'}</p>}
    </div>}
    <PageNavigation label="Worktrees" offset={listing.page?.offset ?? 0} count={records?.length ?? 0} total={listing.page?.total} hasPrevious={(listing.page?.offset ?? 0) > 0} hasNext={listing.page?.hasMore ?? false} loading={loading} disabled={!!pending || locked} onPrevious={listing.previous} onNext={listing.next} />
    {creating ? <form className="worktree-create" onSubmit={create} aria-label="Create worktree">
      <div className="worktree-field"><label htmlFor={`${uid}-mode`}>Checkout</label><SelectMenu<CheckoutMode> id={`${uid}-mode`} value={mode} onValueChange={value => { setMode(value); setError(''); }} options={checkoutOptions} aria-label="Checkout type" disabled={disabled} /></div>
      {mode !== 'detached' && <div className="worktree-field"><label htmlFor={`${uid}-branch`}>{mode === 'new' ? 'New branch name' : 'Existing branch name'}</label><input id={`${uid}-branch`} className="input" value={branch} onChange={event => setBranch(event.target.value)} placeholder={mode === 'new' ? 'feature/my-task' : 'release'} autoFocus autoComplete="off" spellCheck={false} maxLength={255} disabled={disabled} required /></div>}
      {mode !== 'existing' && <div className="worktree-field"><label htmlFor={`${uid}-base`}>Start from <span>optional</span></label><input id={`${uid}-base`} className="input" value={base} onChange={event => setBase(event.target.value)} placeholder="Current commit (HEAD)" autoComplete="off" spellCheck={false} maxLength={255} disabled={disabled} aria-describedby={`${uid}-base-help`} /><p id={`${uid}-base-help`}>A branch, tag, or commit. Defaults to the current commit in {creationSource?.name || workspace.name}.</p></div>}
      <div className="worktree-field"><label htmlFor={`${uid}-name`}>Workspace name <span>optional</span></label><input id={`${uid}-name`} className="input" value={name} onChange={event => setName(event.target.value)} placeholder="Use the branch or checkout name" autoComplete="off" maxLength={100} disabled={disabled} /></div>
      {mode === 'detached' && <p className="worktree-form-note">This checkout has no branch. Create a branch before keeping new commits.</p>}
      <div className="worktree-form-actions"><button type="button" className="button ghost" onClick={cancelCreate} disabled={!!pending || locked}>Cancel</button><button type="submit" className="button primary" disabled={disabled || !creationSource || mode !== 'detached' && !branch.trim()}>{pending?.action === 'create' ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}Create worktree</button></div>
    </form> : <button ref={createTrigger} type="button" className="worktree-new button" onClick={() => { setCreating(true); setError(''); setNotice(''); }} disabled={disabled || !creationSource}><Plus size={16} />New worktree</button>}
    {!removal && error && <p className="worktree-error" role="alert">{error}</p>}
    <p className="worktree-feedback" role="status" aria-live="polite">{status}</p>
    <Modal open={!!removal} onClose={closeRemoval} title={`${finishingRemoval ? 'Finish removing' : 'Remove'} ${removal?.worktree.name || 'worktree'}?`} titleId={`${uid}-remove-title`} description={finishingRemoval ? 'The checkout was already removed. Complete the remaining cleanup and removal confirmation.' : 'This permanently deletes the checkout and its files. Git branches are kept.'} className="worktree-remove-dialog">
      <div className="worktree-remove-body"><p>{finishingRemoval ? 'This retries the existing removal. Any remaining snapshots and backups for this worktree will be permanently removed after the server verifies the removal. Git branches are kept.' : 'Only a clean, idle checkout can be removed. Local or ignored files, active work, Git locks, and commits without a saved branch block removal.'}</p><p className="worktree-remove-path">{removal?.worktree.path}</p>{error && <p className="worktree-error" role="alert">{error}</p>}{removing && <p role="status" className="worktree-loading"><Loader2 size={15} className="spin" />{finishingRemoval ? 'Finishing removal…' : 'Removing worktree…'}</p>}</div>
      <div className="modal-footer"><button type="button" className="button ghost" data-autofocus onClick={closeRemoval} disabled={!!pending}>Cancel</button><button type="button" className="button danger" disabled={disabled || !removal || !!(removal && removalReason(removal.worktree))} onClick={remove}>{removing ? <Loader2 size={15} className="spin" /> : finishingRemoval ? <RefreshCw size={15} /> : <Trash2 size={15} />}{finishingRemoval ? 'Finish removal' : 'Remove worktree'}</button></div>
    </Modal>
  </section>;
}
