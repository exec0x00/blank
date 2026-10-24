import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import type { AppSettings, FileAttachment, FileContent, FileEntry, FileRewindPreview, FileRewindPreviewRow, Thread, ThreadListPage, ThreadRewindComplete, ThreadRewindRecoveryStatus, ThreadSummary, Workspace } from '../../shared/types';
import { changeReviewPageFixture } from './change-review-fixture';
import { directoryPageFixture } from './directory-page-fixture';
import { uiStateFixture } from './ui-state-fixture';

// Explicit transport fixture: the shipped app, rewind hook and Monaco run in the
// browser. These records do not stand in for Git/filesystem transaction tests.
export const REWIND_PROMPT = 'Restore the parser checkpoint before the second request.';
export const REWIND_RESULT = 'The second parser change is ready.';
export const FILE_BEFORE = 'export const parserVersion = 1;\n';
export const FILE_AFTER = 'export const parserVersion = 2;\n';
const now = '2026-09-20T10:00:00.000Z';
const rootId = 'rewind-thread';
export const REWIND_TURN = 'rewind-turn-2';

export interface RewindRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
}
type HeldKind = 'preview' | 'commit';
type CommitMode = 'complete' | 'conflict' | 'lost' | 'recovery_required';
export interface HeldRewindReply {
  started: boolean;
  settled: boolean;
  release(): void;
  wait: Promise<void>;
}
interface PreviewPlan { preview: FileRewindPreview; rows: FileRewindPreviewRow[]; }
interface FixtureOptions { unavailableReason?: string; files?: number; previewFailure?: boolean; }

function summary(thread: Thread): ThreadSummary {
  const { messages: _messages, ...value } = thread;
  return value;
}

