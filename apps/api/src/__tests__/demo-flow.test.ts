import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Phase 2 Step 10 — MVP demo flow, end to end, on the KEYLESS configuration.
 *
 * This file IS the executable demo runbook: it walks the exact chain
 * `docs/mvp-demo-flow.md` describes, in demo order (login -> client ->
 * design reference -> DesignDNA -> content idea -> design brief -> layout
 * generation -> Creative QA -> visual generation -> human approval ->
 * production package -> package download -> production approve -> render ->
 * render history -> artifact download), against the configuration a keyless
 * demo machine runs: AI_DEFAULT_PROVIDER=fake (the real FakeAIAdapter,
 * packages/model-router/src/providers/fake.ts) + RENDERER_PROVIDER=fake
 * (suite-global, vitest.config.ts). Zero external network, zero real keys.
 *
 * WHAT MAKES THIS FILE DIFFERENT from every other integration file here:
 * there is NO `vi.mock('@grafista/model-router')` anywhere. The REAL
 * ModelRouter receives every AI call and routes it to the REAL fake adapter —
 * text/vision tasks via the explicit `provider: env.AI_DEFAULT_PROVIDER`
 * override the services pass, and image_generation (which passes no explicit
 * provider) via the routing table, where 'fake' is the primary entry.
 *
 * ENV-FLIP MECHANICS: apps/api/src/config/env.ts snapshots process.env ONCE
 * at ITS module load, and vitest.config.ts pins AI_DEFAULT_PROVIDER=openai
 * for the whole suite. Vitest gives each test FILE an isolated module
 * registry, so this file flips process.env FIRST and only then loads the app
 * graph via dynamic import — a static `import { app } from '../app.js'`
 * would hoist above the assignment and snapshot 'openai'. Nothing from src/
 * is imported statically. FakeAIAdapter.isAvailable() additionally re-reads
 * process.env at CALL time, so the switch below governs the whole file and
 * the afterAll restore keeps it from leaking into other files in this worker.
 */

const ORIGINAL_AI_DEFAULT_PROVIDER = process.env.AI_DEFAULT_PROVIDER;
process.env.AI_DEFAULT_PROVIDER = 'fake';

// Loaded AFTER the flip (top-level await): env.ts and every service in this
// file's registry sees AI_DEFAULT_PROVIDER='fake'.
const { app } = await import('../app.js');
const { pool } = await import('../db/pool.js');
const { TEST_USERS, TEST_USER_PASSWORD } = await import('../test/global-setup.js');

