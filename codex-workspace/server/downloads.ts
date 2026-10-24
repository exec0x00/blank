import { Router, type Request, type Response } from 'express';
import type { AppContext } from './context';
import { createSessionEventStream } from './auth';
import { DownloadService, type DownloadServiceOptions } from './downloads/service';
import type { DownloadJob } from './downloads/types';

export { DownloadService } from './downloads/service';
export type { DownloadServiceOptions, DownloadSourceRequest } from './downloads/service';
export type { DownloadJob, DownloadJobState, DownloadIssue, DownloadServiceStatus, DownloadSourceIdentity } from './downloads/types';

const services = new WeakMap<AppContext, DownloadService>();

export function getDownloadService(ctx: AppContext, options?: DownloadServiceOptions): DownloadService {
  let service = services.get(ctx);
  if (!service) { service = new DownloadService(ctx, options); services.set(ctx, service); }
  return service;
}

/** Await this before the HTTP listener is exposed, so every restart attempts remote expiry cleanup first. */
export async function initializeDownloads(ctx: AppContext, options?: DownloadServiceOptions): Promise<DownloadService> {
  const service = getDownloadService(ctx, options);
  await service.initialize();
  return service;
}

export async function shutdownDownloads(ctx: AppContext): Promise<void> { await services.get(ctx)?.close(); }

function streamJob(service: DownloadService, id: string, req: Request, res: Response): void {
  const stream = createSessionEventStream(req, res);
  let streaming = false;
  let pending: DownloadJob | undefined;
  stream.onClose(() => { pending = undefined; });
  const send = (job: DownloadJob) => {
    if (stream.closed) return;
    if (!streaming) { pending = job; return; }
    stream.sendLatest(`event: download\ndata: ${JSON.stringify(job)}\n\n`);
  };
  try { stream.onClose(service.subscribe(id, send)); }
  catch (error) {
    stream.dispose();
    throw error;
  }
  // Reserve a subscription before committing HTTP 200, so exhausted stream limits remain a real
  // 429 JSON error instead of a silent successful EventSource connection that immediately closes.
  res.status(200);
  // HF's edge otherwise negotiates Brotli/gzip and buffers small event frames. The same
  // no-transform directive used by agent SSE preserves immediate progress through the edge.
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  streaming = true;
  if (pending) { const initial = pending; pending = undefined; send(initial); }
}

/** Mount behind AuthService.requireSession and protectMutations, like the other /api routers. */
export function createDownloadRouter(ctx: AppContext): Router {
  const router = Router();
  const service = getDownloadService(ctx);
  router.get('/downloads/status', (_req, res) => res.json(service.status()));
  router.post('/workspaces/:workspaceId/downloads', async (req, res) => {
    const job = await service.prepare(String(req.params.workspaceId), req.body);
    res.setHeader('Location', `/api/downloads/${job.id}`);
    res.status(202).json(job);
  });
  router.get('/downloads/:id/events', async (req, res) => {
    const id = String(req.params.id);
    await service.get(id);
    streamJob(service, id, req, res);
  });
  router.get('/downloads/:id', async (req, res) => res.json(await service.get(String(req.params.id))));
  router.delete('/downloads/:id', async (req, res) => res.json(await service.cancel(String(req.params.id))));
  return router;
}
