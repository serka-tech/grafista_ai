/**
 * Grafista AI Studio — Template Render Engine Orchestrator (Phase 2 Step 9A)
 *
 * Pipeline stage: production_jobs row (package_ready/approved) -> render
 * request -> HTML/CSS document (see ../render/html-renderer.ts) -> a
 * PNG/JPG/PDF export in object storage (see ../render/adapters/). Structured
 * exactly like production-package-builder.ts's buildProductionPackage():
 * domain-level permission double-guard first, then the gate, then a job row
 * created 'pending' -> 'rendering', then the actual work inside a try/catch
 * whose failure branch marks the job 'failed' with error_message before
 * rethrowing (same "failures are persisted, never swallowed" contract).
 *
 * DELIBERATE DEVIATION from buildProductionPackage(): NO idempotency check.
 * Every POST creates a brand-new render job, even for the same production
 * job + preset + format — unlike a production package (one canonical package
 * per generated output), a user may legitimately want to re-render (e.g.
 * after a renderer upgrade) or request a different preset/format for the
 * same already-packaged production job, so "re-sending" is never a no-op
 * here.
 */

import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import {
  RENDER_PRESET_DIMENSIONS,
  RENDER_PRESET_METADATA,
  type ExportFormat,
  type Layer,
  type RenderJob,
  type RenderPreset,
  type RenderWarning,
  type RequestedFormat,
} from '@grafista/schemas';
import { assertProductionJobReadyForRender } from './render-gate.js';
import { store } from '../data/store.js';
import { buildRenderHtml } from '../render/html-renderer.js';
import { assessRenderQuality } from '../render/render-quality.js';
import {
  extractSelectedVisual,
  planVisualComposition,
  type LoadedVisual,
} from '../render/visual-composition.js';
import { getRendererAdapter } from '../render/adapters/factory.js';
import { getStorageProvider } from '../storage/factory.js';
import { getObjectBuffer } from '../storage/file-service.js';
import type { StorageProviderName } from '../storage/types.js';
import { usersRepo } from '../db/repositories/users.js';
import { assertClientAccessible } from '../auth/client-access.js';
import { isRenderQueueEnabled, getRenderJobMaxAttempts } from './render-queue-env.js';
import { enqueueRenderJob } from './render-worker.js';

const CREATE_PERMISSION = 'render_jobs:create';

/**
 * DOMAIN-LEVEL permission guard (mirrors assertRequesterMayCreateProductionJobs
 * in production-package-builder.ts): re-verifies the requester's
 * 'render_jobs:create' permission fresh from the database, independently of
 * the Express middleware chain.
 */
async function assertRequesterMayCreateRenderJobs(requestedBy: string): Promise<void> {
  const requester = await usersRepo.getWithAccess(requestedBy);
  if (!requester || requester.status !== 'active' || !requester.permissions.includes(CREATE_PERMISSION)) {
    throw Object.assign(
      new Error(`Forbidden — user is not an active user with the '${CREATE_PERMISSION}' permission`),
      { status: 403 }
    );
  }
}

/**
 * Phase 3 Step 1 (F8) — resolves the production package's selected generated
 * visual into an embeddable base64 data URI. The manifest's
 * `selectedVisual.storage` coordinates (Step 8C) are read back through the
 * storage abstraction (getObjectBuffer — same in-process pattern
 * design-dna-analysis.ts uses), NEVER via the authenticated fileUrl route or
 * a raw public storage URL: the Playwright adapter loads the document with
 * page.setContent() and has no session cookie, so the image must be
 * self-contained in the HTML.
 *
 * This helper NEVER throws — a missing/unreadable visual degrades to a
 * structured warning and the render proceeds with the existing placeholder
 * behavior (warnings never fail a render, only adapter/storage-write errors
 * do).
 */
