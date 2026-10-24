import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ZodError } from 'zod';
import { HttpError } from '../server/errors';
import { createNativeProcessesRouter } from '../server/codex-cli/features/processes';
import { FIRST_THREAD, SECOND_THREAD, pendingValue, processFixture, resourceSnapshot } from './native-processes-fixture';
import type { NativeProcessOutputPage, NativeProcessSession } from '../shared/native-processes';

// The parent mounts the router behind the existing authentication/same-origin
// middleware. These tests exercise the actual feature HTTP boundary and wire
// dispatch; they do not replace the separate site's authentication tests.
vi.mock('../server/host-resources', async original => ({ ...await original<typeof import('../server/host-resources')>(),
  observeHostResources: async () => resourceSnapshot() }));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });

async function fixture() {
  const fixture = await processFixture(), app = express();
  app.use(express.json({ limit: '128kb' })); app.use('/api', createNativeProcessesRouter(fixture.deps));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof ZodError ? 400 : error instanceof HttpError ? error.status : 500;
    res.status(status).json({ error: error.message, code: error instanceof HttpError ? error.code : 'INVALID_INPUT' });
  };
  app.use(errors);
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address unavailable.');
  const url = `http://127.0.0.1:${address.port}/api`;
  const request = (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', signal?: AbortSignal) => fetch(url + route, {
    method, signal, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fixture.close(); });
  return { ...fixture, url, request };
}
const base = '/workspaces/one/native/processes';

