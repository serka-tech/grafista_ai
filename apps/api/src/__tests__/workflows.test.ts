import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { PIPELINE_ORDER } from '../workflows/definition-loader.js';

/**
 * Workflow engine + routes tests (Phase 2 Step 6). Structurally mirrors
 * creative-qa.test.ts: the test environment sets FAKE AI keys, so every
 * AI-backed step mocks `@grafista/model-router` wholesale. `aiControl.mode`
 * (vi.hoisted so the hoisted vi.mock factory can read it) switches between a
 * canned success response, a simulated provider failure, and a low-scoring
 * Creative QA report (exercises the qa_failed gate-arrival rule).
 *
 * Workflow runs are driven exclusively through the real HTTP surface
 * (start → advance → approve-step/reject-step), and every persistence claim
 * is verified against PostgreSQL with pool.query — run state must live in
 * the database, not in process memory.
 */
const aiControl = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'failure' | 'low_score_creative_qa',
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
  const CREATIVE_QA_LOW_SCORE_CONTENT = buildCreativeQaContent(30);

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
        content = aiControl.mode === 'low_score_creative_qa' ? CREATIVE_QA_LOW_SCORE_CONTENT : CREATIVE_QA_SUCCESS_CONTENT;
      } else if (req.taskType === 'image_generation') {
        content = {
          images: [
            {
              imageBase64: Buffer.from('fake-generated-image-bytes-alternative-1').toString('base64'),
              mimeType: 'image/png',
              width: 1080,
              height: 1080,
            },
            {
              imageBase64: Buffer.from('fake-generated-image-bytes-alternative-2').toString('base64'),
              mimeType: 'image/png',
              width: 1080,
              height: 1080,
            },
          ],
        };
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

type Agent = ReturnType<typeof request.agent>;

const SEED_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

async function loginAs(email: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status, `login as ${email} failed: ${JSON.stringify(res.body)}`).toBe(200);
  return agent;
}

async function createClient(name: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for workflows' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-workflow-test'), { filename, contentType: 'image/png' });
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

/** Client -> approved content idea -> approved design brief (all via the existing routes). */
async function createApprovedDesignBrief(clientName: string) {
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
  const briefId = briefRes.body.data.id as string;
  const approveBriefRes = await owner.post(`/api/design-briefs/${briefId}/approve`);
  expect(approveBriefRes.status).toBe(200);

  return { clientId, ideaId, briefId };
}

/**
 * Full chain up to "approved LayoutPlan + approved DesignBrief + approved DesignDNA" —
 * everything runCreativeQa()/the production gate requires (adapted from creative-qa.test.ts).
 */
async function createFullyReadyLayoutPlan(clientName: string) {
  const clientId = await createClient(clientName);
  await uploadReference(clientId, 'reference-1.png');
  await analyzeAndApproveDna(clientId);

  const owner = await loginAs(TEST_USERS.OWNER);
  const ideaRes = await owner
    .post(`/api/clients/${clientId}/content-ideas`)
    .send({ platform: 'instagram_post', format: 'single_image', topic: 'Seasonal harvest', optionCount: 1 });
  expect(ideaRes.status, `content idea generation failed: ${JSON.stringify(ideaRes.body)}`).toBe(201);
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

  return { clientId, ideaId, briefId, layoutPlanId };
}

/** Runs Creative QA on the plan via the existing route and approves the report. */
async function approveCreativeQaFor(layoutPlanId: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
  expect(genRes.status).toBe(201);
  const reportId = genRes.body.data.id as string;
  const approveRes = await owner.post(`/api/creative-qa/${reportId}/approve`);
  expect(approveRes.status).toBe(200);
  return reportId;
}

async function startRun(agent: Agent, workflowId: string, clientId: string, input?: Record<string, unknown>) {
  const res = await agent.post(`/api/workflows/${workflowId}/start`).send({ clientId, input });
  expect(res.status).toBe(201);
  return res.body.data as { run: Record<string, any>; steps: Array<Record<string, any>> };
}

/**
 * Advances the run one step at a time until it leaves 'in_progress' (gate wait,
 * completion, qa_failed, or blocked_future_feature) and returns the final payload.
 */
async function advanceToPause(agent: Agent, runId: string, maxSteps = 15) {
  for (let i = 0; i < maxSteps; i++) {
    const res = await agent.post(`/api/workflow-runs/${runId}/advance`).send({});
    expect(res.status).toBe(200);
    const data = res.body.data as { run: Record<string, any>; steps: Array<Record<string, any>> };
    if (data.run.status !== 'in_progress') return data;
  }
  throw new Error(`Run ${runId} is still in_progress after ${maxSteps} advance calls`);
}

function stepByStepId(steps: Array<Record<string, any>>, stepId: string) {
  const step = steps.find((s) => s.stepId === stepId);
  expect(step, `step ${stepId} should exist`).toBeDefined();
  return step!;
}

beforeEach(() => {
  aiControl.mode = 'success';
});

