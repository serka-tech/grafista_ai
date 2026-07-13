import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { GRAFISTA_ORG_ID } from '../config/tenant.js';
import { organizationsRepo } from '../db/repositories/organizations.js';
import { usersRepo } from '../db/repositories/users.js';
import { contentIdeasRepo } from '../db/repositories/content-ideas.js';
import { approvalsRepo } from '../db/repositories/approvals.js';
import { designBriefsRepo } from '../db/repositories/design-briefs.js';
import { hashPassword } from '../auth/password.js';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

/**
 * Packaging Phase A — ORGANIZATION (tenant) isolation.
 *
 * The pre-existing client_members intra-org scoping is covered by
 * client-isolation.test.ts (which must keep passing unchanged — all its users
 * live in the same founding org, so the new org boundary is trivially true for
 * them and only client_members scoping is exercised).
 *
 * This suite adds the HARD tenant boundary: two DIFFERENT organizations, where
 * a member of one org can NEVER see or touch the other org's clients or their
 * data — not in a LIST, not by direct id (404) — and org/team management is
 * confined to the caller's own org.
 *
 * Org A = the founding "Grafista Ajans" org (GRAFISTA_ORG_ID) that every
 * seeded TEST_USER already belongs to. Org B = a fresh org seeded here.
 */

const ORG_B_OWNER_EMAIL = 'orgb-owner@test.local';

async function loginAs(email: string) {
  const agent = request.agent(testServer.server);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function createClientAs(agent: request.Agent, name: string) {
  const res = await agent.post('/api/clients').send({ name, industry: 'test', notes: 'org isolation' });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; organizationId: string };
}

/** Directly seeds a pending content idea (for the approvals-list org filter). */
async function seedPendingIdea(clientId: string, title: string) {
  return contentIdeasRepo.create({
    id: uuid(),
    clientId,
    title,
    description: 'seed',
    platform: 'instagram_post',
    format: 'single_image',
    hashtags: [],
    status: 'pending_approval',
    generatedBy: 'manual',
  });
}

/** Directly seeds an idea+approval+brief chain (for the design-briefs-list org filter). */
async function seedBrief(clientId: string, title: string) {
  const idea = await contentIdeasRepo.create({
    id: uuid(),
    clientId,
    title: `${title} idea`,
    description: 'seed',
    platform: 'instagram_post',
    format: 'single_image',
    hashtags: [],
    status: 'approved',
    generatedBy: 'manual',
  });
  const approval = await approvalsRepo.create({
    id: uuid(),
    entityType: 'content_idea',
    entityId: idea.id,
    clientId,
    status: 'approved',
  });
  return designBriefsRepo.create({
    id: uuid(),
    clientId,
    contentIdeaId: idea.id,
    approvalId: approval.id,
    title,
    objective: 'seed brief',
    platform: 'instagram_post',
    format: 'single_image',
    dimensions: { width: 1080, height: 1080, unit: 'px' },
    contentElements: {},
    visualDirection: {},
    brandConstraints: {},
    aiImagePrompts: [],
  });
}

