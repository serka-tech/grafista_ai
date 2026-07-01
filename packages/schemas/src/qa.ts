import { z } from 'zod';

// ─── Creative QA Report ──────────────────────────────────
export const QACheckStatusEnum = z.enum(['pass', 'warn', 'fail', 'skip']);
export type QACheckStatus = z.infer<typeof QACheckStatusEnum>;

export const QACheckItemSchema = z.object({
  category: z.string().max(100),
  checkName: z.string().max(200),
  status: QACheckStatusEnum,
  score: z.number().min(0).max(100).optional(),
  details: z.string().max(1000).optional(),
  suggestion: z.string().max(500).optional(),
});
export type QACheckItem = z.infer<typeof QACheckItemSchema>;

export const CreativeQAReportSchema = z.object({
  id: z.string().uuid(),
  designBriefId: z.string().uuid(),
  clientId: z.string().uuid(),

  overallScore: z.number().min(0).max(100),
  overallStatus: z.enum(['passed', 'needs_revision', 'failed']),

  checks: z.array(QACheckItemSchema),

  brandConsistency: QACheckItemSchema,
  readability: QACheckItemSchema,
  mobileLegibility: QACheckItemSchema,
  visualHierarchy: QACheckItemSchema,
  logoSafetyArea: QACheckItemSchema,
  colorContrast: QACheckItemSchema,
  spelling: QACheckItemSchema,
  clientStyleMatch: QACheckItemSchema,
  exportReadiness: QACheckItemSchema,

  summary: z.string().max(2000),
  criticalIssues: z.array(z.string().max(500)).default([]),
  recommendations: z.array(z.string().max(500)).default([]),

  reviewedAt: z.string().datetime(),
});
export type CreativeQAReport = z.infer<typeof CreativeQAReportSchema>;
