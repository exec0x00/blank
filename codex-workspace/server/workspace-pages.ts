import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Workspace, WorkspacePage } from '../shared/types';
import type { AppContext } from './context';
import type { WorkspaceService } from './workspaces';
import { HttpError } from './errors';

export const WORKSPACE_PAGE_SIZE = 40;
export const MAX_WORKSPACE_PAGE_SIZE = 100;
export const WORKSPACE_INDEX_FRESHNESS_MS = 15_000;
const MAX_INDEX_WORKSPACES = 50_000;
const MAX_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 32 * 1024;
const MAX_DIRTY_IDS = 1000;
const READ_CONCURRENCY = 8;
const indexes = new WeakMap<WorkspaceService, WorkspaceIndex>();

export interface WorkspacePageInput { limit?: number; cursor?: string; query?: string; refresh?: boolean }
interface Snapshot { workspaces: Workspace[]; revision: string; checkedAt: number }
interface Cursor { version: 1; revision: string; query: string; limit: number; offset: number }

const absent = (error: unknown) => error instanceof HttpError && error.status === 404
  && ['WORKSPACE_NOT_FOUND', 'WORKSPACE_DIRECTORY_MISSING'].includes(error.code || '');
const changed = () => new HttpError(409, 'The workspace list changed. Refresh it to continue.', 'WORKSPACE_LIST_CHANGED');
const invalidCursor = () => new HttpError(400, 'This workspace page does not match the current search. Start from the first page.', 'INVALID_WORKSPACE_CURSOR');
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');

/** Copy only public metadata. The derived index never owns registrations or tombstones. */
function summary(workspace: Workspace): Workspace {
  const result: Workspace = { id: workspace.id, name: workspace.name, path: workspace.path,
    createdAt: workspace.createdAt, updatedAt: workspace.updatedAt };
  if (workspace.githubAccountId !== undefined) result.githubAccountId = workspace.githubAccountId;
  if (workspace.source !== undefined) result.source = { kind: workspace.source.kind, fullName: workspace.source.fullName };
  if (workspace.worktree !== undefined) result.worktree = { id: workspace.worktree.id,
    sourceWorkspaceId: workspace.worktree.sourceWorkspaceId, repositoryWorkspaceId: workspace.worktree.repositoryWorkspaceId,
    commonDirectory: workspace.worktree.commonDirectory, gitDirectory: workspace.worktree.gitDirectory };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_WORKSPACE_BYTES) {
    throw new HttpError(413, 'A saved workspace summary exceeds its size limit.', 'WORKSPACE_LIMIT');
  }
  return result;
}

function snapshot(workspaces: Workspace[], checkedAt: number): Snapshot {
  if (workspaces.length > MAX_INDEX_WORKSPACES) throw new HttpError(413, 'The saved workspace registry exceeds its record limit.', 'WORKSPACE_LIMIT');
  const entries: Workspace[] = [];
  let bytes = 0;
  for (const workspace of workspaces) {
    const entry = summary(workspace);
    bytes += Buffer.byteLength(JSON.stringify(entry));
    if (bytes > MAX_INDEX_BYTES) throw new HttpError(413, 'The workspace summary index exceeds its size limit.', 'WORKSPACE_LIMIT');
    entries.push(entry);
  }
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { workspaces: entries, revision: fingerprint(entries), checkedAt };
}

async function batches<T, U>(values: T[], read: (value: T) => Promise<U>): Promise<U[]> {
  const result: U[] = [];
  for (let start = 0; start < values.length; start += READ_CONCURRENCY) {
    result.push(...await Promise.all(values.slice(start, start + READ_CONCURRENCY).map(read)));
  }
  return result;
}

class WorkspaceIndex {
  private value?: Snapshot;
  private reading?: Promise<Snapshot>;
  private dirty = new Map<string, number>();
  private generation = 0;
  private fullRefresh = false;

  constructor(private readonly service: WorkspaceService, private readonly secret: string) {}

  mark(id: string): void {
    this.generation++;
    if (this.dirty.size >= MAX_DIRTY_IDS && !this.dirty.has(id)) { this.fullRefresh = true; this.dirty.clear(); }
    this.dirty.set(id, this.generation);
  }

