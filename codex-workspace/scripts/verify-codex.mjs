#!/usr/bin/env node
// Authenticated hosted verification. This helper never reads a password/HF token,
// changes the active workspace, or executes against an unverified release SHA.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const LIVE = new Set(['running', 'awaiting_approval', 'awaiting_input']);
const WORKING = new Set(['running', 'waiting']);
const MODEL = 'gpt-5.6-cyber';
const EFFORT = 'max';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const THREAD = /^thr_[a-f0-9]{32}$/;
const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

export function ownedWorkspace(workspace, expectedName) {
  return !!workspace && UUID.test(workspace.id) && workspace.name === expectedName
    && workspace.path === `/data/workspaces/${workspace.id}`;
}
export function pendingFixtureChanges(changes, workspaceId, family, expected) {
  return changes.filter(change => change.status === 'pending' && change.workspaceId === workspaceId
    && family.has(change.threadId) && Object.hasOwn(expected, change.path)
    && change.original === null && change.modified === expected[change.path]);
}
function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function argument(args, name, fallback) {
  const offset = args.indexOf(name);
  if (offset < 0) return fallback;
  if (!args[offset + 1] || args[offset + 1].startsWith('--')) throw new Error(`${name} requires a value.`);
  return args[offset + 1];
}
function clean(value, cookie = '') {
  const text = String(value ?? '');
  return (cookie ? text.replaceAll(cookie, '[redacted]') : text)
    .replace(/codex_workspace_session=[^\s;"']+/g, 'codex_workspace_session=[redacted]')
    .replace(/\b(?:hf_|gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}\b/g, '[redacted]');
}

async function loadSession(location) {
  const stat = await fs.lstat(location);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 8192,
    'Use a regular mode-0600 session JSON file containing only base and cookie.');
  const handle = await fs.open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
  let session;
  try { session = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
  requireCondition(Object.keys(session).every(key => ['base', 'cookie'].includes(key)) && typeof session.base === 'string'
    && typeof session.cookie === 'string' && session.cookie.length > 0 && session.cookie.length <= 4096 && !/[\r\n]/.test(session.cookie),
  'The private session file must contain only base and cookie strings.');
  const base = new URL(session.base);
  requireCondition(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/',
    'The saved session must use a plain HTTPS origin without URL credentials.');
  return { base: base.origin, cookie: session.cookie };
}

function requestJson(url, { cookie, method = 'GET', body, timeoutMs = 30_000, allowStatus = [] } = {}) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, agent, headers: {
      Accept: 'application/json', ...(cookie ? { Cookie: cookie, Origin: url.origin, 'X-Codex-Workspace': '1' } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}),
    } }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) req.destroy(new Error('Hosted verification response exceeded its bound.'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const status = res.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          if (allowStatus.includes(status)) { resolve({ status, data: undefined }); return; }
          const error = new Error(`Hosted ${method} ${url.pathname} returned HTTP ${status}.`);
          error.status = status; reject(error); return;
        }
        try { resolve({ status, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { reject(new Error(`Hosted ${url.pathname} returned invalid JSON.`)); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Hosted ${method} ${url.pathname} timed out; its outcome must be observed, not replayed.`)));
    req.once('error', reject); req.end(encoded);
  });
}

function observeEvents(base, cookie, threadId, onEvent) {
  let req, ended = false, initial = false, total = 0, buffer = '';
  const decoder = new StringDecoder('utf8');
  const summary = { threadId, connected: false, snapshots: 0, eventCounts: {}, errors: [], ended: false };
  const ready = new Promise((resolve, reject) => {
    req = https.request(new URL(`/api/threads/${threadId}/events`, base), { method: 'GET', agent,
      headers: { Cookie: cookie, Origin: base, Accept: 'text/event-stream' } }, res => {
      if (res.statusCode !== 200 || !String(res.headers['content-type']).includes('text/event-stream')) {
        res.resume(); reject(new Error(`Thread event stream returned HTTP ${res.statusCode}.`)); return;
      }
      summary.connected = true;
      res.on('data', chunk => {
        total += chunk.length; buffer += decoder.write(chunk);
        if (total > 16 * 1024 * 1024 || buffer.length > 4 * 1024 * 1024) { req.destroy(new Error('Thread event stream exceeded its verification bound.')); return; }
        let separator;
        while ((separator = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, separator.index); buffer = buffer.slice(separator.index + separator[0].length);
          const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          try {
            const event = JSON.parse(data);
            if (event.threadId !== threadId) throw new Error('The event stream changed conversation identity.');
            summary.eventCounts[event.type] = (summary.eventCounts[event.type] ?? 0) + 1;
            if (event.type === 'snapshot') {
              summary.snapshots++;
              if (!initial) { initial = true; resolve(); }
            }
            onEvent(event);
          } catch (error) { summary.errors.push(clean(error.message, cookie)); req.destroy(); }
        }
      });
      res.on('end', () => { ended = true; summary.ended = true; if (!initial) reject(new Error('The thread stream ended before its snapshot.')); });
      res.on('error', error => { ended = true; summary.ended = true; if (!initial) reject(error); else summary.errors.push(clean(error.message, cookie)); });
    });
    req.setTimeout(25_000, () => req.destroy(new Error('The thread stream stopped delivering heartbeats.')));
    req.on('error', error => { ended = true; summary.ended = true; if (!initial) reject(error); else summary.errors.push(clean(error.message, cookie)); });
    req.end();
  });
  return { ready, summary, get ended() { return ended; }, close() { ended = true; req?.destroy(); } };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/verify-codex.mjs --ready-sha <RUNNING release SHA> [--session /tmp/codex-api-benchmark-session.json] [--report /tmp/codex-hosted-runtime-evidence.json]\nRun only after the coordinator announces the new release. Creates one isolated workspace; never changes global preferences. Undo applies only to still-pending, unchanged verification additions. Existing Keep/Undo decisions are preserved.');
    return;
  }
  if (args.includes('--self-test')) {
    const id = '12345678-1234-4234-9234-123456789abc';
    assert(ownedWorkspace({ id, name: 'proof', path: `/data/workspaces/${id}` }, 'proof'));
    assert(!ownedWorkspace({ id, name: 'user project', path: `/data/workspaces/${id}` }, 'proof'));
    assert(!ownedWorkspace({ id, name: 'proof', path: '/data/workspaces/other' }, 'proof'));
    const fixture = { id: 'own', workspaceId: id, threadId: 'root', path: 'alpha.txt', original: null, modified: 'alpha\n', status: 'pending' };
    const selected = pendingFixtureChanges([fixture, { ...fixture, id: 'kept', status: 'kept' }, { ...fixture, id: 'foreign', threadId: 'user-thread' }, { ...fixture, id: 'edited', modified: 'manual edit' }, { ...fixture, id: 'existing', original: 'user source' }], id, new Set(['root']), { 'alpha.txt': 'alpha\n' });
    assert.deepEqual(selected.map(item => item.id), ['own']);
    assert.equal(clean('example codex_workspace_session=do-not-log'), 'example codex_workspace_session=[redacted]');
    console.log('Offline ownership, review-selection, and redaction checks passed. No network requests were made.'); return;
  }
  const allowed = new Set(['--ready-sha', '--session', '--report', '--space', '--run-timeout-ms']);
  for (let i = 0; i < args.length; i += 2) requireCondition(allowed.has(args[i]) && args[i + 1], 'Unknown or incomplete verification option.');
  const expectedSha = argument(args, '--ready-sha');
  requireCondition(/^[a-f0-9]{40}$/.test(expectedSha ?? ''), 'Supply --ready-sha only after the coordinator confirms that release is RUNNING.');
  const space = argument(args, '--space', 'alvin3y12/codex-workspace');
  requireCondition(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(space), 'Use an owner/Space identifier.');
  const sessionPath = path.resolve(argument(args, '--session', path.join(os.tmpdir(), 'codex-api-benchmark-session.json')));
  const reportPath = path.resolve(argument(args, '--report', path.join(os.tmpdir(), `codex-hosted-runtime-${Date.now()}.json`)));
  requireCondition(reportPath !== sessionPath, 'The report must not overwrite the private session file.');
  const maximumRunMs = Number(argument(args, '--run-timeout-ms', '240000'));
  requireCondition(Number.isSafeInteger(maximumRunMs) && maximumRunMs >= 30_000 && maximumRunMs <= 600_000, 'Use a run deadline from 30000 to 600000 milliseconds.');
  const session = await loadSession(sessionPath);
  requireCondition(new URL(session.base).hostname === `${space.replace('/', '-').toLowerCase()}.hf.space`, 'The session and selected Space do not match.');
  const receipt = await fs.open(reportPath, 'wx', 0o600);
  await receipt.close();
  const started = Date.now(), marker = randomUUID().replaceAll('-', '').slice(0, 12);
  const report = { schema: 'codex-hosted-runtime-v1', transport: 'actual authenticated HTTP/SSE', mockedModelResponses: false,
    startedAt: new Date(started).toISOString(), expectedSha, space, passed: false, phase: 'release-gate', checks: {}, observations: [], streams: [] };
  const save = async () => { await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 }); await fs.chmod(reportPath, 0o600); };
  const api = async (route, method = 'GET', body, options = {}) => (await requestJson(new URL(`/api${route}`, session.base), { cookie: session.cookie, method, body, ...options })).data;
  const streams = new Map(), seenAgents = new Map(); let peakWorking = 0, owned, thread, runSubmitted = false;
  const updateAgents = values => {
    for (const value of values) if (value && typeof value.id === 'string') {
      const previous = seenAgents.get(value.id);
      if (previous?.updatedAt && value.updatedAt && previous.updatedAt > value.updatedAt) continue;
      seenAgents.set(value.id, value);
    }
    peakWorking = Math.max(peakWorking, [...seenAgents.values()].filter(value => WORKING.has(value.status)).length);
  };
  const startStream = id => {
    if (streams.has(id)) return streams.get(id);
    const observer = observeEvents(session.base, session.cookie, id, event => {
      if (id !== thread?.id) return; // Child replay snapshots cannot fabricate an overlap in the root timeline.
      if (event.type === 'agent_change') updateAgents([event.agent]);
      if (event.type === 'snapshot' && Array.isArray(event.thread?.agents)) updateAgents(event.thread.agents);
    });
    streams.set(id, observer); report.streams.push(observer.summary);
    return observer;
  };
  try {
    const info = (await requestJson(new URL(`https://huggingface.co/api/spaces/${space}`))).data;
    const runtimeSha = info.runtime?.sha;
    report.release = { repositorySha: info.sha, runtimeSha, stage: info.runtime?.stage, public: info.private === false };
    requireCondition(info.sha === expectedSha && runtimeSha === expectedSha && info.runtime?.stage === 'RUNNING' && info.private === false,
      'The expected public release is not proven RUNNING. No workspace was created.');
    requireCondition((await api('/session')).authenticated === true, 'The saved session expired; refresh the private session file before verification.');
    const bootstrap = await api('/bootstrap');
    report.activeWorkspaceBefore = bootstrap.activeWorkspaceId;
    await api('/extensions'); // Fail before mutations if an old release lacks native extension/agent integration.
    report.checks.authenticatedRelease = true;
    const workspaceName = `Native Codex verification ${marker}`;
    report.workspaceName = workspaceName; report.phase = 'creating-workspace'; await save();
    owned = await api('/workspaces', 'POST', { name: workspaceName, initializeGit: false });
    requireCondition(ownedWorkspace(owned, workspaceName), 'Unexpected verification workspace identity; no files or conversations were changed.');
    report.workspace = { id: owned.id, name: owned.name, path: owned.path }; await save();
    const createdBootstrap = await api('/bootstrap');
    report.activeWorkspaceAfterCreate = createdBootstrap.activeWorkspaceId;
    report.checks.noActiveWorkspaceMutation = true; // This helper never sends active:true or edits UI/settings state.
    report.observations.push(createdBootstrap.activeWorkspaceId === bootstrap.activeWorkspaceId ? 'Active workspace unchanged after isolated creation.' : 'Active workspace changed independently; its new selection was preserved.');
    thread = await api('/threads', 'POST', { workspaceId: owned.id });
    requireCondition(THREAD.test(thread.id) && thread.workspaceId === owned.id, 'Unexpected verification conversation identity.');
    report.rootThreadId = thread.id; report.phase = 'observing-before-run'; await save();
    await startStream(thread.id).ready;
    const expected = { 'alpha.txt': `ALPHA_NATIVE_OK_${marker}\n`, 'beta.txt': `BETA_NATIVE_OK_${marker}\n` };
    const hostMarker = `HOST_CONCURRENT_OK_${marker}`;
    const code = `const fs=require('node:fs');for(const [name,expected] of ${JSON.stringify(Object.entries(expected))}){if(fs.readFileSync(name,'utf8')!==expected)throw new Error('Unexpected fixture bytes: '+name)}process.stdout.write(${JSON.stringify(hostMarker + '\n')});`;
    const command = `node -e ${shellQuote(code)}`;
    const prompt = `Verify native parallel agents in this isolated workspace. Spawn exactly two worker agents named alpha and beta before waiting for either. Give alpha ownership ONLY of alpha.txt, whose exact UTF-8 content must be ${JSON.stringify(expected['alpha.txt'])}; give beta ownership ONLY of beta.txt with exact content ${JSON.stringify(expected['beta.txt'])}. Each child must use write_file with expected_version:null to create its fresh file, then read_file to verify it, and report the result. If either file already exists, leave it untouched and report a conflict; never overwrite or patch an existing file. Inherit ${MODEL} and max reasoning, with no model/effort override. No nested agents, extra files, installations, Git, or unrelated work. Do not do the workers' edits yourself. Collect both actual worker results with wait_agent. Finally execute this exact Node command using exec_command (do not modify the command):\n${command}\nFinish with the verified host result. Do not rename this conversation manually. Mandatory host rules apply: no proxies, filesystem mounts, proot, Docker, or containers.`;
    report.expectedFiles = expected; report.model = MODEL; report.reasoningEffort = EFFORT; report.permissionMode = 'full-access';
    report.phase = 'submitting-run'; runSubmitted = true; await save();
    try { report.run = await api(`/threads/${thread.id}/run`, 'POST', { prompt, mode: 'agent', permissionMode: 'full-access', model: MODEL, reasoningEffort: EFFORT }); }
    catch (error) {
      if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
      report.submissionObservation = clean(error.message, session.cookie);
    } // Never replay an uncertain POST.
    report.phase = 'observing-run'; await save();
    const deadline = Date.now() + maximumRunMs; let terminal, failures = 0;
    while (Date.now() < deadline) {
      try {
        const [current, children] = await Promise.all([api(`/threads/${thread.id}`), api(`/threads/${thread.id}/agents`)]);
        failures = 0; updateAgents(children);
        for (const child of children) if (!streams.has(child.id)) startStream(child.id).ready.catch(error => report.observations.push(clean(error.message, session.cookie)));
        if (!LIVE.has(current.status) && current.messages.some(message => message.role === 'user' && message.content.includes(marker))) { terminal = current; break; }
      } catch (error) {
        if ([401, 403, 404].includes(error.status)) throw error;
        failures++; report.observations.push(`Observation retry ${failures}: ${clean(error.message, session.cookie)}`);
      }
      await delay(1000);
    }
    requireCondition(terminal, 'The same submitted conversation did not reach a verified terminal state before the deadline. It was not restarted.');
    report.root = { status: terminal.status, error: terminal.error, finalMessage: terminal.messages.filter(message => message.role === 'assistant').at(-1)?.content };
    requireCondition(terminal.status === 'idle', `The root run finished as ${terminal.status}.`);
    const children = await api(`/threads/${thread.id}/agents`); updateAgents(children);
    requireCondition(children.length === 2 && children.every(child => child.parentThreadId === thread.id && child.workspaceId === owned.id && child.status === 'completed' && child.model === MODEL && child.reasoningEffort === EFFORT),
      'The two expected inherited-policy workers did not both complete.');
    requireCondition(children.map(child => child.taskName).sort().join(',') === 'alpha,beta', 'The assigned worker identities changed.');
    const childThreads = await Promise.all(children.map(child => api(`/threads/${child.id}`)));
    report.agents = children.map(child => ({ id: child.id, taskName: child.taskName, parentThreadId: child.parentThreadId, status: child.status, model: child.model, reasoningEffort: child.reasoningEffort, createdAt: child.createdAt, updatedAt: child.updatedAt }));
    report.childTools = childThreads.map(child => ({ id: child.id, activities: child.messages.flatMap(message => message.activities ?? []).map(activity => ({ name: activity.name, status: activity.status, input: activity.input, output: activity.output })) }));
    requireCondition(childThreads.every(child => ['write_file', 'read_file'].every(name => child.messages.some(message => message.activities?.some(activity => activity.name === name && activity.status === 'completed')))), 'A worker did not perform its required real file tools.');
    for (const child of childThreads) {
      const owner = children.find(item => item.id === child.id), ownedPath = `${owner.taskName}.txt`;
      const writes = child.messages.flatMap(message => message.activities ?? []).filter(activity => activity.name === 'write_file' && activity.status === 'completed');
      requireCondition(writes.length === 1 && writes.every(activity => { try { const input = JSON.parse(activity.input); return input.path === ownedPath && input.expected_version === null && input.content === expected[ownedPath]; } catch { return false; } }), 'A worker changed more than its one fresh verification file.');
    }
    report.peakWorkingAgents = peakWorking;
    requireCondition(peakWorking >= 2, 'The live statuses did not prove two workers were working concurrently.');
    report.checks.concurrentWorkers = true;
    const commandActivities = terminal.messages.flatMap(message => message.activities ?? []).filter(activity => activity.name === 'exec_command' && activity.status === 'completed');
    const hostProof = commandActivities.find(activity => {
      try { const input = JSON.parse(activity.input), output = JSON.parse(activity.output); return (input.command ?? input.cmd) === command && output.exit_code === 0 && String(output.output).includes(hostMarker); } catch { return false; }
    });
    requireCondition(hostProof, 'No successful actual execution of the exact parent Node assertion was recorded.');
    report.parentCommand = { input: hostProof.input, output: hostProof.output }; report.checks.parentHostCommand = true;
    report.files = await Promise.all(Object.entries(expected).map(async ([name, content]) => {
      const file = await api(`/workspaces/${owned.id}/file?path=${encodeURIComponent(name)}`);
      requireCondition(file.content === content && file.size === Buffer.byteLength(content), `${name} does not have the required current UTF-8 bytes; it was left untouched.`);
      return { path: name, content: file.content, bytes: file.size, version: file.version };
    }));
    report.checks.actualFileBytes = true;
    const namingDeadline = Date.now() + 25_000;
    let named = terminal;
    while (!['generated', 'manual'].includes(named.titleSource) && Date.now() < namingDeadline) { await delay(1000); named = await api(`/threads/${thread.id}`); }
    report.naming = { source: named.titleSource, title: named.titleSource === 'manual' ? '[manual title preserved]' : named.title, revision: named.titleRevision };
    requireCondition(['generated', 'manual'].includes(named.titleSource), 'An automatic root title was not observed within its bounded wait.');
    report.checks.automaticTitle = named.titleSource === 'generated';
    report.checks.manualTitlePreserved = named.titleSource === 'manual';
    report.phase = 'reviewing-owned-changes'; await save();
    const pending = await api(`/changes?workspaceId=${owned.id}`);
    const family = new Set([thread.id, ...children.map(child => child.id)]);
    const selected = pendingFixtureChanges(pending, owned.id, family, expected);
    report.review = { observedPending: pending.length, selectedOwnedAdditions: selected.length, decision: 'preserved-existing-decisions' };
    if (selected.length) {
      try {
        const result = await api('/changes/resolve', 'POST', { ids: selected.map(change => change.id), action: 'undo' });
        report.review.decision = 'pending-owned-additions-undone'; report.review.resolved = result.changes.map(change => ({ id: change.id, path: change.path, status: change.status }));
        report.review.filesAbsentAfterUndo = await Promise.all(selected.map(async change => {
          const observed = await requestJson(new URL(`/api/workspaces/${owned.id}/file?path=${encodeURIComponent(change.path)}`, session.base), { cookie: session.cookie, allowStatus: [404] });
          return { path: change.path, absent: observed.status === 404 };
        }));
        requireCondition(report.review.filesAbsentAfterUndo.every(file => file.absent), 'A file was present after Undo; it was left unchanged for inspection.');
      } catch (error) {
        if (error.status !== 409) throw error;
        report.review.decision = 'concurrent-user-decision-or-file-conflict-preserved';
      }
    }
    report.activeWorkspaceAfter = (await api('/bootstrap')).activeWorkspaceId;
    report.checks.sse = (streams.get(thread.id).summary.eventCounts.activity ?? 0) > 0 && (streams.get(thread.id).summary.eventCounts.agent_change ?? 0) > 0;
    requireCondition(report.checks.sse, 'The root event stream did not show real tools and agent status changes.');
    report.phase = 'complete'; report.passed = true;
  } catch (error) {
    report.error = clean(error.message, session.cookie); report.phase = 'failed';
    if (runSubmitted && thread && owned) {
      try {
        const current = await api(`/threads/${thread.id}`);
        if (current.workspaceId === owned.id && LIVE.has(current.status)) { await api(`/threads/${thread.id}/stop`, 'POST', {}); report.stoppedOwnedRun = true; }
        else report.stoppedOwnedRun = false;
      } catch { report.observations.push('Could not confirm or stop the owned run; inspect the saved rootThreadId. It was not restarted.'); }
    }
    process.exitCode = 1;
  } finally {
    for (const stream of streams.values()) stream.close();
    report.elapsedMs = Date.now() - started;
    await save(); agent.destroy();
    console.log(JSON.stringify({ passed: report.passed, phase: report.phase, workspaceId: report.workspace?.id, rootThreadId: report.rootThreadId,
      peakWorkingAgents: report.peakWorkingAgents, titleSource: report.naming?.source, review: report.review?.decision,
      error: report.error, report: reportPath }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(clean(error.message)); process.exitCode = 1; agent.destroy(); });
}
