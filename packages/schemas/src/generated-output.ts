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

export const GeneratedOutputSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  designBriefId: z.string().uuid(),
  layoutPlanId: z.string().uuid().optional(),

  type: OutputTypeEnum,
  name: z.string().max(300),
  description: z.string().max(1000).optional(),

  fileUrl: z.string().url().optional(),
  previewUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  mimeType: z.string().max(100).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),

  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),

  generationMethod: z.enum(['ai_generated', 'template_based', 'manual', 'photoshop_worker']),
  aiModel: z.string().max(100).optional(),
  generationTimeMs: z.number().int().nonnegative().optional(),

  qaStatus: z.enum(['pending', 'passed', 'failed', 'skipped']).default('pending'),
  approvalStatus: z.enum(['pending', 'approved', 'rejected', 'revision_requested']).default('pending'),

  version: z.number().int().positive().default(1),
  parentOutputId: z.string().uuid().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GeneratedOutput = z.infer<typeof GeneratedOutputSchema>;

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
