import { z } from 'zod';

// ─── Creative QA Report (Phase 2 Step 5B) ────────────────
// Pipeline stage: approved LayoutPlan + approved DesignBrief + approved
// DesignDNA -> CreativeQAReport (see apps/api/src/services/creative-qa.ts).
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

/** Same shape as QACheckItemSchema but with `score` REQUIRED — used for the 11 named
 * checks below so the server can reliably derive the flat `scores` mirror from them
 * without ever hitting `undefined`. The generic `checks[]` array keeps score optional. */
const ScoredQACheckItemSchema = QACheckItemSchema.extend({
  score: z.number().min(0).max(100),
});

export const CreativeQAReportStatusEnum = z.enum([
  'generated', 'passed', 'failed', 'approved', 'rejected', 'needs_revision',
]);
export type CreativeQAReportStatus = z.infer<typeof CreativeQAReportStatusEnum>;

/** Flat, shallow, obviously-named numeric mirror of the 10 named scores this task calls
 * out — server-computed from the corresponding named QACheckItem.score after validation
 * (never invented independently by the model), so a dashboard can read e.g.
 * `report.scores.layoutHierarchy` directly without digging into nested check objects. */
export const CreativeQAScoresSchema = z.object({
  brandConsistency: z.number().min(0).max(100),
  designDnaMatch: z.number().min(0).max(100),
  layoutHierarchy: z.number().min(0).max(100),
  readability: z.number().min(0).max(100),
  mobileLegibility: z.number().min(0).max(100),
  logoSafety: z.number().min(0).max(100),
  colorContrast: z.number().min(0).max(100),
  typographyConsistency: z.number().min(0).max(100),
  contentClarity: z.number().min(0).max(100),
  exportReadiness: z.number().min(0).max(100),
});
export type CreativeQAScores = z.infer<typeof CreativeQAScoresSchema>;

export const CreativeQAReportSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  designBriefId: z.string().uuid(),
  layoutPlanId: z.string().uuid(),
  // NULL only for schema flexibility/future-proofing — the current service hard-requires
  // an approved DesignDNA to exist before running Creative QA, so this is always set today.
  designDnaId: z.string().uuid().optional(),

  // DB workflow lifecycle status (distinct from the AI's own 3-state overallStatus read
  // below): generated -> passed|failed (set directly by the service at creation) ->
  // approved|rejected|needs_revision (human decision via the approve/reject routes).
  status: CreativeQAReportStatusEnum.default('generated'),

  overallScore: z.number().min(0).max(100),
  overallStatus: z.enum(['passed', 'needs_revision', 'failed']),
  // Server config, not model output — the score threshold this report was judged against.
  passThreshold: z.number().min(0).max(100).default(75),
  // Explicit pass/fail decision, independent of the richer 3-state overallStatus.
  // Server-computed as `overallScore >= passThreshold`, never invented by the model.
  passed: z.boolean(),

  scores: CreativeQAScoresSchema,

  // Free-form supplementary checks beyond the 11 named categories below, if the model
  // wants to flag something extra.
  checks: z.array(QACheckItemSchema).default([]),

  brandConsistency: ScoredQACheckItemSchema,
  readability: ScoredQACheckItemSchema,
  mobileLegibility: ScoredQACheckItemSchema,
  visualHierarchy: ScoredQACheckItemSchema,
  logoSafetyArea: ScoredQACheckItemSchema,
  colorContrast: ScoredQACheckItemSchema,
  spelling: QACheckItemSchema,
  // Renamed from the Phase-1 stub's `clientStyleMatch` — how well this alternative
  // matches the client's approved DesignDNA rules specifically.
  designDnaMatch: ScoredQACheckItemSchema,
  exportReadiness: ScoredQACheckItemSchema,
  typographyConsistency: ScoredQACheckItemSchema,
  contentClarity: ScoredQACheckItemSchema,

  summary: z.string().max(2000),
  // Canonical issue list the model must produce.
  detectedIssues: z.array(z.string().max(500)).default([]),
  // Server-set mirror of detectedIssues, kept for backward-compat with the Phase-1 field name.
  criticalIssues: z.array(z.string().max(500)).default([]),

  // Three priority tiers — replace/supplement the old flat recommendations[] below.
  highPriorityFixes: z.array(z.string().max(500)).default([]),
  mediumPriorityFixes: z.array(z.string().max(500)).default([]),
  lowPriorityFixes: z.array(z.string().max(500)).default([]),
  // Server-computed concatenation of the three tiers above (high -> medium -> low), kept
  // for backward-compat with the Phase-1 field name.
  recommendations: z.array(z.string().max(500)).default([]),

  designerNotes: z.string().max(2000).optional(),
  // A short actionable summary distinct from `summary` above, e.g. "Approve as-is" /
  // "Revise headline contrast before proceeding" / "Reject — brand mismatch".
  finalRecommendation: z.string().max(1000),
  // Why this report scored the way it did, tied specifically to DesignDNA rules checked/violated.
  designDnaReasons: z.array(z.string().max(500)).default([]),
  // Same, tied to the design brief's stated requirements.
  designBriefReasons: z.array(z.string().max(500)).default([]),
  // Things that could go wrong in visual generation/Photoshop production if this proceeds as-is.
  risksBeforeProduction: z.array(z.string().max(500)).default([]),

  // The literal Part-G pipeline-gate signal (see apps/api/src/services/production-gate.ts).
  // Server-computed: true only when `passed` is true AND no unresolved highPriorityFixes.
  canProceedToProduction: z.boolean(),

  // Server-attached, never invented by the model.
  provider: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  createdBy: z.string().uuid().optional(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.string().datetime().optional(),
  rejectedBy: z.string().uuid().optional(),
  rejectedAt: z.string().datetime().optional(),

  reviewedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CreativeQAReport = z.infer<typeof CreativeQAReportSchema>;

/** Subset the AI creative QA call is expected to produce — server-controlled/computed
 * fields (id, clientId, designBriefId, layoutPlanId, designDnaId, status, passThreshold,
 * passed, scores, criticalIssues, recommendations, canProceedToProduction, provider,
 * model, createdBy, approvedBy/At, rejectedBy/At, timestamps) are attached/derived by the
 * service after parsing, never invented by the model. Mirrors the DesignDNAContentSchema
 * / LayoutPlanContentSchema `.omit(...)` convention. */
export const CreativeQAReportContentSchema = CreativeQAReportSchema.omit({
  id: true,
  clientId: true,
  designBriefId: true,
  layoutPlanId: true,
  designDnaId: true,
  status: true,
  passThreshold: true,
  passed: true,
  scores: true,
  criticalIssues: true,
  recommendations: true,
  canProceedToProduction: true,
  provider: true,
  model: true,
  createdBy: true,
  approvedBy: true,
  approvedAt: true,
  rejectedBy: true,
  rejectedAt: true,
  // Server-set at persist time (new Date().toISOString()), not asked of the model — same
  // reasoning as createdAt/updatedAt: timestamps are the server's job, not the AI's.
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type CreativeQAReportContent = z.infer<typeof CreativeQAReportContentSchema>;
