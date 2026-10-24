import { useSyncExternalStore } from 'react';
import type { UiEditorPreferences, UiLayoutPreferences, UiLayoutProfile, UiState, UiStateChange, UiStatePatch, UiTabState, Workspace } from '../shared/types';
import { ApiError, api, json } from './api';
import { validAgentWidthRatio, validExplorerWidth } from './pane-geometry';
import { validComposerTiers, validServiceTier } from '../shared/service-tiers';

export type UiSyncStatus = 'loading' | 'saved' | 'pending' | 'saving' | 'offline' | 'locked' | 'error' | 'conflict';
export interface UiStateSnapshot { value: UiState; status: UiSyncStatus; pending: number; message?: string }
type StorageCache = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Transport = (patch?: UiStatePatch) => Promise<UiState>;
type QueuedChange = { change: UiStateChange; baseRevision: number; sequence: number };
const cacheKey = 'codex:ui-state:v1';
const profiles: UiLayoutProfile[] = ['desktop', 'laptop', 'tablet', 'mobile'];
const views = ['agent', 'editor', 'terminal', 'git', 'github'];
const emptyState = (): UiState => ({ version: 1, revision: 0, layouts: {}, editor: {}, workspaces: {}, fieldRevisions: {} });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const relativeFile = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !/[\\\u0000-\u001f\u007f]/.test(value) && !value.startsWith('/') && !/^[a-z]:/i.test(value)
  && value.split('/').every(part => !!part && part !== '.' && part !== '..' && !part.startsWith('.codex-write-'));
const validTabs = (value: unknown): value is UiTabState => record(value) && onlyKeys(value, ['paths', 'active'])
  && Array.isArray(value.paths) && value.paths.length <= 100 && value.paths.every(relativeFile)
  && new Set(value.paths).size === value.paths.length && typeof value.active === 'string' && (value.active === '' || value.paths.includes(value.active));
const validRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const fieldKey = (change: UiStateChange) => change.section === 'layout' ? `layout.${change.profile}.${change.key}`
  : change.section === 'editor' ? `editor.${change.key}` : `workspace.${change.workspaceId}.${change.key}${change.key === 'serviceTier' ? '.' + (change.threadId ?? 'draft') : ''}`;
const fieldValue = (state: UiState, change: UiStateChange): unknown => change.section === 'layout' ? state.layouts[change.profile]?.[change.key]
  : change.section === 'editor' ? state.editor[change.key] : change.key === 'serviceTier'
    ? state.workspaces[change.workspaceId]?.serviceTiers?.[change.threadId ?? 'draft'] : state.workspaces[change.workspaceId]?.[change.key];
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function validChange(value: unknown): value is UiStateChange {
  if (!record(value)) return false;
  if (value.section === 'layout' && onlyKeys(value, ['section', 'profile', 'key', 'value']) && profiles.includes(value.profile as UiLayoutProfile)) {
    return value.key === 'view' ? views.includes(value.value as string)
      : value.key === 'sidebar' ? ['expanded', 'collapsed'].includes(value.value as string)
        : value.key === 'split' ? ['split', 'focus'].includes(value.value as string)
          : value.key === 'agentWidthRatio' ? validAgentWidthRatio(value.value)
            : value.key === 'explorerWidth' && validExplorerWidth(value.value);
  }
  if (value.section === 'editor' && onlyKeys(value, ['section', 'key', 'value'])) {
    return (value.key === 'minimap' || value.key === 'lineNumbers') ? typeof value.value === 'boolean'
      : value.key === 'wrap' && (typeof value.value === 'boolean' || value.value === null);
  }
  if (value.section === 'workspace' && value.key === 'serviceTier') return onlyKeys(value, ['section', 'workspaceId', 'threadId', 'key', 'value'])
    && identifier(value.workspaceId) && (value.threadId === null || typeof value.threadId === 'string'
      && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.threadId)) && validServiceTier(value.value);
  return value.section === 'workspace' && onlyKeys(value, ['section', 'workspaceId', 'key', 'value']) && identifier(value.workspaceId)
    && (value.key === 'threadId' ? value.value === null || identifier(value.value)
      : value.key === 'tabs' && validTabs(value.value));
}

