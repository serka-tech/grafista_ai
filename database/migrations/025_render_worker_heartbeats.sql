-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Render Worker Heartbeats (Production
-- Readiness Step — Healthcheck + Worker Heartbeat/Stale Lock Recovery)
--
-- Purely ADDITIVE: one new small table, no existing table/column touched.
-- Implements docs/production-readiness-review.md §5/§7/§11/§12's proposal
-- and the stale-lock recovery tooling that 022_render_jobs_queue.sql's own
-- comment on `locked_at` explicitly deferred ("paired with locked_by for
-- future stale-lock recovery tooling — not implemented in this migration").
--
-- Why a NEW table instead of reusing render_jobs.locked_by/locked_at: those
-- columns only reflect whichever job a worker currently has claimed — an
-- idle worker with an empty queue looks IDENTICAL to a dead worker (both
-- have no 'rendering' row at all) using render_jobs data alone. This table
-- is written on every poll tick regardless of whether a job was claimed, so
-- "is a worker process alive right now" is answerable independently of
-- queue contents.
--
-- One row PER worker_id (upsert on every tick, see
-- render-worker-heartbeats.ts's upsertHeartbeat()) rather than an
-- append-only log — this is a liveness signal, not a history/audit table;
-- the current heartbeat is all any caller (the /ready route) ever needs.
--
-- metadata is a small JSONB bag for operational-only fields (e.g. last poll
-- duration, last error CLASS) — callers must never put raw error messages,
-- stack traces, or provider payloads in it (no PII/secrets by construction:
-- there is no reasonable operational field that would need one).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE render_worker_heartbeats (
  worker_id VARCHAR(200) PRIMARY KEY,
  worker_type VARCHAR(50) NOT NULL DEFAULT 'render_worker',
  status VARCHAR(20) NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'degraded')),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports listRecentHeartbeats(maxAgeMs) — "any worker alive in the last N
-- ms" without a full table scan (this table stays tiny in practice, one row
-- per distinct RENDER_WORKER_ID ever seen, but the index costs nothing).
CREATE INDEX idx_render_worker_heartbeats_last_heartbeat ON render_worker_heartbeats(last_heartbeat_at DESC);
