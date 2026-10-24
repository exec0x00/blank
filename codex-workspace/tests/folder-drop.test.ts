import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../shared/types';
import {
  collectDirectoryHandle, collectExternalDrop, MAX_FOLDER_UPLOAD_BYTES, MAX_FOLDER_UPLOAD_DIRECTORIES,
  MAX_FOLDER_UPLOAD_FILES, planSelectedFiles, prepareFolderUpload, uploadDestination, validateExplorerPath,
  type DroppedEntry, type DroppedHandle, type DroppedItem,
} from '../client/components/editor/folder-drop';

const file = (name: string, content = name) => new File([content], name);
const fileEntry = (value: File): DroppedEntry => ({ name: value.name, isFile: true, isDirectory: false, file: resolve => resolve(value) });
function directoryEntry(name: string, batches: DroppedEntry[][]) {
  const readEntries = vi.fn((resolve: (entries: DroppedEntry[]) => void) => resolve(batches.shift() || []));
  return { name, isFile: false, isDirectory: true, createReader: () => ({ readEntries }), readEntries } satisfies DroppedEntry & { readEntries: typeof readEntries };
}
const entryItem = (entry: DroppedEntry): DroppedItem => ({ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => entry });
const transfer = (...items: DroppedItem[]) => ({ items, files: [] });
const fileHandle = (value: File): DroppedHandle => ({ name: value.name, kind: 'file', getFile: async () => value });
const directoryHandle = (name: string, children: DroppedHandle[] = []): DroppedHandle => ({ name, kind: 'directory', async *values() { yield* children; } });
const createdDirectory = (path: string): FileEntry => ({ path, name: path.split('/').at(-1)!, kind: 'directory' });
function pickedFile(path: string, content = 'saved') {
  const value = file(path.split('/').at(-1)!, content);
  Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
}

afterEach(() => { vi.useRealTimers(); });

