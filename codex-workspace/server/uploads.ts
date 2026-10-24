import { Router } from 'express';
import type { AppContext } from './context';
import { UploadService, type UploadServiceOptions } from './uploads/service';

export { UploadService } from './uploads/service';
export type { UploadServiceOptions } from './uploads/service';
export type { UploadJob, UploadJobState, UploadIssue, UploadCapability, UploadServiceStatus } from './uploads/types';

const services = new WeakMap<AppContext, UploadService>();

export function getUploadService(ctx: AppContext, options?: UploadServiceOptions): UploadService {
  let service = services.get(ctx);
  if (!service) { service = new UploadService(ctx, options); services.set(ctx, service); }
  return service;
}

/** Await before accepting requests: durable recovery and the first remote cleanup pass happen here. */
export async function initializeUploads(ctx: AppContext, options?: UploadServiceOptions): Promise<UploadService> {
  const service = getUploadService(ctx, options);
  await service.initialize();
  return service;
}

export async function shutdownUploads(ctx: AppContext): Promise<void> { await services.get(ctx)?.close(); }

/** Mount at /api behind requireSession and protectMutations. No raw file contents are accepted. */
export function createUploadRouter(ctx: AppContext): Router {
  const router = Router();
  const service = getUploadService(ctx);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/uploads/status', (_req, res) => res.json(service.status()));
  router.post('/workspaces/:workspaceId/uploads', async (req, res) => {
    const job = await service.reserve(String(req.params.workspaceId), req.body);
    res.setHeader('Location', `/api/uploads/${job.id}`);
    res.status(201).json(job);
  });
  router.post('/uploads/:id/capability', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' });
    res.json(await service.capability(String(req.params.id)));
  });
  router.post('/uploads/:id/complete', async (req, res) => res.status(202).json(await service.complete(String(req.params.id), req.body)));
  router.get('/uploads/:id', async (req, res) => res.json(await service.get(String(req.params.id))));
  router.delete('/uploads/:id', async (req, res) => res.json(await service.cancel(String(req.params.id))));
  return router;
}
