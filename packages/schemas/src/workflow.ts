import { z } from 'zod';

// ─── Workflow Definitions (Phase 2 Step 6) ───────────────
// Shape of the ten JSON workflow definitions in workflows/*.json, validated
// at server startup by apps/api/src/workflows/definition-loader.ts. Field
// names here are snake_case on purpose — they mirror the JSON files
// verbatim (the files are the source of truth, not the DB).
export const WorkflowStepTypeEnum = z.enum(['system', 'user_action', 'ai_task', 'approval_gate', 'worker_task']);
export type WorkflowStepType = z.infer<typeof WorkflowStepTypeEnum>;

export const WorkflowStepDefinitionSchema = z.object({
  step_id: z.string().min(1),
  order: z.number().int().positive(),
  action: z.string().min(1),
  type: WorkflowStepTypeEnum,
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  skill: z.string().nullable(),
  approval_required: z.boolean(),
  ai_provider_routing: z.string().optional(),
  condition: z.string().optional(),
  on_reject: z.string().optional(),
});
export type WorkflowStepDefinition = z.infer<typeof WorkflowStepDefinitionSchema>;

// Permissive on purpose: the JSON files carry ad-hoc extra keys per input
// (accepted_formats, default, format, ...) and free-form type strings.
export const WorkflowRequiredInputSchema = z
  .object({
    type: z.string(),
    required: z.boolean().optional(),
  })
  .passthrough();
export type WorkflowRequiredInput = z.infer<typeof WorkflowRequiredInputSchema>;

export const WorkflowFailureCaseSchema = z.object({
  case: z.string(),
  action: z.string(),
});
export type WorkflowFailureCase = z.infer<typeof WorkflowFailureCaseSchema>;

export const WorkflowDefinitionSchema = z
  .object({
    workflow_id: z.string().min(1),
    name: z.string().min(1),
    purpose: z.string().min(1),
    trigger: z.string().min(1),
    required_inputs: z.record(WorkflowRequiredInputSchema),
    steps: z.array(WorkflowStepDefinitionSchema).min(1),
    skills_used: z.array(z.string()),
    approval_required: z.boolean(),
    // Object keyed by output name; per-output shapes are ad-hoc (type/schema/stored_in/...).
    outputs: z.record(z.unknown()),
    failure_cases: z.array(WorkflowFailureCaseSchema),
    next_workflow: z.string().nullable(),
    status_tracking: z.array(z.string()).optional(),
  })
  .superRefine((def, ctx) => {
    const seenIds = new Set<string>();
    const seenOrders = new Set<number>();
    for (const step of def.steps) {
      if (seenIds.has(step.step_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `duplicate step_id '${step.step_id}'` });
      }
      seenIds.add(step.step_id);
      if (seenOrders.has(step.order)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `duplicate step order ${step.order}` });
      }
      seenOrders.add(step.order);
    }
  });
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ─── Workflow Runs (DB rows, camelCase) ──────────────────
export const WorkflowRunStatusEnum = z.enum([
  'draft', 'in_progress', 'waiting_for_approval', 'approved', 'completed',
  'failed', 'cancelled', 'qa_failed', 'blocked_future_feature',
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusEnum>;

export const WorkflowStepStatusEnum = z.enum([
  'pending', 'in_progress', 'waiting_for_approval', 'approved', 'rejected',
  'skipped', 'completed', 'failed',
]);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusEnum>;

export const WorkflowRunSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().min(1),
  clientId: z.string().uuid(),
  status: WorkflowRunStatusEnum,
  startedBy: z.string().uuid(),
  currentStepId: z.string().optional(),
  // Full validated definition at start time — runs survive later JSON edits.
  definitionSnapshot: WorkflowDefinitionSchema,
  inputJson: z.record(z.unknown()),
  outputJson: z.record(z.unknown()),
  errorJson: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkflowStepRecordSchema = z.object({
  id: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  stepId: z.string().min(1),
  stepName: z.string(),
  action: z.string(),
  stepOrder: z.number().int(),
  stepType: WorkflowStepTypeEnum,
  status: WorkflowStepStatusEnum,
  requiredPermission: z.string().optional(),
  requiredApproval: z.boolean(),
  skillIds: z.array(z.string()),
  inputJson: z.record(z.unknown()),
  outputJson: z.record(z.unknown()),
  errorJson: z.record(z.unknown()).optional(),
  revisionCount: z.number().int(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.string().datetime().optional(),
  rejectedBy: z.string().uuid().optional(),
  rejectedAt: z.string().datetime().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkflowStepRecord = z.infer<typeof WorkflowStepRecordSchema>;

export const StartWorkflowRunRequestSchema = z.object({
  clientId: z.string().uuid(),
  input: z.record(z.unknown()).optional(),
});
export type StartWorkflowRunRequest = z.infer<typeof StartWorkflowRunRequestSchema>;
