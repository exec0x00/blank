import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { defaultSettings } from '../server/settings';
import { HttpError } from '../server/errors';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { CodexRuntimeStatus } from '../shared/codex-cli';
import type { ThreadSummary, Workspace } from '../shared/types';
import type { NativeFeatureDependencies } from '../server/codex-cli/features/common';
import { createNativeOrganizationRouter, nativeQueueEntryRevision, nativeQueueRevision,
  NATIVE_ORGANIZATION_QUEUE_LIMIT } from '../server/codex-cli/features/organization';
import { prepareCodexInput } from '../server/codex-cli/inputs';
import { getConversationFiles, shutdownConversationFiles } from '../server/conversation-files';
import { getImageAttachments } from '../server/agent/attachments';
import { shutdownUploads } from '../server/uploads';
import { acquireWorkspaceActivity, withWorkspaceRemoval } from '../server/worktrees/activity';

const THREAD = '01990000-0000-7000-8000-000000000001';
const PEER = '01990000-0000-7000-8000-000000000002';
const FOREIGN_THREAD = '01990000-0000-7000-8000-000000000003';
const PROJECT = '01990000-0000-7000-8000-000000000011';
const FOREIGN_PROJECT = '01990000-0000-7000-8000-000000000012';
const SECTION = '01990000-0000-7000-8000-000000000021';
const QUEUE = '01990000-0000-7000-8000-000000000031';
const calls: Array<{ method: string; params: any }> = [];
const handlers = new Map<string, (params: any) => unknown | Promise<unknown>>();
let directory: string, ctx: AppContext, workspace: Workspace, other: Workspace, bridge: CodexBridge;
let appServer: Server | undefined, origin: string, generation: string, activeTurns: number;
let deps: NativeFeatureDependencies;
const summaries = new Map<string, ThreadSummary>();
const nativeProjects = new Map<string, any>(), nativeThreads = new Map<string, any>();
const nativeSection = { id: SECTION, name: 'Shared', appearance: { icon: 'folder', color: 'neutral' } };
const project = (id: string, root: string) => ({ id, name: 'Native project', roots: [{ path: root }], metadata: { label: 'Exact native record' },
  position: 1, createdAt: 1_700_000_000, updatedAt: 1_700_000_001, recencyAt: null });
const nativeThread = (id: string) => ({ id, projectId: null, section: null, gitInfo: { sha: null, branch: 'main', originUrl: 'https://github.com/owner/project.git' },
  daybreakEnabled: null, status: { type: 'idle' } });

