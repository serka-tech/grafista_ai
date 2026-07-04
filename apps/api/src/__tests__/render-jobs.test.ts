import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import type { RenderInput, RenderOutput } from '../render/adapters/types.js';

/**
 * Phase 2 Step 9A — Render Jobs / Export Artifacts (Template Render Engine
 * integration layer).
 *
 * Structurally mirrors production-jobs.test.ts: the AI provider is mocked
 * wholesale (aiControl / vi.hoisted) so the fixture pipeline (client -> design
 * DNA -> content idea -> design brief -> layout plan -> Creative QA -> visual
 * generation -> production package) can always produce a REAL production_jobs
 * row with status 'package_ready' — everything downstream of that (render
 * gate, render_jobs rows, HTML build, the fake renderer adapter, storage
 * writes, export_artifacts rows) runs against the real Postgres instance and
 * the real local-disk storage provider, unmocked.
 *
 * rendererControl.failRender simulates a renderer outage (wraps the REAL
 * factory's getRendererAdapter — which resolves to the deterministic fake
 * adapter under RENDERER_PROVIDER=fake, see vitest.config.ts — so every test
 * that does NOT set failRender still exercises the real fake-adapter render
 * path end to end).
 */

const aiControl = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'failure',
}));

const rendererControl = vi.hoisted(() => ({ failRender: false }));

vi.mock('../render/adapters/factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../render/adapters/factory.js')>();
  return {
    ...actual,
    getRendererAdapter: () => {
      const real = actual.getRendererAdapter();
      return {
        name: real.name,
        version: real.version,
        render: async (input: RenderInput): Promise<RenderOutput> => {
          if (rendererControl.failRender) {
            throw Object.assign(new Error('Simulated renderer outage: render failed'), { status: 502 });
          }
          return real.render(input);
        },
      };
    },
  };
});

