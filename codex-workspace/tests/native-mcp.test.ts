import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import type { AppContext } from '../server/context';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { NativeNotification, NativeServerRequest, RpcId } from '../server/codex-cli/rpc';
import type { NativeFeatureDependencies } from '../server/codex-cli/features/common';
import type { ThreadSummary } from '../shared/types';
import { HttpError } from '../server/errors';
import { saveMcpEnvironment } from '../server/codex-cli/mcp-environment';
import { createNativeMcpRouter, matchesResourceTemplate, NativeMcpService } from '../server/codex-cli/features/mcp';
import { assertMcpValue, mcpForm, safeMcpUrl, validateMcpField } from '../server/codex-cli/features/mcp-schema';
import { mcpContent } from '../server/codex-cli/features/mcp-content';

const THREAD = '01990000-0000-7000-8000-000000000001', PEER = '01990000-0000-7000-8000-000000000002';
const TURN = '01990000-0000-7000-8000-000000000101';
const scope = { workspaceId: 'owned-workspace', threadId: THREAD };
const simpleSchema = { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 80 }, count: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['query'], additionalProperties: false };
const elicitation = (extra: Record<string, unknown> = {}) => ({ threadId: THREAD, turnId: TURN, serverName: 'owned-mcp', mode: 'form', message: 'Choose inputs for this server.', requestedSchema: simpleSchema, _meta: null, ...extra });
const row = (extra: Record<string, unknown> = {}) => ({ name: 'owned-mcp', runtimeStatus: 'connected', pluginId: null, httpOrigin: 'https://mcp.example', serverInfo: null, serverCapabilities: {},
  tools: { search: { name: 'search', title: 'Search documents', description: 'Search the server documents.', inputSchema: simpleSchema, annotations: { readOnlyHint: true } } }, toolsError: null,
  resources: [{ name: 'Guide', uri: 'docs://guide', mimeType: 'text/plain' }], resourceTemplates: [{ name: 'Document', uriTemplate: 'docs://documents/{id}' }], authStatus: 'notLoggedIn', ...extra });

class McpFixture implements CodexBridge {
  current: string | null = 'generation-one';
  supported = new Set<string>();
  unavailable = new Set<string>();
  calls: Array<{ method: string; params: unknown }> = [];
  replies: Array<{ id: RpcId; generation: string; result: unknown }> = [];
  rejections: Array<{ id: RpcId; generation: string }> = [];
  handlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
  owners = new Map<string, (message: NativeServerRequest, generation: string) => void | Promise<void>>();
  pending = new Set<RpcId>();
  notifications = new Set<(message: NativeNotification, generation: string) => void>();
  connections = new Set<(state: 'ready' | 'closed', generation: string) => void>();
  generic = new Set<(message: NativeServerRequest, generation: string) => void>();
  leases = 0;
  trackedId: RpcId = 734;
  trackedResult: Promise<unknown> | undefined;
  generation() { return this.current; }
  supports(method: string) { return !this.unavailable.has(method); }
  status(): ReturnType<CodexBridge['status']> { return { backend: 'codex-cli', state: this.current ? 'ready' : 'stopped', version: '0.159.2', installedVersion: '0.159.2', startedAt: null, updatedAt: '2026-09-30T00:00:00Z', canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } }; }
  async request<T>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params: structuredClone(params) });
    if (!this.current) throw new HttpError(503, 'Fixture connection closed.');
    const override = this.handlers.get(method); if (override) return await override((params ?? {}) as Record<string, unknown>) as T;
    const defaults: Record<string, unknown> = {
      'config/read': { config: { mcp_oauth_credentials_store: 'keyring', auth_keyring_backend: 'direct' }, origins: {}, layers: null },
      'mcpServerStatus/list': { data: [row()], nextCursor: null },
      'mcpServer/oauth/login': { authorizationUrl: 'https://auth.example/authorize?client_id=owned&state=opaque-flow' },
      'mcpServer/tool/call': { content: [{ type: 'text', text: 'Tool completed.' }] },
      'mcpServer/resource/read': { contents: [{ uri: 'docs://guide', text: 'The guide content.' }], originCallId: null },
      'userVerification/status': { credentialId: null, unavailableReason: 'providerUnavailable', unavailableMessage: 'private diagnostic must not escape' },
      'userVerification/enroll': { credentialId: 'private-credential-id', algorithm: 'ES256', publicKey: 'private-enrollment-material' },
      'userVerification/verify': { proof: { credentialId: 'private-credential-id', signature: 'privateSignatureData' } },
    };
    return (defaults[method] ?? {}) as T;
  }
  async requestTracked<T>(method: string, params?: unknown) {
    this.calls.push({ method, params: structuredClone(params) });
    return { id: this.trackedId, generation: this.current!, result: (this.trackedResult ?? Promise.resolve({ proof: { credentialId: 'private-credential-id', signature: 'privateSignatureData' } })) as Promise<T> };
  }
  respond(id: RpcId, result: unknown, generation: string) {
    if (generation !== this.current || !this.pending.delete(id)) throw new HttpError(409, 'Stale callback.');
    this.replies.push({ id, generation, result: structuredClone(result) });
  }
  rejectRequest(id: RpcId, _message: string, generation: string) { if (generation === this.current) { this.pending.delete(id); this.rejections.push({ id, generation }); } }
  registerServerRequestHandler(method: string, handler: (message: NativeServerRequest, generation: string) => void | Promise<void>) {
    if (this.owners.has(method)) throw new Error('Duplicate callback owner.');
    this.owners.set(method, handler); return () => this.owners.delete(method);
  }
  acquireActivity(generation: string) { if (generation !== this.current) throw new HttpError(409, 'Stale activity.'); this.leases++; let done = false; return () => { if (!done) { done = true; this.leases--; } }; }
  onNotification(listener: (message: NativeNotification, generation: string) => void) { this.notifications.add(listener); return () => this.notifications.delete(listener); }
  onConnection(listener: (state: 'ready' | 'closed', generation: string) => void) { this.connections.add(listener); return () => this.connections.delete(listener); }
  onRequest(listener: (message: NativeServerRequest, generation: string) => void) { this.generic.add(listener); return () => this.generic.delete(listener); }
  async callback(id: RpcId, params = elicitation(), generation = this.current!) {
    this.pending.add(id); const message = { id, method: 'mcpServer/elicitation/request', params };
    const owner = this.owners.get(message.method); if (owner) await owner(message, generation); else for (const listener of this.generic) listener(message, generation);
  }
  notify(method: string, params: Record<string, unknown>, generation = this.current!) { for (const listener of this.notifications) listener({ method, params }, generation); }
  disconnect() { const previous = this.current!; this.current = null; this.pending.clear(); for (const listener of this.connections) listener('closed', previous); }
}

