import { Router, Request, Response, NextFunction } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { buildProductionPackage } from '../services/production-package-builder.js';
import { getFileAccess } from '../storage/file-service.js';
import type { StorageProviderName } from '../storage/types.js';
import type { ProductionJob } from '@grafista/schemas';
import { assertClientAccessible } from '../auth/client-access.js';

const PACKAGE_DOWNLOAD_FILENAME = 'production-package.json';

// Step 8C — small, read-only summary of a production job's package derived
// PURELY from data already on the row (packageManifestSnapshot, the DB
// snapshot written at 'package_ready' time — see production-package-builder.ts)
// and the job's own status/packageSizeBytes. No storage round-trip, no new
// fields on the job row itself — this is a view built at response time.
// Safe before packaging finishes: packageManifestSnapshot is null/undefined
// for 'pending'/'packaging'/'failed' jobs, in which case packageVersion/
// targetFormats/canvasSize degrade to null/[]/null rather than throwing.
type PackageSummary = {
  packageVersion: number | null;
  targetFormats: unknown[];
  canvasSize: { width: number; height: number } | null;
  packageReady: boolean;
  packageSizeBytes: number | null;
  reviewStatus: ProductionJob['status'];
};

function buildPackageSummary(
  job: Pick<ProductionJob, 'status' | 'packageSizeBytes' | 'packageManifestSnapshot'>
): PackageSummary {
  const manifest = job.packageManifestSnapshot;
  const templateContract = manifest?.templateContract as Record<string, unknown> | undefined;
  const targetFormats = Array.isArray(templateContract?.targetFormats)
    ? (templateContract!.targetFormats as unknown[])
    : [];
  const canvasSize = (templateContract?.canvas as { width: number; height: number } | undefined) ?? null;
  const packageVersion =
    (manifest?.packageVersion as number | undefined) ?? (manifest?.manifestVersion as number | undefined) ?? null;

  return {
    packageVersion,
    targetFormats,
    canvasSize,
    packageReady: job.status === 'package_ready' || job.status === 'approved',
    packageSizeBytes: job.packageSizeBytes ?? null,
    reviewStatus: job.status,
  };
}

// Mounted at /api — a generated-output-scoped create route plus standalone
// /production-jobs/:id routes (mirrors how visualGenerationRouter pairs its
// layout-plan-scoped run route with standalone /visual-outputs/:id routes).
//
// AUTHORIZATION NOTE — permission-only, no client scoping: this codebase has
// no per-client access model (UserWithAccess carries global roles/permissions
// only, and no existing read route — see visual-generation.ts's GET
// /visual-outputs/:id — filters by the requester's client membership), so
// these routes deliberately mirror that convention instead of inventing one.
export const productionJobsRouter: Router = Router();

// POST /api/generated-outputs/:generatedOutputId/production-jobs — sends one
// generated visual to production packaging. Synchronous (the package is built
// within the request). The production gate lives INSIDE the service (its first
// awaits): 404 unknown output / 409 output not in 'generated' status already
// carry a `.status` and bubble to the centralized errorHandler — not
// re-implemented or reformatted here (same contract as visual-generation.ts).
// Idempotent: an existing active job for the output is returned as-is instead
// of duplicating work. The service ALSO re-verifies the requester's
// 'production_jobs:create' permission independently of this middleware chain
// (domain-level double guard, mirroring engine.ts's bindingPermission check).
productionJobsRouter.post(
  '/generated-outputs/:generatedOutputId/production-jobs',
  requireAuth,
  requirePermission('production_jobs:create'),
  asyncHandler(async (req: Request, res: Response) => {
    const job = await buildProductionPackage(req.params.generatedOutputId, req.user!.id);
    res.status(201).json({ data: job });
  })
);

// GET /api/generated-outputs/:generatedOutputId/production-jobs — full job
// history (including failed/cancelled/rejected) for one generated output. A
// list endpoint — returns [] (200), not 404, when none exist yet (mirrors
// visual-generation.ts's list route).
productionJobsRouter.get(
  '/generated-outputs/:generatedOutputId/production-jobs',
  requireAuth,
  requirePermission('production_jobs:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const jobs = await store.productionJobs.listByGeneratedOutput(req.params.generatedOutputId);
    // Step 8C — packageSummary attached per-item (additive field on each job
    // object) rather than as a separate parallel array, so consumers that
    // already iterate `data` (e.g. the dashboard's listProductionJobs call)
    // get it for free without an index-correlation step.
    res.json({ data: jobs.map((job) => ({ ...job, packageSummary: buildPackageSummary(job) })), total: jobs.length });
  })
);

