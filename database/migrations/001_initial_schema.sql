-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Initial Database Schema
-- PostgreSQL 15+ with pgvector support
-- ═══════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Clients ─────────────────────────────────────────────
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  industry VARCHAR(100),
  website VARCHAR(500),
  contact_name VARCHAR(200),
  contact_email VARCHAR(320),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_slug ON clients(slug);

-- ─── Brand Assets ────────────────────────────────────────
CREATE TABLE brand_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'logo', 'logo_variant', 'icon', 'color_palette', 'font',
    'brand_guideline', 'pattern', 'illustration', 'photography_style', 'other'
  )),
  name VARCHAR(200) NOT NULL,
  file_url TEXT,
  mime_type VARCHAR(100),
  file_size_bytes BIGINT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brand_assets_client ON brand_assets(client_id);
CREATE INDEX idx_brand_assets_type ON brand_assets(type);

-- ─── Brand Profiles ──────────────────────────────────────
CREATE TABLE brand_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  brand_name VARCHAR(200) NOT NULL,
  tagline VARCHAR(500),
  description TEXT,
  industry VARCHAR(100),
  target_audience TEXT,
  brand_personality JSONB DEFAULT '[]',
  tone_of_voice JSONB DEFAULT '[]',
  colors JSONB DEFAULT '[]',
  fonts JSONB DEFAULT '[]',
  rules JSONB DEFAULT '[]',
  forbidden_elements JSONB DEFAULT '[]',
  competitor_brands JSONB DEFAULT '[]',
  inspiration_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brand_profiles_client ON brand_profiles(client_id);

-- ─── Design References ──────────────────────────────────
CREATE TABLE design_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  mime_type VARCHAR(100),
  file_size_bytes BIGINT,
  tags JSONB DEFAULT '[]',
  is_approved BOOLEAN NOT NULL DEFAULT true,
  analysis_id UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_design_refs_client ON design_references(client_id);

-- ─── Design Analysis ────────────────────────────────────
CREATE TABLE design_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  design_reference_id UUID NOT NULL REFERENCES design_references(id) ON DELETE CASCADE,
  format VARCHAR(50),
  aspect_ratio VARCHAR(20),
  dominant_colors JSONB DEFAULT '[]',
  typography_hierarchy JSONB DEFAULT '{}',
  logo_position VARCHAR(30),
  image_treatment TEXT,
  background_style TEXT,
  text_density VARCHAR(20),
  cta_style TEXT,
  layout_pattern VARCHAR(30),
  visual_mood VARCHAR(30),
  brand_consistency_notes TEXT,
  reusable_design_rules JSONB DEFAULT '[]',
  confidence DECIMAL(3,2) DEFAULT 0.5,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_design_analysis_ref ON design_analysis(design_reference_id);

-- ─── Design DNA ──────────────────────────────────────────
CREATE TABLE design_dna (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  brand_personality JSONB DEFAULT '[]',
  preferred_layouts JSONB DEFAULT '[]',
  visual_rules JSONB DEFAULT '[]',
  typography_rules JSONB DEFAULT '[]',
  color_usage_rules JSONB DEFAULT '[]',
  logo_usage_rules JSONB DEFAULT '[]',
  content_tone JSONB DEFAULT '{}',
  avoid_list JSONB DEFAULT '[]',
  approval_bias JSONB DEFAULT '{}',
  recommended_prompt_style JSONB DEFAULT '{}',
  source_analysis_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_design_dna_client ON design_dna(client_id);
CREATE UNIQUE INDEX idx_design_dna_client_version ON design_dna(client_id, version);

-- ─── Content Ideas ───────────────────────────────────────
CREATE TABLE content_ideas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_name VARCHAR(200),
  title VARCHAR(300) NOT NULL,
  description TEXT,
  platform VARCHAR(30) NOT NULL,
  format VARCHAR(30) NOT NULL,
  target_audience TEXT,
  hook TEXT,
  caption TEXT,
  hashtags JSONB DEFAULT '[]',
  call_to_action VARCHAR(200),
  tone_of_voice VARCHAR(200),
  visual_direction TEXT,
  ai_image_prompt TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'rejected', 'revision_requested'
  )),
  generated_by VARCHAR(10) NOT NULL DEFAULT 'ai' CHECK (generated_by IN ('ai', 'manual')),
  approval_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_ideas_client ON content_ideas(client_id);
