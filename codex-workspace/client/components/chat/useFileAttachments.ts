import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileAttachment, FileAttachmentReference } from '../../../shared/types';
import { api, ApiError } from '../../api';
import { FILE_ATTACHMENT_LIMITS, uploadFileAttachment, validFileAttachment, validateAttachmentFile, type FileAttachmentProgress } from './file-attachment-transfer';

export interface ComposerFileAttachment extends FileAttachmentProgress {
  key: string;
  name: string;
  mimeType: string;
  bytes: number;
}
interface DraftFile extends ComposerFileAttachment { file?: File; controller?: AbortController }
interface FileDraft { workspaceId: string; draftKey: string; items: DraftFile[]; error: string | null }
interface Options { workspaceId: string; draftKey: string; disabled?: boolean; locked?: boolean }

export interface FileAttachmentsController {
  scope: string;
  items: readonly ComposerFileAttachment[];
  attachmentRefs: FileAttachmentReference[];
  hasAttachments: boolean;
  isBusy: boolean;
  hasErrors: boolean;
  disabled: boolean;
  locked: boolean;
  canAttach: boolean;
  error: string | null;
  addFiles: (files: FileList | readonly File[]) => void;
  remove: (key: string) => Promise<void>;
  cancel: (key: string) => void;
  retry: (key: string) => void;
  clearError: () => void;
  reportError: (message: string) => void;
  clearSubmitted: (draftKey?: string, submittedRefs?: readonly FileAttachmentReference[]) => void;
  discardDraft: (draftKey?: string) => Promise<void>;
  restoreDraft: (draftKey: string, attachments: readonly FileAttachment[]) => Promise<void>;
  promoteDraft: (fromKey: string, toKey: string) => boolean;
}

// Workspace switches remount ChatPanel. Keep unsent files in bounded page memory,
// never localStorage, so returning to their original thread can recover the draft.
const draftCache = new Map<string, FileDraft>();
const MAX_BUFFERED_BYTES = 200 * 1024 * 1024;
const MAX_BUFFERED_ITEMS = 128;
const ACTIVE = new Set(['queued', 'reserving', 'checking', 'preparing', 'uploading', 'publishing', 'importing', 'cancelling', 'removing']);
const encoded = encodeURIComponent;
const scopeOf = (workspaceId: string, key: string) => JSON.stringify([workspaceId, key]);
const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 600) : 'The attachment could not be updated. Try again.';
const pageLocked = () => typeof document !== 'undefined' && document.body.dataset.workspaceLocked === 'true';