function validatedRemote(value: UiState): UiState {
  if (!record(value) || !onlyKeys(value, ['version', 'revision', 'layouts', 'editor', 'workspaces', 'fieldRevisions'])
    || value.version !== 1 || !validRevision(value.revision) || !record(value.layouts) || !record(value.editor)
    || !record(value.workspaces) || !record(value.fieldRevisions) || Object.keys(value.workspaces).length > 1000
    || Object.keys(value.fieldRevisions).length > 2500) throw new Error('Saved interface preferences could not be read.');
  for (const [profile, preferences] of Object.entries(value.layouts)) {
    if (!profiles.includes(profile as UiLayoutProfile) || !record(preferences)) throw new Error('Invalid saved layout preferences.');
    for (const [key, entry] of Object.entries(preferences)) if (!validChange({ section: 'layout', profile, key, value: entry })) throw new Error('Invalid saved layout preferences.');
  }
  for (const [key, entry] of Object.entries(value.editor)) if (!validChange({ section: 'editor', key, value: entry })) throw new Error('Invalid saved editor preferences.');
  for (const [workspaceId, preferences] of Object.entries(value.workspaces)) {
    if (!identifier(workspaceId) || !record(preferences)) throw new Error('Invalid saved workspace selections.');
    for (const [key, entry] of Object.entries(preferences)) if (!(key === 'serviceTiers' ? validComposerTiers(entry)
      : validChange({ section: 'workspace', workspaceId, key, value: entry }))) throw new Error('Invalid saved workspace selections.');
  }
  for (const [key, entry] of Object.entries(value.fieldRevisions)) {
    if (!/^(?:layout\.(?:desktop|laptop|tablet|mobile)\.(?:view|sidebar|split|agentWidthRatio|explorerWidth)|editor\.(?:minimap|lineNumbers|wrap)|workspace\.[a-zA-Z0-9_-]{1,128}\.(?:threadId|tabs|serviceTier\.(?:draft|[a-fA-F0-9-]{36})))$/.test(key)
      || !validRevision(entry) || entry > value.revision) throw new Error('Invalid saved preference revision.');
  }
  return structuredClone(value);
}

function applyChanges(state: UiState, changes: Iterable<QueuedChange>): UiState {
  const next = structuredClone(state);
  for (const { change } of changes) {
    if (change.section === 'layout') next.layouts[change.profile] = { ...next.layouts[change.profile], [change.key]: change.value };
    else if (change.section === 'editor') next.editor = { ...next.editor, [change.key]: change.value };
    else if (change.key === 'serviceTier') next.workspaces[change.workspaceId] = { ...next.workspaces[change.workspaceId],
      serviceTiers: { ...next.workspaces[change.workspaceId]?.serviceTiers, [change.threadId ?? 'draft']: change.value } };
    else next.workspaces[change.workspaceId] = { ...next.workspaces[change.workspaceId], [change.key]: change.value };
  }
  return next;
}

function legacySelections(storage: StorageCache | undefined, workspaceIds: string[], profile: UiLayoutProfile): UiStateChange[] {
  const changes: UiStateChange[] = [];
  const read = (key: string) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const parse = (key: string): unknown => { try { return JSON.parse(read(key) || 'null'); } catch { return null; } };
  for (const key of ['view', 'sidebar', 'split']) {
    const change = { section: 'layout', profile, key, value: read(`codex.${key}`) };
    if (validChange(change)) changes.push(change);
  }
  const editor = parse('codex:editor-view');
  if (record(editor)) for (const key of ['minimap', 'lineNumbers', 'wrap']) {
    const change = { section: 'editor', key, value: editor[key] };
    if (validChange(change)) changes.push(change);
  }
  for (const workspaceId of workspaceIds.slice(0, 240)) {
    const threadId = read(`codex:thread:${workspaceId}`);
    if (threadId === '$new' || identifier(threadId)) changes.push({ section: 'workspace', workspaceId, key: 'threadId', value: threadId === '$new' ? null : threadId });
    const tabs = parse(`codex:tabs:${workspaceId}`);
    if (record(tabs) && Array.isArray(tabs.paths)) {
      const paths = [...new Set(tabs.paths.filter(relativeFile))].slice(0, 100);
      changes.push({ section: 'workspace', workspaceId, key: 'tabs', value: { paths, active: typeof tabs.active === 'string' && paths.includes(tabs.active) ? tabs.active : paths[0] || '' } });
    }
  }
  return changes;
}

