-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Render Queue / Worker fields (Phase 3 Step 5A)
--
-- Purely ADDITIVE on top of 019_render_jobs.sql: no existing column is
-- renamed, dropped, or retyped, and every new column is nullable/defaulted so
-- pre-existing render_jobs rows remain valid without a backfill. This is the
-- migration referenced (planning-only, not yet written) by
-- docs/render-queue-worker-plan.md §5/§6 — see that document for the full
-- rationale behind each field and the worker lifecycle it supports.
--
-- error_message is NOT renamed to last_error (the plan explicitly keeps the
-- existing name — it already serves that purpose).
--
-- STATUS MODEL CHANGE — 'queued' is added to the CHECK constraint alongside
-- the five existing values. Postgres has no `ALTER TYPE ... ADD VALUE` for a
-- plain CHECK-based enum column (this table intentionally uses VARCHAR +
-- CHECK, not a native Postgres ENUM type, matching 019's own choice), so the
-- only way to add an allowed value is to drop and recreate the constraint:
--   pending  -> row created; queue-mode creation goes straight to 'queued'
--               instead (see render-engine.ts) so the "waiting to be picked
--               up" state is visible to the dashboard immediately.
--   queued   -> NEW. Set at creation time when the render queue is enabled
--               (RENDER_QUEUE_ENABLED=true); also the state a retried job is
--               moved back to (queued_at is untouched on retry — see below).
--   rendering -> unchanged; now also carries started_at/locked_by/locked_at/
--               attempt_count bookkeeping set by the worker's atomic claim
--               query (see render-jobs.ts repo's claimNext()).
--   rendered/failed/cancelled -> unchanged terminal values. 'cancelled' gets
--               a REAL code path for the first time (render-worker.ts
--               cancelRenderJob()) — previously present in the CHECK but
--               never set by any code.
--
-- New columns:
--   queued_at               — when the job first entered 'queued' (creation
--                              time in queue mode). Nullable — a sync-mode
--                              ('pending' -> immediate render, no queue) job
--                              never sets this.
--   started_at               — when a worker claimed the job and began the
--                              actual render pipeline (rendering).
--   finished_at               — when the job reached any terminal state
--                              (rendered/failed/cancelled).
--   attempt_count             — how many times a worker has claimed/attempted
--                              this job; incremented atomically by the claim
--                              query. Starts at 0 (a job that is claimed once
--                              becomes 1).
--   max_attempts              — the ceiling attempt_count must stay under
--                              before a retryable failure gives up and goes
--                              to 'failed' instead of back to 'queued'.
--                              Defaulted from RENDER_JOB_MAX_ATTEMPTS at
--                              creation time (see render-jobs.ts repo).
--   next_run_at               — when a queued/retried job becomes eligible
--                              for claiming; the worker's claim query filters
--                              on `next_run_at IS NULL OR next_run_at <= now()`.
--                              Set to NOW() at creation, and to
--                              NOW() + backoff(attempt_count) on a retryable
--                              failure.
--   locked_by                 — worker identity (RENDER_WORKER_ID) that
--                              currently owns this job while 'rendering';
--                              cleared on every terminal/requeue transition.
--   locked_at                 — when the current lock was acquired; paired
--                              with locked_by for future stale-lock recovery
--                              tooling (not implemented in this migration/
--                              step — see plan §12 risks).
--   cancellation_requested    — set by POST /render-jobs/:id/cancel when the
--                              job is already 'rendering' (a job still
--                              'pending'/'queued' is cancelled directly,
--                              this flag is never needed for those). The
--                              worker checks this immediately before
--                              persisting a 'rendered' outcome and finalizes
--                              to 'cancelled' instead if set.
--   cancelled_at               — when the job actually transitioned to
--                              'cancelled' (immediately for pending/queued,
--                              on the worker's next observation for
--                              rendering).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE render_jobs
  ADD COLUMN queued_at TIMESTAMPTZ,
  ADD COLUMN started_at TIMESTAMPTZ,
  ADD COLUMN finished_at TIMESTAMPTZ,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN next_run_at TIMESTAMPTZ,
  ADD COLUMN locked_by VARCHAR(200),
  ADD COLUMN locked_at TIMESTAMPTZ,
  ADD COLUMN cancellation_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cancelled_at TIMESTAMPTZ;

ALTER TABLE render_jobs DROP CONSTRAINT render_jobs_status_check;
ALTER TABLE render_jobs ADD CONSTRAINT render_jobs_status_check CHECK (status IN (
  'pending', 'queued', 'rendering', 'rendered', 'failed', 'cancelled'
));

-- Supports the worker's claim query (`WHERE status IN ('pending','queued')
-- AND (next_run_at IS NULL OR next_run_at <= NOW())`) without a full table
-- scan as render_jobs grows — mirrors idx_render_jobs_status from 019, just
-- scoped to the rows a poll actually cares about.
CREATE INDEX idx_render_jobs_claimable ON render_jobs(status, next_run_at);
