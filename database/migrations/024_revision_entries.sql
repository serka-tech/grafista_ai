-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Revision Entries (Phase 3 Step 6B)
--
-- Purely ADDITIVE: one new append-only table + one new permission. No
-- existing table/column is touched. See docs/revision-history-plan.md §3/§4/
-- §6/§7 for the full rationale (this migration implements that plan).
--
-- revision_entries records a HUMAN approve/reject/revise DECISION on one of
-- three entities that have a real needs_revision round-trip today
-- (design_dna, layout_plans, creative_qa_reports) — it is NOT a replacement
-- for analytics_events (023_analytics_events.sql), which is a pure
-- append-only METRIC log with no "what changed" narrative. The two tables
-- are deliberately separate and this migration does not touch
-- analytics_events in any way.
--
-- client_id NOT NULL mirrors analytics_events.client_id exactly, so
-- assertClientAccessible (see ../../apps/api/src/auth/client-access.ts)
-- applies the same way it applies everywhere else.
--
-- revision_type uses VARCHAR + CHECK (not a native Postgres ENUM), matching
-- analytics_events.event_type's own precedent — adding a new revision type
-- later is a drop/recreate of the CHECK constraint, not an ALTER TYPE
-- migration.
--
-- entity_type/entity_id is the same polymorphic-reference idiom
-- analytics_events.entity_type/entity_id already uses.
--
-- actor_user_id is nullable + ON DELETE SET NULL (same pattern as
-- analytics_events.actor_user_id / production_jobs.approved_by/rejected_by).
-- Every call site in this MVP is a synchronous HTTP route (a human decision),
-- but nullable is kept for forward-compat with a hypothetical future
-- system-originated revision.
--
-- before_snapshot/after_snapshot are SMALL, SELECTIVE objects (status,
-- notes/revisionNotes, score for creative_qa only, approvedBy/rejectedBy) —
-- NEVER the full layout_json/qa_json/design_dna analysis blob, never a raw
-- provider payload, never base64/image data (see §4/§7 of the plan).
-- before_snapshot is nullable (the very first revision on a row has no prior
-- revision state to speak of); after_snapshot is NOT NULL (every revision
-- entry has a resulting state by definition).
--
-- reason is capped at 2000 characters at the application layer (see
-- apps/api/src/db/repositories/revision-entries.ts) — same order of
-- magnitude as production_jobs.rejection_reason's existing 2000-char cap.
--
-- NOT projectId/campaignId — this schema has no such entities today (same
-- finding 023_analytics_events.sql already made).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE revision_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN (
    'design_dna',
    'layout_plan',
    'creative_qa_report'
  )),
  entity_id UUID NOT NULL,
  revision_type VARCHAR(60) NOT NULL CHECK (revision_type IN (
    'design_dna_approved',
    'design_dna_needs_revision',
    'layout_plan_approved',
    'layout_plan_rejected',
    'layout_plan_needs_revision',
    'creative_qa_report_approved',
    'creative_qa_report_rejected',
    'creative_qa_report_needs_revision'
  )),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  before_snapshot JSONB,
  after_snapshot JSONB NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_revision_entries_client_created ON revision_entries(client_id, created_at DESC);
CREATE INDEX idx_revision_entries_type ON revision_entries(revision_type);
CREATE INDEX idx_revision_entries_entity ON revision_entries(entity_type, entity_id);

-- ─── Permission: revisions:read ─────────────────────────────
-- Role distribution mirrors 023_analytics_events.sql's rationale exactly:
-- OWNER + CREATIVE_DIRECTOR (full pipeline ownership) and DESIGNER (may read
-- the revision history of the DNA/layout/QA work they generate — harmless,
-- read-only data) get it; CONTENT_MANAGER does not, matching the existing
-- design_dna/layout_plans/creative_qa/analytics posture for that role
-- (005/007/010/023's own precedent).
--
-- As with 005/007/010/012/015/017/020/023: the OWNER cross-join in
-- 003_auth.sql was a one-time snapshot, not a live trigger — this new
-- permission needs its own explicit OWNER grant.
INSERT INTO permissions (key) VALUES ('revisions:read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key = 'revisions:read';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key = 'revisions:read';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key = 'revisions:read';

-- CONTENT_MANAGER: intentionally no revisions:read grant.
