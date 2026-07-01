import { z } from 'zod';

// ─── Brand Asset Types ───────────────────────────────────
export const BrandAssetTypeEnum = z.enum([
  'logo',
  'logo_variant',
  'icon',
  'color_palette',
  'font',
  'brand_guideline',
  'pattern',
  'illustration',
  'photography_style',
  'other',
]);
export type BrandAssetType = z.infer<typeof BrandAssetTypeEnum>;

export const ColorSchema = z.object({
  name: z.string().max(50),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  rgb: z.object({
    r: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    b: z.number().int().min(0).max(255),
  }).optional(),
  usage: z.string().max(200).optional(),
  isPrimary: z.boolean().default(false),
});
export type Color = z.infer<typeof ColorSchema>;

export const FontSchema = z.object({
  name: z.string().max(100),
  family: z.string().max(100),
  weight: z.string().max(50).optional(),
  usage: z.enum(['heading', 'subheading', 'body', 'caption', 'accent', 'other']),
  sampleUrl: z.string().url().optional(),
});
export type Font = z.infer<typeof FontSchema>;

export const BrandAssetSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  type: BrandAssetTypeEnum,
  name: z.string().min(1).max(200),
  fileUrl: z.string().url().optional(),
  mimeType: z.string().max(100).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
});
export type BrandAsset = z.infer<typeof BrandAssetSchema>;

export const BrandRuleSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(['required', 'forbidden', 'preferred', 'guideline']),
  description: z.string().min(1).max(1000),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
});
export type BrandRule = z.infer<typeof BrandRuleSchema>;

export const BrandProfileSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  brandName: z.string().min(1).max(200),
  tagline: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  industry: z.string().max(100).optional(),
  targetAudience: z.string().max(1000).optional(),
  brandPersonality: z.array(z.string().max(50)).max(10).default([]),
  toneOfVoice: z.array(z.string().max(50)).max(10).default([]),
  colors: z.array(ColorSchema).default([]),
  fonts: z.array(FontSchema).default([]),
  rules: z.array(BrandRuleSchema).default([]),
  forbiddenElements: z.array(z.string().max(200)).default([]),
  competitorBrands: z.array(z.string().max(200)).default([]),
  inspirationNotes: z.string().max(3000).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BrandProfile = z.infer<typeof BrandProfileSchema>;

export const CreateBrandAssetSchema = z.object({
  type: BrandAssetTypeEnum,
  name: z.string().min(1).max(200),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateBrandAsset = z.infer<typeof CreateBrandAssetSchema>;
