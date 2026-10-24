import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { consumeBootstrapListenerEnvironment, type BootstrapListenerConfig } from './bootstrap-listener';

export interface AppConfig {
  dataDir: string;
  stateDir: string;
  workspacesDir: string;
  homeDir: string;
  runtimeDir: string;
  password: string;
  sessionSecret: string;
  encryptionKey: string;
  port: number;
  host: string;
  production: boolean;
  devWeb?: boolean;
  /** Server-owned opt-in. Disabled on the current Space by the owner's choice. */
  nativeBrowserEnabled: boolean;
  /** Private inherited handles supplied only by the Python bootstrap parent. */
  bootstrapListener?: BootstrapListenerConfig;
  bucket: string;
  requirePersistentData: boolean;
  distDir: string;
  downloadBucket?: string;
  downloadToken?: string;
}

function localSecret(name: string): string {
  const location = path.join(os.tmpdir(), `codex-workspace-${process.getuid?.() ?? 'local'}-${name}.key`);
  try { return fs.readFileSync(location, 'utf8').trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const value = randomBytes(32).toString('hex');
    try { fs.writeFileSync(location, value, { mode: 0o600, flag: 'wx' }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return fs.readFileSync(location, 'utf8').trim(); throw e; }
    return value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const bootstrapListener = consumeBootstrapListenerEnvironment(env);
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(env.DATA_DIR || path.join(process.cwd(), '.local-data'));
  const password = env.WORKSPACE_PASSWORD || (production ? '' : 'local-development');
  if (!password || password.length < 8) throw new Error('WORKSPACE_PASSWORD must contain at least 8 characters.');
  if (production && (!env.SESSION_SECRET || !env.ENCRYPTION_KEY)) throw new Error('Set SESSION_SECRET and ENCRYPTION_KEY as Space secrets before starting.');
  const sessionSecret = env.SESSION_SECRET || localSecret('sessions');
  const encryptionKey = env.ENCRYPTION_KEY || localSecret('credentials');
  if (sessionSecret.length < 32 || encryptionKey.length < 32) throw new Error('SESSION_SECRET and ENCRYPTION_KEY must each contain at least 32 characters.');
  const port = Number(env.PORT || 7860);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number.');
  return {
    dataDir,
    stateDir: path.join(dataDir, 'codex-workspace', 'state'),
    workspacesDir: path.join(dataDir, 'workspaces'),
    homeDir: path.join(dataDir, 'home'),
    runtimeDir: path.resolve(env.RUNTIME_DIR || path.join(os.tmpdir(), `codex-workspace-runtime-${process.getuid?.() ?? 'local'}`)),
    password, sessionSecret, encryptionKey, port,
    host: env.HOST || '0.0.0.0', production, devWeb: !production && env.CLAUDE_VITE_DEV === '1',
    nativeBrowserEnabled: env.NATIVE_BROWSER_ENABLED === '1',
    ...(bootstrapListener ? { bootstrapListener } : {}),
    bucket: env.HF_BUCKET || 'alvin3y12/data',
    requirePersistentData: env.REQUIRE_PERSISTENT_DATA === '1',
    distDir: path.resolve(env.CLIENT_DIST_DIR || 'dist/client'),
    downloadBucket: env.HF_DOWNLOAD_BUCKET || undefined,
    downloadToken: env.HF_DOWNLOAD_TOKEN || undefined,
  };
}
