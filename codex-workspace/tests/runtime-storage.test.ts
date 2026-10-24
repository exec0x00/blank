import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config';
import { prepareRuntimeStorage, runtimeEnvironment } from '../server/runtime-storage';

let directory: string;
let config: { dataDir: string; homeDir: string; runtimeDir: string };

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-runtime-storage-'));
  const dataDir = path.join(directory, 'data');
  config = { dataDir, homeDir: path.join(dataDir, 'home'), runtimeDir: path.join(directory, 'runtime') };
  await fs.mkdir(config.homeDir, { recursive: true });
});

afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe('private disposable runtime storage', () => {
  it('creates cache, dependency, build and temporary directories outside durable home', async () => {
    const prepared = await prepareRuntimeStorage(config);
    const environment = runtimeEnvironment(config);
    expect(prepared.root).toBe(config.runtimeDir);
    expect((await fs.stat(prepared.root)).mode & 0o777).toBe(0o700);
    for (const target of Object.values(environment).filter(value => value.startsWith(`${config.runtimeDir}/`))) {
      expect((await fs.lstat(target)).isDirectory()).toBe(true);
      expect(await fs.realpath(target)).toBe(target);
    }
    expect(environment.HOME).toBe(config.homeDir);
    expect(environment.XDG_CONFIG_HOME).toBe(path.join(config.homeDir, '.config'));
    expect(environment.XDG_STATE_HOME).toBe(path.join(config.homeDir, '.local/state'));
    expect(environment.XDG_DATA_HOME).toBe(path.join(config.homeDir, '.local/share'));
    expect(environment.npm_config_cache).toBe(path.join(prepared.cacheDir, 'npm'));
    expect(environment.PIP_CACHE_DIR).toBe(path.join(prepared.cacheDir, 'pip'));
    expect(environment.UV_CACHE_DIR).toBe(path.join(prepared.cacheDir, 'uv'));
    expect(environment.HF_HUB_CACHE).toBe(path.join(prepared.cacheDir, 'huggingface/hub'));
    expect(environment.HF_XET_CACHE).toBe(path.join(prepared.cacheDir, 'huggingface/xet'));
    expect(environment.CCACHE_DIR).toBe(path.join(prepared.cacheDir, 'ccache'));
    expect(environment.GOMODCACHE).toBe(path.join(prepared.dependenciesDir, 'go'));
    expect(environment.CODEX_BUILD_DIR).toBe(prepared.buildDir);
    expect(environment.TMPDIR).toBe(prepared.temporaryDir);
    expect(environment.WORKSPACE_PASSWORD).toBeUndefined();
    expect(environment.SESSION_SECRET).toBeUndefined();
  });

  it('preserves existing home configuration, history and prior caches without a silent migration', async () => {
    const existing = [
      ['.npmrc', 'user-specific-registry-configuration\n'],
      ['.cache/npm/user-cache', 'existing cache bytes\n'],
      ['.cache/huggingface/token', 'non-secret fixture token\n'],
      ['.local/state/terminal-history/session.history', 'echo previous command\n'],
      ['.cargo/config.toml', '[build]\njobs = 1\n'],
    ] as const;
    for (const [name, content] of existing) {
      await fs.mkdir(path.dirname(path.join(config.homeDir, name)), { recursive: true });
      await fs.writeFile(path.join(config.homeDir, name), content);
    }
    await prepareRuntimeStorage(config);
    await prepareRuntimeStorage(config);
    for (const [name, content] of existing) expect(await fs.readFile(path.join(config.homeDir, name), 'utf8')).toBe(content);
    const environment = runtimeEnvironment(config);
    expect(environment.HF_HOME).toBe(path.join(config.homeDir, '.cache/huggingface'));
    expect(environment.CARGO_HOME).toBe(path.join(config.homeDir, '.cargo'));
    await expect(fs.access(path.join(environment.npm_config_cache, 'user-cache'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a public or durable scratch location before creating directories', async () => {
    for (const runtimeDir of ['/data/codex-unsafe-runtime-fixture', path.join(config.dataDir, 'scratch'), config.dataDir, directory]) {
      await expect(prepareRuntimeStorage({ ...config, runtimeDir })).rejects.toMatchObject({ code: 'RUNTIME_STORAGE_UNSAFE' });
    }
    await expect(fs.access(path.join(config.dataDir, 'scratch'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(config.dataDir)).toEqual(['home']);
  });

  it('refuses an existing nonprivate root without changing its permissions or files', async () => {
    await fs.mkdir(config.runtimeDir, { mode: 0o755 });
    await fs.chmod(config.runtimeDir, 0o755);
    await fs.writeFile(path.join(config.runtimeDir, 'keep.txt'), 'owned existing bytes');
    await expect(prepareRuntimeStorage(config)).rejects.toMatchObject({ code: 'RUNTIME_STORAGE_UNSAFE' });
    expect((await fs.stat(config.runtimeDir)).mode & 0o777).toBe(0o755);
    expect(await fs.readFile(path.join(config.runtimeDir, 'keep.txt'), 'utf8')).toBe('owned existing bytes');
  });

  it('rejects symlink roots and intermediate aliases, including aliases outside data', async () => {
    const target = path.join(directory, 'other-private-directory');
    await fs.mkdir(target, { mode: 0o700 });
    await fs.writeFile(path.join(target, 'keep.txt'), 'retained');
    await fs.symlink(target, config.runtimeDir);
    await expect(prepareRuntimeStorage(config)).rejects.toMatchObject({ code: 'RUNTIME_STORAGE_UNSAFE' });
    await expect(prepareRuntimeStorage({ ...config, runtimeDir: path.join(config.runtimeDir, 'child') })).rejects.toMatchObject({ code: 'RUNTIME_STORAGE_UNSAFE' });
    expect(await fs.readdir(target)).toEqual(['keep.txt']);
  });

  it('rejects an internal cache symlink without traversing into user files', async () => {
    await fs.mkdir(config.runtimeDir, { mode: 0o700 });
    await fs.writeFile(path.join(config.homeDir, 'keep.txt'), 'durable user bytes');
    await fs.symlink(config.homeDir, path.join(config.runtimeDir, 'cache'));
    await expect(prepareRuntimeStorage(config)).rejects.toMatchObject({ code: 'RUNTIME_STORAGE_UNSAFE' });
    expect(await fs.readdir(config.homeDir)).toEqual(['keep.txt']);
    expect(await fs.readFile(path.join(config.homeDir, 'keep.txt'), 'utf8')).toBe('durable user bytes');
  });

  it('detects aliases of the configured durable directory before creating scratch', async () => {
    const alias = path.join(directory, 'durable-alias');
    await fs.symlink(config.dataDir, alias);
    await expect(prepareRuntimeStorage({ dataDir: alias, homeDir: path.join(alias, 'home'), runtimeDir: path.join(config.dataDir, 'scratch') })).rejects.toMatchObject({ code: 'RUNTIME_STORAGE_UNSAFE' });
    expect(await fs.readdir(config.dataDir)).toEqual(['home']);
  });

  it('does not treat a dangling durable symlink as an ordinary missing directory', async () => {
    const alias = path.join(directory, 'missing-data-alias');
    const target = path.join(directory, 'not-yet-created-data');
    await fs.symlink(target, alias);
    await expect(prepareRuntimeStorage({ dataDir: alias, homeDir: path.join(alias, 'home'), runtimeDir: path.join(target, 'scratch') })).rejects.toMatchObject({ code: 'RUNTIME_STORAGE_UNSAFE' });
    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true);
  });

  it('rejects noncanonical paths and a home outside durable data', () => {
    for (const runtimeDir of ['relative/runtime', `${config.runtimeDir}/../runtime`, `${config.runtimeDir}\n`, '/']) {
      expect(() => runtimeEnvironment({ ...config, runtimeDir })).toThrow();
    }
    expect(() => runtimeEnvironment({ ...config, homeDir: path.join(directory, 'ephemeral-home') })).toThrow();
  });

  it('accepts an explicit RUNTIME_DIR without changing durable configuration paths', () => {
    const env = { NODE_ENV: 'test', WORKSPACE_PASSWORD: 'runtime-test-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64), DATA_DIR: config.dataDir };
    const explicit = loadConfig({ ...env, RUNTIME_DIR: config.runtimeDir });
    expect(explicit.runtimeDir).toBe(config.runtimeDir);
    expect(explicit.homeDir).toBe(config.homeDir);
    expect(explicit.stateDir).toBe(path.join(config.dataDir, 'codex-workspace/state'));
    expect(loadConfig(env).runtimeDir).toBe(path.join(os.tmpdir(), `codex-workspace-runtime-${process.getuid?.() ?? 'local'}`));
  });
});
