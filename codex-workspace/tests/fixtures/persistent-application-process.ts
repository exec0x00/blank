import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preferenceFixtureTokens, type PreferenceBoundaryInspection } from './persistent-native-boundary';

export const preferenceFixturePassword = 'persistent-preferences-fixture-password';
const sessionSecret = 'persistent-preferences-fixture-session-key-not-real';
const encryptionKey = 'persistent-preferences-fixture-encryption-key-not-real';
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const STARTUP_TIMEOUT_MS = 30_000;
const GRACEFUL_STOP_MS = 20_000;
const TERM_STOP_MS = 2_000;
const KILL_STOP_MS = 5_000;
const OUTPUT_LIMIT = 8192;

interface Inspection extends PreferenceBoundaryInspection { nativeConfigFile: string }
export interface PreferenceAppProcess {
  child: ChildProcess; pid: number; base: string; dataDir: string; homeDir: string;
  stateDir: string; workspacesDir: string; runtimeDir: string; inspection?: Inspection;
}
interface ProcessExit { code: number | null; signal: NodeJS.Signals | null }
interface OwnedProcess {
  child: ChildProcess; startedAt: number; phase: string; trace: string[];
  lastImport?: string; output: string; spawnError?: Error; grouped: boolean;
  closed: Promise<ProcessExit>; exit?: ProcessExit; stopping?: Promise<void>; aborting: boolean;
}
const active = new Set<OwnedProcess>();
const owned = new WeakMap<ChildProcess, OwnedProcess>();
let inspectionSequence = 0;

function safeText(value: unknown): string {
  let text = String(value);
  for (const secret of [preferenceFixturePassword, sessionSecret, encryptionKey, ...preferenceFixtureTokens]) text = text.replaceAll(secret, '[fixture-secret]');
  return text.slice(-OUTPUT_LIMIT);
}

// TypeScript is registered inside the bootstrap so diagnostics begin before
// loader registration/imports. This still executes the real server source in
// a fresh Node process, with the same installed tsx ESM loader used by --import.
const appBootstrap = String.raw`
  import https from 'node:https';
  import { syncBuiltinESMExports } from 'node:module';
  const startedAt = Date.now();
  let phase = 'bootstrap';
  let runtime;
  let inspect;
  let stopping = false;
  const send = message => {
    if (process.connected) process.send(message, () => {});
  };
  const progress = value => {
    phase = value;
    send({ type: 'phase', phase, elapsedMs: Date.now() - startedAt });
  };
  const errorText = error => {
    let message = String(error?.stack || error?.message || error);
    for (const key of ['WORKSPACE_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY']) {
      if (process.env[key]) message = message.replaceAll(process.env[key], '[fixture-secret]');
    }
    return message.slice(0, 4096);
  };
  const stop = async (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    progress('shutdown');
    try { if (runtime) await runtime.close(); }
    catch (error) { send({ type: 'failure', phase, error: errorText(error) }); exitCode = 1; }
    process.exit(exitCode);
  };
  process.on('message', message => {
    if (message?.type === 'close') void stop();
    if (message?.type === 'inspect' && Number.isSafeInteger(message.requestId) && inspect) {
      send({ type: 'inspection', requestId: message.requestId, inspection: inspect() });
    }
  });
  process.once('SIGTERM', () => void stop());
  progress('bootstrap');
  try {
    const unexpectedNetwork = () => { throw new Error('Preference persistence must not contact an external service.'); };
    https.request = unexpectedNetwork;
    https.get = unexpectedNetwork;
    globalThis.fetch = unexpectedNetwork;
    syncBuiltinESMExports();

    progress('loading-typescript');
    const { register } = await import('tsx/esm/api');
    register({ onImport: url => {
      if (url.includes('/server/') || url.includes('/shared/')) {
        send({ type: 'import', module: url.split('?')[0].slice(-400) });
      }
    } });
    progress('installing-controlled-boundaries');
    const { githubPreferenceBoundary, installPreferenceNativeBoundary } = await import('./tests/fixtures/persistent-native-boundary.ts');
    const github = githubPreferenceBoundary();
    https.request = github.request;
    https.get = github.denied;
    globalThis.fetch = github.denied;
    syncBuiltinESMExports();
    progress('importing-application');
    const { createApplication } = await import('./server/index.ts');
    progress('initializing-application');
    runtime = await createApplication();
    const native = await installPreferenceNativeBoundary(runtime.ctx, github);
    inspect = () => ({ ...native.inspect(), nativeConfigFile: native.filePath });
    progress('opening-listener');
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });

    const { dataDir, homeDir, stateDir, workspacesDir, runtimeDir } = runtime.ctx.config;
    progress('serving');
    send({ type: 'ready', pid: process.pid,
      base: 'http://127.0.0.1:' + runtime.server.address().port,
      dataDir, homeDir, stateDir, workspacesDir, runtimeDir, inspection: inspect(),
    });
  } catch (error) {
    send({ type: 'failure', phase, error: errorText(error) });
    await stop(1);
  }
`;

