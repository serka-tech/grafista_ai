-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Creative QA Reports (Phase 2 Step 5B)
--
-- Pipeline stage: approved LayoutPlan + approved DesignBrief + approved
-- DesignDNA -> CreativeQAReport (see apps/api/src/services/creative-qa.ts).
-- One generation call reviews one LayoutPlan alternative against its
-- DesignBrief and the client's approved DesignDNA and produces exactly one
-- report row.
--
-- design_dna_id is nullable — the service currently HARD REQUIRES an
-- approved DesignDNA to exist before running Creative QA (409 otherwise), so
-- in practice this column is always populated today. It is kept nullable
-- here for schema flexibility/future-proofing only (mirrors layout_plans's
-- own design_dna_id column, which is nullable for the same reason), not
-- because the current service ever leaves it unset.
--
-- `score` / `pass_threshold` are denormalized copies of qa_json's
-- overallScore/passThreshold (fast querying/sorting without JSON parsing).
-- `recommendations` is a denormalized copy of the combined
-- high/medium/low-priority fix tiers (fast listing without parsing the full
-- qa_json blob).
--
-- status lifecycle: 'generated' is a defensive default only — the service
-- currently always sets 'passed' or 'failed' directly at creation time based
-- on the validated score vs threshold. A human can still move either of
-- those to 'approved' (ship as-is) or 'rejected'/'needs_revision' via the
-- approve/reject routes — that's what separates the AI's read from the
-- human's final call.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE creative_qa_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  design_brief_id UUID NOT NULL REFERENCES design_briefs(id),
  layout_plan_id UUID NOT NULL REFERENCES layout_plans(id),
  design_dna_id UUID REFERENCES design_dna(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'generated' CHECK (status IN (
    'generated', 'passed', 'failed', 'approved', 'rejected', 'needs_revision'
  )),
  score DECIMAL(5,2),
  pass_threshold DECIMAL(5,2),
  provider VARCHAR(50),
  model VARCHAR(100),
  qa_json JSONB NOT NULL DEFAULT '{}',
  recommendations JSONB NOT NULL DEFAULT '[]',
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_creative_qa_reports_client ON creative_qa_reports(client_id);
CREATE INDEX idx_creative_qa_reports_brief ON creative_qa_reports(design_brief_id);
CREATE INDEX idx_creative_qa_reports_layout_plan ON creative_qa_reports(layout_plan_id);
CREATE INDEX idx_creative_qa_reports_status ON creative_qa_reports(status);

CREATE TRIGGER trg_creative_qa_reports_updated BEFORE UPDATE ON creative_qa_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