describe('native task HTTP authority and controls', () => {
  it('rejects arbitrary argv, paths, environment, raw RPC fields and unbounded settings before native dispatch', async () => {
    const { request, bridge } = await fixture();
    for (const body of [
      { kind: 'process', command: ['/bin/sh', '-c', 'true'] },
      { kind: 'command', command: 'true', cwd: '/etc' },
      { kind: 'process', command: 'true', env: { HOME: '/elsewhere' } },
      { kind: 'command', command: 'true', processId: 'chosen-by-browser' },
      { kind: 'process', command: 'true', processHandle: 'chosen-by-browser' },
      { kind: 'process', command: 'true', method: 'arbitrary/native/method' },
      { kind: 'command', command: 'true', disableTimeout: true },
      { kind: 'command', command: 'true', timeoutMs: 3_600_001 },
      { kind: 'command', command: 'true', tty: false, rows: 24 },
      { kind: 'process', command: 'x'.repeat(32_769) },
    ]) expect((await request(base, body)).status).toBe(400);
    expect((await request(base, { kind: 'process', command: 'docker ps' })).status).toBe(403);
    expect(bridge.calls).toEqual([]); expect(bridge.leases.size).toBe(0);
  });

  it('creates only owned handles, streams ordered output, controls PTY size/input, and stops the exact native process', async () => {
    const { request, bridge, ctx } = await fixture();
    const response = await request(base, { kind: 'process', command: 'cat', tty: true });
    expect(response.status).toBe(202); expect(response.headers.get('cache-control')).toContain('no-store');
    const task = await response.json() as NativeProcessSession;
    const native = bridge.calls.find(call => call.method === 'process/spawn')!.params;
    expect(native.processHandle).not.toBe(task.id);
    expect(native.cwd).toBe(`${ctx.config.workspacesDir}/one`);
    expect((native.command as string[]).slice(0, 2)).toEqual(['/usr/bin/env', '-i']);
    expect((native.command as string[]).slice(-3)).toEqual(['/bin/sh', '-c', 'cat']);
    for (const [stream, text] of [['stdout', 'one'], ['stderr', 'two'], ['stdout', 'three']]) {
      bridge.emit('process/outputDelta', { processHandle: native.processHandle, stream, deltaBase64: Buffer.from(text).toString('base64'), capReached: false });
    }
    const output = await (await request(`${base}/${task.id}/output?after=1`)).json() as NativeProcessOutputPage;
    expect(output.chunks.map(chunk => [chunk.sequence, chunk.stream, chunk.text])).toEqual([[2, 'stderr', 'two'], [3, 'stdout', 'three']]);
    expect((await request(`${base}/${task.id}/input`, { generation: task.generation, text: 'hello\r' })).status).toBe(200);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'process/writeStdin', params: { processHandle: native.processHandle, deltaBase64: 'aGVsbG8N', closeStdin: false } });
    expect((await request(`${base}/${task.id}/resize`, { generation: task.generation, rows: 40, cols: 120 })).status).toBe(200);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'process/resizePty', params: { processHandle: native.processHandle, size: { rows: 40, cols: 120 } } });
    expect((await request(`${base}/${task.id}/resize`, { generation: task.generation, rows: 40, cols: 5000 })).status).toBe(400);
    expect((await request(`${base}/${task.id}/stop`, { generation: task.generation })).status).toBe(200);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'process/kill', params: { processHandle: native.processHandle } });
    bridge.exit(String(native.processHandle), -1);
    expect((await request(`${base}/${task.id}`, {}, 'DELETE')).status).toBe(200);
    expect((await request(`${base}/${task.id}/output`)).status).toBe(404);
  });

  it('dispatches command controls separately, refuses foreign workspace handles and validates output cursors', async () => {
    const { request, bridge } = await fixture();
    const task = await (await request(base, { kind: 'command', command: 'cat', tty: true })).json() as NativeProcessSession;
    const native = bridge.calls.find(call => call.method === 'command/exec')!.params;
    expect((await request(`/workspaces/two/native/processes/${task.id}/stop`, { generation: task.generation })).status).toBe(404);
    expect((await request(`${base}/${task.id}/input`, { generation: 'old', text: 'hello' })).status).toBe(409);
    expect((await request(`${base}/${task.id}/output?after=9999999999999999`)).status).toBe(400);
    expect((await request(`${base}/${task.id}/output?after=1`)).status).toBe(409);
    expect((await request(`${base}/${task.id}/input`, { generation: task.generation, text: 'hello\r' })).status).toBe(200);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'command/exec/write', params: { processId: native.processId } });
    expect((await request(`${base}/${task.id}/resize`, { generation: task.generation, rows: 20, cols: 80 })).status).toBe(200);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'command/exec/resize', params: { processId: native.processId } });
    expect((await request(`${base}/${task.id}/stop`, { generation: task.generation })).status).toBe(200);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'command/exec/terminate', params: { processId: native.processId } });
  });

  it('requires exact workspace/thread authorization for native shell and background controls', async () => {
    const { request, bridge } = await fixture();
    const thread = `/workspaces/one/threads/${FIRST_THREAD}/native`, foreign = `/workspaces/one/threads/${SECOND_THREAD}/native`;
    expect((await request(`${foreign}/shell`, { generation: bridge.current, command: 'printf one' })).status).toBe(403);
    expect((await request(`${thread}/shell`, { generation: bridge.current, command: 'printf one', cwd: '/other' })).status).toBe(400);
    expect((await request(`${thread}/shell`, { generation: bridge.current, command: 'printf one', timeoutMs: 0 })).status).toBe(202);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'thread/shellCommand', params: { threadId: FIRST_THREAD, command: 'printf one', timeoutMs: 0 } });
    expect((await request(`${foreign}/background-terminals`)).status).toBe(403);
    expect((await request(`${thread}/background-terminals?limit=101`)).status).toBe(400);
    expect((await request(`${foreign}/background-terminals/stop-all`, { generation: bridge.current })).status).toBe(403);
    expect((await request(`${thread}/background-terminals/stop-all`, { generation: bridge.current })).status).toBe(200);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'thread/backgroundTerminals/clean', params: { threadId: FIRST_THREAD } });
  });

  it('cancels a disconnected creation while admission is pending without dispatching a process', async () => {
    const { request, bridge, ctx } = await fixture(), entered = pendingValue<void>(), gate = pendingValue<void>();
    const resolvePath = ctx.workspaces.resolvePath.bind(ctx.workspaces);
    vi.spyOn(ctx.workspaces, 'resolvePath').mockImplementation(async (id, relative, options) => { entered.resolve(); await gate.promise; return resolvePath(id, relative, options); });
    const controller = new AbortController();
    const response = request(base, { kind: 'process', command: 'cat' }, 'POST', controller.signal).catch(error => error as Error);
    await entered.promise; controller.abort(); expect(await response).toBeInstanceOf(Error);
    await new Promise<void>(resolve => setImmediate(resolve)); gate.resolve();
    await vi.waitFor(() => expect(bridge.leases.size).toBe(0));
    expect(bridge.calls).toEqual([]);
  });
});
