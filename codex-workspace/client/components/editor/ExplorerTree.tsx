import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronRight, Ellipsis, LoaderCircle } from 'lucide-react';
import type { FileEntry } from '../../../shared/types';
import { FileIcon } from './FileIcon';
import { ListSkeleton } from '../ui/Loading';
import type { DirectoryPagingState } from './directory-pages';
import { treeWindowIndices, TREE_WINDOW_THRESHOLD } from './tree-window';
import './ExplorerTree.css';

export interface ExplorerRevealRequest { id: number; path: string }

interface ExplorerTreeProps {
  label: string;
  emptyContent?: ReactNode;
  tree: Record<string, FileEntry[]>;
  expanded: ReadonlySet<string>;
  loading: ReadonlySet<string>;
  errors: Record<string, string>;
  paging?: Record<string, DirectoryPagingState>;
  revealRequest?: ExplorerRevealRequest | null;
  onRevealHandled?: (id: number) => void;
  selectedPath: string | null;
  activePath: string | null;
  dirtyPaths: ReadonlySet<string>;
  cutPath: string | null;
  dragPath: string | null;
  dropDirectory: string | null;
  dropAllowed: boolean;
  transferBusy: boolean;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onToggleDirectory: (entry: FileEntry) => void;
  onRetry: (path: string) => void;
  onLoadMore?: (path: string) => void;
  onFocusPath?: (path: string) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onClipboard: (entry: FileEntry, action: 'move' | 'copy') => void;
  onPaste: (directory: string, target?: FileEntry) => void;
  onClearClipboard: () => void;
  onDragStart: (entry: FileEntry, event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onContextMenu: (entry: FileEntry, anchor: HTMLElement, point: { x: number; y: number }) => void;
}

type EntryRow = { kind: 'entry'; entry: FileEntry; depth: number; position: number; size: number };
type StatusRow = { kind: 'error' | 'loading' | 'empty'; path: string; depth: number; message: string };
type MoreRow = { kind: 'more'; path: string; depth: number; message: string; busy: boolean; stale: boolean };
type TreeRow = EntryRow | StatusRow | MoreRow;
type NavigableRow = EntryRow | MoreRow | (StatusRow & { kind: 'error' });

const parentPath = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const rowStyle = (depth: number) => ({ '--tree-depth': depth } as CSSProperties);
const rowKey = (row: TreeRow) => `${row.kind}:${row.kind === 'entry' ? row.entry.path : row.path}`;
const EMPTY_PAGING: Record<string, DirectoryPagingState> = {};
function ownValue<T>(values: Record<string, T>, path: string): T | undefined {
  return Object.hasOwn(values, path) ? values[path] : undefined;
}

/** Explicit levels and sibling positions keep this flat ARIA tree accessible. */
export function ExplorerTree({ label, emptyContent, tree, expanded, loading, errors, paging = EMPTY_PAGING, revealRequest, onRevealHandled, selectedPath, activePath, dirtyPaths, cutPath, dragPath, dropDirectory, dropAllowed, transferBusy, onSelect, onOpen, onToggleDirectory, onRetry, onLoadMore, onFocusPath, onRename, onDelete, onClipboard, onPaste, onClearClipboard, onDragStart, onDragEnd, onContextMenu }: ExplorerTreeProps) {
  const helpId = useId();
  const treeRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const lastRevealed = useRef<string | null>(null);
  const lastExplicitReveal = useRef<number | null>(null);
  const pendingPageFocus = useRef<{ path: string; count: number } | null>(null);
  const hadFocus = useRef(false);
  const typeahead = useRef({ text: '', at: 0 });
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [focusedAction, setFocusedAction] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 480, rowHeight: 34 });

  useLayoutEffect(() => {
    const element = treeRef.current;
    if (!element) return;
    const measure = () => {
      const rowHeight = Number.parseFloat(getComputedStyle(element).getPropertyValue('--explorer-page-row-height')) || 34;
      setViewport(previous => previous.top === element.scrollTop && previous.height === element.clientHeight && previous.rowHeight === rowHeight
        ? previous : { top: element.scrollTop, height: element.clientHeight, rowHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => {
    const result: TreeRow[] = [];
    const visit = (path: string, depth: number) => {
      const entries = ownValue(tree, path);
      const error = ownValue(errors, path);
      const page = ownValue(paging, path);
      const more = Boolean(page?.nextCursor || page?.stale);
      entries?.forEach((entry, index) => {
        result.push({ kind: 'entry', entry, depth, position: index + 1, size: more ? -1 : entries.length });
        if (entry.kind === 'directory' && expanded.has(entry.path)) visit(entry.path, depth + 1);
      });
      if (error) result.push({ kind: 'error', path, depth, message: error });
      if (more) result.push({ kind: 'more', path, depth, message: `${entries?.length ?? 0} loaded`, busy: loading.has(path), stale: Boolean(page?.stale) });
      else if (loading.has(path)) result.push({ kind: 'loading', path, depth, message: entries?.length ? 'Refreshing…' : 'Loading…' });
      else if (entries && !entries.length && !error) result.push({ kind: 'empty', path, depth, message: path ? 'Empty folder' : 'No files yet' });
    };
    visit('', 0);
    return result;
  }, [tree, expanded, loading, errors, paging]);
  const entries = useMemo(() => rows.filter((row): row is EntryRow => row.kind === 'entry'), [rows]);
  const byPath = useMemo(() => new Map(entries.map((row) => [row.entry.path, row])), [entries]);
  const navigation = useMemo(() => rows.filter((row): row is NavigableRow => row.kind === 'entry' || row.kind === 'more' || row.kind === 'error'), [rows]);
  const byKey = useMemo(() => new Map(navigation.map(row => [rowKey(row), row])), [navigation]);
  const indices = useMemo(() => new Map(rows.map((row, index) => [rowKey(row), index])), [rows]);
  const offsets = useMemo(() => {
    const next = [0];
    for (const row of rows) next.push(next[next.length - 1] + (row.kind === 'error' ? viewport.rowHeight * 2 + 12 : viewport.rowHeight));
    return next;
  }, [rows, viewport.rowHeight]);

  useEffect(() => {
    // A renamed expanded folder has a new path and needs its own directory cache.
    for (const { entry } of entries) {
      if (entry.kind === 'directory' && expanded.has(entry.path) && !ownValue(tree, entry.path) && !loading.has(entry.path) && !ownValue(errors, entry.path)) onRetry(entry.path);
    }
  }, [entries, expanded, tree, loading, errors, onRetry]);

  // Collapsing or removing the focused entry must leave one usable tab stop.
  const nearestVisible = (path: string | null): string | undefined => {
    for (let candidate = path; candidate; candidate = parentPath(candidate)) {
      if (byPath.has(candidate)) return candidate;
    }
    return undefined;
  };
  const tabPath = focusedPath && byPath.has(focusedPath) ? focusedPath
    : selectedPath && byPath.has(selectedPath) ? selectedPath
      : nearestVisible(focusedPath) || nearestVisible(selectedPath) || nearestVisible(activePath) || entries[0]?.entry.path;
  const tabKey = focusedAction && byKey.has(focusedAction) ? focusedAction : tabPath ? `entry:${tabPath}` : navigation[0] ? rowKey(navigation[0]) : undefined;
  const virtual = rows.length > TREE_WINDOW_THRESHOLD;
  const visibleIndices = treeWindowIndices(offsets, viewport.top, viewport.height, [tabKey, activePath && `entry:${activePath}`, selectedPath && `entry:${selectedPath}`, dragPath && `entry:${dragPath}`, revealRequest && `entry:${revealRequest.path}`]
    .map(key => key ? indices.get(key) ?? -1 : -1));

  const buttonForKey = (key: string) => key.startsWith('entry:') ? buttons.current.get(key.slice(6)) : actionButtons.current.get(key);
  const ensureRow = (key: string) => {
    const element = treeRef.current;
    const index = indices.get(key);
    if (!element || index === undefined) return;
    const top = offsets[index] + 4;
    const bottom = offsets[index + 1] + 4;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = Math.max(0, bottom - element.clientHeight);
    setViewport(previous => previous.top === element.scrollTop ? previous : { ...previous, top: element.scrollTop });
  };

  useLayoutEffect(() => {
    const key = pendingFocus.current;
    const button = key ? buttonForKey(key) : undefined;
    if (button) { pendingFocus.current = null; button.focus({ preventScroll: true }); }
  });

  useLayoutEffect(() => {
    if (activePath !== lastRevealed.current && activePath && byPath.has(activePath) && treeRef.current?.clientHeight) {
      ensureRow(`entry:${activePath}`);
      lastRevealed.current = activePath;
    }
    if (!activePath) lastRevealed.current = null;
  }, [activePath, byPath, viewport.height]);

  useLayoutEffect(() => {
    const element = treeRef.current;
    if (!element || !virtual) return;
    const maximum = Math.max(0, offsets[offsets.length - 1] + 24 - element.clientHeight);
    if (element.scrollTop > maximum) element.scrollTop = maximum;
    setViewport(previous => previous.top === element.scrollTop ? previous : { ...previous, top: element.scrollTop });
  }, [offsets, virtual]);

  useEffect(() => {
    if (!hadFocus.current || document.activeElement !== document.body) return;
    // Refreshes and filesystem operations can remove the focused DOM node.
    const target = tabKey ? buttonForKey(tabKey) : treeRef.current;
    target?.focus({ preventScroll: true });
  }, [rows, tabKey]);

  const focusRow = (row: NavigableRow) => {
    const key = rowKey(row);
    pendingFocus.current = key;
    if (row.kind === 'entry') { setFocusedPath(row.entry.path); setFocusedAction(null); onFocusPath?.(row.entry.path); }
    else setFocusedAction(key);
    ensureRow(key);
    const button = buttonForKey(key);
    if (button) { pendingFocus.current = null; button.focus({ preventScroll: true }); }
  };

  const focusEntry = (entry: FileEntry) => {
    const row = byPath.get(entry.path);
    if (row) focusRow(row);
  };

  useEffect(() => {
    if (!revealRequest || revealRequest.id === lastExplicitReveal.current) return;
    const element = treeRef.current;
    const row = byPath.get(revealRequest.path);
    const button = buttons.current.get(revealRequest.path);
    if (!element?.clientHeight || !row || !button || document.body.dataset.workspaceLocked === 'true') return;
    const measuredHeight = Number.parseFloat(getComputedStyle(element).getPropertyValue('--explorer-page-row-height')) || 34;
    if (measuredHeight !== viewport.rowHeight) return;
    // The requested row is pinned in the bounded DOM window before this effect.
    // Passive effects run after the closing dialog restores focus. Waiting for
    // real geometry also covers the phone Files/editor transition.
    focusRow(row);
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setViewport(previous => previous.top === element.scrollTop ? previous : { ...previous, top: element.scrollTop });
    if (document.activeElement !== button) return;
    lastExplicitReveal.current = revealRequest.id;
    onRevealHandled?.(revealRequest.id);
  }, [revealRequest, byPath, viewport.height, viewport.rowHeight, onRevealHandled]);

  useLayoutEffect(() => {
    const pending = pendingPageFocus.current;
    if (!pending || loading.has(pending.path)) return;
    pendingPageFocus.current = null;
    const entry = ownValue(tree, pending.path)?.[pending.count];
    if (entry) focusEntry(entry);
    else if (tabKey) ensureRow(tabKey);
  }, [tree, loading]);

  const showMenu = (entry: FileEntry, event?: MouseEvent<HTMLElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    const anchor = buttons.current.get(entry.path);
    if (!anchor) return;
    focusEntry(entry);
    const bounds = anchor.getBoundingClientRect();
    const isPointer = event?.type === 'contextmenu' && (event.clientX !== 0 || event.clientY !== 0);
    const triggerBounds = event?.currentTarget.getBoundingClientRect();
    onContextMenu(entry, anchor, isPointer ? { x: event.clientX, y: event.clientY }
      : { x: triggerBounds?.right ?? bounds.left + 32, y: triggerBounds?.bottom ?? bounds.bottom });
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const path = (event.target as HTMLElement).dataset.treePath;
    const row = path ? byPath.get(path) : undefined;
    const action = (event.target as HTMLElement).dataset.treeAction;
    const currentRow = row || (action ? byKey.get(action) : undefined);
    if (event.defaultPrevented || event.altKey) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.shiftKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key === 'v') {
        event.preventDefault();
        onPaste(row ? row.entry.kind === 'directory' ? row.entry.path : parentPath(row.entry.path) : currentRow?.kind !== 'entry' ? currentRow?.path ?? '' : '', row?.entry);
      } else if (row && (key === 'c' || key === 'x')) {
        event.preventDefault();
        onClipboard(row.entry, key === 'x' ? 'move' : 'copy');
      }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); onClearClipboard(); return; }
    if (!currentRow) return;
    if (event.key.length !== 1 || event.key === ' ' || event.key === '*') typeahead.current = { text: '', at: 0 };
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = navigation.indexOf(currentRow);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? navigation.length - 1
        : Math.max(0, Math.min(navigation.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      focusRow(navigation[next]);
      return;
    }
    if (!row) {
      if (event.key === 'ArrowLeft' && currentRow.kind !== 'entry') {
        const parent = byPath.get(currentRow.path);
        if (parent) { event.preventDefault(); focusRow(parent); }
      }
      return;
    }
    const index = entries.indexOf(row);
    const { entry } = row;
    const directory = entry.kind === 'directory';
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (directory && !expanded.has(entry.path)) onToggleDirectory(entry);
      else if (directory && entries[index + 1]?.depth === row.depth + 1) focusEntry(entries[index + 1].entry);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (directory && expanded.has(entry.path)) onToggleDirectory(entry);
      else {
        const parent = byPath.get(parentPath(entry.path));
        if (parent) focusEntry(parent.entry);
      }
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      showMenu(entry);
    } else if (event.key === 'F2') {
      event.preventDefault();
      onRename(entry);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onDelete(entry);
    } else if (event.key === '*') {
      event.preventDefault();
      for (const sibling of entries) {
        if (sibling.entry.kind === 'directory' && parentPath(sibling.entry.path) === parentPath(entry.path) && !expanded.has(sibling.entry.path)) onToggleDirectory(sibling.entry);
      }
      onSelect(entry);
    } else if (event.key.length === 1 && event.key !== ' ') {
      event.preventDefault();
      const now = performance.now();
      const character = event.key.toLocaleLowerCase();
      const previous = now - typeahead.current.at < 700 ? typeahead.current.text : '';
      const text = previous === character ? character : `${previous}${character}`.slice(-64);
      typeahead.current = { text, at: now };
      const start = text.length === 1 ? index + 1 : index;
      for (let offset = 0; offset < entries.length; offset += 1) {
        const candidate = entries[(start + offset) % entries.length].entry;
        if (candidate.name.toLocaleLowerCase().startsWith(text)) { focusEntry(candidate); break; }
      }
    }
  };

  return <div ref={treeRef} className="editor-tree-scroll" role="tree" aria-label={label} aria-describedby={helpId}
    aria-busy={loading.has('') || undefined} tabIndex={navigation.length ? -1 : 0} onKeyDown={handleKey}
    data-tree-windowed={virtual || undefined} onScroll={(event) => { const top = event.currentTarget.scrollTop; setViewport(previous => previous.top === top ? previous : { ...previous, top }); }}
    onFocusCapture={() => { hadFocus.current = true; }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hadFocus.current = false; }}>
    <span id={helpId} className="sr-only">Use arrow keys to navigate, Enter to open, and type to find a loaded file. Load more reads the next page; Go to file can find files outside the loaded pages. Press Shift+F10 for actions or F2 to rename. Control or Command with X, C, and V moves, copies, and pastes into the focused folder. Escape clears the selection to paste. Copy uses saved files.</span>
    {loading.has('') && !ownValue(tree, '')?.length && !ownValue(errors, '') ? <ListSkeleton label="Loading files…" rows={7} compact /> : visibleIndices.map((index, visibleIndex) => {
      const row = rows[index];
      const path = row.kind === 'entry' ? row.entry.path : row.path;
      const key = rowKey(row);
      const style = { ...rowStyle(row.depth), ...(virtual ? { height: offsets[index + 1] - offsets[index] } : {}) };
      const className = `editor-tree-entry${virtual ? ' editor-tree-windowed' : ''}`;
      const previousEnd = visibleIndex ? offsets[visibleIndices[visibleIndex - 1] + 1] : 0;
      const gap = offsets[index] - previousEnd;
      const wrap = (element: ReactNode) => <Fragment key={key}>{gap > 0 && <div className="editor-tree-window-gap" role="none" aria-hidden="true" data-explorer-drop-rejected="unrendered" style={{ height: gap }} />}{element}</Fragment>;
      const guides = <span className="editor-tree-guides" aria-hidden="true">{Array.from({ length: row.depth }, (_, index) => <span key={index} style={{ insetInlineStart: `calc(${index} * var(--tree-indent) + 16px)` }} />)}</span>;
      if (row.kind === 'empty' && path === '' && emptyContent) return <div key={key} role="none" className="editor-tree-empty-shell">{emptyContent}</div>;
      if (row.kind === 'more') return wrap(<div role="none" className={className} style={style} data-explorer-drop-directory={path}>
        {guides}
        <div className={`editor-tree-message editor-tree-more${dropDirectory === path && dropAllowed ? ' editor-folder-drop-target' : ''}`}>
          <span aria-live="polite">{row.message}</span>
          <button ref={button => { if (button) actionButtons.current.set(key, button); else actionButtons.current.delete(key); }}
            type="button" className="button ghost" tabIndex={tabKey === key ? 0 : -1} data-tree-action={key}
            aria-label={`${row.stale ? 'Refresh' : 'Load more in'} ${path || 'workspace files'}`} aria-disabled={row.busy || undefined}
            onFocus={() => setFocusedAction(key)} onClick={() => { if (!row.busy) {
              pendingPageFocus.current = { path, count: ownValue(tree, path)?.length ?? 0 };
              if (row.stale) onRetry(path); else onLoadMore?.(path);
            } }}>
            {row.busy && <LoaderCircle size={13} className="editor-spin" aria-hidden="true" />}{row.busy ? 'Loading…' : row.stale ? 'Refresh folder' : 'Load more'}
          </button>
        </div>
      </div>);
      if (row.kind !== 'entry') return wrap(<div role="none" className={className} style={style} data-explorer-drop-directory={path}>
        {guides}
        <div className={`editor-tree-message editor-tree-${row.kind}${dropDirectory === path && dropAllowed ? ' editor-folder-drop-target' : ''}`} role={row.kind === 'error' ? 'alert' : 'status'}>
          {row.kind === 'loading' && <LoaderCircle size={13} className="editor-spin" aria-hidden="true" />}
          <span>{row.message}</span>
          {row.kind === 'error' && <button ref={button => { if (button) actionButtons.current.set(key, button); else actionButtons.current.delete(key); }}
            type="button" className="button ghost" tabIndex={tabKey === key ? 0 : -1} data-tree-action={key}
            aria-label={`Retry loading ${path || 'workspace files'}`} onFocus={() => setFocusedAction(key)} onClick={() => onRetry(path)}>Retry</button>}
        </div>
      </div>);
      const { entry } = row;
      const directory = entry.kind === 'directory';
      const isExpanded = expanded.has(path);
      const selected = selectedPath === path;
      const active = activePath === path;
      const dirty = dirtyPaths.has(path);
      const markedForMove = Boolean(cutPath && (path === cutPath || path.startsWith(`${cutPath}/`)));
      const description = [directory ? 'Folder' : 'File', entry.isSymlink ? 'Symbolic link' : '', dirty ? 'Unsaved changes' : '', markedForMove ? 'Ready to move' : ''].filter(Boolean).join('. ');
      return wrap(<div role="none" className={className} style={style} data-explorer-drop-directory={directory && !entry.isSymlink ? path : parentPath(path)} data-explorer-drop-rejected={directory && entry.isSymlink ? 'symbolic-link' : undefined}>
        {guides}
        <div className={`editor-tree-item${selected ? ' selected' : ''}${active ? ' active' : ''}${markedForMove ? ' editor-tree-cut' : ''}${dragPath === path ? ' editor-tree-drag-source' : ''}${directory && dropDirectory === path && dropAllowed ? ' editor-folder-drop-target' : ''}`} onContextMenu={(event) => showMenu(entry, event)}>
          <button ref={(button) => { if (button) buttons.current.set(path, button); else buttons.current.delete(path); }}
            type="button" className="editor-tree-row" role="treeitem" tabIndex={tabKey === key ? 0 : -1}
            aria-label={entry.name} aria-description={description} aria-level={row.depth + 1} aria-posinset={row.position} aria-setsize={row.size}
            aria-expanded={directory ? isExpanded : undefined} aria-selected={selected} aria-current={active || undefined}
            data-tree-path={path} title={entry.isSymlink ? `${path} (symbolic link)` : path}
            draggable={!transferBusy} onDragStart={(event) => onDragStart(entry, event)} onDragEnd={onDragEnd}
            onFocus={() => { setFocusedPath(path); setFocusedAction(null); onFocusPath?.(path); }}
            onClick={() => { onSelect(entry); if (directory) onToggleDirectory(entry); else onOpen(entry); }}>
            <span className="editor-tree-chevron" aria-hidden="true">{directory && (loading.has(path)
              ? <LoaderCircle size={13} className="editor-spin" /> : <ChevronRight size={14} className={isExpanded ? 'expanded' : undefined} />)}</span>
            <FileIcon path={path} directory={directory} expanded={isExpanded} size={16} />
            <span className="editor-tree-name">{entry.name}</span>
            {entry.isSymlink && <span className="editor-symlink" aria-hidden="true" title="Symbolic link">↗</span>}
            {dirty && <span className="editor-dirty-dot" aria-label="Unsaved changes" title="Unsaved changes" />}
          </button>
          <button type="button" tabIndex={-1} className="editor-tree-menu editor-menu-trigger" aria-label={`Actions for ${entry.name}`} aria-haspopup="menu" onClick={(event) => showMenu(entry, event)}><Ellipsis size={15} aria-hidden="true" /></button>
        </div>
      </div>);
    })}
    {visibleIndices.length > 0 && visibleIndices[visibleIndices.length - 1] < rows.length - 1
      && <div className="editor-tree-window-gap" role="none" aria-hidden="true" data-explorer-drop-rejected="unrendered" style={{ height: offsets[offsets.length - 1] - offsets[visibleIndices[visibleIndices.length - 1] + 1] }} />}
  </div>;
}
