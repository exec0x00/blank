import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Folder, FolderPlus, GitBranch, Github, Loader2, MoreHorizontal, Pencil, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { Workspace, WorkspaceDeletionPlan, WorkspacePage } from '../../shared/types';
import { ApiError, api } from '../api';
import { WORKSPACE_PAGE_SIZE } from '../workspace-selection';
import Modal from './Modal';
import WorktreeManager from './WorktreeManager';
import WorkspaceTrash from './WorkspaceTrash';
import { DropdownMenu } from './ui/Dropdown';
import './workspace-switcher.css';

interface Props {
  open: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  workspacePage?: Omit<WorkspacePage, 'workspaces' | 'selected'>;
  currentWorkspace: Workspace | null;
  activeWorkspaceId: string | null;
  onSelect: (workspace: Workspace) => Promise<boolean>;
  onCreate: (name: string, initializeGit: boolean) => Promise<void | boolean>;
  onRename: (workspace: Workspace, name: string) => Promise<void>;
  onDelete: (workspace: Workspace, plan: WorkspaceDeletionPlan) => Promise<boolean>;
  onImport: () => void;
  onWorkspaceRestored: (workspace: Workspace) => void;
  onWorkspaceDeletionCompleted?: () => void;
  initialSection?: 'workspaces' | 'trash';
  refreshing?: boolean;
  listError?: string;
  onRefresh?: () => void | Promise<void>;
  onWorktreeWorkspaceReady?: (workspace: Workspace) => void;
  onWorktreeWorkspaceArchived?: (workspaceId: string) => void;
}

interface PageView { page: WorkspacePage; query: string; cursor?: string }
interface PageRequest { query: string; cursor?: string; refresh?: boolean }
const initialPage = (workspaces: Workspace[], metadata?: Props['workspacePage']): PageView => ({
  page: { offset: 0, nextCursor: null, previousCursor: null, ...metadata, workspaces: workspaces.slice(0, WORKSPACE_PAGE_SIZE) }, query: '',
});