describe('1. Workflow catalog API serves the validated definitions', () => {
  it('lists the ten definitions in pipeline order with executable summaries', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.get('/api/workflows');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.data.map((d: { workflowId: string }) => d.workflowId)).toEqual([...PIPELINE_ORDER]);

    const visual = res.body.data.find((d: { workflowId: string }) => d.workflowId === 'visual-generation');
    expect(visual.executable.supported).toBe(true);
    expect(visual.executable.futureSteps).toEqual([]);
    expect(visual.executable.gateSteps).toContain('user_approval');

    const psd = res.body.data.find((d: { workflowId: string }) => d.workflowId === 'photoshop-production');
    expect(psd.executable.supported).toBe(false);
    expect(psd.executable.futureSteps).toContain('send_to_photoshop');

    const styleLib = res.body.data.find((d: { workflowId: string }) => d.workflowId === 'style-library-ingestion');
    expect(styleLib.executable.supported).toBe(true);
    expect(styleLib.executable.gateSteps).toEqual(['user_approval']);
    expect(styleLib.stepCount).toBe(9);
  });

  it('serves a full annotated definition with binding info and resolved skills', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.get('/api/workflows/style-library-ingestion');
    expect(res.status).toBe(200);
    expect(res.body.data.steps.length).toBe(9);

    const analyzeStep = res.body.data.steps.find((s: { step_id: string }) => s.step_id === 'analyze_styles');
    expect(analyzeStep.binding.bindingKind).toBe('run_design_dna_analysis');
    expect(analyzeStep.binding.requiredPermission).toBe('design_dna:run');
    expect(analyzeStep.binding.skillIds).toContain('style-analysis');

    const skillIds = res.body.data.skills.map((s: { id: string }) => s.id);
    expect(skillIds).toContain('style-analysis');
    expect(res.body.data.skills[0].whenToUse.length).toBeGreaterThan(0);

    const missing = await owner.get('/api/workflows/unknown-workflow');
    expect(missing.status).toBe(404);
  });
});

describe('2. Unauthenticated access', () => {
  it('rejects start and run listing with 401', async () => {
    const startRes = await request(app)
      .post('/api/workflows/style-library-ingestion/start')
      .send({ clientId: SEED_CLIENT_ID });
    expect(startRes.status).toBe(401);

    const listRes = await request(app).get('/api/workflow-runs');
    expect(listRes.status).toBe(401);
  });
});

describe('3. Missing workflow permissions', () => {
  it('rejects CONTENT_MANAGER start with 403 and requiredPermission workflows:start', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
    const res = await contentManager
      .post('/api/workflows/client-onboarding/start')
      .send({ clientId: SEED_CLIENT_ID });
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('workflows:start');
  });

  it('rejects CONTENT_MANAGER approve-step with 403 and requiredPermission workflows:approve', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
    const res = await contentManager.post(`/api/workflow-runs/${SEED_CLIENT_ID}/approve-step`).send({});
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('workflows:approve');
  });

  it('rejects DESIGNER cancel with 403 and requiredPermission workflows:cancel', async () => {
    const designer = await loginAs(TEST_USERS.DESIGNER);
    const res = await designer.post(`/api/workflow-runs/${SEED_CLIENT_ID}/cancel`).send({});
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('workflows:cancel');
  });
});

