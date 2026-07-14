import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { pool } from '../db/pool.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { brandAssetsRepo } from '../db/repositories/brand-assets.js';
import { v4 as uuid } from 'uuid';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

/**
 * Phase 2 Step 7 — Visual Generation (direct API surface).
 *
 * Structurally mirrors creative-qa.test.ts: the test environment sets a FAKE
 * OPENAI_API_KEY, so `@grafista/model-router`'s ModelRouter is replaced wholesale
 * below — no real network call (OpenAI or Kie AI) ever happens. `aiControl.mode`
 * (vi.hoisted so it's usable inside the hoisted vi.mock factory) switches the
 * image_generation response between a canned two-image success payload, a simulated
 * provider outage, and a schema-violating payload. The chain-building task types
 * (style_analysis / design_dna_synthesis / content_ideation / layout_generation /
 * creative_qa) always succeed so every test can drive the full pipeline up to
 * "approved LayoutPlan + approved Creative QA report".
 *
 * Storage failures are simulated by wrapping ../storage/factory.js: when
 * `storageControl.failPut` is set, putObject throws — everything else delegates to
 * the REAL local-disk provider, so happy-path tests also verify actual bytes landed
 * in object storage (read back via getObjectBuffer and compared to the mock bytes).
 *
 * The workflow-engine path (step binding `run_visual_generation` + `generated_output`
 * approval gate, end to end) is covered separately in workflows.test.ts §11.
 */

const aiControl = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'failure' | 'invalid_visual_payload' | 'invalid_then_valid',
  // Counts image_generation calls so the schema-retry tests can prove a second attempt happened.
  imageCalls: 0,
}));

const storageControl = vi.hoisted(() => ({ failPut: false }));

const FAKE_IMAGE_BYTES_1 = 'grafista-visual-generation-test-image-bytes-alternative-1';
const FAKE_IMAGE_BYTES_2 = 'grafista-visual-generation-test-image-bytes-alternative-2';

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
        imageBase64: Buffer.from('grafista-visual-generation-test-image-bytes-alternative-1').toString('base64'),
        mimeType: 'image/png',
        width: 1080,
        height: 1080,
      },
      {
        imageBase64: Buffer.from('grafista-visual-generation-test-image-bytes-alternative-2').toString('base64'),
        mimeType: 'image/jpeg',
        width: 1080,
        height: 1350,
      },
    ],
  };

  // Schema-violating: VisualGenerationPayloadSchema requires images.min(1).
  const INVALID_VISUAL_PAYLOAD = { images: [] };

  class MockModelRouter {
    async complete(req: { taskType: string }) {
      if (req.taskType === 'image_generation') aiControl.imageCalls += 1;
      // Failure modes only apply to the image_generation call — the chain-building
      // task types must keep succeeding so tests can always reach the gate.
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
      else if (req.taskType === 'image_generation') {
        if (aiControl.mode === 'invalid_visual_payload') content = INVALID_VISUAL_PAYLOAD;
        else if (aiControl.mode === 'invalid_then_valid') {
          content = aiControl.imageCalls === 1 ? INVALID_VISUAL_PAYLOAD : VISUAL_GENERATION_SUCCESS_CONTENT;
        } else content = VISUAL_GENERATION_SUCCESS_CONTENT;
      } else content = {};

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
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for visual generation' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-visual-generation-test'), { filename, contentType: 'image/png' });
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

/**
 * Full chain up to "approved LayoutPlan + approved DesignBrief + approved DesignDNA"
 * (same helper as creative-qa.test.ts). Creative QA itself is NOT run here — tests
 * that need the production gate cleared call approveCreativeQaFor() on top.
 */
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

/** Runs Creative QA for the layout plan and human-approves the report (clears the production gate). */
async function approveCreativeQaFor(layoutPlanId: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
  expect(genRes.status).toBe(201);
  const reportId = genRes.body.data.id as string;
  const approveRes = await owner.post(`/api/creative-qa/${reportId}/approve`);
  expect(approveRes.status).toBe(200);
  return reportId;
}

