import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { getDownloadService } from '../downloads';
import { ConversationFilesService, type ConversationFilesOptions } from './service';
import { FILE_ATTACHMENT_LIMITS } from './types';
import { FILE_ATTACHMENT_HASH, fileAttachmentReferenceSchema, parseFileInput } from './validation';

export { ConversationFilesService } from './service';
export type { ConversationFilesOptions } from './service';
export * from './types';
export { fileAttachmentReferencesSchema } from './validation';
export { cleanupWorkspaceConversationFiles } from './cleanup';

const services = new WeakMap<AppContext, ConversationFilesService>();

export function getConversationFiles(ctx: AppContext, options?: ConversationFilesOptions): ConversationFilesService {
  let service = services.get(ctx);
  if (!service) { service = new ConversationFilesService(ctx, options); services.set(ctx, service); }
  return service;
}

export async function initializeConversationFiles(ctx: AppContext, options?: ConversationFilesOptions): Promise<ConversationFilesService> {
  const service = getConversationFiles(ctx, options);
  await service.initialize(); return service;
}

export async function shutdownConversationFiles(ctx: AppContext): Promise<void> { await services.get(ctx)?.close(); }

const hashQuery = z.object({ sha256: z.string().regex(FILE_ATTACHMENT_HASH) }).strict();
const numberQuery = (maximum: number, minimum = 0) => z.string().regex(/^\d{1,8}$/).transform(Number).pipe(z.number().int().min(minimum).max(maximum)).optional();
const inspectQuery = z.object({
  sha256: z.string().regex(FILE_ATTACHMENT_HASH),
  offset: numberQuery(FILE_ATTACHMENT_LIMITS.maxBytes),
  maxBytes: numberQuery(FILE_ATTACHMENT_LIMITS.maxInspectionBytes, 1),
}).strict();

/** Mount only behind the existing server-side session and same-origin mutation protections. */
export function createConversationFilesRouter(ctx: AppContext): Router {
  const router = Router(), service = getConversationFiles(ctx);
  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    next();
  });
  router.get('/file-attachment-uploads/status', (_req, res) => res.json(service.status()));
  router.post('/workspaces/:workspaceId/file-attachments/uploads', async (req, res) => {
    const job = await service.reserve(String(req.params.workspaceId), req.body);
    res.setHeader('Location', `/api/file-attachment-uploads/${job.id}`);
    res.status(201).json(job);
  });
  router.post('/file-attachment-uploads/:id/capability', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' });
    res.json(await service.capability(String(req.params.id)));
  });
  router.post('/file-attachment-uploads/:id/complete', async (req, res) => {
    res.status(202).json(await service.complete(String(req.params.id), req.body));
  });
  router.get('/file-attachment-uploads/:id', async (req, res) => res.json(await service.get(String(req.params.id))));
  router.delete('/file-attachment-uploads/:id', async (req, res) => res.json(await service.cancel(String(req.params.id))));
  router.get('/workspaces/:workspaceId/file-attachments/:attachmentId/inspect', async (req, res) => {
    const query = parseFileInput(inspectQuery, req.query);
    res.json(await service.inspect(String(req.params.workspaceId), { id: String(req.params.attachmentId), sha256: query.sha256 },
      { ...(query.offset !== undefined ? { offset: query.offset } : {}), ...(query.maxBytes !== undefined ? { maxBytes: query.maxBytes } : {}) }));
  });
  router.post('/workspaces/:workspaceId/file-attachments/:attachmentId/downloads', async (req, res) => {
    const body = parseFileInput(hashQuery, req.body);
    const reference = parseFileInput(fileAttachmentReferenceSchema, { id: String(req.params.attachmentId), sha256: body.sha256 });
    const workspaceId = String(req.params.workspaceId);
    const { attachment, source } = await service.openDownloadSource(workspaceId, reference);
    // prepareSource owns both descriptor handles on success and rejection. The
    // ordinary download job/SSE endpoints provide its immutable public URL.
    const job = await getDownloadService(ctx).prepareSource(workspaceId, {
      fileName: attachment.name, mimeType: attachment.mimeType, expectedVersion: attachment.sha256,
      sourceIdentity: { type: 'attachment', id: attachment.id, sha256: attachment.sha256 },
    }, source);
    res.setHeader('Location', `/api/downloads/${job.id}`);
    res.status(202).json(job);
  });
  router.delete('/workspaces/:workspaceId/file-attachments/:attachmentId', async (req, res) => {
    const query = parseFileInput(hashQuery, req.query);
    res.json(await service.discard(String(req.params.workspaceId), { id: String(req.params.attachmentId), sha256: query.sha256 }));
  });
  return router;
}
