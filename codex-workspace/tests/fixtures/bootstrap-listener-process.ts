import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer, Server } from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { BootstrapListener } from '../../server/bootstrap-listener';
import { loadConfig } from '../../server/config';

const mode = process.argv[2];
const send = (value: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(value)}\n`);
const config = loadConfig();
const inherited = config.bootstrapListener!;
const originals = new Map([inherited.fd, inherited.readyFd].map(fd => [fd, fs.fstatSync(fd)]));
const closed = (fd: number): boolean => {
  try { const current = fs.fstatSync(fd); const original = originals.get(fd)!; return current.dev !== original.dev || current.ino !== original.ino; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EBADF'; }
};
const sentinel = path.join(process.env.BOOTSTRAP_TEST_DIR!, 'retained-descriptor.txt');
fs.writeFileSync(sentinel, 'retained descriptor bytes');

async function simple() {
  if (mode.startsWith('invalid-')) {
    assert.throws(() => new BootstrapListener(inherited, config.port), /configuration is invalid/);
    assert.equal(closed(inherited.fd), false); assert.equal(closed(inherited.readyFd), false);
    send({ kind: 'checked', invalidPreserved: true });
    return;
  }
  const activation = new BootstrapListener(inherited, config.port);
  const server = createServer((_req, res) => res.end('owned inherited listener'));
  let reused: number | undefined;
  try {
    if (mode === 'reuse-listener') {
      fs.closeSync(inherited.fd); reused = fs.openSync(sentinel, 'r');
      assert.equal(reused, inherited.fd);
      assert.throws(() => activation.listen(server), /configuration is invalid/);
    } else if (mode === 'listen-failure') {
      server.listen = (() => { throw new Error('Injected listen failure.'); }) as typeof server.listen;
      assert.throws(() => activation.listen(server), /Injected listen failure/);
    } else {
      const listening = once(server, 'listening');
      activation.listen(server); await listening;
      if (mode === 'ready-changed-flags') {
        execFileSync('python3', ['-c', 'import os; os.set_blocking(3, True)'], { stdio: ['ignore', 'ignore', 'pipe', inherited.readyFd] });
      } else {
        fs.closeSync(inherited.readyFd); reused = fs.openSync(sentinel, 'r');
        assert.equal(reused, inherited.readyFd);
      }
      assert.throws(() => activation.signalReady(), /readiness handoff failed/);
    }
  } finally {
    activation.close(); activation.close();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (reused !== undefined) {
    assert.equal(fs.readFileSync(reused, 'utf8'), 'retained descriptor bytes');
    fs.closeSync(reused);
  }
  send({ kind: 'checked', ownedClosed: closed(inherited.fd) && closed(inherited.readyFd), reusedPreserved: reused !== undefined });
}

async function application() {
  // An ordinary grandchild must receive neither activation environment nor the
  // parent's private pipe/socket. Compare identity, since FD numbers get reused.
  const identities = [inherited.fd, inherited.readyFd].map(fd => {
    const stat = fs.fstatSync(fd); return { fd, ino: stat.ino, dev: stat.dev };
  });
  const descendants = JSON.parse(execFileSync(process.execPath, ['-e', `
    const fs = require('fs');
    const supplied = JSON.parse(process.argv[1]);
    const leaked = supplied.some(({fd, ino, dev}) => {
      try { const value = fs.fstatSync(fd); return value.ino === ino && value.dev === dev; } catch { return false; }
    });
    process.stdout.write(JSON.stringify({ leaked, privateEnvironment: Object.keys(process.env).some(key => key.startsWith('CODEX_BOOTSTRAP_')) }));
  `, JSON.stringify(identities)], { encoding: 'utf8' }));
  assert.deepEqual(descendants, { leaked: false, privateEnvironment: false });
  const { AuthService } = await import('../../server/auth');
  const { FileMetadataManager } = await import('../../server/file-metadata');
  let authClosed = 0; let metadataClosed = 0;
  const closeAuth = AuthService.prototype.close;
  AuthService.prototype.close = async function () { authClosed++; await closeAuth.call(this); };
  const closeMetadata = FileMetadataManager.prototype.close;
  FileMetadataManager.prototype.close = async function () { metadataClosed++; await closeMetadata.call(this); };
  if (mode === 'initialize-failure') {
    const initialize = AuthService.prototype.initialize;
    AuthService.prototype.initialize = async function () { await initialize.call(this); throw new Error('Injected initialization failure.'); };
  }
  if (mode === 'application-listen-failure') {
    Server.prototype.listen = function (this: Server) {
      queueMicrotask(() => this.emit('error', new Error('Injected inherited listen failure.')));
      return this;
    } as typeof Server.prototype.listen;
  }
  const { startApplication } = await import('../../server/index');
  if (mode !== 'application') {
    await assert.rejects(startApplication(config), mode === 'initialize-failure' ? /Injected initialization failure/
      : mode === 'application-listen-failure' ? /Injected inherited listen failure/ : /readiness handoff failed/);
    assert.equal(authClosed, 1); assert.equal(metadataClosed, 1);
    assert.equal(closed(inherited.fd), true); assert.equal(closed(inherited.readyFd), true);
    send({ kind: 'checked', ownedClosed: true, runtimeClosed: true, descendants });
    return;
  }
  const runtime = await startApplication(config);
  try {
    assert.equal(runtime.server.listening, true);
    assert.equal(closed(inherited.readyFd), true);
    assert.equal('bootstrapListener' in runtime.ctx.config, false);
    const [workspace] = await runtime.ctx.workspaces.list();
    const threadId = 'thr_12345678901234567890123456789012';
    const timestamp = new Date().toISOString();
    await runtime.ctx.store.write(`thread-${threadId}`, { thread: {
      id: threadId, workspaceId: workspace.id, title: 'Inherited listener stream', status: 'idle',
      createdAt: timestamp, updatedAt: timestamp, messages: [{ id: 'bootstrap-retained-message', role: 'assistant', content: 'Retained stream bytes.', createdAt: timestamp }], turns: [],
    }, input: [], revision: 1 });
    send({ kind: 'application-ready', workspaceId: workspace.id, threadId, descendants });
    const input = createInterface({ input: process.stdin });
    const stopping = new Promise<void>(resolve => {
      input.once('line', () => resolve()); input.once('close', resolve); process.once('SIGTERM', () => resolve());
    });
    try { await stopping; } finally { input.close(); }
  } finally { await runtime.close(); }
  assert.equal(authClosed, 1); assert.equal(metadataClosed, 1);
  send({ kind: 'checked', ownedClosed: closed(inherited.fd) && closed(inherited.readyFd), runtimeClosed: true });
}

try {
  if (['application', 'initialize-failure', 'application-listen-failure', 'ready-closed', 'ready-full'].includes(mode)) await application();
  else await simple();
} catch (error) {
  console.error(error); process.exitCode = 1;
}
