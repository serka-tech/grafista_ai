import { z } from 'zod';

// ─── Content Platform ────────────────────────────────────
export const PlatformEnum = z.enum([
  'instagram_post',
  'instagram_story',
  'instagram_reel',
  'instagram_carousel',
  'facebook_post',
  'facebook_story',
  'twitter_post',
  'linkedin_post',
  'tiktok',
  'youtube_thumbnail',
  'youtube_short',
  'pinterest',
  'email_header',
  'web_banner',
  'other',
]);
export type Platform = z.infer<typeof PlatformEnum>;

export const ContentFormatEnum = z.enum([
  'single_image',
  'carousel',
  'video',
  'story',
  'reel',
  'animated',
  'text_only',
  'infographic',
  'other',
]);
export type ContentFormat = z.infer<typeof ContentFormatEnum>;

export const ContentIdeaSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  campaignName: z.string().max(200).optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000),
  platform: PlatformEnum,
  format: ContentFormatEnum,
  targetAudience: z.string().max(500).optional(),
  hook: z.string().max(500).optional(),
  caption: z.string().max(3000).optional(),
  hashtags: z.array(z.string().max(100)).default([]),
  callToAction: z.string().max(200).optional(),
  toneOfVoice: z.string().max(200).optional(),
  visualDirection: z.string().max(1000).optional(),
  aiImagePrompt: z.string().max(2000).optional(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'revision_requested']).default('draft'),
  generatedBy: z.enum(['ai', 'manual']).default('ai'),
  approvalId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContentIdea = z.infer<typeof ContentIdeaSchema>;

export const ContentOptionSchema = z.object({
  optionNumber: z.number().int().positive(),
  idea: ContentIdeaSchema,
  reasoning: z.string().max(1000).optional(),
  brandAlignmentScore: z.number().min(0).max(100).optional(),
});
export type ContentOption = z.infer<typeof ContentOptionSchema>;

export const GenerateContentRequestSchema = z.object({
  clientId: z.string().uuid(),
  campaignName: z.string().max(200).optional(),
  platform: PlatformEnum,
  format: ContentFormatEnum.optional(),
  topic: z.string().max(500).optional(),
  targetAudience: z.string().max(500).optional(),
  mood: z.string().max(200).optional(),
  optionCount: z.number().int().min(1).max(10).default(3),
  additionalNotes: z.string().max(2000).optional(),
});
export type GenerateContentRequest = z.infer<typeof GenerateContentRequestSchema>;