let bridge: McpFixture, service: NativeMcpService, deps: NativeFeatureDependencies, secrets: Map<string, string>;
beforeEach(() => {
  bridge = new McpFixture(); secrets = new Map();
  const ctx = { workspaces: { getAvailable: vi.fn(async (id: string) => { if (id !== scope.workspaceId && id !== 'other-workspace') throw new HttpError(404, 'Missing workspace.'); return { id, rootPath: '/fixture/owned' }; }) },
    secrets: { get: vi.fn(async (key: string) => secrets.get(key)), set: vi.fn(async (key: string, value: string) => { secrets.set(key, value); }) },
    store: { write: vi.fn(() => { throw new Error('MCP must not persist requests, proofs, or plaintext secrets.'); }) }, config: { dataDir: '/fixture' } } as unknown as AppContext;
  const authorizeThread = vi.fn(async (workspaceId: string, threadId: string) => {
    if (workspaceId !== scope.workspaceId || ![THREAD, PEER].includes(threadId)) throw new HttpError(404, 'Unauthorized native conversation.');
    return { id: threadId, workspaceId, backend: 'codex-cli' } as ThreadSummary;
  });
  deps = { ctx, bridge, authorizeThread, threadSummary: async id => authorizeThread(scope.workspaceId, id) };
  service = new NativeMcpService(deps);
});
afterEach(async () => { await service.close(); vi.useRealTimers(); });
async function selected(hosted = false) {
  if (hosted) bridge.handlers.set('mcpServerStatus/list', () => ({ data: [row({ name: 'codex_apps' })], nextCursor: null }));
  const inventory = await service.inventory(scope); const server = inventory.servers[0]; const catalog = await service.catalog(scope, server.id, 'tools'); return { server, tool: catalog.tools[0] };
}
async function requestId() { return (await service.state(scope)).requests[0].id; }

