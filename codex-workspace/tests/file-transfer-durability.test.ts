import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureDurableReceipt, PublicBucketVerifier, type DurableFileReceipt } from '../server/file-transfers/durability';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('public bucket transfer durability barriers', () => {
  let directory: string;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-transfer-durability-')); });
  afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });
  const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const config = () => ({ dataDir: directory, bucket: 'owner/public-data' });
  const receipt = (value = 'verified bytes'): DurableFileReceipt => ({ absolute: path.join(directory, 'workspaces/project/file 文.txt'), size: Buffer.byteLength(value), sha256: digest(value) });
  function clock() {
    let time = Date.now();
    return { now: () => time, sleep: async (milliseconds: number) => { time += Math.max(milliseconds, 120_001); } };
  }

  it('hashes a real metadata file without reading beyond its declared bound', async () => {
    const filename = path.join(directory, 'record.json');
    await fs.writeFile(filename, '{"paths":["source","destination"]}\n');
    const actual = await captureDurableReceipt(config(), filename, 4096);
    const bytes = await fs.readFile(filename);
    expect(actual).toEqual({ absolute: filename, size: bytes.length, sha256: digest(bytes) });
    await expect(captureDurableReceipt(config(), filename, 4)).rejects.toMatchObject({ code: 'FILE_TRANSFER_DURABILITY_PENDING' });
  });

  it('rejects metadata symlinks and requests outside the configured durable root', async () => {
    await fs.writeFile(path.join(directory, 'actual'), 'keep');
    await fs.symlink('actual', path.join(directory, 'link'));
    await expect(captureDurableReceipt(config(), path.join(directory, 'link'), 10)).rejects.toMatchObject({ code: 'ELOOP' });
    await expect(captureDurableReceipt(config(), path.join(directory, '..', 'outside'), 10)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });

  it('uses the direct public object URL and confirms a bounded streamed SHA-256 without credentials', async () => {
    const content = 'verified bytes';
    const requests: { url: URL; options?: RequestInit }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, options) => {
      requests.push({ url: new URL(String(input)), options });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(Buffer.from('verified ')); controller.enqueue(Buffer.from('bytes')); controller.close();
      } }), { headers: { 'content-length': String(Buffer.byteLength(content)) } });
    });
    await new PublicBucketVerifier(config(), { fetchImpl, ...clock() }).verify([receipt(content)]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url.origin).toBe('https://huggingface.co');
    expect(requests[0].url.pathname).toBe('/buckets/owner/public-data/resolve/workspaces/project/file%20%E6%96%87.txt');
    expect(requests[0].url.searchParams.get('verify')).toMatch(/^[a-f0-9-]{36}$/);
    expect(requests[0].options).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store' });
    expect(new Headers(requests[0].options?.headers).has('authorization')).toBe(false);
    expect(new Headers(requests[0].options?.headers).has('cookie')).toBe(false);
    expect(requests[0].options?.body).toBeUndefined();
  });

  it('accepts only provider HTTPS redirects and strips every opportunity to forward credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.hf.co/bytes?signed=opaque' } }))
      .mockResolvedValueOnce(new Response('verified bytes'));
    await new PublicBucketVerifier(config(), { fetchImpl, ...clock() }).verify([receipt()]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options?.credentials).toBe('omit');
      expect(options?.redirect).toBe('manual');
      expect(new Headers(options?.headers).has('authorization')).toBe(false);
    }
    for (const location of ['http://huggingface.co/object', 'https://attacker.invalid/object', 'https://user:secret@huggingface.co/object', 'https://huggingface.co.evil.invalid/object', 'https://huggingface.co:8443/object']) {
      const unsafe = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location } }));
      await expect(new PublicBucketVerifier(config(), { fetchImpl: unsafe, ...clock() }).verify([receipt()]))
        .rejects.toMatchObject({ code: 'FILE_TRANSFER_DURABILITY_PENDING' });
      expect(unsafe).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects same-sized wrong bytes, oversized bodies, truncated bodies, and misleading content lengths', async () => {
    const responses = [
      () => new Response('different data'),
      () => new Response('verified bytes plus more'),
      () => new Response('short'),
      () => new Response('verified bytes', { headers: { 'content-length': '999' } }),
      () => new Response('verified bytes', { headers: { 'content-length': '-1' } }),
    ];
    for (const response of responses) {
      const fetchImpl = vi.fn<typeof fetch>(async () => response());
      await expect(new PublicBucketVerifier(config(), { fetchImpl, ...clock() }).verify([receipt()]))
        .rejects.toMatchObject({ status: 503, code: 'FILE_TRANSFER_DURABILITY_PENDING' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('waits for asynchronous publication but does not treat a missing object as a successful move', async () => {
    let now = Date.now();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('old contents'))
      .mockResolvedValueOnce(new Response('verified bytes'));
    const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds; });
    await new PublicBucketVerifier(config(), { fetchImpl, now: () => now, sleep }).verify([receipt()]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([250, 500]);
    const queries = fetchImpl.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('verify'));
    expect(new Set(queries).size).toBe(3);
  });

  it('bounds redirect loops and exposes no signed URL or upstream error text on failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302, headers: { location: 'https://cdn.hf.co/loop?token=must-not-appear' },
    }));
    const error = await new PublicBucketVerifier(config(), { fetchImpl, ...clock() }).verify([receipt()]).catch(value => value as Error);
    expect(error).toMatchObject({ code: 'FILE_TRANSFER_DURABILITY_PENDING' });
    expect((error as Error).message).not.toMatch(/must-not-appear|token=|cdn\.hf\.co/);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('requires a separate verified receipt for each file and each metadata object', async () => {
    const first = receipt();
    const metadata = { absolute: path.join(directory, 'codex-workspace/state/file-transfer-record.json'), size: 2, sha256: digest('{}') };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('verified bytes'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(new PublicBucketVerifier(config(), { fetchImpl, ...clock() }).verify([first, metadata])).rejects.toMatchObject({ code: 'FILE_TRANSFER_DURABILITY_PENDING' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[1][0])).pathname).toContain('file-transfer-record.json');
  });

  it('checks old object absence at the fixed Hub endpoint without following redirects', async () => {
    let now = Date.now();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.hf.co/old' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await new PublicBucketVerifier(config(), { fetchImpl, now: () => now, sleep: async milliseconds => { now += milliseconds; } }).verifyAbsent([receipt().absolute]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [input, options] of fetchImpl.mock.calls) {
      expect(new URL(String(input)).origin).toBe('https://huggingface.co');
      expect(options).toMatchObject({ method: 'HEAD', credentials: 'omit', redirect: 'manual', cache: 'no-store' });
    }
  });

  it.each(['GET', 'HEAD'] as const)('preserves caller cancellation during %s without retrying or exposing transport errors', async method => {
    const entered = deferred();
    const closing = new AbortController();
    const reason = new Error('This file-page context is closing.');
    let received: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, options) => {
      received = options?.signal;
      expect(options?.method).toBe(method);
      entered.resolve();
      return new Promise<Response>((_resolve, reject) => {
        received!.addEventListener('abort', () => reject(new Error('Transport detail must not replace the caller reason.')), { once: true });
      });
    });
    const verifier = new PublicBucketVerifier(config(), { fetchImpl, signal: closing.signal });
    const pending = method === 'GET' ? verifier.verify([receipt()]) : verifier.verifyAbsent([receipt().absolute]);
    const rejected = expect(pending).rejects.toBe(reason);
    await entered.promise;
    closing.abort(reason);
    await rejected;
    expect(received?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const healthy = vi.fn<typeof fetch>(async () => new Response('verified bytes'));
    await new PublicBucketVerifier(config(), { fetchImpl: healthy, signal: new AbortController().signal }).verify([receipt()]);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('cancels and clears its native backoff timer without making another request', async () => {
    vi.useFakeTimers();
    const closing = new AbortController();
    const reason = new Error('Stop during backoff.');
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const pending = new PublicBucketVerifier(config(), { fetchImpl, signal: closing.signal }).verify([receipt()]);
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const waitingTimers = vi.getTimerCount();
    expect(waitingTimers).toBeGreaterThan(0);
    closing.abort(reason);
    await rejected;
    expect(vi.getTimerCount()).toBeLessThan(waitingTimers);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes cancellation to an injected sleep but waits for that hook to finish before settling', async () => {
    const entered = deferred();
    const release = deferred();
    const closing = new AbortController();
    const reason = new Error('Stop while custom backoff is active.');
    const sleep = vi.fn(async (_milliseconds: number, signal?: AbortSignal) => {
      expect(signal).toBe(closing.signal); entered.resolve(); await release.promise;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    let settled = false;
    const pending = new PublicBucketVerifier(config(), { fetchImpl, sleep, signal: closing.signal }).verify([receipt()]);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    const rejected = expect(pending).rejects.toBe(reason);
    await entered.promise;
    closing.abort(reason);
    try { await new Promise<void>(resolve => { setImmediate(resolve); }); expect(settled).toBe(false); }
    finally { release.resolve(); }
    await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('waits for an active resource hook and then reports caller cancellation before fetching', async () => {
    const entered = deferred();
    const release = deferred();
    const closing = new AbortController();
    const reason = new Error('Stop while resource observation is active.');
    const checkResources = async () => { entered.resolve(); await release.promise; };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('verified bytes'));
    let settled = false;
    const pending = new PublicBucketVerifier(config(), { fetchImpl, checkResources, signal: closing.signal }).verify([receipt()]);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    const rejected = expect(pending).rejects.toBe(reason);
    await entered.promise;
    closing.abort(reason);
    try { await new Promise<void>(resolve => { setImmediate(resolve); }); expect(settled).toBe(false); }
    finally { release.resolve(); }
    await rejected;
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
