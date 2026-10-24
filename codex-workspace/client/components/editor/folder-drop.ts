import type { FileEntry } from '../../../shared/types';
import { MAX_WORKSPACE_FOLDER_UPLOAD_FILES, MAX_WORKSPACE_UPLOAD_BYTES, MAX_WORKSPACE_UPLOAD_FILES, MAX_WORKSPACE_UPLOAD_TOTAL_BYTES } from '../../uploads';

export const MAX_FOLDER_UPLOAD_FILES = MAX_WORKSPACE_FOLDER_UPLOAD_FILES;
export const MAX_FOLDER_UPLOAD_DIRECTORIES = 500;
export const MAX_FOLDER_UPLOAD_BYTES = MAX_WORKSPACE_UPLOAD_TOTAL_BYTES;
export const MAX_FOLDER_UPLOAD_DEPTH = 32;
const MAX_PATH_BYTES = 2048;
const READ_TIMEOUT_MS = 20_000;

export class FolderDropError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'FolderDropError'; }
}

export interface FolderUploadPlan {
  /** Paths are relative to the folder the user actually dropped onto. */
  directories: string[];
  files: Array<{ file: File; relativePath: string }>;
  totalBytes: number;
}

export interface FolderScanOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { files: number; directories: number }) => void;
}

/** Small structural interfaces also cover browsers without the newer DOM types. */
export interface DroppedHandle {
  kind: 'file' | 'directory';
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterableIterator<DroppedHandle>;
}

export interface DroppedEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: DroppedEntry[]) => void, failure?: (error: DOMException) => void) => void;
  };
}

export interface DroppedItem {
  kind: string;
  getAsFile: () => File | null;
  getAsFileSystemHandle?: () => Promise<DroppedHandle | null>;
  webkitGetAsEntry?: () => DroppedEntry | null;
  getAsEntry?: () => DroppedEntry | null;
}

type CapturedItem = {
  file: File | null;
  entry: DroppedEntry | null;
  canInspectFolders: boolean;
  handle?: Promise<{ value: DroppedHandle | null; error?: unknown }>;
  captureError?: unknown;
};

function cancelled(): DOMException { return new DOMException('Upload cancelled.', 'AbortError'); }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }

export function validateExplorerPath(path: string, allowRoot = false): string {
  if (typeof path !== 'string' || (!path && !allowRoot) || /[\\\u0000-\u001f\u007f]/.test(path)
    || new TextEncoder().encode(path).byteLength > MAX_PATH_BYTES
    || (path && path.split('/').some(part => !part || part === '.' || part === '..' || new TextEncoder().encode(part).byteLength > 255))) {
    throw new FolderDropError('UPLOAD_PATH_INVALID', 'Choose a relative workspace path without empty names, “..”, or unsupported filename characters.');
  }
  return path;
}

export function uploadDestination(directory: string, relativePath: string): string {
  validateExplorerPath(directory, true);
  validateExplorerPath(relativePath);
  return validateExplorerPath(directory ? `${directory}/${relativePath}` : relativePath);
}

function entryPath(parent: string, name: string): string {
  // A name is one component, never a browser-supplied absolute/full path.
  if (typeof name !== 'string' || name.includes('/')) throw new FolderDropError('UPLOAD_NAME_INVALID', 'A dropped item has an unsupported name. Rename it before uploading.');
  const path = uploadDestination(parent, name);
  if (path.split('/').length > MAX_FOLDER_UPLOAD_DEPTH) throw new FolderDropError('UPLOAD_FOLDER_TOO_DEEP', `Choose folders no more than ${MAX_FOLDER_UPLOAD_DEPTH} levels deep.`);
  return path;
}

function readWithTimeout<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error !== undefined) reject(error); else resolve(value!);
    };
    const abort = () => finish(cancelled());
    const timer = setTimeout(() => finish(new FolderDropError('UPLOAD_FOLDER_READ_TIMEOUT', 'The browser took too long to read a dropped item. Select the folder again or use Upload files.')), READ_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(value => finish(undefined, value), error => finish(error));
    if (signal?.aborted) abort();
  });
}