export async function gitRewindFixture(page: Page, options: FixtureOptions = {}) {
  const preferences = uiStateFixture();
  const workspace: Workspace = { id: 'rewind-workspace', name: 'Git checkpoint fixture', path: '/data/workspaces/rewind-fixture', createdAt: now, updatedAt: now };
  const otherWorkspace: Workspace = { id: 'other-rewind-workspace', name: 'Independent workspace fixture', path: '/data/workspaces/other-rewind-fixture', createdAt: now, updatedAt: now };
  const settings: AppSettings = { model: 'fixture-rewind-model', reasoningEffort: 'max', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: true, agentConfigured: true };
  const restoredAttachment: FileAttachment = {
    id: 'file_0123456789abcdef0123456789abcdef', workspaceId: workspace.id,
    name: 'checkpoint-notes.txt', mimeType: 'text/plain', bytes: 31,
    sha256: createHash('sha256').update('Recorded checkpoint attachment.').digest('hex'), createdAt: now,
  };
  const root: Thread = {
    id: rootId, workspaceId: workspace.id, title: 'Parser checkpoint conversation', status: 'idle', mode: 'agent', permissionMode: 'ask', agents: [],
    createdAt: now, updatedAt: '2026-09-20T10:03:00.000Z',
    turns: [
      { id: 'rewind-turn-1', userMessageId: 'rewind-user-1', messageIds: ['rewind-user-1', 'rewind-assistant-1'], startedAt: now, completedAt: now, status: 'completed', purpose: 'conversation' },
      { id: REWIND_TURN, userMessageId: 'rewind-user-2', messageIds: ['rewind-user-2', 'rewind-assistant-2'], startedAt: now, completedAt: now, status: 'completed', purpose: 'conversation' },
    ],
    messages: [
      { id: 'rewind-user-1', role: 'user', content: 'Save the original parser.', turnId: 'rewind-turn-1', createdAt: now },
      { id: 'rewind-assistant-1', role: 'assistant', content: 'The original parser is recorded.', turnId: 'rewind-turn-1', createdAt: now },
      { id: 'rewind-user-2', role: 'user', content: REWIND_PROMPT, turnId: REWIND_TURN, fileAttachments: [restoredAttachment], createdAt: now },
      { id: 'rewind-assistant-2', role: 'assistant', content: REWIND_RESULT, turnId: REWIND_TURN, createdAt: now },
    ],
  };
  const otherThread: Thread = { id: 'independent-rewind-thread', workspaceId: workspace.id, title: 'Independent conversation fixture', status: 'idle', createdAt: now, updatedAt: '2026-09-20T10:01:00.000Z', messages: [{ id: 'other-message', role: 'assistant', content: 'This conversation has independent history.', createdAt: now }], turns: [], agents: [] };
  const remoteThread: Thread = { ...structuredClone(otherThread), id: 'other-workspace-thread', workspaceId: otherWorkspace.id, title: 'Other workspace conversation fixture', messages: [{ id: 'other-workspace-message', role: 'assistant', content: 'This workspace has independent history.', createdAt: now }] };
  const threads = new Map([[root.id, root], [otherThread.id, otherThread], [remoteThread.id, remoteThread]]);
  const workspaces = [workspace, otherWorkspace];
  const contents = new Map<string, string>([
    ['src/changed.ts', FILE_AFTER], ['src/new.ts', 'export const addedBySecondTurn = true;\n'],
    ['notes/unrelated.ts', 'export const unrelated = "saved";\n'], ['README.md', '# Explicit rewind browser fixture\n'],
  ]);
  const versions = new Map([...contents.keys()].map(path => [path, 1]));
  const rows: FileRewindPreviewRow[] = [
    { path: 'src/changed.ts', action: 'update', staged: false },
    { path: 'src/new.ts', action: 'delete', staged: false },
    { path: 'src/restored.ts', action: 'create', staged: true },
  ];
  if (options.files !== undefined && options.files < rows.length) rows.splice(options.files);
  while (rows.length < (options.files ?? 3)) {
    const path = `generated/record-${String(rows.length + 1).padStart(4, '0')}.ts`;
    rows.push({ path, action: 'update', staged: false });
    contents.set(path, '// Current checkpoint fixture contents.\n'); versions.set(path, 1);
  }
  const requests: RewindRequest[] = [], unexpected: string[] = [], pageErrors: string[] = [];
  const plans = new Map<string, PreviewPlan>();
  const statuses = new Map<string, ThreadRewindRecoveryStatus>();
  const held: Record<HeldKind, HeldRewindReply[]> = { preview: [], commit: [] };
  const allHeld: HeldRewindReply[] = [];
  let authenticated = true, activeWorkspaceId = workspace.id, previewCounter = 0, commitCounter = 0;
  let previewFailure = !!options.previewFailure;
  let nextCommit: CommitMode = 'complete';
  let statusPending = false;
  let discoveredStatus: ThreadRewindRecoveryStatus | undefined;
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.addInitScript(() => {
    class FixtureEventSource {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
      CONNECTING = 0; OPEN = 1; CLOSED = 2;
      readyState = 0; withCredentials = true; url: string;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(url: string | URL) {
        this.url = String(url);
        setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(new Event('open')); } }, 0);
      }
      close() { this.readyState = 2; }
      addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
    }
    window.EventSource = FixtureEventSource as unknown as typeof EventSource;
  });

  function holdNext(kind: HeldKind): HeldRewindReply {
    let release!: () => void;
    const reply: HeldRewindReply = { started: false, settled: false, release: () => release(), wait: new Promise<void>(resolve => { release = resolve; }) };
    held[kind].push(reply); allHeld.push(reply); return reply;
  }
  async function respond(route: Route, value: unknown, status = 200, kind?: HeldKind) {
    const reply = kind ? held[kind].shift() : undefined;
    if (reply) { reply.started = true; await reply.wait; }
    try { await route.fulfill({ status, json: value }); }
    catch (error) { if (!reply && !page.isClosed() && !route.request().failure()) throw error; }
    finally { if (reply) reply.settled = true; }
  }
  const file = (path: string): FileContent | undefined => contents.has(path) ? {
    path, content: contents.get(path)!, version: `fixture-${versions.get(path)}-${path}`,
    language: path.endsWith('.ts') ? 'typescript' : 'markdown', size: Buffer.byteLength(contents.get(path)!),
  } : undefined;
  function entries(): FileEntry[] {
    const entries = new Map<string, FileEntry>();
    for (const path of contents.keys()) {
      const parts = path.split('/');
      for (let count = 1; count < parts.length; count++) {
        const directory = parts.slice(0, count).join('/');
        entries.set(directory, { name: parts[count - 1], path: directory, kind: 'directory' });
      }
      entries.set(path, { name: parts.at(-1)!, path, kind: 'file', size: Buffer.byteLength(contents.get(path)!) });
    }
    return [...entries.values()];
  }
  function preview(thread: Thread, body: Record<string, unknown>): FileRewindPreview {
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 25)), offset = Math.max(0, Number(body.offset) || 0);
    if (discoveredStatus?.status === 'pending' || discoveredStatus?.status === 'recovery_required') return {
      availability: 'unavailable', reason: 'An earlier file rewind needs attention before another file rewind can start.',
      workspaceId: thread.workspaceId, threadId: thread.id, beforeTurnId: String(body.beforeTurnId),
      index: { behavior: 'preserve', changedPaths: 0, description: 'Check the earlier transaction before changing files or staging.' },
      rows: [], offset: 0, limit, total: 0, hasMore: false, affectedDirtyPaths: [], canCommit: false, warnings: [],
      recovery: structuredClone(discoveredStatus),
    };
    if (options.unavailableReason) return {
      availability: 'unavailable', reason: options.unavailableReason, workspaceId: thread.workspaceId, threadId: thread.id,
      beforeTurnId: String(body.beforeTurnId), index: { behavior: 'preserve', changedPaths: 0, description: 'Workspace files and Git staging remain unchanged.' },
      rows: [], offset: 0, limit, total: 0, hasMore: false, affectedDirtyPaths: [], canCommit: false, warnings: [],
    };
    if (body.planId) {
      const saved = plans.get(String(body.planId));
      if (!saved || saved.preview.version !== body.version) throw new Error('The UI requested an unknown checkpoint preview version.');
      const pageRows = saved.rows.slice(offset, offset + limit);
      return { ...structuredClone(saved.preview), rows: pageRows, offset, limit, hasMore: offset + pageRows.length < saved.rows.length };
    }
    const planId = `fixture-plan-${++previewCounter}`, version = `fixture-plan-version-${previewCounter}`;
    const dirtyPaths = Array.isArray(body.dirtyPaths) ? body.dirtyPaths.filter((path): path is string => typeof path === 'string') : [];
    const affectedDirtyPaths = dirtyPaths.filter(path => rows.some(row => row.path === path || row.path.startsWith(`${path}/`) || path.startsWith(`${row.path}/`)));
    const value: FileRewindPreview = {
      availability: 'available', workspaceId: thread.workspaceId, threadId: thread.id, beforeTurnId: String(body.beforeTurnId), planId, version,
      expiresAt: new Date(Date.now() + 300_000).toISOString(), checkpoint: { id: 'fixture-checkpoint-2', createdAt: now, head: '1234567890abcdef1234567890abcdef12345678', branch: 'feature/parser' },
      index: { behavior: 'restore-captured-entries', changedPaths: rows.some(row => row.staged) ? 1 : 0, description: 'Restore captured staging for affected paths; unrelated staged files are preserved.' },
      rows: rows.slice(0, limit), offset: 0, limit, total: rows.length, hasMore: rows.length > limit,
      affectedDirtyPaths, canCommit: !affectedDirtyPaths.length, warnings: ['External services and commands outside the workspace cannot be rewound.'],
    };
    plans.set(planId, { preview: structuredClone(value), rows: structuredClone(rows) });
    return value;
  }
  function commit(thread: Thread, body: Record<string, unknown>): ThreadRewindComplete {
    const files = body.files as { planId: string; version: string } | undefined;
    const turn = thread.turns?.find(turn => turn.id === body.beforeTurnId);
    if (!turn) throw new Error('The fixture received a rewind for an absent turn.');
    const boundary = thread.messages.findIndex(message => message.id === turn.userMessageId);
    const prompt = thread.messages[boundary];
    if (files) for (const row of rows) {
      if (row.action === 'delete') contents.delete(row.path);
      else contents.set(row.path, row.path === 'src/changed.ts' ? FILE_BEFORE : '// Restored checkpoint fixture contents.\n');
      versions.set(row.path, (versions.get(row.path) || 0) + 1);
    }
    thread.messages = thread.messages.slice(0, boundary);
    thread.turns = thread.turns!.slice(0, thread.turns!.indexOf(turn));
    return {
      status: 'complete', workspaceId: thread.workspaceId, threadId: thread.id, beforeTurnId: String(body.beforeTurnId), thread: structuredClone(thread), restoredPrompt: prompt.content,
      restoredFileAttachments: structuredClone(prompt.fileAttachments || []), restoredAttachments: [],
      filesUnchanged: !files || rows.length === 0, filesRewound: files ? rows.length : 0,
      backupId: `fixture-backup-${++commitCounter}`,
      ...(files ? { recoveryId: `fixture-recovery-${commitCounter}`, planId: files.planId, planVersion: files.version } : {}),
    };
  }

  await page.route('**/api/**', async route => {
    if (await preferences.handle(route)) return;
    const request = route.request(), url = new URL(request.url()), path = url.pathname.slice('/api'.length), method = request.method();
    const body = request.postData() && request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() as Record<string, unknown> : null;
    requests.push({ method, path, query: Object.fromEntries(url.searchParams), body });
    if (path === '/session') {
      if (method === 'DELETE') authenticated = false;
      if (method === 'POST') authenticated = true;
      return respond(route, { authenticated });
    }
    if (!authenticated) return respond(route, { error: 'Fixture session is locked.', code: 'UNAUTHORIZED' }, 401);
    if (path === '/bootstrap') return respond(route, {
      workspaces, activeWorkspaceId, activeWorkspace: workspaces.find(value => value.id === activeWorkspaceId),
      workspacePage: { nextCursor: null, previousCursor: null, offset: 0, total: workspaces.length, revision: 'fixture-workspaces-1' },
      settings, githubAccounts: [], uiState: preferences.read(), storage: { path: '/data', bucket: 'fixture/data', persistent: true, writable: true },
    });
    if (path === '/models') return respond(route, { models: [settings.model], revision: 1, catalog: [{
      id: settings.model, profileId: 'checkpoint-fixture-profile', revision: 1, label: 'Checkpoint fixture model', group: 'Custom', origin: 'custom',
      contextWindow: 200_000, maxOutputTokens: 32_000, contextSource: 'user', autoCompactThreshold: 90, effectiveContextPercent: 95,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], reasoningSummaries: ['auto', 'concise', 'detailed'], verbosities: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'max', defaultReasoningSummary: null, defaultVerbosity: null, defaultMaxOutputTokens: null,
    }] });
    if (path === '/skills') return respond(route, { skills: [], issues: [] });
    if (path === '/skills/page') return respond(route, { skills: [], issues: [], nextCursor: null, complete: true, searched: 0, limit: 30 });
    if (path === '/changes') return respond(route, changeReviewPageFixture(url));
    if (path === '/github/accounts') return respond(route, { accounts: [], nextCursor: null, previousCursor: null, offset: 0, total: 0 });
    if (path === '/downloads/status') return respond(route, { enabled: false, ready: false });
    if (path === '/downloads' || path.endsWith('/workflows') || path.endsWith('/terminals')) return respond(route, []);
    if (path === '/workspaces' && method === 'GET') {
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const selected = workspaces.filter(value => value.name.toLowerCase().includes(query));
      return respond(route, { workspaces: selected, nextCursor: null, previousCursor: null, offset: 0, total: selected.length, revision: 'fixture-workspaces-1' });
    }
    const workspaceMatch = /^\/workspaces\/([^/]+)(?:\/([\w-]+(?:\/page)?))?$/.exec(path);
    if (workspaceMatch) {
      const selected = workspaces.find(value => value.id === workspaceMatch[1]);
      if (!selected) return respond(route, { error: 'Fixture workspace is unavailable.' }, 404);
      const endpoint = workspaceMatch[2];
      if (!endpoint && method === 'GET') return respond(route, selected);
      if (!endpoint && method === 'PATCH' && body?.active === true) { activeWorkspaceId = selected.id; return respond(route, selected); }
      // Workspace-recovery tests install a narrower route with their durable
      // record states. These thread-control cases start with no discovered record.
      if (endpoint === 'rewind-recovery' && method === 'GET') return respond(route, { workspaceId: selected.id, recovery: null });
      if (endpoint === 'file-transfers/page' && method === 'GET') return respond(route, {
        items: [], offset: 0, limit: Number(url.searchParams.get('limit') || 25), total: 0, hasMore: false,
      });
      if (endpoint === 'tree-page') return respond(route, directoryPageFixture(url, entries()));
      if (endpoint === 'tree-entry') {
        const entry = entries().find(value => value.path === url.searchParams.get('path'));
        return respond(route, entry || { error: 'Fixture file not found.', code: 'FILE_NOT_FOUND' }, entry ? 200 : 404);
      }
      if (endpoint === 'file-paths') return respond(route, [...contents.keys()]);
      if (endpoint === 'file' && method === 'GET') {
        const value = file(url.searchParams.get('path') || '');
        return respond(route, value || { error: 'Fixture file not found.', code: 'FILE_NOT_FOUND' }, value ? 200 : 404);
      }
      if (endpoint === 'file' && method === 'PUT' && typeof body?.path === 'string' && typeof body.content === 'string') {
        const current = file(body.path);
        if (!current || current.version !== body.expectedVersion) return respond(route, { error: 'The fixture file changed on disk.', code: 'FILE_CONFLICT' }, 409);
        contents.set(body.path, body.content); versions.set(body.path, (versions.get(body.path) || 0) + 1);
        return respond(route, file(body.path));
      }
    }
    if (/^\/workspaces\/[^/]+\/git\/status$/.test(path)) return respond(route, { isRepository: !options.unavailableReason?.includes('not a Git'), branch: 'feature/parser', ahead: 0, behind: 0, files: [], branches: ['feature/parser'] });
    if (path === '/threads' && method === 'GET') {
      const values = [...threads.values()].filter(thread => thread.workspaceId === url.searchParams.get('workspaceId')).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const list: ThreadListPage = { items: values, olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false };
      return respond(route, list);
    }
    const threadMatch = /^\/threads\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (threadMatch) {
      const thread = threads.get(threadMatch[1]), endpoint = threadMatch[2];
      if (!thread) return respond(route, { error: 'Fixture conversation unavailable.' }, 404);
      if (!endpoint && method === 'GET') return respond(route, thread);
      if (endpoint === 'agents' && method === 'GET') return respond(route, []);
      if (endpoint === 'rewind/preview' && method === 'POST' && body) {
        if (previewFailure) return respond(route, { error: 'The saved checkpoint could not be read.', code: 'FILE_REWIND_UNAVAILABLE' }, 503, 'preview');
        return respond(route, preview(thread, body), 200, 'preview');
      }
      if (endpoint === 'rewind' && method === 'POST' && body) {
        const files = body.files as { planId?: string; version?: string } | undefined;
        const plan = files?.planId ? plans.get(files.planId) : undefined;
        if (files && (!plan || plan.preview.version !== files.version || plan.preview.beforeTurnId !== body.beforeTurnId || plan.preview.threadId !== thread.id)) {
          unexpected.push('A file commit did not use its exact confirmed preview.');
          return respond(route, { error: 'The fixture cannot verify this file rewind plan.', code: 'FILE_REWIND_CONFLICT' }, 409);
        }
        const mode = nextCommit; nextCommit = 'complete';
        if (mode === 'conflict') return respond(route, { error: 'src/changed.ts changed after this checkpoint preview. Refresh the preview before continuing.', code: 'FILE_REWIND_CONFLICT' }, 409, 'commit');
        if (mode === 'recovery_required') {
          if (!files || typeof files.planId !== 'string' || typeof files.version !== 'string') throw new Error('The recovery fixture needs a submitted file plan.');
          const recovery = { status: 'recovery_required' as const, workspaceId: thread.workspaceId, threadId: thread.id, beforeTurnId: String(body.beforeTurnId),
            planId: files.planId, planVersion: files.version, recoveryId: 'fixture-recovery-needed', backupId: 'fixture-backup-needed',
            message: 'The saved files need recovery review. The original conversation is preserved.', threadUnchanged: true };
          statuses.set(`${files.planId}:${files.version}`, recovery);
          return respond(route, recovery, 200, 'commit');
        }
        const receipt = commit(thread, body);
        if (files) statuses.set(`${files.planId}:${files.version}`, receipt);
        if (mode === 'lost') { statusPending = true; await route.abort('failed'); return; }
        return respond(route, receipt, 200, 'commit');
      }
      if (endpoint === 'rewind/status' && method === 'GET') {
        const planId = url.searchParams.get('planId') || '', version = url.searchParams.get('version') || '';
        if (!planId && !version && discoveredStatus) return respond(route, discoveredStatus);
        const value = statuses.get(`${planId}:${version}`);
        if (statusPending && value?.status === 'complete') return respond(route, { status: 'pending', workspaceId: value.thread.workspaceId, threadId: value.thread.id, beforeTurnId: value.beforeTurnId, planId, version, recoveryId: value.recoveryId!, message: 'The checkpoint receipt is still being verified.' });
        return respond(route, value || { status: 'not_started', planId, version });
      }
      if (endpoint?.startsWith('rewind/recovery/') && method === 'GET') {
        const id = endpoint.slice('rewind/recovery/'.length);
        const value = [...statuses.values()].find(value => 'recoveryId' in value && value.recoveryId === id);
        return respond(route, value || { error: 'Unknown fixture rewind recovery.' }, value ? 200 : 404);
      }
    }
    unexpected.push(`${method} ${path}`);
    return respond(route, { error: `Unexpected Git rewind browser fixture request: ${method} ${path}` }, 404);
  });

  return {
    workspace, otherWorkspace, root, otherThread, remoteThread, restoredAttachment, requests, unexpected, pageErrors, plans,
    snapshotFiles: () => Object.fromEntries(contents), file: (path: string) => contents.get(path),
    previewRequests: () => requests.filter(request => request.path.endsWith('/rewind/preview')),
    commits: () => requests.filter(request => request.path.endsWith('/rewind') && request.method === 'POST'),
    statusReads: () => requests.filter(request => request.path.endsWith('/rewind/status') && request.method === 'GET'),
    fileWrites: () => requests.filter(request => request.path.endsWith('/file') && request.method === 'PUT'),
    holdNext,
    failNextCommit: (failure: CommitMode) => { nextCommit = failure; },
    allowStatusCompletion: () => { statusPending = false; },
    discoverEarlierRecovery() {
      discoveredStatus = {
        status: 'recovery_required', workspaceId: root.workspaceId, threadId: root.id, beforeTurnId: 'rewind-turn-1',
        planId: 'earlier-fixture-plan', planVersion: 'earlier-fixture-plan-version',
        recoveryId: 'earlier-fixture-recovery', backupId: 'earlier-fixture-backup', threadUnchanged: true,
        message: 'An earlier transaction was found in durable recovery records after reload.',
      };
    },
    completeEarlierRecovery() {
      discoveredStatus = {
        status: 'complete', workspaceId: root.workspaceId, threadId: root.id, beforeTurnId: 'rewind-turn-1',
        planId: 'earlier-fixture-plan', planVersion: 'earlier-fixture-plan-version',
        recoveryId: 'earlier-fixture-recovery', backupId: 'earlier-fixture-backup', filesRewound: 1, filesUnchanged: false,
        thread: { ...structuredClone(root), turns: [], messages: [] }, restoredPrompt: 'An obsolete prompt from the earlier transaction.',
        restoredAttachments: [], restoredFileAttachments: [restoredAttachment],
      };
    },
    setPreviewFailure: (failure: boolean) => { previewFailure = failure; },
    releaseAll: () => allHeld.forEach(reply => reply.release()),
    async expireSession(nextWorkspaceId = activeWorkspaceId) {
      authenticated = false; activeWorkspaceId = nextWorkspaceId;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
    },
  };
}

export type GitRewindFixture = Awaited<ReturnType<typeof gitRewindFixture>>;
