/**
 * Grafista AI Studio — Creative QA Service (Phase 2 Step 5B)
 *
 * Pipeline stage: approved LayoutPlan + approved DesignBrief + approved DesignDNA ->
 * CreativeQAReport. Mirrors the real-AI-call pattern already used in
 * services/layout-generation.ts (createPromptBuilder -> modelRouter.complete ->
 * parse/validate -> persist) — exactly ONE AI call reviews one LayoutPlan alternative.
 * Nothing is persisted unless the AI response validates against
 * CreativeQAReportContentSchema — no partial/broken CreativeQAReport rows on any failure.
 *
 * This is a pure text/structural review of the LayoutPlan's JSON (positions, colors,
 * typography, layers) — no rendered image exists yet at this phase (visual generation is
 * a future phase), so no `images` are sent to the model router.
 */

import { v4 as uuid } from 'uuid';
import { ModelRouter, type AIResponse } from '@grafista/model-router';
import { createPromptBuilder, creativeQATemplate } from '@grafista/prompt-engine';
import {
  CreativeQAReportContentSchema,
  type CreativeQAReport,
  type CreativeQAReportContent,
  type CreativeQAReportStatus,
  type CreativeQAScores,
} from '@grafista/schemas';
import { store } from '../data/store.js';
import { env } from '../config/env.js';

const modelRouter = new ModelRouter();

/** Default score threshold (0-100) a report must meet to be considered 'passed'. */
export const DEFAULT_PASS_THRESHOLD = 75;

export interface CreativeQaResult {
  report: CreativeQAReport;
}

/** Tolerates markdown code fences around the model's JSON output (same cleanup as layout-generation.ts). */
function parseJsonFromModelOutput(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

/** Names of the 11 named per-check fields on CreativeQAReportContent (see packages/schemas/src/qa.ts),
 * each of which carries its own `status` field that must be one of QACheckStatusEnum's
 * 'pass' | 'warn' | 'fail' | 'skip' — a completely different enum from the top-level
 * `overallStatus` ('passed' | 'needs_revision' | 'failed'). */
const NAMED_QA_CHECK_FIELDS = [
  'brandConsistency', 'readability', 'mobileLegibility', 'visualHierarchy',
  'logoSafetyArea', 'colorContrast', 'spelling', 'designDnaMatch',
  'exportReadiness', 'typographyConsistency', 'contentClarity',
] as const;

/** Defense-in-depth safety net: even with the prompt now spelling out the per-check
 * `status` enum explicitly (see creative-qa.ts template), GPT-4o and other providers may
 * still occasionally reuse the nearby `overallStatus` vocabulary by mistake. This maps
 * ONLY those exact, obviously-intended near-miss synonyms to the correct QACheckStatusEnum
 * value, on per-check `status` fields only, BEFORE schema validation runs. It never
 * touches the top-level `overallStatus` field (different field, different enum, left
 * completely untouched), and it does NOT loosen validation in any way: any value not in
 * this exact map (typos, made-up words, wrong types, etc.) is left untouched and will
 * still fail CreativeQAReportContentSchema validation and 502 exactly as before. */
const QA_CHECK_STATUS_SYNONYMS: Record<string, string> = {
  passed: 'pass',
  needs_revision: 'warn',
  failed: 'fail',
};

function normalizeCheckStatus(check: unknown): unknown {
  if (
    check !== null &&
    typeof check === 'object' &&
    typeof (check as { status?: unknown }).status === 'string'
  ) {
    const status = (check as { status: string }).status;
    const mapped = QA_CHECK_STATUS_SYNONYMS[status];
    if (mapped) {
      return { ...check, status: mapped };
    }
  }
  return check;
}

/** Applies normalizeCheckStatus to every per-check `status` field in the raw parsed AI
 * response — the 11 named checks above, plus every item inside the free-form `checks[]`
 * array. Never touches `overallStatus` (a different top-level field/enum entirely). */
function normalizeQaCheckStatuses(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }
  const result: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  for (const field of NAMED_QA_CHECK_FIELDS) {
    if (field in result) {
      result[field] = normalizeCheckStatus(result[field]);
    }
  }

  if (Array.isArray(result.checks)) {
    result.checks = result.checks.map(normalizeCheckStatus);
  }

  return result;
}

function logAiCall(label: string, response: AIResponse): void {
  if (response.success) {
    console.log(
      `[creative-qa] ${label} ok — provider=${response.provider} model=${response.model} ` +
        `tokens(in/out/total)=${response.usage.inputTokens}/${response.usage.outputTokens}/${response.usage.totalTokens} ` +
        `estimatedCost=${response.usage.estimatedCost ?? 'n/a'} latencyMs=${response.latencyMs}`
    );
  } else {
    console.error(
      `[creative-qa] ${label} FAILED — provider=${response.provider} latencyMs=${response.latencyMs} error=${response.error}`
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

function conflict(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 409 });
}

function notFound(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 404 });
}

/** Server-computed flat mirror of the 10 named scores this task calls out, derived from
 * the corresponding named QACheckItem.score values (never invented independently). */