describe('4. Starting a run persists real PostgreSQL rows', () => {
  it('OWNER start returns 201 and workflow_runs + workflow_steps rows exist', async () => {
    const clientId = await createClient('Workflow Start Persistence Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const { run, steps } = await startRun(owner, 'client-onboarding', clientId);

    expect(run.status).toBe('in_progress');
    expect(run.currentStepId).toBe('create_client');
    expect(steps.length).toBe(7);

    const runRows = await pool.query('SELECT * FROM workflow_runs WHERE id = $1', [run.id]);
    expect(runRows.rows.length).toBe(1);
    expect(runRows.rows[0].workflow_id).toBe('client-onboarding');
    expect(runRows.rows[0].status).toBe('in_progress');
    expect(runRows.rows[0].client_id).toBe(clientId);
    // Definition snapshot + auto-filled client inputs are real JSONB, not derived on read.
    expect(runRows.rows[0].definition_snapshot.workflow_id).toBe('client-onboarding');
    expect(runRows.rows[0].definition_snapshot.steps.length).toBe(7);
    expect(runRows.rows[0].input_json.client_id).toBe(clientId);
    expect(runRows.rows[0].input_json.client_name).toBe('Workflow Start Persistence Client');

    const stepRows = await pool.query(
      'SELECT * FROM workflow_steps WHERE workflow_run_id = $1 ORDER BY step_order ASC',
      [run.id]
    );
    expect(stepRows.rows.length).toBe(run.definitionSnapshot.steps.length);
    expect(stepRows.rows.map((r) => r.step_id)).toEqual([
      'create_client', 'upload_assets', 'validate_assets', 'generate_brand_profile',
      'generate_brand_rules', 'user_approval', 'save_profile',
    ]);
    expect(stepRows.rows.every((r) => r.status === 'pending')).toBe(true);
    expect(stepRows.rows.find((r) => r.step_id === 'user_approval')!.required_approval).toBe(true);
  });

  it('CREATIVE_DIRECTOR can start a run too (201)', async () => {
    const clientId = await createClient('Workflow CD Start Client');
    const director = await loginAs(TEST_USERS.CREATIVE_DIRECTOR);
    const { run } = await startRun(director, 'client-onboarding', clientId);
    expect(run.status).toBe('in_progress');

    const rows = await pool.query('SELECT started_by FROM workflow_runs WHERE id = $1', [run.id]);
    expect(rows.rows.length).toBe(1);
  });

  it('missing required workflow inputs are rejected with 400 listing the keys', async () => {
    const clientId = await createClient('Workflow Missing Inputs Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post('/api/workflows/content-generation/start').send({ clientId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Missing required workflow inputs: campaign_goal, platform/);
  });

  it('unknown workflow id -> 404, invalid body -> 400 with zod issues', async () => {
    const clientId = await createClient('Workflow Unknown Id Client');
    const owner = await loginAs(TEST_USERS.OWNER);

    const notFoundRes = await owner.post('/api/workflows/no-such-workflow/start').send({ clientId });
    expect(notFoundRes.status).toBe(404);

    const badBodyRes = await owner.post('/api/workflows/client-onboarding/start').send({ clientId: 'not-a-uuid' });
    expect(badBodyRes.status).toBe(400);
    expect(Array.isArray(badBodyRes.body.issues)).toBe(true);
  });
});

describe('5. Approval gate pauses style-library-ingestion (DesignDNA gate)', () => {
  it(
    'waits at user_approval, blocks advance, and CREATIVE_DIRECTOR approval really approves the DesignDNA',
    async () => {
      const clientId = await createClient('Workflow DNA Gate Client');
      await uploadReference(clientId, 'reference-1.png');

      const owner = await loginAs(TEST_USERS.OWNER);
      const { run } = await startRun(owner, 'style-library-ingestion', clientId, {
        design_files: ['reference-1.png'],
      });

      const paused = await advanceToPause(owner, run.id);
      expect(paused.run.status).toBe('waiting_for_approval');
      expect(paused.run.currentStepId).toBe('user_approval');
      expect(stepByStepId(paused.steps, 'upload_references').status).toBe('completed');
      expect(stepByStepId(paused.steps, 'upload_psd').status).toBe('skipped');
      expect(stepByStepId(paused.steps, 'upload_psd').outputJson.skipped).toBe(true);
      expect(stepByStepId(paused.steps, 'analyze_styles').status).toBe('completed');
      expect(stepByStepId(paused.steps, 'analyze_styles').outputJson.designDnaId).toBeTruthy();
      expect(stepByStepId(paused.steps, 'generate_dna').status).toBe('completed');
      expect(stepByStepId(paused.steps, 'user_approval').status).toBe('waiting_for_approval');

      // The gate cannot be skipped by advancing.
      const advanceRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(advanceRes.status).toBe(409);
      expect(advanceRes.body.message).toMatch(/approval gate/);

      // Roles without workflows:approve cannot decide the gate.
      const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
      const cmRes = await contentManager.post(`/api/workflow-runs/${run.id}/approve-step`).send({});
      expect(cmRes.status).toBe(403);
      expect(cmRes.body.requiredPermission).toBe('workflows:approve');

      const designer = await loginAs(TEST_USERS.DESIGNER);
      const designerRes = await designer.post(`/api/workflow-runs/${run.id}/approve-step`).send({});
      expect(designerRes.status).toBe(403);
      expect(designerRes.body.requiredPermission).toBe('workflows:approve');

      // The domain entity is still untouched while the gate waits.
      const dnaBefore = await pool.query(
        'SELECT status FROM design_dna WHERE client_id = $1 ORDER BY version DESC LIMIT 1',
        [clientId]
      );
      expect(dnaBefore.rows[0].status).toBe('generated');

      // CREATIVE_DIRECTOR approves — the REAL DesignDNA row flips to approved.
      const director = await loginAs(TEST_USERS.CREATIVE_DIRECTOR);
      const approveRes = await director.post(`/api/workflow-runs/${run.id}/approve-step`).send({});
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.run.status).toBe('in_progress');
      const approvedGate = stepByStepId(approveRes.body.data.steps, 'user_approval');
      expect(approvedGate.status).toBe('approved');
      expect(approvedGate.approvedBy).toBeTruthy();

      const dnaAfter = await pool.query(
        'SELECT status, approved_by FROM design_dna WHERE client_id = $1 ORDER BY version DESC LIMIT 1',
        [clientId]
      );
      expect(dnaAfter.rows[0].status).toBe('approved');
      expect(dnaAfter.rows[0].approved_by).toBeTruthy();

      const approvalRows = await pool.query('SELECT * FROM workflow_approvals WHERE workflow_run_id = $1', [run.id]);
      expect(approvalRows.rows.length).toBe(1);
      expect(approvalRows.rows[0].decision).toBe('approved');
      expect(approvalRows.rows[0].entity_type).toBe('design_dna');

      // Remaining steps run through and the run completes.
      const done = await advanceToPause(owner, run.id);
      expect(done.run.status).toBe('completed');
      expect(stepByStepId(done.steps, 'learn_from_corrections').status).toBe('skipped');
      expect(stepByStepId(done.steps, 'save_dna').status).toBe('completed');

      const runRows = await pool.query('SELECT status, completed_at FROM workflow_runs WHERE id = $1', [run.id]);
      expect(runRows.rows[0].status).toBe('completed');
      expect(runRows.rows[0].completed_at).not.toBeNull();
    },
    30_000
  );
});

describe('6. approve-step / reject-step with no gate waiting -> 409', () => {
  it('rejects decisions while the current step is an executable step', async () => {
    const clientId = await createClient('Workflow No Gate Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const { run } = await startRun(owner, 'client-onboarding', clientId);

    const approveRes = await owner.post(`/api/workflow-runs/${run.id}/approve-step`).send({});
    expect(approveRes.status).toBe(409);
    expect(approveRes.body.message).toMatch(/No step is waiting for approval/);

    const rejectRes = await owner.post(`/api/workflow-runs/${run.id}/reject-step`).send({});
    expect(rejectRes.status).toBe(409);
    expect(rejectRes.body.message).toMatch(/No step is waiting for approval/);
  });
});

describe('7. Design-brief gate cannot be skipped and approval flips the real brief', () => {
  it(
    'pauses at user_approval, 409s advance, then completes after approval',
    async () => {
      const clientId = await createClient('Workflow Brief Gate Client');
      const owner = await loginAs(TEST_USERS.OWNER);

      const ideaRes = await owner
        .post(`/api/clients/${clientId}/content-ideas`)
        .send({ platform: 'instagram_post', format: 'single_image', topic: 'Seasonal harvest', optionCount: 1 });
      expect(ideaRes.status).toBe(201);
      const ideaId = ideaRes.body.data[0].id as string;
      const approveIdeaRes = await owner.post(`/api/content-ideas/${ideaId}/approve`);
      expect(approveIdeaRes.status).toBe(200);

      const { run } = await startRun(owner, 'design-brief', clientId, { content_idea_id: ideaId });
      const paused = await advanceToPause(owner, run.id);
      expect(paused.run.status).toBe('waiting_for_approval');
      expect(paused.run.currentStepId).toBe('user_approval');
      expect(stepByStepId(paused.steps, 'select_references').status).toBe('skipped');
      const briefId = stepByStepId(paused.steps, 'generate_brief').outputJson.designBriefId as string;
      expect(briefId).toBeTruthy();

      const advanceRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(advanceRes.status).toBe(409);
      expect(advanceRes.body.message).toMatch(/approval gate/);

      const director = await loginAs(TEST_USERS.CREATIVE_DIRECTOR);
      const approveRes = await director.post(`/api/workflow-runs/${run.id}/approve-step`).send({});
      expect(approveRes.status).toBe(200);

      const briefRows = await pool.query('SELECT status FROM design_briefs WHERE id = $1', [briefId]);
      expect(briefRows.rows[0].status).toBe('approved');

      const done = await advanceToPause(owner, run.id);
      expect(done.run.status).toBe('completed');
      expect(stepByStepId(done.steps, 'save_brief').status).toBe('completed');
    },
    30_000
  );
});

describe('8. Reject at the layout gate -> revision loop (on_reject return_to_step_2)', () => {
  it(
    'resets steps back to generate_layouts, really rejects the plan, and the loop can finish',
    async () => {
      const { briefId } = await createApprovedDesignBrief('Workflow Layout Reject Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const { run } = await startRun(owner, 'layout-generation', (await pool.query(
        'SELECT client_id FROM design_briefs WHERE id = $1', [briefId]
      )).rows[0].client_id, { design_brief_id: briefId });

      const paused = await advanceToPause(owner, run.id);
      expect(paused.run.status).toBe('waiting_for_approval');
      const firstPlans = stepByStepId(paused.steps, 'generate_layouts').outputJson.layoutPlans as Array<{ id: string }>;
      expect(firstPlans.length).toBe(2);

      // Gate skipping impossible (layout gate).
      const advanceRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(advanceRes.status).toBe(409);

      // Engine validates the reject payload before touching anything.
      const noIdRes = await owner.post(`/api/workflow-runs/${run.id}/reject-step`).send({ notes: 'eksik' });
      expect(noIdRes.status).toBe(400);
      expect(noIdRes.body.message).toMatch(/layoutPlanId is required/);

      const rejectRes = await owner
        .post(`/api/workflow-runs/${run.id}/reject-step`)
        .send({ layoutPlanId: firstPlans[0].id, notes: 'Kompozisyon zayıf' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.run.status).toBe('in_progress');
      expect(rejectRes.body.data.run.currentStepId).toBe('generate_layouts');

      const steps = rejectRes.body.data.steps as Array<Record<string, any>>;
      expect(stepByStepId(steps, 'load_brief').status).toBe('completed');
      for (const stepId of ['generate_layouts', 'qa_check', 'present_alternatives', 'user_approval']) {
        expect(stepByStepId(steps, stepId).status).toBe('pending');
        expect(stepByStepId(steps, stepId).revisionCount).toBe(1);
      }

      // Same semantics as POST /api/layout-plans/:id/reject: notes -> needs_revision.
      const planRows = await pool.query('SELECT status FROM layout_plans WHERE id = $1', [firstPlans[0].id]);
      expect(planRows.rows[0].status).toBe('needs_revision');
      const approvalRows = await pool.query('SELECT decision FROM workflow_approvals WHERE workflow_run_id = $1', [run.id]);
      expect(approvalRows.rows.map((r) => r.decision)).toEqual(['rejected']);

      // The revision loop is really executable: regenerate, approve one of the NEW plans, finish.
      const secondPause = await advanceToPause(owner, run.id);
      expect(secondPause.run.status).toBe('waiting_for_approval');
      const secondPlans = stepByStepId(secondPause.steps, 'generate_layouts').outputJson.layoutPlans as Array<{ id: string }>;
      expect(secondPlans.map((p) => p.id)).not.toContain(firstPlans[0].id);

      const approveRes = await owner
        .post(`/api/workflow-runs/${run.id}/approve-step`)
        .send({ layoutPlanId: secondPlans[0].id });
      expect(approveRes.status).toBe(200);

      const done = await advanceToPause(owner, run.id);
      expect(done.run.status).toBe('completed');

      const approvedPlanRows = await pool.query('SELECT status FROM layout_plans WHERE id = $1', [secondPlans[0].id]);
      expect(approvedPlanRows.rows[0].status).toBe('approved');
    },
    30_000
  );
});

describe('9. Reject at the creative-qa gate (no usable on_reject) -> run failed', () => {
  it(
    'fails the run with a clear error_json and really rejects the QA report',
    async () => {
      const { briefId, layoutPlanId, clientId } = await createFullyReadyLayoutPlan('Workflow QA Reject Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const { run } = await startRun(owner, 'creative-qa', clientId, {
        design_brief_id: briefId,
        layout_plan_id: layoutPlanId,
      });

      const paused = await advanceToPause(owner, run.id);
      expect(paused.run.status).toBe('waiting_for_approval');
      const reportId = stepByStepId(paused.steps, 'brand_consistency').outputJson.creativeQaReportId as string;
      expect(reportId).toBeTruthy();
      // Facts were read from the single report — recommendations skipped at score 88.
      expect(stepByStepId(paused.steps, 'generate_score').outputJson.overallScore).toBe(88);
      expect(stepByStepId(paused.steps, 'revision_recommendations').status).toBe('skipped');

      const rejectRes = await owner.post(`/api/workflow-runs/${run.id}/reject-step`).send({});
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.run.status).toBe('failed');
      expect(rejectRes.body.data.run.errorJson.reason).toBe('step_rejected');
      expect(rejectRes.body.data.run.errorJson.onReject).toBeNull();
      expect(rejectRes.body.data.run.errorJson.message).toMatch(/revizyon döngüsü tanımlamıyor/);

      const reportRows = await pool.query('SELECT status FROM creative_qa_reports WHERE id = $1', [reportId]);
      expect(reportRows.rows[0].status).toBe('rejected');

      const advanceRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(advanceRes.status).toBe(409);
      expect(advanceRes.body.message).toMatch(/has failed/);
    },
    30_000
  );
});

