import { Router, Request, Response, NextFunction } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { renderProductionJob } from '../services/render-engine.js';
import { cancelRenderJob } from '../services/render-worker.js';
import { getFileAccess } from '../storage/file-service.js';
import type { StorageProviderName } from '../storage/types.js';
import { assertClientAccessible } from '../auth/client-access.js';
import {
  ExportFormatEnum,
  RenderPresetEnum,
  RENDER_PRESET_METADATA,
  type ExportArtifact,
  type ExportFormat,
  type RenderPreset,
} from '@grafista/schemas';

// Mounted at /api — a production-job-scoped create route paired with its own
// list route (render history, added as a hotfix — see the GET
// /production-jobs/:id/render-jobs route below), plus standalone
// /render-jobs/:id and /export-artifacts/:id routes (mirrors how
// productionJobsRouter pairs its generated-output-scoped create route with
// its own list route, plus standalone /production-jobs/:id routes). Same
// "permission-only, no client scoping" authorization note as
// production-jobs.ts applies here too.
export const renderJobsRouter: Router = Router();

const VALID_PRESETS = new Set<string>(RenderPresetEnum.options);
const VALID_EXPORT_FORMATS = new Set<string>(ExportFormatEnum.options);

/**
 * Builds the compact artifact-summary shape embedded on each render job by
 * the render-history route below (GET /production-jobs/:id/render-jobs).
 * Phase 2 Step 9B polish: additive `preset` (the OWNING render job's own
 * requested preset — an export artifact has no preset field of its own),
 * `checksum` (nullable — ExportArtifactSchema itself allows it to be absent)
 * and `createdAt`, alongside the original id/format/width/height/mimeType/
 * sizeBytes/fileUrl fields already returned pre-9B.
 */
function buildArtifactSummary(artifact: ExportArtifact, preset: RenderPreset) {
  return {
    id: artifact.id,
    format: artifact.format,
    width: artifact.width,
    height: artifact.height,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    checksum: artifact.checksum ?? null,
    preset,
    createdAt: artifact.createdAt,
    fileUrl: `/api/export-artifacts/${artifact.id}/file`,
  };
}

// POST /api/production-jobs/:id/render — requests a render of a
// package_ready/approved production job at the given preset/exportFormat.
// Synchronous (the whole render pipeline runs within the request — see
// render-engine.ts). Body validated inline (no zod route-body schema — not
// this codebase's convention, see production-jobs.ts's reject route): both
// `preset` and `exportFormat` must be recognized strings, else 400 before the
// service is ever called. Phase 2 Step 9B additionally checks the two are a
// SUPPORTED COMBINATION (RENDER_PRESET_METADATA[preset].allowedFormats) —
// also a 400, also before the service is ever called; the service
// (render-engine.ts) re-checks the same combination independently as
// defense in depth for any non-HTTP caller. The gate (404 unknown job / 409
// not render-ready) and the domain-level permission double-guard (403) both
// live INSIDE the service and bubble to the centralized errorHandler
// untouched — EXCEPT the not-render-ready 409, which this route catches to
// additionally echo the production job's current status (see the catch below).
renderJobsRouter.post(
  '/production-jobs/:id/render',
  requireAuth,
  requirePermission('render_jobs:create'),
  asyncHandler(async (req: Request, res: Response) => {
    const preset = req.body?.preset;
    const exportFormat = req.body?.exportFormat;

    if (typeof preset !== 'string' || !VALID_PRESETS.has(preset)) {
      return res.status(400).json({
        error: `Invalid or missing "preset" — must be one of: ${[...VALID_PRESETS].join(', ')}`,
      });
    }
    if (typeof exportFormat !== 'string' || !VALID_EXPORT_FORMATS.has(exportFormat)) {
      return res.status(400).json({
        error: `Invalid or missing "exportFormat" — must be one of: ${[...VALID_EXPORT_FORMATS].join(', ')}`,
      });
    }

    const allowedFormats = RENDER_PRESET_METADATA[preset as RenderPreset].allowedFormats;
    if (!allowedFormats.includes(exportFormat as ExportFormat)) {
      return res.status(400).json({
        error: `Export format "${exportFormat}" is not supported for preset "${preset}" — allowed formats: ${allowedFormats.join(', ')}`,
      });
    }

    try {
      const renderJob = await renderProductionJob(
        req.params.id,
        { preset: preset as (typeof RenderPresetEnum.options)[number], exportFormat: exportFormat as (typeof ExportFormatEnum.options)[number] },
        req.user!.id
      );
      // Phase 3 Step 5A — sync mode (default, RENDER_QUEUE_ENABLED off)
      // always returns a TERMINAL job here ('rendered'; a failure throws
      // instead, see the catch below) -> 201, unchanged from before this
      // step. Queue mode returns a freshly-created, non-terminal 'queued'
      // job -> 202 Accepted (see docs/render-queue-worker-plan.md §7).
      const statusCode = renderJob.status === 'queued' ? 202 : 201;
      return res.status(statusCode).json({ data: renderJob });
    } catch (err) {
      // ── NOT-RENDER-READY 409 ── mirrors production-jobs.ts's approve/reject
      // 409 convention of echoing the job's current status, without touching
      // the central error contract: render-gate.ts attaches
      // `productionJobStatus` to its not-ready error, and this route
      // re-serializes it in the errorHandler's exact shape (error/message/
      // timestamp) plus the ADDITIVE `status` field. Every other error
      // (404 unknown job, defensive manifest 409, 403 domain guard, 502
      // renderer) still bubbles to the centralized errorHandler untouched.
      const e = err as Error & { status?: number; productionJobStatus?: string };
      if (e.status === 409 && typeof e.productionJobStatus === 'string') {
        return res.status(409).json({
          error: 'Conflict',
          message: e.message,
          timestamp: new Date().toISOString(),
          status: e.productionJobStatus,
        });
      }
      throw err;
    }
  })
);

