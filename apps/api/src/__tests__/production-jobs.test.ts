import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';

/**
 * Phase 2 Step 8A — Production Jobs (package builder + template contract).
 *
 * Structurally mirrors visual-generation.test.ts: the AI provider is mocked
 * wholesale (aiControl / vi.hoisted) so the fixture pipeline (client -> design
 * DNA -> content idea -> design brief -> layout plan -> Creative QA -> visual
 * generation) can always produce a REAL generated_outputs row with status
 * 'generated' — everything downstream of that (production gate, job rows,
 * package building, storage writes, approve/reject) runs against the real
 * Postgres instance and the real local-disk storage provider, unmocked.
 *
 * storageControl.failPut simulates a storage outage for BOTH the visual
 * generation putObject (used to force a 'failed' generated output) and the
 * production package putObject (used to force a 'failed' production job).
 */

const aiControl = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'failure' | 'invalid_visual_payload',
}));

const storageControl = vi.hoisted(() => ({ failPut: false }));

vi.mock('../storage/factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/factory.js')>();
  return {
    ...actual,
    getStorageProvider: () => {
      const real = actual.getStorageProvider();
      return {
        name: real.name,
        putObject: async (args: { key: string; body: Buffer; contentType: string }) => {
          if (storageControl.failPut) {
            throw Object.assign(new Error('Simulated storage outage: putObject failed'), { status: 500 });
          }
          return real.putObject(args);
        },
        getObjectAccess: (args: { key: string; filename: string; contentType?: string }) =>
          real.getObjectAccess(args),
        getObjectBuffer: (args: { key: string }) => real.getObjectBuffer(args),
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
        imageBase64: Buffer.from('grafista-production-jobs-test-image-bytes-alternative-1').toString('base64'),
        mimeType: 'image/png',
        width: 1080,
        height: 1080,
      },
      {
        imageBase64: Buffer.from('grafista-production-jobs-test-image-bytes-alternative-2').toString('base64'),
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
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for production jobs' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-production-jobs-test'), { filename, contentType: 'image/png' });
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

/** Same full-chain helper as visual-generation.test.ts / creative-qa.test.ts. */
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

/**
 * The standard starting point for every production-job test: the full pipeline
 * through visual generation, producing two REAL generated_outputs rows with
 * status 'generated' (bytes actually in local storage).
 */
async function createGeneratedOutputs(clientName: string) {
  const ready = await createQaClearedLayoutPlan(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/visual-generation`);
  expect(res.status).toBe(201);
  const outputs = res.body.data as Array<{ id: string; status: string }>;
  expect(outputs.every((o) => o.status === 'generated')).toBe(true);
  return { ...ready, outputs };
}

/** Forces the visual-generation storage write to fail -> two 'failed' outputs. */
async function createFailedOutputs(clientName: string) {
  const ready = await createQaClearedLayoutPlan(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  storageControl.failPut = true;
  const res = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/visual-generation`);
  storageControl.failPut = false;
  expect(res.status).toBe(201);
  const outputs = res.body.data as Array<{ id: string; status: string }>;
  expect(outputs.every((o) => o.status === 'failed')).toBe(true);
  return { ...ready, outputs };
}

async function userIdByEmail(email: string) {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  expect(rows.length).toBe(1);
  return rows[0].id as string;
}

async function jobCountForOutput(generatedOutputId: string) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM production_jobs WHERE generated_output_id = $1',
    [generatedOutputId]
  );
  return rows[0].count as number;
}

beforeEach(() => {
  aiControl.mode = 'success';
  storageControl.failPut = false;
});

const SOME_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('1. Unauthenticated access', () => {
  it('rejects create, list, get, package, approve and reject with 401', async () => {
    expect((await request(app).post(`/api/generated-outputs/${SOME_UUID}/production-jobs`)).status).toBe(401);
    expect((await request(app).get(`/api/generated-outputs/${SOME_UUID}/production-jobs`)).status).toBe(401);
    expect((await request(app).get(`/api/production-jobs/${SOME_UUID}`)).status).toBe(401);
    expect((await request(app).get(`/api/production-jobs/${SOME_UUID}/package`)).status).toBe(401);
    expect((await request(app).post(`/api/production-jobs/${SOME_UUID}/approve`)).status).toBe(401);
    expect((await request(app).post(`/api/production-jobs/${SOME_UUID}/reject`)).status).toBe(401);
  });
});

