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

  const job = await store.renderJobs.create({
    id: uuid(),
    clientId: productionJob.clientId,
    productionJobId: productionJob.id,
    requestedFormat: fullRequestedFormat,
    manifestSnapshot: productionJob.packageManifestSnapshot,
    templateContractSnapshot: productionJob.templateContractSnapshot,
    requestedBy,
  });

  await store.renderJobs.updateStatus(job.id, 'rendering');

  try {
    // The requested PRESET's dimensions are the target canvas — NOT the
    // layout plan's own canvas size (see html-renderer.ts's module header):
    // this MVP does not scale/fit a mismatched layout plan into the target
    // format, it trusts that layout plans are normally already generated
    // per-target-format (layoutPlan.format), so the two usually line up.
    const layers = (productionJob.packageManifestSnapshot?.layoutPlanSnapshot as { layers?: Layer[] } | undefined)
      ?.layers ?? [];
    // Step 9B — safe zones live on the same layoutPlanSnapshot as layers;
    // `as any` for the same reason `layers` above needs a cast: this
    // snapshot is a loosely-typed Record<string, unknown> copy, not a
    // validated LayoutPlan.
    const safeZones = (productionJob.packageManifestSnapshot?.layoutPlanSnapshot as any)?.safeZones ?? [];
    const canvas = { width, height };

    // Phase 3 Step 1 (F8) — load the package's selected generated visual from
    // storage and deterministically map it onto the layout's primary image
    // slot (see loadSelectedVisual above + render/visual-composition.ts).
    // Both halves degrade to warnings, never fail the render.
    const { visual, warnings: visualLoadWarnings } = await loadSelectedVisual(productionJob.packageManifestSnapshot);
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
    // storage error does, via the catch block below (unchanged).
    const qualityWarnings = assessRenderQuality({ canvas, layers, safeZones, imageSources });
    const warnings = [...visualLoadWarnings, ...compositionPlan.warnings, ...htmlWarnings, ...qualityWarnings];

    const adapter = getRendererAdapter();
    const { buffer, mimeType } = await adapter.render({
      html,
      width,
      height,
      format: requestedFormat.exportFormat,
    });

    const checksum = createHash('sha256').update(buffer).digest('hex');

    const key = `render-jobs/${productionJob.clientId}/${job.id}/exports/${requestedFormat.preset.replace(/_/g, '-')}.${requestedFormat.exportFormat}`;

    const storageProvider = getStorageProvider();
    const stored = await storageProvider.putObject({ key, body: buffer, contentType: mimeType });

    await store.exportArtifacts.create({
      id: uuid(),
      renderJobId: job.id,
      clientId: productionJob.clientId,
      format: requestedFormat.exportFormat,
      width,
      height,
      mimeType,
      storageProvider: stored.provider,
      storageBucket: stored.bucket,
      storageKey: stored.key,
      sizeBytes: buffer.length,
      checksum,
    });

    const rendered = await store.renderJobs.updateStatus(job.id, 'rendered', {
      rendererName: adapter.name,
      rendererVersion: adapter.version,
      renderWarnings: warnings,
    });

    if (!rendered) {
      throw new Error(`Render job ${job.id} disappeared while rendering`);
    }

    console.log(
      `[render-engine] render ready — jobId=${rendered.id} key=${stored.key} sizeBytes=${buffer.length}`
    );
    return rendered;
  } catch (err) {
    // FAILURES ARE PERSISTED (same contract as production-package-builder.ts):
    // the job row is marked 'failed' with the error before the error propagates.
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[render-engine] render FAILED — jobId=${job.id} error=${errorMessage}`);
    await store.renderJobs.updateStatus(job.id, 'failed', { errorMessage });
    throw err;
  }
}
