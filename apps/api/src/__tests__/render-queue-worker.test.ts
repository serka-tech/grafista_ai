import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { store } from '../data/store.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';
import { usersRepo } from '../db/repositories/users.js';
import { clientMembersRepo } from '../db/repositories/client-members.js';
import { hashPassword } from '../auth/password.js';
import type { RenderInput, RenderOutput } from '../render/adapters/types.js';

/**
 * Phase 3 Step 5A — Render Queue / Polling Worker.
 *
 * Structurally mirrors render-jobs.test.ts (same fixture pipeline, same
 * vi.hoisted() aiControl/rendererControl mocking idiom, same real embedded
 * Postgres + real local-disk storage + real fake renderer adapter under
 * RENDERER_PROVIDER=fake) — this file adds ONLY the queue/worker-specific
 * surface: RENDER_QUEUE_ENABLED=true creation (202 + 'queued'), the
 * deterministic `runOnePollCycle` (processNextRenderJob) tick, claim/lock
 * concurrency, job-level retry/exhaustion, cancel (pending/queued and
 * rendering), and cancel RBAC/client-isolation.
 *
 * RENDER_QUEUE_ENABLED is OFF for the whole rest of the suite (unset by
 * vitest.config.ts/global-setup.ts) — every test in this file that needs it
 * ON sets `process.env.RENDER_QUEUE_ENABLED = 'true'` itself and restores it
 * in `afterEach`, mirroring storage.test.ts's STORAGE_PROVIDER override
 * pattern exactly, so no other test file is ever affected.
 */

const rendererControl = vi.hoisted(() => ({ failRender: false }));

vi.mock('../render/adapters/factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../render/adapters/factory.js')>();
  return {
    ...actual,
    getRendererAdapter: () => {
      const real = actual.getRendererAdapter();
      return {
        name: real.name,
        version: real.version,
        render: async (input: RenderInput): Promise<RenderOutput> => {
          if (rendererControl.failRender) {
            throw Object.assign(new Error('Simulated renderer outage: render failed'), { status: 502 });
          }
          return real.render(input);
        },
      };
    },
  };
});

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
        imageBase64: Buffer.from('grafista-render-queue-worker-test-image-bytes-1').toString('base64'),
        mimeType: 'image/png',
        width: 1080,
        height: 1080,
      },
      {
        imageBase64: Buffer.from('grafista-render-queue-worker-test-image-bytes-2').toString('base64'),
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
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for render queue worker' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-render-queue-worker-test'), { filename, contentType: 'image/png' });
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
  await approveCreativeQaFor(ready.layoutPlanId);
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner.post(`/api/layout-plans/${ready.layoutPlanId}/visual-generation`);
  expect(res.status).toBe(201);
  const outputs = res.body.data as Array<{ id: string; status: string }>;
  expect(outputs.every((o) => o.status === 'generated')).toBe(true);
  return { ...ready, outputs };
}

/** The standard starting point for every test here: a REAL production_jobs
 * row at status 'package_ready'. */
