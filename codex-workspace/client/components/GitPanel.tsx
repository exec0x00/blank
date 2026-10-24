import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, CircleAlert,
  Download, FileCode2, FileText, FolderGit2, GitBranch, GitCommitHorizontal,
  GitCompareArrows, LoaderCircle, Minus, Plus, RefreshCw, RotateCcw, Search, Trash2, X,
} from 'lucide-react';
import { api, json } from '../api';
import type { GitBranchPage, GitDiff, GitFile, GitFilePage, GitStatusSummary, Workspace } from '../../shared/types';
import Modal from './Modal';
import { SelectMenu } from './ui/Dropdown';
import GithubAccountSelect from './GithubAccountSelect';
import PageNavigation from './ui/PageNavigation';
import { useGitPage } from './useGitPage';
import { MeasuredWindow } from './chat/MeasuredWindow';
import './git.css';

interface GitPanelProps {
  workspace: Workspace;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  onOpenFile?: (path: string) => void;
}

type Selection = GitFile;
type Discard = { discardId: string; count: number };
const statusNames: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', U: 'Conflict', '?': 'Untracked', T: 'Type changed' };
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';
interface PatchRow { line: string; kind: string; oldLine?: number; newLine?: number }
interface PatchChunk { start: number; end: number; before: number; after: number; lines: number; hunks: number }
const patchChunkKey = (chunk: PatchChunk) => String(chunk.start);
const patchChunkHeight = (chunk: PatchChunk) => chunk.lines * 20 + chunk.hunks * 16;

function patchLine(line: string, position: { before: number; after: number }): PatchRow {
  const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
  let kind = 'context', oldLine: number | undefined, newLine: number | undefined;
  if (hunk) { position.before = Number(hunk[1]); position.after = Number(hunk[2]); kind = 'hunk'; }
  else if (/^(?:diff |index |--- |\+\+\+ |new file |deleted file |old mode |new mode |similarity |dissimilarity |rename |copy |Binary |Index: |===)/.test(line)) kind = 'meta';
  else if (line.startsWith('+')) { kind = 'added'; newLine = position.after++; }
  else if (line.startsWith('-')) { kind = 'removed'; oldLine = position.before++; }
  else if (line.startsWith(' ')) { oldLine = position.before++; newLine = position.after++; }
  else kind = 'meta';
  return { line, kind, oldLine, newLine };
}

function PatchLines({ patch, chunk }: { patch: string; chunk: PatchChunk }) {
  const rows = useMemo(() => {
    const position = { before: chunk.before, after: chunk.after };
    const lines = patch.slice(chunk.start, chunk.end).split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines.map(line => patchLine(line, position));
  }, [patch, chunk]);
  return <>{rows.map((row, index) => <div className={`git-patch-line ${row.kind}`} key={index}>
    <span className="git-line-number" aria-hidden="true">{row.oldLine}</span><span className="git-line-number" aria-hidden="true">{row.newLine}</span><code>{row.line || ' '}</code>
  </div>)}</>;
}

function PatchPreview({ patch }: { patch: string }) {
  const scroll = useRef<HTMLDivElement>(null);
  const chunks = useMemo(() => {
    const items: PatchChunk[] = [];
    const position = { before: 0, after: 0 };
    let current: PatchChunk | undefined;
    // Keep one small index entry per 48 lines. Even a newline-heavy patch does
    // not create a million row objects or React elements before it is visible.
    for (let start = 0; start < patch.length;) {
      const newline = patch.indexOf('\n', start), end = newline === -1 ? patch.length : newline + 1;
      if (!current) current = { start, end, before: position.before, after: position.after, lines: 0, hunks: 0 };
      const row = patchLine(patch.slice(start, newline === -1 ? end : newline), position);
      current.end = end; current.lines++; if (row.kind === 'hunk') current.hunks++;
      if (current.lines === 48 || end === patch.length) { items.push(current); current = undefined; }
      start = end;
    }
    return items;
  }, [patch]);
  return <div ref={scroll} className="git-patch" tabIndex={0} role="region" aria-label="Unified diff. Red lines were removed; green lines were added."><MeasuredWindow items={chunks} itemKey={patchChunkKey} estimateHeight={patchChunkHeight} scrollRef={scroll} resetKey={patch} overscan={350} renderItem={chunk => <PatchLines patch={patch} chunk={chunk} />} /></div>;
}

