import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as hub from '@huggingface/hub';
import { HuggingFaceDownloadBucket, huggingFaceFetch, PUBLIC_DOWNLOAD_BUCKET, publicDownloadUrl, uploadTime, validateDownloadBucket } from '../server/downloads/bucket';

vi.mock('@huggingface/hub', async importOriginal => {
  const actual = await importOriginal<typeof import('@huggingface/hub')>();
  return { ...actual, commitIter: vi.fn(actual.commitIter) };
});

const TOKEN = 'hf_SYNTHETIC_DOWNLOAD_TEST_SECRET';
const endpoint = `https://huggingface.co/api/buckets/${PUBLIC_DOWNLOAD_BUCKET}`;
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const signal = () => new AbortController().signal;

afterEach(() => vi.restoreAllMocks());

describe('native Hugging Face download bucket boundary', () => {
  it('pins the cleanup/upload bucket separately from every data-bucket spelling', () => {
    expect(validateDownloadBucket(PUBLIC_DOWNLOAD_BUCKET, 'alvin3y12/data')).toBe(PUBLIC_DOWNLOAD_BUCKET);
    for (const bucket of ['alvin3y12/data', 'buckets/alvin3y12/data', 'ALVIN3Y12/DATA', 'alvin3y12/data/', 'someone/else']) {
      expect(() => validateDownloadBucket(bucket, 'alvin3y12/data')).toThrow();
    }
    expect(() => validateDownloadBucket(PUBLIC_DOWNLOAD_BUCKET, `buckets/${PUBLIC_DOWNLOAD_BUCKET}/`)).toThrow();
    expect(() => publicDownloadUrl(PUBLIC_DOWNLOAD_BUCKET, '../data/secret')).toThrow();
    expect(publicDownloadUrl(PUBLIC_DOWNLOAD_BUCKET, 'exports/file/café 文.txt')).toContain('caf%C3%A9%20%E6%96%87.txt?download=true');
  });

  it('reads every SDK pagination page with expand=true and exposes upload time independently from old mtime', async () => {
    const uploadedAt = '2026-09-19T12:00:00.000Z';
    const first = { path: 'a.txt', type: 'file', size: 3, uploadedAt, mtime: '2020-01-01T00:00:00Z', xetHash: 'a'.repeat(64) };
    const second = { path: 'nested/b.txt', type: 'file', size: 4, uploadedAt, xetHash: 'b'.repeat(64) };
    const requests: { url: string; headers: Headers }[] = [];
    const fetchImpl: typeof fetch = async (resource, options) => {
      const url = new URL(String(resource));
      requests.push({ url: url.href, headers: new Headers(options?.headers) });
      if (!url.searchParams.has('cursor')) {
        expect(url.searchParams.get('recursive')).toBe('true');
        expect(url.searchParams.get('expand')).toBe('true');
        return json([first], 200, { link: `<${endpoint}/tree?recursive=true&expand=true&cursor=page-2>; rel="next"` });
      }
      return json([second]);
    };
    const bucket = new HuggingFaceDownloadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, fetchImpl);
    const objects = [];
    for await (const object of bucket.list(signal())) objects.push(object);
    expect(objects.map(item => item.path)).toEqual(['a.txt', 'nested/b.txt']);
    expect(objects[0].uploadedAt).toBe(uploadedAt);
    expect(objects[0]).not.toHaveProperty('mtime');
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.url).not.toContain(TOKEN);
    }
  });

  it('does not follow a pagination URL to a non-HF origin or forward the owner token to CAS', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([], 200, { link: '<https://evil.example/tree>; rel="next"' }));
    const bucket = new HuggingFaceDownloadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, fetchImpl);
    await expect((async () => { for await (const _item of bucket.list(signal())) { /* Exhaust pagination. */ } })()).rejects.toMatchObject({ code: 'DOWNLOAD_BUCKET_REQUEST_FAILED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = huggingFaceFetch({ signal: signal(), token: TOKEN, fetchImpl });
    await expect(request('https://cas-server-direct.xethub.hf.co/v1/shards', { headers: { Authorization: `Bearer ${TOKEN}` } })).rejects.toMatchObject({ code: 'DOWNLOAD_BUCKET_REQUEST_FAILED' });
    await expect(request('https://huggingface.co@evil.example/api')).rejects.toThrow();
    await expect(request('http://huggingface.co/api')).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('forwards the job abort signal to otherwise signal-less SDK requests and refuses automatic redirects', async () => {
    const controller = new AbortController();
    let received: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (_resource, options) => {
      received = options;
      return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
    };
    const request = huggingFaceFetch({ signal: controller.signal, token: TOKEN, fetchImpl });
    const pending = request('https://cas-server-direct.xethub.hf.co/v1/shards', { method: 'POST', body: 'shard', headers: { Authorization: 'Bearer synthetic-xet-token' } });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(received?.signal?.aborted).toBe(true);
    expect(received?.redirect).toBe('error');
  });

  it('publishes the original MIME type and waits for the retention gate immediately before addFile', async () => {
    let allowed = false;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_resource, options) => {
      expect(allowed).toBe(true);
      expect(JSON.parse(options!.body as string)).toEqual({ type: 'addFile', path: 'exports/test/file.txt', xetHash: 'a'.repeat(64), contentType: 'text/plain' });
      return json({ success: true, processed: 1, succeeded: 1, failed: [] });
    });
    const request = huggingFaceFetch({
      signal: signal(), token: TOKEN, fetchImpl,
      upload: { bucket: PUBLIC_DOWNLOAD_BUCKET, path: 'exports/test/file.txt', mimeType: 'text/plain' },
      beforePublish: async () => { allowed = true; },
    });
    const result = await request(`${endpoint}/batch`, { method: 'POST', body: JSON.stringify({ type: 'addFile', path: 'exports/test/file.txt', xetHash: 'a'.repeat(64) }) });
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const denied = huggingFaceFetch({
      signal: signal(), token: TOKEN, fetchImpl,
      upload: { bucket: PUBLIC_DOWNLOAD_BUCKET, path: 'exports/test/file.txt', mimeType: 'text/plain' },
      beforePublish: async () => { throw new Error('retention unavailable'); },
    });
    await expect(denied(`${endpoint}/batch`, { method: 'POST', body: JSON.stringify({ type: 'addFile', path: 'exports/test/file.txt', xetHash: 'a'.repeat(64) }) })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('checks partial deletion results, confirms missing objects idempotently, and never claims an undeleted object succeeded', async () => {
    const fetchImpl: typeof fetch = async (resource, options) => {
      expect(String(resource).startsWith(endpoint)).toBe(true);
      if (String(resource).endsWith('/batch')) {
        expect((options!.body as string).split('\n').map(line => JSON.parse(line))).toEqual([
          { type: 'deleteFile', path: 'one.txt' }, { type: 'deleteFile', path: 'missing.txt' }, { type: 'deleteFile', path: 'blocked.txt' },
        ]);
        return json({ success: false, processed: 3, succeeded: 1, failed: [{ path: 'missing.txt', error: 'not found' }, { path: 'blocked.txt', error: 'busy' }] }, 422);
      }
      const requested = JSON.parse(options!.body as string).paths as string[];
      return json(requested[0] === 'missing.txt' ? [] : [{ path: 'blocked.txt', type: 'file', size: 1, uploadedAt: '2026-01-01T00:00:00Z' }]);
    };
    const bucket = new HuggingFaceDownloadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, fetchImpl);
    expect(await bucket.delete(['one.txt', 'missing.txt', 'blocked.txt'], signal())).toEqual({ deleted: ['one.txt', 'missing.txt'], failed: ['blocked.txt'] });
  });

  it('rejects malformed successful cleanup results and non-object timestamps', async () => {
    const fetchImpl: typeof fetch = async () => json({ success: true, processed: 1, succeeded: 0, failed: [] });
    const bucket = new HuggingFaceDownloadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, fetchImpl);
    await expect(bucket.delete(['one.txt'], signal())).rejects.toMatchObject({ code: 'DOWNLOAD_BUCKET_REQUEST_FAILED' });
    const now = Date.parse('2026-09-19T12:00:00Z');
    for (const value of [undefined, 'bad', '0', 0, '2026-99-19T12:00:00Z', '2026-02-31T12:00:00Z', '2026-02-29T12:00:00Z', '2027-01-01T00:00:00Z']) expect(uploadTime(value, now)).toBeUndefined();
    expect(uploadTime('2026-09-18T12:00:00Z', now)).toBe(now - 86_400_000);
  });

  it('uses a disk-backed Blob for the real snapshot and treats SDK error-progress as failure', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'download-native-test-'));
    const snapshot = path.join(directory, 'snapshot');
    await fs.writeFile(snapshot, Buffer.from([0, 128, 255, 17]));
    const objectPath = 'exports/test/binary.bin';
    const progress: number[] = [];
    let failed = false;
    vi.mocked(hub.commitIter).mockImplementation(async function* (options) {
      expect(options.repo).toEqual({ type: 'bucket', name: PUBLIC_DOWNLOAD_BUCKET });
      expect(options.accessToken).toBe(TOKEN);
      const operation = options.operations[0];
      if (operation.operation !== 'addOrUpdate' || !(operation.content instanceof Blob)) throw new Error('Expected a disk-backed Blob.');
      expect(Buffer.from(await operation.content.arrayBuffer())).toEqual(Buffer.from([0, 128, 255, 17]));
      yield { event: 'fileProgress', state: failed ? 'error' : 'uploading', path: objectPath, progress: 0.5 };
      return undefined;
    });
    const fetchImpl: typeof fetch = async () => json([{ path: objectPath, type: 'file', size: 4, uploadedAt: '2026-09-19T12:00:00Z', xetHash: 'a'.repeat(64) }]);
    const bucket = new HuggingFaceDownloadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, fetchImpl);
    try {
      expect(await bucket.upload({ objectPath, snapshotPath: snapshot, mimeType: 'application/octet-stream', size: 4, signal: signal(), onProgress: bytes => progress.push(bytes) })).toMatchObject({ path: objectPath, size: 4 });
      expect(progress).toEqual([2]);
      failed = true;
      await expect(bucket.upload({ objectPath, snapshotPath: snapshot, mimeType: 'application/octet-stream', size: 4, signal: signal(), onProgress: () => undefined })).rejects.toMatchObject({ code: 'DOWNLOAD_BUCKET_REQUEST_FAILED' });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
