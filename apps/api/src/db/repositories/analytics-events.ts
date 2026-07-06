/**
 * Grafista AI Studio — Analytics Events Repository (Phase 3 Step 6A)
 *
 * Append-only lifecycle event log. `record()` is the "hard" primitive (plain
 * INSERT, throws on failure); `recordBestEffort()` is what every lifecycle
 * call site actually uses — it wraps `record()` in try/catch so an analytics
 * write can NEVER break the primary domain flow (design brief creation,
 * visual generation, render pipeline, etc). See
 * docs/analytics-revision-history-plan.md §9/§14 and
 * database/migrations/023_analytics_events.sql for the full rationale.
 *
 * Metadata sanitization: every call site is expected to pass a small,
 * explicitly-constructed object (never an entire upstream response/request
 * object) — but `record()` also runs a defensive denylist check as a
 * backstop, so a mistake at a call site cannot silently persist a secret.
 */

import { pool } from '../pool.js';
import type {
  AnalyticsClientSummary,
  AnalyticsEntityType,
  AnalyticsEvent,
  AnalyticsEventType,
} from '@grafista/schemas';

/**
 * Denylist backstop for analytics_events.metadata keys. Deliberately
 * word-aware rather than a bare substring match: legitimate metadata fields
 * like `tokenInput`/`tokenOutput` (AIResponse.usage token counts, see §6 of
 * docs/analytics-revision-history-plan.md) must NOT be rejected just because
 * they contain the substring "token" — only credential-shaped keys (a bare
 * `token`, or a key ENDING in "token" like `accessToken`/`authToken`) are
 * denylisted, along with `apiKey`/`secret`/`password`/`authorization` in any
 * position.
 */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(Boolean);
}

function isDenylistedKey(key: string): boolean {
  const words = keyWords(key);
  if (words.length === 0) return false;
  if (words.some((w) => w === 'secret' || w === 'password' || w === 'authorization' || w === 'auth')) return true;
  if (words.includes('api') && words.includes('key')) return true;
  // A bare "token", or a key ENDING in "token" (accessToken, authToken, ...) —
  // NOT a key that merely starts with "token" (tokenInput, tokenOutput).
  if (words[words.length - 1] === 'token') return true;
  return false;
}

function assertMetadataSafe(metadata: Record<string, unknown>): void {
  for (const key of Object.keys(metadata)) {
    if (isDenylistedKey(key)) {
      throw new Error(`analytics_events.metadata contains a denylisted key: "${key}"`);
    }
  }
}

function mapRow(row: Record<string, unknown>): AnalyticsEvent {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    entityType: row.entity_type as AnalyticsEntityType,
    entityId: row.entity_id as string,
    eventType: row.event_type as AnalyticsEventType,
    actorUserId: (row.actor_user_id as string) ?? null,
    provider: (row.provider as string) ?? null,
    model: (row.model as string) ?? null,
    status: (row.status as string) ?? null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export interface RecordAnalyticsEventInput {
  clientId: string;
  entityType: AnalyticsEntityType;
  entityId: string;
  eventType: AnalyticsEventType;
  actorUserId?: string | null;
  provider?: string | null;
  model?: string | null;
  status?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}

const EVENT_TYPES_FOR_SUMMARY: AnalyticsEventType[] = [
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
];

export const analyticsEventsRepo = {
  /** Plain INSERT — throws on failure. Use recordBestEffort() from lifecycle call sites instead. */
  async record(input: RecordAnalyticsEventInput): Promise<AnalyticsEvent> {
    const metadata = input.metadata ?? {};
    assertMetadataSafe(metadata);

    const { rows } = await pool.query(
      `INSERT INTO analytics_events (
         id, client_id, entity_type, entity_id, event_type, actor_user_id,
         provider, model, status, duration_ms, metadata
       )
       VALUES (uuid_generate_v4(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        input.clientId,
        input.entityType,
        input.entityId,
        input.eventType,
        input.actorUserId ?? null,
        input.provider ?? null,
        input.model ?? null,
        input.status ?? null,
        input.durationMs ?? null,
        JSON.stringify(metadata),
      ]
    );
    return mapRow(rows[0]);
  },

  /**
   * Fire-and-forget wrapper — NEVER throws. Every lifecycle call site
   * (creative-qa approve, visual-generation success/failure, production
   * package/approve/reject, render job rendered/failed/queued/cancelled,
   * export artifact download) uses this, not record(), so a transient DB
   * issue or a sanitization rejection can never break the primary flow it's
   * attached to. On failure, logs a short warning with NO secret/raw
   * payload content — only the event type, entity id, and error message
   * class.
   */
  async recordBestEffort(input: RecordAnalyticsEventInput): Promise<void> {
    try {
      await analyticsEventsRepo.record(input);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(
        `[analytics-events] best-effort record failed — eventType=${input.eventType} entityId=${input.entityId} error=${errorMessage}`
      );
    }
  },

  /**
   * Client-scoped summary: totals per known event type + recent activity.
   * Plain pool.query, no ORM — mirrors render-jobs.ts's repository style.
   */
  async getClientSummary(clientId: string, opts?: { recentLimit?: number }): Promise<AnalyticsClientSummary> {
    const recentLimit = opts?.recentLimit ?? 10;

    const { rows: countRows } = await pool.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM analytics_events
       WHERE client_id = $1
       GROUP BY event_type`,
      [clientId]
    );

    const counts = new Map<string, number>();
    for (const row of countRows) {
      counts.set(row.event_type as string, Number(row.count));
    }
    const countFor = (eventType: AnalyticsEventType): number => counts.get(eventType) ?? 0;

    const totalEvents = EVENT_TYPES_FOR_SUMMARY.reduce((sum, eventType) => sum + countFor(eventType), 0);

    const { rows: recentRows } = await pool.query(
      `SELECT event_type, entity_type, entity_id, created_at
       FROM analytics_events
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [clientId, recentLimit]
    );

    return {
      totalEvents,
      visualGenerationSucceeded: countFor('visual_generation_succeeded'),
      visualGenerationFailed: countFor('visual_generation_failed'),
      productionPackagesCreated: countFor('production_package_created'),
      productionApproved: countFor('production_job_approved'),
      productionRejected: countFor('production_job_rejected'),
      renderJobsRendered: countFor('render_job_rendered'),
      renderJobsFailed: countFor('render_job_failed'),
      exportArtifactDownloads: countFor('export_artifact_downloaded'),
      recentActivity: recentRows.map((row) => ({
        eventType: row.event_type as AnalyticsEventType,
        entityType: row.entity_type as AnalyticsEntityType,
        entityId: row.entity_id as string,
        createdAt: (row.created_at as Date).toISOString(),
      })),
    };
  },
};