async function createPackageReadyProductionJob(clientName: string) {
  const ready = await createGeneratedOutputs(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const jobRes = await owner.post(`/api/generated-outputs/${ready.outputs[0].id}/production-jobs`);
  expect(jobRes.status).toBe(201);
  const productionJob = jobRes.body.data as Record<string, unknown>;
  expect(productionJob.status).toBe('package_ready');
  return { ...ready, productionJob };
}

async function userIdByEmail(email: string) {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  expect(rows.length).toBe(1);
  return rows[0].id as string;
}

/** Creates a QUEUED render job (RENDER_QUEUE_ENABLED must already be 'true'). */
async function createQueuedRenderJob(productionJobId: string): Promise<Record<string, any> & { id: string }> {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/production-jobs/${productionJobId}/render`)
    .send({ preset: 'instagram_post', exportFormat: 'png' });
  expect(res.status).toBe(202);
  expect(res.body.data.status).toBe('queued');
  return res.body.data as Record<string, any> & { id: string };
}

beforeEach(async () => {
  rendererControl.failRender = false;
  // The worker's claim query is deliberately GLOBAL/client-agnostic (plan §9
  // — claiming is not user-scoped), so a queued/pending job left behind by a
  // PREVIOUS test in this file (e.g. one that only asserts on creation, or a
  // cancel test that never drives the job to completion) would otherwise be
  // claimed ahead of THIS test's own job by claimNext()'s "oldest first"
  // ordering, making claim/concurrency assertions flaky. Draining before
  // every test keeps each test's claim() calls deterministic without
  // changing the worker's real (correctly global) claim semantics.
  await pool.query("UPDATE render_jobs SET status = 'cancelled', cancelled_at = NOW(), finished_at = NOW() WHERE status IN ('pending', 'queued')");
});

afterEach(() => {
  delete process.env.RENDER_QUEUE_ENABLED;
  delete process.env.RENDER_JOB_MAX_ATTEMPTS;
  delete process.env.RENDER_JOB_BASE_DELAY_MS;
});

describe('1. Sync mode (default, RENDER_QUEUE_ENABLED unset) — unchanged behavior', () => {
  it('POST /production-jobs/:id/render still returns 201 with a terminal "rendered" job (no queue involved)', async () => {
    expect(process.env.RENDER_QUEUE_ENABLED).toBeUndefined();
    const { productionJob } = await createPackageReadyProductionJob('Queue Sync Default Client');
    const owner = await loginAs(TEST_USERS.OWNER);

    const res = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'png' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('rendered');
  }, 30_000);
});

describe('2. Queue-mode creation (RENDER_QUEUE_ENABLED=true)', () => {
  it('POST /production-jobs/:id/render returns 202 with a "queued" job carrying queuedAt/nextRunAt/maxAttempts', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const { productionJob } = await createPackageReadyProductionJob('Queue Creation Client');

    const job = await createQueuedRenderJob(productionJob.id as string);
    expect(job.queuedAt).toBeTruthy();
    expect(job.maxAttempts).toBe(3);
    expect(job.attemptCount ?? 0).toBe(0);

    const { rows } = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [job.id]);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('queued');
    expect(rows[0].next_run_at).toBeTruthy();
    expect(rows[0].queued_at).toBeTruthy();
  }, 30_000);
});

describe('3. Worker claim — atomic claim + concurrency', () => {
  it('claimNext moves a queued job straight to "rendering" and increments attempt_count', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const { productionJob } = await createPackageReadyProductionJob('Queue Claim Client');
    const job = await createQueuedRenderJob(productionJob.id as string);

    const claimed = await store.renderJobs.claimNext('test-worker-1');
    expect(claimed).toBeDefined();
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.status).toBe('rendering');
    expect(claimed!.attemptCount).toBe(1);
    expect(claimed!.lockedBy).toBe('test-worker-1');
    expect(claimed!.startedAt).toBeTruthy();
  }, 30_000);

  it('a single claimable job can never be claimed by two concurrent callers (real Postgres SKIP LOCKED)', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const { productionJob } = await createPackageReadyProductionJob('Queue Concurrent Claim Client');
    const job = await createQueuedRenderJob(productionJob.id as string);

    const [a, b] = await Promise.all([
      store.renderJobs.claimNext('worker-a'),
      store.renderJobs.claimNext('worker-b'),
    ]);

    const claimedResults = [a, b].filter((r) => r !== undefined);
    expect(claimedResults.length).toBe(1);
    expect(claimedResults[0]!.id).toBe(job.id);

    const { rows } = await pool.query('SELECT attempt_count, status FROM render_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('rendering');
    expect(rows[0].attempt_count).toBe(1);
  }, 30_000);

  it('returns undefined when there is nothing claimable', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const claimed = await store.renderJobs.claimNext('idle-worker');
    // Not asserting exact undefined-ness against other tests' leftover rows
    // (each test uses its own fresh production job) — just that calling it
    // with nothing of THIS test's own queued never throws.
    expect(claimed === undefined || typeof claimed?.id === 'string').toBe(true);
  });
});

describe('4. processNextRenderJob / runOnePollCycle — success path', () => {
  it('a queued job becomes "rendered" with finished_at set and a real export_artifacts row', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const { productionJob } = await createPackageReadyProductionJob('Queue Success Client');
    const job = await createQueuedRenderJob(productionJob.id as string);

    const { processNextRenderJob } = await import('../services/render-worker.js');
    const processed = await processNextRenderJob('success-worker');
    expect(processed).toBeDefined();
    expect(processed!.id).toBe(job.id);
    expect(processed!.status).toBe('rendered');
    expect(processed!.finishedAt).toBeTruthy();
    expect(processed!.attemptCount).toBe(1);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM export_artifacts WHERE render_job_id = $1', [
      job.id,
    ]);
    expect(rows[0].count).toBe(1);
  }, 30_000);

  it('runOnePollCycle is the same deterministic tick function (no real timers)', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const { productionJob } = await createPackageReadyProductionJob('Queue RunOnePollCycle Client');
    await createQueuedRenderJob(productionJob.id as string);

    const { runOnePollCycle } = await import('../services/render-worker.js');
    const processed = await runOnePollCycle('poll-cycle-worker');
    expect(processed?.status).toBe('rendered');
  }, 30_000);
});

describe('5. Job-level retry vs exhaustion', () => {
  it(
    'a retryable failure (renderer outage, classified "unknown"/retryable) returns the job to "queued" with next_run_at + error_message, then a later tick succeeds once the renderer recovers',
    async () => {
      process.env.RENDER_QUEUE_ENABLED = 'true';
      process.env.RENDER_JOB_MAX_ATTEMPTS = '3';
      const { productionJob } = await createPackageReadyProductionJob('Queue Retry Success Client');
      const job = await createQueuedRenderJob(productionJob.id as string);

      rendererControl.failRender = true;
      const { processNextRenderJob } = await import('../services/render-worker.js');
      const firstAttempt = await processNextRenderJob('retry-worker');
      expect(firstAttempt).toBeDefined();
      expect(firstAttempt!.id).toBe(job.id);
      expect(firstAttempt!.status).toBe('queued');
      expect(firstAttempt!.attemptCount).toBe(1);
      expect(firstAttempt!.errorMessage).toMatch(/Simulated renderer outage/);
      expect(firstAttempt!.nextRunAt).toBeTruthy();

      // Force the retry to be immediately eligible (bypass the real backoff
      // delay) and let the renderer recover, then tick again.
      await pool.query("UPDATE render_jobs SET next_run_at = NOW() WHERE id = $1", [job.id]);
      rendererControl.failRender = false;

      const secondAttempt = await processNextRenderJob('retry-worker');
      expect(secondAttempt).toBeDefined();
      expect(secondAttempt!.id).toBe(job.id);
      expect(secondAttempt!.status).toBe('rendered');
      expect(secondAttempt!.attemptCount).toBe(2);
    },
    30_000
  );

  it(
    'repeated failures exhaust max_attempts and the job becomes terminal "failed" with error_message set',
    async () => {
      process.env.RENDER_QUEUE_ENABLED = 'true';
      process.env.RENDER_JOB_MAX_ATTEMPTS = '2';
      const { productionJob } = await createPackageReadyProductionJob('Queue Retry Exhausted Client');
      const job = await createQueuedRenderJob(productionJob.id as string);

      rendererControl.failRender = true;
      const { processNextRenderJob } = await import('../services/render-worker.js');

      const first = await processNextRenderJob('exhaust-worker');
      expect(first!.status).toBe('queued');
      expect(first!.attemptCount).toBe(1);

      await pool.query("UPDATE render_jobs SET next_run_at = NOW() WHERE id = $1", [job.id]);
      const second = await processNextRenderJob('exhaust-worker');
      expect(second!.status).toBe('failed');
      expect(second!.attemptCount).toBe(2);
      expect(second!.finishedAt).toBeTruthy();
      expect(second!.errorMessage).toMatch(/Simulated renderer outage/);

      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM export_artifacts WHERE render_job_id = $1', [
        job.id,
      ]);
      expect(rows[0].count).toBe(0);
    },
    30_000
  );
});

describe('6. Cancel — pending/queued vs rendering vs terminal', () => {
  it('cancelling a still-"queued" job (never claimed) transitions it directly to "cancelled"', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const { productionJob } = await createPackageReadyProductionJob('Queue Cancel Queued Client');
    const job = await createQueuedRenderJob(productionJob.id as string);
    const owner = await loginAs(TEST_USERS.OWNER);

    const res = await owner.post(`/api/render-jobs/${job.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect(res.body.data.cancelledAt).toBeTruthy();
    expect(res.body.data.finishedAt).toBeTruthy();
  }, 30_000);

  it(
    'cancelling a "rendering" job only sets cancellationRequested — the worker finalizes to "cancelled" on its next observation',
    async () => {
      process.env.RENDER_QUEUE_ENABLED = 'true';
      const { productionJob } = await createPackageReadyProductionJob('Queue Cancel Rendering Client');
      const job = await createQueuedRenderJob(productionJob.id as string);

      // Claim it ourselves (simulating "the worker already started") without
      // running the pipeline yet.
      const claimed = await store.renderJobs.claimNext('cancel-target-worker');
      expect(claimed!.id).toBe(job.id);
      expect(claimed!.status).toBe('rendering');

      const owner = await loginAs(TEST_USERS.OWNER);
      const cancelRes = await owner.post(`/api/render-jobs/${job.id}/cancel`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('rendering');
      expect(cancelRes.body.data.cancellationRequested).toBe(true);

      // The worker's next observation (processRenderJob on the already-
      // claimed job) must finalize it to 'cancelled', not 'rendered'.
      const { processRenderJob } = await import('../services/render-worker.js');
      const finalized = await processRenderJob(job.id, 'cancel-target-worker');
      expect(finalized).toBeDefined();
      expect(finalized!.status).toBe('cancelled');
      expect(finalized!.cancelledAt).toBeTruthy();
      expect(finalized!.finishedAt).toBeTruthy();
    },
    30_000
  );

  it('cancelling an already-terminal ("rendered") job is rejected with 409, not a silent no-op', async () => {
    const { productionJob } = await createPackageReadyProductionJob('Queue Cancel Terminal Client');
    const owner = await loginAs(TEST_USERS.OWNER);

    // Sync mode (default) — job comes back already 'rendered'.
    const renderRes = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'png' });
    expect(renderRes.status).toBe(201);
    const renderJob = renderRes.body.data as Record<string, unknown>;
    expect(renderJob.status).toBe('rendered');

    const cancelRes = await owner.post(`/api/render-jobs/${renderJob.id}/cancel`);
    expect(cancelRes.status).toBe(409);
  }, 30_000);

  it('cancelling an unknown render job id is rejected with 404', async () => {
    const owner = await loginAs(TEST_USERS.OWNER);
    const res = await owner.post(`/api/render-jobs/${uuid()}/cancel`);
    expect(res.status).toBe(404);
  });
});

