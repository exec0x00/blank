import { constants, type Stats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './config';
import { HttpError } from './errors';

type RuntimeConfig = Pick<AppConfig, 'dataDir' | 'homeDir' | 'runtimeDir'>;
export interface RuntimeStoragePaths {
  root: string;
  temporaryDir: string;
  cacheDir: string;
  buildDir: string;
  dependenciesDir: string;
  sessionDir: string;
}

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const within = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const overlaps = (first: string, second: string): boolean => within(first, second) || within(second, first);
const normalized = (value: string): boolean => value.length > 1 && value.length <= 4096
  && path.isAbsolute(value) && path.resolve(value) === value && value.split(path.sep).length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);

function unsafe(): never {
  throw new HttpError(409, 'Runtime storage must be a canonical private directory outside /data and durable app storage. Existing files were left unchanged.', 'RUNTIME_STORAGE_UNSAFE');
}

function paths(config: RuntimeConfig): RuntimeStoragePaths {
  if (![config.dataDir, config.homeDir, config.runtimeDir].every(normalized)
    || !within(config.dataDir, config.homeDir) || config.dataDir === config.homeDir
    || ['/data', config.dataDir, config.homeDir].some(durable => overlaps(durable, config.runtimeDir))) unsafe();
  return {
    root: config.runtimeDir,
    temporaryDir: path.join(config.runtimeDir, 'tmp'),
    cacheDir: path.join(config.runtimeDir, 'cache'),
    buildDir: path.join(config.runtimeDir, 'build'),
    dependenciesDir: path.join(config.runtimeDir, 'dependencies'),
    sessionDir: path.join(config.runtimeDir, 'run'),
  };
}

