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
import { ModelRouter } from '@grafista/model-router';
import { createPromptBuilder, visualGenerationTemplate } from '@grafista/prompt-engine';
import {
  VisualGenerationPayloadSchema,
  BrandPaletteSchema,
  type CreativeQAReport,
  type GeneratedOutput,
  type VisualGenerationImage,
  type VisualGenerationPayload,
} from '@grafista/schemas';
import { assertReadyForVisualProduction } from './production-gate.js';
import { store } from '../data/store.js';
import { getStorageProvider } from '../storage/factory.js';
import { aiCallError, callAiForJson, type ValidateResult } from './ai-call-helper.js';
import { assertClientAccessible } from '../auth/client-access.js';
import { assertWithinClientBudget } from './visual-generation-budget.js';
import { describeLayoutForImagePrompt } from './visual-prompt-layout.js';

const modelRouter = new ModelRouter();

const PALETTE_ROLE_LABEL: Record<string, string> = {
  primary: 'primary / main brand color',
  secondary: 'secondary',
  accent: 'accent / highlight',
  background: 'background / base',
  text: 'text',
  other: 'supporting',
};

/**
 * Role-tagged brand palette text for the image prompt, read from the client's
 * color_palette asset (metadata.palette — extracted from the uploaded kartela and
 * user-edited). Returns '' when none is set, so the template falls back to the
 * layout's own colors. This is the fix for the "flat single color" output: the
 * real palette now reaches the image model instead of a lone background color.
 */
async function loadBrandPaletteText(clientId: string): Promise<string> {
  const assets = await store.brandAssets.listByClient(clientId);
  for (let i = assets.length - 1; i >= 0; i -= 1) {
    const a = assets[i];
    if (a.type !== 'color_palette') continue;
    const parsed = BrandPaletteSchema.safeParse((a.metadata as { palette?: unknown } | undefined)?.palette);
    if (!parsed.success) continue;
    const distinctHex = new Set(parsed.data.map((c) => c.hex.toUpperCase()));
    if (distinctHex.size < 2) return '';
    return parsed.data
      .map((c) => `- ${c.hex} — ${PALETTE_ROLE_LABEL[c.role] ?? c.role}${c.name ? ` (${c.name})` : ''}`)
      .join('\n');
  }
  return '';
}

/** Per-image download timeout when the provider returns a URL instead of base64 bytes. */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface VisualGenerationResult {
  outputs: GeneratedOutput[];
}

function notFound(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 404 });
}

/** Accepts either the canonical { images: [...] } payload or a bare array (same
 * tolerance layout-generation.ts extends to array wrappers). */
function normalizePayloadShape(raw: unknown): unknown {
  return Array.isArray(raw) ? { images: raw } : raw;
}

