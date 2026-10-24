import { describe, expect, it, vi } from 'vitest';
import type { CodexTokenUsage } from '../shared/codex-cli';
import { NativeTokenUsageStore, nativeTokenUsage, reportedTokenUsage } from '../server/codex-cli/token-usage';

const scope = { id: '01980000-0000-7000-8000-000000000001', workspaceId: 'workspace-one', cwd: '/workspace-one' };
const report = (contextTokens = 80): CodexTokenUsage => ({
  total: { totalTokens: 140, inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 },
  contextTokens, modelContextWindow: 1_050_000, reportedAt: '2026-09-30T12:00:00.000Z',
});
function memoryStore() {
  const data = new Map<string, unknown>();
  return { data, read: vi.fn(async <T>(key: string, fallback: T): Promise<T> => structuredClone(data.get(key) ?? fallback) as T),
    write: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }),
    delete: vi.fn(async (key: string) => { data.delete(key); }) };
}
function deferred() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }

describe('native token report persistence', () => {
  it('restores only the last real report for its exact thread, workspace and working directory', async () => {
    const store = memoryStore(), first = new NativeTokenUsageStore(store);
    await first.save(scope, report());
    const restarted = new NativeTokenUsageStore(store);
    await restarted.load(scope); expect(restarted.peek(scope)).toEqual(report());
    for (const foreign of [{ ...scope, workspaceId: 'another-workspace' }, { ...scope, cwd: '/another-directory' }, { ...scope, id: scope.id.replace(/1$/, '2') }]) {
      const isolated = new NativeTokenUsageStore(store); await isolated.load(foreign); expect(isolated.peek(foreign)).toBeNull();
    }
    expect([...store.data.values()]).toEqual([{ version: 1, ...scope, usage: report() }]);
  });

  it('never substitutes accumulated tokens for missing context or invents unreported capacities', () => {
    const received = nativeTokenUsage({ total: report().total, last: {}, modelContextWindow: null }, report().reportedAt);
    expect(received).toEqual({ ...report(), contextTokens: null, modelContextWindow: null });
    expect(nativeTokenUsage({ total: report().total, last: { totalTokens: 80 } }, undefined)).toBeNull();
    expect(reportedTokenUsage({ ...report(), total: { ...report().total, cachedInputTokens: -1 } })).toBeNull();
    expect(reportedTokenUsage({ ...report(), total: { ...report().total, cacheWriteInputTokens: undefined } })).toBeNull();
    expect(reportedTokenUsage({ ...report(), contextTokens: Number.MAX_SAFE_INTEGER + 1, modelContextWindow: 0 }))
      .toMatchObject({ contextTokens: null, modelContextWindow: null });
    expect(reportedTokenUsage({ ...report(), private: 'not retained', last: { reasoning: 'not retained' } })).toEqual(report());
  });

  it('coalesces a burst of reports on slow storage and durably invalidates the old measurement', async () => {
    const store = memoryStore(), gate = deferred(), normalWrite = store.write.getMockImplementation()!;
    store.write.mockImplementationOnce(async (key, value) => { await gate.promise; await normalWrite(key, value); });
    const reports = new NativeTokenUsageStore(store), pending = reports.save(scope, report());
    for (let index = 0; index < 500; index++) expect(reports.save(scope, report(index))).toBe(pending);
    expect(reports.save(scope, null)).toBe(pending);
    expect(reports.peek(scope)).toBeNull(); gate.release(); await pending;
    expect(store.write).toHaveBeenCalledTimes(2);
    const restarted = new NativeTokenUsageStore(store); await restarted.load(scope); expect(restarted.peek(scope)).toBeNull();
  });

  it.each([report(90), null])('does not restore a stale disk read over a notification or rewind (%j)', async update => {
    const store = memoryStore(); await new NativeTokenUsageStore(store).save(scope, report());
    const gate = deferred(), normalRead = store.read.getMockImplementation()!;
    store.read.mockImplementationOnce(async (key, fallback) => { const saved = await normalRead(key, fallback); await gate.promise; return saved; });
    const reports = new NativeTokenUsageStore(store), loading = reports.load(scope);
    await reports.save(scope, update); gate.release(); await loading;
    expect(reports.peek(scope)).toEqual(update);
  });

  it('keeps native measurements usable when persistence fails and retries on the next report', async () => {
    const store = memoryStore(), status = vi.fn(), reports = new NativeTokenUsageStore(store, status);
    store.write.mockRejectedValueOnce(new Error('Synthetic storage failure.'));
    await expect(reports.save(scope, report())).rejects.toThrow('Synthetic storage failure.');
    expect(reports.peek(scope)).toEqual(report()); expect(status).toHaveBeenCalledWith(expect.objectContaining(scope), 'write');
    await reports.save(scope, report(90));
    const restarted = new NativeTokenUsageStore(store); await restarted.load(scope); expect(restarted.peek(scope)).toEqual(report(90));
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining(scope));
  });
});