function track(child: ChildProcess, grouped: boolean): OwnedProcess {
  let onClose!: (exit: ProcessExit) => void;
  const record: OwnedProcess = {
    child, grouped, startedAt: Date.now(), phase: 'spawn-requested', trace: [], output: '', aborting: false,
    closed: new Promise(resolve => { onClose = resolve; }),
  };
  active.add(record); owned.set(child, record);
  const phase = (value: string) => {
    record.phase = value;
    record.trace.push(`+${Date.now() - record.startedAt} ms ${value}`);
    record.trace = record.trace.slice(-16);
  };
  child.once('spawn', () => phase('process-spawned'));
  child.on('error', error => { record.spawnError = error; });
  child.on('message', value => {
    const message = value as { type?: string; phase?: unknown; module?: unknown; error?: unknown };
    if (message?.type === 'phase' && typeof message.phase === 'string') phase(safeText(message.phase).slice(0, 160));
    if (message?.type === 'import' && typeof message.module === 'string') record.lastImport = safeText(message.module).slice(-400);
    if (message?.type === 'failure') record.output = safeText(`${record.output}\n${message.phase}: ${message.error}`);
  });
  child.stdout?.on('data', bytes => { record.output = safeText(record.output + bytes.toString()); });
  child.stderr?.on('data', bytes => { record.output = safeText(record.output + bytes.toString()); });
  // close follows exit and stream closure, and also occurs after spawn errors.
  // The child remains owned until this completion barrier, never just until kill.
  child.once('close', (code, signal) => {
    record.exit = { code, signal }; active.delete(record); onClose(record.exit);
  });
  return record;
}

function waitForClose(record: OwnedProcess, timeoutMs: number): Promise<ProcessExit | undefined> {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(undefined), timeoutMs);
    void record.closed.then(exit => { clearTimeout(timeout); resolve(exit); });
  });
}

function signalOwned(record: OwnedProcess, signal: NodeJS.Signals): void {
  if (record.exit) return;
  try {
    // detached created this child's own process group. Never signal the test
    // runner's group or discover/kill unrelated processes by name.
    if (record.grouped && record.child.pid) process.kill(-record.child.pid, signal);
    else record.child.kill(signal);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

async function diagnostics(record: OwnedProcess): Promise<string> {
  let processState = 'process status unavailable';
  if (record.child.pid) {
    const results = await Promise.allSettled([
      fs.readFile(`/proc/${record.child.pid}/status`, 'utf8'),
      fs.readFile(`/proc/${record.child.pid}/wchan`, 'utf8'),
    ]);
    processState = results.map((result, index) => result.status === 'fulfilled'
      ? index === 0 ? result.value.split('\n').filter(line => /^(?:Name|State|PPid|Threads|VmRSS):/.test(line)).join(', ') : `wait=${result.value.trim()}`
      : `proc-${index}=${(result.reason as NodeJS.ErrnoException).code ?? 'unavailable'}`).join('; ');
  }
  return `pid=${record.child.pid ?? 'not-spawned'}; elapsed=${Date.now() - record.startedAt} ms; phase=${record.phase}; ${processState}.\n`
    + `Startup trace: ${record.trace.join(' -> ') || '(no child progress received)'}.\n`
    + `Last application import: ${record.lastImport ?? '(none reported)'}.\n`
    + `Output: ${safeText(record.output || record.spawnError?.message || '(empty)')}`;
}

export async function stopPreferenceProcess(child: ChildProcess, abort = false): Promise<void> {
  const record = owned.get(child);
  if (!record) throw new Error('Refusing to stop an unowned preference fixture process.');
  record.aborting ||= abort;
  record.stopping ??= (async () => {
    if (!record.exit) {
      if (record.aborting) signalOwned(record, 'SIGTERM');
      else if (child.connected) child.send({ type: 'close' }, error => { if (error) signalOwned(record, 'SIGTERM'); });
      else signalOwned(record, 'SIGTERM');
    }
    let exit = await waitForClose(record, record.aborting ? TERM_STOP_MS : GRACEFUL_STOP_MS);
    if (!exit && !record.aborting) { signalOwned(record, 'SIGTERM'); exit = await waitForClose(record, TERM_STOP_MS); }
    if (!exit) { signalOwned(record, 'SIGKILL'); exit = await waitForClose(record, KILL_STOP_MS); }
    if (!exit) throw new Error(`Preference fixture did not close after owned-process termination. ${await diagnostics(record)}`);
    if (!record.aborting && exit.code !== 0) {
      throw new Error(`Preference fixture did not shut down cleanly (${exit.signal ?? exit.code}). ${await diagnostics(record)}`);
    }
  })();
  return record.stopping;
}

export async function closePreferenceProcesses(): Promise<void> {
  const stopped = await Promise.allSettled([...active].map(record => stopPreferenceProcess(record.child)));
  const failures = stopped.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, 'Preference fixture cleanup failed; live fixture directories were retained.');
}

export async function inspectPreferenceProcess(app: PreferenceAppProcess): Promise<Inspection> {
  const record = owned.get(app.child);
  if (!record || record.exit || !app.child.connected) throw new Error('Preference fixture is not running.');
  const requestId = ++inspectionSequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup();reject(new Error('Preference fixture inspection timed out.')); }, 5000);
    const onMessage = (value: unknown) => {
      const message = value as { type?: string; requestId?: number; inspection?: Inspection };
      if (message.type !== 'inspection' || message.requestId !== requestId) return;
      cleanup();if (!message.inspection) reject(new Error('Missing preference fixture inspection.'));else resolve(message.inspection);
    };
    const onClose = () => { cleanup();reject(new Error('Preference fixture closed during inspection.')); };
    const cleanup = () => { clearTimeout(timer);app.child.off('message', onMessage);app.child.off('close', onClose); };
    app.child.on('message', onMessage);app.child.once('close', onClose);
    app.child.send({ type: 'inspect', requestId }, error => { if (error) { cleanup();reject(error); } });
  });
}

