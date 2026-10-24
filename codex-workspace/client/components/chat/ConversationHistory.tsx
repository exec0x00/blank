import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, Archive, ArrowDown, ArrowUp, Check, LoaderCircle, MessageSquare, Plus, Search, X } from 'lucide-react';
import type { ThreadSummary } from '../../../shared/types';
import Modal from '../Modal';
import { SelectMenu } from '../ui/Dropdown';
import { ListSkeleton } from '../ui/Loading';
import { MeasuredWindow, type MeasuredWindowHandle } from './MeasuredWindow';
import { conversationHistoryEntries, conversationStatusLabel, conversationUpdatedLabel, type ConversationHistoryEntry } from './conversation-navigation';
import type { useThreadCatalog } from './useThreadCatalog';
import './conversation-navigation.css';

type Catalog = ReturnType<typeof useThreadCatalog>;
interface ConversationHistoryProps {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  selectedId: string | null;
  selectedThread?: ThreadSummary | null;
  backend: 'codex-cli' | 'legacy';
  visibility: 'active' | 'archived';
  query: string;
  catalog: Catalog;
  createDisabled: boolean;
  creating: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onBackendChange: (value: 'codex-cli' | 'legacy') => void;
  onVisibilityChange: (value: 'active' | 'archived') => void;
  onQueryChange: (value: string) => void;
}

const entryKey = (entry: ConversationHistoryEntry) => entry.thread.id;
const entryHeight = (entry: ConversationHistoryEntry) => entry.group ? 108 : 72;

