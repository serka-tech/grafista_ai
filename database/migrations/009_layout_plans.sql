-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Layout Plans (Phase 2 Step 5A)
--
-- Pipeline stage: approved DesignBrief (+ approved DesignDNA context, if any) ->
-- LayoutPlan alternatives. One generation call (see apps/api/src/services/
-- layout-generation.ts) produces 2-3 alternatives in a single AI response; each
-- alternative is persisted as its own row here, distinguished by
-- alternative_index, so they can be independently listed/approved/rejected.
--
-- design_dna_id is nullable — a layout can be generated without an approved
-- DesignDNA existing yet (DNA is optional context; the DesignBrief being
-- approved is the only hard requirement). content_idea_id is a denormalized
-- convenience copied from the design brief (which already links to it), useful
-- for querying without a join.
--
-- design_briefs.layout_plan_id and generated_outputs.layout_plan_id (both
-- already present as forward-looking, unenforced UUID columns since
-- 001_initial_schema.sql) are intentionally left as-is here — wiring those FKs
-- up is a future-phase concern, not part of this migration.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE layout_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  design_brief_id UUID NOT NULL REFERENCES design_briefs(id),
  content_idea_id UUID REFERENCES content_ideas(id),
  design_dna_id UUID REFERENCES design_dna(id) ON DELETE SET NULL,
  alternative_index INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'generated' CHECK (status IN (
    'generated', 'approved', 'rejected', 'needs_revision'
  )),
  format VARCHAR(50),
  canvas_width INTEGER,
  canvas_height INTEGER,
  layout_json JSONB NOT NULL DEFAULT '{}',
  provider VARCHAR(50),
  model VARCHAR(100),
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_layout_plans_client ON layout_plans(client_id);
CREATE INDEX idx_layout_plans_brief ON layout_plans(design_brief_id);
CREATE INDEX idx_layout_plans_status ON layout_plans(status);

CREATE TRIGGER trg_layout_plans_updated BEFORE UPDATE ON layout_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();
