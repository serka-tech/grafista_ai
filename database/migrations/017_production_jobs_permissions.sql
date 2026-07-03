-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Production Jobs Permissions (Phase 2 Step 8A)
--
-- Adds the four permission keys the production-job surface needs: create
-- (send an approved/generated visual to production packaging), read
-- (list/inspect jobs and their packages), approve / reject (human decision
-- on a built package). Naming follows the domain:action convention of
-- 005/007/010/012/015 ('create' matches clients:create / content_ideas:create;
-- 'run' is reserved for AI-execution surfaces like creative_qa/visual_generation).
--
-- Role distribution: OWNER and CREATIVE_DIRECTOR get all four (they own the
-- production gate end to end, mirroring visual_generation approve/reject).
-- DESIGNER gets read ONLY — designers can see production status but cannot
-- initiate or gate production (stricter than visual_generation:run on
-- purpose: sending to production is a pipeline-exit decision, not a creative
-- iteration step). CONTENT_MANAGER gets nothing (matches its creative_qa /
-- visual_generation posture — intentional).
--
-- As with 005/007/010/012/015: the OWNER cross-join in 003_auth.sql was a
-- one-time snapshot at that migration's time, not a live trigger — new
-- permissions added after 003 do NOT automatically get an OWNER row. Every
-- new permission below therefore gets an explicit INSERT for OWNER too.
-- ═══════════════════════════════════════════════════════════

INSERT INTO permissions (key) VALUES
  ('production_jobs:create'),
  ('production_jobs:read'),
  ('production_jobs:approve'),
  ('production_jobs:reject');

-- OWNER: explicit grants for all four new keys
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key IN (
  'production_jobs:create', 'production_jobs:read', 'production_jobs:approve', 'production_jobs:reject'
);

-- CREATIVE_DIRECTOR: all four — owns the production pipeline end to end.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key IN (
  'production_jobs:create', 'production_jobs:read', 'production_jobs:approve', 'production_jobs:reject'
);

-- DESIGNER: read only — can follow production status, cannot initiate or gate it.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key IN ('production_jobs:read');

-- CONTENT_MANAGER: no production_jobs permissions at all (intentional).