  private async read(force = false): Promise<Snapshot> {
    // Concurrent page requests and refresh clicks share one registry read.
    if (this.reading) { await this.reading; force = false; }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.value && !force && !this.fullRefresh && !this.dirty.size
        && Date.now() - this.value.checkedAt < WORKSPACE_INDEX_FRESHNESS_MS) return this.value;
      if (this.reading) { await this.reading; force = false; continue; }
      const dirty = new Map(this.dirty);
      const scope = this.generation;
      const full = force || this.fullRefresh || !this.value || Date.now() - this.value.checkedAt >= WORKSPACE_INDEX_FRESHNESS_MS;
      force = false;
      const previous = this.value;
      const started = Date.now();
      const reading = (async () => {
        let records: Workspace[];
        if (full) records = await this.service.listMetadata();
        else {
          const byId = new Map(previous!.workspaces.map(workspace => [workspace.id, workspace]));
          for (const [id, workspace] of await batches([...dirty.keys()], async id => {
            try { return [id, await this.service.getAvailable(id)] as const; }
            catch (error) { if (absent(error)) return [id, null] as const; throw error; }
          })) {
            if (workspace) byId.set(id, workspace); else byId.delete(id);
          }
          records = [...byId.values()];
        }
        const next = snapshot(records, full ? started : previous!.checkedAt);
        this.value = next;
        for (const [id, version] of dirty) if (this.dirty.get(id) === version) this.dirty.delete(id);
        if (full && scope === this.generation) this.fullRefresh = false;
        return next;
      })();
      this.reading = reading;
      try { await reading; }
      finally { if (this.reading === reading) this.reading = undefined; }
      if (!this.fullRefresh && !this.dirty.size) return this.value!;
    }
    throw changed();
  }

  private sign(encoded: string): string { return createHmac('sha256', this.secret).update('workspace-page-v1\0').update(encoded).digest('base64url'); }
  private encode(cursor: Cursor): string {
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return `${encoded}.${this.sign(encoded)}`;
  }
  private decode(value: string, query: string, limit: number): Cursor {
    if (value.length > 1200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw invalidCursor();
    const [encoded, signature] = value.split('.');
    const expected = Buffer.from(this.sign(encoded));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw invalidCursor();
    let cursor: Cursor;
    try { cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Cursor; }
    catch { throw invalidCursor(); }
    if (!cursor || cursor.version !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(cursor.revision)
      || cursor.query !== query || cursor.limit !== limit || !Number.isSafeInteger(cursor.offset)
      || cursor.offset < 0 || cursor.offset >= MAX_INDEX_WORKSPACES || cursor.offset % limit !== 0) throw invalidCursor();
    return cursor;
  }

  async page(input: WorkspacePageInput): Promise<WorkspacePage> {
    const { limit = WORKSPACE_PAGE_SIZE } = input;
    const query = (input.query || '').trim().toLowerCase();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_WORKSPACE_PAGE_SIZE
      || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)
      || input.refresh !== undefined && typeof input.refresh !== 'boolean') {
      throw new HttpError(400, 'Use a workspace page size from 1 to 100 and a readable search of at most 200 characters.', 'INVALID_WORKSPACE_PAGE');
    }
    const queryId = fingerprint(query);
    const cursor = input.cursor ? this.decode(input.cursor, queryId, limit) : undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const index = await this.read(attempt === 0 && input.refresh);
      if (cursor && cursor.revision !== index.revision) throw changed();
      const candidates = query ? index.workspaces.filter(workspace => workspace.name.toLowerCase().includes(query) || workspace.path.toLowerCase().includes(query)) : index.workspaces;
      const offset = cursor?.offset || 0;
      if (offset > 0 && offset >= candidates.length) throw changed();
      const visible = candidates.slice(offset, offset + limit);
      const scope = this.generation;
      let observedChange = false;
      const verified = await batches(visible, async workspace => {
        let current: Workspace | null;
        try { current = summary(await this.service.getAvailable(workspace.id)); }
        catch (error) { if (absent(error)) current = null; else throw error; }
        if (!current || JSON.stringify(current) !== JSON.stringify(workspace)) { observedChange = true; this.mark(workspace.id); }
        return current;
      });
      // A page is never evidence that a different, unreturned workspace is gone.
      // Visible rows are rechecked against their own canonical records and roots.
      if (observedChange || scope !== this.generation || this.value?.revision !== index.revision) continue;
      const at = (position: number) => this.encode({ version: 1, revision: index.revision, query: queryId, limit, offset: position });
      return { workspaces: verified as Workspace[], offset, total: candidates.length, revision: index.revision,
        previousCursor: offset > 0 ? at(Math.max(0, offset - limit)) : null,
        nextCursor: offset + limit < candidates.length ? at(offset + limit) : null };
    }
    throw changed();
  }
}

/** Called after a canonical metadata write, never in place of that write. */
export function workspaceMetadataChanged(service: WorkspaceService, id: string): void { indexes.get(service)?.mark(id); }

export function getWorkspacePage(ctx: AppContext, input: WorkspacePageInput = {}): Promise<WorkspacePage> {
  return getWorkspacePageFor(ctx.workspaces, ctx.config.sessionSecret, input);
}

export function getWorkspacePageFor(service: WorkspaceService, secret: string, input: WorkspacePageInput = {}): Promise<WorkspacePage> {
  let index = indexes.get(service);
  if (!index) { index = new WorkspaceIndex(service, secret); indexes.set(service, index); }
  return index.page(input);
}

export function workspacePageInput(query: Record<string, unknown>): WorkspacePageInput {
  if (Object.keys(query).some(key => !['limit', 'cursor', 'query', 'refresh'].includes(key))
    || Object.values(query).some(value => typeof value !== 'string')) {
    throw new HttpError(400, 'Provide one value for each workspace page option.', 'INVALID_WORKSPACE_PAGE');
  }
  const limit = query.limit === undefined ? WORKSPACE_PAGE_SIZE : typeof query.limit === 'string' && /^\d{1,3}$/.test(query.limit) ? Number(query.limit) : NaN;
  if (query.refresh !== undefined && !['0', '1', 'false', 'true'].includes(query.refresh as string)) throw new HttpError(400, 'refresh must be true or false.', 'INVALID_WORKSPACE_PAGE');
  return { limit, cursor: query.cursor as string | undefined, query: query.query as string | undefined, refresh: query.refresh === '1' || query.refresh === 'true' };
}
