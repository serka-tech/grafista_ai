/**
 * Grafista AI Studio — Workflow Engine (Phase 2 Step 6)
 *
 * Synchronous, PostgreSQL-backed execution of the ten JSON workflow
 * definitions: one API call advances exactly one step; every transition is
 * a guarded single-statement UPDATE (see the workflow-* repositories), so
 * the full run state survives an API restart by construction. No queues,
 * no cron, no background execution.
 *
 * Non-negotiables enforced here:
 *  - Approval gates perform REAL domain approvals via the existing repos
 *    (designDnaRepo.approve, approvals.create + setApprovalOutcome,
 *    designBriefsRepo.updateStatus, layoutPlansRepo.approve/reject,
 *    creativeQaReportsRepo.approve/reject) and cannot be skipped: advance
 *    on a waiting gate is a 409, approve-step with nothing waiting is a 409.
 *  - Unimplemented features block the run as 'blocked_future_feature' with
 *    a clear message — never faked as success.
 *  - Step execution failures persist step+run failure state, then rethrow
 *    the ORIGINAL error so the HTTP status stays correct (502 AI failure,
 *    409 gate, ...).
 */

import { v4 as uuid } from 'uuid';
import type { WorkflowRun, WorkflowStepRecord } from '@grafista/schemas';
import type { UserWithAccess } from '../db/repositories/users.js';
import { store } from '../data/store.js';
import { getWorkflowCatalog } from './catalog.js';
import { buildSkillStepContext } from './skill-loader.js';
import {
  bindingPermission,
  type ApprovalGateKind,
  type QaReportFact,
  type StepBinding,
  type StepExecutionContext,
  type StepExecutionResult,
} from './step-bindings.js';
import { runDesignDnaAnalysis } from '../services/design-dna-analysis.js';
import { runContentIdeation, ContentIdeationRequestSchema } from '../services/content-ideation.js';
import { createDesignBriefFromContentIdea } from '../services/design-brief-creation.js';
import { runLayoutGeneration } from '../services/layout-generation.js';
import { runCreativeQa } from '../services/creative-qa.js';
import { runVisualGeneration } from '../services/visual-generation.js';
import { assertReadyForVisualProduction } from '../services/production-gate.js';

// ─── Error helpers (same error-with-status pattern as the services) ─────────

function badRequest(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}

function conflict(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 409 });
}

function notFound(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 404 });
}

