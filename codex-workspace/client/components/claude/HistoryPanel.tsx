import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Download, GitFork, LoaderCircle, MessageSquare, MoreHorizontal, PencilLine, Pin, PinOff, Plus, Search, ShieldQuestion, SquareTerminal, Trash2, X } from 'lucide-react';
import type { ClaudeConversationSummary, ClaudeNativeSession } from '../../../shared/claude';
import { api } from '../../api';
import { DropdownMenu } from '../ui/Dropdown';

type Filter = 'recent' | 'pinned' | 'archived' | 'sessions';
interface Props {
  open: boolean; onClose: () => void; workspaceId: string; workspaceName: string; selectedId: string | null;
  items: ClaudeConversationSummary[]; loading: boolean; error: string | null; onRetry: () => void;
  onSelect: (id: string) => void; onCreate: () => void; onRename: (item: ClaudeConversationSummary) => void;
  onPatch: (id: string, patch: { pinned?: boolean; archived?: boolean }) => void; onDelete: (item: ClaudeConversationSummary) => void;
  onImport: (session: ClaudeNativeSession) => Promise<void>;
}

export function relativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return '';
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: delta > 300 * 86_400_000 ? 'numeric' : undefined });
}
function bucket(value: string) {
  const date = new Date(value), today = new Date(); today.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (date.getTime() >= today.getTime()) return 'Today';
  if (date.getTime() >= today.getTime() - day) return 'Yesterday';
  if (date.getTime() >= today.getTime() - 7 * day) return 'Previous 7 days';
  if (date.getTime() >= today.getTime() - 30 * day) return 'Previous 30 days';
  return 'Older';
}