describe('10. Creative QA arrival rule — failed report (<50) parks the run as qa_failed', () => {
  it(
    'never opens the gate: run qa_failed, approve-step and advance both 409',
    async () => {
      const { briefId, layoutPlanId, clientId } = await createFullyReadyLayoutPlan('Workflow QA Failed Client');
      aiControl.mode = 'low_score_creative_qa';

      const owner = await loginAs(TEST_USERS.OWNER);
      const { run } = await startRun(owner, 'creative-qa', clientId, {
        design_brief_id: briefId,
        layout_plan_id: layoutPlanId,
      });

      const paused = await advanceToPause(owner, run.id);
      expect(paused.run.status).toBe('qa_failed');
      expect(paused.run.errorJson.reason).toBe('qa_score_below_50');
      expect(paused.run.errorJson.score).toBe(30);
      // At score 30 the recommendations step records the real fixes instead of skipping.
      expect(stepByStepId(paused.steps, 'revision_recommendations').status).toBe('completed');
      // The gate itself never opened.
      expect(stepByStepId(paused.steps, 'user_approval').status).toBe('pending');

      const approveRes = await owner.post(`/api/workflow-runs/${run.id}/approve-step`).send({});
      expect(approveRes.status).toBe(409);
      expect(approveRes.body.message).toMatch(/No step is waiting for approval/);

      const advanceRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(advanceRes.status).toBe(409);
      expect(advanceRes.body.message).toMatch(/Creative QA/);
    },
    30_000
  );
});