async function loadSelectedVisual(
  manifestSnapshot: Record<string, unknown> | undefined
): Promise<{ visual: LoadedVisual | null; warnings: RenderWarning[] }> {
  const section = extractSelectedVisual(manifestSnapshot);
  if (!section) {
    return {
      visual: null,
      warnings: [
        {
          code: 'selected_visual_missing',
          message:
            'Package manifest carries no selectedVisual/generatedOutput section — compositing skipped, image slots keep their placeholders',
          severity: 'info',
        },
      ],
    };
  }

  const storage = section.storage;
  const provider = storage?.provider;
  const key = storage?.key;
  if (!key || (provider !== 'local' && provider !== 's3')) {
    return {
      visual: null,
      warnings: [
        {
          code: 'selected_visual_storage_missing',
          message:
            'Selected visual has no usable storage coordinates in the package manifest — image slots keep their placeholders',
          severity: 'warning',
          details: { selectedVisualId: section.id ?? null, provider: provider ?? null },
        },
      ],
    };
  }

  try {
    const buffer = await getObjectBuffer({
      storageProvider: provider as StorageProviderName,
      storageBucket: storage?.bucket ?? '',
      storageKey: key,
    });
    const mimeType = section.mimeType && section.mimeType.startsWith('image/') ? section.mimeType : 'image/png';
    return {
      visual: {
        dataUri: `data:${mimeType};base64,${buffer.toString('base64')}`,
        mimeType,
        sizeBytes: buffer.length,
        dimensions: section.dimensions ?? null,
      },
      warnings: [],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[render-engine] selected visual could not be read from storage — degrading to placeholder: ${reason}`);
    return {
      visual: null,
      warnings: [
        {
          code: 'selected_visual_storage_missing',
          message: `Selected visual could not be read from storage (${reason}) — image slots keep their placeholders`,
          severity: 'warning',
          details: { selectedVisualId: section.id ?? null, storageKey: key },
        },
      ],
    };
  }
}

/**
 * Renders a package_ready/approved production job into one exported file
 * (PNG/JPG/PDF) at the requested preset. Synchronous — the whole pipeline
 * (HTML build -> adapter render -> checksum -> storage write -> artifact row
 * -> job 'rendered') runs within this call before it resolves.
 */
export async function renderProductionJob(
  productionJobId: string,
  requestedFormat: { preset: RenderPreset; exportFormat: ExportFormat },
  requestedBy: string
): Promise<RenderJob> {
  // DOMAIN GUARD then GATE — 403 before 404/409, same ordering as
  // buildProductionPackage().
  await assertRequesterMayCreateRenderJobs(requestedBy);
  const productionJob = await assertProductionJobReadyForRender(productionJobId);
  // Phase 3 Step 4 — client isolation hardening.
  await assertClientAccessible(requestedBy, productionJob.clientId);

  console.log(
    `[render-engine] render requested — productionJobId=${productionJobId} preset=${requestedFormat.preset} ` +
      `format=${requestedFormat.exportFormat} requestedBy=${requestedBy}`
  );

  const { width, height } = RENDER_PRESET_DIMENSIONS[requestedFormat.preset];

  // Step 9B — preset/exportFormat combination guard (defense in depth: the
  // route in render-jobs.ts has its own friendly 400 that fires first for
  // HTTP callers, mirroring this codebase's double-guard idiom — see
  // assertRequesterMayCreateRenderJobs above for the same pattern applied to
  // permissions). Runs BEFORE the render_jobs row is created below, so an
  // invalid combination never persists a job row.
  const allowedFormats = RENDER_PRESET_METADATA[requestedFormat.preset].allowedFormats;
  if (!allowedFormats.includes(requestedFormat.exportFormat)) {
    throw Object.assign(
      new Error(
        `Export format "${requestedFormat.exportFormat}" is not supported for preset "${requestedFormat.preset}" — allowed: ${allowedFormats.join(', ')}`
      ),
      { status: 400 }
    );
  }

  const fullRequestedFormat: RequestedFormat = {
    preset: requestedFormat.preset,
    exportFormat: requestedFormat.exportFormat,
    width,
    height,
  };

  // Phase 3 Step 5A — sync-vs-queue decision. Default OFF (RENDER_QUEUE_ENABLED
  // unset/falsy): the row is created 'pending' and this function runs the
  // whole pipeline inline before resolving, EXACTLY as before this step —
  // every pre-existing caller/test keeps seeing a terminal ('rendered' or a
  // thrown error) RenderJob back from this call. When ON, the row is created
  // 'queued' instead and this function returns IMMEDIATELY with that
  // non-terminal job — a worker (render-worker.ts) claims and executes it
  // later. See docs/render-queue-worker-plan.md §7.
  const queueEnabled = isRenderQueueEnabled();

  if (queueEnabled) {
    const queuedJob = await enqueueRenderJob({
      id: uuid(),
      clientId: productionJob.clientId,
      productionJobId: productionJob.id,
      requestedFormat: fullRequestedFormat,
      manifestSnapshot: productionJob.packageManifestSnapshot,
      templateContractSnapshot: productionJob.templateContractSnapshot,
      requestedBy,
    });
    console.log(`[render-engine] render job queued (worker will process it) — jobId=${queuedJob.id}`);
    return queuedJob;
  }

  const job = await store.renderJobs.create(
    {
      id: uuid(),
      clientId: productionJob.clientId,
      productionJobId: productionJob.id,
      requestedFormat: fullRequestedFormat,
      manifestSnapshot: productionJob.packageManifestSnapshot,
      templateContractSnapshot: productionJob.templateContractSnapshot,
      requestedBy,
    },
    { queued: false, maxAttempts: getRenderJobMaxAttempts() }
  );

  await store.renderJobs.updateStatus(job.id, 'rendering');

  try {
    const { rendererName, rendererVersion, renderWarnings } = await runRenderPipeline(job);
    const rendered = await store.renderJobs.updateStatus(job.id, 'rendered', {
      rendererName,
      rendererVersion,
      renderWarnings,
    });

    if (!rendered) {
      throw new Error(`Render job ${job.id} disappeared while rendering`);
    }

    console.log(`[render-engine] render ready — jobId=${rendered.id}`);

    // Phase 3 Step 6A — analytics event (best-effort). Sync (non-queue) path.
    await store.analyticsEvents.recordBestEffort({
      clientId: rendered.clientId,
      entityType: 'render_job',
      entityId: rendered.id,
      eventType: 'render_job_rendered',
      actorUserId: requestedBy,
      status: rendered.status,
      metadata: {
        preset: rendered.requestedFormat.preset,
        format: rendered.requestedFormat.exportFormat,
        width: rendered.requestedFormat.width,
        height: rendered.requestedFormat.height,
        warningCount: renderWarnings.length,
      },
    });

    return rendered;
  } catch (err) {
    // FAILURES ARE PERSISTED (same contract as production-package-builder.ts):
    // the job row is marked 'failed' with the error before the error propagates.
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[render-engine] render FAILED — jobId=${job.id} error=${errorMessage}`);
    await store.renderJobs.updateStatus(job.id, 'failed', { errorMessage });

    // Phase 3 Step 6A — analytics event (best-effort). Sync (non-queue) path.
    await store.analyticsEvents.recordBestEffort({
      clientId: job.clientId,
      entityType: 'render_job',
      entityId: job.id,
      eventType: 'render_job_failed',
      actorUserId: requestedBy,
      status: 'failed',
      metadata: {
        preset: job.requestedFormat.preset,
        format: job.requestedFormat.exportFormat,
      },
    });

    throw err;
  }
}

