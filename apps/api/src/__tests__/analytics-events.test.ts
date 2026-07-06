import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { store } from '../data/store.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { usersRepo } from '../db/repositories/users.js';
import { clientMembersRepo } from '../db/repositories/client-members.js';
import { hashPassword } from '../auth/password.js';

/**
 * Phase 3 Step 6A — Analytics Events.
 *
 * Structurally mirrors client-isolation.test.ts / render-queue-worker.test.ts:
 * the AI provider is mocked wholesale (vi.mock('@grafista/model-router')) so
 * the fixture pipeline (client -> design DNA -> content idea -> design brief
 * -> layout plan -> Creative QA -> visual generation -> production package ->
 * render) always produces a REAL, independent pipeline against the real
 * embedded Postgres instance and real local-disk storage — nothing about
 * analytics_events itself is mocked.
 */

vi.mock('@grafista/model-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@grafista/model-router')>();
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

  const CREATIVE_QA_SUCCESS_CONTENT = {
    overallScore: 88,
    overallStatus: 'passed',
    checks: [],
    brandConsistency: scoredCheck('brand', 'Brand Consistency', 88),
    readability: scoredCheck('text', 'Readability', 88),
    mobileLegibility: scoredCheck('text', 'Mobile Legibility', 88),
    visualHierarchy: scoredCheck('layout', 'Visual Hierarchy', 88),
    logoSafetyArea: scoredCheck('logo', 'Logo Safety Area', 88),
    colorContrast: scoredCheck('color', 'Color Contrast', 88),
    spelling: scoredCheck('text', 'Spelling', 100),
    designDnaMatch: scoredCheck('brand', 'DesignDNA Match', 88),
    exportReadiness: scoredCheck('export', 'Export Readiness', 88),
    typographyConsistency: scoredCheck('typography', 'Typography Consistency', 88),
    contentClarity: scoredCheck('content', 'Content Clarity', 88),
    summary: 'Creative QA review summary',
    detectedIssues: [],
    highPriorityFixes: [],
    mediumPriorityFixes: [],
    lowPriorityFixes: ['Consider tightening headline kerning slightly'],
    designerNotes: 'Overall composition is solid.',
    finalRecommendation: 'Approve as-is',
    designDnaReasons: ['Layout followed the warm natural lighting visual rule'],
    designBriefReasons: ['Headline copy matches the approved brief hook'],
    risksBeforeProduction: [],
  };

  const VISUAL_GENERATION_SUCCESS_CONTENT = {
    images: [
      {
        imageBase64: Buffer.from('grafista-analytics-events-test-image-bytes-1').toString('base64'),
        mimeType: 'image/png',
        width: 1080,
        height: 1080,
      },
      {
        imageBase64: Buffer.from('grafista-analytics-events-test-image-bytes-2').toString('base64'),
        mimeType: 'image/jpeg',
        width: 1080,
        height: 1350,
      },
    ],
  };

  class MockModelRouter {
    async complete(req: { taskType: string }) {
      let content: unknown;
      if (req.taskType === 'style_analysis') content = STYLE_ANALYSIS_CONTENT;
      else if (req.taskType === 'design_dna_synthesis') content = DESIGN_DNA_CONTENT;
      else if (req.taskType === 'content_ideation') content = CONTENT_IDEATION_CONTENT;
      else if (req.taskType === 'layout_generation') content = LAYOUT_ALTERNATIVES;
      else if (req.taskType === 'creative_qa') content = CREATIVE_QA_SUCCESS_CONTENT;
      else if (req.taskType === 'image_generation') content = VISUAL_GENERATION_SUCCESS_CONTENT;
      else content = {};

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

  return { ...actual, ModelRouter: MockModelRouter };
});

async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function createClient(name: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for analytics events' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-analytics-events-test'), { filename, contentType: 'image/png' });
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

async function createFullyReadyLayoutPlan(clientName: string) {
  const clientId = await createClient(clientName);
  await uploadReference(clientId, 'reference-1.png');
  await analyzeAndApproveDna(clientId);

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

  return { clientId, briefId, layoutPlanId };
}

