import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NativeFilesSearchPanel, NativeFilePreview, encodeNativeFileText, nativeBrowserPath, nativeFileMutation, nativeFileText } from '../client/components/native/NativeFilesSearchPanel';
import { isWorkspaceWriteHeld, registerWorkspaceRewindGuard } from '../client/workspace-rewind-guard';
import { NATIVE_FILE_BYTES, type NativeFileContents } from '../shared/native-files-search';

const file = (content: string): NativeFileContents => ({ path: 'src/example.txt', dataBase64: Buffer.from(content).toString('base64'),
  bytes: Buffer.byteLength(content), version: createHash('sha256').update(content).digest('hex') });

describe('native files panel content and editor coordination', () => {
  it('renders useful file and search controls, without raw RPC, connection keys or model-provider controls', () => {
    const html = renderToStaticMarkup(<NativeFilesSearchPanel workspaceId="workspace-a" threadId="thread-a" />);
    for (const text of ['Files and search', 'Folder path', 'Search files', 'Start live search', 'Watch folder', 'New file', 'New folder', 'Messages', 'References']) expect(html).toContain(text);
    for (const text of ['fs/readFile', 'attachmentType', 'dataBase64', 'model_provider', 'API key', '/models', '<dialog']) expect(html).not.toContain(text);
  });

  it('shows file contents as escaped text and handles binary files honestly', () => {
    const html = renderToStaticMarkup(<NativeFilePreview file={file('<script>throw Error("never run")</script>\n{"actual":"file content"}')} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('file content'); expect(html).not.toContain('<script'); expect(html).not.toContain('dataBase64');
    expect(renderToStaticMarkup(<NativeFilePreview file={file('binary\0contents')} />)).toContain('binary file');
    expect(nativeFileText(file('actual\n🙂'))).toBe('actual\n🙂');
  });

  it('rejects partial, invalid or oversized previews before rendering or treating them as editable whole files', () => {
    const original = file('complete');
    for (const changed of [{ bytes: 100 }, { dataBase64: 'YQ' }, { version: 'bad' }, { path: '/etc/passwd' }, { bytes: NATIVE_FILE_BYTES + 1 }]) {
      expect(() => nativeFileText({ ...original, ...changed })).toThrow();
    }
    expect(() => encodeNativeFileText('🙂'.repeat(NATIVE_FILE_BYTES / 3))).toThrow('256 KiB');
    expect(() => encodeNativeFileText('binary\0contents')).toThrow('binary');
    expect(Buffer.from(encodeNativeFileText('🙂 file'), 'base64').toString()).toBe('🙂 file');
    for (const selected of ['../secret', '/root/secret', '.git/config', 'folder/../file', 'C:\\outside', '.codex-write-untrusted']) expect(() => nativeBrowserPath(selected)).toThrow();
  });

  it('refuses a file action before HTTP dispatch when its destination intersects a dirty editor buffer', async () => {
    const action = vi.fn(async () => ({ path: 'dirty.txt' })), release = vi.fn();
    const unregister = registerWorkspaceRewindGuard('workspace-native-dirty', {
      read: () => ({ dirtyPaths: ['dirty.txt'] }), acquire: () => ({ dirtyPaths: ['dirty.txt'], release }),
      readExternal: paths => { if (paths.includes('dirty.txt')) throw new Error('Save dirty.txt before changing it.'); },
      acquireExternal: () => ({ release }),
    });
    try {
      await expect(nativeFileMutation('workspace-native-dirty', ['dirty.txt'], action)).rejects.toThrow('Save dirty.txt');
      expect(action).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled(); expect(isWorkspaceWriteHeld('workspace-native-dirty')).toBe(false);
    } finally { unregister(); }
  });

  it('holds mounted editor writes through an actual pending file request and releases them with refresh even on rejection', async () => {
    let settle!: (value: { path: string }) => void;
    const request = new Promise<{ path: string }>(resolve => { settle = resolve; }), release = vi.fn();
    const unregister = registerWorkspaceRewindGuard('workspace-native-request', {
      read: () => ({ dirtyPaths: [] }), acquire: () => ({ dirtyPaths: [], release }), readExternal: () => undefined, acquireExternal: () => ({ release }),
    });
    try {
      const pending = nativeFileMutation('workspace-native-request', ['file.txt'], () => request);
      expect(isWorkspaceWriteHeld('workspace-native-request')).toBe(true); expect(release).not.toHaveBeenCalled();
      settle({ path: 'file.txt' }); await pending;
      expect(isWorkspaceWriteHeld('workspace-native-request')).toBe(false); expect(release).toHaveBeenCalledWith({ refresh: true });
      await expect(nativeFileMutation('workspace-native-request', ['file.txt'], async () => { throw new Error('Native write rejected.'); })).rejects.toThrow('rejected');
      expect(isWorkspaceWriteHeld('workspace-native-request')).toBe(false); expect(release).toHaveBeenCalledTimes(2);
    } finally { unregister(); }
  });
});