/**
 * Phase 3 Step 5A — the ACTUAL render pipeline (HTML build -> adapter render
 * -> checksum -> storage write -> export_artifacts row), extracted verbatim
 * out of renderProductionJob() so both the sync path above AND the polling
 * worker (render-worker.ts) can run the identical logic. Deliberately does
 * NOT touch render_jobs.status itself — the caller decides the surrounding
 * state transition (sync path: 'rendering' -> 'rendered'/'failed' inline;
 * worker: claim already set 'rendering', then 'rendered'/'queued'(retry)/
 * 'failed'/'cancelled' depending on outcome + job-level retry rules — see
 * render-worker.ts). Operates entirely off the render_jobs row's own
 * snapshotted fields (clientId, manifestSnapshot, requestedFormat) — it never
 * re-fetches the owning production_jobs row, so it works identically whether
 * called moments after creation (sync mode) or minutes later by a worker
 * (queue mode, after the production job may have moved on).
 */
export async function runRenderPipeline(
  job: RenderJob
): Promise<{ rendererName: string; rendererVersion: string; renderWarnings: RenderWarning[] }> {
  const { width, height } = job.requestedFormat;
  const manifestSnapshot = job.manifestSnapshot;

  // The requested PRESET's dimensions are the target canvas — NOT the
  // layout plan's own canvas size (see html-renderer.ts's module header):
  // this MVP does not scale/fit a mismatched layout plan into the target
  // format, it trusts that layout plans are normally already generated
  // per-target-format (layoutPlan.format), so the two usually line up.
  const layers = (manifestSnapshot?.layoutPlanSnapshot as { layers?: Layer[] } | undefined)?.layers ?? [];
  // Step 9B — safe zones live on the same layoutPlanSnapshot as layers;
  // `as any` for the same reason `layers` above needs a cast: this
  // snapshot is a loosely-typed Record<string, unknown> copy, not a
  // validated LayoutPlan.
  const safeZones = (manifestSnapshot?.layoutPlanSnapshot as any)?.safeZones ?? [];
  const canvas = { width, height };

  // Phase 3 Step 1 (F8) — load the package's selected generated visual from
  // storage and deterministically map it onto the layout's primary image
  // slot (see loadSelectedVisual above + render/visual-composition.ts).
  // Both halves degrade to warnings, never fail the render.
  const { visual, warnings: visualLoadWarnings } = await loadSelectedVisual(manifestSnapshot);
  const compositionPlan = visual
    ? planVisualComposition({ layers, visual })
    : { imageSources: {} as Record<string, string>, warnings: [] as RenderWarning[] };
  const imageSources = compositionPlan.imageSources;

  const { html, warnings: htmlWarnings } = buildRenderHtml({ canvas, layers, imageSources });
  // Step 9B — pre-render heuristic QA pass (see render-quality.ts's module
  // header: heuristics surfacing risk, not typographic ground truth).
  // Composition warnings come first (they explain what the renderer was
  // given), then the renderer's warnings (produced in layer order), then
  // the quality pass. Warnings NEVER fail a render — only a real adapter/
  // storage error does, via the caller's catch block.
  const qualityWarnings = assessRenderQuality({ canvas, layers, safeZones, imageSources });
  const warnings = [...visualLoadWarnings, ...compositionPlan.warnings, ...htmlWarnings, ...qualityWarnings];

  const adapter = getRendererAdapter();
  const { buffer, mimeType } = await adapter.render({
    html,
    width,
    height,
    format: job.requestedFormat.exportFormat,
  });

  const checksum = createHash('sha256').update(buffer).digest('hex');

  const key = `render-jobs/${job.clientId}/${job.id}/exports/${job.requestedFormat.preset.replace(/_/g, '-')}.${job.requestedFormat.exportFormat}`;

  const storageProvider = getStorageProvider();
  const stored = await storageProvider.putObject({ key, body: buffer, contentType: mimeType });

  await store.exportArtifacts.create({
    id: uuid(),
    renderJobId: job.id,
    clientId: job.clientId,
    format: job.requestedFormat.exportFormat,
    width,
    height,
    mimeType,
    storageProvider: stored.provider,
    storageBucket: stored.bucket,
    storageKey: stored.key,
    sizeBytes: buffer.length,
    checksum,
  });

  console.log(`[render-engine] pipeline complete — jobId=${job.id} key=${stored.key} sizeBytes=${buffer.length}`);

  return { rendererName: adapter.name, rendererVersion: adapter.version, renderWarnings: warnings };
}