/** Chain + cleared gate in one call — the standard starting point for generation tests. */
async function createQaClearedLayoutPlan(clientName: string) {
  const ready = await createFullyReadyLayoutPlan(clientName);
  const creativeQaReportId = await approveCreativeQaFor(ready.layoutPlanId);
  return { ...ready, creativeQaReportId };
}

beforeEach(() => {
  aiControl.mode = 'success';
  aiControl.imageCalls = 0;
  storageControl.failPut = false;
  // Budget guard is OFF by default — each test opts in explicitly (go-live M2.1).
  delete process.env.CLIENT_MONTHLY_BUDGET_USD;
  delete process.env.KIE_IMAGE_COST_USD;
});

const SOME_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('1. Unauthenticated access', () => {
  it('rejects POST run, GET list, and GET/approve/reject output routes with 401', async () => {
    expect((await request(testServer.server).post(`/api/layout-plans/${SOME_UUID}/visual-generation`)).status).toBe(401);
    expect((await request(testServer.server).get(`/api/layout-plans/${SOME_UUID}/visual-generation`)).status).toBe(401);
    expect((await request(testServer.server).get(`/api/visual-outputs/${SOME_UUID}`)).status).toBe(401);
    expect((await request(testServer.server).post(`/api/visual-outputs/${SOME_UUID}/approve`)).status).toBe(401);
    expect((await request(testServer.server).post(`/api/visual-outputs/${SOME_UUID}/reject`)).status).toBe(401);
  });
});

