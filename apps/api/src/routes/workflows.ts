/**
 * Grafista AI Studio — Workflow Definitions API (Phase 2 Step 6)
 *
 * Serves the validated workflow catalog (workflows/*.json + skills + step
 * bindings) and starts persistent runs via the engine. The old in-memory
 * instance implementation is fully retired — run state now lives in
 * PostgreSQL (see routes/workflow-runs.ts and workflows/engine.ts).
 */

import { Router, Request, Response } from 'express';
import { StartWorkflowRunRequestSchema, type WorkflowDefinition } from '@grafista/schemas';
import { getWorkflowCatalog, type WorkflowCatalog } from '../workflows/catalog.js';
import { bindingPermission } from '../workflows/step-bindings.js';
import { startWorkflowRun } from '../workflows/engine.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';

export const workflowsRouter: Router = Router();

// Presentation-only icons (kept out of the JSON definitions on purpose — the
// files stay pure process definitions; the dashboard keeps its visuals).
const WORKFLOW_ICONS: Record<string, string> = {
  'client-onboarding': '🏢',
  'style-library-ingestion': '📐',
  'content-generation': '💡',
  'design-brief': '📋',
  'layout-generation': '🧩',
  'visual-generation': '🎨',
  'photoshop-production': '🖌️',
  'creative-qa': '✅',
  'revision-learning': '🧠',
  'monthly-content-calendar': '📅',
};

function summarizeDefinition(def: WorkflowDefinition, catalog: WorkflowCatalog) {
  const futureSteps: string[] = [];
  const gateSteps: string[] = [];
  for (const step of def.steps) {
    const binding = catalog.bindings.get(`${def.workflow_id}/${step.step_id}`);
    if (binding?.kind === 'future') futureSteps.push(step.step_id);
    if (binding?.kind === 'approval_gate') gateSteps.push(step.step_id);
  }
  return {
    workflowId: def.workflow_id,
    name: def.name,
    icon: WORKFLOW_ICONS[def.workflow_id] ?? '⚙️',
    purpose: def.purpose,
    trigger: def.trigger,
    nextWorkflow: def.next_workflow,
    stepCount: def.steps.length,
    approvalRequired: def.approval_required,
    skillsUsed: def.skills_used,
    executable: {
      supported: futureSteps.length === 0,
      futureSteps,
      gateSteps,
    },
  };
}

// GET /api/workflows — list all workflow definitions (validated catalog)
workflowsRouter.get(
  '/',
  requireAuth,
  requirePermission('workflows:read'),
  asyncHandler(async (_req: Request, res: Response) => {
    const catalog = getWorkflowCatalog();
    const data = catalog.definitions.map((def) => summarizeDefinition(def, catalog));
    res.json({ data, total: data.length });
  })
);

// GET /api/workflows/:workflowId — full definition + binding annotations + resolved skills
workflowsRouter.get(
  '/:workflowId',
  requireAuth,
  requirePermission('workflows:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const catalog = getWorkflowCatalog();
    const def = catalog.definitions.find((d) => d.workflow_id === req.params.workflowId);
    if (!def) return res.status(404).json({ error: 'Workflow not found' });

    const steps = def.steps.map((step) => {
      const binding = catalog.bindings.get(`${def.workflow_id}/${step.step_id}`);
      return {
        ...step,
        binding: binding
          ? {
              bindingKind: binding.kind,
              supported: binding.kind !== 'future',
              futureMessage: binding.kind === 'future' ? binding.message : undefined,
              requiredPermission: bindingPermission(binding),
              skillIds: [...new Set([step.skill, step.ai_provider_routing].filter((s): s is string => !!s))],
            }
          : undefined,
      };
    });

    const skills = def.skills_used
      .map((id) => catalog.skills.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({ id: s.id, name: s.name, description: s.description, whenToUse: s.whenToUse }));

    res.json({
      data: {
        ...summarizeDefinition(def, catalog),
        requiredInputs: def.required_inputs,
        outputs: def.outputs,
        failureCases: def.failure_cases,
        statusTracking: def.status_tracking,
        steps,
        skills,
      },
    });
  })
);

// POST /api/workflows/:workflowId/start — start a persistent workflow run
workflowsRouter.post(
  '/:workflowId/start',
  requireAuth,
  requirePermission('workflows:start'),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = StartWorkflowRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    const result = await startWorkflowRun({
      workflowId: req.params.workflowId,
      clientId: parsed.data.clientId,
      input: parsed.data.input ?? {},
      user: req.user!,
    });

    res.status(201).json({ data: result });
  })
);
