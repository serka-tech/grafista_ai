-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Design DNA Permissions (Phase 2 Step 4)
--
-- The OWNER cross-join in 003_auth.sql (`INSERT INTO role_permissions SELECT
-- r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'OWNER'`)
-- was a one-time snapshot at that migration's time, not a live trigger — new
-- permissions added after 003 do NOT automatically get an OWNER row. Every
-- new permission below therefore gets an explicit INSERT for OWNER too.
-- ═══════════════════════════════════════════════════════════

INSERT INTO permissions (key) VALUES
  ('design_dna:run'),
  ('design_dna:read'),
  ('design_dna:approve'),
  ('design_dna:revise');

-- OWNER: all four (explicit — see note above)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key IN (
  'design_dna:run', 'design_dna:read', 'design_dna:approve', 'design_dna:revise'
);

-- CREATIVE_DIRECTOR: all four
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key IN (
  'design_dna:run', 'design_dna:read', 'design_dna:approve', 'design_dna:revise'
);

-- DESIGNER: read + run (cannot approve/revise its own analysis)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key IN ('design_dna:read', 'design_dna:run');

-- CONTENT_MANAGER: read only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CONTENT_MANAGER' AND p.key IN ('design_dna:read');