export function GitPanel({ workspace, onNotify, onOpenFile }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [accountId, setAccountId] = useState(workspace.githubAccountId ?? '');
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [discardPaths, setDiscardPaths] = useState<string[] | null>(null);
  const [lastDiscard, setLastDiscard] = useState<Discard | null>(null);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [fileSearch, setFileSearch] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchQuery, setBranchQuery] = useState('');
  const [preview, setPreview] = useState<'diff' | 'file'>('diff');
  const panel = useRef<HTMLElement>(null);
  const currentWorkspace = useRef(workspace.id);
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const accountSequence = useRef(0);
  const mutationSequence = useRef(0);
  const statusController = useRef<AbortController | null>(null);
  const diffController = useRef<AbortController | null>(null);
  const retryConnection = useRef<() => void>(() => undefined);
  const working = useRef(false);
  const sessionLocked = useRef(document.body.dataset.workspaceLocked === 'true');
  const notify = useRef(onNotify);
  currentWorkspace.current = workspace.id;
  notify.current = onNotify;
  const base = `/workspaces/${encodeURIComponent(workspace.id)}`;
  const fileParams = new URLSearchParams({ limit: '50', query: fileQuery });
  const stagedPage = useGitPage<GitFilePage>(status?.isRepository && stagedOpen ? `${base}/git/changes?${fileParams}&staged=true` : null, status?.revision);
  const changesPage = useGitPage<GitFilePage>(status?.isRepository && changesOpen ? `${base}/git/changes?${fileParams}&staged=false` : null, status?.revision);
  const branchPage = useGitPage<GitBranchPage>(status?.isRepository && branchesOpen ? `${base}/git/branches?${new URLSearchParams({ limit: '50', query: branchQuery })}` : null);
  useEffect(() => { const timer = setTimeout(() => setFileQuery(fileSearch.trim()), 220); return () => clearTimeout(timer); }, [fileSearch]);
  useEffect(() => { const timer = setTimeout(() => setBranchQuery(branchSearch.trim()), 180); return () => clearTimeout(timer); }, [branchSearch]);

  const refresh = useCallback(async (showLoading = false) => {
    if (sessionLocked.current) return;
    const id = workspace.id;
    const sequence = ++requestSequence.current;
    statusController.current?.abort();
    const controller = new AbortController(); statusController.current = controller;
    if (showLoading) setLoading(true);
    try {
      const next = await api<GitStatusSummary>(`/workspaces/${encodeURIComponent(id)}/git/status?summary=true`, { signal: controller.signal });
      if (!mounted.current || currentWorkspace.current !== id || sequence !== requestSequence.current) return;
      if (typeof next.isRepository !== 'boolean' || typeof next.branch !== 'string' || [next.ahead, next.behind, next.changedFileCount, next.stagedCount, next.changesCount, next.conflictCount].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('The repository summary could not be read. Refresh to try again.');
      setStatus(next);
      setLoadError(null);
      setRevision(value => value + 1);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && currentWorkspace.current === id && sequence === requestSequence.current) setLoadError(messageOf(error));
    } finally {
      if (mounted.current && currentWorkspace.current === id && sequence === requestSequence.current) { setLoading(false); statusController.current = null; }
    }
  }, [workspace.id]);

  useEffect(() => {
    mounted.current = true;
    mutationSequence.current++; working.current = false;
    setStatus(null); setSelected(null); setMessage(''); setFailure(null); setLoadError(null);
    setLastDiscard(null); setBusy(null); setDiscardPaths(null); setNewBranchOpen(false);
    setFileSearch(''); setFileQuery(''); setBranchSearch(''); setBranchQuery(''); setBranchesOpen(false);
    setAccountId(workspace.githubAccountId ?? ''); setConnectionError('');
    const id = workspace.id;
    let live = true;
    let connectionController: AbortController | null = null;
    const visible = () => !document.hidden && !!panel.current?.getClientRects().length;
    const refreshConnection = async () => {
      if (sessionLocked.current) return;
      const request = ++accountSequence.current;
      connectionController?.abort(); connectionController = new AbortController();
      const signal = connectionController.signal;
      try {
        const current = await api<Workspace>(`/workspaces/${encodeURIComponent(id)}`, { signal });
        if (signal.aborted || !live || sessionLocked.current || currentWorkspace.current !== id || accountSequence.current !== request) return;
        setAccountId(current.githubAccountId ?? ''); setConnectionError('');
      } catch {
        if (!signal.aborted && live && !sessionLocked.current && currentWorkspace.current === id && accountSequence.current === request) setConnectionError('The repository connection could not be refreshed. Try again.');
      }
    };
    retryConnection.current = () => { void refreshConnection(); };
    void refresh(true);
    void refreshConnection();
    const interval = window.setInterval(() => { if (!document.hidden && visible() && !working.current) void refresh(); }, 12_000);
    const onFocus = () => { if (visible() && !working.current) { void refresh(); void refreshConnection(); } };
    const onAccountsChanged = () => { if (visible() && !working.current) void refreshConnection(); };
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; source?: string }>).detail;
      if (visible() && (!detail?.workspaceId || detail.workspaceId === id) && detail?.source !== 'git') void refresh();
    };
    const onLocked = () => { sessionLocked.current = true; requestSequence.current++; accountSequence.current++; mutationSequence.current++; statusController.current?.abort(); connectionController?.abort(); diffController.current?.abort(); working.current = false; setBusy(null); setLoading(false); setDiffLoading(false); };
    const onUnlocked = () => { sessionLocked.current = false; if (visible()) { void refresh(true); void refreshConnection(); } };
    let wasVisible = visible();
    const observer = new ResizeObserver(() => {
      const isVisible = visible();
      if (isVisible && !wasVisible && !working.current) { void refresh(); void refreshConnection(); }
      wasVisible = isVisible;
    });
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('focus', onFocus);
    window.addEventListener('codex:github-accounts-changed', onAccountsChanged);
    window.addEventListener('codex:workspace-changed', onChange);
    window.addEventListener('codex:session-locked', onLocked);
    window.addEventListener('codex:session-expired', onLocked);
    window.addEventListener('codex:session-unlocked', onUnlocked);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      live = false; mounted.current = false;
      statusController.current?.abort(); connectionController?.abort(); diffController.current?.abort();
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('codex:github-accounts-changed', onAccountsChanged);
      window.removeEventListener('codex:workspace-changed', onChange);
      window.removeEventListener('codex:session-locked', onLocked);
      window.removeEventListener('codex:session-expired', onLocked);
      window.removeEventListener('codex:session-unlocked', onUnlocked);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [workspace.id, refresh]);

  useEffect(() => {
    if (sessionLocked.current) return;
    if (!selected) { setDiff(null); setDiffError(null); setDiffLoading(false); return; }
    const controller = new AbortController();
    diffController.current = controller;
    setDiffLoading(true); setDiffError(null);
    void api<GitDiff>(`${base}/git/diff?${new URLSearchParams({ path: selected.path, staged: String(selected.staged) })}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDiff(result); })
      .catch(error => { if (!controller.signal.aborted) { setDiff(null); setDiffError(messageOf(error)); } })
      .finally(() => { if (!controller.signal.aborted) setDiffLoading(false); });
    return () => controller.abort();
  }, [base, selected?.path, selected?.staged, revision]);

  const run = async <T,>(action: string, body?: unknown, success?: string): Promise<T | undefined> => {
    if (working.current || sessionLocked.current) return;
    const id = workspace.id;
    const operation = ++mutationSequence.current;
    const current = () => mounted.current && currentWorkspace.current === id && operation === mutationSequence.current && !sessionLocked.current;
    working.current = true; setBusy(action); setFailure(null);
    try {
      const result = await api<T>(`${base}/git/${action}?summary=true`, json('POST', body));
      if (current()) {
        if (action === 'stage' || action === 'unstage') {
          const requested = body as { paths?: string[]; all?: boolean } | undefined;
          setSelected(previous => previous && (requested?.all || requested?.paths?.includes(previous.path)) ? { ...previous, staged: action === 'stage' } : previous);
        } else if (action === 'commit') setSelected(previous => previous?.staged ? null : previous);
        await refresh();
        if (!current()) return undefined;
        window.dispatchEvent(new CustomEvent('codex:workspace-changed', { detail: { workspaceId: id, source: 'git' } }));
        if (success && !sessionLocked.current) notify.current(success, 'success');
      }
      return current() ? result : undefined;
    } catch (error) {
      if (current()) {
        const detail = messageOf(error);
        setFailure(detail); if (!sessionLocked.current) notify.current(detail, 'error');
      }
      return undefined;
    } finally {
      if (operation === mutationSequence.current) { working.current = false; if (mounted.current && currentWorkspace.current === id) setBusy(null); }
    }
  };

  const chooseAccount = async (nextId: string) => {
    if (working.current || sessionLocked.current) return;
    const id = workspace.id;
    const sequence = ++accountSequence.current;
    const operation = ++mutationSequence.current;
    working.current = true; setBusy('account'); setFailure(null);
    try {
      const updated = await api<Workspace>(base, json('PATCH', { githubAccountId: nextId || null }));
      if (mounted.current && currentWorkspace.current === id && sequence === accountSequence.current && operation === mutationSequence.current && !sessionLocked.current) {
        setAccountId(updated.githubAccountId ?? '');
        if (!sessionLocked.current) notify.current('GitHub account saved for this repository.', 'success');
      }
    } catch (error) {
      if (mounted.current && currentWorkspace.current === id && operation === mutationSequence.current && !sessionLocked.current) { setFailure(messageOf(error)); notify.current(messageOf(error), 'error'); }
    } finally {
      if (operation === mutationSequence.current) { working.current = false; if (mounted.current && currentWorkspace.current === id) setBusy(null); }
    }
  };

  const staged = stagedPage.page?.files ?? [];
  const changes = changesPage.page?.files ?? [];
  const count = status?.changedFileCount ?? 0;
  // A preview can belong to another page. Absence from this page never means
  // the file was removed; per-file operations verify its current server state.
  const selectedFile = [...staged, ...changes].find(file => file.path === selected?.path && file.staged === selected?.staged) ?? selected;
  const diffCounts = useMemo(() => {
    const lines = diff?.patch.split('\n') ?? [];
    return { added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length, removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length };
  }, [diff]);
  const canCommit = !!message.trim() && (status?.stagedCount ?? 0) > 0 && !status?.conflictCount && !busy;
  const openFile = (filePath: string) => {
    if (onOpenFile) onOpenFile(filePath);
    else window.dispatchEvent(new CustomEvent('codex:open-file', { detail: { path: filePath } }));
  };
  const commit = async () => {
    if (!canCommit) return;
    const result = await run<{ commit: string }>('commit', { message }, 'Changes committed.');
    if (result && mounted.current) setMessage('');
  };
  const chooseFile = (file: GitFile) => {
    setSelected(file); setDiff(null); setPreview('diff');
  };

  const renderGroup = (files: GitFile[], isStaged: boolean) => {
    const expanded = isStaged ? stagedOpen : changesOpen;
    const label = isStaged ? 'Staged changes' : 'Changes';
    const results = isStaged ? stagedPage : changesPage;
    const total = (isStaged ? status?.stagedCount : status?.changesCount) ?? 0;
    return <section className="git-change-group" aria-label={label} aria-busy={results.loading}>
      <div className="git-group-heading">
        <button className="git-group-toggle" aria-expanded={expanded} onClick={() => isStaged ? setStagedOpen(value => !value) : setChangesOpen(value => !value)}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{label}</span><span className="git-count">{fileQuery && results.page ? `${results.page.total}/${total}` : total}</span>
        </button>
        <div className="git-group-actions">
          {!isStaged && expanded && files.some(file => file.status !== 'U') && <button className="icon-button" title="Discard shown unstaged changes" aria-label="Discard shown unstaged changes" disabled={!!busy || results.loading || results.stale} onClick={() => setDiscardPaths(files.filter(file => file.status !== 'U').map(file => file.path))}><RotateCcw size={14} /></button>}
          <button className="icon-button" title={isStaged ? 'Unstage all changes' : 'Stage all changes'} aria-label={isStaged ? 'Unstage all changes' : 'Stage all changes'} disabled={!!busy || total === 0} onClick={() => void run(isStaged ? 'unstage' : 'stage', { all: true })}>
            {isStaged ? <Minus size={16} /> : <Plus size={16} />}
          </button>
        </div>
      </div>
      {expanded && <>
      {results.error && <div className="git-page-error" role="alert"><p>{results.error}</p><button className="button ghost" type="button" disabled={results.loading || !!busy} onClick={results.retry}>{results.stale ? 'Refresh list' : 'Retry page'}</button></div>}
      {results.loading && !files.length ? <p className="git-group-empty" role="status"><LoaderCircle size={13} className="git-spinning" />Loading changes…</p> : files.length ? <ul className="git-file-list">
        {files.map(file => {
          const slash = file.path.lastIndexOf('/');
          const name = file.path.slice(slash + 1);
          const directory = slash >= 0 ? file.path.slice(0, slash) : '';
          const active = selected?.path === file.path && selected.staged === isStaged;
          return <li key={file.path} className={`git-file-row ${active ? 'selected' : ''}`}>
            <button className="git-file-main" title={`${file.originalPath ? `${file.originalPath} → ` : ''}${file.path} · ${statusNames[file.status] ?? file.status}`} onClick={() => chooseFile(file)} aria-pressed={active}>
              <FileText size={15} className="git-file-icon" />
              <span className="git-file-label"><span className="git-file-name">{name}</span>{directory && <span className="git-file-directory">{directory}</span>}</span>
              <span className={`git-status-letter status-${file.status === '?' ? 'untracked' : file.status.toLowerCase()}`} aria-label={statusNames[file.status] ?? file.status}>{file.status === '?' ? 'U' : file.status === 'U' ? '!' : file.status}</span>
            </button>
            <div className="git-file-actions">
              {!isStaged && file.status !== 'U' && <button className="icon-button" title={`Discard changes to ${name}`} aria-label={`Discard changes to ${file.path}`} disabled={!!busy || results.loading || results.stale} onClick={() => setDiscardPaths([file.path])}><RotateCcw size={13} /></button>}
              <button className="icon-button" title={`${isStaged ? 'Unstage' : 'Stage'} ${name}`} aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${file.path}`} disabled={!!busy || results.loading || results.stale} onClick={() => void run(isStaged ? 'unstage' : 'stage', { paths: [file.path] })}>{isStaged ? <Minus size={15} /> : <Plus size={15} />}</button>
            </div>
          </li>;
        })}
      </ul> : !results.error && <p className="git-group-empty">{fileQuery ? `No changes match “${fileQuery}”.` : isStaged ? 'Stage changes to include them in a commit.' : 'Your working files are up to date.'}</p>}
      <PageNavigation label={label} offset={results.page?.offset ?? 0} count={files.length} total={results.page?.total} hasPrevious={!!results.page?.previousCursor} hasNext={!!results.page?.nextCursor} loading={results.loading} disabled={!!busy || results.stale} onPrevious={results.previous} onNext={results.next} />
      </>}
    </section>;
  };

  return <section ref={panel} className="git-panel" aria-label="Git changes" aria-busy={loading || !!busy}>
    <div className="git-topbar">
      <div className="git-heading"><span className="git-heading-icon"><GitBranch size={19} /></span><div><h2>Source control</h2><p>{loading ? 'Reading repository…' : status?.isRepository ? `${plural(count, 'changed file')}${busy ? ' · Working…' : ''}` : 'Version history for your workspace'}</p></div></div>
      <button className="icon-button git-refresh" onClick={() => void refresh(true)} disabled={loading || !!busy} aria-label="Refresh source control" title="Refresh source control"><RefreshCw size={16} className={loading ? 'git-spinning' : ''} /></button>
    </div>

    {(failure || loadError) && <div className="git-error" role="alert"><CircleAlert size={16} /><span>{failure || loadError}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => { setFailure(null); setLoadError(null); }}><X size={14} /></button></div>}

    {!status && loading ? <div className="git-state"><LoaderCircle size={24} className="git-spinning" /><p>Opening source control…</p></div> : !status ? <div className="git-state"><FolderGit2 size={34} /><h3>Repository unavailable</h3><p>Refresh to try reading this workspace again.</p><button className="button" onClick={() => void refresh(true)}>Try again</button></div> : !status.isRepository ? <div className="git-state git-onboarding"><div className="git-onboarding-icon"><FolderGit2 size={34} /></div><span className="git-eyebrow">A history for every idea</span><h3>Start tracking your work</h3><p>Review changes, create commits, and move between branches in this workspace.</p><button className="button primary" onClick={() => void run('init', undefined, 'Git repository initialized.')} disabled={!!busy}>{busy === 'init' ? <LoaderCircle size={16} className="git-spinning" /> : <Plus size={16} />}Initialize repository</button><span className="git-onboarding-note">Your existing files stay in place.</span></div> : <>
      <div className="git-repository-bar">
        <div className="git-branch-control"><SelectMenu aria-label="Current Git branch" compact searchPlaceholder="Find a branch…" value={status.branch} disabled={!!busy} onValueChange={name => { void run('branch', { name }, 'Branch switched.'); }}
          renderValue={() => <><GitBranch size={15} /><span>{status.branch === 'HEAD' ? 'Detached HEAD' : status.branch}</span></>}
          valueLabel={status.branch === 'HEAD' ? 'Detached HEAD' : status.branch}
          onOpenChange={open => { setBranchesOpen(open); if (open) { setBranchSearch(''); setBranchQuery(''); } }}
          options={(branchPage.page?.branches ?? []).map(branch => ({ value: branch, label: branch, icon: <GitBranch size={15} />, disabled: branchPage.loading || branchPage.stale || branchSearch.trim() !== branchQuery }))}
          remoteSearch={{ query: branchSearch, onQueryChange: setBranchSearch, loading: branchPage.loading || branchSearch.trim() !== branchQuery, error: branchPage.error, onRetry: branchPage.retry,
            onPreviousPage: branchPage.stale ? undefined : branchPage.previous, onNextPage: branchPage.stale ? undefined : branchPage.next,
            footer: <PageNavigation label="Branches" offset={branchPage.page?.offset ?? 0} count={branchPage.page?.branches.length ?? 0} total={branchPage.page?.total} hasPrevious={!!branchPage.page?.previousCursor} hasNext={!!branchPage.page?.nextCursor} loading={branchPage.loading || branchSearch.trim() !== branchQuery} disabled={branchPage.stale} onPrevious={branchPage.previous} onNext={branchPage.next} />,
          }} /></div>
        <button className="icon-button" title="Create a branch" aria-label="Create a branch" disabled={!!busy} onClick={() => { setNewBranch(''); setNewBranchOpen(true); }}><Plus size={16} /></button>
        <span className="git-toolbar-divider" />
        <div className="git-sync-controls">
          <button className="button ghost" onClick={() => void run('pull', { accountId }, 'Repository is up to date.')} disabled={!!busy || !status.remote} title={status.remote ? 'Pull remote commits without rewriting local history' : 'Add a remote repository to pull'}>{busy === 'pull' ? <LoaderCircle size={14} className="git-spinning" /> : <ArrowDown size={14} />}<span>Pull</span>{status.behind > 0 && <span className="git-sync-count">{status.behind}</span>}</button>
          <button className="button ghost" onClick={() => void run('push', { accountId }, 'Changes pushed to the remote.')} disabled={!!busy || !status.remote} title={status.remote ? 'Push committed changes' : 'Add a remote repository to push'}>{busy === 'push' ? <LoaderCircle size={14} className="git-spinning" /> : <ArrowUp size={14} />}<span>Push</span>{status.ahead > 0 && <span className="git-sync-count">{status.ahead}</span>}</button>
          <button className="icon-button" onClick={() => void run('fetch', { accountId }, 'Remote branches refreshed.')} disabled={!!busy || !status.remote} title="Fetch remote branches" aria-label="Fetch remote branches">{busy === 'fetch' ? <LoaderCircle size={15} className="git-spinning" /> : <Download size={15} />}</button>
        </div>
      </div>

      {lastDiscard && <div className="git-undo-notice" role="status"><Check size={14} /><span>Discarded {plural(lastDiscard.count, 'file change')}.</span><button disabled={!!busy} onClick={async () => { const result = await run<{ restored: number }>('restore-discard', { discardId: lastDiscard.discardId }, 'Discarded changes restored.'); if (result) setLastDiscard(null); }}>Undo discard</button><button className="icon-button" aria-label="Dismiss undo notice" onClick={() => setLastDiscard(null)}><X size={13} /></button></div>}

      <div className={`git-workbench ${selected ? 'has-selection' : ''}`}>
        <aside className="git-changes-pane" aria-label="Changes and commit">
          <form className="git-commit-form" onSubmit={event => { event.preventDefault(); void commit(); }}>
            <label htmlFor={`git-message-${workspace.id}`}>Commit message</label>
            <textarea id={`git-message-${workspace.id}`} className="input git-message-input" placeholder="Describe what changed…" value={message} maxLength={20_000} rows={3} onChange={event => setMessage(event.target.value)} disabled={busy === 'commit'} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void commit(); } }} />
            <button className="button primary git-commit-button" type="submit" disabled={!canCommit} title={status.stagedCount ? 'Commit staged changes (Ctrl/⌘ + Enter)' : 'Stage changes before committing'}>{busy === 'commit' ? <LoaderCircle size={16} className="git-spinning" /> : <GitCommitHorizontal size={16} />}<span>Commit staged</span>{status.stagedCount > 0 && <span className="git-commit-count">{status.stagedCount}</span>}</button>
          </form>
          <label className="git-file-search"><Search size={14} /><input type="search" aria-label="Find changed files" placeholder="Find changed files…" value={fileSearch} maxLength={300} onChange={event => setFileSearch(event.target.value)} /></label>
          <div className="git-groups">{renderGroup(staged, true)}{renderGroup(changes, false)}{count === 0 && <div className="git-clean"><span><Check size={20} /></span><strong>All changes committed</strong><p>Your working tree is clean.</p></div>}</div>
          <div className="git-connection">
            <label><span>GitHub account</span><GithubAccountSelect scope={workspace.id} value={accountId} disabled={!!busy} onValueChange={id => { void chooseAccount(id); }} aria-label="GitHub account for this repository" /></label>
            <p title={status.remote ?? undefined}><span className={`git-remote-dot ${status.remote ? 'connected' : ''}`} />{status.remote ? status.remote.replace(/^https:\/\/github\.com\//, '').replace(/^git@github\.com:/, '').replace(/\.git$/, '') : 'Local repository · no remote'}</p>
            {connectionError && <div className="git-page-error" role="alert"><p>{connectionError}</p><button className="button ghost" type="button" disabled={!!busy} onClick={() => retryConnection.current()}>Retry connection</button></div>}
          </div>
        </aside>

        <section className="git-diff-pane" aria-label="Change preview">
          {selected ? <>
            <div className="git-diff-heading"><button className="icon-button git-back" aria-label="Back to changes" onClick={() => setSelected(null)}><ArrowLeft size={17} /></button><FileCode2 size={16} /><div className="git-diff-title"><strong title={selected.path}>{selected.path.split('/').at(-1)}</strong><span title={selected.path}>{selected.staged ? 'Staged' : 'Working changes'}{selected.path.includes('/') ? ` · ${selected.path.slice(0, selected.path.lastIndexOf('/'))}` : ''}</span></div>
              {diffLoading ? <LoaderCircle size={15} className="git-spinning" /> : diff && !diff.binary && <span className="git-diff-stat"><span>+{diffCounts.added}</span><span>−{diffCounts.removed}</span></span>}
              <button className="icon-button" title="Open in editor" aria-label={`Open ${selected.path} in editor`} disabled={selectedFile?.status === 'D'} onClick={() => openFile(selected.path)}><FileText size={16} /></button>
              <button className="icon-button git-close-diff" title="Close preview" aria-label="Close change preview" onClick={() => setSelected(null)}><X size={15} /></button>
            </div>
            <div className="git-diff-toolbar"><div className="git-preview-tabs" role="tablist" aria-label="Preview format"><button role="tab" aria-selected={preview === 'diff'} className={preview === 'diff' ? 'active' : ''} onClick={() => setPreview('diff')}>Diff</button><button role="tab" aria-selected={preview === 'file'} className={preview === 'file' ? 'active' : ''} onClick={() => setPreview('file')}>File</button></div><span className="git-comparison-label">{selected.staged ? 'Last commit → staged' : 'Staged → working file'}</span><button className="button ghost git-preview-stage" disabled={!!busy || !selectedFile} onClick={() => void run(selected.staged ? 'unstage' : 'stage', { paths: [selected.path] })}>{selected.staged ? <Minus size={14} /> : <Plus size={14} />}{selected.staged ? 'Unstage' : 'Stage'}</button></div>
            {diffError ? <div className="git-state git-preview-error"><CircleAlert size={24} /><p>{diffError}</p><button className="button" onClick={() => setRevision(value => value + 1)}>Retry preview</button></div> : !diff ? <div className="git-state"><LoaderCircle size={23} className="git-spinning" /><p>Reading changes…</p></div> : diff.binary ? <div className="git-state"><FileCode2 size={30} /><h3>Binary file</h3><p>{diff.patch}</p><a className="button" href={`/api${base}/download?${new URLSearchParams({ path: selected.path })}`} download>Download file</a></div> : preview === 'file' ? <div className="git-full-file" tabIndex={0} role="region" aria-label="File contents"><pre>{diff.modified || 'This version of the file is empty.'}</pre></div> : diff.patch ? <PatchPreview patch={diff.patch} /> : <div className="git-state"><Check size={27} /><h3>No content changes</h3><p>The file may have been renamed or its permissions changed.</p></div>}
          </> : <div className="git-state git-preview-empty"><div className="git-preview-art"><span className="git-art-line" /><span className="git-art-line removed" /><span className="git-art-line added" /><span className="git-art-line short" /><GitCompareArrows size={20} /></div><h3>Review your changes</h3><p>Select a file to see what changed,<br />then stage the work you want to commit.</p><span className="git-keyboard-hint"><span>+</span> Stage <span>−</span> Unstage</span></div>}
        </section>
      </div>
    </>}

    <Modal open={newBranchOpen} title="Create a branch" titleId="git-create-branch-title" description={`Start a new branch from ${status?.branch || 'your current work'}.`} onClose={() => { if (!busy) setNewBranchOpen(false); }} className="git-modal">
      <form onSubmit={async event => { event.preventDefault(); if (!newBranch.trim()) return; const result = await run<GitStatusSummary>('branch', { name: newBranch.trim(), create: true }, 'Branch created.'); if (result) setNewBranchOpen(false); }}><label htmlFor="git-new-branch">Branch name</label><div className="git-branch-input"><GitBranch size={16} /><input id="git-new-branch" className="input" data-autofocus placeholder="feature/my-idea" value={newBranch} maxLength={255} autoComplete="off" spellCheck={false} onChange={event => setNewBranch(event.target.value)} /></div><p className="git-modal-note">Your current work follows you onto the new branch.</p>{failure && <p className="git-modal-error" role="alert">{failure}</p>}<div className="git-modal-actions"><button type="button" className="button ghost" disabled={!!busy} onClick={() => setNewBranchOpen(false)}>Cancel</button><button type="submit" className="button primary" disabled={!newBranch.trim() || !!busy}>{busy === 'branch' ? <LoaderCircle size={15} className="git-spinning" /> : <GitBranch size={15} />}Create branch</button></div></form>
    </Modal>

    <Modal open={!!discardPaths} title={`Discard ${discardPaths?.length === 1 ? 'these changes' : `${discardPaths?.length ?? 0} file changes`}?`} titleId="git-discard-title" onClose={() => { if (!busy) setDiscardPaths(null); }} className="git-modal">
      <p className="git-discard-explanation">Working edits will return to their staged version. Untracked files will be removed. A recovery copy is saved so you can undo this discard.</p><ul className="git-discard-files">{discardPaths?.slice(0, 6).map(filePath => <li key={filePath}><FileText size={14} /><span>{filePath}</span></li>)}{(discardPaths?.length ?? 0) > 6 && <li className="muted">and {(discardPaths?.length ?? 0) - 6} more…</li>}</ul>{failure && <p className="git-modal-error" role="alert">{failure}</p>}<div className="git-modal-actions"><button className="button ghost" disabled={!!busy} onClick={() => setDiscardPaths(null)} data-autofocus>Keep changes</button><button className="button git-danger-button" disabled={!!busy} onClick={async () => { const result = await run<Discard>('discard', { paths: discardPaths }); if (result) { setLastDiscard(result); setDiscardPaths(null); } }}>{busy === 'discard' ? <LoaderCircle size={15} className="git-spinning" /> : <Trash2 size={15} />}Discard changes</button></div>
    </Modal>
  </section>;
}

export default GitPanel;
