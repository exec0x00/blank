import { openAsBlob } from 'node:fs';
import { commitIter, listFiles, pathsInfo } from '@huggingface/hub';
import { HttpError } from '../errors';
import type { BucketDeleteResult, BucketObject, DownloadBucket } from './types';

export const PUBLIC_DOWNLOAD_BUCKET = 'alvin3y12/codex-downloads';
export const DOWNLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;
const HUB_ORIGIN = 'https://huggingface.co';
const MAX_BATCH_RESPONSE_BYTES = 256 * 1024;

export function validateDownloadBucket(bucket: string, dataBucket: string): string {
  const normalize = (value: string) => value.replace(/^buckets\//, '').replace(/\/$/, '').toLowerCase();
  if (normalize(bucket) === normalize(dataBucket) || normalize(bucket) === 'alvin3y12/data' || bucket !== PUBLIC_DOWNLOAD_BUCKET) {
    throw new HttpError(503, 'Downloads require the separate public codex-downloads bucket. The data bucket cannot be used for temporary downloads.', 'DOWNLOAD_BUCKET_UNSAFE');
  }
  return bucket;
}

export function validObjectPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.startsWith('/')
    && !/[\\\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export function uploadTime(value: unknown, now: number): number | undefined {
  if (typeof value !== 'string' || value.length > 60) return undefined;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return undefined;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 5 * 60 * 1000 ? timestamp : undefined;
}

export function publicDownloadUrl(bucket: string, objectPath: string): string {
  validateDownloadBucket(bucket, 'alvin3y12/data');
  if (!validObjectPath(objectPath)) throw new HttpError(400, 'Invalid download object.', 'DOWNLOAD_INVALID_OBJECT');
  return `${HUB_ORIGIN}/buckets/${bucket}/resolve/${objectPath.split('/').map(encodeURIComponent).join('/')}?download=true`;
}

function remoteFailure(): HttpError {
  // Deliberately omit upstream bodies, headers, request URLs and credential-bearing error text.
  return new HttpError(502, 'Hugging Face could not complete this file transfer. Try again shortly.', 'DOWNLOAD_BUCKET_REQUEST_FAILED');
}

function allowedHubUrl(value: URL): boolean {
  return value.protocol === 'https:' && !value.username && !value.password && (!value.port || value.port === '443')
    && (value.hostname === 'huggingface.co' || value.hostname.endsWith('.huggingface.co') || value.hostname.endsWith('.hf.co'));
}

interface BatchResponse { success: boolean; processed: number; succeeded: number; failed: { path: string; error: string }[] }

async function readBatchResponse(response: Response, expectedPaths: string[]): Promise<BatchResponse> {
  if ((!response.ok && response.status !== 422) || !response.body) throw remoteFailure();
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BATCH_RESPONSE_BYTES) throw remoteFailure();
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let result: BatchResponse;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as BatchResponse; }
  catch { throw remoteFailure(); }
  const expected = new Set(expectedPaths);
  if (!result || typeof result.success !== 'boolean' || result.processed !== expectedPaths.length
    || !Number.isInteger(result.succeeded) || result.succeeded < 0 || !Array.isArray(result.failed)
    || result.succeeded + result.failed.length !== result.processed
    || result.success !== (result.failed.length === 0) || (response.status === 422 && result.success)
    || result.failed.some(entry => !entry || !expected.has(entry.path) || typeof entry.error !== 'string')
    || new Set(result.failed.map(entry => entry.path)).size !== result.failed.length) throw remoteFailure();
  return result;
}

/**
 * Direct HF requests only. The shared abort signal also reaches Xet shard calls where the SDK
 * currently omits CommitParams.abortSignal. Redirects are refused rather than forwarding a token
 * to a redirect destination; these Hub/CAS API operations have no legitimate redirect requirement.
 */
export function huggingFaceFetch(input: {
  signal: AbortSignal;
  token: string;
  fetchImpl?: typeof fetch;
  upload?: { bucket: string; path: string; mimeType: string };
  beforePublish?: () => Promise<void>;
}): typeof fetch {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  return async (resource, options) => {
    input.signal.throwIfAborted();
    const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
    if (!allowedHubUrl(url)) throw remoteFailure();
    const inherited = resource instanceof Request ? resource : undefined;
    const headers = new Headers(options?.headers ?? inherited?.headers);
    if (headers.get('authorization') === `Bearer ${input.token}` && url.origin !== HUB_ORIGIN) throw remoteFailure();
    const signals = [input.signal, options?.signal, inherited?.signal].filter((item): item is AbortSignal => !!item);
    const prepared: RequestInit = { ...options, headers, signal: AbortSignal.any(signals), redirect: 'error' };
    const uploadBatch = input.upload && url.origin === HUB_ORIGIN && url.pathname === `/api/buckets/${input.upload.bucket}/batch`
      && (options?.method ?? inherited?.method ?? 'GET').toUpperCase() === 'POST';
    if (uploadBatch) {
      if (typeof options?.body !== 'string') throw remoteFailure();
      let operations: Record<string, unknown>[];
      try { operations = options.body.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>); }
      catch { throw remoteFailure(); }
      if (operations.length !== 1 || operations[0].type !== 'addFile' || operations[0].path !== input.upload!.path) throw remoteFailure();
      // Hub accepts contentType on addFile; SDK 2.17 currently omits Blob.type in its publication step.
      prepared.body = JSON.stringify({ ...operations[0], contentType: input.upload!.mimeType });
      await input.beforePublish?.();
      prepared.signal?.throwIfAborted();
    }
    const response = await fetchImpl(resource, prepared);
    if (uploadBatch) {
      const result = await readBatchResponse(response, [input.upload!.path]);
      if (!result.success) throw remoteFailure();
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('content-length');
      return new Response(JSON.stringify(result), { status: response.status, headers: responseHeaders });
    }
    return response;
  };
}

