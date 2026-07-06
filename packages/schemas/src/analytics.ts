import { z } from 'zod';

// ─── Analytics Event (Phase 3 Step 6A) ─────────────────────
// Append-only lifecycle event log, one row per meaningful pipeline
// transition. This does NOT replace any entity's own `status` column (those
// keep meaning what they always meant) — it is a parallel, queryable event
// stream for client-scoped dashboards/reporting. See
// docs/analytics-revision-history-plan.md §8.1 and
// database/migrations/023_analytics_events.sql for the full rationale.
//
// RevisionEntry (§8.2 of the plan) is explicitly OUT of scope for Step 6A —
// this file only covers the analytics_events table.
export const AnalyticsEventTypeEnum = z.enum([
  'creative_qa_approved',
  'visual_generation_succeeded',
  'visual_generation_failed',
  'production_package_created',
  'production_job_approved',
  'production_job_rejected',
  'render_job_queued',
  'render_job_rendered',
  'render_job_failed',
  'render_job_cancelled',
  'export_artifact_downloaded',
]);
export type AnalyticsEventType = z.infer<typeof AnalyticsEventTypeEnum>;

export const AnalyticsEntityTypeEnum = z.enum([
  'creative_qa_report',
  'generated_output',
  'production_job',
  'render_job',
  'export_artifact',
]);
export type AnalyticsEntityType = z.infer<typeof AnalyticsEntityTypeEnum>;

export const AnalyticsEventSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  entityType: AnalyticsEntityTypeEnum,
  entityId: z.string().uuid(),
  eventType: AnalyticsEventTypeEnum,
  actorUserId: z.string().uuid().nullable().optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export interface AnalyticsClientSummary {
  totalEvents: number;
  visualGenerationSucceeded: number;
  visualGenerationFailed: number;
  productionPackagesCreated: number;
  productionApproved: number;
  productionRejected: number;
  renderJobsRendered: number;
  renderJobsFailed: number;
  exportArtifactDownloads: number;
  recentActivity: Array<{
    eventType: AnalyticsEventType;
    entityType: AnalyticsEntityType;
    entityId: string;
    createdAt: string;
  }>;
}
