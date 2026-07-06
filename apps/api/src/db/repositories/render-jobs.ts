/**
 * Grafista AI Studio — Render Jobs (Phase 2 Step 9A)
 *
 * Persists render jobs (production_jobs row at 'package_ready'/'approved' ->
 * one Template Render Engine request -> a rendered PNG/JPG/PDF exported to
 * object storage, see ../../services/render-engine.ts). Mirrors the
 * production-jobs.ts repo style exactly — plain pool.query + a mapRow,
 * parameterized queries, node-postgres auto-parsing JSONB.
 *
 * Unlike production_jobs, the manifest/template-contract snapshots are known
 * at CREATE time (copied straight from the production job) rather than
 * populated by a later updateStatus() call — see render-engine.ts.
 */

import { pool } from '../pool.js';
import type { RenderJob, RenderJobStatus, RenderWarning, RequestedFormat } from '@grafista/schemas';

function toIso(value: unknown): string | undefined {
  return value instanceof Date ? value.toISOString() : undefined;
}

function mapRow(row: Record<string, unknown>): RenderJob {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    productionJobId: row.production_job_id as string,
    requestedFormat: row.requested_format as RequestedFormat,

    manifestSnapshot: (row.manifest_snapshot as Record<string, unknown>) ?? undefined,
    templateContractSnapshot: (row.template_contract_snapshot as Record<string, unknown>) ?? undefined,

    status: row.status as RenderJobStatus,

    rendererName: (row.renderer_name as string) ?? undefined,
    rendererVersion: (row.renderer_version as string) ?? undefined,
    renderWarnings: (row.render_warnings as RenderWarning[]) ?? undefined,

    requestedBy: row.requested_by as string,
    errorMessage: (row.error_message as string) ?? undefined,

    // Phase 3 Step 5A — render queue/worker fields (ADDITIVE, all optional).
    queuedAt: toIso(row.queued_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    attemptCount: row.attempt_count != null ? Number(row.attempt_count) : undefined,
    maxAttempts: row.max_attempts != null ? Number(row.max_attempts) : undefined,
    nextRunAt: toIso(row.next_run_at),
    lockedBy: (row.locked_by as string) ?? undefined,
    lockedAt: toIso(row.locked_at),
    cancellationRequested: row.cancellation_requested != null ? Boolean(row.cancellation_requested) : undefined,
    cancelledAt: toIso(row.cancelled_at),

    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const renderJobsRepo = {
  /**
   * Persists one render job row. Unlike production_jobs,
   * manifestSnapshot/templateContractSnapshot are already known at creation
   * time (copied from the production job), so they're inserted directly here
   * rather than deferred to a later updateStatus() call.
   *
   * Phase 3 Step 5A — `opts.queued` (default false, preserving the exact
   * pre-Step-5A row shape/behavior for every existing caller): when true
   * (RENDER_QUEUE_ENABLED=true, see render-engine.ts), the row starts life
   * 'queued' with `queuedAt`/`nextRunAt` set to now and `maxAttempts` from
   * `opts.maxAttempts` (falls back to the column default, 3) — a worker
   * claims it later (see claimNext()). When false, the row starts 'pending'
   * exactly as it always has, and the synchronous caller drives it straight
   * through 'rendering' -> 'rendered'/'failed' itself; `next_run_at`/
   * `max_attempts` are set too but are inert in that path since no worker
   * ever reads them.
   */
  async create(
    data: {
      id: string;
      clientId: string;
      productionJobId: string;
      requestedFormat: RequestedFormat;
      manifestSnapshot?: Record<string, unknown>;
      templateContractSnapshot?: Record<string, unknown>;
      requestedBy: string;
    },
    opts?: { queued?: boolean; maxAttempts?: number }
  ): Promise<RenderJob> {
    const queued = opts?.queued ?? false;
    const status = queued ? 'queued' : 'pending';
    const { rows } = await pool.query(
      `INSERT INTO render_jobs (
         id, client_id, production_job_id, requested_format, manifest_snapshot,
         template_contract_snapshot, status, requested_by, queued_at, next_run_at, max_attempts
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),COALESCE($10, 3))
       RETURNING *`,
      [
        data.id,
        data.clientId,
        data.productionJobId,
        JSON.stringify(data.requestedFormat),
        data.manifestSnapshot ? JSON.stringify(data.manifestSnapshot) : null,
        data.templateContractSnapshot ? JSON.stringify(data.templateContractSnapshot) : null,
        status,
        data.requestedBy,
        queued ? new Date().toISOString() : null,
        opts?.maxAttempts ?? null,
      ]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<RenderJob | undefined> {
    const { rows } = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Full render-job history for one production job, oldest first. */
  async listByProductionJob(productionJobId: string): Promise<RenderJob[]> {
    const { rows } = await pool.query(
      'SELECT * FROM render_jobs WHERE production_job_id = $1 ORDER BY created_at ASC',
      [productionJobId]
    );
    return rows.map(mapRow);
  },

  /**
   * Moves a job's render status ('rendering', 'rendered', 'failed',
   * 'cancelled'). errorMessage is stored when provided and cleared otherwise
   * (a successful retry must not keep a stale error — same contract as
   * productionJobsRepo.updateStatus()). renderer fields/warnings are written
   * when provided and left untouched otherwise. Returns undefined (-> 404 in
   * the route) if no row matched.
   */
  async updateStatus(
    id: string,
    status: RenderJobStatus,
    fields?: {
      errorMessage?: string;
      rendererName?: string;
      rendererVersion?: string;
      renderWarnings?: RenderWarning[];
    }
  ): Promise<RenderJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE render_jobs
       SET status = $2,
           error_message = $3,
           renderer_name = COALESCE($4, renderer_name),
           renderer_version = COALESCE($5, renderer_version),
           render_warnings = COALESCE($6, render_warnings)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        status,
        fields?.errorMessage ?? null,
        fields?.rendererName ?? null,
        fields?.rendererVersion ?? null,
        fields?.renderWarnings ? JSON.stringify(fields.renderWarnings) : null,
      ]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  // ─── Phase 3 Step 5A — render queue/worker methods ─────────

  /**
   * Atomically claims the single oldest claimable job (status 'pending' or
   * 'queued', not cancellation-requested, `next_run_at` due) for `workerId`
   * and moves it straight to 'rendering' — a single statement, so it is
   * correct under real concurrent callers without an explicit app-level
   * transaction. The inner `SELECT ... FOR UPDATE SKIP LOCKED` is Postgres-
   * native mutual exclusion: two workers (or two ticks) racing this query at
   * the same instant can never claim the same row — the loser's SELECT skips
   * the locked candidate row entirely and (with only one claimable job
   * available) comes back empty, so its outer UPDATE's `WHERE id = (SELECT
   * id FROM candidate)` matches nothing and returns no row.
   *
   * Sets started_at/locked_by/locked_at, increments attempt_count, and
   * (only the first time) queued_at — a job created in sync/'pending' mode
   * never reaches this method at all (see render-engine.ts), so queued_at
   * stays null for those rows exactly as it always has.
   */
  async claimNext(workerId: string): Promise<RenderJob | undefined> {
    const { rows } = await pool.query(
      `WITH candidate AS (
         SELECT id FROM render_jobs
         WHERE status IN ('pending', 'queued')
           AND cancellation_requested = FALSE
           AND (next_run_at IS NULL OR next_run_at <= NOW())
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE render_jobs
       SET status = 'rendering',
           started_at = NOW(),
           locked_by = $1,
           locked_at = NOW(),
           attempt_count = attempt_count + 1,
           queued_at = COALESCE(queued_at, NOW())
       WHERE id = (SELECT id FROM candidate)
       RETURNING *`,
      [workerId]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Success — terminal 'rendered', clears the lock, clears any stale error. */
  async markRendered(
    id: string,
    fields: { rendererName?: string; rendererVersion?: string; renderWarnings?: RenderWarning[] }
  ): Promise<RenderJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE render_jobs
       SET status = 'rendered',
           finished_at = NOW(),
           locked_by = NULL,
           locked_at = NULL,
           error_message = NULL,
           renderer_name = COALESCE($2, renderer_name),
           renderer_version = COALESCE($3, renderer_version),
           render_warnings = COALESCE($4, render_warnings)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        fields.rendererName ?? null,
        fields.rendererVersion ?? null,
        fields.renderWarnings ? JSON.stringify(fields.renderWarnings) : null,
      ]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Retryable failure — back to 'queued' (NOT 'failed'), clears the lock,
   * records the attempt's error, and schedules the next eligible claim time.
   * attempt_count is left as-is (already incremented by claimNext()).
   */
  async markRetry(id: string, fields: { errorMessage: string; nextRunAt: Date }): Promise<RenderJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE render_jobs
       SET status = 'queued',
           locked_by = NULL,
           locked_at = NULL,
           error_message = $2,
           next_run_at = $3
       WHERE id = $1
       RETURNING *`,
      [id, fields.errorMessage, fields.nextRunAt.toISOString()]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Retries exhausted (or a non-retryable error class) — terminal 'failed'. */
  async markFailed(id: string, fields: { errorMessage: string }): Promise<RenderJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE render_jobs
       SET status = 'failed',
           finished_at = NOW(),
           locked_by = NULL,
           locked_at = NULL,
           error_message = $2
       WHERE id = $1
       RETURNING *`,
      [id, fields.errorMessage]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Worker observed `cancellationRequested` after a 'rendering' attempt finished — terminal 'cancelled'. */
  async markCancelled(id: string): Promise<RenderJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE render_jobs
       SET status = 'cancelled',
           finished_at = NOW(),
           cancelled_at = NOW(),
           locked_by = NULL,
           locked_at = NULL
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Cancel request (POST /render-jobs/:id/cancel), atomic single statement:
   *   - old status 'pending'/'queued' -> cancelled directly (finished_at/
   *     cancelled_at set now; nothing was ever claimed, so there is no
   *     lock/in-flight work to interrupt).
   *   - old status 'rendering'       -> cancellation_requested = true only;
   *     status stays 'rendering' until the worker observes the flag right
   *     after its current attempt finishes (see render-worker.ts). Real
   *     in-flight interruption of the renderer/storage call is NOT
   *     performed — documented limitation, see docs/render-queue-worker-plan.md §12.
   *   - old status 'rendered'/'failed'/'cancelled' -> no-op (the CASE
   *     branches all fall through to the current value); the caller
   *     distinguishes this from a real transition via the returned
   *     `oldStatus` and turns it into a 409.
   * The `old` CTE is evaluated once, before the UPDATE's SET list runs, so
   * comparing against it (rather than the correlated column, which would
   * refer to the row's OLD value anyway per standard SQL UPDATE semantics)
   * makes the "was this a real transition" logic explicit and easy to read.
   */
  async requestCancellation(id: string): Promise<{ job: RenderJob; oldStatus: RenderJobStatus } | undefined> {
    const { rows } = await pool.query(
      `WITH old AS (SELECT status FROM render_jobs WHERE id = $1)
       UPDATE render_jobs
       SET
         status = CASE WHEN (SELECT status FROM old) IN ('pending', 'queued') THEN 'cancelled' ELSE render_jobs.status END,
         cancellation_requested = CASE WHEN (SELECT status FROM old) = 'rendering' THEN TRUE ELSE render_jobs.cancellation_requested END,
         cancelled_at = CASE WHEN (SELECT status FROM old) IN ('pending', 'queued') THEN NOW() ELSE render_jobs.cancelled_at END,
         finished_at = CASE WHEN (SELECT status FROM old) IN ('pending', 'queued') THEN NOW() ELSE render_jobs.finished_at END
       WHERE id = $1
       RETURNING *, (SELECT status FROM old) AS old_status`,
      [id]
    );
    if (!rows[0]) return undefined;
    const oldStatus = rows[0].old_status as RenderJobStatus;
    return { job: mapRow(rows[0]), oldStatus };
  },

  // ─── Production Readiness Step — operational queue visibility ─────────

  /**
   * GLOBAL (not client-scoped) counts by status, across every render_jobs
   * row — this is deliberately an operational/ops view (see GET
   * /api/health/ready), not a client-facing feature, so it does NOT filter
   * by client_id the way every other render_jobs query in this file does.
   */
  async countByStatus(): Promise<Record<string, number>> {
    const { rows } = await pool.query('SELECT status, COUNT(*)::int AS count FROM render_jobs GROUP BY status');
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status as string] = row.count as number;
    }
    return counts;
  },

  /**
   * A small operational summary folding a few cheap, separate queries
   * together (readability over a single "perfect" query, per the task's own
   * guidance) — queue depth by status, how many 'rendering' rows look stale
   * right now (informational; the sweep is what actually fixes them),
   * how old the oldest still-waiting job is, and when the last successful
   * render finished.
   */
  async getQueueSummary(staleThresholdMs: number): Promise<{
    byStatus: Record<string, number>;
    staleLockedCount: number;
    oldestQueuedAgeMs: number | null;
    lastRenderedAt: string | null;
  }> {
    const byStatus = await this.countByStatus();

    const staleResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM render_jobs
       WHERE status = 'rendering' AND locked_by IS NOT NULL
         AND started_at < NOW() - ($1 || ' milliseconds')::interval`,
      [staleThresholdMs]
    );
    const staleLockedCount = staleResult.rows[0]?.count ?? 0;

    const oldestResult = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(queued_at))) * 1000 AS age_ms
       FROM render_jobs WHERE status IN ('pending', 'queued')`
    );
    const oldestQueuedAgeMs =
      oldestResult.rows[0]?.age_ms != null ? Math.round(Number(oldestResult.rows[0].age_ms)) : null;

    const lastRenderedResult = await pool.query(
      `SELECT MAX(finished_at) AS last_rendered_at FROM render_jobs WHERE status = 'rendered'`
    );
    const lastRenderedAt = toIso(lastRenderedResult.rows[0]?.last_rendered_at) ?? null;

    return { byStatus, staleLockedCount, oldestQueuedAgeMs, lastRenderedAt };
  },

  /**
   * The stale-lock sweep (docs/render-queue-worker-plan.md's originally
   * planned tooling, implemented here): finds every 'rendering' row whose
   * `started_at` is older than `staleThresholdMs` and still carries a
   * `locked_by` (a worker claimed it and never reached a terminal state —
   * crashed, killed, or otherwise stuck), and recovers each one:
   *   - attempt_count < max_attempts -> back to 'pending' (NOT 'queued' —
   *     deliberate per the task's explicit instruction, though claimNext()
   *     accepts both), locks cleared, next_run_at = NOW() so it is
   *     immediately eligible again, error_message gets a fixed safe note
   *     (never raw internal error details).
   *   - attempt_count >= max_attempts -> terminal 'failed', finished_at set,
   *     locks cleared, a similar fixed safe note.
   * The `WHERE status = 'rendering'` clause guarantees 'rendered'/
   * 'cancelled'/already-'failed' rows are never touched, by construction.
   */
  async resetStaleLocks(staleThresholdMs: number): Promise<{ recoveredCount: number; failedCount: number }> {
    const recoveredResult = await pool.query(
      `UPDATE render_jobs
       SET status = 'pending',
           locked_by = NULL,
           locked_at = NULL,
           next_run_at = NOW(),
           error_message = 'stale lock recovered — job was locked without progress past the configured threshold'
       WHERE status = 'rendering' AND locked_by IS NOT NULL
         AND started_at < NOW() - ($1 || ' milliseconds')::interval
         AND attempt_count < max_attempts
       RETURNING id`,
      [staleThresholdMs]
    );

    const failedResult = await pool.query(
      `UPDATE render_jobs
       SET status = 'failed',
           finished_at = NOW(),
           locked_by = NULL,
           locked_at = NULL,
           error_message = 'stale lock recovered — max attempts already reached'
       WHERE status = 'rendering' AND locked_by IS NOT NULL
         AND started_at < NOW() - ($1 || ' milliseconds')::interval
         AND attempt_count >= max_attempts
       RETURNING id`,
      [staleThresholdMs]
    );

    return { recoveredCount: recoveredResult.rows.length, failedCount: failedResult.rows.length };
  },
};
