import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { HttpError } from '../server/errors';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { NativeNotification, NativeServerRequest, RpcId } from '../server/codex-cli/rpc';
import type { NativeFeatureDependencies } from '../server/codex-cli/features/common';
import type { HostResourceSnapshot } from '../server/host-resources';
import type { CodexRuntimeStatus } from '../shared/codex-cli';

export const FIRST_THREAD = '01990000-0000-7000-8000-000000000001';
export const SECOND_THREAD = '01990000-0000-7000-8000-000000000002';

export function pendingValue<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Protocol lifecycle fixture only: no real process, model request or installer. */
export class ProcessBridge implements CodexBridge {
  current: string | null = 'native-process-fixture-one';
  leases = new Set<symbol>();
  unsupported = new Set<string>();
  calls: Array<{ method: string; params: Record<string, unknown>; timeoutMs?: number }> = [];
  handlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
  commands = new Map<string, ReturnType<typeof pendingValue<unknown>>>();
  private notifications = new Set<(message: NativeNotification, generation: string) => void>();
  private connections = new Set<(state: 'ready' | 'closed', generation: string) => void>();
  generation() { return this.current; }
  supports(method: string) { return !this.unsupported.has(method); }
  status(): CodexRuntimeStatus {
    return { backend: 'codex-cli', state: this.current ? 'ready' : 'stopped', version: '0.159.2', installedVersion: '0.159.2',
      startedAt: null, updatedAt: new Date().toISOString(), canUpdate: this.leases.size === 0, updateBlockedReason: null, error: null, activeTurns: 0,
      capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } };
  }
  acquireActivity(generation: string) {
    if (generation !== this.current) throw new HttpError(409, 'Fixture generation changed.', 'CODEX_CONNECTION_CHANGED');
    const id = Symbol(); this.leases.add(id); return () => this.leases.delete(id);
  }
  async request<T = unknown>(method: string, input: unknown = {}, timeoutMs?: number): Promise<T> {
    const params = input as Record<string, unknown>;
    this.calls.push({ method, params, timeoutMs });
    const handler = this.handlers.get(method); if (handler) return await handler(params) as T;
    if (method === 'command/exec') {
      const pending = pendingValue<unknown>(); this.commands.set(String(params.processId), pending); return await pending.promise as T;
    }
    if (method === 'thread/backgroundTerminals/list') return { data: [], nextCursor: null } as T;
    if (method === 'thread/backgroundTerminals/terminate') return { terminated: true } as T;
    return {} as T;
  }
  respond(_id: RpcId, _result: unknown, _generation: string) {}
  rejectRequest(_id: RpcId, _message: string, _generation: string) {}
  onRequest(_listener: (message: NativeServerRequest, generation: string) => void) { return () => {}; }
  onNotification(listener: (message: NativeNotification, generation: string) => void) { this.notifications.add(listener); return () => { this.notifications.delete(listener); }; }
  onConnection(listener: (state: 'ready' | 'closed', generation: string) => void) { this.connections.add(listener); return () => { this.connections.delete(listener); }; }
  emit(method: string, params: Record<string, unknown>, generation = this.current!) {
    for (const listener of this.notifications) listener({ method, params }, generation);
  }
  exit(handle: string, exitCode = 0) {
    this.emit('process/exited', { processHandle: handle, exitCode, stdout: '', stderr: '', stdoutCapReached: false, stderrCapReached: false });
  }
  close() {
    const generation = this.current; this.current = null;
    if (generation) for (const listener of this.connections) listener('closed', generation);
    for (const pending of this.commands.values()) pending.reject(new HttpError(503, 'Fixture closed.', 'CODEX_CONNECTION_CLOSED'));
    this.commands.clear();
  }
}

export function resourceSnapshot(headroomBytes = 80_000_000_000): HostResourceSnapshot {
  return { observedAt: new Date().toISOString(), memory: { status: 'available', source: 'cgroup-v2', currentBytes: 90_000_000_000 - headroomBytes,
    limitBytes: 104_000_000_000, limitKind: 'limited', policyCeilingBytes: 90_000_000_000, effectiveCeilingBytes: 90_000_000_000,
    headroomBytes, defaultReserveBytes: 2_000_000_000, hostTotalBytes: null, hostAvailableBytes: null,
    breakdown: null, swapCurrentBytes: null, scopes: [] }, filesystems: [], warnings: [] };
}

export async function processFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-processes-test-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: path.join(root, 'data'), RUNTIME_DIR: path.join(root, 'runtime'),
    WORKSPACE_PASSWORD: 'process-fixture-password', SESSION_SECRET: 'process-fixture-session-secret-value', ENCRYPTION_KEY: 'process-fixture-encryption-key-value' });
  await Promise.all(['one', 'two'].map(name => fs.mkdir(path.join(config.workspacesDir, name), { recursive: true })));
  const bridge = new ProcessBridge(), cleanups: Array<() => void | Promise<void>> = [];
  const workspace = async (id: string) => {
    if (!['one', 'two'].includes(id)) throw new HttpError(404, 'Workspace not found.');
    return { id, path: path.join(config.workspacesDir, id), name: id };
  };
  const ctx = { config, events: new EventEmitter(), workspaces: { get: workspace, resolvePath: async (id: string, relative: string) => {
    if (relative !== '') throw new Error('Process fixture permits only exact workspace roots.');
    return (await workspace(id)).path;
  } } } as unknown as AppContext;
  const deps: NativeFeatureDependencies = { ctx, bridge, registerCleanup: cleanup => cleanups.push(cleanup),
    authorizeThread: async (workspaceId, threadId) => {
      await workspace(workspaceId);
      if (threadId !== (workspaceId === 'one' ? FIRST_THREAD : SECOND_THREAD)) throw new HttpError(403, 'Thread belongs to another workspace.', 'CODEX_THREAD_SCOPE');
      return { id: threadId, workspaceId, backend: 'codex-cli', title: 'Native fixture', createdAt: '', updatedAt: '', status: 'idle' };
    } };
  return { root, ctx, bridge, deps, cleanups, async close() {
    bridge.close(); await Promise.all(cleanups.map(cleanup => cleanup())); await fs.rm(root, { recursive: true, force: true });
  } };
}
