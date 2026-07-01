import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { upload } from '../middleware/upload.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

export const designReferencesRouter: Router = Router();

// GET /api/clients/:clientId/design-references
designReferencesRouter.get(
  '/:clientId/design-references',
  requireAuth,
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    const refs = await store.designReferences.listByClient(req.params.clientId);
    res.json({ data: refs, total: refs.length });
  }
);

// POST /api/clients/:clientId/design-references — accepts multipart/form-data with an optional `file` field
designReferencesRouter.post(
  '/:clientId/design-references',
  requireAuth,
  requirePermission('design_references:upload'),
  upload.single('file'),
  async (req: Request, res: Response) => {
    const client = await store.clients.getById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { name, description, tags } = req.body;
    const resolvedName = name ?? req.file?.originalname;
    if (!resolvedName) return res.status(400).json({ error: 'Name is required' });

    const ref = await store.designReferences.create({
      id: uuid(),
      clientId: req.params.clientId,
      name: resolvedName,
      description,
      fileUrl: req.file ? `/uploads/${req.file.filename}` : undefined,
      tags: parseTags(tags),
    });
    res.status(201).json({ data: ref });
  }
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