describe('2. RBAC — missing visual_generation permissions are 403', () => {
  it('CONTENT_MANAGER (no visual_generation permissions at all) cannot run or read', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);

    const runRes = await contentManager.post(`/api/layout-plans/${SOME_UUID}/visual-generation`);
    expect(runRes.status).toBe(403);
    expect(runRes.body.requiredPermission).toBe('visual_generation:run');

    const listRes = await contentManager.get(`/api/layout-plans/${SOME_UUID}/visual-generation`);
    expect(listRes.status).toBe(403);
    expect(listRes.body.requiredPermission).toBe('visual_generation:read');

    const getRes = await contentManager.get(`/api/visual-outputs/${SOME_UUID}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.requiredPermission).toBe('visual_generation:read');
  });

  it('DESIGNER (run+read only) cannot approve or reject', async () => {
    const designer = await loginAs(TEST_USERS.DESIGNER);

    const approveRes = await designer.post(`/api/visual-outputs/${SOME_UUID}/approve`);
    expect(approveRes.status).toBe(403);
    expect(approveRes.body.requiredPermission).toBe('visual_generation:approve');

    const rejectRes = await designer.post(`/api/visual-outputs/${SOME_UUID}/reject`);
    expect(rejectRes.status).toBe(403);
    expect(rejectRes.body.requiredPermission).toBe('visual_generation:reject');
  });
});

describe('3. Production gate — no cleared Creative QA report', () => {
  it(
    'returns 409 with a clear message and persists ZERO generated_outputs rows when Creative QA was never run',
    async () => {
      const { layoutPlanId } = await createFullyReadyLayoutPlan('Visual Gen No QA Client');
      // Layout plan is approved but Creative QA has never been run at all.

      const owner = await loginAs(TEST_USERS.OWNER);
      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/not ready for visual production/);
      expect(res.body.message).toMatch(/'approved' or 'passed'/);

      const rows = await pool.query('SELECT * FROM generated_outputs WHERE layout_plan_id = $1', [layoutPlanId]);
      expect(rows.rows.length).toBe(0);
    },
    30_000
  );

  it(
    'returns 409 when the only Creative QA report was rejected (gate re-closes)',
    async () => {
      const { layoutPlanId } = await createFullyReadyLayoutPlan('Visual Gen Rejected QA Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const qaRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
      expect(qaRes.status).toBe(201);
      const reportId = qaRes.body.data.id as string;
      // A freshly generated report is 'passed' (which clears the gate), so flip it to
      // 'rejected' to prove a non-cleared status blocks generation.
      const rejectRes = await owner.post(`/api/creative-qa/${reportId}/reject`);
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('rejected');

      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(res.status).toBe(409);

      const rows = await pool.query('SELECT * FROM generated_outputs WHERE layout_plan_id = $1', [layoutPlanId]);
      expect(rows.rows.length).toBe(0);
    },
    30_000
  );
});

describe('4. Happy path — approved Creative QA, mocked provider, real storage + Postgres', () => {
  it(
    'returns 201 with generated outputs whose metadata and stored bytes are all real',
    async () => {
      const { clientId, briefId, layoutPlanId, creativeQaReportId } =
        await createQaClearedLayoutPlan('Visual Gen Happy Path Client');

      const owner = await loginAs(TEST_USERS.OWNER);
      await brandAssetsRepo.create({
        id: uuid(),
        clientId,
        type: 'color_palette',
        name: 'Approved palette',
        metadata: {
          palette: [
            { hex: '#123456', role: 'primary', name: 'Lacivert' },
            { hex: '#FEDCBA', role: 'accent', name: 'Krem' },
          ],
        },
      });
      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(res.status).toBe(201);
      expect(res.body.total).toBe(2);

      const outputs = res.body.data as Array<Record<string, unknown>>;
      expect(outputs.map((o) => o.alternativeIndex)).toEqual([1, 2]);
      for (const output of outputs) {
        expect(output.status).toBe('generated');
        expect(output.clientId).toBe(clientId);
        expect(output.designBriefId).toBe(briefId);
        expect(output.layoutPlanId).toBe(layoutPlanId);
        expect(output.creativeQaReportId).toBe(creativeQaReportId);
        expect(output.provider).toBe('openai');
        expect(output.aiModel).toBe('gpt-4o');
        expect(output.generationMethod).toBe('ai_generated');
        expect(output.approvalStatus).toBe('pending');
        expect(output.errorMessage).toBeUndefined();
        // Same protected-fileUrl pattern as brand-assets/design-references: the URL is
        // the authenticated file route, never a raw storage location.
        expect(output.fileUrl).toBe(`/api/visual-outputs/${output.id}/file`);
      }
      // Mime/extension mapping per image alternative.
      expect(outputs[0].mimeType).toBe('image/png');
      expect(String(outputs[0].storageKey)).toMatch(/^generated-outputs\/.+\.png$/);
      expect(outputs[0].dimensions).toEqual({ width: 1080, height: 1080 });
      expect(outputs[1].mimeType).toBe('image/jpeg');
      expect(String(outputs[1].storageKey)).toMatch(/^generated-outputs\/.+\.jpg$/);
      expect(outputs[1].dimensions).toEqual({ width: 1080, height: 1350 });

      // DB rows are real Postgres data with the full metadata set persisted.
      const rows = await pool.query(
        'SELECT * FROM generated_outputs WHERE layout_plan_id = $1 ORDER BY alternative_index ASC',
        [layoutPlanId]
      );
      expect(rows.rows.length).toBe(2);
      for (const row of rows.rows) {
        expect(row.status).toBe('generated');
        expect(row.provider).toBe('openai');
        expect(row.ai_model).toBe('gpt-4o');
        expect(row.prompt_snapshot).toBeTruthy();
        expect(row.storage_provider).toBe('local');
        expect(row.storage_key).toBeTruthy();
        expect(row.error_message).toBeNull();
        expect(row.created_by).toBeTruthy();
        expect(row.creative_qa_report_id).toBe(creativeQaReportId);
        expect(Number(row.file_size_bytes)).toBeGreaterThan(0);
        expect(row.file_url).toBe(`/api/visual-outputs/${row.id}/file`);
      }
      // The prompt snapshot captured what was actually sent (canvas dims are template variables).
      expect(String(rows.rows[0].prompt_snapshot)).toContain('1080');
      const completePrompt = String(rows.rows[0].prompt_snapshot);
      expect(completePrompt).toContain('#123456 — primary / main brand color');
      expect(completePrompt).toContain('#FEDCBA — accent / highlight');
      expect(completePrompt).toContain('approved BRAND PALETTE overrides every conflicting color value');
      expect(completePrompt).not.toContain('Background: solid');

      // The bytes really landed in object storage and match the provider payload exactly.
      const { getStorageProviderByName } = await import('../storage/factory.js');
      const local = getStorageProviderByName('local');
      const stored1 = await local.getObjectBuffer({ key: rows.rows[0].storage_key as string });
      expect(stored1.toString()).toBe(FAKE_IMAGE_BYTES_1);
      const stored2 = await local.getObjectBuffer({ key: rows.rows[1].storage_key as string });
      expect(stored2.toString()).toBe(FAKE_IMAGE_BYTES_2);
    },
    30_000
  );
});

describe('5. Listing + single-output reads', () => {
  it(
    'GET list returns the generated rows; unknown ids are 200-empty / 404; malformed UUIDs are 400',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen Listing Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const postRes = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(postRes.status).toBe(201);
      const outputId = postRes.body.data[0].id as string;

      const listRes = await owner.get(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(2);
      expect(listRes.body.data.map((o: { id: string }) => o.id)).toContain(outputId);

      const getRes = await owner.get(`/api/visual-outputs/${outputId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(outputId);
      expect(getRes.body.data.status).toBe('generated');

      // A list endpoint returns [] (200), not 404, for a layout plan with no outputs.
      const emptyRes = await owner.get(`/api/layout-plans/${SOME_UUID}/visual-generation`);
      expect(emptyRes.status).toBe(200);
      expect(emptyRes.body.total).toBe(0);
      expect(emptyRes.body.data).toEqual([]);

      const missingRes = await owner.get(`/api/visual-outputs/${SOME_UUID}`);
      expect(missingRes.status).toBe(404);

      const badUuidRes = await owner.get('/api/visual-outputs/not-a-valid-uuid');
      expect(badUuidRes.status).toBe(400);
    },
    30_000
  );
});

