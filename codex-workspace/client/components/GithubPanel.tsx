import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, FolderGit2, GitBranch, Github, KeyRound, Loader2, LockKeyhole, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api, json } from '../api';
import type { GithubAccount, GithubRepo, Workspace } from '../../shared/types';
import GithubImportRecoveryNotice from './GithubImportRecoveryNotice';
import { useGithubAccountPage } from './useGithubAccountPage';
import { useGithubRepositories } from './useGithubRepositories';
import PageNavigation from './ui/PageNavigation';
import './github.css';

export interface GithubPanelProps {
  onImported: (workspace: Workspace) => void;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  onAccountsChanged?: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function updatedLabel(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently updated';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 30) return `Updated ${days} days ago`;
  return `Updated ${new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}`;
}

function AccountAvatar({ account }: { account: GithubAccount }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [account.avatarUrl]);
  return account.avatarUrl && !failed
    ? <img className="github-avatar" src={account.avatarUrl} alt="" width="34" height="34" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="github-avatar github-avatar-fallback" aria-hidden="true">{account.login.slice(0, 2).toUpperCase()}</span>;
}

export function GithubPanel({ onImported, onNotify, onAccountsChanged }: GithubPanelProps) {
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<GithubAccount | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountQuery, setAccountQuery] = useState('');
  const [accountCount, setAccountCount] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState('');
  const [disconnecting, setDisconnecting] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importRecoveryRevision, setImportRecoveryRevision] = useState(0);
  const [locked, setLocked] = useState(false);
  const importDialog = useRef<HTMLDialogElement>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const sessionEpoch = useRef(0);
  const pendingRequests = useRef(new Set<AbortController>());
  const callbacks = useRef({ onNotify, onAccountsChanged, onImported });
  callbacks.current = { onNotify, onAccountsChanged, onImported };
  const accountListing = useGithubAccountPage(accountQuery, selectedAccountId, 'repository-browser');
  const accountPage = accountListing.page;
  const pendingAccountQuery = accountQuery !== accountSearch.trim();
  const accounts = !pendingAccountQuery ? accountPage?.accounts ?? [] : [];
  const accountsLoading = accountListing.loading || pendingAccountQuery;
  const accountsError = accountListing.error;
  const pendingRepoQuery = query !== search.trim();
  const repositoryListing = useGithubRepositories(selectedAccountId, query, !locked && !pendingRepoQuery, panel);
  const repoPage = repositoryListing.page;
  const repositories = !pendingRepoQuery ? repoPage?.repositories ?? [] : [];
  const reposLoading = repositoryListing.loading || pendingRepoQuery;
  const reposError = repositoryListing.error;

  useEffect(() => {
    const cancelRequests = () => {
      sessionEpoch.current += 1;
      for (const controller of pendingRequests.current) controller.abort();
      pendingRequests.current.clear();
    };
    const onLocked = () => {
      cancelRequests();
      setLocked(true);
      setToken('');
      setSelectedRepo(null);
      setConfirmDisconnect('');
      setConnectError('');
      setImportError('');
      setConnecting(false);
      setImporting(false);
      setDisconnecting('');
    };
    const onUnlocked = () => setLocked(false);
    window.addEventListener('codex:session-locked', onLocked);
    window.addEventListener('codex:session-expired', onLocked);
    window.addEventListener('codex:session-unlocked', onUnlocked);
    return () => {
      window.removeEventListener('codex:session-locked', onLocked);
      window.removeEventListener('codex:session-expired', onLocked);
      window.removeEventListener('codex:session-unlocked', onUnlocked);
      cancelRequests();
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setAccountQuery(accountSearch.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [accountSearch]);

  useEffect(() => {
    if (locked || !accountPage || !accountListing.selectionChecked) return;
    if (!accountQuery) setAccountCount(accountPage.total);
    if (selectedAccountId && accountPage.selected) { setSelectedAccount(accountPage.selected); return; }
    const first = accountPage.accounts[0] ?? null;
    setSelectedAccount(first); setSelectedAccountId(first?.id ?? '');
    if (!accountQuery && accountPage.total === 0) setConnectOpen(true);
  }, [accountPage, accountQuery, accountListing.selectionChecked, selectedAccountId, locked]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQuery(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const dialog = importDialog.current;
    if (!dialog) return;
    if (selectedRepo && !locked && !dialog.open) dialog.showModal();
    else if ((!selectedRepo || locked) && dialog.open) dialog.close();
  }, [selectedRepo, locked]);

  const selectAccount = (id: string) => {
    if (id === selectedAccountId) return;
    setSelectedAccount(accounts.find(account => account.id === id) ?? null);
    setSelectedAccountId(id);
    setConfirmDisconnect('');
  };

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locked || connecting || !token.trim()) return;
    const controller = new AbortController();
    const epoch = sessionEpoch.current;
    pendingRequests.current.add(controller);
    setConnecting(true);
    setConnectError('');
    try {
      const account = await api<GithubAccount>('/github/accounts', { ...json('POST', { token: token.trim() }), signal: controller.signal });
      if (controller.signal.aborted || epoch !== sessionEpoch.current) return;
      setToken('');
      setConnectOpen(false);
      setAccountSearch(''); setAccountQuery('');
      setAccountCount(current => Math.max(1, current)); setSelectedAccount(account);
      setSelectedAccountId(account.id);
      window.dispatchEvent(new CustomEvent('codex:github-accounts-changed'));
      if (account.id === selectedAccountId) repositoryListing.reload();
      callbacks.current.onNotify(`Connected to GitHub as ${account.login}.`, 'success');
      callbacks.current.onAccountsChanged?.();
    } catch (error) {
      if (!controller.signal.aborted && epoch === sessionEpoch.current) setConnectError(message(error));
    } finally {
      pendingRequests.current.delete(controller);
      if (!controller.signal.aborted && epoch === sessionEpoch.current) setConnecting(false);
    }
  };

  const disconnect = async (account: GithubAccount) => {
    if (locked || disconnecting) return;
    const controller = new AbortController();
    const epoch = sessionEpoch.current;
    pendingRequests.current.add(controller);
    setDisconnecting(account.id);
    try {
      await api(`/github/accounts/${encodeURIComponent(account.id)}`, { ...json('DELETE', {}), signal: controller.signal });
      if (controller.signal.aborted || epoch !== sessionEpoch.current) return;
      setConfirmDisconnect('');
      setSelectedAccount(current => current?.id === account.id ? null : current);
      setSelectedAccountId(current => current === account.id ? '' : current);
      setAccountCount(current => Math.max(0, current - 1));
      window.dispatchEvent(new CustomEvent('codex:github-accounts-changed'));
      callbacks.current.onAccountsChanged?.();
      callbacks.current.onNotify(`Disconnected ${account.login}. Your local repositories are still here.`, 'info');
    } catch (error) {
      if (!controller.signal.aborted && epoch === sessionEpoch.current) callbacks.current.onNotify(message(error), 'error');
    } finally {
      pendingRequests.current.delete(controller);
      if (!controller.signal.aborted && epoch === sessionEpoch.current) setDisconnecting('');
    }
  };

  const importRepository = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locked || !selectedRepo || !selectedAccountId || importing || !workspaceName.trim()) return;
    const controller = new AbortController();
    const epoch = sessionEpoch.current;
    pendingRequests.current.add(controller);
    setImporting(true);
    setImportError('');
    try {
      const workspace = await api<Workspace>('/github/import', { ...json('POST', {
        accountId: selectedAccountId, fullName: selectedRepo.fullName, name: workspaceName.trim(),
      }), signal: controller.signal });
      if (controller.signal.aborted || epoch !== sessionEpoch.current) return;
      setSelectedRepo(null);
      callbacks.current.onNotify(`${workspace.name} is ready.`, 'success');
      callbacks.current.onImported(workspace);
    } catch (error) {
      if (!controller.signal.aborted && epoch === sessionEpoch.current) setImportError(message(error));
    } finally {
      pendingRequests.current.delete(controller);
      if (!controller.signal.aborted && epoch === sessionEpoch.current) {
        setImporting(false);
        setImportRecoveryRevision(current => current + 1);
      }
    }
  };

  const activeAccount = selectedAccount?.id === selectedAccountId ? selectedAccount : accountPage?.selected;
  const hasAccounts = accountCount > 0 || !!selectedAccountId || !!accountPage?.total;
  const searchIncomplete = !!query && (!repoPage || !repoPage.searchComplete);

  return (
    <section ref={panel} className="github-panel" aria-label="Repository browser">
      <header className="github-heading">
        <div className="github-heading-copy">
          <span className="github-heading-icon"><Github size={23} aria-hidden="true" /></span>
          <div><h2>Bring your work with you</h2><p>Connect an account. Pick a repository. Make it yours.</p></div>
        </div>
        {hasAccounts && !connectOpen && <button className="button github-add-account" onClick={() => { setConnectOpen(true); window.setTimeout(() => tokenInput.current?.focus(), 0); }}><Plus size={15} aria-hidden="true" /><span>Add account</span></button>}
      </header>

      <GithubImportRecoveryNotice refreshKey={importRecoveryRevision} />

      {accountsError && <div className="github-error" role="alert"><p>{accountsError}</p><button className="button ghost" onClick={accountListing.retry}>Try again</button></div>}

      {connectOpen && <form className={`github-connect${hasAccounts ? '' : ' github-connect-first'}`} onSubmit={connect}>
        <div className="github-connect-intro">
          <span className="github-connect-symbol"><KeyRound size={19} aria-hidden="true" /></span>
          <div><h3>{hasAccounts ? 'Connect another account' : 'Your GitHub, connected'}</h3><p>Use a personal access token to choose which repositories this workspace can access.</p></div>
          {hasAccounts && <button className="icon-button github-connect-close" type="button" aria-label="Close account connection" disabled={connecting} onClick={() => { setConnectOpen(false); setToken(''); setConnectError(''); }}><X size={17} /></button>}
        </div>
        <div className="github-token-controls">
          <label htmlFor="github-token">Personal access token</label>
          <div className="github-token-row">
            <input ref={tokenInput} className="input" id="github-token" type="password" data-private-input="true" placeholder="github_pat_…" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={1024} required disabled={connecting} aria-describedby="github-token-help" />
            <button className="button primary" type="submit" disabled={connecting || !token.trim()}>{connecting ? <Loader2 size={16} className="github-spinner" aria-hidden="true" /> : <Github size={16} aria-hidden="true" />}<span>{connecting ? 'Verifying…' : 'Connect account'}</span></button>
          </div>
          <p className="github-token-help" id="github-token-help">Give <strong>Contents</strong> read and write access for the repositories you want to use. Organization access may need approval. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create a token <ExternalLink size={11} aria-hidden="true" /></a><span className="github-help-divider">·</span><a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noopener noreferrer">Token guide <ExternalLink size={11} aria-hidden="true" /></a></p>
          {connectError && <p className="github-inline-error" role="alert">{connectError}</p>}
        </div>
      </form>}

      {accountsLoading && !hasAccounts ? <div className="github-loading-state" role="status"><Loader2 className="github-spinner" size={21} aria-hidden="true" /><span>Loading your accounts…</span></div> : hasAccounts ? <div className="github-layout">
        <aside className="github-accounts" aria-label="Connected GitHub accounts">
          <div className="github-section-label"><span>Accounts</span><span className="github-count">{accountQuery ? accountPage?.total ?? '…' : accountCount || accountPage?.total || 0}</span><button className="icon-button" aria-label="Refresh GitHub accounts" title="Refresh GitHub accounts" onClick={accountListing.reload} disabled={accountsLoading}><RefreshCw size={13} /></button></div>
          <label className="github-search github-account-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search GitHub accounts" placeholder="Find an account" value={accountSearch} maxLength={120} onChange={event => setAccountSearch(event.target.value)} /></label>
          <div className="github-account-list" aria-busy={accountsLoading}>
            {accounts.map((account) => <div className={`github-account-wrap${account.id === selectedAccountId ? ' is-selected' : ''}`} key={account.id}>
              <button className="github-account" onClick={() => selectAccount(account.id)} aria-pressed={account.id === selectedAccountId} disabled={accountsLoading || locked}>
                <AccountAvatar account={account} />
                <span className="github-account-copy"><strong className="text-ellipsis" data-tooltip={account.name || account.login}>{account.name || account.login}</strong><span>@{account.login}</span></span>
                {account.id === selectedAccountId && <Check className="github-account-check" size={14} aria-hidden="true" />}
              </button>
              <button className="github-disconnect icon-button" title={`Disconnect ${account.login}`} aria-label={`Disconnect ${account.login}`} onClick={() => setConfirmDisconnect((current) => current === account.id ? '' : account.id)} disabled={!!disconnecting || accountsLoading || locked}><Trash2 size={14} /></button>
              {confirmDisconnect === account.id && <div className="github-disconnect-confirm"><p>Disconnect <strong>@{account.login}</strong>?</p><span>Your local repositories will stay here.</span><div><button className="button ghost" onClick={() => setConfirmDisconnect('')} disabled={!!disconnecting}>Keep account</button><button className="button github-danger" onClick={() => void disconnect(account)} disabled={!!disconnecting}>{disconnecting === account.id ? <Loader2 size={14} className="github-spinner" aria-hidden="true" /> : null}Disconnect</button></div></div>}
            </div>)}
            {!accounts.length && <p className="github-account-empty" role="status">{accountsLoading ? 'Finding accounts…' : accountsError ? 'Accounts could not be loaded.' : 'No matching accounts.'}</p>}
          </div>
          <PageNavigation label="GitHub accounts" offset={accountPage?.offset ?? 0} count={accounts.length} total={accountPage?.total}
            hasPrevious={!!accountPage?.previousCursor} hasNext={!!accountPage?.nextCursor} loading={accountsLoading} disabled={locked}
            onPrevious={accountListing.previous} onNext={accountListing.next} />
          <p className="github-account-note">Each repository keeps its own account for fetching and pushing.</p>
        </aside>

        <div className="github-repositories">
          <div className="github-repo-toolbar">
            <div className="github-repo-title"><h3>Repositories</h3>{activeAccount && <span>@{activeAccount.login}</span>}</div>
            <button className="icon-button" aria-label="Refresh repositories" title="Refresh repositories" onClick={repositoryListing.reload} disabled={reposLoading || !selectedAccountId || locked}><RefreshCw size={16} className={reposLoading ? 'github-spinner' : ''} /></button>
          </div>
          <label className="github-search"><Search size={17} aria-hidden="true" /><input type="search" placeholder="Search your repositories" aria-label="Search your repositories" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} /><kbd aria-hidden="true">Search</kbd></label>

          {reposError && <div className="github-error github-repo-error" role="alert"><p>{reposError}</p><button className="button" onClick={repositoryListing.retry} disabled={reposLoading}><RefreshCw size={14} aria-hidden="true" />Try again</button></div>}
          {!!query && (reposLoading || repositoryListing.paused) && <div className="github-search-progress"><span role="status" aria-live="polite">{repositoryListing.paused ? 'Search paused' : 'Searching repositories…'}{repositoryListing.progress ? ` · page ${repositoryListing.progress.page}` : ''}</span><button className="button ghost" onClick={repositoryListing.paused ? repositoryListing.resume : repositoryListing.pause}>{repositoryListing.paused ? 'Continue search' : 'Pause search'}</button></div>}
          <>
            <div className={`github-repo-list${reposLoading ? ' is-loading' : ''}`} aria-busy={reposLoading}>
              {reposLoading && repositories.length === 0 ? <div className="github-loading-state" role="status"><Loader2 className="github-spinner" size={22} aria-hidden="true" /><span>{query ? 'Searching your repositories…' : 'Fetching repositories…'}</span></div> : repositories.length > 0 ? repositories.map((repo) => <article className="github-repo" key={repo.id}>
                <span className="github-repo-icon"><FolderGit2 size={20} aria-hidden="true" /></span>
                <div className="github-repo-copy">
                  <div className="github-repo-name"><a href={repo.url} target="_blank" rel="noopener noreferrer" title={`View ${repo.fullName} on GitHub`}>{repo.fullName}</a>{repo.private && <span className="github-private" title="Private on GitHub" aria-label="Private on GitHub"><LockKeyhole size={10} aria-hidden="true" />Private</span>}</div>
                  {repo.description && <p>{repo.description}</p>}
                  <div className="github-repo-meta"><span data-tooltip={repo.defaultBranch}><GitBranch size={11} aria-hidden="true" /><span className="text-ellipsis">{repo.defaultBranch}</span></span><span>{updatedLabel(repo.updatedAt)}</span></div>
                </div>
                <button className="button github-import-button" disabled={reposLoading} onClick={() => { setSelectedRepo(repo); setWorkspaceName(repo.name); setImportError(''); }} aria-label={`Import ${repo.fullName}`}><Download size={14} aria-hidden="true" /><span>Import</span></button>
              </article>) : <div className="github-empty"><span className="github-empty-icon"><FolderGit2 size={27} aria-hidden="true" /></span><h4>{reposError ? 'Repositories could not be loaded' : query ? searchIncomplete ? 'More repositories to search' : repositoryListing.hadMatches ? 'No further matches' : 'No matching repositories' : (repoPage?.page ?? 1) > 1 ? 'You’re all caught up' : 'No repositories available'}</h4><p>{reposError ? 'Retry the request to continue from this page.' : query ? searchIncomplete ? 'Continue the search to check the remaining repositories this account can access.' : repositoryListing.hadMatches ? 'Return to a previous page or try a different search.' : 'The search reached the end of the accessible repository list. Try a different name or select another account.' : (repoPage?.page ?? 1) > 1 ? 'Return to the previous page to choose a repository.' : 'Your token may need access to more repositories. You can update its permissions on GitHub and refresh here.'}</p>{query && <button className="button ghost" onClick={() => setSearch('')}>Clear search</button>}</div>}
            </div>
            <footer className="github-pagination"><span aria-live="polite">{reposLoading ? 'Loading…' : `${repositories.length} ${query ? 'matches on this page' : repositories.length === 1 ? 'repository' : 'repositories'}`}{query && repoPage?.searchComplete && !reposLoading ? ' · Search complete' : ''}</span><nav aria-label="Repository pages"><button className="icon-button" disabled={locked} aria-disabled={!repoPage?.previousCursor || reposLoading || repositoryListing.paused} aria-label="Previous repository page" onClick={() => { if (!reposLoading && !repositoryListing.paused) repositoryListing.previous(); }}><ChevronLeft size={17} /></button><span>Page {repoPage?.page ?? repositoryListing.progress?.page ?? 1}</span><button className="icon-button" disabled={locked} aria-disabled={!repoPage?.nextCursor || reposLoading || repositoryListing.paused} aria-label="Next repository page" onClick={() => { if (!reposLoading && !repositoryListing.paused) repositoryListing.next(); }}><ChevronRight size={17} /></button></nav></footer>
          </>
        </div>
      </div> : !accountsError && !accountsLoading && <div className="github-welcome-note"><FolderGit2 size={16} aria-hidden="true" /><span>Private repositories, organizations, and multiple accounts. All in one place.</span></div>}

      <dialog ref={importDialog} className="github-import-dialog" aria-labelledby="github-import-title" aria-describedby="github-import-description github-import-storage" onCancel={(event) => { if (importing) event.preventDefault(); else setSelectedRepo(null); }} onClick={(event) => { if (event.target === event.currentTarget && !importing) setSelectedRepo(null); }}>
        {selectedRepo && <form onSubmit={importRepository}>
          <div className="github-dialog-top"><span className="github-dialog-icon"><FolderGit2 size={23} aria-hidden="true" /></span><button className="icon-button" type="button" aria-label="Cancel import" onClick={() => setSelectedRepo(null)} disabled={importing}><X size={18} /></button></div>
          <h3 id="github-import-title">A new home for your repository</h3>
          <p className="github-dialog-description" id="github-import-description">Import <strong>{selectedRepo.fullName}</strong> with its Git history and branches.</p>
          <p className="github-storage-note" id="github-import-storage">Imported files are stored unencrypted in your public data bucket.</p>
          <label className="github-workspace-label" htmlFor="github-workspace-name">Workspace name</label>
          <input className="input" id="github-workspace-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} disabled={importing} maxLength={80} required autoFocus />
          <div className="github-import-account"><Github size={14} aria-hidden="true" /><span>Connected as <strong>@{activeAccount?.login}</strong></span><Check size={13} aria-hidden="true" /></div>
          {importError && <p className="github-inline-error" role="alert">{importError}</p>}
          {importing && <p className="github-import-status" role="status">Cloning your repository. Larger repositories may take a few minutes.</p>}
          <div className="github-dialog-actions"><button className="button ghost" type="button" onClick={() => setSelectedRepo(null)} disabled={importing}>Cancel</button><button className="button primary" type="submit" disabled={importing || !workspaceName.trim()}>{importing ? <Loader2 size={16} className="github-spinner" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}<span>{importing ? 'Importing…' : 'Create workspace'}</span></button></div>
        </form>}
      </dialog>
    </section>
  );
}

export default GithubPanel;
