import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, json } from '../client/api';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('browser API response and deadline handling', () => {
  it('preserves JSON arrays and Headers inputs while retaining same-origin authentication', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('[{"id":"retained"}]', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const headers = new Headers({ 'Content-Type': 'application/json', 'If-Match': 'saved-version', 'X-Codex-Workspace': 'wrong' });
    expect(await api('/saved', { headers })).toEqual([{ id: 'retained' }]);
    const [, request] = fetch.mock.calls[0] as [string, RequestInit];
    expect(request.credentials).toBe('same-origin');
    expect(new Headers(request.headers).get('If-Match')).toBe('saved-version');
    expect(new Headers(request.headers).get('X-Codex-Workspace')).toBe('1');
    expect(headers.get('X-Codex-Workspace')).toBe('wrong');
  });

  it.each(['<html>Starting workspace…</html>', '', '{"saved":'])('rejects an unreadable success response instead of confirming a save: %s', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(api('/saved', json('PUT', { content: 'keep my edits' }))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('retains HTTP failure status for non-JSON and null error bodies', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 503 }))
      .mockResolvedValueOnce(new Response('null', { status: 502 }));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/bootstrap')).rejects.toMatchObject({ status: 503, message: 'Request failed (503).' });
    await expect(api('/bootstrap')).rejects.toMatchObject({ status: 502, message: 'Request failed (502).' });
  });

  it('bounds a stalled bootstrap read, aborts it, and never retries or accepts its late result', async () => {
    vi.useFakeTimers();
    const response = pending<Response>();
    const fetch = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetch);
    const result = api('/bootstrap').catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    const cancelled = vi.fn();
    response.resolve(new Response(new ReadableStream<Uint8Array>({ cancel: cancelled })));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cancelled).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'REQUEST_TIMEOUT' }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the deadline active while a successful response body is stalled', async () => {
    vi.useFakeTimers();
    const body = pending<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => body.promise }));
    const result = api('/bootstrap', { timeoutMs: 100 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBeInstanceOf(ApiError);
    body.resolve({ late: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves a mutation deadline to its caller and never replays an uncertain write', async () => {
    vi.useFakeTimers();
    const response = pending<Response>();
    const fetch = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetch);
    let completed = false;
    const result = api('/files', json('POST', { name: 'one-copy' })).then(value => { completed = true; return value; });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(completed).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
    response.resolve(new Response('{"created":true}'));
    expect(await result).toEqual({ created: true });
  });

  it('honors cancellation without waiting for a fetch implementation to settle', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const response = pending<Response>();
    const fetch = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetch);
    const result = api('/bootstrap', { signal: controller.signal }).catch(error => error);
    const reason = new Error('This session was superseded.');
    controller.abort(reason);
    expect(await result).toBe(reason);
    response.resolve(new Response('{}'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(api('/bootstrap', { signal: controller.signal })).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels an unread response body that arrives after its caller has aborted', async () => {
    const response = pending<Response>();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(response.promise));
    const controller = new AbortController();
    const reason = new Error('The selected history item changed.');
    const result = api('/threads/old/history/detail', { signal: controller.signal }).catch(error => error);
    controller.abort(reason);
    expect(await result).toBe(reason);
    response.resolve(new Response(body, { status: 200 }));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(cancelled).toHaveBeenCalledExactlyOnceWith(reason);
    expect(body.locked).toBe(false);
  });

  it.each(['rejected', 'stalled'] as const)('does not wait for %s cleanup of a discarded late response', async cleanup => {
    const response = pending<Response>();
    const cancelled = vi.fn(() => cleanup === 'rejected' ? Promise.reject(new Error('The transport is already closed.')) : new Promise<void>(() => undefined));
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(response.promise));
    const controller = new AbortController();
    const reason = new Error('The workspace was locked.');
    const result = api('/threads/old/history/detail', { signal: controller.signal }).catch(error => error);
    controller.abort(reason);
    expect(await result).toBe(reason);
    response.resolve(new Response(new ReadableStream<Uint8Array>({ cancel: cancelled })));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(cancelled).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it('allows an explicit session deadline without retrying its mutation', async () => {
    vi.useFakeTimers();
    const response = pending<Response>();
    const fetch = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetch);
    const result = api('/session', { ...json('DELETE'), timeoutMs: 100 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ code: 'REQUEST_TIMEOUT', message: expect.stringContaining('unconfirmed') });
    response.resolve(new Response('{"authenticated":false}'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