describe('native MCP catalog and concrete native actions', () => {
  it('does not start native discovery when reading presentation state', async () => {
    const state = await service.state(scope);
    expect(state.connected).toBe(true); expect(state.requests).toEqual([]); expect(bridge.calls).toEqual([]);
  });
  it('uses native full inventory and paginates without exposing raw tool schemas or metadata', async () => {
    bridge.handlers.set('mcpServerStatus/list', () => ({ data: [row({ tools: Object.fromEntries(Array.from({ length: 19 }, (_, index) => [`tool${index}`, { name: `tool${index}`, inputSchema: simpleSchema, _meta: { password: 'private' } }])) })], nextCursor: 'opaque-native-cursor' }));
    const inventory = await service.inventory(scope, 'prior-cursor'), first = await service.catalog(scope, inventory.servers[0].id, 'tools');
    expect(bridge.calls[0]).toEqual({ method: 'mcpServerStatus/list', params: { threadId: THREAD, cursor: 'prior-cursor', limit: 12, detail: 'full' } });
    expect(first.tools).toHaveLength(16); expect(first.nextOffset).toBe(16);
    expect((await service.catalog(scope, inventory.servers[0].id, 'tools', 16)).tools).toHaveLength(3);
    expect(JSON.stringify(first)).not.toContain('inputSchema'); expect(JSON.stringify(first)).not.toContain('private');
  });
  it('requires workspace and native thread authority for catalog handles', async () => {
    const { server } = await selected();
    await expect(service.catalog({ workspaceId: 'other-workspace', threadId: THREAD }, server.id, 'tools')).rejects.toMatchObject({ status: 404 });
    await expect(service.catalog({ workspaceId: scope.workspaceId, threadId: PEER }, server.id, 'tools')).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
    bridge.disconnect(); bridge.current = 'generation-two';
    await expect(service.catalog(scope, server.id, 'tools')).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
  });
  it('calls only the catalog-selected tool with validated exact inputs', async () => {
    const { server, tool } = await selected();
    const result = await service.tool(scope, { serverId: server.id, toolId: tool.id, arguments: { query: 'example', count: 2 } });
    expect(bridge.calls.at(-1)).toEqual({ method: 'mcpServer/tool/call', params: { threadId: THREAD, server: 'owned-mcp', tool: 'search', arguments: { query: 'example', count: 2 } } });
    expect(result.content[0]).toMatchObject({ kind: 'text', text: 'Tool completed.' });
    const count = bridge.calls.length;
    for (const args of [{ query: 'x' }, { query: 'valid', count: '2' }, { query: 'valid', count: 20 }, { query: 'valid', method: 'command/exec' }]) await expect(service.tool(scope, { serverId: server.id, toolId: tool.id, arguments: args })).rejects.toMatchObject({ status: 400 });
    await expect(service.tool(scope, { serverId: server.id, toolId: 'search', arguments: { query: 'ok' } })).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
    expect(bridge.calls).toHaveLength(count);
  });
  it('rejects unknown schema constraints before issuing a tool call', async () => {
    bridge.handlers.set('mcpServerStatus/list', () => ({ data: [row({ tools: { restricted: { name: 'restricted', inputSchema: { type: 'object', properties: { text: { type: 'string', pattern: '^(a+)+$' } } } } } })], nextCursor: null }));
    const { server, tool } = await selected(); expect(tool.form.field).toBeNull();
    await expect(service.tool(scope, { serverId: server.id, toolId: tool.id, arguments: { text: 'a' } })).rejects.toMatchObject({ status: 422 });
    expect(bridge.calls.some(call => call.method === 'mcpServer/tool/call')).toBe(false);
  });
  it('reads actual discovered resources and validates template addresses', async () => {
    const { server } = await selected(), catalog = await service.catalog(scope, server.id, 'resources');
    await service.resource(scope, { serverId: server.id, resourceId: catalog.resources[0].id });
    expect(bridge.calls.at(-1)).toEqual({ method: 'mcpServer/resource/read', params: { threadId: THREAD, server: 'owned-mcp', uri: 'docs://guide' } });
    await expect(service.resource(scope, { serverId: server.id, resourceId: catalog.resources[1].id, uri: 'other://documents/secret' })).rejects.toMatchObject({ status: 400 });
    await service.resource(scope, { serverId: server.id, resourceId: catalog.resources[1].id, uri: 'docs://documents/readme' });
    expect(bridge.calls.at(-1)?.params).toMatchObject({ uri: 'docs://documents/readme' });
  });
  it('reloads native saved configuration without creating a substitute config', async () => {
    const { server } = await selected(); await service.reload(scope);
    expect(bridge.calls.at(-1)).toEqual({ method: 'config/mcpServer/reload', params: undefined });
    await expect(service.catalog(scope, server.id, 'tools')).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
    expect(deps.ctx.store.write).not.toHaveBeenCalled();
  });
  it('honors live method availability without probing a provider', async () => {
    bridge.unavailable.add('mcpServerStatus/list');
    await expect(service.inventory(scope)).rejects.toMatchObject({ status: 501 });
    expect(bridge.calls).toEqual([]);
  });
});

