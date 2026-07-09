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
 *   6. demo render — ensures ONE full render-output chain exists below the
 *                     demo brief (approved layout_plan -> generated visual
 *                     output -> package_ready production_job -> a render_job
 *                     already in status 'rendered', with a real stored PNG
 *                     export artifact) so the dashboard's /outputs Product
 *                     Gallery shows at least one real card + working
 *                     Download button on a freshly bootstrapped database.
 *                     Hand-authored placeholder content, NOT run through the
 *                     real AI/render pipeline — see ensureDemoRenderOutput().
 *
 * Run:   pnpm run db:seed-demo-all
 * Env:   ADMIN_EMAIL    (optional — default demo-owner@grafista.local)
 *        ADMIN_PASSWORD (optional — if unset, a random strong password is
 *                         generated and printed ONCE; if the owner already
 *                         exists, ADMIN_PASSWORD is ignored — the existing
 *                         password is never changed)
 */

import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { v4 as uuid } from 'uuid';
import { pool, closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { runSeed } from '../db/seed.js';
import { seedDemoReferences } from './db-seed-demo.js';
import { usersRepo } from '../db/repositories/users.js';
import { hashPassword } from '../auth/password.js';
import { contentIdeasRepo } from '../db/repositories/content-ideas.js';
import { designBriefsRepo, type DesignBrief } from '../db/repositories/design-briefs.js';
import { layoutPlansRepo } from '../db/repositories/layout-plans.js';
import { generatedOutputsRepo } from '../db/repositories/generated-outputs.js';
import { productionJobsRepo } from '../db/repositories/production-jobs.js';
import { renderJobsRepo } from '../db/repositories/render-jobs.js';
import { exportArtifactsRepo } from '../db/repositories/export-artifacts.js';
import { getStorageProvider, getStorageProviderByName } from '../storage/factory.js';
import type { StorageProviderName } from '../storage/types.js';
import type { LayoutPlan, LayoutPlanContent, RenderJob } from '@grafista/schemas';

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
 * Fixed ids for the single demo render-output chain this script maintains,
 * seeded BELOW the demo brief so the dashboard's /outputs Product Gallery has
 * at least one real card on a freshly bootstrapped database. Same v4-shaped
 * UUID literal convention as DEMO_BRIEF_ID above, each distinct so none of the
 * check-before-insert lookups below can ever collide with one another or
 * with DEMO_BRIEF_ID.
 */
const DEMO_LAYOUT_PLAN_ID = 'd0000000-0000-4000-8000-000000000002';
const DEMO_VISUAL_OUTPUT_ID = 'd0000000-0000-4000-8000-000000000003';
const DEMO_PRODUCTION_JOB_ID = 'd0000000-0000-4000-8000-000000000004';
const DEMO_RENDER_JOB_ID = 'd0000000-0000-4000-8000-000000000005';
const DEMO_RENDER_ARTIFACT_ID = 'd0000000-0000-4000-8000-000000000006';

/**
 * Fixed pixel size for the demo render chain — deliberately independent of
 * DIMENSION_MAP/the design brief's own `dimensions` (which happens to also be
 * 1080x1080 for the seeded Flavora "Summer Harvest" brief today, but is not
 * guaranteed to stay that way): this constant is the single source of truth
 * for BOTH the recorded width/height columns below AND the actual pixel
 * dimensions baked into DEMO_RENDER_PNG_BASE64, so the two can never drift
 * apart — no metadata is ever recorded that doesn't match the real bytes.
 */
const RENDER_WIDTH = 1080;
const RENDER_HEIGHT = 1080;

/**
 * Real 1080x1080 solid-color PNG (~5KB), base64-encoded — generated ONCE with
 * Node's zlib (deterministic: a fixed-size solid-color bitmap deflated with a
 * fixed compression level, no randomness, no external files/tools/network)
 * and embedded as a constant here, exactly like db-seed-demo.ts's
 * FOREST_GREEN_PNG_BASE64 (same Flavora "Forest Green" #2D5016 brand tone).
 * This is an HONEST placeholder: a hand-authored 1080x1080 Instagram-post
 * bitmap, not something the real AI/render pipeline ever produced — every
 * row below that references it makes that explicit (provider 'demo-seed',
 * rendererName 'demo-seed', designerNotes, package manifest note).
 */
const DEMO_RENDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAABDgAAAQ4CAIAAABjcvvYAAATOklEQVR42u3XMQ0AAAgEsVeBC7zgXw0uCEOTKrjt0lMAAACvRAIAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAGBUVAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoqAAAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARkUCAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVFQAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAADAqKgAAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAAEZFAgAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFRUAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKioAAAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACjAgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAYFQAAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAACMCgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAgFEBAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAAAwKgAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAAEYFAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGRQIAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAGBUAAACjAgAAGBUVAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoAAAAGBUAAMCoqAAAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAowIAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAGBUAAAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAjAoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAIBRAQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAMCoAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAABGBQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAwKgAAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAAAYFQAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAADAqAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARgUAAMCoAAAARkUCAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAADAqAAAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVAAAAowIAABgVFQAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAKMCAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAABgVAAAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAAIwKAACAUQEAADAqAACAUQEAADAqAACAUQEAADAqAACAUQEAALizvO3iCTA+yq0AAAAASUVORK5CYII=';

/**
 * Precomputed once at module load from the fixed base64 above — never
 * recomputed from arbitrary/random input, so this stays fully deterministic
 * across every run and every process.
 */
const DEMO_RENDER_PNG_BUFFER = Buffer.from(DEMO_RENDER_PNG_BASE64, 'base64');
const DEMO_RENDER_PNG_CHECKSUM = createHash('sha256').update(DEMO_RENDER_PNG_BUFFER).digest('hex');

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
  renderOutput:
    | { layoutPlanId: string; renderJobId: string; results: string[] }
    | { skipped: true; reason: string };
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

// ─── Demo render-output chain (Demo-Day polish) ────────────
//
// Everything below composes ONE fixed-id chain — layout_plan -> generated
// visual output -> production_job -> render_job -> export artifact — directly
// via the same repos the real routes/services use, WITHOUT going through
// runLayoutGeneration/runVisualGeneration/production-package-builder.ts/
// render-engine.ts (no AI call, no Playwright, no queue/worker). Every row is
// check-before-insert by its own FIXED id (mirrors ensureDemoBrief/
// ensureDemoReference above), so re-running never duplicates anything, and
// every stored-file row self-heals its object-storage bytes if the row
// exists but the underlying object was wiped (mirrors ensureDemoReference()
// in db-seed-demo.ts exactly).

/** Ensures the single demo layout_plan exists and is 'approved'. */
async function ensureDemoLayoutPlan(ownerId: string, brief: DesignBrief): Promise<{ layoutPlan: LayoutPlan; created: boolean }> {
  const existing = await layoutPlansRepo.getById(DEMO_LAYOUT_PLAN_ID);
  if (existing) {
    return { layoutPlan: existing, created: false };
  }

  // Hand-authored LayoutPlanContent — every field the real
  // LayoutPlanContentSchema requires (including zod-defaulted ones, since
  // this is a plain object literal, never parsed through .parse()) is set
  // explicitly rather than relying on a default that would never actually
  // run. canvas is fixed at RENDER_WIDTH x RENDER_HEIGHT (see that
  // constant's own comment) so it always matches the real PNG bytes below.
  const content: LayoutPlanContent = {
    format: brief.platform,
    canvas: { width: RENDER_WIDTH, height: RENDER_HEIGHT, backgroundColor: '#FFFFFF', dpi: 72 },
    layers: [
      {
        id: 'background',
        name: 'Background',
        type: 'background',
        position: { x: 0, y: 0, width: RENDER_WIDTH, height: RENDER_HEIGHT, rotation: 0, anchor: 'top-left' },
        zIndex: 0,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
      },
      {
        id: 'headline',
        name: 'Headline',
        type: 'text',
        position: { x: 80, y: 80, width: RENDER_WIDTH - 160, height: 240, rotation: 0, anchor: 'top-left' },
        zIndex: 1,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        textProperties: {
          content: brief.title,
          fontFamily: 'Outfit',
          fontSize: 64,
          fontWeight: 'bold',
          color: '#FFFFFF',
          alignment: 'left',
        },
      },
    ],
    safeZones: [],
    headlinePlacement: {
      layerId: 'headline',
      position: { x: 80, y: 80, width: RENDER_WIDTH - 160, height: 240, rotation: 0, anchor: 'top-left' },
    },
    exportSettings: { formats: ['png'], quality: 90, scaleFactor: 1 },
    referenceDesignIds: [],
    designDnaRulesUsed: [],
    designerNotes: 'Seeded demo layout for the /outputs gallery — hand-authored, never run through runLayoutGeneration/the AI pipeline.',
  };

  await layoutPlansRepo.create({
    id: DEMO_LAYOUT_PLAN_ID,
    clientId: brief.clientId,
    designBriefId: brief.id,
    contentIdeaId: brief.contentIdeaId,
    alternativeIndex: 1,
    status: 'generated',
    content,
    provider: 'demo-seed',
    model: 'demo-seed-v1',
    createdBy: ownerId,
  });

  // create() always inserts status 'generated' — approve() (which sets
  // approved_by/approved_at too) is a second step, same two-step idiom
  // ensureDemoBrief already uses for design_briefs' draft -> approved bump.
  const approved = await layoutPlansRepo.approve(DEMO_LAYOUT_PLAN_ID, ownerId);
  return { layoutPlan: approved!, created: true };
}

/** Ensures the single demo generated_outputs ("visual output") row exists with real PNG bytes in storage. */
async function ensureDemoVisualOutput(
  ownerId: string,
  brief: DesignBrief,
  layoutPlanId: string
): Promise<{ outputId: string; status: 'created' | 'exists' | 'healed' }> {
  const existing = await generatedOutputsRepo.getById(DEMO_VISUAL_OUTPUT_ID);

  if (existing) {
    if (!existing.storageProvider || !existing.storageKey || !existing.storageBucket) {
      console.warn(
        `[seed-demo-all] demo visual output ${DEMO_VISUAL_OUTPUT_ID} exists but has no storage columns — ` +
          'cannot repair in place. Delete that generated_outputs row and re-run to recreate it with file bytes.'
      );
      return { outputId: existing.id, status: 'exists' };
    }
    const provider = getStorageProviderByName(existing.storageProvider as StorageProviderName);
    try {
      await provider.getObjectBuffer({ key: existing.storageKey });
      return { outputId: existing.id, status: 'exists' };
    } catch {
      await provider.putObject({ key: existing.storageKey, body: DEMO_RENDER_PNG_BUFFER, contentType: 'image/png' });
      return { outputId: existing.id, status: 'healed' };
    }
  }

  // New row: storage write FIRST, row second — same never-persist-metadata-
  // on-storage-failure ordering as ensureDemoReference()/visual-generation.ts.
  const key = `generated-outputs/${brief.clientId}/${DEMO_VISUAL_OUTPUT_ID}.png`;
  const stored = await getStorageProvider().putObject({ key, body: DEMO_RENDER_PNG_BUFFER, contentType: 'image/png' });

  await generatedOutputsRepo.create({
    id: DEMO_VISUAL_OUTPUT_ID,
    clientId: brief.clientId,
    designBriefId: brief.id,
    layoutPlanId,
    type: 'preview_image',
    name: 'Demo Render Output',
    alternativeIndex: 1,
    status: 'generated',
    // Same protected-fileUrl pattern as visual-generation.ts — the authenticated
    // file route, never a raw storage location.
    fileUrl: `/api/visual-outputs/${DEMO_VISUAL_OUTPUT_ID}/file`,
    mimeType: 'image/png',
    fileSizeBytes: DEMO_RENDER_PNG_BUFFER.length,
    storageProvider: stored.provider,
    storageBucket: stored.bucket,
    storageKey: stored.key,
    dimensions: { width: RENDER_WIDTH, height: RENDER_HEIGHT },
    generationMethod: 'manual',
    provider: 'demo-seed',
    createdBy: ownerId,
  });

  return { outputId: DEMO_VISUAL_OUTPUT_ID, status: 'created' };
}

/** Ensures the single demo production_jobs row exists and has reached 'package_ready'. */
async function ensureDemoProductionJob(
  ownerId: string,
  brief: DesignBrief,
  layoutPlanId: string,
  generatedOutputId: string
): Promise<{ productionJobId: string; created: boolean }> {
  const existing = await productionJobsRepo.getById(DEMO_PRODUCTION_JOB_ID);
  if (existing) {
    return { productionJobId: existing.id, created: false };
  }

  await productionJobsRepo.create({
    id: DEMO_PRODUCTION_JOB_ID,
    clientId: brief.clientId,
    generatedOutputId,
    layoutPlanId,
    status: 'pending',
    generationMethod: 'manual_package_builder',
    requestedBy: ownerId,
  });

  // Same create('pending') -> updateStatus(...) two-step as every other
  // guarded state machine in this file — NOT production-package-builder.ts
  // (no real package bytes are built; packageManifestSnapshot is a small,
  // honestly-labeled placeholder object, not a fabricated real manifest).
  await productionJobsRepo.updateStatus(DEMO_PRODUCTION_JOB_ID, 'package_ready', {
    packageManifestSnapshot: {
      note: 'Seeded demo production package — not built by the real production-package-builder pipeline.',
      generatedOutputId,
      layoutPlanId,
    },
  });

  return { productionJobId: DEMO_PRODUCTION_JOB_ID, created: true };
}

/** Ensures the single demo render_job (status 'rendered') and its export artifact (real PNG bytes) exist. */
async function ensureDemoRenderJobWithArtifact(
  ownerId: string,
  brief: DesignBrief,
  productionJobId: string
): Promise<{ renderJob: RenderJob; renderJobCreated: boolean; artifactStatus: 'created' | 'exists' | 'healed' }> {
  let renderJob = await renderJobsRepo.getById(DEMO_RENDER_JOB_ID);
  let renderJobCreated = false;

  if (!renderJob) {
    await renderJobsRepo.create({
      id: DEMO_RENDER_JOB_ID,
      clientId: brief.clientId,
      productionJobId,
      requestedFormat: { preset: 'instagram_post', exportFormat: 'png', width: RENDER_WIDTH, height: RENDER_HEIGHT },
      requestedBy: ownerId,
    });
    // create() (opts.queued left at its default false) always inserts status
    // 'pending' — there is no repo method that inserts a row already
    // 'rendered' in one step (same limitation ensureDemoBrief's design_briefs
    // two-step already works around). Moving straight to 'rendered' via
    // plain updateStatus() — NOT claimNext()/markRendered(), which are the
    // queue/worker's own methods — means queued_at/started_at/locked_by/
    // locked_at/attempt_count/next_run_at are never touched by this seed
    // step: the row goes 'pending' -> 'rendered' directly, never 'queued' or
    // 'rendering', so it can never be mistaken for something the queue/
    // worker claimed. RENDER_QUEUE_ENABLED is never read or set here.
    renderJob = (await renderJobsRepo.updateStatus(DEMO_RENDER_JOB_ID, 'rendered', {
      rendererName: 'demo-seed',
      rendererVersion: 'demo-seed-v1',
    }))!;
    renderJobCreated = true;
  }

  const existingArtifact = await exportArtifactsRepo.getById(DEMO_RENDER_ARTIFACT_ID);
  if (existingArtifact) {
    const provider = getStorageProviderByName(existingArtifact.storageProvider as StorageProviderName);
    try {
      await provider.getObjectBuffer({ key: existingArtifact.storageKey });
      return { renderJob, renderJobCreated, artifactStatus: 'exists' };
    } catch {
      await provider.putObject({
        key: existingArtifact.storageKey,
        body: DEMO_RENDER_PNG_BUFFER,
        contentType: 'image/png',
      });
      return { renderJob, renderJobCreated, artifactStatus: 'healed' };
    }
  }

  const key = `export-artifacts/${brief.clientId}/${DEMO_RENDER_ARTIFACT_ID}.png`;
  const stored = await getStorageProvider().putObject({ key, body: DEMO_RENDER_PNG_BUFFER, contentType: 'image/png' });

  // format/width/height/mimeType/sizeBytes/checksum below all describe
  // DEMO_RENDER_PNG_BUFFER's REAL bytes (see that constant's own comment) —
  // never a fabricated label.
  await exportArtifactsRepo.create({
    id: DEMO_RENDER_ARTIFACT_ID,
    renderJobId: DEMO_RENDER_JOB_ID,
    clientId: brief.clientId,
    format: 'png',
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    mimeType: 'image/png',
    storageProvider: stored.provider,
    storageBucket: stored.bucket,
    storageKey: stored.key,
    sizeBytes: DEMO_RENDER_PNG_BUFFER.length,
    checksum: DEMO_RENDER_PNG_CHECKSUM,
  });

  return { renderJob, renderJobCreated, artifactStatus: 'created' };
}

/**
 * Composes the four steps above into the one chain the /outputs Product
 * Gallery needs: approved layout_plan -> generated visual output ->
 * package_ready production_job -> rendered render_job + its export artifact.
 * Only proceeds if the demo brief exists (mirrors ensureDemoBrief's own
 * explicit-skip contract) — every row below has a hard FK dependency on
 * DEMO_BRIEF_ID (directly or transitively), so there is nothing safe to do
 * without it.
 */
async function ensureDemoRenderOutput(ownerId: string): Promise<SeedDemoAllSummary['renderOutput']> {
  const brief = await designBriefsRepo.getById(DEMO_BRIEF_ID);
  if (!brief) {
    const reason = `the demo design brief (${DEMO_BRIEF_ID}) does not exist yet — ensureDemoBrief must succeed first.`;
    console.warn(`[seed-demo-all] skipping demo render output — ${reason}`);
    return { skipped: true, reason };
  }

  const { layoutPlan, created: layoutPlanCreated } = await ensureDemoLayoutPlan(ownerId, brief);
  const { outputId, status: outputStatus } = await ensureDemoVisualOutput(ownerId, brief, layoutPlan.id);
  const { productionJobId, created: productionJobCreated } = await ensureDemoProductionJob(
    ownerId,
    brief,
    layoutPlan.id,
    outputId
  );
  const {
    renderJob,
    renderJobCreated,
    artifactStatus,
  } = await ensureDemoRenderJobWithArtifact(ownerId, brief, productionJobId);

  const results = [
    `layout plan ${DEMO_LAYOUT_PLAN_ID}: ${layoutPlanCreated ? 'created' : 'already existed'} (status: approved)`,
    `visual output ${DEMO_VISUAL_OUTPUT_ID}: ${outputStatus}`,
    `production job ${DEMO_PRODUCTION_JOB_ID}: ${productionJobCreated ? 'created' : 'already existed'} (status: package_ready)`,
    `render job ${DEMO_RENDER_JOB_ID}: ${renderJobCreated ? 'created' : 'already existed'} (status: ${renderJob.status})`,
    `render artifact ${DEMO_RENDER_ARTIFACT_ID}: ${artifactStatus}`,
  ];
  for (const line of results) console.log(`[seed-demo-all] ${line}`);

  return { layoutPlanId: layoutPlan.id, renderJobId: renderJob.id, results };
}

export async function seedDemoAll(opts: SeedDemoAllOptions = {}): Promise<SeedDemoAllSummary> {
  await runMigrations(pool);
  await runSeed(pool);
  const referenceResults = await seedDemoReferences();
  const owner = await ensureDemoOwner(opts);
  const brief = await ensureDemoBrief();

  let renderOutput: SeedDemoAllSummary['renderOutput'];
  if ('skipped' in brief) {
    renderOutput = { skipped: true, reason: 'demo design brief was skipped — see the brief result for why.' };
  } else {
    // ensureDemoOwner() only returns {email, created, generatedPassword} —
    // look the row up by that same email to get the id createdBy/requestedBy
    // below actually need (a plain read, mutates nothing).
    const ownerUser = await usersRepo.findByEmail(owner.email);
    if (!ownerUser) {
      renderOutput = {
        skipped: true,
        reason: `owner user ${owner.email} could not be found right after ensureDemoOwner() — should be unreachable.`,
      };
    } else {
      renderOutput = await ensureDemoRenderOutput(ownerUser.id);
    }
  }

  return { referenceResults, owner, brief, renderOutput };
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
  if ('skipped' in summary.renderOutput) {
    console.log(`  demo render output: SKIPPED — ${summary.renderOutput.reason}`);
  } else {
    console.log('  demo render output (for the /outputs Product Gallery):');
    for (const line of summary.renderOutput.results) console.log(`    - ${line}`);
    console.log(`    layoutPlanId: ${summary.renderOutput.layoutPlanId}`);
    console.log(`    renderJobId:  ${summary.renderOutput.renderJobId}`);
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
