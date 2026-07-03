import { Router, Request, Response, NextFunction } from 'express';
import { store } from '../data/store.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { renderProductionJob } from '../services/render-engine.js';
import { getFileAccess } from '../storage/file-service.js';
import type { StorageProviderName } from '../storage/types.js';
import { ExportFormatEnum, RenderPresetEnum } from '@grafista/schemas';

// Mounted at /api — a production-job-scoped create route plus standalone
// /render-jobs/:id and /export-artifacts/:id routes (mirrors how
// productionJobsRouter pairs its generated-output-scoped create route with
// standalone /production-jobs/:id routes). Same "permission-only, no client
// scoping" authorization note as production-jobs.ts applies here too.
export const renderJobsRouter: Router = Router();

const VALID_PRESETS = new Set<string>(RenderPresetEnum.options);
const VALID_EXPORT_FORMATS = new Set<string>(ExportFormatEnum.options);

// POST /api/production-jobs/:id/render — requests a render of a
// package_ready/approved production job at the given preset/exportFormat.
// Synchronous (the whole render pipeline runs within the request — see
// render-engine.ts). Body validated inline (no zod route-body schema — not
// this codebase's convention, see production-jobs.ts's reject route): both
// `preset` and `exportFormat` must be recognized strings, else 400 before the
// service is ever called. The gate (404 unknown job / 409 not render-ready)
// and the domain-level permission double-guard (403) both live INSIDE the
// service and bubble to the centralized errorHandler untouched.
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

    const renderJob = await renderProductionJob(
      req.params.id,
      { preset: preset as (typeof RenderPresetEnum.options)[number], exportFormat: exportFormat as (typeof ExportFormatEnum.options)[number] },
      req.user!.id
    );
    res.status(201).json({ data: renderJob });
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
    res.json({ data: job });
  })
);

// GET /api/render-jobs/:id/artifacts — list route: returns [] (200), not 404,
// when the job exists but has no artifacts yet (mirrors production-jobs.ts's
// list-route convention). Uses export_artifacts:read (artifact-focused
// route) rather than render_jobs:read — for the four seeded roles today the
// two permissions are always granted together, so this has no behavioral
// difference in practice, but it is the more semantically correct guard.
renderJobsRouter.get(
  '/render-jobs/:id/artifacts',
  requireAuth,
  requirePermission('export_artifacts:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const job = await store.renderJobs.getById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Render job not found' });

    const artifacts = await store.exportArtifacts.listByRenderJob(job.id);
    res.json({ data: artifacts, total: artifacts.length });
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
