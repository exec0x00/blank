import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, CircleAlert, LoaderCircle, Upload, X } from 'lucide-react';
import { isWorkspaceUploadActive, type WorkspaceUploadProgress } from '../uploads';
import { MeasuredWindow, type MeasuredRange, type MeasuredWindowHandle } from './chat/MeasuredWindow';
import './uploads.css';

export interface UploadProgressProps {
  files: readonly WorkspaceUploadProgress[];
  onCancel?: () => void;
  onDismiss?: () => void;
}

const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
const labels: Record<WorkspaceUploadProgress['stage'], string> = {
  queued: 'Waiting', reserving: 'Preparing upload', preparing: 'Preparing file', uploading: 'Uploading',
  publishing: 'Finishing upload', importing: 'Saving to workspace', cancelling: 'Cancelling',
  ready: 'Saved to workspace', failed: 'Upload failed', cancelled: 'Cancelled', unconfirmed: 'Save not confirmed',
};
const WINDOW_AFTER = 50;
const uploadKey = (file: WorkspaceUploadProgress) => file.id;
const uploadHeight = (file: WorkspaceUploadProgress) => 64
  + (isWorkspaceUploadActive(file) && file.stage !== 'queued' ? 11 : 0)
  + (file.error ? 7 + Math.ceil(file.error.length / 34) * 17 : 0)
  + (file.notice ? 7 + Math.ceil(file.notice.length / 34) * 17 : 0);

