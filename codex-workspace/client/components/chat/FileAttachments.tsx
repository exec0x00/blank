import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Download, Eye, File as FileIcon, FileArchive, FileCode2, FileText, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { FileAttachment, FileAttachmentInspection } from '../../../shared/types';
import { api } from '../../api';
import { startAttachmentDownload } from '../../downloads';
import Modal from '../Modal';
import { FILE_ATTACHMENT_LIMITS, validFileAttachment, type FileAttachmentStage } from './file-attachment-transfer';
import { useFileAttachmentLock, type ComposerFileAttachment, type FileAttachmentsController } from './useFileAttachments';
import './file-attachments.css';

const encoded = encodeURIComponent;
const INSPECTION_BYTES = 16 * 1024;
const BUSY = new Set<FileAttachmentStage>(['queued', 'reserving', 'checking', 'preparing', 'uploading', 'publishing', 'importing', 'cancelling', 'removing']);
const labels: Record<FileAttachmentStage, string> = {
  queued: 'Waiting to upload', reserving: 'Preparing upload', checking: 'Checking upload', preparing: 'Preparing file', uploading: 'Uploading',
  publishing: 'Finishing upload', importing: 'Verifying file', cancelling: 'Cancelling', ready: 'Ready', failed: 'Needs attention', cancelled: 'Cancelled',
  unconfirmed: 'Upload not confirmed', paused: 'Paused', removing: 'Removing',
};