class PlanBuilder {
  private readonly directories = new Set<string>();
  private readonly explicitDirectories = new Set<string>();
  private readonly filePaths = new Set<string>();
  private readonly files: FolderUploadPlan['files'] = [];
  private totalBytes = 0;

  constructor(private readonly options: FolderScanOptions, private readonly maxFiles = MAX_FOLDER_UPLOAD_FILES) {}

  private changed() {
    checkAbort(this.options.signal);
    this.options.onProgress?.({ files: this.files.length, directories: this.directories.size });
  }

  private parents(path: string) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) this.directory(parts.slice(0, index).join('/'), false);
  }

  directory(path: string, explicit = true) {
    checkAbort(this.options.signal);
    validateExplorerPath(path);
    if (path.split('/').length > MAX_FOLDER_UPLOAD_DEPTH) throw new FolderDropError('UPLOAD_FOLDER_TOO_DEEP', `Choose folders no more than ${MAX_FOLDER_UPLOAD_DEPTH} levels deep.`);
    if (this.filePaths.has(path) || (explicit && this.explicitDirectories.has(path))) {
      throw new FolderDropError('UPLOAD_DUPLICATE_PATH', `More than one dropped item uses “${path}”. Rename one before uploading.`);
    }
    if (explicit) this.explicitDirectories.add(path);
    if (!this.directories.has(path)) {
      if (this.directories.size >= MAX_FOLDER_UPLOAD_DIRECTORIES) throw new FolderDropError('UPLOAD_TOO_MANY_FOLDERS', `Choose no more than ${MAX_FOLDER_UPLOAD_DIRECTORIES} folders at a time.`);
      this.directories.add(path);
      this.parents(path);
      this.changed();
    }
  }

  file(file: File, path: string) {
    checkAbort(this.options.signal);
    validateExplorerPath(path);
    if (!(file instanceof Blob) || typeof file.name !== 'string' || path.split('/').at(-1) !== file.name) {
      throw new FolderDropError('UPLOAD_FILE_UNREADABLE', 'The browser could not read a selected file safely. Select the files again.');
    }
    if (path.split('/').length > MAX_FOLDER_UPLOAD_DEPTH) throw new FolderDropError('UPLOAD_FOLDER_TOO_DEEP', `Choose folders no more than ${MAX_FOLDER_UPLOAD_DEPTH} levels deep.`);
    if (this.filePaths.has(path) || this.directories.has(path)) throw new FolderDropError('UPLOAD_DUPLICATE_PATH', `More than one dropped item uses “${path}”. Rename one before uploading.`);
    if (this.files.length >= this.maxFiles) throw new FolderDropError('UPLOAD_BATCH_TOO_LARGE', `Choose no more than ${this.maxFiles} files at a time. Split larger selections into smaller uploads.`);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_WORKSPACE_UPLOAD_BYTES) throw new FolderDropError('UPLOAD_TOO_LARGE', `“${file.name}” exceeds the ${MAX_WORKSPACE_UPLOAD_BYTES / 1024 / 1024} MB per-file upload limit.`);
    if (this.totalBytes + file.size > MAX_FOLDER_UPLOAD_BYTES) throw new FolderDropError('UPLOAD_BATCH_TOO_LARGE', `Choose no more than ${MAX_FOLDER_UPLOAD_BYTES / 1024 / 1024} MB of files in one upload.`);
    this.parents(path);
    this.filePaths.add(path);
    this.files.push({ file, relativePath: path });
    this.totalBytes += file.size;
    this.changed();
  }

  result(): FolderUploadPlan {
    checkAbort(this.options.signal);
    if (!this.files.length && !this.directories.size) throw new FolderDropError('UPLOAD_DROP_EMPTY', 'No readable files or folders were provided. Use Upload files or Upload folder.');
    return {
      directories: [...this.directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)),
      files: [...this.files], totalBytes: this.totalBytes,
    };
  }
}