function forbidden(permission: string, stepId: string): Error & { status: number } {
  return Object.assign(new Error(`Forbidden — missing permission '${permission}' required by step ${stepId}`), { status: 403 });
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

export interface RunWithSteps {
  run: WorkflowRun;
  steps: WorkflowStepRecord[];
}

export interface ApproveStepBody {
  contentIdeaId?: string;
  layoutPlanId?: string;
  generatedOutputId?: string;
  notes?: string;
}

export type RejectStepBody = ApproveStepBody;

export async function getRunWithSteps(runId: string): Promise<RunWithSteps> {
  const run = await store.workflowRuns.getById(runId);
  if (!run) throw notFound('Workflow run not found');
  const steps = await store.workflowSteps.listByRun(runId);
  return { run, steps };
}

function stepBindingFor(workflowId: string, stepId: string): StepBinding {
  const binding = getWorkflowCatalog().bindings.get(`${workflowId}/${stepId}`);
  if (!binding) {
    // Catalog validation guarantees this for current definitions — this can only
    // trip for a run snapshot whose step no longer has a registered binding.
    throw Object.assign(new Error(`No step binding registered for ${workflowId}/${stepId}`), { status: 500 });
  }
  return binding;
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** 409 explaining WHY a terminal/blocked run cannot advance (stored reason included). */
function assertRunNotTerminal(run: WorkflowRun): void {
  const storedMessage = run.errorJson && typeof run.errorJson.message === 'string' ? ` — ${run.errorJson.message}` : '';
  switch (run.status) {
    case 'completed':
      throw conflict('Workflow run is already completed');
    case 'cancelled':
      throw conflict('Workflow run has been cancelled');
    case 'failed':
      throw conflict(`Workflow run has failed${storedMessage}`);
    case 'qa_failed':
      throw conflict(`Workflow run is blocked after a failed Creative QA${storedMessage}`);
    case 'blocked_future_feature':
      throw conflict(`Workflow run is blocked on a future feature that is not implemented yet${storedMessage}`);
    default:
      return;
  }
}

/** Entity ids of a given type this run recorded so far (newest first). */
async function runEntityIds(runId: string, entityType: string): Promise<string[]> {
  const outputs = await store.workflowStepOutputs.findByRunAndEntityType(runId, entityType);
  return outputs.map((o) => o.entityId).filter((id): id is string => typeof id === 'string');
}

async function loadRunQaReport(runId: string) {
  const reportId = (await runEntityIds(runId, 'creative_qa_report'))[0];
  return reportId ? store.creativeQaReports.getById(reportId) : undefined;
}

async function loadRunDesignBriefId(run: WorkflowRun): Promise<string | undefined> {
  if (typeof run.outputJson.designBriefId === 'string') return run.outputJson.designBriefId;
  return (await runEntityIds(run.id, 'design_brief'))[0];
}

// ─── Arming: park the run on its next pending step ──────────────────────────

/**
 * Applied after start and after each step completes/skips/approves: finds the
 * next pending step and parks the run in the right status for it (waiting on a
 * gate, blocked on a future feature, in_progress on an executable step, or
 * completed when nothing is left).
 */
async function armNextStep(runId: string): Promise<void> {
  const run = await store.workflowRuns.getById(runId);
  if (!run) throw notFound('Workflow run not found');
  const steps = await store.workflowSteps.listByRun(runId);
  const next = steps.find((s) => s.status === 'pending');

  if (!next) {
    const outputs = await store.workflowStepOutputs.listByRun(runId);
    const doneStatuses = new Set(['completed', 'approved', 'skipped']);
    await store.workflowRuns.markCompleted(runId, {
      summary: {
        completedSteps: steps.filter((s) => doneStatuses.has(s.status)).length,
        entities: outputs.map((o) => ({ entityType: o.entityType, entityId: o.entityId ?? null })),
      },
    });
    return;
  }

  const binding = stepBindingFor(run.workflowId, next.stepId);

  if (binding.kind === 'approval_gate') {
    // ARRIVAL RULE (creative-qa): a failed report scoring < 50 blocks the run as
    // qa_failed — the gate stays pending instead of opening for approval.
    if (binding.gate === 'creative_qa') {
      const report = await loadRunQaReport(runId);
      if (report && report.status === 'failed' && report.overallScore < 50) {
        await store.workflowRuns.setCurrentStep(runId, next.stepId);
        await store.workflowRuns.markQaFailed(runId, {
          reason: 'qa_score_below_50',
          creativeQaReportId: report.id,
          score: report.overallScore,
          message: `Creative QA skoru ${report.overallScore} (< 50) — onay kapısı açılamaz; düzeltme sonrası yeni bir creative-qa çalıştırması gerekiyor`,
        });
        return;
      }
    }
    await store.workflowSteps.wait(next.id);
    await store.workflowRuns.setCurrentStep(runId, next.stepId);
    await store.workflowRuns.markWaiting(runId);
    return;
  }

  if (binding.kind === 'future') {
    await store.workflowSteps.setOutput(next.id, { futureFeature: true, feature: binding.feature, message: binding.message });
    const error: Record<string, unknown> = { feature: binding.feature, message: binding.message };
    // If the production gate check already passed in THIS run, surface that the
    // pipeline itself is clear — only the feature implementation is missing.
    const gateCleared = steps.some(
      (s) => s.status === 'completed' && s.outputJson.pipelineState === 'ready_for_visual_generation'
    );
    if (gateCleared) error.pipelineState = 'ready_for_visual_generation';
    await store.workflowRuns.setCurrentStep(runId, next.stepId);
    await store.workflowRuns.markBlockedFuture(runId, error);
    return;
  }

  // Executable (or skippable) step: stays 'pending' until the next advance call.
  await store.workflowRuns.setCurrentStep(runId, next.stepId);
  await store.workflowRuns.markInProgress(runId);
}

// ─── Start ───────────────────────────────────────────────────────────────────

export async function startWorkflowRun(params: {
  workflowId: string;
  clientId: string;
  input: Record<string, unknown>;
  user: UserWithAccess;
}): Promise<RunWithSteps> {
  const catalog = getWorkflowCatalog();
  const def = catalog.definitions.find((d) => d.workflow_id === params.workflowId);
  if (!def) throw notFound('Workflow not found');

  const client = await store.clients.getById(params.clientId);
  if (!client) throw notFound('Client not found');

  const missing: string[] = [];
  for (const [key, spec] of Object.entries(def.required_inputs)) {
    if (!spec.required) continue;
    if (key === 'client_id' || key === 'client_name') continue; // auto-filled from the client
    const value = params.input[key];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw badRequest(`Missing required workflow inputs: ${missing.join(', ')}`);
  }

  const effectiveInput = { ...params.input, client_id: params.clientId, client_name: client.name };

  const run = await store.workflowRuns.create({
    id: uuid(),
    workflowId: def.workflow_id,
    clientId: params.clientId,
    startedBy: params.user.id,
    definitionSnapshot: def,
    input: effectiveInput,
  });

  const orderedSteps = [...def.steps].sort((a, b) => a.order - b.order);
  await store.workflowSteps.createMany(
    orderedSteps.map((stepDef) => {
      const binding = stepBindingFor(def.workflow_id, stepDef.step_id);
      const stepInput: Record<string, unknown> = {};
      if (stepDef.type === 'ai_task' && stepDef.skill) {
        const skill = catalog.skills.get(stepDef.skill);
        if (skill) stepInput.skillContext = buildSkillStepContext(skill);
      }
      return {
        id: uuid(),
        workflowRunId: run.id,
        stepId: stepDef.step_id,
        stepName: stepDef.action,
        action: stepDef.action,
        stepOrder: stepDef.order,
        stepType: stepDef.type,
        requiredPermission: bindingPermission(binding),
        requiredApproval: stepDef.approval_required,
        skillIds: [...new Set([stepDef.skill, stepDef.ai_provider_routing].filter((s): s is string => !!s))],
        input: stepInput,
      };
    })
  );

  await armNextStep(run.id);
  return getRunWithSteps(run.id);
}

// ─── Advance (execute the current step) ──────────────────────────────────────

export async function advanceWorkflowRun(params: {
  runId: string;
  input?: Record<string, unknown>;
  user: UserWithAccess;
}): Promise<RunWithSteps> {
  const run = await store.workflowRuns.getById(params.runId);
  if (!run) throw notFound('Workflow run not found');

  assertRunNotTerminal(run);
  if (run.status === 'waiting_for_approval') {
    throw conflict('Current step is an approval gate — use approve-step or reject-step');
  }
  if (!run.currentStepId) {
    throw conflict('Workflow run has no executable current step');
  }

  const step = await store.workflowSteps.getByRunAndStepId(run.id, run.currentStepId);
  if (!step) {
    throw conflict('Step is not in an executable state');
  }
  if (step.status === 'completed' || step.status === 'skipped') {
    // Self-heal: a prior advance completed/skipped this step (complete()/skip() succeeded)
    // but the process died — or a later write threw — before armNextStep ran, leaving
    // current_step_id stale while the run stayed 'in_progress'. Re-arming here is
    // idempotent (armNextStep only ever reads current DB state), so retrying the same
    // advance call recovers the run instead of 409ing forever.
    await armNextStep(run.id);
    return getRunWithSteps(run.id);
  }
  if (step.status !== 'pending') {
    throw conflict('Step is not in an executable state');
  }

  const binding = stepBindingFor(run.workflowId, step.stepId);

  const permission = bindingPermission(binding);
  if (permission && !params.user.permissions.includes(permission)) {
    throw forbidden(permission, step.stepId);
  }

  // Defensive — arming rules park runs on gates/future steps with a non-in_progress
  // run status, so these should be unreachable via advance.
  if (binding.kind === 'approval_gate') {
    throw conflict('Current step is an approval gate — use approve-step or reject-step');
  }
  if (binding.kind === 'future') {
    throw conflict(`Bu adım henüz uygulanmamış bir özelliğe ait — ${binding.message}`);
  }

  if (binding.kind === 'skip') {
    const skipped = await store.workflowSteps.skip(step.id, { skipped: true, note: binding.note });
    if (!skipped) throw conflict('Step is not in an executable state');
    await armNextStep(run.id);
    return getRunWithSteps(run.id);
  }

  const begun = await store.workflowSteps.begin(step.id);
  if (!begun) {
    throw conflict('Step is not in an executable state');
  }

  const ctx: StepExecutionContext = {
    run,
    step: begun,
    user: params.user,
    input: { ...run.inputJson, ...(params.input ?? {}) },
  };

  let result: StepExecutionResult;
  try {
    result = await executeBinding(binding, ctx);
  } catch (err) {
    // Persist the failure on both step and run, THEN rethrow the original error
    // so the client still gets the real status (502 AI failure, 409 gate, ...).
    const e = err as Error & { status?: number };
    await store.workflowSteps.fail(step.id, { message: e.message, status: e.status ?? 500 });
    const runError: Record<string, unknown> =
      binding.kind === 'production_gate_check'
        ? { pipelineState: 'blocked_by_qa', message: e.message, stepId: step.stepId }
        : { message: e.message, status: e.status ?? 500, stepId: step.stepId };
    await store.workflowRuns.markFailed(run.id, runError);
    throw err;
  }

  if (result.skippedNote) {
    await store.workflowSteps.skip(step.id, { skipped: true, note: result.skippedNote });
  } else {
    await store.workflowSteps.complete(step.id, result.output);
  }

  for (const entity of result.entities ?? []) {
    await store.workflowStepOutputs.create({
      id: uuid(),
      workflowStepId: step.id,
      workflowRunId: run.id,
      entityType: entity.entityType,
      entityId: entity.entityId,
      outputKey: entity.outputKey,
      outputJson: entity.outputJson,
    });
  }
  if (result.runOutput) {
    await store.workflowRuns.mergeOutput(run.id, result.runOutput);
  }

  await armNextStep(run.id);
  return getRunWithSteps(run.id);
}

/** Executes one non-gate binding — real services, real repositories, no fakes. */
async function executeBinding(binding: StepBinding, ctx: StepExecutionContext): Promise<StepExecutionResult> {
  switch (binding.kind) {
    case 'record_context':
      return binding.exec(ctx);

    case 'run_design_dna_analysis': {
      const { designDna, analyses } = await runDesignDnaAnalysis(ctx.run.clientId, ctx.user.id);
      return {
        output: {
          designDnaId: designDna.id,
          version: designDna.version,
          status: designDna.status,
          confidenceScore: designDna.confidenceScore ?? null,
          analysesCount: analyses.length,
          note: 'Bu servis çağrısı referans analizleriyle birlikte DesignDNA sentezini de çalıştırdı — generate_dna adımı sonucu doğrular',
        },
        entities: [{ entityType: 'design_dna', entityId: designDna.id, outputKey: 'design_dna_draft' }],
        runOutput: { designDnaId: designDna.id },
      };
    }

    case 'generate_content_ideas': {
      const details = ctx.run.outputJson.campaignDetails;
      if (!details || typeof details !== 'object') {
        throw conflict('Kampanya detayları bulunamadı — enter_campaign_details adımı önce çalışmalı');
      }
      const d = details as Record<string, unknown>;
      const parsed = ContentIdeationRequestSchema.safeParse({
        campaignName: d.campaign_goal,
        platform: d.platform,
        format: d.format,
        topic: d.topic,
        targetAudience: d.target_audience,
        mood: d.mood,
        optionCount: d.option_count,
      });
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw badRequest(`Invalid campaign details: ${issues}`);
      }
      const result = await runContentIdeation(ctx.run.clientId, ctx.user.id, parsed.data);
      return {
        output: {
          ideaCount: result.ideas.length,
          ideas: result.ideas.map((i) => ({ id: i.id, title: i.title, status: i.status })),
          provider: result.provider,
          model: result.model,
        },
        entities: result.ideas.map((i) => ({ entityType: 'content_idea', entityId: i.id, outputKey: 'content_idea' })),
      };
    }

    case 'create_design_brief': {
      const contentIdeaId =
        typeof ctx.run.outputJson.contentIdeaId === 'string' ? ctx.run.outputJson.contentIdeaId : stringField(ctx.input, 'content_idea_id');
      if (!contentIdeaId) {
        throw conflict('Content idea bulunamadı — load_content adımı önce çalışmalı');
      }
      const brief = await createDesignBriefFromContentIdea(contentIdeaId);
      return {
        output: { designBriefId: brief.id, title: brief.title, status: brief.status, platform: brief.platform, format: brief.format },
        entities: [{ entityType: 'design_brief', entityId: brief.id, outputKey: 'design_brief_draft' }],
        runOutput: { designBriefId: brief.id },
      };
    }

    case 'generate_layout_plans': {
      const designBriefId =
        typeof ctx.run.outputJson.designBriefId === 'string' ? ctx.run.outputJson.designBriefId : stringField(ctx.input, 'design_brief_id');
      if (!designBriefId) {
        throw conflict('Design brief bulunamadı — load_brief adımı önce çalışmalı');
      }
      const { layoutPlans } = await runLayoutGeneration(designBriefId, ctx.user.id);
      return {
        output: {
          layoutPlanCount: layoutPlans.length,
          layoutPlans: layoutPlans.map((p) => ({ id: p.id, alternativeIndex: p.alternativeIndex, status: p.status })),
        },
        entities: layoutPlans.map((p) => ({ entityType: 'layout_plan', entityId: p.id, outputKey: 'layout_plan' })),
        runOutput: { layoutPlanIds: layoutPlans.map((p) => p.id) },
      };
    }

    case 'run_creative_qa': {
      const layoutPlanId = stringField(ctx.input, 'layout_plan_id');
      if (!layoutPlanId) {
        throw badRequest('layout_plan_id is required to run the creative-qa workflow');
      }
      const designBriefId = stringField(ctx.input, 'design_brief_id');
      if (designBriefId) {
        const plan = await store.layoutPlans.getById(layoutPlanId);
        if (!plan) throw notFound('Layout plan not found');
        if (plan.designBriefId !== designBriefId) {
          throw conflict(`Layout plan ${layoutPlanId} does not belong to design brief ${designBriefId}`);
        }
      }
      const { report } = await runCreativeQa(layoutPlanId, ctx.user.id);
      return {
        output: {
          creativeQaReportId: report.id,
          status: report.status,
          score: report.overallScore,
          passed: report.passed,
          brandConsistency: report.brandConsistency,
          clientStyleMatch: report.designDnaMatch,
          note: 'Tek AI çağrısı 11 kontrolün tamamını kapsar — sonraki kontrol adımları bu rapordan okunur, yeni AI çağrısı yapılmaz',
        },
        entities: [{ entityType: 'creative_qa_report', entityId: report.id, outputKey: 'qa_report' }],
        runOutput: { creativeQaReportId: report.id },
      };
    }

    case 'production_gate_check': {
      const layoutPlanId = stringField(ctx.input, 'layout_plan_id');
      if (!layoutPlanId) {
        throw conflict('layout_plan_id is required — the production gate needs an approved layout plan with a cleared Creative QA report');
      }
      const plan = await store.layoutPlans.getById(layoutPlanId);
      if (!plan) throw notFound('Layout plan not found');
      if (plan.clientId !== ctx.run.clientId) {
        throw conflict('Layout plan does not belong to this client');
      }
      if (plan.status !== 'approved') {
        throw conflict(`Layout plan must be approved before visual production (current status: ${plan.status})`);
      }
      await assertReadyForVisualProduction(layoutPlanId);
      return {
        output: { pipelineState: 'ready_for_visual_generation', layoutPlanId },
        runOutput: { pipelineState: 'ready_for_visual_generation' },
      };
    }

    case 'run_visual_generation': {
      const layoutPlanId = stringField(ctx.input, 'layout_plan_id');
      if (!layoutPlanId) {
        throw conflict('layout_plan_id is required — visual generation renders one approved, QA-cleared layout plan');
      }
      const plan = await store.layoutPlans.getById(layoutPlanId);
      if (!plan) throw notFound('Layout plan not found');
      if (plan.clientId !== ctx.run.clientId) {
        throw conflict('Layout plan does not belong to this client');
      }
      // The service re-checks the production gate as its own first await (409 unless a
      // Creative QA report is 'approved'/'passed') and PERSISTS failures: a provider/
      // schema failure writes a 'failed' generated_outputs row then rethrows (502); a
      // per-image download/storage failure records that image as 'failed' and continues,
      // so `outputs` here can mix 'generated' and 'failed' rows — both are recorded as
      // run entities so failures stay visible in the workflow trail too.
      const { outputs } = await runVisualGeneration(layoutPlanId, ctx.user.id);
      return {
        output: {
          outputCount: outputs.length,
          generatedCount: outputs.filter((o) => o.status === 'generated').length,
          failedCount: outputs.filter((o) => o.status === 'failed').length,
          outputs: outputs.map((o) => ({ id: o.id, alternativeIndex: o.alternativeIndex, status: o.status })),
          note: 'Tek servis çağrısı prompt üretimini VE görsel üretimini kapsar — route_generation adımı bu sonucu kaydeder, yeni AI çağrısı yapılmaz',
        },
        entities: outputs.map((o) => ({ entityType: 'generated_output', entityId: o.id, outputKey: 'generated_output' })),
        runOutput: { generatedOutputIds: outputs.map((o) => o.id) },
      };
    }

    case 'qa_report_fact':
      return executeQaReportFact(binding.fact, ctx);

    default:
      // approval_gate / future / skip are handled before execution reaches here.
      throw conflict('Step binding cannot be executed via advance');
  }
}

/** Reads a real fact from the run's already-produced CreativeQAReport — no new AI call. */
async function executeQaReportFact(fact: QaReportFact, ctx: StepExecutionContext): Promise<StepExecutionResult> {
  const report = await loadRunQaReport(ctx.run.id);
  if (!report) {
    throw conflict('Creative QA raporu bulunamadı — brand_consistency adımı önce çalışmalı');
  }
  const base = {
    creativeQaReportId: report.id,
    note: 'Bu kontrol brand_consistency adımında üretilen rapordan okundu — yeni AI çağrısı yapılmadı',
  };
  switch (fact) {
    case 'logo':
      return { output: { ...base, check: report.logoSafetyArea } };
    case 'typography':
      return { output: { ...base, check: report.typographyConsistency } };
    case 'spelling':
      return { output: { ...base, check: report.spelling } };
    case 'mobile':
      return { output: { ...base, check: report.mobileLegibility } };
    case 'hierarchy':
      return { output: { ...base, check: report.visualHierarchy } };
    case 'dna_match':
      return { output: { ...base, check: report.designDnaMatch, designDnaReasons: report.designDnaReasons } };
    case 'score':
      return {
        output: {
          ...base,
          overallScore: report.overallScore,
          overallStatus: report.overallStatus,
          passed: report.passed,
          passThreshold: report.passThreshold,
          scores: report.scores,
        },
      };
    case 'recommendations': {
      if (report.overallScore >= 80) {
        return { output: {}, skippedNote: 'Skor >= 80, öneri gerekmiyor' };
      }
      return {
        output: {
          ...base,
          highPriorityFixes: report.highPriorityFixes,
          mediumPriorityFixes: report.mediumPriorityFixes,
          lowPriorityFixes: report.lowPriorityFixes,
          recommendations: report.recommendations,
        },
      };
    }
  }
}

/** Binding kinds that actually RE-EXECUTE generation (as opposed to merely verifying a
 *  prior result or recording bookkeeping) — see resolveRevisionTargetOrder(). */
const REGENERATING_BINDING_KINDS = new Set<StepBinding['kind']>([
  'run_design_dna_analysis',
  'generate_content_ideas',
  'create_design_brief',
  'generate_layout_plans',
  'run_creative_qa',
  'run_visual_generation',
]);

/**
 * The literal step order named by on_reject (e.g. `return_to_step_6`) sometimes points at a
 * bookkeeping/verification step rather than the step that actually regenerates the rejected
 * entity — e.g. style-library-ingestion's gate says `return_to_step_6` (generate_dna, a
 * record_context step that only VERIFIES the DesignDNA analyze_styles already produced),
 * while the real regeneration happens at order 4 (analyze_styles). Resetting to a
 * verification step whose precondition the rejection itself just broke (DNA now
 * 'needs_revision', not 'generated') guarantees the next advance 409s the run into 'failed'.
 * Walk backward from the literal target to the nearest step whose binding actually
 * re-executes generation, so the revision loop always lands somewhere the next advance can
 * succeed. Loops that already target a regenerating step (design-brief, layout-generation)
 * are unaffected — the literal order already satisfies the search.
 */
function resolveRevisionTargetOrder(run: WorkflowRun, literalOrder: number): number {
  const steps = [...run.definitionSnapshot.steps].sort((a, b) => b.order - a.order);
  for (const stepDef of steps) {
    if (stepDef.order > literalOrder) continue;
    const binding = getWorkflowCatalog().bindings.get(`${run.workflowId}/${stepDef.step_id}`);
    if (binding && REGENERATING_BINDING_KINDS.has(binding.kind)) {
      return stepDef.order;
    }
  }
  return literalOrder;
}

// ─── Approval gates ──────────────────────────────────────────────────────────

interface GateDecisionResult {
  entityType: string;
  entityId?: string;
  output: Record<string, unknown>;
}

/** Loads the gate step currently waiting for a decision (or 409s). */
async function loadWaitingGate(runId: string): Promise<{
  run: WorkflowRun;
  step: WorkflowStepRecord;
  binding: Extract<StepBinding, { kind: 'approval_gate' }>;
}> {
  const run = await store.workflowRuns.getById(runId);
  if (!run) throw notFound('Workflow run not found');
  if (run.status !== 'waiting_for_approval' || !run.currentStepId) {
    throw conflict('No step is waiting for approval');
  }
  const step = await store.workflowSteps.getByRunAndStepId(run.id, run.currentStepId);
  if (!step || step.status !== 'waiting_for_approval') {
    throw conflict('No step is waiting for approval');
  }
  const binding = stepBindingFor(run.workflowId, step.stepId);
  if (binding.kind !== 'approval_gate') {
    throw conflict('No step is waiting for approval');
  }
  return { run, step, binding };
}

export async function approveWorkflowStep(params: { runId: string; body: ApproveStepBody; user: UserWithAccess }): Promise<RunWithSteps> {
  const { run, step, binding } = await loadWaitingGate(params.runId);

  if (!params.user.permissions.includes(binding.approvePermission)) {
    throw forbidden(binding.approvePermission, step.stepId);
  }
  if (binding.gate === 'brand_profile_future') {
    throw conflict('Bu onay kapısı henüz uygulanmamış bir özelliğe ait');
  }

  const decision = await performGateApproval(binding.gate, run, params.body, params.user);

  // Guarded transition (waiting_for_approval -> approved) is the concurrency claim: check
  // its result and bail BEFORE writing any audit/output rows or re-arming the run, so a
  // lost race (e.g. a concurrent reject-step call already moved the step on) surfaces as a
  // clean 409 instead of leaving a duplicate audit trail / double-armed run behind.
  const approvedStep = await store.workflowSteps.approve(step.id, params.user.id, decision.output);
  if (!approvedStep) {
    throw conflict('No step is waiting for approval');
  }

  await store.workflowApprovals.create({
    id: uuid(),
    workflowRunId: run.id,
    workflowStepId: step.id,
    decision: 'approved',
    decidedBy: params.user.id,
    entityType: decision.entityType,
    entityId: decision.entityId,
    notes: params.body.notes,
  });
  await store.workflowStepOutputs.create({
    id: uuid(),
    workflowStepId: step.id,
    workflowRunId: run.id,
    entityType: decision.entityType,
    entityId: decision.entityId,
    outputKey: 'approved_entity',
  });

  await armNextStep(run.id);
  return getRunWithSteps(run.id);
}

async function performGateApproval(
  gate: Exclude<ApprovalGateKind, 'brand_profile_future'>,
  run: WorkflowRun,
  body: ApproveStepBody,
  user: UserWithAccess
): Promise<GateDecisionResult> {
  switch (gate) {
    case 'design_dna': {
      const latest = await store.designDna.getLatestByClientId(run.clientId);
      if (!latest) throw conflict('Design DNA not found — run the analyze_styles step first');
      const approved = await store.designDna.approve(latest.id, user.id);
      if (!approved) {
        throw conflict(`Design DNA is not in an approvable state (current status: ${latest.status})`);
      }
      return {
        entityType: 'design_dna',
        entityId: approved.id,
        output: { approved: true, designDnaId: approved.id, version: approved.version, status: approved.status },
      };
    }

    case 'content_idea': {
      const generatedIds = await runEntityIds(run.id, 'content_idea');
      if (body.contentIdeaId) {
        if (!generatedIds.includes(body.contentIdeaId)) {
          throw conflict('Content idea does not belong to this workflow run');
        }
        const idea = await store.contentIdeas.getById(body.contentIdeaId);
        if (!idea) throw notFound('Content idea not found');
        if (idea.status !== 'pending_approval') {
          throw conflict(`Content idea is not awaiting approval (current status: ${idea.status})`);
        }
        // Same semantics as POST /api/content-ideas/:id/approve: approvals row + status flip.
        const approval = await store.approvals.create({
          id: uuid(),
          entityType: 'content_idea',
          entityId: idea.id,
          clientId: idea.clientId,
          status: 'approved',
          reviewerRole: 'creative_director',
          reviewerName: user.name,
          notes: body.notes,
          approvedAt: new Date(),
        });
        const updated = await store.contentIdeas.setApprovalOutcome(idea.id, 'approved', approval.id);
        return {
          entityType: 'content_idea',
          entityId: idea.id,
          output: { approved: true, contentIdeaId: idea.id, approvalId: approval.id, status: updated?.status ?? 'approved' },
        };
      }
      // No id given: at least one of the run's generated ideas must already be approved.
      const ideas = [];
      for (const id of generatedIds) {
        const idea = await store.contentIdeas.getById(id);
        if (idea) ideas.push(idea);
      }
      const approvedIdeas = ideas.filter((i) => i.status === 'approved');
      if (approvedIdeas.length === 0) {
        throw conflict(
          'Approve at least one generated content idea first (provide contentIdeaId or use POST /api/content-ideas/:id/approve)'
        );
      }
      return {
        entityType: 'content_idea',
        entityId: approvedIdeas[0].id,
        output: { approved: true, approvedIdeaIds: approvedIdeas.map((i) => i.id) },
      };
    }

    case 'design_brief': {
      const briefId = await loadRunDesignBriefId(run);
      const brief = briefId ? await store.designBriefs.getById(briefId) : undefined;
      if (!brief) throw conflict('Design brief not found in this run — run the generate_brief step first');
      const updated = await store.designBriefs.updateStatus(brief.id, 'approved');
      return {
        entityType: 'design_brief',
        entityId: brief.id,
        output: { approved: true, designBriefId: brief.id, status: updated?.status ?? 'approved' },
      };
    }

    case 'layout_plan': {
      if (!body.layoutPlanId) {
        throw badRequest('layoutPlanId is required to approve a layout plan');
      }
      const generatedIds = await runEntityIds(run.id, 'layout_plan');
      if (!generatedIds.includes(body.layoutPlanId)) {
        throw conflict('Layout plan does not belong to this workflow run');
      }
      const plan = await store.layoutPlans.getById(body.layoutPlanId);
      if (!plan) throw notFound('Layout plan not found');
      const approved = await store.layoutPlans.approve(plan.id, user.id);
      if (!approved) {
        throw conflict(`Layout plan is not in an approvable state (current status: ${plan.status})`);
      }
      return {
        entityType: 'layout_plan',
        entityId: approved.id,
        output: { approved: true, layoutPlanId: approved.id, alternativeIndex: approved.alternativeIndex, status: approved.status },
      };
    }

    case 'creative_qa': {
      const report = await loadRunQaReport(run.id);
      if (!report) throw conflict('Creative QA raporu bulunamadı — brand_consistency adımı önce çalışmalı');
      const approved = await store.creativeQaReports.approve(report.id, user.id);
      if (!approved) {
        throw conflict(`Creative QA report is not in an approvable state (current status: ${report.status})`);
      }
      return {
        entityType: 'creative_qa_report',
        entityId: approved.id,
        output: { approved: true, creativeQaReportId: approved.id, status: approved.status, score: approved.overallScore },
      };
    }

    case 'generated_output': {
      if (!body.generatedOutputId) {
        throw badRequest('generatedOutputId is required to approve a generated visual');
      }
      const generatedIds = await runEntityIds(run.id, 'generated_output');
      if (!generatedIds.includes(body.generatedOutputId)) {
        throw conflict('Generated output does not belong to this workflow run');
      }
      const output = await store.generatedOutputs.getById(body.generatedOutputId);
      if (!output) throw notFound('Generated output not found');
      // Repo guard: only status = 'generated' rows with an open approval match — a
      // 'failed' alternative can never be approved.
      const approved = await store.generatedOutputs.approve(output.id, user.id);
      if (!approved) {
        throw conflict(
          `Generated output is not in an approvable state (status: ${output.status}, approval: ${output.approvalStatus})`
        );
      }
      return {
        entityType: 'generated_output',
        entityId: approved.id,
        output: {
          approved: true,
          generatedOutputId: approved.id,
          alternativeIndex: approved.alternativeIndex,
          approvalStatus: approved.approvalStatus,
        },
      };
    }
  }
}

export async function rejectWorkflowStep(params: { runId: string; body: RejectStepBody; user: UserWithAccess }): Promise<RunWithSteps> {
  const { run, step, binding } = await loadWaitingGate(params.runId);

  if (!params.user.permissions.includes(binding.rejectPermission)) {
    throw forbidden(binding.rejectPermission, step.stepId);
  }
  if (binding.gate === 'brand_profile_future') {
    throw conflict('Bu onay kapısı henüz uygulanmamış bir özelliğe ait');
  }

  const notes = params.body.notes;
  const decision = await performGateRejection(binding.gate, run, params.body, params.user);

  // Same concurrency claim as approveWorkflowStep: check the guarded transition's result
  // before writing the audit row or touching resetForRevision/armNextStep.
  const rejectedStep = await store.workflowSteps.reject(step.id, params.user.id, decision.output);
  if (!rejectedStep) {
    throw conflict('No step is waiting for approval');
  }

  await store.workflowApprovals.create({
    id: uuid(),
    workflowRunId: run.id,
    workflowStepId: step.id,
    decision: 'rejected',
    decidedBy: params.user.id,
    entityType: decision.entityType,
    entityId: decision.entityId,
    notes,
  });

  // on_reject: a matching return_to_step_N re-opens the revision loop; anything
  // else (or nothing) fails the run — no invented recovery semantics.
  const stepDef = run.definitionSnapshot.steps.find((s) => s.step_id === step.stepId);
  const onReject = stepDef?.on_reject;
  const returnMatch = onReject ? /^return_to_step_(\d+)/.exec(onReject) : null;
  if (returnMatch) {
    const targetOrder = resolveRevisionTargetOrder(run, Number(returnMatch[1]));
    await store.workflowSteps.resetForRevision(run.id, targetOrder, step.stepOrder);
    await store.workflowRuns.markInProgress(run.id);
    await armNextStep(run.id);
  } else {
    await store.workflowRuns.markFailed(run.id, {
      reason: 'step_rejected',
      stepId: step.stepId,
      notes: notes ?? null,
      onReject: onReject ?? null,
      message: 'Adım reddedildi ve bu workflow otomatik revizyon döngüsü tanımlamıyor',
    });
  }

  return getRunWithSteps(run.id);
}

async function performGateRejection(
  gate: Exclude<ApprovalGateKind, 'brand_profile_future'>,
  run: WorkflowRun,
  body: RejectStepBody,
  user: UserWithAccess
): Promise<GateDecisionResult> {
  const notes = body.notes;
  switch (gate) {
    case 'design_dna': {
      const latest = await store.designDna.getLatestByClientId(run.clientId);
      if (!latest) throw conflict('Design DNA not found — run the analyze_styles step first');
      const revised = await store.designDna.requestRevision(latest.id, notes);
      if (!revised) {
        throw conflict(`Design DNA is not in a revisable state (current status: ${latest.status})`);
      }
      return {
        entityType: 'design_dna',
        entityId: revised.id,
        output: { rejected: true, designDnaId: revised.id, status: revised.status, notes: notes ?? null },
      };
    }

    case 'content_idea': {
      if (!body.contentIdeaId) {
        throw badRequest('contentIdeaId is required to reject a generated content idea');
      }
      const generatedIds = await runEntityIds(run.id, 'content_idea');
      if (!generatedIds.includes(body.contentIdeaId)) {
        throw conflict('Content idea does not belong to this workflow run');
      }
      const idea = await store.contentIdeas.getById(body.contentIdeaId);
      if (!idea) throw notFound('Content idea not found');
      if (idea.status !== 'pending_approval') {
        throw conflict(`Content idea is not awaiting approval (current status: ${idea.status})`);
      }
      // Same semantics as POST /api/content-ideas/:id/reject: notes -> revision_requested.
      const newStatus = notes ? 'revision_requested' : 'rejected';
      const approval = await store.approvals.create({
        id: uuid(),
        entityType: 'content_idea',
        entityId: idea.id,
        clientId: idea.clientId,
        status: newStatus,
        reviewerRole: 'creative_director',
        reviewerName: user.name,
        revisionNotes: notes,
        rejectedAt: new Date(),
      });
      const updated = await store.contentIdeas.setApprovalOutcome(idea.id, newStatus, approval.id);
      return {
        entityType: 'content_idea',
        entityId: idea.id,
        output: { rejected: true, contentIdeaId: idea.id, approvalId: approval.id, status: updated?.status ?? newStatus },
      };
    }

    case 'design_brief': {
      const briefId = await loadRunDesignBriefId(run);
      const brief = briefId ? await store.designBriefs.getById(briefId) : undefined;
      if (!brief) throw conflict('Design brief not found in this run — run the generate_brief step first');
      // Same semantics as POST /api/design-briefs/:id/reject: notes -> needs_revision.
      const newStatus = notes ? 'needs_revision' : 'rejected';
      const updated = await store.designBriefs.updateStatus(brief.id, newStatus);
      return {
        entityType: 'design_brief',
        entityId: brief.id,
        output: { rejected: true, designBriefId: brief.id, status: updated?.status ?? newStatus },
      };
    }

    case 'layout_plan': {
      if (!body.layoutPlanId) {
        throw badRequest('layoutPlanId is required to reject a layout plan');
      }
      const generatedIds = await runEntityIds(run.id, 'layout_plan');
      if (!generatedIds.includes(body.layoutPlanId)) {
        throw conflict('Layout plan does not belong to this workflow run');
      }
      const plan = await store.layoutPlans.getById(body.layoutPlanId);
      if (!plan) throw notFound('Layout plan not found');
      const rejected = await store.layoutPlans.reject(plan.id, notes);
      if (!rejected) {
        throw conflict(`Layout plan is not in a rejectable state (current status: ${plan.status})`);
      }
      return {
        entityType: 'layout_plan',
        entityId: rejected.id,
        output: { rejected: true, layoutPlanId: rejected.id, status: rejected.status },
      };
    }

    case 'creative_qa': {
      const report = await loadRunQaReport(run.id);
      if (!report) throw conflict('Creative QA raporu bulunamadı — brand_consistency adımı önce çalışmalı');
      const rejected = await store.creativeQaReports.reject(report.id, user.id, notes);
      if (!rejected) {
        throw conflict(`Creative QA report is not in a rejectable state (current status: ${report.status})`);
      }
      return {
        entityType: 'creative_qa_report',
        entityId: rejected.id,
        output: { rejected: true, creativeQaReportId: rejected.id, status: rejected.status },
      };
    }

    case 'generated_output': {
      if (!body.generatedOutputId) {
        throw badRequest('generatedOutputId is required to reject a generated visual');
      }
      const generatedIds = await runEntityIds(run.id, 'generated_output');
      if (!generatedIds.includes(body.generatedOutputId)) {
        throw conflict('Generated output does not belong to this workflow run');
      }
      const output = await store.generatedOutputs.getById(body.generatedOutputId);
      if (!output) throw notFound('Generated output not found');
      // Same semantics as POST /api/visual-outputs/:id/reject: notes -> 'revision_requested',
      // otherwise -> 'rejected' (mapping lives in the repo).
      const rejected = await store.generatedOutputs.reject(output.id, notes);
      if (!rejected) {
        throw conflict(
          `Generated output is not in a rejectable state (status: ${output.status}, approval: ${output.approvalStatus})`
        );
      }
      return {
        entityType: 'generated_output',
        entityId: rejected.id,
        output: { rejected: true, generatedOutputId: rejected.id, approvalStatus: rejected.approvalStatus },
      };
    }
  }
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

export async function cancelWorkflowRun(params: { runId: string; user: UserWithAccess }): Promise<RunWithSteps> {
  const run = await store.workflowRuns.getById(params.runId);
  if (!run) throw notFound('Workflow run not found');
  const cancelled = await store.workflowRuns.markCancelled(run.id);
  if (!cancelled) {
    throw conflict('Run is already terminal');
  }
  console.log(`[workflow-engine] run cancelled — runId=${run.id} by=${params.user.id}`);
  return getRunWithSteps(run.id);
}
