import { listFiles } from '@huggingface/hub';
import { HttpError } from '../errors';
import { HuggingFaceDownloadBucket, PUBLIC_DOWNLOAD_BUCKET, publicDownloadUrl, validateDownloadBucket } from '../downloads/bucket';
import type { BucketObject } from '../downloads/types';
import { MAX_UPLOAD_BYTES } from '../workspaces';
import type { UploadBucket, UploadCapability } from './types';
import { CONTENT_HASH, UPLOAD_ID, validUploadObjectPath } from './validation';

const HUB_ORIGIN = 'https://huggingface.co';
const DIRECT_CAS_ORIGIN = 'https://cas-server-direct.xethub.hf.co';
export const PUBLIC_CAS_ORIGIN = 'https://cas-server.xethub.hf.co';
const CAS_ORIGINS = new Set([DIRECT_CAS_ORIGIN, PUBLIC_CAS_ORIGIN]);
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_CAPABILITY_BYTES = 32 * 1024;
export const MAX_CAPABILITY_LIFETIME_MS = 20 * 60 * 1000;

export function uploadRemoteFailure(): HttpError {
  // Never forward provider bodies, signed URLs, headers or credential-bearing exception text.
  return new HttpError(502, 'Hugging Face could not complete this upload. Try again shortly.', 'UPLOAD_BUCKET_REQUEST_FAILED');
}

export function validateUploadCapability(value: unknown, now: number, writerToken?: string): UploadCapability {
  if (!value || typeof value !== 'object') throw uploadRemoteFailure();
  const { accessToken, casUrl, exp } = value as UploadCapability;
  if (typeof accessToken !== 'string' || accessToken.length > 16_384 || accessToken.startsWith('hf_')
    || accessToken === writerToken || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
    || !Number.isSafeInteger(exp) || exp * 1000 <= now + 60_000 || exp * 1000 > now + MAX_CAPABILITY_LIFETIME_MS
    || typeof casUrl !== 'string') throw uploadRemoteFailure();
  let url: URL;
  try { url = new URL(casUrl); } catch { throw uploadRemoteFailure(); }
  if (!CAS_ORIGINS.has(url.origin) || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (casUrl !== url.origin && casUrl !== `${url.origin}/`)) throw uploadRemoteFailure();
  // The provider's known direct alias resolves to private addresses in the deployed browser
  // environment. Only after validating the original capability, use HF's documented public
  // CAS service for that one alias. Preserve the provider-issued bearer token and expiry.
  // This never accepts an arbitrary replacement URL or changes browser network protections.
  const browserCasUrl = url.origin === DIRECT_CAS_ORIGIN ? PUBLIC_CAS_ORIGIN : url.origin;
  return { accessToken, casUrl: browserCasUrl, exp };
}

export async function boundedResponseBytes(response: Response, maximum: number, signal: AbortSignal, onProgress?: (bytes: number) => void): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel().catch(() => undefined);
    throw uploadRemoteFailure();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) throw uploadRemoteFailure();
      chunks.push(Buffer.from(part.value));
      onProgress?.(length);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks, length);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function allowedPublicUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
    && (url.hostname === 'huggingface.co' || url.hostname.endsWith('.huggingface.co') || url.hostname.endsWith('.hf.co'));
}

/** Native HF Xet: browser CAS capability, server-only bucket publication, public immutable-byte read. */
export class HuggingFaceUploadBucket implements UploadBucket {
  private readonly metadata: HuggingFaceDownloadBucket;
  private readonly endpoint: string;