/** Server state is canonical. This journal only caches unacknowledged, revision-checked selections. */
export class UiStateClient {
  private confirmed = emptyState();
  private queued = new Map<string, QueuedChange>();
  private sequence = 0;
  private initialized = false;
  private unlocked = false;
  private online = true;
  private inFlight: Promise<void> | undefined;
  private activeBatch = new Map<string, QueuedChange>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private splitBatch = false;
  private listeners = new Set<() => void>();
  private conflictNotice: string | undefined;
  private snapshot: UiStateSnapshot = { value: emptyState(), status: 'loading', pending: 0 };

  constructor(private transport: Transport, private storage?: StorageCache, private debounceMs = 300) {}

  getSnapshot = (): UiStateSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  private publish(status: UiSyncStatus, message?: string): void {
    if (status === 'conflict' && message) this.conflictNotice = message;
    if (this.queued.size && ['pending', 'saving'].includes(status)) {
      if (!this.unlocked) status = 'locked';
      else if (!this.online) { status = 'offline'; message = 'Interface preferences have not synced yet. They will retry when you reconnect.'; }
    }
    message ||= this.conflictNotice;
    this.snapshot = { value: applyChanges(this.confirmed, this.queued.values()), status, pending: this.queued.size, ...(message ? { message } : {}) };
    try {
      this.storage?.setItem(cacheKey, JSON.stringify({ version: 1, state: this.confirmed, pending: [...this.queued.values()] }));
    } catch { /* Browser storage is a cache; mounted storage remains authoritative. */ }
    this.listeners.forEach(listener => listener());
  }

  private restoreJournal(): void {
    try {
      const text = this.storage?.getItem(cacheKey);
      if (!text || text.length > 2 * 1024 * 1024) return;
      const cached: unknown = JSON.parse(text);
      if (!record(cached) || cached.version !== 1 || !Array.isArray(cached.pending)) return;
      for (const item of cached.pending.slice(0, 512)) {
        if (!record(item) || !validChange(item.change) || !validRevision(item.baseRevision)) continue;
        this.queued.set(fieldKey(item.change), { change: item.change, baseRevision: item.baseRevision, sequence: ++this.sequence });
      }
    } catch { /* A corrupt optional cache must not hide the saved server state. */ }
  }

  private reconcile(remote: UiState, deferInFlight = true): boolean {
    let conflict = false;
    remote = validatedRemote(remote);
    if (remote.revision < this.confirmed.revision) remote = this.confirmed;
    this.confirmed = remote;
    for (const [key, item] of this.queued) {
      const sending = this.activeBatch.get(key);
      // Bootstrap may observe our save before its PATCH acknowledgement. Wait
      // for that response's actual revision before deciding whether a newer
      // local choice conflicts; equal values alone cannot identify our write.
      if (deferInFlight && sending && item.sequence !== sending.sequence) continue;
      if (equal(fieldValue(remote, item.change), item.change.value)) this.queued.delete(key);
      else if (item.baseRevision > remote.revision || (remote.fieldRevisions[key] || 0) > item.baseRevision) {
        this.queued.delete(key);
        conflict = true;
      } else item.baseRevision = remote.revision;
    }
    return conflict;
  }

  async hydrate(remote: UiState | undefined, workspaceIds: string[], profile: UiLayoutProfile): Promise<void> {
    if (!this.initialized) this.restoreJournal();
    let canonical = validatedRemote(remote ?? await this.transport());
    if (canonical.revision === 0 && !this.queued.size) {
      const changes = legacySelections(this.storage, workspaceIds, profile);
      if (changes.length) canonical = validatedRemote(await this.transport({ revision: 0, changes, migration: true }));
    }
    // An older bootstrap response can finish while a successful save is in flight.
    if (this.initialized && canonical.revision < this.confirmed.revision) canonical = this.confirmed;
    const conflict = this.reconcile(canonical);
    this.initialized = true;
    this.publish(conflict ? 'conflict' : this.queued.size ? 'pending' : 'saved', conflict ? 'Some interface selections changed in another browser. The newer saved selections were kept.' : undefined);
    this.schedule();
  }

