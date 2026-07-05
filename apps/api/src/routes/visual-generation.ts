import { Router, Request, Response, NextFunction } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { runVisualGeneration } from '../services/visual-generation.js';
import { getFileAccess } from '../storage/file-service.js';
import type { StorageProviderName } from '../storage/types.js';
import { assertClientAccessible } from '../auth/client-access.js';

// Mounted at /api — layout-plan-scoped run/list routes plus standalone
// /visual-outputs/:id routes (mirrors how creativeQaRouter from
// routes/creative-qa.ts is mounted).
export const visualGenerationRouter: Router = Router();

// POST /api/layout-plans/:layoutPlanId/visual-generation — renders the QA-cleared
// LayoutPlan into one or more visual outputs. Synchronous (runs to completion within
// the request). The production gate lives INSIDE the service (its first await): no
// Creative QA report in 'approved'/'passed' status -> 409 with a clear message, which
// (like 404 layout plan not found and 502 provider/JSON/schema failure) already
// carries a `.status` and bubbles to the centralized errorHandler — not re-implemented
// or reformatted here. Per-image download/storage failures are NOT errors at this
// level: the service persists those rows as status 'failed' with error_message and
// still returns them, so the 201 body can contain a mix of 'generated' and 'failed'
// alternatives (failures stay visible, never swallowed — same contract as the service).
visualGenerationRouter.post(
  '/layout-plans/:layoutPlanId/visual-generation',
  requireAuth,
  requirePermission('visual_generation:run'),
  asyncHandler(async (req: Request, res: Response) => {
    const { outputs } = await runVisualGeneration(req.params.layoutPlanId, req.user!.id);
    res.status(201).json({ data: outputs, total: outputs.length });
  })
);

// GET /api/layout-plans/:layoutPlanId/visual-generation — all generated outputs for
// one layout plan (every run's alternatives, including 'failed' rows). A list
// endpoint — returns [] (200), not 404, when none exist yet.
visualGenerationRouter.get(
  '/layout-plans/:layoutPlanId/visual-generation',
  requireAuth,
  requirePermission('visual_generation:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const outputs = await store.generatedOutputs.listByLayoutPlan(req.params.layoutPlanId);
    res.json({ data: outputs, total: outputs.length });
  })
);

// GET /api/visual-outputs/:id
visualGenerationRouter.get(
  '/visual-outputs/:id',
  requireAuth,
  requirePermission('visual_generation:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const output = await store.generatedOutputs.getById(req.params.id);
    if (!output) return res.status(404).json({ error: 'Generated output not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, output.clientId);
    res.json({ data: output });
  })
);

// GET /api/visual-outputs/:id/file — authenticated, permission-checked access to the
// generated image bytes (this is what the persisted fileUrl points at). Same access
// pattern as brand-assets/design-references: local streams through this route, S3
// redirects to a short-lived signed URL. Only status 'generated' rows have a file —
// 'pending'/'failed' rows (or rows missing storage coordinates) are a 404, because the
// file was never produced.
visualGenerationRouter.get(
  '/visual-outputs/:id/file',
  requireAuth,
  requirePermission('visual_generation:read'),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const output = await store.generatedOutputs.getById(req.params.id);
    // Phase 3 Step 4 — client isolation hardening: checked as soon as we know
    // the record exists, before the combined not-found/status check below
    // reveals anything further about it.
    if (output) await assertClientAccessible(req.user!.id, output.clientId);
    if (
      !output ||
      output.status !== 'generated' ||
      !output.storageKey ||
      !output.storageProvider ||
      !output.storageBucket
    ) {
      return res.status(404).json({ error: 'File not found' });
    }

    const access = await getFileAccess(
      {
        storageProvider: output.storageProvider as StorageProviderName,
        storageKey: output.storageKey,
        storageBucket: output.storageBucket,
      },
      output.name,
      output.mimeType
    );

    if (access.kind === 'redirect') {
      return res.redirect(302, access.url);
    }

    res.setHeader('Content-Type', access.contentType ?? output.mimeType ?? 'application/octet-stream');
    if (access.contentLength != null) res.setHeader('Content-Length', String(access.contentLength));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(output.name)}"`);
    access.stream.on('error', next);
    access.stream.pipe(res);
  })
);

// POST /api/visual-outputs/:id/approve — human sign-off on a successfully generated
// visual. The repo guard only matches status = 'generated' rows with an open approval,
// so approving a 'failed'/'pending' row or re-approving is a 409 (mirrors creative-qa.ts).
visualGenerationRouter.post(
  '/visual-outputs/:id/approve',
  requireAuth,
  requirePermission('visual_generation:approve'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await store.generatedOutputs.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Generated output not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, existing.clientId);

    const approved = await store.generatedOutputs.approve(existing.id, req.user!.id);
    if (!approved) {
      return res.status(409).json({
        error: 'Generated output is not in an approvable state',
        status: existing.status,
        approvalStatus: existing.approvalStatus,
      });
    }
    res.json({ data: approved });
  })
);

// POST /api/visual-outputs/:id/reject — optional body { notes?: string }: notes present ->
// 'revision_requested', otherwise -> 'rejected' (mirrors creative-qa.ts's reject pattern;
// the mapping itself lives in the repo).
visualGenerationRouter.post(
  '/visual-outputs/:id/reject',
  requireAuth,
  requirePermission('visual_generation:reject'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await store.generatedOutputs.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Generated output not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, existing.clientId);

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    const rejected = await store.generatedOutputs.reject(existing.id, notes);
    if (!rejected) {
      return res.status(409).json({
        error: 'Generated output is not in a rejectable state',
        status: existing.status,
        approvalStatus: existing.approvalStatus,
      });
    }
    res.json({ data: rejected });
  })
);