vi.mock('@grafista/model-router', () => {
  const STYLE_ANALYSIS_CONTENT = {
    format: 'square',
    aspectRatio: '1:1',
    dominantColors: [{ hex: '#2D5016', percentage: 55 }, { hex: '#FAF5EB', percentage: 45 }],
    typographyHierarchy: { headingStyle: 'Playfair Display Bold, 36pt', bodyStyle: 'Inter Regular, 14pt' },
    logoPosition: 'top-left',
    imageTreatment: 'Warm natural lighting, no filters',
    backgroundStyle: 'Solid cream background',
    textDensity: 'low',
    ctaStyle: 'Rounded pill button, leaf green',
    layoutPattern: 'centered',
    visualMood: 'organic',
    brandConsistencyNotes: 'Consistent earthy palette across the reference',
    reusableDesignRules: ['Use warm natural lighting', 'Keep text density low'],
    designCategory: 'post',
    confidence: 0.9,
  };

  const DESIGN_DNA_CONTENT = {
    brandPersonality: ['authentic', 'warm', 'trustworthy'],
    preferredLayouts: ['centered'],
    visualRules: [{ rule: 'Use warm natural lighting in all photography', source: 'analysis', confidence: 0.9 }],
    typographyRules: [{ rule: 'Headings: Playfair Display Bold', example: '36pt' }],
    colorUsageRules: [{ rule: 'Primary earthy green', colors: ['#2D5016'] }],
    logoUsageRules: [{ rule: 'Logo top-left', preferredPosition: 'top-left' }],
    imageTreatmentRules: [{ rule: 'No artificial filters, natural light only' }],
    contentTone: { primary: 'friendly', secondary: 'informative', keywords: ['fresh', 'organic'], examples: [] },
    avoidList: ['neon colors', 'generic stock photos'],
    confidenceScore: 0.88,
  };

  const CONTENT_IDEATION_CONTENT = [
    {
      title: 'Fresh Harvest Announcement',
      description: 'Announce the new seasonal harvest with warm, natural imagery.',
      format: 'single_image',
      hook: 'Straight from the farm to your table',
      caption: 'Our new harvest has arrived.',
      hashtags: ['#fresh', '#local'],
      callToAction: 'Shop now',
      toneOfVoice: 'friendly',
      visualDirection: 'bright, natural lighting',
    },
  ];

  function layoutAlternative(index: number) {
    return {
      format: 'instagram_post',
      canvas: { width: 1080, height: 1080, backgroundColor: '#FFFFFF', dpi: 72 },
      layers: [
        { id: `bg-${index}`, name: 'Background', type: 'background', position: { x: 0, y: 0, width: 1080, height: 1080 }, zIndex: 0 },
        {
          id: `headline-${index}`,
          name: 'Headline',
          type: 'text',
          position: { x: 80, y: 120, width: 920, height: 200 },
          zIndex: 10,
          textProperties: { content: 'Taze ve Dogal', fontFamily: 'Playfair Display', fontSize: 64, color: '#2D5016' },
        },
        { id: `logo-${index}`, name: 'Logo', type: 'logo', position: { x: 40, y: 40, width: 120, height: 120 }, zIndex: 20 },
      ],
      gridStructure: { columns: 12, gutter: 24, description: '12-column grid' },
      safeZones: [],
      headlinePlacement: { layerId: `headline-${index}`, position: { x: 80, y: 120, width: 920, height: 200 } },
      logoPlacement: { layerId: `logo-${index}`, position: { x: 40, y: 40, width: 120, height: 120 } },
      colorUsageNotes: 'Earthy green on cream background',
      typographyNotes: 'Playfair Display for headline, Inter for body',
      exportSettings: { formats: ['png'], quality: 90, scaleFactor: 1 },
      referenceDesignIds: [],
      designDnaRulesUsed: index === 1 ? ['Use warm natural lighting in all photography'] : [],
      designerNotes: `Alternative ${index}`,
    };
  }

  const LAYOUT_ALTERNATIVES = [layoutAlternative(1), layoutAlternative(2)];

  function scoredCheck(category: string, checkName: string, score: number) {
    return {
      category,
      checkName,
      status: score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail',
      score,
      details: `${checkName} observations`,
      suggestion: score < 80 ? `Improve ${checkName}` : undefined,
    };
  }

  const CREATIVE_QA_SUCCESS_CONTENT = {
    overallScore: 88,
    overallStatus: 'passed',
    checks: [],
    brandConsistency: scoredCheck('brand', 'Brand Consistency', 88),
    readability: scoredCheck('text', 'Readability', 88),
    mobileLegibility: scoredCheck('text', 'Mobile Legibility', 88),
    visualHierarchy: scoredCheck('layout', 'Visual Hierarchy', 88),
    logoSafetyArea: scoredCheck('logo', 'Logo Safety Area', 88),
    colorContrast: scoredCheck('color', 'Color Contrast', 88),
    spelling: scoredCheck('text', 'Spelling', 100),
    designDnaMatch: scoredCheck('brand', 'DesignDNA Match', 88),
    exportReadiness: scoredCheck('export', 'Export Readiness', 88),
    typographyConsistency: scoredCheck('typography', 'Typography Consistency', 88),
    contentClarity: scoredCheck('content', 'Content Clarity', 88),
    summary: 'Creative QA review summary',
    detectedIssues: [],
    highPriorityFixes: [],
    mediumPriorityFixes: [],
    lowPriorityFixes: ['Consider tightening headline kerning slightly'],
    designerNotes: 'Overall composition is solid.',
    finalRecommendation: 'Approve as-is',
    designDnaReasons: ['Layout followed the warm natural lighting visual rule'],
    designBriefReasons: ['Headline copy matches the approved brief hook'],
    risksBeforeProduction: [],
  };

  const VISUAL_GENERATION_SUCCESS_CONTENT = {
    images: [
      {
        imageBase64: Buffer.from('grafista-render-jobs-test-image-bytes-alternative-1').toString('base64'),
        mimeType: 'image/png',
        width: 1080,
        height: 1080,
      },
      {
        imageBase64: Buffer.from('grafista-render-jobs-test-image-bytes-alternative-2').toString('base64'),
        mimeType: 'image/jpeg',
        width: 1080,
        height: 1350,
      },
    ],
  };

  class MockModelRouter {
    async complete(req: { taskType: string }) {
      if (req.taskType === 'image_generation' && aiControl.mode === 'failure') {
        return {
          success: false,
          provider: 'openai',
          model: 'none',
          content: '',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMs: 7,
          error: 'Simulated image provider outage',
        };
      }

      let content: unknown;
      if (req.taskType === 'style_analysis') content = STYLE_ANALYSIS_CONTENT;
      else if (req.taskType === 'design_dna_synthesis') content = DESIGN_DNA_CONTENT;
      else if (req.taskType === 'content_ideation') content = CONTENT_IDEATION_CONTENT;
      else if (req.taskType === 'layout_generation') content = LAYOUT_ALTERNATIVES;
      else if (req.taskType === 'creative_qa') content = CREATIVE_QA_SUCCESS_CONTENT;
      else if (req.taskType === 'image_generation') content = VISUAL_GENERATION_SUCCESS_CONTENT;
      else content = {};

      return {
        success: true,
        provider: 'openai',
        model: 'gpt-4o',
        content: JSON.stringify(content),
        usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 },
        latencyMs: 5,
      };
    }
  }

  return { ModelRouter: MockModelRouter };
});

