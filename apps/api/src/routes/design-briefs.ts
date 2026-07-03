import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';
import { createDesignBriefFromContentIdea } from '../services/design-brief-creation.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';

export const designBriefsRouter: Router = Router();

// POST /api/design-briefs — create (requires approved content idea; derivation
// logic extracted into services/design-brief-creation.ts for the workflow
// engine — the response contract here is unchanged).
designBriefsRouter.post('/design-briefs', requireAuth, requirePermission('design_briefs:create'), asyncHandler(async (req: Request, res: Response) => {
  const { contentIdeaId } = req.body;
  if (!contentIdeaId) return res.status(400).json({ error: 'contentIdeaId is required' });

  try {
    const brief = await createDesignBriefFromContentIdea(contentIdeaId);
    return res.status(201).json({ data: brief });
  } catch (err) {
    const e = err as Error & { status?: number; currentStatus?: string };
    if (e.status === 404) return res.status(404).json({ error: 'Content idea not found' });
    // ── APPROVAL GATE ──
    if (e.status === 403) {
      return res.status(403).json({
        error: 'Content idea must be approved before creating a design brief',
        currentStatus: e.currentStatus,
        message: 'Approve this content idea first via POST /api/content-ideas/:id/approve',
      });
    }
    throw err;
  }
}));

// GET /api/design-briefs/:id
designBriefsRouter.get('/design-briefs/:id', requireAuth, requirePermission('clients:read'), asyncHandler(async (req: Request, res: Response) => {
  const brief = await store.designBriefs.getById(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Design brief not found' });

  const idea = await store.contentIdeas.getById(brief.contentIdeaId);
  const client = await store.clients.getById(brief.clientId);

  res.json({ data: { ...brief, contentIdea: idea, client } });
}));

// GET /api/design-briefs — list all
designBriefsRouter.get('/design-briefs', requireAuth, requirePermission('clients:read'), asyncHandler(async (_req: Request, res: Response) => {
  const briefs = await store.designBriefs.list();
  res.json({ data: briefs, total: briefs.length });
}));

// POST /api/design-briefs/:id/approve — required before layout generation can run
// against this brief (see services/layout-generation.ts).
designBriefsRouter.post('/design-briefs/:id/approve', requireAuth, requirePermission('design_briefs:approve'), asyncHandler(async (req: Request, res: Response) => {
  const brief = await store.designBriefs.getById(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Design brief not found' });

  const updated = await store.designBriefs.updateStatus(brief.id, 'approved');
  res.json({ data: updated });
}));

// POST /api/design-briefs/:id/reject — mirrors approvals.ts's content-idea reject pattern:
// { revisionNotes } present -> 'needs_revision', otherwise -> 'rejected'.
designBriefsRouter.post('/design-briefs/:id/reject', requireAuth, requirePermission('design_briefs:approve'), asyncHandler(async (req: Request, res: Response) => {
  const brief = await store.designBriefs.getById(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Design brief not found' });

  const newStatus = req.body?.revisionNotes ? 'needs_revision' : 'rejected';
  const updated = await store.designBriefs.updateStatus(brief.id, newStatus);
  res.json({ data: updated });
}));