function objectOf(value: { path: string; type: string; size: number; uploadedAt?: string; xetHash?: string }): BucketObject {
  return {
    path: value.path, size: value.size,
    type: value.type === 'file' || value.type === 'directory' ? value.type : 'unknown',
    ...(typeof value.uploadedAt === 'string' ? { uploadedAt: value.uploadedAt } : {}),
    ...(typeof value.xetHash === 'string' ? { xetHash: value.xetHash } : {}),
  };
}

export class HuggingFaceDownloadBucket implements DownloadBucket {
  constructor(public readonly id: string, private readonly token: string, private readonly fetchImpl: typeof fetch = globalThis.fetch) {
    validateDownloadBucket(id, 'alvin3y12/data');
    if (!token || /[\r\n]/.test(token)) throw new HttpError(503, 'The download bucket secret is not configured.', 'DOWNLOADS_UNAVAILABLE');
  }

  private request(signal: AbortSignal): typeof fetch { return huggingFaceFetch({ signal, token: this.token, fetchImpl: this.fetchImpl }); }

  async *list(signal: AbortSignal): AsyncIterable<BucketObject> {
    for await (const entry of listFiles({
      repo: { type: 'bucket', name: this.id }, accessToken: this.token, recursive: true, expand: true, fetch: this.request(signal),
    })) {
      signal.throwIfAborted();
      yield objectOf(entry);
    }
  }

  async get(objectPath: string, signal: AbortSignal): Promise<BucketObject | undefined> {
    return (await this.getMany([objectPath], signal))[0];
  }

  async getMany(objectPaths: string[], signal: AbortSignal): Promise<BucketObject[]> {
    if (objectPaths.length > 100 || objectPaths.some(item => !validObjectPath(item))) throw remoteFailure();
    if (objectPaths.length === 0) return [];
    const entries = await pathsInfo({
      repo: { type: 'bucket', name: this.id }, paths: objectPaths, expand: true,
      accessToken: this.token, fetch: this.request(signal),
    });
    const expected = new Set(objectPaths);
    if (new Set(entries.map(item => item.path)).size !== entries.length || entries.some(item => !expected.has(item.path))) throw remoteFailure();
    return entries.map(objectOf);
  }

  async upload(input: Parameters<DownloadBucket['upload']>[0]): Promise<BucketObject> {
    input.signal.throwIfAborted();
    if (!validObjectPath(input.objectPath)) throw remoteFailure();
    const content = await openAsBlob(input.snapshotPath, { type: input.mimeType });
    if (content.size !== input.size) throw new HttpError(409, 'The temporary download changed. Prepare the file again.', 'DOWNLOAD_FILE_CHANGED');
    const request = huggingFaceFetch({
      signal: input.signal, token: this.token, fetchImpl: this.fetchImpl,
      upload: { bucket: this.id, path: input.objectPath, mimeType: input.mimeType },
      beforePublish: input.beforePublish,
    });
    for await (const event of commitIter({
      repo: { type: 'bucket', name: this.id }, accessToken: this.token,
      title: 'Prepare a workspace file download', operations: [{ operation: 'addOrUpdate', path: input.objectPath, content }],
      abortSignal: input.signal, fetch: request,
    })) {
      input.signal.throwIfAborted();
      if (event.event === 'fileProgress') {
        if (event.state === 'error') throw remoteFailure();
        if (event.state === 'uploading' && Number.isFinite(event.progress)) input.onProgress(Math.floor(Math.max(0, Math.min(1, event.progress)) * input.size));
      }
    }
    input.signal.throwIfAborted();
    const uploaded = await this.get(input.objectPath, input.signal);
    if (!uploaded || uploaded.type !== 'file' || uploaded.size !== input.size) throw remoteFailure();
    return uploaded;
  }

  async delete(objectPaths: string[], signal: AbortSignal): Promise<BucketDeleteResult> {
    if (objectPaths.length === 0) return { deleted: [], failed: [] };
    if (objectPaths.length > 100 || new Set(objectPaths).size !== objectPaths.length || objectPaths.some(item => !validObjectPath(item))) throw remoteFailure();
    const response = await this.request(signal)(`${HUB_ORIGIN}/api/buckets/${this.id}/batch`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/x-ndjson' },
      body: objectPaths.map(item => JSON.stringify({ type: 'deleteFile', path: item })).join('\n'),
    });
    const result = await readBatchResponse(response, objectPaths);
    const failed = new Set(result.failed.map(entry => entry.path));
    // A previous partial attempt may already have deleted a path. Missing is a successful final state.
    for (const objectPath of failed) {
      try { if (!await this.get(objectPath, signal)) failed.delete(objectPath); }
      catch { /* Keep it failed until a later complete scan can confirm its state. */ }
    }
    return { deleted: objectPaths.filter(item => !failed.has(item)), failed: [...failed] };
  }
}
