import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { AlertCircle, Archive, ArchiveRestore, ArrowDown, Check, ClipboardList, Code2, ExternalLink, FolderOpen, GitFork, Lightbulb, ListTodo, LoaderCircle, MoreHorizontal, PencilLine, Pin, PinOff, Plus, Settings2, Sparkles, Trash2, Bug, WifiOff, X } from 'lucide-react';
import type { AppSettings, Workspace } from '../../shared/types';
import type { ClaudeAttachment, ClaudeConversation, ClaudeConversationSummary, ClaudeEntry, ClaudeNativeSession } from '../../shared/claude';
import { api, json } from '../api';
import { getUiThread, setUiThread } from '../ui-state';
import { useWindowLocation, windowLink, writeWindowLocation, readWindowLocation } from '../window-navigation';
import type { OpenChange } from './editor/change-review';
import { ConversationHeader } from './chat/ConversationHeader';
import { ConversationSkeleton } from './ui/Loading';
import { DropdownMenu } from './ui/Dropdown';
import Modal from './Modal';
import { useConversation } from './claude/useConversation';
import { Timeline } from './claude/Timeline';
import { RequestCard, type RequestAnswer } from './claude/RequestCards';
import { HistoryPanel } from './claude/HistoryPanel';
import { Composer, type ComposerSettings } from './claude/Composer';
import { TodoList } from './claude/ToolCard';
import { WorkingIndicator } from './claude/Working';
import { useClaudeCapabilities, useClaudeModels } from './claude/catalog';
import './chat.css';
import './claude/claude.css';

export interface ChatPanelProps {
  workspace: Workspace; settings: AppSettings; onSettings: (section?: string) => void;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  onOpenFile?: (path: string, location?: { line: number; column?: number }) => void;
  onOpenChange?: OpenChange;
}
type UserEntry = Extract<ClaudeEntry, { kind: 'user' }>;
const DRAFT_KEY = '$new';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const statusLabel: Record<string, string> = {
  starting: 'Starting Claude Code', requesting: 'Waiting for Claude', responding: 'Writing', thinking: 'Thinking', tool: 'Working', awaiting: 'Waiting for you',
  compacting: 'Compacting conversation', retrying: 'Retrying', stopping: 'Stopping',
};

function draftsStore() {
  try { return JSON.parse(sessionStorage.getItem('claude-drafts') || '{}') as Record<string, string>; } catch { return {}; }
}