describe('6. Provider failure', () => {
  it(
    'returns 502 and persists exactly one FAILED row (with error_message, no storage coordinates)',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen Provider Failure Client');

      aiControl.mode = 'failure';
      const owner = await loginAs(TEST_USERS.OWNER);
      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(res.status).toBe(502);

      const rows = await pool.query('SELECT * FROM generated_outputs WHERE layout_plan_id = $1', [layoutPlanId]);
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].status).toBe('failed');
      expect(rows.rows[0].error_message).toBe('Simulated image provider outage');
      expect(rows.rows[0].storage_key).toBeNull();
      expect(rows.rows[0].prompt_snapshot).toBeTruthy();

      // The failed row stays visible through the listing API and can never be approved.
      const listRes = await owner.get(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.data[0].status).toBe('failed');

      const approveRes = await owner.post(`/api/visual-outputs/${rows.rows[0].id}/approve`);
      expect(approveRes.status).toBe(409);
    },
    30_000
  );

  it(
    'schema-violating provider payload is a 502 with one FAILED row, never a generated one',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen Invalid Payload Client');

      aiControl.mode = 'invalid_visual_payload';
      const owner = await loginAs(TEST_USERS.OWNER);
      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(res.status).toBe(502);
      expect(res.body.message).toMatch(/schema validation/);
      // Phase 3 Step 3: one automatic schema retry precedes the 502 (2 AI calls), and
      // the 'failed' row is written exactly ONCE — only after the FINAL attempt.
      expect(aiControl.imageCalls).toBe(2);

      const rows = await pool.query('SELECT * FROM generated_outputs WHERE layout_plan_id = $1', [layoutPlanId]);
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].status).toBe('failed');
      expect(rows.rows[0].error_message).toMatch(/schema validation/);
    },
    30_000
  );

  it(
    'schema-flake that recovers on the automatic retry produces a normal 201 with NO failed rows',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen N1 Retry Client');

      aiControl.mode = 'invalid_then_valid';
      const owner = await loginAs(TEST_USERS.OWNER);
      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);

      expect(res.status).toBe(201);
      expect(aiControl.imageCalls).toBe(2);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      for (const output of res.body.data as Array<Record<string, unknown>>) {
        expect(output.status).toBe('generated');
      }

      // The absorbed first attempt must NOT leave a phantom 'failed' row behind.
      const failedRows = await pool.query(
        "SELECT * FROM generated_outputs WHERE layout_plan_id = $1 AND status = 'failed'",
        [layoutPlanId]
      );
      expect(failedRows.rows.length).toBe(0);
    },
    30_000
  );
});

