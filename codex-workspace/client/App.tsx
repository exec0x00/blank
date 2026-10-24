import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, CircleAlert, Code2, Columns2, ExternalLink, Eye, EyeOff, FileSearch, FolderOpen, FolderPlus, GitBranch, Github, ListTodo, Loader2, LockKeyhole, MessageSquare, MoreHorizontal, PanelRightClose, PanelRightOpen, Plug, Puzzle, RefreshCw, Save, Search, Settings, Settings2, ShieldCheck, Sparkles, SquarePen, Terminal, Users, WifiOff, Wrench, X } from 'lucide-react';
import type { AppSettings, Bootstrap, GithubAccountPage, Workspace, WorkspaceDeleteResult, WorkspaceDeletionPlan, WorkspacePage } from '../shared/types';
import { api, json } from './api';
import { clearSessionLock, readSessionLock, rememberSessionLock, UNCONFIRMED_LOCK_MESSAGE } from './session-lock';
import './session-lock.css';
import { dismissUiStateNotice, flushUiState, hydrateUiState, layoutProfile, retryUiState, setUiLayout, useUiState } from './ui-state';
import CommandPalette, { type CommandAction } from './components/CommandPalette';
import SettingsDialog, { type SettingsPatch, type SettingsTab } from './components/SettingsDialog';
import WorkspaceSwitcher from './components/WorkspaceSwitcher';
import Logo from './components/Logo';
import Modal from './components/Modal';
import { DropdownMenu } from './components/ui/Dropdown';
import { LoadingStatus, PanelSkeleton, WorkspaceOpening } from './components/ui/Loading';
import ToastStack, { type Notice } from './components/ui/ToastStack';
import PanelBoundary from './components/PanelBoundary';
import DownloadProgress from './components/DownloadProgress';
import type { EditorActionDetail, EditorActionType, EditorCommandScope, EditorToolbarState } from './components/editor/editor-actions';
import { validChangeReviewTarget, type ChangeReviewRequest, type ChangeReviewTarget } from './components/editor/change-review';
import { applyDarkTheme, darkSettings } from './theme';
import { applyWorkspace, applyWorkspacePage, hydrationWorkspaces, lookupWorkspace, selectedWorkspace, WORKSPACE_PAGE_SIZE } from './workspace-selection';
import { readWindowLocation, resolveWindowWorkspace, useWindowLocation, validNavigationId, windowLink, writeWindowLocation, type WindowLocation } from './window-navigation';
import { connectWindowEvents } from './window-events';
import { usePaneSizing } from './usePaneSizing';
import PaneSplitter from './components/PaneSplitter';
import './window-navigation.css';

const ChatPanel = lazy(() => import('./components/ChatPanel'));
const EditorPanel = lazy(() => import('./components/EditorPanel'));
const TerminalPanel = lazy(() => import('./components/TerminalPanel'));
const GitPanel = lazy(() => import('./components/GitPanel'));
const GithubPanel = lazy(() => import('./components/GithubPanel'));
const ClaudeToolsDialog = lazy(() => import('./components/ClaudeToolsDialog'));

type View = 'agent' | 'editor' | 'terminal' | 'git' | 'github';
type AuthState = 'checking' | 'locked' | 'ready' | 'error';
type PendingEditorAction = { type: EditorActionType; workspaceId: string; detail: EditorActionDetail; scope: EditorCommandScope | null; bindInitialEditor: boolean };
type ToolsSection = 'commands' | 'agents' | 'mcp' | 'memory' | 'sessions';
type NativeToolsSelection = { workspaceId: string; section: ToolsSection };
const sameEditorScope = (left: EditorCommandScope, right: EditorCommandScope) => left.workspaceId === right.workspaceId && left.editorInstanceId === right.editorInstanceId && left.generation === right.generation;
const validEditorToolbar = (state: EditorToolbarState) => state && typeof state.workspaceId === 'string' && state.workspaceId.length > 0
  && typeof state.editorInstanceId === 'string' && state.editorInstanceId.length > 0 && Number.isSafeInteger(state.generation) && state.generation >= 0
  && (state.activePath === null || typeof state.activePath === 'string') && Number.isSafeInteger(state.dirtyCount) && state.dirtyCount >= 0
  && ['ready', 'dirty', 'saveDisabled', 'saving', 'hasConflict', 'missing', 'explorerVisible', 'explorerToggleDisabled'].every(key => typeof state[key as keyof EditorToolbarState] === 'boolean');
const navItems = [{ id: 'agent', label: 'Claude', mobile: 'Claude', Icon: MessageSquare }, { id: 'editor', label: 'Editor', mobile: 'Files', Icon: Code2 }, { id: 'terminal', label: 'Terminal', mobile: 'Terminal', Icon: Terminal }, { id: 'git', label: 'Source control', mobile: 'Changes', Icon: GitBranch }, { id: 'github', label: 'Repositories', mobile: 'Repos', Icon: Github }] as const;
const getError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

function PanelLoading({ label }: { label: string }) {
  return <PanelSkeleton label={`Opening ${label}…`} kind={label === 'Claude' ? 'conversation' : label === 'editor' ? 'editor' : label === 'terminal' ? 'terminal' : 'list'} />;
}
function LazyPanel({ label, children }: { label: string; children: ReactNode }) { return <PanelBoundary label={label}><Suspense fallback={<PanelLoading label={label} />}>{children}</Suspense></PanelBoundary>; }
function PanelMountSignal({ onMount }: { onMount: () => (() => void) }) { useEffect(onMount, [onMount]); return null; }

class WorkspaceToolsBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <Modal open title="Workspace tools" titleId="workspace-tools-failure" onClose={this.props.onClose}>
      <div className="panel-failure" role="alert"><span><CircleAlert size={24} /></span><h2>Workspace tools could not open.</h2><p>Your workspace is still available. Save any open files before reloading this tab to try again.</p><button className="button" onClick={this.props.onClose}>Back to workspace</button></div>
    </Modal>;
  }
}

function LoginScreen({ onLogin, overlay = false, lockNotice, locking = false, onRetryLock }: {
  onLogin: (password: string) => Promise<void>; overlay?: boolean; lockNotice?: string; locking?: boolean; onRetryLock: () => void;
}) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!password || busy || locking) return; setBusy(true); setError(''); try { await onLogin(password); setPassword(''); } catch (failure) { setError(getError(failure)); } finally { setBusy(false); } };
  return <div className={`login-screen ${overlay ? 'login-overlay' : ''}`}>
    <header className="login-brand"><Logo size={25} /><span>Arc <span>Workspace</span></span></header>
    <main className="login-main">
      <div className="login-introduction"><div className="login-eyebrow"><span />Arc Workspace</div><h1>Your development<br /><span>workspace.</span></h1><p>Edit code, run commands, and build with Claude Code.</p><div className="login-feature-row"><span><Code2 size={16} />Editor</span><span><Terminal size={16} />Terminal</span><span><Sparkles size={16} />Claude Code</span></div><div className="login-decoration" aria-hidden="true"><div className="decoration-toolbar"><i /><i /><i /><span>workspace</span></div><div className="decoration-code"><span><em>01</em><b>const</b> project = <i>"my-workspace"</i>;</span><span><em>02</em></span><span><em>03</em><b>await</b> claude.run(project);<span className="decoration-caret" /></span></div><div className="decoration-status"><span /><span>Files · Terminal · Claude</span><Logo size={16} /></div></div></div>
      <section className="login-card" aria-labelledby="login-title"><div className="login-lock"><LockKeyhole size={22} /></div><h2 id="login-title">Open your workspace</h2><p>{overlay ? 'Enter your password to continue where you left off.' : 'Enter your workspace password to continue.'}</p>{(lockNotice || locking) && <div className="login-lock-notice" role={locking ? 'status' : 'alert'}><p>{locking ? 'Closing the server session…' : lockNotice}</p>{!locking && <button className="button small" type="button" disabled={busy} onClick={onRetryLock}><RefreshCw size={14} />Retry server sign-out</button>}</div>}<form onSubmit={(event) => void submit(event)}><label className="field-label" htmlFor="workspace-password">Workspace password</label><div className={`password-field ${error ? 'has-error' : ''}`}><input id="workspace-password" className="input" type={visible ? 'text' : 'password'} data-private-input="true" placeholder="Enter your password" autoComplete="current-password" autoFocus value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }} disabled={busy || locking} required /><button className="icon-button" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)} tabIndex={0}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{error && <p className="form-error" role="alert"><CircleAlert size={14} />{error}</p>}<button className="button primary login-submit" type="submit" disabled={busy || locking || !password}>{busy ? <><Loader2 className="spin" size={17} />Opening workspace…</> : <>Continue <ArrowRight size={17} /></>}</button></form><div className="login-note"><ShieldCheck size={15} /><span>Password-protected app · Public Hugging Face Space</span></div></section>
    </main><footer className="login-footer"><span>Arc Workspace</span><span>Public data bucket · Unencrypted workspace files</span></footer>
  </div>;
}

