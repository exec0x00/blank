import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { FilePagesService } from '../server/file-pages/service';
import type { FileSaveOptions } from '../server/file-pages/save';
import { shutdownFilePages } from '../server/file-pages';

export async function filePagesFixture(options: FileSaveOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-file-pages-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, WORKSPACE_PASSWORD: 'paged-file-tests-only',
    SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
  const store = new JsonStore(config.stateDir);
  const secrets = new SecretStore(store, config.encryptionKey);
  const workspaces = new WorkspaceService(config, store);
  await workspaces.initialize();
  const workspace = await workspaces.create({ name: 'Paged files' });
  const ctx: AppContext = { config, store, secrets, workspaces, events: new EventEmitter(), settings: async () => ({ ...defaultSettings }),
    saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  const service = new FilePagesService(ctx, options);
  return { directory, config, workspace, ctx, service, close: async () => {
    await shutdownFilePages(ctx);
    await fs.rm(directory, { recursive: true, force: true });
  } };
}

export type FilePagesFixture = Awaited<ReturnType<typeof filePagesFixture>>;

export async function repeatedFile(filename: string, size: number, line = 'bounded native file contents\r\n'): Promise<void> {
  const unit = Buffer.from(line);
  const bytes = Buffer.from(line.repeat(Math.ceil(64 * 1024 / unit.length)));
  const output = await fs.open(filename, 'wx');
  try {
    for (let offset = 0; offset < size;) {
      const length = Math.min(bytes.length, size - offset);
      const { bytesWritten } = await output.write(bytes, 0, length, offset);
      offset += bytesWritten;
    }
  } finally { await output.close(); }
}

/** Expected entire-file digest computed with a bounded buffer, including unseen bytes. */
export async function digestFile(filename: string, edit?: { start: number; end: number; replacement: string }): Promise<string> {
  const handle = await fs.open(filename, 'r');
  try {
    const size = (await handle.stat()).size;
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let inserted = false;
    for (let offset = 0; offset < size;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!bytesRead) throw new Error('Fixture source was truncated.');
      const bytes = buffer.subarray(0, bytesRead);
      if (!edit) hash.update(bytes);
      else {
        if (offset < edit.start) hash.update(bytes.subarray(0, Math.min(bytesRead, edit.start - offset)));
        if (!inserted && edit.start <= offset + bytesRead) { hash.update(edit.replacement); inserted = true; }
        if (offset + bytesRead > edit.end) hash.update(bytes.subarray(Math.max(0, edit.end - offset)));
      }
      offset += bytesRead;
    }
    if (edit && !inserted) hash.update(edit.replacement);
    return hash.digest('hex');
  } finally { await handle.close(); }
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
