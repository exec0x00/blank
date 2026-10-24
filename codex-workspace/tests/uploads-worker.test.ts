import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitParams, CommitProgressEvent } from '@huggingface/hub';
import type { UploadCapability } from '../shared/types';
import { UploadProtocolError, uploadFileToTransferBucket, validateUploadCapability, type UploadWorkerInput } from '../client/uploads.worker';

const sdk = vi.hoisted(() => ({ commit: vi.fn() }));
vi.mock('@huggingface/hub', () => ({ commitIter: sdk.commit }));

const bucket = 'alvin3y12/codex-downloads';
const id = '10000000-0000-4000-8000-000000000001';
const objectPath = `imports/${id}/source.txt`;
const tokenRoute = `https://huggingface.co/api/buckets/${bucket}/xet-write-token`;
const batchRoute = `https://huggingface.co/api/buckets/${bucket}/batch`;
const hash = 'a'.repeat(64);
const casUrl = 'https://cas-server-direct.xethub.hf.co';
const token = 'temporary-CAS-capability-for-worker-tests';
const capability = (): UploadCapability => ({ accessToken: token, casUrl, exp: Math.floor(Date.now() / 1000) + 900 });
const input = (file = new File(['hello'], 'source.txt')): UploadWorkerInput => ({ file, bucket, objectPath, reservationId: id });

async function tokenFor(params: CommitParams) {
  const response = await params.fetch!(tokenRoute, { headers: { 'X-Xet-Session-Id': 'fixture' } });
  return await response.json() as UploadCapability;
}

function options() {
  const controller = new AbortController();
  const nativeFetch = vi.fn(async () => new Response('', { status: 200 }));
  return { controller, nativeFetch, args: { capability: vi.fn(async () => capability()), progress: vi.fn(), signal: controller.signal, fetch: nativeFetch as unknown as typeof fetch } };
}

beforeEach(() => {
  sdk.commit.mockReset();
  // These tests exercise our security/cancellation boundary with an SDK driver.
  // Actual Xet packing and normal browser CORS are covered by the live browser
  // protocol proof; these fixtures make no claim about provider availability.
  sdk.commit.mockImplementation(async function* (params: CommitParams): AsyncGenerator<CommitProgressEvent> {
    const credential = await tokenFor(params);
    const authorization = `Bearer ${credential.accessToken}`;
    await params.fetch!(`${credential.casUrl}/v1/chunks/default/${hash}`, { headers: { Authorization: authorization } });
    await params.fetch!(`${credential.casUrl}/v1/xorbs/default/${hash}`, { method: 'POST', headers: { Authorization: authorization }, body: new Uint8Array([104, 101, 108, 108, 111]) });
    yield { event: 'fileProgress', state: 'uploading', path: objectPath, progress: 1 };
    await params.fetch!(`${credential.casUrl}/v1/shards`, { method: 'POST', headers: { Authorization: authorization }, body: new Uint8Array([1, 2, 3]) });
    await params.fetch!(batchRoute, { method: 'POST', body: JSON.stringify({ type: 'addFile', path: objectPath, xetHash: hash }) });
  });
});