async function mount() {
  if (appServer) await new Promise<void>(resolve => appServer!.close(() => resolve()));
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api', createNativeOrganizationRouter(deps));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Unexpected error', code: error instanceof HttpError ? error.code : 'INVALID_INPUT' });
  });
  appServer = await new Promise<Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const address = appServer.address(); if (!address || typeof address === 'string') throw new Error('Missing owned fixture listener.');
  origin = `http://127.0.0.1:${address.port}/api`;
}
function request(route: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(origin + route, { method, headers: bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {} }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', value => { text += value; }); res.on('end', () => {
        resolve({ status: res.statusCode!, body: res.headers['content-type']?.includes('json') ? JSON.parse(text) : text });
      });
    }); req.on('error', reject); req.end(bytes);
  });
}
const projects = () => `/workspaces/${workspace.id}/codex/projects`;
const thread = (id = THREAD) => `/workspaces/${workspace.id}/codex/threads/${id}`;
const last = (method: string) => calls.filter(call => call.method === method).at(-1);

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-organization-test-'));
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'), NODE_ENV: 'test',
    WORKSPACE_PASSWORD: 'native-organization-fixture-password', SESSION_SECRET: 'native-organization-session-'.repeat(3), ENCRYPTION_KEY: 'native-organization-key-'.repeat(3) });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store); await workspaces.initialize();
  workspace = (await workspaces.list())[0]; other = await workspaces.create({ name: 'Other workspace' });
  await fs.mkdir(path.join(workspace.path, 'folder'));
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: async () => ({ ...defaultSettings }), saveSettings: async patch => ({ ...defaultSettings, ...patch }),
    providerKey: async () => { throw new Error('Organization routes do not use provider credentials.'); } };
  calls.length = 0; handlers.clear(); summaries.clear(); nativeProjects.clear(); nativeThreads.clear(); generation = 'native-fixture-generation'; activeTurns = 0;
  for (const [id, workspaceId] of [[THREAD, workspace.id], [PEER, workspace.id], [FOREIGN_THREAD, other.id]]) {
    summaries.set(id, { id, workspaceId, backend: 'codex-cli', title: id, createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z', status: 'idle' });
    nativeThreads.set(id, nativeThread(id));
  }
  nativeProjects.set(PROJECT, project(PROJECT, workspace.path)); nativeProjects.set(FOREIGN_PROJECT, project(FOREIGN_PROJECT, other.path));
  bridge = {
    generation: () => generation, supports: () => true,
    status: () => ({ state: 'ready', activeTurns, backend: 'codex-cli' } as CodexRuntimeStatus),
    request: async <T>(method: string, params?: unknown): Promise<T> => {
      calls.push({ method, params: structuredClone(params) }); const input = params as any;
      if (handlers.has(method)) return await handlers.get(method)!(input) as T;
      if (method === 'project/list') return { data: [...nativeProjects.values()], nextCursor: null } as T;
      if (method === 'project/read') { const found = nativeProjects.get(input.projectId); if (!found) throw new HttpError(404, 'Native project missing.', 'CODEX_RPC_REJECTED'); return { project: structuredClone(found) } as T; }
      if (method === 'project/create' || method === 'project/import') return { project: { ...project(PROJECT, workspace.path), ...input, metadata: input.metadata ?? {}, id: PROJECT } } as T;
      if (method === 'project/update') {
        const found = nativeProjects.get(input.projectId); Object.assign(found, input); delete found.projectId; return { project: structuredClone(found) } as T;
      }
      if (method === 'threadSection/list') return { data: [nativeSection], nextCursor: null } as T;
      if (method === 'threadSection/create' || method === 'threadSection/update') return { section: { ...nativeSection, ...input } } as T;
      if (method === 'thread/read') { const found = nativeThreads.get(input.threadId); return { thread: structuredClone(found) } as T; }
      if (method === 'thread/metadata/update') {
        const found = nativeThreads.get(input.threadId);
        if (input.projectId !== undefined) found.projectId = input.projectId || null;
        if (input.gitInfo) found.gitInfo = { ...found.gitInfo, ...input.gitInfo };
        if (input.daybreakEnabled !== undefined) found.daybreakEnabled = input.daybreakEnabled;
        return { thread: structuredClone(found) } as T;
      }
      if (method === 'memory/status') return { v2ConsolidatedThreads: 7, v2Ready: input.minConsolidatedThreads <= 7 } as T;
      if (method === 'thread/queue/list') return { data: [], nextCursor: null } as T;
      return {} as T;
    }, respond: () => undefined, rejectRequest: () => undefined,
    onNotification: () => () => undefined, onRequest: () => () => undefined, onConnection: () => () => undefined,
  };
  deps = { ctx, bridge,
    authorizeThread: vi.fn(async (workspaceId, threadId) => {
      const summary = summaries.get(threadId);
      if (!summary || summary.workspaceId !== workspaceId) throw new HttpError(404, 'Conversation not found in this workspace.', 'THREAD_NOT_FOUND');
      return summary;
    }), updateQueuedInput: vi.fn(async () => ({ saved: true })), reorderQueuedInput: vi.fn(async () => ({ reordered: true })) };
  await mount();
});
afterEach(async () => {
  if (appServer) { appServer.closeAllConnections(); await new Promise<void>(resolve => appServer!.close(() => resolve())); appServer = undefined; }
  await getImageAttachments(ctx).close(); await shutdownConversationFiles(ctx); await shutdownUploads(ctx);
  await ctx.workspaces.closeFileTrashPages(); await ctx.workspaces.closeTrashCleanup(); await ctx.store.flush(); await fs.rm(directory, { recursive: true, force: true });
});

