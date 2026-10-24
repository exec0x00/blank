import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HuggingFaceUploadBucket, PUBLIC_CAS_ORIGIN, validateUploadCapability } from '../server/uploads/bucket';
import { PUBLIC_DOWNLOAD_BUCKET } from '../server/downloads/bucket';

const TOKEN = 'hf_SYNTHETIC_upload_writer_secret';
const CAS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJ0ZXN0Ijp0cnVlfQ.c3ludGhldGlj';
const CAS = 'https://cas-server-direct.xethub.hf.co';
const endpoint = `https://huggingface.co/api/buckets/${PUBLIC_DOWNLOAD_BUCKET}`;
const now = Date.now();
const objectPath = `imports/${randomUUID()}/fichier é 文.bin`;
const xetHash = 'a'.repeat(64);
const metadata = { path: objectPath, type: 'file', size: 4, xetHash, uploadedAt: new Date(now).toISOString() };
const capability = () => ({ accessToken: CAS_TOKEN, casUrl: CAS, exp: Math.floor(now / 1000) + 900 });
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const signal = () => new AbortController().signal;

describe('native HF browser upload boundary', () => {
  it('requests only the pinned bucket CAS capability and strips unrelated upstream properties', async () => {
    const id = randomUUID();
    const request = vi.fn<typeof fetch>().mockImplementation(async (resource, options) => {
      expect(String(resource)).toBe(`${endpoint}/xet-write-token`);
      expect(options).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit' });
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(new Headers(options?.headers).get('x-xet-session-id')).toBe(id);
      expect(options?.body).toBeUndefined();
      return json({ ...capability(), unrelatedWriter: TOKEN });
    });
    const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, request, () => now);
    expect(await bucket.capability(id, signal())).toEqual({ ...capability(), casUrl: PUBLIC_CAS_ORIGIN });
    expect(request).toHaveBeenCalledTimes(1);
    expect(() => new HuggingFaceUploadBucket('alvin3y12/data', TOKEN, request)).toThrow();
  });

  it('normalizes only the exact validated direct alias to the public CAS without changing JWT or expiry', () => {
    const original = Object.freeze(capability());
    const normalized = validateUploadCapability(original, now, TOKEN);
    expect(normalized).toEqual({ accessToken: original.accessToken, exp: original.exp, casUrl: PUBLIC_CAS_ORIGIN });
    expect(original.casUrl).toBe(CAS);
    expect(validateUploadCapability({ ...original, casUrl: `${CAS}/` }, now, TOKEN)).toEqual(normalized);
    for (const casUrl of [PUBLIC_CAS_ORIGIN, `${PUBLIC_CAS_ORIGIN}/`]) {
      expect(validateUploadCapability({ ...original, casUrl }, now, TOKEN)).toEqual(normalized);
    }
    for (const casUrl of [
      `${CAS}.evil.example`, `${PUBLIC_CAS_ORIGIN}.evil.example`, `${CAS}:444`, `${CAS}:443`,
      `${CAS}/..`, `${CAS}?`, `${CAS}#`, ` ${CAS}`, `${CAS.toUpperCase()}`,
      'http://cas-server.xethub.hf.co', 'https://@cas-server.xethub.hf.co',
      'https://cas-server-direct.xethub.hf.co@evil.example', 'https://evil.example@cas-server.xethub.hf.co',
    ]) expect(() => validateUploadCapability({ ...original, casUrl }, now, TOKEN)).toThrow();
  });

  it('rejects owner-token disclosure, unexpected capability origins and lifetime expansion', () => {
    for (const change of [
      { accessToken: TOKEN }, { accessToken: 'hf_any_other_writer' }, { accessToken: 'not-a-jwt' },
      { casUrl: 'https://evil.example' }, { casUrl: `${CAS}/v1/shards` }, { casUrl: `${CAS}?token=secret` },
      { casUrl: 'https://writer@cas-server-direct.xethub.hf.co' },
      { exp: Math.floor(now / 1000) + 59 }, { exp: Math.floor(now / 1000) + 1800 },
    ]) expect(() => validateUploadCapability({ ...capability(), ...change }, now, TOKEN)).toThrow();
    expect(validateUploadCapability({ ...capability(), casUrl: 'https://cas-server.xethub.hf.co/' }, now, TOKEN).casUrl).toBe('https://cas-server.xethub.hf.co');
  });

  it('bounds capability responses and sanitizes upstream bodies and thrown exception text', async () => {
    for (const response of [json({ error: TOKEN }, 401), new Response('x'.repeat(40_000)), new Response('', { status: 302, headers: { location: 'https://evil.example' } })]) {
      const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, async () => response, () => now);
      await expect(bucket.capability(randomUUID(), signal())).rejects.toMatchObject({ code: 'UPLOAD_BUCKET_REQUEST_FAILED' });
      const error = await bucket.capability(randomUUID(), signal()).catch(value => value);
      expect(String(error)).not.toContain(TOKEN);
    }
    const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, async () => { throw new Error(TOKEN); }, () => now);
    await expect(bucket.capability(randomUUID(), signal())).rejects.toMatchObject({ message: 'Hugging Face could not complete this upload. Try again shortly.' });
  });

  it('lists only imports with pagination and refuses a changed pagination origin or bucket', async () => {
    const urls: string[] = [];
    let bad = false;
    const request: typeof fetch = async (resource, options) => {
      const url = String(resource); urls.push(url);
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(options?.redirect).toBe('error');
      if (!url.includes('cursor=')) return json([metadata], 200, { link: `<${bad ? 'https://evil.example/steal' : `${endpoint}/tree/imports?recursive=true&expand=true&cursor=2`}>; rel="next"` });
      return json([]);
    };
    const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, request);
    const collected = []; for await (const object of bucket.list(signal())) collected.push(object);
    expect(collected).toEqual([metadata]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(`${endpoint}/tree/imports?recursive=true&expand=true`);
    bad = true;
    await expect((async () => { for await (const _object of bucket.list(signal())) { /* Exhaust. */ } })()).rejects.toMatchObject({ code: 'UPLOAD_BUCKET_REQUEST_FAILED' });
    expect(urls).toHaveLength(3);
    const missing = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, async () => json({ error: 'No imports yet' }, 404));
    const empty = []; for await (const object of missing.list(signal())) empty.push(object);
    expect(empty).toEqual([]);
  });

  it('publishes one fixed immutable staging path with the writer token only on Hub', async () => {
    let published = false;
    let publications = 0;
    const request: typeof fetch = async (resource, options) => {
      expect(String(resource).startsWith(endpoint)).toBe(true);
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
      if (String(resource).endsWith('/paths-info')) return json(published ? [metadata] : []);
      expect(String(resource)).toBe(`${endpoint}/batch`);
      expect(JSON.parse(String(options?.body))).toEqual({ type: 'addFile', path: objectPath, xetHash, contentType: 'application/octet-stream' });
      published = true; publications++;
      return json({ success: true, processed: 1, succeeded: 1, failed: [] });
    };
    const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, request);
    expect(await bucket.publish({ objectPath, xetHash, signal: signal() })).toEqual(metadata);
    expect(await bucket.publish({ objectPath, xetHash, signal: signal() })).toEqual(metadata);
    expect(publications).toBe(1);
    await expect(bucket.publish({ objectPath, xetHash: 'b'.repeat(64), signal: signal() })).rejects.toMatchObject({ code: 'UPLOAD_STAGE_CONFLICT' });
    await expect(bucket.publish({ objectPath: 'exports/other.txt', xetHash, signal: signal() })).rejects.toThrow();
    expect(publications).toBe(1);
  });

  it('does not accept partial or malformed publication success', async () => {
    for (const result of [
      { success: true, processed: 2, succeeded: 1, failed: [] },
      { success: true, processed: 1, succeeded: 0, failed: [] },
      { success: false, processed: 1, succeeded: 0, failed: [{ path: objectPath, error: TOKEN }] },
    ]) {
      const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, async resource => String(resource).endsWith('/paths-info') ? json([]) : json(result));
      await expect(bucket.publish({ objectPath, xetHash, signal: signal() })).rejects.toMatchObject({ code: 'UPLOAD_BUCKET_REQUEST_FAILED' });
    }
  });

  it('downloads binary data directly from public resolve/CDN URLs without forwarding any credential', async () => {
    const bytes = Buffer.from([0, 128, 255, 47]);
    const urls: string[] = [];
    const request: typeof fetch = async (resource, options) => {
      urls.push(String(resource));
      expect(new Headers(options?.headers).has('authorization')).toBe(false);
      expect(options).toMatchObject({ credentials: 'omit', redirect: 'manual', cache: 'no-store' });
      if (urls.length === 1) return new Response('', { status: 302, headers: { location: 'https://cas-bridge.xethub.hf.co/bytes?Signature=synthetic', 'x-xet-hash': xetHash } });
      return new Response(new Uint8Array(bytes), { headers: { 'content-length': '4' } });
    };
    const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, request);
    const progress: number[] = [];
    expect(await bucket.read({ objectPath, xetHash, size: 4, signal: signal(), onProgress: value => progress.push(value) })).toEqual(bytes);
    expect(urls[0]).toContain('fichier%20%C3%A9%20%E6%96%87.bin?download=true');
    expect(progress).toEqual([4]);
  });

  it('rejects unsafe redirects, mismatched hash headers and overlong/truncated byte streams', async () => {
    const responses = [
      () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } }),
      () => new Response('', { status: 302, headers: { location: 'https://hf.co.evil.example/secret' } }),
      () => new Response('abcd', { headers: { 'x-xet-hash': 'b'.repeat(64) } }),
      () => new Response('abcde'), () => new Response('abc'),
      () => new Response('abcd', { headers: { 'content-length': '99999999' } }),
    ];
    for (const response of responses) {
      const request = vi.fn<typeof fetch>().mockImplementation(async () => response());
      const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, request);
      await expect(bucket.read({ objectPath, xetHash, size: 4, signal: signal() })).rejects.toMatchObject({ code: 'UPLOAD_BUCKET_REQUEST_FAILED' });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it('never deletes an object outside its reserved upload namespace', async () => {
    const request = vi.fn<typeof fetch>();
    const bucket = new HuggingFaceUploadBucket(PUBLIC_DOWNLOAD_BUCKET, TOKEN, request);
    for (const candidate of ['../data/secret', 'exports/anything/file.txt', 'imports/not-a-uuid/file.txt', `imports/${randomUUID()}/../file`]) {
      await expect(bucket.delete([candidate], signal())).rejects.toMatchObject({ code: 'UPLOAD_BUCKET_REQUEST_FAILED' });
    }
    expect(request).not.toHaveBeenCalled();
  });
});