async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function createClient(name: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for render jobs' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-render-jobs-test'), { filename, contentType: 'image/png' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function analyzeAndApproveDna(clientId: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const analyzeRes = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
  expect(analyzeRes.status).toBe(201);
  const approveDnaRes = await owner.post(`/api/clients/${clientId}/design-dna/approve`);
  expect(approveDnaRes.status).toBe(200);
  return approveDnaRes.body.data.id as string;
}

/** Same full-chain helper as production-jobs.test.ts. */
async function createFullyReadyLayoutPlan(clientName: string) {
  const clientId = await createClient(clientName);
  await uploadReference(clientId, 'reference-1.png');
  const designDnaId = await analyzeAndApproveDna(clientId);

  const owner = await loginAs(TEST_USERS.OWNER);
  const ideaRes = await owner
    .post(`/api/clients/${clientId}/content-ideas`)
    .send({ platform: 'instagram_post', format: 'single_image', topic: 'Seasonal harvest', optionCount: 1 });
  expect(ideaRes.status).toBe(201);
  const ideaId = ideaRes.body.data[0].id as string;
  const approveIdeaRes = await owner.post(`/api/content-ideas/${ideaId}/approve`);
  expect(approveIdeaRes.status).toBe(200);

  const briefRes = await owner.post('/api/design-briefs').send({ contentIdeaId: ideaId });
  expect(briefRes.status).toBe(201);
  const briefId = briefRes.body.data.id as string;
  const approveBriefRes = await owner.post(`/api/design-briefs/${briefId}/approve`);
  expect(approveBriefRes.status).toBe(200);

  const genRes = await owner.post(`/api/design-briefs/${briefId}/layout-plans`);
  expect(genRes.status).toBe(201);
  const layoutPlanId = genRes.body.data[0].id as string;
  const approveLayoutRes = await owner.post(`/api/layout-plans/${layoutPlanId}/approve`);
  expect(approveLayoutRes.status).toBe(200);

  return { clientId, briefId, layoutPlanId, designDnaId };
}

async function approveCreativeQaFor(layoutPlanId: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
  expect(genRes.status).toBe(201);
  const reportId = genRes.body.data.id as string;
  const approveRes = await owner.post(`/api/creative-qa/${reportId}/approve`);
  expect(approveRes.status).toBe(200);
  return reportId;
}

async function createQaClearedLayoutPlan(clientName: string) {
  const ready = await createFullyReadyLayoutPlan(clientName);
  const creativeQaReportId = await approveCreativeQaFor(ready.layoutPlanId);
  return { ...ready, creativeQaReportId };
}

async function createGeneratedOutputs(clientName: string) {
  const ready = await createQaClearedLayoutPlan(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/visual-generation`);
  expect(res.status).toBe(201);
  const outputs = res.body.data as Array<{ id: string; status: string }>;
  expect(outputs.every((o) => o.status === 'generated')).toBe(true);
  return { ...ready, outputs };
}

/** The standard starting point for every render-job test: a REAL
 * production_jobs row at status 'package_ready', built by the full pipeline
 * above (client -> ... -> generated output -> production package). */
async function createPackageReadyProductionJob(clientName: string) {
  const ready = await createGeneratedOutputs(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const jobRes = await owner.post(`/api/generated-outputs/${ready.outputs[0].id}/production-jobs`);
  expect(jobRes.status).toBe(201);
  const productionJob = jobRes.body.data as Record<string, unknown>;
  expect(productionJob.status).toBe('package_ready');
  return { ...ready, productionJob };
}

async function userIdByEmail(email: string) {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  expect(rows.length).toBe(1);
  return rows[0].id as string;
}

beforeEach(() => {
  aiControl.mode = 'success';
  rendererControl.failRender = false;
});

const SOME_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('1. Unauthenticated access', () => {
  it('rejects render, get, artifacts and file with 401', async () => {
    expect((await request(app).post(`/api/production-jobs/${SOME_UUID}/render`)).status).toBe(401);
    expect((await request(app).get(`/api/render-jobs/${SOME_UUID}`)).status).toBe(401);
    expect((await request(app).get(`/api/render-jobs/${SOME_UUID}/artifacts`)).status).toBe(401);
    expect((await request(app).get(`/api/export-artifacts/${SOME_UUID}/file`)).status).toBe(401);
  });
});

describe('2. RBAC — render_jobs / export_artifacts permission matrix', () => {
  it('CONTENT_MANAGER (no render_jobs/export_artifacts permissions at all) gets 403 on all 4 routes', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);

    const renderRes = await contentManager.post(`/api/production-jobs/${SOME_UUID}/render`).send({ preset: 'instagram_post', exportFormat: 'png' });
    expect(renderRes.status).toBe(403);
    expect(renderRes.body.requiredPermission).toBe('render_jobs:create');

    const getRes = await contentManager.get(`/api/render-jobs/${SOME_UUID}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.requiredPermission).toBe('render_jobs:read');

    const artifactsRes = await contentManager.get(`/api/render-jobs/${SOME_UUID}/artifacts`);
    expect(artifactsRes.status).toBe(403);
    expect(artifactsRes.body.requiredPermission).toBe('export_artifacts:read');

    const fileRes = await contentManager.get(`/api/export-artifacts/${SOME_UUID}/file`);
    expect(fileRes.status).toBe(403);
    expect(fileRes.body.requiredPermission).toBe('export_artifacts:read');
  });

  for (const role of ['OWNER', 'CREATIVE_DIRECTOR', 'DESIGNER'] as const) {
    it(
      `${role} can create a render job, read it, and read its artifacts`,
      async () => {
        const { productionJob } = await createPackageReadyProductionJob(`RBAC ${role} Client`);
        const actor = await loginAs(TEST_USERS[role]);

        const renderRes = await actor
          .post(`/api/production-jobs/${productionJob.id}/render`)
          .send({ preset: 'instagram_post', exportFormat: 'png' });
        expect(renderRes.status).toBe(201);
        const renderJob = renderRes.body.data as Record<string, unknown>;
        expect(renderJob.status).toBe('rendered');

        const getRes = await actor.get(`/api/render-jobs/${renderJob.id}`);
        expect(getRes.status).toBe(200);
        expect(getRes.body.data.id).toBe(renderJob.id);

        const artifactsRes = await actor.get(`/api/render-jobs/${renderJob.id}/artifacts`);
        expect(artifactsRes.status).toBe(200);
        expect(artifactsRes.body.total).toBe(1);
      },
      30_000
    );
  }
});

