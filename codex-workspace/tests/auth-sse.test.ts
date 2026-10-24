import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express, { type ErrorRequestHandler } from 'express';
import { AuthService, createSessionEventStream, type AuthServiceOptions, type SessionEventStream } from '../server/auth';
import { createAgentRouter, getCodexConversations, shutdownAgent } from '../server/agent';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { NativeNotification, NativeServerRequest, RpcId } from '../server/codex-cli/rpc';
import { shutdownImageAttachments } from '../server/agent/attachments';
import { createDownloadRouter, getDownloadService, initializeDownloads, shutdownDownloads } from '../server/downloads';
import { PUBLIC_DOWNLOAD_BUCKET } from '../server/downloads/bucket';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import type { AgentEvent, ChatMessage, CodexRuntimeStatus, ConversationHistoryDetail, Thread } from '../shared/types';

const password = 'stream-test-only-password';
const signingKey = 'stream-test-only-session-signing-key-123456789';
const encryptionKey = 'stream-test-only-credential-key-123456789';
const epoch = createHmac('sha256', signingKey).update(password).digest('hex');
const day = 24 * 60 * 60 * 1000;
const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));


// A protocol fixture only: the real web router, conversation service, auth
// guard and writable response remain in use. No native process or provider runs.
const runtimeFixtures = vi.hoisted(() => new WeakMap<object, unknown>());
vi.mock('../server/codex-cli/runtime', () => ({ getCodexRuntime: (ctx: object) => {
  const runtime = runtimeFixtures.get(ctx);
  if (!runtime) throw new Error('The SSE fixture must install its isolated native bridge.');
  return runtime;
} }));
const NATIVE_THREAD = '01980000-0000-7000-8000-0000000000a1';
const NATIVE_TURN = '01980000-0000-7000-8000-0000000000b1';
const readMethods = new Set(['thread/read', 'thread/items/list', 'thread/turns/list', 'thread/queue/list', 'thread/goal/get']);
class StreamBridge implements CodexBridge {
  metadata: Record<string, unknown> | null = null;
  messages: ChatMessage[] = [];
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  notifications = new Set<(message: NativeNotification, generation: string) => void>();
  serverRequests = new Set<(message: NativeServerRequest, generation: string) => void>();
  connections = new Set<(state: 'ready' | 'closed', generation: string) => void>();
  generation() { return this.metadata ? 'native-stream-fixture' : null; }
  supports(method: string) { return readMethods.has(method); }
  status(): CodexRuntimeStatus { return { backend: 'codex-cli', state: this.metadata ? 'ready' : 'stopped', version: null, installedVersion: null,
    startedAt: null, updatedAt: '2026-09-22T00:00:00Z', canUpdate: false, updateBlockedReason: 'Protocol fixture', error: null, activeTurns: 0,
    capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: false, plan: false, review: false, historyRevert: false } }; }
  async request<T>(method: string, input: unknown = {}): Promise<T> {
    if (!this.metadata || !input || typeof input !== 'object' || Array.isArray(input) || !readMethods.has(method)) {
      throw new Error(`Unexpected native RPC in SSE authorization fixture: ${method}`);
    }
    const params = input as Record<string, unknown>; this.calls.push({ method, params: structuredClone(params) });
    if (params.threadId !== NATIVE_THREAD) throw new Error('Native fixture thread scope changed.');
    if (method === 'thread/read') {
      expect(params.includeTurns).toBe(false);
      return { thread: structuredClone(this.metadata) } as T;
    }
    if (method === 'thread/turns/list') {
      expect(params.itemsView).toBe('notLoaded');
      return { data: [{ id: NATIVE_TURN, status: 'completed', items: [], itemsView: 'notLoaded', error: null, startedAt: 1700000000, completedAt: 1700000001 }], nextCursor: null, backwardsCursor: null } as T;
    }
    if (method === 'thread/queue/list') return { data: [], nextCursor: null } as T;
    if (method === 'thread/goal/get') return { goal: null } as T;
    expect(params.limit).toBe(1);
    const direction = params.sortDirection === 'asc' ? 1 : -1;
    const tokens = new Map(this.messages.map((_message, index) => [`native opaque ${index} /+=?`, index]));
    const index = params.cursor === undefined ? this.messages.length - 1 : tokens.get(String(params.cursor));
    if (index === undefined) throw new Error('An opaque native fixture cursor was changed.');
    const message = this.messages[index];
    const item = message?.role === 'user'
      ? { id: message.id, type: 'userMessage', clientId: null, content: [{ type: 'text', text: message.content, text_elements: [] }] }
      : message ? { id: message.id, type: 'agentMessage', text: message.content, phase: 'final_answer', memoryCitation: null, delivery: null, questions: null } : undefined;
    const following = index + direction;
    return { data: item ? [{ turnId: NATIVE_TURN, item }] : [], nextCursor: following >= 0 && following < this.messages.length ? `native opaque ${following} /+=?` : null,
      backwardsCursor: message ? `native opaque ${index} /+=?` : null } as T;
  }
  respond(_id: RpcId, _result: unknown, _generation: string): void { throw new Error('SSE reads must not answer native requests.'); }
  rejectRequest(_id: RpcId, _message: string, _generation: string): void { throw new Error('No pending native request is expected.'); }
  onNotification(listener: (message: NativeNotification, generation: string) => void) { this.notifications.add(listener); return () => { this.notifications.delete(listener); }; }
  onRequest(listener: (message: NativeServerRequest, generation: string) => void) { this.serverRequests.add(listener); return () => { this.serverRequests.delete(listener); }; }
  onConnection(listener: (state: 'ready' | 'closed', generation: string) => void) { this.connections.add(listener); return () => { this.connections.delete(listener); }; }
  notifyTitle(threadName: string) {
    if (!this.metadata) throw new Error('Only a native fixture can publish native notifications.');
    this.metadata.name = threadName;
    for (const listener of this.notifications) listener({ method: 'thread/name/updated', params: { threadId: NATIVE_THREAD, threadName } }, 'native-stream-fixture');
  }
  async close() { /* The real conversation service owns its bridge subscriptions. */ }
}

