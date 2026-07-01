import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../data/store.js';
import { upload } from '../middleware/upload.js';

export const designReferencesRouter: Router = Router();

// GET /api/clients/:clientId/design-references
designReferencesRouter.get('/:clientId/design-references', (req: Request, res: Response) => {
  const refs = Array.from(store.designReferences.values()).filter((r) => r.clientId === req.params.clientId);
  res.json({ data: refs, total: refs.length });
});

// POST /api/clients/:clientId/design-references — accepts multipart/form-data with an optional `file` field
designReferencesRouter.post('/:clientId/design-references', upload.single('file'), (req: Request, res: Response) => {
  const client = store.clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { name, description, tags } = req.body;
  const resolvedName = name ?? req.file?.originalname;
  if (!resolvedName) return res.status(400).json({ error: 'Name is required' });

  const ref = {
    id: uuid(),
    clientId: req.params.clientId,
    name: resolvedName,
    description,
    fileUrl: req.file ? `/uploads/${req.file.filename}` : undefined,
    thumbnailUrl: undefined,
    tags: parseTags(tags),
    isApproved: true,
    uploadedAt: new Date().toISOString(),
  };
  store.designReferences.set(ref.id, ref);
  res.status(201).json({ data: ref });
});

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
