#!/usr/bin/env node
// Real hosted smoke/restart verification. All credentials stay outside source.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const phase = args[0] || 'create';
if (!['create', 'verify'].includes(phase)) throw new Error('Use create or verify.');
const base = new URL(option('--url', process.env.SPACE_URL || 'https://alvin3y12-codex-workspace.hf.space'));
if (base.username || base.password || (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Use an HTTPS Space URL.');
const statePath = path.resolve(option('--state', path.join(os.tmpdir(), 'codex-workspace-live-verification.json')));
const sourceRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
if (statePath === sourceRoot || statePath.startsWith(sourceRoot + path.sep)) throw new Error('Verification state must be stored outside source.');
const credentialsFile = option('--credentials-file');
let password = process.env.WORKSPACE_PASSWORD;
if (credentialsFile) {
  const stat = await fs.stat(credentialsFile);
  if (stat.mode & 0o077) throw new Error('Credentials file must have mode 0600.');
  password ||= JSON.parse(await fs.readFile(credentialsFile, 'utf8')).workspacePassword;
}

function request(route, { method = 'GET', body, cookie } = {}) {
  const url = new URL(route, base);
  if (url.origin !== base.origin) throw new Error('Refusing a cross-origin credential request.');
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method, agent: false,
      headers: { Origin: base.origin, 'X-Codex-Workspace': '1', ...(cookie ? { Cookie: cookie } : {}), ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}) },
    }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) req.destroy(new Error('Oversized verification response.')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { data = undefined; }
        resolve({ status: response.statusCode, data, headers: response.headers });
      });
    });
    req.setTimeout(45_000, () => req.destroy(new Error('Hosted request timed out.')));
    req.on('error', reject);
    if (encoded) req.write(encoded);
    req.end();
  });
}
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
async function api(route, cookie, method = 'GET', body) {
  const response = await request(`/api${route}`, { method, body, cookie });
  requireCondition(response.status >= 200 && response.status < 300, `${method} ${route} returned ${response.status}: ${response.data?.error || 'unexpected response'}`);
  return response.data;
}
async function shell(cookie, workspaceId, commands, expected) {
  const terminal = await api(`/workspaces/${workspaceId}/terminals`, cookie, 'POST', {});
  const socketUrl = new URL(`/ws/terminal/${terminal.id}`, base); socketUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket;
  try {
    return await new Promise((resolve, reject) => {
      let output = '';
      let sent = false;
      let settled = false;
      const deadline = setTimeout(() => { socket?.terminate(); reject(new Error('The hosted terminal did not return the expected command output.')); }, 30_000);
      socket = new WebSocket(socketUrl, { headers: { Cookie: cookie, Origin: base.origin }, agent: false });
      socket.once('error', error => { clearTimeout(deadline); reject(error); });
      socket.on('message', raw => {
        let message; try { message = JSON.parse(raw.toString()); } catch { return; }
        if (message.type === 'ready' && !sent) {
          sent = true;
          socket.send(JSON.stringify({ type: 'resize', cols: 100, rows: 28 }));
          socket.send(JSON.stringify({ type: 'input', data: commands + '\r' }));
        }
        if (message.type === 'output') {
          output = (output + message.data).slice(-150_000);
          if (!settled && expected.every(text => output.includes(text))) { settled = true; clearTimeout(deadline); resolve(true); socket.close(); }
        }
        if (message.type === 'exit' && !settled) { settled = true; clearTimeout(deadline); reject(new Error(`The hosted verification shell exited with code ${message.exitCode} before its assertions passed.`)); }
      });
      socket.once('close', () => { if (!settled) { settled = true; clearTimeout(deadline); reject(new Error('The terminal disconnected before verification completed.')); } });
    });
  } finally {
    socket?.close();
    await api(`/terminals/${terminal.id}`, cookie, 'DELETE');
  }
}

requireCondition((await request('/health')).data?.status === 'ok', 'The hosted application is not healthy.');
requireCondition((await request('/api/bootstrap')).status === 401, 'Anonymous workspace access must be rejected.');

