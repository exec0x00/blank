export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError'; }
}

export function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

export interface ApiRequestOptions extends RequestInit { timeoutMs?: number }
const READ_TIMEOUT_MS = 30_000;

async function request<T>(path: string, options: RequestInit): Promise<T> {
  options.signal?.throwIfAborted();
  const headers = new Headers(options.headers);
  headers.set('X-Codex-Workspace', '1');
  const response = await fetch(`/api${path.startsWith('/') ? path : '/' + path}`, {
    ...options,
    credentials: 'same-origin',
    headers,
  });
  if (options.signal?.aborted) {
    // A transport wrapper can ignore AbortSignal and deliver headers after the
    // caller has already left. Discard its unread body so the connection does
    // not remain open; cleanup must not delay or replace the original abort.
    try { void response.body?.cancel(options.signal.reason).catch(() => undefined); }
    catch { /* A wrapper may already own or have closed this response body. */ }
  }
  options.signal?.throwIfAborted();
  let body: unknown;
  if (response.status !== 204) {
    try { body = await response.json(); }
    catch {
      options.signal?.throwIfAborted();
      if (response.ok) throw new ApiError('The workspace returned an unreadable response. The result could not be confirmed.', response.status, 'INVALID_RESPONSE');
    }
  }
  options.signal?.throwIfAborted();
  if (!response.ok) {
    const detail = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    if (response.status === 401 && detail.code === 'AUTH_REQUIRED' && !path.startsWith('/session')) window.dispatchEvent(new CustomEvent('codex:session-expired'));
    throw new ApiError(typeof detail.error === 'string' ? detail.error : `Request failed (${response.status}).`, response.status, typeof detail.code === 'string' ? detail.code : undefined);
  }
  return body as T;
}

export async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { timeoutMs: requestedTimeout, ...input } = options;
  const read = ['GET', 'HEAD'].includes((input.method ?? 'GET').toUpperCase());
  const timeoutMs = requestedTimeout ?? (read ? READ_TIMEOUT_MS : undefined);
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)) {
    throw new RangeError('The request timeout must be between 1 and 300000 milliseconds.');
  }
  const controller = timeoutMs === undefined ? undefined : new AbortController();
  const signal = controller?.signal ?? input.signal;
  const cancel = () => controller?.abort(input.signal?.reason);
  if (controller && input.signal) {
    if (input.signal.aborted) cancel();
    else input.signal.addEventListener('abort', cancel, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    if (!signal) return await request<T>(path, input);
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new DOMException('The request was cancelled.', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    if (timeoutMs !== undefined) timer = setTimeout(() => controller!.abort(new ApiError(read
      ? 'The workspace is taking too long to respond. Check your connection and try again.'
      : 'The server did not respond in time. The result is unconfirmed.', 0, 'REQUEST_TIMEOUT')), timeoutMs);
    // A deadline covers both headers and the response body. Abort also stops
    // the browser fetch; no request, including a mutation, is retried here.
    return await Promise.race([request<T>(path, { ...input, signal }), aborted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (controller && input.signal) input.signal.removeEventListener('abort', cancel);
  }
}
