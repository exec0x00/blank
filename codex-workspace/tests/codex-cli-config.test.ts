import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs, { type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { parse } from 'smol-toml';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import * as resources from '../server/host-resources';
import { prepareCodexLaunch, readCodexLaunchRuleSnapshot, validateCodexLaunchPolicy, installCodexManagedRequirements, validateCodexManagedRequirementsResponse,
  renderCodexHostRules, renderCodexManagedRequirements, CODEX_CLI_HOST_POLICY,
  CODEX_CLI_HOST_RULES_FILENAME, CODEX_CLI_PROVIDER_ID, CODEX_CLI_PROVIDER_ENV_KEY, CODEX_CLI_SANDBOX_MODE } from '../server/codex-cli/config';

const execute = promisify(execFile);
const nativeBinary = process.env.CODEX_CLI_TEST_EXECUTABLE;

describe('official Codex launch configuration', () => {
  let root: string, ctx: AppContext, autoApprove: boolean;
  beforeEach(async () => {
    vi.stubEnv('PASSWORD', 'provider-password-test');
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-config-'));
    autoApprove = false;
    const config = loadConfig({ DATA_DIR: path.join(root, 'data'), RUNTIME_DIR: path.join(root, 'runtime'),
      WORKSPACE_PASSWORD: 'site-password-never-in-native-env', SESSION_SECRET: 'server-session-marker-'.repeat(4), ENCRYPTION_KEY: 'server-encryption-marker-'.repeat(4),
      HF_DOWNLOAD_TOKEN: 'server-hf-download-marker' });
    const store = new JsonStore(config.stateDir);
    ctx = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(), settings: vi.fn(async () => ({ autoApprove })),
      providerKey: vi.fn(async () => { throw new Error('Native launch must never request a decrypted provider key.'); }) } as unknown as AppContext;
  });
  afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await ctx.store.flush(); await fs.rm(root, { recursive: true, force: true }); });

  function overrides(args: string[]) {
    const result: Record<string, unknown> = {};
    for (let i = 3; i < args.length; i += 2) {
      expect(args[i]).toBe('-c'); const item = args[i + 1], equals = item.indexOf('=');
      result[item.slice(0, equals)] = parse(`value = ${item.slice(equals + 1)}`).value;
    }
    return result;
  }

  /** Real owned-directory/file operations, with only kernel mount/UID metadata
   * projected to reproduce HF's root process + synthesized bucket owner. No
   * real mount, chown, privilege change, /data write or provider request. */
  async function mountedOwnerFixture() {
    const nativeHome = path.join(ctx.config.dataDir, 'codex-workspace', 'native-codex'), rules = path.join(nativeHome, 'rules');
    const reserved = path.join(rules, CODEX_CLI_HOST_RULES_FILENAME);
    await fs.mkdir(rules, { recursive: true });
    await fs.writeFile(reserved, renderCodexHostRules());
    for (const directory of [nativeHome, rules]) await fs.chmod(directory, 0o777);
    await fs.chmod(reserved, 0o666);
    ctx.config.requirePersistentData = true;
    const originals = { open: fs.open.bind(fs), lstat: fs.lstat.bind(fs), realpath: fs.realpath.bind(fs), statfs: fs.statfs.bind(fs) };
    const kernelMounts = await fs.readFile('/proc/self/mountinfo', 'utf8'), dataStat = await fs.lstat(ctx.config.dataDir);
    const uid = (process.getuid?.() ?? 1000) + 4000, gid = (process.getgid?.() ?? 1000) + 4000;
    const metadata = new Map<string, Partial<Pick<Stats, 'uid' | 'gid' | 'dev'>>>();
    const controls: { id: number; source: string; type: string; device: number; fuse: boolean; extra: string; onRuleRead?: () => Promise<void> } =
      { id: 900001, source: 'hf-mount', type: 'fuse', device: dataStat.dev, fuse: true, extra: '' };
    const mountFile = path.join(root, 'controlled-mountinfo');
    async function writeMount() {
      const device = BigInt(controls.device);
      const numbers = `${((device >> 8n) & 0xfffn) | ((device >> 32n) & 0xfffff000n)}:${(device & 0xffn) | ((device >> 12n) & 0xffffff00n)}`;
      const escaped = ctx.config.dataDir.replaceAll(' ', '\\040');
      await fs.writeFile(mountFile, `${kernelMounts.trim()}\n${controls.id} 1 ${numbers} / ${escaped} rw,nosuid,nodev,relatime,idmapped - ${controls.type} ${controls.source} rw,user_id=${uid},group_id=${gid},default_permissions,allow_other\n${controls.extra}`);
    }
    await writeMount();
    const belongs = (filename: string) => filename === ctx.config.dataDir || filename.startsWith(ctx.config.dataDir + path.sep);
    const reported = (stat: Stats, filename: string) => belongs(filename)
      ? Object.assign(Object.create(Object.getPrototypeOf(stat)) as Stats, stat, { uid, gid }, metadata.get(filename)) : stat;
    async function namedPath(filename: string) {
      const descriptor = /^\/proc\/self\/fd\/(\d+)(.*)$/.exec(filename);
      return descriptor ? (await originals.realpath(`/proc/self/fd/${descriptor[1]}`)) + descriptor[2] : filename;
    }
    vi.spyOn(fs, 'lstat').mockImplementation((async (filename, ...options) =>
      reported(await originals.lstat(filename, ...options) as Stats, await namedPath(String(filename)))) as typeof fs.lstat);
    vi.spyOn(fs, 'statfs').mockImplementation((async (filename, ...options) => {
      const stat = await originals.statfs(filename, ...options);
      return belongs(await namedPath(String(filename))) && controls.fuse ? { ...stat, type: 0x65735546 } : stat;
    }) as typeof fs.statfs);
    vi.spyOn(fs, 'open').mockImplementation(async (filename, ...options) => {
      const descriptor = await originals.open(filename === '/proc/self/mountinfo' ? mountFile : filename, ...options);
      const stat = descriptor.stat.bind(descriptor), read = descriptor.read.bind(descriptor);
      vi.spyOn(descriptor, 'stat').mockImplementation((async (...args) =>
        reported(await stat(...args) as Stats, await originals.realpath(`/proc/self/fd/${descriptor.fd}`))) as FileHandle['stat']);
      vi.spyOn(descriptor, 'read').mockImplementation((async (...args) => {
        const value = await Reflect.apply(read, descriptor, args);
        if (controls.onRuleRead && await originals.realpath(`/proc/self/fd/${descriptor.fd}`) === reserved) {
          const action = controls.onRuleRead; controls.onRuleRead = undefined; await action();
        }
        return value;
      }) as FileHandle['read']);
      return descriptor;
    });
    const chown = vi.spyOn(fs, 'chown');
    return { nativeHome, rules, reserved, uid, gid, metadata, controls, writeMount, chown,
      modes: () => Promise.all([nativeHome, rules, reserved].map(async filename => (await originals.lstat(filename)).mode & 0o7777)),
    };
  }

  it('keeps authoritative native state durable, uses actual app-server stdio and preserves native preferences', async () => {
    const nativeHome = path.join(ctx.config.dataDir, 'codex-workspace', 'native-codex');
    await fs.mkdir(nativeHome, { recursive: true, mode: 0o700 });
    const preferences = 'model = "user-native-choice"\nmodel_reasoning_effort = "high"\n[features]\nmemories = true\n';
    await fs.writeFile(path.join(nativeHome, 'config.toml'), preferences);
    const launch = await prepareCodexLaunch(ctx), config = overrides(launch.args);
    expect(launch.args.slice(0, 3)).toEqual(['app-server', '--listen', 'stdio://']);
    expect(launch.codexHomeDir).toBe(nativeHome); expect(launch.cwd).toBe(ctx.config.homeDir);
    expect(launch.env.HOME).toBe(ctx.config.homeDir); expect(launch.env.CODEX_HOME).toBe(nativeHome); expect(launch.env.CODEX_SQLITE_HOME).toBe(nativeHome);
    expect(config.sqlite_home).toBe(nativeHome); expect(String(config.log_dir).startsWith(ctx.config.runtimeDir + path.sep)).toBe(true);
    expect(launch.env.TMPDIR!.startsWith(ctx.config.runtimeDir + path.sep)).toBe(true);
    expect(launch.env.XDG_CACHE_HOME!.startsWith(ctx.config.runtimeDir + path.sep)).toBe(true);
    expect(config.model_provider).toBe(CODEX_CLI_PROVIDER_ID);
    expect(config[`model_providers.${CODEX_CLI_PROVIDER_ID}.base_url`]).toBe('https://alvin3y12-test.hf.space/api');
    expect(config[`model_providers.${CODEX_CLI_PROVIDER_ID}.wire_api`]).toBe('responses');
    expect(config[`model_providers.${CODEX_CLI_PROVIDER_ID}.requires_openai_auth`]).toBe(false);
    expect(config[`model_providers.${CODEX_CLI_PROVIDER_ID}.env_key`]).toBe(CODEX_CLI_PROVIDER_ENV_KEY);
    expect(CODEX_CLI_PROVIDER_ENV_KEY).toBe('PASSWORD');
    expect(launch.env.PASSWORD).toBe('provider-password-test');
    expect(config['features.api_key_model_discovery']).toBe(false);
    expect(config.model).toBeUndefined(); expect(config.model_reasoning_effort).toBeUndefined();
    expect(config['features.memories']).toBeUndefined(); expect(config.base_instructions).toBeUndefined(); expect(config.model_instructions_file).toBeUndefined();
    expect(config['features.plugins']).toBeUndefined();
    expect(await fs.readFile(path.join(nativeHome, 'config.toml'), 'utf8')).toBe(preferences);
    expect(await fs.readFile(path.join(nativeHome, 'rules', CODEX_CLI_HOST_RULES_FILENAME), 'utf8')).toBe(renderCodexHostRules());
    expect(ctx.providerKey).not.toHaveBeenCalled();
  });

  it('requires the PASSWORD secret before preparing a native launch', async () => {
    vi.stubEnv('PASSWORD', '');
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_PROVIDER_PASSWORD_MISSING' });
  });

  it('starts from a child-environment allowlist and never copies controlling homes, credentials or proxy settings', async () => {
    const secrets = {
      HF_TOKEN: 'parent-hf-token-marker', HF_DOWNLOAD_TOKEN: 'parent-download-token-marker',
      GITHUB_TOKEN: 'parent-github-token-marker', GH_TOKEN: 'parent-gh-token-marker',
      WORKSPACE_PASSWORD: 'parent-password-marker', SESSION_SECRET: 'parent-session-marker', ENCRYPTION_KEY: 'parent-encryption-marker',
      OPENAI_API_KEY: 'parent-api-key-marker', HTTPS_PROXY: 'http://parent-proxy-marker', ALL_PROXY: 'socks5://parent-socks-marker',
      CODEX_AUTH_JSON: 'parent-auth-json-marker', AWS_SECRET_ACCESS_KEY: 'parent-cloud-marker',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: 'parent-header-marker',
      NODE_OPTIONS: '--require=parent-loader-marker', PYTHONPATH: '/parent-python-marker',
    };
    for (const [key, value] of Object.entries(secrets)) vi.stubEnv(key, value);
    const fakeControl = path.join(root, 'fake-control-home'); await fs.mkdir(fakeControl);
    await fs.writeFile(path.join(fakeControl, 'auth.json'), 'control-auth-must-remain-unread-and-unchanged');
    vi.stubEnv('HOME', fakeControl); vi.stubEnv('CODEX_HOME', fakeControl); vi.stubEnv('CODEX_SQLITE_HOME', fakeControl); vi.stubEnv('PATH', '/parent-path-marker');
    const launch = await prepareCodexLaunch(ctx), serialized = JSON.stringify(launch);
    for (const [key, value] of Object.entries(secrets)) {
      expect(launch.env[key]).toBeUndefined();
      if (value.includes('marker')) expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain(fakeControl); expect(launch.env.PATH).not.toContain('parent-path-marker');
    for (const value of [ctx.config.password, ctx.config.sessionSecret, ctx.config.encryptionKey, ctx.config.downloadToken!]) expect(serialized).not.toContain(value);
    expect(await fs.readFile(path.join(fakeControl, 'auth.json'), 'utf8')).toBe('control-auth-must-remain-unread-and-unchanged');
  });

  it('uses additive native developer policy and keeps native approval preferences editable', async () => {
    const first = overrides((await prepareCodexLaunch(ctx)).args);
    expect(first.sandbox_mode).toBe('danger-full-access'); expect(first.approval_policy).toBeUndefined();
    expect(first.developer_instructions).toContain(CODEX_CLI_HOST_POLICY);
    expect(first.developer_instructions).toMatch(/Host resource snapshot at \d{4}-\d{2}-\d{2}T/);
    expect(first.developer_instructions).toContain('90,000,000,000'); expect(first.developer_instructions).toContain('2,000,000,000');
    expect(first.developer_instructions).toContain('browser\'s built-in sandbox'); expect(first.developer_instructions).toContain('different remote machine');
    expect(first.developer_instructions).toContain('fork_context=false');
    expect(first['features.multi_agent_v2']).toBe(false);
    for (const key of ['apps', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser', 'in_app_dictation', 'realtime_conversation', 'network_proxy', 'respect_system_proxy']) expect(first[`features.${key}`]).toBe(false);
    expect(first['otel.metrics_exporter']).toBe('none'); expect(first['analytics.enabled']).toBe(false);
    autoApprove = true; expect(overrides((await prepareCodexLaunch(ctx)).args).approval_policy).toBeUndefined();
    expect(ctx.settings).not.toHaveBeenCalled();
  });

  it('declares the native read-only base while keeping launch and thread sandbox policy pinned to full access', async () => {
    const nativeHome = path.join(ctx.config.dataDir, 'codex-workspace', 'native-codex');
    await fs.mkdir(nativeHome, { recursive: true, mode: 0o700 });
    const preferences = 'sandbox_mode = "read-only"\napproval_policy = "on-request"\n';
    await fs.writeFile(path.join(nativeHome, 'config.toml'), preferences);

    const launch = await prepareCodexLaunch(ctx), config = overrides(launch.args);

    expect(parse(renderCodexManagedRequirements()).allowed_sandbox_modes).toEqual(['read-only', 'danger-full-access']);
    expect(CODEX_CLI_SANDBOX_MODE).toBe('danger-full-access');
    expect(config.sandbox_mode).toBe(CODEX_CLI_SANDBOX_MODE);
    expect(config.allowed_sandbox_modes).toBeUndefined();
    expect(await fs.readFile(path.join(nativeHome, 'config.toml'), 'utf8')).toBe(preferences);
    expect(launch.args[0]).toBe('app-server');
    expect(CODEX_CLI_HOST_POLICY).toContain('bwrap/bubblewrap');
    expect(CODEX_CLI_HOST_POLICY).toContain('Never mount or unmount');
    expect(CODEX_CLI_HOST_POLICY).toContain('Never mine cryptocurrency');
  });

  it('repairs only exact reserved modes after remount-like permission loss while preserving native state bytes and user modes', async () => {
    const launch = await prepareCodexLaunch(ctx), rules = path.join(launch.codexHomeDir, 'rules');
    const reserved = path.join(rules, CODEX_CLI_HOST_RULES_FILENAME);
    const files = [
      { path: path.join(launch.codexHomeDir, 'config.toml'), data: 'approval_policy = "never"\n', mode: 0o640 },
      { path: path.join(launch.codexHomeDir, 'state_5.sqlite'), data: 'synthetic existing database bytes, not a recovered database', mode: 0o660 },
      { path: path.join(launch.codexHomeDir, 'state_5.sqlite-wal'), data: 'synthetic existing WAL bytes', mode: 0o664 },
      { path: path.join(rules, 'user.rules'), data: 'prefix_rule(pattern=["git", "status"], decision="allow")\n', mode: 0o640 },
    ];
    for (const file of files) { await fs.writeFile(file.path, file.data); await fs.chmod(file.path, file.mode); }
    await fs.chmod(launch.codexHomeDir, 0o777); await fs.chmod(rules, 0o777); await fs.chmod(reserved, 0o666);

    await prepareCodexLaunch(ctx);

    expect((await fs.stat(launch.codexHomeDir)).mode & 0o7777).toBe(0o700);
    expect((await fs.stat(rules)).mode & 0o7777).toBe(0o700);
    expect((await fs.stat(reserved)).mode & 0o7777).toBe(0o600);
    expect(await fs.readFile(reserved, 'utf8')).toBe(renderCodexHostRules());
    for (const file of files) {
      expect(await fs.readFile(file.path, 'utf8')).toBe(file.data);
      expect((await fs.stat(file.path)).mode & 0o7777).toBe(file.mode);
    }
  });

  it('does not repair or overwrite a changed or multiply linked reserved rule file', async () => {
    const launch = await prepareCodexLaunch(ctx), reserved = path.join(launch.codexHomeDir, 'rules', CODEX_CLI_HOST_RULES_FILENAME);
    await fs.writeFile(reserved, 'changed existing policy\n'); await fs.chmod(reserved, 0o666);
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });
    expect(await fs.readFile(reserved, 'utf8')).toBe('changed existing policy\n');
    expect((await fs.stat(reserved)).mode & 0o7777).toBe(0o666);
    await fs.writeFile(reserved, renderCodexHostRules());
    const outside = path.join(root, 'same-inode-rule'); await fs.link(reserved, outside);
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });
    expect((await fs.stat(outside)).mode & 0o7777).toBe(0o666);
  });

  it('accepts the verified native mount owner only for reserved paths and revalidates it for later rule reads', async () => {
    const mounted = await mountedOwnerFixture();
    const prefs = path.join(mounted.nativeHome, 'config.toml'), history = path.join(mounted.nativeHome, 'state_5.sqlite');
    await fs.writeFile(prefs, 'approval_policy = "on-request"\n'); await fs.chmod(prefs, 0o640);
    await fs.writeFile(history, 'owned synthetic database bytes'); await fs.chmod(history, 0o660);

    const launch = await prepareCodexLaunch(ctx), first = await readCodexLaunchRuleSnapshot(launch);

    expect(await mounted.modes()).toEqual([0o700, 0o700, 0o600]);
    expect((await fs.lstat(mounted.reserved)).uid).toBe(mounted.uid);
    expect(first.files).toContainEqual({ path: mounted.reserved, sha256: createHash('sha256').update(renderCodexHostRules()).digest('hex') });
    expect(await readCodexLaunchRuleSnapshot(launch)).toEqual(first);
    expect(await fs.readFile(prefs, 'utf8')).toBe('approval_policy = "on-request"\n');
    expect((await fs.lstat(prefs)).mode & 0o7777).toBe(0o640);
    expect(await fs.readFile(history, 'utf8')).toBe('owned synthetic database bytes');
    expect((await fs.lstat(history)).mode & 0o7777).toBe(0o660);
    expect(mounted.chown).not.toHaveBeenCalled();
    expect(Object.keys(launch).sort()).toEqual(['args', 'codexHomeDir', 'cwd', 'env', 'mcpEnvironmentVersion']);
    await expect(readCodexLaunchRuleSnapshot({ ...launch })).rejects.toMatchObject({ code: 'CODEX_CONFIG_STORAGE_UNSAFE' });

    mounted.controls.id++; await mounted.writeMount();
    await expect(readCodexLaunchRuleSnapshot(launch)).rejects.toMatchObject({ code: 'CODEX_CONFIG_STORAGE_UNSAFE' });
  });

  it.each(['no-persistent-contract', 'foreign-source', 'foreign-type', 'wrong-mount-device', 'not-fuse-statfs', 'nested-mount'])(
    'refuses a synthetic owner without the exact native mount proof: %s', async variant => {
      const mounted = await mountedOwnerFixture();
      if (variant === 'no-persistent-contract') ctx.config.requirePersistentData = false;
      if (variant === 'foreign-source') mounted.controls.source = 'untrusted-other-fuse';
      if (variant === 'foreign-type') mounted.controls.type = 'overlay';
      if (variant === 'wrong-mount-device') mounted.controls.device++;
      if (variant === 'not-fuse-statfs') mounted.controls.fuse = false;
      if (variant === 'nested-mount') mounted.controls.extra = `900002 900001 0:99 / ${mounted.rules} rw - fuse hf-mount rw\n`;
      await mounted.writeMount();

      await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_STORAGE_UNSAFE' });

      expect(await mounted.modes()).toEqual([0o777, 0o777, 0o666]);
      expect(await fs.readFile(mounted.reserved, 'utf8')).toBe(renderCodexHostRules());
      expect(mounted.chown).not.toHaveBeenCalled();
    });

  it.each(['home-owner', 'rules-owner', 'file-owner', 'file-group', 'home-device', 'file-device'])(
    'refuses a foreign reserved-path identity even on the verified data mount: %s', async variant => {
      const mounted = await mountedOwnerFixture();
      const target = variant.startsWith('home') ? mounted.nativeHome : variant.startsWith('rules') ? mounted.rules : mounted.reserved;
      const original = await fs.lstat(target);
      mounted.metadata.set(target, variant.endsWith('owner') ? { uid: mounted.uid + 1 }
        : variant.endsWith('group') ? { gid: mounted.gid + 1 } : { dev: original.dev + 1, uid: process.getuid?.() ?? 1000 });

      await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });

      expect(await mounted.modes()).toEqual([0o777, 0o777, 0o666]);
      expect(mounted.chown).not.toHaveBeenCalled();
    });

  it('verifies exact rule bytes before repairing any reserved directory or file mode', async () => {
    const mounted = await mountedOwnerFixture();
    await fs.writeFile(mounted.reserved, 'different policy kept for inspection\n');
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });
    expect(await mounted.modes()).toEqual([0o777, 0o777, 0o666]);
    expect(await fs.readFile(mounted.reserved, 'utf8')).toBe('different policy kept for inspection\n');
  });

  it('never follows reserved symlinks or repairs a linked target under the owner alias', async () => {
    const mounted = await mountedOwnerFixture(), target = path.join(ctx.config.dataDir, 'other-user-rule');
    await fs.writeFile(target, renderCodexHostRules()); await fs.chmod(target, 0o666);
    await fs.unlink(mounted.reserved); await fs.symlink(target, mounted.reserved);
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });
    expect((await fs.lstat(target)).mode & 0o7777).toBe(0o666);
    await fs.unlink(mounted.reserved); await fs.link(target, mounted.reserved);
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });
    expect((await fs.lstat(target)).mode & 0o7777).toBe(0o666);
    expect(mounted.chown).not.toHaveBeenCalled();
  });

  it.each(['mount-record', 'data-root', 'rule-inode'])(
    'fences an identity race before reserved-mode repair: %s', async variant => {
      const mounted = await mountedOwnerFixture(), retired = path.join(root, 'retired-native-data'), oldRule = path.join(mounted.rules, 'prior-rule');
      mounted.controls.onRuleRead = async () => {
        if (variant === 'mount-record') { mounted.controls.id++; await mounted.writeMount(); }
        if (variant === 'data-root') { await fs.rename(ctx.config.dataDir, retired); await fs.mkdir(ctx.config.dataDir); }
        if (variant === 'rule-inode') { await fs.rename(mounted.reserved, oldRule); await fs.writeFile(mounted.reserved, renderCodexHostRules(), { mode: 0o666 }); }
      };
      await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });
      const original = variant === 'data-root' ? path.join(retired, 'codex-workspace', 'native-codex', 'rules', CODEX_CLI_HOST_RULES_FILENAME)
        : variant === 'rule-inode' ? oldRule : mounted.reserved;
      expect((await fs.lstat(original)).mode & 0o7777).toBe(0o666);
      expect(await fs.readFile(original, 'utf8')).toBe(renderCodexHostRules());
      expect(mounted.chown).not.toHaveBeenCalled();
    });

  it('refuses unsafe native-home and rule symlinks without touching the target', async () => {
    const target = path.join(root, 'other-owner'); await fs.mkdir(target); await fs.writeFile(path.join(target, 'kept'), 'unchanged');
    const parent = path.join(ctx.config.dataDir, 'codex-workspace'); await fs.mkdir(parent, { recursive: true });
    await fs.symlink(target, path.join(parent, 'native-codex'));
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_STORAGE_UNSAFE' });
    expect(await fs.readdir(target)).toEqual(['kept']);
    await fs.unlink(path.join(parent, 'native-codex'));
    const launch = await prepareCodexLaunch(ctx), rules = path.join(launch.codexHomeDir, 'rules', CODEX_CLI_HOST_RULES_FILENAME);
    await fs.unlink(rules); await fs.symlink(path.join(target, 'kept'), rules);
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });
    expect(await fs.readFile(path.join(target, 'kept'), 'utf8')).toBe('unchanged');
  });

  it('preserves user rule files and refuses to overwrite an altered reserved policy', async () => {
    const launch = await prepareCodexLaunch(ctx), directory = path.join(launch.codexHomeDir, 'rules');
    const custom = 'prefix_rule(pattern=["git", "status"], decision="allow")\n'; await fs.writeFile(path.join(directory, 'user.rules'), custom);
    await prepareCodexLaunch(ctx); expect(await fs.readFile(path.join(directory, 'user.rules'), 'utf8')).toBe(custom);
    const reserved = path.join(directory, CODEX_CLI_HOST_RULES_FILENAME); await fs.writeFile(reserved, 'changed policy retained for inspection\n');
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_POLICY_CONFLICT' });
    expect(await fs.readFile(reserved, 'utf8')).toBe('changed policy retained for inspection\n');
  });

  it('refuses launch on unavailable accounting or inadequate reserve without spawning or modifying native preferences', async () => {
    const observed = await resources.observeHostResources(ctx.config);
    vi.spyOn(resources, 'observeHostResources').mockResolvedValue({ ...observed, memory: { ...observed.memory, status: 'available', headroomBytes: 1_000_000_000 } });
    await expect(prepareCodexLaunch(ctx)).rejects.toMatchObject({ code: 'CODEX_CONFIG_RESOURCES' });
  });

  it('permits native MCP while retaining managed provider, child policy and restrictive execution rules', () => {
    const policy = parse(renderCodexManagedRequirements());
    expect(policy.mcp_servers).toBeUndefined(); expect(policy.additional_developer_instructions).toBe(CODEX_CLI_HOST_POLICY);
    expect(policy.model_provider).toBe(CODEX_CLI_PROVIDER_ID);
    expect((policy.model_providers as Record<string, unknown>)[CODEX_CLI_PROVIDER_ID]).toEqual({ name: 'Fixed owner Responses service',
      base_url: 'https://alvin3y12-test.hf.space/api', wire_api: 'responses', env_key: CODEX_CLI_PROVIDER_ENV_KEY,
      requires_openai_auth: false, supports_websockets: false });
    expect(policy.model).toBeUndefined(); expect(policy.model_reasoning_effort).toBeUndefined();
    expect(policy.allowed_approval_policies).toEqual(['on-request', 'never']); expect(policy.approval_policy).toBeUndefined();
    expect(policy.allowed_sandbox_modes).toEqual(['read-only', 'danger-full-access']);
    expect(policy.cli_auth_credentials_store).toBe('ephemeral');
    expect((policy.features as Record<string, unknown>).multi_agent_v2).toBe(false);
    expect((policy.rules as { prefix_rules: Array<{ decision: string }> }).prefix_rules.every(rule => rule.decision === 'forbidden')).toBe(true);
  });

  it('creates and verifies managed requirements only in the injected owned destination without overwriting administrator policy', async () => {
    const filename = path.join(root, 'managed-policy', 'requirements.toml');
    const first = await installCodexManagedRequirements(filename);
    expect(first).toEqual({ path: filename, sha256: createHash('sha256').update(renderCodexManagedRequirements()).digest('hex') });
    expect(await fs.readFile(filename, 'utf8')).toBe(renderCodexManagedRequirements());
    expect((await fs.stat(filename)).mode & 0o7777).toBe(0o600);
    const original = await fs.stat(filename);
    expect(await installCodexManagedRequirements(filename)).toEqual(first);
    expect((await fs.stat(filename)).ino).toBe(original.ino);
    await fs.writeFile(filename, 'additional_developer_instructions = "Existing administrator policy"\n');
    const conflict = await fs.stat(filename);
    await expect(installCodexManagedRequirements(filename)).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    expect(await fs.readFile(filename, 'utf8')).toBe('additional_developer_instructions = "Existing administrator policy"\n');
    expect((await fs.stat(filename)).mtimeMs).toBe(conflict.mtimeMs);
  });

  it('upgrades the exact previous provider policy without replacing administrator edits', async () => {
    const directory = path.join(root, 'previous-provider-policy'); await fs.mkdir(directory, { mode: 0o700 });
    const target = path.join(directory, 'requirements.toml');
    const previous = await fs.readFile(new URL('./fixtures/managed-requirements/before-provider-change.toml', import.meta.url), 'utf8');
    expect(Buffer.byteLength(previous)).toBe(7034);
    expect(createHash('sha256').update(previous).digest('hex')).toBe('7ca25e9ca4ac60f3343ddc352c046d52b266cb5c974bfa44fce099ab48d5f78b');
    await fs.writeFile(target, previous, { mode: 0o600 });
    await installCodexManagedRequirements(target);
    expect(await fs.readFile(target, 'utf8')).toBe(renderCodexManagedRequirements());
    const administrator = previous + '\n# Local administrator edit\n';
    await fs.writeFile(target, administrator);
    await expect(installCodexManagedRequirements(target)).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    expect(await fs.readFile(target, 'utf8')).toBe(administrator);
  });

  it('upgrades only the exact previously shipped application MCP policy and preserves administrator variants', async () => {
    const directory = path.join(root, 'owned-managed-migration'); await fs.mkdir(directory, { mode: 0o700 });
    const target = path.join(directory, 'requirements.toml');
    const previous = await fs.readFile(new URL('./fixtures/managed-requirements/before-mcp.toml', import.meta.url), 'utf8');
    // Fingerprint independently obtained from the pre-change source commit.
    expect(createHash('sha256').update(previous).digest('hex')).toBe('c850017376b20aac9883fa1cbb60ecbe1afea490da0daf5145339886e3b40e55');
    await fs.writeFile(target, previous, { mode: 0o600 });
    await installCodexManagedRequirements(target);
    expect(await fs.readFile(target, 'utf8')).toBe(renderCodexManagedRequirements());
    expect(parse(await fs.readFile(target, 'utf8')).mcp_servers).toBeUndefined();
    const administrator = previous.replace('name = "Fixed owner Responses service"', 'name = "Administrator Responses service"');
    await fs.writeFile(target, administrator);
    await expect(installCodexManagedRequirements(target)).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    expect(await fs.readFile(target, 'utf8')).toBe(administrator);
    expect((await fs.readdir(directory)).sort()).toEqual(['requirements.toml']);
  });

  it('upgrades the exact preceding native policy to keep runtime remote control disabled', async () => {
    const directory = path.join(root, 'protocol-managed-migration'); await fs.mkdir(directory, { mode: 0o700 });
    const target = path.join(directory, 'requirements.toml');
    const previous = await fs.readFile(new URL('./fixtures/managed-requirements/before-remote-control.toml', import.meta.url), 'utf8');
    expect(createHash('sha256').update(previous).digest('hex')).toBe('3659500751ea712eff096b9da50d88b5360b333f6abd622dd46800ebf0886cdf');
    await fs.writeFile(target, previous, { mode: 0o600 });
    await installCodexManagedRequirements(target);
    expect(await fs.readFile(target, 'utf8')).toBe(renderCodexManagedRequirements());
    expect((parse(await fs.readFile(target, 'utf8')).features as Record<string, unknown>).remote_control).toBe(false);
    const administrator = previous + '\n# Independent administrator change\n';
    await fs.writeFile(target, administrator);
    await expect(installCodexManagedRequirements(target)).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    expect(await fs.readFile(target, 'utf8')).toBe(administrator);
  });

  it('removes the requested instruction when upgrading the exact previous release, preserving administrator edits', async () => {
    const directory = path.join(root, 'instruction-managed-migration'); await fs.mkdir(directory, { mode: 0o700 });
    const target = path.join(directory, 'requirements.toml');
    const previous = await fs.readFile(new URL('./fixtures/managed-requirements/before-policy-line-removal.toml', import.meta.url), 'utf8');
    expect(createHash('sha256').update(previous).digest('hex')).toBe('3747975c944708dd3a61b5e489324170666fe64a1af532c65c59372cb8041d81');
    const removed = 'Never expose passwords, tokens, secret environment values or credential stores in files, URLs, logs, prompts or child briefs.';
    expect(previous).toContain(removed);
    await fs.writeFile(target, previous, { mode: 0o600 });
    await installCodexManagedRequirements(target);
    const upgraded = await fs.readFile(target, 'utf8');
    expect(upgraded).toBe(renderCodexManagedRequirements());
    expect(upgraded).not.toContain(removed);
    const administrator = previous + '\n# Independent administrator change\n';
    await fs.writeFile(target, administrator);
    await expect(installCodexManagedRequirements(target)).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    expect(await fs.readFile(target, 'utf8')).toBe(administrator);
  });

  it('refuses managed path aliases, unsafe modes and hardlinks without changing any target', async () => {
    const other = path.join(root, 'administrator'); await fs.mkdir(other); const target = path.join(other, 'requirements.toml');
    await fs.writeFile(target, renderCodexManagedRequirements());
    const alias = path.join(root, 'alias'); await fs.symlink(other, alias);
    await expect(installCodexManagedRequirements(path.join(alias, 'requirements.toml'))).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    const own = path.join(root, 'managed'); await fs.mkdir(own); const filename = path.join(own, 'requirements.toml');
    await fs.symlink(target, filename);
    await expect(installCodexManagedRequirements(filename)).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    await fs.unlink(filename); await fs.link(target, filename);
    await expect(installCodexManagedRequirements(filename)).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    await fs.unlink(filename); await fs.copyFile(target, filename); await fs.chmod(filename, 0o666);
    await expect(installCodexManagedRequirements(filename)).rejects.toMatchObject({ code: 'CODEX_CONFIG_MANAGED_POLICY_CONFLICT' });
    expect((await fs.stat(filename)).mode & 0o7777).toBe(0o666);
    expect(await fs.readFile(target, 'utf8')).toBe(renderCodexManagedRequirements());
  });

  it('requires native confirmation of every projected managed invariant and preserves both editable approval choices', () => {
    const rendered = parse(renderCodexManagedRequirements());
    const valid = { requirements: { additionalDeveloperInstructions: CODEX_CLI_HOST_POLICY,
      allowedSandboxModes: ['read-only', 'danger-full-access'], allowedApprovalPolicies: ['never', 'on-request'],
      cliAuthCredentialsStore: 'ephemeral', featureRequirements: rendered.features } };
    expect(() => validateCodexManagedRequirementsResponse(valid)).not.toThrow();
    expect(() => validateCodexManagedRequirementsResponse({ requirements: { ...valid.requirements,
      allowedSandboxModes: ['danger-full-access', 'read-only'] } })).not.toThrow();
    for (const invalid of [undefined, {}, { requirements: null },
      { requirements: { ...valid.requirements, additionalDeveloperInstructions: 'changed policy' } },
      { requirements: { ...valid.requirements, allowedSandboxModes: ['danger-full-access'] } },
      { requirements: { ...valid.requirements, allowedSandboxModes: ['read-only'] } },
      { requirements: { ...valid.requirements, allowedSandboxModes: ['workspace-write'] } },
      { requirements: { ...valid.requirements, allowedSandboxModes: ['read-only', 'workspace-write', 'danger-full-access'] } },
      { requirements: { ...valid.requirements, allowedSandboxModes: ['read-only', 'read-only'] } },
      { requirements: { ...valid.requirements, allowedApprovalPolicies: ['never'] } },
      { requirements: { ...valid.requirements, allowedApprovalPolicies: ['never', 'never'] } },
      { requirements: { ...valid.requirements, cliAuthCredentialsStore: 'file' } },
      { requirements: { ...valid.requirements, featureRequirements: undefined } },
      { requirements: { ...valid.requirements, featureRequirements: { ...(rendered.features as object), multi_agent_v2: true } } },
    ]) expect(() => validateCodexManagedRequirementsResponse(invalid)).toThrow(expect.objectContaining({ code: 'CODEX_CONFIG_MANAGED_POLICY_UNCONFIRMED' }));
    for (const name of Object.keys(rendered.features as object)) {
      const missing = { ...(rendered.features as Record<string, unknown>) }; delete missing[name];
      expect(() => validateCodexManagedRequirementsResponse({ requirements: { ...valid.requirements, featureRequirements: missing } }))
        .toThrow(expect.objectContaining({ code: 'CODEX_CONFIG_MANAGED_POLICY_UNCONFIRMED' }));
    }
  });

  it.skipIf(!nativeBinary)('loads actual native configuration and proves forbidden rules beat a conflicting allow without executing the checked command', async () => {
    const launch = await prepareCodexLaunch(ctx), rule = path.join(launch.codexHomeDir, 'rules', CODEX_CLI_HOST_RULES_FILENAME);
    const allow = path.join(root, 'project-allow.rules'); await fs.writeFile(allow, 'prefix_rule(pattern=["docker"], decision="allow")\n');
    for (const paths of [[rule, allow], [allow, rule]]) {
      const result = await execute(nativeBinary!, ['execpolicy', 'check', ...paths.flatMap(value => ['--rules', value]), '--resolve-host-executables', '--', '/usr/bin/docker', 'version'],
        { cwd: launch.cwd, env: launch.env, timeout: 15_000, maxBuffer: 32 * 1024 });
      expect(JSON.parse(result.stdout).decision).toBe('forbidden');
    }
    const browser = await execute(nativeBinary!, ['execpolicy', 'check', '--rules', rule, '--', 'chromium', '--version'], { cwd: launch.cwd, env: launch.env, timeout: 15_000, maxBuffer: 32 * 1024 });
    expect(JSON.parse(browser.stdout).matchedRules).toEqual([]);
    const features = await execute(nativeBinary!, ['features', 'list', ...launch.args.slice(3)], { cwd: launch.cwd, env: launch.env, timeout: 15_000, maxBuffer: 64 * 1024 });
    expect(features.stdout).toMatch(/^api_key_model_discovery\s+.*false$/m);
    expect(features.stdout).toMatch(/^browser_use\s+.*false$/m);
    expect(features.stdout).toMatch(/^realtime_conversation\s+.*false$/m);
    expect(features.stdout).toMatch(/^multi_agent_v2\s+.*false$/m);
    expect(features.stderr).not.toMatch(/error|unrecognized|unknown feature/i);
    const validated = await validateCodexLaunchPolicy(launch, nativeBinary!);
    expect(validated.files.map(file => path.basename(file.path))).toContain(CODEX_CLI_HOST_RULES_FILENAME);
    expect(validated.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const broken = path.join(launch.codexHomeDir, 'rules', 'broken-user.rules'); await fs.writeFile(broken, 'prefix_rule(');
    await expect(validateCodexLaunchPolicy(launch, nativeBinary!)).rejects.toMatchObject({ code: 'CODEX_CONFIG_RULES_INVALID' });
    expect(await fs.readFile(broken, 'utf8')).toBe('prefix_rule(');
  });

  it.skipIf(!nativeBinary)('permits requested general tunnels but denies cloudflared tunnels in the stock policy parser', async () => {
    const launch = await prepareCodexLaunch(ctx), rule = path.join(launch.codexHomeDir, 'rules', CODEX_CLI_HOST_RULES_FILENAME);
    expect(CODEX_CLI_HOST_POLICY).toContain('General tunnels are allowed, including runlocal');
    expect(CODEX_CLI_HOST_POLICY).toContain('Cloudflared tunnels are specifically forbidden');
    const check = async (command: string[]) => JSON.parse((await execute(nativeBinary!,
      ['execpolicy', 'check', '--rules', rule, '--', ...command],
      { cwd: launch.cwd, env: launch.env, timeout: 15_000, maxBuffer: 32 * 1024 })).stdout);
    for (const command of [
      ['runlocal', 'tunnel', '3000'], ['npx', 'localtunnel', '--port', '3000'], ['lt', '--port', '3000'],
      ['ssh', '-L', '3000:localhost:3000', 'user-supplied-host'], ['ssh', '-R', '80:localhost:3000', 'user-supplied-host'],
    ]) expect((await check(command)).matchedRules).toEqual([]);
    for (const command of [
      ['cloudflared', 'tunnel', '--url', 'http://localhost:3000'],
      ['cloudflared', '--no-autoupdate', 'tunnel', '--url', 'http://localhost:3000'],
    ]) expect((await check(command)).decision).toBe('forbidden');
  });
});
