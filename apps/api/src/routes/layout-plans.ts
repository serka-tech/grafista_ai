import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { runLayoutGeneration } from '../services/layout-generation.js';

// Mounted at /api — design-brief-scoped generate/list routes plus standalone
// /layout-plans/:id routes (mirrors how design-briefs.ts / approvals.ts are mounted).
export const layoutPlansRouter: Router = Router();

// POST /api/design-briefs/:designBriefId/layout-plans — runs one real AI call producing
// 2-3 layout alternatives for an approved design brief. Synchronous (runs to completion
// within the request). Service errors (404 brief/client not found, 409 brief not
// approved, 502 AI/schema failure) already carry a `.status` and bubble to the
// centralized errorHandler — not caught/reformatted here.
layoutPlansRouter.post(
  '/design-briefs/:designBriefId/layout-plans',
  requireAuth,
  requirePermission('layout_plans:create'),
  asyncHandler(async (req: Request, res: Response) => {
    const { layoutPlans } = await runLayoutGeneration(req.params.designBriefId, req.user!.id);
    res.status(201).json({ data: layoutPlans });
  })
);

// GET /api/design-briefs/:designBriefId/layout-plans — all alternatives for one brief,
// ordered by alternativeIndex. A list endpoint — returns [] (200), not 404, when none exist yet.
layoutPlansRouter.get(
  '/design-briefs/:designBriefId/layout-plans',
  requireAuth,
  requirePermission('layout_plans:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const layoutPlans = await store.layoutPlans.listByDesignBrief(req.params.designBriefId);
    res.json({ data: layoutPlans, total: layoutPlans.length });
  })
);

// GET /api/layout-plans/:id
layoutPlansRouter.get(
  '/layout-plans/:id',
  requireAuth,
  requirePermission('layout_plans:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const layoutPlan = await store.layoutPlans.getById(req.params.id);
    if (!layoutPlan) return res.status(404).json({ error: 'Layout plan not found' });
    res.json({ data: layoutPlan });
  })
);

// POST /api/layout-plans/:id/approve
layoutPlansRouter.post(
  '/layout-plans/:id/approve',
  requireAuth,
  requirePermission('layout_plans:approve'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await store.layoutPlans.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Layout plan not found' });

    const approved = await store.layoutPlans.approve(existing.id, req.user!.id);
    if (!approved) {
      return res.status(409).json({ error: 'Layout plan is not in an approvable state', status: existing.status });
    }
    res.json({ data: approved });
  })
);

// POST /api/layout-plans/:id/reject — optional body { notes?: string }: notes present ->
// 'needs_revision', otherwise -> 'rejected' (mirrors approvals.ts's content-idea reject pattern).
layoutPlansRouter.post(
  '/layout-plans/:id/reject',
  requireAuth,
  requirePermission('layout_plans:reject'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await store.layoutPlans.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Layout plan not found' });

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    const rejected = await store.layoutPlans.reject(existing.id, notes);
    if (!rejected) {
      return res.status(409).json({ error: 'Layout plan is not in a rejectable state', status: existing.status });
    }
    res.json({ data: rejected });
  })
);

// Mounted at /api/clients — client-scoped listing (mirrors design-dna.ts's mounting).
export const clientLayoutPlansRouter: Router = Router();

// GET /api/clients/:clientId/layout-plans — all layout plans across all briefs for a client.
clientLayoutPlansRouter.get(
  '/:clientId/layout-plans',
  requireAuth,
  requirePermission('layout_plans:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const layoutPlans = await store.layoutPlans.listByClient(req.params.clientId);
    res.json({ data: layoutPlans, total: layoutPlans.length });
  })
);