/** Validation step for callAiForJson — runs AFTER the normalizePayloadShape transform. */
function validateVisualPayload(raw: unknown): ValidateResult<VisualGenerationPayload> {
  const validated = VisualGenerationPayloadSchema.safeParse(raw);
  return validated.success ? { ok: true, data: validated.data } : { ok: false, error: validated.error.message };
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
/** Image providers a caller may explicitly pick (KIE vs OpenAI comparison). */
export type VisualProvider = 'openai' | 'kie-ai';

export async function runVisualGeneration(
  layoutPlanId: string,
  requestedBy: string,
  provider?: VisualProvider
): Promise<VisualGenerationResult> {
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
  // Phase 3 Step 4 — client isolation hardening.
  await assertClientAccessible(requestedBy, client.id);

  // Production go-live M2.1 — monthly per-client AI-image budget guard. Runs
  // before any provider call so a client that hit its ceiling never triggers
  // paid generation. No-op unless CLIENT_MONTHLY_BUDGET_USD is set.
  await assertWithinClientBudget(client.id);

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

  // F8 fix (go-live M2.3): feed a SEMANTIC layout description, not the raw
  // layout JSON. The image model was rendering literal position coordinates
  // ("(30, 30)") from the JSON as visible text on the generated visual; the
  // description carries the same composition intent (roles, copy, colors,
  // relative placement) without the pixel-coordinate numbers that leaked.
  const brandPaletteText = await loadBrandPaletteText(client.id);

  const prompt = createPromptBuilder(visualGenerationTemplate)
    .setVariables({
      layoutPlan: describeLayoutForImagePrompt(layoutPlan),
      brandPalette:
        brandPaletteText || 'No explicit brand palette provided — use the colors from the layout description.',
      designBrief: JSON.stringify(brief, null, 2),
      qaSummary,
      canvasWidth: String(layoutPlan.canvas.width),
      canvasHeight: String(layoutPlan.canvas.height),
    })
    .build();

  // Snapshot of exactly what was sent to the image provider, persisted on every row.
  const promptSnapshot = `${prompt.system}\n\n${prompt.user}`;

  // Provider selection: when the caller explicitly picks one (KIE-vs-OpenAI
  // comparison), pass it through so the router bypasses capability filtering and
  // uses exactly that adapter. When omitted, image_generation's own routing
  // entry decides (both openai and kie-ai are image-capable now).
  //
  // Phase 3 Step 3: limited schema-retry via callAiForJson (same N1 pattern as
  // layout-generation), with one deliberate persistence rule — the 'failed'
  // generated_outputs row is written ONLY after the FINAL attempt fails, so an
  // attempt that recovers on retry leaves no failed row behind. The aspect
  // ratio still goes out raw ("W:H" pixels); the KieAIAdapter boundary
  // normalizes it (Step 13 hotfix A — unchanged).
  const outcome = await callAiForJson<VisualGenerationPayload>({
    router: modelRouter,
    request: {
      taskType: 'image_generation',
      ...(provider ? { provider } : {}),
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      outputFormat: 'json',
      maxTokens: prompt.metadata.maxTokens,
      temperature: prompt.metadata.temperature,
      metadata: { aspectRatio: `${layoutPlan.canvas.width}:${layoutPlan.canvas.height}` },
    },
    context: 'image_generation',
    logPrefix: 'visual-generation',
    transform: normalizePayloadShape,
    validate: validateVisualPayload,
  });

  // Last attempt's response — provider/model/latency for every persisted row
  // (success or failure) come from the attempt that actually concluded the run.
  const aiResponse = outcome.response;

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
    const failedRow = await store.generatedOutputs.create({
      ...baseRow,
      id: uuid(),
      name: `Visual generation failed — ${layoutPlan!.format}`,
      alternativeIndex: alternativeIndexBase + 1,
      status: 'failed',
      errorMessage,
      generationTimeMs: aiResponse.latencyMs,
    });

    // Phase 3 Step 6A — analytics event (best-effort). AI-call-level failure
    // (outcome.ok === false): provider/model/attempts come from the last
    // attempt's AIResponse, matching what ai-call-helper.ts already logs.
    await store.analyticsEvents.recordBestEffort({
      clientId: baseRow.clientId,
      entityType: 'generated_output',
      entityId: failedRow.id,
      eventType: 'visual_generation_failed',
      actorUserId: requestedBy,
      provider: aiResponse.provider,
      model: aiResponse.model,
      status: 'failed',
      durationMs: aiResponse.latencyMs ?? null,
      metadata: {
        attempts: outcome.attempts,
        errorKind: aiResponse.errorKind ?? null,
        tokenInput: aiResponse.usage?.inputTokens ?? null,
        tokenOutput: aiResponse.usage?.outputTokens ?? null,
        estimatedCost: aiResponse.usage?.estimatedCost ?? null,
      },
    });
  }

  if (!outcome.ok) {
    // FAILURES ARE PERSISTED (module contract) — but only after the final
    // attempt: a schema flake that succeeds on the automatic retry must not
    // leave a phantom 'failed' row behind.
    await recordRunFailure(outcome.errorMessage);
    throw aiCallError(outcome);
  }

  // Per image: bytes -> storage -> row. A failure for ONE image records that image as
  // 'failed' (never 'generated') and continues with the rest — partial success is
  // meaningful, and every failure remains visible via its own row + error_message.
  const outputs: GeneratedOutput[] = [];
  for (const [i, image] of outcome.data.images.entries()) {
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

      // Same protected-fileUrl pattern as brand-assets/design-references: the URL is the
      // authenticated file route (GET /api/visual-outputs/:id/file), never a raw storage
      // location — local streams through the API, S3 redirects to a short-lived signed URL.
      const outputId = uuid();
      const persisted = await store.generatedOutputs.create({
        ...baseRow,
        id: outputId,
        name,
        alternativeIndex,
        status: 'generated',
        fileUrl: `/api/visual-outputs/${outputId}/file`,
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

      // Phase 3 Step 6A — analytics event (best-effort).
      await store.analyticsEvents.recordBestEffort({
        clientId: client.id,
        entityType: 'generated_output',
        entityId: persisted.id,
        eventType: 'visual_generation_succeeded',
        actorUserId: requestedBy,
        provider: aiResponse.provider,
        model: aiResponse.model,
        status: 'generated',
        durationMs: aiResponse.latencyMs ?? null,
        metadata: {
          attempts: outcome.attempts,
          tokenInput: aiResponse.usage?.inputTokens ?? null,
          tokenOutput: aiResponse.usage?.outputTokens ?? null,
          estimatedCost: aiResponse.usage?.estimatedCost ?? null,
        },
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

      // Phase 3 Step 6A — analytics event (best-effort). Per-image storage/
      // download failure — same event type as the AI-call-level failure
      // above (both are "visual generation didn't produce a usable image"),
      // but this one has no retry/attempts count of its own.
      await store.analyticsEvents.recordBestEffort({
        clientId: client.id,
        entityType: 'generated_output',
        entityId: failedRow.id,
        eventType: 'visual_generation_failed',
        actorUserId: requestedBy,
        provider: aiResponse.provider,
        model: aiResponse.model,
        status: 'failed',
        durationMs: aiResponse.latencyMs ?? null,
        metadata: { errorKind: 'storage_or_download_failure' },
      });

      outputs.push(failedRow);
    }
  }

  return { outputs };
}