describe('2. RBAC — production_jobs permission matrix', () => {
  it('CONTENT_MANAGER (no production_jobs permissions at all) cannot create or read', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);

    const createRes = await contentManager.post(`/api/generated-outputs/${SOME_UUID}/production-jobs`);
    expect(createRes.status).toBe(403);
    expect(createRes.body.requiredPermission).toBe('production_jobs:create');

    const listRes = await contentManager.get(`/api/generated-outputs/${SOME_UUID}/production-jobs`);
    expect(listRes.status).toBe(403);
    expect(listRes.body.requiredPermission).toBe('production_jobs:read');

    const getRes = await contentManager.get(`/api/production-jobs/${SOME_UUID}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.requiredPermission).toBe('production_jobs:read');

    const packageRes = await contentManager.get(`/api/production-jobs/${SOME_UUID}/package`);
    expect(packageRes.status).toBe(403);
    expect(packageRes.body.requiredPermission).toBe('production_jobs:read');
  });

  it('DESIGNER (read only) can list but cannot create, approve or reject', async () => {
    const designer = await loginAs(TEST_USERS.DESIGNER);

    // read IS granted to DESIGNER — a list for an unknown output is 200-empty.
    const listRes = await designer.get(`/api/generated-outputs/${SOME_UUID}/production-jobs`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toEqual([]);
    expect(listRes.body.total).toBe(0);

    const createRes = await designer.post(`/api/generated-outputs/${SOME_UUID}/production-jobs`);
    expect(createRes.status).toBe(403);
    expect(createRes.body.requiredPermission).toBe('production_jobs:create');

    const approveRes = await designer.post(`/api/production-jobs/${SOME_UUID}/approve`);
    expect(approveRes.status).toBe(403);
    expect(approveRes.body.requiredPermission).toBe('production_jobs:approve');

    const rejectRes = await designer.post(`/api/production-jobs/${SOME_UUID}/reject`);
    expect(rejectRes.status).toBe(403);
    expect(rejectRes.body.requiredPermission).toBe('production_jobs:reject');
  });

  it('domain-level guard in the service re-checks production_jobs:create independently of the route middleware', async () => {
    const { buildProductionPackage } = await import('../services/production-package-builder.js');

    // DESIGNER lacks production_jobs:create -> 403 from the service itself,
    // BEFORE the production gate (so even an unknown output id is a 403 here).
    const designerId = await userIdByEmail(TEST_USERS.DESIGNER);
    await expect(buildProductionPackage(SOME_UUID, designerId)).rejects.toMatchObject({ status: 403 });

    // OWNER has create -> the guard passes and the NEXT check (the gate) fires: 404.
    const ownerId = await userIdByEmail(TEST_USERS.OWNER);
    await expect(buildProductionPackage(SOME_UUID, ownerId)).rejects.toMatchObject({ status: 404 });

    expect(await jobCountForOutput(SOME_UUID)).toBe(0);
  });
});

describe('3. Production gate — only a status "generated" output may enter production', () => {
  it(
    'returns 409 for failed and pending outputs and persists ZERO production_jobs rows',
    async () => {
      const { outputs } = await createFailedOutputs('Production Gate Failed Output Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const failedRes = await owner.post(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(failedRes.status).toBe(409);
      expect(failedRes.body.message).toMatch(/not ready for production/);
      expect(failedRes.body.message).toMatch(/'failed'/);

      // A 'pending' output (bytes not persisted yet) is equally blocked.
      await pool.query("UPDATE generated_outputs SET status = 'pending' WHERE id = $1", [outputs[1].id]);
      const pendingRes = await owner.post(`/api/generated-outputs/${outputs[1].id}/production-jobs`);
      expect(pendingRes.status).toBe(409);
      expect(pendingRes.body.message).toMatch(/'pending'/);

      expect(await jobCountForOutput(outputs[0].id)).toBe(0);
      expect(await jobCountForOutput(outputs[1].id)).toBe(0);
    },
    30_000
  );

  it('returns 404 for an unknown generated output id and 400 for a malformed UUID', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);

    const missingRes = await owner.post(`/api/generated-outputs/${SOME_UUID}/production-jobs`);
    expect(missingRes.status).toBe(404);

    const badUuidRes = await owner.post('/api/generated-outputs/not-a-valid-uuid/production-jobs');
    expect(badUuidRes.status).toBe(400);

    const missingJobRes = await owner.get(`/api/production-jobs/${SOME_UUID}`);
    expect(missingJobRes.status).toBe(404);

    const missingPackageRes = await owner.get(`/api/production-jobs/${SOME_UUID}/package`);
    expect(missingPackageRes.status).toBe(404);
  });
});

describe('4. Happy path — CREATIVE_DIRECTOR sends a generated visual to production', () => {
  it(
    'creates a package_ready job whose manifest, DB row and stored bytes are all real and consistent',
    async () => {
      const { clientId, layoutPlanId, outputs } = await createGeneratedOutputs('Production Happy Path Client');
      const director = await loginAs(TEST_USERS.CREATIVE_DIRECTOR);

      const createRes = await director.post(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(createRes.status).toBe(201);
      const job = createRes.body.data as Record<string, unknown>;
      expect(job.status).toBe('package_ready');
      expect(job.clientId).toBe(clientId);
      expect(job.generatedOutputId).toBe(outputs[0].id);
      expect(job.layoutPlanId).toBe(layoutPlanId);
      expect(job.generationMethod).toBe('manual_package_builder');
      expect(job.errorMessage).toBeUndefined();
      expect(job.packageMimeType).toBe('application/json');
      expect(Number(job.packageSizeBytes)).toBeGreaterThan(0);
      expect(String(job.packageStorageKey)).toBe(
        `production-jobs/${clientId}/${job.id}/packages/production-package.json`
      );

      // DB row is real Postgres data with snapshots persisted.
      const { rows } = await pool.query('SELECT * FROM production_jobs WHERE id = $1', [job.id]);
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.status).toBe('package_ready');
      expect(row.package_storage_provider).toBe('local');
      expect(row.package_storage_key).toBe(job.packageStorageKey);
      expect(Number(row.package_size_bytes)).toBeGreaterThan(0);
      expect(row.requested_by).toBeTruthy();
      expect(row.approved_by).toBeNull();
      expect(row.error_message).toBeNull();
      expect(row.package_manifest_snapshot).toBeTruthy();
      expect(row.template_contract_snapshot).toBeTruthy();

      // The bytes really landed in object storage and ARE the manifest snapshot.
      const { getStorageProviderByName } = await import('../storage/factory.js');
      const local = getStorageProviderByName('local');
      const storedBytes = await local.getObjectBuffer({ key: row.package_storage_key as string });
      expect(storedBytes.length).toBe(Number(row.package_size_bytes));
      const storedManifest = JSON.parse(storedBytes.toString());
      expect(storedManifest.manifestVersion).toBe(1);
      expect(storedManifest.productionJobId).toBe(job.id);
      expect(storedManifest.clientId).toBe(clientId);
      expect(storedManifest.generatedOutput.id).toBe(outputs[0].id);
      expect(storedManifest.sourceVisualReference).toBe(`/api/visual-outputs/${outputs[0].id}/file`);
      expect(storedManifest.layoutPlanSnapshot.id).toBe(layoutPlanId);
      expect(storedManifest.creativeQaSnapshot).toBeTruthy();
      expect(storedManifest.brandSnapshot).toBeTruthy();
      expect(typeof storedManifest.productionInstructions).toBe('string');
      expect(storedManifest.productionInstructions).toContain('# Production Instructions');
      expect(storedManifest).toEqual(row.package_manifest_snapshot);

      // Template contract is derived from the REAL layout plan of the pipeline.
      const contract = storedManifest.templateContract;
      expect(contract.contractVersion).toBe(1);
      expect(contract.canvas.width).toBe(1080);
      expect(contract.canvas.height).toBe(1080);
      expect(contract.targetFormats).toEqual(['instagram_post']);
      expect(contract.brandColors).toEqual(['#2D5016']);
      expect(contract.textSlots.length).toBe(1);
      expect(contract.textSlots[0].content).toBe('Taze ve Dogal');
      expect(contract.fontRequirements.length).toBe(1);
      expect(contract.fontRequirements[0].fontFamily).toBe('Playfair Display');
      expect(contract.fontRequirements[0].fontSizes).toContain(64);
      expect(contract.logoSlot).toBeTruthy();
      expect(contract.futurePhotoshopAdapterHints.layerTypesPresent).toContain('text');
      expect(contract).toEqual(row.template_contract_snapshot);

      // GET /api/production-jobs/:id returns the same job.
      const getRes = await director.get(`/api/production-jobs/${job.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(job.id);
      expect(getRes.body.data.status).toBe('package_ready');

      // GET /api/production-jobs/:id/package streams the exact stored bytes.
      const packageRes = await director.get(`/api/production-jobs/${job.id}/package`).responseType('blob');
      expect(packageRes.status).toBe(200);
      expect(packageRes.headers['content-type']).toContain('application/json');
      expect(packageRes.headers['content-disposition']).toContain('production-package.json');
      expect(Buffer.from(packageRes.body).toString()).toBe(storedBytes.toString());

      // List endpoint shows exactly this one job.
      const listRes = await director.get(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.data[0].id).toBe(job.id);
    },
    30_000
  );
});

