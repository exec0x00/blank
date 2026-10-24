#!/usr/bin/env node
// Read-only persistence checkpoint. The only hosted mutations are opening and
// closing this verifier's own temporary PTY; it never restores working files.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const argv = process.argv.slice(2);
const phase = argv[0];
const help = `Usage:
  node scripts/verify-persistence.mjs before [--baseline /tmp/checkpoint.json] [--proof /tmp/before-proof.json]
  node scripts/verify-persistence.mjs after --baseline /tmp/checkpoint.json [--proof /tmp/after-proof.json] [--expected-revision SHA]
Options:
  --state PATH              Original mode-0600 verify-live state (contains the existing cookie).
  --allow-change SCOPE      Acknowledge one reported concurrent change in after mode; repeat as needed.
                            Scopes: file:RELATIVE_PATH, ui-state, settings, root-thread,
                            active-workspace, workspace-registry, github-accounts, current-head.
Exit 0: immutable checks pass and comparison has no unacknowledged changes.
Exit 2: immutable checks pass but current working data differs; inspect the proof.
Exit 1: an actual verification prerequisite or immutable history check failed.
This command never repairs files, changes selections, logs in, or uses a Hub token.`;
if (argv.includes('--help') || !phase) { console.log(help); process.exit(0); }
if (!['before', 'after'].includes(phase)) throw new Error('Use before or after.');
const options = new Map();
const allowedChanges = new Set();
for (let index = 1; index < argv.length; index += 2) {
  const key = argv[index];
  const value = argv[index + 1];
  if (!['--state', '--baseline', '--proof', '--expected-revision', '--allow-change'].includes(key) || !value || value.startsWith('--')) {
    throw new Error('Invalid verifier argument. Use --help.');
  }
  if (key === '--allow-change') allowedChanges.add(value);
  else if (options.has(key)) throw new Error('An option was supplied more than once.');
  else options.set(key, value);
}
if (phase === 'before' && allowedChanges.size) throw new Error('Only after mode accepts acknowledged changes.');
const sourceRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const originalPath = path.resolve(options.get('--state') || path.join(os.tmpdir(), 'codex-workspace-live-verification.json'));
const baselinePath = path.resolve(options.get('--baseline') || path.join(os.tmpdir(), 'codex-workspace-persistence-baseline.json'));
const proofPath = path.resolve(options.get('--proof') || path.join(os.tmpdir(), `codex-workspace-persistence-${phase}-proof.json`));
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(sortObject(value));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
  return value;
}
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function outsideSource(filename) {
  requireCondition(filename !== sourceRoot && !filename.startsWith(sourceRoot + path.sep), 'Keep checkpoint files outside source.');
}
async function privateJson(filename) {
  outsideSource(filename);
  const stat = await fs.lstat(filename);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'Checkpoint inputs must be ordinary mode-0600 files.');
  requireCondition(stat.size < 24 * 1024 * 1024, 'Checkpoint input exceeds the size limit.');
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}
async function writeExclusive(filename, value, mode) {
  outsideSource(filename);
  requireCondition(filename !== originalPath && filename !== baselinePath || filename === baselinePath && phase === 'before', 'Refusing to replace an input checkpoint.');
  await fs.writeFile(filename, JSON.stringify(value, null, 2) + '\n', { mode, flag: 'wx' });
  await fs.chmod(filename, mode);
}

function request(url, { method = 'GET', cookie, body, origin } = {}) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const call = transport.request(url, { method, agent: false,
      headers: { Accept: 'application/json', ...(origin ? { Origin: origin, 'X-Codex-Workspace': '1' } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}) },
    }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 12 * 1024 * 1024) call.destroy(new Error('Verification response exceeded its limit.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { data = null; }
        resolve({ status: response.statusCode, data });
      });
    });
    call.setTimeout(45_000, () => call.destroy(new Error('A verification request timed out.')));
    call.on('error', reject);
    if (encoded) call.write(encoded);
    call.end();
  });
}

