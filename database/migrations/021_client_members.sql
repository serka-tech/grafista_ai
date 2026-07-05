-- ═══════════════════════════════════════════════════════════
-- Grafista AI Studio — Client Membership (Phase 3 Step 4: client isolation
-- hardening)
-- ═══════════════════════════════════════════════════════════
--
-- Before this migration, authorization was PURELY role/permission based
-- (users.roles/permissions are global — see 003_auth.sql) with NO concept of
-- "which clients can this user touch" (documented explicitly as a deliberate
-- convention in routes/production-jobs.ts and routes/render-jobs.ts). Any
-- authenticated user holding the right global permission could read or act
-- on ANY client's data.
--
-- client_members is a minimal, ADDITIVE, OPT-IN scoping table:
--   - A user with ZERO rows here is UNRESTRICTED across every client — this
--     preserves today's behavior EXACTLY for every existing/seeded/demo user
--     (none of them get a row by default), so nothing already deployed
--     silently loses access.
--   - A user with ONE OR MORE rows here is restricted to only those clients.
--
-- This is deliberately NOT a tenant/organization redesign: no billing, no
-- tenant table, no change to roles/permissions. It only adds the mechanism
-- an operator can use to scope a specific user to specific clients, and the
-- application-level guard (see apps/api/src/auth/client-access.ts) that
-- enforces it at the service/repository layer, not just at routes.
CREATE TABLE client_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX idx_client_members_user ON client_members(user_id);
CREATE INDEX idx_client_members_client ON client_members(client_id);