describe('11. Production gate — visual-generation', () => {
  it(
    'fails the run when no Creative QA report cleared the layout plan',
    async () => {
      const { briefId, layoutPlanId, clientId } = await createFullyReadyLayoutPlan('Workflow Visual Blocked Client');
      // Deliberately NO Creative QA run for this plan.

      const owner = await loginAs(TEST_USERS.OWNER);
      const { run } = await startRun(owner, 'visual-generation', clientId, {
        design_brief_id: briefId,
        layout_plan_id: layoutPlanId,
      });

      const advanceRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(advanceRes.status).toBe(409);
      expect(advanceRes.body.message).toMatch(/Creative QA/);

      const runRows = await pool.query('SELECT status, error_json FROM workflow_runs WHERE id = $1', [run.id]);
      expect(runRows.rows[0].status).toBe('failed');
      expect(runRows.rows[0].error_json.pipelineState).toBe('blocked_by_qa');
      expect(runRows.rows[0].error_json.message).toMatch(/Creative QA/);

      const stepRows = await pool.query(
        "SELECT status FROM workflow_steps WHERE workflow_run_id = $1 AND step_id = 'check_existing'",
        [run.id]
      );
      expect(stepRows.rows[0].status).toBe('failed');
    },
    30_000
  );

  it(
    'with an approved QA report the gate clears, real visuals are generated, and gate approval completes the run',
    async () => {
      const { briefId, layoutPlanId, clientId } = await createFullyReadyLayoutPlan('Workflow Visual Cleared Client');
      await approveCreativeQaFor(layoutPlanId);

      const owner = await loginAs(TEST_USERS.OWNER);
      const { run } = await startRun(owner, 'visual-generation', clientId, {
        design_brief_id: briefId,
        layout_plan_id: layoutPlanId,
      });

      const paused = await advanceToPause(owner, run.id);
      expect(paused.run.status).toBe('waiting_for_approval');
      expect(paused.run.currentStepId).toBe('user_approval');
      expect(stepByStepId(paused.steps, 'check_existing').status).toBe('completed');
      expect(stepByStepId(paused.steps, 'check_existing').outputJson.pipelineState).toBe('ready_for_visual_generation');

      const genStep = stepByStepId(paused.steps, 'generate_prompts');
      expect(genStep.status).toBe('completed');
      expect(genStep.outputJson.generatedCount).toBe(2);
      expect(genStep.outputJson.failedCount).toBe(0);
      const generated = genStep.outputJson.outputs as Array<{ id: string; alternativeIndex: number; status: string }>;
      expect(generated.map((o) => o.alternativeIndex)).toEqual([1, 2]);
      expect(paused.run.outputJson.generatedOutputIds).toEqual(generated.map((o) => o.id));

      // route_generation records the REAL routing outcome; brand/style checks are honest skips.
      expect(stepByStepId(paused.steps, 'route_generation').status).toBe('completed');
      expect(stepByStepId(paused.steps, 'route_generation').outputJson.providers).toEqual(['openai']);
      expect(stepByStepId(paused.steps, 'brand_check').status).toBe('skipped');
      expect(stepByStepId(paused.steps, 'style_check').status).toBe('skipped');

      // Real generated_outputs rows exist in PostgreSQL, stored and indexed.
      const outputRows = await pool.query(
        'SELECT id, status, alternative_index, storage_key, created_by, creative_qa_report_id FROM generated_outputs WHERE layout_plan_id = $1 ORDER BY alternative_index ASC',
        [layoutPlanId]
      );
      expect(outputRows.rows.length).toBe(2);
      expect(outputRows.rows.map((r) => Number(r.alternative_index))).toEqual([1, 2]);
      expect(outputRows.rows.every((r) => r.status === 'generated' && r.storage_key && r.creative_qa_report_id)).toBe(true);

      // The gate demands an explicit choice — no id is a 400, a foreign id is a 409.
      const noIdRes = await owner.post(`/api/workflow-runs/${run.id}/approve-step`).send({});
      expect(noIdRes.status).toBe(400);
      expect(noIdRes.body.message).toMatch(/generatedOutputId is required/);

      const approveRes = await owner
        .post(`/api/workflow-runs/${run.id}/approve-step`)
        .send({ generatedOutputId: generated[0].id });
      expect(approveRes.status).toBe(200);

      const done = await advanceToPause(owner, run.id);
      expect(done.run.status).toBe('completed');
      expect(stepByStepId(done.steps, 'user_approval').status).toBe('approved');
      expect(stepByStepId(done.steps, 'save_visual').status).toBe('completed');

      // The REAL domain approval happened (not just workflow bookkeeping).
      const approvedRow = await pool.query(
        'SELECT approval_status, approved_by FROM generated_outputs WHERE id = $1',
        [generated[0].id]
      );
      expect(approvedRow.rows[0].approval_status).toBe('approved');
      expect(approvedRow.rows[0].approved_by).toBeTruthy();

      const approvalRows = await pool.query(
        "SELECT decision, entity_type, entity_id FROM workflow_approvals WHERE workflow_run_id = $1",
        [run.id]
      );
      expect(approvalRows.rows.length).toBe(1);
      expect(approvalRows.rows[0].decision).toBe('approved');
      expect(approvalRows.rows[0].entity_type).toBe('generated_output');
      expect(approvalRows.rows[0].entity_id).toBe(generated[0].id);
    },
    30_000
  );

  it(
    're-running generation for the same layout plan appends a NEW alternative set with continuing alternative_index',
    async () => {
      const { briefId, layoutPlanId, clientId } = await createFullyReadyLayoutPlan('Workflow Visual Rerun Client');
      await approveCreativeQaFor(layoutPlanId);

      // First batch via the direct route (same service the workflow binding calls).
      const owner = await loginAs(TEST_USERS.OWNER);
      const firstRes = await owner.post(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(firstRes.status).toBe(201);
      expect(firstRes.body.total).toBe(2);
      expect(firstRes.body.data.map((o: { alternativeIndex: number }) => o.alternativeIndex)).toEqual([1, 2]);

      // Second batch via the workflow — indices continue at 3/4, never reset.
      const { run } = await startRun(owner, 'visual-generation', clientId, {
        design_brief_id: briefId,
        layout_plan_id: layoutPlanId,
      });
      const paused = await advanceToPause(owner, run.id);
      expect(paused.run.status).toBe('waiting_for_approval');
      const generated = stepByStepId(paused.steps, 'generate_prompts').outputJson.outputs as Array<{ alternativeIndex: number }>;
      expect(generated.map((o) => o.alternativeIndex)).toEqual([3, 4]);

      const listRes = await owner.get(`/api/layout-plans/${layoutPlanId}/visual-generation`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(4);
    },
    30_000
  );
});

describe('12. photoshop-production blocks as future, never completed', () => {
  it(
    'passes the production gate then blocks on send_to_photoshop; cancel is still possible',
    async () => {
      const { briefId, layoutPlanId, clientId } = await createFullyReadyLayoutPlan('Workflow PSD Blocked Client');
      await approveCreativeQaFor(layoutPlanId);

      const owner = await loginAs(TEST_USERS.OWNER);
      const { run } = await startRun(owner, 'photoshop-production', clientId, {
        design_brief_id: briefId,
        layout_plan_id: layoutPlanId,
      });

      const blocked = await advanceToPause(owner, run.id);
      expect(blocked.run.status).toBe('blocked_future_feature');
      expect(blocked.run.errorJson.feature).toBe('photoshop_production');
      expect(blocked.run.errorJson.message).toMatch(/Photoshop üretimi henüz uygulanmadı/);
      expect(stepByStepId(blocked.steps, 'load_layout').status).toBe('completed');
      expect(stepByStepId(blocked.steps, 'send_to_photoshop').status).toBe('pending');
      expect(stepByStepId(blocked.steps, 'send_to_photoshop').outputJson.futureFeature).toBe(true);

      const advanceRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(advanceRes.status).toBe(409);

      const runRows = await pool.query('SELECT status, completed_at FROM workflow_runs WHERE id = $1', [run.id]);
      expect(runRows.rows[0].status).toBe('blocked_future_feature');
      expect(runRows.rows[0].completed_at).toBeNull();

      // A blocked run can still be aborted explicitly.
      const cancelRes = await owner.post(`/api/workflow-runs/${run.id}/cancel`).send({});
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.run.status).toBe('cancelled');
      const cancelledRows = await pool.query('SELECT status FROM workflow_runs WHERE id = $1', [run.id]);
      expect(cancelledRows.rows[0].status).toBe('cancelled');

      const cancelAgainRes = await owner.post(`/api/workflow-runs/${run.id}/cancel`).send({});
      expect(cancelAgainRes.status).toBe(409);
    },
    30_000
  );
});

describe('13. Malformed run ids return structured 400, not a crash', () => {
  it('GET/POST /api/workflow-runs/not-a-valid-uuid -> 400 JSON', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);

    const getRes = await owner.get('/api/workflow-runs/not-a-valid-uuid');
    expect(getRes.status).toBe(400);
    expect(getRes.body.error).toBe('Bad Request');
    expect(getRes.body.message).toBeTruthy();
    expect(getRes.body.timestamp).toBeTruthy();

    const stepsRes = await owner.get('/api/workflow-runs/not-a-valid-uuid/steps');
    expect(stepsRes.status).toBe(400);

    const advanceRes = await owner.post('/api/workflow-runs/not-a-valid-uuid/advance').send({});
    expect(advanceRes.status).toBe(400);

    const approveRes = await owner.post('/api/workflow-runs/not-a-valid-uuid/approve-step').send({});
    expect(approveRes.status).toBe(400);

    const cancelRes = await owner.post('/api/workflow-runs/not-a-valid-uuid/cancel').send({});
    expect(cancelRes.status).toBe(400);
  });
});

