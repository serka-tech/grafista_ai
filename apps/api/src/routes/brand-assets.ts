import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { upload } from '../middleware/upload.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

export const brandAssetsRouter: Router = Router();

// GET /api/clients/:clientId/brand-assets
brandAssetsRouter.get(
  '/:clientId/brand-assets',
  requireAuth,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const assets = await store.brandAssets.listByClient(req.params.clientId);
    res.json({ data: assets, total: assets.length });
  }
);

// POST /api/clients/:clientId/brand-assets — accepts multipart/form-data with an optional `file` field
brandAssetsRouter.post(
  '/:clientId/brand-assets',
  requireAuth,
  requirePermission('brand_assets:upload'),
  upload.single('file'),
  async (req: Request, res: Response) => {
    const client = await store.clients.getById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { type, name, metadata } = req.body;
    const resolvedName = name ?? req.file?.originalname;
    if (!type || !resolvedName) return res.status(400).json({ error: 'Type and name are required' });

    const asset = await store.brandAssets.create({
      id: uuid(),
      clientId: req.params.clientId,
      type,
      name: resolvedName,
      fileUrl: req.file ? `/uploads/${req.file.filename}` : undefined,
      mimeType: req.file?.mimetype,
      fileSizeBytes: req.file?.size,
      metadata: parseMetadata(metadata),
    });
    res.status(201).json({ data: asset });
  }
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
