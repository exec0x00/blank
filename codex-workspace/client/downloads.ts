import { useSyncExternalStore } from 'react';
import type { DownloadJob } from '../shared/types';
import { api, ApiError, json } from './api';

// This cap applies to the browser fallback only. Larger files are streamed to a
// user-selected file or handed directly to the browser's download manager.
export const DOWNLOAD_MEMORY_LIMIT = 32 * 1024 * 1024;
const CACHE_KEY = 'codex.download-job-ids';
const MAX_HISTORY = 24;
type SaveHandle = { createWritable: () => Promise<{ write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }> };
type PickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; id: string }) => Promise<SaveHandle> };

export interface DownloadRequest {
  workspaceId: string;
  path: string;
  expectedVersion?: string;
  size?: number;
  hasUnsavedChanges?: boolean;
  /** For message assets path is only a display name, never a workspace file path. */
  attachment?: { id: string; sha256: string };
  generatedImage?: { id: string; sha256: string };
}

export interface AttachmentDownloadRequest { workspaceId: string; attachmentId: string; sha256: string; fileName: string; size: number }
export interface GeneratedImageDownloadRequest { workspaceId: string; imageId: string; sha256: string; fileName: string; size: number }

export interface DownloadTransfer {
  id: string;
  request: DownloadRequest;
  fileName: string;
  job?: DownloadJob;
  stage: 'choosing' | 'preparing' | 'ready' | 'receiving' | 'saved' | 'started' | 'failed' | 'cancelled' | 'expired';
  bytesReceived: number;
  connection: 'live' | 'reconnecting';
  error?: string;
  errorCode?: string;
  notice?: string;
  cancelling?: boolean;
  delivery?: 'native';
}

interface Runtime {
  source?: EventSource;
  retryTimer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
  refreshController?: AbortController;
  autoSave: boolean;
  cancelled?: boolean;
  handle?: SaveHandle;
}

interface DownloadSnapshot { active: boolean; transfers: readonly DownloadTransfer[] }
const pending = (job: DownloadJob) => ['queued', 'snapshotting', 'uploading'].includes(job.state);
const fileName = (path: string) => path.split('/').at(-1) || 'download';
const getError = (error: unknown) => error instanceof Error ? error.message : 'The download could not be completed. Try again.';
const errorCode = (error: unknown) => error instanceof ApiError ? error.code : undefined;
const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const validSource = (source: NonNullable<DownloadJob['source']>) => !!source && typeof source === 'object'
  && Object.keys(source).every(key => ['type', 'id', 'sha256'].includes(key))
  && (source.type === 'attachment' && /^file_[a-f0-9]{32}$/.test(source.id)
    || source.type === 'generated_image' && /^img_[a-f0-9]{64}$/.test(source.id))
  && /^[a-f0-9]{64}$/.test(source.sha256);

/** Only the fixed public bucket can provide a download URL, never an app proxy. */
export function publicDownloadUrl(job?: DownloadJob): string | undefined {
  if (!job?.url || job.state !== 'ready' || !job.expiresAt || !Number.isFinite(Date.parse(job.expiresAt)) || Date.parse(job.expiresAt) <= Date.now()) return;
  try {
    const url = new URL(job.url);
    if (url.origin !== 'https://huggingface.co' || url.username || url.password || url.hash) return;
    if (!/^\/buckets\/alvin3y12\/codex-downloads\/resolve\/exports\/[a-f0-9-]{36}\/[^/]+$/.test(url.pathname)) return;
    const name = decodeURIComponent(url.pathname.split('/').at(-1)!);
    if (!name || name !== job.fileName || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) return;
    if (url.searchParams.size !== 1 || url.searchParams.get('download') !== 'true') return;
    return url.href;
  } catch { return; }
}

function picker(request: DownloadRequest): Promise<SaveHandle | undefined> | undefined {
  const choose = (window as PickerWindow).showSaveFilePicker;
  if (!choose || (request.size !== undefined && request.size <= DOWNLOAD_MEMORY_LIMIT)) return;
  // This call must remain on the original click stack, before any API awaits.
  try { return choose.call(window, { suggestedName: fileName(request.path), id: 'codex-workspace-download' }); }
  catch (error) { return Promise.reject(error); }
}

