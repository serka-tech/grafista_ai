# Packaging Phase A — Final State (Tenant Foundation + Multi-User + Isolation)

Branch: `packaging/phase-a-tenancy` → merged fast-forward into `go-live/m2-hardening`
(commit `a6e1e3c`). **DEPLOYED and live-verified on staging AND production (2026-07-13)** —
see "Deploy record" below.
Plan: `~/.claude/plans/soft-dazzling-flurry.md`.

## What this phase delivered

Before Phase A the codebase had **no tenant/organization layer**: isolation ran on
global roles + opt-in `client_members` (0 rows = unrestricted). A second customer's data
would not have been isolated. Phase A adds the tenant boundary **now** (cheap with one
tenant; expensive to retrofit later across 18 client-scoped tables) so the long-term
resale motion is "open a new org", not a rewrite. Billing, white-label, and public
self-signup are **out of scope (Phase B)** but the schema is shaped to enable them.

Business model locked in: **now** = the Grafista agency's own multi-user workspace
(one org "Grafista Ajans", team users, agency clients); **later** = the same SaaS sells a
single-tenant account to an external customer as a new org.

## Schema (2 additive migrations, apply manually staging→prod)

- **`027_organizations.sql`** — `organizations` table; founding org "Grafista Ajans"
  seeded with the fixed id `GRAFISTA_ORG_ID` (`apps/api/src/config/tenant.ts`);
  `clients.organization_id` + `users.organization_id` added as
  `NOT NULL DEFAULT '<GRAFISTA_ORG_ID>' REFERENCES organizations(id) ON DELETE RESTRICT`.
  `NOT NULL DEFAULT` = metadata-only on PG 11+, and it **backfills every existing row**
  into the founding org — so nobody loses access and deploy ordering is irrelevant
  (expand/contract). Removing the DEFAULT is Phase B (once every writer names its org).
- **`028_invites_and_org_permission.sql`** — `invites` table (mirrors the `sessions`
  token pattern; only the HMAC token hash is stored) + new `org:manage` permission granted
  to OWNER only.

## Backend

- **`auth/client-access.ts` `assertClientAccessible(userId, clientId)`** — signature
  unchanged (all ~26 existing call sites become tenant-aware for free). Now two layers:
  (1) HARD org boundary (user.org must equal client.org, else 404), then (2) the unchanged
  SOFT intra-org `client_members` scoping.
- **Isolation gaps closed** — list endpoints filtered by org (`clients`, `workflow-runs`,
  `approvals`, `design-briefs`); per-record `assertClientAccessible` added to previously
  unguarded nested routes (`brand-assets`, `design-references`, `content-ideas`,
  `clients` GET/PUT `:id`, `workflows/engine.ts startWorkflowRun`). `clients.create` and
  `users.create` now land rows in the caller's org.
- **Org/team management** — new `routes/org.ts` (`/api/org`, all `requirePermission('org:manage')`,
  always operate on `req.user.organizationId`): list users, create invite (returns the
  accept link; **no email send** — Phase B), set role, enable/disable, assign/unassign
  clients. New `invitesRepo`, `organizationsRepo`; `usersRepo` gained `listByOrg`,
  `replaceRole`, `updateStatus`, `getById`; `clientMembersRepo` gained `removeMember`.
- **Invite acceptance** — `POST /api/auth/accept-invite` (the ONLY user-creation path; no
  public signup): validates a one-time token, creates the user in the inviter's org with
  the invited role, consumes the invite, logs them in. Self-role/self-disable are blocked
  to prevent lockout.

## Dashboard

- `lib/api.ts` org methods; new OWNER-only **Ekip** page (`app/settings/team/page.tsx`):
  invite form (shows a copyable accept link), user roster with role change / enable-disable /
  per-user client assignment (empty = sees all org clients). New standalone
  `app/accept-invite/page.tsx`; `middleware.ts` exempts `/accept-invite`; sidebar shows
  "Ekip" only for OWNER.

## Verification (all green)

- Full API suite **493 passed** (`vitest --maxWorkers=2`); new `__tests__/org-isolation.test.ts`
  (12 tests) proves two orgs cannot see each other's clients (list + by-id + brief/approval
  lists + org roster) and the invite→accept flow; existing `client-isolation.test.ts`
  (7 tests) passes **unchanged** (back-compat proof — same-org users only exercise
  `client_members`). Typecheck + lint + build (api + dashboard) all green.
- **Live run against a fresh standalone Postgres** (Docker) — the exact prod go-live path:
  migrations 027/028 applied clean, backfill verified (`users_no_org = 0`, one
  "Grafista Ajans" org, admin in the founding org). Real HTTP smoke (login → org roster →
  invite → accept → roster updated → DESIGNER gets 403 on org:manage → token reuse 400).
  Browser-driven UI check: Ekip page, invite-link display, accept-invite page all render.

## Deploy record (DONE — 2026-07-13)

Deployed to **staging then production**, both live-verified.

- **Staging:** both services retargeted to `packaging/phase-a-tenancy`; migrations 026/027/028
  applied via Render Shell (`node dist/scripts/db-migrate.js`; staging was behind at 025).
  Full HTTP smoke passed (login → org roster → invite → accept → invitee client scope →
  token reuse 400 → DESIGNER 403). Dashboard `/accept-invite` 200, `/settings/team` gated.
- **Production:** `packaging/phase-a-tenancy` fast-forward merged into `go-live/m2-hardening`
  (`a793975..a6e1e3c`) → prod auto-deploy. Full smoke passed: the real admin
  (`sercanbingol023@gmail.com`) and all existing clients (Turyap Sistem, Yenişehir Merkez
  Koleji, Prime Proje, Play & Bite) backfilled cleanly into the founding org; invite→accept,
  isolation, and RBAC all verified. All throwaway smoke users deleted (login 401 after).
- **Backfill:** `organization_id` is `NOT NULL DEFAULT`, so a clean migration mathematically
  guarantees zero NULLs; verified functionally via the org-scoped client list on both envs.
- **Operational finding (fixed):** neither prod nor staging had a Pre-Deploy Command set
  (docs implied prod did), so migrations did NOT auto-run — new code briefly ran ahead of the
  027/028 columns on prod until the migration was run manually. Permanently fixed by setting
  **Pre-Deploy Command = `node dist/scripts/db-migrate.js`** on both API services (verified live
  in the prod deploy log). Future deploys now migrate automatically and fail the deploy if a
  migration fails.
- **First real use (2026-07-13):** first genuine team member invited via the prod Ekip screen
  and accepted — `grafistaajans33@gmail.com` (DESIGNER), now active in the founding org.

Rollback (unchanged): columns are additive and old code never references `organization_id` →
redeploy the prior API image, DB stays.

## Out of scope — Phase B

Billing/subscription/quota · white-label (per-org theme/logo) · public self-signup ·
"new org" provisioning UI + org-deletion · org_id denormalization onto 18 child tables +
RLS · dropping the column DEFAULT · invite email (SMTP) · cross-org super-admin.
