import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { brandAssetsRepo } from '../db/repositories/brand-assets.js';
import { organizationsRepo } from '../db/repositories/organizations.js';
import { usersRepo } from '../db/repositories/users.js';
import { hashPassword } from '../auth/password.js';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

async function login(email: string) {
  const agent = request.agent(testServer.server);
  expect((await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD })).status).toBe(200);
  return agent;
}

describe('PATCH brand asset palette', () => {
  let owner: request.Agent;
  let clientId: string;
  let paletteId: string;
  let wrongTypeId: string;
  let otherOrgEmail: string;

  beforeAll(async () => {
    owner = await login(TEST_USERS.OWNER);
    const client = await owner.post('/api/clients').send({ name: 'Palette route client', industry: 'test' });
    clientId = client.body.data.id;
    paletteId = uuid();
    wrongTypeId = uuid();
    for (const [id, type] of [[paletteId, 'color_palette'], [wrongTypeId, 'logo']] as const) {
      await brandAssetsRepo.create({ id, clientId, type, name: type, metadata: { preserved: true } });
    }
    const otherOrg = await organizationsRepo.create({ name: 'Palette Other Org', slug: `palette-other-${uuid().slice(0, 8)}` });
    otherOrgEmail = `palette-other-${uuid()}@test.local`;
    const otherUser = await usersRepo.create({
      id: uuid(), email: otherOrgEmail, passwordHash: await hashPassword(TEST_USER_PASSWORD),
      name: 'Palette Other Owner', organizationId: otherOrg.id,
    });
    await usersRepo.assignRole(otherUser.id, 'OWNER');
  });

  it('returns 200 and atomically persists metadata.palette', async () => {
    const palette = [{ hex: '#112233', role: 'primary' }, { hex: '#AABBCC', role: 'accent' }];
    const res = await owner.patch(`/api/clients/${clientId}/brand-assets/${paletteId}/palette`).send({ palette });
    expect(res.status).toBe(200);
    expect(res.body.data.metadata).toMatchObject({ preserved: true, palette });
  });

  it('returns 400 for invalid hex', async () => {
    expect((await owner.patch(`/api/clients/${clientId}/brand-assets/${paletteId}/palette`).send({ palette: [{ hex: 'red', role: 'primary' }] })).status).toBe(400);
  });

  it('returns 404 for missing and wrong-type assets', async () => {
    expect((await owner.patch(`/api/clients/${clientId}/brand-assets/${uuid()}/palette`).send({ palette: [] })).status).toBe(404);
    expect((await owner.patch(`/api/clients/${clientId}/brand-assets/${wrongTypeId}/palette`).send({ palette: [] })).status).toBe(404);
  });

  it('returns 404 across client scope', async () => {
    const otherOrgOwner = await login(otherOrgEmail);
    expect((await otherOrgOwner.patch(`/api/clients/${clientId}/brand-assets/${paletteId}/palette`).send({ palette: [] })).status).toBe(404);
  });
});