describe('7. Storage failure — a failed write is never recorded as generated', () => {
  it(
    'persists FAILED rows with error_message and no storage_key; a later re-run continues alternative_index',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen Storage Failure Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      storageControl.failPut = true;
      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      // Per-image storage failures are recorded per row and still returned (201), but
      // NO row may claim status 'generated'.
      expect(res.status).toBe(201);
      expect(res.body.total).toBe(2);
      for (const output of res.body.data as Array<Record<string, unknown>>) {
        expect(output.status).toBe('failed');
        expect(output.errorMessage).toMatch(/Simulated storage outage/);
        expect(output.storageKey).toBeUndefined();
        // A failed row has no file, so it must never carry a fileUrl.
        expect(output.fileUrl).toBeUndefined();
      }

      const failedRows = await pool.query(
        "SELECT * FROM generated_outputs WHERE layout_plan_id = $1 AND status = 'generated'",
        [layoutPlanId]
      );
      expect(failedRows.rows.length).toBe(0);

      // RE-RUN SEMANTICS: generation is deliberately NOT idempotent — a new run appends
      // a new alternative set, continuing the index after ALL prior rows (failed included).
      storageControl.failPut = false;
      const retryRes = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.map((o: { alternativeIndex: number }) => o.alternativeIndex)).toEqual([3, 4]);
      expect(retryRes.body.data.every((o: { status: string }) => o.status === 'generated')).toBe(true);

      const listRes = await owner.get(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(listRes.body.total).toBe(4);
    },
    30_000
  );
});

describe('8. Approve / reject lifecycle on generated outputs', () => {
  it(
    'OWNER approves a generated output once; re-approval and post-rejection flips are 409',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen Approve Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const postRes = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(postRes.status).toBe(201);
      const [first, second] = postRes.body.data as Array<{ id: string }>;

      const approveRes = await owner.post(`/api/visual-outputs/${first.id}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.approvalStatus).toBe('approved');
      expect(approveRes.body.data.approvedBy).toBeTruthy();
      expect(approveRes.body.data.approvedAt).toBeTruthy();

      // Approval is a one-shot decision from an open state.
      const reApproveRes = await owner.post(`/api/visual-outputs/${first.id}/approve`);
      expect(reApproveRes.status).toBe(409);

      // Reject without notes -> 'rejected'; a rejected output cannot then be approved.
      const rejectRes = await owner.post(`/api/visual-outputs/${second.id}/reject`);
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.approvalStatus).toBe('rejected');
      const approveRejectedRes = await owner.post(`/api/visual-outputs/${second.id}/approve`);
      expect(approveRejectedRes.status).toBe(409);
    },
    30_000
  );

  it(
    'reject with notes moves the output to revision_requested (still re-approvable)',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen Revision Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const postRes = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(postRes.status).toBe(201);
      const outputId = postRes.body.data[0].id as string;

      const rejectRes = await owner
        .post(`/api/visual-outputs/${outputId}/reject`)
        .send({ notes: 'Please brighten the background' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.approvalStatus).toBe('revision_requested');

      // revision_requested is still an open approval (mirrors layout_plans.approve()).
      const approveRes = await owner.post(`/api/visual-outputs/${outputId}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.approvalStatus).toBe('approved');
    },
    30_000
  );
});

