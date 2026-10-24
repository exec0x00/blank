import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';
import { GitService } from '../server/git';
import type { Workspace } from '../shared/types';

let directory: string, runtime: string, base: string, cookie: string;
let app: Awaited<ReturnType<typeof createApplication>>;
let workspace: Workspace;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-operational-page-http-'));
  runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-operational-page-runtime-'));
  const config = loadConfig({ DATA_DIR: directory, RUNTIME_DIR: runtime, NODE_ENV: 'test', WORKSPACE_PASSWORD: 'operational-pages-fixture',
    SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
  app = await createApplication(config);
  workspace = await app.ctx.workspaces.create({ name: 'Operational route fixture', initializeGit: true });
  await app.ctx.workspaces.writeFile(workspace.id, 'retained.txt', 'Native route fixture.');
  const git = new GitService(app.ctx); await git.stage(workspace.id, ['retained.txt']); await git.commit(workspace.id, 'Route fixture');
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const session = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1', Origin: base }, body: JSON.stringify({ password: config.password }) });
  expect(session.status).toBe(200); cookie = session.headers.get('set-cookie')!.split(';')[0];
});
afterEach(async () => {
  await app?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  if (runtime) await fs.rm(runtime, { recursive: true, force: true });
});
const request = (route: string, authenticated = true) => fetch(`${base}/api${route}`, { headers: authenticated ? { Cookie: cookie } : {} });

describe('operational pages in the composed authenticated application', () => {
  it('gates every page route and rejects malformed or excessive page inputs before native list work', async () => {
    const routes = ['/workspace-trash/page', '/workspace-deletions/page', `/workspaces/${workspace.id}/file-transfers/page`, `/workspaces/${workspace.id}/worktrees/page`];
    for (const route of routes) {
      expect((await request(route, false)).status).toBe(401);
      for (const query of ['limit=51', 'offset=-1', 'q=one&q=two', 'offset=10001', 'path=..%2Foutside']) {
        const response = await request(`${route}?${query}`);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'INVALID_OPERATIONAL_PAGE' });
      }
    }
    expect(await (await request('/workspace-trash/page')).json()).toMatchObject({ items: [], offset: 0, limit: 25, total: 0, hasMore: false });
    expect(await (await request('/workspace-deletions/page')).json()).toMatchObject({ items: [], total: 0 });
    expect(await (await request(`/workspaces/${workspace.id}/worktrees/page`)).json()).toMatchObject({ items: [], repository: { id: workspace.id }, sources: [expect.objectContaining({ id: workspace.id })] });
    // Existing internal/legacy array consumers retain their contracts.
    expect(await (await request('/workspace-trash')).json()).toEqual([]);
    expect(await (await request(`/workspaces/${workspace.id}/worktrees`)).json()).toEqual([]);
  });

  it('pages retained transfer failures through the route without deleting journals or retrying transfers', async () => {
    const saved = [];
    for (let index = 0; index < 6; index++) {
      const id = randomUUID(), createdAt = new Date(Date.now() - index * 60_000).toISOString();
      const record = { version: 1, id, workspaceId: workspace.id, kind: 'move', path: `source-${index}.txt`, newPath: `destination-${index}.txt`,
        phase: 'interrupted', interruptedPhase: 'removing', createdAt, updatedAt: createdAt, issue: 'Inspection is required before another action.' };
      await app.ctx.store.write(`file-transfer-${id}`, record); saved.push(record);
    }
    const first = await (await request(`/workspaces/${workspace.id}/file-transfers/page?limit=2`)).json();
    expect(first).toMatchObject({ offset: 0, limit: 2, total: 6, hasMore: true });
    expect(first.items.map((item: { id: string }) => item.id)).toEqual(saved.slice(0, 2).map(item => item.id));
    const later = await (await request(`/workspaces/${workspace.id}/file-transfers/page?limit=2&offset=4`)).json();
    expect(later.items.map((item: { id: string }) => item.id)).toEqual(saved.slice(4).map(item => item.id));
    const search = await (await request(`/workspaces/${workspace.id}/file-transfers/page?q=destination-5`)).json();
    expect(search.items).toEqual([expect.objectContaining({ id: saved[5].id, state: 'interrupted', phase: 'removing' })]);
    expect(await app.ctx.store.read(`file-transfer-${saved[5].id}`, null)).toEqual(saved[5]);
    expect(await fs.readFile(path.join(workspace.path, 'retained.txt'), 'utf8')).toBe('Native route fixture.');
  });
});
