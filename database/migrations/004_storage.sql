-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — S3-Compatible Object Storage (Phase 2 Step 3)
--
-- Adds the metadata columns needed to track where an uploaded file's bytes
-- actually live (local disk vs. S3-compatible bucket) and who uploaded it.
-- The asset-type distinction (brand asset vs. design reference) is already
-- expressed by which table the row lives in — no new column needed for that.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE brand_assets
  ADD COLUMN original_filename VARCHAR(300),
  ADD COLUMN storage_provider VARCHAR(10) CHECK (storage_provider IN ('s3', 'local')),
  ADD COLUMN storage_key TEXT,
  ADD COLUMN storage_bucket VARCHAR(200),
  ADD COLUMN uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE design_references
  ADD COLUMN original_filename VARCHAR(300),
  ADD COLUMN storage_provider VARCHAR(10) CHECK (storage_provider IN ('s3', 'local')),
  ADD COLUMN storage_key TEXT,
  ADD COLUMN storage_bucket VARCHAR(200),
  ADD COLUMN uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_brand_assets_uploaded_by ON brand_assets(uploaded_by);
CREATE INDEX idx_design_refs_uploaded_by ON design_references(uploaded_by);
