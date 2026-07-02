-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Design Brief Status Extension (Phase 2 Step 5A)
--
-- Layout generation (see apps/api/src/services/layout-generation.ts) requires an
-- *approved* DesignBrief as a hard prerequisite, but until now there was no route
-- anywhere in the codebase that could ever move design_briefs.status out of 'draft'
-- (design_briefs:approve has existed as a permission key since 003_auth.sql, but was
-- never wired to a route). This migration only widens the status CHECK constraint so
-- the new POST /api/design-briefs/:id/approve and /reject routes have somewhere to
-- land — 'approved' already existed, 'rejected' and 'needs_revision' are new. Nothing
-- else about design_briefs changes.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE design_briefs DROP CONSTRAINT design_briefs_status_check;

ALTER TABLE design_briefs ADD CONSTRAINT design_briefs_status_check CHECK (status IN (
  'draft', 'in_progress', 'qa_pending', 'qa_passed', 'approved', 'exported',
  'rejected', 'needs_revision'
));
