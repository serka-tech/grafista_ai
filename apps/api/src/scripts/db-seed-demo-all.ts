/**
 * Grafista AI Studio — One-command demo bootstrap (Demo-Smoke Phase, Task 4)
 *
 * Idempotent, non-destructive: stands up a full local/offline demo dataset
 * in a single command by composing the EXISTING, already-tested seed steps —
 * it invents no new seeding logic beyond a single demo design_brief row.
 * Safe to re-run against a database that already has some or all of this
 * data; every step checks before it writes.
 *
 *   1. migrate     — runMigrations (../db/migrate.ts), same function the test
 *                     suite's global-setup uses.
 *   2. base seed   — runSeed (../db/seed.ts): the "Flavora Organic" sample
 *                     client, brand profile, brand_assets, and 3
 *                     content_ideas (one APPROVED with an approvals row).
 *                     No-ops if the client already exists.
 *   3. demo refs   — seedDemoReferences (./db-seed-demo.ts): 2 design
 *                     references with real PNG bytes in object storage, so
 *                     DesignDNA analysis works without any real AI keys.
 *   4. demo owner  — ensures ONE OWNER login user exists. Never resets an
 *                     existing user's password.
 *   5. demo brief  — ensures ONE 'approved' design_brief exists on the
 *                     seeded approved content idea, ready for
 *                     POST /api/design-briefs/:id/layout-plans.
 *
 * Run:   pnpm run db:seed-demo-all
 * Env:   ADMIN_EMAIL    (optional — default demo-owner@grafista.local)
 *        ADMIN_PASSWORD (optional — if unset, a random strong password is
 *                         generated and printed ONCE; if the owner already
 *                         exists, ADMIN_PASSWORD is ignored — the existing
 *                         password is never changed)
 */

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { v4 as uuid } from 'uuid';
import { pool, closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { runSeed } from '../db/seed.js';
import { seedDemoReferences } from './db-seed-demo.js';
import { usersRepo } from '../db/repositories/users.js';
import { hashPassword } from '../auth/password.js';
import { contentIdeasRepo } from '../db/repositories/content-ideas.js';
import { designBriefsRepo } from '../db/repositories/design-briefs.js';

/** Fixed id of the "Flavora Organic" sample client — see src/db/seed.ts / database/seed/sample-data.sql. */
const SAMPLE_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const DEFAULT_OWNER_EMAIL = 'demo-owner@grafista.local';

/**
 * Fixed id for the single demo design_brief this script maintains — the
 * idempotency key for check-before-insert (mirrors DEMO_REFERENCES' fixed
 * names in db-seed-demo.ts). Not derived from any other seeded id, so it
 * cannot collide with the sample client/content-idea/approval ids above.
 */
const DEMO_BRIEF_ID = 'd0000000-0000-4000-8000-000000000001';

/**
 * Platform -> pixel dimensions. Copied from
 * ../services/design-brief-creation.ts (createDesignBriefFromContentIdea),
 * which is the tested logic for turning an approved content idea into a
 * design brief via the HTTP route. That function always mints a random id
 * via uuid(), so it can't be reused directly for a FIXED, idempotent demo
 * brief id — this script re-derives the same brief shape by hand instead.
 */
const DIMENSION_MAP: Record<string, { width: number; height: number }> = {
  instagram_post: { width: 1080, height: 1080 },
  instagram_story: { width: 1080, height: 1920 },
  instagram_reel: { width: 1080, height: 1920 },
  instagram_carousel: { width: 1080, height: 1080 },
  facebook_post: { width: 1200, height: 630 },
  twitter_post: { width: 1200, height: 675 },
  linkedin_post: { width: 1200, height: 627 },
  youtube_thumbnail: { width: 1280, height: 720 },
};

export interface SeedDemoAllOptions {
  /** Overrides process.env.ADMIN_EMAIL / the built-in default. */
  ownerEmail?: string;
  /** Overrides process.env.ADMIN_PASSWORD. Must be >=8 chars if provided. */
  ownerPassword?: string;
}

export interface SeedDemoAllSummary {
  referenceResults: string[];
  owner: { email: string; created: boolean; generatedPassword?: string };
  brief: { id: string; created: boolean } | { skipped: true; reason: string };
}

async function ensureDemoOwner(
  opts: SeedDemoAllOptions
): Promise<SeedDemoAllSummary['owner']> {
  const email = (opts.ownerEmail ?? process.env.ADMIN_EMAIL ?? DEFAULT_OWNER_EMAIL).toLowerCase();

  const existing = await usersRepo.findByEmail(email);
  if (existing) {
    console.log(`[seed-demo-all] owner exists — password unchanged (${email})`);
    return { email, created: false };
  }

  let password = opts.ownerPassword ?? process.env.ADMIN_PASSWORD;
  if (password && password.length < 8) {
    throw new Error('[seed-demo-all] ADMIN_PASSWORD must be at least 8 characters.');
  }

  let generatedPassword: string | undefined;
  if (!password) {
    // 24 base64url chars (18 random bytes) — well above the 8-char minimum,
    // no external dependency, no network.
    password = randomBytes(18).toString('base64url');
    generatedPassword = password;
  }

  const passwordHash = await hashPassword(password);
  const user = await usersRepo.create({ id: uuid(), email, passwordHash, name: 'Demo Owner' });
  await usersRepo.assignRole(user.id, 'OWNER');
  console.log(`[seed-demo-all] created OWNER user: ${user.email}`);

  if (generatedPassword) {
    console.log(
      '\n[seed-demo-all] Generated a demo-only password — SAVE THIS NOW, it will not be shown again:\n' +
        `    email:    ${email}\n` +
        `    password: ${generatedPassword}\n` +
        '  (Set ADMIN_PASSWORD yourself next time to choose your own.)\n'
    );
  }

  return { email, created: true, generatedPassword };
}

/**
 * Ensures ONE render-ready ('approved' status — see layout-generation.ts's
 * hard prerequisite and 008_design_brief_status_extension.sql) design_brief
 * exists for the Flavora client, built from the sample data's already-
 * approved content idea and its approval row (looked up dynamically, not
 * hardcoded — only the sample client id is a fixed constant).
 */
async function ensureDemoBrief(): Promise<SeedDemoAllSummary['brief']> {
  const existing = await designBriefsRepo.getById(DEMO_BRIEF_ID);
  if (existing) {
    console.log(`[seed-demo-all] demo design brief ${DEMO_BRIEF_ID} already exists — skipping (idempotent)`);
    return { id: DEMO_BRIEF_ID, created: false };
  }

  const approvedIdeas = await contentIdeasRepo.listApprovedByClient(SAMPLE_CLIENT_ID);
  const idea = approvedIdeas[0];
  if (!idea || !idea.approvalId) {
    const reason =
      'no approved content_idea with an approval row was found for the Flavora sample client ' +
      `(${SAMPLE_CLIENT_ID}) — run the base seed first (pnpm run db:seed), then re-run this script.`;
    console.warn(`[seed-demo-all] skipping demo design brief — ${reason}`);
    return { skipped: true, reason };
  }

  const dims = DIMENSION_MAP[idea.platform] ?? { width: 1080, height: 1080 };

  await designBriefsRepo.create({
    id: DEMO_BRIEF_ID,
    clientId: idea.clientId,
    contentIdeaId: idea.id,
    approvalId: idea.approvalId,
    title: `Demo Brief: ${idea.title}`,
    objective: idea.description,
    platform: idea.platform,
    format: idea.format,
    dimensions: { ...dims, unit: 'px' },
    contentElements: {
      headline: idea.hook ?? idea.title,
      caption: idea.caption,
      callToAction: idea.callToAction,
      hashtags: idea.hashtags,
    },
    visualDirection: {
      mood: idea.toneOfVoice ?? 'professional',
      imageDirection: idea.visualDirection,
    },
    brandConstraints: {
      requiredElements: ['logo'],
    },
    aiImagePrompts: idea.aiImagePrompt ? [{ label: 'Main Image', prompt: idea.aiImagePrompt }] : [],
  });

  // designBriefsRepo.create() always inserts status 'draft' — bump it to
  // 'approved' (the status layout-generation.ts requires) in a second step,
  // same as the demo runbook's own DesignBrief approve call.
  await designBriefsRepo.updateStatus(DEMO_BRIEF_ID, 'approved');

  console.log(`[seed-demo-all] created demo design brief ${DEMO_BRIEF_ID} (status: approved)`);
  return { id: DEMO_BRIEF_ID, created: true };
}

export async function seedDemoAll(opts: SeedDemoAllOptions = {}): Promise<SeedDemoAllSummary> {
  await runMigrations(pool);
  await runSeed(pool);
  const referenceResults = await seedDemoReferences();
  const owner = await ensureDemoOwner(opts);
  const brief = await ensureDemoBrief();

  return { referenceResults, owner, brief };
}

async function main() {
  const summary = await seedDemoAll();

  console.log('\n[seed-demo-all] done.');
  console.log('  references:');
  for (const line of summary.referenceResults) console.log(`    - ${line}`);
  console.log(`  owner: ${summary.owner.email} (${summary.owner.created ? 'created' : 'already existed'})`);
  if ('skipped' in summary.brief) {
    console.log(`  demo design brief: SKIPPED — ${summary.brief.reason}`);
  } else {
    console.log(`  demo design brief: ${summary.brief.id} (${summary.brief.created ? 'created' : 'already existed'})`);
  }
  console.log(
    '\nNext steps: set AI_DEFAULT_PROVIDER=fake in .env (see .env.example DEMO MODE), start the API + ' +
      'dashboard, and log in with the owner credentials above.'
  );

  await closePool();
}

// Only auto-run when this file is executed directly (`tsx db-seed-demo-all.ts`,
// i.e. `pnpm run db:seed-demo-all`) — not when imported for `seedDemoAll` by
// its test, which must not trigger the CLI side effects (process.exit /
// closePool) as an import side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    console.error('[seed-demo-all] FAILED', err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
}