export default function WorkspaceSwitcher({ open, onClose, workspaces, workspacePage, currentWorkspace, activeWorkspaceId, onSelect, onCreate, onRename, onDelete, onImport, onWorkspaceRestored, onWorkspaceDeletionCompleted, initialSection = 'workspaces', refreshing = false, listError, onRefresh, onWorktreeWorkspaceReady, onWorktreeWorkspaceArchived }: Props) {
  const [query, setQuery] = useState('');
  const queryRef = useRef(query);
  queryRef.current = query;
  const [pageView, setPageView] = useState<PageView>(() => initialPage(workspaces, workspacePage));
  const pageViewRef = useRef(pageView);
  pageViewRef.current = pageView;
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [pageNotice, setPageNotice] = useState('');
  const pageRead = useRef<AbortController | null>(null);
  const pageReadNumber = useRef(0);
  const pageRequest = useRef<PageRequest>({ query: '' });
  const listRef = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const listScrollTop = useRef(0);
  const hasOpened = useRef(false);
  const [creating, setCreating] = useState(false);
  const createButton = useRef<HTMLButtonElement>(null);
  const createNameInput = useRef<HTMLInputElement>(null);
  const deletionConfirmation = useRef<HTMLDivElement>(null);
  const deletionTrigger = useRef<HTMLButtonElement | null>(null);
  const [name, setName] = useState('');
  const [initializeGit, setInitializeGit] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [trashing, setTrashing] = useState<string | null>(null);
  const [deletionPlan, setDeletionPlan] = useState<WorkspaceDeletionPlan | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [worktreeWorkspace, setWorktreeWorkspace] = useState<Workspace | null>(null);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const busyRef = useRef(false);
  const operationRead = useRef<AbortController | null>(null);
  const worktreeBusyRef = useRef(false);
  const generation = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const currentWorktreesButton = useRef<HTMLButtonElement>(null);
  const trashButton = useRef<HTMLButtonElement>(null);
  const activeWorkspace = currentWorkspace?.id === activeWorkspaceId ? currentWorkspace : null;
  const canManageWorktrees = !!onWorktreeWorkspaceReady && !!onWorktreeWorkspaceArchived;
  const stopPageRead = useCallback(() => { pageReadNumber.current++; pageRead.current?.abort(); pageRead.current = null; setPageLoading(false); }, []);
  const loadPage = useCallback(async (input: PageRequest, focus = false) => {
    if (!openRef.current || busyRef.current || worktreeBusyRef.current || document.body.dataset.workspaceLocked === 'true') return;
    pageRead.current?.abort();
    const controller = new AbortController();
    pageRead.current = controller;
    const request = ++pageReadNumber.current;
    const scope = generation.current;
    const current = () => !controller.signal.aborted && scope === generation.current && request === pageReadNumber.current
      && openRef.current && document.body.dataset.workspaceLocked !== 'true' && queryRef.current.trim() === input.query;
    pageRequest.current = input;
    setPageLoading(true); setPageError(''); setPageNotice('');
    let cursor = input.cursor;
    const read = (refresh = false) => {
      const parameters = new URLSearchParams({ limit: String(WORKSPACE_PAGE_SIZE), query: input.query });
      if (cursor) parameters.set('cursor', cursor);
      if (refresh) parameters.set('refresh', '1');
      return api<WorkspacePage>(`/workspaces?${parameters}`, { signal: controller.signal });
    };
    try {
      let page: WorkspacePage;
      try { page = await read(input.refresh); }
      catch (failure) {
        if (!current() || !(failure instanceof ApiError) || failure.code !== 'WORKSPACE_LIST_CHANGED' || !cursor) throw failure;
        cursor = undefined;
        page = await read();
        if (current()) setPageNotice('The workspace list changed. Showing its first page.');
      }
      if (!current()) return;
      const next = { page, query: input.query, cursor };
      pageViewRef.current = next; setPageView(next);
      pageRequest.current = { query: input.query, cursor };
      requestAnimationFrame(() => {
        if (!current() || !listRef.current) return;
        listRef.current.scrollTop = listScrollTop.current;
        if (focus) listRef.current.focus({ preventScroll: true });
      });
    } catch (failure) {
      if (current()) setPageError(failure instanceof Error ? failure.message : 'The workspace page could not be loaded. Try again.');
    } finally {
      if (scope === generation.current && request === pageReadNumber.current) { pageRead.current = null; setPageLoading(false); }
    }
  }, []);

  useEffect(() => {
    generation.current++; stopPageRead(); operationRead.current?.abort(); operationRead.current = null; busyRef.current = false; setBusy(false);
    worktreeBusyRef.current = false; setWorktreeBusy(false);
    if (open) {
      if (!hasOpened.current) {
        hasOpened.current = true;
        setQuery(''); queryRef.current = ''; setPageView(initialPage(workspaces, workspacePage));
      }
      setPageError(''); setPageNotice('');
      setCreating(false); setName(''); setRenaming(null); setTrashing(null); setDeletionPlan(null); setError(''); setWorktreeWorkspace(null); setTrashOpen(initialSection === 'trash');
    }
  }, [open, initialSection, stopPageRead]);
  useEffect(() => {
    if (!open || trashOpen || worktreeWorkspace) { stopPageRead(); return; }
    const text = query.trim();
    const cursor = text === pageViewRef.current.query ? pageViewRef.current.cursor : undefined;
    const timer = window.setTimeout(() => void loadPage({ query: text, cursor }), text === pageViewRef.current.query ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [open, query, trashOpen, worktreeWorkspace?.id, loadPage, stopPageRead]);
  const latestSeed = useRef({ workspaces, workspacePage });
  useEffect(() => {
    const previous = latestSeed.current;
    latestSeed.current = { workspaces, workspacePage };
    if (previous.workspaces === workspaces && previous.workspacePage === workspacePage) return;
    if (!open || trashOpen || worktreeWorkspace || busyRef.current || worktreeBusyRef.current || query.trim() !== pageViewRef.current.query) return;
    void loadPage({ query: query.trim(), cursor: pageViewRef.current.cursor });
  }, [workspaces, workspacePage, open, trashOpen, worktreeWorkspace?.id, query, loadPage]);
  useEffect(() => {
    const lock = () => { generation.current++; stopPageRead(); operationRead.current?.abort(); operationRead.current = null; busyRef.current = false; setBusy(false); worktreeBusyRef.current = false; setWorktreeBusy(false); };
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-expired', lock);
    return () => { generation.current++; pageRead.current?.abort(); operationRead.current?.abort(); window.removeEventListener('codex:session-locked', lock); window.removeEventListener('codex:session-expired', lock); };
  }, [stopPageRead]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (searchInput.current?.offsetParent) searchInput.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (!open || !creating) return;
    const frame = requestAnimationFrame(() => createNameInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, creating]);
  useEffect(() => {
    if (!open || !trashing || creating) return;
    const frame = requestAnimationFrame(() => {
      deletionConfirmation.current?.scrollIntoView({ block: 'nearest' });
      if (!busy) deletionConfirmation.current?.querySelector<HTMLButtonElement>('[data-delete-cancel]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, trashing, creating, busy]);
  const onWorktreeBusy = useCallback((value: boolean) => { worktreeBusyRef.current = value; setWorktreeBusy(value); }, []);
  const perform = async <T,>(action: (signal: AbortSignal) => Promise<T>, close = false, onSuccess?: (result: T) => void, mutation = true) => {
    if (busyRef.current || worktreeBusyRef.current || !openRef.current || document.body.dataset.workspaceLocked === 'true') return;
    busyRef.current = true;
    stopPageRead();
    const controller = new AbortController(); operationRead.current = controller;
    const scope = generation.current;
    const current = () => !controller.signal.aborted && scope === generation.current && openRef.current && document.body.dataset.workspaceLocked !== 'true';
    setBusy(true); setError('');
    let closed = false;
    try { const result = await action(controller.signal); if (current() && result !== false) { onSuccess?.(result); if (close) { closed = true; onClose(); } } }
    catch (failure) { if (current()) { if (failure instanceof ApiError && failure.code === 'WORKSPACE_DELETION_CHANGED') setDeletionPlan(null); setError(failure instanceof Error ? failure.message : 'The workspace could not be updated.'); } }
    finally { if (operationRead.current === controller) operationRead.current = null; if (scope === generation.current) { busyRef.current = false; setBusy(false); if (!closed && mutation && current()) void loadPage({ query: queryRef.current.trim() }); } }
  };
  const create = (event: FormEvent) => { event.preventDefault(); if (name.trim()) void perform(() => onCreate(name.trim(), initializeGit), true); };
  const rename = (event: FormEvent, workspace: Workspace) => { event.preventDefault(); if (renameValue.trim()) void perform(() => onRename(workspace, renameValue.trim()), false, () => setRenaming(null)); };
  const checkDeletion = (workspace: Workspace) => {
    setTrashing(workspace.id); setDeletionPlan(null); setRenaming(null);
    void perform(signal => api<WorkspaceDeletionPlan>(`/workspaces/${encodeURIComponent(workspace.id)}/deletion`, { signal }), false, plan => {
      if (plan.workspaceId !== workspace.id || !['trash', 'permanent'].includes(plan.mode) || (plan.mode === 'trash' ? plan.retentionDays !== 30 : plan.retentionDays !== null)) throw new Error('The deletion options could not be verified. Try again.');
      setDeletionPlan(plan);
    }, false);
  };
  const { page } = pageView;
  const pendingQuery = query.trim() !== pageView.query;
  const reading = pageLoading || pendingQuery && !pageError;
  const searchText = query.trim().toLowerCase();
  const pinned = activeWorkspace && (!searchText || activeWorkspace.name.toLowerCase().includes(searchText) || activeWorkspace.path.toLowerCase().includes(searchText))
    && !page.workspaces.some(item => item.id === activeWorkspace.id) ? activeWorkspace : null;
  const filtered = pinned ? [pinned, ...page.workspaces] : page.workspaces;
  const changePage = (cursor: string | null) => {
    if (!cursor || busy || reading) return;
    setRenaming(null); setTrashing(null); setDeletionPlan(null); setError(''); listScrollTop.current = 0;
    void loadPage({ query: pageView.query, cursor }, true);
  };
  const refresh = () => { void onRefresh?.(); void loadPage({ query: queryRef.current.trim(), cursor: pageViewRef.current.query === queryRef.current.trim() ? pageViewRef.current.cursor : undefined, refresh: true }); };
  const manageWorktrees = (workspace: Workspace) => { setWorktreeWorkspace(workspace); setCreating(false); setRenaming(null); setTrashing(null); setError(''); };
  const backToWorkspaces = () => { if (worktreeBusyRef.current) return; setWorktreeWorkspace(null); requestAnimationFrame(() => currentWorktreesButton.current?.focus()); };
  const backFromTrash = () => { if (worktreeBusyRef.current) return; setTrashOpen(false); onRefresh?.(); requestAnimationFrame(() => trashButton.current?.focus()); };
  const startCreating = () => { setCreating(true); setRenaming(null); setTrashing(null); setDeletionPlan(null); setError(''); };
  const backFromCreate = () => {
    if (busyRef.current) return;
    setCreating(false); setError('');
    requestAnimationFrame(() => createButton.current?.focus({ preventScroll: true }));
  };
  const cancelDeletion = () => {
    if (busyRef.current) return;
    setTrashing(null); setDeletionPlan(null); setError('');
    requestAnimationFrame(() => deletionTrigger.current?.focus({ preventScroll: true }));
  };
  const close = () => {
    if (busyRef.current || worktreeBusyRef.current) return;
    if (creating) backFromCreate();
    else onClose();
  };


  return <Modal open={open} onClose={close}
    title={trashOpen ? 'Workspace trash' : creating ? 'Create workspace' : 'Your workspaces'} titleId="workspace-dialog-title"
    description={trashOpen ? 'Restore saved workspaces and review permanent deletions.' : worktreeWorkspace ? 'Manage checkouts for this repository.' : creating ? 'Set up a home for your next project.' : 'Create a project or pick up where you left off.'}
    className="workspace-dialog">
    <div className={`workspace-dialog-body${!trashOpen && !worktreeWorkspace ? ' workspace-manager-body' : ''}${creating ? ' is-creating' : ''}`}>
      {trashOpen ? <WorkspaceTrash onBack={backFromTrash} onRestored={onWorkspaceRestored} onBusyChange={onWorktreeBusy} onDeletionCompleted={onWorkspaceDeletionCompleted || onRefresh} />
        : worktreeWorkspace && onWorktreeWorkspaceReady && onWorktreeWorkspaceArchived
          ? <WorktreeManager key={worktreeWorkspace.id} workspace={currentWorkspace?.id === worktreeWorkspace.id ? currentWorkspace : page.workspaces.find(workspace => workspace.id === worktreeWorkspace.id) || worktreeWorkspace} currentWorkspace={currentWorkspace} onBack={backToWorkspaces} onWorkspaceReady={onWorktreeWorkspaceReady} onWorkspaceArchived={onWorktreeWorkspaceArchived} onSelect={onSelect} onSelected={onClose} onBusyChange={onWorktreeBusy} />
          : <>
            {/* Keep the selection view mounted while creating so its query, page and scroll survive Back or Escape. */}
            <div className="workspace-picker" hidden={creating}>
              <div className="workspace-manager-actions" role="group" aria-label="Manage workspaces">
                <button ref={createButton} className="button primary workspace-create-action" type="button" onClick={startCreating} disabled={busy}>
                  <FolderPlus size={17} /><span>Create workspace</span>
                </button>
                <div className="workspace-secondary-actions">
                  <button className="button ghost workspace-import-action" type="button" aria-label="Import from GitHub" title="Import from GitHub" onClick={() => { onClose(); onImport(); }} disabled={busy || worktreeBusy}>
                    <Github size={17} /><span>Import</span>
                  </button>
                  {canManageWorktrees && activeWorkspace && <button ref={currentWorktreesButton} className="icon-button" type="button" onClick={() => manageWorktrees(activeWorkspace)} disabled={busy} aria-label={`Manage worktrees for ${activeWorkspace.name}`} title={`Worktrees for ${activeWorkspace.name}`}><GitBranch size={17} /></button>}
                  <button ref={trashButton} className="button ghost workspace-trash-action" type="button" onClick={() => { setTrashOpen(true); setError(''); }} disabled={busy} aria-label="Workspace trash" title="Workspace trash">
                    <Trash2 size={17} /><span>Trash</span>
                  </button>
                </div>
              </div>
              <label className="search-field workspace-search"><Search size={17} /><input ref={searchInput} className="input" placeholder="Search workspaces…" aria-label="Find a workspace" aria-controls="workspace-selection-list" aria-describedby="workspace-search-help" value={query} maxLength={200} disabled={busy}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || busy || reading || !filtered.length) return;
                  if (event.key === 'ArrowDown') { event.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>('.workspace-select')?.focus(); }
                  else if (event.key === 'Enter') { event.preventDefault(); void perform(() => onSelect(filtered[0]), true); }
                }}
                onChange={(event) => { queryRef.current = event.target.value; setQuery(event.target.value); listScrollTop.current = 0; if (listRef.current) listRef.current.scrollTop = 0; stopPageRead(); setPageError(''); setPageNotice(''); setRenaming(null); setTrashing(null); setDeletionPlan(null); }} /></label>
              <span className="sr-only" id="workspace-search-help">Press Enter to open the first result, or Arrow Down to browse workspaces.</span>
              <div className="workspace-list-heading">
                <span role="status">{reading || refreshing ? 'Checking workspaces…' : pageView.query ? 'Search results' : 'All workspaces'}</span>
                <button className="icon-button" type="button" onClick={refresh} disabled={busy || reading || refreshing} aria-label="Refresh workspaces">{reading || refreshing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}</button>
              </div>
              {(pageError || listError) && <div className="workspace-page-error"><p className="form-error" role="alert">{pageError || listError}</p><button className="button small" type="button" disabled={busy || reading} onClick={() => { if (pageError) void loadPage(pageRequest.current); else refresh(); }}>Try again</button></div>}
              {pageNotice && <p className="workspace-page-notice" role="status">{pageNotice}</p>}
              <div ref={listRef} id="workspace-selection-list" className="workspace-list" role="list" aria-label="Workspaces" aria-busy={reading} tabIndex={-1}
                onScroll={event => { listScrollTop.current = event.currentTarget.scrollTop; }}
                onKeyDown={event => {
                  if (busy || reading || event.nativeEvent.isComposing) return;
                  const target = event.target as HTMLElement;
                  if (!target.closest('.workspace-select') && target !== listRef.current) return;
                  const choices = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.workspace-select:not(:disabled)') || []);
                  const current = choices.indexOf(target.closest<HTMLButtonElement>('.workspace-select')!);
                  let next = current;
                  if (event.key === 'ArrowDown') next = Math.min(current + 1, choices.length - 1);
                  else if (event.key === 'ArrowUp') next = current - 1;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = choices.length - 1;
                  else return;
                  event.preventDefault();
                  if (next < 0) searchInput.current?.focus();
                  else choices[next]?.focus();
                }}>
                {filtered.map((workspace) => <div className={`workspace-list-item ${workspace.id === activeWorkspaceId ? 'is-current' : ''}`} role="listitem" key={workspace.id}>
                  {renaming === workspace.id ? <form className="workspace-rename-form" onSubmit={(event) => rename(event, workspace)}>
                    <Folder size={19} /><input className="input" aria-label="Workspace name" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus maxLength={80} disabled={busy} />
                    <button className="icon-button" type="submit" aria-label="Save workspace name" disabled={busy || !renameValue.trim()}><Check size={17} /></button>
                    <button className="icon-button" type="button" onClick={() => setRenaming(null)} aria-label="Cancel rename" disabled={busy}><X size={17} /></button>
                  </form> : <>
                    <button className="workspace-select" type="button" data-tooltip={`${workspace.name} · ${workspace.path}`} aria-current={workspace.id === activeWorkspaceId ? 'true' : undefined} onClick={() => void perform(() => onSelect(workspace), true)} disabled={busy || reading}>
                      <span className="workspace-folder">{workspace.worktree ? <GitBranch size={19} /> : workspace.source?.kind === 'github' ? <Github size={19} /> : <Folder size={19} />}</span>
                      <span className="workspace-item-label"><strong data-tooltip={workspace.name} dir="auto">{workspace.name}</strong><span title={workspace.path}>{workspace.path}</span>
                        {(workspace.id === activeWorkspaceId || workspace.worktree || workspace.source?.kind === 'github') && <span className="workspace-kind">{[workspace.id === activeWorkspaceId ? 'Current workspace' : '', workspace.worktree ? 'Worktree' : workspace.source?.kind === 'github' ? workspace.source.fullName : ''].filter(Boolean).join(' · ')}</span>}
                      </span>
                      {workspace.id === activeWorkspaceId && <Check className="workspace-current-check" size={17} />}
                    </button>
                    <div className="workspace-row-actions">
                      <DropdownMenu aria-label={`Workspace actions for ${workspace.name}`} trigger={<button className="icon-button cw-menu-trigger" type="button" disabled={busy || reading} aria-label={`Actions for ${workspace.name}`}><MoreHorizontal size={17} /></button>} items={[
                        ...(canManageWorktrees ? [{ id: 'worktrees', label: 'Worktrees', icon: <GitBranch size={15} />, description: 'Create, reopen, or manage repository checkouts.', onSelect: () => manageWorktrees(workspace) }] : []),
                        { id: 'rename', label: 'Rename workspace', icon: <Pencil size={15} />, onSelect: () => { setRenaming(workspace.id); setRenameValue(workspace.name); setTrashing(null); } },
                      ]} />
                      <button className="workspace-delete-action" type="button" disabled={busy || reading || !!workspace.worktree && !canManageWorktrees}
                        aria-label={workspace.worktree ? `Manage removal of ${workspace.name}` : `Delete ${workspace.name}`}
                        title={workspace.worktree ? 'Remove through the worktree manager' : `Delete ${workspace.name}`}
                        aria-expanded={!workspace.worktree ? trashing === workspace.id : undefined}
                        onClick={event => { deletionTrigger.current = event.currentTarget; if (workspace.worktree) manageWorktrees(workspace); else checkDeletion(workspace); }}>
                        <Trash2 size={16} /><span>Delete</span>
                      </button>
                    </div>
                  </>}
                  {trashing === workspace.id && <div ref={deletionConfirmation} className="workspace-trash-confirm" role="group" aria-label={`Confirm deletion of ${workspace.name}`}>
                    {deletionPlan?.workspaceId === workspace.id ? <p>{deletionPlan.mode === 'permanent'
                      ? <>Permanently delete <strong>{workspace.name}</strong> and its local files? GitHub repository workspaces skip trash, so this cannot be undone. The repository on GitHub will remain.</>
                      : <>Move <strong>{workspace.name}</strong> to workspace trash? Its saved files can be restored for 30 days. After that, they are permanently deleted.</>}</p>
                      : <p role="status">{busy ? 'Checking deletion options…' : 'Deletion options are unavailable. Try again before deleting.'}</p>}
                    <div>
                      <button className="button ghost" type="button" data-delete-cancel onClick={cancelDeletion} disabled={busy}>Cancel</button>
                      {deletionPlan?.workspaceId === workspace.id ? <button className="button danger" type="button" disabled={busy} onClick={() => void perform(() => onDelete(workspace, deletionPlan), false, () => {
                        setTrashing(null); setDeletionPlan(null);
                        setPageView(current => ({ ...current, page: { ...current.page, workspaces: current.page.workspaces.filter(item => item.id !== workspace.id) } }));
                        requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }));
                      })}>{busy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}{deletionPlan.mode === 'permanent' ? 'Delete workspace permanently' : 'Move to trash'}</button>
                        : <button className="button" type="button" disabled={busy} onClick={() => checkDeletion(workspace)}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}Try again</button>}
                    </div>
                  </div>}
                </div>)}
                {!reading && !pendingQuery && filtered.length === 0 && <div className="workspace-list-empty"><Folder size={24} /><strong>{pageView.query ? 'No matching workspaces' : 'Start your first workspace'}</strong><p>{pageView.query ? `No workspaces match “${pageView.query}”. Try a different search.` : 'Create a workspace above or import a project from GitHub.'}</p></div>}
              </div>
              {(page.previousCursor || page.nextCursor || page.workspaces.length > 0) && <nav className="workspace-pagination" aria-label="Workspace pages">
                <span role="status">{page.workspaces.length ? `${page.offset + 1}–${page.offset + page.workspaces.length}${page.total === undefined ? '' : ` of ${page.total}`}` : 'No results'}</span>
                <div><button className="button small ghost" type="button" aria-label="Previous workspaces" disabled={busy || reading || !page.previousCursor} onClick={() => changePage(page.previousCursor)}><ChevronLeft size={15} />Previous</button><button className="button small ghost" type="button" aria-label="Next workspaces" disabled={busy || reading || !page.nextCursor} onClick={() => changePage(page.nextCursor)}>Next<ChevronRight size={15} /></button></div>
              </nav>}
              {error && <p className="form-error workspace-operation-error" role="alert">{error}</p>}
              {error && trashing && deletionPlan?.mode === 'permanent' && <button className="button ghost" type="button" onClick={() => { setTrashOpen(true); setError(''); }} disabled={busy}>Review deletion status</button>}
            </div>
            {creating && <form className="workspace-create-screen" onSubmit={create} aria-busy={busy}>
              <button className="text-button workspace-create-back" type="button" onClick={backFromCreate} disabled={busy}><ArrowLeft size={16} />Back to workspaces</button>
              <label className="field-label" htmlFor="new-workspace-name">Workspace name</label>
              <input ref={createNameInput} id="new-workspace-name" className="input" placeholder="my-next-project" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus autoComplete="off" required disabled={busy} aria-describedby="new-workspace-name-help" />
              <p className="field-help" id="new-workspace-name-help">Choose a name you can find easily later.</p>
              <label className="workspace-git-option"><input type="checkbox" checked={initializeGit} onChange={(event) => setInitializeGit(event.target.checked)} disabled={busy} /><span><strong>Initialize a Git repository</strong><small>Track changes from your first file.</small></span><GitBranch size={18} /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="workspace-create-footer"><button className="button ghost" type="button" onClick={backFromCreate} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? <Loader2 size={16} className="spin" /> : <FolderPlus size={16} />}{busy ? 'Creating workspace…' : 'Create workspace'}</button></div>
            </form>}
          </>}
    </div>
  </Modal>;
}
