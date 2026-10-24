import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { JsonStore, SecretStore } from '../server/store';
import { loadConfig } from '../server/config';

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const testSessionSecret = 'storage-test-session-secret-with-at-least-32-characters';
const testEncryptionKey = 'storage-test-credential-key-with-at-least-32-characters';

let dataDir: string;
let stateDir: string;
let store: JsonStore;

function testEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    WORKSPACE_PASSWORD: 'storage-test-password',
    SESSION_SECRET: testSessionSecret,
    ENCRYPTION_KEY: testEncryptionKey,
  };
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-storage-test-'));
  stateDir = path.join(dataDir, 'codex-workspace', 'state');
  store = new JsonStore(stateDir);
});

afterEach(async () => {
  await store.flush().catch(() => undefined);
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('ordinary, public bucket state', () => {
  it('locates durable files below the configured native data directory', () => {
    const config = loadConfig(testEnv());
    expect(config.dataDir).toBe(dataDir);
    expect(config.stateDir).toBe(stateDir);
    expect(config.workspacesDir).toBe(path.join(dataDir, 'workspaces'));
    expect(config.homeDir).toBe(path.join(dataDir, 'home'));
    expect(config.bucket).toBe('alvin3y12/data');
    expect(config.runtimeDir).not.toBe(config.workspacesDir);
  });

  it('reopens readable state, hidden Git files, and home files in a fresh process', async () => {
    const imports = `
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import { loadConfig } from './server/config.ts';
      import { JsonStore } from './server/store.ts';
      const config = loadConfig();
      const store = new JsonStore(config.stateDir);
    `;
    await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', String.raw`${imports}
      const workspacePath = path.join(config.workspacesDir, 'restart-project');
      await fs.mkdir(path.join(workspacePath, '.git'), { recursive: true });
      await fs.mkdir(config.homeDir, { recursive: true });
      await fs.writeFile(path.join(workspacePath, 'hello.ts'), 'export const persisted = true;\n');
      await fs.writeFile(path.join(workspacePath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      await fs.writeFile(path.join(config.homeDir, '.gitconfig'), '[init]\n  defaultBranch = main\n');
      await store.write('workspaces', [{ id: 'restart-project', name: 'Restart project', path: workspacePath }]);
      await store.write('thread-restart', { messages: ['This conversation survives a process restart.'] });
      await store.flush();
    `], { cwd: projectRoot, env: testEnv(), timeout: 15_000 });

    const { stdout } = await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', String.raw`${imports}
      const workspaces = await store.read('workspaces', []);
      const workspacePath = workspaces[0].path;
      console.log(JSON.stringify({
        workspaces,
        thread: await store.read('thread-restart', null),
        file: await fs.readFile(path.join(workspacePath, 'hello.ts'), 'utf8'),
        git: await fs.readFile(path.join(workspacePath, '.git', 'HEAD'), 'utf8'),
        home: await fs.readFile(path.join(config.homeDir, '.gitconfig'), 'utf8'),
      }));
    `], { cwd: projectRoot, env: testEnv(), timeout: 15_000 });

    const recovered = JSON.parse(stdout.trim());
    expect(recovered.workspaces).toEqual([{
      id: 'restart-project', name: 'Restart project', path: path.join(dataDir, 'workspaces', 'restart-project'),
    }]);
    expect(recovered.thread.messages).toEqual(['This conversation survives a process restart.']);
    expect(recovered.file).toBe('export const persisted = true;\n');
    expect(recovered.git).toBe('ref: refs/heads/main\n');
    expect(recovered.home).toBe('[init]\n  defaultBranch = main\n');
    const ordinaryState = await fs.readFile(path.join(stateDir, 'workspaces.json'), 'utf8');
    expect(JSON.parse(ordinaryState)[0].name).toBe('Restart project');
    expect(ordinaryState).not.toContain(testSessionSecret);
    expect(ordinaryState).not.toContain(testEncryptionKey);
  }, 30_000);

  it('serializes concurrent read-modify-write updates without losing entries', async () => {
    const expectedIds = Array.from({ length: 80 }, (_, index) => `event-${index}`);
    await Promise.all(expectedIds.map(id => store.update<string[]>('thread-events', [], async current => {
      // Yield inside the updater: an unlocked read-modify-write loses entries here.
      await Promise.resolve();
      return [...current, id];
    })));
    expect(await new JsonStore(stateDir).read('thread-events', [])).toEqual(expectedIds);
  });

  it('makes reads wait for an already queued write', async () => {
    let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const pendingUpdate = store.update('settings', { theme: 'dark' }, async () => {
      await gate;
      return { theme: 'light' };
    });
    const pendingRead = store.read('settings', { theme: 'missing' });
    unblock();
    await pendingUpdate;
    expect(await pendingRead).toEqual({ theme: 'light' });
  });

  it('clones values before queuing writes and does not mutate fallback values', async () => {
    const value = { selected: 'first', nested: { count: 1 } };
    const write = store.write('settings', value);
    value.selected = 'mutated-after-save';
    value.nested.count = 99;
    await write;
    expect(await store.read('settings', null)).toEqual({ selected: 'first', nested: { count: 1 } });

    const fallback = { list: ['original'] };
    const missing = await store.read('missing', fallback);
    missing.list.push('changed');
    expect(fallback).toEqual({ list: ['original'] });
    expect(await store.read('missing', fallback)).toEqual(fallback);
  });

  it.each(['../outside', '/tmp/outside', 'nested/key', 'nested\\key', '.', '..', '', 'bad\0key', 'a'.repeat(182)])(
    'rejects unsafe storage key %j for every operation', async key => {
      await expect(Promise.resolve().then(() => store.read(key, {}))).rejects.toThrow();
      await expect(Promise.resolve().then(() => store.write(key, {}))).rejects.toThrow();
      await expect(Promise.resolve().then(() => store.update(key, {}, value => value))).rejects.toThrow();
      await expect(Promise.resolve().then(() => store.delete(key))).rejects.toThrow();
    },
  );

  it('uses defaults only for missing state and refuses to overwrite malformed existing state', async () => {
    expect(await store.read('settings', { theme: 'dark' })).toEqual({ theme: 'dark' });
    await fs.mkdir(stateDir, { recursive: true });
    const filename = path.join(stateDir, 'settings.json');
    await fs.writeFile(filename, '{"theme":');
    await expect(store.read('settings', { theme: 'dark' })).rejects.toThrow();
    await expect(store.update('settings', { theme: 'dark' }, () => ({ theme: 'light' }))).rejects.toThrow();
    expect(await fs.readFile(filename, 'utf8')).toBe('{"theme":');
  });

  it('keeps the previous state and resumes its write queue after serialization or updater errors', async () => {
    await store.write('settings', { theme: 'dark' });
    await expect(store.write('settings', { unsupported: 1n })).rejects.toThrow();
    expect(await store.read('settings', null)).toEqual({ theme: 'dark' });
    await expect(store.update('settings', {}, () => { throw new Error('updater failed'); })).rejects.toThrow('updater failed');
    expect(await store.read('settings', null)).toEqual({ theme: 'dark' });
    await store.write('settings', { theme: 'light' });
    expect(await store.read('settings', null)).toEqual({ theme: 'light' });
    expect(await fs.readdir(stateDir)).toEqual(['settings.json']);
  });

  it('rejects a non-JSON root value without replacing valid state', async () => {
    await store.write('settings', { theme: 'dark' });
    await expect(Promise.resolve().then(() => store.write('settings', undefined))).rejects.toThrow();
    expect(await new JsonStore(stateDir).read('settings', null)).toEqual({ theme: 'dark' });
  });

  it('propagates filesystem failures and can be retried after the failure is fixed', async () => {
    const nonDirectory = path.join(dataDir, 'blocked');
    await fs.writeFile(nonDirectory, 'an ordinary file');
    const broken = new JsonStore(path.join(nonDirectory, 'state'));
    await expect(broken.write('settings', { theme: 'dark' })).rejects.toThrow();
    expect(await fs.readFile(nonDirectory, 'utf8')).toBe('an ordinary file');
    await fs.rm(nonDirectory);
    await broken.write('settings', { theme: 'light' });
    expect(await broken.read('settings', null)).toEqual({ theme: 'light' });
  });

  it('keeps complete parseable JSON visible to independent filesystem readers during updates', async () => {
    const filename = path.join(stateDir, 'thread-atomic.json');
    const payload = 'ordinary conversation content '.repeat(2048);
    await store.write('thread-atomic', { version: 0, payload });
    let writesFinished = false;
    const writes = Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.write('thread-atomic', { version: index + 1, payload }),
    )).finally(() => { writesFinished = true; });
    let reads = 0;
    while (!writesFinished) {
      const record = JSON.parse(await fs.readFile(filename, 'utf8'));
      expect(record.payload).toBe(payload);
      expect(record.version).toBeGreaterThanOrEqual(0);
      expect(record.version).toBeLessThanOrEqual(20);
      reads += 1;
    }
    await writes;
    expect(reads).toBeGreaterThan(0);
    expect(await store.read('thread-atomic', null)).toEqual({ version: 20, payload });
  });
});

describe('credential values in a public bucket', () => {
  it('protects only credential values while keeping normal state readable', async () => {
    const secrets = new SecretStore(store, testEncryptionKey);
    const githubToken = 'github-fixture-token-never-a-real-credential';
    const providerToken = 'model-fixture-token-never-a-real-credential';
    await Promise.all([
      secrets.set('github-fixture', githubToken),
      secrets.set('provider-key', providerToken),
      store.write('settings', { model: 'fixture-model', theme: 'dark' }),
    ]);

    const newStore = new JsonStore(stateDir);
    const reopened = new SecretStore(newStore, testEncryptionKey);
    expect(await reopened.get('github-fixture')).toBe(githubToken);
    expect(await reopened.get('provider-key')).toBe(providerToken);
    expect(await reopened.get('missing')).toBeUndefined();
    const stateFiles = await fs.readdir(stateDir);
    const diskContents = (await Promise.all(stateFiles.map(file => fs.readFile(path.join(stateDir, file), 'utf8')))).join('\n');
    expect(diskContents).toContain('fixture-model');
    expect(diskContents).not.toContain(githubToken);
    expect(diskContents).not.toContain(providerToken);
    expect(diskContents).not.toContain(testEncryptionKey);

    await reopened.delete('github-fixture');
    expect(await reopened.get('github-fixture')).toBeUndefined();
    expect(await reopened.get('provider-key')).toBe(providerToken);
  });

  it('fails to decrypt with the wrong key without losing stored credentials', async () => {
    const secrets = new SecretStore(store, testEncryptionKey);
    await secrets.set('github-fixture', 'not-a-real-token');
    const filename = path.join(stateDir, 'protected-credentials.json');
    const original = await fs.readFile(filename);
    const wrongKey = new SecretStore(new JsonStore(stateDir), 'different-key-that-is-at-least-32-characters');
    await expect(wrongKey.get('github-fixture')).rejects.toThrow();
    expect(await fs.readFile(filename)).toEqual(original);
    expect(await secrets.get('github-fixture')).toBe('not-a-real-token');
  });

  it('rejects modified authenticated ciphertext instead of returning an altered credential', async () => {
    const secrets = new SecretStore(store, testEncryptionKey);
    await secrets.set('github-fixture', 'not-a-real-token');
    await store.update<Record<string, string>>('protected-credentials', {}, values => {
      const data = Buffer.from(values['github-fixture'], 'base64');
      data[data.length - 1] ^= 1;
      return { ...values, 'github-fixture': data.toString('base64') };
    });
    await expect(secrets.get('github-fixture')).rejects.toThrow();
  });

  it('requires production password and both secret keys instead of persisting generated keys in the bucket', () => {
    const production = { ...testEnv(), NODE_ENV: 'production' };
    expect(() => loadConfig({ ...production, WORKSPACE_PASSWORD: undefined })).toThrow();
    expect(() => loadConfig({ ...production, SESSION_SECRET: undefined })).toThrow();
    expect(() => loadConfig({ ...production, ENCRYPTION_KEY: undefined })).toThrow();
    expect(() => loadConfig(production)).not.toThrow();
  });
});
