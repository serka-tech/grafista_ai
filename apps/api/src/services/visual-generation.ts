/**
 * Grafista AI Studio — Visual Generation Service (Phase 2 Step 7)
 *
 * Pipeline stage: approved LayoutPlan + cleared Creative QA report -> rendered
 * visual(s) in object storage + generated_outputs rows. Mirrors the service
 * skeleton of layout-generation.ts / creative-qa.ts (gate -> createPromptBuilder
 * -> modelRouter.complete -> parse/validate -> persist), with one deliberate
 * difference: FAILURES ARE PERSISTED. A provider or storage failure still writes
 * a 'failed' generated_outputs row (with error_message) before the error
 * propagates — failures must stay visible, never swallowed, and a failed write
 * must never masquerade as 'generated'.
 *
 * The production gate (assertReadyForVisualProduction) is the FIRST await of
 * runVisualGeneration — no code path can reach the AI provider, storage, or the
 * database without a Creative QA report in 'approved'/'passed' status.
 */

import { v4 as uuid } from 'uuid';
import { ModelRouter, type AIResponse } from '@grafista/model-router';
import { createPromptBuilder, visualGenerationTemplate } from '@grafista/prompt-engine';
import {
  VisualGenerationPayloadSchema,
  type CreativeQAReport,
  type GeneratedOutput,
  type VisualGenerationImage,
} from '@grafista/schemas';
import { assertReadyForVisualProduction } from './production-gate.js';
import { store } from '../data/store.js';
import { getStorageProvider } from '../storage/factory.js';

const modelRouter = new ModelRouter();

/** Per-image download timeout when the provider returns a URL instead of base64 bytes. */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface VisualGenerationResult {
  outputs: GeneratedOutput[];
}

