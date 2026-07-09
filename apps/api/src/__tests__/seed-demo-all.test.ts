import { describe, it, expect } from 'vitest';
import { pool } from '../db/pool.js';
import { seedDemoAll } from '../scripts/db-seed-demo-all.js';
import { getStorageProviderByName } from '../storage/factory.js';
import type { StorageProviderName } from '../storage/types.js';

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
// Render-output chain fixed ids — see db-seed-demo-all.ts's own constants
// (kept as separate literals here, same as DEMO_BRIEF_ID above, rather than
// imported, so this test file stays a plain black-box consumer of
// seedDemoAll()'s public contract).
const DEMO_LAYOUT_PLAN_ID = 'd0000000-0000-4000-8000-000000000002';
const DEMO_VISUAL_OUTPUT_ID = 'd0000000-0000-4000-8000-000000000003';
const DEMO_PRODUCTION_JOB_ID = 'd0000000-0000-4000-8000-000000000004';
const DEMO_RENDER_JOB_ID = 'd0000000-0000-4000-8000-000000000005';
const DEMO_RENDER_ARTIFACT_ID = 'd0000000-0000-4000-8000-000000000006';

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

async function countDemoRenderJobs(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM render_jobs WHERE id = $1', [
    DEMO_RENDER_JOB_ID,
  ]);
  return rows[0].count as number;
}

async function countDemoRenderArtifacts(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM export_artifacts WHERE id = $1', [
    DEMO_RENDER_ARTIFACT_ID,
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

    // The render-output chain (layout_plan -> visual output -> production_job
    // -> render_job -> export artifact) must exist after the very first run,
    // reported with its fixed ids — not skipped.
    if ('skipped' in firstSummary.renderOutput) {
      throw new Error(`renderOutput unexpectedly skipped: ${firstSummary.renderOutput.reason}`);
    }
    expect(firstSummary.renderOutput.layoutPlanId).toBe(DEMO_LAYOUT_PLAN_ID);
    expect(firstSummary.renderOutput.renderJobId).toBe(DEMO_RENDER_JOB_ID);
    expect(firstSummary.renderOutput.results.length).toBe(5);

    const renderJobCountAfterFirst = await countDemoRenderJobs();
    const artifactCountAfterFirst = await countDemoRenderArtifacts();
    expect(renderJobCountAfterFirst).toBe(1);
    expect(artifactCountAfterFirst).toBe(1);

    // Second run: must not throw and must not duplicate anything.
    const secondSummary = await seedDemoAll({ ownerEmail: DEMO_OWNER_EMAIL, ownerPassword: DEMO_OWNER_PASSWORD });

    expect(secondSummary.owner.created).toBe(false);
    expect(secondSummary.owner.generatedPassword).toBeUndefined();

    const briefCountAfterSecond = await countDemoBriefs();
    const ownerCountAfterSecond = await countOwnerUsers();

    expect(ownerCountAfterSecond).toBe(ownerCountAfterFirst);
    expect(briefCountAfterSecond).toBe(briefCountAfterFirst);

    // Idempotent: the second run must report the SAME fixed ids and must not
    // duplicate the layout plan / visual output / production job / render
    // job / export artifact rows.
    if ('skipped' in secondSummary.renderOutput) {
      throw new Error(`renderOutput unexpectedly skipped on second run: ${secondSummary.renderOutput.reason}`);
    }
    expect(secondSummary.renderOutput.layoutPlanId).toBe(DEMO_LAYOUT_PLAN_ID);
    expect(secondSummary.renderOutput.renderJobId).toBe(DEMO_RENDER_JOB_ID);

    const renderJobCountAfterSecond = await countDemoRenderJobs();
    const artifactCountAfterSecond = await countDemoRenderArtifacts();
    expect(renderJobCountAfterSecond).toBe(renderJobCountAfterFirst);
    expect(artifactCountAfterSecond).toBe(artifactCountAfterFirst);
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

  it('creates exactly one demo render_job with the fixed id, status rendered, with its artifact file present', async () => {
    const { rows: layoutRows } = await pool.query('SELECT id, status FROM layout_plans WHERE id = $1', [
      DEMO_LAYOUT_PLAN_ID,
    ]);
    expect(layoutRows.length).toBe(1);
    expect(layoutRows[0].status).toBe('approved');

    const { rows: outputRows } = await pool.query('SELECT id, status FROM generated_outputs WHERE id = $1', [
      DEMO_VISUAL_OUTPUT_ID,
    ]);
    expect(outputRows.length).toBe(1);
    expect(outputRows[0].status).toBe('generated');

    const { rows: productionRows } = await pool.query('SELECT id, status FROM production_jobs WHERE id = $1', [
      DEMO_PRODUCTION_JOB_ID,
    ]);
    expect(productionRows.length).toBe(1);
    expect(productionRows[0].status).toBe('package_ready');

    const { rows: renderRows } = await pool.query(
      `SELECT id, status, production_job_id, queued_at, locked_by, started_at, attempt_count
       FROM render_jobs WHERE id = $1`,
      [DEMO_RENDER_JOB_ID]
    );
    expect(renderRows.length).toBe(1);
    expect(renderRows[0].status).toBe('rendered');
    expect(renderRows[0].production_job_id).toBe(DEMO_PRODUCTION_JOB_ID);
    // Never enqueued/claimed — this row was moved 'pending' -> 'rendered'
    // directly, so every queue/worker-only column must be untouched.
    expect(renderRows[0].queued_at).toBeNull();
    expect(renderRows[0].locked_by).toBeNull();
    expect(renderRows[0].started_at).toBeNull();
    expect(Number(renderRows[0].attempt_count)).toBe(0);

    const renderJobCount = await countDemoRenderJobs();
    expect(renderJobCount).toBe(1);

    const { rows: artifactRows } = await pool.query(
      `SELECT id, render_job_id, format, width, height, size_bytes, storage_provider, storage_key
       FROM export_artifacts WHERE id = $1`,
      [DEMO_RENDER_ARTIFACT_ID]
    );
    expect(artifactRows.length).toBe(1);
    const artifact = artifactRows[0];
    expect(artifact.render_job_id).toBe(DEMO_RENDER_JOB_ID);
    expect(artifact.format).toBe('png');
    expect(Number(artifact.width)).toBeGreaterThan(0);
    expect(Number(artifact.height)).toBeGreaterThan(0);
    expect(Number(artifact.size_bytes)).toBeGreaterThan(0);

    // The artifact's file must actually be present in object storage (not
    // just a DB row) and its real byte length must match the recorded
    // size_bytes — a genuine PNG, not a fabricated label.
    const provider = getStorageProviderByName(artifact.storage_provider as StorageProviderName);
    const body = await provider.getObjectBuffer({ key: artifact.storage_key as string });
    expect(body.length).toBe(Number(artifact.size_bytes));
    // PNG magic bytes.
    expect(body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    const artifactCount = await countDemoRenderArtifacts();
    expect(artifactCount).toBe(1);
  });
});
