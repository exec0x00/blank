import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCodexCliInstaller, CODEX_CLI_REGISTRY } from '../server/codex-cli/install';
import type { CodexCliInstaller, CodexCliInstallOptions, CodexCliInstallStatus } from '../server/codex-cli/install-types';

// Local npm/native-process fixtures test the transaction and isolation rules.
// They are explicitly not official-package or provider acceptance. The real
// npm/official --version/schema proof is performed separately by the owner.
let directory: string;
const installers: CodexCliInstaller[] = [];
const run = promisify(execFile);

type Mode = 'good' | 'npm-fail' | 'bad-version' | 'bad-schema' | 'foreign-registry' | 'loud' | 'hold';

async function fixture() {
  const root = await fs.mkdtemp(path.join(directory, 'fixture-'));
  const control = path.join(root, 'control.json'), calls = path.join(root, 'calls.jsonl'), release = path.join(root, 'release-hold');
  const npm = path.join(root, 'npm-fixture.cjs');
  const nativeSource = (version: string, mode: Mode) => `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
if (fs.existsSync(path.join(process.env.CODEX_HOME, 'auth.json')) || fs.existsSync(path.join(process.env.CODEX_HOME, 'config.toml'))) process.exit(91);
if (process.argv[2] === '--version') { process.stdout.write('codex-cli ${mode === 'bad-version' ? '9.9.9' : version}\\n'); process.exit(0); }
if (process.argv.includes('--help')) { process.stdout.write('Usage: codex app-server generate-json-schema --out <DIR> --experimental\\n'); process.exit(0); }
if (process.argv[2] !== 'app-server' || process.argv[3] !== 'generate-json-schema') process.exit(92);
const output = process.argv[process.argv.indexOf('--out') + 1];
const methods = ${JSON.stringify(['initialize', 'thread/start', 'thread/resume', 'thread/list', 'thread/read', 'turn/start', ...(mode === 'bad-schema' ? [] : ['turn/interrupt'])])};
const schema = values => ({oneOf: values.map(method => ({type:'object',properties:{method:{enum:[method]}},required:['method']}))});
fs.writeFileSync(path.join(output,'ClientRequest.json'),JSON.stringify(schema(methods)));
fs.writeFileSync(path.join(output,'ClientNotification.json'),JSON.stringify(schema(['initialized'])));
fs.writeFileSync(path.join(output,'ServerRequest.json'),JSON.stringify(schema(['item/commandExecution/requestApproval'])));
fs.writeFileSync(path.join(output,'ServerNotification.json'),JSON.stringify(schema(['turn/completed'])));
`;
  await fs.writeFile(npm, `
const fs = require('node:fs/promises'), path = require('node:path');
const controlPath=${JSON.stringify(control)}, callsPath=${JSON.stringify(calls)}, releasePath=${JSON.stringify(release)};
const nativeSource=${nativeSource.toString()};
const REQUIRED_REGISTRY=${JSON.stringify(CODEX_CLI_REGISTRY)};
(async()=>{
 const args=process.argv.slice(2), configuration=JSON.parse(await fs.readFile(controlPath,'utf8'));
 const prefix=args[args.indexOf('--prefix')+1];
 const record={args, cwd:process.cwd(), sentinelPresent:'CODEX_INSTALL_TEST_SECRET' in process.env,
  inheritedProviderKey:'OPENAI_API_KEY' in process.env, inheritedHubToken:'HF_TOKEN' in process.env,
  userConfig:await fs.readFile(process.env.NPM_CONFIG_USERCONFIG,'utf8'),globalConfig:await fs.readFile(process.env.NPM_CONFIG_GLOBALCONFIG,'utf8'),
  codexHome:process.env.CODEX_HOME,home:process.env.HOME,registry:process.env.npm_config_registry};
 await fs.appendFile(callsPath,JSON.stringify(record)+'\\n');
 if (configuration.mode==='npm-fail') { process.stderr.write('fixture raw diagnostic should not reach status'); process.exit(42); }
 if (configuration.mode==='loud') { process.stdout.write('bounded-fixture-output'.repeat(5000)); return; }
 if (configuration.mode==='hold') {
  while (!await fs.stat(releasePath).then(()=>true,()=>false)) await new Promise(resolve=>setTimeout(resolve,30));
 }
 const version=configuration.version, name='@openai/codex', platform='@openai/codex-linux-'+process.arch;
 const target=process.arch==='x64'?'x86_64-unknown-linux-musl':'aarch64-unknown-linux-musl';
 const packageRoot=path.join(prefix,'node_modules',name), platformRoot=path.join(prefix,'node_modules',platform);
 await fs.mkdir(path.join(packageRoot,'bin'),{recursive:true});await fs.mkdir(path.join(platformRoot,'vendor',target,'bin'),{recursive:true});
 await fs.writeFile(path.join(packageRoot,'package.json'),JSON.stringify({name,version,bin:{codex:'bin/codex.js'}}));
 await fs.writeFile(path.join(packageRoot,'bin/codex.js'),'// explicit local transaction fixture, never model output\\n');
 await fs.writeFile(path.join(platformRoot,'package.json'),JSON.stringify({name,version:version+'-linux-'+process.arch}));
 await fs.writeFile(path.join(platformRoot,'vendor',target,'bin/codex'),nativeSource(version,configuration.mode),{mode:0o755});
 const locked=version=>({version,resolved:(configuration.mode==='foreign-registry'?'https://untrusted.invalid/':REQUIRED_REGISTRY)+'@openai/codex/-/codex-'+version+'.tgz',integrity:'sha512-YWJjZA=='});
 await fs.writeFile(path.join(prefix,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{},'node_modules/@openai/codex':locked(version),['node_modules/'+platform]:locked(version+'-linux-'+process.arch)}}));
})().catch(()=>process.exit(99));
`, { mode: 0o600 });
  const home = path.join(root, 'data', 'native-codex-home');
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, 'auth.json'), 'synthetic durable-home sentinel; must remain untouched');
  await fs.writeFile(path.join(home, 'config.toml'), 'synthetic durable configuration sentinel');
  const statuses: CodexCliInstallStatus[] = [];
  const options: CodexCliInstallOptions = { dataDir: path.join(root, 'data'), codexHomeDir: home,
    runtimeDir: path.join(root, 'runtime'), nodeExecutable: process.execPath, npmCliPath: npm,
    onStatus: status => { statuses.push(status); } };
  const installRoot = path.join(options.runtimeDir, 'dependencies', 'official-codex-cli');
  async function configure(mode: Mode, version = '1.2.3') { await fs.writeFile(control, JSON.stringify({ mode, version })); }
  async function records(): Promise<Array<Record<string, unknown>>> {
    return (await fs.readFile(calls, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(value => JSON.parse(value));
  }
  function create() { const installer = createCodexCliInstaller(options); installers.push(installer); return installer; }
  await configure('good');
  return { root, home, options, installRoot, configure, records, create, statuses, release };
}

beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-install-test-')); });
afterEach(async () => {
  await Promise.allSettled(installers.splice(0).map(installer => installer.close()));
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('official Codex installer transaction boundaries', () => {
  it('uses the fixed latest package/registry, isolated npm config and schema/version probes', async () => {
    const value = await fixture(); vi.stubEnv('CODEX_INSTALL_TEST_SECRET', 'synthetic-private-parent-value');
    const installer = value.create(), installed = await installer.start();
    const [request] = await value.records();
    expect(request.args).toEqual(expect.arrayContaining(['install', '@openai/codex@latest', '--ignore-scripts', '--prefer-online', '--include=optional', `--registry=${CODEX_CLI_REGISTRY}`]));
    expect(request.args).not.toContain('-g'); expect(request.args).not.toContain('--global');
    expect(request).toMatchObject({ sentinelPresent: false, inheritedProviderKey: false, inheritedHubToken: false, userConfig: '', globalConfig: '', registry: CODEX_CLI_REGISTRY });
    expect(String(request.codexHome)).not.toBe(value.home);
    expect(String(request.cwd)).toContain(path.join(value.installRoot, 'staging'));
    expect(installed.version).toBe('1.2.3'); expect(installed.methods).toContain('turn/start');
    expect(installed.serverRequestMethods).toEqual(['item/commandExecution/requestApproval']);
    expect(installed.serverNotificationMethods).toEqual(['turn/completed']);
    expect(installed.clientNotificationMethods).toEqual(['initialized']);
    expect(JSON.parse(await fs.readFile(installed.schemaManifestPath, 'utf8'))).toMatchObject({ codexVersion: '1.2.3', experimental: true });
    expect(await fs.readFile(path.join(value.home, 'auth.json'), 'utf8')).toBe('synthetic durable-home sentinel; must remain untouched');
    expect(await fs.readFile(path.join(value.home, 'config.toml'), 'utf8')).toBe('synthetic durable configuration sentinel');
    expect(installer.status()).toMatchObject({ phase: 'ready', available: true, currentVersion: '1.2.3', lastAttempt: { kind: 'startup', outcome: 'succeeded' }, lastError: null });
    expect(JSON.stringify(installer.status())).not.toContain(value.root);
    expect(value.statuses.map(status => status.phase)).toEqual(expect.arrayContaining(['preparing', 'installing', 'verifying', 'switching', 'ready']));
  });

  it('coalesces concurrent startup and update requests into one actual npm operation', async () => {
    const value = await fixture(), installer = value.create();
    const results = await Promise.all([installer.start(), installer.updateLatest(), installer.start(), installer.updateLatest()]);
    expect(new Set(results.map(result => result.releaseId)).size).toBe(1);
    expect(await value.records()).toHaveLength(1);
    results[0].methods.length = 0;
    expect(installer.current()!.methods).toContain('turn/start');
  });

  it('keeps the same transaction when a status observer synchronously requests another update', async () => {
    const value = await fixture(); let installer!: CodexCliInstaller, reentered: Promise<unknown> | undefined;
    installer = createCodexCliInstaller({ ...value.options, onStatus: status => {
      if (status.phase === 'preparing' && !reentered) reentered = installer.updateLatest();
    } });
    installers.push(installer);
    const installed = await installer.start(); await reentered;
    expect(installed.version).toBe('1.2.3'); expect(await value.records()).toHaveLength(1);
  });

  it('runs latest npm again on the next application instance and safely reuses an identical verified release', async () => {
    const value = await fixture(), first = value.create(), installed = await first.start();
    await first.close();
    const second = value.create(), recovered = await second.start();
    expect(await value.records()).toHaveLength(2);
    expect(recovered.releaseId).toBe(installed.releaseId);
    expect(await fs.readdir(path.join(value.installRoot, 'releases'))).toEqual([installed.releaseId]);
    expect(await fs.readdir(path.join(value.installRoot, 'staging'))).toEqual([]);
  });

  it('uses a later successful explicit update after an initial startup failure without reinstalling on start', async () => {
    const value = await fixture(), installer = value.create(); await value.configure('npm-fail');
    await expect(installer.start()).rejects.toMatchObject({ code: 'CODEX_INSTALL_NPM_FAILED' });
    await value.configure('good');
    const repaired = await installer.updateLatest();
    expect(await installer.start()).toEqual(repaired);
    expect(await value.records()).toHaveLength(2);
  });

  it('repairs a missing disposable cached binary through a fresh verified install without deleting the old release', async () => {
    const value = await fixture(), first = value.create(), installed = await first.start(); await first.close();
    await fs.unlink(installed.executablePath);
    const next = value.create(), recovered = await next.start();
    expect(recovered.version).toBe('1.2.3'); expect(recovered.releaseId).not.toBe(installed.releaseId);
    expect(await value.records()).toHaveLength(2);
    await fs.access(recovered.executablePath);
    expect(await fs.readdir(path.join(value.installRoot, 'releases'))).toContain(installed.releaseId);
    expect(await fs.readFile(path.join(value.home, 'auth.json'), 'utf8')).toContain('must remain untouched');
  });

  it('switches only after verification and retains the previous immutable executable for running leases', async () => {
    const value = await fixture(), installer = value.create(), first = await installer.start();
    const oldBytes = await fs.readFile(first.executablePath);
    await value.configure('good', '1.2.4');
    const updated = await installer.updateLatest();
    expect(updated.version).toBe('1.2.4'); expect(updated.releaseId).not.toBe(first.releaseId);
    expect(await fs.readFile(first.executablePath)).toEqual(oldBytes);
    const pointer = JSON.parse(await fs.readFile(path.join(value.installRoot, 'current.json'), 'utf8'));
    expect(pointer.releaseId).toBe(updated.releaseId);
    expect((await fs.readdir(path.join(value.installRoot, 'releases'))).sort()).toEqual([first.releaseId, updated.releaseId].sort());
  });

  it.each([
    ['npm-fail', 'CODEX_INSTALL_NPM_FAILED'], ['bad-version', 'CODEX_INSTALL_VERIFICATION_FAILED'], ['bad-schema', 'CODEX_INSTALL_PROTOCOL_UNSUPPORTED'],
    ['foreign-registry', 'CODEX_INSTALL_VERIFICATION_FAILED'], ['loud', 'CODEX_INSTALL_OUTPUT_LIMIT'],
  ] as const)('retains current binary/pointer when %s update fails and returns only a safe failure status', async (mode, code) => {
    const value = await fixture(), installer = value.create(), first = await installer.start();
    const pointer = await fs.readFile(path.join(value.installRoot, 'current.json'));
    const untouched = path.join(value.installRoot, 'staging', 'other-task');
    await fs.mkdir(untouched); await fs.writeFile(path.join(untouched, 'keep'), 'unrelated data');
    await value.configure(mode, '1.2.4');
    await expect(installer.updateLatest()).rejects.toMatchObject({ code });
    expect(installer.current()).toEqual(first);
    expect(await fs.readFile(path.join(value.installRoot, 'current.json'))).toEqual(pointer);
    expect(installer.status()).toMatchObject({ phase: 'failed', available: true, currentVersion: '1.2.3', lastAttempt: { kind: 'update', outcome: 'failed' }, lastError: { code } });
    expect(JSON.stringify(installer.status())).not.toContain('fixture raw diagnostic');
    expect(JSON.stringify(installer.status())).not.toContain(value.root);
    expect(await fs.readFile(path.join(untouched, 'keep'), 'utf8')).toBe('unrelated data');
  });

  it('restores the previous pointer after a reported rename failure that actually replaced it', async () => {
    const value = await fixture(), installer = value.create(), first = await installer.start();
    const pointer = await fs.readFile(path.join(value.installRoot, 'current.json'));
    const rename = fs.rename.bind(fs); let injected = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to);
      if (!injected && String(to).endsWith('/current.json')) {
        injected = true; throw Object.assign(new Error('synthetic post-rename acknowledgement failure'), { code: 'EIO' });
      }
    });
    await value.configure('good', '1.2.4');
    await expect(installer.updateLatest()).rejects.toMatchObject({ code: 'CODEX_INSTALL_STORAGE_FAILED' });
    expect(injected).toBe(true); expect(installer.current()).toEqual(first);
    expect(await fs.readFile(path.join(value.installRoot, 'current.json'))).toEqual(pointer);
    await fs.access(first.executablePath);
  });

  it('holds the kernel lock across installer processes without stealing it or running a second npm', async () => {
    const value = await fixture(), first = value.create(); await value.configure('hold');
    const pending = first.start(); void pending.catch(() => undefined);
    await expect.poll(async () => (await value.records()).length).toBe(1);
    const options = { ...value.options, onStatus: undefined };
    const code = `import { createCodexCliInstaller } from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'server/codex-cli/install.ts')).href)};
      const installer=createCodexCliInstaller(${JSON.stringify(options)});
      try { await installer.start(); process.exitCode=20; } catch(error) { process.stdout.write(error.code); }
      finally { await installer.close(); }`;
    const result = await run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
      cwd: process.cwd(), timeout: 15_000, maxBuffer: 16 * 1024,
      env: { PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), LANG: 'C.UTF-8' },
    });
    expect(result.stdout).toBe('CODEX_INSTALL_BUSY');
    expect(await value.records()).toHaveLength(1);
    await fs.writeFile(value.release, 'continue'); await pending;
    expect(first.status()).toMatchObject({ phase: 'ready', available: true });
  });

  it('cancels only owned installation work on close and releases the lock for the next service', async () => {
    const value = await fixture(), installer = value.create(), first = await installer.start();
    await value.configure('hold', '1.2.4');
    const update = installer.updateLatest(); void update.catch(() => undefined);
    await expect.poll(async () => (await value.records()).length).toBe(2);
    await installer.close();
    await expect(update).rejects.toMatchObject({ code: 'CODEX_INSTALL_CANCELLED' });
    expect(installer.current()).toEqual(first);
    await value.configure('good', '1.2.4');
    const next = value.create(); expect((await next.start()).version).toBe('1.2.4');
  });

  it('refuses a runtime symlink or durable overlap without touching the target or native home', async () => {
    const value = await fixture();
    const target = path.join(value.root, 'unrelated'); await fs.mkdir(target); await fs.writeFile(path.join(target, 'keep'), 'safe');
    await fs.symlink(target, value.options.runtimeDir);
    await expect(value.create().start()).rejects.toMatchObject({ code: 'CODEX_INSTALL_STORAGE_UNSAFE' });
    expect(await fs.readdir(target)).toEqual(['keep']);
    const overlap = createCodexCliInstaller({ ...value.options, runtimeDir: path.join(value.options.dataDir, 'install') }); installers.push(overlap);
    await expect(overlap.start()).rejects.toMatchObject({ code: 'CODEX_INSTALL_STORAGE_UNSAFE' });
    expect(await value.records()).toEqual([]);
    expect(await fs.readFile(path.join(value.home, 'auth.json'), 'utf8')).toContain('must remain untouched');
  });
});
