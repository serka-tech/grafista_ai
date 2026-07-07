import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { pool } from '../db/pool.js';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

const SEED_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('1. Unauthenticated access to protected routes', () => {
  it('rejects GET /api/clients with 401', async () => {
    const res = await request(testServer.server).get('/api/clients');
    expect(res.status).toBe(401);
  });

  it('rejects POST /api/clients with 401', async () => {
    const res = await request(testServer.server).post('/api/clients').send({ name: 'Should Not Be Created' });
    expect(res.status).toBe(401);
  });

  it('rejects GET /api/settings/providers with 401', async () => {
    const res = await request(testServer.server).get('/api/settings/providers');
    expect(res.status).toBe(401);
  });
});

describe('2. Invalid login', () => {
  it('rejects an unknown email with 401', async () => {
    const res = await request(testServer.server).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'whatever123' });
    expect(res.status).toBe(401);
  });

  it('rejects a known email with the wrong password with 401', async () => {
    const res = await request(testServer.server).post('/api/auth/login').send({ email: TEST_USERS.OWNER, password: 'totally-wrong-password' });
    expect(res.status).toBe(401);
  });

  it('does not set a session cookie on failed login', async () => {
    const res = await request(testServer.server).post('/api/auth/login').send({ email: TEST_USERS.OWNER, password: 'totally-wrong-password' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('3. OWNER can access all protected routes', () => {
  const owner = request.agent(testServer.server);

  it('logs in successfully and sets a cookie', async () => {
    const res = await owner.post('/api/auth/login').send({ email: TEST_USERS.OWNER, password: TEST_USER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.roles).toContain('OWNER');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('can read clients (clients:read)', async () => {
    const res = await owner.get('/api/clients');
    expect(res.status).toBe(200);
  });

  it('can create clients (clients:create)', async () => {
    const res = await owner.post('/api/clients').send({ name: 'Owner-Created Client' });
    expect(res.status).toBe(201);
  });

  it('can manage settings (settings:manage)', async () => {
    const res = await owner.get('/api/settings/providers');
    expect(res.status).toBe(200);
  });

  it('can final-approve outputs (outputs:final_approve)', async () => {
    const res = await owner.post('/api/outputs/fake-id/final-approve');
    expect(res.status).toBe(200);
  });

  it('GET /api/auth/me returns the current user', async () => {
    const res = await owner.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(TEST_USERS.OWNER);
    expect(res.body.data.user.permissions).toContain('clients:delete');
  });
});

describe('4. DESIGNER cannot final-approve outputs', () => {
  const designer = request.agent(testServer.server);

  it('logs in as DESIGNER', async () => {
    const res = await designer.post('/api/auth/login').send({ email: TEST_USERS.DESIGNER, password: TEST_USER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.roles).toContain('DESIGNER');
  });

  it('is rejected with 403 on outputs:final_approve', async () => {
    const res = await designer.post('/api/outputs/fake-id/final-approve');
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('outputs:final_approve');
  });

  it('can still create design briefs (has design_briefs:create)', async () => {
    const res = await designer.post('/api/design-briefs').send({ contentIdeaId: 'e1a1a1a1-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    // Either succeeds (201) or the idea is already briefed in an earlier test run — both prove the permission gate passed, not 403.
    expect(res.status).not.toBe(403);
  });
});

describe('5. CONTENT_MANAGER cannot manage settings', () => {
  const contentManager = request.agent(testServer.server);

  it('logs in as CONTENT_MANAGER', async () => {
    const res = await contentManager
      .post('/api/auth/login')
      .send({ email: TEST_USERS.CONTENT_MANAGER, password: TEST_USER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.roles).toContain('CONTENT_MANAGER');
  });

  it('is rejected with 403 on GET /api/settings/providers', async () => {
    const res = await contentManager.get('/api/settings/providers');
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('settings:manage');
  });
});

describe('6. User without brand_assets:upload cannot upload brand assets', () => {
  const contentManager = request.agent(testServer.server);

  it('logs in as CONTENT_MANAGER (no brand_assets:upload)', async () => {
    const res = await contentManager
      .post('/api/auth/login')
      .send({ email: TEST_USERS.CONTENT_MANAGER, password: TEST_USER_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('is rejected with 403 uploading a brand asset', async () => {
    const res = await contentManager
      .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
      .field('type', 'logo')
      .field('name', 'Should Be Blocked');
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('brand_assets:upload');
  });

  it('DESIGNER (has brand_assets:upload) is allowed through the permission gate', async () => {
    const designer = request.agent(testServer.server);
    await designer.post('/api/auth/login').send({ email: TEST_USERS.DESIGNER, password: TEST_USER_PASSWORD });
    const res = await designer
      .post(`/api/clients/${SEED_CLIENT_ID}/brand-assets`)
      .field('type', 'logo')
      .field('name', 'Designer Uploaded Asset (no file)');
    expect(res.status).toBe(201);
  });
});

describe('7. Logout invalidates the session', () => {
  const agent = request.agent(testServer.server);

  it('logs in, confirms access, logs out, then confirms access is revoked', async () => {
    const loginRes = await agent.post('/api/auth/login').send({ email: TEST_USERS.OWNER, password: TEST_USER_PASSWORD });
    expect(loginRes.status).toBe(200);

    const beforeLogout = await agent.get('/api/auth/me');
    expect(beforeLogout.status).toBe(200);

    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);

    // Same agent — same cookie jar, same (now-revoked) token — must now be rejected.
    const afterLogout = await agent.get('/api/auth/me');
    expect(afterLogout.status).toBe(401);
  });
});

describe('8. Sessions are persisted in PostgreSQL, not in-memory', () => {
  it('a valid session has a real row in the sessions table, queryable outside the app', async () => {
    const agent = request.agent(testServer.server);
    await agent.post('/api/auth/login').send({ email: TEST_USERS.OWNER, password: TEST_USER_PASSWORD });

    const { rows } = await pool.query(
      `SELECT s.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE u.email = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()`,
      [TEST_USERS.OWNER]
    );
    expect(rows.length).toBeGreaterThan(0);
    // A restarted API process would reconnect to the same Postgres and find this same row —
    // proven end-to-end with a real process restart in manual verification (see report).
  });
});
