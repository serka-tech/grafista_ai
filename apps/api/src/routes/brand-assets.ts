import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { upload } from '../middleware/upload.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { storeUploadedFile, getFileAccess } from '../storage/file-service.js';

export const brandAssetsRouter: Router = Router();

// GET /api/clients/:clientId/brand-assets
brandAssetsRouter.get(
  '/:clientId/brand-assets',
  requireAuth,
  requirePermission('clients:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const assets = await store.brandAssets.listByClient(req.params.clientId);
    res.json({ data: assets, total: assets.length });
  })
);

// POST /api/clients/:clientId/brand-assets — accepts multipart/form-data with an optional `file` field.
// The file is buffered in memory by multer, then handed to the storage provider (S3 or local disk,
// selected by STORAGE_PROVIDER). The Postgres row is only written after storage succeeds — a storage
// failure propagates as an error response and never creates a partial/broken metadata row.
brandAssetsRouter.post(
  '/:clientId/brand-assets',
  requireAuth,
  requirePermission('brand_assets:upload'),
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const client = await store.clients.getById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { type, name, metadata } = req.body;
    const resolvedName = name ?? req.file?.originalname;
    if (!type || !resolvedName) return res.status(400).json({ error: 'Type and name are required' });

    const id = uuid();
    const fileMeta = req.file
      ? await storeUploadedFile({ assetKind: 'brand-assets', clientId: req.params.clientId, file: req.file })
      : undefined;

    const asset = await store.brandAssets.create({
      id,
      clientId: req.params.clientId,
      type,
      name: resolvedName,
      fileUrl: fileMeta ? `/api/clients/${req.params.clientId}/brand-assets/${id}/file` : undefined,
      mimeType: fileMeta?.mimeType,
      fileSizeBytes: fileMeta?.fileSizeBytes,
      originalFilename: fileMeta?.originalFilename,
      storageProvider: fileMeta?.storageProvider,
      storageKey: fileMeta?.storageKey,
      storageBucket: fileMeta?.storageBucket,
      uploadedBy: req.user!.id,
      metadata: parseMetadata(metadata),
    });
    res.status(201).json({ data: asset });
  })
);

// GET /api/clients/:clientId/brand-assets/:assetId/file — authenticated, permission-checked file access.
// Never serves bucket/disk files directly: local disk is streamed through this route, S3 files are
// redirected to a short-lived signed URL generated on demand.
brandAssetsRouter.get(
  '/:clientId/brand-assets/:assetId/file',
  requireAuth,
  requirePermission('clients:read'),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const asset = await store.brandAssets.getById(req.params.clientId, req.params.assetId);
    if (!asset || !asset.storageKey || !asset.storageProvider || !asset.storageBucket) {
      return res.status(404).json({ error: 'File not found' });
    }

    const access = await getFileAccess(
      { storageProvider: asset.storageProvider, storageKey: asset.storageKey, storageBucket: asset.storageBucket },
      asset.originalFilename ?? asset.name,
      asset.mimeType
    );

    if (access.kind === 'redirect') {
      return res.redirect(302, access.url);
    }

    res.setHeader('Content-Type', access.contentType ?? asset.mimeType ?? 'application/octet-stream');
    if (access.contentLength != null) res.setHeader('Content-Length', String(access.contentLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(asset.originalFilename ?? asset.name)}"`
    );
    access.stream.on('error', next);
    access.stream.pipe(res);
  })
);

function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw as Record<string, unknown>;
}
