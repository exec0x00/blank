import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileAttachment, FileAttachmentUploadJob, UploadCapability } from '../shared/types';
import { ApiError } from '../client/api';
import { FILE_ATTACHMENT_LIMITS, uploadFileAttachment, validFileAttachment, type FileAttachmentProgress } from '../client/components/chat/file-attachment-transfer';
import type { UploadWorkerEvent, UploadWorkerRequest } from '../client/uploads.worker';

const transport = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/api', async original => ({ ...await original<typeof import('../client/api')>(), api: transport.api }));
const xetHash = 'a'.repeat(64), sha256 = 'b'.repeat(64);
const capability: UploadCapability = { accessToken: 'temporary-chat-test-capability-only', casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(Date.now() / 1000) + 900 };

/** Only the external worker boundary is controlled; the upload state machine runs. */
class WorkerFixture {
  static instances: WorkerFixture[] = [];
  static start: (worker: WorkerFixture, request: Extract<UploadWorkerRequest, { type: 'start' }>) => void;
  static supplied: (worker: WorkerFixture) => void;
  listeners = new Map<string, Array<(event: MessageEvent<UploadWorkerEvent>) => void>>();
  messages: UploadWorkerRequest[] = [];
  terminate = vi.fn();
  constructor(readonly url: URL, readonly options: WorkerOptions) { WorkerFixture.instances.push(this); }
  addEventListener(type: string, callback: (event: MessageEvent<UploadWorkerEvent>) => void) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
  postMessage(request: UploadWorkerRequest) {
    this.messages.push(request);
    if (request.type === 'start') WorkerFixture.start(this, request);
    else WorkerFixture.supplied(this);
  }
  emit(data: UploadWorkerEvent) { for (const callback of this.listeners.get('message') || []) callback({ data } as MessageEvent<UploadWorkerEvent>); }
}

function job(index = 0, input = { name: 'notes.txt', size: 5, mimeType: 'text/plain' }): FileAttachmentUploadJob {
  const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  return { id, workspaceId: 'workspace-a', ...input, state: 'reserved', bucket: 'alvin3y12/codex-downloads', objectPath: `imports/${id}/staged-file`, bytesProcessed: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sessionExpiresAt: new Date(Date.now() + 1_800_000).toISOString() };
}
function saved(value: FileAttachmentUploadJob): FileAttachmentUploadJob {
  return { ...value, state: 'ready', bytesProcessed: value.size, attachment: { id: `file_${value.id.replaceAll('-', '')}`, workspaceId: value.workspaceId,
    name: value.name, bytes: value.size, mimeType: value.mimeType, sha256, createdAt: value.createdAt } };
}
function fixture(prior?: FileAttachmentUploadJob) {
  const jobs = new Map<string, FileAttachmentUploadJob>(prior ? [[prior.id, prior]] : []);
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const controls: {
    reserve?: (value: FileAttachmentUploadJob) => FileAttachmentUploadJob;
    complete?: (value: FileAttachmentUploadJob) => FileAttachmentUploadJob | Promise<FileAttachmentUploadJob>;
    read?: (value: FileAttachmentUploadJob) => FileAttachmentUploadJob | Promise<FileAttachmentUploadJob>;
    cancel?: (value: FileAttachmentUploadJob) => FileAttachmentUploadJob | Promise<FileAttachmentUploadJob>;
  } = {};
  transport.api.mockImplementation(async (path: string, options: RequestInit = {}) => {
    const method = options.method || 'GET', body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    calls.push({ path, method, body });
    if (path === '/workspaces/workspace-a/file-attachments/uploads') {
      let value = job(jobs.size, body); if (controls.reserve) value = controls.reserve(value);
      jobs.set(value.id, value); return value;
    }
    const match = /^\/file-attachment-uploads\/([^/]+)(\/capability|\/complete)?$/.exec(path);
    if (!match) throw new Error(`Unexpected fixture request ${method} ${path}`);
    const value = jobs.get(match[1])!;
    if (match[2] === '/capability') return capability;
    if (match[2] === '/complete') {
      expect(body).toEqual({ xetHash, sha256 });
      const next = controls.complete ? await controls.complete(value) : saved(value); jobs.set(next.id, next); return next;
    }
    if (method === 'DELETE') {
      const next = controls.cancel ? await controls.cancel(value) : { ...value, state: 'cancelled' as const }; jobs.set(next.id, next); return next;
    }
    return controls.read ? controls.read(value) : value;
  });
  return { calls, controls, jobs };
}