describe('native organization workspace authority', () => {
  it('creates a native record using verified real folders and the supplied idempotency key', async () => {
    const idempotencyKey = randomUUID();
    const result = await request(projects(), 'POST', { name: 'My project', roots: ['folder'], metadata: { category: 'test' }, idempotencyKey });
    expect(result.status).toBe(201); expect(result.body.project.id).toBe(PROJECT); expect(result.body.workspaceRoots).toEqual(['folder']);
    expect(last('project/create')?.params).toEqual({ name: 'My project', roots: [{ path: path.join(workspace.path, 'folder') }], metadata: { category: 'test' }, idempotencyKey });
    expect(calls.some(call => /thread\/(start|resume|inject_items)|turn\/start/.test(call.method))).toBe(false);
  });

  it('rejects traversal, symlink escape, files, duplicate real roots, and removal admission before native mutations', async () => {
    await fs.symlink(other.path, path.join(workspace.path, 'escape')); await fs.writeFile(path.join(workspace.path, 'file.txt'), 'fixture');
    for (const roots of [['../outside'], [other.path], ['escape'], ['file.txt'], ['folder', './folder']]) {
      const response = await request(projects(), 'POST', { name: 'Unsafe', roots, idempotencyKey: randomUUID() });
      expect([400, 403]).toContain(response.status);
    }
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspace.id, async () => {
      expect((await request(projects(), 'POST', { name: 'Busy', roots: ['.'], idempotencyKey: randomUUID() })).status).toBe(409);
    });
    expect(last('project/create')).toBeUndefined();
  });

  it('filters a bounded native page by every actual root and keeps the native cursor', async () => {
    const mixed = { ...project('mixed-project', workspace.path), roots: [{ path: workspace.path }, { path: other.path }] };
    handlers.set('project/list', () => ({ data: [nativeProjects.get(PROJECT), nativeProjects.get(FOREIGN_PROJECT), mixed], nextCursor: 'native-next-page' }));
    const result = await request(projects() + '?limit=3');
    expect(result.status).toBe(200); expect(result.body.data.map((item: any) => item.project.id)).toEqual([PROJECT]);
    expect(result.body.nextCursor).toBe('native-next-page'); expect(result.body.filteredCount).toBe(2);
    expect((await request(projects() + '/' + FOREIGN_PROJECT)).status).toBe(404);
    expect((await request(projects() + '?limit=80')).status).toBe(400);
  });

  it('requires current project revisions and authorizes the native order anchor', async () => {
    const read = await request(projects() + '/' + PROJECT);
    const stale = await request(projects() + '/' + PROJECT, 'PATCH', { name: 'Stale', expectedRevision: '0'.repeat(64) });
    expect(stale.status).toBe(409); expect(last('project/update')).toBeUndefined();
    const denied = await request(projects() + '/' + PROJECT + '/move', 'POST', { beforeProjectId: FOREIGN_PROJECT, expectedRevision: read.body.revision });
    expect(denied.status).toBe(404); expect(last('project/move')).toBeUndefined();
    const result = await request(projects() + '/' + PROJECT, 'PATCH', { name: 'Renamed', roots: ['folder'], expectedRevision: read.body.revision });
    expect(result.status).toBe(200); expect(result.body.project.id).toBe(PROJECT); expect(result.body.project.metadata).toEqual({ label: 'Exact native record' });
    expect((await request(projects() + '/' + PROJECT, 'DELETE', { expectedRevision: result.body.revision })).status).toBe(400);
    const moved = await request(projects() + '/' + PROJECT + '/move', 'POST', { beforeProjectId: null, expectedRevision: result.body.revision });
    expect(moved.status).toBe(200); expect(last('project/move')?.params).toEqual({ projectId: PROJECT, beforeProjectId: null });
    expect((await request(projects() + '/' + PROJECT, 'DELETE', { expectedRevision: result.body.revision, confirmation: 'delete-native-project' })).status).toBe(200);
  });

  it('imports only the explicitly selected authorized native threads with confirmation', async () => {
    const draft = { name: 'Imported', roots: ['.'], threads: [THREAD, PEER], idempotencyKey: randomUUID(), confirmation: 'reassign-selected-native-threads' };
    expect((await request(projects() + '/import', 'POST', { ...draft, threads: [THREAD, FOREIGN_THREAD] })).status).toBe(404);
    expect((await request(projects() + '/import', 'POST', { ...draft, confirmation: undefined })).status).toBe(400);
    expect(last('project/import')).toBeUndefined();
    expect((await request(projects() + '/import', 'POST', draft)).status).toBe(201);
    expect(last('project/import')?.params.threads).toEqual([THREAD, PEER]);
    expect(last('project/import')?.params).not.toHaveProperty('confirmation');
    expect(calls.every(call => call.method === 'project/import')).toBe(true);
  });

  it('refuses a workspace/native-generation change before dispatch', async () => {
    const read = await request(projects() + '/' + PROJECT);
    handlers.set('project/read', () => { generation = 'replacement-generation'; return { project: nativeProjects.get(PROJECT) }; });
    expect((await request(projects() + '/' + PROJECT, 'PATCH', { name: 'Late', expectedRevision: read.body.revision })).status).toBe(409);
    expect(last('project/update')).toBeUndefined();
  });
});

