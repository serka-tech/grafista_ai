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
  type ExportFormat,
  type Layer,
  type RenderJob,
  type RenderPreset,
  type RequestedFormat,
} from '@grafista/schemas';
import { assertProductionJobReadyForRender } from './render-gate.js';
import { store } from '../data/store.js';
import { buildRenderHtml } from '../render/html-renderer.js';
import { getRendererAdapter } from '../render/adapters/factory.js';
import { getStorageProvider } from '../storage/factory.js';
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
    const canvas = { width, height };

    const { html, warnings } = buildRenderHtml({ canvas, layers });

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
