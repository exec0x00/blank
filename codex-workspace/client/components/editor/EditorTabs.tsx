import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { AlertCircle, GitCompareArrows, LoaderCircle, Plus, X } from 'lucide-react';
import { FileIcon } from './FileIcon';

interface FileTab {
  path: string;
  dirty: boolean;
  conflict: boolean;
  pending: boolean;
}

interface EditorTabsProps {
  files: FileTab[];
  activePath: string | null;
  review: boolean;
  reviewActive: boolean;
  visible: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onSelectReview: () => void;
  onCloseReview: () => void;
  onOpen: () => void;
}

const nameOf = (path: string) => path.split('/').at(-1) || path;
const directoryOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'root';

/** Keep the current file visible without scrolling the editor or its ancestors. */
export function EditorTabs({ files, activePath, review, reviewActive, visible, onSelect, onClose, onSelectReview, onCloseReview, onOpen }: EditorTabsProps) {
  const bar = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const hadFocus = useRef(false);
  const activeKey = reviewActive && review ? 'review' : activePath ? `file:${activePath}` : review ? 'review' : files[0] ? `file:${files[0].path}` : '';
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files) counts.set(nameOf(file.path), (counts.get(nameOf(file.path)) || 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [files]);

  const reveal = (key: string) => {
    const container = bar.current;
    const tab = tabs.current.get(key)?.parentElement;
    if (!container || !tab || !container.clientWidth) return;
    const bounds = container.getBoundingClientRect();
    const item = tab.getBoundingClientRect();
    if (item.left < bounds.left + 4) container.scrollLeft -= bounds.left + 4 - item.left;
    else if (item.right > bounds.right - 4) container.scrollLeft += item.right - bounds.right + 4;
  };

  useLayoutEffect(() => {
    if (!visible) return;
    reveal(activeKey);
    if (hadFocus.current && document.activeElement === document.body) tabs.current.get(activeKey)?.focus({ preventScroll: true });
    const element = bar.current;
    if (!element) return;
    const observer = new ResizeObserver(() => reveal(activeKey));
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeKey, files.length, visible]);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const current = (event.target as HTMLElement).closest<HTMLButtonElement>('button[role="tab"]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const keys = [...files.map(file => `file:${file.path}`), ...(review ? ['review'] : [])];
    const index = keys.findIndex(key => tabs.current.get(key) === current);
    if (index < 0 || !keys.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    const key = keys[next];
    if (key === 'review') onSelectReview(); else onSelect(key.slice(5));
    tabs.current.get(key)?.focus({ preventScroll: true });
    reveal(key);
  };

  return <div ref={bar} className="editor-tabbar" role="tablist" aria-label="Open files and reviews" onKeyDown={navigate}
    onFocusCapture={() => { hadFocus.current = true; }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hadFocus.current = false; }}>
    {files.map(file => {
      const key = `file:${file.path}`;
      const selected = activeKey === key;
      return <div key={key} className={`editor-file-tab${selected ? ' active' : ''}${file.dirty ? ' is-dirty' : ''}`}>
        <button ref={button => { if (button) tabs.current.set(key, button); else tabs.current.delete(key); }} type="button" role="tab"
          tabIndex={selected ? 0 : -1} aria-selected={selected} aria-label={nameOf(file.path)} title={file.path}
          aria-description={[file.path, file.dirty ? 'Unsaved changes' : '', file.conflict ? 'Changed on disk' : ''].filter(Boolean).join('. ')}
          onClick={() => onSelect(file.path)}>
          <FileIcon path={file.path} />
          <span className="editor-tab-label text-ellipsis" dir="auto">{nameOf(file.path)}</span>
          {duplicateNames.has(nameOf(file.path)) && <small className="editor-tab-directory" aria-hidden="true">{directoryOf(file.path)}</small>}
          {file.conflict && <AlertCircle size={12} className="editor-tab-conflict" aria-hidden="true" />}
          {file.pending && <LoaderCircle size={11} className="editor-spin" aria-hidden="true" />}
        </button>
        <button type="button" tabIndex={selected ? 0 : -1} className={`editor-close-tab${file.dirty ? ' dirty' : ''}`}
          aria-label={`Close ${nameOf(file.path)}${file.dirty ? ' (unsaved)' : ''}`} title={file.dirty ? 'Unsaved changes — close file' : 'Close file'} onClick={() => onClose(file.path)}>
          {file.dirty ? <><span className="editor-dirty-dot" /><X size={13} /></> : <X size={13} />}
        </button>
      </div>;
    })}
    {review && <div className={`editor-file-tab editor-review-tab${reviewActive ? ' active' : ''}`}>
      <button ref={button => { if (button) tabs.current.set('review', button); else tabs.current.delete('review'); }} type="button" role="tab"
        tabIndex={activeKey === 'review' ? 0 : -1} aria-selected={reviewActive} aria-description="Recorded changes. Read only."
        title="Recorded changes · Read-only" onClick={onSelectReview}><GitCompareArrows size={14} /><span className="editor-tab-label">Change review</span></button>
      <button type="button" tabIndex={activeKey === 'review' ? 0 : -1} className="editor-close-tab" aria-label="Close change review" title="Close change review" onClick={onCloseReview}><X size={13} /></button>
    </div>}
    <button type="button" className="editor-tab-add" title="Open a file" aria-label="Open a file" onClick={onOpen}><Plus size={14} /></button>
  </div>;
}
