import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { buildRealEstateListingLayout } from '../services/real-estate-template.js';

/**
 * Go-live M6 — direct-photo listing cards. An uploaded property photo becomes a
 * `generated_output` (generationMethod 'uploaded') that the EXISTING production +
 * render pipeline composites into the curated template's hero image slot. The
 * suite renderer is 'fake', but composition (which slot the photo lands in) runs
 * before the adapter, so the `selected_visual_loaded` warning proves it.
 */

const testServer = startTestServer(app);
afterAll(() => testServer.close());

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function loginAs(email: string) {
  const agent = request.agent(testServer.server);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function createClient(name: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post('/api/clients').send({ name, industry: 'Real Estate' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

function postListingCard(agent: ReturnType<typeof request.agent>, clientId: string) {
  return agent
    .post(`/api/clients/${clientId}/listing-cards`)
    .field('preset', 'instagram_post')
    .field('price', '₺4.250.000')
    .field('title', '3+1 Deniz Manzaralı Daire')
    .field('address', 'Kadıköy, İstanbul')
    .field('agencyName', 'Turyap')
    .attach('file', PNG, { filename: 'property.png', contentType: 'image/png' });
}

describe('1. Template factory', () => {
  it('builds exactly one injectable hero image slot plus the listing text layers', () => {
    const content = buildRealEstateListingLayout('instagram_post', {
      title: 'T', price: 'P', address: 'A', agencyName: 'Ag',
    });
    expect(content.canvas).toEqual(expect.objectContaining({ width: 1080, height: 1080 }));
    const imageSlots = content.layers.filter((l) => l.type === 'image');
    expect(imageSlots).toHaveLength(1);
    expect(imageSlots[0].imageProperties?.sourceUrl).toBeUndefined(); // injectable (no http source)
    const texts = content.layers.filter((l) => l.type === 'text').map((l) => l.textProperties?.content);
    expect(texts).toEqual(expect.arrayContaining(['P', 'T', 'A', 'Ag']));
    // story preset is taller
    expect(buildRealEstateListingLayout('instagram_story', { title: '', price: '', address: '', agencyName: '' }).canvas.height).toBe(1920);
  });
});

describe('2. Auth & validation', () => {
  it('401 unauthenticated', async () => {
    const res = await request(testServer.server).post('/api/clients/x/listing-cards').field('price', 'p');
    expect(res.status).toBe(401);
  });

  it('403 without visual_generation:run (CONTENT_MANAGER)', async () => {
    const clientId = await createClient('Listing RBAC Client');
    const cm = await loginAs(TEST_USERS.CONTENT_MANAGER);
    const res = await postListingCard(cm, clientId);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('visual_generation:run');
  });

  it('400 when the photo file is missing', async () => {
    const clientId = await createClient('Listing NoFile Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner
      .post(`/api/clients/${clientId}/listing-cards`)
      .field('preset', 'instagram_post')
      .field('price', '₺1')
      .field('title', 'x');
    expect(res.status).toBe(400);
  });

  it('400 when price/title missing', async () => {
    const clientId = await createClient('Listing NoFields Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner
      .post(`/api/clients/${clientId}/listing-cards`)
      .field('preset', 'instagram_post')
      .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });
});

describe('3. End-to-end — upload photo → generated_output → production → render (photo in hero slot)', () => {
  it(
    'creates an uploaded output and composites the photo into the "Property photo" slot',
    async () => {
      const clientId = await createClient('Turyap Listing E2E');
      const owner = await loginAs(TEST_USERS.OWNER);

      const cardRes = await postListingCard(owner, clientId);
      expect(cardRes.status).toBe(201);
      const output = cardRes.body.data;
      expect(output.generationMethod).toBe('uploaded');
      expect(output.status).toBe('generated');
      expect(output.clientId).toBe(clientId);
      expect(output.layoutPlanId).toBeTruthy();
      expect(output.fileUrl).toBe(`/api/visual-outputs/${output.id}/file`);

      // Send to production (unchanged endpoint) — the uploaded output packages fine.
      const prodRes = await owner.post(`/api/generated-outputs/${output.id}/production-jobs`);
      expect(prodRes.status).toBe(201);
      expect(prodRes.body.data.status).toBe('package_ready');

      // Render (fake adapter) — composition still runs and picks the hero slot.
      const renderRes = await owner
        .post(`/api/production-jobs/${prodRes.body.data.id}/render`)
        .send({ preset: 'instagram_post', exportFormat: 'png' });
      expect(renderRes.status).toBe(201);
      expect(renderRes.body.data.status).toBe('rendered');

      const warnings = renderRes.body.data.renderWarnings as Array<{ code: string; message: string }>;
      const composited = warnings.find((w) => w.code === 'selected_visual_loaded');
      expect(composited).toBeDefined();
      expect(composited!.message).toContain('Property photo');
      // NOT the slotless full-bleed fallback — the curated template HAS an image slot.
      expect(warnings.some((w) => w.code === 'full_canvas_visual_fallback')).toBe(false);

      // The export artifact is downloadable.
      const artRes = await owner.get(`/api/render-jobs/${renderRes.body.data.id}/artifacts`);
      expect(artRes.status).toBe(200);
      expect(artRes.body.data.length).toBeGreaterThan(0);
    },
    40_000
  );
});
