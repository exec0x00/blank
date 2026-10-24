import { Router } from 'express';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { FilePagesService } from './file-pages/service';
import { filePagesLifecycleFor } from './file-pages/lifecycle';

const services = new WeakMap<AppContext, FilePagesService>();
export function filePagesFor(ctx: AppContext): FilePagesService {
  let service = services.get(ctx);
  if (!service) {
    filePagesLifecycleFor(ctx).assertOpen();
    service = new FilePagesService(ctx); services.set(ctx, service);
  }
  return service;
}

export async function initializeFilePages(ctx: AppContext): Promise<void> { await filePagesFor(ctx).initialize(); }
/** Synchronously closes admission; resolves only after admitted file-page work settles. */
export function shutdownFilePages(ctx: AppContext): Promise<void> { return filePagesLifecycleFor(ctx).close(); }

function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'A JSON object is required.', 'INVALID_FILE_REQUEST');
  return value as Record<string, unknown>;
}

/** Mount at /api behind the app's session and same-origin mutation middleware. */
export function createFilePagesRouter(ctx: AppContext): Router {
  const router = Router();
  const service = filePagesFor(ctx);
  router.get('/workspaces/:id/file-info', async (req, res) => { res.json(await service.info(req.params.id, req.query.path)); });
  router.get('/workspaces/:id/file-page', async (req, res) => {
    res.json(await service.page(req.params.id, { path: req.query.path, version: req.query.version, offset: req.query.offset, cursor: req.query.cursor }));
  });
  router.post('/workspaces/:id/file-search', async (req, res) => {
    const input = body(req.body);
    res.json(await service.search(req.params.id, { path: input.path, version: input.version, query: input.query, cursor: input.cursor, caseSensitive: input.caseSensitive }));
  });
  router.put('/workspaces/:id/file-range', async (req, res) => {
    const input = body(req.body);
    res.json(await service.save(req.params.id, { path: input.path, pageToken: input.pageToken, content: input.content }));
  });
  router.get('/workspaces/:id/file-recoveries', async (req, res) => { res.json(await service.recoveries(req.params.id)); });
  return router;
}
