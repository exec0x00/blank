import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadCapability, UploadJob, UploadServiceStatus } from '../shared/types';
import { ApiError } from '../client/api';
import { MAX_WORKSPACE_FOLDER_UPLOAD_FILES, MAX_WORKSPACE_UPLOAD_BYTES, MAX_WORKSPACE_UPLOAD_FILES, MAX_WORKSPACE_UPLOAD_TOTAL_BYTES, WorkspaceUploadError, uploadWorkspaceFiles, type WorkspaceUploadProgress } from '../client/uploads';
import type { UploadWorkerEvent, UploadWorkerRequest } from '../client/uploads.worker';

const transport = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/api', async importOriginal => ({ ...await importOriginal<typeof import('../client/api')>(), api: transport.api }));

const xetHash = 'a'.repeat(64);
const sha256 = 'b'.repeat(64);
const capability: UploadCapability = { accessToken: 'temporary-test-capability-only', casUrl: 'https://cas-server-direct.xethub.hf.co', exp: Math.floor(Date.now() / 1000) + 900 };
const status: UploadServiceStatus = { enabled: true, ready: true, state: 'ready', bucket: 'alvin3y12/codex-downloads', maxFileBytes: MAX_WORKSPACE_UPLOAD_BYTES, maxActiveSessions: 8, maxConcurrency: 2, sessionTtlMs: 1_800_000, unknownTimestampCount: 0 };

class UploadWorkerFixture {
  static instances: UploadWorkerFixture[] = [];
  static start: (worker: UploadWorkerFixture, input: Extract<UploadWorkerRequest, { type: 'start' }>) => void;
  static supplied: (worker: UploadWorkerFixture, input: Extract<UploadWorkerRequest, { type: 'capability' }>) => void;
  listeners = new Map<string, Array<(event: MessageEvent<UploadWorkerEvent>) => void>>();
  messages: UploadWorkerRequest[] = [];
  terminate = vi.fn();
  constructor(readonly url: URL, readonly options: WorkerOptions) { UploadWorkerFixture.instances.push(this); }
  addEventListener(type: string, callback: (event: MessageEvent<UploadWorkerEvent>) => void) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
  postMessage(message: UploadWorkerRequest) {
    this.messages.push(message);
    if (message.type === 'start') UploadWorkerFixture.start(this, message);
    else UploadWorkerFixture.supplied(this, message);
  }
  emit(message: UploadWorkerEvent) { for (const callback of this.listeners.get('message') || []) callback({ data: message } as MessageEvent<UploadWorkerEvent>); }
}

function makeJob(index: number, input: { path: string; size: number }): UploadJob {
  const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  return { id, workspaceId: 'workspace-a', path: input.path, fileName: input.path.split('/').at(-1)!, size: input.size,
    state: 'reserved', bucket: status.bucket!, objectPath: `imports/${id}/staged-file`, bytesProcessed: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sessionExpiresAt: new Date(Date.now() + status.sessionTtlMs).toISOString() };
}

