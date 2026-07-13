-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Invites + org:manage permission (Packaging Phase A)
-- ═══════════════════════════════════════════════════════════
--
-- Phase A gives an organization real multi-user management. There is no public
-- self-signup (that is Phase B); the only way to add a user is: an OWNER (or
-- any holder of the new org:manage permission) creates an invite, and the
-- invitee accepts it with a one-time token to set their password.
--
-- The invites table mirrors the sessions table's token pattern
-- (003_auth.sql:49) exactly — an opaque token is generated with the SAME
-- crypto helpers (auth/session-token.ts generateSessionToken/hashSessionToken)
-- and only its HMAC-SHA256 hash is stored, never the raw token. accepted_at
-- makes an invite single-use; expires_at bounds its lifetime.
--
-- role is validated at the application layer against the fixed ROLES catalog
-- (003_auth.sql seeds OWNER/CREATIVE_DIRECTOR/DESIGNER/CONTENT_MANAGER); it is
-- stored as text here to avoid a second source of truth.
--
-- As with 005/007/010/012/015/017/020/023: the OWNER cross-join in 003_auth.sql
-- was a one-time snapshot, not a live trigger — the new org:manage permission
-- needs its own explicit OWNER grant. Only OWNER manages the org/team, matching
-- the settings:manage posture (003_auth.sql: OWNER-only).

CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(50) NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE INDEX idx_invites_token_hash ON invites(token_hash);
CREATE INDEX idx_invites_org ON invites(organization_id);

-- ─── org:manage permission (OWNER only) ──
INSERT INTO permissions (key) VALUES ('org:manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'OWNER' AND p.key = 'org:manage';
