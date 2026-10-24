import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config';
import { createApplication } from '../server/index';

const index = '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/workspace.js"></script></body></html>';
const script = 'document.getElementById("root").textContent = "workspace fixture";';
let directory: string;
let application: Awaited<ReturnType<typeof createApplication>> | undefined;
let origin: string;
let cookie: string;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-web-routing-'));
  const distDir = path.join(directory, 'client');
  await fs.mkdir(path.join(distDir, 'assets'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(distDir, 'index.html'), index),
    fs.writeFile(path.join(distDir, 'assets', 'workspace.js'), script),
  ]);
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: path.join(directory, 'data'),
    RUNTIME_DIR: path.join(directory, 'runtime'), CLIENT_DIST_DIR: distDir,
    WORKSPACE_PASSWORD: 'web-routing-test-password', SESSION_SECRET: 'web-routing-test-session-secret-at-least-32',
    ENCRYPTION_KEY: 'web-routing-test-encryption-secret-at-least-32' });
  application = await createApplication(config);
  await new Promise<void>(resolve => application!.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(application.server.address() as AddressInfo).port}`;
  const login = await fetch(`${origin}/api/session`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' }, body: JSON.stringify({ password: config.password }) });
  expect(login.status).toBe(200);
  cookie = login.headers.get('set-cookie')!.split(';')[0];
});

afterAll(async () => {
  await application?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

describe('public status and built workspace routes', () => {
  it('always serves the literal root status regardless of session, query, Accept or conditional headers', async () => {
    for (const route of ['/', '/?workspace=linked-workspace&thread=native-child&view=agent', '/?view=editor&workspace=%00']) {
      const headers: HeadersInit[] = [
        { Accept: 'text/html' },
        { Cookie: cookie, Accept: 'application/json', 'If-None-Match': '*' },
        { Cookie: 'codex_session=invalid', Accept: 'text/plain', 'If-Modified-Since': 'Wed, 01 Jan 2031 00:00:00 GMT' },
      ];
      for (const requestHeaders of headers) {
        const response = await fetch(origin + route, { headers: requestHeaders, redirect: 'manual' });
        expect(response.status, route).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('location')).toBeNull();
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(await response.text()).toBe('status: ok');
      }
    }
  });

  it('serves /work and /work/ without redirecting or consuming focused-window query parameters', async () => {
    for (const route of ['/work', '/work/', '/work?workspace=linked-workspace&thread=native-child&view=agent',
      '/work/?workspace=linked-workspace&thread=%24new&view=editor']) {
      const response = await fetch(origin + route, { redirect: 'manual' });
      expect(response.status, route).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('location')).toBeNull();
      expect(response.url).toBe(origin + route);
      expect(await response.text()).toBe(index);
    }
    const unlocked = await fetch(`${origin}/work`, { headers: { Cookie: cookie, Accept: 'text/html' } });
    expect(unlocked.status).toBe(200);
    expect(await unlocked.text()).toBe(index);
  });

  it('keeps assets at their existing URLs and workspace APIs behind the existing session boundary', async () => {
    const asset = await fetch(`${origin}/assets/workspace.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(await asset.text()).toBe(script);
    expect(await (await fetch(`${origin}/health`)).json()).toEqual({ status: 'ok' });
    expect(await (await fetch(`${origin}/api/session`)).json()).toEqual({ authenticated: false });
    for (const route of ['/api/bootstrap', '/api/workspaces']) {
      expect((await fetch(origin + route)).status, route).toBe(401);
      expect((await fetch(origin + route, { headers: { Cookie: cookie } })).status, route).toBe(200);
    }
    const missing = await fetch(`${origin}/api/missing`, { headers: { Cookie: cookie, Accept: 'text/html' } });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
  });
});