describe('3. Render gate — only package_ready/approved production jobs may be rendered', () => {
  it(
    'a package_ready production job renders successfully (synchronous 201 already shows status "rendered")',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render Gate PackageReady Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const renderRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(renderRes.status).toBe(201);
      const renderJob = renderRes.body.data as Record<string, unknown>;
      expect(renderJob.status).toBe('rendered');
      expect(renderJob.productionJobId).toBe(productionJob.id);
      expect(renderJob.rendererName).toBe('fake');
      expect(renderJob.errorMessage).toBeUndefined();
      expect((renderJob.requestedFormat as Record<string, unknown>).width).toBe(1080);
      expect((renderJob.requestedFormat as Record<string, unknown>).height).toBe(1080);

      const { rows } = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [renderJob.id]);
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('rendered');
      expect(rows[0].manifest_snapshot).toBeTruthy();
      expect(rows[0].template_contract_snapshot).toBeTruthy();
    },
    30_000
  );

  it(
    'an approved production job also renders successfully',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render Gate Approved Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const approveRes = await owner.post(`/api/production-jobs/${productionJob.id}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('approved');

      const renderRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'landscape', exportFormat: 'jpg' });
      expect(renderRes.status).toBe(201);
      expect(renderRes.body.data.status).toBe('rendered');
    },
    30_000
  );

  it(
    'pending/packaging production jobs are rejected with 409',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render Gate Pending Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      await pool.query("UPDATE production_jobs SET status = 'pending' WHERE id = $1", [productionJob.id]);
      const pendingRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(pendingRes.status).toBe(409);
      expect(pendingRes.body.message).toMatch(/not ready for render/);
      expect(pendingRes.body.message).toMatch(/'pending'/);

      await pool.query("UPDATE production_jobs SET status = 'packaging' WHERE id = $1", [productionJob.id]);
      const packagingRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(packagingRes.status).toBe(409);
      expect(packagingRes.body.message).toMatch(/'packaging'/);

      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM render_jobs WHERE production_job_id = $1', [
        productionJob.id,
      ]);
      expect(rows[0].count).toBe(0);
    },
    30_000
  );

  it(
    'rejected/failed/cancelled production jobs are rejected with 409',
    async () => {
      const owner = await loginAs(TEST_USERS.OWNER);

      for (const status of ['rejected', 'failed', 'cancelled']) {
        const { productionJob } = await createPackageReadyProductionJob(`Render Gate ${status} Client`);
        await pool.query('UPDATE production_jobs SET status = $2 WHERE id = $1', [productionJob.id, status]);

        const res = await owner
          .post(`/api/production-jobs/${productionJob.id}/render`)
          .send({ preset: 'instagram_post', exportFormat: 'png' });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(new RegExp(`'${status}'`));
      }
    },
    30_000
  );

  it(
    'a package_ready job missing its manifest snapshot or storage key is rejected with 409 (defensive guard)',
    async () => {
      const owner = await loginAs(TEST_USERS.OWNER);

      const { productionJob: jobA } = await createPackageReadyProductionJob('Render Gate Missing Manifest Client');
      await pool.query('UPDATE production_jobs SET package_manifest_snapshot = NULL WHERE id = $1', [jobA.id]);
      const resA = await owner
        .post(`/api/production-jobs/${jobA.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(resA.status).toBe(409);
      expect(resA.body.message).toMatch(/missing its package manifest\/storage key/);

      const { productionJob: jobB } = await createPackageReadyProductionJob('Render Gate Missing StorageKey Client');
      await pool.query('UPDATE production_jobs SET package_storage_key = NULL WHERE id = $1', [jobB.id]);
      const resB = await owner
        .post(`/api/production-jobs/${jobB.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(resB.status).toBe(409);
      expect(resB.body.message).toMatch(/missing its package manifest\/storage key/);
    },
    30_000
  );

  it('an unknown production job id is rejected with 404', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner
      .post(`/api/production-jobs/${SOME_UUID}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'png' });
    expect(res.status).toBe(404);
  });

  it('the domain-level guard in the service re-checks render_jobs:create independently of the route middleware', async () => {
    const { renderProductionJob } = await import('../services/render-engine.js');

    const contentManagerId = await userIdByEmail(TEST_USERS.CONTENT_MANAGER);
    await expect(
      renderProductionJob(SOME_UUID, { preset: 'instagram_post', exportFormat: 'png' }, contentManagerId)
    ).rejects.toMatchObject({ status: 403 });

    const ownerId = await userIdByEmail(TEST_USERS.OWNER);
    await expect(
      renderProductionJob(SOME_UUID, { preset: 'instagram_post', exportFormat: 'png' }, ownerId)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('4. Fake renderer determinism', () => {
  it(
    'two renders of the identical input produce byte-identical export_artifacts.checksum',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render Determinism Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const firstRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(firstRes.status).toBe(201);
      const firstJobId = firstRes.body.data.id as string;

      const secondRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(secondRes.status).toBe(201);
      const secondJobId = secondRes.body.data.id as string;

      // No idempotency in this MVP — two distinct render_jobs rows, both 'rendered'.
      expect(secondJobId).not.toBe(firstJobId);

      const { rows: firstArtifacts } = await pool.query(
        'SELECT checksum FROM export_artifacts WHERE render_job_id = $1',
        [firstJobId]
      );
      const { rows: secondArtifacts } = await pool.query(
        'SELECT checksum FROM export_artifacts WHERE render_job_id = $1',
        [secondJobId]
      );
      expect(firstArtifacts.length).toBe(1);
      expect(secondArtifacts.length).toBe(1);
      expect(firstArtifacts[0].checksum).toBeTruthy();
      expect(firstArtifacts[0].checksum).toBe(secondArtifacts[0].checksum);
    },
    30_000
  );
});

describe('5. Export artifact storage + metadata', () => {
  it(
    'artifact metadata is persisted and queryable, and the file route streams the real bytes (PNG magic header)',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render Artifact Storage Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const renderRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_story', exportFormat: 'png' });
      expect(renderRes.status).toBe(201);
      const renderJob = renderRes.body.data as Record<string, unknown>;

      const artifactsRes = await owner.get(`/api/render-jobs/${renderJob.id}/artifacts`);
      expect(artifactsRes.status).toBe(200);
      expect(artifactsRes.body.total).toBe(1);
      const artifact = artifactsRes.body.data[0] as Record<string, unknown>;
      expect(artifact.format).toBe('png');
      expect(artifact.width).toBe(1080);
      expect(artifact.height).toBe(1920);
      expect(artifact.mimeType).toBe('image/png');
      expect(artifact.storageProvider).toBe('local');
      expect(Number(artifact.sizeBytes)).toBeGreaterThan(0);
      expect(artifact.checksum).toBeTruthy();

      const fileRes = await owner.get(`/api/export-artifacts/${artifact.id}/file`).responseType('blob');
      expect(fileRes.status).toBe(200);
      expect(fileRes.headers['content-type']).toContain('image/png');
      expect(fileRes.headers['content-disposition']).toContain(`export-${artifact.id}.png`);
      const bytes = Buffer.from(fileRes.body);
      // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    },
    30_000
  );

  it('a job with no artifacts yet returns [] (200), not 404, and unknown artifact/job ids 404', async () => {
    const { productionJob } = await createPackageReadyProductionJob('Render Artifact Empty Client');
    const owner = await loginAs(TEST_USERS.OWNER);

    // A render_jobs row that never got an artifact (forced failure) still lists as [].
    rendererControl.failRender = true;
    const failRes = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'png' });
    rendererControl.failRender = false;
    expect(failRes.status).toBe(502);

    const { rows } = await pool.query('SELECT id FROM render_jobs WHERE production_job_id = $1', [productionJob.id]);
    expect(rows.length).toBe(1);
    const jobId = rows[0].id as string;

    const artifactsRes = await owner.get(`/api/render-jobs/${jobId}/artifacts`);
    expect(artifactsRes.status).toBe(200);
    expect(artifactsRes.body.data).toEqual([]);
    expect(artifactsRes.body.total).toBe(0);

    expect((await owner.get(`/api/render-jobs/${SOME_UUID}/artifacts`)).status).toBe(404);
    expect((await owner.get(`/api/export-artifacts/${SOME_UUID}/file`)).status).toBe(404);
    expect((await owner.get(`/api/render-jobs/${SOME_UUID}`)).status).toBe(404);
  });
});