/** Resolve aliases even when the final durable directory does not yet exist. */
async function canonicalWithMissingLeaf(target: string): Promise<string> {
  let candidate = target;
  const suffix: string[] = [];
  for (let count = 0; count < 64; count++) {
    try { return path.join(await fs.realpath(candidate), ...suffix); }
    catch (error) {
      if (['ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) unsafe();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || candidate === path.parse(candidate).root) throw error;
      const entry = await fs.lstat(candidate).catch(statError => {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw statError;
      });
      if (entry?.isSymbolicLink()) unsafe();
      suffix.unshift(path.basename(candidate));
      candidate = path.dirname(candidate);
    }
  }
  return unsafe();
}

function privateDirectory(stat: Stats): void {
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
    || typeof process.getuid === 'function' && stat.uid !== process.getuid()) unsafe();
}

async function checkedHandle(absolute: string, access = absolute): Promise<FileHandle> {
  let handle: FileHandle;
  try { handle = await fs.open(access, DIRECTORY_FLAGS); }
  catch (error) {
    if (['ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) unsafe();
    throw error;
  }
  try {
    if (!(await handle.stat()).isDirectory() || await fs.realpath(`/proc/self/fd/${handle.fd}`) !== absolute) unsafe();
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function checkHandle(handle: FileHandle, absolute: string): Promise<void> {
  if (await fs.realpath(`/proc/self/fd/${handle.fd}`) !== absolute) unsafe();
}

/** Walk no-follow descriptors so mkdir never traverses an unchecked symlink. */
async function prepareRoot(target: string): Promise<FileHandle> {
  let absolute = path.parse(target).root;
  let parent = await checkedHandle(absolute);
  try {
    for (const name of path.relative(absolute, target).split(path.sep).filter(Boolean)) {
      await checkHandle(parent, absolute);
      const access = `/proc/self/fd/${parent.fd}/${name}`;
      await fs.mkdir(access, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
      const childAbsolute = path.join(absolute, name);
      const child = await checkedHandle(childAbsolute, access);
      try { await checkHandle(parent, absolute); }
      catch (error) { await child.close(); throw error; }
      await parent.close();
      parent = child;
      absolute = childAbsolute;
    }
    privateDirectory(await parent.stat());
    return parent;
  } catch (error) { await parent.close(); throw error; }
}

async function prepareChild(root: FileHandle, rootPath: string, relative: string): Promise<void> {
  let handle = root;
  let absolute = rootPath;
  try {
    for (const name of relative.split(path.sep)) {
      await checkHandle(handle, absolute);
      const access = `/proc/self/fd/${handle.fd}/${name}`;
      await fs.mkdir(access, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
      const childAbsolute = path.join(absolute, name);
      const child = await checkedHandle(childAbsolute, access);
      try { await checkHandle(handle, absolute); }
      catch (error) { await child.close(); throw error; }
      if (handle !== root) await handle.close();
      handle = child;
      absolute = childAbsolute;
    }
    // The root is private; cache consumers may choose ordinary modes within it.
    await checkHandle(root, rootPath);
  } finally { if (handle !== root) await handle.close(); }
}

/**
 * Common child-process paths only; does not inherit secrets or change process.env.
 * Call prepareRuntimeStorage before launching a process with this environment.
 * Existing project-local node_modules/build outputs are not moved or symlinked.
 */
export function runtimeEnvironment(config: RuntimeConfig): Record<string, string> {
  const runtime = paths(config);
  const cache = (name: string) => path.join(runtime.cacheDir, name);
  const home = config.homeDir;
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: runtime.cacheDir,
    XDG_RUNTIME_DIR: runtime.sessionDir,
    TMPDIR: runtime.temporaryDir, TMP: runtime.temporaryDir, TEMP: runtime.temporaryDir,
    CODEX_RUNTIME_DIR: runtime.root,
    CODEX_BUILD_DIR: runtime.buildDir,
    CODEX_DEPENDENCIES_DIR: runtime.dependenciesDir,
    npm_config_cache: cache('npm'), NPM_CONFIG_CACHE: cache('npm'),
    npm_config_store_dir: cache('pnpm'),
    NPM_CONFIG_USERCONFIG: path.join(home, '.npmrc'),
    PIP_CACHE_DIR: cache('pip'), UV_CACHE_DIR: cache('uv'), YARN_CACHE_FOLDER: cache('yarn'),
    // HF_HOME can hold login configuration/tokens. Preserve its existing home
    // location and redirect the independently supported disposable cache paths.
    HF_HOME: path.join(home, '.cache', 'huggingface'),
    HF_HUB_CACHE: cache('huggingface/hub'), HUGGINGFACE_HUB_CACHE: cache('huggingface/hub'),
    HF_ASSETS_CACHE: cache('huggingface/assets'), HF_DATASETS_CACHE: cache('huggingface/datasets'),
    HF_XET_CACHE: cache('huggingface/xet'), TRANSFORMERS_CACHE: cache('huggingface/transformers'),
    TORCH_HOME: cache('torch'), TRITON_CACHE_DIR: cache('triton'), CUDA_CACHE_PATH: cache('cuda'),
    CCACHE_DIR: cache('ccache'), SCCACHE_DIR: cache('sccache'),
    GOCACHE: cache('go-build'), GOMODCACHE: path.join(runtime.dependenciesDir, 'go'),
    NODE_COMPILE_CACHE: cache('node-compile'), DENO_DIR: cache('deno'),
    BUN_INSTALL_CACHE_DIR: cache('bun'), COMPOSER_CACHE_DIR: cache('composer'),
    PYTHONPYCACHEPREFIX: cache('python-bytecode'), MYPY_CACHE_DIR: cache('mypy'), NUMBA_CACHE_DIR: cache('numba'),
    NUGET_PACKAGES: path.join(runtime.dependenciesDir, 'nuget'),
    // These homes also contain user configuration and credentials, not just caches.
    CARGO_HOME: path.join(home, '.cargo'), RUSTUP_HOME: path.join(home, '.rustup'),
  };
}

/** Validate/create disposable directories; never clean, chmod or migrate user files. */
export async function prepareRuntimeStorage(config: RuntimeConfig): Promise<RuntimeStoragePaths> {
  const runtime = paths(config);
  const [publicData, durableData, durableHome, actualRuntime] = await Promise.all([
    canonicalWithMissingLeaf('/data'), canonicalWithMissingLeaf(config.dataDir),
    canonicalWithMissingLeaf(config.homeDir), canonicalWithMissingLeaf(runtime.root),
  ]);
  if (actualRuntime !== runtime.root || [publicData, durableData, durableHome].some(durable => overlaps(durable, actualRuntime))) unsafe();
  const root = await prepareRoot(runtime.root);
  try {
    const environment = runtimeEnvironment(config);
    const children = new Set([runtime.temporaryDir, runtime.cacheDir, runtime.buildDir, runtime.dependenciesDir, runtime.sessionDir,
      ...Object.values(environment).filter(value => value !== runtime.root && within(runtime.root, value))]);
    for (const child of children) await prepareChild(root, runtime.root, path.relative(runtime.root, child));
    await checkHandle(root, runtime.root);
    privateDirectory(await root.stat());
    return runtime;
  } finally { await root.close(); }
}
