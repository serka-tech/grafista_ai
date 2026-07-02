import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { runCreativeQa } from '../services/creative-qa.js';

// Mounted at /api — layout-plan/design-brief-scoped run/list routes plus standalone
// /creative-qa/:id routes (mirrors how layoutPlansRouter/clientLayoutPlansRouter from
// routes/layout-plans.ts are mounted).
export const creativeQaRouter: Router = Router();

// POST /api/layout-plans/:layoutPlanId/creative-qa — runs one real AI call reviewing an
// approved LayoutPlan against its approved DesignBrief and the client's approved
// DesignDNA. Synchronous (runs to completion within the request). Service errors (404
// layout plan/brief/client not found, 409 not approved / no approved DesignDNA, 502
// AI/schema failure) already carry a `.status` and bubble to the centralized
// errorHandler — not caught/reformatted here.
creativeQaRouter.post(
  '/layout-plans/:layoutPlanId/creative-qa',
  requireAuth,
  requirePermission('creative_qa:run'),
  asyncHandler(async (req: Request, res: Response) => {
    const { report } = await runCreativeQa(req.params.layoutPlanId, req.user!.id);
    res.status(201).json({ data: report });
  })
);

// GET /api/layout-plans/:layoutPlanId/creative-qa — all reports for one layout plan
// alternative. A list endpoint — returns [] (200), not 404, when none exist yet.
creativeQaRouter.get(
  '/layout-plans/:layoutPlanId/creative-qa',
  requireAuth,
  requirePermission('creative_qa:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const reports = await store.creativeQaReports.listByLayoutPlan(req.params.layoutPlanId);
    res.json({ data: reports, total: reports.length });
  })
);

// GET /api/design-briefs/:designBriefId/creative-qa — all reports across all layout plan
// alternatives for one design brief.
creativeQaRouter.get(
  '/design-briefs/:designBriefId/creative-qa',
  requireAuth,
  requirePermission('creative_qa:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const reports = await store.creativeQaReports.listByDesignBrief(req.params.designBriefId);
    res.json({ data: reports, total: reports.length });
  })
);

// GET /api/creative-qa/:id
creativeQaRouter.get(
  '/creative-qa/:id',
  requireAuth,
  requirePermission('creative_qa:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const report = await store.creativeQaReports.getById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Creative QA report not found' });
    res.json({ data: report });
  })
);

// POST /api/creative-qa/:id/approve
creativeQaRouter.post(
  '/creative-qa/:id/approve',
  requireAuth,
  requirePermission('creative_qa:approve'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await store.creativeQaReports.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Creative QA report not found' });

    const approved = await store.creativeQaReports.approve(existing.id, req.user!.id);
    if (!approved) {
      return res.status(409).json({ error: 'Creative QA report is not in an approvable state', status: existing.status });
    }
    res.json({ data: approved });
  })
);

// POST /api/creative-qa/:id/reject — optional body { notes?: string }: notes present ->
// 'needs_revision', otherwise -> 'rejected' (mirrors layout-plans.ts's reject pattern).
creativeQaRouter.post(
  '/creative-qa/:id/reject',
  requireAuth,
  requirePermission('creative_qa:reject'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await store.creativeQaReports.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Creative QA report not found' });

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    const rejected = await store.creativeQaReports.reject(existing.id, req.user!.id, notes);
    if (!rejected) {
      return res.status(409).json({ error: 'Creative QA report is not in a rejectable state', status: existing.status });
    }
    res.json({ data: rejected });
  })
);

// Mounted at /api/clients — client-scoped listing (mirrors clientLayoutPlansRouter's mounting).
export const clientCreativeQaRouter: Router = Router();

// GET /api/clients/:clientId/creative-qa — all Creative QA reports across all layout
// plans for a client.
clientCreativeQaRouter.get(
  '/:clientId/creative-qa',
  requireAuth,
  requirePermission('creative_qa:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const reports = await store.creativeQaReports.listByClient(req.params.clientId);
    res.json({ data: reports, total: reports.length });
  })
);