// GET /api/production-jobs/:id
productionJobsRouter.get(
  '/production-jobs/:id',
  requireAuth,
  requirePermission('production_jobs:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const job = await store.productionJobs.getById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Production job not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, job.clientId);
    // Step 8C — packageSummary is purely additive alongside the existing
    // `data: job` shape; nothing already reading `data` is affected.
    res.json({ data: job, packageSummary: buildPackageSummary(job) });
  })
);

// GET /api/production-jobs/:id/package — authenticated, permission-checked
// access to the built JSON package bytes. Same access pattern as
// visual-outputs/:id/file: local streams through this route, S3 redirects to a
// short-lived signed URL. Storage coordinates are only ever written together
// with the 'package_ready' transition (and never cleared afterwards — see
// productionJobsRepo.updateStatus), so missing coordinates mean the package
// was never built ('pending'/'packaging'/'failed'/'cancelled' before
// packaging finished) — a 404, because the file does not exist.
productionJobsRouter.get(
  '/production-jobs/:id/package',
  requireAuth,
  requirePermission('production_jobs:read'),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const job = await store.productionJobs.getById(req.params.id);
    if (!job || !job.packageStorageKey || !job.packageStorageProvider || !job.packageStorageBucket) {
      return res.status(404).json({ error: 'Package not found' });
    }
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, job.clientId);

    const access = await getFileAccess(
      {
        storageProvider: job.packageStorageProvider as StorageProviderName,
        storageKey: job.packageStorageKey,
        storageBucket: job.packageStorageBucket,
      },
      PACKAGE_DOWNLOAD_FILENAME,
      job.packageMimeType
    );

    if (access.kind === 'redirect') {
      return res.redirect(302, access.url);
    }

    res.setHeader('Content-Type', access.contentType ?? job.packageMimeType ?? 'application/octet-stream');
    if (access.contentLength != null) res.setHeader('Content-Length', String(access.contentLength));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(PACKAGE_DOWNLOAD_FILENAME)}"`);
    access.stream.on('error', next);
    access.stream.pipe(res);
  })
);

// POST /api/production-jobs/:id/approve — human sign-off on the built package.
// The repo guard only matches status = 'package_ready' rows, so approving a
// 'pending'/'packaging'/'failed' job or re-approving is a 409 (mirrors
// visual-generation.ts's approve route). Records approved_by/approved_at;
// see the reject route below for the equivalent reject-side audit trail
// added in Phase 2 Step 8B.
productionJobsRouter.post(
  '/production-jobs/:id/approve',
  requireAuth,
  requirePermission('production_jobs:approve'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await store.productionJobs.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Production job not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, existing.clientId);

    const approved = await store.productionJobs.approve(existing.id, req.user!.id);
    if (!approved) {
      return res.status(409).json({
        error: 'Production job is not in an approvable state',
        status: existing.status,
      });
    }

    // Phase 3 Step 6A — analytics event (best-effort).
    await store.analyticsEvents.recordBestEffort({
      clientId: approved.clientId,
      entityType: 'production_job',
      entityId: approved.id,
      eventType: 'production_job_approved',
      actorUserId: req.user!.id,
      status: approved.status,
    });

    res.json({ data: approved });
  })
);

// POST /api/production-jobs/:id/reject — same 'package_ready'-only guard as
// approve. Optional body { reason?: string }: a rejected job is still
// terminal (no revision_requested state — a new job is created instead of a
// revision loop), but Phase 2 Step 8B adds an audit trail (rejected_by/
// rejected_at/rejection_reason, see 018_production_jobs_review_audit.sql) so
// the reason for sending a package back is not lost. Body parsing mirrors
// visual-generation.ts's / creative-qa.ts's reject routes' `notes` idiom —
// no length cap or 400 here either, matching that existing convention (the
// schema layer caps rejectionReason at 2000 chars).
productionJobsRouter.post(
  '/production-jobs/:id/reject',
  requireAuth,
  requirePermission('production_jobs:reject'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await store.productionJobs.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Production job not found' });
    // Phase 3 Step 4 — client isolation hardening.
    await assertClientAccessible(req.user!.id, existing.clientId);

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const rejected = await store.productionJobs.reject(existing.id, req.user!.id, reason);
    if (!rejected) {
      return res.status(409).json({
        error: 'Production job is not in a rejectable state',
        status: existing.status,
      });
    }

    // Phase 3 Step 6A — analytics event (best-effort).
    await store.analyticsEvents.recordBestEffort({
      clientId: rejected.clientId,
      entityType: 'production_job',
      entityId: rejected.id,
      eventType: 'production_job_rejected',
      actorUserId: req.user!.id,
      status: rejected.status,
    });

    res.json({ data: rejected });
  })
);