// This exact program runs in the actual hosted instance. It returns digests and
// metadata only. No shell echo or expected marker is accepted as an assertion.
async function inspectHost(input) {
  let crypto;
  const frame = result => process.stdout.write(String.fromCharCode(30) + 'PERSISTENCE:' + input.nonce + ':'
    + Buffer.from(JSON.stringify(result)).toString('base64') + String.fromCharCode(31) + '\n');
  try {
    const [fs, nodeFs, path, cryptoModule, childProcess, util] = await Promise.all([
      import('node:fs/promises'), import('node:fs'), import('node:path'), import('node:crypto'), import('node:child_process'), import('node:util'),
    ]);
    crypto = cryptoModule;
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    const execFile = util.promisify(childProcess.execFile);
    const workspace = input.workspacePath;
    if (await fs.realpath(process.cwd()) !== workspace || await fs.realpath(workspace) !== workspace) throw new Error('WORKSPACE_PATH_MISMATCH');
    const mountLines = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n');
    const mounted = mountLines.map(line => line.split(' ')).find(parts => parts[4] === '/data');
    const nativeMount = { mounted: Boolean(mounted), path: '/data',
      filesystem: mounted ? mounted[mounted.indexOf('-') + 1] : null,
      readOnly: mounted ? mounted[5].split(',').includes('ro') : null };
    const git = async args => {
      const { stdout } = await execFile('git', ['-c', 'core.fsmonitor=false', ...args], {
        cwd: workspace, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 20_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
      });
      return stdout;
    };
    const commitBytes = await git(['cat-file', 'commit', input.commit]);
    const objectAlgorithm = input.commit.length === 40 ? 'sha1' : 'sha256';
    const objectId = (kind, bytes) => crypto.createHash(objectAlgorithm).update(kind + ' ' + bytes.length + '\0').update(bytes).digest('hex');
    if (objectId('commit', commitBytes) !== input.commit) throw new Error('ORIGINAL_COMMIT_OBJECT_MISMATCH');
    const tree = (await git(['ls-tree', '-z', '--full-tree', input.commit, '--', ...Object.keys(input.expectedFiles)])).toString('utf8').split('\0').filter(Boolean);
    const blobs = [];
    for (const line of tree) {
      const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(line);
      if (!match || !input.expectedFiles[match[3]]) throw new Error('ORIGINAL_TREE_ENTRY_INVALID');
      const [, mode, oid, relative] = match;
      const bytes = await git(['cat-file', 'blob', oid]);
      const expected = input.expectedFiles[relative];
      if (objectId('blob', bytes) !== oid || hash(bytes) !== expected.sha256 || bytes.length !== expected.size) {
        throw new Error('ORIGINAL_BLOB_MISMATCH');
      }
      blobs.push({ path: relative, oid, mode, size: bytes.length, sha256: hash(bytes), originalBytesMatch: true });
    }
    if (blobs.length !== Object.keys(input.expectedFiles).length) throw new Error('ORIGINAL_BLOB_MISSING');
    const currentHead = (await git(['rev-parse', '--verify', 'HEAD'])).toString('utf8').trim();
    const entries = [];
    const changedWhileReading = [];
    let bytesRead = 0;
    const started = Date.now();
    const directoryFlags = nodeFs.constants.O_RDONLY | nodeFs.constants.O_DIRECTORY | nodeFs.constants.O_NOFOLLOW;
    const fileFlags = nodeFs.constants.O_RDONLY | nodeFs.constants.O_NOFOLLOW | nodeFs.constants.O_NONBLOCK;
    const walk = async (handle, relative, absolute, depth) => {
      if (depth > 64 || Date.now() - started > 60_000) throw new Error('INVENTORY_LIMIT');
      const access = '/proc/self/fd/' + handle.fd;
      if (await fs.realpath(access) !== absolute) throw new Error('DIRECTORY_MOVED_DURING_READ');
      const before = await handle.stat();
      const children = (await fs.readdir(access, { withFileTypes: true })).filter(child => !(relative === '' && child.name === '.git')).sort((a, b) => a.name.localeCompare(b.name));
      entries.push({ path: relative, kind: 'directory', mode: (before.mode & 0o7777).toString(8).padStart(4, '0'),
        empty: children.length === 0, children: children.length, mtimeMs: before.mtimeMs });
      for (const child of children) {
        if (entries.length > 10_000 || bytesRead > 128 * 1024 * 1024) throw new Error('INVENTORY_LIMIT');
        const childPath = relative ? relative + '/' + child.name : child.name;
        const entryPath = access + '/' + child.name;
        const stat = await fs.lstat(entryPath);
        const item = { path: childPath, mode: (stat.mode & 0o7777).toString(8).padStart(4, '0'), mtimeMs: stat.mtimeMs };
        if (stat.isSymbolicLink()) {
          const target = await fs.readlink(entryPath);
          entries.push({ ...item, kind: 'symlink', target, size: Buffer.byteLength(target), sha256: hash(Buffer.from(target)) });
        } else if (stat.isDirectory()) {
          const nested = await fs.open(entryPath, directoryFlags);
          try { await walk(nested, childPath, path.join(absolute, child.name), depth + 1); }
          finally { await nested.close(); }
        } else if (stat.isFile()) {
          if (stat.size > 32 * 1024 * 1024 || bytesRead + stat.size > 128 * 1024 * 1024) throw new Error('INVENTORY_LIMIT');
          const file = await fs.open(entryPath, fileFlags);
          try {
            const opened = await file.stat();
            if (!opened.isFile()) throw new Error('FILE_TYPE_CHANGED_DURING_READ');
            const digest = crypto.createHash('sha256');
            let size = 0;
            for await (const chunk of file.createReadStream({ autoClose: false })) {
              size += chunk.length; bytesRead += chunk.length;
              if (size > 32 * 1024 * 1024 || bytesRead > 128 * 1024 * 1024) throw new Error('INVENTORY_LIMIT');
              digest.update(chunk);
            }
            const after = await file.stat();
            if (opened.ino !== stat.ino || opened.mtimeMs !== after.mtimeMs || opened.size !== after.size || size !== after.size) changedWhileReading.push(childPath);
            entries.push({ ...item, kind: 'file', size, sha256: digest.digest('hex') });
          } finally { await file.close(); }
        } else entries.push({ ...item, kind: 'special' });
      }
      if (await fs.realpath(access) !== absolute) throw new Error('DIRECTORY_MOVED_DURING_READ');
      if ((await handle.stat()).mtimeMs !== before.mtimeMs) changedWhileReading.push(relative || '.');
    };
    const root = await fs.open(workspace, directoryFlags);
    try { await walk(root, '', workspace, 0); } finally { await root.close(); }
    frame({ ok: true, historyDisabled: process.env.HISTFILE === undefined && process.env.PROMPT_COMMAND === undefined,
      nativeMount, originalHistory: { commit: input.commit, commitObjectSha256: hash(commitBytes), commitObjectVerified: true, blobs },
      currentHead, entries: entries.sort((a, b) => a.path.localeCompare(b.path)), changedWhileReading,
      inspection: { bytesRead, entryCount: entries.length, excluded: ['.git internals: immutable commit and blobs checked separately'] } });
  } catch (error) {
    frame({ ok: false, code: typeof error?.message === 'string' && /^[A-Z_]+$/.test(error.message) ? error.message : error?.code || 'HOST_INSPECTION_FAILED' });
    process.exitCode = 1;
  }
}