  change(changes: UiStateChange[]): void {
    if (!this.initialized) return;
    let changed = false;
    for (const change of changes) {
      if (!validChange(change) || equal(fieldValue(this.snapshot.value, change), change.value)) continue;
      changed = true;
      const key = fieldKey(change);
      if (!this.activeBatch.has(key) && equal(fieldValue(this.confirmed, change), change.value)) this.queued.delete(key);
      else this.queued.set(key, { change: structuredClone(change), baseRevision: this.queued.get(key)?.baseRevision ?? this.confirmed.revision, sequence: ++this.sequence });
    }
    if (!changed) return;
    this.conflictNotice = undefined;
    this.publish(this.queued.size ? (!this.unlocked ? 'locked' : !this.online ? 'offline' : 'pending') : 'saved',
      this.queued.size && !this.online ? 'Interface preferences have not synced yet. They will retry when you reconnect.' : undefined);
    this.schedule();
  }

  setSession(unlocked: boolean): void {
    this.unlocked = unlocked;
    if (!unlocked) { clearTimeout(this.timer); clearTimeout(this.retryTimer); this.timer = undefined; this.retryTimer = undefined; }
    if (!this.initialized) return;
    if (!unlocked && this.queued.size) this.publish('locked');
    else if (unlocked) { if (this.queued.size) this.publish('pending'); this.schedule(); }
  }

  setOnline(online: boolean): void {
    this.online = online;
    if (this.queued.size && !online) this.publish('offline', 'Interface preferences have not synced yet. They will retry when you reconnect.');
    if (online) this.schedule(0);
  }

  private schedule(delay = this.debounceMs): void {
    clearTimeout(this.timer);
    if (!this.initialized || !this.unlocked || !this.online || this.inFlight || !this.queued.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    if (this.inFlight) return this.inFlight;
    if (!this.initialized || !this.unlocked || !this.online || !this.queued.size) return;
    const revision = Math.min(...[...this.queued.values()].map(item => item.baseRevision));
    const batch = [...this.queued.entries()].filter(([, item]) => item.baseRevision === revision).slice(0, this.splitBatch ? 1 : 512);
    this.activeBatch = new Map(batch);
    this.publish('saving');
    this.inFlight = this.saveBatch(revision, batch).finally(() => {
      this.inFlight = undefined;
      this.activeBatch.clear();
      if (this.queued.size && !this.retryTimer) this.schedule();
    });
    return this.inFlight;
  }

  private async saveBatch(revision: number, batch: [string, QueuedChange][]): Promise<void> {
    try {
      const remote = validatedRemote(await this.transport({ revision, changes: batch.map(([, item]) => item.change) }));
      for (const [key, sent] of batch) {
        const latest = this.queued.get(key);
        if (latest?.sequence === sent.sequence) this.queued.delete(key);
        else if (latest) latest.baseRevision = remote.revision;
      }
      const conflict = this.reconcile(remote.revision < this.confirmed.revision ? this.confirmed : remote, false);
      this.attempts = 0;
      this.publish(conflict ? 'conflict' : this.queued.size ? 'pending' : 'saved', conflict ? 'Some interface selections changed in another browser. The newer saved selections were kept.' : undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const conflict = this.reconcile(await this.transport(), false);
          this.attempts = 0;
          this.publish(conflict ? 'conflict' : this.queued.size ? 'pending' : 'saved', conflict ? 'Some interface selections changed in another browser. The newer saved selections were kept.' : undefined);
        } catch (refreshError) { this.failed(refreshError); }
      } else if (error instanceof ApiError && [400, 403, 404, 413].includes(error.status)) {
        if (batch.length > 1) { this.splitBatch = true; this.publish('pending'); }
        else {
          const [key, sent] = batch[0];
          if (this.queued.get(key)?.sequence === sent.sequence) this.queued.delete(key);
          this.publish('error', 'One interface selection could not be saved. Choose the file or conversation again, or retry your preferences.');
          if (this.queued.size) this.schedule(0);
        }
      } else this.failed(error);
    }
  }

