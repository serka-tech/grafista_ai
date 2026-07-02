-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Layout Plans Permissions (Phase 2 Step 5A)
--
-- `layout_plans:create` already exists (added in 003_auth.sql) and is already
-- granted to OWNER (via the one-time cross-join snapshot), CREATIVE_DIRECTOR,
-- and DESIGNER. This migration adds the three permission keys that flow was
-- missing: read / approve / reject.
--
-- As with 005_design_dna_permissions.sql: the OWNER cross-join in 003_auth.sql
-- was a one-time snapshot at that migration's time, not a live trigger — new
-- permissions added after 003 do NOT automatically get an OWNER row. Every new
-- permission below therefore gets an explicit INSERT for OWNER too, even
-- though OWNER already has `layout_plans:create` from the original cross-join.
-- ═══════════════════════════════════════════════════════════

INSERT INTO permissions (key) VALUES
  ('layout_plans:read'),
  ('layout_plans:approve'),
  ('layout_plans:reject');

-- OWNER: explicit grants for the three new keys (create already granted via 003's cross-join)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key IN (
  'layout_plans:read', 'layout_plans:approve', 'layout_plans:reject'
);

-- CREATIVE_DIRECTOR: read + approve + reject (create already granted in 003_auth.sql)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key IN (
  'layout_plans:read', 'layout_plans:approve', 'layout_plans:reject'
);

-- DESIGNER: read only (create already granted in 003_auth.sql) — cannot approve/reject
-- its own generated layouts.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key IN ('layout_plans:read');

-- CONTENT_MANAGER: no layout_plans permissions at all (unchanged, intentional).
