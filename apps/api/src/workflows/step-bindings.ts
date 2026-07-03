/**
 * Grafista AI Studio — Workflow Step Bindings (Phase 2 Step 6)
 *
 * The explicit registry mapping every (workflow_id, step_id) of the ten JSON
 * workflow definitions to what the engine actually does for that step.
 * Catalog validation (catalog.ts) fails the server start if any definition
 * step has no binding here — a JSON step can never silently become a no-op.
 *
 * Binding kinds:
 *  - record_context     bookkeeping steps recording REAL data (counts, ids,
 *                       statuses) and validating preconditions (400/409).
 *  - run_design_dna_analysis / generate_content_ideas / create_design_brief /
 *    generate_layout_plans / run_creative_qa / run_visual_generation
 *                       call the EXISTING services — never reimplemented.
 *  - production_gate_check
 *                       calls services/production-gate.ts's
 *                       assertReadyForVisualProduction.
 *  - approval_gate      REAL domain approvals via the existing repos (the
 *                       engine performs them in engine.ts).
 *  - future             explicitly unimplemented feature — blocks the run
 *                       with status 'blocked_future_feature', never fakes
 *                       success.
 *  - skip               optional/non-blocking steps — marked 'skipped' with
 *                       a note, never faked as work done.
 *  - qa_report_fact     re-reads a real field from the CreativeQAReport the
 *                       run already produced (no new AI call).
 */

import { PlatformEnum, type WorkflowRun, type WorkflowStepRecord } from '@grafista/schemas';
import type { Permission } from '../auth/permissions.js';
import type { UserWithAccess } from '../db/repositories/users.js';
import type { ContentIdea } from '../db/repositories/content-ideas.js';
import type { GeneratedOutput, LayoutPlan } from '@grafista/schemas';
import { store } from '../data/store.js';

// ─── Execution context/result contracts ─────────────────────────────────────

export interface StepExecutionContext {
  run: WorkflowRun;
  step: WorkflowStepRecord;
  user: UserWithAccess;
  /** run.inputJson merged with the advance request's input (request wins). */
  input: Record<string, unknown>;
}

export interface StepEntityLink {
  entityType: string;
  entityId?: string;
  outputKey: string;
  outputJson?: Record<string, unknown>;
}

export interface StepExecutionResult {
  output: Record<string, unknown>;
  /** Domain entities this step produced/verified — persisted to workflow_step_outputs. */
  entities?: StepEntityLink[];
  /** Patch merged into the run's output_json (cross-step context, e.g. campaignDetails). */
  runOutput?: Record<string, unknown>;
  /** When set, the engine marks the step 'skipped' with this note instead of 'completed'. */
  skippedNote?: string;
}

export type RecordContextExec = (ctx: StepExecutionContext) => Promise<StepExecutionResult>;

export type ApprovalGateKind =
  | 'design_dna'
  | 'content_idea'
  | 'design_brief'
  | 'layout_plan'
  | 'creative_qa'
  | 'generated_output'
  | 'brand_profile_future';

export type FutureFeature =
  | 'photoshop_production'
  | 'brand_profile_ai'
  | 'calendar_ai'
  | 'revision_learning_ai';

export type QaReportFact =
  | 'logo'
  | 'typography'
  | 'spelling'
  | 'mobile'
  | 'hierarchy'
  | 'dna_match'
  | 'score'
  | 'recommendations';

export type StepBinding =
  | { kind: 'record_context'; permission?: Permission; exec: RecordContextExec }
  | { kind: 'run_design_dna_analysis' }
  | { kind: 'generate_content_ideas' }
  | { kind: 'create_design_brief' }
  | { kind: 'generate_layout_plans' }
  | { kind: 'run_creative_qa' }
  | { kind: 'run_visual_generation' }
  | { kind: 'production_gate_check' }
  | { kind: 'approval_gate'; gate: ApprovalGateKind; approvePermission: Permission; rejectPermission: Permission }
  | { kind: 'future'; feature: FutureFeature; message: string }
  | { kind: 'skip'; note: string }
  | { kind: 'qa_report_fact'; fact: QaReportFact };

