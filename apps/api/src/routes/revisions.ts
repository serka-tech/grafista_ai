/**
 * Grafista AI Studio — Revisions Routes (Phase 3 Step 6B)
 *
 * Mounted at /api/clients (mirrors routes/analytics.ts exactly) — a single
 * client-scoped "recent revisions" endpoint. Guard order matches every other
 * client-scoped route in this codebase: requireAuth ->
 * requirePermission('revisions:read') -> assertClientAccessible(req.user!.id,
 * req.params.clientId).
 *
 * The list response is intentionally minimal (id, entityType, entityId,
 * revisionType, actorUserId, reason, metadata, createdAt) — before/after
 * snapshots are NOT included here (see docs/revision-history-plan.md §12
 * item 5); a future per-entity revision detail endpoint could add them if
 * ever needed, out of scope for this MVP.
 */

import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { assertClientAccessible } from '../auth/client-access.js';
import type { RevisionEntrySummary } from '@grafista/schemas';

export const revisionsRouter: Router = Router();

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function parseLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

// GET /api/clients/:clientId/revisions/recent
revisionsRouter.get(
  '/:clientId/revisions/recent',
  requireAuth,
  requirePermission('revisions:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const client = await store.clients.getById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    // Phase 3 Step 4 — client isolation hardening, same pattern as every
    // other client-scoped route.
    await assertClientAccessible(req.user!.id, client.id);

    const limit = parseLimit(req.query.limit);
    const entries = await store.revisionEntries.getRecentByClientId(client.id, limit);

    const data: RevisionEntrySummary[] = entries.map((entry) => ({
      id: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      revisionType: entry.revisionType,
      actorUserId: entry.actorUserId ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
    }));

    res.json({ data });
  })
);