class DownloadManager {
  private snapshot: DownloadSnapshot = { active: false, transfers: [] };
  private listeners = new Set<() => void>();
  private runtimes = new Map<string, Runtime>();
  private restoring = false;
  private restored = false;
  private recoveryIds = new Set<string>();
  private cachedIndex?: string;
  private objectUrls = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('codex:session-locked', () => this.setActive(false));
    window.addEventListener('codex:session-expired', () => this.setActive(false));
    window.addEventListener('codex:session-unlocked', () => this.setActive(true));
    window.addEventListener('pagehide', () => this.setActive(false));
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;
  private publish(transfers = this.snapshot.transfers) {
    this.snapshot = { ...this.snapshot, transfers };
    this.listeners.forEach(listener => listener());
    // This is only a recovery index. Authoritative metadata lives on the server;
    // no file links, names, account tokens or file bytes enter browser storage.
    try {
      const index = JSON.stringify([...new Set([...this.recoveryIds, ...transfers.flatMap(item => item.job ? [item.job.id] : [])])].slice(-MAX_HISTORY));
      if (index !== this.cachedIndex) { sessionStorage.setItem(CACHE_KEY, index); this.cachedIndex = index; }
    } catch { /* Optional recovery cache. */ }
  }
  private find(id: string) { return this.snapshot.transfers.find(item => item.id === id); }
  private update(id: string, patch: Partial<DownloadTransfer>) { this.publish(this.snapshot.transfers.map(item => item.id === id ? { ...item, ...patch } : item)); }
  private closeEvents(runtime: Runtime) {
    runtime.source?.close(); runtime.source = undefined;
    if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
    runtime.retryTimer = undefined;
    runtime.refreshController?.abort(); runtime.refreshController = undefined;
  }

  setActive = (active: boolean) => {
    if (active === this.snapshot.active) return;
    this.snapshot = { ...this.snapshot, active };
    if (!active) {
      for (const runtime of this.runtimes.values()) {
        this.closeEvents(runtime); runtime.controller?.abort(); runtime.controller = undefined;
        runtime.autoSave = false; runtime.handle = undefined;
      }
      for (const [url, timer] of this.objectUrls) { clearTimeout(timer); URL.revokeObjectURL(url); }
      this.objectUrls.clear();
      this.publish(this.snapshot.transfers.map(item => {
        if (item.stage === 'receiving') return { ...item, stage: 'ready', bytesReceived: 0, notice: 'Saving stopped when the workspace locked. Choose Save file to try again.' };
        if (!item.job && ['choosing', 'preparing'].includes(item.stage)) return { ...item, stage: 'cancelled', notice: 'The workspace was locked.' };
        return item;
      }));
    } else {
      // Read the recovery cache before publish can update it.
      const cached = !this.restored ? this.cachedIds() : [];
      cached.forEach(id => this.recoveryIds.add(id));
      this.publish();
      for (const item of this.snapshot.transfers) if (item.job && !['cancelled', 'failed', 'expired'].includes(item.stage)) void this.refresh(item.id);
      if (!this.restored) void this.restore(cached);
    }
  };