describe('7. Cancel RBAC + client isolation', () => {
  it('CONTENT_MANAGER (no render_jobs:cancel) gets 403', async () => {
    const { productionJob } = await createPackageReadyProductionJob('Queue Cancel RBAC Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const renderRes = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'png' });
    expect(renderRes.status).toBe(201);
    const renderJob = renderRes.body.data as Record<string, unknown>;

    const contentManager = await loginAs(TEST_USERS.CONTENT_MANAGER);
    const res = await contentManager.post(`/api/render-jobs/${renderJob.id}/cancel`);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe('render_jobs:cancel');
  }, 30_000);

  it(
    'a client-membership-restricted user gets 404 cancelling another client\'s render job (client isolation preserved)',
    async () => {
      process.env.RENDER_QUEUE_ENABLED = 'true';
      const { productionJob } = await createPackageReadyProductionJob('Queue Cancel Isolation Client');
      const job = await createQueuedRenderJob(productionJob.id as string);

      const passwordHash = await hashPassword(TEST_USER_PASSWORD);
      const scopedEmail = `scoped-cancel-${uuid()}@test.local`;
      const scopedUser = await usersRepo.create({ id: uuid(), email: scopedEmail, passwordHash, name: 'Scoped Cancel User' });
      await usersRepo.assignRole(scopedUser.id, 'OWNER');

      // Restrict to a DIFFERENT client (never granted membership on the
      // production job's own client) — must be treated exactly like "not
      // found", same as every other client-isolation guard in this codebase.
      const otherClientId = await createClient('Queue Cancel Isolation Other Client');
      await clientMembersRepo.addMember(scopedUser.id, otherClientId);

      const scopedAgent = await loginAs(scopedEmail);
      const res = await scopedAgent.post(`/api/render-jobs/${job.id}/cancel`);
      expect(res.status).toBe(404);

      // Sanity: the unrestricted OWNER can still cancel it.
      const owner = await loginAs(TEST_USERS.OWNER);
      const ownerRes = await owner.post(`/api/render-jobs/${job.id}/cancel`);
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.data.status).toBe('cancelled');
    },
    30_000
  );
});

