/**
 * Grafista AI Studio — Workflow Runs API (Phase 2 Step 6)
 *
 * PostgreSQL-backed run inspection and control surface for the workflow
 * engine (workflows/engine.ts): list/detail, advance one step, decide
 * approval gates, cancel. All state transitions happen inside the engine
 * with guarded UPDATEs — these routes only validate the HTTP surface.
 */

import { Router, Request, Response } from 'express';
import { store } from '../data/store.js';
import {
  advanceWorkflowRun,
  approveWorkflowStep,
  cancelWorkflowRun,
  rejectWorkflowStep,
} from '../workflows/engine.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';

export const workflowRunsRouter: Router = Router();

// GET /api/workflow-runs — list runs (filters: clientId, workflowId, status)
workflowRunsRouter.get(
  '/',
  requireAuth,
  requirePermission('workflows:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const runs = await store.workflowRuns.list({
      clientId: req.query.clientId as string | undefined,
      workflowId: req.query.workflowId as string | undefined,
      status: req.query.status as string | undefined,
    });
    res.json({ data: runs, total: runs.length });
  })
);

// GET /api/workflow-runs/:id — run + steps + outputs + approvals + definition snapshot
workflowRunsRouter.get(
  '/:id',
  requireAuth,
  requirePermission('workflows:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const run = await store.workflowRuns.getById(req.params.id);
    if (!run) return res.status(404).json({ error: 'Workflow run not found' });

    const [steps, outputs, approvals, client] = await Promise.all([
      store.workflowSteps.listByRun(run.id),
      store.workflowStepOutputs.listByRun(run.id),
      store.workflowApprovals.listByRun(run.id),
      store.clients.getById(run.clientId),
    ]);

    res.json({
      data: {
        run: { ...run, clientName: client?.name, workflowName: run.definitionSnapshot.name },
        steps,
        outputs,
        approvals,
        definition: run.definitionSnapshot,
      },
    });
  })
);

// GET /api/workflow-runs/:id/steps — just the step rows
workflowRunsRouter.get(
  '/:id/steps',
  requireAuth,
  requirePermission('workflows:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const run = await store.workflowRuns.getById(req.params.id);
    if (!run) return res.status(404).json({ error: 'Workflow run not found' });
    const steps = await store.workflowSteps.listByRun(run.id);
    res.json({ data: steps, total: steps.length });
  })
);

// POST /api/workflow-runs/:id/advance — execute the current step
workflowRunsRouter.post(
  '/:id/advance',
  requireAuth,
  requirePermission('workflows:advance'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = (req.body?.input ?? undefined) as Record<string, unknown> | undefined;
    const result = await advanceWorkflowRun({ runId: req.params.id, input, user: req.user! });
    res.json({ data: result });
  })
);

// POST /api/workflow-runs/:id/approve-step — decide the waiting approval gate
workflowRunsRouter.post(
  '/:id/approve-step',
  requireAuth,
  requirePermission('workflows:approve'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await approveWorkflowStep({
      runId: req.params.id,
      body: {
        contentIdeaId: typeof req.body?.contentIdeaId === 'string' ? req.body.contentIdeaId : undefined,
        layoutPlanId: typeof req.body?.layoutPlanId === 'string' ? req.body.layoutPlanId : undefined,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
      },
      user: req.user!,
    });
    res.json({ data: result });
  })
);

// POST /api/workflow-runs/:id/reject-step — reject at the waiting approval gate
workflowRunsRouter.post(
  '/:id/reject-step',
  requireAuth,
  requirePermission('workflows:approve'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await rejectWorkflowStep({
      runId: req.params.id,
      body: {
        contentIdeaId: typeof req.body?.contentIdeaId === 'string' ? req.body.contentIdeaId : undefined,
        layoutPlanId: typeof req.body?.layoutPlanId === 'string' ? req.body.layoutPlanId : undefined,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
      },
      user: req.user!,
    });
    res.json({ data: result });
  })
);

// POST /api/workflow-runs/:id/cancel — abort a non-terminal run
workflowRunsRouter.post(
  '/:id/cancel',
  requireAuth,
  requirePermission('workflows:cancel'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await cancelWorkflowRun({ runId: req.params.id, user: req.user! });
    res.json({ data: result });
  })
);