function UploadDetails({ file }: { file: WorkspaceUploadProgress }) {
  const active = isWorkspaceUploadActive(file);
  const measurable = file.stage === 'uploading' || file.stage === 'importing';
  const current = file.stage === 'importing' ? file.bytesImported : file.bytesUploaded;
  const percent = measurable && file.size > 0 ? Math.min(100, Math.floor(current / file.size * 100)) : undefined;
  const label = labels[file.stage];
  return <>
    <div className="workspace-upload-file">
      <span className="workspace-upload-icon" aria-hidden="true">{active ? <LoaderCircle size={15} className="workspace-upload-spin" /> : file.stage === 'ready' ? <Check size={15} /> : file.error ? <CircleAlert size={15} /> : <Upload size={15} />}</span>
      <strong title={file.path}>{file.fileName}</strong>
      <span>{bytes(file.size)}</span>
    </div>
    <div className="workspace-upload-status"><span role="status">{label}</span>{percent !== undefined && <span>{percent}%</span>}</div>
    {active && file.stage !== 'queued' && <div className={`workspace-upload-track ${percent === undefined ? 'is-waiting' : ''}`} role="progressbar" aria-label={`${label}: ${file.fileName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={percent === undefined ? label : `${bytes(current)} of ${bytes(file.size)}`}><span style={percent === undefined ? undefined : { width: `${percent}%` }} /></div>}
    {file.error && <p className="workspace-upload-error" role="alert">{file.error}</p>}
    {file.notice && <p className="workspace-upload-note">{file.notice}</p>}
  </>;
}

function summarize(files: readonly WorkspaceUploadProgress[]) {
  let active = 0, saved = 0, queued = 0, failed = 0, cancelled = 0, unconfirmed = 0, cancelling = false;
  let current: WorkspaceUploadProgress | undefined, waiting: WorkspaceUploadProgress | undefined, problem: WorkspaceUploadProgress | undefined;
  for (const file of files) {
    if (isWorkspaceUploadActive(file)) {
      active++;
      if (file.stage === 'queued') { queued++; waiting ??= file; }
      else current ??= file;
    }
    if (file.stage === 'ready') saved++;
    if (file.stage === 'failed') { failed++; problem ??= file; }
    if (file.stage === 'cancelled') cancelled++;
    if (file.stage === 'unconfirmed') { unconfirmed++; problem ??= file; }
    if (file.stage === 'cancelling') cancelling = true;
  }
  return { active, saved, queued, failed, cancelled, unconfirmed, cancelling, current: current ?? waiting, problem };
}
type UploadSummary = ReturnType<typeof summarize>;

function UploadHeading({ files, onCancel, onDismiss, summary, children }: UploadProgressProps & { summary: UploadSummary; children?: ReactNode }) {
  const { active, saved, cancelling } = summary;
  return <div className="workspace-upload-heading"><span>Uploads</span><span className="workspace-upload-count">{active ? `${active} active` : `${saved} of ${files.length} saved`}</span>
    {children}
    {active > 0 && onCancel && <button className="workspace-upload-action" onClick={onCancel} disabled={cancelling} aria-label="Cancel uploads">{cancelling ? 'Cancelling…' : 'Cancel'}</button>}
    {!active && onDismiss && <button className="workspace-upload-action workspace-upload-dismiss" onClick={onDismiss} aria-label="Dismiss uploads"><X size={15} /></button>}
  </div>;
}

function WindowedUploads({ files, summary, onCancel, onDismiss }: UploadProgressProps & { summary: UploadSummary }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<MeasuredWindowHandle | null>(null);
  const rowNodes = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<string | null>(null);
  const pendingReveal = useRef<string | null>(null);
  const firstVisibleKey = useRef<string | null>(null);
  const followCurrent = useRef(true);
  const currentKey = summary.current?.id;
  const [selectedKey, setSelectedKey] = useState(currentKey ?? files[0].id);

  const focusPending = useCallback(() => {
    const key = pendingFocus.current;
    const node = key ? rowNodes.current.get(key) : undefined;
    if (!node || !scrollRef.current?.clientHeight) return;
    pendingFocus.current = null;
    node.focus({ preventScroll: true });
  }, []);
  const registerRow = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const key = node.dataset.uploadKey!;
    rowNodes.current.set(key, node);
    return () => { if (rowNodes.current.get(key) === node) rowNodes.current.delete(key); };
  }, []);
  const reveal = useCallback((key: string, focus = false) => {
    pendingFocus.current = focus ? key : null;
    setSelectedKey(key);
    pendingReveal.current = windowRef.current?.jumpToKey(key, 'nearest') ? null : key;
    if (focus) focusPending();
  }, [focusPending]);
  const onRangeChange = useCallback((range: MeasuredRange) => {
    firstVisibleKey.current = range.firstKey;
    const key = pendingReveal.current;
    if (key && windowRef.current?.jumpToKey(key, 'nearest')) pendingReveal.current = null;
    focusPending();
  }, [focusPending]);
  const browse = () => { followCurrent.current = false; pendingReveal.current = null; pendingFocus.current = null; };

  useLayoutEffect(focusPending);
  useLayoutEffect(() => {
    if (followCurrent.current && currentKey) reveal(currentKey);
  }, [currentKey, reveal]);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
    const focusedKey = target.closest<HTMLElement>('[data-upload-key]')?.dataset.uploadKey;
    const index = Math.max(0, files.findIndex(file => file.id === (focusedKey ?? firstVisibleKey.current ?? selectedKey)));
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 260) / 64));
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = focusedKey ? index + 1 : index; break;
      case 'ArrowUp': next = focusedKey ? index - 1 : index; break;
      case 'PageDown': next = index + page; break;
      case 'PageUp': next = index - page; break;
      case 'Home': next = 0; break;
      case 'End': next = files.length - 1; break;
      default: return;
    }
    event.preventDefault();
    browse();
    reveal(files[Math.max(0, Math.min(files.length - 1, next))].id, true);
  };
  const details = [
    `${summary.saved} of ${files.length} saved`,
    summary.queued ? `${summary.queued} waiting` : '',
    summary.active > summary.queued ? `${summary.active - summary.queued} in progress` : '',
    summary.failed ? `${summary.failed} failed` : '',
    summary.unconfirmed ? `${summary.unconfirmed} not confirmed` : '',
    summary.cancelled ? `${summary.cancelled} cancelled` : '',
  ].filter(Boolean).join(' · ');

  return <section className="workspace-uploads workspace-uploads-windowed" aria-label="File uploads">
    <UploadHeading files={files} summary={summary} onCancel={onCancel} onDismiss={onDismiss}>
      {currentKey && <button className="workspace-upload-action" aria-label="Show active upload" onClick={() => { followCurrent.current = true; reveal(currentKey); }}>Current</button>}
    </UploadHeading>
    <div className="workspace-upload-overview"><p className="workspace-upload-summary" role="status" aria-atomic="true">{details}</p>
      {summary.problem && <button className="workspace-upload-action" aria-label="Show upload problem" onClick={() => { browse(); reveal(summary.problem!.id, true); }}>Issues</button>}
    </div>
    <div ref={scrollRef} className="workspace-upload-list is-windowed" role="list" aria-label="Upload files" tabIndex={0}
      onKeyDown={navigate} onPointerDown={browse} onWheel={browse} onTouchMove={browse}
      onFocusCapture={event => {
        const key = (event.target as HTMLElement).closest<HTMLElement>('[data-upload-key]')?.dataset.uploadKey;
        if (key) { browse(); setSelectedKey(key); }
      }}>
      <MeasuredWindow items={files} itemKey={uploadKey} estimateHeight={uploadHeight} scrollRef={scrollRef} handleRef={windowRef}
        resetKey={files[0].id} overscan={180} onRangeChange={onRangeChange}
        renderItem={(file, index) => <div ref={registerRow} role="listitem" tabIndex={-1} data-upload-key={file.id}
          className={`workspace-upload-item ${file.error ? 'has-error' : ''} ${file.id === selectedKey ? 'is-selected' : ''}`}
          aria-label={`Upload ${file.fileName}`} aria-posinset={index + 1} aria-setsize={files.length}
          aria-current={file.id === currentKey && file.stage !== 'queued' ? 'true' : undefined}>
          <UploadDetails file={file} />
        </div>} />
    </div>
  </section>;
}

/** Keep the full transfer plan; only large batches limit their mounted rows. */
export default function UploadProgress({ files, onCancel, onDismiss }: UploadProgressProps) {
  if (!files.length) return null;
  const summary = summarize(files);
  if (files.length > WINDOW_AFTER) return <WindowedUploads key={files[0].id} files={files} summary={summary} onCancel={onCancel} onDismiss={onDismiss} />;
  return <section className="workspace-uploads" aria-label="File uploads">
    <UploadHeading files={files} summary={summary} onCancel={onCancel} onDismiss={onDismiss} />
    <ol className="workspace-upload-list">{files.map(file => <li key={file.id} className={`workspace-upload-item ${file.error ? 'has-error' : ''}`} aria-label={`Upload ${file.fileName}`}><UploadDetails file={file} /></li>)}</ol>
  </section>;
}
