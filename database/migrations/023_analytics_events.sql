-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Analytics Events (Phase 3 Step 6A)
--
-- Purely ADDITIVE: one new append-only table + one new permission. No
-- existing table/column is touched. See docs/analytics-revision-history-plan.md
-- §8.1/§9/§12 for the full rationale (this migration implements that plan,
-- refined by a follow-up read-only audit — no projects/campaigns columns:
-- this schema has no such entities today, so none are speculatively added).
--
-- analytics_events records a lifecycle EVENT (append-only, many rows over
-- time) — it does NOT replace any table's own `status` column, which still
-- reflects the current state exactly as it always has. `client_id NOT NULL`
-- mirrors every other analytics-eligible table in this schema (clients,
-- design_dna, layout_plans, creative_qa_reports, production_jobs,
-- render_jobs, export_artifacts) so `assertClientAccessible` (see
-- ../../apps/api/src/auth/client-access.ts) applies to this table exactly
-- the same way it applies everywhere else.
--
-- event_type uses VARCHAR + CHECK (not a native Postgres ENUM), matching the
-- render_jobs.status / production_jobs.status precedent (022_render_jobs_
-- queue.sql's own rationale) — adding a new event type later is a
-- drop/recreate of the CHECK constraint, not an ALTER TYPE migration.
--
-- entity_type/entity_id is the same polymorphic-reference idiom the
-- `approvals` table already uses (001_initial_schema.sql) — no new concept.
--
-- actor_user_id is nullable + ON DELETE SET NULL (same pattern as
-- production_jobs.approved_by/rejected_by): NULL means a system/worker-
-- originated event (e.g. the render queue worker, which has no HTTP user
-- context) rather than a human action.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID NOT NULL,
  event_type VARCHAR(60) NOT NULL CHECK (event_type IN (
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
    'export_artifact_downloaded'
  )),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider VARCHAR(60),
  model VARCHAR(120),
  status VARCHAR(30),
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_events_client_created ON analytics_events(client_id, created_at DESC);
CREATE INDEX idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_entity ON analytics_events(entity_type, entity_id);

-- ─── Permission: analytics:read ─────────────────────────────
-- Role distribution mirrors 020_render_jobs_permissions.sql's rationale:
-- OWNER + CREATIVE_DIRECTOR (full pipeline ownership) and DESIGNER (may
-- read a summary of the jobs they generate — harmless, read-only,
-- aggregate-only data) get it; CONTENT_MANAGER does not, matching the
-- existing production_jobs/creative_qa/visual_generation/render_jobs
-- posture for that role (017/020's own precedent).
--
-- As with 005/007/010/012/015/017/020: the OWNER cross-join in
-- 003_auth.sql was a one-time snapshot, not a live trigger — this new
-- permission needs its own explicit OWNER grant.
INSERT INTO permissions (key) VALUES ('analytics:read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key = 'analytics:read';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key = 'analytics:read';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key = 'analytics:read';

-- CONTENT_MANAGER: intentionally no analytics:read grant.
