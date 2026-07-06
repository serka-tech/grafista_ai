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

// ─── Revision Entry (Phase 3 Step 6B) ───────────────────────
// Append-only audit trail of approve/reject/needs_revision DECISIONS on the
// three entities that have a real needs_revision round-trip today
// (design_dna, layout_plans, creative_qa_reports). This is a DIFFERENT
// concept from RevisionMemory above (which is about learned DNA rules
// extracted from free-text feedback) and from AnalyticsEvent (analytics.ts,
// a pure append-only metric log) — see docs/revision-history-plan.md §5/§6
// and database/migrations/024_revision_entries.sql for the full rationale.
export const RevisionEntityTypeEnum = z.enum(['design_dna', 'layout_plan', 'creative_qa_report']);
export type RevisionEntityType = z.infer<typeof RevisionEntityTypeEnum>;

export const RevisionTypeEnum = z.enum([
  'design_dna_approved',
  'design_dna_needs_revision',
  'layout_plan_approved',
  'layout_plan_rejected',
  'layout_plan_needs_revision',
  'creative_qa_report_approved',
  'creative_qa_report_rejected',
  'creative_qa_report_needs_revision',
]);
export type RevisionType = z.infer<typeof RevisionTypeEnum>;

export const RevisionEntrySchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  entityType: RevisionEntityTypeEnum,
  entityId: z.string().uuid(),
  revisionType: RevisionTypeEnum,
  actorUserId: z.string().uuid().nullable().optional(),
  beforeSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  afterSnapshot: z.record(z.string(), z.unknown()),
  reason: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type RevisionEntry = z.infer<typeof RevisionEntrySchema>;

/** Minimal shape returned by GET /clients/:clientId/revisions/recent — deliberately
 * excludes before/afterSnapshot (see docs/revision-history-plan.md §12 item 5). */
export interface RevisionEntrySummary {
  id: string;
  entityType: RevisionEntityType;
  entityId: string;
  revisionType: RevisionType;
  actorUserId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
