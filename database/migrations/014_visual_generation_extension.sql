-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Visual Generation extension of generated_outputs
-- (Phase 2 Step 7)
--
-- generated_outputs was created in 001_initial_schema.sql but no repository
-- used it until now. Phase 2 Step 7 (visual generation: approved LayoutPlan
-- + cleared Creative QA report -> AI image -> object storage -> row here)
-- needs a few columns 001 did not anticipate:
--
--   * creative_qa_report_id — the QA report that cleared this layout plan
--     for production (traceability of the production-gate decision).
--   * alternative_index     — which visual alternative of a generation batch
--     this row is (mirrors layout_plans.alternative_index).
--   * status                — production lifecycle of the FILE itself:
--     'pending' | 'generated' | 'failed'. Distinct from qa_status /
--     approval_status, which track review of an already-generated file.
--   * error_message         — provider/storage failure detail when 'failed'.
--   * provider              — AI provider name ('openai', 'kie-ai', ...);
--     001 only had ai_model.
--   * prompt_snapshot       — exact prompt sent to the image provider.
--   * storage_provider/_bucket/_key — object-storage coordinates, the same
--     triple brand_assets/design_references already store (004_storage.sql).
--   * created_by / approved_by / approved_at — audit columns matching the
--     layout_plans / creative_qa_reports convention.
--
-- Everything below is idempotent (IF NOT EXISTS / guarded DO blocks) so a
-- partial apply can be safely re-run. width/height stay inside the existing
-- `dimensions` JSONB column; mime_type/file_url already exist in 001.
-- updated_at is already maintained by 001's trg_outputs_updated trigger.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE generated_outputs
  ADD COLUMN IF NOT EXISTS creative_qa_report_id UUID REFERENCES creative_qa_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS alternative_index INTEGER,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS provider VARCHAR(50),
  ADD COLUMN IF NOT EXISTS prompt_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_key TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- CHECK constraint for the new production status column (guarded — ADD CONSTRAINT
-- has no IF NOT EXISTS form on this Postgres baseline).
DO $$ BEGIN
  ALTER TABLE generated_outputs
    ADD CONSTRAINT chk_generated_outputs_status
    CHECK (status IN ('pending', 'generated', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 001 declared layout_plan_id as a bare UUID because layout_plans did not exist
-- yet (it arrived in 009). Now that it does, enforce the reference.
DO $$ BEGIN
  ALTER TABLE generated_outputs
    ADD CONSTRAINT fk_generated_outputs_layout_plan
    FOREIGN KEY (layout_plan_id) REFERENCES layout_plans(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_outputs_layout_plan ON generated_outputs(layout_plan_id);
CREATE INDEX IF NOT EXISTS idx_outputs_qa_report ON generated_outputs(creative_qa_report_id);
CREATE INDEX IF NOT EXISTS idx_outputs_status ON generated_outputs(status);