function saved(job: UploadJob): UploadJob {
  return { ...job, state: 'ready', bytesProcessed: job.size, version: sha256, entry: { name: job.fileName, path: job.path, kind: 'file', size: job.size }, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
}

function fixture() {
  const jobs = new Map<string, UploadJob>();
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const reservations: Array<{ path: string; size: number }> = [];
  const controls: {
    reserve?: (input: { path: string; size: number }) => void;
    complete?: (job: UploadJob) => UploadJob | Promise<UploadJob>;
    read?: (job: UploadJob) => UploadJob | Promise<UploadJob>;
    cancel?: (job: UploadJob) => UploadJob | Promise<UploadJob>;
  } = {};
  transport.api.mockImplementation(async (path: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : init.body;
    calls.push({ path, method, body });
    if (path === '/uploads/status') return status;
    if (path === '/workspaces/workspace-a/uploads') {
      const input = body as { path: string; size: number };
      controls.reserve?.(input);
      reservations.push(input);
      const job = makeJob(jobs.size, input); jobs.set(job.id, job); return job;
    }
    const match = /^\/uploads\/([^/]+)(\/capability|\/complete)?$/.exec(path);
    if (!match) throw new Error(`Unexpected upload fixture request ${method} ${path}`);
    const job = jobs.get(match[1])!;
    if (match[2] === '/capability') return capability;
    if (match[2] === '/complete') {
      expect(body).toEqual({ xetHash, sha256 });
      const next = controls.complete ? await controls.complete(job) : saved(job); jobs.set(job.id, next); return next;
    }
    if (method === 'DELETE') {
      const next = controls.cancel ? await controls.cancel(job) : { ...job, state: 'cancelled' as const }; jobs.set(job.id, next); return next;
    }
    return controls.read ? controls.read(job) : job;
  });
  return { jobs, calls, reservations, controls };
}

beforeEach(() => {
  transport.api.mockReset();
  UploadWorkerFixture.instances = [];
  UploadWorkerFixture.start = worker => worker.emit({ type: 'capability', requestId: 1 });
  UploadWorkerFixture.supplied = worker => { worker.emit({ type: 'progress', stage: 'uploading', bytesUploaded: 1 }); worker.emit({ type: 'complete', xetHash, sha256 }); };
  vi.stubGlobal('Worker', UploadWorkerFixture);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('incoming browser uploads', () => {
  it('sends only reservation and integrity metadata to the app and keeps capabilities out of UI state', async () => {
    const app = fixture();
    const updates: WorkspaceUploadProgress[][] = [];
    const file = new File(['hello'], 'café 你好.txt');
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: 'chosen folder', files: [file], onProgress: values => updates.push(values) });
    expect(result.uploaded).toBe(1);
    expect(app.reservations).toEqual([{ path: 'chosen folder/café 你好.txt', size: 5 }]);
    expect(app.calls.filter(call => call.method === 'POST').map(call => call.body)).toEqual([{ path: 'chosen folder/café 你好.txt', size: 5 }, undefined, { xetHash, sha256 }]);
    const worker = UploadWorkerFixture.instances[0];
    expect(worker.options.type).toBe('module');
    expect(worker.messages[0]).toMatchObject({ type: 'start', file, bucket: status.bucket });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(updates.some(update => update[0].stage === 'uploading' && update[0].bytesUploaded === 1)).toBe(true);
    expect(updates.at(-1)?.[0]).toMatchObject({ stage: 'ready', bytesImported: 5, path: 'chosen folder/café 你好.txt' });
    expect(JSON.stringify(updates)).not.toContain(capability.accessToken);
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('continues after a create-only conflict and a duplicate selection without overwriting either path', async () => {
    const app = fixture();
    app.controls.reserve = input => { if (input.path === 'exists.txt') throw new ApiError('Exists', 409, 'FILE_EXISTS'); };
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['x'], 'exists.txt'), new File(['a'], 'new.txt'), new File(['b'], 'new.txt')] });
    expect(result).toMatchObject({ uploaded: 1, failed: 2, cancelled: 0 });
    expect(result.files[0].error).toContain('already exists');
    expect(result.files[2].errorCode).toBe('UPLOAD_DUPLICATE_PATH');
    expect(app.reservations).toHaveLength(1);
    expect(UploadWorkerFixture.instances).toHaveLength(1);
  });

  it('bounds file sizes and batch counts before transferring file data', async () => {
    const app = fixture();
    const large = new File(['x'], 'large.bin');
    Object.defineProperty(large, 'size', { value: MAX_WORKSPACE_UPLOAD_BYTES + 1 });
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [large] });
    expect(result.files[0]).toMatchObject({ stage: 'failed', errorCode: 'UPLOAD_TOO_LARGE' });
    expect(app.calls).toHaveLength(0);
    await expect(uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: Array.from({ length: MAX_WORKSPACE_UPLOAD_FILES + 1 }, () => new File(['x'], 'one.txt')) })).rejects.toThrow('no more than 50');
    expect(UploadWorkerFixture.instances).toHaveLength(0);
  });

  it('refuses traversal names and target buffers that become dirty during transfer', async () => {
    const app = fixture();
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['a'], '../bad.txt'), new File(['b'], 'safe.txt')],
      checkTarget: vi.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new WorkspaceUploadError('UPLOAD_BUFFER_CONFLICT', 'The file now has unsaved edits.'); }),
    });
    expect(result.uploaded).toBe(0);
    expect(result.files[0].errorCode).toBe('UPLOAD_NAME_INVALID');
    expect(result.files[1]).toMatchObject({ stage: 'failed', errorCode: 'UPLOAD_BUFFER_CONFLICT' });
    expect(app.calls.some(call => call.path.endsWith('/complete'))).toBe(false);
    expect(app.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
  });

  it('terminates transfer and cancels pending files when the workspace changes', async () => {
    const app = fixture();
    const controller = new AbortController();
    UploadWorkerFixture.start = () => controller.abort();
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['a'], 'first.txt'), new File(['b'], 'second.txt')], signal: controller.signal });
    expect(result).toMatchObject({ uploaded: 0, failed: 0, cancelled: 2 });
    expect(app.reservations).toHaveLength(1);
    expect(app.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect(UploadWorkerFixture.instances[0].terminate).toHaveBeenCalledOnce();
    expect(app.calls.some(call => call.path.endsWith('/complete'))).toBe(false);
  });

  it('reports a completed workspace write when saving wins the cancellation race', async () => {
    const app = fixture();
    const controller = new AbortController();
    app.controls.complete = async () => { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); };
    app.controls.cancel = job => saved(job);
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['a'], 'first.txt'), new File(['b'], 'second.txt')], signal: controller.signal });
    expect(result).toMatchObject({ uploaded: 1, cancelled: 1 });
    expect(result.files[0].notice).toContain('Saved before cancellation');
    expect(result.files[0].stage).toBe('ready');
  });

  it('reconciles a lost finalization response without a second file transfer', async () => {
    const app = fixture();
    app.controls.complete = async job => { app.jobs.set(job.id, saved(job)); throw new TypeError('Network dropped after commit'); };
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['a'], 'saved.txt')] });
    expect(result.uploaded).toBe(1);
    expect(UploadWorkerFixture.instances).toHaveLength(1);
    expect(app.calls.filter(call => call.path.endsWith('/complete'))).toHaveLength(1);
    expect(app.calls.some(call => call.method === 'GET' && /^\/uploads\/[a-f0-9-]{36}$/.test(call.path))).toBe(true);
  });

  it('labels an unreachable finalization outcome as unconfirmed, never saved or cancelled', async () => {
    const app = fixture();
    app.controls.complete = async () => { throw new TypeError('Network failed'); };
    app.controls.read = async () => { throw new TypeError('Offline'); };
    app.controls.cancel = async () => { throw new TypeError('Offline'); };
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['a'], 'uncertain.txt')] });
    expect(result).toMatchObject({ uploaded: 0, failed: 0, cancelled: 0, unconfirmed: 1 });
    expect(result.files[0].error).toContain('Refresh the destination folder');
  });

  it('does not report successful CAS transfer as a successful workspace save', async () => {
    const app = fixture();
    app.controls.complete = job => ({ ...job, state: 'failed', error: { code: 'UPLOAD_INTEGRITY_FAILED', message: 'The staged bytes did not match.' } });
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['a'], 'bad.txt')] });
    expect(result).toMatchObject({ uploaded: 0, failed: 1 });
    expect(result.files[0]).toMatchObject({ stage: 'failed', errorCode: 'UPLOAD_INTEGRITY_FAILED', error: 'The staged bytes did not match.' });
  });

  it('surfaces a real direct-network failure and does not publish incomplete data', async () => {
    const app = fixture();
    UploadWorkerFixture.supplied = worker => worker.emit({ type: 'error', code: 'UPLOAD_NETWORK_BLOCKED', message: 'The browser could not reach Hugging Face for the direct upload.' });
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['a'], 'blocked.txt')] });
    expect(result.files[0]).toMatchObject({ stage: 'failed', errorCode: 'UPLOAD_NETWORK_BLOCKED' });
    expect(app.calls.some(call => call.path.endsWith('/complete'))).toBe(false);
    expect(app.calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect(UploadWorkerFixture.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('requires the ready confirmation to match the original file hash and destination', async () => {
    const app = fixture();
    app.controls.complete = job => ({ ...saved(job), version: 'c'.repeat(64) });
    app.controls.cancel = job => ({ ...job, state: 'cancelled' });
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [new File(['a'], 'verified.txt')] });
    expect(result.uploaded).toBe(0);
    expect(result.files[0].stage).toBe('failed');
    expect(result.files[0].errorCode).toBe('UPLOAD_RESPONSE_INVALID');
  });
});