  private cachedIds(): string[] {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '[]');
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)).slice(-MAX_HISTORY) : [];
    } catch { return []; }
  }

  private async restore(ids: string[]) {
    if (this.restoring) return;
    this.restoring = true;
    try {
      for (const jobId of ids) {
        if (!this.snapshot.active) return;
        if (this.snapshot.transfers.some(item => item.job?.id === jobId)) continue;
        const id = `recovered-${jobId}`;
        const runtime: Runtime = { autoSave: false, refreshController: new AbortController() };
        this.runtimes.set(id, runtime);
        try {
          const job = await api<DownloadJob>(`/downloads/${encodeURIComponent(jobId)}`, { signal: runtime.refreshController!.signal });
          runtime.refreshController = undefined;
          if (!this.snapshot.active) return;
          if (job.source && !validSource(job.source)) throw new Error('Invalid download source.');
          this.recoveryIds.delete(jobId);
          this.publish([...this.snapshot.transfers, { id, request: { workspaceId: job.workspaceId, path: job.path, expectedVersion: job.version, size: job.size,
            ...(job.source?.type === 'attachment' ? { attachment: { id: job.source.id, sha256: job.source.sha256 } } : {}),
            ...(job.source?.type === 'generated_image' ? { generatedImage: { id: job.source.id, sha256: job.source.sha256 } } : {}) }, fileName: job.fileName, stage: 'preparing', bytesReceived: 0, connection: 'live', job }]);
          this.accept(id, job);
        } catch (error) {
          this.runtimes.delete(id);
          if (error instanceof ApiError && [404, 410].includes(error.status)) this.recoveryIds.delete(jobId);
        }
      }
      this.restored = true;
      this.publish();
    } finally { this.restoring = false; }
  }

  start = (request: DownloadRequest) => {
    if (!this.snapshot.active) return;
    if (request.attachment && request.generatedImage) return;
    const selected = picker(request);
    const id = crypto.randomUUID();
    this.runtimes.set(id, { autoSave: true });
    const removable = this.snapshot.transfers.filter(item => !['choosing', 'preparing', 'receiving'].includes(item.stage));
    if (this.snapshot.transfers.length >= MAX_HISTORY && removable[0]) this.dismiss(removable[0].id);
    this.publish([...this.snapshot.transfers, { id, request: { ...request }, fileName: fileName(request.path), stage: selected ? 'choosing' : 'preparing', bytesReceived: 0, connection: 'live' }]);
    void this.prepare(id, selected);
  };

  startAttachment = (request: AttachmentDownloadRequest) => {
    if (!/^file_[a-f0-9]{32}$/.test(request.attachmentId) || !/^[a-f0-9]{64}$/.test(request.sha256)
      || !request.workspaceId || !request.fileName || /[/\\\u0000-\u001f\u007f]/.test(request.fileName)
      || !Number.isSafeInteger(request.size) || request.size < 0) return;
    this.start({ workspaceId: request.workspaceId, path: request.fileName, size: request.size, attachment: { id: request.attachmentId, sha256: request.sha256 } });
  };

  startGeneratedImage = (request: GeneratedImageDownloadRequest) => {
    if (!/^img_[a-f0-9]{64}$/.test(request.imageId) || !/^[a-f0-9]{64}$/.test(request.sha256)
      || !request.workspaceId || !request.fileName || /[/\\\u0000-\u001f\u007f]/.test(request.fileName)
      || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 8 * 1024 * 1024) return;
    this.start({ workspaceId: request.workspaceId, path: request.fileName, size: request.size,
      generatedImage: { id: request.imageId, sha256: request.sha256 } });
  };

  private async chooseHandle(id: string, selected?: Promise<SaveHandle | undefined>) {
    if (!selected) return true;
    const runtime = this.runtimes.get(id)!;
    try {
      const handle = await selected;
      if (!this.snapshot.active || runtime.cancelled || !this.find(id)) return false;
      runtime.handle = handle; return true;
    } catch (error) {
      if (!this.snapshot.active || !this.find(id)) return false;
      if (aborted(error)) { this.update(id, { stage: 'cancelled', notice: 'No file was selected.' }); return false; }
      // Embedded or unsupported browsers may forbid the File System Access API.
      // Keep the direct browser download available without buffering huge files.
      runtime.handle = undefined;
      this.update(id, { notice: 'This browser cannot choose a save location here. Its download manager will save the file instead.' });
      return true;
    }
  }

  private async prepare(id: string, selected?: Promise<SaveHandle | undefined>) {
    if (!await this.chooseHandle(id, selected)) return;
    const item = this.find(id); const runtime = this.runtimes.get(id);
    if (!item || !runtime || runtime.cancelled || !this.snapshot.active) return;
    this.update(id, { stage: 'preparing' });
    const controller = new AbortController(); runtime.controller = controller;
    try {
      const attachment = item.request.attachment;
      const generatedImage = item.request.generatedImage;
      const path = attachment ? `/workspaces/${encodeURIComponent(item.request.workspaceId)}/file-attachments/${encodeURIComponent(attachment.id)}/downloads`
        : generatedImage ? `/workspaces/${encodeURIComponent(item.request.workspaceId)}/generated-images/${encodeURIComponent(generatedImage.id)}/download`
          : `/workspaces/${encodeURIComponent(item.request.workspaceId)}/downloads`;
      const job = await api<DownloadJob>(path, {
        ...json('POST', attachment ? { sha256: attachment.sha256 } : generatedImage ? { sha256: generatedImage.sha256 }
          : { path: item.request.path, ...(item.request.expectedVersion ? { expectedVersion: item.request.expectedVersion } : {}) }), signal: controller.signal,
      });
      if (!this.snapshot.active || controller.signal.aborted || !this.find(id)) return;
      runtime.controller = undefined;
      this.update(id, { job });
      if (runtime.cancelled) { await this.cancelServer(id); return; }
      this.accept(id, job);
    } catch (error) {
      if (!this.snapshot.active || controller.signal.aborted || !this.find(id)) return;
      this.update(id, { stage: runtime.cancelled ? 'cancelled' : 'failed', cancelling: false, error: getError(error), errorCode: errorCode(error) });
    } finally { if (runtime.controller === controller) runtime.controller = undefined; }
  }

  private accept(id: string, job: DownloadJob) {
    const item = this.find(id); const runtime = this.runtimes.get(id);
    if (!item || !runtime || !this.snapshot.active) return;
    const selected = item.request.attachment ? { type: 'attachment' as const, ...item.request.attachment }
      : item.request.generatedImage ? { type: 'generated_image' as const, ...item.request.generatedImage } : undefined;
    if (selected && (job.workspaceId !== item.request.workspaceId || !job.source || !validSource(job.source) || job.source.type !== selected.type
      || job.source.id !== selected.id || job.source.sha256 !== selected.sha256
      || job.fileName !== item.request.path || job.path !== item.request.path
      || job.state === 'ready' && (job.version !== selected.sha256 || item.request.size !== undefined && job.size !== item.request.size))) {
      runtime.autoSave = false; this.closeEvents(runtime);
      this.update(id, { stage: 'failed', error: selected.type === 'attachment'
        ? 'The server returned a download for a different attachment. Prepare this file again.'
        : 'The server returned a download for a different generated image. Prepare this image again.', errorCode: 'DOWNLOAD_SOURCE_INVALID' });
      return;
    }
    // Reconnect replays cannot rewind a terminal job or start a second save.
    if (item.job && !pending(item.job) && pending(job)) return;
    if (item.job && Date.parse(job.updatedAt) < Date.parse(item.job.updatedAt)) return;
    this.update(id, { job, connection: 'live', error: job.error?.message, errorCode: job.error?.code });
    if (pending(job)) { if (!runtime.cancelled) this.watch(id); return; }
    this.closeEvents(runtime);
    if (job.state === 'ready') {
      if (!publicDownloadUrl(job)) {
        this.update(id, Date.parse(job.expiresAt || '') <= Date.now()
          ? { stage: 'expired', error: 'This download link expired. Prepare the saved file again.', errorCode: 'DOWNLOAD_EXPIRED' }
          : { stage: 'failed', error: 'The server returned an invalid download link.', errorCode: 'DOWNLOAD_INVALID_URL' });
        return;
      }
      if (['receiving', 'saved', 'started'].includes(item.stage)) return;
      this.update(id, { stage: 'ready', cancelling: false });
      if (runtime.autoSave && !runtime.cancelled) { runtime.autoSave = false; void this.save(id); }
    } else if (job.state === 'failed' || job.state === 'cancelled' || job.state === 'expired') this.update(id, { stage: job.state, cancelling: false });
  }

  private watch(id: string) {
    const item = this.find(id); const runtime = this.runtimes.get(id);
    if (!item?.job || !runtime || runtime.source || !this.snapshot.active) return;
    const source = new EventSource(`/api/downloads/${encodeURIComponent(item.job.id)}/events`, { withCredentials: true });
    runtime.source = source;
    source.addEventListener('download', event => {
      if (!this.snapshot.active || runtime.source !== source) return;
      try {
        const job = JSON.parse((event as MessageEvent).data) as DownloadJob;
        if (job.id === this.find(id)?.job?.id && job.workspaceId === item.request.workspaceId) this.accept(id, job);
      } catch { this.update(id, { connection: 'reconnecting' }); this.scheduleRefresh(id); }
    });
    source.onopen = () => { if (runtime.source === source && this.snapshot.active) this.update(id, { connection: 'live' }); };
    source.onerror = () => {
      if (runtime.source !== source || !this.snapshot.active) return;
      this.update(id, { connection: 'reconnecting' }); this.scheduleRefresh(id);
    };
  }

  private scheduleRefresh(id: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime || runtime.retryTimer || !this.snapshot.active) return;
    runtime.retryTimer = setTimeout(() => { runtime.retryTimer = undefined; void this.refresh(id); }, 1500);
  }

  private async refresh(id: string) {
    const item = this.find(id); const runtime = this.runtimes.get(id);
    if (!item?.job || !runtime || !this.snapshot.active || runtime.refreshController) return;
    const controller = new AbortController(); runtime.refreshController = controller;
    try {
      const job = await api<DownloadJob>(`/downloads/${encodeURIComponent(item.job.id)}`, { signal: controller.signal });
      if (!controller.signal.aborted && this.snapshot.active) this.accept(id, job);
    } catch (error) {
      if (!controller.signal.aborted && this.snapshot.active) {
        if (error instanceof ApiError && [404, 410].includes(error.status)) {
          this.closeEvents(runtime);
          this.update(id, { job: { ...item.job, state: 'expired', url: undefined }, stage: 'expired', error: 'This download is no longer available. Prepare the saved file again.', errorCode: 'DOWNLOAD_EXPIRED' });
        }
        else { this.update(id, { connection: 'reconnecting' }); this.scheduleRefresh(id); }
      }
    } finally { if (runtime.refreshController === controller) runtime.refreshController = undefined; }
  }

  saveAgain = (id: string) => {
    const item = this.find(id); const runtime = this.runtimes.get(id);
    if (!item || !runtime || !this.snapshot.active) return;
    runtime.cancelled = false;
    if (item.delivery === 'native') {
      const url = publicDownloadUrl(item.job);
      if (url) this.directDownload(id, url); else this.expire();
      return;
    }
    const selected = picker({ ...item.request, size: item.job?.size });
    if (selected) this.update(id, { stage: 'choosing', error: undefined });
    void this.chooseHandle(id, selected).then(proceed => { if (proceed && this.snapshot.active) void this.save(id); });
  };

  private directDownload(id: string, url: string) {
    const item = this.find(id)!;
    const link = document.createElement('a');
    link.href = url; link.download = item.fileName; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
    document.body.appendChild(link); link.click(); link.remove();
    const encodedName = /[^A-Za-z0-9._-]/.test(item.fileName);
    this.update(id, { stage: 'started', delivery: 'native', error: undefined, errorCode: undefined, notice: `Download requested. If it does not start, choose Download file.${encodedName ? ' The browser may encode the filename; you can rename it after saving.' : ''}` });
  }

  private async save(id: string) {
    const item = this.find(id); const runtime = this.runtimes.get(id);
    if (!item?.job || !runtime || !this.snapshot.active || runtime.cancelled) return;
    const url = publicDownloadUrl(item.job);
    if (!url) { this.expire(); return; }
    if (!runtime.handle && item.job.size > DOWNLOAD_MEMORY_LIMIT) { this.directDownload(id, url); return; }
    const saveHandle = runtime.handle; runtime.handle = undefined;
    const controller = new AbortController(); runtime.controller = controller;
    this.update(id, { stage: 'receiving', bytesReceived: 0, error: undefined, errorCode: undefined });
    let writable: Awaited<ReturnType<SaveHandle['createWritable']>> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
    try {
      if (saveHandle) writable = await saveHandle.createWritable();
      if (controller.signal.aborted) throw new DOMException('Download stopped.', 'AbortError');
      const response = await fetch(url, { credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw new ApiError(response.status === 404 || response.status === 410 ? 'This bucket link is no longer available. Prepare the saved file again.' : `The bucket download failed (${response.status}). Try again.`, response.status, [404, 410].includes(response.status) ? 'DOWNLOAD_EXPIRED' : 'DOWNLOAD_FETCH_FAILED');
      if (!response.body) throw new Error('This browser cannot stream the file. Use the bucket link.');
      reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      let lastPaint = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw new DOMException('Download stopped.', 'AbortError');
        if (done) break;
        received += value.byteLength;
        if (received > item.job.size) throw new Error('The downloaded file size did not match its prepared snapshot. Prepare it again.');
        if (writable) await writable.write(value);
        else {
          if (received > DOWNLOAD_MEMORY_LIMIT) throw new Error('This file is too large to buffer safely in this browser. Use the bucket link.');
          chunks.push(value);
        }
        if (performance.now() - lastPaint >= 80) { this.update(id, { bytesReceived: received }); lastPaint = performance.now(); }
      }
      if (received !== item.job.size) throw new Error('The download ended before all file bytes arrived. Try saving it again.');
      if (controller.signal.aborted || !this.snapshot.active) throw new DOMException('Download stopped.', 'AbortError');
      if (writable) { await writable.close(); writable = undefined; }
      else {
        const blobUrl = URL.createObjectURL(new Blob(chunks, { type: item.job.mimeType || 'application/octet-stream' }));
        const link = document.createElement('a'); link.href = blobUrl; link.download = item.fileName; link.rel = 'noopener';
        document.body.appendChild(link); link.click(); link.remove();
        this.objectUrls.set(blobUrl, setTimeout(() => { URL.revokeObjectURL(blobUrl); this.objectUrls.delete(blobUrl); }, 30_000));
      }
      if (!controller.signal.aborted && this.snapshot.active) this.update(id, { stage: saveHandle ? 'saved' : 'started', bytesReceived: received, notice: saveHandle ? 'Saved to your selected file.' : 'Sent to your browser’s downloads.' });
    } catch (error) {
      if (!controller.signal.aborted && this.snapshot.active && this.find(id)) {
        // Browser privacy/CORS/network policies can reject fetch even when a
        // native download works. Hand off the public URL without a Space proxy
        // and keep a real, user-clickable link if automatic navigation is blocked.
        if (error instanceof TypeError && publicDownloadUrl(item.job)) this.directDownload(id, url);
        else {
          const expired = errorCode(error) === 'DOWNLOAD_EXPIRED';
          this.update(id, { stage: expired ? 'expired' : 'ready', ...(expired ? { job: { ...item.job, state: 'expired', url: undefined } } : {}), errorCode: errorCode(error), error: getError(error) });
        }
      }
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      await writable?.abort().catch(() => {});
      if (runtime.controller === controller) runtime.controller = undefined;
    }
  }

  cancel = (id: string) => {
    const item = this.find(id); const runtime = this.runtimes.get(id);
    if (!item || !runtime || !this.snapshot.active) return;
    runtime.cancelled = true; runtime.autoSave = false; runtime.handle = undefined;
    this.closeEvents(runtime);
    if (item.stage === 'receiving') {
      runtime.controller?.abort();
      this.update(id, { stage: 'ready', bytesReceived: 0, notice: 'Saving stopped. The prepared file is still available.', error: undefined });
    } else if (item.job && pending(item.job)) {
      this.update(id, { cancelling: true }); void this.cancelServer(id);
    } else this.update(id, { stage: 'cancelled', cancelling: !!runtime.controller });
    // A very fast cancel can race the POST. Keep that tiny request alive long
    // enough to obtain the job id, then cancel the server job in prepare().
  };

  private async cancelServer(id: string) {
    const item = this.find(id); const runtime = this.runtimes.get(id);
    if (!item?.job || !runtime || !this.snapshot.active) return;
    const controller = new AbortController(); runtime.controller = controller;
    try {
      const job = await api<DownloadJob>(`/downloads/${encodeURIComponent(item.job.id)}`, { ...json('DELETE'), signal: controller.signal });
      if (!controller.signal.aborted && this.snapshot.active) this.accept(id, job);
    } catch (error) {
      if (!controller.signal.aborted && this.snapshot.active) {
        runtime.cancelled = false;
        this.update(id, { cancelling: false, error: `Could not cancel preparation. ${getError(error)}` });
        this.watch(id);
      }
    } finally { if (runtime.controller === controller) runtime.controller = undefined; }
  }

  retry = (id: string) => { const item = this.find(id); if (item && this.snapshot.active) { this.start(item.request); this.dismiss(id); } };
  dismiss = (id: string) => {
    const item = this.find(id);
    if (item?.job) this.recoveryIds.delete(item.job.id);
    const runtime = this.runtimes.get(id);
    if (runtime) { this.closeEvents(runtime); runtime.controller?.abort(); }
    this.runtimes.delete(id); this.publish(this.snapshot.transfers.filter(item => item.id !== id));
  };
  expire = () => {
    if (!this.snapshot.active) return;
    const expired = this.snapshot.transfers.filter(item => item.job?.state === 'ready' && item.job.expiresAt && Date.parse(item.job.expiresAt) <= Date.now() && !['expired', 'receiving'].includes(item.stage));
    for (const item of expired) this.update(item.id, { job: { ...item.job!, state: 'expired', url: undefined }, stage: 'expired', error: 'This download link expired. Prepare the saved file again.', errorCode: 'DOWNLOAD_EXPIRED' });
  };
}

export const downloads = new DownloadManager();
export const startWorkspaceDownload = downloads.start;
export const startAttachmentDownload = downloads.startAttachment;
export const startGeneratedImageDownload = downloads.startGeneratedImage;
export function useDownloads() { return useSyncExternalStore(downloads.subscribe, downloads.getSnapshot, downloads.getSnapshot); }