describe('direct upload worker boundary', () => {
  it('uses only direct CORS CAS requests and returns independent SHA-256 metadata before Hub publication', async () => {
    const setup = options();
    const result = await uploadFileToTransferBucket(input(), setup.args);
    expect(result).toEqual({ xetHash: hash, sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' });
    expect(setup.args.capability).toHaveBeenCalledOnce();
    expect(setup.nativeFetch).toHaveBeenCalledTimes(3);
    for (const [url, init] of setup.nativeFetch.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(new URL(url).origin).toBe(casUrl);
      expect(init).toMatchObject({ mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`);
    }
    expect(setup.args.progress).toHaveBeenCalledWith({ type: 'progress', stage: 'uploading', bytesUploaded: 5 });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(setup.args.progress.mock.calls)).not.toContain(token);
  });

  it('blocks main writer tokens, expired capabilities, and unexpected CAS origins before any direct request', async () => {
    const invalid = [
      { ...capability(), accessToken: 'hf_main_writer_token_must_never_reach_a_browser' },
      { ...capability(), exp: Math.floor(Date.now() / 1000) - 1 },
      { ...capability(), exp: Math.floor(Date.now() / 1000) + 86_400 },
      { ...capability(), casUrl: 'https://example.test' },
      { ...capability(), casUrl: `${casUrl}/extra` },
      { ...capability(), casUrl: `${casUrl}?token=secret` },
      { ...capability(), casUrl: 'https://name:secret@cas-server-direct.xethub.hf.co' },
    ];
    for (const value of invalid) expect(() => validateUploadCapability(value)).toThrow(UploadProtocolError);
    const setup = options(); setup.args.capability.mockResolvedValueOnce(invalid[0]);
    await expect(uploadFileToTransferBucket(input(), setup.args)).rejects.toMatchObject({ code: 'UPLOAD_CAPABILITY_INVALID' });
    expect(setup.nativeFetch).not.toHaveBeenCalled();
  });

  it('rejects SDK requests that would forward the capability to another destination or method', async () => {
    for (const unsafe of [
      { url: `https://example.test/v1/xorbs/default/${hash}`, method: 'POST' },
      { url: `${casUrl}/v1/shards?redirect=elsewhere`, method: 'POST' },
      { url: `${casUrl}/v1/shards`, method: 'DELETE' },
      { url: `${casUrl}/v1/reconstruction/${hash}`, method: 'GET' },
      { url: `http://cas-server-direct.xethub.hf.co/v1/shards`, method: 'POST' },
    ]) {
      sdk.commit.mockImplementationOnce(async function* (params: CommitParams) {
        const credential = await tokenFor(params);
        await params.fetch!(unsafe.url, { method: unsafe.method, headers: { Authorization: `Bearer ${credential.accessToken}` } });
      });
      const setup = options();
      await expect(uploadFileToTransferBucket(input(), setup.args)).rejects.toMatchObject({ code: 'UPLOAD_PROTOCOL_INVALID' });
      expect(setup.nativeFetch).not.toHaveBeenCalled();
    }
  });

  it('rejects a publication candidate for any object except the exact reserved staging path', async () => {
    sdk.commit.mockImplementationOnce(async function* (params: CommitParams) {
      await params.fetch!(batchRoute, { method: 'POST', body: JSON.stringify({ type: 'addFile', path: `imports/${id}/different.txt`, xetHash: hash }) });
    });
    const setup = options();
    await expect(uploadFileToTransferBucket(input(), setup.args)).rejects.toMatchObject({ code: 'UPLOAD_PROTOCOL_INVALID' });
    expect(setup.nativeFetch).not.toHaveBeenCalled();
  });

  it('never treats 100% source-byte progress as success when the final shard upload fails', async () => {
    const setup = options();
    setup.nativeFetch.mockImplementation(async (...args: unknown[]) => new Response('', { status: String(args[0]).endsWith('/v1/shards') ? 503 : 200 }));
    await expect(uploadFileToTransferBucket(input(), setup.args)).rejects.toMatchObject({ code: 'UPLOAD_TRANSFER_FAILED' });
    expect(setup.args.progress).toHaveBeenCalledWith({ type: 'progress', stage: 'uploading', bytesUploaded: 5 });
  });

  it('surfaces a blocked network/CORS request with a static message and no credential leakage', async () => {
    const setup = options();
    setup.nativeFetch.mockRejectedValueOnce(new TypeError(`Failed request with ${token}`));
    const error = await uploadFileToTransferBucket(input(), setup.args).then((): never => { throw new Error('Expected the direct transfer to fail.'); }, error => error as UploadProtocolError);
    expect(error.code).toBe('UPLOAD_NETWORK_BLOCKED');
    expect(error.message).toContain('browser could not reach Hugging Face');
    expect(error.message).not.toContain(token);
  });

  it('stops before transmitting data when cancellation occurs during capability retrieval', async () => {
    const setup = options();
    setup.args.capability.mockImplementationOnce(async () => { setup.controller.abort(); return capability(); });
    await expect(uploadFileToTransferBucket(input(), setup.args)).rejects.toMatchObject({ name: 'AbortError' });
    expect(setup.nativeFetch).not.toHaveBeenCalled();
  });

  it('validates the immutable file bound and staging reservation before reading file bytes', async () => {
    const setup = options();
    const file = new File(['a'], 'source.txt');
    Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 + 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(uploadFileToTransferBucket(input(file), setup.args)).rejects.toMatchObject({ code: 'UPLOAD_PROTOCOL_INVALID' });
    expect(read).not.toHaveBeenCalled();
    expect(sdk.commit).not.toHaveBeenCalled();
    expect(setup.args.capability).not.toHaveBeenCalled();
  });

  it('calculates the correct digest for an empty file and still waits for server publication', async () => {
    const setup = options();
    const result = await uploadFileToTransferBucket(input(new File([], 'source.txt')), setup.args);
    expect(result.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(result.xetHash).toBe(hash);
    expect(setup.nativeFetch).toHaveBeenCalledTimes(3);
  });
});
