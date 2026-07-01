import { z } from 'zod';

// ─── Style Analysis ──────────────────────────────────────
export const LayoutPatternEnum = z.enum([
  'centered',
  'split',
  'grid',
  'asymmetric',
  'full-bleed',
  'text-heavy',
  'image-dominant',
  'layered',
  'minimal',
  'collage',
  'editorial',
  'other',
]);
export type LayoutPattern = z.infer<typeof LayoutPatternEnum>;

export const VisualMoodEnum = z.enum([
  'energetic',
  'calm',
  'luxurious',
  'playful',
  'professional',
  'bold',
  'minimal',
  'organic',
  'tech',
  'vintage',
  'modern',
  'artistic',
  'corporate',
  'other',
]);
export type VisualMood = z.infer<typeof VisualMoodEnum>;

export const DesignCategoryEnum = z.enum([
  'story',
  'post',
  'carousel',
  'billboard',
  'brochure',
  'menu',
  'real_estate',
  'school',
  'healthcare',
  'cafe_restaurant',
  'corporate',
  'other',
]);
export type DesignCategory = z.infer<typeof DesignCategoryEnum>;

export const StyleAnalysisSchema = z.object({
  id: z.string().uuid(),
  designReferenceId: z.string().uuid(),
  format: z.string().max(50),
  aspectRatio: z.string().max(20),
  dominantColors: z.array(z.object({
    hex: z.string(),
    percentage: z.number().min(0).max(100),
    name: z.string().optional(),
  })).max(10),
  typographyHierarchy: z.object({
    headingStyle: z.string().max(200).optional(),
    subheadingStyle: z.string().max(200).optional(),
    bodyStyle: z.string().max(200).optional(),
    captionStyle: z.string().max(200).optional(),
    fontCount: z.number().int().min(0).max(10).optional(),
  }).default({}),
  logoPosition: z.enum([
    'top-left', 'top-center', 'top-right',
    'bottom-left', 'bottom-center', 'bottom-right',
    'center', 'watermark', 'none',
  ]).optional(),
  imageTreatment: z.string().max(300).optional(),
  backgroundStyle: z.string().max(300).optional(),
  textDensity: z.enum(['minimal', 'low', 'medium', 'high', 'text-heavy']).optional(),
  ctaStyle: z.string().max(300).optional(),
  layoutPattern: LayoutPatternEnum.optional(),
  visualMood: VisualMoodEnum.optional(),
  brandConsistencyNotes: z.string().max(2000).optional(),
  reusableDesignRules: z.array(z.string().max(500)).default([]),
  designCategory: DesignCategoryEnum.optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  analyzedAt: z.string().datetime(),
});
export type StyleAnalysis = z.infer<typeof StyleAnalysisSchema>;

// ─── Design DNA ──────────────────────────────────────────
export const DesignDNAStatusEnum = z.enum([
  'draft',
  'generated',
  'waiting_for_approval',
  'approved',
  'needs_revision',
]);
export type DesignDNAStatus = z.infer<typeof DesignDNAStatusEnum>;

export const DesignDNASchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  version: z.number().int().positive().default(1),
  status: DesignDNAStatusEnum.default('draft'),

  brandPersonality: z.array(z.string().max(100)).default([]),
  preferredLayouts: z.array(LayoutPatternEnum).default([]),

  visualRules: z.array(z.object({
    rule: z.string().max(500),
    source: z.enum(['analysis', 'manual', 'feedback']),
    confidence: z.number().min(0).max(1),
  })).default([]),

  typographyRules: z.array(z.object({
    rule: z.string().max(500),
    example: z.string().max(200).optional(),
  })).default([]),

  colorUsageRules: z.array(z.object({
    rule: z.string().max(500),
    colors: z.array(z.string()).optional(),
  })).default([]),

  logoUsageRules: z.array(z.object({
    rule: z.string().max(500),
    preferredPosition: z.string().max(100).optional(),
  })).default([]),

  imageTreatmentRules: z.array(z.object({
    rule: z.string().max(500),
    example: z.string().max(200).optional(),
  })).default([]),

  contentTone: z.object({
    primary: z.string().max(100),
    secondary: z.string().max(100).optional(),
    keywords: z.array(z.string().max(50)).default([]),
    examples: z.array(z.string().max(500)).default([]),
  }),

  avoidList: z.array(z.string().max(300)).default([]),

  approvalBias: z.object({
    preferredFormats: z.array(z.string().max(50)).default([]),
    preferredMoods: z.array(VisualMoodEnum).default([]),
    rejectionPatterns: z.array(z.string().max(300)).default([]),
  }).optional(),

  recommendedPromptStyle: z.object({
    imagePromptPrefix: z.string().max(500).optional(),
    imagePromptSuffix: z.string().max(500).optional(),
    negativePromptKeywords: z.array(z.string().max(100)).default([]),
    styleModifiers: z.array(z.string().max(100)).default([]),
  }).optional(),

  confidenceScore: z.number().min(0).max(1).optional(),
  referencesUsed: z.array(z.string().uuid()).default([]),

  sourceAnalysisCount: z.number().int().nonnegative().default(0),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.string().datetime().optional(),
  revisionNotes: z.string().max(2000).optional(),
  lastUpdatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type DesignDNA = z.infer<typeof DesignDNASchema>;

/** Subset the AI synthesis call is expected to produce — server-controlled fields
 * (id, clientId, version, status, referencesUsed, sourceAnalysisCount, timestamps,
 * approval fields) are attached by the service after parsing, never invented by the model. */
export const DesignDNAContentSchema = DesignDNASchema.omit({
  id: true,
  clientId: true,
  version: true,
  status: true,
  referencesUsed: true,
  sourceAnalysisCount: true,
  approvedBy: true,
  approvedAt: true,
  revisionNotes: true,
  lastUpdatedAt: true,
  createdAt: true,
});
export type DesignDNAContent = z.infer<typeof DesignDNAContentSchema>;
