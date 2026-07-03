-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Workflow Engine (Phase 2 Step 6)
--
-- Persistent, restart-safe state for the workflow engine
-- (apps/api/src/workflows/engine.ts). A run is one execution of one of the
-- ten JSON workflow definitions in workflows/*.json for one client; its
-- steps are materialized as rows at start time so every status transition,
-- approval decision and produced entity survives an API restart.
--
-- Two deliberate NON-tables, documented here so nobody "adds them back":
--
--   * NO workflow_definitions table. The definitions live in
--     workflows/*.json (validated + cross-checked against the step-binding
--     registry at server startup). Each run stores the full validated
--     definition it was started with in definition_snapshot, so in-flight
--     runs are immune to later JSON edits without needing a versioned
--     definitions table.
--
--   * NO workflow_skill_usages join table. The skill ids a step consumes
--     (its `skill` plus `ai_provider_routing` from the JSON) are frozen
--     into workflow_steps.skill_ids as a JSONB array at run start — the
--     same snapshot-over-join reasoning as definition_snapshot.
--
-- workflow_step_outputs links steps to the REAL domain entities they
-- produced/affected (design_dna, content_idea, design_brief, layout_plan,
-- creative_qa_report) — approval gates and later steps read these links to
-- act on this run's entities specifically. workflow_approvals is the audit
-- trail of gate decisions (who approved/rejected which step, when); the
-- domain approval itself still lives on the entity's own status column
-- (and, for content ideas, in the existing approvals table), exactly like
-- the manual HTTP routes.
-- ═══════════════════════════════════════════════════════════

-- ─── Workflow runs ───────────────────────────────────────────
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id VARCHAR(100) NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'draft', 'in_progress', 'waiting_for_approval', 'approved', 'completed',
    'failed', 'cancelled', 'qa_failed', 'blocked_future_feature'
  )),
  started_by UUID NOT NULL REFERENCES users(id),
  -- step_id string of the step the run is currently parked on; NULL when terminal.
  current_step_id VARCHAR(100),
  -- Full validated workflow definition at start time — runs survive later JSON edits.
  definition_snapshot JSONB NOT NULL DEFAULT '{}',
  input_json JSONB NOT NULL DEFAULT '{}',
  output_json JSONB NOT NULL DEFAULT '{}',
  error_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_workflow_runs_client ON workflow_runs(client_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);

CREATE TRIGGER trg_workflow_runs_updated BEFORE UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Workflow steps (materialized per run at start time) ────
CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id VARCHAR(100) NOT NULL,
  step_name TEXT NOT NULL,
  action TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  step_type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'waiting_for_approval', 'approved', 'rejected',
    'skipped', 'completed', 'failed'
  )),
  required_permission VARCHAR(100),
  required_approval BOOLEAN NOT NULL DEFAULT false,
  skill_ids JSONB NOT NULL DEFAULT '[]',
  input_json JSONB NOT NULL DEFAULT '{}',
  output_json JSONB NOT NULL DEFAULT '{}',
  error_json JSONB,
  revision_count INTEGER NOT NULL DEFAULT 0,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_run_id, step_id)
);

CREATE INDEX idx_workflow_steps_run ON workflow_steps(workflow_run_id);
CREATE INDEX idx_workflow_steps_status ON workflow_steps(status);

CREATE TRIGGER trg_workflow_steps_updated BEFORE UPDATE ON workflow_steps FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Step outputs (links to produced/affected domain entities) ──
CREATE TABLE workflow_step_outputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  -- e.g. 'design_dna', 'content_idea', 'design_brief', 'layout_plan', 'creative_qa_report'
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  output_key VARCHAR(100) NOT NULL,
  output_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_step_outputs_run ON workflow_step_outputs(workflow_run_id);
CREATE INDEX idx_workflow_step_outputs_entity ON workflow_step_outputs(entity_type, entity_id);

-- ─── Gate decision audit trail ───────────────────────────────
CREATE TABLE workflow_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_by UUID NOT NULL REFERENCES users(id),
  entity_type VARCHAR(50),
  entity_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_approvals_run ON workflow_approvals(workflow_run_id);