function deriveScores(content: CreativeQAReportContent): CreativeQAScores {
  return {
    brandConsistency: content.brandConsistency.score,
    designDnaMatch: content.designDnaMatch.score,
    layoutHierarchy: content.visualHierarchy.score,
    readability: content.readability.score,
    mobileLegibility: content.mobileLegibility.score,
    logoSafety: content.logoSafetyArea.score,
    colorContrast: content.colorContrast.score,
    typographyConsistency: content.typographyConsistency.score,
    contentClarity: content.contentClarity.score,
    exportReadiness: content.exportReadiness.score,
  };
}

/**
 * Runs a Creative QA review on one approved LayoutPlan alternative. Hard prerequisites
 * (all 409 otherwise): the LayoutPlan must be 'approved', its DesignBrief must be
 * 'approved', and the client must have an 'approved' DesignDNA (no reduced-confidence
 * fallback mode for this phase — Creative QA without approved DesignDNA context is
 * considered unreliable and is refused outright).
 */
export async function runCreativeQa(layoutPlanId: string, requestedBy: string): Promise<CreativeQaResult> {
  console.log(`[creative-qa] run requested — layoutPlanId=${layoutPlanId} requestedBy=${requestedBy}`);

  const layoutPlan = await store.layoutPlans.getById(layoutPlanId);
  if (!layoutPlan) {
    throw notFound('Layout plan not found');
  }

  if (layoutPlan.status !== 'approved') {
    throw conflict(`LayoutPlan must be approved before running Creative QA (current status: ${layoutPlan.status})`);
  }

  const brief = await store.designBriefs.getById(layoutPlan.designBriefId);
  if (!brief) {
    throw notFound('Design brief not found');
  }

  if (brief.status !== 'approved') {
    throw conflict(`Design brief must be approved before running Creative QA (current status: ${brief.status})`);
  }

  const client = await store.clients.getById(brief.clientId);
  if (!client) {
    throw notFound('Client not found');
  }

  const latestDna = await store.designDna.getLatestByClientId(client.id);
  if (!latestDna) {
    throw conflict('Approved DesignDNA is required before running Creative QA — none exists for this client');
  }
  if (latestDna.status !== 'approved') {
    throw conflict(
      `Approved DesignDNA is required before running Creative QA — current DesignDNA status is ${latestDna.status}`
    );
  }

  const designDnaRules = {
    preferredLayouts: latestDna.preferredLayouts,
    visualRules: latestDna.visualRules,
    typographyRules: latestDna.typographyRules,
    logoUsageRules: latestDna.logoUsageRules,
    imageTreatmentRules: latestDna.imageTreatmentRules,
    colorUsageRules: latestDna.colorUsageRules,
    brandPersonality: latestDna.brandPersonality,
    contentTone: latestDna.contentTone,
    avoidList: latestDna.avoidList,
  };

  const prompt = createPromptBuilder(creativeQATemplate)
    .setVariables({
      layoutPlan: JSON.stringify(layoutPlan, null, 2),
      designBrief: JSON.stringify(brief, null, 2),
      designDnaRules: JSON.stringify(designDnaRules, null, 2),
      passThreshold: String(DEFAULT_PASS_THRESHOLD),
    })
    .build();

  const aiResponse = await modelRouter.complete({
    taskType: 'creative_qa',
    provider: env.AI_DEFAULT_PROVIDER,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    outputFormat: 'json',
    maxTokens: prompt.metadata.maxTokens,
    temperature: prompt.metadata.temperature,
  });
  logAiCall('creative_qa', aiResponse);

  if (!aiResponse.success) {
    throw providerError(aiResponse);
  }

  let raw: unknown;
  try {
    raw = parseJsonFromModelOutput(aiResponse.content);
  } catch (err) {
    throw Object.assign(
      new Error(`AI response was not valid JSON (creative_qa): ${err instanceof Error ? err.message : String(err)}`),
      { status: 502 }
    );
  }

  raw = normalizeQaCheckStatuses(raw);

  const validated = CreativeQAReportContentSchema.safeParse(raw);
  if (!validated.success) {
    throw schemaError('creative_qa', validated.error.message);
  }
  const content = validated.data;

  const passed = content.overallScore >= DEFAULT_PASS_THRESHOLD;
  const status: CreativeQAReportStatus = passed ? 'passed' : 'failed';
  const canProceedToProduction = passed && content.highPriorityFixes.length === 0;
  const scores = deriveScores(content);
  const recommendations = [...content.highPriorityFixes, ...content.mediumPriorityFixes, ...content.lowPriorityFixes];

  const storedContent = {
    ...content,
    passThreshold: DEFAULT_PASS_THRESHOLD,
    passed,
    scores,
    criticalIssues: content.detectedIssues,
    recommendations,
    canProceedToProduction,
    reviewedAt: new Date().toISOString(),
  };

  const persisted = await store.creativeQaReports.create({
    id: uuid(),
    clientId: client.id,
    designBriefId: brief.id,
    layoutPlanId: layoutPlan.id,
    designDnaId: latestDna.id,
    status,
    score: content.overallScore,
    passThreshold: DEFAULT_PASS_THRESHOLD,
    provider: aiResponse.provider,
    model: aiResponse.model,
    createdBy: requestedBy,
    content: storedContent,
  });

  return { report: persisted };
}
