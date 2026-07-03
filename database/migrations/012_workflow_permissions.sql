-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Workflow Engine Permissions (Phase 2 Step 6)
--
-- Adds the five permission keys the persistent workflow engine needs:
-- read (list/inspect definitions and runs), start (create a run), advance
-- (execute the current step), approve (decide approval gates), cancel
-- (abort a run). The engine ALSO enforces each step's own domain
-- permission at execution time (e.g. advancing the analyze_styles step
-- still requires 'design_dna:run', approving the layout gate still
-- requires 'layout_plans:approve') — these workflow keys gate the engine
-- surface itself, they never bypass the per-domain checks.
--
-- As with 005/007/010: the OWNER cross-join in 003_auth.sql was a one-time
-- snapshot at that migration's time, not a live trigger — new permissions
-- added after 003 do NOT automatically get an OWNER row. Every new
-- permission below therefore gets an explicit INSERT for OWNER too.
-- ═══════════════════════════════════════════════════════════

INSERT INTO permissions (key) VALUES
  ('workflows:read'),
  ('workflows:start'),
  ('workflows:advance'),
  ('workflows:approve'),
  ('workflows:cancel');

-- OWNER: explicit grants for all five new keys
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key IN (
  'workflows:read', 'workflows:start', 'workflows:advance', 'workflows:approve', 'workflows:cancel'
);

-- CREATIVE_DIRECTOR: all five — the role that owns the creative pipeline end to end.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key IN (
  'workflows:read', 'workflows:start', 'workflows:advance', 'workflows:approve', 'workflows:cancel'
);

-- DESIGNER: read + start + advance, no approve/cancel. Safe because the engine
-- additionally enforces per-step domain permissions — a DESIGNER advancing a
-- step still needs that step's own permission (and DESIGNER holds no
-- *:approve keys, so approval gates stay out of reach either way).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key IN (
  'workflows:read', 'workflows:start', 'workflows:advance'
);

-- CONTENT_MANAGER: read only. The flat permission model has no per-workflow
-- scoping, so granting start/advance here would open every workflow's engine
-- surface (not just content ones) — conservative by design.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CONTENT_MANAGER' AND p.key IN ('workflows:read');
