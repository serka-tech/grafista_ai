/**
 * Grafista AI Studio — Tenant constants (Packaging Phase A: multi-tenancy foundation)
 *
 * A single fixed, deterministic organization id for the founding tenant
 * ("Grafista Ajans"). It is referenced in THREE places that must agree
 * byte-for-byte:
 *   - the DEFAULT on clients.organization_id / users.organization_id
 *     (database/migrations/027_organizations.sql)
 *   - the seeded organizations row (same migration)
 *   - the seed-admin script and test setup, so freshly seeded users/clients
 *     land in the same tenant as everything that already existed before the
 *     migration ran.
 *
 * Why a hard-coded constant (mirrors db/seed.ts's SAMPLE_CLIENT_ID convention):
 * the migration must place the founding org row BEFORE it can be used as a
 * column DEFAULT, and application code that backfills/seeds must target the
 * exact same row — a generated id could not be shared across the SQL file and
 * the TypeScript layer.
 *
 * This is Phase A only. When public self-signup arrives (Phase B), new orgs
 * get generated ids via organizationsRepo.create(); this constant stays as the
 * identity of the original agency tenant.
 */
export const GRAFISTA_ORG_ID = '00000000-0000-0000-0000-000000000001';