async function visitHandle(handle: DroppedHandle, parent: string, builder: PlanBuilder, options: FolderScanOptions): Promise<void> {
  checkAbort(options.signal);
  const path = entryPath(parent, handle.name);
  if (handle.kind === 'file' && typeof handle.getFile === 'function') {
    builder.file(await readWithTimeout(handle.getFile(), options.signal), path);
  } else if (handle.kind === 'directory' && typeof handle.values === 'function') {
    builder.directory(path);
    const iterator = handle.values();
    for (;;) {
      const child = await readWithTimeout(iterator.next(), options.signal);
      if (child.done) break;
      await visitHandle(child.value, path, builder, options);
    }
  } else throw new FolderDropError('UPLOAD_FOLDER_UNSUPPORTED', 'This browser cannot read this dropped folder. Use Upload folder, or select its files with Upload files.');
}

async function visitEntry(entry: DroppedEntry, parent: string, builder: PlanBuilder, options: FolderScanOptions): Promise<void> {
  checkAbort(options.signal);
  const path = entryPath(parent, entry.name);
  if (entry.isFile && !entry.isDirectory && typeof entry.file === 'function') {
    const file = await readWithTimeout(new Promise<File>((resolve, reject) => entry.file!(resolve, reject)), options.signal);
    builder.file(file, path);
  } else if (entry.isDirectory && !entry.isFile && typeof entry.createReader === 'function') {
    builder.directory(path);
    const reader = entry.createReader();
    // Chromium returns directory contents in batches (commonly 100 entries).
    // The empty batch is the only indication that enumeration has finished.
    for (;;) {
      const children = await readWithTimeout(new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject)), options.signal);
      if (!Array.isArray(children)) throw new FolderDropError('UPLOAD_FOLDER_UNREADABLE', 'The browser returned an unreadable folder. Select it again.');
      if (!children.length) break;
      for (const child of children) await visitEntry(child, path, builder, options);
    }
  } else throw new FolderDropError('UPLOAD_FOLDER_UNSUPPORTED', 'This browser cannot read this dropped folder. Use Upload folder, or select its files with Upload files.');
}