describe('native shared sections and conversation metadata', () => {
  it('keeps sections global and preserves omitted appearance in native update parameters', async () => {
    const page = await request('/codex/thread-sections?limit=10');
    expect(page.status).toBe(200); expect(page.body.scope).toBe('all-native-workspaces'); expect(page.body.data[0].id).toBe(SECTION);
    expect((await request('/codex/thread-sections/' + SECTION, 'PATCH', { name: 'Renamed' })).status).toBe(200);
    expect(last('threadSection/update')?.params).toEqual({ sectionId: SECTION, name: 'Renamed' });
    expect((await request('/codex/thread-sections', 'POST', { name: 'New', appearance: null })).status).toBe(201);
    expect((await request('/codex/thread-sections/' + SECTION, 'DELETE', {})).status).toBe(400);
    expect(last('threadSection/delete')).toBeUndefined();
    expect((await request('/codex/thread-sections/' + SECTION, 'DELETE', { confirmation: 'delete-section-across-all-native-workspaces' })).status).toBe(200);
    expect((await request(`/workspaces/${workspace.id}/codex/thread-sections`)).status).toBe(404);
  });

  it('patches only explicit native metadata and preserves null/empty assignment semantics', async () => {
    const read = await request(thread() + '/organization'); expect(read.status).toBe(200);
    expect(read.body.memoryModeReadable).toBe(false); expect(read.body).not.toHaveProperty('pinned');
    expect((await request(thread() + '/metadata', 'PATCH', { expectedRevision: read.body.revision, isPinned: true })).status).toBe(400);
    expect((await request(thread() + '/metadata', 'PATCH', { expectedRevision: read.body.revision, projectId: FOREIGN_PROJECT })).status).toBe(404);
    expect((await request(thread() + '/metadata', 'PATCH', { expectedRevision: read.body.revision, gitInfo: { originUrl: 'https://fixture-secret@github.com/owner/repo.git' } })).status).toBe(400);
    expect(last('thread/metadata/update')).toBeUndefined();
    const updated = await request(thread() + '/metadata', 'PATCH', { expectedRevision: read.body.revision, projectId: PROJECT, gitInfo: { branch: null }, daybreakEnabled: false });
    expect(updated.status).toBe(200); expect(last('thread/metadata/update')?.params).toEqual({ threadId: THREAD, projectId: PROJECT, gitInfo: { branch: null }, daybreakEnabled: false });
    expect((await request(thread() + '/metadata', 'PATCH', { expectedRevision: updated.body.revision, projectId: '' })).status).toBe(200);
    expect(last('thread/metadata/update')?.params.projectId).toBe('');
    nativeThreads.get(THREAD).gitInfo.originUrl = 'https://fixture-secret@github.com/owner/repo.git';
    const sanitized = await request(thread() + '/organization');
    expect(JSON.stringify(sanitized.body)).not.toContain('fixture-secret'); expect(sanitized.body.gitInfo.originUrl).toBeNull();
  });

  it('checks thread workspace ownership and native section membership before moving', async () => {
    const read = await request(thread() + '/organization');
    expect((await request(thread(FOREIGN_THREAD) + '/organization')).status).toBe(404);
    expect((await request(thread() + '/section', 'POST', { sectionId: SECTION, beforeThreadId: PEER, expectedRevision: read.body.revision })).status).toBe(409);
    nativeThreads.get(PEER).section = nativeSection;
    const result = await request(thread() + '/section', 'POST', { sectionId: SECTION, beforeThreadId: PEER, expectedRevision: read.body.revision });
    expect(result.status).toBe(200); expect(last('thread/section/move')?.params).toEqual({ threadId: THREAD, sectionId: SECTION, beforeThreadId: PEER });
  });
});