export class PreferenceStartupError extends Error {
  constructor(message: string, readonly processId: number | undefined, cause: unknown) {
    super(message, { cause }); this.name = 'PreferenceStartupError';
  }
}

export async function startPreferenceProcess(dataDir: string, runtimeDir: string, workspaceId?: string,
  fixture: { bootstrap?: string; startupTimeoutMs?: number } = {}): Promise<PreferenceAppProcess> {
  const grouped = process.platform !== 'win32';
  const child = spawn(process.execPath, ['--input-type=module', '--eval', fixture.bootstrap ?? appBootstrap], {
    cwd: projectRoot, detached: grouped,
    env: {
      PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_ENV: 'test', NODE_OPTIONS: '--max-old-space-size=512',
      DATA_DIR: dataDir, RUNTIME_DIR: runtimeDir,
      CODEX_CLI_TEST_START: '0',
      WORKSPACE_PASSWORD: preferenceFixturePassword, SESSION_SECRET: sessionSecret, ENCRYPTION_KEY: encryptionKey,
      ...(workspaceId ? { CODEX_TEST_WORKSPACE_ID: workspaceId } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const record = track(child, grouped);
  try {
    const ready = await new Promise<Omit<PreferenceAppProcess, 'child'>>((resolve, reject) => {
      const timeoutMs = fixture.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`Preference fixture startup exceeded ${timeoutMs} ms.`)); }, timeoutMs);
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup(); reject(new Error(`Preference fixture exited during startup (${signal ?? code}).`));
      };
      const onMessage = (value: unknown) => {
        const message = value as Partial<Omit<PreferenceAppProcess, 'child'>> & { type?: string; error?: unknown; phase?: string };
        if (message?.type === 'failure') { cleanup(); reject(new Error(`Preference fixture failed during ${message.phase}: ${safeText(message.error)}`)); return; }
        if (message?.type !== 'ready') return;
        if (typeof message.pid !== 'number' || message.pid !== child.pid
          || ['base', 'dataDir', 'homeDir', 'stateDir', 'workspacesDir', 'runtimeDir'].some(key => typeof message[key as keyof typeof message] !== 'string')) {
          cleanup(); reject(new Error('Invalid preference fixture startup response.')); return;
        }
        cleanup(); resolve(message as Omit<PreferenceAppProcess, 'child'>);
      };
      function cleanup() {
        clearTimeout(timeout); child.off('error', onError); child.off('exit', onExit); child.off('message', onMessage);
      }
      child.once('error', onError); child.once('exit', onExit); child.on('message', onMessage);
    });
    return { child, ...ready };
  } catch (error) {
    const detail = await diagnostics(record);
    try { await stopPreferenceProcess(child, true); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], `Preference fixture startup and cleanup failed. ${detail}`); }
    // Expected SIGTERM/SIGKILL after a startup failure is cleanup, not a second
    // contradictory shutdown failure. Rejection happens only after close.
    throw new PreferenceStartupError(`${safeText(error instanceof Error ? error.message : error)} ${detail}`, child.pid, error);
  }
}
