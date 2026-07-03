-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Production Jobs review audit trail (Phase 2 Step 8B)
--
-- 016_production_jobs.sql gave approve() a full audit trail (approved_by /
-- approved_at) but reject() none at all — a rejected job recorded only the
-- status flip, with no record of who rejected it, when, or why. This
-- migration brings reject to parity with approve and adds the reason field
-- the human reviewer needs to leave for whoever picks up a retry:
--
--   * rejected_by      — mirrors approved_by (same ON DELETE SET NULL: losing
--     the user account must not block deleting/anonymizing it, and must not
--     retroactively invalidate the historical decision).
--   * rejected_at      — mirrors approved_at.
--   * rejection_reason — free-text explanation (there is no revision_requested
--     state for production jobs, so this is the only place the reason a
--     package was sent back is captured — see productionJobsRepo.reject()).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS), matching 014_visual_generation_
-- extension.sql's convention for additive, safely-rerunnable column changes.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
