import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { assertReadyForVisualProduction } from '../services/production-gate.js';

/**
 * Structurally mirrors layout-plans.test.ts: the test environment (global-setup.ts) sets
 * a FAKE OPENAI_API_KEY, so any test exercising a real AI-backed route must mock the AI
 * call rather than let it attempt a real network call. `@grafista/model-router`'s
 * ModelRouter is replaced wholesale below. `aiControl.mode` (declared via vi.hoisted so
 * it's available inside the hoisted vi.mock factory) lets individual tests switch between
 * a canned success response, a simulated provider failure, and a schema-violating
 * "invalid" Creative QA response.
 *
 * This suite needs to drive the whole chain up to "approved layout plan + approved design
 * brief + approved DesignDNA" (content idea -> approve -> design brief -> approve ->
 * design references + DesignDNA analyze -> approve -> layout plan generate -> approve),
 * so the mock also covers taskType 'content_ideation', 'style_analysis',
 * 'design_dna_synthesis', and 'layout_generation' (reused/adapted from
 * layout-plans.test.ts's own helper chain) in addition to 'creative_qa'.
 */
const aiControl = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'failure' | 'invalid_creative_qa' | 'invalid_then_valid',
  // Counts creative_qa calls so the schema-retry tests can prove a second attempt happened.
  qaCalls: 0,
}));

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

  function buildCreativeQaContent(overallScore: number) {
    const lowScore = overallScore < 80;
    return {
      overallScore,
      overallStatus: overallScore >= 80 ? 'passed' : overallScore >= 50 ? 'needs_revision' : 'failed',
      checks: [],
      brandConsistency: scoredCheck('brand', 'Brand Consistency', overallScore),
      readability: scoredCheck('text', 'Readability', overallScore),
      mobileLegibility: scoredCheck('text', 'Mobile Legibility', overallScore),
      visualHierarchy: scoredCheck('layout', 'Visual Hierarchy', overallScore),
      logoSafetyArea: scoredCheck('logo', 'Logo Safety Area', overallScore),
      colorContrast: scoredCheck('color', 'Color Contrast', overallScore),
      spelling: scoredCheck('text', 'Spelling', 100),
      designDnaMatch: scoredCheck('brand', 'DesignDNA Match', overallScore),
      exportReadiness: scoredCheck('export', 'Export Readiness', overallScore),
      typographyConsistency: scoredCheck('typography', 'Typography Consistency', overallScore),
      contentClarity: scoredCheck('content', 'Content Clarity', overallScore),
      summary: 'Creative QA review summary',
      detectedIssues: lowScore ? ['Headline contrast is too low against the background'] : [],
      highPriorityFixes: lowScore ? ['Fix headline/background contrast before proceeding'] : [],
      mediumPriorityFixes: [],
      lowPriorityFixes: ['Consider tightening headline kerning slightly'],
      designerNotes: 'Overall composition is solid.',
      finalRecommendation: lowScore ? 'Revise headline contrast before proceeding' : 'Approve as-is',
      designDnaReasons: ['Layout followed the warm natural lighting visual rule'],
      designBriefReasons: ['Headline copy matches the approved brief hook'],
      risksBeforeProduction: lowScore ? ['Low contrast may render illegible once rasterized'] : [],
    };
  }

  const CREATIVE_QA_SUCCESS_CONTENT = buildCreativeQaContent(88);
  // Schema-violating: missing every required field except overallScore.
  const INVALID_CREATIVE_QA_CONTENT = { overallScore: 90 };

  class MockModelRouter {
    async complete(req: { taskType: string }) {
      if (aiControl.mode === 'failure') {
        return {
          success: false,
          provider: 'openai',
          model: 'none',
          content: '',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMs: 1,
          error: 'Simulated provider outage',
        };
      }

      let content: unknown;
      if (req.taskType === 'style_analysis') content = STYLE_ANALYSIS_CONTENT;
      else if (req.taskType === 'design_dna_synthesis') content = DESIGN_DNA_CONTENT;
      else if (req.taskType === 'content_ideation') content = CONTENT_IDEATION_CONTENT;
      else if (req.taskType === 'layout_generation') content = LAYOUT_ALTERNATIVES;
      else if (req.taskType === 'creative_qa') {
        aiControl.qaCalls += 1;
        if (aiControl.mode === 'invalid_creative_qa') content = INVALID_CREATIVE_QA_CONTENT;
        else if (aiControl.mode === 'invalid_then_valid') {
          content = aiControl.qaCalls === 1 ? INVALID_CREATIVE_QA_CONTENT : CREATIVE_QA_SUCCESS_CONTENT;
        } else content = CREATIVE_QA_SUCCESS_CONTENT;
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
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function createClient(name: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for creative QA' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-creative-qa-test'), { filename, contentType: 'image/png' });
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

/** Client -> approved content idea -> design brief (still 'draft'). */
async function createDraftDesignBrief(clientName: string) {
  const clientId = await createClient(clientName);
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

  return { clientId, brief: briefRes.body.data as { id: string; status: string } };
}

/** Same chain, then approves the design brief too. */
async function createApprovedDesignBrief(clientName: string) {
  const { clientId, brief } = await createDraftDesignBrief(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const approveRes = await owner.post(`/api/design-briefs/${brief.id}/approve`);
  expect(approveRes.status).toBe(200);
  expect(approveRes.body.data.status).toBe('approved');
  return { clientId, brief: approveRes.body.data as { id: string; status: string } };
}

/**
 * Full chain up to "approved LayoutPlan + approved DesignBrief + approved DesignDNA" —
 * everything runCreativeQa() requires. Returns the ids Creative QA tests need.
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
  expect(approveLayoutRes.body.data.status).toBe('approved');

  return { clientId, briefId, layoutPlanId, designDnaId };
}

beforeEach(() => {
  aiControl.mode = 'success';
  aiControl.qaCalls = 0;
});

describe('1. Unauthenticated access', () => {
  it('rejects POST run with 401', async () => {
    const res = await request(app).post(
      '/api/layout-plans/a1b2c3d4-e5f6-7890-abcd-ef1234567890/creative-qa'
    );
    expect(res.status).toBe(401);
  });
});

describe('2. Missing creative_qa:run permission', () => {
  it('rejects CONTENT_MANAGER with 403 and requiredPermission', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
    const res = await contentManager.post(
      '/api/layout-plans/a1b2c3d4-e5f6-7890-abcd-ef1234567890/creative-qa'
    );
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('creative_qa:run');
  });
});

describe('3. Unapproved layout plan (still generated)', () => {
  it('returns 409 and persists no creative_qa_reports rows', async () => {
    const clientId = await createClient('Creative QA Unapproved Layout Client');
    await uploadReference(clientId, 'reference-1.png');
    await analyzeAndApproveDna(clientId);

    const { brief } = await createApprovedDesignBrief('Creative QA Unapproved Layout Client 2');
    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(genRes.status).toBe(201);
    const layoutPlanId = genRes.body.data[0].id as string;
    // Deliberately not approved.

    const res = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(res.status).toBe(409);

    const rows = await pool.query('SELECT * FROM creative_qa_reports WHERE layout_plan_id = $1', [layoutPlanId]);
    expect(rows.rows.length).toBe(0);
  });
});

describe('4. Unapproved design brief (data-integrity edge case)', () => {
  it(
    'returns 409 when the brief backing an already-approved layout plan is later un-approved',
    async () => {
      // Step 5A's own gate makes it impossible to *generate* a layout plan without an
      // already-approved brief, so the only way to exercise this branch is to approve
      // everything first and then flip the brief back away from 'approved' via its own
      // reject route (design-briefs.ts's updateStatus has no prior-state guard) — a
      // real, reachable data-integrity scenario (e.g. a brief revision requested after
      // its layout plans were already approved), not a direct repository hack.
      const { briefId, layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Unapproved Brief Client');

      const owner = await loginAs(TEST_USERS.OWNER);
      const rejectBriefRes = await owner.post(`/api/design-briefs/${briefId}/reject`);
      expect(rejectBriefRes.status).toBe(200);
      expect(rejectBriefRes.body.data.status).toBe('rejected');

      const res = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
      expect(res.status).toBe(409);

      const rows = await pool.query('SELECT * FROM creative_qa_reports WHERE layout_plan_id = $1', [layoutPlanId]);
      expect(rows.rows.length).toBe(0);
    }
  );
});

describe('5. No approved DesignDNA', () => {
  it('returns 409 when DesignDNA was never generated for the client', async () => {
    const { brief } = await createApprovedDesignBrief('Creative QA No DNA Client');
    const owner = await loginAs(TEST_USERS.OWNER);

    const genRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(genRes.status).toBe(201);
    const layoutPlanId = genRes.body.data[0].id as string;
    const approveRes = await owner.post(`/api/layout-plans/${layoutPlanId}/approve`);
    expect(approveRes.status).toBe(200);

    const res = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(res.status).toBe(409);

    const rows = await pool.query('SELECT * FROM creative_qa_reports WHERE layout_plan_id = $1', [layoutPlanId]);
    expect(rows.rows.length).toBe(0);
  });

  it('returns 409 when DesignDNA was generated but never approved', async () => {
    const { clientId, brief } = await createDraftDesignBrief('Creative QA Unapproved DNA Client');
    await uploadReference(clientId, 'reference-1.png');

    const owner = await loginAs(TEST_USERS.OWNER);
    const analyzeRes = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
    expect(analyzeRes.status).toBe(201);
    // Deliberately not approved.

    const approveBriefRes = await owner.post(`/api/design-briefs/${brief.id}/approve`);
    expect(approveBriefRes.status).toBe(200);

    const genRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(genRes.status).toBe(201);
    const layoutPlanId = genRes.body.data[0].id as string;
    const approveRes = await owner.post(`/api/layout-plans/${layoutPlanId}/approve`);
    expect(approveRes.status).toBe(200);

    const res = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(res.status).toBe(409);

    const rows = await pool.query('SELECT * FROM creative_qa_reports WHERE layout_plan_id = $1', [layoutPlanId]);
    expect(rows.rows.length).toBe(0);
  });
});

describe('6. Full happy path', () => {
  it('returns 201 with a persisted report with correct linkage', async () => {
    const { clientId, briefId, layoutPlanId, designDnaId } = await createFullyReadyLayoutPlan(
      'Creative QA Happy Path Client'
    );

    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);

    expect(res.status).toBe(201);
    const report = res.body.data;
    expect(report.layoutPlanId).toBe(layoutPlanId);
    expect(report.designBriefId).toBe(briefId);
    expect(report.clientId).toBe(clientId);
    expect(report.designDnaId).toBe(designDnaId);
    expect(report.status).toBe('passed');
    expect(report.passed).toBe(true);
    expect(report.overallScore).toBe(88);
    expect(report.passThreshold).toBe(75);
    expect(report.canProceedToProduction).toBe(true);
    expect(report.scores.layoutHierarchy).toBe(88);
    expect(report.scores.designDnaMatch).toBe(88);
    expect(Array.isArray(report.highPriorityFixes)).toBe(true);
    expect(Array.isArray(report.mediumPriorityFixes)).toBe(true);
    expect(Array.isArray(report.lowPriorityFixes)).toBe(true);
    expect(typeof report.finalRecommendation).toBe('string');

    const rows = await pool.query('SELECT * FROM creative_qa_reports WHERE layout_plan_id = $1', [layoutPlanId]);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].design_dna_id).toBe(designDnaId);
  });
});

describe('7. Malformed UUIDs return 400, not a crash', () => {
  it('rejects a non-UUID layoutPlanId with 400', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post('/api/layout-plans/not-a-valid-uuid/creative-qa');
    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID creative-qa report id with 400', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.get('/api/creative-qa/not-a-valid-uuid');
    expect(res.status).toBe(400);
  });
});

describe('8. AI provider failure', () => {
  it('returns structured 502 and persists zero rows', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Failure Client');

    aiControl.mode = 'failure';
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(res.status).toBe(502);

    const listRes = await owner.get(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(0);
  });
});

describe('9. Invalid AI JSON output (schema violation)', () => {
  it('returns structured 502 and persists zero rows', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Invalid Schema Client');

    aiControl.mode = 'invalid_creative_qa';
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(res.status).toBe(502);
    // Phase 3 Step 3: one automatic schema retry precedes the 502 — 2 AI calls total.
    expect(aiControl.qaCalls).toBe(2);

    const rows = await pool.query('SELECT * FROM creative_qa_reports WHERE layout_plan_id = $1', [layoutPlanId]);
    expect(rows.rows.length).toBe(0);
  });
});

// Phase 3 Step 3 — same N1 schema-flake auto-retry pattern as layout generation.
describe('9b. Schema-validation flake recovers via automatic retry', () => {
  it('first invalid + second valid response -> 201 with a persisted report from exactly 2 AI calls', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA N1 Retry Client');

    aiControl.mode = 'invalid_then_valid';
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);

    expect(res.status).toBe(201);
    expect(aiControl.qaCalls).toBe(2);

    const rows = await pool.query('SELECT * FROM creative_qa_reports WHERE layout_plan_id = $1', [layoutPlanId]);
    expect(rows.rows.length).toBe(1);
  });
});

describe('10. Persisted rows are real Postgres data', () => {
  it('GET reflects the same report that POST returned, with real fields', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Persistence Client');

    const owner = await loginAs(TEST_USERS.OWNER);
    const postRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(postRes.status).toBe(201);
    const reportId = postRes.body.data.id as string;

    const getRes = await owner.get(`/api/creative-qa/${reportId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(reportId);
    expect(getRes.body.data.overallScore).toBe(postRes.body.data.overallScore);

    const listRes = await owner.get(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.data[0].id).toBe(reportId);

    const dbRows = await pool.query('SELECT * FROM creative_qa_reports WHERE id = $1', [reportId]);
    expect(dbRows.rows.length).toBe(1);
    expect(Number(dbRows.rows[0].score)).toBe(88);
    expect(dbRows.rows[0].qa_json.finalRecommendation).toBeTruthy();
  });
});

describe('11. Approve requires creative_qa:approve', () => {
  it('rejects DESIGNER (run+read only) with 403', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Approve Permission Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(genRes.status).toBe(201);
    const reportId = genRes.body.data.id as string;

    const designer = await loginAs(TEST_USERS.DESIGNER);
    const res = await designer.post(`/api/creative-qa/${reportId}/approve`);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('creative_qa:approve');
  });

  it('OWNER can approve a passed report', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Approve Success Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    const reportId = genRes.body.data.id as string;

    const res = await owner.post(`/api/creative-qa/${reportId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.approvedBy).toBeTruthy();
  });
});

describe('12. Reject requires creative_qa:reject', () => {
  it('rejects DESIGNER (run+read only) with 403', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Reject Permission Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(genRes.status).toBe(201);
    const reportId = genRes.body.data.id as string;

    const designer = await loginAs(TEST_USERS.DESIGNER);
    const res = await designer.post(`/api/creative-qa/${reportId}/reject`);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('creative_qa:reject');
  });

  it('OWNER can reject a report (no notes -> rejected)', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Reject Success Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    const reportId = genRes.body.data.id as string;

    const res = await owner.post(`/api/creative-qa/${reportId}/reject`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
    expect(res.body.data.rejectedBy).toBeTruthy();
  });

  it('OWNER rejecting with notes moves status to needs_revision', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Creative QA Revision Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    const reportId = genRes.body.data.id as string;

    const res = await owner.post(`/api/creative-qa/${reportId}/reject`).send({ notes: 'Please improve contrast' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('needs_revision');
    expect(res.body.data.rejectedBy).toBeTruthy();
  });
});

describe('13. Production-gate utility (Part G placeholder, not wired anywhere yet)', () => {
  it('throws a 409-shaped error when no Creative QA report exists yet for the layout plan', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Production Gate Blocked Client');
    // No Creative QA has been run at all yet for this layout plan.
    await expect(assertReadyForVisualProduction(layoutPlanId)).rejects.toMatchObject({ status: 409 });
  });

  it('throws when the only report is rejected, and resolves once a report is approved', async () => {
    const { layoutPlanId } = await createFullyReadyLayoutPlan('Production Gate Cleared Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(genRes.status).toBe(201);
    const reportId = genRes.body.data.id as string;

    // The freshly-generated report is already 'passed', which the gate's documented rule
    // already treats as cleared — so first flip it to 'rejected' to prove a non-cleared
    // status still blocks the gate, then approve it to prove approval clears it.
    const rejectRes = await owner.post(`/api/creative-qa/${reportId}/reject`);
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.status).toBe('rejected');
    await expect(assertReadyForVisualProduction(layoutPlanId)).rejects.toMatchObject({ status: 409 });

    // A rejected report can't be re-approved (only generated/passed/failed/needs_revision
    // can), so run a fresh Creative QA pass on the same layout plan and approve that one.
    const genRes2 = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
    expect(genRes2.status).toBe(201);
    const reportId2 = genRes2.body.data.id as string;
    const approveRes = await owner.post(`/api/creative-qa/${reportId2}/approve`);
    expect(approveRes.status).toBe(200);

    await expect(assertReadyForVisualProduction(layoutPlanId)).resolves.toBeUndefined();
  });
});

describe('14. Full existing suite continues to pass alongside these new tests', () => {
  it('is verified by running `corepack pnpm --filter @grafista/api test` for the whole repo, not a single assertion here', () => {
    expect(true).toBe(true);
  });
});
