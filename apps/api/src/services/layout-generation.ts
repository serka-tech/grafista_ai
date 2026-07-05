/**
 * Grafista AI Studio — Layout Generation Service (Phase 2 Step 5A)
 *
 * Pipeline stage: approved DesignBrief (+ approved DesignDNA context, if available) ->
 * LayoutPlan alternatives. Mirrors the real-AI-call pattern already used in
 * services/design-dna-analysis.ts (createPromptBuilder -> modelRouter.complete ->
 * parse/validate -> persist) — exactly ONE AI call asks for all 2-3 alternatives in a
 * single JSON array response (cheaper/faster than N separate calls). Nothing is
 * persisted unless every alternative validates against LayoutPlanContentSchema — no
 * partial/broken LayoutPlan rows on any failure.
 */

import { v4 as uuid } from 'uuid';
import { ModelRouter } from '@grafista/model-router';
import { createPromptBuilder, layoutGenerationTemplate } from '@grafista/prompt-engine';
import { LayoutPlanContentSchema, type LayoutPlan, type LayoutPlanContent } from '@grafista/schemas';
import { store } from '../data/store.js';
import { env } from '../config/env.js';
import { aiCallError, callAiForJson, type ValidateResult } from './ai-call-helper.js';
import { assertClientAccessible } from '../auth/client-access.js';

const modelRouter = new ModelRouter();

const MIN_ALTERNATIVES = 2;
const MAX_ALTERNATIVES = 3;
// Ask the model for the max every time; validation below still accepts 2 or 3 back.
const REQUESTED_ALTERNATIVE_COUNT = MAX_ALTERNATIVES;

export interface LayoutGenerationResult {
  layoutPlans: LayoutPlan[];
}

/** Extracts an array of raw alternative objects, tolerating a bare array or a {alternatives:[...]} wrapper. */
function extractAlternatives(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.alternatives)) return obj.alternatives;
    if (Array.isArray(obj.layoutAlternatives)) return obj.layoutAlternatives;
  }
  throw new Error('Model did not return a JSON array of layout alternatives');
}

/**
 * Full structural validation of one model response: alternative extraction,
 * count bounds, and per-alternative LayoutPlanContentSchema. Used by
 * callAiForJson so a validation flake on ANY of these steps triggers the
 * automatic in-service retry (manual-demo-pass N1) instead of an instant 502.
 */
function validateLayoutAlternatives(raw: unknown): ValidateResult<LayoutPlanContent[]> {
  let rawAlternatives: unknown[];
  try {
    rawAlternatives = extractAlternatives(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (rawAlternatives.length < MIN_ALTERNATIVES || rawAlternatives.length > MAX_ALTERNATIVES) {
    return {
      ok: false,
      error: `expected ${MIN_ALTERNATIVES}-${MAX_ALTERNATIVES} layout alternatives, got ${rawAlternatives.length}`,
    };
  }

  // Validate EVERY alternative before accepting ANY of them — no partial/broken rows.
  const validatedAlternatives: LayoutPlanContent[] = [];
  for (const [i, rawAlternative] of rawAlternatives.entries()) {
    const validated = LayoutPlanContentSchema.safeParse(rawAlternative);
    if (!validated.success) {
      return { ok: false, error: `alternative ${i + 1}: ${validated.error.message}` };
    }
    validatedAlternatives.push(validated.data);
  }
  return { ok: true, data: validatedAlternatives };
}

/**
 * Generates 2-3 LayoutPlan alternatives for a design brief. The brief MUST already be
 * 'approved' (409 otherwise) — DesignDNA is optional context, only used when the
 * client's latest DesignDNA version is itself 'approved'.
 */
export async function runLayoutGeneration(designBriefId: string, requestedBy: string): Promise<LayoutGenerationResult> {
  console.log(`[layout-generation] run requested — designBriefId=${designBriefId} requestedBy=${requestedBy}`);

  const brief = await store.designBriefs.getById(designBriefId);
  if (!brief) {
    throw Object.assign(new Error('Design brief not found'), { status: 404 });
  }

  if (brief.status !== 'approved') {
    throw Object.assign(
      new Error(`Design brief must be approved before generating a layout plan (current status: ${brief.status})`),
      { status: 409 }
    );
  }

  const client = await store.clients.getById(brief.clientId);
  if (!client) {
    throw Object.assign(new Error('Client not found'), { status: 404 });
  }
  // Phase 3 Step 4 — client isolation hardening.
  await assertClientAccessible(requestedBy, client.id);

  const latestDna = await store.designDna.getLatestByClientId(client.id);
  const approvedDna = latestDna && latestDna.status === 'approved' ? latestDna : undefined;

  const dnaContext = approvedDna
    ? JSON.stringify(
        {
          preferredLayouts: approvedDna.preferredLayouts,
          visualRules: approvedDna.visualRules,
          typographyRules: approvedDna.typographyRules,
          logoUsageRules: approvedDna.logoUsageRules,
          imageTreatmentRules: approvedDna.imageTreatmentRules,
          colorUsageRules: approvedDna.colorUsageRules,
        },
        null,
        2
      )
    : 'No approved DesignDNA available for this client yet — proceed using only the design brief and general best practices. designDnaRulesUsed must be [] in every alternative.';

  const prompt = createPromptBuilder(layoutGenerationTemplate)
    .setVariables({
      designBrief: JSON.stringify(brief, null, 2),
      canvasWidth: String(brief.dimensions.width),
      canvasHeight: String(brief.dimensions.height),
      alternativeCount: String(REQUESTED_ALTERNATIVE_COUNT),
      dnaContext,
      referenceDesignIds: JSON.stringify(brief.referenceDesignIds ?? []),
    })
    .build();

  // Phase 3 Step 3 (N1 fix): a syntactically fine response that fails schema
  // validation gets ONE automatic same-prompt retry inside callAiForJson before
  // any 502 reaches the user. Nothing is persisted unless a whole attempt
  // validates end to end.
  const outcome = await callAiForJson<LayoutPlanContent[]>({
    router: modelRouter,
    request: {
      taskType: 'layout_generation',
      provider: env.AI_DEFAULT_PROVIDER,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      outputFormat: 'json',
      maxTokens: prompt.metadata.maxTokens,
      temperature: prompt.metadata.temperature,
    },
    context: 'layout_generation',
    logPrefix: 'layout-generation',
    validate: validateLayoutAlternatives,
  });

  if (!outcome.ok) {
    throw aiCallError(outcome);
  }

  const { data: validatedAlternatives, response: aiResponse } = outcome;

  const layoutPlans: LayoutPlan[] = [];
  for (const [i, content] of validatedAlternatives.entries()) {
    const persisted = await store.layoutPlans.create({
      id: uuid(),
      clientId: client.id,
      designBriefId: brief.id,
      contentIdeaId: brief.contentIdeaId,
      designDnaId: approvedDna?.id,
      alternativeIndex: i + 1,
      status: 'generated',
      content,
      provider: aiResponse.provider,
      model: aiResponse.model,
      createdBy: requestedBy,
    });
    layoutPlans.push(persisted);
  }

  return { layoutPlans };
}