describe('9. Protected file download — GET /api/visual-outputs/:id/file', () => {
  it(
    'streams a generated file with the right Content-Type; 401 unauthenticated; 403 without visual_generation:read; 404 unknown id',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen File Download Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const postRes = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(postRes.status).toBe(201);
      const [first, second] = postRes.body.data as Array<{ id: string; fileUrl: string }>;
      expect(first.fileUrl).toBe(`/api/visual-outputs/${first.id}/file`);

      // The persisted fileUrl serves the ACTUAL stored bytes with the row's mime type.
      const firstRes = await owner.get(first.fileUrl).responseType('blob');
      expect(firstRes.status).toBe(200);
      expect(firstRes.headers['content-type']).toContain('image/png');
      expect(Buffer.from(firstRes.body).toString()).toBe(FAKE_IMAGE_BYTES_1);

      const secondRes = await owner.get(second.fileUrl).responseType('blob');
      expect(secondRes.status).toBe(200);
      expect(secondRes.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.from(secondRes.body).toString()).toBe(FAKE_IMAGE_BYTES_2);

      // Same auth gates as every other visual_generation read.
      expect((await request(testServer.server).get(first.fileUrl)).status).toBe(401);

      const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
      const forbiddenRes = await contentManager.get(first.fileUrl);
      expect(forbiddenRes.status).toBe(403);
      expect(forbiddenRes.body.requiredPermission).toBe('visual_generation:read');

      // Unknown output id — mirrors GET /api/visual-outputs/:id.
      expect((await owner.get(`/api/visual-outputs/${SOME_UUID}/file`)).status).toBe(404);
    },
    30_000
  );

  it(
    'returns 404 for a failed row — no file was ever produced, and the row carries no fileUrl',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen File 404 Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      storageControl.failPut = true;
      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(res.status).toBe(201);

      for (const output of res.body.data as Array<{ id: string; status: string; fileUrl?: string }>) {
        expect(output.status).toBe('failed');
        expect(output.fileUrl).toBeUndefined();
        const fileRes = await owner.get(`/api/visual-outputs/${output.id}/file`);
        expect(fileRes.status).toBe(404);
        expect(fileRes.body.error).toBe('File not found');
      }
    },
    30_000
  );
});

describe('11. Monthly budget guard (go-live M2.1)', () => {
  it(
    'blocks generation with 402 once the client is over its monthly budget — and never calls the provider',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen Budget Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      // First run is under budget (guard disabled) and succeeds — 2 images generated.
      const firstRes = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(firstRes.status).toBe(201);
      expect(firstRes.body.total).toBe(2);

      // Enforce a ceiling the client has already blown: $1/image, $1.50 cap, 2 generated = $2.
      process.env.KIE_IMAGE_COST_USD = '1';
      process.env.CLIENT_MONTHLY_BUDGET_USD = '1.5';
      const callsBefore = aiControl.imageCalls;

      const blockedRes = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(blockedRes.status).toBe(402);
      expect(blockedRes.body.error).toBe('Payment Required');
      expect(blockedRes.body.message).toMatch(/budget/i);
      // The guard ran BEFORE the provider — no paid image call happened for the blocked run.
      expect(aiControl.imageCalls).toBe(callsBefore);

      // No new rows were written for the blocked run (still just the first run's 2).
      const rows = await pool.query('SELECT * FROM generated_outputs WHERE layout_plan_id = $1', [layoutPlanId]);
      expect(rows.rows.length).toBe(2);
    },
    30_000
  );

  it(
    'allows generation while comfortably under budget',
    async () => {
      const { layoutPlanId } = await createQaClearedLayoutPlan('Visual Gen Under Budget Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      process.env.KIE_IMAGE_COST_USD = '0.05';
      process.env.CLIENT_MONTHLY_BUDGET_USD = '100';

      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(res.status).toBe(201);
      expect(res.body.total).toBe(2);
    },
    30_000
  );
});

describe('10. Workflow-engine coverage lives in workflows.test.ts', () => {
  it('run_visual_generation binding + generated_output gate are covered end to end there (§11)', () => {
    // workflows.test.ts §11 drives the visual-generation workflow through start ->
    // production gate -> run_visual_generation -> route_generation -> user_approval
    // (approve one generated_output) -> save_visual -> completed, and asserts the
    // Postgres rows + workflow_approvals trail. Not duplicated here.
    expect(true).toBe(true);
  });
});
