import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorCodexRuntime, readCodexRuntimeStatus, type CodexRuntimeObservation } from '../client/codex-runtime-status';
import type { CodexRuntimeStatus } from '../shared/codex-cli';

const status = (state: CodexRuntimeStatus['state'] = 'ready'): CodexRuntimeStatus => ({
  backend: 'codex-cli', state, version: 'owned-runtime-fixture', installedVersion: 'owned-runtime-fixture',
  startedAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
  canUpdate: state === 'ready', updateBlockedReason: null, error: state === 'error' ? 'The official process exited.' : null,
  activeTurns: 0, capabilities: { conversations: true, pagination: true, queue: true, goals: true,
    skills: true, plan: true, review: true, historyRevert: true },
});
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.useRealTimers(); });
function fixture(initial?: CodexRuntimeStatus | null, online = true) {
  vi.useFakeTimers();
  const observations: CodexRuntimeObservation[] = [], reads: Array<ReturnType<typeof deferred> & { signal: AbortSignal }> = [];
  const monitor = monitorCodexRuntime({ initial, online,
    read: signal => { const pending = deferred(); reads.push({ ...pending, signal }); return pending.promise; },
    publish: value => observations.push(value), intervalMs: 5000, timeoutMs: 10_000,
  });
  stops.push(monitor.stop);
  return { monitor, reads, observations };
}

describe('browser Codex status recovery', () => {
  it('retains confirmed native readiness through a transient browser failure, then clears the transport error', async () => {
    const data = fixture(); await vi.advanceTimersByTimeAsync(0);
    data.reads[0].resolve(status()); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    data.reads[1].reject(new TypeError('Failed to fetch')); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations.at(-1)).toMatchObject({ status: { state: 'ready' }, error: expect.stringMatching(/server.*reached.*Reconnecting/) });
    await vi.advanceTimersByTimeAsync(5000);
    data.reads[2].resolve(status()); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations.at(-1)).toMatchObject({ status: { state: 'ready' }, error: null });
    expect(data.observations.every(value => value.status?.state === 'ready')).toBe(true);
  });

  it('cannot turn an unknown or failed native runtime healthy after a browser error', async () => {
    const data = fixture(); await vi.advanceTimersByTimeAsync(0);
    data.reads[0].reject(new TypeError('Failed to fetch')); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations.at(-1)?.status).toBeNull();
    data.monitor.refresh(); await vi.advanceTimersByTimeAsync(0);
    data.reads[1].resolve(status('error')); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations.at(-1)).toMatchObject({ status: { state: 'error', error: 'The official process exited.' }, error: null });
    data.monitor.refresh(); await vi.advanceTimersByTimeAsync(0);
    data.reads[2].reject(new TypeError('Failed to fetch')); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations.at(-1)?.status?.state).toBe('error');
  });

  it('supersedes a pending poll on explicit refresh and ignores its late status and late failure', async () => {
    const data = fixture(); await vi.advanceTimersByTimeAsync(0);
    data.monitor.refresh(); await vi.advanceTimersByTimeAsync(0);
    expect(data.reads[0].signal.aborted).toBe(true);
    data.reads[1].resolve(status()); await vi.advanceTimersByTimeAsync(0);
    data.reads[0].resolve(status('installing')); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations).toEqual([{ status: status(), error: null }]);
    data.monitor.refresh(); await vi.advanceTimersByTimeAsync(0);
    data.monitor.refresh(); await vi.advanceTimersByTimeAsync(0);
    data.reads[3].resolve(status()); data.reads[2].reject(new TypeError('Old session')); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations.at(-1)).toEqual({ status: status(), error: null });
  });

  it('recovers from a fetch that never settles without accepting its response after the timeout', async () => {
    const data = fixture(status()); await vi.advanceTimersByTimeAsync(10_000);
    expect(data.reads[0].signal.aborted).toBe(true);
    expect(data.observations.at(-1)).toMatchObject({ status: { state: 'ready' }, error: expect.stringMatching(/taking too long/) });
    await vi.advanceTimersByTimeAsync(5000); expect(data.reads).toHaveLength(2);
    data.reads[1].resolve(status()); await vi.advanceTimersByTimeAsync(0);
    data.reads[0].resolve(status('stopped')); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations.at(-1)).toEqual({ status: status(), error: null });
  });

  it('cancels browser reads while offline and refreshes promptly when the browser returns online', async () => {
    const data = fixture(status()); await vi.advanceTimersByTimeAsync(0);
    data.monitor.setOnline(false); expect(data.reads[0].signal.aborted).toBe(true);
    expect(data.observations.at(-1)).toMatchObject({ status: { state: 'ready' }, error: expect.stringMatching(/browser is offline/) });
    await vi.advanceTimersByTimeAsync(60_000); expect(data.reads).toHaveLength(1);
    data.monitor.setOnline(true); await vi.advanceTimersByTimeAsync(0); expect(data.reads).toHaveLength(2);
    data.reads[1].resolve(status()); await vi.advanceTimersByTimeAsync(0);
    expect(data.observations.at(-1)?.error).toBeNull();
  });

  it('cannot publish a previous session or component response after disposal', async () => {
    const data = fixture(); await vi.advanceTimersByTimeAsync(0); data.monitor.stop();
    expect(data.reads[0].signal.aborted).toBe(true);
    data.reads[0].resolve(status()); await vi.advanceTimersByTimeAsync(60_000);
    data.monitor.refresh(); data.monitor.setOnline(true); await vi.advanceTimersByTimeAsync(0);
    expect(data.reads).toHaveLength(1); expect(data.observations).toEqual([]);
  });

  it('checks actual runtime status fields before using readiness to enable native controls', () => {
    expect(readCodexRuntimeStatus(status('installing')).state).toBe('installing');
    for (const value of [null, {}, { ...status(), capabilities: {} }, { ...status(), activeTurns: -1 },
      { ...status(), state: 'connected' }, { ...status(), updatedAt: 'invalid' }]) expect(() => readCodexRuntimeStatus(value)).toThrow(/unreadable/);
  });
});