describe('explicit native memory scope and outcomes', () => {
  it('requires idle native state and exact confirmation for global maintenance', async () => {
    const read = await request('/codex/memory?minConsolidatedThreads=6');
    expect(read.body).toMatchObject({ scope: 'all-native-workspaces', v2ConsolidatedThreads: 7, v2Ready: true, minConsolidatedThreads: 6 });
    expect((await request('/codex/memory/reset', 'POST', {})).status).toBe(400);
    activeTurns = 1;
    expect((await request('/codex/memory/reset', 'POST', { confirmation: 'reset-memory-across-all-native-workspaces' })).status).toBe(409);
    activeTurns = 0; const release = acquireWorkspaceActivity(ctx.config.workspacesDir, other.id, 'agent');
    try { expect((await request('/codex/memory/reset', 'POST', { confirmation: 'reset-memory-across-all-native-workspaces' })).status).toBe(409); }
    finally { release(); }
    expect(last('memory/reset')).toBeUndefined();
    expect((await request('/codex/memory/reset', 'POST', { confirmation: 'reset-memory-across-all-native-workspaces' })).status).toBe(200);
    expect(last('memory/reset')?.params).toBeUndefined();
    const compress = await request('/codex/rollouts/compress', 'POST', { confirmation: 'compress-rollouts-across-all-native-workspaces' });
    expect(compress.status).toBe(202); expect(compress.body).toMatchObject({ accepted: true, completed: false, scope: 'all-native-workspaces' });
  });

  it('changes only an idle conversation memory mode and reports native method rejection honestly', async () => {
    nativeThreads.get(THREAD).status = { type: 'active' };
    const body = { mode: 'disabled', confirmation: 'change-thread-memory-mode' };
    expect((await request(thread() + '/memory-mode', 'POST', body)).status).toBe(409); expect(last('thread/memoryMode/set')).toBeUndefined();
    nativeThreads.get(THREAD).status = { type: 'notLoaded' };
    expect((await request(thread() + '/memory-mode', 'POST', body)).status).toBe(200);
    expect(last('thread/memoryMode/set')?.params).toEqual({ threadId: THREAD, mode: 'disabled' });
    handlers.set('project/list', () => { throw new HttpError(501, 'This native store does not implement project/list.', 'CODEX_METHOD_UNAVAILABLE'); });
    const unavailable = await request(projects());
    expect(unavailable.status).toBe(501); expect(unavailable.body.code).toBe('CODEX_METHOD_UNAVAILABLE'); expect(unavailable.body).not.toHaveProperty('data');
  });

  it('does not turn a malformed native maintenance response into a success message', async () => {
    handlers.set('rollout/compress', () => null);
    const result = await request('/codex/rollouts/compress', 'POST', { confirmation: 'compress-rollouts-across-all-native-workspaces' });
    expect(result.status).toBe(502); expect(result.body).not.toHaveProperty('accepted');
  });
});