beforeEach(() => {
  transport.api.mockReset(); WorkerFixture.instances = [];
  WorkerFixture.start = worker => worker.emit({ type: 'capability', requestId: 1 });
  WorkerFixture.supplied = worker => { worker.emit({ type: 'progress', stage: 'uploading', bytesUploaded: 2 }); worker.emit({ type: 'complete', xetHash, sha256 }); };
  vi.stubGlobal('Worker', WorkerFixture);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('general chat attachments use direct verified uploads', () => {
  it('sends metadata only to the app, transfers the actual File to the HF worker, and keeps capabilities out of progress', async () => {
    const app = fixture(), updates: FileAttachmentProgress[] = [];
    const file = new File(['hello'], 'café 你好.txt', { type: 'text/plain' });
    const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file, onProgress: value => updates.push(value) });
    expect(result.stage).toBe('ready');
    expect(result.attachment).toMatchObject({ name: file.name, bytes: file.size, sha256 });
    expect(app.calls.filter(call => call.method === 'POST').map(call => call.body)).toEqual([{ name: file.name, size: file.size, mimeType: file.type }, undefined, { xetHash, sha256 }]);
    expect(app.calls.every(call => !(call.body instanceof Blob))).toBe(true);
    expect(WorkerFixture.instances[0].messages[0]).toMatchObject({ type: 'start', file, bucket: 'alvin3y12/codex-downloads' });
    expect(WorkerFixture.instances[0].url.pathname).toContain('/client/uploads.worker.ts');
    expect(WorkerFixture.instances[0].terminate).toHaveBeenCalledOnce();
    expect(updates.find(value => value.stage === 'uploading')?.bytesUploaded).toBe(2);
    expect(updates.filter(value => value.stage !== 'ready').every(value => !value.attachment)).toBe(true);
    expect(JSON.stringify(updates)).not.toContain(capability.accessToken);
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('does not enable an attachment merely because the browser finished transferring its bytes', async () => {
    vi.useFakeTimers();
    const app = fixture(), updates: FileAttachmentProgress[] = [];
    let committed = false;
    app.controls.complete = value => ({ ...value, state: 'importing', bytesProcessed: 2 });
    app.controls.read = value => committed ? saved(value) : value;
    const pending = uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt'), onProgress: value => updates.push(value) });
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.at(-1)).toMatchObject({ stage: 'importing', bytesUploaded: 5, bytesImported: 2 });
    expect(updates.at(-1)?.attachment).toBeUndefined();
    committed = true; await vi.advanceTimersByTimeAsync(700);
    expect((await pending).stage).toBe('ready');
  });

  it('rejects oversized, traversal, and reserved names before requesting a reservation', async () => {
    const app = fixture();
    const large = new File(['x'], 'large.bin'); Object.defineProperty(large, 'size', { value: FILE_ATTACHMENT_LIMITS.fileBytes + 1 });
    for (const file of [large, new File(['x'], '../outside.txt'), new File(['x'], '.codex-write-internal')]) {
      await expect(uploadFileAttachment({ workspaceId: 'workspace-a', file })).rejects.toThrow();
    }
    expect(app.calls).toEqual([]); expect(WorkerFixture.instances).toEqual([]);
  });

  it('rejects a workspace, bucket, or object-path mismatch before starting a worker', async () => {
    for (const patch of [{ workspaceId: 'workspace-b' }, { bucket: 'outside/bucket' }, { objectPath: 'imports/other/file' }]) {
      const app = fixture(); app.controls.reserve = value => ({ ...value, ...patch });
      const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt') });
      expect(result.stage).toBe('failed'); expect(result.attachment).toBeUndefined();
    }
    expect(WorkerFixture.instances).toEqual([]);
  });

  it('reconciles an interrupted draft that already committed without uploading it again', async () => {
    const previous = job(), app = fixture(saved(previous));
    const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt'), previousJob: previous, expectedSha256: sha256 });
    expect(result.stage).toBe('ready'); expect(result.attachment?.sha256).toBe(sha256);
    expect(app.calls.map(call => call.method)).toEqual(['GET']); expect(WorkerFixture.instances).toEqual([]);
  });

  it('can retry a local file after its old reservation expired without treating it as an attachment', async () => {
    const previous = job(), app = fixture(previous);
    app.controls.read = value => { if (value.id === previous.id) throw new ApiError('Expired', 410); return value; };
    const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt'), previousJob: previous });
    expect(result.stage).toBe('ready'); expect(result.job?.id).not.toBe(previous.id); expect(WorkerFixture.instances).toHaveLength(1);
    expect(app.calls.filter(call => call.path.endsWith('/file-attachments/uploads'))).toHaveLength(1);
  });

  it('reconciles a lost completion response with the same reservation and no second transfer', async () => {
    const app = fixture();
    app.controls.complete = value => { app.jobs.set(value.id, saved(value)); throw new TypeError('Response lost'); };
    const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt') });
    expect(result.stage).toBe('ready'); expect(WorkerFixture.instances).toHaveLength(1);
    expect(app.calls.filter(call => call.path.endsWith('/complete'))).toHaveLength(1);
    expect(app.calls.some(call => call.method === 'DELETE')).toBe(false);
  });

  it('terminates the worker on abort and cancels its reservation without finalizing', async () => {
    const app = fixture(), controller = new AbortController();
    WorkerFixture.start = () => controller.abort();
    const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt'), signal: controller.signal });
    expect(result.stage).toBe('cancelled'); expect(result.attachment).toBeUndefined();
    expect(WorkerFixture.instances[0].terminate).toHaveBeenCalledOnce();
    expect(app.calls.some(call => call.method === 'DELETE')).toBe(true);
    expect(app.calls.some(call => call.path.endsWith('/complete'))).toBe(false);
  });

  it('reports a real commit when saving finishes before cancellation', async () => {
    const app = fixture(), controller = new AbortController();
    app.controls.complete = async () => { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); };
    app.controls.cancel = value => saved(value);
    const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt'), signal: controller.signal });
    expect(result.stage).toBe('ready'); expect(result.attachment).toBeDefined(); expect(result.notice).toContain('before cancellation');
  });

  it('keeps uncertain finalization blocked instead of offering a sendable reference', async () => {
    const app = fixture();
    app.controls.complete = () => { throw new TypeError('Response lost'); };
    app.controls.read = () => { throw new TypeError('Connection unavailable'); };
    app.controls.cancel = () => { throw new ApiError('Unavailable', 503); };
    const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt') });
    expect(result.stage).toBe('unconfirmed'); expect(result.attachment).toBeUndefined(); expect(result.error).toContain('Check its status');
  });

  it('refuses a committed descriptor with different bytes, digest, or workspace', async () => {
    for (const patch of [{ bytes: 4 }, { sha256: 'c'.repeat(64) }, { workspaceId: 'workspace-b' }]) {
      const app = fixture(); app.controls.complete = value => { const next = saved(value); return { ...next, attachment: { ...next.attachment!, ...patch } }; };
      const result = await uploadFileAttachment({ workspaceId: 'workspace-a', file: new File(['hello'], 'notes.txt') });
      expect(result.stage).not.toBe('ready'); expect(result.attachment).toBeUndefined();
    }
    const valid = saved(job()).attachment as FileAttachment;
    expect(validFileAttachment(valid, 'workspace-a')).toBe(true);
    expect(validFileAttachment({ ...valid, id: 'att_image' }, 'workspace-a')).toBe(false);
  });
});
