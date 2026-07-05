/**
 * Grafista AI Studio — Design DNA Analysis Service (Phase 2 Step 4)
 *
 * Runs real AI vision analysis over a client's uploaded design references, then
 * synthesizes those per-reference results into one aggregated client-level Design
 * DNA. Mirrors the real-AI-call pattern already used in routes/content-ideas.ts
 * (createPromptBuilder → modelRouter.complete → parse/validate → persist), pulled
 * out into a service module because this flow spans two AI calls and two tables.
 */

import { v4 as uuid } from 'uuid';
import { ModelRouter } from '@grafista/model-router';
import { createPromptBuilder, styleAnalysisTemplate, designDnaSynthesisTemplate } from '@grafista/prompt-engine';
import { StyleAnalysisSchema, DesignDNAContentSchema, type StyleAnalysis, type DesignDNA } from '@grafista/schemas';
import { z } from 'zod';
import { store } from '../data/store.js';
import { env } from '../config/env.js';
import { getObjectBuffer } from '../storage/file-service.js';
import type { DesignReference } from '../db/repositories/design-references.js';
import { aiCallError, callAiForJson, type ValidateResult } from './ai-call-helper.js';

const modelRouter = new ModelRouter();

export interface DesignDnaAnalysisResult {
  designDna: DesignDNA;
  analyses: StyleAnalysis[];
}

/** A design reference that actually has bytes in storage (metadata-only rows are skipped). */
type UsableDesignReference = DesignReference & {
  storageKey: string;
  storageProvider: NonNullable<DesignReference['storageProvider']>;
  storageBucket: string;
};

function isUsable(ref: DesignReference): ref is UsableDesignReference {
  return !!ref.storageKey && !!ref.storageProvider && !!ref.storageBucket;
}

/** Generic zod-safeParse -> ValidateResult bridge for callAiForJson. */
function zodValidate<S extends z.ZodTypeAny>(schema: S) {
  return (raw: unknown): ValidateResult<z.infer<S>> => {
    const validated = schema.safeParse(raw);
    return validated.success ? { ok: true, data: validated.data } : { ok: false, error: validated.error.message };
  };
}

/**
 * Runs (or re-runs) Design DNA analysis for a client: one vision call per uploaded design
 * reference, then one text synthesis call combining all per-reference results. Persists a
 * new design_analysis row per reference and one new design_dna version — or persists
 * nothing at all if any step fails (no partial/fake rows for a failed step).
 */
