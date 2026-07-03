-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Production Jobs (Phase 2 Step 8A)
--
-- Pipeline stage: approved/QA-cleared visual (generated_outputs row with
-- status 'generated') -> production job -> manifest + template-contract JSON
-- package in object storage (see apps/api/src/services/
-- production-package-builder.ts). A job is the unit a human production
-- designer (and, in a future phase, an automated Photoshop worker) picks up
-- to turn an AI preview visual into final deliverables.
--
-- STATUS MODEL — one column, deliberately NOT the generated_outputs
-- status/approval_status split. generated_outputs needed two independent
-- axes because file production and human review genuinely overlap there (a
-- file can be 'generated' while its review is still 'pending'). A production
-- job's lifecycle is strictly linear instead: packaging can only be approved
-- or rejected AFTER it is 'package_ready', so the states never overlap and a
-- single guarded state machine is the simplest safe model for the MVP:
--
--   pending -> packaging -> package_ready -> approved | rejected
--                      \-> failed                (error_message set)
--   cancelled                                     (manual abort, any pre-terminal state)
--
-- IDEMPOTENCY — one ACTIVE job per generated output, enforced BOTH at the
-- service layer (findActiveByGeneratedOutput returns the existing job instead
-- of creating a duplicate) and here at the DB layer via a partial unique
-- index: a second concurrent create for the same output fails instead of
-- silently duplicating. 'failed' / 'cancelled' / 'rejected' jobs do not count
-- as active — a retry after failure or rejection is legitimate.
--
-- layout_plan_id is a nullable denormalized copy from the generated output
-- (same convenience-copy pattern as generated_outputs.layout_plan_id /
-- layout_plans.content_idea_id) — useful for querying without a join.
-- package_manifest_snapshot / template_contract_snapshot duplicate the stored
-- JSON package for fast DB reads without a storage round-trip (same
-- snapshot-over-fetch reasoning as workflow_runs.definition_snapshot).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE production_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  generated_output_id UUID NOT NULL REFERENCES generated_outputs(id),
  layout_plan_id UUID REFERENCES layout_plans(id),
  requested_by UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'packaging', 'package_ready', 'failed', 'cancelled', 'approved', 'rejected'
  )),
  -- How the package was produced ('manual_package_builder' today; a future
  -- Photoshop worker would introduce its own value).
  generation_method VARCHAR(50) NOT NULL DEFAULT 'manual_package_builder',
  -- Object-storage coordinates of the built package (same provider/bucket/key
  -- triple as brand_assets / design_references / generated_outputs).
  package_storage_provider VARCHAR(20),
  package_storage_bucket TEXT,
  package_storage_key TEXT,
  package_mime_type VARCHAR(100),
  package_size_bytes BIGINT,
  package_manifest_snapshot JSONB,
  template_contract_snapshot JSONB,
  error_message TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_production_jobs_client ON production_jobs(client_id);
CREATE INDEX idx_production_jobs_output ON production_jobs(generated_output_id);
CREATE INDEX idx_production_jobs_status ON production_jobs(status);

-- DB-layer idempotency guard: at most one non-terminal ("active") job per
-- generated output. See header comment.
CREATE UNIQUE INDEX uniq_production_jobs_active_output
  ON production_jobs(generated_output_id)
  WHERE status NOT IN ('failed', 'cancelled', 'rejected');

CREATE TRIGGER trg_production_jobs_updated BEFORE UPDATE ON production_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