async function inspectPty(state, api, base, payload) {
  const terminal = await api(`/workspaces/${state.workspaceId}/terminals`, 'POST', {});
  requireCondition(typeof terminal.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(terminal.id), 'The temporary terminal ID is invalid.');
  let socket;
  try {
    const nonce = randomUUID();
    const source = `(${inspectHost.toString()})(${JSON.stringify({ ...payload, nonce })})`;
    const encoded = Buffer.from(source).toString('base64');
    requireCondition(encoded.length < 60 * 1024, 'The inspection command exceeds its size limit.');
    // A PTY can still be in canonical mode when it first becomes ready. Keep
    // each input line below the kernel line limit and acknowledge execution of
    // each chunk, rather than dropping a long pasted command into that race.
    const commands = ['unset HISTFILE PROMPT_COMMAND; set +o history; stty -echo; codex_persistence_payload='];
    for (let offset = 0; offset < encoded.length; offset += 2000) {
      commands.push(`codex_persistence_payload=$codex_persistence_payload'${encoded.slice(offset, offset + 2000)}'`);
    }
    const finalCommand = `node -e 'eval(Buffer.from(process.argv[1],"base64").toString("utf8"))' "$codex_persistence_payload"; unset codex_persistence_payload\r`;
    const url = new URL(`/ws/terminal/${terminal.id}`, base);
    url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    return await new Promise((resolve, reject) => {
      let settled = false; let sent = false; let output = ''; let acknowledged = -1; let executing = false;
      const prefix = '\x1ePERSISTENCE:' + nonce + ':';
      const stepMarker = step => '\x1ePERSISTENCE-STEP:' + nonce + ':' + step + '\x1f';
      const sendStep = step => socket.send(JSON.stringify({ type: 'input',
        data: commands[step] + `; printf '\\036PERSISTENCE-STEP:${nonce}:${step}\\037'\r` }));
      const complete = (error, value) => {
        if (settled) return; settled = true; clearTimeout(deadline);
        if (error) reject(error); else resolve(value);
      };
      const deadline = setTimeout(() => { socket?.terminate(); complete(new Error(`Read-only host inspection timed out (ready=${sent}, acknowledgedSteps=${acknowledged + 1}, executing=${executing}).`)); }, 120_000);
      socket = new WebSocket(url, { headers: { Cookie: state.cookie, Origin: base.origin }, agent: false, perMessageDeflate: false, handshakeTimeout: 30_000 });
      socket.on('message', raw => {
        let message; try { message = JSON.parse(raw.toString()); } catch { return; }
        if (message.type === 'ready' && !sent) { sent = true; sendStep(0); }
        if (message.type === 'output' && typeof message.data === 'string') {
          output += message.data;
          if (output.length > 8 * 1024 * 1024) { complete(new Error('The inspection frame exceeded its size limit.')); return; }
          if (!executing && output.includes(stepMarker(acknowledged + 1))) {
            acknowledged++;
            if (acknowledged + 1 < commands.length) sendStep(acknowledged + 1);
            else { executing = true; socket.send(JSON.stringify({ type: 'input', data: finalCommand })); }
          }
          const start = output.indexOf(prefix);
          const end = start < 0 ? -1 : output.indexOf('\x1f', start + prefix.length);
          if (start >= 0 && end >= 0) {
            try {
              const payload = output.slice(start + prefix.length, end).replace(/[\r\n]/g, '');
              requireCondition(/^[a-zA-Z0-9+/=]+$/.test(payload), 'The inspection frame is invalid.');
              const result = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
              requireCondition(result.ok === true, `Host inspection failed: ${result.code || 'unknown check'}.`);
              complete(null, result);
            } catch (error) { complete(error); }
          }
        }
        if (message.type === 'exit') complete(new Error('The temporary shell exited before returning a validated inspection frame.'));
      });
      socket.once('error', () => complete(new Error('The authenticated inspection terminal failed.')));
      socket.once('close', () => complete(new Error('The inspection terminal disconnected before returning its frame.')));
    });
  } finally {
    socket?.close();
    await api(`/terminals/${terminal.id}`, 'DELETE');
  }
}

