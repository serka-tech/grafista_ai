import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { runDesignDnaAnalysis } from '../services/design-dna-analysis.js';
import { assertClientAccessible } from '../auth/client-access.js';

export const designDnaRouter: Router = Router();

// POST /api/clients/:clientId/design-dna/analyze — runs real AI vision analysis over the
// client's uploaded design references and synthesizes an aggregated Design DNA. Synchronous
// (runs to completion within the request), not a background job — re-running after new
// uploads is just calling this route again (it always creates a new version).
designDnaRouter.post(
  '/:clientId/design-dna/analyze',
  requireAuth,
  requirePermission('design_dna:run'),
  asyncHandler(async (req: Request, res: Response) => {
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, req.params.clientId);

    const client = await store.clients.getById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { designDna, analyses } = await runDesignDnaAnalysis(req.params.clientId, req.user!.id);
    res.status(201).json({ data: designDna, analyses });
  })
);

// GET /api/clients/:clientId/design-dna — latest Design DNA version (any status) for a client.
designDnaRouter.get(
  '/:clientId/design-dna',
  requireAuth,
  requirePermission('design_dna:read'),
  asyncHandler(async (req: Request, res: Response) => {
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, req.params.clientId);

    const dna = await store.designDna.getLatestByClientId(req.params.clientId);
    if (!dna) return res.status(404).json({ error: 'Design DNA not found. Run analysis first.' });
    res.json({ data: dna });
  })
);

// GET /api/clients/:clientId/design-dna/references — per-reference style analyses for a
// client. A list endpoint — returns an empty array (200), not 404, when none exist yet.
designDnaRouter.get(
  '/:clientId/design-dna/references',
  requireAuth,
  requirePermission('design_dna:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const analyses = await store.designAnalysis.listByClientReferences(req.params.clientId);
    res.json({ data: analyses, total: analyses.length });
  })
);

// POST /api/clients/:clientId/design-dna/approve — approves the latest Design DNA version.
designDnaRouter.post(
  '/:clientId/design-dna/approve',
  requireAuth,
  requirePermission('design_dna:approve'),
  asyncHandler(async (req: Request, res: Response) => {
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, req.params.clientId);

    const latest = await store.designDna.getLatestByClientId(req.params.clientId);
    if (!latest) return res.status(404).json({ error: 'Design DNA not found. Run analysis first.' });

    const approved = await store.designDna.approve(latest.id, req.user!.id);
    if (!approved) {
      return res.status(409).json({ error: 'Design DNA is not in an approvable state', status: latest.status });
    }
    res.json({ data: approved });
  })
);

// POST /api/clients/:clientId/design-dna/revise — requests revision on the latest Design DNA
// version. Optional { notes } body explaining what needs to change.
designDnaRouter.post(
  '/:clientId/design-dna/revise',
  requireAuth,
  requirePermission('design_dna:revise'),
  asyncHandler(async (req: Request, res: Response) => {
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, req.params.clientId);

    const latest = await store.designDna.getLatestByClientId(req.params.clientId);
    if (!latest) return res.status(404).json({ error: 'Design DNA not found. Run analysis first.' });

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    const revised = await store.designDna.requestRevision(latest.id, notes);
    if (!revised) {
      return res.status(409).json({ error: 'Design DNA is not in a revisable state', status: latest.status });
    }
    res.json({ data: revised });
  })
);
