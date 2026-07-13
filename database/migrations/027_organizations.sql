-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Organizations (Packaging Phase A: multi-tenancy
-- foundation)
-- ═══════════════════════════════════════════════════════════
--
-- Until now there was NO tenant/organization layer. Isolation ran on two
-- orthogonal axes only: (1) global roles/permissions (003_auth.sql — no
-- tenant concept), and (2) opt-in client_members (021 — a user with zero
-- rows is UNRESTRICTED). That is a single-team model: a second customer's
-- data would not be isolated from the first.
--
-- This migration introduces the top-level tenant boundary. It is deliberately
-- ADDITIVE and SAFE on the live production database (Turyap client + the OWNER
-- admin already exist there):
--
--   * The founding org "Grafista Ajans" is inserted with a FIXED, deterministic
--     id (see apps/api/src/config/tenant.ts — GRAFISTA_ORG_ID) BEFORE it is
--     referenced as a column DEFAULT.
--   * clients.organization_id / users.organization_id are added as
--     NOT NULL DEFAULT '<GRAFISTA_ORG_ID>'. On Postgres 11+ a NOT NULL column
--     with a constant DEFAULT is a metadata-only change (no table rewrite), and
--     every existing row (all current clients + users) is backfilled to the
--     founding org automatically — so nobody loses access: the org check added
--     in auth/client-access.ts is trivially true for same-org users, and
--     client_members scoping keeps its exact prior semantics.
--   * The DEFAULT also makes deploy ordering irrelevant (expand/contract):
--     old code that INSERTs a user/client without naming an org still gets the
--     founding org instead of failing. Removing the DEFAULT is a Phase B step
--     (once public self-signup exists and every writer names its org).
--
-- ON DELETE RESTRICT (not CASCADE): there is no org-deletion tool in Phase A;
-- RESTRICT makes it impossible to wipe a whole tenant's client data by
-- accidentally removing its org row. An org-deletion flow is Phase B.
--
-- The whole file runs as a single implicit transaction (the migration runner
-- executes each .sql file with one pool.query — see apps/api/src/db/migrate.ts),
-- so it is atomic: a failure rolls everything back and is not recorded as
-- applied. Re-running is a no-op (ON CONFLICT DO NOTHING + the runner's
-- schema_migrations guard).

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Founding tenant (must exist before it is used as a DEFAULT) ──
INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Grafista Ajans', 'grafista-ajans')
ON CONFLICT (id) DO NOTHING;

-- ─── Tenant column on clients + users (NOT NULL DEFAULT backfills existing rows) ──
ALTER TABLE clients ADD COLUMN organization_id UUID NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000001'
  REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE users ADD COLUMN organization_id UUID NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000001'
  REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE INDEX idx_clients_org ON clients(organization_id);
CREATE INDEX idx_users_org ON users(organization_id);