describe('planned folder uploads through the existing direct worker', () => {
  it('keeps nested paths and equal basenames distinct while transferring one original File at a time', async () => {
    const app = fixture();
    const files = [new File(['first'], 'same.txt'), new File(['second'], 'same.txt')];
    const checked: string[] = [];
    UploadWorkerFixture.start = worker => {
      for (const previous of UploadWorkerFixture.instances) if (previous !== worker) expect(previous.terminate).toHaveBeenCalledOnce();
      worker.emit({ type: 'capability', requestId: 1 });
    };
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: 'selected/nested', files,
      relativePaths: ['project/one/same.txt', 'project/two/same.txt'], checkTarget: path => { checked.push(path); } });
    expect(result.uploaded).toBe(2);
    expect(app.reservations).toEqual([
      { path: 'selected/nested/project/one/same.txt', size: 5 }, { path: 'selected/nested/project/two/same.txt', size: 6 },
    ]);
    expect(UploadWorkerFixture.instances.map(worker => (worker.messages[0] as Extract<UploadWorkerRequest, { type: 'start' }>).file)).toEqual(files);
    expect(checked).toEqual(['selected/nested/project/one/same.txt', 'selected/nested/project/one/same.txt', 'selected/nested/project/two/same.txt', 'selected/nested/project/two/same.txt']);
    expect(app.calls.some(call => call.method === 'PUT' || call.body instanceof Blob)).toBe(false);
    expect(result.files.map(file => file.path)).toEqual(app.reservations.map(file => file.path));
  });

  it('allows a planned folder batch above the flat selection limit and still enforces the 1,000-file ceiling', async () => {
    const app = fixture();
    const files = Array.from({ length: MAX_WORKSPACE_UPLOAD_FILES + 1 }, (_, index) => new File(['a'], `${index}.txt`));
    await expect(uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files })).rejects.toThrow('50');
    const result = await uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files, relativePaths: files.map(file => `folder/${file.name}`) });
    expect(result.uploaded).toBe(files.length); expect(app.reservations).toHaveLength(files.length);
    const oversized = Array.from({ length: MAX_WORKSPACE_FOLDER_UPLOAD_FILES + 1 }, (_, index) => new File(['a'], `${index}.txt`));
    await expect(uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: oversized, relativePaths: oversized.map(file => `folder/${file.name}`) })).rejects.toThrow('1000');
    expect(app.reservations).toHaveLength(files.length);
  });

  it.each(['../file.txt', '/file.txt', 'folder//file.txt', 'folder/./file.txt', 'folder\\file.txt', 'folder/different.txt'])('rejects unsafe or mismatched planned destinations %j before reserving', async path => {
    const app = fixture();
    await expect(uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: 'target', files: [new File(['data'], 'file.txt')], relativePaths: [path] })).rejects.toBeInstanceOf(WorkspaceUploadError);
    expect(app.calls).toEqual([]); expect(UploadWorkerFixture.instances).toHaveLength(0);
  });

  it('rejects incomplete plans and excessive aggregate source size without loading file contents', async () => {
    const app = fixture(); const file = new File(['a'], 'file.txt');
    await expect(uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files: [file], relativePaths: [] })).rejects.toMatchObject({ code: 'UPLOAD_PATHS_INVALID' });
    const files = Array.from({ length: MAX_WORKSPACE_UPLOAD_TOTAL_BYTES / MAX_WORKSPACE_UPLOAD_BYTES + 1 }, (_, index) => {
      const item = new File(['metadata only'], `${index}.bin`);
      Object.defineProperty(item, 'size', { value: MAX_WORKSPACE_UPLOAD_BYTES }); return item;
    });
    await expect(uploadWorkspaceFiles({ workspaceId: 'workspace-a', directory: '', files, relativePaths: files.map(file => `folder/${file.name}`) })).rejects.toThrow('250 MB');
    expect(app.calls).toEqual([]); expect(UploadWorkerFixture.instances).toHaveLength(0);
  });
});
