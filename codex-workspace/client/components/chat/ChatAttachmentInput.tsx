import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Paperclip } from 'lucide-react';
import type { ImageAttachmentsController } from './ImageAttachments';
import type { FileAttachmentsController } from './useFileAttachments';
import './file-attachments.css';

const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export function isPhotoAttachment(file: Pick<File, 'name' | 'type'>): boolean {
  return PHOTO_TYPES.has(file.type) || (!file.type || file.type === 'application/octet-stream') && /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}
const hasFiles = (transfer: DataTransfer) => Array.from(transfer.types || []).includes('Files') || Array.from(transfer.items || []).some(item => item.kind === 'file');
const isDirectory = (item: DataTransferItem) => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory === true;

export function useChatAttachmentInput(images: ImageAttachmentsController, files: FileAttachmentsController) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const disabled = images.disabled || files.disabled;
  const locked = images.locked || files.locked;
  const identity = useRef({ scope: files.scope, locked, version: 0 });
  if (identity.current.scope !== files.scope || identity.current.locked !== locked) identity.current = { scope: files.scope, locked, version: identity.current.version + 1 };
  const selectionVersion = identity.current.version;
  const current = useRef({ images, files, disabled, locked });
  current.current = { images, files, disabled, locked };
  const unavailable = () => current.current.disabled || current.current.locked || document.body.dataset.workspaceLocked === 'true';
  useEffect(() => { depth.current = 0; setDragging(false); }, [files.scope, disabled, locked]);
  useEffect(() => {
    const invalidate = () => { identity.current.version++; depth.current = 0; setDragging(false); };
    window.addEventListener('codex:session-locked', invalidate);
    window.addEventListener('codex:session-expired', invalidate);
    return () => { window.removeEventListener('codex:session-locked', invalidate); window.removeEventListener('codex:session-expired', invalidate); };
  }, []);
  function addFiles(selection: FileList | readonly File[]) {
    // A native file picker can remain open while keyboard navigation changes the
    // workspace or session. It cannot move files into the newly selected draft.
    if (selectionVersion !== identity.current.version || unavailable()) return;
    const photos: File[] = [], documents: File[] = [];
    for (const file of Array.from(selection)) (isPhotoAttachment(file) ? photos : documents).push(file);
    if (photos.length) current.current.images.addFiles(photos);
    if (documents.length) current.current.files.addFiles(documents);
  }
  return {
    scope: files.scope, selectionVersion, disabled, locked, isDragging: dragging && !disabled,
    canAttach: !disabled && (images.canAttach || files.canAttach), addFiles,
    composerProps: {
      onPaste: (event: ClipboardEvent<HTMLElement>) => {
        const items = Array.from(event.clipboardData.items || []);
        const candidates = items.filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null);
        const selected = candidates.length ? candidates : Array.from(event.clipboardData.files || []);
        if (!selected.length) return;
        // Let the textarea insert plain text normally on mixed text/file paste.
        if (!event.clipboardData.getData('text/plain')) event.preventDefault();
        if (!unavailable()) addFiles(selected);
      },
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault(); depth.current++;
        if (!unavailable()) setDragging(true);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault(); event.dataTransfer.dropEffect = unavailable() ? 'none' : 'copy';
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault(); depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false);
        if (unavailable()) return;
        if (Array.from(event.dataTransfer.items || []).some(isDirectory)) { files.reportError('Choose individual files to attach. Upload folders from the file explorer.'); return; }
        addFiles(event.dataTransfer.files);
      },
    },
  };
}

export type ChatAttachmentInputController = ReturnType<typeof useChatAttachmentInput>;

export function ChatAttachmentButton({ controller }: { controller: ChatAttachmentInputController }) {
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<ChatAttachmentInputController['addFiles'] | null>(null);
  const hintId = useId();
  useEffect(() => {
    const element = input.current;
    const cancel = () => { selection.current = null; };
    element?.addEventListener('cancel', cancel);
    return () => element?.removeEventListener('cancel', cancel);
  }, []);
  return <>
    <button type="button" className="cw-file-attach-button" aria-label="Attach files" title="Attach files and photos" aria-describedby={hintId} disabled={!controller.canAttach} onClick={() => { selection.current = controller.addFiles; input.current?.click(); }}><Paperclip size={16} /></button>
    <input ref={input} className="cw-file-input" type="file" multiple tabIndex={-1} aria-label="Choose file attachments" disabled={controller.disabled} onChange={event => {
      if (event.target.files) (selection.current ?? controller.addFiles)(event.target.files);
      selection.current = null; event.target.value = '';
    }} />
    <span id={hintId} className="sr-only">Attach files and photos, or paste or drop them into your message. Up to 8 files, 25 MiB each and 50 MiB total. PNG, JPEG, WebP and static GIF photos support previews, with up to 8 photos, 8 MiB each and 16 MiB total.</span>
  </>;
}

export function ChatAttachmentDropHint({ visible }: { visible: boolean }) {
  return visible ? <div className="cw-file-drop-hint" role="status"><Paperclip size={17} /><span>Drop files or photos to attach</span><small>Files up to 25 MiB · Photos up to 8 MiB</small></div> : null;
}
