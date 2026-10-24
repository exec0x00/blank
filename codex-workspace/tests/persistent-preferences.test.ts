import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppSettings, Bootstrap, GithubAccount, GithubRepo, Thread, UiState, Workspace } from '../shared/types';
import { preferenceFixtureTokens } from './fixtures/persistent-native-boundary';
import {
  closePreferenceProcesses, inspectPreferenceProcess, preferenceFixturePassword as password, PreferenceStartupError,
  startPreferenceProcess as startProcess, stopPreferenceProcess as stopProcess,
  type PreferenceAppProcess as AppProcess,
} from './fixtures/persistent-application-process';

const directories = new Set<string>();

interface RequestOptions { method?: string; cookie?: string; body?: unknown }

async function request<T>(app: AppProcess, route: string, options: RequestOptions = {}) {
  const response = await fetch(`${app.base}/api${route}`, {
    method: options.method ?? 'GET', signal: AbortSignal.timeout(10_000),
    headers: {
      Origin: app.base, 'X-Codex-Workspace': '1',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, headers: response.headers, body: await response.json() as T };
}

async function read<T>(app: AppProcess, cookie: string, route: string, options: Omit<RequestOptions, 'cookie'> = {}, status = 200): Promise<T> {
  const result = await request<T>(app, route, { ...options, cookie });
  expect(result.status, `${options.method ?? 'GET'} ${route}: ${JSON.stringify(result.body)}`).toBe(status);
  return result.body;
}

async function signIn(app: AppProcess): Promise<string> {
  const result = await request(app, '/session', { method: 'POST', body: { password } });
  expect(result.status).toBe(200);
  const cookie = result.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Preference fixture login did not return a session.');
  return cookie;
}

async function file(location: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(location), { recursive: true });
  await fs.writeFile(location, content);
}


afterEach(async () => {
  // Retain fixture files if an owned child cannot be reaped. Never remove its
  // durable/runtime directories while it may still be using them.
  await closePreferenceProcesses();
  await Promise.all([...directories].map(directory => fs.rm(directory, { recursive: true, force: true })));
  directories.clear();
}, 30_000);

describe('durable preferences through ordinary application restarts', () => {
  it('restores native preferences, account connections, selected history and source files after disposable runtime loss', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-preferences-restart-'));
    directories.add(directory);
    const dataDir = path.join(directory, 'data');
    // Old appearance state is data, not authority to restore a light theme.
    await file(path.join(dataDir, 'codex-workspace/state/settings.json'), JSON.stringify({ theme: 'light', fontSize: 12, wordWrap: false }));
    const first = await startProcess(dataDir, path.join(directory, 'runtime-before'));
    const cookie = await signIn(first);
    const workspace = await read<Workspace>(first, cookie, '/workspaces', { method: 'POST', body: { name: 'Persistent project', initializeGit: false } }, 201);
    await read(first, cookie, `/workspaces/${workspace.id}`, { method: 'PATCH', body: { active: true } });
    expect(first.homeDir).toBe(path.join(dataDir, 'home'));
    expect(first.stateDir).toBe(path.join(dataDir, 'codex-workspace', 'state'));
    expect(workspace.path.startsWith(`${first.workspacesDir}${path.sep}`)).toBe(true);
    expect((await read<AppSettings>(first, cookie, '/settings')).theme).toBe('dark');
    expect((await request(first, '/settings', { method: 'PATCH', cookie, body: { theme: 'light' } })).status).toBe(400);

    // Native config read/CAS/write is the explicitly controlled external
    // boundary; the actual server route and durable TOML are used twice.
    const preferences = { model: 'gpt-6-astra', reasoningEffort: 'xhigh', webSearchMode: 'disabled', autoApprove: true, fontSize: 18, wordWrap: true };
    const savedSettings = await read<AppSettings>(first, cookie, '/settings', { method: 'PATCH', body: preferences });
    expect(savedSettings).toMatchObject({ ...preferences, theme: 'dark' });
    expect(first.inspection?.nativeBoundary).toBe('controlled-file-backed-config');

    const accounts: GithubAccount[] = [];
    for (const token of preferenceFixtureTokens) accounts.push(await read<GithubAccount>(first, cookie, '/github/accounts', { method: 'POST', body: { token } }, 201));
    expect(accounts.map(account => account.id)).toEqual(['gh_7201', 'gh_7202']);
    await read(first, cookie, `/workspaces/${workspace.id}`, { method: 'PATCH', body: { githubAccountId: accounts[1].id } });
    for (const account of accounts) {
      const repositories = await read<GithubRepo[]>(first, cookie, `/github/accounts/${account.id}/repos`);
      expect(repositories).toHaveLength(1);expect(repositories[0].fullName).toBe(`${account.login}/saved-repository`);
    }

    await read(first, cookie, `/workspaces/${workspace.id}/file`, { method: 'PUT', body: { path: 'notes.md', content: '# Persistent project notes\n' } });
    const threadId = `thr_${randomUUID().replaceAll('-', '')}`;
    const stamp = '2026-09-20T00:00:00.000Z';
    // Selection now authorizes the actual read-only record. An old standalone
    // thread-index row is deliberately insufficient and never seeded here.
    const thread: Thread = { id: threadId, workspaceId: workspace.id, title: 'Saved project conversation', createdAt: stamp, updatedAt: stamp, status: 'idle',
      messages: [{ id: 'saved-user', role: 'user', content: 'Preserve this saved project request.', createdAt: stamp },
        { id: 'saved-answer', role: 'assistant', content: 'Preserve this public answer.', createdAt: stamp }],
      timeline: { version: 1, revision: 2, nextSequence: 3, entries: [
        { id: 'saved-user-entry', kind: 'message', messageId: 'saved-user', sequence: 1, revision: 1 },
        { id: 'saved-answer-entry', kind: 'text', messageId: 'saved-answer', sequence: 2, revision: 2, text: 'Preserve this public answer.', startOffset: 0 },
      ] }, turns: [],
    };
    const sourceFile = path.join(first.stateDir, `thread-${threadId}.json`);
    await file(sourceFile, JSON.stringify({ thread, input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_STORED_INPUT_MUST_NOT_BE_PUBLIC' }] }));
    const savedThread = await read<Thread>(first, cookie, `/threads/${threadId}`);
    const historyRoute = `/threads/${threadId}/history?limit=1`;
    const savedHistoryPage = await read<Thread>(first, cookie, historyRoute);
    expect(savedThread).toMatchObject({ id: threadId, backend: 'legacy', readOnly: true, title: thread.title, status: 'idle' });
    expect(savedThread.messages.map(message => message.content)).toEqual(thread.messages.map(message => message.content));
    expect(JSON.stringify(savedThread)).not.toContain('PRIVATE_STORED_INPUT');
    expect(savedHistoryPage.timeline!.entries.length).toBeLessThanOrEqual(1);
    expect((await request(first, `/threads/${threadId}/run`, { cookie, method: 'POST', body: { prompt: 'Must remain read only.' } })).body)
      .toMatchObject({ code: 'LEGACY_THREAD_READ_ONLY' });

    const savedUi = await read<UiState>(first, cookie, '/ui-state', { method: 'PATCH', body: { revision: 0, changes: [
      { section: 'layout', profile: 'desktop', key: 'view', value: 'editor' },
      { section: 'layout', profile: 'desktop', key: 'split', value: 'focus' },
      { section: 'layout', profile: 'mobile', key: 'view', value: 'git' },
      { section: 'editor', key: 'minimap', value: true },
      { section: 'editor', key: 'lineNumbers', value: false },
      { section: 'editor', key: 'wrap', value: true },
      { section: 'workspace', workspaceId: workspace.id, key: 'threadId', value: threadId },
      { section: 'workspace', workspaceId: workspace.id, key: 'tabs', value: { paths: ['notes.md'], active: 'notes.md' } },
    ] } });

    // Portable user/project sources remain durable. Retired extension install,
    // marketplace, role expansion and custom workflow execution are not faked.
    const reusableFiles = [
      [path.join(first.homeDir, '.agents/skills/personal-checklist/SKILL.md'), '---\nname: personal-checklist\ndescription: Saved personal checklist\n---\nKeep this source across restarts.\n'],
      [path.join(workspace.path, '.agents/skills/project-checklist/SKILL.md'), '---\nname: project-checklist\ndescription: Saved project checklist\n---\nRead the saved project checklist.\n'],
      [path.join(first.homeDir, '.codex/AGENTS.md'), 'Preserve the global personal instruction source.\n'],
      [path.join(workspace.path, 'AGENTS.md'), 'Preserve the project instructions.\n'],
      [path.join(workspace.path, '.codex/workflows/release.md'), '# Release checklist\nUse the saved release workflow.\n'],
      [path.join(workspace.path, 'src/application.ts'), 'export const sourceSurvivesRestart = true;\n'],
    ] as const;
    for (const [location, content] of reusableFiles) await file(location, content);
    await file(path.join(first.runtimeDir, 'cache/disposable-sentinel'), 'Discardable cache bytes.\n');
    const credentialFiles = (await fs.readdir(first.stateDir)).filter(name => name.startsWith('github-account-version-')).map(name => path.join(first.stateDir, name));
    expect(credentialFiles).toHaveLength(2);
    const durableFiles = [sourceFile, first.inspection!.nativeConfigFile, ...reusableFiles.map(([location]) => location), ...credentialFiles,
      ...['settings', 'ui-state', 'active-workspace', `workspace-record-${workspace.id}`].map(key => path.join(first.stateDir, `${key}.json`)),
      path.join(workspace.path, 'notes.md'),
    ];
    const originalBytes = new Map<string, string>();
    for (const location of durableFiles) originalBytes.set(location, await fs.readFile(location, 'utf8'));
    for (const location of credentialFiles) for (const token of preferenceFixtureTokens) expect(originalBytes.get(location)).not.toContain(token);
    expect(JSON.parse(originalBytes.get(path.join(first.stateDir, 'settings.json'))!)).toMatchObject(preferences);
    expect(originalBytes.get(first.inspection!.nativeConfigFile)).toContain('model_reasoning_effort = "xhigh"');
    const firstInspection = await inspectPreferenceProcess(first);
    expect(firstInspection).toMatchObject({ nativeProcessStarted: false, githubProfiles: 2, githubRepositoryReads: 2, unexpectedNetwork: 0 });
    expect(firstInspection.nativeMethods.filter(method => method === 'config/batchWrite')).toHaveLength(1);
    expect(firstInspection.nativeMethods.every(method => ['config/read', 'config/batchWrite'].includes(method))).toBe(true);

    expect((await request(first, '/session', { method: 'DELETE', cookie })).status).toBe(200);
    expect((await request(first, '/settings', { cookie })).status).toBe(401);
    expect((await request(first, '/github/accounts', { cookie })).status).toBe(401);
    await stopProcess(first.child);await expect(fs.stat(`/proc/${first.pid}`)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm(first.runtimeDir, { recursive: true });await expect(fs.stat(first.runtimeDir)).rejects.toMatchObject({ code: 'ENOENT' });

    const second = await startProcess(dataDir, path.join(directory, 'runtime-after'), workspace.id);
    expect(second.pid).not.toBe(first.pid);expect(second.homeDir).toBe(first.homeDir);expect(second.stateDir).toBe(first.stateDir);
    expect(second.runtimeDir).not.toBe(first.runtimeDir);
    expect((await request(second, '/bootstrap', { cookie })).status).toBe(401);
    const restoredCookie = await signIn(second), bootstrap = await read<Bootstrap>(second, restoredCookie, '/bootstrap');
    expect(bootstrap.activeWorkspaceId).toBe(workspace.id);
    expect(bootstrap.workspaces.find(item => item.id === workspace.id)).toMatchObject({ id: workspace.id, name: workspace.name, path: workspace.path, githubAccountId: accounts[1].id });
    expect(bootstrap.settings).toEqual(savedSettings);expect(bootstrap.settings.theme).toBe('dark');expect(bootstrap.uiState).toEqual(savedUi);
    expect(bootstrap.githubAccounts).toEqual(accounts);
    expect(await read<Thread>(second, restoredCookie, `/threads/${threadId}`)).toEqual(savedThread);
    expect(await read<Thread>(second, restoredCookie, historyRoute)).toEqual(savedHistoryPage);
    expect(await request(second, `/workspaces/${workspace.id}/workflows`, { cookie: restoredCookie }))
      .toMatchObject({ status: 410, body: { code: 'CUSTOM_AGENT_FEATURE_REMOVED' } });
    expect(await read(second, restoredCookie, `/workspaces/${workspace.id}/file?path=${encodeURIComponent('.codex/workflows/release.md')}`))
      .toMatchObject({ path: '.codex/workflows/release.md', content: '# Release checklist\nUse the saved release workflow.\n' });
    for (const account of accounts) expect((await read<GithubRepo[]>(second, restoredCookie, `/github/accounts/${account.id}/repos`))[0].fullName).toBe(`${account.login}/saved-repository`);
    const secondInspection = await inspectPreferenceProcess(second);
    expect(secondInspection).toMatchObject({ nativeProcessStarted: false, githubProfiles: 0, githubRepositoryReads: 2, unexpectedNetwork: 0 });
    expect(secondInspection.nativeMethods.every(method => method === 'config/read')).toBe(true);
    for (const [location, bytes] of originalBytes) expect(await fs.readFile(location, 'utf8'), location).toBe(bytes);
    await expect(fs.stat(path.join(second.runtimeDir, 'cache/disposable-sentinel'))).rejects.toMatchObject({ code: 'ENOENT' });
    await stopProcess(second.child);await expect(fs.stat(`/proc/${second.pid}`)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('reports a stalled bootstrap and reaps its owned child before rejecting startup', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-preferences-startup-failure-'));
    directories.add(directory);
    let error: unknown;
    try {
      await startProcess(path.join(directory, 'data'), path.join(directory, 'runtime'), undefined, {
        startupTimeoutMs: 3000,
        bootstrap: `process.on('SIGTERM', () => {});
          process.send({ type: 'phase', phase: 'fixture-stalled' });
          process.stderr.write('Deliberately stalled lifecycle fixture.\\n');
          setInterval(() => {}, 1000);`,
      });
    } catch (failure) { error = failure; }
    expect(error).toBeInstanceOf(PreferenceStartupError);
    const failure = error as PreferenceStartupError;
    expect(failure.message).toContain('startup exceeded 3000 ms');
    expect(failure.message).toContain('phase=fixture-stalled');
    expect(failure.message).toContain('Deliberately stalled lifecycle fixture.');
    expect(failure.message).not.toContain('did not shut down cleanly');
    expect(failure.processId).toBeGreaterThan(0);
    await expect(fs.stat(`/proc/${failure.processId}`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(closePreferenceProcesses()).resolves.toBeUndefined();
  }, 15_000);
});
