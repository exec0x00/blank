import { commitIter } from '@huggingface/hub';
import type { UploadCapability } from '../shared/types';

const TRANSFER_BUCKET = 'alvin3y12/codex-downloads';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CAS_PAYLOAD_BYTES = 65 * 1024 * 1024;
const CAS_ORIGINS = new Set(['https://cas-server-direct.xethub.hf.co', 'https://cas-server.xethub.hf.co']);
const HASH = /^[a-f0-9]{64}$/;

export interface UploadWorkerInput {
  file: File;
  bucket: string;
  objectPath: string;
  reservationId: string;
}

export interface UploadWorkerResult { xetHash: string; sha256: string }

export type UploadWorkerRequest =
  | ({ type: 'start' } & UploadWorkerInput)
  | { type: 'capability'; requestId: number; capability: UploadCapability };

export type UploadWorkerEvent =
  | { type: 'capability'; requestId: number }
  | { type: 'progress'; stage: 'preparing' | 'uploading'; bytesUploaded: number }
  | ({ type: 'complete' } & UploadWorkerResult)
  | { type: 'error'; code: string; message: string };

export class UploadProtocolError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'UploadProtocolError'; }
}

function protocolError(): never {
  throw new UploadProtocolError('UPLOAD_PROTOCOL_INVALID', 'The transfer service returned an unexpected upload request. No workspace file was saved.');
}

/** Only the provider's short-lived CAS capability may reach the upload SDK. */
export function validateUploadCapability(value: UploadCapability): UploadCapability {
  if (!value || typeof value.accessToken !== 'string' || value.accessToken.length < 16 || value.accessToken.length > 16_384
    || value.accessToken.startsWith('hf_') || !/^[A-Za-z0-9._-]+$/.test(value.accessToken)
    || !Number.isSafeInteger(value.exp) || value.exp * 1000 <= Date.now() + 5_000 || value.exp * 1000 > Date.now() + 60 * 60_000) {
    throw new UploadProtocolError('UPLOAD_CAPABILITY_INVALID', 'Could not obtain a valid temporary upload capability. Try the upload again.');
  }
  let url: URL;
  try { url = new URL(value.casUrl); } catch { return protocolError(); }
  if (!CAS_ORIGINS.has(url.origin) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return protocolError();
  return { accessToken: value.accessToken, casUrl: url.origin, exp: value.exp };
}

function directFailure(status: number): UploadProtocolError {
  if (status === 401 || status === 403) return new UploadProtocolError('UPLOAD_CAPABILITY_REJECTED', 'Hugging Face rejected the temporary upload capability. Try the upload again.');
  if (status === 429) return new UploadProtocolError('UPLOAD_RATE_LIMITED', 'Hugging Face is limiting uploads. Wait a moment, then try again.');
  return new UploadProtocolError('UPLOAD_TRANSFER_FAILED', `Hugging Face could not accept this upload (${status}). No workspace file was saved.`);
}

/**
 * Runs in a fresh worker for every file. The SDK's capability cache and chunking
 * memory therefore disappear on success, failure, cancellation, or workspace change.
 * File bytes only go to the allowlisted CAS service; Hub publication is intercepted.
 */
export async function uploadFileToTransferBucket(input: UploadWorkerInput, options: {
  capability: () => Promise<UploadCapability>;
  progress: (event: Extract<UploadWorkerEvent, { type: 'progress' }>) => void;
  signal: AbortSignal;
  fetch?: typeof fetch;
}): Promise<UploadWorkerResult> {
  const { file, bucket, objectPath, reservationId } = input;
  if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size > MAX_FILE_BYTES
    || bucket !== TRANSFER_BUCKET || !/^[a-f0-9-]{36}$/.test(reservationId)
    || !objectPath.startsWith(`imports/${reservationId}/`) || !/^imports\/[a-f0-9-]{36}\/[^/\\\u0000-\u001f\u007f]+$/.test(objectPath)) return protocolError();

  options.signal.throwIfAborted();
  options.progress({ type: 'progress', stage: 'preparing', bytesUploaded: 0 });
  // The immutable File is bounded before this allocation. SHA-256 independently
  // verifies the bytes the server eventually saves, in addition to the Xet hash.
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  options.signal.throwIfAborted();

  const nativeFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const tokenRoute = `https://huggingface.co/api/buckets/${bucket}/xet-write-token`;
  const publicationRoute = `https://huggingface.co/api/buckets/${bucket}/batch`;
  const metadataReady = new Error('Upload metadata ready for server publication');
  let capability: UploadCapability | undefined;
  let xetHash: string | undefined;
  let failedProgress = false;
  let stage: 'preparing' | 'uploading' = 'preparing';
  let bytesUploaded = 0;

  const controlledFetch: typeof fetch = async (request, init = {}) => {
    options.signal.throwIfAborted();
    const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url);
    const method = (init.method ?? (request instanceof Request ? request.method : 'GET')).toUpperCase();
    const headers = new Headers(init.headers ?? (request instanceof Request ? request.headers : undefined));

    if (url.href === tokenRoute && method === 'GET') {
      if (headers.has('authorization')) return protocolError();
      capability = validateUploadCapability(await options.capability());
      options.signal.throwIfAborted();
      return new Response(JSON.stringify(capability), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    if (url.href === publicationRoute && method === 'POST') {
      if (headers.has('authorization') || typeof init.body !== 'string' || init.body.length > 8192 || failedProgress) return protocolError();
      let lines: unknown[];
      try { lines = init.body.split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return protocolError(); }
      const candidate = lines[0] as Record<string, unknown> | undefined;
      if (lines.length !== 1 || !candidate || candidate.type !== 'addFile' || candidate.path !== objectPath
        || typeof candidate.xetHash !== 'string' || !HASH.test(candidate.xetHash)) return protocolError();
      xetHash = candidate.xetHash;
      // This is deliberately not a successful bucket response: only the server
      // can publish the reserved path and confirm the permanent workspace write.
      throw metadataReady;
    }

    const chunkLookup = method === 'GET' && /^\/v1\/chunks\/default\/[a-f0-9]{64}$/.test(url.pathname);
    const dataUpload = method === 'POST' && (/^\/v1\/xorbs\/default\/[a-f0-9]{64}$/.test(url.pathname) || url.pathname === '/v1/shards');
    if (!capability || !CAS_ORIGINS.has(url.origin) || url.origin !== capability.casUrl || url.username || url.password || url.search || url.hash
      || (!chunkLookup && !dataUpload) || headers.get('authorization') !== `Bearer ${capability.accessToken}`) return protocolError();
    if (dataUpload) {
      const size = init.body instanceof Blob ? init.body.size : init.body instanceof ArrayBuffer ? init.body.byteLength : ArrayBuffer.isView(init.body) ? init.body.byteLength : -1;
      if (size < 0 || size > MAX_CAS_PAYLOAD_BYTES) return protocolError();
    }

    if (dataUpload && stage !== 'uploading') {
      stage = 'uploading';
      options.progress({ type: 'progress', stage, bytesUploaded });
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 120_000);
    options.signal.addEventListener('abort', abort, { once: true });
    let response: Response;
    try {
      response = await nativeFetch(url.href, {
        ...init, headers, method, signal: controller.signal,
        mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
    } catch {
      options.signal.throwIfAborted();
      if (controller.signal.aborted) throw new UploadProtocolError('UPLOAD_TRANSFER_TIMEOUT', 'The direct transfer timed out. Check your connection, then try again.');
      throw new UploadProtocolError('UPLOAD_NETWORK_BLOCKED', 'The browser could not reach Hugging Face for the direct upload. Check your connection and browser restrictions, then try again.');
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', abort);
    }
    options.signal.throwIfAborted();
    // Missing chunks and rate-limited dedup lookups are supported by the SDK;
    // every data upload still has to receive an ordinary successful CORS response.
    if (!response.ok && !(chunkLookup && (response.status === 404 || response.status === 429))) throw directFailure(response.status);
    if (response.type === 'opaque' || response.type === 'opaqueredirect') return protocolError();
    if (chunkLookup && response.ok && response.body) {
      let received = 0;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, stream) {
        received += chunk.byteLength;
        if (received > MAX_CAS_PAYLOAD_BYTES) return protocolError();
        stream.enqueue(chunk);
      } }));
      return new Response(body, { status: response.status, headers: response.headers });
    }
    return response;
  };

  try {
    for await (const event of commitIter({
      repo: { type: 'bucket', name: bucket }, title: '',
      operations: [{ operation: 'addOrUpdate', path: objectPath, content: file }],
      useXet: true, abortSignal: options.signal, fetch: controlledFetch,
    })) {
      options.signal.throwIfAborted();
      if (event.event !== 'fileProgress') continue;
      if (event.path !== objectPath || event.state === 'error') { failedProgress = true; return protocolError(); }
      if (!Number.isFinite(event.progress) || event.progress < 0 || event.progress > 1) return protocolError();
      // The SDK counts acknowledged or deduplicated source bytes, not wire bytes.
      bytesUploaded = Math.max(bytesUploaded, Math.min(file.size, Math.floor(event.progress * file.size)));
      options.progress({ type: 'progress', stage, bytesUploaded });
    }
  } catch (error) {
    options.signal.throwIfAborted();
    if (error === metadataReady && xetHash && !failedProgress) return { xetHash, sha256 };
    if (error instanceof UploadProtocolError) throw error;
    throw new UploadProtocolError('UPLOAD_TRANSFER_FAILED', 'The direct upload could not finish. No workspace file was saved. Try the upload again.');
  }
  return protocolError();
}