export const attachmentSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KiB` : `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MiB`;
export function attachmentKind(name: string, mimeType: string): string {
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(name)) return 'PDF';
  if (mimeType === 'text/plain' || /\.txt$/i.test(name)) return 'Text';
  if (/\.(?:zip|tar|gz|tgz|7z|rar)$/i.test(name)) return 'Archive';
  if (/\.(?:csv|tsv|xlsx?|ods)$/i.test(name)) return 'Spreadsheet';
  if (/\.(?:docx?|odt|rtf)$/i.test(name)) return 'Document';
  if (/\.md(?:own|x)?$/i.test(name)) return 'Markdown';
  const extension = /\.([a-zA-Z0-9]{1,10})$/.exec(name)?.[1].toUpperCase();
  return extension ? `${extension} file` : mimeType.startsWith('text/') ? 'Text' : 'File';
}
function AttachmentIcon({ name, mimeType }: { name: string; mimeType: string }) {
  const kind = attachmentKind(name, mimeType);
  const Icon = kind === 'Archive' ? FileArchive : ['Text', 'Document', 'Markdown', 'PDF', 'Spreadsheet'].includes(kind) ? FileText
    : /\.(?:json|ya?ml|toml|xml|html?|css|s?css|[cm]?[jt]sx?|py|rb|go|rs|sh|sql|c|cpp|h)$/i.test(name) ? FileCode2 : FileIcon;
  return <Icon size={20} aria-hidden="true" />;
}
function download(attachment: FileAttachment) {
  if (document.body.dataset.workspaceLocked === 'true' || !validFileAttachment(attachment, attachment.workspaceId)) return;
  startAttachmentDownload({ workspaceId: attachment.workspaceId, attachmentId: attachment.id, sha256: attachment.sha256, fileName: attachment.name, size: attachment.bytes });
}

/** Reject mismatched and oversized inspection responses before displaying them. */
export function validateFileInspection(value: FileAttachmentInspection, attachment: FileAttachment, offset: number): FileAttachmentInspection {
  if (!value || !validFileAttachment(value.attachment, attachment.workspaceId) || value.attachment.id !== attachment.id
    || value.attachment.sha256 !== attachment.sha256 || value.attachment.name !== attachment.name || value.attachment.bytes !== attachment.bytes
    || !['utf8', 'binary'].includes(value.format) || !Number.isSafeInteger(value.offset) || value.offset < offset || value.offset > offset + 3
    || !Number.isSafeInteger(value.bytesRead) || value.bytesRead < 0 || value.bytesRead > INSPECTION_BYTES || value.totalBytes !== attachment.bytes
    || value.offset + value.bytesRead > value.totalBytes || typeof value.truncated !== 'boolean'
    || value.nextOffset !== undefined && (!Number.isSafeInteger(value.nextOffset) || value.nextOffset <= value.offset || value.nextOffset !== value.offset + value.bytesRead || value.nextOffset >= value.totalBytes)
    || value.format === 'utf8' && (typeof value.content !== 'string' || value.content.length > INSPECTION_BYTES)
    || value.format === 'binary' && (value.hex !== undefined && (typeof value.hex !== 'string' || value.hex.length > 48 * 1024))
    || value.notice !== undefined && (typeof value.notice !== 'string' || value.notice.length > 2000)) {
    throw new Error('The saved file preview did not match this attachment. Close it and try again.');
  }
  return value;
}

export function FileInspectionContent({ inspection }: { inspection: FileAttachmentInspection }) {
  if (inspection.format === 'utf8') return inspection.content
    ? <pre className="cw-file-inspection-text" tabIndex={0} aria-label="Attached file text">{inspection.content}</pre>
    : <p className="cw-file-inspection-empty">{inspection.totalBytes === 0 ? 'This file is empty.' : 'No text is available in this part of the file.'}</p>;
  return <div className="cw-file-inspection-binary">
    <FileIcon size={26} aria-hidden="true" /><p>{inspection.notice || 'A text preview is not available for this file.'}</p>
    <span>Download the file to open it in a compatible application.</span>
    {inspection.hex && <details><summary>Inspect file bytes</summary><pre tabIndex={0} aria-label="Attached file bytes">{inspection.hex}</pre></details>}
  </div>;
}

export function FileAttachmentPreview({ attachment, onClose }: { attachment: FileAttachment; onClose: () => void }) {
  const titleId = useId();
  const locked = useFileAttachmentLock();
  const [offsets, setOffsets] = useState([0]);
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<{ key: string; inspection?: FileAttachmentInspection; error?: string } | null>(null);
  const offset = offsets.at(-1)!;
  const key = `${attachment.workspaceId}:${attachment.id}:${attachment.sha256}:${offset}:${attempt}`;
  const inspection = load?.key === key ? load.inspection : undefined;
  const error = load?.key === key ? load.error : undefined;
  const loading = !locked && !inspection && !error;
  const latestClose = useRef(onClose); latestClose.current = onClose;
  useEffect(() => { if (locked) latestClose.current(); }, [locked]);
  useEffect(() => {
    if (locked) return;
    const controller = new AbortController();
    if (!validFileAttachment(attachment, attachment.workspaceId)) { setLoad({ key, error: 'This attachment reference is unavailable.' }); return; }
    void api<FileAttachmentInspection>(`/workspaces/${encoded(attachment.workspaceId)}/file-attachments/${encoded(attachment.id)}/inspect?sha256=${attachment.sha256}&offset=${offset}&maxBytes=${INSPECTION_BYTES}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted && document.body.dataset.workspaceLocked !== 'true') setLoad({ key, inspection: validateFileInspection(value, attachment, offset) }); })
      .catch(failure => { if (!controller.signal.aborted) setLoad({ key, error: failure instanceof Error ? failure.message.slice(0, 600) : 'This preview could not be loaded. Try again.' }); });
    return () => controller.abort();
  }, [key, locked]);
  return <Modal open={!locked} title={attachment.name} titleId={titleId} onClose={onClose} description={`${attachmentKind(attachment.name, attachment.mimeType)} · ${attachmentSize(attachment.bytes)}`} className="cw-file-preview">
    <div className="cw-file-preview-toolbar"><span>{inspection ? inspection.format === 'utf8' ? 'Text preview' : 'File inspection' : 'File preview'}</span><button type="button" className="cw-file-download" onClick={() => download(attachment)}><Download size={14} />Download file</button></div>
    <div className="cw-file-preview-content" aria-busy={loading}>
      {loading && <div className="cw-file-inspection-message" role="status"><LoaderCircle size={20} className="cw-file-spin" /><p>Loading file preview…</p></div>}
      {error && <div className="cw-file-inspection-message is-error" role="alert"><AlertCircle size={22} /><p>{error}</p><button type="button" className="button" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={14} />Retry preview</button></div>}
      {inspection && <FileInspectionContent inspection={inspection} />}
    </div>
    {inspection && <div className="cw-file-preview-paging"><span>{inspection.totalBytes === 0 ? '0 bytes' : `Bytes ${inspection.offset + 1}–${inspection.offset + inspection.bytesRead} of ${inspection.totalBytes}`}{inspection.truncated ? ' · Preview truncated' : ''}</span>
      {(offsets.length > 1 || inspection.nextOffset !== undefined) && <div><button type="button" className="cw-file-action" aria-label="Previous part of file" disabled={offsets.length < 2} onClick={() => setOffsets(value => value.slice(0, -1))}><ArrowLeft size={16} /></button><button type="button" className="cw-file-action" aria-label="Next part of file" disabled={inspection.nextOffset === undefined} onClick={() => { if (inspection.nextOffset !== undefined) setOffsets(value => [...value, inspection.nextOffset!]); }}><ArrowRight size={16} /></button></div>}
    </div>}
  </Modal>;
}

