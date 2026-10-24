import type { Page, Route } from '@playwright/test';
import type { FileRewindKeepCurrentResult, FileRewindRecoveryReview, FileRewindRecoveryRow, WorkspaceRewindRecovery } from '../../shared/types';
import { gitRewindFixture, REWIND_TURN, type RewindRequest } from './git-rewind-fixture';

// This is an explicit API transport fixture for the shipped React hook and
// dialogs. Native recovery, file identity and durable journal behavior have
// separate server/filesystem tests; no browser fixture proves those properties.
type HeldKind = 'discovery' | 'review' | 'acknowledgement';
type Failure = 'conflict' | 'lost-after-commit' | 'foreign-receipt';
interface HeldReply { started: boolean; settled: boolean; release(): void; wait: Promise<void> }
interface Options { rows?: number; state?: FileRewindRecoveryReview['state']; canKeepCurrent?: boolean; transcript?: FileRewindRecoveryReview['transcript']; discoveryFailure?: boolean; targetWorkspaceId?: string; targetWorkspaceName?: string }

export async function workspaceRewindRecoveryFixture(page: Page, options: Options = {}) {
  const base = await gitRewindFixture(page);
  const rows: FileRewindRecoveryRow[] = [
    { path: 'src/changed.ts', state: 'restored', staged: false },
    { path: 'src/new.ts', state: 'changed', staged: false },
    { path: 'src/restored.ts', state: 'missing', staged: true },
  ];
  const rowLimit = options.rows ?? 3;
  while (rows.length < rowLimit) rows.push({ path: `generated/recovery-${String(rows.length + 1).padStart(4, '0')}.ts`, state: 'original', staged: false });
  if (rowLimit < rows.length) rows.splice(rowLimit);
  const requests: RewindRequest[] = [];
  const reviews = new Map<string, { value: FileRewindRecoveryReview; revision: number; rows: FileRewindRecoveryRow[] }>();
  const held: Record<HeldKind, HeldReply[]> = { discovery: [], review: [], acknowledgement: [] };
  const gates: HeldReply[] = [];
  let state = options.state ?? 'recovery_required', transcript = options.transcript ?? 'original';
  let canKeepCurrent = options.canKeepCurrent ?? true, discoveryFailure = !!options.discoveryFailure;
  let revision = 1, token = 0, lastVersion: string | undefined, acceptedVersion: string | undefined = state === 'kept_current' ? 'earlier-accepted-review' : undefined;
  let failure: Failure | undefined;
  const identity: Pick<FileRewindRecoveryReview, 'workspaceId' | 'targetWorkspaceId' | 'targetWorkspaceName' | 'threadId' | 'beforeTurnId' | 'recoveryId' | 'planId' | 'planVersion'> = {
    workspaceId: base.workspace.id, targetWorkspaceId: options.targetWorkspaceId, targetWorkspaceName: options.targetWorkspaceName, threadId: base.root.id, beforeTurnId: REWIND_TURN,
    recoveryId: 'durable-workspace-recovery', planId: 'durable-workspace-plan', planVersion: 'durable-workspace-plan-version' };

  function holdNext(kind: HeldKind): HeldReply {
    let release!: () => void;
    const reply: HeldReply = { started: false, settled: false, release: () => release(), wait: new Promise<void>(resolve => { release = resolve; }) };
    held[kind].push(reply); gates.push(reply); return reply;
  }

  async function respond(route: Route, kind: HeldKind, value: unknown, status = 200, lose = false) {
    const gate = held[kind].shift();
    if (gate) { gate.started = true; await gate.wait; }
    try { if (lose) await route.abort('failed'); else await route.fulfill({ status, json: value }); }
    catch (error) { if (!gate && !page.isClosed() && !route.request().failure()) throw error; }
    finally { if (gate) gate.settled = true; }
  }

  function freshReview(): FileRewindRecoveryReview {
    const pending = state === 'pending', settled = state === 'kept_current' || state === 'complete';
    const version = state === 'kept_current' ? acceptedVersion : state === 'complete' ? identity.planVersion : pending ? undefined : `immutable-review-${++token}`;
    const savedRows = pending ? [] : settled ? rows.map(row => ({ ...row, state: 'unavailable' as const })) : structuredClone(rows);
    const value: FileRewindRecoveryReview = { ...identity, backupId: 'durable-workspace-backup', state,
      blocking: !settled, message: pending ? 'A saved file rewind is still running in this workspace.'
        : settled ? 'Recovery ended with the current workspace files and conversation kept.'
          : 'An earlier file rewind stopped with partially restored files. Review the current state.',
      version, ...(state === 'recovery_required' ? { expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() } : {}),
      canKeepCurrent: state === 'recovery_required' && canKeepCurrent, transcript, index: 'changed',
      rows: savedRows.slice(0, 25), offset: 0, limit: 25, total: savedRows.length,
      hasMore: !pending && rows.length > 25 };
    if (version) { reviews.set(version, { value: structuredClone(value), revision, rows: structuredClone(savedRows) }); lastVersion = version; }
    return value;
  }

  await page.route(/\/api\/workspaces\/[^/]+\/rewind-recovery(?:\/keep-current)?(?:\?.*)?$/, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.slice('/api'.length), method = request.method();
    const body = request.postData() && request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() as Record<string, unknown> : null;
    requests.push({ method, path, query: Object.fromEntries(url.searchParams), body });
    const scopeId = decodeURIComponent(path.split('/')[2]);
    const kind: HeldKind = method === 'POST' ? 'acknowledgement' : url.searchParams.has('offset') ? 'review' : 'discovery';
    if (scopeId !== base.workspace.id) return respond(route, kind, { workspaceId: scopeId, recovery: null });
    if (method === 'GET') {
      if (discoveryFailure) return respond(route, kind, { error: 'Recovery storage is temporarily unavailable.', code: 'RECOVERY_UNAVAILABLE' }, 503);
      const requestedId = url.searchParams.get('recoveryId');
      if (requestedId && requestedId !== identity.recoveryId) return respond(route, kind, { error: 'The exact recovery was not found.' }, 404);
      const version = url.searchParams.get('version');
      const saved = version ? reviews.get(version) : undefined;
      if (version && !saved) return respond(route, kind, { error: 'The reviewed recovery version is no longer available.' }, 409);
      const source = saved?.value ?? freshReview();
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 25);
      const fileRows = source.state === 'pending' ? [] : saved?.rows ?? reviews.get(source.version ?? '')?.rows ?? rows;
      const result: WorkspaceRewindRecovery = { workspaceId: scopeId, recovery: { ...structuredClone(source),
        offset, limit, rows: structuredClone(fileRows.slice(offset, offset + limit)), total: fileRows.length, hasMore: offset + limit < fileRows.length } };
      return respond(route, kind, result);
    }
    if (method !== 'POST' || !path.endsWith('/keep-current')) return respond(route, kind, { error: 'Unexpected recovery fixture request.' }, 405);
    const outcome = failure; failure = undefined;
    const version = typeof body?.version === 'string' ? body.version : '';
    const saved = reviews.get(version);
    if (outcome === 'conflict') { revision++; if (rows[0]) rows[0].state = 'changed'; }
    if (body?.recoveryId !== identity.recoveryId || !saved || saved.revision !== revision || state !== 'recovery_required' || !canKeepCurrent) {
      return respond(route, kind, { error: 'Current files changed after this review. Refresh the recovery status before acknowledging it.', code: 'FILE_REWIND_RECOVERY_STALE' }, 409);
    }
    state = 'kept_current'; acceptedVersion = version;
    const receipt: FileRewindKeepCurrentResult = { ...identity, status: 'kept_current', version,
      filesUnchanged: true, conversationUnchanged: true, message: 'Recovery ended. The current files, including any partial rewind, and conversation were kept.' };
    return respond(route, kind, outcome === 'foreign-receipt' ? { ...receipt, planId: 'another-plan' } : receipt, 200, outcome === 'lost-after-commit');
  });

  return { base, identity, requests, holdNext,
    reads: () => requests.filter(request => request.method === 'GET'),
    acknowledgements: () => requests.filter(request => request.method === 'POST'),
    lastVersion: () => lastVersion,
    failNextAcknowledgement: (mode: Failure) => { failure = mode; },
    setDiscoveryFailure: (value: boolean) => { discoveryFailure = value; },
    changeState: (value: { state?: FileRewindRecoveryReview['state']; canKeepCurrent?: boolean; transcript?: FileRewindRecoveryReview['transcript'] }) => {
      if (value.state) state = value.state;
      if (value.canKeepCurrent !== undefined) canKeepCurrent = value.canKeepCurrent;
      if (value.transcript) transcript = value.transcript;
      revision++;
    },
    replaceRecoveryIdentity: (value: Partial<Pick<FileRewindRecoveryReview, 'targetWorkspaceId' | 'targetWorkspaceName' | 'recoveryId' | 'planId' | 'planVersion' | 'threadId' | 'beforeTurnId'>>) => {
      Object.assign(identity, value); revision++; reviews.clear();
    },
    releaseAll: () => { gates.forEach(reply => reply.release()); base.releaseAll(); },
  };
}

export type WorkspaceRecoveryFixture = Awaited<ReturnType<typeof workspaceRewindRecoveryFixture>>;
