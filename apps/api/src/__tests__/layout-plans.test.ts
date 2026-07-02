import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';

/**
 * Structurally mirrors design-dna.test.ts: the test environment (global-setup.ts) sets a
 * FAKE OPENAI_API_KEY, so any test exercising a real AI-backed route must mock the AI call
 * rather than let it attempt a real network call. `@grafista/model-router`'s ModelRouter is
 * replaced wholesale below. `aiControl.mode` (declared via vi.hoisted so it's available
 * inside the hoisted vi.mock factory) lets individual tests switch between a canned success
 * response, a simulated provider failure, and a schema-violating "invalid" layout response.
 *
 * This suite needs to drive the whole chain up to "approved design brief" (content idea ->
 * approve -> design brief -> approve), so the mock also covers taskType 'content_ideation'
 * (used by POST /api/clients/:clientId/content-ideas) and, for the DesignDNA-context proof
 * point, 'style_analysis' / 'design_dna_synthesis' (used by the design-dna analyze route).
 */
const aiControl = vi.hoisted(() => ({ mode: 'success' as 'success' | 'failure' | 'invalid_layout' }));

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
  // Schema-violating: wrong array length (1 instead of 2-3) AND a missing required field
  // (no `canvas`) on the one element present — either defect alone is enough to 502.
  const INVALID_LAYOUT_CONTENT = [{ format: 'instagram_post', layers: [] }];

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
      else if (req.taskType === 'layout_generation') {
        content = aiControl.mode === 'invalid_layout' ? INVALID_LAYOUT_CONTENT : LAYOUT_ALTERNATIVES;
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
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for layout plans' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-layout-plans-test'), { filename, contentType: 'image/png' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
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

beforeEach(() => {
  aiControl.mode = 'success';
});

describe('1. Unauthenticated access', () => {
  it('rejects POST generate with 401', async () => {
    const res = await request(app).post(
      '/api/design-briefs/a1b2c3d4-e5f6-7890-abcd-ef1234567890/layout-plans'
    );
    expect(res.status).toBe(401);
  });
});

describe('2. Missing layout_plans:create permission', () => {
  it('rejects CONTENT_MANAGER with 403 and requiredPermission', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
    const res = await contentManager.post(
      '/api/design-briefs/a1b2c3d4-e5f6-7890-abcd-ef1234567890/layout-plans'
    );
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('layout_plans:create');
  });
});

describe('3. Unapproved design brief', () => {
  it('returns 409 and creates no layout_plans rows', async () => {
    const { brief } = await createDraftDesignBrief('Layout Plans Draft Brief Client');
    expect(brief.status).toBe('draft');

    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(res.status).toBe(409);

    const rows = await pool.query('SELECT * FROM layout_plans WHERE design_brief_id = $1', [brief.id]);
    expect(rows.rows.length).toBe(0);
  });
});

describe('4. Approved design brief — successful generation', () => {
  it('returns 201 with 2-3 persisted alternatives', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Success Client');

    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
    for (const plan of res.body.data) {
      expect(plan.designBriefId).toBe(brief.id);
      expect(plan.status).toBe('generated');
      expect(plan.format).toBe('instagram_post');
    }
  });
});

describe('5. Approved DesignDNA is wired in as context', () => {
  it('persists a non-null designDnaId when approved DesignDNA exists for the client', async () => {
    const { clientId, brief } = await createDraftDesignBrief('Layout Plans DNA Client');
    await uploadReference(clientId, 'reference-1.png');

    const owner = await loginAs(TEST_USERS.OWNER);
    const analyzeRes = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
    expect(analyzeRes.status).toBe(201);
    const approveDnaRes = await owner.post(`/api/clients/${clientId}/design-dna/approve`);
    expect(approveDnaRes.status).toBe(200);
    const dnaId = approveDnaRes.body.data.id as string;

    const approveBriefRes = await owner.post(`/api/design-briefs/${brief.id}/approve`);
    expect(approveBriefRes.status).toBe(200);

    const res = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(res.status).toBe(201);
    for (const plan of res.body.data) {
      expect(plan.designDnaId).toBe(dnaId);
    }
    // At least one alternative in the mock cites a designDnaRulesUsed entry.
    expect(res.body.data.some((p: { designDnaRulesUsed: string[] }) => p.designDnaRulesUsed.length > 0)).toBe(true);
  });
});

