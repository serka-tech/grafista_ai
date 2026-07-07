import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { pool } from '../db/pool.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

/**
 * The test environment (global-setup.ts) sets a FAKE OPENAI_API_KEY, so any test that
 * exercises the real analyze endpoint must mock the AI call rather than let it attempt a
 * real network call. `@grafista/model-router`'s ModelRouter is replaced wholesale below;
 * `aiControl.mode` (declared via vi.hoisted so it's available inside the hoisted vi.mock
 * factory) lets individual tests switch between a canned success response and a
 * simulated provider failure.
 */
const aiControl = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'failure' | 'invalid_synthesis_then_valid',
  // Counts design_dna_synthesis calls so the schema-retry test can prove a second attempt happened.
  synthesisCalls: 0,
}));

vi.mock('@grafista/model-router', () => {
  const STYLE_ANALYSIS_CONTENT = {
    format: 'square',
    aspectRatio: '1:1',
    dominantColors: [
      { hex: '#2D5016', percentage: 55 },
      { hex: '#FAF5EB', percentage: 45 },
    ],
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
      if (req.taskType === 'style_analysis') {
        content = STYLE_ANALYSIS_CONTENT;
      } else {
        aiControl.synthesisCalls += 1;
        // Schema-violating first synthesis response (brandPersonality must be an array),
        // valid on the automatic retry — the N1 schema-flake pattern.
        content =
          aiControl.mode === 'invalid_synthesis_then_valid' && aiControl.synthesisCalls === 1
            ? { ...DESIGN_DNA_CONTENT, brandPersonality: 'not-an-array' }
            : DESIGN_DNA_CONTENT;
      }
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
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for Design DNA' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-design-dna-test'), { filename, contentType: 'image/png' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

beforeEach(() => {
  aiControl.mode = 'success';
  aiControl.synthesisCalls = 0;
});

describe('1. Unauthenticated access', () => {
  it('rejects POST analyze with 401', async () => {
    const res = await request(testServer.server).post('/api/clients/a1b2c3d4-e5f6-7890-abcd-ef1234567890/design-dna/analyze');
    expect(res.status).toBe(401);
  });
});

describe('2. Missing design_dna:run permission', () => {
  it('rejects CONTENT_MANAGER with 403 and requiredPermission', async () => {
    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
    const res = await contentManager.post(
      '/api/clients/a1b2c3d4-e5f6-7890-abcd-ef1234567890/design-dna/analyze'
    );
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('design_dna:run');
  });
});

describe('3. Successful analysis (mocked AI) creates real Postgres rows', () => {
  it('returns 201 with a designDna + analyses, persisted for real', async () => {
    const clientId = await createClient('Design DNA Success Client');
    const refId = await uploadReference(clientId, 'reference-1.png');

    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);

    expect(res.status).toBe(201);
    expect(res.body.data.clientId).toBe(clientId);
    expect(res.body.data.status).toBe('generated');
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.referencesUsed).toContain(refId);
    expect(Array.isArray(res.body.analyses)).toBe(true);
    expect(res.body.analyses.length).toBe(1);
    expect(res.body.analyses[0].designReferenceId).toBe(refId);

    const analysisRows = await pool.query('SELECT * FROM design_analysis WHERE design_reference_id = $1', [refId]);
    expect(analysisRows.rows.length).toBe(1);
    expect(analysisRows.rows[0].design_category).toBe('post');

    const dnaRows = await pool.query('SELECT * FROM design_dna WHERE client_id = $1', [clientId]);
    expect(dnaRows.rows.length).toBe(1);
    expect(dnaRows.rows[0].status).toBe('generated');
    expect(dnaRows.rows[0].source_analysis_count).toBe(1);

  });

  it('DESIGNER (has design_dna:run) is also allowed through the permission gate', async () => {
    const clientId = await createClient('Design DNA Designer Client');
    await uploadReference(clientId, 'reference-2.png');

    const designer = await loginAs(TEST_USERS.DESIGNER);
    const res = await designer.post(`/api/clients/${clientId}/design-dna/analyze`);
    expect(res.status).toBe(201);
  });
});

describe('4. Malformed client UUID returns 400, not a crash', () => {
  it('rejects a non-UUID clientId with 400', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post('/api/clients/not-a-valid-uuid/design-dna/analyze');
    expect(res.status).toBe(400);
  });
});

describe('5. Client with zero uploaded design references', () => {
  it('rejects with 400 and a clear message, no AI call attempted', async () => {
    const clientId = await createClient('Design DNA Empty Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no uploaded design references/i);

    const dnaRows = await pool.query('SELECT * FROM design_dna WHERE client_id = $1', [clientId]);
    expect(dnaRows.rows.length).toBe(0);
  });
});

describe('6. Mocked AI failure surfaces a structured 502 and persists nothing', () => {
  it('returns 502 and creates no design_dna row', async () => {
    const clientId = await createClient('Design DNA Failure Client');
    await uploadReference(clientId, 'reference-3.png');

    aiControl.mode = 'failure';
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
    expect(res.status).toBe(502);

    const dnaRows = await pool.query('SELECT * FROM design_dna WHERE client_id = $1', [clientId]);
    expect(dnaRows.rows.length).toBe(0);
  });
});

// Phase 3 Step 3 — same N1 schema-flake auto-retry pattern as layout generation,
// applied to the synthesis call of the Design DNA pipeline.
describe('6b. Synthesis schema flake recovers via automatic retry', () => {
  it('first invalid + second valid synthesis -> 201 with a persisted DNA from exactly 2 synthesis calls', async () => {
    const clientId = await createClient('Design DNA N1 Retry Client');
    await uploadReference(clientId, 'reference-n1.png');

    aiControl.mode = 'invalid_synthesis_then_valid';
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);

    expect(res.status).toBe(201);
    expect(aiControl.synthesisCalls).toBe(2);

    const dnaRows = await pool.query('SELECT * FROM design_dna WHERE client_id = $1', [clientId]);
    expect(dnaRows.rows.length).toBe(1);
  });
});

describe('7. Approve requires design_dna:approve', () => {
  it('rejects DESIGNER (no design_dna:approve) with 403', async () => {
    const clientId = await createClient('Design DNA Approve Client');
    await uploadReference(clientId, 'reference-4.png');

    const owner = await loginAs(TEST_USERS.OWNER);
    const analyzeRes = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
    expect(analyzeRes.status).toBe(201);

    const designer = await loginAs(TEST_USERS.DESIGNER);
    const res = await designer.post(`/api/clients/${clientId}/design-dna/approve`);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('design_dna:approve');
  });

  it('OWNER (has design_dna:approve) can approve the latest DNA', async () => {
    const clientId = await createClient('Design DNA Approve Success Client');
    await uploadReference(clientId, 'reference-5.png');

    const owner = await loginAs(TEST_USERS.OWNER);
    const analyzeRes = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
    expect(analyzeRes.status).toBe(201);

    const res = await owner.post(`/api/clients/${clientId}/design-dna/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.approvedBy).toBeTruthy();
  });
});

describe('8. GET routes', () => {
  it('GET design-dna returns 404 before analysis has run', async () => {
    const clientId = await createClient('Design DNA Not-Yet-Analyzed Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.get(`/api/clients/${clientId}/design-dna`);
    expect(res.status).toBe(404);
  });

  it('GET design-dna/references returns an empty array (200), not 404, before analysis has run', async () => {
    const clientId = await createClient('Design DNA No References Yet Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.get(`/api/clients/${clientId}/design-dna/references`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