export function HistoryPanel(props: Props) {
  const { open, onClose, workspaceId, workspaceName, selectedId, items, loading, error, onRetry, onSelect, onCreate, onRename, onPatch, onDelete, onImport } = props;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('recent');
  const [sessions, setSessions] = useState<ClaudeNativeSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQuery(''); requestAnimationFrame(() => search.current?.focus()); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (panel.current && target && !panel.current.contains(target) && !target.closest('.conversation-header-picker, .dropdown-menu, [role="menu"]')) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open, onClose]);
  useEffect(() => {
    if (!open || filter !== 'sessions') return;
    setSessionsError(null);
    void api<ClaudeNativeSession[]>(`/claude/sessions?workspaceId=${encodeURIComponent(workspaceId)}`).then(setSessions).catch(failure => setSessionsError(failure instanceof Error ? failure.message : 'Sessions are unavailable.'));
  }, [open, filter, workspaceId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(item => filter === 'archived' ? !!item.archivedAt : filter === 'pinned' ? item.pinned && !item.archivedAt : !item.archivedAt)
      .filter(item => !needle || item.title.toLowerCase().includes(needle) || item.preview.toLowerCase().includes(needle));
  }, [items, query, filter]);
  const groups = useMemo(() => {
    const result: { label: string; items: ClaudeConversationSummary[] }[] = [];
    for (const item of visible) {
      const label = item.pinned && filter === 'recent' ? 'Pinned' : bucket(item.updatedAt);
      const group = result.find(candidate => candidate.label === label);
      if (group) group.items.push(item); else result.push({ label, items: [item] });
    }
    return result;
  }, [visible, filter]);
  const counts = { archived: items.filter(item => item.archivedAt).length, pinned: items.filter(item => item.pinned && !item.archivedAt).length };

  if (!open) return null;
  return <div className="chat-history claude-history" ref={panel} role="dialog" aria-label="Conversation history">
    <div className="chat-history-heading"><span><MessageSquare size={15} />Conversations · {workspaceName}</span><button type="button" className="icon-button" aria-label="Close history" onClick={onClose}><X size={15} /></button></div>
    <div className="claude-history-tabs" role="tablist">
      {([['recent', 'Recent'], ['pinned', `Pinned${counts.pinned ? ` ${counts.pinned}` : ''}`], ['archived', `Archived${counts.archived ? ` ${counts.archived}` : ''}`], ['sessions', 'Claude Code sessions']] as const).map(([value, label]) =>
        <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    {filter !== 'sessions' && <label className="chat-history-search"><Search size={14} /><input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></label>}
    <div className="chat-history-list">
      {filter === 'sessions' ? <>
        <p className="claude-history-hint">Sessions started with <code>claude</code> in the terminal, or by other tools, in this workspace. Importing lets you continue them here.</p>
        {sessionsError ? <p className="chat-history-empty" role="alert">{sessionsError}</p> : !sessions ? <p className="chat-history-empty"><LoaderCircle size={14} className="chat-spin" />Looking for sessions…</p>
          : !sessions.length ? <p className="chat-history-empty">No other Claude Code sessions in this workspace.</p>
          : sessions.map(session => <div key={session.sessionId} className="chat-history-item"><div className="chat-history-item-main">
            <button type="button" className="chat-history-select" disabled={!!importing} onClick={() => { setImporting(session.sessionId); void onImport(session).finally(() => setImporting(null)); }}>
              <SquareTerminal size={15} /><span><strong>{session.title}</strong><small>{relativeTime(session.lastModified)}{session.gitBranch ? ` · ${session.gitBranch}` : ''}</small></span>
              {importing === session.sessionId ? <LoaderCircle size={14} className="chat-spin" /> : <Download size={14} />}</button></div></div>)}
      </> : loading && !items.length ? <p className="chat-history-empty"><LoaderCircle size={14} className="chat-spin" />Loading conversations…</p>
        : error ? <p className="chat-history-empty" role="alert">{error} <button type="button" className="text-button" onClick={onRetry}>Retry</button></p>
        : !visible.length ? <p className="chat-history-empty">{query ? 'No conversations match.' : filter === 'archived' ? 'No archived conversations.' : filter === 'pinned' ? 'Pin conversations to keep them here.' : 'No conversations yet.'}</p>
        : groups.map(group => <div key={group.label} className="claude-history-group"><h4>{group.label}</h4>{group.items.map(item =>
          <div key={item.id} className={`chat-history-item${item.id === selectedId ? ' is-selected' : ''}`}><div className="chat-history-item-main">
            <button type="button" className="chat-history-select" onClick={() => onSelect(item.id)}>
              {item.awaiting ? <ShieldQuestion size={15} className="claude-history-awaiting" /> : item.running ? <LoaderCircle size={15} className="chat-spin" /> : item.forkedFrom ? <GitFork size={15} /> : item.pinned ? <Pin size={15} /> : <MessageSquare size={15} />}
              <span><strong>{item.title}</strong><small>{item.awaiting ? 'Waiting for you · ' : item.running ? 'Working · ' : ''}{relativeTime(item.updatedAt)}{item.preview ? ` · ${item.preview}` : ''}</small></span></button>
            <div className="chat-history-item-actions"><DropdownMenu align="end" aria-label="Conversation actions" trigger={<button type="button" className="icon-button" aria-label={`Actions for ${item.title}`}><MoreHorizontal size={15} /></button>} items={[
              { id: 'rename', label: 'Rename', icon: <PencilLine size={14} />, onSelect: () => onRename(item) },
              { id: 'pin', label: item.pinned ? 'Unpin' : 'Pin', icon: item.pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => onPatch(item.id, { pinned: !item.pinned }) },
              { id: 'archive', label: item.archivedAt ? 'Restore from archive' : 'Archive', icon: item.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />, disabled: item.running, onSelect: () => onPatch(item.id, { archived: !item.archivedAt }) },
              { type: 'separator', id: 'separator' },
              { id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => onDelete(item) },
            ]} /></div>
          </div></div>)}</div>)}
    </div>
    <button type="button" className="chat-history-create" onClick={onCreate}><Plus size={15} />New conversation</button>
  </div>;
}
