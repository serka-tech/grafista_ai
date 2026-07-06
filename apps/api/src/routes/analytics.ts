/**
 * Grafista AI Studio — Analytics Routes (Phase 3 Step 6A)
 *
 * Mounted at /api/clients (mirrors clientCreativeQaRouter/clientLayoutPlansRouter
 * from routes/creative-qa.ts / routes/layout-plans.ts) — a single client-scoped
 * summary endpoint. Guard order matches every other client-scoped route in
 * this codebase: requireAuth -> requirePermission('analytics:read') ->
 * assertClientAccessible(req.user!.id, req.params.id).
 *
 * A separate raw `/analytics/events` listing route is intentionally NOT
 * added in this step — the summary endpoint's `recentActivity` (last 10
 * events) covers Step 6A's dashboard need; a full filterable event list is
 * left for a later step if it turns out to be needed.
 */

import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { assertClientAccessible } from '../auth/client-access.js';

export const analyticsRouter: Router = Router();

// GET /api/clients/:id/analytics/summary
analyticsRouter.get(
  '/:id/analytics/summary',
  requireAuth,
  requirePermission('analytics:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const client = await store.clients.getById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    // Phase 3 Step 4 — client isolation hardening, same pattern as every
    // other client-scoped route.
    await assertClientAccessible(req.user!.id, client.id);

    const summary = await store.analyticsEvents.getClientSummary(client.id, { recentLimit: 10 });
    res.json({ data: summary });
  })
);