export default function ChatPanel({ workspace, settings, onSettings, onNotify, onOpenFile }: ChatPanelProps) {
  const windowLocation = useWindowLocation();
  const requested = !windowLocation.error && windowLocation.workspaceId === workspace.id ? windowLocation.threadId : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(() => requested ?? getUiThread(workspace.id) ?? null);
  const [items, setItems] = useState<ClaudeConversationSummary[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(draftsStore);
  const [attachments, setAttachments] = useState<Record<string, ClaudeAttachment[]>>({});
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ClaudeConversationSummary | null>(null);
  const [rewind, setRewind] = useState<{ entry: UserEntry; edit: boolean } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const defaults: ComposerSettings = useMemo(() => ({
    model: settings.claude?.model || settings.model, effort: settings.claude?.effort ?? null, thinking: settings.claude?.thinking ?? true, permissionMode: settings.claude?.permissionMode ?? 'default',
  }), [settings.claude?.model, settings.model, settings.claude?.effort, settings.claude?.thinking, settings.claude?.permissionMode]);
  const [newSettings, setNewSettings] = useState<ComposerSettings>(defaults);
  useEffect(() => setNewSettings(defaults), [defaults]);
  const { models, loading: modelsLoading } = useClaudeModels();
  const { capabilities } = useClaudeCapabilities(workspace.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [away, setAway] = useState(false);

  const filesChanged = useCallback(() => window.dispatchEvent(new CustomEvent('codex:files-changed', { detail: { workspaceId: workspace.id, source: 'claude' } })), [workspace.id]);
  const onDone = useCallback((error?: string) => { setStopping(false); filesChanged(); if (error) onNotify(error, 'error'); }, [onNotify, filesChanged]);
  const { conversation, setConversation, live, permissions, connection, loadError, reconnect } = useConversation(selectedId, onDone);
  const current = conversation?.id === selectedId ? conversation : null;
  const draftKey = selectedId ?? DRAFT_KEY;
  const draft = drafts[draftKey] ?? '';
  const draftAttachments = attachments[draftKey] ?? [];
  const composerSettings: ComposerSettings = current ? { model: current.model, effort: current.effort, thinking: current.thinking, permissionMode: current.permissionMode } : newSettings;
  const running = live.running;
  // Refresh the explorer and source control as Claude edits files.
  const mutations = current?.entries.filter(entry => entry.kind === 'tool' && entry.status === 'success' && ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'].includes(entry.name)).length ?? 0;
  useEffect(() => { if (!mutations) return; const timer = setTimeout(filesChanged, 400); return () => clearTimeout(timer); }, [mutations, filesChanged]);

  useEffect(() => { try { sessionStorage.setItem('claude-drafts', JSON.stringify(Object.fromEntries(Object.entries(drafts).filter(([, value]) => value)))); } catch { /* Drafts stay in memory. */ } }, [drafts]);

  // Conversation list plus a live summary stream for this workspace.
  const refreshItems = useCallback(async () => {
    setItemsError(null);
    try { setItems(await api<ClaudeConversationSummary[]>(`/claude/conversations?workspaceId=${encodeURIComponent(workspace.id)}`)); }
    catch (error) { setItemsError(errorText(error)); }
    finally { setItemsLoading(false); }
  }, [workspace.id]);
  useEffect(() => {
    void refreshItems();
    let source: EventSource | null = null, timer: ReturnType<typeof setTimeout> | undefined, closed = false;
    const connect = () => {
      source = new EventSource(`/api/claude/events?workspaceId=${encodeURIComponent(workspace.id)}`);
      source.onmessage = message => {
        const event = JSON.parse(message.data) as ClaudeConversationSummary | { id: string; deleted: true } | { type: 'ready' };
        if ('type' in event) return;
        if ('deleted' in event) { setItems(list => list.filter(item => item.id !== event.id)); return; }
        setItems(list => [event, ...list.filter(item => item.id !== event.id)].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt)));
      };
      source.onerror = () => { source?.close(); if (!closed) { timer = setTimeout(() => { void refreshItems(); connect(); }, 4000); } };
    };
    connect();
    return () => { closed = true; source?.close(); clearTimeout(timer); };
  }, [workspace.id, refreshItems]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id); setHistoryOpen(false); following.current = true;
    setUiThread(workspace.id, id);
    const location = readWindowLocation();
    if (location.workspaceId === workspace.id && location.threadId !== undefined) writeWindowLocation({ ...location, threadId: id ?? undefined }, true);
  }, [workspace.id]);
  useEffect(() => { if (requested !== undefined && requested !== selectedId) setSelectedId(requested); }, [requested]);
  useEffect(() => { if (loadError) select(null); }, [loadError]);
  useEffect(() => {
    const create = () => select(null);
    window.addEventListener('codex:new-thread', create);
    return () => window.removeEventListener('codex:new-thread', create);
  }, [select]);

  // Follow streaming output unless the reader scrolled up.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [current?.entries, permissions, live.status]);
  useEffect(() => { following.current = true; setAway(false); requestAnimationFrame(() => { const element = scrollRef.current; if (element) element.scrollTop = element.scrollHeight; }); }, [selectedId]);
  const onScroll = () => {
    const element = scrollRef.current; if (!element) return;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    following.current = atEnd; setAway(!atEnd);
  };
  const jump = () => { const element = scrollRef.current; if (element) { element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); following.current = true; setAway(false); } };

  const setDraft = (value: string) => setDrafts(previous => ({ ...previous, [draftKey]: value }));
  const setDraftAttachments = (value: ClaudeAttachment[]) => setAttachments(previous => ({ ...previous, [draftKey]: value }));

  async function patchConversation(id: string, patch: Record<string, unknown>) {
    try {
      const summary = await api<ClaudeConversationSummary>(`/claude/conversations/${id}`, json('PATCH', patch));
      setItems(list => list.map(item => item.id === id ? summary : item));
    } catch (error) { onNotify(errorText(error), 'error'); }
  }
  function changeSettings(patch: Partial<ComposerSettings>) {
    if (!current) { setNewSettings(previous => ({ ...previous, ...patch })); return; }
    setConversation(previous => previous ? { ...previous, ...patch } : previous);
    void patchConversation(current.id, patch);
    if (patch.permissionMode && running) onNotify(`Switched to ${patch.permissionMode === 'acceptEdits' ? 'accept edits' : patch.permissionMode === 'bypassPermissions' ? 'bypass permissions' : patch.permissionMode} mode for this turn.`, 'info');
  }

  async function send(mode: 'steer' | 'queue' = 'steer') {
    const text = draft.trim();
    if ((!text && !draftAttachments.length) || sending) return;
    if (text === '/clear' || text === '/new') { setDraft(''); select(null); return; }
    setSending(true);
    try {
      let id = current?.id;
      if (!id) {
        const created = await api<ClaudeConversation>('/claude/conversations', json('POST', { workspaceId: workspace.id, ...newSettings }));
        id = created.id;
        setDrafts(previous => ({ ...previous, [DRAFT_KEY]: '' })); setAttachments(previous => ({ ...previous, [DRAFT_KEY]: [] }));
        setConversation(created);
        select(created.id);
      }
      const result = await api<{ queued?: boolean; steered?: boolean }>(`/claude/conversations/${id}/messages`, json('POST', { text, mode, attachments: draftAttachments.map(item => ({ id: item.id })), ...composerSettings }));
      setDrafts(previous => ({ ...previous, [id!]: '', [draftKey]: '' })); setAttachments(previous => ({ ...previous, [id!]: [], [draftKey]: [] }));
      following.current = true;
      if (result.queued) onNotify('Queued. Claude will read it when the current turn finishes.', 'info');
      else if (result.steered) onNotify('Sent. Claude will read it at its next step.', 'info');
    } catch (error) { onNotify(errorText(error), 'error'); }
    finally { setSending(false); }
  }
  async function sendText(text: string) {
    if (!current) return;
    try { await api(`/claude/conversations/${current.id}/messages`, json('POST', { text, mode: 'queue' })); }
    catch (error) { onNotify(errorText(error), 'error'); }
  }
  async function stop() {
    if (!current || stopping) return;
    setStopping(true);
    try { await api(`/claude/conversations/${current.id}/stop`, json('POST')); }
    catch (error) { setStopping(false); onNotify(errorText(error), 'error'); }
  }
  async function answer(requestId: string, value: RequestAnswer) {
    if (!current) return;
    try { await api(`/claude/conversations/${current.id}/permissions/${requestId}`, json('POST', value)); }
    catch (error) { onNotify(errorText(error), 'error'); }
  }
  async function fork(entryId?: string) {
    if (!current) return;
    setActionBusy(true);
    try {
      const created = await api<ClaudeConversation>(`/claude/conversations/${current.id}/fork`, json('POST', entryId ? { entryId } : {}));
      select(created.id); onNotify('Forked into a new conversation.', 'success');
    } catch (error) { onNotify(errorText(error), 'error'); }
    finally { setActionBusy(false); }
  }
  async function confirmRewind(restoreFiles: boolean) {
    if (!current || !rewind) return;
    setActionBusy(true);
    try {
      const result = await api<{ conversation: ClaudeConversation; text: string; attachments: ClaudeAttachment[]; files: { changed: string[] } | null }>(`/claude/conversations/${current.id}/rewind`, json('POST', { entryId: rewind.entry.id, restoreFiles }));
      setConversation(result.conversation);
      if (rewind.edit) { setDrafts(previous => ({ ...previous, [current.id]: result.text })); setAttachments(previous => ({ ...previous, [current.id]: result.attachments })); }
      if (result.files) onNotify(`Restored ${result.files.changed.length} file${result.files.changed.length === 1 ? '' : 's'}.`, 'success');
      setRewind(null);
    } catch (error) { onNotify(errorText(error), 'error'); }
    finally { setActionBusy(false); }
  }
  async function importSession(session: ClaudeNativeSession) {
    try {
      const created = await api<ClaudeConversation>(`/claude/sessions/${session.sessionId}/import`, json('POST', { workspaceId: workspace.id }));
      await refreshItems(); select(created.id); onNotify('Session imported.', 'success');
    } catch (error) { onNotify(errorText(error), 'error'); }
  }
  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!renaming?.title.trim()) return;
    await patchConversation(renaming.id, { title: renaming.title.trim() });
    if (current?.id === renaming.id) setConversation(previous => previous ? { ...previous, title: renaming.title.trim() } : previous);
    setRenaming(null);
  }
  async function remove() {
    if (!deleting) return;
    setActionBusy(true);
    try {
      await api(`/claude/conversations/${deleting.id}`, json('DELETE'));
      setItems(list => list.filter(item => item.id !== deleting.id));
      if (selectedId === deleting.id) select(null);
      setDeleting(null);
    } catch (error) { onNotify(errorText(error), 'error'); }
    finally { setActionBusy(false); }
  }

  const summary = items.find(item => item.id === selectedId);
  const title = current?.title || summary?.title || 'New conversation';
  const archived = !!current?.archivedAt;
  const opening = !!selectedId && !current && !loadError;
  const empty = !selectedId || (!!current && !current.entries.length);
  const statusText = running ? (live.detail || statusLabel[live.status] || 'Working') : '';
  const detail = archived ? 'Archived conversation' : running ? statusText : current?.forkedFrom ? `Forked from ${current.forkedFrom.title}` : current?.importedFrom ? 'Imported Claude Code session' : selectedId ? `${items.find(item => item.id === selectedId)?.messageCount ?? 0} messages` : 'New conversation';
  const streamingNow = !!current?.entries.some(entry => (entry.kind === 'assistant' || entry.kind === 'thinking') && entry.streaming && entry.text.length > 0);
  const todos = current?.todos?.length && current.todos.some(todo => todo.status !== 'completed') ? current.todos : null;
  const suggestions = [
    { icon: <FolderOpen size={16} />, title: 'Understand the project', text: 'Explore this workspace and explain its structure, main entry points, and how to run it.' },
    { icon: <Lightbulb size={16} />, title: 'Plan a change', text: 'Help me plan the next change to this project.', plan: true },
    { icon: <Bug size={16} />, title: 'Find and fix bugs', text: 'Look for bugs or failing tests in this project and fix the most important one.' },
    { icon: <ClipboardList size={16} />, title: 'Write CLAUDE.md', text: '/init' },
  ];

  return <section className={`chat-panel claude-panel${running ? ' is-running' : ''}${permissions.length ? ' is-awaiting' : ''}`} aria-label="Claude conversation">
    <ConversationHeader title={title} detail={detail} historyOpen={historyOpen} onBrowse={() => setHistoryOpen(value => !value)}>
      {!!current?.usage?.contextWindow && current.usage.contextTokens / current.usage.contextWindow >= 0.01 && <span className="claude-header-context" title="Context used">{Math.min(100, Math.round(current.usage.contextTokens / current.usage.contextWindow * 100))}% context</span>}
      <a className="icon-button chat-window-link" href={windowLink({ workspaceId: workspace.id, threadId: selectedId, view: 'agent' })} target="_blank" rel="noopener noreferrer" aria-label="Open Claude in new window" title="Open in new window"><ExternalLink size={15} /></a>
      <button type="button" className="icon-button chat-new-thread" aria-label="New conversation" title="New conversation" onClick={() => select(null)}><Plus size={18} /></button>
      <DropdownMenu align="end" aria-label="Conversation actions" trigger={<button type="button" className="icon-button" aria-label="Conversation actions" title="Conversation actions"><MoreHorizontal size={17} /></button>} items={[
        { id: 'rename', label: 'Rename conversation', icon: <PencilLine size={14} />, disabled: !current, onSelect: () => current && setRenaming({ id: current.id, title: current.title }) },
        { id: 'fork', label: 'Fork conversation', icon: <GitFork size={14} />, disabled: !current?.entries.length || actionBusy, onSelect: () => void fork() },
        { id: 'compact', label: 'Compact context', icon: <ListTodo size={14} />, disabled: !current?.sessionId || running, onSelect: () => { setDraft('/compact'); } },
        { id: 'pin', label: summary?.pinned ? 'Unpin' : 'Pin conversation', icon: summary?.pinned ? <PinOff size={14} /> : <Pin size={14} />, disabled: !current, onSelect: () => current && void patchConversation(current.id, { pinned: !summary?.pinned }) },
        { id: 'archive', label: archived ? 'Restore conversation' : 'Archive conversation', icon: archived ? <ArchiveRestore size={14} /> : <Archive size={14} />, disabled: !current || running, onSelect: () => { if (current) { void patchConversation(current.id, { archived: !archived }); setConversation(previous => previous ? { ...previous, archivedAt: archived ? null : new Date().toISOString() } : previous); } } },
        { type: 'separator', id: 'separator' },
        { id: 'settings', label: 'Claude settings', icon: <Settings2 size={14} />, onSelect: () => onSettings('agent') },
        { id: 'delete', label: 'Delete conversation', icon: <Trash2 size={14} />, danger: true, disabled: !summary, onSelect: () => summary && setDeleting(summary) },
      ]} />
    </ConversationHeader>
    <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} workspaceId={workspace.id} workspaceName={workspace.name} selectedId={selectedId}
      items={items} loading={itemsLoading} error={itemsError} onRetry={() => void refreshItems()} onSelect={select} onCreate={() => select(null)}
      onRename={item => setRenaming({ id: item.id, title: item.title })} onPatch={(id, patch) => void patchConversation(id, patch)} onDelete={setDeleting} onImport={importSession} />
    {!settings.agentConfigured && <div className="chat-runtime-notice" role="alert"><AlertCircle size={15} /><span><strong>Claude is not configured</strong><small>Add the PASSWORD secret to this Space so Claude Code can reach the Messages API.</small></span></div>}
    {connection === 'reconnecting' && <div className="chat-connection" role="status"><WifiOff size={13} /><span>Reconnecting to the conversation…</span><button type="button" onClick={reconnect}>Retry now</button></div>}
    {archived && <div className="chat-archived-banner" role="status"><Archive size={15} /><span>This conversation is archived.</span><button type="button" className="button" onClick={() => { if (current) { void patchConversation(current.id, { archived: false }); setConversation(previous => previous ? { ...previous, archivedAt: null } : previous); } }}><ArchiveRestore size={13} />Restore</button></div>}
    <div className="chat-conversation-wrap">
      <div className="chat-conversation" ref={scrollRef} onScroll={onScroll} tabIndex={0} role="region" aria-label="Conversation messages" aria-busy={opening}>
        <div className={'chat-conversation-content' + (empty && !opening ? ' is-empty' : '')}>
          {opening && <ConversationSkeleton label="Opening your conversation…" />}
          {empty && !opening && <div className="chat-empty"><div className="chat-empty-symbol" aria-hidden="true"><Code2 size={23} /><span><Sparkles size={13} /></span></div>
            <h2>What are we building?</h2><p className="chat-empty-description">Claude Code can read, edit, and run code in <strong>{workspace.name}</strong>.</p>
            <div className="chat-suggestions claude-suggestions">{suggestions.map((item, index) => <button type="button" key={item.title} style={{ '--claude-i': index } as CSSProperties} onClick={() => { setDraft(item.text); if (item.plan) changeSettings({ permissionMode: 'plan' }); }}>
              <span className="chat-suggestion-icon">{item.icon}</span><span><strong>{item.title}</strong><small>{item.text.startsWith('/') ? 'Generate project instructions' : item.text.slice(0, 48) + '…'}</small></span></button>)}</div>
            {items.length > 0 && !selectedId && <div className="claude-recent"><h3>Recent conversations</h3>{items.filter(item => !item.archivedAt).slice(0, 5).map((item, index) => <button type="button" key={item.id} style={{ '--claude-i': index + 4 } as CSSProperties} onClick={() => select(item.id)}>
              {item.running ? <LoaderCircle size={14} className="chat-spin" /> : <Check size={14} />}<span className="text-ellipsis">{item.title}</span></button>)}
              <button type="button" className="text-button" onClick={() => setHistoryOpen(true)}>View all {items.length}</button></div>}
          </div>}
          {current && <Timeline conversationId={current.id} entries={current.entries} workspacePath={workspace.path} running={running} actionsDisabled={running || actionBusy || archived}
            actions={{ onEdit: entry => setRewind({ entry, edit: true }), onRewind: entry => setRewind({ entry, edit: false }), onFork: entryId => void fork(entryId) }}
            onNotify={onNotify} onOpenFile={onOpenFile} />}
          {current?.error && !running && !current.entries.some(entry => entry.kind === 'system' && entry.text === current.error) && <div className="chat-run-error" role="alert"><AlertCircle size={15} /><p>{current.error}</p></div>}
          {running && !permissions.length && !streamingNow && <WorkingIndicator label={statusText} startedAt={live.startedAt} tone={live.status} />}
          {permissions.map(request => <RequestCard key={request.id} request={request} workspacePath={workspace.path} onAnswer={value => answer(request.id, value)} onNotify={onNotify} onOpenFile={onOpenFile} />)}
        </div>
      </div>
      {away && <button type="button" className="chat-jump-latest" onClick={jump}><ArrowDown size={13} />Jump to latest</button>}
    </div>
    {!archived && <div className="chat-compose-area">
      {todos && <details className="claude-todo-panel" open><summary><ListTodo size={14} /><span>Plan</span><span className="claude-todo-progress" aria-hidden="true"><i style={{ width: `${Math.round(todos.filter(todo => todo.status === 'completed').length / todos.length * 100)}%` }} /></span><span className="claude-todo-count">{todos.filter(todo => todo.status === 'completed').length}/{todos.length}</span></summary><TodoList todos={todos} /></details>}
      {!!current?.queue?.length && <div className="claude-queue-list" aria-label="Queued messages">{current.queue.map(item => <div key={item.id} className="claude-queued"><ListTodo size={13} /><span className="text-ellipsis">{item.text || `${item.attachments?.length ?? 0} attachments`}</span>
        <button type="button" aria-label="Remove queued message" onClick={() => void patchConversation(current.id, { queue: current.queue!.filter(entry => entry.id !== item.id).map(entry => entry.id) })}><X size={12} /></button></div>)}</div>}
      <Composer workspaceId={workspace.id} draft={draft} onDraft={setDraft} attachments={draftAttachments} onAttachments={setDraftAttachments}
        settings={composerSettings} onSettings={changeSettings} models={models} modelsLoading={modelsLoading} commands={capabilities?.commands ?? []}
        running={running} stopping={stopping} sending={sending} disabled={opening || !settings.agentConfigured} usage={current?.usage}
        goal={current?.goal} onClearGoal={current ? () => void sendText('/goal clear') : undefined}
        onSend={() => void send()} onQueue={() => void send('queue')} onStop={() => void stop()} onNotify={onNotify} focusKey={selectedId ?? DRAFT_KEY} />
    </div>}
    <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename conversation" titleId="rename-conversation">
      <form onSubmit={event => void rename(event)}><div className="chat-control-dialog-body"><label className="field"><span>Conversation name</span><input className="input" autoFocus maxLength={120} value={renaming?.title ?? ''} onChange={event => setRenaming(previous => previous ? { ...previous, title: event.target.value } : null)} /></label></div>
        <div className="modal-footer"><button type="button" className="button ghost" onClick={() => setRenaming(null)}>Cancel</button><button type="submit" className="button primary" disabled={!renaming?.title.trim()}><Check size={14} />Save name</button></div></form>
    </Modal>
    <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete conversation?" titleId="delete-conversation">
      <div className="chat-control-dialog-body"><p>“{deleting?.title}” will be removed from this workspace. Files Claude changed are not affected.</p></div>
      <div className="modal-footer"><button type="button" className="button ghost" onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="button danger" disabled={actionBusy} onClick={() => void remove()}>{actionBusy && <LoaderCircle size={14} className="chat-spin" />}Delete</button></div>
    </Modal>
    <Modal open={!!rewind} onClose={() => setRewind(null)} title={rewind?.edit ? 'Edit and resend' : 'Rewind conversation'} titleId="rewind-conversation">
      <div className="chat-control-dialog-body"><p>{rewind?.edit ? 'The conversation goes back to just before this message and puts it in the composer so you can change it.' : 'The conversation goes back to just before this message. Later messages are removed.'}</p>
        <blockquote className="claude-rewind-quote">{rewind?.entry.text.slice(0, 400)}</blockquote>
        <p className="field-help">You can also restore the files Claude changed since then, using Claude Code's file checkpoints.</p></div>
      <div className="modal-footer"><button type="button" className="button ghost" onClick={() => setRewind(null)}>Cancel</button>
        <button type="button" className="button" disabled={actionBusy} onClick={() => void confirmRewind(true)}>Rewind code and conversation</button>
        <button type="button" className="button primary" disabled={actionBusy} onClick={() => void confirmRewind(false)}>{actionBusy && <LoaderCircle size={14} className="chat-spin" />}Rewind conversation only</button></div>
    </Modal>
  </section>;
}