export async function runDesignDnaAnalysis(clientId: string, requestedBy: string): Promise<DesignDnaAnalysisResult> {
  console.log(`[design-dna-analysis] run requested — clientId=${clientId} requestedBy=${requestedBy}`);

  const client = await store.clients.getById(clientId);
  if (!client) {
    throw Object.assign(new Error('Client not found'), { status: 404 });
  }

  const allReferences = await store.designReferences.listByClient(clientId);
  const usableReferences = allReferences.filter(isUsable);

  if (usableReferences.length === 0) {
    throw Object.assign(new Error('Client has no uploaded design references to analyze'), { status: 400 });
  }

  const brandContext = `Industry: ${client.industry ?? 'unknown'}. Notes: ${client.notes ?? 'none'}.`;

  const analyses: StyleAnalysis[] = [];
  for (const ref of usableReferences) {
    const buffer = await getObjectBuffer({
      storageProvider: ref.storageProvider,
      storageKey: ref.storageKey,
      storageBucket: ref.storageBucket,
    });
    const mimeType = ref.mimeType ?? 'image/png';
    const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;

    const prompt = createPromptBuilder(styleAnalysisTemplate)
      .setVariables({
        clientName: client.name,
        fileName: ref.originalFilename ?? ref.name,
        description: ref.description ?? '',
        tags: ref.tags.join(', '),
        brandContext,
      })
      .build();

    // Phase 3 Step 3: limited schema-retry via callAiForJson (same N1 pattern
    // as layout-generation). The transform adds the server-controlled fields
    // before validation — the model never invents these — and runs fresh on
    // every attempt.
    const outcome = await callAiForJson<StyleAnalysis>({
      router: modelRouter,
      request: {
        taskType: 'style_analysis',
        provider: env.AI_DEFAULT_PROVIDER,
        images: [dataUri],
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        outputFormat: 'json',
        maxTokens: prompt.metadata.maxTokens,
        temperature: prompt.metadata.temperature,
      },
      context: `style_analysis, reference ${ref.id}`,
      logPrefix: 'design-dna-analysis',
      transform: (raw) => ({
        ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}),
        id: uuid(),
        designReferenceId: ref.id,
        analyzedAt: new Date().toISOString(),
      }),
      validate: zodValidate(StyleAnalysisSchema),
    });

    if (!outcome.ok) {
      throw aiCallError(outcome);
    }
    const validatedData = outcome.data;

    const persisted = await store.designAnalysis.create({
      designReferenceId: ref.id,
      format: validatedData.format,
      aspectRatio: validatedData.aspectRatio,
      dominantColors: validatedData.dominantColors,
      typographyHierarchy: validatedData.typographyHierarchy,
      logoPosition: validatedData.logoPosition,
      imageTreatment: validatedData.imageTreatment,
      backgroundStyle: validatedData.backgroundStyle,
      textDensity: validatedData.textDensity,
      ctaStyle: validatedData.ctaStyle,
      layoutPattern: validatedData.layoutPattern,
      visualMood: validatedData.visualMood,
      brandConsistencyNotes: validatedData.brandConsistencyNotes,
      reusableDesignRules: validatedData.reusableDesignRules,
      designCategory: validatedData.designCategory,
      confidence: validatedData.confidence,
    });
    analyses.push(persisted);
  }

  const synthesisPrompt = createPromptBuilder(designDnaSynthesisTemplate)
    .setVariables({
      clientName: client.name,
      industry: client.industry ?? 'unknown',
      clientNotes: client.notes ?? 'none',
      analysisCount: String(analyses.length),
      styleAnalyses: JSON.stringify(analyses, null, 2),
    })
    .build();

  const synthesisOutcome = await callAiForJson<z.infer<typeof DesignDNAContentSchema>>({
    router: modelRouter,
    request: {
      taskType: 'design_dna_synthesis',
      provider: env.AI_DEFAULT_PROVIDER,
      systemPrompt: synthesisPrompt.system,
      userPrompt: synthesisPrompt.user,
      outputFormat: 'json',
      maxTokens: synthesisPrompt.metadata.maxTokens,
      temperature: synthesisPrompt.metadata.temperature,
    },
    context: 'design_dna_synthesis',
    logPrefix: 'design-dna-analysis',
    validate: zodValidate(DesignDNAContentSchema),
  });

  if (!synthesisOutcome.ok) {
    throw aiCallError(synthesisOutcome);
  }
  const dnaContent = synthesisOutcome.data;

  const confidenceScore =
    dnaContent.confidenceScore ?? analyses.reduce((sum, a) => sum + a.confidence, 0) / analyses.length;

  const designDna = await store.designDna.create({
    id: uuid(),
    clientId: client.id,
    status: 'generated',
    brandPersonality: dnaContent.brandPersonality,
    preferredLayouts: dnaContent.preferredLayouts,
    visualRules: dnaContent.visualRules,
    typographyRules: dnaContent.typographyRules,
    colorUsageRules: dnaContent.colorUsageRules,
    logoUsageRules: dnaContent.logoUsageRules,
    imageTreatmentRules: dnaContent.imageTreatmentRules,
    contentTone: dnaContent.contentTone,
    avoidList: dnaContent.avoidList,
    approvalBias: dnaContent.approvalBias,
    recommendedPromptStyle: dnaContent.recommendedPromptStyle,
    confidenceScore,
    referencesUsed: analyses.map((a) => a.designReferenceId),
    sourceAnalysisCount: analyses.length,
  });

  return { designDna, analyses };
}
