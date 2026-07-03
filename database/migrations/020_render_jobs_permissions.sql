-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Render Jobs Permissions (Phase 2 Step 9A)
--
-- Adds the four permission keys the render/export surface needs: create
-- (request a render of a package_ready production job), read (list/inspect
-- render jobs and their export artifacts), cancel (abort a pending/rendering
-- job), and export_artifacts:read (download a rendered file). Naming follows
-- the domain:action convention of 005/007/010/012/015/017
-- ('create'/'read' match production_jobs:create/:read; 'cancel' is new to
-- this surface since production_jobs has no cancel permission of its own —
-- render jobs are ephemeral, retryable work rather than a pipeline gate).
--
-- Role distribution: OWNER and CREATIVE_DIRECTOR get all four (same
-- end-to-end ownership pattern as production_jobs:*). DESIGNER gets
-- render_jobs:create, render_jobs:read and export_artifacts:read — designers
-- may request/inspect/download renders of already-approved packages, but
-- render_jobs:cancel is withheld on purpose (aborting an in-flight render is
-- reserved for the roles that also own production approval, mirroring the
-- production_jobs:approve/:reject split). CONTENT_MANAGER gets nothing
-- (matches its production_jobs / creative_qa / visual_generation posture —
-- intentional, see 017_production_jobs_permissions.sql).
--
-- As with 005/007/010/012/015/017: the OWNER cross-join in 003_auth.sql was
-- a one-time snapshot at that migration's time, not a live trigger — new
-- permissions added after 003 do NOT automatically get an OWNER row. Every
-- new permission below therefore gets an explicit INSERT for OWNER too.
-- ═══════════════════════════════════════════════════════════

INSERT INTO permissions (key) VALUES
  ('render_jobs:create'),
  ('render_jobs:read'),
  ('render_jobs:cancel'),
  ('export_artifacts:read');

-- OWNER: explicit grants for all four new keys
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key IN (
  'render_jobs:create', 'render_jobs:read', 'render_jobs:cancel', 'export_artifacts:read'
);

-- CREATIVE_DIRECTOR: all four — owns the render/export pipeline end to end.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key IN (
  'render_jobs:create', 'render_jobs:read', 'render_jobs:cancel', 'export_artifacts:read'
);

-- DESIGNER: can request renders, read jobs and download artifacts — cannot cancel.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key IN (
  'render_jobs:create', 'render_jobs:read', 'export_artifacts:read'
);

-- CONTENT_MANAGER: no render_jobs/export_artifacts permissions at all (intentional).
