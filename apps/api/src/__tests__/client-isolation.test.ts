import { describe, it, expect, beforeAll, vi, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { usersRepo } from '../db/repositories/users.js';
import { clientMembersRepo } from '../db/repositories/client-members.js';
import { hashPassword } from '../auth/password.js';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

/**
 * Phase 3 Step 4 — Client Isolation Hardening.
 *
 * Structurally mirrors render-jobs.test.ts: the AI provider is mocked
 * wholesale (aiControl / vi.hoisted) so the fixture pipeline (client ->
 * design DNA -> content idea -> design brief -> layout plan -> Creative QA ->
 * visual generation -> production package -> render) can always produce two
 * REAL, independent, full pipelines for two different clients — everything
 * downstream (gates, storage, the fake renderer adapter under
 * RENDERER_PROVIDER=fake) runs against the real Postgres instance and the
 * real local-disk storage provider, unmocked.
 *
 * This suite does NOT re-test the pipelines themselves (see production-jobs/
 * render-jobs/visual-generation/layout-plans/creative-qa/design-dna test
 * files for that) — it only tests the NEW client_members-based ownership
 * guard (assertClientAccessible, see ../auth/client-access.ts): a
 * membership-restricted user must get 404 for another client's resources,
 * still get 200 for their own, and an unrestricted user (zero client_members
 * rows — today's pre-existing behavior for every current/seeded user) must
 * keep seeing everything, for both clients.
 */

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
        imageBase64: Buffer.from('grafista-client-isolation-test-image-bytes-alternative-1').toString('base64'),
        mimeType: 'image/png',
        width: 1080,
        height: 1080,
      },
      {
        imageBase64: Buffer.from('grafista-client-isolation-test-image-bytes-alternative-2').toString('base64'),
        mimeType: 'image/jpeg',
        width: 1080,
        height: 1350,
      },
    ],
  };

  class MockModelRouter {
    async complete(req: { taskType: string }) {
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
  const agent = request.agent(testServer.server);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function createClient(name: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for isolation' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-client-isolation-test'), { filename, contentType: 'image/png' });
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

/** Same full-chain helper as render-jobs.test.ts / production-jobs.test.ts. */
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

/** The standard starting point: a REAL production_jobs row at status
 * 'package_ready', built by the full pipeline (client -> ... -> generated
 * output -> production package). */
async function createPackageReadyProductionJob(clientName: string) {
  const ready = await createGeneratedOutputs(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const jobRes = await owner.post(`/api/generated-outputs/${ready.outputs[0].id}/production-jobs`);
  expect(jobRes.status).toBe(201);
  const productionJob = jobRes.body.data as Record<string, unknown>;
  expect(productionJob.status).toBe('package_ready');
  return { ...ready, productionJob };
}

async function renderOnce(productionJobId: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const renderRes = await owner
    .post(`/api/production-jobs/${productionJobId}/render`)
    .send({ preset: 'instagram_post', exportFormat: 'png' });
  expect(renderRes.status).toBe(201);
  const renderJob = renderRes.body.data as Record<string, unknown>;
  expect(renderJob.status).toBe('rendered');

  const artifactsRes = await owner.get(`/api/render-jobs/${renderJob.id}/artifacts`);
  expect(artifactsRes.status).toBe(200);
  expect(artifactsRes.body.total).toBe(1);
  const artifact = artifactsRes.body.data[0] as Record<string, unknown>;

  return { renderJob, artifact };
}

const SCOPED_A_EMAIL = 'scoped-owner-a@test.local';
const SCOPED_B_EMAIL = 'scoped-owner-b@test.local';

/** Seeds two extra dedicated users (role OWNER — so global permission checks
 * always pass and only the NEW client_members ownership guard is under
 * test), following the exact pattern global-setup.ts uses to seed the
 * regular TEST_USERS. */
async function seedScopedUser(email: string, name: string) {
  const passwordHash = await hashPassword(TEST_USER_PASSWORD);
  const user = await usersRepo.create({ id: uuid(), email, passwordHash, name });
  await usersRepo.assignRole(user.id, 'OWNER');
  return user.id;
}

describe('Phase 3 Step 4 — client isolation hardening', () => {
  let pipelineA: Awaited<ReturnType<typeof createPackageReadyProductionJob>> & {
    renderJob: Record<string, unknown>;
    artifact: Record<string, unknown>;
  };
  let pipelineB: typeof pipelineA;
  let scopedOwnerAId: string;
  let scopedOwnerBId: string;

  beforeAll(async () => {
    const a = await createPackageReadyProductionJob('Isolation Client A');
    const { renderJob: renderJobA, artifact: artifactA } = await renderOnce(a.productionJob.id as string);
    pipelineA = { ...a, renderJob: renderJobA, artifact: artifactA };

    const b = await createPackageReadyProductionJob('Isolation Client B');
    const { renderJob: renderJobB, artifact: artifactB } = await renderOnce(b.productionJob.id as string);
    pipelineB = { ...b, renderJob: renderJobB, artifact: artifactB };

    scopedOwnerAId = await seedScopedUser(SCOPED_A_EMAIL, 'Scoped Owner A');
    scopedOwnerBId = await seedScopedUser(SCOPED_B_EMAIL, 'Scoped Owner B');

    await clientMembersRepo.addMember(scopedOwnerAId, pipelineA.clientId);
    await clientMembersRepo.addMember(scopedOwnerBId, pipelineB.clientId);
  }, 60_000);

  describe('positive case — scoped-owner-a can read/act on their own client A resources', () => {
    it('production job, render job, render history, artifacts, artifact file, visual output, visual output file all 200', async () => {
      const a = await loginAs(SCOPED_A_EMAIL);

      expect((await a.get(`/api/production-jobs/${pipelineA.productionJob.id}`)).status).toBe(200);
      expect((await a.get(`/api/render-jobs/${pipelineA.renderJob.id}`)).status).toBe(200);
      expect((await a.get(`/api/production-jobs/${pipelineA.productionJob.id}/render-jobs`)).status).toBe(200);
      expect((await a.get(`/api/render-jobs/${pipelineA.renderJob.id}/artifacts`)).status).toBe(200);
      expect((await a.get(`/api/export-artifacts/${pipelineA.artifact.id}/file`).responseType('blob')).status).toBe(200);
      expect((await a.get(`/api/visual-outputs/${pipelineA.outputs[0].id}`)).status).toBe(200);
      expect(
        (await a.get(`/api/visual-outputs/${pipelineA.outputs[0].id}/file`).responseType('blob')).status
      ).toBe(200);
    });
  });

  describe('negative case — scoped-owner-a is denied access to client B resources (404, never 200/500)', () => {
    it('production job routes: get/package/approve/reject -> 404', async () => {
      const a = await loginAs(SCOPED_A_EMAIL);

      expect((await a.get(`/api/production-jobs/${pipelineB.productionJob.id}`)).status).toBe(404);
      expect((await a.get(`/api/production-jobs/${pipelineB.productionJob.id}/package`)).status).toBe(404);
      expect((await a.post(`/api/production-jobs/${pipelineB.productionJob.id}/approve`)).status).toBe(404);
      expect((await a.post(`/api/production-jobs/${pipelineB.productionJob.id}/reject`)).status).toBe(404);
    });

    it('render job / artifact routes: get/artifacts/file/render-history -> 404, and render creation is blocked', async () => {
      const a = await loginAs(SCOPED_A_EMAIL);

      expect((await a.get(`/api/render-jobs/${pipelineB.renderJob.id}`)).status).toBe(404);
      expect((await a.get(`/api/render-jobs/${pipelineB.renderJob.id}/artifacts`)).status).toBe(404);
      expect((await a.get(`/api/export-artifacts/${pipelineB.artifact.id}/file`)).status).toBe(404);
      expect((await a.get(`/api/production-jobs/${pipelineB.productionJob.id}/render-jobs`)).status).toBe(404);

      const renderRes = await a
        .post(`/api/production-jobs/${pipelineB.productionJob.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(renderRes.status).toBe(404);
    });

    it('visual output routes: get/file/approve/reject -> 404', async () => {
      const a = await loginAs(SCOPED_A_EMAIL);
      const outputId = pipelineB.outputs[0].id;

      expect((await a.get(`/api/visual-outputs/${outputId}`)).status).toBe(404);
      expect((await a.get(`/api/visual-outputs/${outputId}/file`)).status).toBe(404);
      expect((await a.post(`/api/visual-outputs/${outputId}/approve`)).status).toBe(404);
      expect((await a.post(`/api/visual-outputs/${outputId}/reject`)).status).toBe(404);
    });

    it('client-scoped design-dna routes -> 404', async () => {
      const a = await loginAs(SCOPED_A_EMAIL);

      expect((await a.post(`/api/clients/${pipelineB.clientId}/design-dna/analyze`)).status).toBe(404);
      expect((await a.get(`/api/clients/${pipelineB.clientId}/design-dna`)).status).toBe(404);
      expect((await a.post(`/api/clients/${pipelineB.clientId}/design-dna/approve`)).status).toBe(404);
      expect((await a.post(`/api/clients/${pipelineB.clientId}/design-dna/revise`)).status).toBe(404);
    });

    it('layout-plan and creative-qa direct-id routes -> 404', async () => {
      const a = await loginAs(SCOPED_A_EMAIL);

      expect((await a.get(`/api/layout-plans/${pipelineB.layoutPlanId}`)).status).toBe(404);
      expect((await a.get(`/api/creative-qa/${pipelineB.creativeQaReportId}`)).status).toBe(404);
    });
  });

  describe('regression guard — the unrestricted TEST_USERS.OWNER (zero client_members rows) still sees both clients', () => {
    it('owner reads pipeline A and pipeline B resources with 200', async () => {
      const owner = await loginAs(TEST_USERS.OWNER);

      expect((await owner.get(`/api/production-jobs/${pipelineA.productionJob.id}`)).status).toBe(200);
      expect((await owner.get(`/api/render-jobs/${pipelineA.renderJob.id}`)).status).toBe(200);
      expect((await owner.get(`/api/visual-outputs/${pipelineA.outputs[0].id}`)).status).toBe(200);

      expect((await owner.get(`/api/production-jobs/${pipelineB.productionJob.id}`)).status).toBe(200);
      expect((await owner.get(`/api/render-jobs/${pipelineB.renderJob.id}`)).status).toBe(200);
      expect((await owner.get(`/api/visual-outputs/${pipelineB.outputs[0].id}`)).status).toBe(200);
    });
  });
});
