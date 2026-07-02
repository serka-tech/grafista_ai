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
import { ModelRouter, type AIResponse } from '@grafista/model-router';
import { createPromptBuilder, layoutGenerationTemplate } from '@grafista/prompt-engine';
import { LayoutPlanContentSchema, type LayoutPlan, type LayoutPlanContent } from '@grafista/schemas';
import { store } from '../data/store.js';
import { env } from '../config/env.js';

const modelRouter = new ModelRouter();

const MIN_ALTERNATIVES = 2;
const MAX_ALTERNATIVES = 3;
// Ask the model for the max every time; validation below still accepts 2 or 3 back.
const REQUESTED_ALTERNATIVE_COUNT = MAX_ALTERNATIVES;

export interface LayoutGenerationResult {
  layoutPlans: LayoutPlan[];
}

/** Tolerates markdown code fences around the model's JSON output (same cleanup as content-ideas.ts / design-dna-analysis.ts). */
function parseJsonFromModelOutput(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

function logAiCall(label: string, response: AIResponse): void {
  if (response.success) {
    console.log(
      `[layout-generation] ${label} ok — provider=${response.provider} model=${response.model} ` +
        `tokens(in/out/total)=${response.usage.inputTokens}/${response.usage.outputTokens}/${response.usage.totalTokens} ` +
        `estimatedCost=${response.usage.estimatedCost ?? 'n/a'} latencyMs=${response.latencyMs}`
    );
  } else {
    console.error(
      `[layout-generation] ${label} FAILED — provider=${response.provider} latencyMs=${response.latencyMs} error=${response.error}`
    );
  }
}

/** Raised with a `.status` property so the central errorHandler renders the right HTTP status. */
function providerError(response: AIResponse): Error & { status: number } {
  return Object.assign(new Error(response.error ?? 'AI provider error'), { status: 502 });
}

function schemaError(context: string, issues: string): Error & { status: number } {
  return Object.assign(new Error(`AI response failed schema validation (${context}): ${issues}`), { status: 502 });
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

  const aiResponse = await modelRouter.complete({
    taskType: 'layout_generation',
    provider: env.AI_DEFAULT_PROVIDER,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    outputFormat: 'json',
    maxTokens: prompt.metadata.maxTokens,
    temperature: prompt.metadata.temperature,
  });
  logAiCall('layout_generation', aiResponse);

  if (!aiResponse.success) {
    throw providerError(aiResponse);
  }

  let rawAlternatives: unknown[];
  try {
    rawAlternatives = extractAlternatives(parseJsonFromModelOutput(aiResponse.content));
  } catch (err) {
    throw Object.assign(
      new Error(`AI response was not valid JSON (layout_generation): ${err instanceof Error ? err.message : String(err)}`),
      { status: 502 }
    );
  }

  if (rawAlternatives.length < MIN_ALTERNATIVES || rawAlternatives.length > MAX_ALTERNATIVES) {
    throw schemaError(
      'layout_generation',
      `expected ${MIN_ALTERNATIVES}-${MAX_ALTERNATIVES} layout alternatives, got ${rawAlternatives.length}`
    );
  }

  // Validate EVERY alternative before persisting ANY of them — no partial/broken rows.
  const validatedAlternatives: LayoutPlanContent[] = [];
  for (const [i, raw] of rawAlternatives.entries()) {
    const validated = LayoutPlanContentSchema.safeParse(raw);
    if (!validated.success) {
      throw schemaError(`layout_generation, alternative ${i + 1}`, validated.error.message);
    }
    validatedAlternatives.push(validated.data);
  }

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
