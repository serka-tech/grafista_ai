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
import { ModelRouter, type AIResponse } from '@grafista/model-router';
import { createPromptBuilder, styleAnalysisTemplate, designDnaSynthesisTemplate } from '@grafista/prompt-engine';
import { StyleAnalysisSchema, DesignDNAContentSchema, type StyleAnalysis, type DesignDNA } from '@grafista/schemas';
import { store } from '../data/store.js';
import { env } from '../config/env.js';
import { getObjectBuffer } from '../storage/file-service.js';
import type { DesignReference } from '../db/repositories/design-references.js';

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

/** Tolerates markdown code fences around the model's JSON output (same cleanup as content-ideas.ts). */
function parseJsonFromModelOutput(content: string): Record<string, unknown> {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

function logAiCall(label: string, response: AIResponse): void {
  if (response.success) {
    console.log(
      `[design-dna-analysis] ${label} ok — provider=${response.provider} model=${response.model} ` +
        `tokens(in/out/total)=${response.usage.inputTokens}/${response.usage.outputTokens}/${response.usage.totalTokens} ` +
        `estimatedCost=${response.usage.estimatedCost ?? 'n/a'} latencyMs=${response.latencyMs}`
    );
  } else {
    console.error(
      `[design-dna-analysis] ${label} FAILED — provider=${response.provider} latencyMs=${response.latencyMs} error=${response.error}`
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

    const aiResponse = await modelRouter.complete({
      taskType: 'style_analysis',
      provider: env.AI_DEFAULT_PROVIDER,
      images: [dataUri],
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      outputFormat: 'json',
      maxTokens: prompt.metadata.maxTokens,
      temperature: prompt.metadata.temperature,
    });
    logAiCall(`style_analysis (reference ${ref.id})`, aiResponse);

    if (!aiResponse.success) {
      throw providerError(aiResponse);
    }

    let rawAnalysis: Record<string, unknown>;
    try {
      rawAnalysis = parseJsonFromModelOutput(aiResponse.content);
    } catch (err) {
      throw Object.assign(
        new Error(`AI response was not valid JSON (style_analysis, reference ${ref.id}): ${err instanceof Error ? err.message : String(err)}`),
        { status: 502 }
      );
    }

    // Server-controlled fields, filled in before validation — the model never invents these.
    const candidate = {
      ...rawAnalysis,
      id: uuid(),
      designReferenceId: ref.id,
      analyzedAt: new Date().toISOString(),
    };
    const validated = StyleAnalysisSchema.safeParse(candidate);
    if (!validated.success) {
      throw schemaError(`style_analysis, reference ${ref.id}`, validated.error.message);
    }

    const persisted = await store.designAnalysis.create({
      designReferenceId: ref.id,
      format: validated.data.format,
      aspectRatio: validated.data.aspectRatio,
      dominantColors: validated.data.dominantColors,
      typographyHierarchy: validated.data.typographyHierarchy,
      logoPosition: validated.data.logoPosition,
      imageTreatment: validated.data.imageTreatment,
      backgroundStyle: validated.data.backgroundStyle,
      textDensity: validated.data.textDensity,
      ctaStyle: validated.data.ctaStyle,
      layoutPattern: validated.data.layoutPattern,
      visualMood: validated.data.visualMood,
      brandConsistencyNotes: validated.data.brandConsistencyNotes,
      reusableDesignRules: validated.data.reusableDesignRules,
      designCategory: validated.data.designCategory,
      confidence: validated.data.confidence,
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

  const synthesisResponse = await modelRouter.complete({
    taskType: 'design_dna_synthesis',
    provider: env.AI_DEFAULT_PROVIDER,
    systemPrompt: synthesisPrompt.system,
    userPrompt: synthesisPrompt.user,
    outputFormat: 'json',
    maxTokens: synthesisPrompt.metadata.maxTokens,
    temperature: synthesisPrompt.metadata.temperature,
  });
  logAiCall('design_dna_synthesis', synthesisResponse);

  if (!synthesisResponse.success) {
    throw providerError(synthesisResponse);
  }

  let rawDna: Record<string, unknown>;
  try {
    rawDna = parseJsonFromModelOutput(synthesisResponse.content);
  } catch (err) {
    throw Object.assign(
      new Error(`AI response was not valid JSON (design_dna_synthesis): ${err instanceof Error ? err.message : String(err)}`),
      { status: 502 }
    );
  }

  const validatedDna = DesignDNAContentSchema.safeParse(rawDna);
  if (!validatedDna.success) {
    throw schemaError('design_dna_synthesis', validatedDna.error.message);
  }

  const confidenceScore =
    validatedDna.data.confidenceScore ?? analyses.reduce((sum, a) => sum + a.confidence, 0) / analyses.length;

  const designDna = await store.designDna.create({
    id: uuid(),
    clientId: client.id,
    status: 'generated',
    brandPersonality: validatedDna.data.brandPersonality,
    preferredLayouts: validatedDna.data.preferredLayouts,
    visualRules: validatedDna.data.visualRules,
    typographyRules: validatedDna.data.typographyRules,
    colorUsageRules: validatedDna.data.colorUsageRules,
    logoUsageRules: validatedDna.data.logoUsageRules,
    imageTreatmentRules: validatedDna.data.imageTreatmentRules,
    contentTone: validatedDna.data.contentTone,
    avoidList: validatedDna.data.avoidList,
    approvalBias: validatedDna.data.approvalBias,
    recommendedPromptStyle: validatedDna.data.recommendedPromptStyle,
    confidenceScore,
    referencesUsed: analyses.map((a) => a.designReferenceId),
    sourceAnalysisCount: analyses.length,
  });

  return { designDna, analyses };
}
