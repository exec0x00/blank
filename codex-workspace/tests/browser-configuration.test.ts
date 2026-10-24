import { afterEach, describe, expect, it } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

async function inspectConfiguration(external = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-browser-config-test-'));
  directories.push(directory);
  const probe = `
    import config from './playwright.config.ts';
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
    console.log(JSON.stringify({ dataDir: server?.env?.DATA_DIR ?? null, exported: process.env.PLAYWRIGHT_DATA_DIR ?? null }));
  `;
  const script = `
    import config from './playwright.config.ts';
    import { execFileSync } from 'node:child_process';
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
    const worker = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', ${JSON.stringify(probe)}], { env: process.env, encoding: 'utf8' }));
    console.log(JSON.stringify({ dataDir: server?.env?.DATA_DIR ?? null, exported: process.env.PLAYWRIGHT_DATA_DIR ?? null, worker }));
  `;
  const { stdout } = await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd: projectRoot, timeout: 15_000,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', TMPDIR: directory, CODEX_BROWSER_LOW_THREADS: '0', CODEX_BROWSER_FRESH_PROCESS: '0',
      ...(external ? { PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:43999' } : {}),
      GOMAXPROCS: '2', UV_THREADPOOL_SIZE: '1', NODE_OPTIONS: '--v8-pool-size=1' },
  });
  return { directory, value: JSON.parse(stdout) as { dataDir: string | null; exported: string | null; worker: { dataDir: string | null; exported: string | null } } };
}

describe('owned browser fixture configuration', () => {
  it('passes the same newly created server directory to a fresh worker process', async () => {
    const { directory, value } = await inspectConfiguration();
    expect(value.dataDir).toMatch(/^\/.*\/codex-workspace-browser-/);
    expect(path.dirname(value.dataDir!)).toBe(directory);
    expect(value.exported).toBe(value.dataDir);
    expect(value.worker).toEqual({ dataDir: value.dataDir, exported: value.dataDir });
  });

  it('does not invent data-directory authority for an external server', async () => {
    const { value } = await inspectConfiguration(true);
    expect(value).toEqual({ dataDir: null, exported: null, worker: { dataDir: null, exported: null } });
  });
});