describe('native MCP elicitation callbacks', () => {
  it('owns exactly one callback, exposes an opaque ID, and returns exact native form data', async () => {
    const generic = vi.fn(); bridge.onRequest(generic); await bridge.callback(7);
    const id = await requestId(); expect(id).not.toBe('7'); expect(generic).not.toHaveBeenCalled();
    await service.respond(scope, id, { action: 'accept', confirmed: true, content: { query: 'Hello', count: 4 } });
    expect(bridge.replies).toEqual([{ id: 7, generation: 'generation-one', result: { action: 'accept', content: { query: 'Hello', count: 4 }, _meta: null } }]);
    expect((await service.state(scope)).requests).toEqual([]); expect(bridge.leases).toBe(0);
    await expect(service.respond(scope, id, { action: 'accept', confirmed: true, content: { query: 'Hello' } })).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
  });
  it('keeps numeric and string outer request identities distinct', async () => {
    await bridge.callback(7); await bridge.callback('7'); const requests = (await service.state(scope)).requests;
    await service.respond(scope, requests[1].id, { action: 'decline' }); await service.respond(scope, requests[0].id, { action: 'cancel' });
    expect(bridge.replies.map(reply => reply.id)).toEqual(['7', 7]);
  });
  it('shows native descendants at their ancestor shelf while replying only on the original child thread', async () => {
    const fork = '01990000-0000-7000-8000-000000000003';
    deps.authorizeThread = async (workspaceId, threadId) => {
      if (workspaceId !== scope.workspaceId || ![THREAD, PEER, fork].includes(threadId)) throw new HttpError(404, 'Unauthorized conversation.');
      return { id: threadId, workspaceId, title: threadId === PEER ? 'Research agent' : 'Root', ...(threadId === PEER ? { parentThreadId: THREAD, rootThreadId: THREAD } : {}) } as ThreadSummary;
    };
    deps.threadSummary = id => deps.authorizeThread(scope.workspaceId, id);
    const changed = vi.fn(), unsubscribe = service.subscribe(scope, changed);
    await bridge.callback('child-request', elicitation({ threadId: PEER }));
    await bridge.callback('fork-request', elicitation({ threadId: fork }));
    const requests = (await service.state(scope)).requests;
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ threadId: PEER, threadTitle: 'Research agent' }); expect(changed).toHaveBeenCalledTimes(1);
    await expect(service.respond(scope, requests[0].id, { action: 'decline' })).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
    await service.respond({ ...scope, threadId: PEER }, requests[0].id, { action: 'decline' });
    expect(bridge.replies[0].id).toBe('child-request'); expect(changed).toHaveBeenCalledTimes(2); unsubscribe();
  });
  it('refuses a cyclic native parent chain instead of publishing a misleading descendant scope', async () => {
    deps.authorizeThread = async (_workspaceId, threadId) => ({ id: threadId, workspaceId: scope.workspaceId, parentThreadId: threadId === PEER ? THREAD : PEER }) as ThreadSummary;
    deps.threadSummary = id => deps.authorizeThread(scope.workspaceId, id);
    await bridge.callback('cycle', elicitation({ threadId: PEER }));
    expect(bridge.rejections).toContainEqual({ id: 'cycle', generation: 'generation-one' }); expect(bridge.leases).toBe(0);
  });
  it('denies forged IDs, other threads/workspaces, invalid answers, and missing explicit confirmation', async () => {
    await bridge.callback(1); const id = await requestId();
    expect((await service.state({ ...scope, threadId: PEER })).requests).toEqual([]);
    await expect(service.respond({ ...scope, threadId: PEER }, id, { action: 'decline' })).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
    await expect(service.respond({ workspaceId: 'other-workspace', threadId: THREAD }, id, { action: 'decline' })).rejects.toMatchObject({ status: 404 });
    await expect(service.respond(scope, id, { action: 'accept', content: { query: 'yes' } })).rejects.toMatchObject({ status: 400 });
    await expect(service.respond(scope, id, { action: 'accept', confirmed: true, content: { query: 'yes', extra: true } })).rejects.toMatchObject({ status: 400 });
    await expect(service.respond(scope, id, { action: 'decline', content: { query: 'yes' } })).rejects.toMatchObject({ status: 400 });
    expect(bridge.replies).toEqual([]);
  });
  it.each(['form', 'openai/form', 'openaiForm'])('supports the exact %s mode without changing answer values', async mode => {
    await bridge.callback(mode, elicitation({ mode, requestedSchema: { type: 'object', properties: { pick: { type: 'string', oneOf: [{ const: 'wire-value', title: 'Readable choice' }] }, many: { type: 'array', items: { anyOf: [{ const: 'native-id', title: 'Native choice' }] }, minItems: 1 }, enabled: { type: 'boolean' } }, required: ['pick', 'many', 'enabled'] } }));
    const id = await requestId(); await service.respond(scope, id, { action: 'accept', confirmed: true, content: { pick: 'wire-value', many: ['native-id'], enabled: false } });
    expect(bridge.replies[0].result).toEqual({ action: 'accept', content: { pick: 'wire-value', many: ['native-id'], enabled: false }, _meta: null });
  });
  it('keeps unsupported forms declineable and rejects unknown modes rather than autoaccepting', async () => {
    await bridge.callback('unsupported', elicitation({ requestedSchema: { type: 'object', properties: { unknown: { $ref: 'https://foreign.invalid/schema' } } } }));
    const id = await requestId(); expect((await service.state(scope)).requests[0].unavailableReason).toBeTruthy();
    await expect(service.respond(scope, id, { action: 'accept', confirmed: true, content: {} })).rejects.toMatchObject({ status: 422 });
    await service.respond(scope, id, { action: 'decline' });
    await bridge.callback('unknown-mode', elicitation({ mode: 'vendor/execute' }));
    expect(bridge.rejections).toContainEqual({ id: 'unknown-mode', generation: 'generation-one' });
    expect(bridge.replies[0].result).toEqual({ action: 'decline', content: null, _meta: null });
  });
  it('requires explicit confirmation for a safe URL and never accepts unsafe links', async () => {
    await bridge.callback('url', elicitation({ mode: 'url', url: 'https://verify.example/step', elicitationId: 'native-elicit-1' }));
    const id = await requestId(); expect((await service.state(scope)).requests[0].urlOrigin).toBe('https://verify.example');
    await expect(service.respond(scope, id, { action: 'accept' })).rejects.toMatchObject({ status: 400 });
    await service.respond(scope, id, { action: 'accept', confirmed: true });
    expect(bridge.replies[0].result).toEqual({ action: 'accept', content: null, _meta: null });
    await bridge.callback('unsafe-url', elicitation({ mode: 'url', url: 'javascript:alert(document.cookie)', elicitationId: 'native-elicit-2' }));
    const unsafe = (await service.state(scope)).requests[0]; expect(unsafe.url).toBeUndefined();
    await expect(service.respond(scope, unsafe.id, { action: 'accept', confirmed: true })).rejects.toMatchObject({ status: 422 });
  });
  it('drops resolved callbacks including resolution during asynchronous authorization', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    deps.threadSummary = async () => { await gate; return { id: THREAD, workspaceId: scope.workspaceId } as ThreadSummary; };
    const registering = bridge.callback('racing'); bridge.notify('serverRequest/resolved', { requestId: 'racing' }); release(); await registering;
    expect((await service.state(scope)).requests).toEqual([]);
    await bridge.callback('resolved'); const id = await requestId(); bridge.notify('serverRequest/resolved', { requestId: 'resolved' });
    await expect(service.respond(scope, id, { action: 'decline' })).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
  });
  it('invalidates pending callbacks on disconnect and expires unhandled requests as cancelled', async () => {
    vi.useFakeTimers(); await bridge.callback('old'); const oldId = await requestId(); bridge.disconnect(); bridge.current = 'generation-two';
    await expect(service.respond(scope, oldId, { action: 'accept', confirmed: true, content: { query: 'valid' } })).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
    await bridge.callback('expiring'); await vi.advanceTimersByTimeAsync(20 * 60_000 + 1);
    expect((await service.state(scope)).requests).toEqual([]);
    expect(bridge.replies).toEqual([{ id: 'expiring', generation: 'generation-two', result: { action: 'cancel', content: null, _meta: null } }]);
    expect(bridge.leases).toBe(0);
  });
});