describe('14. Golden path E2E: content-generation -> design-brief -> layout-generation -> creative-qa', () => {
  it(
    'drives all four workflows to completed with real entity links and DB-backed state',
    async () => {
      const clientId = await createClient('Workflow Golden Path Client');
      await uploadReference(clientId, 'reference-1.png');
      await analyzeAndApproveDna(clientId);
      const owner = await loginAs(TEST_USERS.OWNER);

      // ── content-generation ──
      const contentStart = await startRun(owner, 'content-generation', clientId, {
        campaign_goal: 'Yeni sezon lansmanı',
        platform: 'instagram_post',
        topic: 'Seasonal harvest',
      });
      expect(contentStart.steps.length).toBe(9);

      const contentPaused = await advanceToPause(owner, contentStart.run.id);
      expect(contentPaused.run.status).toBe('waiting_for_approval');
      expect(contentPaused.run.currentStepId).toBe('user_approval');
      const ideas = stepByStepId(contentPaused.steps, 'generate_ideas').outputJson.ideas as Array<{ id: string }>;
      expect(ideas.length).toBe(1);
      const ideaId = ideas[0].id;
      expect(stepByStepId(contentPaused.steps, 'generate_copy').outputJson.withCaption).toBe(1);

      const ideaApproveRes = await owner
        .post(`/api/workflow-runs/${contentStart.run.id}/approve-step`)
        .send({ contentIdeaId: ideaId });
      expect(ideaApproveRes.status).toBe(200);

      const contentDone = await advanceToPause(owner, contentStart.run.id);
      expect(contentDone.run.status).toBe('completed');
      expect(stepByStepId(contentDone.steps, 'user_approval').status).toBe('approved');
      expect(stepByStepId(contentDone.steps, 'learn_from_feedback').status).toBe('skipped');
      expect(stepByStepId(contentDone.steps, 'save_approved').status).toBe('completed');
      expect(stepByStepId(contentDone.steps, 'save_approved').outputJson.approvedIdeaIds).toContain(ideaId);

      const ideaRows = await pool.query('SELECT status FROM content_ideas WHERE id = $1', [ideaId]);
      expect(ideaRows.rows[0].status).toBe('approved');
      const contentOutputs = await pool.query(
        "SELECT entity_type, entity_id, output_key FROM workflow_step_outputs WHERE workflow_run_id = $1 AND entity_type = 'content_idea'",
        [contentStart.run.id]
      );
      expect(contentOutputs.rows.map((r) => r.entity_id)).toContain(ideaId);
      expect(contentOutputs.rows.some((r) => r.output_key === 'approved_entity')).toBe(true);

      // ── design-brief ──
      const briefStart = await startRun(owner, 'design-brief', clientId, { content_idea_id: ideaId });
      const briefPaused = await advanceToPause(owner, briefStart.run.id);
      expect(briefPaused.run.status).toBe('waiting_for_approval');
      const briefId = stepByStepId(briefPaused.steps, 'generate_brief').outputJson.designBriefId as string;

      const briefApproveRes = await owner.post(`/api/workflow-runs/${briefStart.run.id}/approve-step`).send({});
      expect(briefApproveRes.status).toBe(200);
      const briefDone = await advanceToPause(owner, briefStart.run.id);
      expect(briefDone.run.status).toBe('completed');

      const briefRows = await pool.query('SELECT status, content_idea_id FROM design_briefs WHERE id = $1', [briefId]);
      expect(briefRows.rows[0].status).toBe('approved');
      expect(briefRows.rows[0].content_idea_id).toBe(ideaId);
      const briefOutputs = await pool.query(
        "SELECT entity_id FROM workflow_step_outputs WHERE workflow_run_id = $1 AND entity_type = 'design_brief'",
        [briefStart.run.id]
      );
      expect(briefOutputs.rows.map((r) => r.entity_id)).toContain(briefId);

      // ── layout-generation ──
      const layoutStart = await startRun(owner, 'layout-generation', clientId, { design_brief_id: briefId });
      const layoutPaused = await advanceToPause(owner, layoutStart.run.id);
      expect(layoutPaused.run.status).toBe('waiting_for_approval');
      const plans = stepByStepId(layoutPaused.steps, 'generate_layouts').outputJson.layoutPlans as Array<{ id: string }>;
      expect(plans.length).toBe(2);

      const layoutApproveRes = await owner
        .post(`/api/workflow-runs/${layoutStart.run.id}/approve-step`)
        .send({ layoutPlanId: plans[0].id });
      expect(layoutApproveRes.status).toBe(200);
      const layoutDone = await advanceToPause(owner, layoutStart.run.id);
      expect(layoutDone.run.status).toBe('completed');
      expect(stepByStepId(layoutDone.steps, 'save_layout').outputJson.selectedLayoutPlanId).toBe(plans[0].id);

      const planRows = await pool.query('SELECT status, design_brief_id FROM layout_plans WHERE id = $1', [plans[0].id]);
      expect(planRows.rows[0].status).toBe('approved');
      expect(planRows.rows[0].design_brief_id).toBe(briefId);

      // ── creative-qa ──
      const qaStart = await startRun(owner, 'creative-qa', clientId, {
        design_brief_id: briefId,
        layout_plan_id: plans[0].id,
      });
      const qaPaused = await advanceToPause(owner, qaStart.run.id);
      expect(qaPaused.run.status).toBe('waiting_for_approval');
      const reportId = stepByStepId(qaPaused.steps, 'brand_consistency').outputJson.creativeQaReportId as string;

      const qaApproveRes = await owner.post(`/api/workflow-runs/${qaStart.run.id}/approve-step`).send({});
      expect(qaApproveRes.status).toBe(200);
      // The gate is the last step — approving it completes the run.
      expect(qaApproveRes.body.data.run.status).toBe('completed');

      const reportRows = await pool.query('SELECT status, layout_plan_id FROM creative_qa_reports WHERE id = $1', [reportId]);
      expect(reportRows.rows[0].status).toBe('approved');
      expect(reportRows.rows[0].layout_plan_id).toBe(plans[0].id);

      // ── restart safety: state is PostgreSQL rows, visible to a brand-new session ──
      const freshAgent = await loginAs(TEST_USERS.OWNER);
      const freshRes = await freshAgent.get(`/api/workflow-runs/${contentStart.run.id}`);
      expect(freshRes.status).toBe(200);
      expect(freshRes.body.data.run.status).toBe('completed');
      expect(freshRes.body.data.run.outputJson.summary.completedSteps).toBe(9);
      expect(freshRes.body.data.definition.workflow_id).toBe('content-generation');

      const listRes = await freshAgent.get(`/api/workflow-runs?clientId=${clientId}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(4);
      expect(listRes.body.data.every((r: { status: string }) => r.status === 'completed')).toBe(true);

      const allRunRows = await pool.query(
        'SELECT status, completed_at FROM workflow_runs WHERE client_id = $1',
        [clientId]
      );
      expect(allRunRows.rows.length).toBe(4);
      expect(allRunRows.rows.every((r) => r.status === 'completed' && r.completed_at !== null)).toBe(true);
    },
    // Generous: ~60 sequential HTTP calls; parallel suite workers can slow the
    // shared embedded Postgres + bcrypt logins down several-fold under load.
    120_000
  );
});

describe('15. AI provider failure during a step persists failure state, then propagates 502', () => {
  it(
    'generate_ideas failure -> 502, step + run failed in PostgreSQL, further advance 409',
    async () => {
      const clientId = await createClient('Workflow AI Failure Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const { run } = await startRun(owner, 'content-generation', clientId, {
        campaign_goal: 'Yeni sezon lansmanı',
        platform: 'instagram_post',
      });

      // select_client, enter_campaign_details, load_brand_context all succeed.
      for (let i = 0; i < 3; i++) {
        const res = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
        expect(res.status).toBe(200);
      }

      aiControl.mode = 'failure';
      const failRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(failRes.status).toBe(502);

      const runRows = await pool.query('SELECT status, error_json FROM workflow_runs WHERE id = $1', [run.id]);
      expect(runRows.rows[0].status).toBe('failed');
      expect(runRows.rows[0].error_json.stepId).toBe('generate_ideas');
      const stepRows = await pool.query(
        "SELECT status, error_json FROM workflow_steps WHERE workflow_run_id = $1 AND step_id = 'generate_ideas'",
        [run.id]
      );
      expect(stepRows.rows[0].status).toBe('failed');
      expect(stepRows.rows[0].error_json.status).toBe(502);

      aiControl.mode = 'success';
      const advanceRes = await owner.post(`/api/workflow-runs/${run.id}/advance`).send({});
      expect(advanceRes.status).toBe(409);
      expect(advanceRes.body.message).toMatch(/has failed/);
    },
    30_000
  );
});