  private failed(error: unknown): void {
    if (error instanceof ApiError && error.status === 401) { this.unlocked = false; this.publish('locked'); return; }
    this.publish('error', 'Interface preferences have not synced yet. Your open files are unchanged. Retry when the connection is available.');
    if (this.unlocked && this.online) {
      this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.flush(); }, Math.min(15000, 1000 * 2 ** Math.min(this.attempts++, 4)));
    }
  }

  retry = (): void => {
    this.attempts = 0;
    this.publish(!this.queued.size ? 'saved' : !this.unlocked ? 'locked' : !this.online ? 'offline' : 'pending',
      this.queued.size && !this.online ? 'Interface preferences have not synced yet. They will retry when you reconnect.' : undefined);
    void this.flush();
  };
  dismissNotice = (): void => { this.conflictNotice = undefined; this.publish(this.queued.size ? 'pending' : 'saved'); };
  dispose(): void { clearTimeout(this.timer); clearTimeout(this.retryTimer); this.unlocked = false; this.listeners.clear(); }
}

export function layoutProfile(width: number): UiLayoutProfile { return width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile'; }
function browserStorage(): StorageCache | undefined { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } }
const client = new UiStateClient(patch => patch ? api<UiState>('/ui-state', json('PATCH', patch)) : api<UiState>('/ui-state'), browserStorage());
if (typeof window !== 'undefined') {
  window.addEventListener('codex:session-locked', () => client.setSession(false));
  window.addEventListener('codex:session-expired', () => client.setSession(false));
  window.addEventListener('codex:session-unlocked', () => client.setSession(true));
  window.addEventListener('online', () => client.setOnline(true));
  window.addEventListener('offline', () => client.setOnline(false));
  // Start any final save while the document can still send a normal authenticated request.
  window.addEventListener('pagehide', () => { void client.flush(); });
}
export async function hydrateUiState(state: UiState | undefined, workspaces: Workspace[]): Promise<void> { await client.hydrate(state, workspaces.map(workspace => workspace.id), layoutProfile(window.innerWidth)); }
export function useUiState(): UiStateSnapshot { return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot); }
export function setUiLayout(profile: UiLayoutProfile, preferences: UiLayoutPreferences): void {
  const changes: unknown[] = Object.entries(preferences).map(([key, value]) => ({ section: 'layout', profile, key, value }));
  client.change(changes.filter(validChange));
}
export function getUiEditor(): UiEditorPreferences { return client.getSnapshot().value.editor; }
export function setUiEditor(preferences: UiEditorPreferences): void {
  const changes: unknown[] = Object.entries(preferences).map(([key, value]) => ({ section: 'editor', key, value }));
  client.change(changes.filter(validChange));
}
export function getUiThread(workspaceId: string): string | null | undefined { return client.getSnapshot().value.workspaces[workspaceId]?.threadId; }
export function setUiThread(workspaceId: string, threadId: string | null): void { client.change([{ section: 'workspace', workspaceId, key: 'threadId', value: threadId }]); }
export function setUiServiceTier(workspaceId: string, threadId: string | null, serviceTier: string): void {
  const value = { ...client.getSnapshot().value.workspaces[workspaceId]?.serviceTiers, [threadId ?? 'draft']: serviceTier };
  if (!validComposerTiers(value)) throw new Error('This conversation’s service tier could not be saved.');
  client.change([{ section: 'workspace', workspaceId, key: 'serviceTier', threadId, value: serviceTier }]);
}
export function getUiTabs(workspaceId: string): UiTabState { return client.getSnapshot().value.workspaces[workspaceId]?.tabs ?? { paths: [], active: '' }; }
export function setUiTabs(workspaceId: string, tabs: UiTabState): void { client.change([{ section: 'workspace', workspaceId, key: 'tabs', value: tabs }]); }
export const retryUiState = () => client.retry();
export const dismissUiStateNotice = () => client.dismissNotice();
export const flushUiState = () => client.flush();