afterAll(() => {
  // Same hygiene as fake-provider.test.ts: never leak the demo switch into
  // other test files that may reuse this worker's process.env.
  if (ORIGINAL_AI_DEFAULT_PROVIDER === undefined) {
    delete process.env.AI_DEFAULT_PROVIDER;
  } else {
    process.env.AI_DEFAULT_PROVIDER = ORIGINAL_AI_DEFAULT_PROVIDER;
  }
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A real 64x64 solid-green PNG (same bytes as the fake provider's canned
 * visual) — uploaded as the design reference so DesignDNA analysis reads
 * genuine image bytes from storage, exactly like the demo runbook's
 * `db:seed-demo` references. */
const DEMO_REFERENCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsGtlKCNZ1gi+hcEKLD31WgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgtzt9Ee5/QCxAAAAABJRU5ErkJggg==',
  'base64'
);

const FAKE_MODEL = 'fake-canned-v1';

async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function userIdByEmail(email: string) {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  expect(rows.length).toBe(1);
  return rows[0].id as string;
}

type DemoOutput = {
  id: string;
  status: string;
  provider?: string;
  aiModel?: string;
  mimeType?: string;
  fileUrl?: string;
};

// ── Shared demo state ────────────────────────────────────────────────────────
// The `it`s below are one continuous story and run in declaration order
// (vitest runs tests within a file sequentially; no shuffle is configured).
// Describe 2's failure paths deliberately REUSE these entities per the demo
// spec, so this file builds the full chain exactly once.
let owner: ReturnType<typeof request.agent>;
let clientId: string;
let contentIdeaId: string;
let briefId: string;
let plan1Id: string;
let plan2Id: string; // generated in step 7, deliberately left without Creative QA — failure path (a)
let qaReportId: string;
let output1: DemoOutput;
let output2: DemoOutput; // stays un-approved — failure path (c) sends it to production and rejects it
let productionJobId: string;
let renderJobId: string;
let artifactFileUrl: string;

describe('MVP demo flow — happy path on the keyless configuration (real fake AI provider, no vi.mock)', () => {
  it('1. OWNER logs in with a real session', async () => {
    owner = await loginAs(TEST_USERS.OWNER);
  });

  it('2. creates the demo client', async () => {
    const res = await owner
      .post('/api/clients')
      .send({ name: 'Demo Flow Client', industry: 'food', notes: 'Keyless demo-flow client' });
    expect(res.status).toBe(201);
    clientId = res.body.data.id as string;
  });

  it('3. uploads one design reference (multipart, real PNG bytes)', async () => {
    const res = await owner
      .post(`/api/clients/${clientId}/design-references`)
      .field('name', 'demo-reference.png')
      .attach('file', DEMO_REFERENCE_PNG, { filename: 'demo-reference.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
  });

  it(
    '4. DesignDNA analyze (style_analysis + design_dna_synthesis via the fake adapter) succeeds, then approve',
    async () => {
      const analyzeRes = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
      expect(analyzeRes.status).toBe(201);
      expect(analyzeRes.body.data.status).toBe('generated');
      expect(analyzeRes.body.analyses.length).toBe(1);
      // The DNA row itself does not persist provider/model (verified against
      // design-dna-analysis.ts + the designDna repo — no such columns), so
      // "the fake adapter answered" is asserted on the downstream stages that
      // DO record it: content ideas (step 5), layout plans (7), QA report (8),
      // generated outputs (9). Here the success itself is the evidence: with
      // AI_DEFAULT_PROVIDER=fake and no vi.mock, no real adapter has a usable
      // key in this suite, so only the fake adapter can have produced this 201.
      expect(analyzeRes.body.data.confidenceScore).toBeCloseTo(0.88, 2);

      const approveRes = await owner.post(`/api/clients/${clientId}/design-dna/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('approved');
    },
    30_000
  );

  it(
    '5. generates content ideas — response records provider "fake" — and approves the first',
    async () => {
      const genRes = await owner
        .post(`/api/clients/${clientId}/content-ideas`)
        .send({ platform: 'instagram_post', format: 'single_image', topic: 'Seasonal harvest demo', optionCount: 2 });
      expect(genRes.status).toBe(201);
      // First response-derived proof that the REAL fake adapter answered.
      expect(genRes.body.provider).toBe('fake');
      expect(genRes.body.model).toBe(FAKE_MODEL);
      // The canned content_ideation payload has 3 ideas; the service slices to optionCount.
      expect(genRes.body.data.length).toBe(2);
      contentIdeaId = genRes.body.data[0].id as string;

      const approveRes = await owner.post(`/api/content-ideas/${contentIdeaId}/approve`);
      expect(approveRes.status).toBe(200);
    },
    30_000
  );

  it('6. creates the design brief from the approved idea and approves it', async () => {
    const briefRes = await owner.post('/api/design-briefs').send({ contentIdeaId });
    expect(briefRes.status).toBe(201);
    briefId = briefRes.body.data.id as string;

    const approveRes = await owner.post(`/api/design-briefs/${briefId}/approve`);
    expect(approveRes.status).toBe(200);
  });

  it(
    '7. layout generation produces the 2 canned alternatives; only plan #1 is approved',
    async () => {
      const genRes = await owner.post(`/api/design-briefs/${briefId}/layout-plans`);
      expect(genRes.status).toBe(201);
      const plans = genRes.body.data as Array<{ id: string; provider?: string }>;
      // The canned layout_generation payload carries exactly 2 alternatives.
      expect(plans.length).toBe(2);
      expect(plans[0].provider).toBe('fake');
      plan1Id = plans[0].id;
      plan2Id = plans[1].id;

      const approveRes = await owner.post(`/api/layout-plans/${plan1Id}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('approved');
      // plan 2 deliberately gets NO approval and NO Creative QA here — failure
      // path (a) below uses it to prove the visual-generation gate.
    },
    30_000
  );

  it(
    '8. Creative QA returns the canned PASSING report, then a human approves it',
    async () => {
      const runRes = await owner.post(`/api/layout-plans/${plan1Id}/creative-qa`);
      expect(runRes.status).toBe(201);
      qaReportId = runRes.body.data.id as string;
      // Canned verdict: overallScore 88 >= pass threshold 75, zero
      // high-priority fixes -> the service persists status 'passed'.
      expect(runRes.body.data.status).toBe('passed');
      expect(runRes.body.data.overallScore).toBe(88);
      expect(runRes.body.data.provider).toBe('fake');
      expect(runRes.body.data.model).toBe(FAKE_MODEL);

      // BRANCH CHOICE — approve-from-'passed' IS allowed: creativeQaReportsRepo
      // .approve matches status IN ('generated','passed','failed',
      // 'needs_revision'), so the demo exercises the human sign-off route on
      // top of the AI's own 'passed' verdict ('passed' alone would already
      // open the visual-generation gate, per production-gate.ts).
      const approveRes = await owner.post(`/api/creative-qa/${qaReportId}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('approved');
    },
    30_000
  );

  it(
    '9. visual generation yields 2 generated outputs with real, downloadable PNG bytes',
    async () => {
      const res = await owner.post(`/api/layout-plans/${plan1Id}/visual-generation`);
      expect(res.status).toBe(201);
      expect(res.body.total).toBe(2); // canned image_generation returns exactly 2 PNGs
      const outputs = res.body.data as DemoOutput[];
      for (const output of outputs) {
        expect(output.status).toBe('generated');
        expect(output.provider).toBe('fake');
        expect(output.aiModel).toBe(FAKE_MODEL);
        expect(output.mimeType).toBe('image/png');
      }
      [output1, output2] = outputs;

      // The canned payload's base64 is a REAL PNG — the authenticated file
      // route must stream bytes with the PNG magic header.
      const fileRes = await owner.get(output1.fileUrl!).responseType('blob');
      expect(fileRes.status).toBe(200);
      expect(fileRes.headers['content-type']).toContain('image/png');
      const bytes = Buffer.from(fileRes.body);
      expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC);
    },
    30_000
  );

  it('10. a human approves visual output #1', async () => {
    const res = await owner.post(`/api/visual-outputs/${output1.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('approved');
  });

  it(
    '11. production job on output #1 reaches package_ready; the package manifest downloads as v2 JSON',
    async () => {
      const jobRes = await owner.post(`/api/generated-outputs/${output1.id}/production-jobs`);
      expect(jobRes.status).toBe(201);
      productionJobId = jobRes.body.data.id as string;
      expect(jobRes.body.data.status).toBe('package_ready');

      const getRes = await owner.get(`/api/production-jobs/${productionJobId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.packageSummary).toBeTruthy();
      expect(getRes.body.packageSummary.packageVersion).toBe(2);
      expect(getRes.body.packageSummary.packageReady).toBe(true);

      const pkgRes = await owner.get(`/api/production-jobs/${productionJobId}/package`).responseType('blob');
      expect(pkgRes.status).toBe(200);
      expect(pkgRes.headers['content-type']).toContain('application/json');
      const manifest = JSON.parse(Buffer.from(pkgRes.body).toString('utf8')) as Record<string, unknown>;
      expect(manifest.manifestVersion).toBe(2);
      expect(manifest.packageVersion).toBe(2);
      expect(manifest.templateContract).toBeTruthy();
    },
    30_000
  );

  it('12. production APPROVE moves the job to approved', async () => {
    const res = await owner.post(`/api/production-jobs/${productionJobId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  it(
    '13. rendering instagram_post/png on the APPROVED job succeeds with warnings surfaced',
    async () => {
      const res = await owner
        .post(`/api/production-jobs/${productionJobId}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(res.status).toBe(201);
      const renderJob = res.body.data as Record<string, unknown>;
      renderJobId = renderJob.id as string;
      expect(renderJob.status).toBe('rendered');
      expect(renderJob.rendererName).toBe('fake');

      const warnings = renderJob.renderWarnings as Array<Record<string, unknown>>;
      expect(Array.isArray(warnings)).toBe(true);
      // The canned layout_generation payload defines `safeZones: []` (see
      // fake.ts), and render-quality.ts emits exactly one
      // 'safe_area_unavailable' INFO warning when safeZones is empty or
      // missing — so that warning MUST be present on this render.
      const safeArea = warnings.find((w) => w.code === 'safe_area_unavailable');
      expect(safeArea).toBeDefined();
      expect(safeArea?.severity).toBe('info');
    },
    30_000
  );

  it('14. render history carries the render with a complete artifact summary', async () => {
    const res = await owner.get(`/api/production-jobs/${productionJobId}/render-jobs`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const entry = res.body.data[0] as Record<string, any>;
    expect(entry.id).toBe(renderJobId);
    expect(entry.status).toBe('rendered');
    expect(entry.artifactSummaries.length).toBe(1);
    const summary = entry.artifactSummaries[0];
    expect(summary.preset).toBe('instagram_post');
    expect(summary.format).toBe('png');
    expect(summary.width).toBe(1080);
    expect(summary.height).toBe(1080);
    expect(summary.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.fileUrl).toBe(`/api/export-artifacts/${summary.id}/file`);
    artifactFileUrl = summary.fileUrl as string;
  });

  it('15. the export artifact downloads via its fileUrl with PNG magic bytes', async () => {
    const res = await owner.get(artifactFileUrl).responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    const bytes = Buffer.from(res.body);
    expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC);
  });
});

describe('MVP demo flow — the four demo-spec failure paths (reusing the happy-path entities)', () => {
  it(
    'a. visual generation on plan #2 (approved but never QA-run) is a 409 naming Creative QA',
    async () => {
      // The gate is per-layout-plan: approving the plan alone must not open it.
      const approveRes = await owner.post(`/api/layout-plans/${plan2Id}/approve`);
      expect(approveRes.status).toBe(200);

      const res = await owner.post(`/api/layout-plans/${plan2Id}/visual-generation`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Creative QA/);
      expect(res.body.message).toMatch(/'approved' or 'passed'/);
    },
    30_000
  );

  it("b. a 'failed' generated output cannot enter production (409)", async () => {
    // Direct-SQL bare row (same idiom as production-jobs.test.ts's
    // createBareGeneratedOutput): with the always-succeeding fake provider a
    // 'failed' output is unreachable through the API, so it is constructed
    // directly against the happy path's real client/brief FKs.
    const ownerId = await userIdByEmail(TEST_USERS.OWNER);
    const { rows } = await pool.query(
      `INSERT INTO generated_outputs (
         client_id, design_brief_id, layout_plan_id, type, name, status,
         mime_type, generation_method, created_by
       )
       VALUES ($1,$2,NULL,'preview_image','Demo flow failed output','failed','image/png','manual',$3)
       RETURNING id`,
      [clientId, briefId, ownerId]
    );
    const failedOutputId = rows[0].id as string;

    const res = await owner.post(`/api/generated-outputs/${failedOutputId}/production-jobs`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not ready for production/);
    expect(res.body.message).toMatch(/'failed'/);
  });

  it(
    'c. a REJECTED production job cannot be rendered — the 409 echoes status "rejected"',
    async () => {
      // Output #2 from happy-path step 9: 'generated' (never human-approved —
      // the production gate only requires file status 'generated').
      const jobRes = await owner.post(`/api/generated-outputs/${output2.id}/production-jobs`);
      expect(jobRes.status).toBe(201);
      expect(jobRes.body.data.status).toBe('package_ready');
      const rejectedJobId = jobRes.body.data.id as string;

      const rejectRes = await owner
        .post(`/api/production-jobs/${rejectedJobId}/reject`)
        .send({ reason: 'Demo: package sent back' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('rejected');

      const renderRes = await owner
        .post(`/api/production-jobs/${rejectedJobId}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(renderRes.status).toBe(409);
      expect(renderRes.body.message).toMatch(/not ready for render/);
      expect(renderRes.body.message).toMatch(/'rejected'/);
      // Step 10 polish: the 409 body additively echoes the job's current status.
      expect(renderRes.body.status).toBe('rejected');
    },
    30_000
  );

  it('d. CONTENT_MANAGER is 403-blocked from production-job create and render create', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);

    const createRes = await contentManager.post(`/api/generated-outputs/${output2.id}/production-jobs`);
    expect(createRes.status).toBe(403);
    expect(createRes.body.requiredPermission).toBe('production_jobs:create');

    const renderRes = await contentManager
      .post(`/api/production-jobs/${productionJobId}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'png' });
    expect(renderRes.status).toBe(403);
    expect(renderRes.body.requiredPermission).toBe('render_jobs:create');
  });
});