describe('6. Renderer failure — failures are persisted, never swallowed', () => {
  it(
    'marks the render job failed with error_message set, and no export_artifacts row is created',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render Failure Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      rendererControl.failRender = true;
      const renderRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      rendererControl.failRender = false;

      expect(renderRes.status).toBe(502);
      expect(renderRes.body.message).toMatch(/Simulated renderer outage/);

      const { rows } = await pool.query('SELECT * FROM render_jobs WHERE production_job_id = $1', [productionJob.id]);
      expect(rows.length).toBe(1);
      const failedJob = rows[0];
      expect(failedJob.status).toBe('failed');
      expect(failedJob.error_message).toMatch(/Simulated renderer outage/);

      const { rows: artifactRows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM export_artifacts WHERE render_job_id = $1',
        [failedJob.id]
      );
      expect(artifactRows[0].count).toBe(0);

      // A failed render job can still be fetched directly.
      const getRes = await owner.get(`/api/render-jobs/${failedJob.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.status).toBe('failed');
      expect(getRes.body.data.errorMessage).toMatch(/Simulated renderer outage/);

      // Retrying (renderer healthy again) creates a brand-new job that succeeds.
      const retryRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.id).not.toBe(failedJob.id);
      expect(retryRes.body.data.status).toBe('rendered');
    },
    30_000
  );
});

describe('7. Invalid request body — preset/exportFormat validation', () => {
  it('rejects an invalid or missing preset/exportFormat with 400, without calling the service', async () => {
    const { productionJob } = await createPackageReadyProductionJob('Render Invalid Body Client');
    const owner = await loginAs(TEST_USERS.OWNER);

    const missingPresetRes = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ exportFormat: 'png' });
    expect(missingPresetRes.status).toBe(400);

    const badPresetRes = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ preset: 'not_a_real_preset', exportFormat: 'png' });
    expect(badPresetRes.status).toBe(400);

    const missingFormatRes = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ preset: 'instagram_post' });
    expect(missingFormatRes.status).toBe(400);

    const badFormatRes = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'webp' });
    expect(badFormatRes.status).toBe(400);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM render_jobs WHERE production_job_id = $1', [
      productionJob.id,
    ]);
    expect(rows[0].count).toBe(0);
  });
});

describe('8. Render history — GET /production-jobs/:id/render-jobs', () => {
  it('rejects unauthenticated access with 401', async () => {
    const res = await request(app).get(`/api/production-jobs/${SOME_UUID}/render-jobs`);
    expect(res.status).toBe(401);
  });

  it('403 for CONTENT_MANAGER (no render_jobs:read)', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
    const res = await contentManager.get(`/api/production-jobs/${SOME_UUID}/render-jobs`);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('render_jobs:read');
  });

  it(
    'DESIGNER (has render_jobs:read) gets 200',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render History DESIGNER Client');
      const designer = await loginAs(TEST_USERS.DESIGNER);

      const res = await designer.get(`/api/production-jobs/${productionJob.id}/render-jobs`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    },
    30_000
  );

  it('returns 404 for an unknown production job id', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.get(`/api/production-jobs/${SOME_UUID}/render-jobs`);
    expect(res.status).toBe(404);
  });

  it(
    'a fresh package_ready production job with no renders yet returns 200 {data: [], total: 0}, not 404',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render History Empty Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const res = await owner.get(`/api/production-jobs/${productionJob.id}/render-jobs`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    },
    30_000
  );

  it(
    'two renders of the same production job come back oldest-first, each with a correct single-item artifactSummaries whose fileUrl is directly usable',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render History Populated Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const firstRenderRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(firstRenderRes.status).toBe(201);

      const secondRenderRes = await owner
        .post(`/api/production-jobs/${productionJob.id}/render`)
        .send({ preset: 'landscape', exportFormat: 'pdf' });
      expect(secondRenderRes.status).toBe(201);

      const historyRes = await owner.get(`/api/production-jobs/${productionJob.id}/render-jobs`);
      expect(historyRes.status).toBe(200);
      expect(historyRes.body.total).toBe(2);

      const [first, second] = historyRes.body.data as Array<Record<string, any>>;
      // Oldest first — the instagram_post/png render was requested before the landscape/pdf one.
      expect(first.requestedFormat.preset).toBe('instagram_post');
      expect(second.requestedFormat.preset).toBe('landscape');
      expect(first.status).toBe('rendered');
      expect(second.status).toBe('rendered');

      expect(first.artifactSummaries.length).toBe(1);
      const firstArtifact = first.artifactSummaries[0];
      expect(firstArtifact.format).toBe('png');
      expect(firstArtifact.width).toBe(1080);
      expect(firstArtifact.height).toBe(1080);
      expect(firstArtifact.mimeType).toBe('image/png');
      expect(firstArtifact.sizeBytes).toBeGreaterThan(0);
      expect(firstArtifact.fileUrl).toBe(`/api/export-artifacts/${firstArtifact.id}/file`);

      expect(second.artifactSummaries.length).toBe(1);
      const secondArtifact = second.artifactSummaries[0];
      expect(secondArtifact.format).toBe('pdf');
      expect(secondArtifact.width).toBe(1920);
      expect(secondArtifact.height).toBe(1080);
      expect(secondArtifact.mimeType).toBe('application/pdf');
      expect(secondArtifact.sizeBytes).toBeGreaterThan(0);
      expect(secondArtifact.fileUrl).toBe(`/api/export-artifacts/${secondArtifact.id}/file`);

      // Prove the URL is directly usable: GET it and check the PNG magic header.
      const fileRes = await owner.get(firstArtifact.fileUrl).responseType('blob');
      expect(fileRes.status).toBe(200);
      const bytes = Buffer.from(fileRes.body);
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    },
    30_000
  );

  it(
    'a failed render appears in history with status failed, a non-empty errorMessage, and empty artifactSummaries',
    async () => {
      const { productionJob } = await createPackageReadyProductionJob('Render History Failed Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      rendererControl.failRender = true;
      try {
        const failRes = await owner
          .post(`/api/production-jobs/${productionJob.id}/render`)
          .send({ preset: 'instagram_post', exportFormat: 'png' });
        expect(failRes.status).toBe(502);
      } finally {
        rendererControl.failRender = false;
      }

      const historyRes = await owner.get(`/api/production-jobs/${productionJob.id}/render-jobs`);
      expect(historyRes.status).toBe(200);
      expect(historyRes.body.total).toBe(1);

      const failedEntry = historyRes.body.data[0];
      expect(failedEntry.status).toBe('failed');
      expect(failedEntry.errorMessage).toBeTruthy();
      expect(failedEntry.artifactSummaries).toEqual([]);
    },
    30_000
  );
});