interface Session { cookie: string; hash: string; expiresAt: number }
interface Probe { stream: SessionEventStream; response: ServerResponse; cleanups: number }
interface Reply { status: number; headers: IncomingHttpHeaders; body: Record<string, unknown> }
interface Connection {
  response: IncomingMessage;
  text: string;
  cleanEnd: boolean;
  ended: Promise<void>;
}
interface Fixture {
  ctx: AppContext;
  auth: AuthService;
  server: Server;
  origin: string;
  probes: Map<string, Probe>;
  route: string;
  threadId?: string;
  bridge: StreamBridge;
  logoutListeners: ReturnType<EventEmitter['listeners']>;
  close(): Promise<void>;
}

let directory: string;
let fixtures: Fixture[];
let connections: Connection[];
let releases: Array<() => void>;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-auth-sse-'));
  fixtures = []; connections = []; releases = [];
});

afterEach(async () => {
  for (const release of releases) release();
  vi.restoreAllMocks();
  for (const connection of connections) connection.response.destroy();
  for (const fixture of fixtures.reverse()) await fixture.close();
  await fs.rm(directory, { recursive: true, force: true });
});

async function fixture(kind: 'probe' | 'thread' | 'native' | 'download' = 'probe', options: AuthServiceOptions = {}, seed: {
  messages?: ChatMessage[];
  inspect?: (response: ServerResponse, route: string) => void;
} = {}): Promise<Fixture> {
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, WORKSPACE_PASSWORD: password,
    SESSION_SECRET: signingKey, ENCRYPTION_KEY: encryptionKey });
  const store = new JsonStore(config.stateDir);
  const ctx: AppContext = {
    config, store, secrets: new SecretStore(store, encryptionKey), workspaces: new WorkspaceService(config, store),
    events: new EventEmitter().setMaxListeners(150), settings: async () => ({ ...defaultSettings }),
    saveSettings: async patch => ({ ...defaultSettings, ...patch }), providerKey: async () => undefined,
  };
  const bridge = new StreamBridge(); runtimeFixtures.set(ctx, bridge);
  const auth = new AuthService(ctx, options); await auth.initialize();
  const app = express();
  const probes = new Map<string, Probe>();
  app.use('/api', (req, res, next) => { seed.inspect?.(res, req.path); next(); });
  app.get('/unguarded', (req, res) => { createSessionEventStream(req, res); });
  app.use('/api', auth.protectMutations, express.json({ limit: '4kb' }), auth.router(), auth.requireSession);
  app.get('/api/probe/:id', (req, res) => {
    const stream = createSessionEventStream(req, res);
    const probe: Probe = { stream, response: res, cleanups: 0 }; probes.set(String(req.params.id), probe);
    stream.onClose(() => { probe.cleanups++; });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform' });
    res.flushHeaders(); stream.send(': ready\n\n');
  });
  let route = '/api/probe/main', threadId: string | undefined;
  if (kind === 'thread' || kind === 'native') {
    await ctx.workspaces.initialize();
    const workspace = await ctx.workspaces.create({ name: 'Stream authorization fixture' });
    await fs.mkdir(config.homeDir, { recursive: true });
    const conversations = getCodexConversations(ctx);
    if (kind === 'thread') {
      const timestamp = new Date().toISOString();
      const thread: Thread = { id: `thr_${randomUUID().replaceAll('-', '')}`, workspaceId: workspace.id, title: 'Persisted private thread',
        createdAt: timestamp, updatedAt: timestamp, status: 'idle', messages: seed.messages ?? [], turns: [] };
      await store.write(`thread-${thread.id}`, { thread, input: [], revision: 1 });
      threadId = thread.id;
      await conversations.initialize();
      expect(bridge.calls).toEqual([]);
    } else {
      bridge.metadata = { id: NATIVE_THREAD, cwd: workspace.path, name: 'Persisted native thread', model: 'literal-native-model', modelProvider: 'workspace_owner', reasoningEffort: 'high',
        createdAt: 1700000000, updatedAt: 1700000001, status: { type: 'idle' }, parentThreadId: null, forkedFromId: null, turns: [] };
      bridge.messages = seed.messages ?? [{ id: 'native-fixture-message', role: 'assistant', content: 'Previously saved native content.', createdAt: new Date().toISOString() }];
      threadId = NATIVE_THREAD;
      // Warm only the service's local metadata/attachment readers before taking
      // the baseline of service-lifetime auth subscriptions.
      await conversations.get(threadId);
    }
    route = `/api/threads/${threadId}/events`;
    app.use('/api', createAgentRouter(ctx));
  } else if (kind === 'download') {
    const id = randomUUID(), now = new Date().toISOString();
    // A real persisted job exercises the service and its subscription cleanup;
    // this completed failure requires neither a transfer token nor network IO.
    await store.write('download-jobs-v1', { format: 1, jobs: [{ id, workspaceId: 'stream_fixture',
      path: 'private-source.txt', fileName: 'private-source.txt', size: 20, bytesProcessed: 0, state: 'failed',
      bucket: PUBLIC_DOWNLOAD_BUCKET, createdAt: now, updatedAt: now }] });
    await initializeDownloads(ctx);
    route = `/api/downloads/${id}/events`; app.use('/api', createDownloadRouter(ctx));
  }
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof HttpError) res.status(error.status).json({ error: error.message, code: error.code });
    else res.status(500).json({ error: 'The fixture request could not be completed.' });
  };
  app.use(errors);
  const server = createServer(app);
  let closed = false;
  // Application services may retain their own logout listeners for their whole
  // lifetime. Each stream must release only its listener and leave those exact
  // service subscriptions intact; full fixture shutdown must release them too.
  const logoutListeners = ctx.events.listeners('auth:logout');
  const result: Fixture = { ctx, auth, server, origin: '', probes, route, threadId, bridge, logoutListeners, async close() {
    if (closed) return; closed = true;
    await auth.close(); await shutdownAgent(ctx); await shutdownDownloads(ctx); await shutdownImageAttachments(ctx);
    expect(ctx.events.listenerCount('auth:logout')).toBe(0);
    expect(bridge.notifications.size + bridge.serverRequests.size + bridge.connections.size).toBe(0);
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await store.flush();
  } };
  fixtures.push(result);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  result.origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return result;
}