  constructor(
    public readonly id: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {
    validateDownloadBucket(id, 'alvin3y12/data');
    if (!token || /\s/.test(token)) throw new HttpError(503, 'The transfer bucket secret is not configured.', 'UPLOADS_UNAVAILABLE');
    this.endpoint = `${HUB_ORIGIN}/api/buckets/${id}`;
    this.metadata = new HuggingFaceDownloadBucket(id, token, this.metadataFetch);
  }

  private metadataFetch: typeof fetch = async (resource, options) => {
    const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
    const method = (options?.method ?? (resource instanceof Request ? resource.method : 'GET')).toUpperCase();
    const allowed = url.origin === HUB_ORIGIN && !url.username && !url.password && !url.hash
      && ((url.pathname === `/api/buckets/${this.id}/paths-info` && method === 'POST')
        || (url.pathname === `/api/buckets/${this.id}/batch` && method === 'POST')
        || (url.pathname === `/api/buckets/${this.id}/tree/imports` && method === 'GET'));
    if (!allowed) throw uploadRemoteFailure();
    const signal = options?.signal ?? (resource instanceof Request ? resource.signal : undefined) ?? AbortSignal.timeout(30_000);
    try {
      const response = await this.fetchImpl(resource, { ...options, credentials: 'omit', redirect: 'error', signal });
      if (response.status === 404 && url.pathname.endsWith('/tree/imports')) {
        await response.body?.cancel().catch(() => undefined);
        return new Response('[]', { headers: { 'content-type': 'application/json' } });
      }
      if (!response.ok && response.status !== 422) {
        await response.body?.cancel().catch(() => undefined);
        throw uploadRemoteFailure();
      }
      const bytes = await boundedResponseBytes(response, MAX_METADATA_BYTES, signal);
      const headers = new Headers(response.headers);
      headers.delete('content-length'); headers.delete('content-encoding');
      return new Response(new Uint8Array(bytes), { status: response.status, headers });
    } catch { throw uploadRemoteFailure(); }
  };

  async capability(sessionId: string, signal: AbortSignal): Promise<UploadCapability> {
    if (!UPLOAD_ID.test(sessionId)) throw uploadRemoteFailure();
    try {
      const response = await this.fetchImpl(`${this.endpoint}/xet-write-token`, {
        method: 'GET', headers: { Authorization: `Bearer ${this.token}`, 'X-Xet-Session-Id': sessionId, Accept: 'application/json' },
        signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw uploadRemoteFailure(); }
      const bytes = await boundedResponseBytes(response, MAX_CAPABILITY_BYTES, signal);
      return validateUploadCapability(JSON.parse(bytes.toString('utf8')), this.now(), this.token);
    } catch { throw uploadRemoteFailure(); }
  }

  async *list(signal: AbortSignal): AsyncIterable<BucketObject> {
    const request: typeof fetch = (resource, options) => this.metadataFetch(resource, { ...options, signal });
    try {
      for await (const object of listFiles({ repo: { type: 'bucket', name: this.id }, path: 'imports', recursive: true, expand: true, accessToken: this.token, fetch: request })) {
        signal.throwIfAborted();
        yield { path: object.path, type: object.type, size: object.size, uploadedAt: object.uploadedAt, xetHash: object.xetHash };
      }
    } catch { throw uploadRemoteFailure(); }
  }

  async get(objectPath: string, signal: AbortSignal): Promise<BucketObject | undefined> {
    if (!validUploadObjectPath(objectPath)) throw uploadRemoteFailure();
    try { return await this.metadata.get(objectPath, signal); }
    catch { throw uploadRemoteFailure(); }
  }

  async publish(input: Parameters<UploadBucket['publish']>[0]): Promise<BucketObject> {
    const { objectPath, xetHash, signal } = input;
    if (!validUploadObjectPath(objectPath) || !CONTENT_HASH.test(xetHash)) throw uploadRemoteFailure();
    const previous = await this.get(objectPath, signal);
    if (previous) {
      if (previous.type !== 'file' || previous.xetHash !== xetHash) {
        throw new HttpError(409, 'The temporary upload path is already occupied. Upload the file again.', 'UPLOAD_STAGE_CONFLICT');
      }
      return previous;
    }
    try {
      const response = await this.metadataFetch(`${this.endpoint}/batch`, {
        method: 'POST', signal, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/x-ndjson' },
        // Files are data during staging. Do not publish untrusted HTML/SVG as active public documents.
        body: JSON.stringify({ type: 'addFile', path: objectPath, xetHash, contentType: 'application/octet-stream' }),
      });
      const result = await response.json();
      if (!response.ok || result?.success !== true || result.processed !== 1 || result.succeeded !== 1
        || !Array.isArray(result.failed) || result.failed.length !== 0) throw uploadRemoteFailure();
      const object = await this.get(objectPath, signal);
      if (!object || object.type !== 'file' || object.xetHash !== xetHash) throw uploadRemoteFailure();
      return object;
    } catch { throw uploadRemoteFailure(); }
  }

  async read(input: Parameters<UploadBucket['read']>[0]): Promise<Buffer> {
    if (!validUploadObjectPath(input.objectPath) || !CONTENT_HASH.test(input.xetHash)
      || !Number.isSafeInteger(input.size) || input.size < 0 || input.size > MAX_UPLOAD_BYTES) throw uploadRemoteFailure();
    let url = new URL(publicDownloadUrl(PUBLIC_DOWNLOAD_BUCKET, input.objectPath));
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (!allowedPublicUrl(url)) throw uploadRemoteFailure();
        input.signal.throwIfAborted();
        const response = await this.fetchImpl(url, {
          method: 'GET', headers: { Accept: 'application/octet-stream' }, signal: input.signal,
          credentials: 'omit', redirect: 'manual', cache: 'no-store',
        });
        const returnedHash = response.headers.get('x-xet-hash');
        if (returnedHash && returnedHash !== input.xetHash) {
          await response.body?.cancel().catch(() => undefined);
          throw uploadRemoteFailure();
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => undefined);
          if (!location || location.length > 16_384) throw uploadRemoteFailure();
          url = new URL(location, url);
          continue;
        }
        if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); throw uploadRemoteFailure(); }
        const bytes = await boundedResponseBytes(response, input.size, input.signal, input.onProgress);
        if (bytes.length !== input.size) throw uploadRemoteFailure();
        return bytes;
      }
      throw uploadRemoteFailure();
    } catch { throw uploadRemoteFailure(); }
  }

  async delete(objectPaths: string[], signal: AbortSignal) {
    if (objectPaths.some(objectPath => !validUploadObjectPath(objectPath))) throw uploadRemoteFailure();
    try { return await this.metadata.delete(objectPaths, signal); }
    catch { throw uploadRemoteFailure(); }
  }
}
