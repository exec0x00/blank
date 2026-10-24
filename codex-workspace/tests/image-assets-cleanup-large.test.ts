import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { ImageAttachmentService, cleanupWorkspaceImageAttachments } from '../server/agent/attachments';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
let directory: string | undefined, service: ImageAttachmentService | undefined;
afterEach(async () => { await service?.close(); if (directory) await fs.rm(directory, { recursive: true, force: true }); });

it('permanently clears more than 20,000 real retained-image leaves with bounded traversal', async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'codex-large-image-cleanup-'));
  const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'large-image-test-only', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64), NODE_ENV: 'test' });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store); await workspaces.initialize();
  const workspace = await workspaces.create({ name: 'Many retained images' });
  const ctx = { config, store, workspaces, events: new EventEmitter() } as AppContext;
  service = new ImageAttachmentService(ctx, { cleanupIntervalMs: 0 });
  const first = await service.upload(workspace.id, { name: 'sample.png', bytes: png });
  await service.resolve(workspace.id, [{ id: first.id, sha256: first.sha256 }], { retain: true });
  const root = path.join(config.stateDir, 'image-attachments-v1', createHash('sha256').update(workspace.id).digest('hex'));
  const record = JSON.parse(await fs.readFile(path.join(root, `${first.id}.json`), 'utf8'));
  // The normal admission policy has no retained-image count quota. These are
  // real, valid independently owned records/bytes, not a lowered test-only cap.
  for (let offset = 0; offset < 10_000; offset += 64) {
    await Promise.all(Array.from({ length: Math.min(64, 10_000 - offset) }, async () => {
      const id = `att_${randomUUID().replaceAll('-', '')}`;
      await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify({ ...record, id }), { flag: 'wx' });
      await fs.writeFile(path.join(root, `${id}.image`), png, { flag: 'wx' });
    }));
  }
  expect((await fs.readdir(root)).length).toBe(20_002);
  const result = await cleanupWorkspaceImageAttachments(config, workspace.id);
  expect(result).toMatchObject({ attachmentsRemoved: 10_001, filesRemoved: 20_002, permanentlyFenced: true });
  expect(await fs.readdir(root)).toEqual([]);
}, 120_000);
