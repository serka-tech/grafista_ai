import { z } from 'zod';

// ─── Revision Memory ─────────────────────────────────────
export const FeedbackSentimentEnum = z.enum(['positive', 'negative', 'neutral', 'mixed']);
export type FeedbackSentiment = z.infer<typeof FeedbackSentimentEnum>;

export const FeedbackEntrySchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  entityType: z.enum(['content_idea', 'design_brief', 'generated_output']),
  entityId: z.string().uuid(),
  feedbackText: z.string().max(5000),
  sentiment: FeedbackSentimentEnum,
  categories: z.array(z.enum([
    'color', 'typography', 'layout', 'imagery',
    'tone', 'messaging', 'branding', 'format',
    'cta', 'overall', 'other',
  ])).default([]),
  extractedRules: z.array(z.object({
    rule: z.string().max(500),
    ruleType: z.enum(['do', 'dont', 'prefer', 'avoid']),
    confidence: z.number().min(0).max(1),
  })).default([]),
  appliedToDNA: z.boolean().default(false),
  createdAt: z.string().datetime(),
});
export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema>;

export const RevisionMemorySchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  totalFeedbackCount: z.number().int().nonnegative().default(0),
  learnedRules: z.array(z.object({
    rule: z.string().max(500),
    ruleType: z.enum(['do', 'dont', 'prefer', 'avoid']),
    frequency: z.number().int().positive(),
    confidence: z.number().min(0).max(1),
    sourceEntries: z.array(z.string().uuid()).default([]),
    firstSeen: z.string().datetime(),
    lastSeen: z.string().datetime(),
  })).default([]),
  approvalPatterns: z.object({
    avgApprovalRate: z.number().min(0).max(1).optional(),
    commonApprovalReasons: z.array(z.string().max(300)).default([]),
    commonRejectionReasons: z.array(z.string().max(300)).default([]),
  }).optional(),
  lastUpdatedAt: z.string().datetime(),
});
export type RevisionMemory = z.infer<typeof RevisionMemorySchema>;
