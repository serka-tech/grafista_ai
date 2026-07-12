import { z } from 'zod';

// ─── Generated Output ────────────────────────────────────
export const OutputTypeEnum = z.enum([
  'preview_image',
  'final_image',
  'psd_file',
  'pdf_document',
  'export_package',
  'layout_json',
]);
export type OutputType = z.infer<typeof OutputTypeEnum>;

// Production lifecycle of the underlying FILE (Phase 2 Step 7 — visual generation):
// 'pending' (row created, provider/storage work not finished), 'generated' (bytes are
// safely in object storage), 'failed' (provider or storage failed — see errorMessage).
// Distinct from qaStatus/approvalStatus, which track the human/QA review of a
// successfully generated file.
export const GeneratedOutputStatusEnum = z.enum(['pending', 'generated', 'failed']);
export type GeneratedOutputStatus = z.infer<typeof GeneratedOutputStatusEnum>;

export const GeneratedOutputSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  designBriefId: z.string().uuid(),
  layoutPlanId: z.string().uuid().optional(),
  // The Creative QA report that cleared this layout plan for visual production
  // (see apps/api/src/services/production-gate.ts) — recorded for traceability.
  creativeQaReportId: z.string().uuid().optional(),

  type: OutputTypeEnum,
  name: z.string().max(300),
  description: z.string().max(1000).optional(),

  // Which visual alternative of a generation batch this row is (1-based),
  // mirroring layout_plans.alternative_index.
  alternativeIndex: z.number().int().positive().optional(),

  status: GeneratedOutputStatusEnum.default('pending'),
  errorMessage: z.string().max(2000).optional(),

  fileUrl: z.string().url().optional(),
  previewUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  mimeType: z.string().max(100).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),

  // Object-storage coordinates (same triple as brand_assets/design_references uploads —
  // see apps/api/src/storage/file-service.ts). Set only when status is 'generated'.
  storageProvider: z.string().max(20).optional(),
  storageBucket: z.string().max(500).optional(),
  storageKey: z.string().max(1000).optional(),

  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),

  // 'uploaded' (go-live M6): the output's bytes are a user-uploaded photo (e.g. a
  // real-estate property photo) composited into a layout slot, NOT AI-generated.
  generationMethod: z.enum(['ai_generated', 'template_based', 'manual', 'photoshop_worker', 'uploaded']),
  // AI provider (e.g. 'openai', 'kie-ai') and model that produced this output.
  provider: z.string().max(50).optional(),
  aiModel: z.string().max(100).optional(),
  generationTimeMs: z.number().int().nonnegative().optional(),
  // Exact prompt sent to the image provider, snapshotted at generation time.
  promptSnapshot: z.string().optional(),

  qaStatus: z.enum(['pending', 'passed', 'failed', 'skipped']).default('pending'),
  approvalStatus: z.enum(['pending', 'approved', 'rejected', 'revision_requested']).default('pending'),

  version: z.number().int().positive().default(1),
  parentOutputId: z.string().uuid().optional(),

  // Server-attached, never invented by the model.
  createdBy: z.string().uuid().optional(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.string().datetime().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GeneratedOutput = z.infer<typeof GeneratedOutputSchema>;

/** Subset of GeneratedOutput that describes the output itself (file/dimensions/type
 * metadata) — server-controlled fields (ids, statuses, provider/model, storage
 * coordinates, audit columns, timestamps) are attached by the service, never part of
 * any AI/model payload. Mirrors the LayoutPlanContentSchema /
 * CreativeQAReportContentSchema `.omit(...)` convention. */
export const GeneratedOutputContentSchema = GeneratedOutputSchema.omit({
  id: true,
  clientId: true,
  designBriefId: true,
  layoutPlanId: true,
  creativeQaReportId: true,
  status: true,
  errorMessage: true,
  storageProvider: true,
  storageBucket: true,
  storageKey: true,
  provider: true,
  aiModel: true,
  promptSnapshot: true,
  qaStatus: true,
  approvalStatus: true,
  version: true,
  parentOutputId: true,
  createdBy: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type GeneratedOutputContent = z.infer<typeof GeneratedOutputContentSchema>;

// ─── Visual Generation provider payload (Phase 2 Step 7) ─
/** One generated image as returned by an image-generation provider call (see
 * apps/api/src/services/visual-generation.ts). The provider must supply the image
 * either as base64 bytes (`imageBase64`) or as a downloadable URL (`imageUrl`). */
export const VisualGenerationImageSchema = z
  .object({
    imageBase64: z.string().min(1).optional(),
    imageUrl: z.string().url().optional(),
    mimeType: z.string().max(100).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((img) => !!img.imageBase64 || !!img.imageUrl, {
    message: 'Each generated image must include imageBase64 or imageUrl',
  });
export type VisualGenerationImage = z.infer<typeof VisualGenerationImageSchema>;

/** Full payload of one image_generation provider response: 1+ image alternatives. */
export const VisualGenerationPayloadSchema = z.object({
  images: z.array(VisualGenerationImageSchema).min(1),
});
export type VisualGenerationPayload = z.infer<typeof VisualGenerationPayloadSchema>;

// ─── Design Reference ────────────────────────────────────
export const DesignReferenceSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  mimeType: z.string().max(100).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  tags: z.array(z.string().max(50)).default([]),
  isApproved: z.boolean().default(true),
  analysisId: z.string().uuid().optional(),
  uploadedAt: z.string().datetime(),
});
export type DesignReference = z.infer<typeof DesignReferenceSchema>;