/** The domain permission the engine enforces before executing/approving a step. */
export function bindingPermission(binding: StepBinding): Permission | undefined {
  switch (binding.kind) {
    case 'record_context':
      return binding.permission;
    case 'run_design_dna_analysis':
      return 'design_dna:run';
    case 'generate_content_ideas':
      return 'content_ideas:create';
    case 'create_design_brief':
      return 'design_briefs:create';
    case 'generate_layout_plans':
      return 'layout_plans:create';
    case 'run_creative_qa':
      return 'creative_qa:run';
    case 'run_visual_generation':
      return 'visual_generation:run';
    case 'production_gate_check':
      return 'workflows:advance';
    case 'approval_gate':
      return binding.approvePermission;
    default:
      return undefined;
  }
}

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

function stringInput(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Entity ids of a given type this run has recorded so far (newest first). */
async function runEntityIds(runId: string, entityType: string): Promise<string[]> {
  const outputs = await store.workflowStepOutputs.findByRunAndEntityType(runId, entityType);
  return outputs.map((o) => o.entityId).filter((id): id is string => typeof id === 'string');
}

async function loadRunContentIdeas(runId: string): Promise<ContentIdea[]> {
  const ids = await runEntityIds(runId, 'content_idea');
  if (ids.length === 0) {
    throw conflict('No generated content ideas found in this run — run the generate_ideas step first');
  }
  const ideas: ContentIdea[] = [];
  for (const id of ids) {
    const idea = await store.contentIdeas.getById(id);
    if (idea) ideas.push(idea);
  }
  return ideas;
}

async function loadRunLayoutPlans(runId: string): Promise<LayoutPlan[]> {
  const ids = await runEntityIds(runId, 'layout_plan');
  if (ids.length === 0) {
    throw conflict('No generated layout plans found in this run — run the generate_layouts step first');
  }
  const plans: LayoutPlan[] = [];
  for (const id of ids) {
    const plan = await store.layoutPlans.getById(id);
    if (plan) plans.push(plan);
  }
  return plans;
}

// ─── Context recorders (real data only — no fake success anywhere) ──────────

const recordClientSnapshot: RecordContextExec = async (ctx) => {
  const client = await store.clients.getById(ctx.run.clientId);
  if (!client) throw notFound('Client not found');
  return { output: { clientId: client.id, name: client.name, slug: client.slug, status: client.status } };
};

const recordBrandAssets: RecordContextExec = async (ctx) => {
  const assets = await store.brandAssets.listByClient(ctx.run.clientId);
  return {
    output: {
      brandAssetCount: assets.length,
      brandAssetIds: assets.map((a) => a.id),
      note: assets.length === 0 ? 'Henüz marka varlığı yüklenmemiş — bu adım için zorunlu değil' : undefined,
    },
  };
};

const recordBrandAssetValidation: RecordContextExec = async (ctx) => {
  const assets = await store.brandAssets.listByClient(ctx.run.clientId);
  return {
    output: {
      brandAssetCount: assets.length,
      assetTypes: [...new Set(assets.map((a) => a.type))],
      mimeTypes: [...new Set(assets.map((a) => a.mimeType).filter((m): m is string => !!m))],
    },
  };
};

const requireDesignReferences: RecordContextExec = async (ctx) => {
  const references = await store.designReferences.listByClient(ctx.run.clientId);
  const usable = references.filter((r) => !!r.storageKey && !!r.storageProvider && !!r.storageBucket);
  if (usable.length === 0) {
    throw conflict('Client has no uploaded design references — upload at least one before continuing');
  }
  return {
    output: {
      referenceCount: usable.length,
      referenceIds: usable.map((r) => r.id),
      referenceNames: usable.map((r) => r.name),
    },
  };
};

const recordReferenceMetadata: RecordContextExec = async (ctx) => {
  const references = await store.designReferences.listByClient(ctx.run.clientId);
  return {
    output: {
      referenceCount: references.length,
      references: references.map((r) => ({ id: r.id, name: r.name, mimeType: r.mimeType ?? null })),
    },
  };
};

const groupReferenceAnalyses: RecordContextExec = async (ctx) => {
  const analyses = await store.designAnalysis.listByClientReferences(ctx.run.clientId);
  const byDesignCategory: Record<string, number> = {};
  const byFormat: Record<string, number> = {};
  for (const analysis of analyses) {
    const category = analysis.designCategory ?? 'uncategorized';
    const format = analysis.format || 'unknown';
    byDesignCategory[category] = (byDesignCategory[category] ?? 0) + 1;
    byFormat[format] = (byFormat[format] ?? 0) + 1;
  }
  return { output: { analysisCount: analyses.length, byDesignCategory, byFormat } };
};

const verifyGeneratedDna: RecordContextExec = async (ctx) => {
  const latest = await store.designDna.getLatestByClientId(ctx.run.clientId);
  if (!latest) {
    throw conflict('Design DNA not found — run the analyze_styles step first');
  }
  if (latest.status !== 'generated') {
    throw conflict(
      `Latest Design DNA version is '${latest.status}' — expected 'generated'. ` +
        'Re-run analyze_styles (or POST /api/clients/:clientId/design-dna/analyze) to produce a fresh version.'
    );
  }
  return {
    output: {
      designDnaId: latest.id,
      version: latest.version,
      status: latest.status,
      confidenceScore: latest.confidenceScore ?? null,
      note: 'DesignDNA sentezi analyze_styles adımında zaten çalıştı — bu adım sonucu doğrular, yeni AI çağrısı yapmaz',
    },
    entities: [{ entityType: 'design_dna', entityId: latest.id, outputKey: 'design_dna_draft' }],
  };
};

const verifyApprovedDna: RecordContextExec = async (ctx) => {
  const latest = await store.designDna.getLatestByClientId(ctx.run.clientId);
  if (!latest || latest.status !== 'approved') {
    throw conflict(
      `Design DNA is not approved yet (current status: ${latest?.status ?? 'none'}) — complete the user_approval gate first`
    );
  }
  return {
    output: { designDnaId: latest.id, version: latest.version, status: latest.status },
    entities: [{ entityType: 'design_dna', entityId: latest.id, outputKey: 'design_dna' }],
  };
};

const requireCampaignDetails: RecordContextExec = async (ctx) => {
  const campaignGoal = stringInput(ctx.input, 'campaign_goal');
  const platformRaw = stringInput(ctx.input, 'platform');
  const missing: string[] = [];
  if (!campaignGoal) missing.push('campaign_goal');
  if (!platformRaw) missing.push('platform');
  if (missing.length > 0) {
    throw badRequest(`Missing required campaign details: ${missing.join(', ')}`);
  }
  const platform = PlatformEnum.safeParse(platformRaw);
  if (!platform.success) {
    throw badRequest(`platform must be one of: ${PlatformEnum.options.join(', ')}`);
  }
  const campaignDetails = {
    campaign_goal: campaignGoal,
    platform: platform.data,
    format: stringInput(ctx.input, 'format'),
    target_audience: stringInput(ctx.input, 'target_audience'),
    topic: stringInput(ctx.input, 'topic'),
    mood: stringInput(ctx.input, 'mood'),
    option_count: typeof ctx.input.option_count === 'number' ? ctx.input.option_count : undefined,
  };
  return { output: { campaignDetails }, runOutput: { campaignDetails } };
};

const recordBrandContext: RecordContextExec = async (ctx) => {
  const approvedDna = await store.designDna.getApprovedByClientId(ctx.run.clientId);
  const approvedIdeas = await store.contentIdeas.listApprovedByClient(ctx.run.clientId);
  return {
    output: {
      approvedDesignDnaId: approvedDna?.id ?? 'none',
      approvedDesignDnaVersion: approvedDna?.version ?? null,
      approvedContentIdeasCount: approvedIdeas.length,
    },
  };
};

const recordGeneratedCopyPresence: RecordContextExec = async (ctx) => {
  const ideas = await loadRunContentIdeas(ctx.run.id);
  return {
    output: {
      ideaCount: ideas.length,
      withCaption: ideas.filter((i) => !!i.caption).length,
      withHook: ideas.filter((i) => !!i.hook).length,
      withCallToAction: ideas.filter((i) => !!i.callToAction).length,
      note: 'Caption/hook/CTA metinleri generate_ideas adımında üretilen fikirlerin içinde — ayrı bir AI çağrısı yapılmadı',
    },
  };
};

const listGeneratedIdeas: RecordContextExec = async (ctx) => {
  const ideas = await loadRunContentIdeas(ctx.run.id);
  return {
    output: {
      ideas: ideas.map((i) => ({ id: i.id, title: i.title, status: i.status })),
    },
  };
};

const requireApprovedGeneratedIdeas: RecordContextExec = async (ctx) => {
  const ideas = await loadRunContentIdeas(ctx.run.id);
  const approved = ideas.filter((i) => i.status === 'approved');
  if (approved.length === 0) {
    throw conflict('No approved content ideas in this run — approve at least one via the user_approval gate');
  }
  return { output: { approvedIdeaIds: approved.map((i) => i.id), approvedIdeaCount: approved.length } };
};

const requireApprovedContentIdea: RecordContextExec = async (ctx) => {
  const contentIdeaId = stringInput(ctx.input, 'content_idea_id');
  if (!contentIdeaId) {
    throw badRequest('content_idea_id is required to run the design-brief workflow');
  }
  const idea = await store.contentIdeas.getById(contentIdeaId);
  if (!idea) throw notFound('Content idea not found');
  if (idea.clientId !== ctx.run.clientId) {
    throw conflict('Content idea does not belong to this client');
  }
  if (idea.status !== 'approved') {
    throw conflict(`Content idea must be approved before creating a design brief (current status: ${idea.status})`);
  }
  return {
    output: { contentIdeaId: idea.id, title: idea.title, status: idea.status },
    entities: [{ entityType: 'content_idea', entityId: idea.id, outputKey: 'approved_content' }],
    runOutput: { contentIdeaId: idea.id },
  };
};

async function loadRunDesignBrief(run: WorkflowRun) {
  const briefId =
    typeof run.outputJson.designBriefId === 'string'
      ? run.outputJson.designBriefId
      : (await runEntityIds(run.id, 'design_brief'))[0];
  const brief = briefId ? await store.designBriefs.getById(briefId) : undefined;
  if (!brief) {
    throw conflict('Design brief not found in this run — run the generate_brief step first');
  }
  return brief;
}

const recordBriefAiPrompts: RecordContextExec = async (ctx) => {
  const brief = await loadRunDesignBrief(ctx.run);
  return {
    output: {
      designBriefId: brief.id,
      aiImagePromptCount: brief.aiImagePrompts.length,
      aiImagePrompts: brief.aiImagePrompts,
      note: 'Promptlar generate_brief adımında oluşturulan brief üzerinden okundu — yeni AI çağrısı yapılmadı',
    },
  };
};

const verifyApprovedBrief: RecordContextExec = async (ctx) => {
  const brief = await loadRunDesignBrief(ctx.run);
  if (brief.status !== 'approved') {
    throw conflict(`Design brief is not approved yet (current status: ${brief.status}) — complete the user_approval gate first`);
  }
  return {
    output: { designBriefId: brief.id, status: brief.status },
    entities: [{ entityType: 'design_brief', entityId: brief.id, outputKey: 'design_brief' }],
  };
};

const requireApprovedDesignBrief: RecordContextExec = async (ctx) => {
  const designBriefId = stringInput(ctx.input, 'design_brief_id');
  if (!designBriefId) {
    throw badRequest('design_brief_id is required to run the layout-generation workflow');
  }
  const brief = await store.designBriefs.getById(designBriefId);
  if (!brief) throw notFound('Design brief not found');
  if (brief.clientId !== ctx.run.clientId) {
    throw conflict('Design brief does not belong to this client');
  }
  if (brief.status !== 'approved') {
    throw conflict(`Design brief must be approved before generating a layout plan (current status: ${brief.status})`);
  }
  return {
    output: { designBriefId: brief.id, title: brief.title, status: brief.status },
    entities: [{ entityType: 'design_brief', entityId: brief.id, outputKey: 'design_brief' }],
    runOutput: { designBriefId: brief.id },
  };
};

const listGeneratedLayoutPlans: RecordContextExec = async (ctx) => {
  const plans = await loadRunLayoutPlans(ctx.run.id);
  return {
    output: {
      layoutPlans: plans.map((p) => ({ id: p.id, alternativeIndex: p.alternativeIndex, status: p.status })),
    },
  };
};

const requireApprovedLayoutPlan: RecordContextExec = async (ctx) => {
  const plans = await loadRunLayoutPlans(ctx.run.id);
  const approved = plans.filter((p) => p.status === 'approved');
  if (approved.length === 0) {
    throw conflict('No approved layout plan in this run — approve one via the user_approval gate');
  }
  return {
    output: {
      selectedLayoutPlanId: approved[0].id,
      approvedLayoutPlanIds: approved.map((p) => p.id),
    },
    runOutput: { selectedLayoutPlanId: approved[0].id },
  };
};

/** Reads the REAL provider-routing outcome from the generated_outputs rows this run's
 *  generate_prompts step already produced — no new AI call (routing happened inside
 *  runVisualGeneration via the model router's image_generation table). */
const recordVisualRoutingOutcome: RecordContextExec = async (ctx) => {
  const ids = await runEntityIds(ctx.run.id, 'generated_output');
  if (ids.length === 0) {
    throw conflict('No generated outputs found in this run — run the generate_prompts step first');
  }
  const outputs: GeneratedOutput[] = [];
  for (const id of ids) {
    const output = await store.generatedOutputs.getById(id);
    if (output) outputs.push(output);
  }
  return {
    output: {
      outputCount: outputs.length,
      generatedCount: outputs.filter((o) => o.status === 'generated').length,
      failedCount: outputs.filter((o) => o.status === 'failed').length,
      providers: [...new Set(outputs.map((o) => o.provider).filter((p): p is string => !!p))],
      models: [...new Set(outputs.map((o) => o.aiModel).filter((m): m is string => !!m))],
      note: 'Sağlayıcı yönlendirmesi generate_prompts adımındaki üretim çağrısının içinde yapıldı (model router image_generation tablosu) — bu adım sonucu kaydeder, yeni AI çağrısı yapmaz',
    },
  };
};

const requireMonth: RecordContextExec = async (ctx) => {
  const month = stringInput(ctx.input, 'month');
  if (!month) {
    throw badRequest('month is required (format: YYYY-MM)');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw badRequest('month must match the YYYY-MM format');
  }
  return { output: { clientId: ctx.run.clientId, month }, runOutput: { month } };
};

const requireFeedbackEntries: RecordContextExec = async (ctx) => {
  const entries = ctx.input.feedback_entries;
  const isEmptyArray = Array.isArray(entries) && entries.length === 0;
  if (entries === undefined || entries === null || isEmptyArray) {
    throw badRequest('feedback_entries is required (at least one feedback entry)');
  }
  return {
    output: {
      feedbackEntryCount: Array.isArray(entries) ? entries.length : 1,
      feedbackEntries: entries,
    },
  };
};

/** Generic recorder for bookkeeping tail steps: summarizes the run's REAL recorded entities. */
const recordRunSummary: RecordContextExec = async (ctx) => {
  const outputs = await store.workflowStepOutputs.listByRun(ctx.run.id);
  return {
    output: {
      entityCount: outputs.length,
      entities: outputs.map((o) => ({ entityType: o.entityType, entityId: o.entityId ?? null, outputKey: o.outputKey })),
      note: 'Bu adım, önceki adımların ürettiği kayıtları özetler — yeni bir kayıt/AI çağrısı üretmez',
    },
  };
};

// ─── The full binding table (every step of all 10 workflows) ────────────────

const FUTURE_BRAND_PROFILE = 'Marka profili AI üretimi henüz uygulanmadı';
const FUTURE_PHOTOSHOP = 'Photoshop üretimi henüz uygulanmadı';
const FUTURE_CALENDAR = "Aylık takvim AI üretimi henüz uygulanmadı — content-generation workflow'unu kullanın";
const FUTURE_REVISION_LEARNING = 'Revizyon öğrenme AI henüz uygulanmadı';
const SKIP_REVISION_LEARNING = 'Revision learning gelecekteki bir özellik';

/**
 * Placeholder gates ('brand_profile_future') sit behind future-blocked steps, so they are
 * unreachable today — they are still registered so catalog validation passes, and if one
 * is ever reached the engine answers approve/reject with a 409 instead of faking a decision.
 */
const PLACEHOLDER_GATE: StepBinding = {
  kind: 'approval_gate',
  gate: 'brand_profile_future',
  approvePermission: 'workflows:approve',
  rejectPermission: 'workflows:approve',
};

export const STEP_BINDINGS: Record<string, StepBinding> = {
  // ── client-onboarding ──
  'client-onboarding/create_client': { kind: 'record_context', exec: recordClientSnapshot },
  'client-onboarding/upload_assets': { kind: 'record_context', exec: recordBrandAssets },
  'client-onboarding/validate_assets': { kind: 'record_context', exec: recordBrandAssetValidation },
  'client-onboarding/generate_brand_profile': { kind: 'future', feature: 'brand_profile_ai', message: FUTURE_BRAND_PROFILE },
  'client-onboarding/generate_brand_rules': {
    kind: 'future',
    feature: 'brand_profile_ai',
    message: 'Marka kuralları dokümanı AI üretimi henüz uygulanmadı',
  },
  'client-onboarding/user_approval': PLACEHOLDER_GATE,
  'client-onboarding/save_profile': { kind: 'record_context', exec: recordRunSummary },

  // ── style-library-ingestion ──
  'style-library-ingestion/upload_references': { kind: 'record_context', exec: requireDesignReferences },
  'style-library-ingestion/upload_psd': {
    kind: 'skip',
    note: 'PSD derin analizi opsiyonel — PSD yüklemesi bu adımda desteklenmiyor',
  },
  'style-library-ingestion/extract_metadata': { kind: 'record_context', exec: recordReferenceMetadata },
  'style-library-ingestion/analyze_styles': { kind: 'run_design_dna_analysis' },
  'style-library-ingestion/group_references': { kind: 'record_context', exec: groupReferenceAnalyses },
  'style-library-ingestion/generate_dna': { kind: 'record_context', exec: verifyGeneratedDna },
  'style-library-ingestion/user_approval': {
    kind: 'approval_gate',
    gate: 'design_dna',
    approvePermission: 'design_dna:approve',
    rejectPermission: 'design_dna:revise',
  },
  'style-library-ingestion/learn_from_corrections': { kind: 'skip', note: SKIP_REVISION_LEARNING },
  'style-library-ingestion/save_dna': { kind: 'record_context', exec: verifyApprovedDna },

  // ── content-generation ──
  'content-generation/select_client': { kind: 'record_context', exec: recordClientSnapshot },
  'content-generation/enter_campaign_details': { kind: 'record_context', exec: requireCampaignDetails },
  'content-generation/load_brand_context': { kind: 'record_context', exec: recordBrandContext },
  'content-generation/generate_ideas': { kind: 'generate_content_ideas' },
  'content-generation/generate_copy': { kind: 'record_context', exec: recordGeneratedCopyPresence },
  'content-generation/present_options': { kind: 'record_context', exec: listGeneratedIdeas },
  'content-generation/user_approval': {
    kind: 'approval_gate',
    gate: 'content_idea',
    approvePermission: 'content_ideas:approve',
    rejectPermission: 'content_ideas:approve',
  },
  'content-generation/learn_from_feedback': { kind: 'skip', note: SKIP_REVISION_LEARNING },
  'content-generation/save_approved': { kind: 'record_context', exec: requireApprovedGeneratedIdeas },

  // ── design-brief ──
  'design-brief/load_content': { kind: 'record_context', exec: requireApprovedContentIdea },
  'design-brief/load_brand_context': { kind: 'record_context', exec: recordBrandContext },
  'design-brief/select_references': {
    kind: 'skip',
    note: 'Referans seçimi AI adımı henüz uygulanmadı — brief mevcut referans listesiyle oluşturulur',
  },
  'design-brief/generate_brief': { kind: 'create_design_brief' },
  'design-brief/generate_ai_prompts': { kind: 'record_context', exec: recordBriefAiPrompts },
  'design-brief/user_approval': {
    kind: 'approval_gate',
    gate: 'design_brief',
    approvePermission: 'design_briefs:approve',
    rejectPermission: 'design_briefs:approve',
  },
  'design-brief/save_brief': { kind: 'record_context', exec: verifyApprovedBrief },

  // ── layout-generation ──
  'layout-generation/load_brief': { kind: 'record_context', exec: requireApprovedDesignBrief },
  'layout-generation/generate_layouts': { kind: 'generate_layout_plans' },
  'layout-generation/qa_check': {
    kind: 'skip',
    note: "Creative QA bu pipeline'da layout onayından SONRA çalışır (onaylı plan gerektirir) — creative-qa workflow'unu kullanın",
  },
  'layout-generation/present_alternatives': { kind: 'record_context', exec: listGeneratedLayoutPlans },
  'layout-generation/user_approval': {
    kind: 'approval_gate',
    gate: 'layout_plan',
    approvePermission: 'layout_plans:approve',
    rejectPermission: 'layout_plans:reject',
  },
  'layout-generation/save_layout': { kind: 'record_context', exec: requireApprovedLayoutPlan },

  // ── creative-qa ──
  'creative-qa/brand_consistency': { kind: 'run_creative_qa' },
  'creative-qa/logo_check': { kind: 'qa_report_fact', fact: 'logo' },
  'creative-qa/typography_check': { kind: 'qa_report_fact', fact: 'typography' },
  'creative-qa/spelling_check': { kind: 'qa_report_fact', fact: 'spelling' },
  'creative-qa/mobile_readability': { kind: 'qa_report_fact', fact: 'mobile' },
  'creative-qa/visual_hierarchy': { kind: 'qa_report_fact', fact: 'hierarchy' },
  'creative-qa/dna_comparison': { kind: 'qa_report_fact', fact: 'dna_match' },
  'creative-qa/generate_score': { kind: 'qa_report_fact', fact: 'score' },
  'creative-qa/revision_recommendations': { kind: 'qa_report_fact', fact: 'recommendations' },
  'creative-qa/learn_patterns': { kind: 'skip', note: SKIP_REVISION_LEARNING },
  'creative-qa/user_approval': {
    kind: 'approval_gate',
    gate: 'creative_qa',
    approvePermission: 'creative_qa:approve',
    rejectPermission: 'creative_qa:reject',
  },

  // ── visual-generation ──
  'visual-generation/check_existing': { kind: 'production_gate_check' },
  // One service call covers prompt building AND generation (runVisualGeneration builds
  // the visual prompt from the layout plan/brief/QA summary before calling the image
  // provider) — the same single-AI-call pattern as creative-qa/brand_consistency.
  'visual-generation/generate_prompts': { kind: 'run_visual_generation' },
  'visual-generation/route_generation': { kind: 'record_context', exec: recordVisualRoutingOutcome },
  'visual-generation/brand_check': {
    kind: 'skip',
    note: 'Üretilmiş görseller üzerinde ayrı marka kontrolü AI çağrısı henüz uygulanmadı — üretim, Creative QA onayından geçmiş layout plan üzerinden yapıldı (production gate)',
  },
  'visual-generation/style_check': {
    kind: 'skip',
    note: 'Üretilmiş görseller üzerinde ayrı DesignDNA stil kontrolü AI çağrısı henüz uygulanmadı — üretim, Creative QA onayından geçmiş layout plan üzerinden yapıldı (production gate)',
  },
  'visual-generation/user_approval': {
    kind: 'approval_gate',
    gate: 'generated_output',
    approvePermission: 'visual_generation:approve',
    rejectPermission: 'visual_generation:reject',
  },
  'visual-generation/save_visual': { kind: 'record_context', exec: recordRunSummary },

  // ── photoshop-production ──
  'photoshop-production/load_layout': { kind: 'production_gate_check' },
  'photoshop-production/send_to_photoshop': { kind: 'future', feature: 'photoshop_production', message: FUTURE_PHOTOSHOP },
  'photoshop-production/create_psd': { kind: 'future', feature: 'photoshop_production', message: FUTURE_PHOTOSHOP },
  'photoshop-production/export_preview': { kind: 'future', feature: 'photoshop_production', message: FUTURE_PHOTOSHOP },
  'photoshop-production/return_urls': { kind: 'record_context', exec: recordRunSummary },
  'photoshop-production/qa_check': {
    kind: 'skip',
    note: "Creative QA üretilmiş PSD önizlemesi gerektirir — onaylı layout plan için creative-qa workflow'unu kullanın",
  },
  'photoshop-production/user_approval': PLACEHOLDER_GATE,

  // ── monthly-content-calendar ──
  'monthly-content-calendar/select_client_month': { kind: 'record_context', exec: requireMonth },
  'monthly-content-calendar/load_context': { kind: 'record_context', exec: recordBrandContext },
  'monthly-content-calendar/generate_calendar': { kind: 'future', feature: 'calendar_ai', message: FUTURE_CALENDAR },
  'monthly-content-calendar/split_by_format': { kind: 'record_context', exec: recordRunSummary },
  'monthly-content-calendar/generate_briefs_preview': {
    kind: 'future',
    feature: 'calendar_ai',
    message: 'Takvim brief önizlemeleri AI üretimi henüz uygulanmadı',
  },
  'monthly-content-calendar/user_approval': PLACEHOLDER_GATE,
  'monthly-content-calendar/learn_from_edits': { kind: 'skip', note: SKIP_REVISION_LEARNING },
  'monthly-content-calendar/create_production_queue': { kind: 'record_context', exec: recordRunSummary },

  // ── revision-learning ──
  'revision-learning/capture_feedback': { kind: 'record_context', exec: requireFeedbackEntries },
  'revision-learning/classify_feedback': { kind: 'future', feature: 'revision_learning_ai', message: FUTURE_REVISION_LEARNING },
  'revision-learning/update_memory': { kind: 'future', feature: 'revision_learning_ai', message: FUTURE_REVISION_LEARNING },
  'revision-learning/update_approval_bias': { kind: 'record_context', exec: recordRunSummary },
  'revision-learning/adjust_dna': { kind: 'future', feature: 'revision_learning_ai', message: FUTURE_REVISION_LEARNING },
  'revision-learning/review_changes': PLACEHOLDER_GATE,
  'revision-learning/save_changes': { kind: 'record_context', exec: recordRunSummary },
  'revision-learning/log_changelog': { kind: 'record_context', exec: recordRunSummary },
};
