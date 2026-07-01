import { z } from 'zod';
import { PlatformEnum, ContentFormatEnum } from './content.js';

// ─── Design Brief ────────────────────────────────────────
export const DesignBriefSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  contentIdeaId: z.string().uuid(),
  approvalId: z.string().uuid(),

  title: z.string().min(1).max(300),
  objective: z.string().max(1000),
  platform: PlatformEnum,
  format: ContentFormatEnum,

  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    unit: z.enum(['px', 'in', 'cm', 'mm']).default('px'),
  }),

  contentElements: z.object({
    headline: z.string().max(200).optional(),
    subheadline: z.string().max(300).optional(),
    bodyText: z.string().max(1000).optional(),
    caption: z.string().max(3000).optional(),
    callToAction: z.string().max(200).optional(),
    hashtags: z.array(z.string().max(100)).default([]),
  }),

  visualDirection: z.object({
    mood: z.string().max(200),
    colorPalette: z.array(z.string()).default([]),
    typographyNotes: z.string().max(500).optional(),
    imageDirection: z.string().max(1000).optional(),
    layoutSuggestion: z.string().max(500).optional(),
    backgroundDescription: z.string().max(500).optional(),
    iconography: z.string().max(300).optional(),
  }),

  brandConstraints: z.object({
    logoPlacement: z.string().max(200).optional(),
    colorRestrictions: z.array(z.string().max(200)).default([]),
    fontRestrictions: z.array(z.string().max(200)).default([]),
    forbiddenElements: z.array(z.string().max(200)).default([]),
    requiredElements: z.array(z.string().max(200)).default([]),
  }),

  aiImagePrompts: z.array(z.object({
    label: z.string().max(100),
    prompt: z.string().max(2000),
    negativePrompt: z.string().max(1000).optional(),
    style: z.string().max(200).optional(),
    aspectRatio: z.string().max(20).optional(),
  })).default([]),

  designerNotes: z.string().max(3000).optional(),
  referenceDesignIds: z.array(z.string().uuid()).default([]),
  layoutPlanId: z.string().uuid().optional(),
  qaReportId: z.string().uuid().optional(),

  status: z.enum(['draft', 'in_progress', 'qa_pending', 'qa_passed', 'approved', 'exported']).default('draft'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DesignBrief = z.infer<typeof DesignBriefSchema>;
