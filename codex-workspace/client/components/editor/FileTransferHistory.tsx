import { useRef } from 'react';
import { AlertCircle, Files, FolderInput, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import type { FileTransferPage, FileTransferStatus } from '../../../shared/types';
import { EditorDialog } from './EditorDialog';
import PageNavigation from '../ui/PageNavigation';
import { MeasuredWindow } from '../chat/MeasuredWindow';
import './file-transfer-history.css';

export interface FileTransferHistoryProps {
  workspaceId: string;
  page: FileTransferPage | null;
  query: string;
  loadedQuery: string;
  loading: boolean;
  error: string;
  inspectingPath?: string | null;
  inspectError?: string;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRefresh: () => void;
  onClose: () => void;
  onInspect: (path: string) => void;
}

function operationMessage(entry: FileTransferStatus): string {
  return entry.issue || (entry.state === 'interrupted' ? 'Some files may remain at either location. Inspect both paths before making changes.'
    : entry.phase === 'verifying' ? 'Verifying the saved copy…' : entry.phase === 'removing' ? 'Finishing the move…' : 'Copying saved files…');
}

/** Read-only status history. Inspect changes navigation; it never replays a
 * transfer, removes a retained file or overwrites an editor buffer. */
export function FileTransferHistory(props: FileTransferHistoryProps) {
  const { workspaceId, page, query, loadedQuery, loading, error, inspectingPath = null, inspectError = '', onQueryChange, onPrevious, onNext, onRefresh, onClose, onInspect } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const entries = page?.items ?? [];
  return <EditorDialog label="File operations" className="editor-transfers-dialog" onClose={onClose}>
    <div className="editor-dialog-heading"><span className="editor-dialog-icon"><FolderInput size={20} /></span><button type="button" className="icon-button" aria-label="Close file operations" onClick={onClose}><X size={17} /></button></div>
    <h2>File operations</h2><p>Moves and copies that are still running or need attention. Inspect both locations before retrying an interrupted operation.</p>
    <label className="file-transfer-search"><Search size={15} aria-hidden="true" /><input type="search" data-autofocus value={query} maxLength={160} onChange={event => onQueryChange(event.target.value)} placeholder="Search source or destination" aria-label="Search file operations" /></label>
    {error && <div className="editor-inline-error file-transfer-read-error" role="alert"><AlertCircle size={14} /><span>{error}</span><button type="button" className="button ghost" disabled={loading} onClick={onRefresh}>Retry loading</button></div>}
    {inspectError && <div className="editor-inline-error file-transfer-inspect-error" role="alert"><AlertCircle size={14} /><span>{inspectError}</span></div>}
    {inspectingPath && <div className="file-transfer-loading" role="status"><LoaderCircle size={15} className="editor-spin" />Locating file or folder…</div>}
    {loading && <div className="file-transfer-loading" role="status"><LoaderCircle size={15} className="editor-spin" />Checking file operations…</div>}
    {!loading && !error && page && !entries.length && <p className="editor-file-transfer-empty">{query.trim() ? 'No file operations match this search.' : 'No unfinished file operations.'}</p>}
    {entries.length > 0 && <div ref={scroller} className="editor-file-transfer-list file-transfer-history-scroll" role="list" tabIndex={0} aria-label="Saved file operations" aria-busy={loading || undefined}>
      <MeasuredWindow items={entries} itemKey={entry => entry.id} estimateHeight={() => 214} scrollRef={scroller} resetKey={`${workspaceId}\n${loadedQuery}\n${page?.offset ?? 0}`} overscan={280} renderItem={(entry, index) => <div className="editor-file-transfer" role="listitem" aria-posinset={(page?.offset ?? 0) + index + 1} aria-setsize={page?.total} data-file-transfer-id={entry.id}>
        <div className="editor-file-transfer-heading">{entry.state === 'interrupted' ? <AlertCircle size={15} /> : <LoaderCircle size={15} className="editor-spin" />}<strong>{entry.kind === 'move' ? 'Move' : 'Copy'} {entry.state === 'interrupted' ? 'interrupted' : 'in progress'}</strong></div>
        <dl><div><dt>Source</dt><dd>{entry.path}</dd></div><div><dt>Destination</dt><dd>{entry.newPath}</dd></div></dl>
        <p role={entry.state === 'interrupted' ? 'alert' : 'status'}>{operationMessage(entry)}</p>
        <div className="editor-file-transfer-actions"><button type="button" className="button ghost" disabled={!!inspectingPath} aria-busy={inspectingPath === entry.path || undefined} onClick={() => onInspect(entry.path)}><Files size={13} />Inspect source</button><button type="button" className="button ghost" disabled={!!inspectingPath} aria-busy={inspectingPath === entry.newPath || undefined} onClick={() => onInspect(entry.newPath)}><Files size={13} />Inspect destination</button></div>
      </div>} />
    </div>}
    <PageNavigation label="File operations" offset={page?.offset ?? 0} count={entries.length} total={page?.total} hasPrevious={(page?.offset ?? 0) > 0} hasNext={page?.hasMore ?? false} loading={loading} disabled={!!inspectingPath} onPrevious={onPrevious} onNext={onNext} />
    <div className="editor-dialog-footer"><button type="button" className="button ghost" disabled={loading} onClick={onRefresh}><RefreshCw size={14} className={loading ? 'editor-spin' : ''} />Refresh</button><button type="button" className="button" onClick={onClose}>Done</button></div>
  </EditorDialog>;
}