if (phase === 'create') {
  requireCondition(password, 'Supply WORKSPACE_PASSWORD or an external --credentials-file.');
  try { await fs.access(statePath); throw new Error('A verification state already exists; use verify with it or choose another --state path.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const login = await request('/api/session', { method: 'POST', body: { password } });
  requireCondition(login.status === 200 && login.data?.authenticated, 'Hosted password sign-in failed.');
  const cookie = login.headers['set-cookie']?.find(value => value.startsWith('codex_workspace_session='))?.split(';')[0];
  requireCondition(cookie, 'The server did not issue a workspace session.');
  const storage = await api('/storage', cookie);
  requireCondition(storage.persistent && storage.writable && storage.path === '/data', 'The native data volume is not ready.');
  const marker = randomUUID();
  const workspace = await api('/workspaces', cookie, 'POST', { name: 'Persistence verification', initializeGit: true });
  const content = `Arc Workspace hosted persistence check\nVerification: ${marker}\nThis ordinary text file is intentionally unencrypted in the public data bucket.\n`;
  await api(`/workspaces/${workspace.id}/files`, cookie, 'POST', { path: 'verification.txt', kind: 'file' });
  await api(`/workspaces/${workspace.id}/file`, cookie, 'PUT', { path: 'verification.txt', content });
  const thread = await api('/threads', cookie, 'POST', { workspaceId: workspace.id, title: 'Saved across a Space restart' });
  const commands = "set -e; printf 'LIVE_PTY_%s\\n' 'OK'; printf '__CWD_%s__\\n' \"$PWD\"; printf 'created by a real hosted PTY\\n' > terminal-created.txt; mkdir empty-folder; printf '#!/bin/sh\\nprintf preserved\\n' > executable.sh; chmod 755 executable.sh; ln -s verification.txt pointer.txt; printf 'LIVE_SETUP_%s\\n' 'DONE'";
  await shell(cookie, workspace.id, commands, ['LIVE_PTY_OK', `__CWD_${workspace.path}__`, 'LIVE_SETUP_DONE']);
  await api(`/workspaces/${workspace.id}/git/stage`, cookie, 'POST', { paths: ['verification.txt', 'terminal-created.txt', 'executable.sh', 'pointer.txt'] });
  const commit = await api(`/workspaces/${workspace.id}/git/commit`, cookie, 'POST', { message: 'Verify native bucket persistence' });
  const state = { space: base.origin, workspaceId: workspace.id, workspacePath: workspace.path, threadId: thread.id, content, marker, cookie, commit: commit.commit, createdAt: new Date().toISOString(), bucketPaths: [`workspaces/${workspace.id}/verification.txt`, 'codex-workspace/state/sessions.json', 'codex-workspace/state/filesystem-metadata.json'] };
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ stage: 'created', workspaceId: workspace.id, fileAndPtyAndGit: 'passed', statePath, next: 'Confirm matching bucket bytes and metadata, restart the Space once, then run verify with this state file.' }));
} else {
  const stat = await fs.stat(statePath);
  requireCondition((stat.mode & 0o077) === 0, 'Verification state must have mode 0600.');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  requireCondition(state.space === base.origin, 'Verification state belongs to a different Space.');
  requireCondition(typeof state.commit === 'string' && /^[a-f0-9]{40,64}$/.test(state.commit), 'Verification state contains an invalid Git commit.');
  requireCondition((await api('/session', state.cookie)).authenticated, 'The saved session did not survive the restart.');
  const file = await api(`/workspaces/${state.workspaceId}/file?path=verification.txt`, state.cookie);
  requireCondition(file.content === state.content, 'Saved file bytes changed across restart.');
  const terminalFile = await api(`/workspaces/${state.workspaceId}/file?path=terminal-created.txt`, state.cookie);
  requireCondition(terminalFile.content === 'created by a real hosted PTY\n', 'Terminal-created data did not survive restart.');
  const thread = await api(`/threads/${state.threadId}`, state.cookie);
  requireCondition(thread.title === 'Saved across a Space restart', 'Conversation metadata did not survive restart.');
  const git = await api(`/workspaces/${state.workspaceId}/git/status`, state.cookie);
  const originalFiles = new Set(['verification.txt', 'terminal-created.txt', 'executable.sh', 'pointer.txt']);
  requireCondition(git.isRepository && git.files.every(file => !originalFiles.has(file.path)), 'An original verification file or mode changed across restart.');
  // The owner may keep additional work or make new commits while checking the
  // app. Prove the original Git object survives without rejecting their work.
  await shell(state.cookie, state.workspaceId, "set -e; test -L pointer.txt; test -x executable.sh; test -d empty-folder; test \"$(git cat-file -t '" + state.commit + "')\" = commit; printf 'LIVE_RESTART_%s\\n' 'OK'", ['LIVE_RESTART_OK']);
  const storage = await api('/storage', state.cookie);
  requireCondition(storage.persistent && storage.metadata?.initialized && !storage.metadata?.error, 'Native storage metadata recovery reported an error.');
  console.log(JSON.stringify({ stage: 'verified-after-restart', passwordSession: 'passed', ordinaryFiles: 'passed', terminalFiles: 'passed', gitCommit: 'passed', symlinkAndExecutableAndEmptyFolder: 'passed', savedThread: 'passed', workspaceId: state.workspaceId }));
}
