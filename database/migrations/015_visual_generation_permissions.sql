-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Visual Generation Permissions (Phase 2 Step 7)
--
-- Adds the four permission keys the visual-generation surface needs:
-- run (trigger generation for a QA-cleared layout plan), read (list/inspect
-- generated outputs), approve / reject (human decision on a generated
-- visual). Role distribution mirrors creative_qa exactly (003_auth.sql +
-- 010_creative_qa_permissions.sql): run follows creative_qa:run
-- (OWNER/CREATIVE_DIRECTOR/DESIGNER), read follows creative_qa:read,
-- approve/reject stay with OWNER/CREATIVE_DIRECTOR only.
--
-- As with 005/007/010/012: the OWNER cross-join in 003_auth.sql was a
-- one-time snapshot at that migration's time, not a live trigger — new
-- permissions added after 003 do NOT automatically get an OWNER row. Every
-- new permission below therefore gets an explicit INSERT for OWNER too.
-- ═══════════════════════════════════════════════════════════

INSERT INTO permissions (key) VALUES
  ('visual_generation:run'),
  ('visual_generation:read'),
  ('visual_generation:approve'),
  ('visual_generation:reject');

-- OWNER: explicit grants for all four new keys
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key IN (
  'visual_generation:run', 'visual_generation:read', 'visual_generation:approve', 'visual_generation:reject'
);

-- CREATIVE_DIRECTOR: all four — owns the creative pipeline end to end
-- (same distribution as creative_qa run/read/approve/reject).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'CREATIVE_DIRECTOR' AND p.key IN (
  'visual_generation:run', 'visual_generation:read', 'visual_generation:approve', 'visual_generation:reject'
);

-- DESIGNER: run + read (mirrors creative_qa: run from 003, read from 010) —
-- cannot approve/reject visuals generated from its own layouts.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'DESIGNER' AND p.key IN ('visual_generation:run', 'visual_generation:read');

-- CONTENT_MANAGER: no visual_generation permissions at all (matches its
-- creative_qa posture — intentional).