export function ComposerFileCard({ item, disabled, onPreview, onRemove, onCancel, onRetry }: {
  item: ComposerFileAttachment; disabled?: boolean; onPreview?: () => void; onRemove: (trigger: HTMLButtonElement) => void; onCancel: () => void; onRetry: () => void;
}) {
  const active = BUSY.has(item.stage), label = labels[item.stage];
  const measured = item.stage === 'uploading' || item.stage === 'importing';
  const received = item.stage === 'importing' ? item.bytesImported : item.bytesUploaded;
  const percent = measured && item.bytes > 0 ? Math.max(0, Math.min(100, Math.floor(received / item.bytes * 100))) : undefined;
  const needsRetry = ['failed', 'cancelled', 'unconfirmed', 'paused'].includes(item.stage);
  return <li className={`cw-file-draft-card is-${item.stage}`} aria-label={`Attachment ${item.name}`}>
    <span className="cw-file-type-icon"><AttachmentIcon name={item.name} mimeType={item.mimeType} /></span>
    <div className="cw-file-card-info"><strong title={item.name}>{item.name}</strong><span>{attachmentKind(item.name, item.mimeType)} · {attachmentSize(item.bytes)}</span>
      <span className={`cw-file-status ${item.error ? 'has-error' : ''}`}>{active ? <LoaderCircle size={11} className="cw-file-spin" /> : item.stage === 'ready' ? <Check size={11} /> : needsRetry ? <AlertCircle size={11} /> : null}{label}{percent !== undefined && <span>{percent}%</span>}</span>
      {active && item.stage !== 'queued' && <span className={`cw-file-progress ${percent === undefined ? 'is-indeterminate' : ''}`} role="progressbar" aria-label={`${label}: ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={percent === undefined ? label : `${attachmentSize(received)} of ${attachmentSize(item.bytes)}`}><span style={percent === undefined ? undefined : { width: `${percent}%` }} /></span>}
      {item.error && <p className="cw-file-card-error" role="alert">{item.error}</p>}
      {item.notice && <p className="cw-file-card-notice">{item.notice}</p>}
    </div>
    <div className="cw-file-card-actions">
      {onPreview && <button type="button" className="cw-file-action" aria-label={`Inspect ${item.name}`} onClick={onPreview}><Eye size={14} /></button>}
      {needsRetry && <button type="button" className="cw-file-action" aria-label={`${item.attachment ? 'Retry removing' : item.stage === 'unconfirmed' ? 'Check upload of' : 'Retry upload of'} ${item.name}`} disabled={disabled} onClick={onRetry}><RotateCcw size={14} /></button>}
      <button type="button" className="cw-file-action" aria-label={`${active ? 'Cancel upload of' : 'Remove'} ${item.name}`} disabled={disabled || item.stage === 'removing' || item.stage === 'cancelling'} onClick={event => active ? onCancel() : onRemove(event.currentTarget)}><X size={14} /></button>
    </div>
  </li>;
}

export function FileAttachmentComposer({ controller }: { controller: FileAttachmentsController }) {
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const currentScope = useRef(controller.scope); currentScope.current = controller.scope;
  const preview = controller.items.find(item => item.key === previewKey)?.attachment;
  useEffect(() => setPreviewKey(null), [controller.scope, controller.locked]);
  if (controller.locked) return null;
  function remove(key: string, trigger: HTMLButtonElement) {
    const scope = controller.scope;
    void controller.remove(key).finally(() => requestAnimationFrame(() => {
      if (document.body.dataset.workspaceLocked === 'true' || currentScope.current !== scope) return;
      if (document.activeElement === document.body || document.activeElement === trigger) {
        (root.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? root.current?.closest('form')?.querySelector<HTMLElement>('.cw-file-attach-button:not(:disabled), textarea:not(:disabled)'))?.focus();
      }
    }));
  }
  return <div className="cw-file-composer" ref={root}>
    {controller.items.length > 0 && <ul className="cw-file-draft-list" aria-label="Files attached to this message">{controller.items.map(item => <ComposerFileCard key={item.key} item={item} disabled={controller.disabled} onPreview={item.attachment ? () => setPreviewKey(item.key) : undefined} onRemove={trigger => remove(item.key, trigger)} onCancel={() => controller.cancel(item.key)} onRetry={() => controller.retry(item.key)} />)}</ul>}
    {controller.error && <div className="cw-file-selection-error" role="alert"><AlertCircle size={14} /><span>{controller.error}</span><button type="button" className="cw-file-action" aria-label="Dismiss file attachment error" onClick={controller.clearError}><X size={14} /></button></div>}
    <span className="sr-only" role="status" aria-live="polite">{controller.isBusy ? 'Updating file attachments. Wait before sending.' : controller.hasErrors ? 'A file needs attention. Retry or remove it before sending.' : controller.items.length ? `${controller.items.length} files ready to send.` : ''}</span>
    {preview && <FileAttachmentPreview key={preview.id} attachment={preview} onClose={() => setPreviewKey(null)} />}
  </div>;
}

export function MessageFileAttachments({ attachments, workspaceId, locked: explicitlyLocked = false }: { attachments?: readonly FileAttachment[]; workspaceId: string; locked?: boolean }) {
  const locked = useFileAttachmentLock(explicitlyLocked);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [workspaceId, locked]);
  if (locked || !attachments?.length) return null;
  const files = attachments.slice(0, FILE_ATTACHMENT_LIMITS.count), selected = files.find(item => item.id === selectedId);
  return <div className="cw-file-message-attachments"><ul className="cw-file-message-list" aria-label="Attached files">{files.map(attachment => {
    const valid = validFileAttachment(attachment, workspaceId);
    return <li key={attachment.id} className="cw-file-message-card"><span className="cw-file-type-icon"><AttachmentIcon name={attachment.name} mimeType={attachment.mimeType} /></span>
      <button type="button" className="cw-file-message-open" aria-label={`Inspect attached file ${attachment.name}`} disabled={!valid} onClick={() => setSelectedId(attachment.id)}><strong title={attachment.name}>{attachment.name}</strong><span>{attachmentKind(attachment.name, attachment.mimeType)} · {attachmentSize(attachment.bytes)}{!valid ? ' · Unavailable' : ''}</span></button>
      <button type="button" className="cw-file-action" aria-label={`Download file ${attachment.name}`} title="Download file" disabled={!valid} onClick={() => download(attachment)}><Download size={16} /></button>
    </li>;
  })}</ul>{selected && validFileAttachment(selected, workspaceId) && <FileAttachmentPreview key={selected.id} attachment={selected} onClose={() => setSelectedId(null)} />}</div>;
}
