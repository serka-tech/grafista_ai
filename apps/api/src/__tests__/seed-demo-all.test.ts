import { describe, it, expect } from 'vitest';
import { pool } from '../db/pool.js';
import { seedDemoAll } from '../scripts/db-seed-demo-all.js';

/**
 * Demo-Smoke Phase, Task 4 — the one-command demo bootstrap.
 *
 * Runs against the SHARED embedded test database (already migrated + base-
 * seeded + one user per role, via global-setup.ts) — so this must tolerate
 * pre-existing data rather than assuming a clean slate. Uses a distinct
 * owner email (not any of TEST_USERS) so it never collides with fixtures
 * other test files rely on, and passes ownerPassword via opts (not
 * process.env.ADMIN_PASSWORD) so nothing here mutates global process state
 * for other test files sharing this worker.
 */

const DEMO_OWNER_EMAIL = 'seed-demo-all-owner@grafista.local';
const DEMO_OWNER_PASSWORD = 'DemoSmokeTest123!';
const DEMO_BRIEF_ID = 'd0000000-0000-4000-8000-000000000001';

async function countDemoBriefs(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM design_briefs WHERE id = $1', [DEMO_BRIEF_ID]);
  return rows[0].count as number;
}

async function countOwnerUsers(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE email = $1', [
    DEMO_OWNER_EMAIL.toLowerCase(),
  ]);
  return rows[0].count as number;
}

describe('seedDemoAll — one-command demo bootstrap', () => {
  it('runs end to end and is idempotent on a second run (no duplicate owner/brief)', async () => {
    const firstSummary = await seedDemoAll({ ownerEmail: DEMO_OWNER_EMAIL, ownerPassword: DEMO_OWNER_PASSWORD });

    expect(firstSummary.owner.email).toBe(DEMO_OWNER_EMAIL.toLowerCase());
    expect(firstSummary.owner.created).toBe(true);
    // ADMIN_PASSWORD-equivalent was supplied via opts, so no random password
    // branch was taken.
    expect(firstSummary.owner.generatedPassword).toBeUndefined();
    expect(Array.isArray(firstSummary.referenceResults)).toBe(true);
    expect(firstSummary.referenceResults.length).toBe(2);

    const briefCountAfterFirst = await countDemoBriefs();
    const ownerCountAfterFirst = await countOwnerUsers();
    expect(ownerCountAfterFirst).toBe(1);

    // Second run: must not throw and must not duplicate anything.
    const secondSummary = await seedDemoAll({ ownerEmail: DEMO_OWNER_EMAIL, ownerPassword: DEMO_OWNER_PASSWORD });

    expect(secondSummary.owner.created).toBe(false);
    expect(secondSummary.owner.generatedPassword).toBeUndefined();

    const briefCountAfterSecond = await countDemoBriefs();
    const ownerCountAfterSecond = await countOwnerUsers();

    expect(ownerCountAfterSecond).toBe(ownerCountAfterFirst);
    expect(briefCountAfterSecond).toBe(briefCountAfterFirst);
  }, 60_000);

  it('creates the demo owner user with the OWNER role', async () => {
    const { rows } = await pool.query(
      `SELECT r.name FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.email = $1`,
      [DEMO_OWNER_EMAIL.toLowerCase()]
    );
    const roleNames = rows.map((r) => r.name as string);
    expect(roleNames).toContain('OWNER');
  });

  it('creates exactly one demo design_brief with the fixed id, status approved', async () => {
    const { rows } = await pool.query('SELECT id, status FROM design_briefs WHERE id = $1', [DEMO_BRIEF_ID]);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('approved');

    const count = await countDemoBriefs();
    expect(count).toBe(1);
  });
});
