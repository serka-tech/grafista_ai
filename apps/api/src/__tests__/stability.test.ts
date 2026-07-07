import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { pool } from '../db/pool.js';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

/**
 * Regression tests for the Bug 1 (async route handler crash) and Bug 2
 * (reject links to stale approval) stability hotfix.
 *
 * The most important assertion in this whole file is implicit: if Bug 1
 * were still present, an unhandled promise rejection thrown by a Postgres
 * error inside an async Express handler would crash the entire Node
 * process running this `vitest` worker — not just fail one `it()`. The
 * fact that this test suite (and every other test file in this run)
 * completes normally with a "Test Files ... passed" summary is itself
 * proof #1 below. Tests 2 and 3 additionally assert the *response shape*
 * is a structured, well-formed JSON error rather than a hang/reset/crash.
 */

const SEED_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
// Seeded content idea with status 'pending_approval' and approval_id NULL —
// i.e. previously unapproved, not referenced by id in any other test file.
const PENDING_IDEA_ID = 'e2b2b2b2-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const owner = request.agent(testServer.server);

beforeAll(async () => {
  const res = await owner.post('/api/auth/login').send({ email: TEST_USERS.OWNER, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
});

describe('Bug 1 — malformed input no longer crashes the process', () => {
  it('an invalid UUID route param returns a structured 400 instead of crashing (proof #1: this whole suite completing is the proof; proof #2: the shape below)', async () => {
    const res = await owner.get('/api/clients/not-a-real-uuid');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.any(String),
      message: expect.any(String),
      timestamp: expect.any(String),
    });
    // Not a raw stack trace / connection reset — a clean structured JSON body.
    expect(res.body.message).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/); // no stack-trace-looking line
  });

  it('the API is still responsive immediately after the malformed request (server did not die)', async () => {
    await owner.get('/api/clients/not-a-real-uuid');

    const health = await request(testServer.server).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    // A second, fully authenticated call also still works — the connection
    // pool and session middleware are unaffected by the earlier DB error.
    const clients = await owner.get('/api/clients');
    expect(clients.status).toBe(200);
  });

  it('a Postgres constraint violation (duplicate client name/slug) returns a structured 409, not a crash or 500', async () => {
    const name = `Stability Test Client ${Date.now()}`;

    const first = await owner.post('/api/clients').send({ name });
    expect(first.status).toBe(201);

    const second = await owner.post('/api/clients').send({ name });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      error: expect.any(String),
      message: expect.any(String),
      timestamp: expect.any(String),
    });

    // And the server is still up afterwards.
    const health = await request(testServer.server).get('/api/health');
    expect(health.status).toBe(200);
  });
});

describe('Bug 2 — reject links the idea to the newly-created approval, not a stale one', () => {
  it('POST /content-ideas/:id/reject (with revisionNotes) sets idea.approvalId to the returned approval.id', async () => {
    const res = await owner
      .post(`/api/content-ideas/${PENDING_IDEA_ID}/reject`)
      .send({ revisionNotes: 'Please adjust the color palette.', reviewerName: 'QA Test' });

    expect(res.status).toBe(200);
    expect(res.body.data.approval).toBeDefined();
    expect(res.body.data.idea).toBeDefined();
    expect(res.body.data.idea.status).toBe('revision_requested');
    expect(res.body.data.idea.approvalId).toBe(res.body.data.approval.id);

    // Verify directly against Postgres too, independent of the response body.
    const { rows } = await pool.query('SELECT approval_id, status FROM content_ideas WHERE id = $1', [PENDING_IDEA_ID]);
    expect(rows[0].approval_id).toBe(res.body.data.approval.id);
    expect(rows[0].status).toBe('revision_requested');
  });
});

describe('Sanity: existing client listing still works after all of the above', () => {
  it('GET /api/clients still returns the seeded client', async () => {
    const res = await owner.get('/api/clients');
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === SEED_CLIENT_ID)).toBe(true);
  });
});