function expectNoSessionSubscribers(instance: Fixture): void {
  expect(instance.ctx.events.listeners('auth:logout')).toEqual(instance.logoutListeners);
}

async function grant(instance: Fixture, expiresAt = Date.now() + day): Promise<Session> {
  const data = `${randomBytes(32).toString('base64url')}.${expiresAt}`;
  const token = `${data}.${createHmac('sha256', signingKey).update(data).digest('base64url')}`;
  const session = { cookie: `codex_workspace_session=${token}`, hash: createHash('sha256').update(token).digest('hex'), expiresAt };
  const store = new JsonStore(path.join(instance.ctx.config.stateDir, 'auth-sessions-v2', `d-${Math.floor(expiresAt / day)}`));
  await store.write(`session-${session.hash}`, { version: 2, epoch, hash: session.hash, expiresAt });
  return session;
}

function revokedPath(instance: Fixture, session: Session): string {
  return path.join(instance.ctx.config.stateDir, 'auth-sessions-v2', `d-${Math.floor(session.expiresAt / day)}`, `revoked-${session.hash}.json`);
}

function request(instance: Fixture, route: string, options: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = httpRequest(`${instance.origin}${route}`, { method: options.method ?? 'GET', agent: false, headers: {
      Origin: options.origin ?? instance.origin, 'X-Codex-Workspace': '1', ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
    } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.once('error', reject);
      res.once('end', () => {
        try { resolve({ status: res.statusCode ?? 0, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(8_000, () => req.destroy(new Error('Stream fixture request timed out.')));
    req.once('error', reject); req.end(body);
  });
}

async function connect(instance: Fixture, session: Session, route = instance.route, paused = false): Promise<Connection> {
  const result = await new Promise<Connection>((resolve, reject) => {
    const req = httpRequest(`${instance.origin}${route}`, { agent: false, headers: {
      Origin: instance.origin, Cookie: session.cookie, Accept: 'text/event-stream',
    } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Stream fixture returned HTTP ${response.statusCode}.`)); return; }
      let finish!: () => void;
      const connection: Connection = { response, text: '', cleanEnd: false, ended: new Promise<void>(resolveEnd => { finish = resolveEnd; }) };
      response.setEncoding('utf8'); response.on('data', chunk => { connection.text += String(chunk); });
      if (paused) response.pause();
      response.once('end', () => { connection.cleanEnd = true; finish(); });
      response.once('close', finish); response.once('error', finish);
      connections.push(connection); resolve(connection);
    });
    req.setTimeout(8_000, () => req.destroy(new Error('Stream fixture connection timed out.')));
    req.once('error', reject); req.end();
  });
  return result;
}

function gate() {
  let signal!: () => void, release!: () => void;
  const arrived = new Promise<void>(resolve => { signal = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  releases.push(release); return { arrived, blocked, signal, release };
}

function holdNextRevocationRead(instance: Fixture, session: Session) {
  const paused = gate(), original = fs.lstat.bind(fs);
  let intercepted = false;
  const spy = vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
    if (!intercepted && String(args[0]) === revokedPath(instance, session)) {
      intercepted = true; paused.signal(); await paused.blocked;
    }
    return original(...args);
  }) as typeof fs.lstat);
  return { ...paused, spy };
}

function history(turns = 60): ChatMessage[] {
  // Each user message is below the real 64,000-code-unit prompt limit. These
  // saved turns exceed 4 MiB together, including characters crossing chunks.
  const content = '😀 café 漢字\n'.repeat(5000), createdAt = new Date().toISOString();
  return Array.from({ length: turns }, (_, index) => [
    { id: `saved_user_${index}`, role: 'user' as const, content: `${content}End ${index}.`, createdAt },
    { id: `saved_assistant_${index}`, role: 'assistant' as const, content: `Completed saved turn ${index}.`, createdAt },
  ]).flat();
}

function events(connection: Connection): AgentEvent[] {
  return connection.text.split('\n\n').slice(0, -1).flatMap(frame => {
    const data = frame.split('\n').find(line => line.startsWith('data: '));
    return data ? [JSON.parse(data.slice(6)) as AgentEvent] : [];
  });
}
const messageProof = (messages: ChatMessage[]) => messages.map(message => ({ id: message.id,
  digest: createHash('sha256').update(message.content).digest('hex') }));

async function olderPublicMessages(instance: Fixture, session: Session, recent: Thread): Promise<ChatMessage[]> {
  const messages = [...recent.messages], seen = new Set<string>();
  let current = recent;
  while (current.history!.hasOlder) {
    const cursor = current.history!.olderCursor;
    expect(cursor).toBeTypeOf('string'); expect(seen.has(cursor!)).toBe(false); seen.add(cursor!);
    const response = await request(instance, `/api/threads/${recent.id}/history?before=${encodeURIComponent(cursor!)}`, { cookie: session.cookie });
    expect(response.status).toBe(200);
    expect(Buffer.byteLength(JSON.stringify(response.body))).toBeLessThan(512 * 1024);
    const page = response.body as unknown as Thread;
    expect(page.history!.epoch).toBe(recent.history!.epoch);
    expect(page.history!.newestSequence).toBeLessThan(current.history!.oldestSequence!);
    expect(page.messages.length).toBeLessThanOrEqual(40);
    messages.unshift(...page.messages); current = page;
  }
  return messages;
}

async function fullPublicContent(instance: Fixture, session: Session, thread: Thread, expected: ChatMessage): Promise<void> {
  let offset: number | null = 0, version: string | undefined;
  const pieces: string[] = [];
  while (offset !== null) {
    const response = await request(instance, `/api/threads/${thread.id}/history/detail?epoch=${thread.history!.epoch}&field=content&messageId=${expected.id}&offset=${offset}${version ? `&version=${version}` : ''}`, { cookie: session.cookie });
    expect(response.status).toBe(200);
    expect(Buffer.byteLength(JSON.stringify(response.body))).toBeLessThan(128 * 1024);
    const page = response.body as unknown as ConversationHistoryDetail;
    expect(page.offset).toBe(offset); expect(page.totalChars).toBe(expected.content.length);
    expect(page.text.length).toBeLessThanOrEqual(16_384);
    expect(page.text).toBe(expected.content.slice(offset, offset + page.text.length));
    expect(/[\ud800-\udbff]$/.test(page.text)).toBe(false);
    if (version) expect(page.version).toBe(version);
    if (page.nextOffset !== null) { expect(page.nextOffset).toBe(offset + page.text.length); expect(page.nextOffset).toBeGreaterThan(offset); }
    pieces.push(page.text); offset = page.nextOffset; version = page.version;
  }
  expect(pieces.join('')).toBe(expected.content);
  expect(createHash('sha256').update(pieces.join('')).digest('hex'))
    .toBe(createHash('sha256').update(expected.content).digest('hex'));
}

describe('authenticated SSE session lifetime', () => {
  it.each(['thread', 'native', 'download'] as const)('closes the real %s stream at signed expiry, before its first authority refresh', async kind => {
    const instance = await fixture(kind);
    const session = await grant(instance, Date.now() + 700);
    const original = kind !== 'download' ? getCodexConversations(instance.ctx).subscribe.bind(getCodexConversations(instance.ctx)) : undefined;
    const cleanups: ReturnType<typeof vi.fn>[] = [];
    if (original) vi.spyOn(getCodexConversations(instance.ctx), 'subscribe').mockImplementation(async (...args) => {
      const unsubscribe = vi.fn(await original(...args)); cleanups.push(unsubscribe); return unsubscribe;
    });
    const connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(kind === 'thread' ? 'Persisted private thread' : kind === 'native' ? 'Persisted native thread' : 'private-source.txt');
    expect(instance.ctx.events.listeners('auth:logout')).toHaveLength(instance.logoutListeners.length + 1);
    expect(instance.ctx.events.listeners('auth:logout')).toEqual(expect.arrayContaining(instance.logoutListeners));
    await connection.ended;
    expect(connection.cleanEnd).toBe(true);
    expect(Date.now()).toBeLessThan(session.expiresAt + 1_000);
    expectNoSessionSubscribers(instance);
    if (kind !== 'download') expect(cleanups[0]).toHaveBeenCalledTimes(1);
    else expect(instance.ctx.events.listenerCount('download:changed')).toBe(0);
    expect((await request(instance, instance.route, { cookie: session.cookie })).status).toBe(401);
    for (const secret of [session.cookie, session.hash, password, signingKey]) expect(connection.text).not.toContain(secret);
  });

  it('keeps anonymous login available, denies unbound streams, and protects logout mutations', async () => {
    const instance = await fixture();
    expect((await request(instance, '/api/session')).body).toEqual({ authenticated: false });
    expect((await request(instance, instance.route)).status).toBe(401);
    const login = await request(instance, '/api/session', { method: 'POST', body: { password } });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie']![0].split(';')[0];
    expect((await request(instance, '/unguarded', { cookie })).status).toBe(401);
    expect((await request(instance, '/api/session', { method: 'DELETE', cookie, origin: 'https://unrelated.invalid' })).status).toBe(403);
    expect((await request(instance, '/api/session', { cookie })).body).toEqual({ authenticated: true });
  });

  it('invalidates a local logout synchronously without closing another valid session', async () => {
    const instance = await fixture();
    const first = await grant(instance), second = await grant(instance);
    // Register before the guard to exercise listener order: a producer reacting
    // to logout must not squeeze out one last sensitive frame.
    const sendAfterLogout = vi.fn(() => instance.probes.get('first')?.stream.send('data: AFTER_LOGOUT_SECRET\n\n'));
    instance.ctx.events.once('auth:logout', sendAfterLogout);
    const firstConnection = await connect(instance, first, '/api/probe/first');
    const secondConnection = await connect(instance, second, '/api/probe/second');
    await expect.poll(() => firstConnection.text).toContain(': ready');
    expect((await request(instance, '/api/session', { method: 'DELETE', cookie: first.cookie })).status).toBe(200);
    await firstConnection.ended;
    expect(sendAfterLogout).toHaveBeenCalledTimes(1);
    expect(firstConnection.text).not.toContain('AFTER_LOGOUT_SECRET');
    expect(instance.probes.get('first')!.cleanups).toBe(1);
    instance.probes.get('second')!.stream.send('data: STILL_AUTHORIZED\n\n');
    await expect.poll(() => secondConnection.text).toContain('STILL_AUTHORIZED');
    expect(secondConnection.cleanEnd).toBe(false);
  });

  it('observes logout by a separate process without any subsequent HTTP request to the streaming server', async () => {
    const instance = await fixture('probe', { streamMaxAgeMs: 200, streamTimeoutMs: 150 });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    const script = `
      import express from 'express';
      import { createServer } from 'node:http';
      import { EventEmitter } from 'node:events';
      import { AuthService } from './server/auth.ts';
      import { JsonStore } from './server/store.ts';
      const store = new JsonStore(process.env.SSE_TEST_STATE);
      const ctx = { store, events: new EventEmitter(), config: { production: false,
        password: process.env.SSE_TEST_PASSWORD, sessionSecret: process.env.SSE_TEST_KEY } };
      const auth = new AuthService(ctx); await auth.initialize();
      const app = express(); app.use(auth.protectMutations, auth.router());
      const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = 'http://127.0.0.1:' + server.address().port;
      try {
        const reply = await fetch(origin + '/session', { method: 'DELETE', headers: {
          Origin: origin, 'X-Codex-Workspace': '1', Cookie: process.env.SSE_TEST_COOKIE } });
        await reply.arrayBuffer();
        if (reply.status !== 200) throw new Error('Independent logout failed.');
      } finally {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        await auth.close(); await store.flush();
      }
    `;
    await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: projectRoot, timeout: 8_000,
      env: { PATH: process.env.PATH, NODE_ENV: 'test',
        // Keep the runner's bounded thread pools in the independent process;
        // a fresh credential allowlist must not reset those tooling limits.
        GOMAXPROCS: '2', UV_THREADPOOL_SIZE: '1', NODE_OPTIONS: '--v8-pool-size=1', SSE_TEST_STATE: instance.ctx.config.stateDir,
        SSE_TEST_PASSWORD: password, SSE_TEST_KEY: signingKey, SSE_TEST_COOKIE: session.cookie } });
    await connection.ended;
    expect(connection.cleanEnd).toBe(true);
    expect(instance.probes.get('main')!.cleanups).toBe(1);
    expectNoSessionSubscribers(instance);
    expect(await fs.stat(revokedPath(instance, session))).toMatchObject({ size: expect.any(Number) });
  }, 12_000);
});

describe('bounded large conversation snapshots', () => {
  it('reads and reconnects bounded readonly legacy windows from >5 MiB Unicode history without native work or mutation', async () => {
    const messages = history(), expected = messageProof(messages);
    expect(Buffer.byteLength(JSON.stringify(messages))).toBeGreaterThan(5 * 1024 * 1024);
    expect(messages.filter(message => message.role === 'user').every(message => message.content.length <= 64_000)).toBe(true);
    let largestFrame = 0;
    const instance = await fixture('thread', {}, { messages, inspect(response, route) {
      if (!route.endsWith('/events')) return;
      const write = response.write.bind(response);
      vi.spyOn(response, 'write').mockImplementation(((chunk: unknown, ...args: unknown[]) => {
        if (Buffer.isBuffer(chunk) || typeof chunk === 'string') largestFrame = Math.max(largestFrame, Buffer.byteLength(chunk));
        return Reflect.apply(write, response, [chunk, ...args]);
      }) as typeof response.write);
    } });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text.endsWith('\n\n')).toBe(true);
    const first = events(connection)[0];
    expect(first.type).toBe('snapshot');
    const recent = first.thread as Thread;
    expect(recent.messages.length).toBeLessThanOrEqual(40);
    expect(recent.history).toMatchObject({ hasOlder: true, hasNewer: false, totalMessages: messages.length });
    expect(recent.messages.map(message => message.id)).toEqual(messages.slice(-recent.messages.length).map(message => message.id));
    expect(Buffer.byteLength(connection.text)).toBeLessThan(512 * 1024);
    const paged = await olderPublicMessages(instance, session, recent);
    expect(paged.map(message => message.id)).toEqual(messages.map(message => message.id));
    expect(paged.map(message => message.ordinal)).toEqual(messages.map((_message, index) => index + 1));
    paged.forEach((message, index) => {
      expect(message.content).toBe(messages[index].content.slice(0, message.content.length));
      expect(message.contentChars).toBe(messages[index].content.length);
      expect(message.contentTruncated).toBe(message.content.length < messages[index].content.length);
    });
    for (const position of [0, 60, messages.length - 2]) await fullPublicContent(instance, session, recent, messages[position]);
    expect(recent).toMatchObject({ backend: 'legacy', readOnly: true });
    const deniedRename = await request(instance, `/api/threads/${instance.threadId}`, { method: 'PATCH', cookie: session.cookie, body: { title: 'Unsupported legacy rename' } });
    expect(deniedRename.status).toBe(409); expect(deniedRename.body.code).toBe('LEGACY_THREAD_READ_ONLY');
    expect(events(connection)).toHaveLength(1);
    const reconnected = await connect(instance, session);
    await expect.poll(() => events(reconnected).length).toBe(1);
    const resumed = events(reconnected)[0].thread as Thread;
    expect(resumed).toMatchObject({ backend: 'legacy', readOnly: true, title: recent.title });
    expect(resumed.messages).toEqual(recent.messages);
    expect(instance.bridge.calls).toEqual([]);
    expect(largestFrame).toBeLessThan(512 * 1024);
    const saved = await instance.ctx.store.read<{ thread: Thread } | null>(`thread-${instance.threadId}`, null);
    expect(messageProof(saved!.thread.messages)).toEqual(expected);
    expect(connection.cleanEnd).toBe(false);
  });

  it('retains one large snapshot and its ordered tail while session authority is pending', async () => {
    let chunks = 0, largestChunk = 0, crossedCodepoint = false;
    const instance = await fixture('probe', { streamMaxAgeMs: 300, streamTimeoutMs: 200 }, { inspect(response, route) {
      if (!route.startsWith('/probe/')) return;
      const write = response.write.bind(response);
      vi.spyOn(response, 'write').mockImplementation(((chunk: unknown, ...args: unknown[]) => {
        if (Buffer.isBuffer(chunk)) {
          chunks++; largestChunk = Math.max(largestChunk, chunk.length);
          crossedCodepoint ||= (chunk[0] & 0xc0) === 0x80;
        }
        return Reflect.apply(write, response, [chunk, ...args]);
      }) as typeof response.write);
    } });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    const probe = instance.probes.get('main')!, paused = holdNextRevocationRead(instance, session);
    await paused.arrived;
    const snapshot = `data: ${JSON.stringify({ type: 'snapshot', threadId: 'pending', content: '😀'.repeat(1_400_000) })}\n\n`;
    expect(probe.stream.sendSnapshot(snapshot)).toBe(true);
    probe.stream.send('data: {"type":"delta","threadId":"pending","text":"after"}\n\n');
    expect(connection.text).toBe(': ready\n\n'); expect(probe.stream.closed).toBe(false);
    paused.release();
    await expect.poll(() => connection.text.endsWith('"text":"after"}\n\n')).toBe(true);
    const received = events(connection);
    expect(received.map(event => event.type)).toEqual(['snapshot', 'delta']);
    expect(createHash('sha256').update(String(received[0].content)).digest('hex'))
      .toBe(createHash('sha256').update('😀'.repeat(1_400_000)).digest('hex'));
    expect(chunks).toBeGreaterThan(64); expect(largestChunk).toBeLessThanOrEqual(64 * 1024); expect(crossedCodepoint).toBe(true);
  });

  it.each(['bytes', 'frames', 'second snapshot'] as const)('retains the %s bound behind a pending large snapshot', async limit => {
    const instance = await fixture('probe', { streamMaxAgeMs: 300, streamTimeoutMs: 200 });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    const probe = instance.probes.get('main')!, paused = holdNextRevocationRead(instance, session);
    await paused.arrived;
    const snapshot = `data: ${'x'.repeat(5 * 1024 * 1024)}\n\n`;
    expect(probe.stream.sendSnapshot(snapshot)).toBe(true);
    if (limit === 'bytes') probe.stream.send(`data: ${'x'.repeat(4 * 1024 * 1024)}\n\n`);
    else if (limit === 'frames') for (let index = 0; index < 1025; index++) probe.stream.send(`data: ${index}\n\n`);
    else probe.stream.sendSnapshot(snapshot);
    expect(probe.stream.closed).toBe(true); expect(probe.cleanups).toBe(1);
    await connection.ended;
    expect(connection.text).toBe(': ready\n\n'); paused.release();
  });

  it('rejects a transport snapshot over 32 MiB without queuing any of its bytes', async () => {
    const instance = await fixture('probe'), session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toBe(': ready\n\n');
    const probe = instance.probes.get('main')!;
    expect(probe.stream.sendSnapshot(`data: ${'x'.repeat(32 * 1024 * 1024)}\n\n`)).toBe(false);
    probe.stream.send('data: {"type":"delta","threadId":"bounded","text":"still usable"}\n\n');
    await expect.poll(() => connection.text).toContain('still usable');
    expect(connection.text).toBe(': ready\n\ndata: {"type":"delta","threadId":"bounded","text":"still usable"}\n\n');
    expect(probe.stream.closed).toBe(false);
  });

  it('stops a partially delivered large transport snapshot when persisted authorization is revoked', async () => {
    const snapshot = `data: ${JSON.stringify({ type: 'snapshot', threadId: 'chunked-probe', content: '😀'.repeat(1_400_000) })}\n\n`;
    let written = 0, held = false;
    const instance = await fixture('probe', { streamMaxAgeMs: 300, streamTimeoutMs: 200 }, { inspect(response, route) {
      if (!route.startsWith('/probe/')) return;
      const write = response.write.bind(response);
      vi.spyOn(response, 'write').mockImplementation(((chunk: unknown, ...args: unknown[]) => {
        if (Buffer.isBuffer(chunk)) {
          // Hold the second real write in Node's native writable buffer. Merely
          // pausing the loopback reader can still let the kernel accept 5 MiB
          // before the next authority check, which is a valid earlier delivery.
          if (!held && written >= 64 * 1024) { held = true; response.cork(); }
          written += chunk.length;
        }
        return Reflect.apply(write, response, [chunk, ...args]);
      }) as typeof response.write);
    } });
    const session = await grant(instance), connection = await connect(instance, session, instance.route, true);
    const probe = instance.probes.get('main')!;
    expect(probe.stream.sendSnapshot(snapshot)).toBe(true);
    await expect.poll(() => written).toBeGreaterThan(64 * 1024);
    expect(written).toBeLessThan(Buffer.byteLength(snapshot));
    const denied = new Promise<void>(resolve => instance.ctx.events.once('auth:logout', () => resolve()));
    await new JsonStore(path.dirname(revokedPath(instance, session))).write(`revoked-${session.hash}`, {
      version: 2, epoch, hash: session.hash, expiresAt: session.expiresAt, revoked: true,
    });
    await denied; await expect.poll(() => probe.cleanups).toBe(1);
    const stoppedAt = written;
    connection.response.resume(); await connection.ended; await delay(30);
    expect(written).toBe(stoppedAt); expect(connection.cleanEnd).toBe(true);
    expect(connection.text.endsWith('\n\n')).toBe(false);
    expectNoSessionSubscribers(instance);
  });

  it('refuses an oversized previous-conversation record without streaming it or changing its saved bytes', async () => {
    const messages = history(360);
    expect(Buffer.byteLength(JSON.stringify(messages))).toBeGreaterThan(32 * 1024 * 1024);
    const instance = await fixture('thread', {}, { messages }), session = await grant(instance);
    const filename = path.join(instance.ctx.config.stateDir, `thread-${instance.threadId}.json`);
    const before = createHash('sha256').update(await fs.readFile(filename)).digest('hex');
    for (const route of [`/api/threads/${instance.threadId}`, instance.route]) {
      const response = await request(instance, route, { cookie: session.cookie });
      expect(response.status).toBe(409); expect(response.body.code).toBe('LEGACY_THREAD_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toContain('saved_user_');
    }
    expect(createHash('sha256').update(await fs.readFile(filename)).digest('hex')).toBe(before);
    expect(instance.bridge.calls).toEqual([]); expectNoSessionSubscribers(instance);
  });

  it('serves and revokes a bounded native window over a >32 MiB canonical-history fixture without replaying or mutating it', async () => {
    const messages = history(360), expected = messageProof(messages);
    expect(Buffer.byteLength(JSON.stringify(messages))).toBeGreaterThan(32 * 1024 * 1024);
    const instance = await fixture('native', { streamMaxAgeMs: 300, streamTimeoutMs: 200 }, { messages }), service = getCodexConversations(instance.ctx);
    const subscribe = service.subscribe.bind(service), unsubscribe = vi.fn();
    vi.spyOn(service, 'subscribe').mockImplementation(async (...args) => { const release = await subscribe(...args); unsubscribe.mockImplementation(release); return unsubscribe; });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text.endsWith('\n\n')).toBe(true);
    const received = events(connection); expect(received.map(event => event.type)).toEqual(['snapshot']);
    const recent = received[0].thread as Thread;
    expect(recent).toMatchObject({ id: NATIVE_THREAD, backend: 'codex-cli', readOnly: false });
    expect(recent.messages.map(message => message.id)).toEqual([messages.at(-1)!.id]); expect(recent.history).toBeUndefined();
    expect(recent.nativePage).toEqual({ nextCursor: `native opaque ${messages.length - 2} /+=?`, backwardsCursor: `native opaque ${messages.length - 1} /+=?` });
    expect(Buffer.byteLength(connection.text)).toBeLessThan(512 * 1024); expect(connection.cleanEnd).toBe(false);
    const older = await request(instance, `/api/threads/${NATIVE_THREAD}/history?before=${encodeURIComponent(recent.nativePage!.nextCursor!)}`, { cookie: session.cookie });
    expect(older.status).toBe(200); expect(Buffer.byteLength(JSON.stringify(older.body))).toBeLessThan(512 * 1024);
    expect((older.body as unknown as Thread).messages.map(message => message.id)).toEqual([messages.at(-2)!.id]);
    expect((older.body as unknown as Thread).history).toBeUndefined();
    const unsupportedDetail = await request(instance, `/api/threads/${NATIVE_THREAD}/history/detail?epoch=not-a-native-epoch&field=content&messageId=${messages.at(-1)!.id}`, { cookie: session.cookie });
    expect(unsupportedDetail.status).toBe(501); expect(unsupportedDetail.body.code).toBe('CODEX_DETAIL_UNAVAILABLE');
    instance.bridge.notifyTitle('Native title notification');
    await expect.poll(() => events(connection).filter(event => event.type === 'snapshot').length).toBe(2);
    expect((events(connection).at(-1)!.thread as Thread).title).toBe('Native title notification');
    expect(instance.bridge.calls.every(call => readMethods.has(call.method))).toBe(true);
    expect(instance.bridge.calls.filter(call => call.method === 'thread/items/list').every(call => call.params.limit === 1)).toBe(true);
    expect(messageProof(instance.bridge.messages)).toEqual(expected);
    const denied = new Promise<void>(resolve => instance.ctx.events.once('auth:logout', () => resolve()));
    await new JsonStore(path.dirname(revokedPath(instance, session))).write(`revoked-${session.hash}`, {
      version: 2, epoch, hash: session.hash, expiresAt: session.expiresAt, revoked: true,
    });
    await denied; await connection.ended;
    expect(unsubscribe).toHaveBeenCalledTimes(1); expect(connection.cleanEnd).toBe(true);
    const delivered = connection.text, rpcCount = instance.bridge.calls.length;
    instance.bridge.notifyTitle('AFTER_NATIVE_REVOCATION_SECRET'); await delay(30);
    expect(connection.text).toBe(delivered);
    for (const route of [instance.route, `/api/threads/${NATIVE_THREAD}/history?before=${encodeURIComponent(recent.nativePage!.nextCursor!)}`,
      `/api/threads/${NATIVE_THREAD}/history/detail?epoch=not-a-native-epoch&field=content&messageId=${messages[0].id}`]) {
      expect((await request(instance, route, { cookie: session.cookie })).status).toBe(401);
    }
    expect(instance.bridge.calls).toHaveLength(rpcCount); expect(messageProof(instance.bridge.messages)).toEqual(expected);
    expectNoSessionSubscribers(instance);
  });

});

describe('bounded SSE authority refresh and disposal', () => {
  it('checks authority once per lease, holds ordered frames during refresh, and coalesces progress', async () => {
    const instance = await fixture('probe', { streamMaxAgeMs: 300, streamTimeoutMs: 200 });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    const probe = instance.probes.get('main')!, paused = holdNextRevocationRead(instance, session);
    for (let index = 0; index < 100; index++) probe.stream.send(`data: hot-${index}\n\n`);
    await expect.poll(() => connection.text).toContain('hot-99');
    expect(paused.spy.mock.calls.filter(call => String(call[0]) === revokedPath(instance, session))).toHaveLength(0);
    await paused.arrived;
    for (let index = 0; index < 100; index++) probe.stream.sendLatest(`data: progress-${index}\n\n`);
    probe.stream.send('data: ordered-a\n\n'); probe.stream.send('data: ordered-b\n\n');
    await delay(20);
    expect(connection.text).not.toContain('progress-');
    expect(connection.text).not.toContain('ordered-');
    expect(paused.spy.mock.calls.filter(call => String(call[0]) === revokedPath(instance, session))).toHaveLength(1);
    paused.release();
    await expect.poll(() => connection.text).toContain('ordered-b');
    expect(connection.text.match(/data: progress-/g)).toHaveLength(1);
    expect(connection.text).toContain('data: progress-99\n\ndata: ordered-a\n\ndata: ordered-b\n\n');
  });

  it('fails closed on an authority timeout and cannot emit queued data when the late read succeeds', async () => {
    const instance = await fixture('probe', { streamMaxAgeMs: 150, streamTimeoutMs: 80 });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    const probe = instance.probes.get('main')!, paused = holdNextRevocationRead(instance, session);
    await paused.arrived;
    probe.stream.send('data: PENDING_SECRET\n\n');
    await connection.ended;
    expect(connection.cleanEnd).toBe(true); expect(probe.cleanups).toBe(1);
    paused.release(); await delay(50);
    expect(connection.text).not.toContain('PENDING_SECRET');
    expectNoSessionSubscribers(instance);
  });

  it('drops queued frames and a stale in-flight proof when logout occurs during revalidation', async () => {
    const instance = await fixture('probe', { streamMaxAgeMs: 300, streamTimeoutMs: 200 });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    const probe = instance.probes.get('main')!, paused = holdNextRevocationRead(instance, session);
    await paused.arrived; probe.stream.send('data: QUEUED_SECRET\n\n');
    expect((await request(instance, '/api/session', { method: 'DELETE', cookie: session.cookie })).status).toBe(200);
    await connection.ended;
    paused.release(); await delay(30);
    expect(connection.text).not.toContain('QUEUED_SECRET');
    expect(probe.cleanups).toBe(1);
  });

  it('bounds a pending event queue and releases its subscription before an authority read completes', async () => {
    const instance = await fixture('probe', { streamMaxAgeMs: 300, streamTimeoutMs: 200 });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    const probe = instance.probes.get('main')!, paused = holdNextRevocationRead(instance, session);
    await paused.arrived;
    for (let index = 0; index < 1100; index++) probe.stream.send(`data: QUEUED-${index}\n\n`);
    expect(probe.stream.closed).toBe(true); expect(probe.cleanups).toBe(1);
    await connection.ended;
    expect(connection.text).not.toContain('QUEUED-'); paused.release();
  });

  it('stops periodic reads and removes response/session listeners after a client disconnect', async () => {
    const instance = await fixture('probe', { streamMaxAgeMs: 100, streamTimeoutMs: 80 });
    const session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    const reads = vi.spyOn(fs, 'lstat');
    const count = () => reads.mock.calls.filter(call => String(call[0]) === revokedPath(instance, session)).length;
    await expect.poll(count).toBeGreaterThan(0);
    const probe = instance.probes.get('main')!; connection.response.destroy();
    await expect.poll(() => probe.cleanups).toBe(1);
    const endedCount = count(); await delay(350);
    expect(count()).toBe(endedCount);
    expect(probe.response.listenerCount('drain')).toBe(0);
    expectNoSessionSubscribers(instance);
  });

  it('releases a thread subscription that completes after its session expires', async () => {
    const instance = await fixture('thread'), engine = getCodexConversations(instance.ctx);
    const paused = gate(), original = engine.subscribe.bind(engine), unsubscribe = vi.fn();
    vi.spyOn(engine, 'subscribe').mockImplementation(async (id, listener) => {
      paused.signal(); await paused.blocked;
      // Exercise the route's late-disposer path even when an asynchronous
      // subscriber does not honor cancellation. The production subscriber's
      // abort-aware allocation is checked independently below.
      const release = await original(id, listener);
      unsubscribe.mockImplementation(release); return unsubscribe;
    });
    const session = await grant(instance, Date.now() + 400), connection = await connect(instance, session);
    await paused.arrived; await connection.ended;
    paused.release(); await expect.poll(() => unsubscribe.mock.calls.length).toBe(1);
    expect(connection.text).toBe(''); expect(connection.cleanEnd).toBe(true);
    expectNoSessionSubscribers(instance);
  });

  it('releases reserved thread stream capacity on session expiry while its authorized read is still pending', async () => {
    const instance = await fixture('thread'), engine = getCodexConversations(instance.ctx);
    const paused = gate(), originalGet = engine.get.bind(engine);
    vi.spyOn(engine, 'get').mockImplementationOnce(async id => {
      paused.signal(); await paused.blocked;
      return originalGet(id);
    });
    const session = await grant(instance, Date.now() + 400), connection = await connect(instance, session);
    await paused.arrived; await connection.ended;
    expect(connection.text).toBe(''); expect(connection.cleanEnd).toBe(true);
    expectNoSessionSubscribers(instance);
    // All eight per-thread slots must already be free, before the cancelled
    // read settles. Counting an eventual disposer would miss this leak.
    const stops: Array<() => void> = [];
    try {
      for (let index = 0; index < 8; index++) stops.push(await engine.subscribe(instance.threadId!, () => {}));
      await expect(engine.subscribe(instance.threadId!, () => {})).rejects.toMatchObject({ code: 'CODEX_STREAM_LIMIT' });
      paused.release(); await delay(30);
      expect(connection.text).toBe(''); expectNoSessionSubscribers(instance);
    } finally { for (const stop of stops) stop(); }
  });

  it('preserves a download subscription error as HTTP 429 and releases the reserved guard', async () => {
    const instance = await fixture('download'), session = await grant(instance);
    vi.spyOn(getDownloadService(instance.ctx), 'subscribe').mockImplementation(() => {
      throw new HttpError(429, 'Too many live download views are open.', 'DOWNLOAD_SUBSCRIBERS_FULL');
    });
    const response = await request(instance, instance.route, { cookie: session.cookie });
    expect(response.status).toBe(429); expect(response.body.code).toBe('DOWNLOAD_SUBSCRIBERS_FULL');
    expectNoSessionSubscribers(instance);
    expect(instance.ctx.events.listenerCount('download:changed')).toBe(0);
  });

  it('closes streams and clears queued callbacks when the authentication service shuts down', async () => {
    const instance = await fixture(), session = await grant(instance), connection = await connect(instance, session);
    await expect.poll(() => connection.text).toContain(': ready');
    await instance.auth.close(); await connection.ended;
    expect(connection.cleanEnd).toBe(true); expect(instance.probes.get('main')!.cleanups).toBe(1);
    expectNoSessionSubscribers(instance);
  });
});
