import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionLock, readSessionLock, rememberSessionLock } from '../client/session-lock';

function browser(storageAvailable = true) {
  const values = new Map<string, string>();
  const location = { href: 'https://workspace.example/work?workspace=fixture&view=editor#retained' };
  const history = { state: { preserved: true }, replaceState: vi.fn((_state: unknown, _unused: string, value: string | URL) => { location.href = String(value); }) };
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  vi.stubGlobal('window', { location, history, get localStorage() { if (!storageAvailable) throw new Error('Storage is unavailable.'); return localStorage; } });
  clearSessionLock(); history.replaceState.mockClear();
  return { values, location, history };
}
afterEach(() => { clearSessionLock(); vi.unstubAllGlobals(); });

describe('explicit workspace lock persistence', () => {
  it('remembers unconfirmed logout without storing credentials or losing window selection', () => {
    const data = browser();
    rememberSessionLock('pending');
    expect(readSessionLock()).toBe('pending');
    expect([...data.values.values()]).toEqual(['pending']);
    const url = new URL(data.location.href);
    expect(url.pathname).toBe('/work'); expect(url.searchParams.get('workspace')).toBe('fixture');
    expect(url.searchParams.get('view')).toBe('editor'); expect(url.hash).toBe('#retained');
    expect(url.searchParams.get('workspace-lock')).toBe('pending');
    expect(data.history.replaceState).toHaveBeenCalledWith({ preserved: true }, '', expect.any(URL));
  });

  it('requires explicit sign-in after confirmed logout and clears only its lock markers', () => {
    const data = browser();
    data.values.set('other-setting', 'retain');
    rememberSessionLock('pending'); rememberSessionLock('confirmed');
    expect(readSessionLock()).toBe('confirmed');
    clearSessionLock();
    expect(readSessionLock()).toBeUndefined();
    expect([...data.values.entries()]).toEqual([['other-setting', 'retain']]);
    expect(data.location.href).toBe('https://workspace.example/work?workspace=fixture&view=editor#retained');
  });

  it('uses the current URL to retain an explicit lock when browser storage is blocked', async () => {
    const data = browser(false);
    rememberSessionLock('pending');
    // A fresh module has no previous page's in-memory fallback, as on reload.
    vi.resetModules();
    const reloaded = await import('../client/session-lock');
    expect(reloaded.readSessionLock()).toBe('pending');
    reloaded.clearSessionLock();
    expect(new URL(data.location.href).searchParams.has('workspace-lock')).toBe(false);
  });

  it('does not treat arbitrary stored or URL values as a lock or expose them', () => {
    const data = browser();
    data.values.set('codex.workspace-lock.v1', '{"unexpected":"payload"}');
    const url = new URL(data.location.href); url.searchParams.set('workspace-lock', 'unknown'); data.location.href = url.href;
    expect(readSessionLock()).toBeUndefined();
  });
});