describe('native MCP OAuth, streams, and native verification', () => {
  it('opens no browser automatically and binds OAuth completion to server and thread', async () => {
    const { server } = await selected(); const login = await service.oauthLogin(scope, { serverId: server.id, registration: 'cimd', scopes: ['read:docs'] });
    expect(login.origin).toBe('https://auth.example'); expect(bridge.calls.at(-1)).toEqual({ method: 'mcpServer/oauth/login', params: { name: 'owned-mcp', threadId: THREAD, clientRegistration: 'cimd', scopes: ['read:docs'] } });
    bridge.notify('mcpServer/oauthLogin/completed', { name: 'owned-mcp', threadId: PEER, success: true }); expect((await service.state(scope)).notices).toEqual([]);
    bridge.notify('mcpServer/oauthLogin/completed', { name: 'owned-mcp', threadId: THREAD, success: true }); expect((await service.state(scope)).notices[0].message).toContain('completed'); expect(bridge.leases).toBe(0);
  });
  it('does not fall back to plaintext when native keyring OAuth fails', async () => {
    const { server } = await selected(); bridge.handlers.set('mcpServer/oauth/login', () => { throw new Error('Native private diagnostics'); });
    await expect(service.oauthLogin(scope, { serverId: server.id })).rejects.toMatchObject({ code: 'NATIVE_MCP_OAUTH_UNAVAILABLE', message: expect.stringContaining('plaintext credential storage is disabled') });
    expect(bridge.calls.filter(call => call.method.includes('config/') && call.method !== 'config/read')).toEqual([]); expect(deps.ctx.store.write).not.toHaveBeenCalled(); expect(bridge.leases).toBe(0);
  });
  it.each(['auto', 'file', undefined])('blocks OAuth before dispatch when secure keyring policy is %s', async mode => {
    bridge.handlers.set('config/read', () => ({ config: { mcp_oauth_credentials_store: mode }, origins: {}, layers: null }));
    const { server } = await selected();
    expect((await service.state(scope)).capabilities.oauth).toBe(false);
    await expect(service.oauthLogin(scope, { serverId: server.id })).rejects.toMatchObject({ code: 'NATIVE_MCP_OAUTH_POLICY_UNAVAILABLE' });
    expect(bridge.calls.some(call => call.method === 'mcpServer/oauth/login')).toBe(false); expect(deps.ctx.store.write).not.toHaveBeenCalled();
  });
  it('fails closed when keyring policy cannot be read or changes after catalog discovery', async () => {
    const { server } = await selected(); expect((await service.state(scope)).capabilities.oauth).toBe(true);
    bridge.handlers.set('config/read', () => { throw new Error('Credential configuration unavailable.'); });
    await expect(service.oauthLogin(scope, { serverId: server.id })).rejects.toMatchObject({ code: 'NATIVE_MCP_OAUTH_POLICY_UNAVAILABLE' });
    expect(bridge.calls.some(call => call.method === 'mcpServer/oauth/login')).toBe(false);
    bridge.handlers.set('config/read', () => ({ config: { mcp_oauth_credentials_store: 'file' } }));
    await expect(service.oauthLogin(scope, { serverId: server.id })).rejects.toMatchObject({ code: 'NATIVE_MCP_OAUTH_POLICY_UNAVAILABLE' });
  });
  it('refuses authorization links carrying credentials', async () => {
    const { server } = await selected(); bridge.handlers.set('mcpServer/oauth/login', () => ({ authorizationUrl: 'https://auth.example/authorize?access_token=private' }));
    await expect(service.oauthLogin(scope, { serverId: server.id })).rejects.toMatchObject({ code: 'NATIVE_MCP_URL_INVALID' }); expect(bridge.leases).toBe(0);
  });
  it('starts/stops an owned stream and projects only its native notifications', async () => {
    const { server } = await selected(true); const result = await service.startSubscription(scope, { serverId: server.id, name: 'documents.updated', arguments: { query: 'live' } });
    const started = bridge.calls.at(-1)!.params as Record<string, unknown>; expect(started).toMatchObject({ threadId: THREAD, server: 'codex_apps', name: 'documents.updated', arguments: { query: 'live' } }); expect(started.subscriptionId).not.toBe(result.subscription.id);
    bridge.notify('mcpServer/event/stream/notification', { subscriptionId: 'foreign', notification: { method: 'notifications/message', params: { text: 'other' } } });
    bridge.notify('mcpServer/event/stream/notification', { subscriptionId: started.subscriptionId, notification: { method: 'notifications/message', params: { content: [{ type: 'text', text: 'New content' }] } } });
    const state = await service.state(scope); expect(state.subscriptions[0].events).toHaveLength(1); expect(JSON.stringify(state)).not.toContain('foreign');
    await expect(service.stopSubscription({ ...scope, threadId: PEER }, result.subscription.id)).rejects.toMatchObject({ code: 'NATIVE_MCP_STALE' });
    await service.stopSubscription(scope, result.subscription.id); expect(bridge.calls.at(-1)).toEqual({ method: 'mcpServer/event/stream/stop', params: { subscriptionId: started.subscriptionId } }); expect(bridge.leases).toBe(0);
  });
  it('retains an uncertain native stream handle after a lost start acknowledgement without replaying', async () => {
    const { server } = await selected(true); bridge.handlers.set('mcpServer/event/stream/start', () => { throw new HttpError(504, 'No acknowledgement.'); });
    await expect(service.startSubscription(scope, { serverId: server.id, name: 'documents.updated', arguments: { query: 'live' } })).rejects.toMatchObject({ status: 504 });
    const pending = (await service.state(scope)).subscriptions[0]; expect(pending.state).toBe('uncertain');
    await service.stopSubscription(scope, pending.id); expect(bridge.calls.filter(call => call.method === 'mcpServer/event/stream/start')).toHaveLength(1);
  });
  it('allows reconnect grace then stops orphaned native streams', async () => {
    vi.useFakeTimers(); const { server } = await selected(true); const unsubscribe = service.subscribe(scope, () => {});
    await service.startSubscription(scope, { serverId: server.id, name: 'documents.updated', arguments: { query: 'live' } });
    unsubscribe(); await vi.advanceTimersByTimeAsync(20_000); const reconnected = service.subscribe(scope, () => {});
    await vi.advanceTimersByTimeAsync(20_000); expect(bridge.calls.some(call => call.method === 'mcpServer/event/stream/stop')).toBe(false);
    reconnected(); await vi.advanceTimersByTimeAsync(30_001); expect((await service.state(scope)).subscriptions).toEqual([]); expect(bridge.leases).toBe(0);
  });
  it('reports real host verification readiness without disclosing credential metadata or diagnostics', async () => {
    expect(await service.verificationStatus(scope)).toMatchObject({ available: false, enrolled: false, reason: 'The native verification provider is unavailable on this host.', canEnroll: false });
    const enrollment = await service.enrollVerification(scope); expect(enrollment.registrationComplete).toBe(false); expect(JSON.stringify(enrollment)).not.toContain('private-');
    await service.deleteVerification(scope); expect(bridge.calls.at(-1)).toEqual({ method: 'userVerification/delete', params: {} });
  });
  it('signs only the retained challenge and sends its native proof only after a separate explicit response', async () => {
    const challenge = Buffer.from('owned native challenge').toString('base64url'); await bridge.callback('verify', elicitation({ mode: 'openai/userVerification', challenge, title: 'Approve identity check', description: 'Verify this server request.' }));
    const id = await requestId();
    await expect(service.respond(scope, id, { action: 'accept', confirmed: true })).rejects.toMatchObject({ code: 'NATIVE_MCP_VERIFICATION_REQUIRED' });
    const result = await service.verify(scope, id);
    expect(bridge.calls.at(-1)).toEqual({ method: 'userVerification/verify', params: { challenge, title: 'Approve identity check', description: 'Verify this server request.' } });
    expect(result).toMatchObject({ verified: true, completed: false }); expect(JSON.stringify(await service.state(scope))).not.toContain('privateSignature'); expect(JSON.stringify(result)).not.toContain('private-credential');
    await expect(service.respond(scope, id, { action: 'accept', confirmed: true, content: { credentialId: 'forged', signature: 'forged' } })).rejects.toMatchObject({ status: 400 });
    expect(bridge.replies).toEqual([]);
    await service.respond(scope, id, { action: 'accept', confirmed: true }); expect(bridge.replies[0].result).toEqual({ action: 'accept', content: { credentialId: 'private-credential-id', signature: 'privateSignatureData' }, _meta: null });
    expect((await service.state(scope)).requests).toEqual([]); expect(deps.ctx.store.write).not.toHaveBeenCalled();
  });
  it('cancels the exact original verification RPC, never the public request ID', async () => {
    let finish!: (value: unknown) => void; bridge.trackedResult = new Promise(resolve => { finish = resolve; });
    await bridge.callback('verify-outer', elicitation({ mode: 'openai/userVerification', challenge: Buffer.from('challenge').toString('base64url'), title: 'Identity check', description: '' }));
    const id = await requestId(), verifying = service.verify(scope, id); await vi.waitFor(() => expect(bridge.calls.at(-1)?.method).toBe('userVerification/verify'));
    await service.cancelVerification(scope, id); expect(bridge.calls.at(-1)).toEqual({ method: 'userVerification/cancel', params: { requestId: 734 } });
    finish({ proof: { credentialId: 'private-credential-id', signature: 'privateSignatureData' } }); await verifying;
  });
  it('cleans pending callbacks, native subscriptions, listeners, and activity leases on shutdown', async () => {
    const { server } = await selected(true); await bridge.callback('shutdown'); await service.startSubscription(scope, { serverId: server.id, name: 'documents.updated', arguments: { query: 'live' } }); await service.close();
    expect(bridge.replies[0].result).toEqual({ action: 'cancel', content: null, _meta: null }); expect(bridge.calls.at(-1)?.method).toBe('mcpServer/event/stream/stop');
    expect(bridge.leases).toBe(0); expect(bridge.owners.size).toBe(0); expect(bridge.notifications.size).toBe(0); expect(bridge.connections.size).toBe(0);
  });
  it('does not pretend ordinary MCP tools support the hosted-app event protocol', async () => {
    const { server } = await selected(); expect(server.canStream).toBe(false);
    await expect(service.startSubscription(scope, { serverId: server.id, name: 'search', arguments: {} })).rejects.toMatchObject({ code: 'NATIVE_MCP_EVENTS_UNAVAILABLE' });
    expect(bridge.calls.some(call => call.method === 'mcpServer/event/stream/start')).toBe(false);
  });
  it('clears a definitively rejected stream instead of advertising an uncertain live subscription', async () => {
    const { server } = await selected(true); bridge.handlers.set('mcpServer/event/stream/start', () => { throw new HttpError(409, 'Unknown event.', 'CODEX_RPC_REJECTED'); });
    await expect(service.startSubscription(scope, { serverId: server.id, name: 'unknown-event', arguments: {} })).rejects.toMatchObject({ code: 'CODEX_RPC_REJECTED' });
    expect((await service.state(scope)).subscriptions).toEqual([]); expect(bridge.leases).toBe(0);
  });
  it('honors native stream termination and immediately releases its runtime activity lease', async () => {
    const { server } = await selected(true); const result = await service.startSubscription(scope, { serverId: server.id, name: 'documents.updated', arguments: {} });
    const nativeId = (bridge.calls.at(-1)!.params as Record<string, unknown>).subscriptionId;
    bridge.notify('mcpServer/event/stream/notification', { subscriptionId: nativeId, notification: { method: 'notifications/events/terminated', params: {} } });
    expect((await service.state(scope)).subscriptions[0].state).toBe('ended'); expect(bridge.leases).toBe(0);
    const count = bridge.calls.length; await service.stopSubscription(scope, result.subscription.id); expect(bridge.calls).toHaveLength(count); expect((await service.state(scope)).subscriptions).toEqual([]);
  });
});

