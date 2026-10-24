import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DownloadJob } from '../shared/types';

type Client = typeof import('../client/downloads');
const workspaceId = 'workspace_generated', imageId = `img_${'a'.repeat(64)}`, sha256 = 'b'.repeat(64);
const fileName = 'generated-image-aaaaaaaaaaaa.png', size = 72;
const jobId = '10000000-0000-4000-8000-000000000001', nextJobId = '10000000-0000-4000-8000-000000000002';
const key = 'codex.download-job-ids';
const assetRoute = `/api/workspaces/${workspaceId}/generated-images/${imageId}/download`;
const publicUrl = `https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/exports/${jobId}/${fileName}?download=true`;
const request = () => ({ workspaceId, imageId, sha256, fileName, size });
const source = () => ({ type: 'generated_image' as const, id: imageId, sha256 });
const job = (patch: Partial<DownloadJob> = {}): DownloadJob => ({ id: jobId, workspaceId, path: fileName, fileName, size,
  mimeType: 'image/png', source: source(), state: 'queued', bytesProcessed: 0,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch });
const ready = (patch: Partial<DownloadJob> = {}): DownloadJob => job({ state: 'ready', version: sha256,
  bytesProcessed: size, uploadedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), url: publicUrl, ...patch });

// Browser boundaries only: the real singleton and api/json helpers remain loaded.
class Events {
  static instances: Events[] = [];
  private listeners = new Map<string, Array<(event: { data: string }) => void>>();
  onopen?: () => void;
  onerror?: () => void;
  close = vi.fn();
  constructor(readonly url: string, readonly options: EventSourceInit) { Events.instances.push(this); }
  addEventListener(name: string, listener: (event: { data: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  emit(value: DownloadJob) { for (const listener of this.listeners.get('download') ?? []) listener({ data: JSON.stringify(value) }); }
}
class Anchor {
  href = ''; download = ''; target = ''; rel = ''; referrerPolicy = '';
  click = vi.fn(); remove = vi.fn();
}
let client: Client, browser: EventTarget, cache: Map<string, string>, anchors: Anchor[];
let calls: Array<{ url: string; init: RequestInit }>;
let respond: (url: string, init: RequestInit) => DownloadJob | Promise<DownloadJob>;
const clients: Client[] = [];
const apiCalls = () => calls.filter(call => call.url.startsWith('/api/'));
const bucketCalls = () => calls.filter(call => call.url.startsWith('https://'));
const transfer = () => client.downloads.getSnapshot().transfers[0];
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function loadClient(): Promise<void> {
  vi.resetModules(); browser = new EventTarget(); vi.stubGlobal('window', browser);
  client = await import('../client/downloads'); clients.push(client);
}
beforeEach(async () => {
  cache = new Map(); anchors = []; calls = []; Events.instances = []; respond = () => job();
  vi.stubGlobal('crypto', { randomUUID }); vi.stubGlobal('EventSource', Events);
  vi.stubGlobal('sessionStorage', { getItem: (name: string) => cache.get(name) ?? null, setItem: (name: string, value: string) => { cache.set(name, value); } });
  vi.stubGlobal('document', { body: { appendChild: vi.fn() }, createElement: (tag: string) => {
    expect(tag).toBe('a'); const link = new Anchor(); anchors.push(link); return link;
  } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url.startsWith('https://')) throw new TypeError('Fixture browser blocked the public cross-origin fetch.');
    if (!url.startsWith('/api/')) throw new Error('Unexpected client HTTP boundary.');
    return new Response(JSON.stringify(await respond(url, init)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  await loadClient();
});
afterEach(async () => {
  // Lock every module instance before releasing globals; this closes its SSE,
  // aborts pending requests, and clears its reconnect/object-URL timers.
  for (const loaded of clients.splice(0)) loaded.downloads.setActive(false);
  await settle();
  try { for (const stream of Events.instances) expect(stream.close).toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); }
});

describe('generated image downloads through the actual browser manager', () => {
  it('posts only the pinned hash to the singular asset route and watches the common job stream', async () => {
    const picked = request(); client.downloads.setActive(true); client.startGeneratedImageDownload(picked);
    Object.assign(picked, { imageId: `img_${'d'.repeat(64)}`, sha256: 'e'.repeat(64), fileName: 'changed-after-click.png' });
    await vi.waitFor(() => expect(Events.instances).toHaveLength(1));
    expect(apiCalls()).toHaveLength(1); expect(apiCalls()[0].url).toBe(assetRoute);
    expect(apiCalls()[0].init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(apiCalls()[0].init.body))).toEqual({ sha256 });
    expect(new Headers(apiCalls()[0].init.headers).get('X-Codex-Workspace')).toBe('1');
    expect(Events.instances[0].url).toBe(`/api/downloads/${jobId}/events`);
    expect(Events.instances[0].options).toEqual({ withCredentials: true });
    Events.instances[0].emit(job({ state: 'uploading', bytesProcessed: 17 }));
    expect(transfer()).toMatchObject({ stage: 'preparing', request: { workspaceId, generatedImage: { id: imageId, sha256 } },
      job: { state: 'uploading', bytesProcessed: 17 } });
    expect(JSON.parse(cache.get(key)!)).toEqual([jobId]); expect([...cache.keys()]).toEqual([key]);
    expect(bucketCalls()).toEqual([]); expect(anchors).toEqual([]);
  });

  const mismatches: Array<[string, Partial<DownloadJob>]> = [
    ['missing source', { source: undefined }],
    ['attachment substituted for generated image', { source: { type: 'attachment', id: `file_${'c'.repeat(32)}`, sha256 } }],
    ['another image ID', { source: { ...source(), id: `img_${'d'.repeat(64)}` } }],
    ['another source hash', { source: { ...source(), sha256: 'e'.repeat(64) } }],
    ['another filename', { fileName: 'other.png' }],
    ['another display path', { path: 'other.png' }],
    ['another saved version', { version: 'f'.repeat(64) }],
    ['another byte count', { size: size + 1 }],
  ];
  it.each(mismatches)('rejects an SSE result with %s before reading public bytes', async (_label, patch) => {
    client.downloads.setActive(true); client.startGeneratedImageDownload(request());
    await vi.waitFor(() => expect(Events.instances).toHaveLength(1));
    const stream = Events.instances[0]; stream.emit(ready(patch));
    expect(transfer()).toMatchObject({ stage: 'failed', errorCode: 'DOWNLOAD_SOURCE_INVALID' });
    expect(stream.close).toHaveBeenCalledOnce(); await settle();
    expect(bucketCalls()).toEqual([]); expect(anchors).toEqual([]);
  });

  it('rejects a mismatched initial workspace and a public URL with a different filename', async () => {
    respond = () => ready({ workspaceId: 'workspace_other' });
    client.downloads.setActive(true); client.startGeneratedImageDownload(request());
    await vi.waitFor(() => expect(transfer()?.errorCode).toBe('DOWNLOAD_SOURCE_INVALID'));
    client.downloads.dismiss(transfer().id);
    respond = () => ready({ url: publicUrl.replace(fileName, 'unrelated.png') });
    client.startGeneratedImageDownload(request());
    await vi.waitFor(() => expect(transfer()?.errorCode).toBe('DOWNLOAD_INVALID_URL'));
    expect(transfer().stage).toBe('failed'); expect(bucketCalls()).toEqual([]); expect(anchors).toEqual([]);
    expect(Events.instances).toEqual([]);
  });

  it('recovers authoritative source metadata from cached job IDs and Retry recreates the same asset route', async () => {
    const expired = job({ state: 'expired', version: sha256, error: { code: 'DOWNLOAD_EXPIRED', message: 'Prepare this original again.' } });
    respond = () => expired;
    client.downloads.setActive(true); client.startGeneratedImageDownload(request());
    await vi.waitFor(() => expect(transfer()?.stage).toBe('expired'));
    expect(JSON.parse(cache.get(key)!)).toEqual([jobId]);
    client.downloads.setActive(false); await loadClient();
    respond = (url, init) => init.method === 'POST' ? job({ id: nextJobId }) : (() => {
      expect(url).toBe(`/api/downloads/${jobId}`); return expired;
    })();
    client.downloads.setActive(true);
    await vi.waitFor(() => expect(transfer()?.stage).toBe('expired'));
    expect(transfer().request.generatedImage).toEqual({ id: imageId, sha256 });
    expect(transfer().request.attachment).toBeUndefined(); expect(bucketCalls()).toEqual([]);
    client.downloads.retry(transfer().id);
    await vi.waitFor(() => expect(transfer()?.job?.id).toBe(nextJobId));
    expect(apiCalls().map(call => call.url)).toEqual([assetRoute, `/api/downloads/${jobId}`, assetRoute]);
    expect(JSON.parse(String(apiCalls().at(-1)!.init.body))).toEqual({ sha256 });
    expect(Events.instances.at(-1)?.url).toBe(`/api/downloads/${nextJobId}/events`);
    expect(JSON.parse(cache.get(key)!)).toEqual([nextJobId]);
  });

  it('does not submit while inactive or after locking on the original click stack', async () => {
    client.startGeneratedImageDownload(request()); await settle();
    expect(calls).toEqual([]); expect(client.downloads.getSnapshot().transfers).toEqual([]);
    client.downloads.setActive(true); client.startGeneratedImageDownload(request());
    browser.dispatchEvent(new Event('codex:session-locked')); await settle();
    expect(client.downloads.getSnapshot().active).toBe(false); expect(transfer().stage).toBe('cancelled');
    client.startGeneratedImageDownload(request()); client.downloads.retry(transfer().id); await settle();
    expect(calls).toEqual([]); expect(Events.instances).toEqual([]); expect(anchors).toEqual([]);
  });

  it('keeps the established workspace and general attachment download routes unchanged', async () => {
    const attachmentId = `file_${'c'.repeat(32)}`, attachmentRoute = `/api/workspaces/${workspaceId}/file-attachments/${attachmentId}/downloads`;
    const workspaceRoute = `/api/workspaces/${workspaceId}/downloads`;
    respond = url => url === attachmentRoute
      ? job({ id: nextJobId, source: { type: 'attachment', id: attachmentId, sha256 }, path: 'archive.bin', fileName: 'archive.bin', size: 4 })
      : job({ source: undefined, path: 'folder/notes.txt', fileName: 'notes.txt', size: 4 });
    client.downloads.setActive(true);
    client.startWorkspaceDownload({ workspaceId, path: 'folder/notes.txt', expectedVersion: sha256, size: 4 });
    client.startAttachmentDownload({ workspaceId, attachmentId, sha256, fileName: 'archive.bin', size: 4 });
    await vi.waitFor(() => expect(Events.instances).toHaveLength(2));
    expect(apiCalls().map(call => ({ url: call.url, body: JSON.parse(String(call.init.body)) }))).toEqual([
      { url: workspaceRoute, body: { path: 'folder/notes.txt', expectedVersion: sha256 } }, { url: attachmentRoute, body: { sha256 } },
    ]);
    expect(client.downloads.getSnapshot().transfers.every(item => item.stage === 'preparing')).toBe(true);
    expect(bucketCalls()).toEqual([]);
  });

  it('uses a native link when CORS blocks a valid reused object and keeps Download file usable', async () => {
    // Equal immutable exports may reuse an older job's object. Its filename must
    // match, while the public object's job UUID need not equal the new job UUID.
    respond = () => ready({ id: nextJobId });
    client.downloads.setActive(true); client.startGeneratedImageDownload(request());
    await vi.waitFor(() => expect(transfer()?.stage).toBe('started'));
    expect(transfer()).toMatchObject({ delivery: 'native', job: { id: nextJobId, source: source() }, notice: expect.stringContaining('Download requested') });
    expect(transfer().notice).not.toContain('Saved'); expect(client.publicDownloadUrl(transfer().job)).toBe(publicUrl);
    expect(bucketCalls()).toHaveLength(1);
    expect(bucketCalls()[0]).toMatchObject({ url: publicUrl, init: { credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer' } });
    expect(anchors).toHaveLength(1); expect(anchors[0]).toMatchObject({ href: publicUrl, download: fileName, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' });
    expect(anchors[0].click).toHaveBeenCalledOnce(); expect(anchors[0].remove).toHaveBeenCalledOnce();
    client.downloads.saveAgain(transfer().id);
    expect(anchors).toHaveLength(2); expect(anchors[1].href).toBe(publicUrl); expect(anchors[1].click).toHaveBeenCalledOnce();
    expect(apiCalls()).toHaveLength(1); expect(bucketCalls()).toHaveLength(1);
  });
});
