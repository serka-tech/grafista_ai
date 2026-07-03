-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Render Jobs & Export Artifacts (Phase 2 Step 9A)
--
-- Pipeline stage: production_jobs row (package_ready) -> render request ->
-- Template Render Engine (HTML/CSS + Playwright, see apps/api/src/render/) ->
-- one or more exported files (PNG/JPG/PDF) in object storage. This migration
-- is PURELY ADDITIVE — it does not alter generated_outputs, production_jobs,
-- or any other existing table/column. A render_jobs row references its
-- production_jobs row by id only; nothing about production_jobs' own
-- lifecycle (pending -> packaging -> package_ready -> approved | rejected)
-- changes here.
--
-- SNAPSHOTS — manifest_snapshot / template_contract_snapshot copy
-- production_jobs.package_manifest_snapshot / template_contract_snapshot at
-- render-request time, same "snapshot-over-fetch" reasoning already used by
-- production_jobs itself (see 016_production_jobs.sql) and workflow_runs
-- .definition_snapshot: a render must reproduce exactly what it rendered
-- from even if the source production job's package is rebuilt or changes
-- later. Nullable because a render job may in principle be requested before
-- the snapshot copy step runs (mirrors production_jobs' own nullable
-- snapshot columns) — the render service is responsible for populating them.
--
-- requested_format / render_warnings are JSONB for forward-compat, the same
-- convention as every other snapshot/free-shape field in this codebase
-- (package_manifest_snapshot, definition_snapshot, etc):
--   * requested_format shape: { preset, exportFormat, width, height } — see
--     RequestedFormatSchema in packages/schemas/src/render-job.ts.
--   * render_warnings shape: an array of { code, message, layerId? } —
--     font-fallback / unsupported-blendMode / unsupported-filter and similar
--     MVP-limitation warnings raised by the HTML renderer (see
--     apps/api/src/render/html-renderer.ts). Additive by design: a warning
--     recorded here survives long past the render response, so a design QA
--     pass or a future dashboard can review "explainable" render
--     degradations after the fact.
--
-- STATUS MODEL — deliberately mirrors production_jobs' own linear axis: a
-- render is either not started, in flight, finished, failed, or cancelled.
-- There is no approve/reject step for a render itself (approval already
-- happened upstream on the production_jobs row) — 'rendered' is terminal.
--
--   pending -> rendering -> rendered
--                      \-> failed     (error_message set)
--   cancelled                          (manual abort, any pre-terminal state)
--
-- renderer_name / renderer_version record which adapter actually produced
-- the output (e.g. 'playwright' / '<playwright pkg version>', or 'fake' /
-- 'fake-1.0.0' in tests) — same intent as production_jobs.generation_method,
-- letting a future second renderer engine coexist without a schema change.
--
-- export_artifacts is a CHILD of render_jobs (one render job can, in
-- principle, produce more than one exported file — e.g. re-exporting a
-- rendered page at multiple formats without re-rendering — so this is a
-- separate table rather than columns on render_jobs). storage_provider /
-- storage_bucket / storage_key is NOT redundant with a single "url" column —
-- it is the exact same triple used everywhere else a file is stored in this
-- codebase (brand_assets, design_references, generated_outputs,
-- production_jobs.package_storage_*): the provider name is required so
-- getStorageProviderByName() can reconstruct the correct provider for a
-- download even if STORAGE_PROVIDER has since changed (see
-- apps/api/src/storage/factory.ts's header comment for why "currently
-- configured provider" and "provider a file actually lives on" must be able
-- to differ).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE render_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  production_job_id UUID NOT NULL REFERENCES production_jobs(id),
  requested_format JSONB NOT NULL,
  manifest_snapshot JSONB,
  template_contract_snapshot JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'rendering', 'rendered', 'failed', 'cancelled'
  )),
  renderer_name VARCHAR(50),
  renderer_version VARCHAR(50),
  render_warnings JSONB,
  requested_by UUID NOT NULL REFERENCES users(id),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_render_jobs_client ON render_jobs(client_id);
CREATE INDEX idx_render_jobs_production_job ON render_jobs(production_job_id);
CREATE INDEX idx_render_jobs_status ON render_jobs(status);

CREATE TRIGGER trg_render_jobs_updated BEFORE UPDATE ON render_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE export_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  render_job_id UUID NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  format VARCHAR(10) NOT NULL CHECK (format IN ('png', 'jpg', 'pdf')),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  storage_provider VARCHAR(20) NOT NULL,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_export_artifacts_render_job ON export_artifacts(render_job_id);
CREATE INDEX idx_export_artifacts_client ON export_artifacts(client_id);
