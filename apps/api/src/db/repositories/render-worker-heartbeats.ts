/**
 * Grafista AI Studio — Render Worker Heartbeats Repository
 * (Production Readiness Step — Healthcheck + Worker Heartbeat/Stale Lock
 * Recovery)
 *
 * Backs database/migrations/025_render_worker_heartbeats.sql. One row per
 * worker_id, upserted on every poll tick (see render-worker.ts) — this is a
 * liveness signal ("is a worker process alive right now"), not a history
 * log, so `listRecentHeartbeats()` deliberately answers "any worker alive
 * recently" rather than requiring a caller to know a specific worker_id
 * (RENDER_WORKER_ID defaults to a per-process value, so a readiness check
 * cannot hardcode one).
 *
 * `upsertHeartbeat()` is written to be safe for a caller to treat as
 * best-effort (render-worker.ts wraps its call in try/catch so a heartbeat
 * write failure can never break the actual render poll tick) — this repo
 * function itself does not swallow errors; the caller decides.
 */

import { pool } from '../pool.js';

export interface RenderWorkerHeartbeat {
  workerId: string;
  workerType: string;
  status: 'ok' | 'degraded';
  lastHeartbeatAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): RenderWorkerHeartbeat {
  return {
    workerId: row.worker_id as string,
    workerType: row.worker_type as string,
    status: row.status as 'ok' | 'degraded',
    lastHeartbeatAt: (row.last_heartbeat_at as Date).toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const renderWorkerHeartbeatsRepo = {
  /**
   * Upserts the single row for `workerId` — `last_heartbeat_at`/`updated_at`
   * always move to NOW(), `status`/`metadata` reflect this tick's outcome.
   * `metadata` must only ever hold small operational fields (e.g. last poll
   * duration, last error CLASS) — never raw error messages, stack traces, or
   * provider payloads (no secrets/PII by construction of the caller's
   * choices; this repo does not itself sanitize, callers must not pass
   * anything sensitive).
   */
  async upsertHeartbeat(
    workerId: string,
    opts?: { status?: 'ok' | 'degraded'; metadata?: Record<string, unknown> }
  ): Promise<void> {
    await pool.query(
      `INSERT INTO render_worker_heartbeats (worker_id, status, last_heartbeat_at, metadata, updated_at)
       VALUES ($1, $2, NOW(), $3, NOW())
       ON CONFLICT (worker_id) DO UPDATE
       SET status = $2, last_heartbeat_at = NOW(), metadata = $3, updated_at = NOW()`,
      [workerId, opts?.status ?? 'ok', JSON.stringify(opts?.metadata ?? {})]
    );
  },

  async getHeartbeat(workerId: string): Promise<RenderWorkerHeartbeat | null> {
    const { rows } = await pool.query('SELECT * FROM render_worker_heartbeats WHERE worker_id = $1', [workerId]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /**
   * All heartbeats seen within the last `maxAgeMs` (default 1 hour — a
   * generous window; the /ready route applies its own, tighter
   * "recent enough" threshold on top of this list, see app.ts/health route).
   */
  async listRecentHeartbeats(maxAgeMs = 60 * 60 * 1000): Promise<RenderWorkerHeartbeat[]> {
    const { rows } = await pool.query(
      `SELECT * FROM render_worker_heartbeats
       WHERE last_heartbeat_at >= NOW() - ($1 || ' milliseconds')::interval
       ORDER BY last_heartbeat_at DESC`,
      [maxAgeMs]
    );
    return rows.map(mapRow);
  },
};