async function approveCreativeQaFor(layoutPlanId: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const genRes = await owner.post(`/api/layout-plans/${layoutPlanId}/creative-qa`);
  expect(genRes.status).toBe(201);
  const reportId = genRes.body.data.id as string;
  const approveRes = await owner.post(`/api/creative-qa/${reportId}/approve`);
  expect(approveRes.status).toBe(200);
  return reportId;
}

async function createGeneratedOutputs(clientName: string) {
  const ready = await createFullyReadyLayoutPlan(clientName);
  const creativeQaReportId = await approveCreativeQaFor(ready.layoutPlanId);
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/visual-generation`);
  expect(res.status).toBe(201);
  const outputs = res.body.data as Array<{ id: string; status: string }>;
  expect(outputs.every((o) => o.status === 'generated')).toBe(true);
  return { ...ready, creativeQaReportId, outputs };
}

async function createPackageReadyProductionJob(clientName: string) {
  const ready = await createGeneratedOutputs(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const jobRes = await owner.post(`/api/generated-outputs/${ready.outputs[0].id}/production-jobs`);
  expect(jobRes.status).toBe(201);
  const productionJob = jobRes.body.data as Record<string, unknown>;
  expect(productionJob.status).toBe('package_ready');
  return { ...ready, productionJob };
}

async function renderOnce(productionJobId: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const renderRes = await owner
    .post(`/api/production-jobs/${productionJobId}/render`)
    .send({ preset: 'instagram_post', exportFormat: 'png' });
  expect(renderRes.status).toBe(201);
  const renderJob = renderRes.body.data as Record<string, unknown>;
  expect(renderJob.status).toBe('rendered');

  const artifactsRes = await owner.get(`/api/render-jobs/${renderJob.id}/artifacts`);
  expect(artifactsRes.status).toBe(200);
  const artifact = artifactsRes.body.data[0] as Record<string, unknown>;

  return { renderJob, artifact };
}

async function eventsFor(clientId: string) {
  const { rows } = await pool.query(
    'SELECT * FROM analytics_events WHERE client_id = $1 ORDER BY created_at ASC',
    [clientId]
  );
  return rows;
}

describe('Phase 3 Step 6A — Analytics Events', () => {
  describe('1. Repository — record()', () => {
    it('inserts a row with all fields set and metadata round-tripping as JSON', async () => {
      const clientId = await createClient('Analytics Repo Record Client');
      const entityId = uuid();
      const created = await store.analyticsEvents.record({
        clientId,
        entityType: 'render_job',
        entityId,
        eventType: 'render_job_rendered',
        actorUserId: null,
        provider: 'openai',
        model: 'gpt-4o',
        status: 'rendered',
        durationMs: 1234,
        metadata: { preset: 'instagram_post', format: 'png', width: 1080, height: 1080 },
      });

      expect(created.id).toBeTruthy();
      expect(created.clientId).toBe(clientId);
      expect(created.entityId).toBe(entityId);
      expect(created.eventType).toBe('render_job_rendered');
      expect(created.durationMs).toBe(1234);
      expect(created.metadata).toEqual({ preset: 'instagram_post', format: 'png', width: 1080, height: 1080 });

      const { rows } = await pool.query('SELECT * FROM analytics_events WHERE id = $1', [created.id]);
      expect(rows.length).toBe(1);
      expect(rows[0].metadata).toEqual({ preset: 'instagram_post', format: 'png', width: 1080, height: 1080 });
    });

    it('rejects an insert with no client_id (NOT NULL constraint)', async () => {
      await expect(
        store.analyticsEvents.record({
          // @ts-expect-error deliberately omitting the required field
          clientId: undefined,
          entityType: 'render_job',
          entityId: uuid(),
          eventType: 'render_job_rendered',
        })
      ).rejects.toThrow();
    });

    it('rejects metadata containing a denylisted key (e.g. apiKey) — the value is never persisted', async () => {
      const clientId = await createClient('Analytics Repo Denylist Client');
      const entityId = uuid();

      await expect(
        store.analyticsEvents.record({
          clientId,
          entityType: 'render_job',
          entityId,
          eventType: 'render_job_rendered',
          metadata: { apiKey: 'sk-super-secret-value' },
        })
      ).rejects.toThrow(/denylisted/);

      const { rows } = await pool.query('SELECT * FROM analytics_events WHERE entity_id = $1', [entityId]);
      expect(rows.length).toBe(0);
    });
  });

  describe('2. Recorder — recordBestEffort() never throws and never blocks the primary flow', () => {
    it('swallows a simulated failure (invalid client_id) without throwing', async () => {
      await expect(
        store.analyticsEvents.recordBestEffort({
          clientId: 'not-a-real-uuid',
          entityType: 'render_job',
          entityId: uuid(),
          eventType: 'render_job_rendered',
        })
      ).resolves.toBeUndefined();
    });

    it('a denylisted metadata key is swallowed (warned, not thrown) and never persisted', async () => {
      const clientId = await createClient('Analytics Recorder Denylist Client');
      const entityId = uuid();

      await expect(
        store.analyticsEvents.recordBestEffort({
          clientId,
          entityType: 'render_job',
          entityId,
          eventType: 'render_job_rendered',
          metadata: { token: 'leaked-token-value' },
        })
      ).resolves.toBeUndefined();

      const { rows } = await pool.query('SELECT * FROM analytics_events WHERE entity_id = $1', [entityId]);
      expect(rows.length).toBe(0);
    });

    it('a real domain flow (Creative QA approve) still succeeds even under an analytics failure', async () => {
      const ready = await createFullyReadyLayoutPlan('Analytics Best-Effort Primary Flow Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const genRes = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/creative-qa`);
      expect(genRes.status).toBe(201);
      const reportId = genRes.body.data.id as string;

      const spy = vi.spyOn(store.analyticsEvents, 'record').mockRejectedValueOnce(new Error('simulated DB outage'));
      const approveRes = await owner.post(`/api/creative-qa/${reportId}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('approved');
      spy.mockRestore();
    }, 30_000);
  });

  describe('3. getClientSummary() — aggregation over a known seeded event set', () => {
    it('returns correct counts and correctly ordered/limited/client-scoped recent activity', async () => {
      const clientId = await createClient('Analytics Summary Client');
      const otherClientId = await createClient('Analytics Summary Other Client');

      const seed = async (eventType: Parameters<typeof store.analyticsEvents.record>[0]['eventType'], entityType: Parameters<typeof store.analyticsEvents.record>[0]['entityType']) =>
        store.analyticsEvents.record({ clientId, entityType, entityId: uuid(), eventType });

      await seed('visual_generation_succeeded', 'generated_output');
      await seed('visual_generation_succeeded', 'generated_output');
      await seed('visual_generation_failed', 'generated_output');
      await seed('production_package_created', 'production_job');
      await seed('production_job_approved', 'production_job');
      await seed('production_job_rejected', 'production_job');
      await seed('render_job_rendered', 'render_job');
      await seed('render_job_failed', 'render_job');
      await seed('export_artifact_downloaded', 'export_artifact');

      // Noise from a different client — must never leak into clientId's summary.
      await store.analyticsEvents.record({
        clientId: otherClientId,
        entityType: 'render_job',
        entityId: uuid(),
        eventType: 'render_job_rendered',
      });

      const summary = await store.analyticsEvents.getClientSummary(clientId, { recentLimit: 3 });
      expect(summary.visualGenerationSucceeded).toBe(2);
      expect(summary.visualGenerationFailed).toBe(1);
      expect(summary.productionPackagesCreated).toBe(1);
      expect(summary.productionApproved).toBe(1);
      expect(summary.productionRejected).toBe(1);
      expect(summary.renderJobsRendered).toBe(1);
      expect(summary.renderJobsFailed).toBe(1);
      expect(summary.exportArtifactDownloads).toBe(1);
      expect(summary.totalEvents).toBe(9);
      expect(summary.recentActivity.length).toBe(3);
      // Most recent first.
      expect(summary.recentActivity[0].eventType).toBe('export_artifact_downloaded');

      const otherSummary = await store.analyticsEvents.getClientSummary(otherClientId);
      expect(otherSummary.totalEvents).toBe(1);
      expect(otherSummary.renderJobsRendered).toBe(1);
      expect(otherSummary.visualGenerationSucceeded).toBe(0);
    });
  });

  describe('4. Lifecycle integration — each instrumented call site writes its event', () => {
    it('Creative QA approve records creative_qa_approved', async () => {
      const ready = await createFullyReadyLayoutPlan('Analytics Lifecycle QA Client');
      const reportId = await approveCreativeQaFor(ready.layoutPlanId);

      const events = await eventsFor(ready.clientId);
      const match = events.find((e) => e.event_type === 'creative_qa_approved' && e.entity_id === reportId);
      expect(match).toBeDefined();
      expect(match!.entity_type).toBe('creative_qa_report');
    }, 30_000);

    it('visual generation success records visual_generation_succeeded for each generated output', async () => {
      const ready = await createGeneratedOutputs('Analytics Lifecycle Visual Success Client');
      const events = await eventsFor(ready.clientId);
      const succeeded = events.filter((e) => e.event_type === 'visual_generation_succeeded');
      expect(succeeded.length).toBe(ready.outputs.length);
      for (const output of ready.outputs) {
        expect(succeeded.some((e) => e.entity_id === output.id)).toBe(true);
      }
      expect(succeeded[0].provider).toBe('openai');
      expect(succeeded[0].model).toBe('gpt-4o');
    }, 30_000);

    it('production package creation records production_package_created', async () => {
      const ready = await createPackageReadyProductionJob('Analytics Lifecycle Package Client');
      const events = await eventsFor(ready.clientId);
      const match = events.find(
        (e) => e.event_type === 'production_package_created' && e.entity_id === (ready.productionJob as any).id
      );
      expect(match).toBeDefined();
    }, 30_000);

    it('production job approve/reject record their events', async () => {
      const readyA = await createPackageReadyProductionJob('Analytics Lifecycle Prod Approve Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const approveRes = await owner.post(`/api/production-jobs/${(readyA.productionJob as any).id}/approve`);
      expect(approveRes.status).toBe(200);

      const eventsA = await eventsFor(readyA.clientId);
      expect(eventsA.some((e) => e.event_type === 'production_job_approved' && e.entity_id === (readyA.productionJob as any).id)).toBe(true);

      const readyB = await createPackageReadyProductionJob('Analytics Lifecycle Prod Reject Client');
      const rejectRes = await owner.post(`/api/production-jobs/${(readyB.productionJob as any).id}/reject`);
      expect(rejectRes.status).toBe(200);

      const eventsB = await eventsFor(readyB.clientId);
      expect(eventsB.some((e) => e.event_type === 'production_job_rejected' && e.entity_id === (readyB.productionJob as any).id)).toBe(true);
    }, 60_000);

    it('render job rendered records render_job_rendered', async () => {
      const ready = await createPackageReadyProductionJob('Analytics Lifecycle Render Client');
      const { renderJob } = await renderOnce((ready.productionJob as any).id);

      const events = await eventsFor(ready.clientId);
      const match = events.find((e) => e.event_type === 'render_job_rendered' && e.entity_id === (renderJob as any).id);
      expect(match).toBeDefined();
      expect(match!.metadata.preset).toBe('instagram_post');
      expect(match!.metadata.format).toBe('png');
    }, 30_000);

    it('export artifact download records export_artifact_downloaded, and NOT on a 404/403 attempt', async () => {
      const ready = await createPackageReadyProductionJob('Analytics Lifecycle Export Download Client');
      const { artifact } = await renderOnce((ready.productionJob as any).id);
      const owner = await loginAs(TEST_USERS.OWNER);

      const beforeCount = (await eventsFor(ready.clientId)).filter((e) => e.event_type === 'export_artifact_downloaded').length;

      const downloadRes = await owner.get(`/api/export-artifacts/${(artifact as any).id}/file`).responseType('blob');
      expect(downloadRes.status).toBe(200);

      const afterDownload = (await eventsFor(ready.clientId)).filter((e) => e.event_type === 'export_artifact_downloaded');
      expect(afterDownload.length).toBe(beforeCount + 1);

      // A 404 attempt (unknown artifact id) must record nothing.
      const notFoundRes = await owner.get(`/api/export-artifacts/${uuid()}/file`);
      expect(notFoundRes.status).toBe(404);
      const afterNotFound = (await eventsFor(ready.clientId)).filter((e) => e.event_type === 'export_artifact_downloaded');
      expect(afterNotFound.length).toBe(afterDownload.length);
    }, 30_000);
  });

  describe('5. Client isolation — summary endpoint', () => {
    const SCOPED_EMAIL = `scoped-analytics-${uuid()}@test.local`;

    it("a second client's summary/recent-activity never includes the first client's events", async () => {
      const clientA = await createPackageReadyProductionJob('Analytics Isolation Client A');
      const clientB = await createPackageReadyProductionJob('Analytics Isolation Client B');

      const owner = await loginAs(TEST_USERS.OWNER);
      const summaryA = await owner.get(`/api/clients/${clientA.clientId}/analytics/summary`);
      expect(summaryA.status).toBe(200);
      expect(summaryA.body.data.productionPackagesCreated).toBeGreaterThanOrEqual(1);

      const summaryB = await owner.get(`/api/clients/${clientB.clientId}/analytics/summary`);
      expect(summaryB.status).toBe(200);

      const idsInA = summaryA.body.data.recentActivity.map((e: any) => e.entityId);
      expect(idsInA).not.toContain((clientB.productionJob as any).id);
    }, 60_000);

    it('unauthorized cross-client summary access returns the same 404 client-access.ts already produces elsewhere', async () => {
      const clientA = await createClient('Analytics Isolation Restricted Client A');
      const clientB = await createClient('Analytics Isolation Restricted Client B');

      const passwordHash = await hashPassword(TEST_USER_PASSWORD);
      const scopedUser = await usersRepo.create({ id: uuid(), email: SCOPED_EMAIL, passwordHash, name: 'Scoped Analytics User' });
      await usersRepo.assignRole(scopedUser.id, 'OWNER');
      await clientMembersRepo.addMember(scopedUser.id, clientA);

      const scopedAgent = await loginAs(SCOPED_EMAIL);
      const okRes = await scopedAgent.get(`/api/clients/${clientA}/analytics/summary`);
      expect(okRes.status).toBe(200);

      const deniedRes = await scopedAgent.get(`/api/clients/${clientB}/analytics/summary`);
      expect(deniedRes.status).toBe(404);
    });
  });

  describe('6. Secret sanitization — no analytics_events.metadata value ever contains a raw secret-shaped key', () => {
    it('a broad scan of persisted metadata never contains apiKey/password/secret/authorization keys, or a credential-shaped token key', async () => {
      const { rows } = await pool.query('SELECT metadata FROM analytics_events LIMIT 500');
      // Word-aware, matching the repository's own isDenylistedKey() logic —
      // legitimate fields like tokenInput/tokenOutput/attempts must NOT trip
      // this (they are real, non-secret metadata the plan itself specifies).
      const words = (key: string) =>
        key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\-\s]+/).filter(Boolean);
      const isDenylisted = (key: string) => {
        const w = words(key);
        if (w.some((x) => x === 'secret' || x === 'password' || x === 'authorization' || x === 'auth')) return true;
        if (w.includes('api') && w.includes('key')) return true;
        return w[w.length - 1] === 'token';
      };
      for (const row of rows) {
        const keys = Object.keys(row.metadata ?? {});
        for (const key of keys) {
          expect(isDenylisted(key)).toBe(false);
        }
      }
    });
  });
});
