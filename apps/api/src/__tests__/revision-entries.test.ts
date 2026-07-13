import { describe, it, expect, vi, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { app } from '../app.js';
import { startTestServer } from '../test/http-test-server.js';
import { pool } from '../db/pool.js';
import { store } from '../data/store.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { usersRepo } from '../db/repositories/users.js';
import { clientMembersRepo } from '../db/repositories/client-members.js';
import { hashPassword } from '../auth/password.js';

const testServer = startTestServer(app);
afterAll(() => testServer.close());

/**
 * Phase 3 Step 6B — Revision Entries.
 *
 * Structurally mirrors analytics-events.test.ts / client-isolation.test.ts:
 * the AI provider is mocked wholesale (vi.mock('@grafista/model-router')) so
 * the fixture pipeline (client -> design DNA -> content idea -> design brief
 * -> layout plan -> Creative QA) always produces a REAL, independent
 * pipeline against the real embedded Postgres instance — nothing about
 * revision_entries itself is mocked. Fixture helpers are deliberately
 * self-contained (not imported from design-dna.test.ts/layout-plans.test.ts/
 * creative-qa.test.ts, which don't export theirs) — same approach
 * analytics-events.test.ts already takes for its own duplicated helpers.
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

  class MockModelRouter {
    async complete(req: { taskType: string }) {
      let content: unknown;
      if (req.taskType === 'style_analysis') content = STYLE_ANALYSIS_CONTENT;
      else if (req.taskType === 'design_dna_synthesis') content = DESIGN_DNA_CONTENT;
      else if (req.taskType === 'content_ideation') content = CONTENT_IDEATION_CONTENT;
      else if (req.taskType === 'layout_generation') content = LAYOUT_ALTERNATIVES;
      else if (req.taskType === 'creative_qa') content = CREATIVE_QA_SUCCESS_CONTENT;
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
  const agent = request.agent(testServer.server);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function createClient(name: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for revision entries' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-revision-entries-test'), { filename, contentType: 'image/png' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function analyzeDesignDna(clientId: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  await uploadReference(clientId, `reference-${uuid()}.png`);
  const analyzeRes = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
  expect(analyzeRes.status).toBe(201);
  return analyzeRes.body.data.id as string;
}

async function createFullyReadyLayoutPlan(clientName: string) {
  const clientId = await createClient(clientName);
  await uploadReference(clientId, 'reference-1.png');
  const owner = await loginAs(TEST_USERS.OWNER);
  const analyzeRes = await owner.post(`/api/clients/${clientId}/design-dna/analyze`);
  expect(analyzeRes.status).toBe(201);
  const approveDnaRes = await owner.post(`/api/clients/${clientId}/design-dna/approve`);
  expect(approveDnaRes.status).toBe(200);

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

  return { clientId, briefId, layoutPlanId };
}

async function createGeneratedCreativeQaReport(clientName: string) {
  const ready = await createFullyReadyLayoutPlan(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const approveLayoutRes = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/approve`);
  expect(approveLayoutRes.status).toBe(200);

  const genRes = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/creative-qa`);
  expect(genRes.status).toBe(201);
  const reportId = genRes.body.data.id as string;
  return { ...ready, reportId };
}

async function revisionsFor(clientId: string) {
  const { rows } = await pool.query(
    'SELECT * FROM revision_entries WHERE client_id = $1 ORDER BY created_at ASC',
    [clientId]
  );
  return rows;
}

describe('Phase 3 Step 6B — Revision Entries', () => {
  describe('1. Repository — record()', () => {
    it('inserts a row with all fields set and before/after/metadata round-tripping as JSON', async () => {
      const clientId = await createClient('Revisions Repo Record Client');
      const entityId = uuid();
      const created = await store.revisionEntries.record({
        clientId,
        entityType: 'layout_plan',
        entityId,
        revisionType: 'layout_plan_approved',
        actorUserId: null,
        beforeSnapshot: { status: 'generated' },
        afterSnapshot: { status: 'approved', approvedBy: null },
        reason: 'Looks great',
        metadata: { source: 'test' },
      });

      expect(created.id).toBeTruthy();
      expect(created.clientId).toBe(clientId);
      expect(created.entityId).toBe(entityId);
      expect(created.revisionType).toBe('layout_plan_approved');
      expect(created.beforeSnapshot).toEqual({ status: 'generated' });
      expect(created.afterSnapshot).toEqual({ status: 'approved', approvedBy: null });
      expect(created.reason).toBe('Looks great');
      expect(created.metadata).toEqual({ source: 'test' });

      const { rows } = await pool.query('SELECT * FROM revision_entries WHERE id = $1', [created.id]);
      expect(rows.length).toBe(1);
      expect(rows[0].after_snapshot).toEqual({ status: 'approved', approvedBy: null });
    });

    it('rejects an insert with no client_id (NOT NULL constraint)', async () => {
      await expect(
        store.revisionEntries.record({
          // @ts-expect-error deliberately omitting the required field
          clientId: undefined,
          entityType: 'layout_plan',
          entityId: uuid(),
          revisionType: 'layout_plan_approved',
          afterSnapshot: { status: 'approved' },
        })
      ).rejects.toThrow();
    });

    it('rejects a denylisted key in beforeSnapshot/afterSnapshot/metadata — value is never persisted', async () => {
      const clientId = await createClient('Revisions Repo Denylist Client');
      const entityId = uuid();

      await expect(
        store.revisionEntries.record({
          clientId,
          entityType: 'design_dna',
          entityId,
          revisionType: 'design_dna_approved',
          afterSnapshot: { status: 'approved', apiKey: 'sk-super-secret-value' },
        })
      ).rejects.toThrow(/denylisted/);

      const { rows } = await pool.query('SELECT * FROM revision_entries WHERE entity_id = $1', [entityId]);
      expect(rows.length).toBe(0);
    });

    it('truncates a reason longer than 2000 characters instead of rejecting it', async () => {
      const clientId = await createClient('Revisions Repo Truncation Client');
      const longReason = 'x'.repeat(2500);
      const created = await store.revisionEntries.record({
        clientId,
        entityType: 'layout_plan',
        entityId: uuid(),
        revisionType: 'layout_plan_rejected',
        afterSnapshot: { status: 'rejected' },
        reason: longReason,
      });
      expect(created.reason?.length).toBe(2000);
    });

    it('getRecentByClientId respects limit, ordering, and client scoping', async () => {
      const clientId = await createClient('Revisions Repo Recent Client');
      const otherClientId = await createClient('Revisions Repo Recent Other Client');

      for (let i = 0; i < 3; i++) {
        await store.revisionEntries.record({
          clientId,
          entityType: 'layout_plan',
          entityId: uuid(),
          revisionType: 'layout_plan_approved',
          afterSnapshot: { status: 'approved', seq: i },
        });
      }
      await store.revisionEntries.record({
        clientId: otherClientId,
        entityType: 'layout_plan',
        entityId: uuid(),
        revisionType: 'layout_plan_approved',
        afterSnapshot: { status: 'approved' },
      });

      const recent = await store.revisionEntries.getRecentByClientId(clientId, 2);
      expect(recent.length).toBe(2);
      expect(recent[0].afterSnapshot.seq).toBe(2); // most recent first
      expect(recent.every((r) => r.clientId === clientId)).toBe(true);
    });
  });

  describe('2. Recorder — recordBestEffort() never throws and never blocks the primary flow', () => {
    it('swallows a simulated failure (invalid client_id) without throwing', async () => {
      await expect(
        store.revisionEntries.recordBestEffort({
          clientId: 'not-a-real-uuid',
          entityType: 'layout_plan',
          entityId: uuid(),
          revisionType: 'layout_plan_approved',
          afterSnapshot: { status: 'approved' },
        })
      ).resolves.toBeUndefined();
    });

    it('a denylisted key is swallowed (warned, not thrown) and never persisted', async () => {
      const clientId = await createClient('Revisions Recorder Denylist Client');
      const entityId = uuid();

      await expect(
        store.revisionEntries.recordBestEffort({
          clientId,
          entityType: 'layout_plan',
          entityId,
          revisionType: 'layout_plan_approved',
          afterSnapshot: { status: 'approved', authToken: 'leaked-token-value' },
        })
      ).resolves.toBeUndefined();

      const { rows } = await pool.query('SELECT * FROM revision_entries WHERE entity_id = $1', [entityId]);
      expect(rows.length).toBe(0);
    });
  });

  describe('3. Lifecycle integration — each instrumented call site writes its revision entry', () => {
    it('design_dna approve records design_dna_approved', async () => {
      const clientId = await createClient('Revisions Lifecycle DNA Approve Client');
      const dnaId = await analyzeDesignDna(clientId);
      const owner = await loginAs(TEST_USERS.OWNER);
      const approveRes = await owner.post(`/api/clients/${clientId}/design-dna/approve`);
      expect(approveRes.status).toBe(200);

      const revisions = await revisionsFor(clientId);
      const match = revisions.find((r) => r.revision_type === 'design_dna_approved' && r.entity_id === dnaId);
      expect(match).toBeDefined();
      expect(match!.entity_type).toBe('design_dna');
      expect(match!.after_snapshot.status).toBe('approved');
    });

    it('design_dna revise records design_dna_needs_revision with the reason', async () => {
      const clientId = await createClient('Revisions Lifecycle DNA Revise Client');
      const dnaId = await analyzeDesignDna(clientId);
      const owner = await loginAs(TEST_USERS.OWNER);
      const reviseRes = await owner
        .post(`/api/clients/${clientId}/design-dna/revise`)
        .send({ notes: 'Logo needs to be bigger' });
      expect(reviseRes.status).toBe(200);

      const revisions = await revisionsFor(clientId);
      const match = revisions.find((r) => r.revision_type === 'design_dna_needs_revision' && r.entity_id === dnaId);
      expect(match).toBeDefined();
      expect(match!.reason).toBe('Logo needs to be bigger');
      expect(match!.after_snapshot.revisionNotes).toBe('Logo needs to be bigger');
    });

    it('design_dna approve() recovers a needs_revision row (200) and records design_dna_approved (revise → re-approve loop)', async () => {
      const clientId = await createClient('Revisions Lifecycle DNA Recover Client');
      const dnaId = await analyzeDesignDna(clientId);
      const owner = await loginAs(TEST_USERS.OWNER);
      const reviseRes = await owner
        .post(`/api/clients/${clientId}/design-dna/revise`)
        .send({ notes: 'Needs rework' });
      expect(reviseRes.status).toBe(200);
      expect(reviseRes.body.data.status).toBe('needs_revision');

      // approve() now accepts 'needs_revision' too, so the round-trip closes on the
      // same version (mirrors layout_plan reject-with-notes → approve below).
      const approveRes = await owner.post(`/api/clients/${clientId}/design-dna/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('approved');

      const approvedMatch = (await revisionsFor(clientId)).find(
        (r) => r.entity_id === dnaId && r.revision_type === 'design_dna_approved'
      );
      expect(approvedMatch).toBeDefined();
    });

    it('layout_plan approve records layout_plan_approved', async () => {
      const ready = await createFullyReadyLayoutPlan('Revisions Lifecycle Layout Approve Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const approveRes = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/approve`);
      expect(approveRes.status).toBe(200);

      const revisions = await revisionsFor(ready.clientId);
      const match = revisions.find((r) => r.revision_type === 'layout_plan_approved' && r.entity_id === ready.layoutPlanId);
      expect(match).toBeDefined();
      expect(match!.entity_type).toBe('layout_plan');
    });

    it('layout_plan reject WITHOUT notes records layout_plan_rejected', async () => {
      const ready = await createFullyReadyLayoutPlan('Revisions Lifecycle Layout Reject Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const rejectRes = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/reject`);
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('rejected');

      const revisions = await revisionsFor(ready.clientId);
      const match = revisions.find((r) => r.revision_type === 'layout_plan_rejected' && r.entity_id === ready.layoutPlanId);
      expect(match).toBeDefined();
      expect(match!.reason).toBeNull();
    });

    it('layout_plan reject WITH notes records layout_plan_needs_revision with the reason, and a subsequent approve records a second, round-trip revision entry', async () => {
      const ready = await createFullyReadyLayoutPlan('Revisions Lifecycle Layout Round-Trip Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const rejectRes = await owner
        .post(`/api/layout-plans/${ready.layoutPlanId}/reject`)
        .send({ notes: 'Move the CTA down' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('needs_revision');

      const approveRes = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/approve`);
      expect(approveRes.status).toBe(200);

      const revisions = await revisionsFor(ready.clientId);
      const needsRevisionMatch = revisions.find(
        (r) => r.revision_type === 'layout_plan_needs_revision' && r.entity_id === ready.layoutPlanId
      );
      expect(needsRevisionMatch).toBeDefined();
      expect(needsRevisionMatch!.reason).toBe('Move the CTA down');

      const approvedMatches = revisions.filter(
        (r) => r.revision_type === 'layout_plan_approved' && r.entity_id === ready.layoutPlanId
      );
      expect(approvedMatches.length).toBe(1);
      // Append-only: both rows co-exist, in order.
      expect(new Date(needsRevisionMatch!.created_at).getTime()).toBeLessThanOrEqual(
        new Date(approvedMatches[0].created_at).getTime()
      );
    });

    it('creative_qa approve records creative_qa_report_approved AND the existing creative_qa_approved analytics event still fires independently', async () => {
      const ready = await createGeneratedCreativeQaReport('Revisions Lifecycle QA Approve Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const approveRes = await owner.post(`/api/creative-qa/${ready.reportId}/approve`);
      expect(approveRes.status).toBe(200);

      const revisions = await revisionsFor(ready.clientId);
      const revisionMatch = revisions.find(
        (r) => r.revision_type === 'creative_qa_report_approved' && r.entity_id === ready.reportId
      );
      expect(revisionMatch).toBeDefined();
      expect(revisionMatch!.entity_type).toBe('creative_qa_report');

      const { rows: analyticsRows } = await pool.query(
        'SELECT * FROM analytics_events WHERE client_id = $1 AND event_type = $2 AND entity_id = $3',
        [ready.clientId, 'creative_qa_approved', ready.reportId]
      );
      expect(analyticsRows.length).toBe(1);
    });

    it('creative_qa reject WITHOUT notes records creative_qa_report_rejected', async () => {
      const ready = await createGeneratedCreativeQaReport('Revisions Lifecycle QA Reject Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const rejectRes = await owner.post(`/api/creative-qa/${ready.reportId}/reject`);
      expect(rejectRes.status).toBe(200);

      const revisions = await revisionsFor(ready.clientId);
      const match = revisions.find(
        (r) => r.revision_type === 'creative_qa_report_rejected' && r.entity_id === ready.reportId
      );
      expect(match).toBeDefined();
      expect(match!.reason).toBeNull();
    });

    it('creative_qa reject WITH notes records creative_qa_report_needs_revision with the reason', async () => {
      const ready = await createGeneratedCreativeQaReport('Revisions Lifecycle QA Needs-Revision Client');
      const owner = await loginAs(TEST_USERS.OWNER);
      const rejectRes = await owner
        .post(`/api/creative-qa/${ready.reportId}/reject`)
        .send({ notes: 'Contrast needs work' });
      expect(rejectRes.status).toBe(200);

      const revisions = await revisionsFor(ready.clientId);
      const match = revisions.find(
        (r) => r.revision_type === 'creative_qa_report_needs_revision' && r.entity_id === ready.reportId
      );
      expect(match).toBeDefined();
      expect(match!.reason).toBe('Contrast needs work');
    });
  });

  describe('4. Client isolation — GET /clients/:id/revisions/recent', () => {
    const SCOPED_EMAIL = `scoped-revisions-${uuid()}@test.local`;

    it("a second client's recent revisions never includes the first client's entries", async () => {
      const readyA = await createFullyReadyLayoutPlan('Revisions Isolation Client A');
      const readyB = await createFullyReadyLayoutPlan('Revisions Isolation Client B');

      const owner = await loginAs(TEST_USERS.OWNER);
      const approveA = await owner.post(`/api/layout-plans/${readyA.layoutPlanId}/approve`);
      expect(approveA.status).toBe(200);
      const approveB = await owner.post(`/api/layout-plans/${readyB.layoutPlanId}/approve`);
      expect(approveB.status).toBe(200);

      const recentA = await owner.get(`/api/clients/${readyA.clientId}/revisions/recent`);
      expect(recentA.status).toBe(200);
      const idsInA = recentA.body.data.map((r: any) => r.entityId);
      expect(idsInA).toContain(readyA.layoutPlanId);
      expect(idsInA).not.toContain(readyB.layoutPlanId);

      // List shape is minimal — no snapshot fields leaked.
      for (const item of recentA.body.data) {
        expect(item.beforeSnapshot).toBeUndefined();
        expect(item.afterSnapshot).toBeUndefined();
      }
    });

    it('respects the limit query param (capped at 50)', async () => {
      const clientId = await createClient('Revisions Limit Client');
      for (let i = 0; i < 5; i++) {
        await store.revisionEntries.record({
          clientId,
          entityType: 'layout_plan',
          entityId: uuid(),
          revisionType: 'layout_plan_approved',
          afterSnapshot: { status: 'approved' },
        });
      }
      const owner = await loginAs(TEST_USERS.OWNER);
      const res = await owner.get(`/api/clients/${clientId}/revisions/recent?limit=2`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);

      const capped = await owner.get(`/api/clients/${clientId}/revisions/recent?limit=9999`);
      expect(capped.status).toBe(200);
      expect(capped.body.data.length).toBeLessThanOrEqual(50);
    });

    it('unauthorized cross-client access returns the same 404 pattern client-isolation.test.ts already tests elsewhere', async () => {
      const clientA = await createClient('Revisions Isolation Restricted Client A');
      const clientB = await createClient('Revisions Isolation Restricted Client B');

      const passwordHash = await hashPassword(TEST_USER_PASSWORD);
      const scopedUser = await usersRepo.create({ id: uuid(), email: SCOPED_EMAIL, passwordHash, name: 'Scoped Revisions User' });
      await usersRepo.assignRole(scopedUser.id, 'OWNER');
      await clientMembersRepo.addMember(scopedUser.id, clientA);

      const scopedAgent = await loginAs(SCOPED_EMAIL);
      const okRes = await scopedAgent.get(`/api/clients/${clientA}/revisions/recent`);
      expect(okRes.status).toBe(200);

      const deniedRes = await scopedAgent.get(`/api/clients/${clientB}/revisions/recent`);
      expect(deniedRes.status).toBe(404);
    });
  });
});