// GET /api/production-jobs/:id/render-jobs — full render-job history for one
// production job, oldest first (mirrors production-jobs.ts's paired
// create-route + list-route pattern: this GET is paired with the POST
// /production-jobs/:id/render route above, the same way GET
// /generated-outputs/:generatedOutputId/production-jobs is paired with its
// own POST create route). Added as a hotfix: the dashboard's OutputCard
// (visual-outputs-panel.tsx) previously only ever showed the render job
// created during the current browser session because no persisted history
// endpoint existed — a page reload lost it. renderJobsRepo.
// listByProductionJob already existed (oldest-first) and just needed a route.
//
// (a) PERMISSION — render_jobs:read guards the whole list. Each render job's
// embedded artifactSummaries are METADATA only (id/format/width/height/
// mimeType/sizeBytes/fileUrl) — never file bytes — so gating the list on
// render_jobs:read alone is not a privilege widening: for the four seeded
// roles, render_jobs:read and export_artifacts:read are always granted
// together (see permissions.ts), and the actual file bytes stay behind
// export_artifacts:read on GET /export-artifacts/:id/file regardless of what
// this route returns — fileUrl only ever points at that route, it never
// serves bytes itself.
//
// (b) EXISTENCE + SCOPING — 404 when the production job itself doesn't
// exist. Once confirmed, the real relationship guard lives at the data
// layer: renderJobsRepo.listByProductionJob runs a parameterized
// `WHERE production_job_id = $1` — this route can never leak another
// production job's renders because the query itself is scoped to the id
// that was just verified to exist, not to some looser/derived filter.
//
// (c) LIST CONVENTION — returns [] (200), not 404, once the production job
// exists but has no renders yet (same convention as GET
// /render-jobs/:id/artifacts below, and every other list route in this
// codebase).
renderJobsRouter.get(
  '/production-jobs/:id/render-jobs',
  requireAuth,
  requirePermission('render_jobs:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const productionJob = await store.productionJobs.getById(req.params.id);
    if (!productionJob) return res.status(404).json({ error: 'Production job not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, productionJob.clientId);

    const jobs = await store.renderJobs.listByProductionJob(productionJob.id);

    // N+1 (one export_artifacts query per render job) is acceptable at MVP
    // scale — a production job realistically accumulates a handful of
    // renders, not hundreds. Promise.all keeps the per-job fetches
    // concurrent rather than serial.
    const jobsWithSummaries = await Promise.all(
      jobs.map(async (job) => {
        const artifacts = await store.exportArtifacts.listByRenderJob(job.id);
        const artifactSummaries = artifacts.map((artifact) =>
          buildArtifactSummary(artifact, job.requestedFormat.preset)
        );
        return { ...job, artifactSummaries };
      })
    );

    res.json({ data: jobsWithSummaries, total: jobsWithSummaries.length });
  })
);

// GET /api/render-jobs/:id
renderJobsRouter.get(
  '/render-jobs/:id',
  requireAuth,
  requirePermission('render_jobs:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const job = await store.renderJobs.getById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Render job not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, job.clientId);
    res.json({ data: job });
  })
);