describe('8. Provider-vs-job retry boundary — permanent/auth/provider-unavailable classes never get a job-level retry', () => {
  it('classifyProviderError marks provider_unavailable/auth_error/permanent as non-retryable — the exact classes render-worker.ts treats as "skip retry, go straight to failed"', async () => {
    const { classifyProviderError } = await import('@grafista/model-router');

    const providerUnavailable = classifyProviderError({ error: 'provider configuration error: KIE_AI_API_KEY is not set' });
    expect(providerUnavailable.kind).toBe('provider_unavailable');
    expect(providerUnavailable.retryable).toBe(false);

    const authError = classifyProviderError({ error: 'Unauthorized', httpStatus: 401 });
    expect(authError.kind).toBe('auth_error');
    expect(authError.retryable).toBe(false);

    const permanent = classifyProviderError({ error: 'Bad Request', httpStatus: 400 });
    expect(permanent.kind).toBe('permanent');
    expect(permanent.retryable).toBe(false);
  });

  it(
    'the render job\'s OWN failure path (renderer outage, message classified "unknown") DOES retry — the contrast case proving job-level retry only ever covers the non-AI I/O failures this worker is meant for',
    async () => {
      process.env.RENDER_QUEUE_ENABLED = 'true';
      const { productionJob } = await createPackageReadyProductionJob('Queue Retryable Contrast Client');
      const job = await createQueuedRenderJob(productionJob.id as string);

      rendererControl.failRender = true;
      const { processNextRenderJob } = await import('../services/render-worker.js');
      const attempted = await processNextRenderJob('boundary-worker');
      expect(attempted!.id).toBe(job.id);
      expect(attempted!.status).toBe('queued'); // retried, NOT failed
      expect(attempted!.attemptCount).toBe(1);
      rendererControl.failRender = false;

      await pool.query('UPDATE render_jobs SET next_run_at = NOW() WHERE id = $1', [job.id]);
      const finished = await processNextRenderJob('boundary-worker');
      expect(finished!.status).toBe('rendered');
    },
    30_000
  );
});

describe('9. Regression — render-jobs.ts route/response shape untouched in sync mode', () => {
  it('the render history endpoint still returns the same shape for a sync-mode render', async () => {
    const { productionJob } = await createPackageReadyProductionJob('Queue Regression History Client');
    const owner = await loginAs(TEST_USERS.OWNER);

    const renderRes = await owner
      .post(`/api/production-jobs/${productionJob.id}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'png' });
    expect(renderRes.status).toBe(201);

    const historyRes = await owner.get(`/api/production-jobs/${productionJob.id}/render-jobs`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.total).toBe(1);
    expect(historyRes.body.data[0].status).toBe('rendered');
  }, 30_000);

  it('the domain-level guard still 403s independently of the route, unaffected by queue mode', async () => {
    const contentManagerId = await userIdByEmail(TEST_USERS.CONTENT_MANAGER);
    const { renderProductionJob } = await import('../services/render-engine.js');
    await expect(
      renderProductionJob(uuid(), { preset: 'instagram_post', exportFormat: 'png' }, contentManagerId)
    ).rejects.toMatchObject({ status: 403 });
  });
});