function readableError(error: unknown): never {
  if (error instanceof FolderDropError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
  throw new FolderDropError('UPLOAD_FOLDER_UNREADABLE', 'The browser could not read every dropped file or folder. Nothing was uploaded. Use Upload folder or Upload files to select them again.');
}

/**
 * Call in the drop event itself, before awaiting anything. Browser drag data is
 * protected after that event; capture every entry/handle request synchronously.
 * Only metadata and File references are retained, never a full in-memory tree of
 * file contents. Enumeration is sequential and completes before workspace writes.
 */
export function collectExternalDrop(transfer: { items: ArrayLike<DroppedItem>; files: ArrayLike<File> }, options: FolderScanOptions = {}): Promise<FolderUploadPlan> {
  const captured: CapturedItem[] = [];
  try {
    checkAbort(options.signal);
    if (transfer.items.length > MAX_FOLDER_UPLOAD_FILES + MAX_FOLDER_UPLOAD_DIRECTORIES) throw new FolderDropError('UPLOAD_BATCH_TOO_LARGE', 'Too many dropped items. Split them into smaller uploads.');
    for (const item of Array.from(transfer.items)) {
      if (item.kind !== 'file') continue;
      let entry: DroppedEntry | null = null;
      let captureError: unknown;
      try { entry = item.getAsEntry?.() || item.webkitGetAsEntry?.() || null; }
      catch (error) { captureError = error; }
      let handle: CapturedItem['handle'];
      try {
        if (typeof item.getAsFileSystemHandle === 'function') {
          // Catch immediately: a later earlier-item failure must not leave an
          // unhandled rejection from another already captured handle request.
          handle = Promise.resolve(item.getAsFileSystemHandle()).then(value => ({ value }), error => ({ value: null, error }));
        }
      } catch (error) { captureError = error; }
      let file: File | null = null;
      try { file = item.getAsFile(); } catch (error) { captureError = error; }
      captured.push({ entry, handle, file, captureError, canInspectFolders: typeof item.getAsEntry === 'function' || typeof item.webkitGetAsEntry === 'function' || typeof item.getAsFileSystemHandle === 'function' });
    }
    if (!captured.length) {
      // Without entry APIs a folder can masquerade as an empty file. A file
      // picker is the explicit fallback instead of silently flattening it.
      throw new FolderDropError('UPLOAD_FOLDER_UNSUPPORTED', 'This browser cannot inspect dropped files or folders. Use Upload files or Upload folder.');
    }
  } catch (error) { return Promise.reject(error); }
  return (async () => {
    const builder = new PlanBuilder(options);
    try {
      for (const item of captured) {
        checkAbort(options.signal);
        const handle = item.handle ? await readWithTimeout(item.handle, options.signal) : undefined;
        if (handle?.value) await visitHandle(handle.value, '', builder, options);
        else if (item.entry) await visitEntry(item.entry, '', builder, options);
        else if (item.file && item.canInspectFolders && !handle?.error && !item.captureError) {
          // Browser-generated loose Files can lack an entry even when folder
          // inspection is supported. Reject unreadable directory proxies.
          await readWithTimeout(item.file.slice(0, 1).arrayBuffer(), options.signal);
          builder.file(item.file, entryPath('', item.file.name));
        } else throw new FolderDropError('UPLOAD_FOLDER_UNSUPPORTED', 'The browser did not expose every dropped folder. Nothing was uploaded. Use Upload folder or Upload files.');
      }
      return builder.result();
    } catch (error) { return readableError(error); }
  })();
}

export async function collectDirectoryHandle(handle: DroppedHandle, options: FolderScanOptions = {}): Promise<FolderUploadPlan> {
  const builder = new PlanBuilder(options);
  try { await visitHandle(handle, '', builder, options); return builder.result(); }
  catch (error) { return readableError(error); }
}

/** webkitdirectory preserves relative file paths, but omits empty directories. */
export function planSelectedFiles(files: readonly File[], folderSelection = false, options: FolderScanOptions = {}): FolderUploadPlan {
  const builder = new PlanBuilder(options, folderSelection ? MAX_FOLDER_UPLOAD_FILES : MAX_WORKSPACE_UPLOAD_FILES);
  for (const file of files) {
    const relativePath = folderSelection ? file.webkitRelativePath : file.name;
    if (!relativePath) throw new FolderDropError('UPLOAD_FOLDER_UNSUPPORTED', 'The browser did not expose this folder’s relative paths. Drag the folder here or use Upload files.');
    builder.file(file, relativePath);
  }
  return builder.result();
}

export interface PrepareFolderOptions {
  directory: string;
  signal?: AbortSignal;
  list: (path: string) => Promise<FileEntry[]>;
  createDirectory: (path: string) => Promise<FileEntry>;
  checkTarget?: (path: string) => void;
  onCreated?: (path: string, count: number) => void;
}

/** Create-only hierarchy; any collision stops the plan without merging folders. */
export async function prepareFolderUpload(plan: FolderUploadPlan, options: PrepareFolderOptions): Promise<void> {
  const { directory, signal } = options;
  checkAbort(signal);
  validateExplorerPath(directory, true);
  const targets = [...plan.directories, ...plan.files.map(file => file.relativePath)].map(path => uploadDestination(directory, path));
  for (const path of targets) options.checkTarget?.(path);
  if (!plan.directories.length) return;
  const roots = new Set([...plan.directories, ...plan.files.map(file => file.relativePath)].map(path => path.split('/')[0]));
  const existing = await options.list(directory);
  checkAbort(signal);
  if (!Array.isArray(existing) || existing.some(entry => !entry || typeof entry.name !== 'string' || !['file', 'directory'].includes(entry.kind))) {
    throw new FolderDropError('UPLOAD_FOLDER_UNREADABLE', 'The destination folder could not be checked. Refresh it before uploading.');
  }
  const collision = existing.find(entry => roots.has(entry.name));
  if (collision) throw new FolderDropError('UPLOAD_DESTINATION_EXISTS', `“${collision.name}” already exists in ${directory || 'the workspace root'}. Choose another destination or rename the item before uploading. Existing folders are not merged.`);
  let count = 0;
  for (const relativePath of plan.directories) {
    checkAbort(signal);
    const path = uploadDestination(directory, relativePath);
    options.checkTarget?.(path);
    const entry = await options.createDirectory(path);
    checkAbort(signal);
    if (!entry || entry.kind !== 'directory' || entry.path !== path || entry.isSymlink) throw new FolderDropError('UPLOAD_FOLDER_UNCONFIRMED', `Could not confirm the new folder “${path}”. Refresh the destination before retrying.`);
    options.onCreated?.(path, ++count);
  }
}
