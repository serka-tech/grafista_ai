import { z } from 'zod';

// ─── Render Job (Phase 2 Step 9A) ─────────────────────────
// One render job = one request to turn a package_ready production_jobs
// package (see apps/api/src/services/production-package-builder.ts) into an
// actual exported file (PNG/JPG/PDF) via the Template Render Engine (see
// apps/api/src/render/). Status axis mirrors ProductionJobStatus's linear
// shape, minus the human approve/reject step (approval already happened
// upstream, on the production job) — a render is either not started, in
// flight, finished, failed, or cancelled:
//
//   pending -> rendering -> rendered
//                      \-> failed     (errorMessage set)
//   cancelled                          (manual abort, any pre-terminal state)
export const RenderJobStatusEnum = z.enum(['pending', 'rendering', 'rendered', 'failed', 'cancelled']);
export type RenderJobStatus = z.infer<typeof RenderJobStatusEnum>;

// ─── Render preset / format ────────────────────────────────
// A preset names a common export shape; RENDER_PRESET_DIMENSIONS is the
// single source of truth for its pixel size so callers never hardcode
// width/height separately from the preset name.
export const RenderPresetEnum = z.enum(['instagram_post', 'instagram_story', 'landscape', 'ad_creative']);
export type RenderPreset = z.infer<typeof RenderPresetEnum>;

export const RENDER_PRESET_DIMENSIONS: Record<RenderPreset, { width: number; height: number }> = {
  instagram_post: { width: 1080, height: 1080 },
  instagram_story: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  ad_creative: { width: 1200, height: 628 },
};

export const ExportFormatEnum = z.enum(['png', 'jpg', 'pdf']);
export type ExportFormat = z.infer<typeof ExportFormatEnum>;

export const RequestedFormatSchema = z.object({
  preset: RenderPresetEnum,
  exportFormat: ExportFormatEnum,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type RequestedFormat = z.infer<typeof RequestedFormatSchema>;

// A render can only ever partially degrade, never silently produce a wrong
// result — every MVP limitation the HTML renderer hits (unsupported
// blendMode, non-whitelisted font, unresolvable color, freeform filter,
// anchor other than top-left, etc) is recorded as one of these rather than
// dropped, so it can be surfaced to a human reviewer after the fact.
export const RenderWarningSchema = z.object({
  code: z.string().max(100),
  message: z.string().max(500),
  layerId: z.string().optional(),
});
export type RenderWarning = z.infer<typeof RenderWarningSchema>;

export const RenderJobSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  productionJobId: z.string().uuid(),
  requestedFormat: RequestedFormatSchema,

  // DB copies of the production job's package at render-request time —
  // same snapshot-over-fetch reasoning as ProductionJob's own
  // packageManifestSnapshot/templateContractSnapshot.
  manifestSnapshot: z.record(z.unknown()).optional(),
  templateContractSnapshot: z.record(z.unknown()).optional(),

  status: RenderJobStatusEnum.default('pending'),

  // Which adapter actually produced the output ('playwright' / its package
  // version, or 'fake' / 'fake-1.0.0' in tests) — see apps/api/src/render/adapters/.
  rendererName: z.string().max(50).optional(),
  rendererVersion: z.string().max(50).optional(),

  // Additive — survives past the render response so a QA pass can review
  // "explainable" degradations after the fact.
  renderWarnings: z.array(RenderWarningSchema).optional(),

  // Server-attached, never invented by the model.
  requestedBy: z.string().uuid(),
  errorMessage: z.string().max(2000).optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

// ─── Export Artifact ───────────────────────────────────────
// A CHILD of RenderJob — one render job can, in principle, produce more than
// one exported file (see 019_render_jobs.sql), so this is a separate schema
// rather than fields on RenderJob itself.
export const ExportArtifactSchema = z.object({
  id: z.string().uuid(),
  renderJobId: z.string().uuid(),
  clientId: z.string().uuid(),
  format: ExportFormatEnum,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.string().max(100),

  // Same storage-coordinate triple used everywhere else a file is stored in
  // this codebase (brand assets, production_jobs packages, etc) — required
  // for getStorageProviderByName() to reconstruct the correct provider.
  storageProvider: z.string().max(20),
  storageBucket: z.string().max(500),
  storageKey: z.string().max(1000),

  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().max(128).optional(),

  createdAt: z.string().datetime(),
});
export type ExportArtifact = z.infer<typeof ExportArtifactSchema>;