function ConversationHistoryBody({ workspaceId, selectedId, selectedThread, backend, visibility, query, catalog,
  createDisabled, creating, onSelect, onCreate, onBackendChange, onVisibilityChange, onQueryChange }: Omit<ConversationHistoryProps, 'open' | 'onClose' | 'workspaceName'>) {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<MeasuredWindowHandle | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [activeId, setActiveId] = useState(selectedId);
  const [now] = useState(() => new Date());
  const entries = useMemo(() => conversationHistoryEntries(catalog.items, now), [catalog.items, now]);
  const scope = workspaceId + ':' + backend + ':' + visibility + ':' + query.trim();
  const active = catalog.items.find(item => item.id === activeId)?.id
    ?? catalog.items.find(item => item.id === selectedId)?.id ?? catalog.items[0]?.id;
  const currentOutsidePage = selectedThread && selectedThread.id === selectedId && selectedThread.workspaceId === workspaceId
    && !selectedThread.parentThreadId && selectedThread.backend === backend && !!selectedThread.archivedAt === (visibility === 'archived')
    && !query.trim() && !catalog.hasNewer && !catalog.items.some(item => item.id === selectedId);

  useEffect(() => { pendingFocus.current = null; setActiveId(selectedId); }, [scope, selectedId]);
  const focusRow = (id: string | undefined) => {
    if (!id) return;
    pendingFocus.current = id;
    setActiveId(id);
    windowRef.current?.jumpToKey(id);
    setFocusVersion(value => value + 1);
  };
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const frame = requestAnimationFrame(() => {
      const button = buttons.current.get(pendingFocus.current ?? '');
      if (!button) return;
      pendingFocus.current = null;
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusVersion, entries]);

  const rowKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = catalog.items.findIndex(item => item.id === id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? catalog.items.length - 1
      : Math.max(0, Math.min(catalog.items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    focusRow(catalog.items[next]?.id);
  };
  const loading = !!catalog.loading;
  const search = query.trim();
  const emptyTitle = search ? 'No matching conversations' : visibility === 'archived' ? 'No archived conversations'
    : backend === 'legacy' ? 'No preserved conversations' : 'Start a conversation';
  const emptyDescription = search ? 'Try a different name or clear the search.' : visibility === 'archived' ? 'Conversations you archive will appear here.'
    : backend === 'legacy' ? 'Saved history from the previous runtime will appear here.' : 'Your conversations in this workspace will appear here.';

  return <>
    <div className="conversation-history-tools">
      <div className="conversation-history-search">
        <Search size={17} aria-hidden="true" />
        <input ref={searchRef} data-autofocus type="search" autoComplete="off" spellCheck={false} aria-label="Search conversations"
          aria-controls="conversation-history-list" value={query} maxLength={200} placeholder="Search conversations…"
          onChange={event => onQueryChange(event.target.value)} onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              focusRow(event.key === 'ArrowDown' ? catalog.items[0]?.id : catalog.items.at(-1)?.id);
            }
          }} />
        {query && <button type="button" className="icon-button" aria-label="Clear conversation search" title="Clear search"
          onClick={() => { onQueryChange(''); searchRef.current?.focus(); }}><X size={15} /></button>}
      </div>
      <button type="button" className="button conversation-history-new" aria-label="New conversation" disabled={createDisabled} onClick={onCreate}>
        {creating ? <LoaderCircle size={16} className="chat-spin" aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
        <span>New<span className="conversation-history-new-long"> conversation</span></span>
      </button>
    </div>
    <div className="conversation-history-filters">
      <div className="conversation-history-visibility" role="group" aria-label="Conversation visibility">
        <button type="button" aria-pressed={visibility === 'active'} onClick={() => onVisibilityChange('active')}>Active</button>
        <button type="button" aria-pressed={visibility === 'archived'} onClick={() => onVisibilityChange('archived')}><Archive size={14} aria-hidden="true" />Archived</button>
      </div>
      <SelectMenu value={backend} onValueChange={onBackendChange} aria-label="Conversation source" compact
        className="conversation-history-source" options={[
          { value: 'codex-cli', label: 'Current conversations' },
          { value: 'legacy', label: 'Preserved history', description: 'Read only' },
        ]} />
    </div>
    {backend === 'legacy' && <p className="conversation-history-preserved">Preserved conversations are available to read.</p>}
    {currentOutsidePage && <div className="conversation-history-current">
      <span>Current conversation</span>
      <button type="button" data-tooltip={selectedThread.title || 'Untitled conversation'} onClick={() => onSelect(selectedThread.id)}><strong className="text-ellipsis" data-tooltip={selectedThread.title || 'Untitled conversation'}>{selectedThread.title || 'Untitled conversation'}</strong><Check size={15} aria-hidden="true" /></button>
    </div>}
    {catalog.error && <div className="conversation-history-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><div><strong>Couldn’t load conversations</strong><p>{catalog.error}</p></div>
      <button type="button" className="button ghost" disabled={loading} onClick={() => void catalog.retry()}>Retry</button></div>}
    <div className="conversation-history-list chat-history-list" id="conversation-history-list" ref={listRef} role="list" aria-label="Saved conversations"
      aria-busy={loading} aria-describedby="conversation-history-keyboard-help">
      {catalog.hasNewer && <button type="button" className="conversation-history-page" disabled={loading} onClick={() => void catalog.loadNewer()}>
        {catalog.loading === 'newer' ? <LoaderCircle size={15} className="chat-spin" aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}Newer conversations</button>}
      {!entries.length && !catalog.error && (loading ? <ListSkeleton label="Loading conversations…" rows={4} />
        : <div className="conversation-history-empty"><span className="conversation-history-empty-icon" aria-hidden="true">{search ? <Search size={22} /> : visibility === 'archived' ? <Archive size={22} /> : <MessageSquare size={22} />}</span>
          <strong>{emptyTitle}</strong><p>{emptyDescription}</p>{search && <button type="button" className="button ghost" onClick={() => { onQueryChange(''); searchRef.current?.focus(); }}>Clear search</button>}</div>)}
      <MeasuredWindow items={entries} itemKey={entryKey} estimateHeight={entryHeight} scrollRef={listRef} handleRef={windowRef}
        resetKey={scope} onRangeChange={catalog.onRangeChange} overscan={240}
        renderItem={({ thread, group }) => <div className="conversation-history-entry" role="listitem">
          {group && <h3 className="conversation-history-group">{group}</h3>}
          <button type="button" ref={node => { if (node) buttons.current.set(thread.id, node); else buttons.current.delete(thread.id); }}
            className={'conversation-history-row chat-history-select' + (thread.id === selectedId ? ' is-selected' : '')}
            data-conversation-id={thread.id} data-tooltip={thread.title || 'Untitled conversation'} tabIndex={thread.id === active ? 0 : -1} aria-current={thread.id === selectedId ? 'true' : undefined}
            onFocus={() => setActiveId(thread.id)} onKeyDown={event => rowKey(event, thread.id)} onClick={() => onSelect(thread.id)}>
            <span className="conversation-history-row-copy"><strong className="text-ellipsis" data-tooltip={thread.title || 'Untitled conversation'}>{thread.title || 'Untitled conversation'}</strong>
              <span className="conversation-history-row-meta"><span className={'conversation-history-row-status status-' + thread.status}>{conversationStatusLabel(thread)}</span><span aria-hidden="true">·</span>
                <time dateTime={Number.isFinite(Date.parse(thread.updatedAt)) ? thread.updatedAt : undefined}>{conversationUpdatedLabel(thread.updatedAt, now)}</time></span>
            </span>
            {thread.id === selectedId && <span className="conversation-history-selected"><span>Current</span><Check size={15} aria-hidden="true" /></span>}
          </button>
        </div>} />
      {catalog.hasOlder && <button type="button" className="conversation-history-page" disabled={loading} onClick={() => void catalog.loadOlder()}>
        {catalog.loading === 'older' ? <LoaderCircle size={15} className="chat-spin" aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}Older conversations</button>}
    </div>
    <div className="conversation-history-footer">
      <span className="conversation-history-feedback" role="status" aria-live="polite">{entries.length > 0 && loading ? <><LoaderCircle size={13} className="chat-spin" aria-hidden="true" />{catalog.loading === 'latest' ? 'Refreshing…' : 'Loading more…'}</> : search && !loading && entries.length > 0 ? 'Search results' : ''}</span>
      <span className="conversation-history-shortcuts" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd><span>Move</span><kbd>↵</kbd><span>Open</span><kbd>Esc</kbd><span>Close</span></span>
      <span className="chat-sr-only" id="conversation-history-keyboard-help">Use Up and Down to move through conversations, then Enter to open. Escape closes this dialog.</span>
    </div>
  </>;
}

export function ConversationHistory({ open, onClose, workspaceName, ...props }: ConversationHistoryProps) {
  return <Modal open={open} onClose={onClose} title="Conversations" titleId="conversation-history-title" description={workspaceName} className="conversation-history-dialog">
    <ConversationHistoryBody key={props.workspaceId} {...props} />
  </Modal>;
}