describe('5. Idempotency — one active job per generated output', () => {
  it(
    're-sending the same output to production returns the SAME job, and concurrent creates never duplicate',
    async () => {
      const { outputs } = await createGeneratedOutputs('Production Idempotency Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const firstRes = await owner.post(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(firstRes.status).toBe(201);
      const jobId = firstRes.body.data.id as string;

      const secondRes = await owner.post(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(secondRes.status).toBe(201);
      expect(secondRes.body.data.id).toBe(jobId);
      expect(await jobCountForOutput(outputs[0].id)).toBe(1);

      // Concurrent creates on a fresh output: either both resolve to the same
      // job or the DB partial unique index turns the loser into a 409 — but a
      // duplicate active row must NEVER exist.
      const [resA, resB] = await Promise.all([
        owner.post(`/api/generated-outputs/${outputs[1].id}/production-jobs`),
        owner.post(`/api/generated-outputs/${outputs[1].id}/production-jobs`),
      ]);
      const statuses = [resA.status, resB.status].sort();
      expect([[201, 201], [201, 409]]).toContainEqual(statuses);
      if (statuses[1] === 201) {
        expect(resA.body.data.id).toBe(resB.body.data.id);
      }
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM production_jobs
         WHERE generated_output_id = $1 AND status NOT IN ('failed','cancelled','rejected')`,
        [outputs[1].id]
      );
      expect(rows[0].count).toBeLessThanOrEqual(1);
    },
    30_000
  );
});

describe('6. Approve / reject lifecycle', () => {
  it(
    'approve and reject only work from package_ready, exactly once, and a rejected output can be re-sent',
    async () => {
      const { outputs } = await createGeneratedOutputs('Production Lifecycle Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const jobARes = await owner.post(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(jobARes.status).toBe(201);
      const jobAId = jobARes.body.data.id as string;

      // Approve from package_ready: 200 + approved metadata.
      const approveRes = await owner.post(`/api/production-jobs/${jobAId}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('approved');
      expect(approveRes.body.data.approvedBy).toBeTruthy();
      expect(approveRes.body.data.approvedAt).toBeTruthy();

      // Double-approve and reject-after-approve are both 409.
      const reApproveRes = await owner.post(`/api/production-jobs/${jobAId}/approve`);
      expect(reApproveRes.status).toBe(409);
      expect(reApproveRes.body.status).toBe('approved');
      expect((await owner.post(`/api/production-jobs/${jobAId}/reject`)).status).toBe(409);

      const { rows: approvedRows } = await pool.query('SELECT status, approved_by FROM production_jobs WHERE id = $1', [jobAId]);
      expect(approvedRows[0].status).toBe('approved');
      expect(approvedRows[0].approved_by).toBeTruthy();

      // Second output: reject from package_ready, then no flip-backs.
      const jobBRes = await owner.post(`/api/generated-outputs/${outputs[1].id}/production-jobs`);
      expect(jobBRes.status).toBe(201);
      const jobBId = jobBRes.body.data.id as string;

      const rejectRes = await owner.post(`/api/production-jobs/${jobBId}/reject`);
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('rejected');
      expect((await owner.post(`/api/production-jobs/${jobBId}/approve`)).status).toBe(409);
      expect((await owner.post(`/api/production-jobs/${jobBId}/reject`)).status).toBe(409);

      // A rejected job is terminal but NOT active — the output may be re-sent,
      // producing a NEW job (history keeps both).
      const retryRes = await owner.post(`/api/generated-outputs/${outputs[1].id}/production-jobs`);
      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.id).not.toBe(jobBId);
      expect(retryRes.body.data.status).toBe('package_ready');
      expect(await jobCountForOutput(outputs[1].id)).toBe(2);

      // Unknown job ids on approve/reject are 404s.
      expect((await owner.post(`/api/production-jobs/${SOME_UUID}/approve`)).status).toBe(404);
      expect((await owner.post(`/api/production-jobs/${SOME_UUID}/reject`)).status).toBe(404);
    },
    30_000
  );
});

describe('7. Packaging storage failure — failures are persisted, never swallowed', () => {
  it(
    'marks the job failed with error_message and no package coordinates; a retry then succeeds cleanly',
    async () => {
      const { outputs } = await createGeneratedOutputs('Production Storage Failure Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      storageControl.failPut = true;
      const failRes = await owner.post(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(failRes.status).toBe(500);
      expect(failRes.body.message).toMatch(/Simulated storage outage/);

      const { rows } = await pool.query(
        'SELECT * FROM production_jobs WHERE generated_output_id = $1',
        [outputs[0].id]
      );
      expect(rows.length).toBe(1);
      const failedJob = rows[0];
      expect(failedJob.status).toBe('failed');
      expect(failedJob.error_message).toMatch(/Simulated storage outage/);
      expect(failedJob.package_storage_key).toBeNull();
      expect(failedJob.package_manifest_snapshot).toBeNull();

      // A failed job can be inspected but has no package and cannot be approved.
      const getRes = await owner.get(`/api/production-jobs/${failedJob.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.status).toBe('failed');
      expect(getRes.body.data.errorMessage).toMatch(/Simulated storage outage/);
      expect((await owner.get(`/api/production-jobs/${failedJob.id}/package`)).status).toBe(404);
      const approveFailedRes = await owner.post(`/api/production-jobs/${failedJob.id}/approve`);
      expect(approveFailedRes.status).toBe(409);
      expect(approveFailedRes.body.status).toBe('failed');

      // Failed jobs are not "active": the retry creates a NEW job that succeeds.
      storageControl.failPut = false;
      const retryRes = await owner.post(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.id).not.toBe(failedJob.id);
      expect(retryRes.body.data.status).toBe('package_ready');

      // History keeps both rows — nothing orphaned, nothing overwritten.
      const listRes = await owner.get(`/api/generated-outputs/${outputs[0].id}/production-jobs`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(2);
      expect(listRes.body.data.map((j: { status: string }) => j.status).sort()).toEqual([
        'failed',
        'package_ready',
      ]);
    },
    30_000
  );
});
