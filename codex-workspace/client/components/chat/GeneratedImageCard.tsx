import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AlertCircle, Check, Download, FolderDown, ImageOff, LoaderCircle, RotateCcw } from 'lucide-react';
import type { GeneratedImageMetadata } from '../../../shared/types';
import { api, ApiError, json } from '../../api';
import { startGeneratedImageDownload } from '../../downloads';
import { acquireWorkspaceExternalMutation } from '../../workspace-rewind-guard';
import Modal from '../Modal';
import { useFileAttachmentLock } from './useFileAttachments';
import './generated-images.css';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;

/** The viewed conversation owns this UI lifetime. An explicit fork can carry an
 * image whose immutable metadata still names its original owner conversation. */
export interface GeneratedImageScope {
  workspaceId: string;
  threadId: string;
  locked?: boolean;
  readOnly?: boolean;
  executionBlocked?: boolean;
}

export interface GeneratedImageCardProps {
  image: GeneratedImageMetadata;
  scope?: GeneratedImageScope;
  onNotify: Notify;
  activityError?: string;
}

const LOCAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const IMAGE_ID = /^img_[a-f0-9]{64}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_ALT_CHARS = 280;
const MAX_DRAFTS = 64;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const localId = (value: unknown): value is string => typeof value === 'string' && LOCAL_ID.test(value);
const integer = (value: unknown, maximum: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
const lockedNow = () => typeof document !== 'undefined' && document.body.dataset.workspaceLocked === 'true';
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 600) : 'The image could not be saved. Try again.';
const extension = (image: GeneratedImageMetadata) => image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png';
export const generatedImageFileName = (image: GeneratedImageMetadata) => `generated-image-${image.id.slice(4, 16)}.${extension(image)}`;
const imageSize = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 ** 2).toFixed(1)} MiB`;

/** Never accept an arbitrary URL or bytes from a tool's textual output. The
 * preview is a pinned, authenticated same-origin resource for this workspace. */
export function validGeneratedImage(value: unknown, workspaceId: string): value is GeneratedImageMetadata {
  if (!object(value) || !localId(workspaceId) || value.workspaceId !== workspaceId || value.state !== 'completed'
    || typeof value.id !== 'string' || !IMAGE_ID.test(value.id) || typeof value.sha256 !== 'string' || !DIGEST.test(value.sha256)
    || !localId(value.threadId) || !localId(value.messageId) || !localId(value.runId)
    || typeof value.itemId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(value.itemId)
    || typeof value.mimeType !== 'string' || !MIME_TYPES.has(value.mimeType) || !integer(value.bytes, MAX_IMAGE_BYTES)
    || !integer(value.width, 16_384) || !integer(value.height, 16_384) || value.width * value.height > 40_000_000
    || typeof value.createdAt !== 'string' || value.createdAt.length > 30 || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) return false;
  if (value.revisedPrompt !== undefined && (typeof value.revisedPrompt !== 'string' || value.revisedPrompt.length > MAX_PROMPT_BYTES
    || value.revisedPrompt.includes('\0') || new TextEncoder().encode(value.revisedPrompt).length > MAX_PROMPT_BYTES)) return false;
  return value.previewUrl === `/api/workspaces/${encodeURIComponent(workspaceId)}/generated-images/${value.id}/content?sha256=${value.sha256}`;
}

export function generatedImageAltText(prompt?: string): string {
  const text = typeof prompt === 'string' ? prompt.slice(0, MAX_PROMPT_BYTES).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!text) return 'Generated image';
  return text.length <= MAX_ALT_CHARS ? text : `${text.slice(0, MAX_ALT_CHARS - 1).trimEnd()}…`;
}

/** Return exactly the requested relative path; never silently rewrite a target. */
export function generatedImageDestination(path: string, image: GeneratedImageMetadata): string {
  if (!path || path.length > 4096 || new TextEncoder().encode(path).length > 4096 || path.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || !part.trim() || new TextEncoder().encode(part).length > 255)) {
    throw new Error('Enter a file path inside this workspace, such as images/generated-image.png.');
  }
  const allowed = image.mimeType === 'image/jpeg' ? /\.(?:jpg|jpeg)$/i : image.mimeType === 'image/webp' ? /\.webp$/i : /\.png$/i;
  if (!allowed.test(path)) throw new Error(`Use a .${extension(image)} filename for this image.`);
  return path;
}

/** A successful HTTP response is not a save receipt unless it confirms the
 * exact immutable image, destination, ordinary file entry and content version. */
export function validateGeneratedImageSave(value: unknown, image: GeneratedImageMetadata, path: string): void {
  if (!object(value) || value.path !== path || value.version !== image.sha256 || !validGeneratedImage(value.image, image.workspaceId)
    || value.image.id !== image.id || value.image.sha256 !== image.sha256 || value.image.threadId !== image.threadId
    || value.image.messageId !== image.messageId || value.image.runId !== image.runId || value.image.itemId !== image.itemId
    || value.image.bytes !== image.bytes || value.image.width !== image.width || value.image.height !== image.height || value.image.mimeType !== image.mimeType
    || !object(value.entry) || value.entry.path !== path || value.entry.name !== path.split('/').at(-1) || value.entry.kind !== 'file'
    || value.entry.isSymlink !== undefined && value.entry.isSymlink !== false || value.entry.size !== image.bytes) {
    throw new Error('The save response did not confirm this image at the requested path. Check the destination before trying again.');
  }
}

interface SaveSnapshot {
  path: string;
  phase: 'idle' | 'saving' | 'saved' | 'error';
  error?: string;
  savedPath?: string;
}
interface SaveDraft {
  get: () => SaveSnapshot;
  set: (value: SaveSnapshot) => boolean;
  subscribe: (listener: () => void) => () => void;
}

// Measured conversation rows unmount when offscreen. Retain only small bounded
// path/status drafts, including a pending save, so scrolling cannot lose a path
// or start a second create request. No image bytes or URLs enter this cache.
const saveDrafts = new Map<string, SaveSnapshot>();
const saveListeners = new Map<string, Set<() => void>>();
function saveDraft(key: string, image: GeneratedImageMetadata): SaveDraft {
  let initial: SaveSnapshot = { path: generatedImageFileName(image), phase: 'idle' };
  return {
    get: () => saveDrafts.get(key) ?? initial,
    set: value => {
      // Merely viewing an image never evicts somebody's typed path. Only actual
      // save interactions enter this bounded cache; in-flight entries stay held.
      if (!saveDrafts.has(key) && saveDrafts.size >= MAX_DRAFTS) {
        const oldest = [...saveDrafts].find(([oldKey, entry]) => entry.phase !== 'saving' && !saveListeners.get(oldKey)?.size);
        if (oldest) saveDrafts.delete(oldest[0]);
        else {
          initial = { ...value, phase: 'error', error: 'Too many image saves are active. Close another conversation or wait for a save to finish before continuing.' };
          saveListeners.get(key)?.forEach(listener => listener());
          return false;
        }
      }
      saveDrafts.set(key, value);
      saveListeners.get(key)?.forEach(listener => listener());
      return true;
    },
    subscribe: listener => {
      let listeners = saveListeners.get(key);
      if (!listeners) { listeners = new Set(); saveListeners.set(key, listeners); }
      listeners.add(listener);
      const subscribers = listeners;
      return () => { subscribers.delete(listener); if (!subscribers.size) saveListeners.delete(key); };
    },
  };
}

function validScope(scope?: GeneratedImageScope): scope is GeneratedImageScope {
  return !!scope && localId(scope.workspaceId) && localId(scope.threadId);
}

function GeneratedImageContent({ image, scope, onNotify, activityError }: GeneratedImageCardProps & { scope: GeneratedImageScope }) {
  const id = useId();
  const key = JSON.stringify([scope.workspaceId, scope.threadId, image.id, image.sha256]);
  const draft = useMemo(() => saveDraft(key, image), [key]);
  const save = useSyncExternalStore(draft.subscribe, draft.get, draft.get);
  const [saveOpen, setSaveOpen] = useState(false);
  const [preview, setPreview] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const live = useRef({ mounted: true, epoch: 0, locked: !!scope.locked });
  const locked = useFileAttachmentLock(scope.locked, () => {
    live.current.locked = true;
    live.current.epoch++;
    setSaveOpen(false);
  });
  const saveBlocked = !!scope.readOnly || scope.locked !== false || scope.executionBlocked !== false;
  const blockReason = scope.readOnly ? 'This conversation is read-only.' : scope.locked !== false ? 'Wait for the workspace session to be ready before saving an image.' : scope.executionBlocked !== false ? 'Wait for the conversation and workspace to be ready before saving this image.' : undefined;

  useLayoutEffect(() => {
    live.current.mounted = true;
    live.current.locked = locked;
    return () => { live.current.mounted = false; live.current.epoch++; };
  }, [locked]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || lockedNow() || saveBlocked || draft.get().phase === 'saving') return;
    const epoch = live.current.epoch;
    const active = () => live.current.mounted && !live.current.locked && live.current.epoch === epoch && !lockedNow();
    const path = draft.get().path;
    let lease: ReturnType<typeof acquireWorkspaceExternalMutation> | undefined;
    let attempted = false, confirmed = false, failure: unknown, releaseFailure: unknown;
    try {
      generatedImageDestination(path, image);
      lease = acquireWorkspaceExternalMutation(scope.workspaceId, [path]);
      if (!draft.set({ path, phase: 'saving' })) throw new Error('Wait for a pending image save to finish before saving another image.');
      attempted = true;
      const result = await api<unknown>(`/workspaces/${encodeURIComponent(scope.workspaceId)}/generated-images/${image.id}/save`, json('POST', { sha256: image.sha256, path, threadId: image.threadId }));
      validateGeneratedImageSave(result, image, path);
      confirmed = true;
    } catch (error) { failure = error; }
    finally {
      try { lease?.release({ refresh: attempted }); }
      catch (error) { releaseFailure = error; }
    }
    if (confirmed) {
      const error = releaseFailure ? `The image was saved, but the editor could not finish refreshing. Your buffers are retained. ${errorMessage(releaseFailure)}` : undefined;
      draft.set({ path, phase: 'saved', savedPath: path, ...(error ? { error } : {}) });
      if (active()) {
        if (!error) setSaveOpen(false);
        onNotify(error || `Image saved to ${path}.`, error ? 'error' : 'success');
      }
    } else {
      const rejected = failure instanceof ApiError && [400, 401, 403, 404, 409, 410, 413, 415, 423, 429].includes(failure.status);
      const error = `${attempted && !rejected ? 'Save could not be confirmed. Check the destination before trying again. ' : ''}${errorMessage(failure)}${releaseFailure ? ' The editor could not finish refreshing; your buffers are retained.' : ''}`;
      draft.set({ path, phase: 'error', error });
      if (active() && !saveOpen) onNotify(error, 'error');
    }
  }

  if (locked) return null;
  return <figure className="cw-generated-image" aria-label="Generated image">
    <div className={`cw-generated-image-preview is-${preview}`} style={{ aspectRatio: Math.max(0.7, Math.min(2, image.width / image.height)) }} aria-busy={preview === 'loading'}>
      {preview !== 'error' && <img key={attempt} src={image.previewUrl} alt={generatedImageAltText(image.revisedPrompt)} width={image.width} height={image.height}
        loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setPreview('ready')} onError={() => setPreview('error')} />}
      {preview === 'loading' && <span className="cw-generated-image-preview-message" role="status"><LoaderCircle size={19} className="cw-generated-image-spin" aria-hidden="true" />Loading image…</span>}
      {preview === 'error' && <div className="cw-generated-image-preview-message" role="alert"><ImageOff size={22} aria-hidden="true" /><p>The saved image preview could not be loaded.</p><button type="button" className="cw-generated-image-button" onClick={() => { setPreview('loading'); setAttempt(value => value + 1); }}><RotateCcw size={14} aria-hidden="true" />Retry preview</button></div>}
    </div>
    <figcaption className="cw-generated-image-caption"><span>{image.width.toLocaleString()} × {image.height.toLocaleString()}<span aria-hidden="true"> · </span>{extension(image).toUpperCase()}<span aria-hidden="true"> · </span>{imageSize(image.bytes)}</span>
      <div className="cw-generated-image-actions"><button type="button" className="cw-generated-image-button" onClick={() => {
        if (live.current.locked || lockedNow()) return;
        startGeneratedImageDownload({ workspaceId: scope.workspaceId, imageId: image.id, sha256: image.sha256, fileName: generatedImageFileName(image), size: image.bytes });
      }}><Download size={15} aria-hidden="true" />Download</button>
        <button type="button" className="cw-generated-image-button" disabled={saveBlocked} aria-describedby={blockReason ? `${id}-blocked` : undefined} onClick={() => setSaveOpen(true)}><FolderDown size={15} aria-hidden="true" />{save.phase === 'saving' ? 'Saving to workspace…' : 'Save to workspace'}</button></div>
    </figcaption>
    {activityError && <p className="cw-generated-image-error" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>The image was saved, but this step ended with an error. {activityError.slice(0, 1000)}</span></p>}
    {blockReason && <p className="cw-generated-image-note" id={`${id}-blocked`}>{blockReason}</p>}
    {save.phase === 'saving' && <p className="cw-generated-image-note" role="status"><LoaderCircle size={13} className="cw-generated-image-spin" aria-hidden="true" />Saving image to <code>{save.path}</code>…</p>}
    {save.savedPath && <p className="cw-generated-image-note" role="status"><Check size={13} aria-hidden="true" />Saved to <code>{save.savedPath}</code></p>}
    {save.error && !saveOpen && <p className="cw-generated-image-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{save.error}</p>}
    {saveOpen && <Modal open title="Save image to workspace" titleId={`${id}-save-title`} onClose={() => setSaveOpen(false)} description="Create a new image file in this workspace." className="cw-generated-image-save">
      <form onSubmit={event => void submit(event)}>
        <div className="cw-generated-image-save-body"><label className="field-label" htmlFor={`${id}-path`}>Workspace file path</label><input id={`${id}-path`} className="input" data-autofocus value={save.path} maxLength={4096} spellCheck={false} autoComplete="off" disabled={save.phase === 'saving'}
          aria-describedby={`${id}-path-help${save.error ? ` ${id}-save-error` : ''}`} onChange={event => draft.set({ path: event.target.value, phase: 'idle' })} />
          <p className="cw-generated-image-note" id={`${id}-path-help`}>Use a new .{extension(image)} file path. Existing files and unsaved editor changes are kept.</p>
          {blockReason && <p className="cw-generated-image-error" role="alert">{blockReason}</p>}
          {save.phase === 'saving' && <p className="cw-generated-image-note" role="status">Saving the image… Closing this dialog keeps the request running.</p>}
          {save.error && <p className="cw-generated-image-error" id={`${id}-save-error`} role="alert"><AlertCircle size={14} aria-hidden="true" />{save.error}</p>}
        </div>
        <div className="modal-footer"><button type="button" className="button ghost" onClick={() => setSaveOpen(false)}>{save.phase === 'saving' ? 'Close' : 'Cancel'}</button><button type="submit" className="button primary" disabled={save.phase === 'saving' || saveBlocked}>{save.phase === 'saving' ? <LoaderCircle size={15} className="cw-generated-image-spin" aria-hidden="true" /> : <FolderDown size={15} aria-hidden="true" />}{save.phase === 'saving' ? 'Saving…' : 'Save image'}</button></div>
      </form>
    </Modal>}
  </figure>;
}

export function GeneratedImageCard({ image, scope, onNotify, activityError }: GeneratedImageCardProps) {
  const locked = useFileAttachmentLock(scope?.locked);
  if (locked) return null;
  if (!validScope(scope) || !validGeneratedImage(image, scope.workspaceId)) return <div className="cw-generated-image-unavailable" role="alert"><ImageOff size={18} aria-hidden="true" /><span>This generated image could not be verified for this workspace.</span></div>;
  return <GeneratedImageContent key={`${scope.workspaceId}:${scope.threadId}:${image.id}:${image.sha256}`} image={image} scope={scope} onNotify={onNotify} activityError={activityError} />;
}
