import { z } from 'zod';

// ─── Production Job (Phase 2 Step 8A) ────────────────────
// One job = one approved/generated visual sent to production packaging
// (see apps/api/src/services/production-package-builder.ts). Single linear
// status axis on purpose — unlike GeneratedOutput's status/approvalStatus
// split, a job's packaging lifecycle and its human review never overlap
// (approve/reject are only reachable from 'package_ready'):
//
//   pending -> packaging -> package_ready -> approved | rejected
//                      \-> failed          (errorMessage set)
//   cancelled                               (manual abort)
export const ProductionJobStatusEnum = z.enum([
  'pending',
  'packaging',
  'package_ready',
  'failed',
  'cancelled',
  'approved',
  'rejected',
]);
export type ProductionJobStatus = z.infer<typeof ProductionJobStatusEnum>;

export const ProductionJobSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  generatedOutputId: z.string().uuid(),
  // Denormalized convenience copied from the generated output (which already
  // links to it) — NULL when the output had no layout plan.
  layoutPlanId: z.string().uuid().optional(),

  status: ProductionJobStatusEnum.default('pending'),
  errorMessage: z.string().max(2000).optional(),

  // How the package was produced ('manual_package_builder' today; a future
  // Photoshop worker introduces its own value — no PSD logic exists yet).
  generationMethod: z.string().max(50).default('manual_package_builder'),

  // Object-storage coordinates of the built JSON package (same triple as
  // GeneratedOutput / brand assets). Set only when status is 'package_ready'
  // or later.
  packageStorageProvider: z.string().max(20).optional(),
  packageStorageBucket: z.string().max(500).optional(),
  packageStorageKey: z.string().max(1000).optional(),
  packageMimeType: z.string().max(100).optional(),
  packageSizeBytes: z.number().int().nonnegative().optional(),

  // DB copies of the stored package for fast reads without a storage
  // round-trip (snapshot-over-fetch, like WorkflowRun.definitionSnapshot).
  packageManifestSnapshot: z.record(z.unknown()).optional(),
  templateContractSnapshot: z.record(z.unknown()).optional(),

  // Server-attached, never invented by the model.
  requestedBy: z.string().uuid(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.string().datetime().optional(),

  // Reject-side parity with approve's audit fields (Phase 2 Step 8B) — reject
  // previously recorded only the status flip with no who/when/why. reason is
  // free text the reviewer leaves for whoever creates the retry job.
  rejectedBy: z.string().uuid().optional(),
  rejectedAt: z.string().datetime().optional(),
  rejectionReason: z.string().max(2000).optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductionJob = z.infer<typeof ProductionJobSchema>;