export function useFileAttachmentLock(explicit = false, onLock?: () => void) {
  const [locked, setLocked] = useState(pageLocked);
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

/** Every async mutation belongs to one draft, one controller, and one session. */
export function useFileAttachments(options: Options): FileAttachmentsController {
  const mounted = useRef(true);
  const sessionEpoch = useRef(0);
  const queue = useRef<Array<{ draft: FileDraft; item: DraftFile }>>([]);
  const activeUploads = useRef(0);
  const cleanupControllers = useRef(new Set<AbortController>());
  const [, setRevision] = useState(0);
  const refresh = useCallback(() => { if (mounted.current) setRevision(value => value + 1); }, []);
  const current = useRef({ ...options, locked: !!options.locked });

  const pauseDrafts = useCallback((predicate: (draft: FileDraft) => boolean, notice: string) => {
    for (const draft of draftCache.values()) {
      if (!predicate(draft)) continue;
      for (const item of draft.items) {
        if (!ACTIVE.has(item.stage)) continue;
        item.controller?.abort(); item.controller = undefined;
        // A lost deletion response cannot make its possibly deleted ref sendable.
        item.stage = item.attachment ? 'failed' : 'paused';
        item.error = item.attachment ? 'Removal could not be confirmed. Retry removing this file before sending.' : undefined;
        item.notice = item.attachment ? undefined : notice;
      }
    }
    queue.current = queue.current.filter(value => !predicate(value.draft));
    refresh();
  }, [refresh]);
  const lockDrafts = useCallback(() => {
    current.current.locked = true;
    sessionEpoch.current++;
    pauseDrafts(() => true, 'Upload paused when the workspace locked. Retry to check its status.');
    for (const controller of cleanupControllers.current) controller.abort();
    cleanupControllers.current.clear();
  }, [pauseDrafts]);
  const locked = useFileAttachmentLock(options.locked, lockDrafts);
  current.current = { ...options, locked };
  const { workspaceId, draftKey } = options;
  const scope = scopeOf(workspaceId, draftKey);
  const previousScope = useRef(scope);
  const capturedEpoch = sessionEpoch.current;

  useLayoutEffect(() => {
    if (previousScope.current === scope) return;
    const oldScope = previousScope.current;
    previousScope.current = scope;
    pauseDrafts(draft => scopeOf(draft.workspaceId, draft.draftKey) === oldScope, 'Upload paused when you changed conversations. Retry to check its status.');
  }, [scope, pauseDrafts]);
  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
      sessionEpoch.current++;
      const previousWorkspace = current.current.workspaceId;
      pauseDrafts(draft => draft.workspaceId === previousWorkspace, 'Upload paused when you left this workspace. Retry to check its status.');
      for (const controller of cleanupControllers.current) controller.abort();
      cleanupControllers.current.clear();
    };
  }, [pauseDrafts]);

  function unavailable() { return !mounted.current || current.current.locked || pageLocked(); }
  function blocked() {
    return unavailable() || current.current.disabled || current.current.workspaceId !== workspaceId || current.current.draftKey !== draftKey;
  }
  function belongs(draft: FileDraft, item: DraftFile) {
    return draftCache.get(scopeOf(draft.workspaceId, draft.draftKey)) === draft && draft.items.includes(item);
  }
  function live(draft: FileDraft, item: DraftFile, controller: AbortController, epoch: number) {
    return !unavailable() && epoch === sessionEpoch.current && belongs(draft, item) && item.controller === controller
      && current.current.workspaceId === draft.workspaceId && current.current.draftKey === draft.draftKey;
  }
  function getDraft(key = draftKey) {
    const target = scopeOf(workspaceId, key);
    let draft = draftCache.get(target);
    if (!draft) { draft = { workspaceId, draftKey: key, items: [], error: null }; draftCache.set(target, draft); }
    return draft;
  }

  async function upload(draft: FileDraft, item: DraftFile) {
    if (!item.file || unavailable() || !belongs(draft, item)) return;
    const controller = new AbortController();
    const epoch = sessionEpoch.current;
    item.controller = controller;
    item.error = undefined; item.notice = undefined;
    const accept = (progress: FileAttachmentProgress) => {
      if (!live(draft, item, controller, epoch)) return;
      Object.assign(item, progress);
      if (item.stage === 'ready') item.file = undefined;
      refresh();
    };
    try {
      accept(await uploadFileAttachment({ workspaceId: draft.workspaceId, file: item.file, signal: controller.signal,
        previousJob: item.job, expectedSha256: item.sha256, onProgress: accept }));
    } catch (error) {
      if (live(draft, item, controller, epoch)) { item.stage = 'failed'; item.error = message(error); }
    } finally {
      if (belongs(draft, item) && item.controller === controller) { item.controller = undefined; refresh(); }
    }
  }

  function drain() {
    // The HF SDK allocates chunking memory inside the worker. Keep one worker.
    while (activeUploads.current < 1 && queue.current.length && !unavailable()) {
      const next = queue.current.shift()!;
      if (!belongs(next.draft, next.item) || next.item.stage !== 'queued') continue;
      if (next.draft.workspaceId !== current.current.workspaceId || next.draft.draftKey !== current.current.draftKey) {
        next.item.stage = 'paused'; next.item.notice = 'Upload paused. Return to this draft and retry.'; continue;
      }
      activeUploads.current++;
      void upload(next.draft, next.item).finally(() => { activeUploads.current--; drain(); });
    }
  }
  function enqueue(draft: FileDraft, item: DraftFile) {
    item.stage = 'queued'; item.error = undefined; item.notice = undefined;
    queue.current.push({ draft, item });
    refresh(); drain();
  }

  function addFiles(files: FileList | readonly File[]) {
    if (blocked() || !files.length) return;
    const draft = getDraft();
    let error: string | null = null;
    const selected = Array.from(files);
    try {
      if (selected.length + draft.items.length > FILE_ATTACHMENT_LIMITS.count) throw new Error('Attach up to 8 files per message. Remove a file or choose fewer files.');
      let total = draft.items.reduce((sum, item) => sum + item.bytes, 0);
      for (const file of selected) { validateAttachmentFile(file); total += file.size; }
      if (total > FILE_ATTACHMENT_LIMITS.totalBytes) throw new Error('Files in one message can total up to 50 MiB. Remove a file or choose smaller files.');
      const buffered = [...draftCache.values()].flatMap(value => value.items);
      if (buffered.length + selected.length > MAX_BUFFERED_ITEMS || buffered.reduce((sum, item) => sum + (item.file?.size || 0), 0) + selected.reduce((sum, file) => sum + file.size, 0) > MAX_BUFFERED_BYTES) {
        throw new Error('Several drafts already have files waiting. Send or remove those attachments before adding more.');
      }
    } catch (failure) { error = message(failure); }
    draft.error = error;
    if (error) { refresh(); return; }
    const items: DraftFile[] = selected.map(file => ({ key: crypto.randomUUID(), name: file.name, mimeType: file.type || 'application/octet-stream', bytes: file.size,
      stage: 'queued', bytesUploaded: 0, bytesImported: 0, file }));
    draft.items.push(...items);
    for (const item of items) enqueue(draft, item);
  }

  async function removeFromDraft(draft: FileDraft, item: DraftFile) {
    if (!belongs(draft, item) || item.stage === 'removing') return;
    queue.current = queue.current.filter(value => value.item !== item);
    item.controller?.abort(); item.controller = undefined;
    if (!item.attachment) {
      item.file = undefined;
      draft.items = draft.items.filter(value => value !== item);
      if (!draft.items.length) draftCache.delete(scopeOf(draft.workspaceId, draft.draftKey));
      refresh(); return;
    }
    const controller = new AbortController(); const epoch = sessionEpoch.current;
    item.controller = controller; item.stage = 'removing'; item.error = undefined;
    refresh();
    try {
      await api(`/workspaces/${encoded(draft.workspaceId)}/file-attachments/${encoded(item.attachment.id)}?sha256=${item.attachment.sha256}`, { method: 'DELETE', signal: controller.signal });
    } catch (error) {
      const retainedOrGone = error instanceof ApiError && (error.status === 404 || error.status === 410 || error.code === 'FILE_ATTACHMENT_IN_USE');
      if (!retainedOrGone) {
        if (!unavailable() && epoch === sessionEpoch.current && belongs(draft, item) && item.controller === controller) { item.stage = 'failed'; item.error = `Could not remove this file: ${message(error)}`; }
        return;
      }
    } finally { if (belongs(draft, item) && item.controller === controller) { item.controller = undefined; refresh(); } }
    if (controller.signal.aborted || epoch !== sessionEpoch.current || !belongs(draft, item)) return;
    item.file = undefined;
    draft.items = draft.items.filter(value => value !== item);
    if (!draft.items.length) draftCache.delete(scopeOf(draft.workspaceId, draft.draftKey));
    refresh();
  }

  async function remove(key: string) {
    if (blocked()) return;
    const draft = getDraft(), item = draft.items.find(value => value.key === key);
    if (item) await removeFromDraft(draft, item);
  }
  function cancel(key: string) {
    if (blocked()) return;
    const draft = getDraft(), item = draft.items.find(value => value.key === key);
    if (!item || !ACTIVE.has(item.stage) || item.stage === 'removing' || item.stage === 'cancelling') return;
    queue.current = queue.current.filter(value => value.item !== item);
    if (item.controller) {
      item.stage = 'cancelling'; item.notice = 'Checking whether the file finished before cancellation…';
      item.controller.abort();
    } else { item.stage = 'cancelled'; item.notice = 'Upload cancelled. Retry or remove this file.'; }
    refresh();
  }
  function retry(key: string) {
    if (blocked()) return;
    const draft = getDraft(), item = draft.items.find(value => value.key === key);
    if (!item || ACTIVE.has(item.stage)) return;
    if (item.attachment) { void removeFromDraft(draft, item); return; }
    if (!item.file) { item.stage = 'failed'; item.error = 'Choose this file again to retry the upload.'; refresh(); return; }
    enqueue(draft, item);
  }
  function clearSubmitted(key = draftKey, refs?: readonly FileAttachmentReference[]) {
    if (capturedEpoch !== sessionEpoch.current) return;
    const draft = draftCache.get(scopeOf(workspaceId, key));
    if (!draft) return;
    draft.items = draft.items.filter(item => {
      const sent = item.attachment && (!refs || refs.some(ref => ref.id === item.attachment!.id && ref.sha256 === item.attachment!.sha256));
      if (sent) { item.controller?.abort(); item.file = undefined; }
      return !sent;
    });
    draft.error = null;
    if (!draft.items.length) draftCache.delete(scopeOf(workspaceId, key));
    refresh();
  }
  async function discardDraft(key = draftKey) {
    if (unavailable()) return;
    const draft = draftCache.get(scopeOf(workspaceId, key));
    if (!draft) return;
    draft.error = null;
    await Promise.all(draft.items.map(item => removeFromDraft(draft, item)));
    refresh();
  }
  async function restoreDraft(key: string, attachments: readonly FileAttachment[]) {
    if (unavailable() || capturedEpoch !== sessionEpoch.current) return;
    if (attachments.length > FILE_ATTACHMENT_LIMITS.count || new Set(attachments.map(item => item.id)).size !== attachments.length
      || attachments.some(item => !validFileAttachment(item, workspaceId)) || attachments.reduce((sum, item) => sum + item.bytes, 0) > FILE_ATTACHMENT_LIMITS.totalBytes) {
      throw new Error('The restored files could not be confirmed. Reopen the conversation and try again.');
    }
    const target = scopeOf(workspaceId, key), previous = draftCache.get(target);
    const replacement: FileDraft = { workspaceId, draftKey: key, error: null, items: attachments.map(attachment => ({ key: crypto.randomUUID(), name: attachment.name,
      mimeType: attachment.mimeType, bytes: attachment.bytes, attachment, stage: 'ready', bytesUploaded: attachment.bytes, bytesImported: attachment.bytes })) };
    draftCache.set(target, replacement);
    queue.current = queue.current.filter(value => value.draft !== previous);
    for (const item of previous?.items || []) { item.controller?.abort(); item.file = undefined; }
    refresh();
    await Promise.all((previous?.items || []).filter(item => item.attachment && !attachments.some(value => value.id === item.attachment!.id)).map(async item => {
      const controller = new AbortController(); cleanupControllers.current.add(controller);
      try { await api(`/workspaces/${encoded(workspaceId)}/file-attachments/${encoded(item.attachment!.id)}?sha256=${item.attachment!.sha256}`, { method: 'DELETE', signal: controller.signal }); }
      catch (error) {
        const retainedOrGone = error instanceof ApiError && (error.status === 404 || error.status === 410 || error.code === 'FILE_ATTACHMENT_IN_USE');
        if (!controller.signal.aborted && !retainedOrGone && draftCache.get(target) === replacement) replacement.error = 'The previous file could not be deleted. Your restored files are ready; unused uploads expire after 24 hours.';
      } finally { cleanupControllers.current.delete(controller); refresh(); }
    }));
  }
  function promoteDraft(fromKey: string, toKey: string) {
    if (fromKey === toKey) return true;
    const from = scopeOf(workspaceId, fromKey), to = scopeOf(workspaceId, toKey), draft = draftCache.get(from);
    if (!draft) return true;
    if (draftCache.get(to)?.items.length) return false;
    draft.draftKey = toKey; draftCache.delete(from); draftCache.set(to, draft); refresh(); return true;
  }

  const draft = draftCache.get(scope), items = draft?.items || [], disabled = !!options.disabled || locked;
  return {
    scope, items: items.map(({ file: _file, controller: _controller, ...item }) => item),
    attachmentRefs: items.flatMap(item => item.stage === 'ready' && item.attachment ? [{ id: item.attachment.id, sha256: item.attachment.sha256 }] : []),
    hasAttachments: items.length > 0, isBusy: items.some(item => ACTIVE.has(item.stage)), hasErrors: items.some(item => ['failed', 'cancelled', 'unconfirmed', 'paused'].includes(item.stage)),
    disabled, locked, canAttach: !disabled && items.length < FILE_ATTACHMENT_LIMITS.count && items.reduce((sum, item) => sum + item.bytes, 0) < FILE_ATTACHMENT_LIMITS.totalBytes,
    error: draft?.error || null, addFiles, remove, cancel, retry, clearSubmitted, discardDraft, restoreDraft, promoteDraft,
    clearError: () => { const value = draftCache.get(scope); if (value) { value.error = null; refresh(); } },
    reportError: error => { if (!blocked()) { getDraft().error = error.slice(0, 600); refresh(); } },
  };
}