describe('MCP bounded input and public content safety', () => {
  it('redacts vault values from presentation, result text, and server requests', async () => {
    await saveMcpEnvironment(deps.ctx, [{ name: 'MCP_TEST_TOKEN', value: 'owned-secret-value-123' }]);
    bridge.handlers.set('mcpServer/tool/call', () => ({ content: [{ type: 'text', text: 'Token owned-secret-value-123' }], structuredContent: { api_key: 'another-private-value', ordinary: 'result' }, _meta: { token: 'private' } }));
    const { server, tool } = await selected(); const result = await service.tool(scope, { serverId: server.id, toolId: tool.id, arguments: { query: 'ok' } });
    expect(JSON.stringify(result)).not.toContain('owned-secret'); expect(JSON.stringify(result)).not.toContain('another-private'); expect(JSON.stringify(result)).toContain('[REDACTED]');
    await bridge.callback('secret', elicitation({ message: 'Private token: owned-secret-value-123' })); expect(JSON.stringify(await service.state(scope))).not.toContain('owned-secret');
    expect(deps.ctx.store.write).not.toHaveBeenCalled();
  });
  it('bounds nested values, rejects prototype keys, and preserves original scalar types', () => {
    expect(() => assertMcpValue(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow(); expect(() => assertMcpValue({ text: 'x'.repeat(70_000) })).toThrow();
    const form = mcpForm({ type: 'object', properties: { date: { type: 'string', format: 'date' }, amount: { type: 'number', multipleOf: 0.5 }, nested: { type: 'object', properties: { yes: { type: 'boolean' } }, required: ['yes'] } }, required: ['date', 'nested'] });
    expect(form.field).not.toBeNull(); expect(validateMcpField(form.field!, { date: '2026-02-30', nested: { yes: true } })).toContain('calendar date');
    expect(validateMcpField(form.field!, { date: '2026-09-30', amount: 1.3, nested: { yes: true } })).toContain('numeric step');
    expect(validateMcpField(form.field!, { date: '2026-09-30', amount: 1.5, nested: { yes: false } })).toBeNull();
  });
  it('does not expose secret defaults, fetch schema URLs, or treat HTML resources as executable UI', () => {
    const form = mcpForm({ type: 'object', properties: { password: { type: 'string', default: 'do-not-display' } } }); expect(form.field?.fields?.[0].secret).toBe(true); expect(form.field?.fields?.[0].defaultValue).toBeUndefined();
    const nestedDefault = mcpForm({ type: 'object', properties: { password: { type: 'string' } }, default: { password: 'private-nested-default' } }); expect(JSON.stringify(nestedDefault)).not.toContain('private-nested-default');
    expect(mcpForm({ $ref: 'https://example.invalid/remote-schema' }).field).toBeNull();
    const result = mcpContent({ contents: [{ uri: 'ui://native-app', mimeType: 'text/html', text: '<script>run()</script>' }] }, value => value); expect(result.content[0]).toMatchObject({ kind: 'text', text: '<script>run()</script>' });
  });
  it('rejects active or credential-bearing URLs and matches resource templates with bounded work', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'https://user:pass@example.com/', 'https://example.com/?refresh_token=private']) expect(safeMcpUrl(value)).toBeNull();
    expect(safeMcpUrl('https://example.com/step?state=opaque')).toBe('https://example.com/step?state=opaque');
    expect(matchesResourceTemplate('docs://files/{path}/version/{version}', 'docs://files/readme/version/2')).toBe(true);
    expect(matchesResourceTemplate('docs://files/{path}/version/{version}', 'docs://files/readme/revision/2')).toBe(false);
    expect(matchesResourceTemplate('docs://files/' + '{x}a'.repeat(30), 'docs://files/' + 'a'.repeat(8000) + 'z')).toBe(false);
  });
});