describe('bounded native queue editing boundary', () => {
  it('projects real attachment bindings without exposing paths or allowing replacement native inputs', async () => {
    const bytes = Buffer.from('Owned attachment bytes.');
    const file = await getConversationFiles(ctx).storage.commit({ id: `file_${randomUUID().replaceAll('-', '')}`, workspaceId: workspace.id,
      name: 'keep.txt', mimeType: 'text/plain', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: new Date().toISOString() }, bytes);
    const prepared = await prepareCodexInput(ctx, workspace.id, THREAD, { prompt: 'Keep my file.', fileAttachments: [{ id: file.id, sha256: file.sha256 }] });
    await prepared.acknowledge();
    const queued = { id: QUEUE, clientUserMessageId: prepared.clientUserMessageId, input: prepared.input };
    handlers.set('thread/queue/list', () => ({ data: [queued], nextCursor: null }));
    const read = await request(thread() + '/queue-edit');
    expect(read.status).toBe(200); expect(read.body.items[0]).toMatchObject({ id: QUEUE, prompt: 'Keep my file.', attachmentNames: ['keep.txt'], editable: true });
    expect(JSON.stringify(read.body)).not.toContain(ctx.config.stateDir); expect(JSON.stringify(read.body)).not.toContain('Owned attachment bytes.');
    expect(read.body.items[0].revision).toBe(nativeQueueEntryRevision(THREAD, generation, queued));
    expect(read.body.revision).toBe(nativeQueueRevision(THREAD, generation, read.body.items));
    expect((await request(thread() + '/queue-edit/' + QUEUE, 'PATCH', { prompt: 'Changed text.', expectedRevision: read.body.items[0].revision, input: [] })).status).toBe(400);
    const saved = await request(thread() + '/queue-edit/' + QUEUE, 'PATCH', { prompt: 'Changed text.', expectedRevision: read.body.items[0].revision });
    expect(saved.status).toBe(200); expect(deps.updateQueuedInput).toHaveBeenCalledWith(THREAD, QUEUE, { prompt: 'Changed text.', expectedRevision: read.body.items[0].revision });
    expect(queued.input).toEqual(prepared.input); expect(calls.every(call => call.method === 'thread/queue/list')).toBe(true);
  });

  it('bounds queue scans and only supplies an order revision for a complete first snapshot', async () => {
    handlers.set('thread/queue/list', input => {
      const index = Number(input.cursor ?? 0);
      return { data: [{ id: `queued-${index}`, clientUserMessageId: `client-${index}`, input: [{ type: 'text', text: `Message ${index}`, text_elements: [] }] }],
        nextCursor: index < NATIVE_ORGANIZATION_QUEUE_LIMIT ? String(index + 1) : null };
    });
    const page = await request(thread() + '/queue-edit');
    expect(page.status).toBe(200); expect(page.body.items).toHaveLength(NATIVE_ORGANIZATION_QUEUE_LIMIT);
    expect(page.body.nextCursor).toBe(String(NATIVE_ORGANIZATION_QUEUE_LIMIT)); expect(page.body.revision).toBeNull();
    expect(calls).toHaveLength(NATIVE_ORGANIZATION_QUEUE_LIMIT); expect(calls.every(call => call.params.limit === 1)).toBe(true);
    const tail = await request(thread() + '/queue-edit?cursor=' + page.body.nextCursor);
    expect(tail.body.items).toHaveLength(1); expect(tail.body.nextCursor).toBeNull(); expect(tail.body.revision).toBeNull(); expect(tail.body.cursor).toBe(page.body.nextCursor);
    const edited = await request(thread() + '/queue-edit/' + tail.body.items[0].id, 'PATCH', {
      prompt: 'Later page edit', expectedRevision: tail.body.items[0].revision, cursor: tail.body.cursor,
    });
    expect(edited.status).toBe(200); expect(deps.updateQueuedInput).toHaveBeenCalledWith(THREAD, tail.body.items[0].id, {
      prompt: 'Later page edit', expectedRevision: tail.body.items[0].revision, cursor: tail.body.cursor,
    });
    expect((await request(thread() + '/queue-edit/reorder', 'POST', { queuedSubmissionIds: ['one', 'one'], expectedRevision: '0'.repeat(64) })).status).toBe(400);
    expect(deps.reorderQueuedInput).not.toHaveBeenCalled();
  });

  it('keeps queue tokens stable for equivalent native JSON and sensitive to attachments, order and generation', () => {
    const entry = { id: QUEUE, clientUserMessageId: 'client', input: [{ type: 'text', text: 'Original', text_elements: [] }, { type: 'localImage', path: '/owned/native/image.png' }] };
    const first = nativeQueueEntryRevision(THREAD, generation, entry);
    expect(nativeQueueEntryRevision(THREAD, generation, { ...entry, input: [{ text_elements: [], text: 'Original', type: 'text' }, { path: '/owned/native/image.png', type: 'localImage' }] })).toBe(first);
    expect(nativeQueueEntryRevision(THREAD, generation + '-new', entry)).not.toBe(first);
    expect(nativeQueueEntryRevision(THREAD, generation, { ...entry, input: entry.input.slice(0, 1) })).not.toBe(first);
    const order = [{ id: QUEUE, revision: first }, { id: 'other', revision: '0'.repeat(64) }];
    expect(nativeQueueRevision(THREAD, generation, order)).not.toBe(nativeQueueRevision(THREAD, generation, [...order].reverse()));
  });
});
