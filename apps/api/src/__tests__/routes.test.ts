import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';

const SEED_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const APPROVED_IDEA_ID = 'e1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DRAFT_IDEA_ID = 'e3c3c3c3-cccc-cccc-cccc-cccccccccccc';

// Authenticated as OWNER (all permissions) — these tests exercise business
// logic, not the auth layer itself. Auth-specific behavior is covered in
// auth.test.ts.
const owner = request.agent(app);

beforeAll(async () => {
  const res = await owner.post('/api/auth/login').send({ email: TEST_USERS.OWNER, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
});

describe('GET /api/health', () => {
  it('returns ok status (public, no auth required)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/clients', () => {
  it('returns the seeded client list', async () => {
    const res = await owner.get('/api/clients');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((c: { id: string }) => c.id === SEED_CLIENT_ID)).toBe(true);
  });
});

describe('GET /api/clients/:clientId/brand-assets', () => {
  it('returns brand assets for the seeded client', async () => {
    const res = await owner.get(`/api/clients/${SEED_CLIENT_ID}/brand-assets`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
  });
});

describe('GET /api/clients/:clientId/design-references', () => {
  it('returns design references for the seeded client', async () => {
    const res = await owner.get(`/api/clients/${SEED_CLIENT_ID}/design-references`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
  });
});

describe('POST /api/clients/:clientId/content-ideas', () => {
  it('rejects an invalid platform with 400', async () => {
    const res = await owner.post(`/api/clients/${SEED_CLIENT_ID}/content-ideas`).send({ platform: 'not_a_real_platform' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request body');
  });

  it('calls the real AI provider and surfaces its error instead of mocking a success', async () => {
    // The test env sets a fake OPENAI_API_KEY, so this hits the real OpenAI API
    // and must fail with a genuine 401 — proving no silent mock fallback exists.
    const res = await owner
      .post(`/api/clients/${SEED_CLIENT_ID}/content-ideas`)
      .send({ platform: 'instagram_post', optionCount: 1, topic: 'Test' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('AI provider error');
    expect(res.body.provider).toBe('openai');
    expect(res.body.message).toMatch(/401|api key/i);
  }, 15000);
});

describe('GET /api/approvals', () => {
  it('lists pending content idea approvals', async () => {
    const res = await owner.get('/api/approvals');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/design-briefs — approval gate', () => {
  it('requires contentIdeaId', async () => {
    const res = await owner.post('/api/design-briefs').send({});
    expect(res.status).toBe(400);
  });

  it('blocks creating a brief from an unapproved (draft) content idea', async () => {
    const res = await owner.post('/api/design-briefs').send({ contentIdeaId: DRAFT_IDEA_ID });
    expect(res.status).toBe(403);
    expect(res.body.currentStatus).toBe('draft');
  });

  it('allows creating a brief from an approved content idea', async () => {
    const res = await owner.post('/api/design-briefs').send({ contentIdeaId: APPROVED_IDEA_ID });
    expect(res.status).toBe(201);
    expect(res.body.data.contentIdeaId).toBe(APPROVED_IDEA_ID);
  });
});

describe('GET /api/workflows', () => {
  it('lists workflow definitions (authenticated — requires workflows:read since Phase 2 Step 6)', async () => {
    const res = await owner.get('/api/workflows');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