describe('6. Malformed UUIDs return 400, not a crash', () => {
  it('rejects a non-UUID designBriefId with 400', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post('/api/design-briefs/not-a-valid-uuid/layout-plans');
    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID layout plan id with 400', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.get('/api/layout-plans/not-a-valid-uuid');
    expect(res.status).toBe(400);
  });
});

describe('7. AI provider failure', () => {
  it('returns structured 502 and persists zero rows', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Failure Client');

    aiControl.mode = 'failure';
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(res.status).toBe(502);

    const rows = await pool.query('SELECT * FROM layout_plans WHERE design_brief_id = $1', [brief.id]);
    expect(rows.rows.length).toBe(0);
  });
});

describe('8. Invalid AI JSON output (schema violation)', () => {
  it('returns structured 502 and persists zero rows', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Invalid Schema Client');

    aiControl.mode = 'invalid_layout';
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(res.status).toBe(502);

    const rows = await pool.query('SELECT * FROM layout_plans WHERE design_brief_id = $1', [brief.id]);
    expect(rows.rows.length).toBe(0);
  });
});

describe('9. Persisted rows are real Postgres data', () => {
  it('GET reflects the same alternatives that POST returned, with real fields', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Persistence Client');

    const owner = await loginAs(TEST_USERS.OWNER);
    const postRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(postRes.status).toBe(201);

    const getRes = await owner.get(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.total).toBe(postRes.body.data.length);
    expect(getRes.body.data.map((p: { id: string }) => p.id).sort()).toEqual(
      postRes.body.data.map((p: { id: string }) => p.id).sort()
    );

    const dbRows = await pool.query('SELECT * FROM layout_plans WHERE design_brief_id = $1 ORDER BY alternative_index', [brief.id]);
    expect(dbRows.rows.length).toBe(postRes.body.data.length);
    expect(dbRows.rows[0].alternative_index).toBe(1);
    expect(dbRows.rows[0].canvas_width).toBe(1080);
    expect(dbRows.rows[0].canvas_height).toBe(1080);
    expect(dbRows.rows[0].layout_json.layers.length).toBeGreaterThan(0);
  });
});

describe('10. Approve requires layout_plans:approve', () => {
  it('rejects DESIGNER (create+read only) with 403', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Approve Permission Client');

    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    expect(genRes.status).toBe(201);
    const planId = genRes.body.data[0].id as string;

    const designer = await loginAs(TEST_USERS.DESIGNER);
    const res = await designer.post(`/api/layout-plans/${planId}/approve`);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('layout_plans:approve');
  });

  it('OWNER can approve a generated layout plan', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Approve Success Client');

    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    const planId = genRes.body.data[0].id as string;

    const res = await owner.post(`/api/layout-plans/${planId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.approvedBy).toBeTruthy();
  });
});

describe('11. Reject requires layout_plans:reject', () => {
  it('rejects DESIGNER (create+read only) with 403', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Reject Permission Client');

    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    const planId = genRes.body.data[0].id as string;

    const designer = await loginAs(TEST_USERS.DESIGNER);
    const res = await designer.post(`/api/layout-plans/${planId}/reject`);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('layout_plans:reject');
  });

  it('OWNER can reject a generated layout plan (no notes -> rejected)', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Reject Success Client');

    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    const planId = genRes.body.data[0].id as string;

    const res = await owner.post(`/api/layout-plans/${planId}/reject`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
  });

  it('OWNER rejecting with notes moves status to needs_revision', async () => {
    const { brief } = await createApprovedDesignBrief('Layout Plans Revision Client');

    const owner = await loginAs(TEST_USERS.OWNER);
    const genRes = await owner.post(`/api/design-briefs/${brief.id}/layout-plans`);
    const planId = genRes.body.data[1].id as string;

    const res = await owner.post(`/api/layout-plans/${planId}/reject`).send({ notes: 'Please adjust logo placement' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('needs_revision');
  });
});