CREATE INDEX idx_content_ideas_status ON content_ideas(status);

-- ─── Approvals ───────────────────────────────────────────
CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN (
    'content_idea', 'design_brief', 'generated_output', 'final_delivery'
  )),
  entity_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL CHECK (status IN (
    'pending', 'approved', 'rejected', 'revision_requested', 'auto_approved'
  )),
  reviewer_role VARCHAR(30),
  reviewer_name VARCHAR(200),
  notes TEXT,
  revision_notes TEXT,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approvals_entity ON approvals(entity_type, entity_id);
CREATE INDEX idx_approvals_client ON approvals(client_id);
CREATE INDEX idx_approvals_status ON approvals(status);

-- ─── Design Briefs ───────────────────────────────────────
CREATE TABLE design_briefs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  content_idea_id UUID NOT NULL REFERENCES content_ideas(id),
  approval_id UUID NOT NULL REFERENCES approvals(id),
  title VARCHAR(300) NOT NULL,
  objective TEXT,
  platform VARCHAR(30) NOT NULL,
  format VARCHAR(30) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}',
  content_elements JSONB DEFAULT '{}',
  visual_direction JSONB DEFAULT '{}',
  brand_constraints JSONB DEFAULT '{}',
  ai_image_prompts JSONB DEFAULT '[]',
  designer_notes TEXT,
  reference_design_ids JSONB DEFAULT '[]',
  layout_plan_id UUID,
  qa_report_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'in_progress', 'qa_pending', 'qa_passed', 'approved', 'exported'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_design_briefs_client ON design_briefs(client_id);
CREATE INDEX idx_design_briefs_content ON design_briefs(content_idea_id);

-- ─── Generated Outputs ──────────────────────────────────
CREATE TABLE generated_outputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  design_brief_id UUID NOT NULL REFERENCES design_briefs(id),
  layout_plan_id UUID,
  type VARCHAR(20) NOT NULL CHECK (type IN (
    'preview_image', 'final_image', 'psd_file', 'pdf_document', 'export_package', 'layout_json'
  )),
  name VARCHAR(300) NOT NULL,
  description TEXT,
  file_url TEXT,
  preview_url TEXT,
  thumbnail_url TEXT,
  mime_type VARCHAR(100),
  file_size_bytes BIGINT,
  dimensions JSONB,
  generation_method VARCHAR(20) NOT NULL CHECK (generation_method IN (
    'ai_generated', 'template_based', 'manual', 'photoshop_worker'
  )),
  ai_model VARCHAR(100),
  generation_time_ms INTEGER,
  qa_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  version INTEGER NOT NULL DEFAULT 1,
  parent_output_id UUID REFERENCES generated_outputs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outputs_client ON generated_outputs(client_id);
CREATE INDEX idx_outputs_brief ON generated_outputs(design_brief_id);

-- ─── Revision Feedback ──────────────────────────────────
CREATE TABLE revision_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL,
  entity_id UUID NOT NULL,
  feedback_text TEXT NOT NULL,
  sentiment VARCHAR(20) NOT NULL CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
  categories JSONB DEFAULT '[]',
  extracted_rules JSONB DEFAULT '[]',
  applied_to_dna BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_client ON revision_feedback(client_id);
CREATE INDEX idx_feedback_entity ON revision_feedback(entity_type, entity_id);

-- ─── Audit Logs ──────────────────────────────────────────
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_role VARCHAR(30),
  user_name VARCHAR(200),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  details JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ─── Updated At Trigger ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_brand_profiles_updated BEFORE UPDATE ON brand_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_content_ideas_updated BEFORE UPDATE ON content_ideas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_approvals_updated BEFORE UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_design_briefs_updated BEFORE UPDATE ON design_briefs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_outputs_updated BEFORE UPDATE ON generated_outputs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