describe('Packaging Phase A — organization (tenant) isolation', () => {
  // Org A (founding) — a dedicated OWNER for it is one of the seeded TEST_USERS.
  let orgAClient: { id: string; organizationId: string };
  // Org B (fresh)
  let orgBOwnerId: string;
  let orgBClient: { id: string; organizationId: string };

  beforeAll(async () => {
    // Org A client, created by the founding-org OWNER (lands in GRAFISTA_ORG_ID).
    const ownerA = await loginAs(TEST_USERS.OWNER);
    orgAClient = await createClientAs(ownerA, 'Org A Client');

    // Fresh org B + an OWNER user inside it.
    const orgB = await organizationsRepo.create({ name: 'Org B Test', slug: `org-b-${uuid().slice(0, 8)}` });
    const passwordHash = await hashPassword(TEST_USER_PASSWORD);
    const orgBOwner = await usersRepo.create({
      id: uuid(),
      email: ORG_B_OWNER_EMAIL,
      passwordHash,
      name: 'Org B Owner',
      organizationId: orgB.id,
    });
    orgBOwnerId = orgBOwner.id;
    await usersRepo.assignRole(orgBOwner.id, 'OWNER');

    // Org B client, created by org B's OWNER (lands in org B).
    const ownerB = await loginAs(ORG_B_OWNER_EMAIL);
    orgBClient = await createClientAs(ownerB, 'Org B Client');

    // Sanity: the two clients really are in different orgs.
    expect(orgAClient.organizationId).toBe(GRAFISTA_ORG_ID);
    expect(orgBClient.organizationId).toBe(orgB.id);
    expect(orgAClient.organizationId).not.toBe(orgBClient.organizationId);

    // Seed list-endpoint fixtures in each org.
    await seedPendingIdea(orgAClient.id, 'Org A pending');
    await seedPendingIdea(orgBClient.id, 'Org B pending');
    await seedBrief(orgAClient.id, 'Org A brief');
    await seedBrief(orgBClient.id, 'Org B brief');
  }, 30_000);

  describe('client list — each org sees ONLY its own clients', () => {
    it('org A owner lists org A client but not org B client', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      const res = await a.get('/api/clients');
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((c) => c.id);
      expect(ids).toContain(orgAClient.id);
      expect(ids).not.toContain(orgBClient.id);
    });

    it('org B owner lists org B client but not org A client', async () => {
      const b = await loginAs(ORG_B_OWNER_EMAIL);
      const res = await b.get('/api/clients');
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((c) => c.id);
      expect(ids).toContain(orgBClient.id);
      expect(ids).not.toContain(orgAClient.id);
    });
  });

  describe('single client by id — cross-org is 404, same-org is 200', () => {
    it('org A owner: own client 200, other org client 404', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      expect((await a.get(`/api/clients/${orgAClient.id}`)).status).toBe(200);
      expect((await a.get(`/api/clients/${orgBClient.id}`)).status).toBe(404);
    });

    it('org B owner: own client 200, other org client 404', async () => {
      const b = await loginAs(ORG_B_OWNER_EMAIL);
      expect((await b.get(`/api/clients/${orgBClient.id}`)).status).toBe(200);
      expect((await b.get(`/api/clients/${orgAClient.id}`)).status).toBe(404);
    });

    it('org A owner cannot UPDATE another org client (404)', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      expect((await a.put(`/api/clients/${orgBClient.id}`).send({ notes: 'hijack' })).status).toBe(404);
    });
  });

  describe('nested client resources — cross-org is 404', () => {
    it('org A owner is blocked from org B client brand-assets / design-references / content-ideas', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      expect((await a.get(`/api/clients/${orgBClient.id}/brand-assets`)).status).toBe(404);
      expect((await a.get(`/api/clients/${orgBClient.id}/design-references`)).status).toBe(404);
      expect((await a.get(`/api/clients/${orgBClient.id}/content-ideas`)).status).toBe(404);
      // own org still works
      expect((await a.get(`/api/clients/${orgAClient.id}/brand-assets`)).status).toBe(200);
    });
  });

  describe('list endpoints joined through clients — org filtered', () => {
    it('approvals list shows only the caller org pending ideas', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      const resA = await a.get('/api/approvals');
      expect(resA.status).toBe(200);
      const titlesA = (resA.body.data as Array<{ title: string; clientId: string }>).map((x) => x.title);
      expect(titlesA).toContain('Org A pending');
      expect(titlesA).not.toContain('Org B pending');

      const b = await loginAs(ORG_B_OWNER_EMAIL);
      const resB = await b.get('/api/approvals');
      const titlesB = (resB.body.data as Array<{ title: string }>).map((x) => x.title);
      expect(titlesB).toContain('Org B pending');
      expect(titlesB).not.toContain('Org A pending');
    });

    it('design-briefs list shows only the caller org briefs', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      const resA = await a.get('/api/design-briefs');
      expect(resA.status).toBe(200);
      const titlesA = (resA.body.data as Array<{ title: string }>).map((x) => x.title);
      expect(titlesA).toContain('Org A brief');
      expect(titlesA).not.toContain('Org B brief');

      const b = await loginAs(ORG_B_OWNER_EMAIL);
      const resB = await b.get('/api/design-briefs');
      const titlesB = (resB.body.data as Array<{ title: string }>).map((x) => x.title);
      expect(titlesB).toContain('Org B brief');
      expect(titlesB).not.toContain('Org A brief');
    });
  });

  describe('org/team management is confined to the caller org', () => {
    it('GET /api/org/users returns only the caller org members', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      const resA = await a.get('/api/org/users');
      expect(resA.status).toBe(200);
      const emailsA = (resA.body.data as Array<{ email: string }>).map((u) => u.email);
      expect(emailsA).toContain(TEST_USERS.OWNER);
      expect(emailsA).not.toContain(ORG_B_OWNER_EMAIL);

      const b = await loginAs(ORG_B_OWNER_EMAIL);
      const resB = await b.get('/api/org/users');
      const emailsB = (resB.body.data as Array<{ email: string }>).map((u) => u.email);
      expect(emailsB).toContain(ORG_B_OWNER_EMAIL);
      expect(emailsB).not.toContain(TEST_USERS.OWNER);
    });

    it('an org A owner cannot manage an org B user (404)', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      expect((await a.post(`/api/org/users/${orgBOwnerId}/roles`).send({ role: 'DESIGNER' })).status).toBe(404);
      expect((await a.patch(`/api/org/users/${orgBOwnerId}`).send({ status: 'disabled' })).status).toBe(404);
      expect((await a.get(`/api/org/users/${orgBOwnerId}/clients`)).status).toBe(404);
    });

    it('a non-OWNER (no org:manage) is forbidden from org endpoints (403)', async () => {
      const designer = await loginAs(TEST_USERS.DESIGNER);
      expect((await designer.get('/api/org/users')).status).toBe(403);
    });
  });

  describe('invite -> accept flow lands the new user in the inviter org', () => {
    it('creates an invite, accepts it, and the new user is scoped to org A only', async () => {
      const a = await loginAs(TEST_USERS.OWNER);
      const inviteRes = await a.post('/api/org/invites').send({ email: 'invitee@test.local', role: 'DESIGNER' });
      expect(inviteRes.status).toBe(201);
      const token = inviteRes.body.data.token as string;
      expect(typeof token).toBe('string');
      expect(inviteRes.body.data.acceptPath).toContain('/accept-invite?token=');

      // Accept: new user gets a session cookie immediately.
      const invitee = request.agent(testServer.server);
      const acceptRes = await invitee
        .post('/api/auth/accept-invite')
        .send({ token, password: 'InviteePass123!', name: 'Invitee' });
      expect(acceptRes.status).toBe(201);
      expect(acceptRes.body.data.user.email).toBe('invitee@test.local');
      expect(acceptRes.body.data.user.organizationId).toBe(GRAFISTA_ORG_ID);

      // The invitee is already authenticated (accept set a session cookie) and
      // only sees org A clients.
      const clientsRes = await invitee.get('/api/clients');
      const ids = (clientsRes.body.data as Array<{ id: string }>).map((c) => c.id);
      expect(ids).toContain(orgAClient.id);
      expect(ids).not.toContain(orgBClient.id);

      // A reused/expired token is rejected.
      const reuse = await request
        .agent(testServer.server)
        .post('/api/auth/accept-invite')
        .send({ token, password: 'Whatever123!' });
      expect(reuse.status).toBe(400);

      // The org A roster now includes the invitee.
      const rosterRes = await a.get('/api/org/users');
      const emails = (rosterRes.body.data as Array<{ email: string }>).map((u) => u.email);
      expect(emails).toContain('invitee@test.local');
    });
  });
});