type WorkerPort = {
  postMessage: (event: UploadWorkerEvent) => void;
  addEventListener: (name: 'message', callback: (event: MessageEvent<UploadWorkerRequest>) => void) => void;
};

// Importable in focused protocol tests without creating a worker in the test process.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const port = self as unknown as WorkerPort;
  let started = false;
  let nextRequestId = 0;
  const pending = new Map<number, (value: UploadCapability) => void>();
  port.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'capability') {
      const resolve = pending.get(message.requestId);
      pending.delete(message.requestId);
      resolve?.(message.capability);
      return;
    }
    if (message.type !== 'start' || started) return;
    started = true;
    const controller = new AbortController();
    void uploadFileToTransferBucket(message, {
      signal: controller.signal,
      capability: () => new Promise<UploadCapability>(resolve => {
        const requestId = ++nextRequestId;
        pending.set(requestId, resolve);
        port.postMessage({ type: 'capability', requestId });
      }),
      progress: progress => port.postMessage(progress),
    }).then(result => port.postMessage({ type: 'complete', ...result })).catch(error => {
      const failure = error instanceof UploadProtocolError ? error : new UploadProtocolError('UPLOAD_TRANSFER_FAILED', 'The direct upload could not finish. Try the upload again.');
      port.postMessage({ type: 'error', code: failure.code, message: failure.message });
    }).finally(() => pending.clear());
  });
}
