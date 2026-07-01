import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { upload } from '../middleware/upload.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { storeUploadedFile, getFileAccess } from '../storage/file-service.js';

export const designReferencesRouter: Router = Router();

// GET /api/clients/:clientId/design-references
designReferencesRouter.get(
  '/:clientId/design-references',
  requireAuth,
  requirePermission('clients:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const refs = await store.designReferences.listByClient(req.params.clientId);
    res.json({ data: refs, total: refs.length });
  })
);

// POST /api/clients/:clientId/design-references — accepts multipart/form-data with an optional `file`
// field. Storage write happens before the Postgres row is created; a storage failure never leaves a
// partial/broken metadata record behind.
designReferencesRouter.post(
  '/:clientId/design-references',
  requireAuth,
  requirePermission('design_references:upload'),
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const client = await store.clients.getById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { name, description, tags } = req.body;
    const resolvedName = name ?? req.file?.originalname;
    if (!resolvedName) return res.status(400).json({ error: 'Name is required' });

    const id = uuid();
    const fileMeta = req.file
      ? await storeUploadedFile({ assetKind: 'design-references', clientId: req.params.clientId, file: req.file })
      : undefined;

    const ref = await store.designReferences.create({
      id,
      clientId: req.params.clientId,
      name: resolvedName,
      description,
      fileUrl: fileMeta ? `/api/clients/${req.params.clientId}/design-references/${id}/file` : undefined,
      mimeType: fileMeta?.mimeType,
      fileSizeBytes: fileMeta?.fileSizeBytes,
      originalFilename: fileMeta?.originalFilename,
      storageProvider: fileMeta?.storageProvider,
      storageKey: fileMeta?.storageKey,
      storageBucket: fileMeta?.storageBucket,
      uploadedBy: req.user!.id,
      tags: parseTags(tags),
    });
    res.status(201).json({ data: ref });
  })
);

// GET /api/clients/:clientId/design-references/:refId/file — authenticated, permission-checked file
// access. Same access pattern as brand-assets: local streams through this route, S3 redirects to a
// short-lived signed URL.
designReferencesRouter.get(
  '/:clientId/design-references/:refId/file',
  requireAuth,
  requirePermission('clients:read'),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ref = await store.designReferences.getById(req.params.clientId, req.params.refId);
    if (!ref || !ref.storageKey || !ref.storageProvider || !ref.storageBucket) {
      return res.status(404).json({ error: 'File not found' });
    }

    const access = await getFileAccess(
      { storageProvider: ref.storageProvider, storageKey: ref.storageKey, storageBucket: ref.storageBucket },
      ref.originalFilename ?? ref.name,
      ref.mimeType
    );

    if (access.kind === 'redirect') {
      return res.redirect(302, access.url);
    }

    res.setHeader('Content-Type', access.contentType ?? ref.mimeType ?? 'application/octet-stream');
    if (access.contentLength != null) res.setHeader('Content-Length', String(access.contentLength));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(ref.originalFilename ?? ref.name)}"`);
    access.stream.on('error', next);
    access.stream.pipe(res);
  })
);

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return raw.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }
  return [];
}
