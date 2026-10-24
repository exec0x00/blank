import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import express, { type ErrorRequestHandler } from 'express';
import { UiStateClient } from '../client/ui-state';
import { ApiError } from '../client/api';
import type { UiState, UiStatePatch } from '../shared/types';
import { AuthService } from '../server/auth';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { createUiStateRouter } from '../server/ui-state';
import { WorkspaceService } from '../server/workspaces';

const password = 'pane-state-fixture-password';
type Reply = { status: number; cookie?: string; value: unknown };
type Fixture = { ctx: AppContext; origin: string; request(route: string, options?: { method?: string; body?: unknown; cookie?: string; origin?: string }): Promise<Reply>; close(): Promise<void> };
let directory: string;
let runtime: string;
let fixture: Fixture;
let cookie: string;
const clients: UiStateClient[] = [];

async function createFixture(): Promise<Fixture> {
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, RUNTIME_DIR: runtime, WORKSPACE_PASSWORD: password,
    SESSION_SECRET: 'pane-state-fixture-session-secret-not-a-real-key-12345', ENCRYPTION_KEY: 'pane-state-fixture-account-secret-not-a-real-key-12345' });
  const store = new JsonStore(config.stateDir);
  const ctx: AppContext = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    workspaces: new WorkspaceService(config, store), settings: async () => defaultSettings, saveSettings: async () => defaultSettings,
    providerKey: async () => undefined };
  const auth = new AuthService(ctx);
  await auth.initialize();
  const app = express();
  app.use('/api', auth.protectMutations);
  app.use('/api/session', express.json({ limit: '4kb' }));
  app.use('/api', auth.router());
  app.use('/api', auth.requireSession, express.json({ limit: '64kb' }), createUiStateRouter(ctx));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) res.status(error.status).json({ error: error.message, code: error.code });
    else res.status(500).json({ error: 'Pane preference fixture failure.' });
  };
  app.use(errors);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind.');
  const origin = `http://127.0.0.1:${address.port}`;
  const request: Fixture['request'] = (route, options = {}) => new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = httpRequest(`${origin}/api${route}`, { method: options.method || 'GET', agent: false,
      headers: { Origin: options.origin ?? origin, 'X-Codex-Workspace': '1', ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => {
        try { resolve({ status: response.statusCode || 0, cookie: response.headers['set-cookie']?.[0]?.split(';')[0], value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.once('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Fixture request timeout.'))); req.end(body);
  });
  let closed = false;
  return { ctx, origin, request, close: async () => {
    if (closed) return; closed = true;
    await auth.close(); await store.flush();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

async function login() {
  const reply = await fixture.request('/session', { method: 'POST', body: { password } });
  expect(reply.status).toBe(200);
  if (!reply.cookie) throw new Error('No session cookie.');
  return reply.cookie;
}
async function read() {
  const reply = await fixture.request('/ui-state', { cookie });
  expect(reply.status).toBe(200);
  return reply.value as UiState;
}
function makeClient() {
  const client = new UiStateClient(async (patch?: UiStatePatch) => {
    const reply = await fixture.request('/ui-state', { cookie, ...(patch ? { method: 'PATCH', body: patch } : {}) });
    if (reply.status !== 200) { const error = reply.value as { error: string; code: string }; throw new ApiError(error.error, reply.status, error.code); }
    return reply.value as UiState;
  }, undefined, 60_000);
  client.setSession(true);
  clients.push(client);
  return client;
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-pane-state-data-'));
  runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-pane-state-runtime-'));
  fixture = await createFixture(); cookie = await login();
});
afterEach(async () => {
  clients.splice(0).forEach(client => client.dispose());
  await fixture?.close();
  await Promise.all([fs.rm(directory, { recursive: true, force: true }), fs.rm(runtime, { recursive: true, force: true })]);
});

describe('durable pane preferences', () => {
  it('saves both layouts through the real client and restores them after a new service and empty browser cache', async () => {
    const first = makeClient(); await first.hydrate(await read(), [], 'desktop');
    first.change([
      { section: 'layout', profile: 'desktop', key: 'agentWidthRatio', value: 0.43 },
      { section: 'layout', profile: 'desktop', key: 'explorerWidth', value: 312 },
      { section: 'layout', profile: 'laptop', key: 'agentWidthRatio', value: 0.37 },
      { section: 'layout', profile: 'laptop', key: 'explorerWidth', value: 208 },
    ]);
    await first.flush();
    const saved = await read();
    expect(saved.layouts.desktop).toMatchObject({ agentWidthRatio: 0.43, explorerWidth: 312 });
    expect(saved.layouts.laptop).toMatchObject({ agentWidthRatio: 0.37, explorerWidth: 208 });
    expect(JSON.parse(await fs.readFile(path.join(fixture.ctx.config.stateDir, 'ui-state.json'), 'utf8'))).toEqual(saved);
    await fixture.close();
    await fs.rm(runtime, { recursive: true, force: true });
    fixture = await createFixture(); cookie = await login();
    const second = makeClient(); await second.hydrate(await read(), [], 'laptop');
    expect(second.getSnapshot().value.layouts).toEqual(saved.layouts);
    expect(second.getSnapshot().value.workspaces).toEqual({});
  });

  it('rejects malformed sizes and cross-origin writes without modifying previously saved panes', async () => {
    const valid = { revision: 0, changes: [{ section: 'layout', profile: 'desktop', key: 'explorerWidth', value: 280 }] };
    expect((await fixture.request('/ui-state', { method: 'PATCH', cookie, body: valid })).status).toBe(200);
    const saved = await read();
    for (const [key, value] of [['agentWidthRatio', -1], ['agentWidthRatio', 0.9], ['agentWidthRatio', '0.4'], ['agentWidthRatio', null],
      ['explorerWidth', 159], ['explorerWidth', 721], ['explorerWidth', 220.2], ['explorerWidth', { width: 240 }]]) {
      expect((await fixture.request('/ui-state', { method: 'PATCH', cookie,
        body: { revision: saved.revision, changes: [{ section: 'layout', profile: 'desktop', key, value }] } })).status).toBe(400);
    }
    expect((await fixture.request('/ui-state', { method: 'PATCH', cookie, origin: 'https://other.invalid', body: { ...valid, revision: saved.revision } })).status).toBe(403);
    expect((await fixture.request('/ui-state', { method: 'PATCH', body: valid })).status).toBe(401);
    expect(await read()).toEqual(saved);
  });

  it('merges independently resized boundaries while rejecting a stale competing resize of the same boundary', async () => {
    const first = makeClient(); const second = makeClient();
    const original = await read(); await first.hydrate(original, [], 'desktop'); await second.hydrate(original, [], 'desktop');
    first.change([{ section: 'layout', profile: 'desktop', key: 'agentWidthRatio', value: 0.42 }]);
    second.change([{ section: 'layout', profile: 'desktop', key: 'explorerWidth', value: 296 }]);
    await first.flush(); await second.flush();
    expect((await read()).layouts.desktop).toMatchObject({ agentWidthRatio: 0.42, explorerWidth: 296 });
    const competing = await fixture.request('/ui-state', { method: 'PATCH', cookie,
      body: { revision: 0, changes: [{ section: 'layout', profile: 'desktop', key: 'agentWidthRatio', value: 0.62 }] } });
    expect(competing.status).toBe(409);
    expect((await read()).layouts.desktop).toMatchObject({ agentWidthRatio: 0.42, explorerWidth: 296 });
  });
});