function LoadingScreen({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return <WorkspaceOpening error={error} onRetry={onRetry} />;
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const authRef = useRef(auth);
  authRef.current = auth;
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const bootRef = useRef(boot);
  bootRef.current = boot;
  const [bootError, setBootError] = useState('');
  const [lockNotice, setLockNotice] = useState(() => readSessionLock() === 'pending' ? UNCONFIRMED_LOCK_MESSAGE : '');
  const [locking, setLocking] = useState(false);
  const lockRequest = useRef<Promise<void> | null>(null);
  const sessionRead = useRef<AbortController | null>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const windowLocation = useWindowLocation();
  const independentWindow = useRef(windowLocation.view !== undefined);
  const [windowView, setWindowView] = useState<View>(windowLocation.view ?? 'agent');
  const [windowSplit, setWindowSplit] = useState<'split' | 'focus'>('focus');
  const [navigationError, setNavigationError] = useState(windowLocation.error ?? '');
  const lastWindowLocation = useRef<WindowLocation>(windowLocation);
  const linkedWorkspace = useRef<string | null>(null);
  const uiState = useUiState();
  const profile = layoutProfile(width);
  const layout = uiState.value.layouts[profile];
  const view: View = independentWindow.current ? windowView : layout?.view || 'agent';
  const setView = useCallback((next: View) => {
    if (!independentWindow.current) { setUiLayout(layoutProfile(window.innerWidth), { view: next }); return; }
    setWindowView(next);
    const location = readWindowLocation();
    if (!location.error && location.workspaceId && (next === 'agent' || next === 'editor')) writeWindowLocation({ ...location, view: next }, true);
  }, []);
  const splitPreference = independentWindow.current ? windowSplit : layout?.split;
  const setSplitPreference = (split: 'split' | 'focus') => independentWindow.current ? setWindowSplit(split) : setUiLayout(profile, { split });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(244);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('agent');
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [workspaceDialogSection, setWorkspaceDialogSection] = useState<'workspaces' | 'trash'>('workspaces');
  const [recoveryWorkspace, setRecoveryWorkspace] = useState<Workspace | null>(null);
  const recoveryWorkspaceRef = useRef(recoveryWorkspace);
  recoveryWorkspaceRef.current = recoveryWorkspace;
  const [refreshingWorkspaces, setRefreshingWorkspaces] = useState(false);
  const [workspaceListError, setWorkspaceListError] = useState('');
  const workspaceRead = useRef<AbortController | null>(null);
  const workspaceReadNumber = useRef(0);
  const workspaceListVersion = useRef(0);
  const workspaceOperation = useRef<symbol | null>(null);
  const workspaceMutationRead = useRef<AbortController | null>(null);
  const githubAccountsRead = useRef<AbortController | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [nativeTools, setNativeTools] = useState<NativeToolsSelection | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [visitedPanes, setVisitedPanes] = useState<Set<View>>(() => new Set());
  const [online, setOnline] = useState(navigator.onLine);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const switchLock = useRef(false);
  const sessionGeneration = useRef(0);
  const settingsRevision = useRef(0);
  const toastId = useRef(0);
  const dividerCleanup = useRef<(() => void) | null>(null);
  const editorReady = useRef(false);
  const chatReady = useRef(false);
  const [editorToolbarSnapshot, setEditorToolbarSnapshot] = useState<EditorToolbarState | null>(null);
  const editorToolbarRef = useRef<EditorToolbarState | null>(null);
  const editorWorkspaceRef = useRef<string | null>(null);
  const editorLifetime = useRef<{ workspaceId: string | null; readyPublished: boolean }>({ workspaceId: null, readyPublished: false });
  const retiredEditorInstances = useRef(new Set<string>());
  const pendingEditorAction = useRef<PendingEditorAction | null>(null);
  const [changeReview, setChangeReview] = useState<ChangeReviewRequest | null>(null);
  const changeReviewSequence = useRef(0);
  const pendingNewConversation = useRef(false);
  const isDesktop = width >= 1360;
  const isLaptop = width >= 1000 && width < 1360;
  const isTablet = width >= 680 && width < 1000;
  const isMobile = width < 680;
  const hasDock = width >= 1000;
  const split = hasDock && (splitPreference ? splitPreference === 'split' : isDesktop);
  const activeWorkspace = selectedWorkspace(boot);
  // A removed workspace never remains in active navigation. Its mounted panes
  // can still hold unsaved buffers and drafts until the user chooses to leave.
  const workspace = recoveryWorkspace || activeWorkspace;
  const savedWindowThread = workspace && !independentWindow.current ? uiState.value.workspaces[workspace.id]?.threadId : undefined;
  const selectedWindowThread = !windowLocation.error && (!windowLocation.workspaceId || windowLocation.workspaceId === workspace?.id)
    ? windowLocation.threadId !== undefined ? windowLocation.threadId : savedWindowThread : undefined;
  const windowThreadId = selectedWindowThread === null || validNavigationId(selectedWindowThread) ? selectedWindowThread : undefined;
  editorWorkspaceRef.current = workspace?.id ?? null;
  if (editorLifetime.current.workspaceId !== editorWorkspaceRef.current) editorLifetime.current = { workspaceId: editorWorkspaceRef.current, readyPublished: false };
  const editorToolbar = auth === 'ready' && !switchingWorkspace && editorToolbarSnapshot?.workspaceId === workspace?.id && editorToolbarSnapshot?.ready ? editorToolbarSnapshot : null;
  const codingView = view === 'agent' || view === 'editor';
  const showEditor = Boolean(workspace && (recoveryWorkspace ? view !== 'github' && (hasDock || view !== 'terminal') : view === 'editor' || (codingView && split)));
  const showAgent = Boolean(workspace && !recoveryWorkspace && (view === 'agent' || (codingView && split)));
  const showTerminal = Boolean(workspace && (hasDock ? terminalOpen : view === 'terminal'));
  const paneSizing = usePaneSizing({ profile, preferences: layout, workspaceId: workspace?.id,
    agentVisible: showAgent, editorVisible: showEditor, explorerVisible: editorToolbar?.explorerVisible ?? true,
    disabled: auth !== 'ready' || switchingWorkspace });
  const closeNativeTools = useCallback(() => setNativeTools(null), []);
  useEffect(() => { closeNativeTools(); }, [auth, workspace?.id, recoveryWorkspace?.id, switchingWorkspace, closeNativeTools]);
  useEffect(() => connectWindowEvents(), []);
  useEffect(() => {
    if (independentWindow.current && windowLocation.view) setWindowView(windowLocation.view);
  }, [windowLocation.view]);
  useEffect(() => {
    if (auth !== 'ready' || !workspace || recoveryWorkspace) return;
    const location = readWindowLocation();
    if (linkedWorkspace.current !== workspace.id) {
      linkedWorkspace.current = workspace.id;
      if (location.workspaceId !== workspace.id || location.error) {
        writeWindowLocation({ workspaceId: workspace.id, view: location.view }, true);
        setNavigationError('');
      }
    }
  }, [workspace?.id, recoveryWorkspace, auth]);
  useEffect(() => {
    if (workspace && windowLocation.workspaceId === workspace.id && !windowLocation.error) lastWindowLocation.current = windowLocation;
  }, [windowLocation, workspace?.id]);

  useEffect(() => {
    const visible: View[] = [];
    if (showEditor) visible.push('editor');
    if (showAgent) visible.push('agent');
    if (showTerminal) visible.push('terminal');
    if (view === 'git' || view === 'github') visible.push(view);
    setVisitedPanes((current) => visible.every((pane) => current.has(pane)) ? current : new Set([...current, ...visible]));
  }, [showEditor, showAgent, showTerminal, view]);

  const flushEditorAction = useCallback(() => {
    const action = pendingEditorAction.current;
    if (!action) return;
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true' || switchLock.current || action.workspaceId !== editorWorkspaceRef.current) { pendingEditorAction.current = null; return; }
    const current = editorToolbarRef.current;
    if (!current?.ready || current.workspaceId !== action.workspaceId) {
      if (!action.bindInitialEditor || action.scope) pendingEditorAction.current = null;
      return;
    }
    if (action.scope && !sameEditorScope(action.scope, current)) { pendingEditorAction.current = null; return; }
    if (!action.scope && (!action.bindInitialEditor || action.type === 'codex:save-file' || action.type === 'codex:toggle-explorer')) { pendingEditorAction.current = null; return; }
    if (action.type === 'codex:save-file' && (current.saveDisabled || action.detail.path !== current.activePath)) { pendingEditorAction.current = null; return; }
    if (action.type === 'codex:toggle-explorer' && current.explorerToggleDisabled) { pendingEditorAction.current = null; return; }
    pendingEditorAction.current = null;
    window.dispatchEvent(new CustomEvent(action.type, { detail: { ...action.detail, workspaceId: current.workspaceId, editorInstanceId: current.editorInstanceId, generation: current.generation } }));
  }, []);
  const onEditorToolbarStateChange = useCallback((state: EditorToolbarState) => {
    if (!validEditorToolbar(state) || state.workspaceId !== editorWorkspaceRef.current || retiredEditorInstances.current.has(state.editorInstanceId)) return;
    const previous = editorToolbarRef.current;
    if (previous?.editorInstanceId === state.editorInstanceId && state.generation < previous.generation) return;
    // A late cleanup from an old mount must not clear the replacement toolbar.
    if (previous?.workspaceId === state.workspaceId && previous.editorInstanceId !== state.editorInstanceId && !state.ready) return;
    if (state.ready && authRef.current !== 'ready') return;
    if (previous && previous.editorInstanceId !== state.editorInstanceId) retiredEditorInstances.current.add(previous.editorInstanceId);
    editorToolbarRef.current = { ...state };
    if (!state.ready && (pendingEditorAction.current?.scope || editorLifetime.current.readyPublished)) pendingEditorAction.current = null;
    if (state.ready) editorLifetime.current.readyPublished = true;
    setEditorToolbarSnapshot(current => current && Object.keys(state).every(key => current[key as keyof EditorToolbarState] === state[key as keyof EditorToolbarState]) ? current : { ...state });
    if (state.ready && pendingEditorAction.current) requestAnimationFrame(flushEditorAction);
  }, [flushEditorAction]);
  const editorMounted = useCallback(() => { editorReady.current = true; const frame = requestAnimationFrame(flushEditorAction); return () => { editorReady.current = false; cancelAnimationFrame(frame); }; }, [flushEditorAction]);
  const flushNewConversation = useCallback(() => { if (chatReady.current && pendingNewConversation.current) { pendingNewConversation.current = false; window.dispatchEvent(new CustomEvent('codex:new-thread')); } }, []);
  const chatMounted = useCallback(() => { chatReady.current = true; const frame = requestAnimationFrame(flushNewConversation); return () => { chatReady.current = false; cancelAnimationFrame(frame); }; }, [flushNewConversation]);
  useEffect(() => {
    if (pendingEditorAction.current?.workspaceId !== workspace?.id) pendingEditorAction.current = null;
    setChangeReview(current => current?.target.workspaceId === workspace?.id ? current : null);
    pendingNewConversation.current = false;
    if (editorToolbarRef.current && editorToolbarRef.current.workspaceId !== workspace?.id) {
      retiredEditorInstances.current.add(editorToolbarRef.current.editorInstanceId);
      editorToolbarRef.current = null;
      setEditorToolbarSnapshot(null);
    }
  }, [workspace?.id]);
  useEffect(() => {
    const clear = () => { pendingEditorAction.current = null; pendingNewConversation.current = false; setChangeReview(null); };
    window.addEventListener('codex:session-locked', clear);
    window.addEventListener('codex:session-expired', clear);
    return () => { window.removeEventListener('codex:session-locked', clear); window.removeEventListener('codex:session-expired', clear); };
  }, []);

  const notify = useCallback((message: string, kind: Notice['kind'] = 'info') => {
    if (authRef.current !== 'ready') return;
    const id = ++toastId.current;
    setNotices((current) => [...current.filter((item) => item.message !== message || item.kind !== kind).slice(-2), { id, message, kind }]);
  }, []);
  const dismissNotice = useCallback((id: number) => setNotices(current => current.filter(notice => notice.id !== id)), []);

  const checkSession = useCallback(async () => {
    const generation = ++sessionGeneration.current;
    sessionRead.current?.abort(); sessionRead.current = null;
    const rememberedLock = readSessionLock();
    if (rememberedLock) {
      setLockNotice(rememberedLock === 'pending' ? UNCONFIRMED_LOCK_MESSAGE : '');
      authRef.current = 'locked'; setAuth('locked'); return;
    }
    const controller = new AbortController(); sessionRead.current = controller;
    authRef.current = 'checking';
    setAuth('checking'); setBootError('');
    try {
      const session = await api<{ authenticated: boolean }>('/session', { signal: controller.signal });
      if (generation !== sessionGeneration.current) return;
      if (typeof session?.authenticated !== 'boolean') throw new Error('The server could not confirm this session. Please try again.');
      if (!session.authenticated) { setAuth('locked'); return; }
      const resolved = await resolveWindowWorkspace(await api<Bootstrap>('/bootstrap', { signal: controller.signal }), readWindowLocation());
      const data = resolved.boot;
      if (generation !== sessionGeneration.current) return;
      await hydrateUiState(data.uiState, hydrationWorkspaces(data));
      if (generation !== sessionGeneration.current) return;
      setNavigationError(resolved.error ?? '');
      setBoot({ ...data, settings: darkSettings(data.settings) }); authRef.current = 'ready'; setAuth('ready');
    } catch (failure) { if (generation === sessionGeneration.current) { setBootError(getError(failure)); setAuth('error'); } }
    finally { if (sessionRead.current === controller) sessionRead.current = null; }
  }, []);
  useEffect(() => { void checkSession(); }, [checkSession]);
  useEffect(() => { const resize = () => setWidth(window.innerWidth); const connected = () => setOnline(true); const disconnected = () => setOnline(false); window.addEventListener('resize', resize); window.addEventListener('online', connected); window.addEventListener('offline', disconnected); return () => { window.removeEventListener('resize', resize); window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); }; }, []);
  useEffect(() => () => { sessionGeneration.current++; sessionRead.current?.abort(); workspaceRead.current?.abort(); workspaceMutationRead.current?.abort(); githubAccountsRead.current?.abort(); dividerCleanup.current?.(); }, []);

  useEffect(() => {
    if (auth !== 'ready') return;
    const generation = sessionGeneration.current;
    let pending: AbortController | undefined;
    const refresh = () => {
      pending?.abort();
      const controller = new AbortController(); pending = controller;
      const revision = settingsRevision.current;
      void api<AppSettings>('/settings', { signal: controller.signal }).then(value => {
        if (controller.signal.aborted || generation !== sessionGeneration.current || authRef.current !== 'ready'
          || revision !== settingsRevision.current) return;
        setBoot(current => current ? { ...current, settings: darkSettings(value) } : current);
      }).catch(() => undefined); // Native status and the explicit Settings refresh retain failures.
    };
    window.addEventListener('codex:runtime-changed', refresh);
    return () => { pending?.abort(); window.removeEventListener('codex:runtime-changed', refresh); };
  }, [auth]);

  useEffect(() => {
    document.body.dataset.workspaceLocked = String(auth !== 'ready');
    window.dispatchEvent(new CustomEvent(auth === 'ready' ? 'codex:session-unlocked' : 'codex:session-locked'));
    if (auth !== 'ready') { workspaceReadNumber.current++; workspaceRead.current?.abort(); workspaceRead.current = null; workspaceMutationRead.current?.abort(); workspaceMutationRead.current = null; githubAccountsRead.current?.abort(); githubAccountsRead.current = null; workspaceOperation.current = null; switchLock.current = false; setSwitchingWorkspace(false); setRefreshingWorkspaces(false); pendingEditorAction.current = null; pendingNewConversation.current = false; setNotices([]); document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dialog) => dialog.close()); }
  }, [auth]);
  useEffect(() => { document.title = auth === 'ready' && workspace ? `${independentWindow.current ? (view === 'agent' ? 'Agent · ' : view === 'editor' ? 'Editor · ' : '') : ''}${workspace.name} · Arc Workspace` : 'Arc Workspace'; }, [auth, workspace?.name, view]);
  useEffect(() => { if (hasDock && view === 'terminal') { setView('editor'); setTerminalOpen(true); } }, [hasDock, view]);
  useEffect(() => {
    const expired = () => {
      sessionGeneration.current++; sessionRead.current?.abort(); sessionRead.current = null;
      const rememberedLock = readSessionLock() ?? 'confirmed'; rememberSessionLock(rememberedLock);
      setLockNotice(rememberedLock === 'pending' ? UNCONFIRMED_LOCK_MESSAGE : '');
      authRef.current = 'locked'; pendingEditorAction.current = null; setAuth('locked'); setSettingsOpen(false); setWorkspaceDialogOpen(false); setPaletteOpen(false);
    };
    window.addEventListener('codex:session-expired', expired); return () => window.removeEventListener('codex:session-expired', expired);
  }, []);
  useEffect(() => {
    applyDarkTheme();
    if (boot?.settings) { document.documentElement.style.setProperty('--editor-font-size', `${boot.settings.fontSize}px`); window.dispatchEvent(new CustomEvent('codex:settings-changed', { detail: darkSettings(boot.settings) })); }
  }, [boot?.settings]);

  const canLeaveWorkspace = useCallback(() => { const event = new CustomEvent('codex:before-workspace-change', { detail: { cancel: false } }); window.dispatchEvent(event); return !event.detail.cancel; }, []);
  const openWorkspaces = useCallback((section: 'workspaces' | 'trash' = 'workspaces') => { setWorkspaceDialogSection(section); setWorkspaceDialogOpen(true); }, []);
  const retainWorkspace = useCallback((item: Workspace | null) => { recoveryWorkspaceRef.current = item; setRecoveryWorkspace(item); }, []);
  const invalidateWorkspaceRead = useCallback(() => {
    workspaceListVersion.current++; workspaceReadNumber.current++;
    workspaceRead.current?.abort(); workspaceRead.current = null; setRefreshingWorkspaces(false);
  }, []);
  const refreshWorkspaces = useCallback(async (force = false) => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true' || switchLock.current || workspaceRead.current) return;
    const generation = sessionGeneration.current;
    const version = workspaceListVersion.current;
    const request = ++workspaceReadNumber.current;
    const controller = new AbortController();
    const selectedId = editorWorkspaceRef.current;
    workspaceRead.current = controller; setRefreshingWorkspaces(true);
    const current = () => !controller.signal.aborted && generation === sessionGeneration.current && version === workspaceListVersion.current && request === workspaceReadNumber.current && selectedId === editorWorkspaceRef.current && authRef.current === 'ready' && document.body.dataset.workspaceLocked !== 'true' && !switchLock.current;
    try {
      const held = recoveryWorkspaceRef.current;
      const selected = held || selectedWorkspace(bootRef.current);
      const [listing, selection] = await Promise.allSettled([
        api<WorkspacePage>(`/workspaces?limit=${WORKSPACE_PAGE_SIZE}${force ? '&refresh=1' : ''}`, { signal: controller.signal }),
        selected ? lookupWorkspace(selected.id, controller.signal) : Promise.resolve(null),
      ]);
      if (!current()) return;
      const exact = selection.status === 'fulfilled' ? selection.value : undefined;
      if (selected && !held && exact === null) {
        retainWorkspace(selected);
        pendingEditorAction.current = null; pendingNewConversation.current = false;
        setView('editor');
      } else if (held && exact) retainWorkspace(null);
      setBoot(previous => {
        if (!previous || !current()) return previous;
        const next = listing.status === 'fulfilled' ? applyWorkspacePage(previous, listing.value) : previous;
        if (exact) return applyWorkspace(next, exact, true);
        // A failed selected lookup retains the mounted workspace even if the
        // independently refreshed first page does not contain it.
        if (selection.status === 'rejected') return next;
        const location = readWindowLocation();
        // A rejected deep link deliberately has no selected workspace. A
        // background list refresh has no authority to choose a different one.
        if (!selected && (location.error || location.workspaceId)) return { ...next, activeWorkspace: null, activeWorkspaceId: null };
        if (!selected || exact === null) {
          const fallback = next.workspaces.find(item => item.id !== selected?.id) || null;
          return { ...next, workspaces: next.workspaces.filter(item => item.id !== selected?.id), activeWorkspace: fallback, activeWorkspaceId: fallback?.id || null };
        }
        return next;
      });
      const failure = selection.status === 'rejected' ? selection.reason : listing.status === 'rejected' ? listing.reason : null;
      setWorkspaceListError(failure ? `Could not refresh workspaces. ${getError(failure)}` : '');
    } catch (failure) {
      // A failed read cannot prove that a workspace disappeared.
      if (current()) setWorkspaceListError(`Could not refresh workspaces. ${getError(failure)}`);
    } finally {
      if (request === workspaceReadNumber.current && generation === sessionGeneration.current) { workspaceRead.current = null; setRefreshingWorkspaces(false); }
    }
  }, [retainWorkspace, setView]);
  useEffect(() => {
    if (auth !== 'ready') return;
    const refresh = () => { if (!document.hidden) void refreshWorkspaces(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 30_000);
    refresh();
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [auth, refreshWorkspaces]);
  useEffect(() => { if (workspaceDialogOpen) void refreshWorkspaces(); }, [workspaceDialogOpen, refreshWorkspaces]);
  useEffect(() => { if (!switchingWorkspace) void refreshWorkspaces(); }, [switchingWorkspace, refreshWorkspaces]);
  const beginWorkspaceMutation = useCallback(() => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true' || switchLock.current) return null;
    const generation = sessionGeneration.current;
    const operation = Symbol('workspace-operation');
    const controller = new AbortController();
    workspaceMutationRead.current = controller;
    workspaceOperation.current = operation; switchLock.current = true; setSwitchingWorkspace(true); invalidateWorkspaceRead();
    return {
      signal: controller.signal,
      current: () => !controller.signal.aborted && workspaceOperation.current === operation && generation === sessionGeneration.current && authRef.current === 'ready' && document.body.dataset.workspaceLocked !== 'true',
      finish: () => { if (workspaceOperation.current === operation) { workspaceOperation.current = null; workspaceMutationRead.current = null; switchLock.current = false; setSwitchingWorkspace(false); } },
    };
  }, [invalidateWorkspaceRead]);
  const activateWorkspace = useCallback(async (next: Workspace) => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true') return false;
    if (next.id === editorWorkspaceRef.current && !recoveryWorkspaceRef.current) return true;
    if (switchLock.current) return false;
    if (next.id !== editorWorkspaceRef.current && !canLeaveWorkspace()) return false;
    const operation = beginWorkspaceMutation();
    if (!operation) return false;
    try {
      const selected = await api<Workspace>(`/workspaces/${encodeURIComponent(next.id)}`, { ...json('PATCH', { active: true }), signal: operation.signal });
      if (!operation.current()) return false;
      setBoot(previous => previous ? applyWorkspace(previous, selected, true) : previous);
      retainWorkspace(null);
      setNavigationError('');
      return true;
    } finally { operation.finish(); }
  }, [beginWorkspaceMutation, canLeaveWorkspace, retainWorkspace]);
  useEffect(() => {
    if (auth !== 'ready') return;
    if (windowLocation.error) { setNavigationError(windowLocation.error); return; }
    const id = windowLocation.workspaceId;
    if (!id || id === editorWorkspaceRef.current || switchLock.current) return;
    const restoreLocation = () => { if (lastWindowLocation.current.workspaceId) writeWindowLocation(lastWindowLocation.current, true); };
    if (!canLeaveWorkspace()) { restoreLocation(); return; }
    const operation = beginWorkspaceMutation();
    if (!operation) return;
    void lookupWorkspace(id, operation.signal).then(selected => {
      if (!operation.current()) return;
      if (!selected) { setNavigationError('The workspace in this link is no longer available.'); restoreLocation(); return; }
      if (selected.id !== id) throw new Error('The workspace did not match this link.');
      setBoot(previous => previous ? applyWorkspace(previous, selected, true) : previous);
      retainWorkspace(null); setNavigationError('');
    }).catch(failure => {
      if (operation.current()) { setNavigationError(getError(failure)); restoreLocation(); }
    }).finally(operation.finish);
    return () => { if (operation.current()) workspaceMutationRead.current?.abort(); operation.finish(); };
  }, [windowLocation, auth, beginWorkspaceMutation, canLeaveWorkspace, retainWorkspace]);
  const worktreeWorkspaceReady = useCallback((next: Workspace) => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true') return;
    invalidateWorkspaceRead();
    setBoot(current => {
      if (!current || authRef.current !== 'ready') return current;
      return applyWorkspace(current, next);
    });
  }, [invalidateWorkspaceRead]);
  const worktreeWorkspaceArchived = useCallback((workspaceId: string) => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true') return;
    invalidateWorkspaceRead();
    setBoot(current => {
      if (!current || authRef.current !== 'ready' || current.activeWorkspaceId === workspaceId || editorWorkspaceRef.current === workspaceId) return current;
      return { ...current, workspaces: current.workspaces.filter(candidate => candidate.id !== workspaceId) };
    });
  }, [invalidateWorkspaceRead]);
  const workspaceRestored = useCallback((restored: Workspace) => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true') return;
    worktreeWorkspaceReady(restored);
    window.dispatchEvent(new CustomEvent('codex:workspace-changed', { detail: { workspaceId: restored.id, source: 'restore' } }));
    if (recoveryWorkspaceRef.current?.id === restored.id) void activateWorkspace(restored).catch(failure => notify(`Workspace restored, but it could not be reopened. ${getError(failure)}`, 'error'));
  }, [activateWorkspace, notify, worktreeWorkspaceReady]);
  const workspaceDeletionCompleted = useCallback(() => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true') return;
    invalidateWorkspaceRead(); void refreshWorkspaces();
  }, [invalidateWorkspaceRead, refreshWorkspaces]);
  const createWorkspace = async (name: string, initializeGit: boolean) => {
    if (switchLock.current || authRef.current !== 'ready') return false;
    if (!canLeaveWorkspace()) return false;
    const operation = beginWorkspaceMutation();
    if (!operation) return false;
    try {
      const created = await api<Workspace>('/workspaces', { ...json('POST', { name, initializeGit }), signal: operation.signal });
      if (!operation.current()) return false;
      const selected = await api<Workspace>(`/workspaces/${encodeURIComponent(created.id)}`, { ...json('PATCH', { active: true }), signal: operation.signal });
      if (!operation.current()) return false;
      setBoot(previous => previous ? applyWorkspace(previous, selected, true) : previous);
      retainWorkspace(null); setView('agent'); notify(`${created.name} is ready.`, 'success'); return true;
    } finally { operation.finish(); }
  };
  const renameWorkspace = async (item: Workspace, name: string) => {
    const operation = beginWorkspaceMutation();
    if (!operation) return;
    try {
      const updated = await api<Workspace>(`/workspaces/${encodeURIComponent(item.id)}`, { ...json('PATCH', { name }), signal: operation.signal });
      if (!operation.current()) return;
      setBoot(previous => previous ? applyWorkspace(previous, updated) : previous);
      notify('Workspace renamed.', 'success');
    } finally { operation.finish(); }
  };
  const deleteWorkspace = async (item: Workspace, plan: WorkspaceDeletionPlan) => {
    if (plan.workspaceId !== item.id) throw new Error('The deletion options no longer match this workspace. Review them again.');
    if (switchLock.current || authRef.current !== 'ready') return false;
    if (item.id === editorWorkspaceRef.current && !canLeaveWorkspace()) return false;
    const operation = beginWorkspaceMutation();
    if (!operation) return false;
    try {
      const result = await api<WorkspaceDeleteResult>(`/workspaces/${encodeURIComponent(item.id)}`, { ...json('DELETE', { expectedMode: plan.mode }), signal: operation.signal });
      if (!operation.current()) return false;
      const selected = recoveryWorkspaceRef.current || selectedWorkspace(bootRef.current);
      const [listing, selection] = await Promise.allSettled([
        api<WorkspacePage>(`/workspaces?limit=${WORKSPACE_PAGE_SIZE}`, { signal: operation.signal }),
        selected && selected.id !== item.id ? lookupWorkspace(selected.id, operation.signal) : Promise.resolve(null),
      ]);
      if (!operation.current()) return false;
      const exact = selection.status === 'fulfilled' ? selection.value : undefined;
      if (selected && selected.id !== item.id && exact === null) { retainWorkspace(selected); setView('editor'); pendingEditorAction.current = null; pendingNewConversation.current = false; }
      setBoot(previous => {
        if (!previous) return previous;
        const next = listing.status === 'fulfilled' ? applyWorkspacePage(previous, listing.value) : previous;
        const workspaces = next.workspaces.filter(candidate => candidate.id !== item.id && !(selected && selected.id !== item.id && exact === null && candidate.id === selected.id));
        if (exact) return applyWorkspace({ ...next, workspaces }, exact, true);
        if (selected && selected.id !== item.id && selection.status === 'rejected') return { ...next, workspaces };
        const fallback = workspaces[0] || null;
        return { ...next, workspaces, activeWorkspace: fallback, activeWorkspaceId: fallback?.id || null };
      });
      if (recoveryWorkspaceRef.current?.id === item.id) retainWorkspace(null);
      const failure = selection.status === 'rejected' ? selection.reason : listing.status === 'rejected' ? listing.reason : null;
      setWorkspaceListError(failure ? `The workspace was ${result.mode === 'trash' ? 'moved to trash' : 'deleted'}, but the list could not refresh. ${getError(failure)}` : '');
      notify(result.mode === 'permanent' ? 'Local workspace deleted permanently. The GitHub repository is unchanged.' : result.trash.canRestore ? 'Workspace moved to trash. Its saved files can be restored for 30 days.' : result.trash.state === 'missing' ? 'Workspace moved to trash. Its original files are missing.' : 'Workspace moved to trash. Open trash to review its recovery status.', 'success');
      return true;
    } finally { operation.finish(); }
  };
  const importedWorkspace = (imported: Workspace) => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true') return;
    worktreeWorkspaceReady(imported);
    void activateWorkspace(imported).then(selected => { if (selected) setView('editor'); }).catch(failure => notify(getError(failure), 'error'));
  };
  const saveSettings = async (patch: SettingsPatch) => {
    const generation = sessionGeneration.current, revision = ++settingsRevision.current;
    const settings = darkSettings(await api<AppSettings>('/settings', json('PATCH', patch)));
    if (generation !== sessionGeneration.current || authRef.current !== 'ready' || revision !== settingsRevision.current) return;
    setBoot(current => current ? { ...current, settings } : current);
    window.dispatchEvent(new Event('codex:settings-saved'));
    notify('Settings saved.', 'success');
  };
  const refreshGithubAccounts = useCallback(async () => {
    const generation = sessionGeneration.current;
    if (authRef.current !== 'ready') return;
    githubAccountsRead.current?.abort();
    const controller = new AbortController();
    githubAccountsRead.current = controller;
    try {
      const { accounts: githubAccounts, selected: _selectedAccount, ...githubAccountPage } = await api<GithubAccountPage>('/github/accounts?paged=1', { signal: controller.signal });
      if (controller.signal.aborted || generation !== sessionGeneration.current || authRef.current !== 'ready') return;
      setBoot(current => current ? { ...current, githubAccounts, githubAccountPage } : current);
    } catch (failure) { if (!controller.signal.aborted && generation === sessionGeneration.current && authRef.current === 'ready') notify(getError(failure), 'error'); }
    finally { if (githubAccountsRead.current === controller) githubAccountsRead.current = null; }
  }, [notify]);
  const openSettings = useCallback((tab: SettingsTab = 'agent') => { setSettingsTab(tab); setSettingsOpen(true); }, []);
  const openNativeTools = useCallback((section: ToolsSection = 'commands') => {
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true' || switchLock.current) return;
    if (!workspace || recoveryWorkspaceRef.current) { openWorkspaces(); return; }
    setSettingsOpen(false); setPaletteOpen(false);
    setNativeTools({ workspaceId: workspace.id, section });
  }, [workspace, openWorkspaces]);
  const login = async (password: string) => {
    if (lockRequest.current) throw new Error('Wait for the sign-out request to finish before signing in.');
    const generation = ++sessionGeneration.current;
    sessionRead.current?.abort();
    const controller = new AbortController(); sessionRead.current = controller;
    try {
      const current = recoveryWorkspaceRef.current || selectedWorkspace(bootRef.current);
      const session = await api<{ authenticated: boolean }>('/session', { ...json('POST', { password }), signal: controller.signal, timeoutMs: 20_000 });
      if (generation !== sessionGeneration.current) return;
      if (session?.authenticated !== true) throw new Error('The server could not confirm sign-in. Please try again.');
      const [bootstrap, selection] = await Promise.allSettled([
        api<Bootstrap>('/bootstrap', { signal: controller.signal }).then(value => resolveWindowWorkspace(value, readWindowLocation())),
        current ? lookupWorkspace(current.id, controller.signal) : Promise.resolve(null),
      ]);
      if (generation !== sessionGeneration.current) return;
      if (bootstrap.status === 'rejected') throw bootstrap.reason;
      const restored = bootstrap.value.boot;
      setNavigationError(bootstrap.value.error ?? '');
      const data = { ...restored, settings: darkSettings(restored.settings) };
      await hydrateUiState(data.uiState, hydrationWorkspaces(data, current));
      if (generation !== sessionGeneration.current) return;
      // Unlock resumes mounted buffers, including those whose files disappeared
      // while locked. A partial page never decides whether those files survived.
      if (current && selection.status === 'fulfilled' && selection.value) {
        retainWorkspace(null); setBoot(applyWorkspace(data, selection.value, true));
      } else if (current && selection.status === 'fulfilled') {
        retainWorkspace(current); setView('editor');
        setBoot(data);
      } else if (current) {
        // An unavailable selected lookup leaves its existing panes and recovery
        // state untouched. A later successful exact read can reconcile them.
        setBoot(recoveryWorkspaceRef.current ? data : applyWorkspace(data, current, true));
        setWorkspaceListError(`Could not check the current workspace. ${getError(selection.status === 'rejected' ? selection.reason : null)}`);
      } else { retainWorkspace(null); setBoot(data); }
      clearSessionLock(); setLockNotice('');
      authRef.current = 'ready'; setAuth('ready');
    } finally { if (sessionRead.current === controller) sessionRead.current = null; }
  };
  const lockWorkspace = (): Promise<void> => {
    if (lockRequest.current) return lockRequest.current;
    sessionGeneration.current++;
    sessionRead.current?.abort(); sessionRead.current = null;
    pendingEditorAction.current = null; void flushUiState();
    rememberSessionLock('pending'); setLockNotice(''); setLocking(true);
    authRef.current = 'locked'; setAuth('locked'); setSettingsOpen(false); setPaletteOpen(false); setWorkspaceDialogOpen(false);
    window.dispatchEvent(new Event('codex:session-lock-requested'));
    const pending = Promise.resolve().then(async () => {
      try {
        const result = await api<{ authenticated: boolean }>('/session', { ...json('DELETE'), timeoutMs: 20_000 });
        // A 401 from another in-flight read can also hide the interface while
        // this logout completes. Only this exact operation may confirm it.
        if (lockRequest.current !== pending) return;
        if (result?.authenticated !== false) throw new Error('The server could not confirm sign-out.');
        rememberSessionLock('confirmed'); setLockNotice('');
        window.dispatchEvent(new Event('codex:session-ended'));
      } catch (failure) {
        if (lockRequest.current === pending) setLockNotice(`${UNCONFIRMED_LOCK_MESSAGE} ${getError(failure)}`);
      } finally {
        if (lockRequest.current === pending) { lockRequest.current = null; setLocking(false); }
      }
    });
    lockRequest.current = pending;
    return pending;
  };
  const openTerminal = useCallback(() => { if (!workspace) { openWorkspaces(); return; } if (hasDock) setTerminalOpen((open) => !open); else setView('terminal'); }, [workspace, hasDock, openWorkspaces]);
  const closeLastTerminal = useCallback((workspaceId: string) => {
    if (workspaceId !== editorWorkspaceRef.current || switchLock.current) return;
    setTerminalOpen(false);
    setVisitedPanes(current => { const next = new Set(current); next.delete('terminal'); return next; });
    if (window.innerWidth < 1000) setView('editor');
  }, [setView]);
  const requestEditorAction = useCallback((type: EditorActionType, detail: EditorActionDetail = {}) => {
    const workspaceId = editorWorkspaceRef.current;
    if (!workspaceId || authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true' || switchLock.current || (detail.workspaceId !== undefined && detail.workspaceId !== workspaceId)) return;
    const toolbar = editorToolbarRef.current;
    const ready = toolbar?.ready && toolbar.workspaceId === workspaceId ? toolbar : null;
    const scope: EditorCommandScope | null = ready ? { workspaceId, editorInstanceId: ready.editorInstanceId, generation: ready.generation } : null;
    if (detail.editorInstanceId !== undefined && detail.editorInstanceId !== scope?.editorInstanceId) return;
    if (detail.generation !== undefined && detail.generation !== scope?.generation) return;
    const mutation = type === 'codex:save-file' || type === 'codex:toggle-explorer';
    const bindInitialEditor = !scope && !mutation && !editorLifetime.current.readyPublished;
    if (!scope && !bindInitialEditor) return;
    if (type === 'codex:save-file' && (!ready || ready.saveDisabled || detail.path !== ready.activePath)) return;
    if (type === 'codex:toggle-explorer' && (!ready || ready.explorerToggleDisabled)) return;
    pendingEditorAction.current = { type, workspaceId, detail: { ...detail, workspaceId }, scope, bindInitialEditor };
    if (!mutation) setView('editor');
    requestAnimationFrame(flushEditorAction);
  }, [flushEditorAction, setView]);
  const openFile = useCallback((path: string, location?: { line: number; column?: number }) => requestEditorAction('codex:open-file', { path, ...location, workspaceId: workspace?.id }), [requestEditorAction, workspace?.id]);
  const openEditorWindow = useCallback(() => {
    if (!workspace || recoveryWorkspaceRef.current) { openWorkspaces(); return; }
    if (authRef.current !== 'ready' || document.body.dataset.workspaceLocked === 'true' || switchLock.current) return;
    window.open(windowLink({ workspaceId: workspace.id, threadId: windowThreadId, view: 'editor' }), '_blank', 'noopener,noreferrer');
  }, [workspace, windowThreadId, openWorkspaces]);
  const openChange = useCallback((target: ChangeReviewTarget) => {
    if (!validChangeReviewTarget(target) || target.workspaceId !== editorWorkspaceRef.current || authRef.current !== 'ready'
      || document.body.dataset.workspaceLocked === 'true' || switchLock.current || recoveryWorkspaceRef.current) return;
    pendingEditorAction.current = null;
    setChangeReview({ target: { ...target }, sequence: ++changeReviewSequence.current });
    setView('editor');
  }, [setView]);
  const quickOpen = useCallback(() => { if (!workspace) { openWorkspaces(); return; } requestEditorAction('codex:quick-open', { workspaceId: workspace.id }); }, [workspace, requestEditorAction, openWorkspaces]);
  const searchFiles = useCallback(() => { if (!workspace) { openWorkspaces(); return; } requestEditorAction('codex:search-files', { workspaceId: workspace.id }); }, [workspace, requestEditorAction, openWorkspaces]);
  const saveEditorFile = useCallback(() => {
    const current = editorToolbarRef.current;
    if (!current?.ready || current.saveDisabled || !current.activePath || recoveryWorkspaceRef.current) return;
    requestEditorAction('codex:save-file', { workspaceId: current.workspaceId, editorInstanceId: current.editorInstanceId, generation: current.generation, path: current.activePath });
  }, [requestEditorAction]);
  const toggleEditorExplorer = useCallback(() => {
    const current = editorToolbarRef.current;
    if (!current?.ready || current.explorerToggleDisabled) return;
    requestEditorAction('codex:toggle-explorer', { workspaceId: current.workspaceId, editorInstanceId: current.editorInstanceId, generation: current.generation });
  }, [requestEditorAction]);
  const newConversation = useCallback(() => { if (!workspace || recoveryWorkspaceRef.current) { openWorkspaces(); return; } pendingNewConversation.current = true; setView('agent'); requestAnimationFrame(flushNewConversation); }, [workspace, flushNewConversation, openWorkspaces]);
  const toggleSplit = () => { const next = split ? 'focus' : 'split'; setSplitPreference(next); };
  const toggleAgentPane = () => {
    setView(showAgent ? 'editor' : 'agent');
    if (hasDock) setSplitPreference(showAgent ? 'focus' : 'split');
  };
  const toggleEditorPane = () => {
    setView(showEditor ? 'agent' : 'editor');
    if (hasDock) setSplitPreference(showEditor ? 'focus' : 'split');
  };
  const navigate = (next: View) => { if (next === 'terminal') { openTerminal(); return; } setView(next); };

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (auth !== 'ready' || event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const recognized = (key === 'k' && !event.shiftKey) || key === ',' || (key === 'p' && !event.shiftKey) || (key === 'f' && event.shiftKey) || key === '`';
      if (!recognized) return;
      event.preventDefault(); event.stopPropagation();
      if (key === 'k') setPaletteOpen((open) => !open);
      else if (key === ',') setSettingsOpen((open) => !open);
      else if (key === 'p') quickOpen();
      else if (key === 'f') searchFiles();
      else if (key === '`') openTerminal();
    };
    window.addEventListener('keydown', shortcuts, true); return () => window.removeEventListener('keydown', shortcuts, true);
  }, [auth, quickOpen, searchFiles, openTerminal]);

  const actions = useMemo<CommandAction[]>(() => [
    { id: 'new-thread', label: 'New conversation', description: 'Start fresh with Claude', Icon: SquarePen, onSelect: newConversation },
    { id: 'quick-open', label: 'Open a file', description: 'Find a file in the current workspace', Icon: Search, shortcut: `${mod} P`, onSelect: quickOpen },
    { id: 'search-files', label: 'Search in files', description: 'Find text across the current workspace', Icon: Search, shortcut: `${mod} ⇧ F`, onSelect: searchFiles },
    { id: 'workspace', label: 'Switch or create a workspace', description: 'Choose where you work', Icon: FolderOpen, onSelect: () => openWorkspaces() },
    { id: 'terminal', label: 'Toggle terminal', description: 'A shell in your current workspace', Icon: Terminal, shortcut: `${mod} \``, onSelect: openTerminal },
    { id: 'agent', label: 'Go to Claude', Icon: MessageSquare, onSelect: () => setView('agent') },
    { id: 'editor', label: 'Go to editor', Icon: Code2, onSelect: () => setView('editor') },
    { id: 'source', label: 'Review source control', description: 'Stage, commit, and push your changes', Icon: GitBranch, onSelect: () => setView('git') },
    { id: 'github', label: 'Import from GitHub', description: 'Connect accounts and browse repositories', Icon: Github, onSelect: () => setView('github') },
    { id: 'claude-commands', label: 'Slash commands & skills', description: 'Browse the commands Claude Code can run here', Icon: Sparkles, onSelect: () => openNativeTools('commands') },
    { id: 'claude-agents', label: 'Subagents', description: 'Agents Claude can delegate work to', Icon: Users, onSelect: () => openNativeTools('agents') },
    { id: 'claude-mcp', label: 'MCP servers', description: 'Connected tools and integrations', Icon: Plug, onSelect: () => openNativeTools('mcp') },
    { id: 'claude-memory', label: 'Claude memory (CLAUDE.md)', description: 'Instructions Claude follows in every workspace', Icon: FileSearch, onSelect: () => openNativeTools('memory') },
    { id: 'claude-sessions', label: 'Import Claude Code sessions', description: 'Open sessions started from the terminal', Icon: ListTodo, onSelect: () => openNativeTools('sessions') },
    { id: 'editor-window', label: 'Open editor in a new window', description: 'Keep this workspace open in a separate editor view', Icon: ExternalLink, onSelect: openEditorWindow },
    { id: 'claude-settings', label: 'Claude settings', description: 'Model, effort, thinking, and permissions', Icon: Settings2, onSelect: () => openSettings('agent') },
    { id: 'settings', label: 'Open settings', description: 'Claude Code, permissions, MCP, and appearance', Icon: Settings, shortcut: `${mod} ,`, onSelect: () => openSettings() },
    { id: 'lock', label: 'Lock workspace', description: 'Require your password to continue', Icon: LockKeyhole, onSelect: () => { void lockWorkspace().catch((failure) => notify(getError(failure), 'error')); } },
  ], [newConversation, quickOpen, searchFiles, openTerminal, openSettings, openWorkspaces, openNativeTools, openEditorWindow, notify]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return; event.preventDefault(); const startY = event.clientY; const startHeight = terminalHeight;
    document.body.classList.add('resizing-terminal');
    const move = (pointer: PointerEvent) => setTerminalHeight(Math.max(130, Math.min(window.innerHeight * .68, startHeight + startY - pointer.clientY)));
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', cleanup); window.removeEventListener('pointercancel', cleanup); document.body.classList.remove('resizing-terminal'); dividerCleanup.current = null; };
    dividerCleanup.current?.(); dividerCleanup.current = cleanup; window.addEventListener('pointermove', move); window.addEventListener('pointerup', cleanup); window.addEventListener('pointercancel', cleanup);
  };

  if (!boot && (auth === 'checking' || auth === 'error')) return <LoadingScreen error={auth === 'error' ? bootError : undefined} onRetry={() => void checkSession()} />;
  const selectedNav = navItems.find((item) => item.id === view)!;
  const appStyle = { '--terminal-height': `${terminalHeight}px` } as CSSProperties;
  return <>
    {boot && <div className={`app-shell sidebar-compact ${independentWindow.current ? 'window-view' : ''} layout-${isMobile ? 'mobile' : isTablet ? 'tablet' : isLaptop ? 'laptop' : 'desktop'}`} style={appStyle} inert={auth !== 'ready'} aria-hidden={auth !== 'ready' ? true : undefined}>
      <aside className="app-sidebar" aria-label="Workspace navigation">
        <nav className="main-nav" aria-label="Main navigation">{navItems.map(({ id, label, Icon }) => {
          const paneVisible = id === 'agent' ? showAgent : id === 'editor' ? showEditor : undefined;
          const active = paneVisible ?? (view === id || (id === 'terminal' && hasDock && terminalOpen));
          const title = paneVisible === undefined ? label : `${paneVisible ? 'Hide' : 'Show'} ${id === 'agent' ? 'Claude' : 'editor'}`;
          return <button key={id} className={`nav-item ${id === 'git' ? 'nav-group-start' : ''} ${active ? 'active' : ''}`} title={title} aria-label={label} aria-pressed={paneVisible} aria-controls={paneVisible === undefined ? undefined : `${id}-workbench`} aria-current={paneVisible === undefined && view === id ? 'page' : undefined} onClick={() => id === 'agent' ? toggleAgentPane() : id === 'editor' ? toggleEditorPane() : navigate(id)}><Icon size={20} strokeWidth={1.7} /></button>;
        })}</nav>
        <div className="sidebar-bottom"><div className="sidebar-bottom-actions"><button className="sidebar-settings" onClick={() => openSettings()} aria-label="Settings" title={`Settings (${mod} ,)`}><Settings size={19} /></button><button className="icon-button lock-button" onClick={() => void lockWorkspace().catch((failure) => notify(getError(failure), 'error'))} aria-label="Lock workspace" title="Lock workspace"><LockKeyhole size={16} /></button></div></div>
      </aside>
      <div className="app-main">
        <header className={`app-topbar ${showEditor ? 'has-editor-actions' : ''}`}>
          <div className="topbar-location">
            <Logo size={22} label="Arc Workspace" />
            <button className="topbar-workspace" onClick={() => openWorkspaces()} disabled={switchingWorkspace} aria-busy={switchingWorkspace || undefined}
              aria-label={activeWorkspace ? `Switch workspace. Current workspace: ${activeWorkspace.name}` : 'Choose or create a workspace'} data-tooltip={activeWorkspace ? `Switch workspace · ${activeWorkspace.name}` : 'Switch workspace'} aria-haspopup="dialog" aria-expanded={workspaceDialogOpen}>
              {switchingWorkspace ? <Loader2 size={16} className="workspace-launcher-icon spin" aria-hidden="true" /> : <FolderOpen size={16} className="workspace-launcher-icon" aria-hidden="true" />}<span>{recoveryWorkspace ? 'Recover open files' : activeWorkspace?.name || 'Your workspace'}</span><ChevronDown size={14} aria-hidden="true" />
            </button>
            <span className="sr-only" role="status">{switchingWorkspace ? 'Updating workspace…' : ''}</span>
            <span className="topbar-slash">/</span><span className="topbar-page">{selectedNav.label}{independentWindow.current ? ' window' : ''}</span>
          </div>
          <div className="topbar-actions">
            {showEditor && <div className="topbar-editor-actions" role="group" aria-label="Editor controls">
              <button className="app-editor-quick-open" onClick={quickOpen} aria-label="Go to file" title={`Go to file (${mod} P)`}><Search size={16} /><span>Go to file</span><kbd>{mod} P</kbd></button>
              <button className={`button app-editor-save ${editorToolbar?.dirty ? 'is-dirty' : ''}`} onClick={saveEditorFile} disabled={!!recoveryWorkspace || !editorToolbar?.ready || editorToolbar.saveDisabled} aria-label="Save" aria-busy={editorToolbar?.saving || undefined} title={recoveryWorkspace ? 'Restore this workspace before saving' : editorToolbar?.hasConflict ? 'Resolve the file conflict before saving' : editorToolbar?.missing ? 'Restore the file before saving' : `Save file (${mod} S)`}>{editorToolbar?.saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}<span>Save</span>{editorToolbar?.dirty && <span className="app-editor-dirty-dot" aria-hidden="true" />}</button>
              {!isMobile && <button className={`icon-button app-editor-explorer ${editorToolbar?.explorerVisible ? 'is-active' : ''}`} onClick={toggleEditorExplorer} disabled={!editorToolbar?.ready || editorToolbar.explorerToggleDisabled} aria-pressed={editorToolbar?.explorerVisible ?? false} aria-label={editorToolbar?.explorerVisible ? 'Hide files' : 'Show files'} title={editorToolbar?.explorerVisible ? 'Hide files' : 'Show files'}>{editorToolbar?.explorerVisible ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>}
              {hasDock && workspace && !recoveryWorkspace && <a className="icon-button app-window-link" href={windowLink({ workspaceId: workspace.id, threadId: windowThreadId, view: 'editor' })}
                target="_blank" rel="noopener noreferrer" aria-label="Open editor in new window" title="Open editor in new window"><ExternalLink size={15} /></a>}
            </div>}
            {hasDock && codingView && workspace && !recoveryWorkspace && <div className="topbar-view-controls" role="group" aria-label="Panel layout">
              <button className={`icon-button split-toggle ${split ? 'is-active' : ''}`} onClick={toggleSplit} aria-pressed={split} aria-controls="workspace-stage" aria-label={split ? 'Focus on one panel' : 'Show editor and agent side by side'} title={split ? 'Focus on one panel' : 'Show editor and agent side by side'}><Columns2 size={17} /><span className="split-toggle-label">Split view</span></button>
            </div>}
            <div className="topbar-utilities">
            {isMobile ? <DropdownMenu align="end" aria-label="Workspace actions" trigger={<button className="icon-button topbar-overflow" aria-label="Workspace actions" title="Workspace actions"><MoreHorizontal size={20} /></button>} items={[
              ...(showEditor ? [
                { id: 'files', label: editorToolbar?.explorerVisible ? 'Hide files' : 'Show files', icon: <FolderOpen size={16} />, disabled: !editorToolbar?.ready || editorToolbar.explorerToggleDisabled, onSelect: toggleEditorExplorer },
                { id: 'editor-window', label: 'Open editor in new window', icon: <ExternalLink size={16} />, disabled: !!recoveryWorkspace, onSelect: openEditorWindow },
                { type: 'separator' as const, id: 'workspace' },
              ] : []),
              { id: 'tools', label: 'Claude tools', icon: <Wrench size={16} />, disabled: !workspace || !!recoveryWorkspace, onSelect: () => openNativeTools() },
              { id: 'commands', label: 'Search commands', icon: <Search size={16} />, shortcut: `${mod} K`, onSelect: () => setPaletteOpen(true) },
              { id: 'settings', label: 'Settings', icon: <Settings size={16} />, shortcut: `${mod} ,`, onSelect: () => openSettings() },
              { type: 'separator', id: 'session' },
              { id: 'lock', label: 'Lock workspace', icon: <LockKeyhole size={16} />, onSelect: () => { void lockWorkspace().catch(failure => notify(getError(failure), 'error')); } },
            ]} /> : <>
              <button className="topbar-tools" onClick={() => openNativeTools()} disabled={!workspace || !!recoveryWorkspace || switchingWorkspace} aria-label="Claude tools" aria-haspopup="dialog" title="Claude tools: commands, agents, MCP, memory"><Wrench size={17} /><span>Claude tools</span></button>
              <button className="command-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search commands" aria-haspopup="dialog" title={`Search commands (${mod} K)`}><Search size={16} /><span>Commands</span><kbd>{mod} K</kbd></button>
            </>}
            </div>
          </div>
        </header>
        {!online && <div className="connection-banner" role="status"><WifiOff size={14} />You’re offline. Your open files are still here; reconnect to save or run commands.</div>}
        {navigationError && <div className="connection-banner window-link-error" role="alert"><CircleAlert size={14} /><span>{navigationError}</span><button type="button" className="button small" onClick={() => openWorkspaces()}>Choose workspace</button><button type="button" className="icon-button" onClick={() => setNavigationError('')} aria-label="Dismiss link error"><X size={14} /></button></div>}
        {online && uiState.message && <div className="connection-banner" role="status"><CircleAlert size={14} /><span>{uiState.message}</span>{uiState.pending > 0 && <button className="button small" onClick={retryUiState}>Retry</button>}<button className="icon-button" onClick={dismissUiStateNotice} aria-label="Dismiss preference notice"><X size={14} /></button></div>}
        {recoveryWorkspace && <div className="workspace-recovery-banner" role="status"><CircleAlert size={17} /><div className="workspace-recovery-copy"><strong>{recoveryWorkspace.name} is no longer available.</strong><p>Your open editor buffers and chat drafts are kept in this tab. Copy unsaved text before leaving, or restore the workspace from trash if its files are available. Existing terminals remain available to close. Reloading will lose these unsaved contents.</p></div><div className="workspace-recovery-actions"><button className="button" onClick={() => openWorkspaces('trash')}>Open workspace trash</button><button className="button ghost" onClick={() => openWorkspaces()}>Choose workspace</button></div></div>}
        <main className={`workbench ${showAgent && showEditor ? 'is-split' : ''} ${showTerminal ? 'with-terminal' : ''}`} aria-label="Workspace" aria-busy={switchingWorkspace || undefined}>
          <div id="workspace-stage" ref={paneSizing.stageRef} className={`workbench-stage ${paneSizing.enabled ? 'workbench-stage-resizable' : ''}`} style={paneSizing.stageStyle} hidden={!hasDock && view === 'terminal'}>
            {workspace && <>
              <section id="agent-workbench" className="workbench-pane agent-pane" hidden={!showAgent} inert={!!recoveryWorkspace || switchingWorkspace} aria-label="Claude conversation">{(showAgent || visitedPanes.has('agent')) && <LazyPanel key={workspace.id} label="Claude"><ChatPanel workspace={workspace} settings={boot.settings} onSettings={(tab = 'agent') => openSettings(tab as SettingsTab)} onNotify={notify} onOpenFile={openFile} onOpenChange={openChange} /><PanelMountSignal onMount={chatMounted} /></LazyPanel>}</section>
              {paneSizing.enabled && <PaneSplitter {...paneSizing.agentControl} label="Resize agent and editor" controls="agent-workbench editor-workbench" />}
              <section id="editor-workbench" className="workbench-pane editor-pane" hidden={!showEditor} aria-label="Code editor">{(showEditor || visitedPanes.has('editor')) && <LazyPanel key={workspace.id} label="editor"><EditorPanel workspace={workspace} settings={boot.settings} onNotify={notify} onToolbarStateChange={onEditorToolbarStateChange} paneSizing={paneSizing.editorSizing} changeReview={changeReview} visible={showEditor && !switchingWorkspace} /><PanelMountSignal onMount={editorMounted} /></LazyPanel>}</section>
              <section className="workbench-pane git-pane" hidden={!!recoveryWorkspace || view !== 'git'} inert={!!recoveryWorkspace || switchingWorkspace} aria-label="Source control">{((!recoveryWorkspace && view === 'git') || visitedPanes.has('git')) && <LazyPanel key={workspace.id} label="source control"><GitPanel workspace={workspace} onNotify={notify} onOpenFile={openFile} /></LazyPanel>}</section>
            </>}
            <section className="workbench-pane github-pane" hidden={view !== 'github'} aria-label="GitHub repositories">{(view === 'github' || visitedPanes.has('github')) && <LazyPanel label="repositories"><GithubPanel onImported={importedWorkspace} onNotify={notify} onAccountsChanged={() => { void refreshGithubAccounts(); }} /></LazyPanel>}</section>
            {!workspace && view !== 'github' && <section className="workspace-welcome"><div className="welcome-symbol"><Logo size={38} /></div><span className="eyebrow">Arc Workspace</span><h1>Open a workspace.</h1><p>Create a workspace or import a GitHub repository.<br />Keep your files, terminal sessions, and agent threads together.</p><div className="welcome-actions"><button className="welcome-action" onClick={() => openWorkspaces()}><span><FolderPlus size={23} /></span><strong>Create a workspace</strong><p>Start a new project</p><ArrowRight size={18} /></button><button className="welcome-action" onClick={() => setView('github')}><span><Github size={23} /></span><strong>Import a repository</strong><p>Work with an existing project</p><ArrowRight size={18} /></button></div>{!boot.settings.agentConfigured && <p className="welcome-agent-connect" role="status"><CircleAlert size={15} />Claude is not configured. Add the PASSWORD Space secret.</p>}</section>}
          </div>
          {workspace && <section className="terminal-dock" hidden={!showTerminal} aria-label="Workspace terminal">{hasDock && <div className="terminal-resize-handle" role="separator" aria-label="Resize terminal" aria-orientation="horizontal" aria-valuenow={terminalHeight} aria-valuemin={130} aria-valuemax={Math.round(window.innerHeight * .68)} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setTerminalHeight((height) => Math.max(130, Math.min(window.innerHeight * .68, height + (event.key === 'ArrowUp' ? 30 : -30)))); } }}><span /></div>}{(showTerminal || visitedPanes.has('terminal')) && <LazyPanel key={workspace.id} label="terminal"><TerminalPanel workspace={workspace} onNotify={notify} onCloseLast={closeLastTerminal} existingSessionsOnly={!!recoveryWorkspace} /></LazyPanel>}</section>}
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{navItems.map(({ id, mobile, Icon }) => <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><span><Icon size={21} strokeWidth={1.7} /></span><span>{mobile}</span></button>)}</nav>
      {settingsOpen && <SettingsDialog open onClose={() => setSettingsOpen(false)} settings={boot.settings} onSave={saveSettings} onLogout={lockWorkspace} initialTab={settingsTab} workspaceId={workspace?.id} />}
      <WorkspaceSwitcher open={workspaceDialogOpen} onClose={() => setWorkspaceDialogOpen(false)} workspaces={boot.workspaces} workspacePage={boot.workspacePage} currentWorkspace={recoveryWorkspace ? null : activeWorkspace} activeWorkspaceId={recoveryWorkspace ? null : activeWorkspace?.id || null} onSelect={activateWorkspace} onCreate={createWorkspace} onRename={renameWorkspace} onDelete={deleteWorkspace} onWorkspaceRestored={workspaceRestored} onWorkspaceDeletionCompleted={workspaceDeletionCompleted} initialSection={workspaceDialogSection} refreshing={refreshingWorkspaces} listError={workspaceListError} onRefresh={() => refreshWorkspaces(true)} onImport={() => setView('github')} onWorktreeWorkspaceReady={worktreeWorkspaceReady} onWorktreeWorkspaceArchived={worktreeWorkspaceArchived} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={actions} />
      {nativeTools && auth === 'ready' && nativeTools.workspaceId === workspace?.id && !recoveryWorkspace && !switchingWorkspace && workspace && <WorkspaceToolsBoundary key={`${nativeTools.workspaceId}:${nativeTools.section}`} onClose={closeNativeTools}>
        <Suspense fallback={<Modal open title="Claude tools" titleId="workspace-tools-loading" onClose={closeNativeTools}><PanelLoading label="Claude tools" /></Modal>}>
          <ClaudeToolsDialog workspace={workspace} initialSection={nativeTools.section} onClose={closeNativeTools} onNotify={notify} onOpenSettings={tab => { closeNativeTools(); openSettings(tab as SettingsTab); }} />
        </Suspense>
      </WorkspaceToolsBoundary>}
    </div>}
    {auth === 'locked' && <LoginScreen onLogin={login} overlay={Boolean(boot)} lockNotice={lockNotice} locking={locking} onRetryLock={() => { void lockWorkspace(); }} />}
    {auth === 'checking' && boot && <div className="session-loading-overlay"><LoadingStatus label="Checking your session…" /></div>}
    <DownloadProgress active={auth === 'ready'} />
    <ToastStack notices={auth === 'ready' ? notices : []} limit={isMobile ? 1 : isTablet ? 2 : 3} onDismiss={dismissNotice} />
  </>;
}
