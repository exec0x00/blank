import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { AlertCircle, Check, ImageOff, ImagePlus, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { AttachmentReference, ImageAttachment } from '../../../shared/types';
import { api, ApiError } from '../../api';
import { uploadImageAttachment, type ImageAttachmentTransferState } from './image-attachment-transfer';
import { validAttachmentName } from './file-attachment-transfer';
import './image-attachments.css';

export const IMAGE_ATTACHMENT_LIMITS = { count: 8, fileBytes: 8 * 1024 * 1024, totalBytes: 16 * 1024 * 1024 } as const;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif';
const encoded = encodeURIComponent;

export interface ComposerImageAttachment {
  key: string;
  name: string;
  bytes: number;
  previewUrl: string;
  status: 'queued' | 'uploading' | 'ready' | 'error' | 'canceled' | 'removing';
  attachment?: ImageAttachment;
  error?: string;
  transferProgress?: Pick<ImageAttachmentTransferState, 'stage' | 'bytesUploaded' | 'bytesImported'>;
}

interface DraftImage extends ComposerImageAttachment {
  file?: File;
  objectUrl?: string;
  controller?: AbortController;
  transfer?: ImageAttachmentTransferState;
  transferOwner?: symbol;
}

interface AttachmentDraft {
  workspaceId: string;
  draftKey: string;
  items: DraftImage[];
  error: string | null;
}

export interface ImageAttachmentsOptions {
  workspaceId: string;
  /** Use the same key as the text draft; the workspace is scoped separately. */
  draftKey: string;
  disabled?: boolean;
  locked?: boolean;
}

export interface ImageAttachmentsController {
  items: readonly ComposerImageAttachment[];
  attachmentRefs: AttachmentReference[];
  hasAttachments: boolean;
  isUploading: boolean;
  /** Includes removal requests, so submitting cannot race a server deletion. */
  isBusy: boolean;
  hasErrors: boolean;
  isDragging: boolean;
  disabled: boolean;
  locked: boolean;
  canAttach: boolean;
  error: string | null;
  addFiles: (files: FileList | readonly File[]) => void;
  remove: (key: string) => Promise<void>;
  cancel: (key: string) => void;
  retry: (key: string) => void;
  clearError: () => void;
  /** Clears acknowledged references without deleting images retained by a message. */
  clearSubmitted: (draftKey?: string, submittedRefs?: readonly AttachmentReference[]) => void;
  discardDraft: (draftKey?: string) => Promise<void>;
  /** Replace a confirmed rewind draft with its already stored image snapshots. */
  restoreDraft: (draftKey: string, attachments: readonly ImageAttachment[]) => Promise<void>;
  /** Call when a new conversation takes ownership of the unsent new-thread draft. */
  promoteDraft: (fromKey: string, toKey: string) => boolean;
  /** Spread on the composer form/wrapper, never on the whole document. */
  composerProps: {
    onPaste: (event: ClipboardEvent<HTMLElement>) => void;
    onDragEnter: (event: DragEvent<HTMLElement>) => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

function draftScope(workspaceId: string, draftKey: string) { return JSON.stringify([workspaceId, draftKey]); }
function message(error: unknown) { return error instanceof Error ? error.message : 'The image could not be uploaded. Please try again.'; }
function fileSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KiB` : `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MiB`; }
function supportedFile(file: File) { return IMAGE_TYPES.has(file.type) || ((!file.type || file.type === 'application/octet-stream') && /\.(?:png|jpe?g|webp|gif)$/i.test(file.name)); }
function hasFiles(transfer: DataTransfer) { return Array.from(transfer.types).includes('Files') || Array.from(transfer.items || []).some(item => item.kind === 'file'); }

/** Server metadata cannot make a preview fetch another origin or an arbitrary route. */
function previewUrl(attachment: ImageAttachment): string | undefined {
  if (!attachment || !/^att_[a-f0-9]{32}$/.test(attachment.id) || !/^[a-f0-9]{64}$/.test(attachment.sha256)) return;
  const expected = `/api/workspaces/${encoded(attachment.workspaceId)}/attachments/${attachment.id}/content?sha256=${attachment.sha256}`;
  return attachment.previewUrl === expected ? expected : undefined;
}

function validImage(attachment: ImageAttachment, workspaceId: string) {
  return attachment && attachment.workspaceId === workspaceId && IMAGE_TYPES.has(attachment.mimeType)
    && Number.isSafeInteger(attachment.bytes) && attachment.bytes > 0 && attachment.bytes <= IMAGE_ATTACHMENT_LIMITS.fileBytes
    && Number.isSafeInteger(attachment.width) && attachment.width > 0 && attachment.width <= 16384
    && Number.isSafeInteger(attachment.height) && attachment.height > 0 && attachment.height <= 16384
    && attachment.width * attachment.height <= 40_000_000 && typeof attachment.name === 'string' && !!previewUrl(attachment);
}

function useAttachmentLock(explicit = false, onLock?: () => void) {
  const [locked, setLocked] = useState(() => document.body.dataset.workspaceLocked === 'true');
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;
  useEffect(() => {
    const lock = () => { onLockRef.current?.(); setLocked(true); };
    const unlock = () => setLocked(false);
    window.addEventListener('codex:session-locked', lock);
    window.addEventListener('codex:session-expired', lock);
    window.addEventListener('codex:session-unlocked', unlock);
    return () => {
      window.removeEventListener('codex:session-locked', lock);
      window.removeEventListener('codex:session-expired', lock);
      window.removeEventListener('codex:session-unlocked', unlock);
    };
  }, []);
  useEffect(() => { if (explicit) onLockRef.current?.(); }, [explicit]);
  return explicit || locked;
}

function releaseImage(item: DraftImage) {
  item.controller?.abort();
  item.controller = undefined;
  if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  item.objectUrl = undefined;
  item.file = undefined;
}

/** Uploads only explicit local files. Draft files never enter localStorage or message text. */
export function useImageAttachments(options: ImageAttachmentsOptions): ImageAttachmentsController {
  const drafts = useRef(new Map<string, AttachmentDraft>());
  const uploadQueue = useRef<Array<{ draft: AttachmentDraft; item: DraftImage }>>([]);
  const activeUploads = useRef(0);
  const cleanupControllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  const [, setRevision] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const refresh = useCallback(() => { if (mounted.current) setRevision(value => value + 1); }, []);
  const clearLocal = useCallback(() => {
    for (const draft of drafts.current.values()) for (const item of draft.items) releaseImage(item);
    for (const controller of cleanupControllers.current) controller.abort();
    cleanupControllers.current.clear();
    uploadQueue.current = [];
    drafts.current.clear();
    dragDepth.current = 0;
    if (mounted.current) { setDragging(false); refresh(); }
  }, [refresh]);
  const locked = useAttachmentLock(options.locked, clearLocal);
  const current = useRef({ ...options, locked });
  current.current = { ...options, locked };
  const { workspaceId, draftKey } = options;
  const scope = draftScope(workspaceId, draftKey);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearLocal(); };
  }, [clearLocal]);
  useEffect(() => { dragDepth.current = 0; setDragging(false); }, [scope, options.disabled, locked]);

  function unavailable() { return !mounted.current || current.current.locked || document.body.dataset.workspaceLocked === 'true'; }
  function blocked() { return unavailable() || current.current.disabled; }
  function live(draft: AttachmentDraft, item: DraftImage) { return mounted.current && drafts.current.get(draftScope(draft.workspaceId, draft.draftKey)) === draft && draft.items.includes(item); }
  function getDraft(key = draftKey) {
    const target = draftScope(workspaceId, key);
    let draft = drafts.current.get(target);
    if (!draft) { draft = { workspaceId, draftKey: key, items: [], error: null }; drafts.current.set(target, draft); }
    return draft;
  }

  async function upload(draft: AttachmentDraft, item: DraftImage) {
    if (!item.file || unavailable() || !live(draft, item)) return;
    const file = item.file;
    const controller = new AbortController();
    const owner = Symbol('photo-transfer');
    item.controller = controller;
    item.transferOwner = owner;
    item.status = 'uploading';
    item.error = undefined;
    refresh();
    try {
      const result = await uploadImageAttachment({ workspaceId: draft.workspaceId, file, detail: 'high', previous: item.transfer,
        signal: controller.signal, onProgress: state => {
          if (!live(draft, item) || item.transferOwner !== owner) return;
          // A cancelled request may still return its known reservation outcome.
          // Keep that identity for retry without reviving the cancelled draft.
          item.transfer = state;
          if (!controller.signal.aborted && item.controller === controller) {
            item.transferProgress = { stage: state.stage, bytesUploaded: state.bytesUploaded, bytesImported: state.bytesImported };
            refresh();
          }
        } });
      if (controller.signal.aborted || !live(draft, item) || item.controller !== controller) return;
      const attachment = result.image;
      if (result.stage !== 'ready' || !attachment) {
        item.status = result.stage === 'cancelled' ? 'canceled' : 'error';
        item.error = result.error || result.notice || 'The photo upload could not finish. Retry or remove it.';
        return;
      }
      const source = previewUrl(attachment);
      if (!validImage(attachment, draft.workspaceId) || attachment.bytes !== file.size || !source) {
        throw new Error('The uploaded image could not be confirmed. Please retry.');
      }
      item.attachment = attachment;
      item.previewUrl = source;
      item.status = 'ready';
      item.file = undefined;
      item.transfer = undefined;
      item.transferProgress = undefined;
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
      item.objectUrl = undefined;
    } catch (error) {
      if (controller.signal.aborted || !live(draft, item) || item.controller !== controller) return;
      item.status = 'error';
      item.error = message(error);
    } finally {
      if (live(draft, item) && item.controller === controller) { item.controller = undefined; refresh(); }
    }
  }

  function drainUploads() {
    // The service permits four concurrent uploads. Leave room for another tab.
    while (activeUploads.current < 2 && uploadQueue.current.length && !unavailable()) {
      const next = uploadQueue.current.shift()!;
      if (!live(next.draft, next.item) || next.item.status !== 'queued') continue;
      activeUploads.current++;
      void upload(next.draft, next.item).finally(() => { activeUploads.current--; drainUploads(); });
    }
  }

  function queueUpload(draft: AttachmentDraft, item: DraftImage) {
    item.status = 'queued';
    item.error = undefined;
    uploadQueue.current.push({ draft, item });
    drainUploads();
    refresh();
  }

  function addFiles(files: FileList | readonly File[]) {
    if (blocked() || !files.length) return;
    const draft = getDraft();
    let error: string | null = null;
    if (files.length + draft.items.length > IMAGE_ATTACHMENT_LIMITS.count) error = 'Attach up to 8 images per message. Remove an image or choose fewer files.';
    const selected: File[] = [];
    let total = draft.items.reduce((sum, item) => sum + item.bytes, 0);
    if (!error) for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (!supportedFile(file)) { error = 'Choose PNG, JPEG, WebP, or a static GIF image.'; break; }
      const reservedName = file.name.startsWith('.codex-write-');
      if (!validAttachmentName(file.name)) {
        error = reservedName
          ? 'Image filenames starting with .codex-write- are reserved. Rename the file and choose it again.'
          : 'Use an image filename of up to 255 UTF-8 bytes without slashes or control characters. Rename the file and choose it again.';
        break;
      }
      if (!file.size) { error = `${file.name} is empty. Choose another image.`; break; }
      if (file.size > IMAGE_ATTACHMENT_LIMITS.fileBytes) { error = `${file.name} is too large. Each image can be up to 8 MiB.`; break; }
      total += file.size;
      if (total > IMAGE_ATTACHMENT_LIMITS.totalBytes) { error = 'Images in one message can total up to 16 MiB. Remove an image or choose smaller files.'; break; }
      selected.push(file);
    }
    draft.error = error;
    if (error) { refresh(); return; }
    const items: DraftImage[] = selected.map(file => {
      const objectUrl = URL.createObjectURL(file);
      return { key: crypto.randomUUID(), name: file.name, bytes: file.size, file, objectUrl, previewUrl: objectUrl, status: 'queued' };
    });
    draft.items.push(...items);
    refresh();
    for (const item of items) queueUpload(draft, item);
  }

  async function removeFromDraft(draft: AttachmentDraft, item: DraftImage) {
    if (!live(draft, item) || item.status === 'removing') return;
    if (!item.attachment) {
      uploadQueue.current = uploadQueue.current.filter(value => value.item !== item);
      releaseImage(item);
      draft.items = draft.items.filter(value => value !== item);
      refresh();
      return;
    }
    const controller = new AbortController();
    item.controller?.abort();
    item.controller = controller;
    item.status = 'removing';
    item.error = undefined;
    refresh();
    try {
      await api(`/workspaces/${encoded(draft.workspaceId)}/attachments/${encoded(item.attachment.id)}`, { method: 'DELETE', signal: controller.signal });
    } catch (error) {
      // A retained message owns its image; removing this draft must leave that copy alone.
      const alreadyGone = error instanceof ApiError && (error.status === 404 || error.status === 410 || error.code === 'ATTACHMENT_IN_USE');
      if (!alreadyGone) {
        if (live(draft, item) && !controller.signal.aborted) { item.status = 'error'; item.error = `Could not remove this image: ${message(error)}`; }
        return;
      }
    } finally {
      if (live(draft, item) && item.controller === controller) { item.controller = undefined; refresh(); }
    }
    if (controller.signal.aborted || !live(draft, item)) return;
    releaseImage(item);
    draft.items = draft.items.filter(value => value !== item);
    refresh();
  }

  async function remove(key: string) {
    if (blocked()) return;
    const draft = getDraft();
    const item = draft.items.find(value => value.key === key);
    if (item) await removeFromDraft(draft, item);
  }

  function cancel(key: string) {
    if (blocked()) return;
    const draft = getDraft();
    const item = draft.items.find(value => value.key === key);
    if (!item || (item.status !== 'uploading' && item.status !== 'queued')) return;
    uploadQueue.current = uploadQueue.current.filter(value => value.item !== item);
    item.controller?.abort();
    item.controller = undefined;
    item.status = 'canceled';
    item.error = item.transfer?.promotionStarted ? 'Cancelled while checking this photo. Retry checks the same uploaded file.'
      : 'Upload canceled. Retry or remove this image.';
    refresh();
  }

  function retry(key: string) {
    if (blocked()) return;
    const draft = getDraft();
    const item = draft.items.find(value => value.key === key);
    if (!item || item.status === 'uploading' || item.status === 'queued' || item.status === 'removing') return;
    if (item.attachment) void removeFromDraft(draft, item);
    else queueUpload(draft, item);
  }

  function clearSubmitted(key = draftKey, submittedRefs?: readonly AttachmentReference[]) {
    const draft = drafts.current.get(draftScope(workspaceId, key));
    if (!draft) return;
    draft.items = draft.items.filter(item => {
      const sent = item.attachment && (!submittedRefs || submittedRefs.some(ref => ref.id === item.attachment!.id && ref.sha256 === item.attachment!.sha256));
      if (sent) releaseImage(item);
      return !sent;
    });
    draft.error = null;
    refresh();
  }

  async function discardDraft(key = draftKey) {
    if (unavailable()) return;
    const draft = drafts.current.get(draftScope(workspaceId, key));
    if (!draft) return;
    draft.error = null;
    await Promise.all(draft.items.map(item => removeFromDraft(draft, item)));
    if (!draft.items.length) drafts.current.delete(draftScope(workspaceId, key));
    refresh();
  }

  async function restoreDraft(key: string, attachments: readonly ImageAttachment[]) {
    if (unavailable()) return;
    if (attachments.length > IMAGE_ATTACHMENT_LIMITS.count || new Set(attachments.map(item => item.id)).size !== attachments.length
      || attachments.some(item => !validImage(item, workspaceId)) || attachments.reduce((sum, item) => sum + item.bytes, 0) > IMAGE_ATTACHMENT_LIMITS.totalBytes) {
      throw new Error('The restored images could not be confirmed. Reload the conversation and try again.');
    }
    const target = draftScope(workspaceId, key);
    const prior = drafts.current.get(target);
    const replacement: AttachmentDraft = { workspaceId, draftKey: key, error: null, items: attachments.map(attachment => ({
      key: crypto.randomUUID(), name: attachment.name, bytes: attachment.bytes, previewUrl: previewUrl(attachment)!, status: 'ready', attachment,
    })) };
    drafts.current.set(target, replacement);
    if (prior) for (const item of prior.items) releaseImage(item);
    uploadQueue.current = uploadQueue.current.filter(value => value.draft !== prior);
    refresh();
    await Promise.all((prior?.items ?? []).filter(item => item.attachment && !attachments.some(value => value.id === item.attachment!.id)).map(async item => {
      const controller = new AbortController();
      cleanupControllers.current.add(controller);
      try {
        await api(`/workspaces/${encoded(workspaceId)}/attachments/${encoded(item.attachment!.id)}`, { method: 'DELETE', signal: controller.signal });
      } catch (error) {
        const retainedOrGone = error instanceof ApiError && (error.status === 404 || error.status === 410 || error.code === 'ATTACHMENT_IN_USE');
        if (!controller.signal.aborted && !retainedOrGone && drafts.current.get(target) === replacement) {
          replacement.error = 'The previous image could not be deleted. Your restored images are ready; unused uploads expire after 24 hours.';
        }
      } finally { cleanupControllers.current.delete(controller); refresh(); }
    }));
  }

  function promoteDraft(fromKey: string, toKey: string) {
    if (fromKey === toKey) return true;
    const from = draftScope(workspaceId, fromKey), to = draftScope(workspaceId, toKey);
    const draft = drafts.current.get(from);
    if (!draft) return true;
    if (drafts.current.get(to)?.items.length) return false;
    draft.draftKey = toKey;
    drafts.current.delete(from);
    drafts.current.set(to, draft);
    refresh();
    return true;
  }

  const draft = drafts.current.get(scope);
  const items = draft?.items ?? [];
  const disabled = !!options.disabled || locked;
  return {
    items: [...items],
    attachmentRefs: items.flatMap(item => item.status === 'ready' && item.attachment ? [{ id: item.attachment.id, sha256: item.attachment.sha256 }] : []),
    hasAttachments: items.length > 0,
    isUploading: items.some(item => item.status === 'queued' || item.status === 'uploading'),
    isBusy: items.some(item => item.status === 'queued' || item.status === 'uploading' || item.status === 'removing'),
    hasErrors: items.some(item => item.status === 'error' || item.status === 'canceled'),
    isDragging: dragging && !disabled,
    disabled, locked,
    canAttach: !disabled && items.length < IMAGE_ATTACHMENT_LIMITS.count && items.reduce((sum, item) => sum + item.bytes, 0) < IMAGE_ATTACHMENT_LIMITS.totalBytes,
    error: draft?.error ?? null,
    addFiles, remove, cancel, retry,
    clearError: () => { const value = drafts.current.get(scope); if (value) { value.error = null; refresh(); } },
    clearSubmitted, discardDraft, restoreDraft, promoteDraft,
    composerProps: {
      onPaste: event => {
        const candidates = Array.from(event.clipboardData.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null);
        const files = (candidates.length ? candidates : Array.from(event.clipboardData.files)).filter(file => file.type.startsWith('image/') || supportedFile(file));
        if (!files.length) return;
        // Mixed text/image paste still inserts its normal plain text into the textarea.
        if (!event.clipboardData.getData('text/plain')) event.preventDefault();
        if (!blocked()) addFiles(files);
      },
      onDragEnter: event => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth.current++;
        if (!blocked()) setDragging(true);
      },
      onDragOver: event => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy';
      },
      onDragLeave: event => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      },
      onDrop: event => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!blocked()) addFiles(event.dataTransfer.files);
      },
    },
  };
}

function Thumbnail({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed
    ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} draggable={false} />
    : <span className="cw-image-thumb-error" title={`Preview unavailable for ${name}`}><ImageOff size={17} /><span>Unavailable</span></span>;
}

function ImagePreviewDialog({ src, name, caption, onClose }: { src?: string; name: string; caption: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const titleId = useId();
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (document.body.dataset.workspaceLocked === 'true') { latestClose.current(); return; }
    dialog?.showModal();
    return () => {
      dialog?.close();
      requestAnimationFrame(() => {
        if (dialog?.open || document.body.dataset.workspaceLocked === 'true' || !returnFocus.current?.isConnected) return;
        if (document.activeElement === document.body || (document.activeElement && dialog?.contains(document.activeElement))) returnFocus.current.focus();
      });
    };
  }, []);
  useEffect(() => { setFailed(false); setVersion(0); }, [src]);
  return <dialog ref={ref} className="cw-image-preview" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClose={() => { if (ref.current && !ref.current.open) onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="cw-image-preview-header"><h2 id={titleId} className="text-ellipsis" data-tooltip={name}>{name}</h2><button type="button" className="cw-image-action" aria-label="Close image preview" onClick={onClose} autoFocus><X size={19} /></button></div>
    <div className="cw-image-preview-content">
      {!src || failed ? <div className="cw-image-preview-error" role="status"><ImageOff size={28} /><p>This image preview is unavailable.</p><span>The image may have expired or your session may have ended.</span>{src && <button type="button" onClick={() => { setFailed(false); setVersion(value => value + 1); }}><RotateCcw size={14} />Retry preview</button>}</div>
        : <img key={`${src}:${version}`} src={src} alt={name} decoding="async" onError={() => setFailed(true)} />}
    </div>
    <p className="cw-image-preview-caption">{caption}</p>
  </dialog>;
}

export function ImageAttachmentButton({ controller, disabled = false, compact = false }: { controller: ImageAttachmentsController; disabled?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const selected = useRef<ImageAttachmentsController['addFiles'] | null>(null);
  const hintId = useId();
  useEffect(() => {
    const element = input.current;
    const cancel = () => { selected.current = null; };
    element?.addEventListener('cancel', cancel);
    return () => element?.removeEventListener('cancel', cancel);
  }, []);
  return <>
    <button type="button" className={`cw-image-attach-button ${compact ? 'is-compact' : ''}`} aria-label="Attach images" aria-describedby={hintId} title="Attach images · PNG, JPEG, WebP or static GIF · up to 8 images" disabled={disabled || !controller.canAttach} onClick={() => { selected.current = controller.addFiles; input.current?.click(); }}><ImagePlus size={16} />{!compact && <span>Attach images</span>}</button>
    <input ref={input} className="cw-image-file-input" type="file" accept={IMAGE_ACCEPT} multiple aria-label="Choose image attachments" tabIndex={-1} disabled={disabled || controller.disabled} onChange={event => { if (event.target.files) (selected.current ?? controller.addFiles)(event.target.files); selected.current = null; event.target.value = ''; }} />
    <span id={hintId} className="sr-only">PNG, JPEG, WebP, or static GIF. Up to 8 images, 8 MiB each and 16 MiB total. You can also paste or drop an image into the message.</span>
  </>;
}

export function ImageAttachmentComposer({ controller, disabled = false, showPicker = true }: { controller: ImageAttachmentsController; disabled?: boolean; showPicker?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const selected = controller.items.find(item => item.key === previewKey);
  const blocked = disabled || controller.disabled;
  useEffect(() => { if (controller.locked) setPreviewKey(null); }, [controller.locked]);
  if (controller.locked) return null;
  function remove(key: string, trigger: HTMLButtonElement) {
    void controller.remove(key).finally(() => requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement === trigger) {
        const next = root.current?.querySelector<HTMLElement>('button:not(:disabled)')
          ?? root.current?.closest('form')?.querySelector<HTMLElement>('.cw-image-attach-button:not(:disabled), textarea:not(:disabled)');
        next?.focus();
      }
    }));
  }
  return <div ref={root} className={`cw-image-composer ${controller.isDragging ? 'is-dragging' : ''}`}>
    {controller.isDragging && <div className="cw-image-drop-hint" role="status"><ImagePlus size={17} /><span>Drop images to attach</span><small>Up to 8 images · 8 MiB each</small></div>}
    {controller.items.length > 0 && <ul className="cw-image-draft-rail" aria-label="Images attached to this message">
      {controller.items.map(item => {
        const transfer = item.transferProgress;
        const label = transfer?.stage === 'promoting' ? 'Preparing photo…' : transfer?.stage === 'importing' ? 'Verifying photo…'
          : transfer?.stage === 'publishing' ? 'Saving photo…' : transfer?.stage === 'checking' ? 'Checking photo…'
            : transfer?.stage === 'ready' ? 'Finishing photo…' : 'Uploading…';
        const measured = transfer?.stage === 'uploading' ? transfer.bytesUploaded : transfer?.stage === 'importing' ? transfer.bytesImported : undefined;
        const percent = measured === undefined ? undefined : Math.max(0, Math.min(100, Math.floor(measured / item.bytes * 100)));
        return <li key={item.key} className={`cw-image-draft-card is-${item.status}`}>
        <button type="button" className="cw-image-thumbnail" aria-label={`Preview ${item.name}`} onClick={() => setPreviewKey(item.key)}><Thumbnail src={item.previewUrl} name={item.name} /></button>
        <div className="cw-image-draft-info"><strong title={item.name}>{item.name}</strong><span>{fileSize(item.bytes)}{item.attachment ? ` · ${item.attachment.width} × ${item.attachment.height}` : ''}</span>
          <span className={`cw-image-upload-status ${item.error ? 'has-error' : ''}`} role={item.error ? 'alert' : undefined}>
            {item.status === 'queued' || item.status === 'uploading' || item.status === 'removing' ? <><LoaderCircle size={11} className="cw-image-spin" />{item.status === 'removing' ? 'Removing…' : item.status === 'queued' ? 'Waiting to upload…' : label}</> : item.error ? <><AlertCircle size={11} />{item.error}</> : <><Check size={11} />Ready</>}
          </span>
          {item.status === 'uploading' && <span className="cw-image-progress" role="progressbar" aria-label={`${label.replace('…', '')}: ${item.name}`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
            aria-valuetext={measured === undefined ? label : `${measured} of ${item.bytes} bytes`}><span style={percent === undefined ? undefined : { width: `${percent}%`, animation: 'none' }} /></span>}
        </div>
        <div className="cw-image-draft-actions">
          {(item.status === 'error' || item.status === 'canceled' || (item.status === 'ready' && item.error)) && <button type="button" className="cw-image-action" aria-label={`${item.attachment ? 'Retry removing' : 'Retry upload of'} ${item.name}`} disabled={blocked} onClick={event => item.attachment ? remove(item.key, event.currentTarget) : controller.retry(item.key)}><RotateCcw size={14} /></button>}
          <button type="button" className="cw-image-action" aria-label={`${item.status === 'uploading' || item.status === 'queued' ? 'Cancel upload of' : 'Remove'} ${item.name}`} disabled={blocked || item.status === 'removing'} onClick={event => item.status === 'uploading' || item.status === 'queued' ? controller.cancel(item.key) : remove(item.key, event.currentTarget)}><X size={14} /></button>
        </div>
      </li>; })}
    </ul>}
    {controller.error && <div className="cw-image-selection-error" role="alert"><AlertCircle size={14} /><span>{controller.error}</span><button type="button" className="cw-image-action" aria-label="Dismiss attachment error" onClick={controller.clearError}><X size={14} /></button></div>}
    {showPicker && <div className="cw-image-picker-row"><ImageAttachmentButton controller={controller} disabled={disabled} />{controller.items.length > 0 && <span aria-live="polite">{controller.items.length} / 8 images{controller.isUploading ? ' · Uploading' : ''}</span>}</div>}
    <span className="sr-only" role="status" aria-live="polite">{controller.isUploading ? 'Uploading images. Wait for uploads before sending.' : controller.hasErrors ? 'An image needs attention. Retry or remove it before sending.' : controller.items.length ? `${controller.items.length} images ready to send.` : ''}</span>
    {selected && <ImagePreviewDialog src={selected.previewUrl} name={selected.name} caption={selected.attachment ? `${selected.attachment.width} × ${selected.attachment.height} · ${fileSize(selected.bytes)}` : `${fileSize(selected.bytes)} · ${selected.status === 'uploading' ? 'Uploading' : 'Local image'}`} onClose={() => setPreviewKey(null)} />}
  </div>;
}

export function MessageImageAttachments({ attachments, locked: explicitlyLocked = false }: { attachments?: readonly ImageAttachment[]; locked?: boolean }) {
  const locked = useAttachmentLock(explicitlyLocked);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { if (locked) setSelectedId(null); }, [locked]);
  if (locked || !attachments?.length) return null;
  const images = attachments.slice(0, IMAGE_ATTACHMENT_LIMITS.count);
  const selected = images.find(item => item.id === selectedId);
  return <div className="cw-image-message-attachments">
    <ul className="cw-image-message-grid" aria-label="Attached images">{images.map(attachment => <li key={attachment.id}>
      <button type="button" className="cw-image-message-preview" aria-label={`Open attached image ${attachment.name}`} onClick={() => setSelectedId(attachment.id)}><Thumbnail src={previewUrl(attachment)} name={attachment.name} /><span title={attachment.name}>{attachment.name}</span></button>
    </li>)}</ul>
    {selected && <ImagePreviewDialog src={previewUrl(selected)} name={selected.name} caption={`${selected.width} × ${selected.height} · ${fileSize(selected.bytes)}`} onClose={() => setSelectedId(null)} />}
  </div>;
}