describe('native MCP HTTP feature boundary', () => {
  it('rejects RPC injection, response metadata, extra scopes, and oversized pages before native dispatch', async () => {
    await service.close();
    const cleanups: Array<() => void | Promise<void>> = []; deps.registerCleanup = cleanup => { cleanups.push(cleanup); };
    const app = express(); app.use(express.json({ limit: '256kb' })); app.use('/api', createNativeMcpRouter(deps));
    app.use(((error, _req, res, _next) => res.status(error instanceof HttpError ? error.status : 400).json({ error: 'Request rejected.', code: error instanceof HttpError ? error.code : 'INVALID_INPUT' })) as ErrorRequestHandler);
    const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address.');
    const base = `http://127.0.0.1:${address.port}/api/workspaces/${scope.workspaceId}/native/mcp`;
    const post = (suffix: string, body: unknown) => fetch(base + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const stateResponse = await fetch(base + '/state?threadId=' + THREAD); expect(stateResponse.status).toBe(200); expect(stateResponse.headers.get('Cache-Control')).toContain('no-store'); expect(bridge.calls).toEqual([]);
      const inventoryResponse = await post('/inventory', { threadId: THREAD }); const inventory = await inventoryResponse.json() as { servers: Array<{ id: string }> };
      const serverId = inventory.servers[0].id;
      const catalog = await (await fetch(base + `/catalog?threadId=${THREAD}&serverId=${serverId}&kind=tools`)).json() as { tools: Array<{ id: string }> };
      const call = { threadId: THREAD, serverId, toolId: catalog.tools[0].id, arguments: { query: 'valid' }, confirmed: true };
      const count = bridge.calls.length;
      expect((await post('/tool', { ...call, method: 'command/exec' })).status).toBe(400);
      expect((await post('/tool', { ...call, _meta: { administrator: true } })).status).toBe(400);
      expect((await post('/tool', { ...call, server: 'foreign-server' })).status).toBe(400);
      expect((await fetch(base + `/catalog?threadId=${THREAD}&serverId=${serverId}&kind=tools&offset=99999`)).status).toBe(400);
      expect(bridge.calls).toHaveLength(count);
      await bridge.callback('http-callback');
      const state = await (await fetch(base + '/state?threadId=' + THREAD)).json() as { requests: Array<{ id: string }> };
      const callbackId = state.requests[0].id;
      expect((await post(`/requests/${callbackId}/respond`, { threadId: THREAD, action: 'accept', confirmed: true, content: { query: 'valid' }, _meta: { bypass: true } })).status).toBe(400);
      expect(bridge.replies).toEqual([]);
      expect((await post(`/requests/${callbackId}/respond`, { threadId: THREAD, action: 'decline' })).status).toBe(200);
      expect(bridge.replies[0]).toEqual({ id: 'http-callback', generation: 'generation-one', result: { action: 'decline', content: null, _meta: null } });
    } finally {
      await Promise.all(cleanups.map(cleanup => cleanup()));
      server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
