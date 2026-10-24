import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronDown, ChevronUp, CircleAlert, ExternalLink, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { downloads, publicDownloadUrl, useDownloads, type DownloadTransfer } from '../downloads';
import { MeasuredWindow } from './chat/MeasuredWindow';
import './downloads.css';

const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`;
const working = (item: DownloadTransfer) => ['choosing', 'preparing', 'receiving'].includes(item.stage) || item.cancelling;
const transferKey = (item: DownloadTransfer) => item.id;
const transferHeight = (item: DownloadTransfer) => item.error || item.notice ? 240 : 185;

function status(item: DownloadTransfer) {
  if (item.cancelling) return 'Cancelling preparation…';
  if (item.stage === 'choosing') return 'Choose where to save the file';
  if (item.stage === 'receiving') return 'Saving from Hugging Face';
  if (item.stage === 'saved') return 'File saved';
  if (item.stage === 'started') return item.delivery === 'native' ? 'Download requested' : 'Download sent to browser';
  if (item.stage === 'cancelled') return 'Download cancelled';
  if (item.stage === 'failed') return 'Could not prepare download';
  if (item.stage === 'expired') return 'Download expired';
  if (item.stage === 'ready') return 'Ready to save';
  if (item.job?.state === 'snapshotting') return 'Preparing saved file';
  if (item.job?.state === 'uploading') return 'Uploading to download bucket';
  return 'Preparing download…';
}

function DownloadRow({ item }: { item: DownloadTransfer }) {
  const busy = working(item);
  const finished = item.stage === 'saved' || item.stage === 'started';
  const native = item.delivery === 'native';
  const link = publicDownloadUrl(item.job);
  const total = item.job?.size ?? item.request.size;
  const current = item.stage === 'receiving' ? item.bytesReceived : item.job?.bytesProcessed || 0;
  const measurable = item.stage === 'receiving' || ['snapshotting', 'uploading'].includes(item.job?.state || '');
  const determinate = measurable && total !== undefined && total > 0;
  const percent = determinate ? Math.min(100, Math.floor(current / total * 100)) : undefined;
  const versionConflict = ['VERSION_CONFLICT', 'DOWNLOAD_FILE_CHANGED'].includes(item.errorCode || '');
  const retry = ['failed', 'cancelled', 'expired'].includes(item.stage) && !versionConflict;
  const expiry = link && item.job?.expiresAt ? new Date(item.job.expiresAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);

  return <div className={`download-item ${item.error ? 'has-error' : ''}`} role="listitem" aria-label={`Download ${item.fileName}`}>
    <div className="download-item-top"><span className="download-file-icon" aria-hidden="true">{busy ? <LoaderCircle size={17} className="download-spin" /> : finished && !native ? <Check size={17} /> : item.error ? <CircleAlert size={17} /> : <ArrowDownToLine size={17} />}</span><div className="download-file-details"><strong title={item.request.path}>{item.fileName}</strong><span>{total === undefined ? 'Saved file' : bytes(total)}{item.request.hasUnsavedChanges ? ' · Saved version' : ''}</span></div>{!busy && <button className="download-icon-button" aria-label={`Dismiss download ${item.fileName}`} onClick={() => downloads.dismiss(item.id)}><X size={15} /></button>}</div>
    <div className="download-status"><span role="status">{status(item)}</span>{busy && determinate && <span>{bytes(Math.min(current, total!))} / {bytes(total!)}</span>}</div>
    {busy && item.stage !== 'choosing' && <div className={`download-progress-track ${determinate ? '' : 'is-waiting'}`} role="progressbar" aria-label={status(item)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={determinate ? `${bytes(Math.min(current, total!))} of ${bytes(total!)}` : status(item)}><span style={determinate ? { width: `${percent}%` } : undefined} /></div>}
    {item.request.hasUnsavedChanges && <p className="download-detail">Unsaved editor changes are not included.</p>}
    {item.connection === 'reconnecting' && busy && <p className="download-detail" role="status">Reconnecting… Preparation continues on the server.</p>}
    {item.error && <p className="download-error" role="alert">{item.error}{versionConflict && ' Reload the file in the editor, then choose Download again.'}</p>}
    {item.notice && <p className="download-detail">{item.notice}</p>}
    {copyError && <p className="download-error" role="alert">Could not copy the link. Open the bucket link instead.</p>}
    {expiry && <p className="download-detail">Public link available until {expiry}.</p>}
    <div className="download-actions">
      {busy && <button className="download-button" disabled={item.cancelling} onClick={() => downloads.cancel(item.id)}>{item.stage === 'receiving' ? 'Stop saving' : 'Cancel'}</button>}
      {retry && <button className="download-button" onClick={() => downloads.retry(item.id)}><RotateCcw size={14} />Prepare again</button>}
      {!busy && link && <>{native ? <a className="download-button download-primary" href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" download={item.fileName}><ArrowDownToLine size={14} />Download file<ExternalLink size={13} /></a> : <><button className="download-button download-primary" onClick={() => downloads.saveAgain(item.id)}><ArrowDownToLine size={14} />{finished ? 'Save again' : 'Save file'}</button><a className="download-button" href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" download={item.fileName}>Bucket link<ExternalLink size={13} /></a></>}<button className="download-button download-copy" onClick={() => { setCopyError(false); void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => { setCopied(false); setCopyError(true); }); }} aria-label={`Copy public download link for ${item.fileName}`}>{copied ? 'Copied' : 'Copy link'}</button></>}
    </div>
  </div>;
}

/** Mount once in the authenticated app shell so pane switches never lose jobs. */
export default function DownloadProgress({ active }: { active: boolean }) {
  const snapshot = useDownloads();
  const [expanded, setExpanded] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => [...snapshot.transfers].reverse(), [snapshot.transfers]);
  const count = snapshot.transfers.length;
  const running = snapshot.transfers.filter(working).length;
  useEffect(() => { downloads.setActive(active); }, [active]);
  useEffect(() => { if (count) setExpanded(true); }, [count]);
  useEffect(() => { if (!active) return; const timer = setInterval(downloads.expire, 15_000); return () => clearInterval(timer); }, [active]);
  if (!active || !snapshot.active || !count) return null;
  return <aside className={`download-tray ${expanded ? 'is-expanded' : ''}`} aria-label="File downloads">
    <button className="download-tray-heading" aria-expanded={expanded} aria-controls="download-transfer-list" onClick={() => setExpanded(value => !value)}><ArrowDownToLine size={17} /><span>Downloads</span><span className="download-count">{running ? `${running} active` : count}</span>{expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
    <div id="download-transfer-list" ref={list} className="download-list" role="list" aria-label="Download transfers" hidden={!expanded}>{ordered.length > 24
      ? <MeasuredWindow items={ordered} itemKey={transferKey} estimateHeight={transferHeight} scrollRef={list} resetKey="download-transfers" overscan={250} renderItem={item => <DownloadRow item={item} />} />
      : ordered.map(item => <DownloadRow key={item.id} item={item} />)}</div>
  </aside>;
}
