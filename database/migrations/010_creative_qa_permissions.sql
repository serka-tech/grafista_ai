-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Creative QA Permissions (Phase 2 Step 5B)
--
-- `creative_qa:run` already exists (added in 003_auth.sql) and is already
-- granted to OWNER (via the one-time cross-join snapshot), CREATIVE_DIRECTOR,
-- and DESIGNER. This migration adds the three permission keys that flow was
-- missing: read / approve / reject.
--
-- As with 007_layout_plans_permissions.sql: the OWNER cross-join in
-- 003_auth.sql was a one-time snapshot at that migration's time, not a live
-- trigger — new permissions added after 003 do NOT automatically get an
-- OWNER row. Every new permission below therefore gets an explicit INSERT
-- for OWNER too, even though OWNER already has `creative_qa:run` from the
-- original cross-join.
-- ═══════════════════════════════════════════════════════════

INSERT INTO permissions (key) VALUES
  ('creative_qa:read'),
  ('creative_qa:approve'),
  ('creative_qa:reject');

-- OWNER: explicit grants for the three new keys (run already granted via 003's cross-join)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key IN (
  'creative_qa:read', 'creative_qa:approve', 'creative_qa:reject'
);

-- CREATIVE_DIRECTOR: read + approve + reject (run already granted in 003_auth.sql)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key IN (
  'creative_qa:read', 'creative_qa:approve', 'creative_qa:reject'
);

-- DESIGNER: read only (run already granted in 003_auth.sql) — cannot approve/reject
-- QA reports on its own generated layouts.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key IN ('creative_qa:read');

-- CONTENT_MANAGER: no creative_qa permissions at all (unchanged, intentional).
