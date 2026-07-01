-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Real Design DNA Vision Analysis (Phase 2 Step 4)
--
-- Extends design_analysis (per-reference StyleAnalysis storage, previously
-- defined but completely unused) and design_dna (aggregated client DNA) so
-- the new Postgres-backed analysis service (see apps/api/src/services/
-- design-dna-analysis.ts) has somewhere real to persist its output. This
-- migration intentionally never touches design_dna.dna_embedding — that
-- column only exists when 002_pgvector.sql successfully applied (pgvector
-- extension available), which is not guaranteed (see db/migrate.ts).
-- ═══════════════════════════════════════════════════════════

-- ─── design_analysis: possible design category classification ──
ALTER TABLE design_analysis
  ADD COLUMN design_category VARCHAR(30) CHECK (design_category IN (
    'story', 'post', 'carousel', 'billboard', 'brochure', 'menu',
    'real_estate', 'school', 'healthcare', 'cafe_restaurant', 'corporate', 'other'
  ));

-- ─── design_dna: status lifecycle + approval/revision tracking ──
-- Lifecycle: draft -> generated -> waiting_for_approval -> approved
--            (any non-approved status) -> needs_revision
-- 'draft' and 'waiting_for_approval' are reserved for future flows (e.g. an
-- explicit "submit for review" dashboard step) — no route in this phase
-- produces them; POST /analyze always writes 'generated'.
ALTER TABLE design_dna
  ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'generated', 'waiting_for_approval', 'approved', 'needs_revision'
  )),
  ADD COLUMN confidence_score DECIMAL(3,2),
  ADD COLUMN references_used JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN image_treatment_rules JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN revision_notes TEXT;

CREATE INDEX idx_design_dna_status ON design_dna(status);