// POST /api/render-jobs/:id/cancel (Phase 3 Step 5A) — requests cancellation
// of a non-terminal render job. `render_jobs:cancel` already existed as a
// permission key (020_render_jobs_permissions.sql) even though no code path
// used it before this step. pending/queued jobs are cancelled immediately;
// a 'rendering' job gets cancellationRequested=true and is finalized to
// 'cancelled' by the worker on its next observation (see render-worker.ts —
// real in-flight Playwright/storage interruption is NOT performed, a
// documented MVP limitation). An already-terminal job (rendered/failed/
// cancelled) is an explicit 409, never a silent no-op.
renderJobsRouter.post(
  '/render-jobs/:id/cancel',
  requireAuth,
  requirePermission('render_jobs:cancel'),
  asyncHandler(async (req: Request, res: Response) => {
    const job = await store.renderJobs.getById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Render job not found' });
    // Phase 3 Step 4 — client isolation hardening, same guard every other
    // route in this file already applies.
    await assertClientAccessible(req.user!.id, job.clientId);

    const updated = await cancelRenderJob(job.id, req.user!.id);
    res.json({ data: updated });
  })
);

// GET /api/render-jobs/:id/artifacts — list route: returns [] (200), not 404,
// when the job exists but has no artifacts yet (mirrors production-jobs.ts's
// list-route convention). Uses export_artifacts:read (artifact-focused
// route) rather than render_jobs:read — for the four seeded roles today the
// two permissions are always granted together, so this has no behavioral
// difference in practice, but it is the more semantically correct guard.
//
// Phase 2 Step 9B polish: each item ADDITIVELY gains `preset` (from the
// owning render job's own requestedFormat.preset — an artifact has no
// preset field of its own) and `fileUrl`, alongside every existing 9A field
// on the artifact (id/format/width/height/mimeType/storageProvider/
// storageBucket/storageKey/sizeBytes/checksum/createdAt) — nothing removed,
// existing 9A tests assert on those.
renderJobsRouter.get(
  '/render-jobs/:id/artifacts',
  requireAuth,
  requirePermission('export_artifacts:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const job = await store.renderJobs.getById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Render job not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, job.clientId);

    const artifacts = await store.exportArtifacts.listByRenderJob(job.id);
    const data = artifacts.map((artifact) => ({
      ...artifact,
      preset: job.requestedFormat.preset,
      fileUrl: `/api/export-artifacts/${artifact.id}/file`,
    }));
    res.json({ data, total: data.length });
  })
);

// GET /api/export-artifacts/:id/file — authenticated, permission-checked
// access to the exported file bytes. Same access pattern as
// production-jobs.ts's /production-jobs/:id/package route: local streams
// through this route, S3 redirects to a short-lived signed URL.
renderJobsRouter.get(
  '/export-artifacts/:id/file',
  requireAuth,
  requirePermission('export_artifacts:read'),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const artifact = await store.exportArtifacts.getById(req.params.id);
    if (!artifact) return res.status(404).json({ error: 'Export artifact not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, artifact.clientId);

    const filename = `export-${artifact.id}.${artifact.format}`;

    const access = await getFileAccess(
      {
        storageProvider: artifact.storageProvider as StorageProviderName,
        storageKey: artifact.storageKey,
        storageBucket: artifact.storageBucket,
      },
      filename,
      artifact.mimeType
    );

    if (access.kind === 'redirect') {
      return res.redirect(302, access.url);
    }

    res.setHeader('Content-Type', access.contentType ?? artifact.mimeType ?? 'application/octet-stream');
    if (access.contentLength != null) res.setHeader('Content-Length', String(access.contentLength));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    access.stream.on('error', next);
    access.stream.pipe(res);
  })
);