function compactState(observed) {
  const { bootstrap, uiState, thread } = observed;
  const preferences = { version: uiState.version, revision: uiState.revision, sha256: digest(canonical(uiState)),
    layoutsSha256: digest(canonical(uiState.layouts)), editorSha256: digest(canonical(uiState.editor)),
    workspacePreferencesSha256: digest(canonical(uiState.workspaces)), fieldRevisionsSha256: digest(canonical(uiState.fieldRevisions)) };
  return {
    uiState: preferences,
    settings: { sha256: digest(canonical(bootstrap.settings)) },
    activeWorkspace: { id: bootstrap.activeWorkspaceId },
    workspaceRegistry: { count: bootstrap.workspaces.length, sha256: digest(canonical(bootstrap.workspaces)) },
    githubAccounts: { count: bootstrap.githubAccounts.length, sha256: digest(canonical(bootstrap.githubAccounts)) },
    rootThread: { id: thread.id, workspaceId: thread.workspaceId, parentThreadId: thread.parentThreadId || null,
      rootThreadId: thread.rootThreadId || null, createdAt: thread.createdAt, updatedAt: thread.updatedAt, status: thread.status,
      titleSha256: digest(String(thread.title)), messageCount: thread.messages.length, sha256: digest(canonical(thread)) },
  };
}
function comparableFile(entry) {
  if (!entry) return null;
  const { path, kind, mode, sha256, size, target, empty } = entry;
  return { path, kind, mode, ...(sha256 ? { sha256 } : {}), ...(kind !== 'directory' && size !== undefined ? { size } : {}),
    ...(target === undefined ? {} : { target }), ...(kind === 'directory' ? { empty } : {}) };
}
function differences(before, after) {
  const result = [];
  const add = (scope, oldValue, newValue) => {
    if (canonical(oldValue) !== canonical(newValue)) result.push({ scope, before: oldValue, after: newValue, acknowledged: allowedChanges.has(scope) });
  };
  const oldFiles = new Map(before.host.entries.map(entry => [entry.path, entry]));
  const newFiles = new Map(after.host.entries.map(entry => [entry.path, entry]));
  for (const name of [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()) add('file:' + (name || '.'), comparableFile(oldFiles.get(name)), comparableFile(newFiles.get(name)));
  add('current-head', before.host.currentHead, after.host.currentHead);
  for (const [scope, key] of [['ui-state', 'uiState'], ['settings', 'settings'], ['root-thread', 'rootThread'],
    ['active-workspace', 'activeWorkspace'], ['workspace-registry', 'workspaceRegistry'], ['github-accounts', 'githubAccounts']]) add(scope, before.state[key], after.state[key]);
  return result;
}

async function main() {
  for (const filename of [originalPath, baselinePath, proofPath]) outsideSource(filename);
  requireCondition(proofPath !== baselinePath && proofPath !== originalPath && baselinePath !== originalPath, 'Use distinct checkpoint and proof paths.');
  // Refuse to overwrite either an old baseline or an existing proof.
  for (const filename of phase === 'before' ? [baselinePath, proofPath] : [proofPath]) {
    await fs.access(filename).then(() => { throw new Error('An output checkpoint already exists; choose another path.'); }, error => { if (error.code !== 'ENOENT') throw error; });
  }
  const original = await privateJson(originalPath);
  requireCondition(typeof original.cookie === 'string' && original.cookie && !/[\r\n]/.test(original.cookie), 'The original checkpoint has no usable cookie.');
  requireCondition(/^[a-f0-9]{40,64}$/.test(original.commit) && /^[a-zA-Z0-9_-]{1,128}$/.test(original.workspaceId)
    && /^[a-zA-Z0-9_-]{1,128}$/.test(original.threadId) && original.workspacePath === '/data/workspaces/' + original.workspaceId,
  'The original checkpoint identifiers are invalid.');
  const base = new URL(original.space);
  requireCondition(base.protocol === 'https:' && !base.username && !base.password && base.origin === original.space, 'Use the exact HTTPS Space origin from the original proof.');
  const api = async (route, method = 'GET', body) => {
    const url = new URL('/api' + route, base);
    requireCondition(url.origin === base.origin, 'Refusing a cross-origin session request.');
    const result = await request(url, { cookie: original.cookie, method, body, origin: base.origin });
    requireCondition(result.status >= 200 && result.status < 300, `Read-only verifier request ${method} returned HTTP ${result.status}.`);
    return result.data;
  };
  const expectedBytes = {
    'verification.txt': { bytes: Buffer.from(original.content), gitMode: '100644' },
    'terminal-created.txt': { bytes: Buffer.from('created by a real hosted PTY\n'), gitMode: '100644' },
    'executable.sh': { bytes: Buffer.from('#!/bin/sh\nprintf preserved\n'), gitMode: '100755' },
    'pointer.txt': { bytes: Buffer.from('verification.txt'), gitMode: '120000' },
  };
  const expectedFiles = Object.fromEntries(Object.entries(expectedBytes).map(([name, record]) => [name, { sha256: digest(record.bytes), size: record.bytes.length, gitMode: record.gitMode }]));
  const session = await api('/session');
  requireCondition(session.authenticated === true, 'The saved original session is no longer valid; no login was attempted.');
  const [storage, bootstrap, uiState, thread, spaceResponse, bucketResponse] = await Promise.all([
    api('/storage'), api('/bootstrap'), api('/ui-state'), api('/threads/' + original.threadId),
    request(new URL('https://huggingface.co/api/spaces/alvin3y12/codex-workspace')),
    request(new URL('https://huggingface.co/api/buckets/alvin3y12/data')),
  ]);
  requireCondition(storage.path === '/data' && storage.persistent === true && storage.writable === true
    && storage.metadata?.initialized === true && storage.metadata.error === null, 'The native storage or metadata status is not ready.');
  requireCondition(thread.id === original.threadId && thread.workspaceId === original.workspaceId && !thread.parentThreadId
    && Array.isArray(thread.messages), 'The original saved root thread is unavailable or has a different identity.');
  requireCondition(uiState.version === 1 && Number.isSafeInteger(uiState.revision) && uiState.revision >= 0, 'Canonical UI preferences are unavailable.');
  requireCondition(bootstrap.workspaces.some(item => item.id === original.workspaceId && item.path === original.workspacePath), 'The original workspace registration is missing.');
  const info = spaceResponse.data;
  const bucket = bucketResponse.data;
  requireCondition(spaceResponse.status === 200 && bucketResponse.status === 200 && info.private === false && bucket.private === false,
    'The Space and data bucket must both remain public.');
  requireCondition(info.runtime?.stage === 'RUNNING' && info.sha === info.runtime.sha, 'The source replacement has not settled on a running revision.');
  const volume = info.runtime.volumes?.find(volume => volume.type === 'bucket' && volume.source === 'alvin3y12/data' && volume.mountPath === '/data');
  requireCondition(volume && volume.readOnly !== true, 'The native read-write bucket attachment is missing.');
  if (options.has('--expected-revision')) requireCondition(info.runtime.sha === options.get('--expected-revision'), 'The expected source revision is not running.');
  console.error('Persistence checkpoint: original session, saved root thread, canonical preferences, and native storage endpoints verified; inspecting immutable Git objects and current files.');
  const host = await inspectPty(original, api, base, { workspacePath: original.workspacePath, commit: original.commit, expectedFiles });
  requireCondition(host.historyDisabled === true, 'The temporary inspection process did not have shell history disabled.');
  requireCondition(host.nativeMount.mounted === true && host.nativeMount.readOnly === false, 'The host does not have a writable native /data mount.');
  requireCondition(host.changedWhileReading.length === 0, 'The working tree changed during collection; no stable baseline was claimed. Run again after those writes settle.');
  const [finalUiState, finalBootstrap, finalThread] = await Promise.all([api('/ui-state'), api('/bootstrap'), api('/threads/' + original.threadId)]);
  const finalSpace = await request(new URL('https://huggingface.co/api/spaces/alvin3y12/codex-workspace'));
  requireCondition(finalSpace.status === 200 && finalSpace.data?.sha === info.sha && finalSpace.data?.runtime?.sha === info.runtime.sha
    && finalSpace.data?.runtime?.stage === 'RUNNING', 'The deployed revision changed during collection; no mixed-revision checkpoint was recorded.');
  const initial = compactState({ bootstrap, uiState, thread });
  const final = compactState({ bootstrap: finalBootstrap, uiState: finalUiState, thread: finalThread });
  const duringCollection = Object.keys(initial).filter(key => canonical(initial[key]) !== canonical(final[key]));
  const collectedAt = new Date().toISOString();
  const checkpoint = {
    version: 1, phase, collectedAt, space: base.origin, workspaceId: original.workspaceId, threadId: original.threadId,
    originalProof: { createdAt: original.createdAt, commit: original.commit, sha256: digest(canonical(original)) },
    deployment: { repositoryRevision: info.sha, runningRevision: info.runtime.sha, stage: info.runtime.stage, spacePublic: true, bucketPublic: true,
      volume: { source: volume.source, mountPath: volume.mountPath, readOnly: volume.readOnly === true } },
    session: { originalCookieStillValid: true, loginAttempted: false },
    storage: { path: storage.path, persistent: storage.persistent, writable: storage.writable, bucket: storage.bucket,
      metadataInitialized: storage.metadata.initialized, metadataError: storage.metadata.error, metadataIssueCount: storage.metadata.issueCount },
    host, state: final, duringCollection,
    scope: { workspaceFilesWritten: false, preferencesWritten: false, selectionChanged: false, temporaryPtyOnly: true,
      historyDisabled: true, treeScope: 'Registered verification workspace, except separately verified .git internals.' },
  };
  const workingTreeVsOriginal = Object.entries(expectedFiles).map(([name, expected]) => {
    const current = host.entries.find(entry => entry.path === name);
    return { path: name, originalSha256: expected.sha256, currentSha256: current?.sha256 || null,
      originalSize: expected.size, currentSize: current?.size ?? null, originalBytesStillInWorkingTree: current?.sha256 === expected.sha256,
      immutableOriginalBlobVerified: true };
  });
  let changes = [];
  let sourceReplaced = null;
  if (phase === 'after') {
    const baseline = await privateJson(baselinePath);
    requireCondition(baseline.version === 1 && baseline.phase === 'before' && baseline.space === checkpoint.space
      && baseline.workspaceId === checkpoint.workspaceId && baseline.originalProof.sha256 === checkpoint.originalProof.sha256,
    'The baseline belongs to a different original verification record.');
    requireCondition(canonical(baseline.host.originalHistory) === canonical(host.originalHistory), 'Immutable history differs from the current baseline.');
    sourceReplaced = baseline.deployment.runningRevision !== checkpoint.deployment.runningRevision;
    requireCondition(sourceReplaced, 'After mode requires a different running source revision.');
    changes = differences(baseline, checkpoint);
    for (const allowed of allowedChanges) requireCondition(changes.some(change => change.scope === allowed), 'An acknowledged scope has no actual difference; remove the unused --allow-change.');
  }
  const proof = {
    ...checkpoint, workingTreeVsOriginal, sourceReplaced, changes,
    verdict: changes.some(change => !change.acknowledged) ? 'unacknowledged-working-state-changes' : duringCollection.length ? 'state-changed-during-observation' : phase === 'before' ? 'current-baseline-recorded' : 'persistence-verified-with-reported-changes',
    interpretation: 'The original commit and blob bytes are immutable history checks. Current working files are a separate observation; differences are reported, never restored or attributed to a cause without additional evidence.',
  };
  if (phase === 'before') await writeExclusive(baselinePath, checkpoint, 0o600);
  await writeExclusive(proofPath, proof, 0o644);
  console.log(JSON.stringify({ phase, verdict: proof.verdict, baselinePath, proofPath, runningRevision: info.runtime.sha,
    immutableHistory: 'verified', originalSession: 'valid', workingTreeEntries: host.entries.length,
    workingFilesDifferingFromOriginal: workingTreeVsOriginal.filter(record => !record.originalBytesStillInWorkingTree).map(record => record.path),
    changes: changes.map(({ scope, acknowledged }) => ({ scope, acknowledged })), duringCollection }));
  if (changes.some(change => !change.acknowledged) || duringCollection.length) process.exitCode = 2;
}

main().catch(error => {
  // Deliberately omit request bodies, cookies, raw terminal output, and file bytes.
  console.error('Persistence checkpoint failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
