import { Router } from 'express';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { GeneratedImageService, type GeneratedImageCleanupConfig } from './generated-images/service';
import type { ImageAssetCleanupOptions } from './image-assets/coordination';

export { GeneratedImageService, GENERATED_IMAGE_LIMITS } from './generated-images/service';
export type { GeneratedImageCleanupConfig } from './generated-images/service';
export type {
  CommitGeneratedImageInput, GeneratedImageReference, GeneratedImageMetadata,
  GeneratedImageRead, GeneratedImageReadLeaseOptions, GeneratedImageModelOptions, GeneratedImageServiceOptions,
  GeneratedImageRecovery, GeneratedImageWorkspaceCleanup, GeneratedImageMimeType, GeneratedImageFormat,
} from './generated-images/types';

const services = new WeakMap<AppContext, GeneratedImageService>();
export function getGeneratedImageService(ctx: AppContext): GeneratedImageService {
  let service = services.get(ctx);
  if (!service) { service = new GeneratedImageService(ctx); services.set(ctx, service); }
  return service;
}
export async function initializeGeneratedImages(ctx: AppContext): Promise<void> { await getGeneratedImageService(ctx).initialize(); }
export async function shutdownGeneratedImages(ctx: AppContext): Promise<void> { await services.get(ctx)?.close(); }
export async function cleanupWorkspaceGeneratedImages(source: AppContext | GeneratedImageCleanupConfig, workspaceId: string, options: ImageAssetCleanupOptions = {}) {
  return GeneratedImageService.cleanupWorkspace(source, workspaceId, options);
}

/** Mount at /api only after session authentication and mutation-origin checks. */
export function createGeneratedImagesRouter(ctx: AppContext): Router {
  const router = Router(), service = getGeneratedImageService(ctx);
  router.get('/workspaces/:workspaceId/generated-images/:id/content', async (req, res) => {
    if (Object.keys(req.query).length !== 1 || typeof req.query.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(req.query.sha256)) {
      throw new HttpError(400, 'A generated image preview requires its saved SHA-256 reference.', 'INVALID_GENERATED_IMAGE_INPUT');
    }
    const controller = new AbortController();
    const abort = () => { if (!res.writableFinished) controller.abort(new HttpError(400, 'Image preview cancelled.', 'GENERATED_IMAGE_PREVIEW_ABORTED')); };
    req.once('aborted', abort); res.once('close', abort);
    try {
      const { metadata, bytes } = await service.read(String(req.params.workspaceId), String(req.params.id), req.query.sha256, controller.signal);
      controller.signal.throwIfAborted();
      const extension = metadata.mimeType === 'image/jpeg' ? 'jpg' : metadata.mimeType.slice('image/'.length);
      res.set({ 'Content-Type': metadata.mimeType, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': `inline; filename="generated-image.${extension}"`, ETag: `"${metadata.sha256}"` });
      res.end(bytes);
    } finally { req.off('aborted', abort); res.off('close', abort); }
  });
  return router;
}