/** Tolerates markdown code fences around the model's JSON output (same cleanup as layout-generation.ts / creative-qa.ts). */
function parseJsonFromModelOutput(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

function logAiCall(label: string, response: AIResponse): void {
  if (response.success) {
    console.log(
      `[visual-generation] ${label} ok — provider=${response.provider} model=${response.model} ` +
        `tokens(in/out/total)=${response.usage.inputTokens}/${response.usage.outputTokens}/${response.usage.totalTokens} ` +
        `estimatedCost=${response.usage.estimatedCost ?? 'n/a'} latencyMs=${response.latencyMs}`
    );
  } else {
    console.error(
      `[visual-generation] ${label} FAILED — provider=${response.provider} latencyMs=${response.latencyMs} error=${response.error}`
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

function notFound(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 404 });
}

/** Accepts either the canonical { images: [...] } payload or a bare array (same
 * tolerance layout-generation.ts extends to array wrappers). */
function normalizePayloadShape(raw: unknown): unknown {
  return Array.isArray(raw) ? { images: raw } : raw;
}

/** Picks the QA report whose clearance opened the gate: a human 'approved' report wins
 * over an AI 'passed' one; ties break to the most recent (lists are created_at ASC). */
function pickClearedReport(reports: CreativeQAReport[]): CreativeQAReport | undefined {
  const approved = reports.filter((r) => r.status === 'approved');
  if (approved.length > 0) return approved[approved.length - 1];
  const passed = reports.filter((r) => r.status === 'passed');
  return passed.length > 0 ? passed[passed.length - 1] : undefined;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function extensionForMime(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? 'png';
}

/** Resolves one provider image to raw bytes: base64 decoded in-process, or downloaded
 * when only a URL was returned. Throws on any download/decode problem — the caller
 * records that as a 'failed' row. */
async function resolveImageBytes(image: VisualGenerationImage): Promise<{ body: Buffer; mimeType: string }> {
  if (image.imageBase64) {
    const body = Buffer.from(image.imageBase64, 'base64');
    if (body.length === 0) {
      throw new Error('Provider returned empty base64 image data');
    }
    return { body, mimeType: image.mimeType ?? 'image/png' };
  }

  // Schema refine guarantees imageUrl is set when imageBase64 is not.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(image.imageUrl!, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Image download failed: HTTP ${response.status} from provider URL`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) {
      throw new Error('Image download returned an empty body');
    }
    const mimeType = image.mimeType ?? response.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    return { body, mimeType };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renders the given approved + QA-cleared LayoutPlan into one or more visual outputs.
 *
 * Flow: production gate (409 unless a Creative QA report for this layout plan is
 * 'approved'/'passed') -> prompt (visualGenerationTemplate) -> modelRouter.complete
 * (taskType 'image_generation'; routing table decides openai vs kie-ai) -> validate
 * payload (VisualGenerationPayloadSchema) -> per image: bytes -> object storage ->
 * generated_outputs row ('generated' on success, 'failed' + error_message when that
 * image's download/storage failed). Provider- or schema-level failure persists ONE
 * 'failed' row and then rethrows (502) — never silently swallowed.
 */
export async function runVisualGeneration(layoutPlanId: string, requestedBy: string): Promise<VisualGenerationResult> {
  // GATE — must stay the first await; nothing below runs for an uncleared layout plan.
  await assertReadyForVisualProduction(layoutPlanId);

  console.log(`[visual-generation] run requested — layoutPlanId=${layoutPlanId} requestedBy=${requestedBy}`);

  const layoutPlan = await store.layoutPlans.getById(layoutPlanId);
  if (!layoutPlan) {
    throw notFound('Layout plan not found');
  }

  const brief = await store.designBriefs.getById(layoutPlan.designBriefId);
  if (!brief) {
    throw notFound('Design brief not found');
  }

  const client = await store.clients.getById(brief.clientId);
  if (!client) {
    throw notFound('Client not found');
  }

  // The gate already guaranteed at least one cleared report exists.
  const qaReports = await store.creativeQaReports.listByLayoutPlan(layoutPlanId);
  const clearedReport = pickClearedReport(qaReports);

  // RE-RUN SEMANTICS: running generation again for the same layout plan is NOT
  // idempotent — it deliberately produces a NEW alternative set. alternative_index
  // continues from the existing row count (failed rows included), so every row across
  // all runs stays uniquely and monotonically indexed and a re-run's alternatives are
  // distinguishable from the first batch by index alone.
  const priorOutputs = await store.generatedOutputs.listByLayoutPlan(layoutPlanId);
  const alternativeIndexBase = priorOutputs.length;

  const qaSummary = clearedReport
    ? JSON.stringify(
        {
          summary: clearedReport.summary,
          finalRecommendation: clearedReport.finalRecommendation,
          highPriorityFixes: clearedReport.highPriorityFixes,
          mediumPriorityFixes: clearedReport.mediumPriorityFixes,
          lowPriorityFixes: clearedReport.lowPriorityFixes,
          designerNotes: clearedReport.designerNotes,
        },
        null,
        2
      )
    : 'No additional QA notes.';

  const prompt = createPromptBuilder(visualGenerationTemplate)
    .setVariables({
      layoutPlan: JSON.stringify(layoutPlan, null, 2),
      designBrief: JSON.stringify(brief, null, 2),
      qaSummary,
      canvasWidth: String(layoutPlan.canvas.width),
      canvasHeight: String(layoutPlan.canvas.height),
    })
    .build();

  // Snapshot of exactly what was sent to the image provider, persisted on every row.
  const promptSnapshot = `${prompt.system}\n\n${prompt.user}`;

  // No explicit `provider` here (unlike the text services): image_generation has its
  // own routing entry (primary 'openai', fallback 'kie-ai') and AI_DEFAULT_PROVIDER
  // only knows text providers — forcing it would break the image fallback chain.
  const aiResponse = await modelRouter.complete({
    taskType: 'image_generation',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    outputFormat: 'json',
    maxTokens: prompt.metadata.maxTokens,
    temperature: prompt.metadata.temperature,
    metadata: { aspectRatio: `${layoutPlan.canvas.width}:${layoutPlan.canvas.height}` },
  });
  logAiCall('image_generation', aiResponse);

  const baseRow = {
    clientId: client.id,
    designBriefId: brief.id,
    layoutPlanId: layoutPlan.id,
    creativeQaReportId: clearedReport?.id,
    type: 'preview_image' as const,
    generationMethod: 'ai_generated' as const,
    provider: aiResponse.provider,
    aiModel: aiResponse.model,
    promptSnapshot,
    createdBy: requestedBy,
  };

  /** Persists a 'failed' row so the failure is visible in the DB, then lets the caller rethrow. */
  async function recordRunFailure(errorMessage: string): Promise<void> {
    await store.generatedOutputs.create({
      ...baseRow,
      id: uuid(),
      name: `Visual generation failed — ${layoutPlan!.format}`,
      alternativeIndex: alternativeIndexBase + 1,
      status: 'failed',
      errorMessage,
      generationTimeMs: aiResponse.latencyMs,
    });
  }

  if (!aiResponse.success) {
    await recordRunFailure(aiResponse.error ?? 'AI provider error');
    throw providerError(aiResponse);
  }

  let raw: unknown;
  try {
    raw = normalizePayloadShape(parseJsonFromModelOutput(aiResponse.content));
  } catch (err) {
    const message = `AI response was not valid JSON (image_generation): ${err instanceof Error ? err.message : String(err)}`;
    await recordRunFailure(message);
    throw Object.assign(new Error(message), { status: 502 });
  }

  const validated = VisualGenerationPayloadSchema.safeParse(raw);
  if (!validated.success) {
    await recordRunFailure(`AI response failed schema validation (image_generation): ${validated.error.message}`);
    throw schemaError('image_generation', validated.error.message);
  }

  // Per image: bytes -> storage -> row. A failure for ONE image records that image as
  // 'failed' (never 'generated') and continues with the rest — partial success is
  // meaningful, and every failure remains visible via its own row + error_message.
  const outputs: GeneratedOutput[] = [];
  for (const [i, image] of validated.data.images.entries()) {
    const alternativeIndex = alternativeIndexBase + i + 1;
    const name = `${layoutPlan.format} visual — alternative ${alternativeIndex}`;

    try {
      const { body, mimeType } = await resolveImageBytes(image);

      // Same never-persist-metadata-on-storage-failure contract as storeUploadedFile():
      // putObject throws StorageError on any failure, which the catch below records.
      const storageProvider = getStorageProvider();
      const stored = await storageProvider.putObject({
        key: `generated-outputs/${client.id}/${uuid()}.${extensionForMime(mimeType)}`,
        body,
        contentType: mimeType,
      });

      const persisted = await store.generatedOutputs.create({
        ...baseRow,
        id: uuid(),
        name,
        alternativeIndex,
        status: 'generated',
        mimeType,
        fileSizeBytes: body.length,
        storageProvider: stored.provider,
        storageBucket: stored.bucket,
        storageKey: stored.key,
        dimensions:
          image.width && image.height
            ? { width: image.width, height: image.height }
            : { width: layoutPlan.canvas.width, height: layoutPlan.canvas.height },
        generationTimeMs: aiResponse.latencyMs,
      });
      outputs.push(persisted);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[visual-generation] image ${alternativeIndex} FAILED (download/storage) — layoutPlanId=${layoutPlanId} error=${errorMessage}`
      );
      const failedRow = await store.generatedOutputs.create({
        ...baseRow,
        id: uuid(),
        name,
        alternativeIndex,
        status: 'failed',
        errorMessage,
        generationTimeMs: aiResponse.latencyMs,
      });
      outputs.push(failedRow);
    }
  }

  return { outputs };
}