describe('external explorer folder drops', () => {
  it('reads every legacy directory batch, preserving nested and empty folders', async () => {
    const loose = file('loose.txt');
    const nested = file('café 你好.txt', 'saved bytes');
    const root = directoryEntry('project', [
      Array.from({ length: 100 }, (_, index) => directoryEntry(`empty-${index}`, [[]])),
      [directoryEntry('nested', [[fileEntry(nested)]])],
      [],
    ]);
    const result = await collectExternalDrop(transfer(entryItem(root), entryItem(fileEntry(loose))));
    expect(root.readEntries).toHaveBeenCalledTimes(3);
    expect(result.directories).toHaveLength(102);
    expect(result.directories).toContain('project/empty-99');
    expect(result.directories).toContain('project/nested');
    expect(result.files).toEqual([{ file: nested, relativePath: 'project/nested/café 你好.txt' }, { file: loose, relativePath: 'loose.txt' }]);
    expect(result.totalBytes).toBe(nested.size + loose.size);
  });

  it('captures every entry and modern handle request in the original drop turn', async () => {
    let dropTurn = true;
    let resolveFirst!: (value: DroppedHandle) => void;
    const invoked: number[] = [];
    const first = new Promise<DroppedHandle>(resolve => { resolveFirst = resolve; });
    const items = [first, Promise.resolve(fileHandle(file('second.txt')))].map((handle, index) => ({
      kind: 'file', getAsFile: () => null,
      getAsFileSystemHandle() { expect(dropTurn).toBe(true); invoked.push(index); return handle; },
    }));
    const result = collectExternalDrop(transfer(...items));
    dropTurn = false;
    expect(invoked).toEqual([0, 1]);
    resolveFirst(directoryHandle('empty'));
    expect(await result).toMatchObject({ directories: ['empty'], files: [{ relativePath: 'second.txt' }] });
  });

  it('uses a captured legacy entry when the modern handle API is unavailable', async () => {
    const item = entryItem(directoryEntry('fallback', [[fileEntry(file('content.txt'))]]));
    item.getAsFileSystemHandle = async () => { throw new DOMException('Not allowed', 'NotAllowedError'); };
    const result = await collectExternalDrop(transfer(item));
    expect(result.files[0].relativePath).toBe('fallback/content.txt');
  });

  it('reads modern directory handles sequentially and includes empty directories', async () => {
    const first = file('same.txt', 'first'); const second = file('same.txt', 'second');
    const result = await collectDirectoryHandle(directoryHandle('root', [
      directoryHandle('empty'), directoryHandle('one', [fileHandle(first)]), directoryHandle('two', [fileHandle(second)]),
    ]));
    expect(result.directories).toEqual(['root', 'root/empty', 'root/one', 'root/two']);
    expect(result.files.map(item => item.relativePath)).toEqual(['root/one/same.txt', 'root/two/same.txt']);
    expect(result.files.map(item => item.file)).toEqual([first, second]);
  });

  it('supports readable loose files without flattening unreadable folder proxies', async () => {
    const loose = file('standalone.txt');
    const result = await collectExternalDrop(transfer({ kind: 'file', getAsFile: () => loose, webkitGetAsEntry: () => null }));
    expect(result.files).toEqual([{ file: loose, relativePath: 'standalone.txt' }]);
    const proxy = file('folder');
    Object.defineProperty(proxy, 'slice', { value: () => ({ arrayBuffer: async () => { throw new DOMException('Folder', 'NotReadableError'); } }) });
    await expect(collectExternalDrop(transfer({ kind: 'file', getAsFile: () => proxy, webkitGetAsEntry: () => null }))).rejects.toMatchObject({ code: 'UPLOAD_FOLDER_UNREADABLE' });
  });

  it('gives an actionable fallback when the browser cannot expose dropped directories', async () => {
    await expect(collectExternalDrop(transfer({ kind: 'file', getAsFile: () => null }))).rejects.toThrow('Use Upload folder or Upload files');
    await expect(collectExternalDrop(transfer({ kind: 'file', getAsFile: () => file('possibly-a-folder', '') }))).rejects.toMatchObject({ code: 'UPLOAD_FOLDER_UNSUPPORTED' });
    await expect(collectExternalDrop({ items: [], files: [file('unknown')] })).rejects.toMatchObject({ code: 'UPLOAD_FOLDER_UNSUPPORTED' });
  });

  it('fails the whole plan if a later entry cannot be read instead of silently skipping it', async () => {
    const broken: DroppedEntry = { name: 'bad', isFile: false, isDirectory: true, createReader: () => ({ readEntries: (_resolve, reject) => reject!(new DOMException('Permission denied', 'NotReadableError')) }) };
    const root = directoryEntry('root', [[fileEntry(file('valid.txt')), broken]]);
    await expect(collectExternalDrop(transfer(entryItem(root)))).rejects.toThrow('Nothing was uploaded');
  });

  it('stops reading promptly when cancelled while waiting for a directory batch', async () => {
    const controller = new AbortController();
    const pending: DroppedEntry = { name: 'pending', isFile: false, isDirectory: true, createReader: () => ({ readEntries: () => undefined }) };
    const result = collectExternalDrop(transfer(entryItem(pending)), { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('bounds a browser reader that never returns', async () => {
    vi.useFakeTimers();
    const pending: DroppedEntry = { name: 'pending', isFile: false, isDirectory: true, createReader: () => ({ readEntries: () => undefined }) };
    const result = collectExternalDrop(transfer(entryItem(pending)));
    const rejected = expect(result).rejects.toMatchObject({ code: 'UPLOAD_FOLDER_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20_001);
    await rejected;
  });

  it('preserves directory-picker file paths and plans ancestors before descendants', () => {
    const result = planSelectedFiles([pickedFile('project/src/deep/app.ts'), pickedFile('project/README.md')], true);
    expect(result.directories).toEqual(['project', 'project/src', 'project/src/deep']);
    expect(result.files.map(item => item.relativePath)).toEqual(['project/src/deep/app.ts', 'project/README.md']);
    expect(() => planSelectedFiles([file('no-relative-path.txt')], true)).toThrow('relative paths');
  });

  it.each(['../escape.txt', '/absolute.txt', 'root/../escape.txt', 'root//empty.txt', 'root\\windows.txt', 'root/./dot.txt', 'root/\u0000bad.txt'])('rejects the unsafe selected path %j before any writes', path => {
    expect(() => planSelectedFiles([pickedFile(path)], true)).toThrow();
  });

  it('rejects duplicate destinations and file/folder name collisions', async () => {
    expect(() => planSelectedFiles([file('same.txt'), file('same.txt')])).toThrow('More than one');
    const root = directoryEntry('root', [[fileEntry(file('conflict')), directoryEntry('conflict', [[]])]]);
    await expect(collectExternalDrop(transfer(entryItem(root)))).rejects.toMatchObject({ code: 'UPLOAD_DUPLICATE_PATH' });
    await expect(collectExternalDrop(transfer(entryItem(directoryEntry('same', [[]])), entryItem(directoryEntry('same', [[]]))))).rejects.toMatchObject({ code: 'UPLOAD_DUPLICATE_PATH' });
  });

  it('bounds file count, aggregate size, single-file size, directories, and depth', async () => {
    const plannedFiles = Array.from({ length: MAX_FOLDER_UPLOAD_FILES + 1 }, (_, index) => pickedFile(`folder/${index}.txt`));
    expect(() => planSelectedFiles(plannedFiles, true)).toThrow('1000');
    expect(planSelectedFiles(plannedFiles.slice(0, MAX_FOLDER_UPLOAD_FILES), true).files).toHaveLength(MAX_FOLDER_UPLOAD_FILES);
    expect(() => planSelectedFiles(Array.from({ length: 51 }, (_, index) => file(`${index}.txt`)))).toThrow('50');
    const sized = (name: string, size: number) => { const value = file(name); Object.defineProperty(value, 'size', { value: size }); return value; };
    expect(() => planSelectedFiles([sized('large', 25 * 1024 * 1024 + 1)])).toThrow('per-file');
    expect(() => planSelectedFiles(Array.from({ length: MAX_FOLDER_UPLOAD_BYTES / (25 * 1024 * 1024) + 1 }, (_, index) => sized(`${index}.bin`, 25 * 1024 * 1024)))).toThrow('one upload');
    const wide = directoryHandle('wide', Array.from({ length: MAX_FOLDER_UPLOAD_DIRECTORIES }, (_, index) => directoryHandle(`empty-${index}`)));
    await expect(collectDirectoryHandle(wide)).rejects.toMatchObject({ code: 'UPLOAD_TOO_MANY_FOLDERS' });
    expect(() => planSelectedFiles([pickedFile(`${'nested/'.repeat(32)}file.txt`)], true)).toThrow('levels deep');
  });

  it('validates the complete path beneath an explicitly chosen nested destination', () => {
    expect(uploadDestination('assets/nested', 'project/file.txt')).toBe('assets/nested/project/file.txt');
    expect(validateExplorerPath('', true)).toBe('');
    expect(() => uploadDestination('../outside', 'file.txt')).toThrow();
    expect(() => uploadDestination('a'.repeat(255), `${'b/'.repeat(900)}${'c'.repeat(255)}`)).toThrow();
  });
});

describe('create-only workspace folder preparation', () => {
  it('preflights names before creating every ancestor, including an empty folder', async () => {
    const plan = await collectDirectoryHandle(directoryHandle('project', [directoryHandle('empty'), directoryHandle('src', [fileHandle(file('app.ts'))])]));
    const created: string[] = []; const checked: string[] = [];
    const list = vi.fn(async () => []);
    await prepareFolderUpload(plan, {
      directory: 'chosen/nested', list,
      createDirectory: async path => { created.push(path); return createdDirectory(path); },
      checkTarget: path => { checked.push(path); },
    });
    expect(list).toHaveBeenCalledWith('chosen/nested');
    expect(created).toEqual(['chosen/nested/project', 'chosen/nested/project/empty', 'chosen/nested/project/src']);
    expect(checked).toContain('chosen/nested/project/src/app.ts');
  });

  it('does not merge an existing top-level folder or create a partial hierarchy on a known collision', async () => {
    const plan = planSelectedFiles([pickedFile('project/deep/file.txt')], true);
    const createDirectory = vi.fn();
    await expect(prepareFolderUpload(plan, { directory: 'target', list: async () => [createdDirectory('target/project')], createDirectory })).rejects.toMatchObject({ code: 'UPLOAD_DESTINATION_EXISTS' });
    expect(createDirectory).not.toHaveBeenCalled();
  });

  it('checks every destination buffer before the first workspace mutation', async () => {
    const plan = planSelectedFiles([pickedFile('project/deep/file.txt')], true);
    const createDirectory = vi.fn(); const list = vi.fn();
    await expect(prepareFolderUpload(plan, {
      directory: 'target', list, createDirectory,
      checkTarget: path => { if (path === 'target/project/deep/file.txt') throw new Error('Edited buffer stays safe.'); },
    })).rejects.toThrow('Edited buffer');
    expect(createDirectory).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });

  it('stops after a concurrent exclusive-mkdir collision and does not overwrite or silently continue', async () => {
    const plan = planSelectedFiles([pickedFile('project/deep/file.txt')], true);
    const created: string[] = [];
    await expect(prepareFolderUpload(plan, {
      directory: 'target', list: async () => [],
      createDirectory: async path => { if (path.endsWith('/deep')) throw new Error('Destination now exists.'); created.push(path); return createdDirectory(path); },
    })).rejects.toThrow('Destination now exists');
    expect(created).toEqual(['target/project']);
  });

  it('does not continue directory creation after a lock or workspace cancellation', async () => {
    const controller = new AbortController(); const plan = planSelectedFiles([pickedFile('root/deep/file.txt')], true);
    const createDirectory = vi.fn(async (path: string) => { controller.abort(); return createdDirectory(path); });
    const onCreated = vi.fn();
    await expect(prepareFolderUpload(plan, { directory: '', signal: controller.signal, list: async () => [], createDirectory, onCreated })).rejects.toMatchObject({ name: 'AbortError' });
    expect(createDirectory).toHaveBeenCalledTimes(1); expect(onCreated).not.toHaveBeenCalled();
  });

  it('retains the existing per-file upload flow for flat selections without creating folders', async () => {
    const plan = planSelectedFiles([file('loose.txt')]); const list = vi.fn(); const createDirectory = vi.fn();
    await prepareFolderUpload(plan, { directory: '', list, createDirectory });
    expect(list).not.toHaveBeenCalled(); expect(createDirectory).not.toHaveBeenCalled();
  });
});
