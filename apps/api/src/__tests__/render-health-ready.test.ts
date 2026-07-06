import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { app } from '../app.js';
import { pool } from '../db/pool.js';
import { store } from '../data/store.js';
import { TEST_USERS, TEST_USER_PASSWORD } from '../test/global-setup.js';

/**
 * Production Readiness Step — Healthcheck + Worker Heartbeat/Stale Lock
 * Recovery.
 *
 * A new file (rather than extending render-queue-worker.test.ts) since the
 * subject matter is different: health/readiness routes, worker heartbeats,
 * queue summary, and the stale-lock sweep — not the render pipeline itself.
 * Follows the exact same conventions/fixture pipeline as
 * render-queue-worker.test.ts (real embedded Postgres + real local-disk
 * storage + real fake renderer adapter under RENDERER_PROVIDER=fake,
 * supertest against the real app, direct `pool.query` only for
 * backdating/assertions) — a real production_jobs row is required because
 * render_jobs.production_job_id is a hard FK, so tests here drive the same
 * full pipeline (client -> reference -> DesignDNA -> content idea -> brief
 * -> layout plan -> creative QA -> visual generation -> production job)
 * rather than hand-inserting rows that would violate FK constraints.
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
        imageBase64: Buffer.from('grafista-render-health-ready-test-image-bytes-1').toString('base64'),
        mimeType: 'image/png',
        width: 1080,
        height: 1080,
      },
      {
        imageBase64: Buffer.from('grafista-render-health-ready-test-image-bytes-2').toString('base64'),
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
  const res = await owner.post('/api/clients').send({ name, industry: 'food', notes: 'Test client for render-health-ready' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function uploadReference(clientId: string, filename: string) {
  const owner = await loginAs(TEST_USERS.OWNER);
  const res = await owner
    .post(`/api/clients/${clientId}/design-references`)
    .field('name', filename)
    .attach('file', Buffer.from('fake-png-bytes-for-render-health-ready-test'), { filename, contentType: 'image/png' });
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

/** A REAL production_jobs row at status 'package_ready' — the only legal
 * parent for a render_jobs row (production_job_id is a hard FK). */
async function createPackageReadyProductionJob(clientName: string) {
  const ready = await createGeneratedOutputs(clientName);
  const owner = await loginAs(TEST_USERS.OWNER);
  const jobRes = await owner.post(`/api/generated-outputs/${ready.outputs[0].id}/production-jobs`);
  expect(jobRes.status).toBe(201);
  const productionJob = jobRes.body.data as Record<string, unknown>;
  expect(productionJob.status).toBe('package_ready');
  return { ...ready, productionJob };
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
  // Same drain as render-queue-worker.test.ts's own beforeEach — the
  // worker's claim query is deliberately global, so leftover
  // pending/queued rows from a previous test would otherwise be claimed
  // ahead of this test's own job.
  await pool.query("UPDATE render_jobs SET status = 'cancelled', cancelled_at = NOW(), finished_at = NOW() WHERE status IN ('pending', 'queued')");
});

afterEach(async () => {
  delete process.env.RENDER_QUEUE_ENABLED;
  delete process.env.RENDER_JOB_MAX_ATTEMPTS;
  delete process.env.RENDER_JOB_BASE_DELAY_MS;
  delete process.env.RENDER_JOB_STALE_LOCK_MS;
  // Keep heartbeats from other tests in this file from leaking staleness
  // assertions into each other.
  await pool.query('DELETE FROM render_worker_heartbeats');
});

describe('GET /api/health — unchanged regression guard', () => {
  it('returns the exact same static shape as before this step', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'timestamp', 'version'].sort());
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('grafista-ai-studio-api');
    expect(res.body.version).toBe('0.1.0');
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('GET /api/health/ready — basic shape and no-auth access', () => {
  it('returns 200 with an overall ok/degraded status and all check keys present, no auth required', async () => {
    const res = await request(app).get('/api/health/ready');
    expect([200, 503]).toContain(res.status);
    expect(['ok', 'degraded', 'error']).toContain(res.body.status);
    const checks = res.body.checks;
    for (const key of ['database', 'storage', 'renderQueue', 'workerHeartbeat', 'providers', 'playwright']) {
      expect(checks).toHaveProperty(key);
      expect(checks[key]).toHaveProperty('status');
      expect(checks[key]).toHaveProperty('message');
      expect(checks[key]).toHaveProperty('checkedAt');
    }
  });

  it('database check is ok (real embedded Postgres is up)', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.body.checks.database.status).toBe('ok');
  });

  it('renderQueue reports "queue disabled" when RENDER_QUEUE_ENABLED is unset', async () => {
    expect(process.env.RENDER_QUEUE_ENABLED).toBeUndefined();
    const res = await request(app).get('/api/health/ready');
    expect(res.body.checks.renderQueue.status).toBe('ok');
    expect(res.body.checks.renderQueue.message.toLowerCase()).toContain('disabled');
  });

  it('workerHeartbeat reports "not applicable" when RENDER_QUEUE_ENABLED is unset', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.body.checks.workerHeartbeat.status).toBe('ok');
    expect(res.body.checks.workerHeartbeat.message.toLowerCase()).toContain('not applicable');
  });

  it('never leaks any real secret value present in the test process env', async () => {
    const res = await request(app).get('/api/health/ready');
    const stringified = JSON.stringify(res.body);
    const secretValues = [
      process.env.AUTH_SECRET,
      process.env.OPENAI_API_KEY,
      process.env.ANTHROPIC_API_KEY,
      process.env.DATABASE_URL,
    ].filter((v): v is string => Boolean(v && v.length > 3));
    for (const secret of secretValues) {
      expect(stringified).not.toContain(secret);
    }
  });

  it('providers check reports presence/absence only, never leaking the key value', async () => {
    const res = await request(app).get('/api/health/ready');
    const providers = res.body.checks.providers;
    expect(providers.details.openai).toBe('present');
    expect(providers.details.anthropic).toBe('present');
    expect(JSON.stringify(providers)).not.toContain(process.env.OPENAI_API_KEY);
    expect(JSON.stringify(providers)).not.toContain(process.env.ANTHROPIC_API_KEY);
  });
});

describe('Worker heartbeat — tick writes/updates a heartbeat row', () => {
  it('calling runOnePollCycle writes a recent heartbeat that /ready reflects as healthy', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const workerId = `test-heartbeat-worker-${uuid()}`;
    const { runOnePollCycle } = await import('../services/render-worker.js');
    await runOnePollCycle(workerId);

    const heartbeat = await store.renderWorkerHeartbeats.getHeartbeat(workerId);
    expect(heartbeat).toBeTruthy();
    expect(heartbeat!.status).toBe('ok');

    const res = await request(app).get('/api/health/ready');
    expect(res.body.checks.workerHeartbeat.status).toBe('ok');
    expect(res.body.checks.workerHeartbeat.details.workerCount).toBeGreaterThan(0);
  }, 30_000);

  it('a heartbeat older than the staleness threshold is reported as degraded', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const workerId = `test-stale-heartbeat-worker-${uuid()}`;
    await store.renderWorkerHeartbeats.upsertHeartbeat(workerId, { status: 'ok' });
    await pool.query("UPDATE render_worker_heartbeats SET last_heartbeat_at = NOW() - INTERVAL '1 hour'");

    const res = await request(app).get('/api/health/ready');
    expect(res.body.checks.workerHeartbeat.status).toBe('degraded');
  });
});

describe('Queue summary — countByStatus / getQueueSummary', () => {
  it('reflects seeded jobs at known statuses exactly', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    await pool.query('DELETE FROM render_jobs');

    const job1 = await createPackageReadyProductionJob('Health Ready Queue Summary Client 1');
    await createQueuedRenderJob(job1.productionJob.id as string);

    const job2 = await createPackageReadyProductionJob('Health Ready Queue Summary Client 2');
    const queuedJob2 = await createQueuedRenderJob(job2.productionJob.id as string);
    await store.renderJobs.claimNext('summary-worker'); // moves the oldest queued job to 'rendering'

    const summary = await store.renderJobs.getQueueSummary(900_000);
    expect(summary.byStatus.rendering).toBe(1);
    expect((summary.byStatus.queued ?? 0)).toBe(1);

    // Sanity: the claimed one is queuedJob2 or job1's job, either is fine —
    // what matters is the total distribution above.
    expect(queuedJob2.status).toBe('queued');
  }, 60_000);
});

describe('Stale lock recovery — sweepStaleRenderLocks', () => {
  it('recovers a stale rendering job (attempt_count < max_attempts) back to pending with locks cleared and a safe error note', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    process.env.RENDER_JOB_MAX_ATTEMPTS = '3';
    process.env.RENDER_JOB_STALE_LOCK_MS = '1000';

    const { productionJob } = await createPackageReadyProductionJob('Health Ready Stale Recover Client');
    const job = await createQueuedRenderJob(productionJob.id as string);
    const claimed = await store.renderJobs.claimNext('stale-worker-1');
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.attemptCount).toBe(1);

    await pool.query("UPDATE render_jobs SET started_at = NOW() - INTERVAL '5 seconds' WHERE id = $1", [job.id]);

    const { sweepStaleRenderLocks } = await import('../services/render-worker.js');
    const result = await sweepStaleRenderLocks();
    expect(result.recoveredCount).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [job.id]);
    const row = rows[0];
    expect(row.status).toBe('pending');
    expect(row.locked_by).toBeNull();
    expect(row.locked_at).toBeNull();
    expect(row.next_run_at).toBeTruthy();
    expect(row.error_message).toContain('stale lock recovered');
    expect(row.error_message).not.toMatch(/AUTH_SECRET|api[_-]?key/i);
  }, 30_000);

  it('fails a stale rendering job that has exhausted max_attempts', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    process.env.RENDER_JOB_MAX_ATTEMPTS = '1';
    process.env.RENDER_JOB_STALE_LOCK_MS = '1000';

    const { productionJob } = await createPackageReadyProductionJob('Health Ready Stale Exhaust Client');
    const job = await createQueuedRenderJob(productionJob.id as string);
    const claimed = await store.renderJobs.claimNext('stale-worker-2');
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.attemptCount).toBe(1); // == max_attempts (1) already

    await pool.query("UPDATE render_jobs SET started_at = NOW() - INTERVAL '5 seconds' WHERE id = $1", [job.id]);

    const { sweepStaleRenderLocks } = await import('../services/render-worker.js');
    const result = await sweepStaleRenderLocks();
    expect(result.failedCount).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [job.id]);
    const row = rows[0];
    expect(row.status).toBe('failed');
    expect(row.finished_at).toBeTruthy();
    expect(row.locked_by).toBeNull();
    expect(row.error_message).toContain('stale lock recovered');
  }, 30_000);

  it('leaves a fresh (recently locked, not stale) rendering job untouched', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    process.env.RENDER_JOB_STALE_LOCK_MS = '900000'; // 15 min — default, generous

    const { productionJob } = await createPackageReadyProductionJob('Health Ready Stale Fresh Client');
    const job = await createQueuedRenderJob(productionJob.id as string);
    await store.renderJobs.claimNext('fresh-worker');

    const { sweepStaleRenderLocks } = await import('../services/render-worker.js');
    await sweepStaleRenderLocks();

    const { rows } = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('rendering');
    expect(rows[0].locked_by).toBe('fresh-worker');
  }, 30_000);

  it('never touches rendered/cancelled jobs even with old started_at/locked_at timestamps', async () => {
    process.env.RENDER_JOB_STALE_LOCK_MS = '1000';

    // 'rendered' — the normal sync-mode path.
    const { productionJob: renderedPj } = await createPackageReadyProductionJob('Health Ready Stale Rendered Client');
    const owner = await loginAs(TEST_USERS.OWNER);
    const renderRes = await owner
      .post(`/api/production-jobs/${renderedPj.id}/render`)
      .send({ preset: 'instagram_post', exportFormat: 'png' });
    expect(renderRes.status).toBe(201);
    const renderedJobId = renderRes.body.data.id as string;
    await pool.query("UPDATE render_jobs SET started_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [renderedJobId]);

    // 'cancelled' — a queued job cancelled directly.
    process.env.RENDER_QUEUE_ENABLED = 'true';
    const { productionJob: cancelledPj } = await createPackageReadyProductionJob('Health Ready Stale Cancelled Client');
    const cancelledJob = await createQueuedRenderJob(cancelledPj.id as string);
    const cancelRes = await owner.post(`/api/render-jobs/${cancelledJob.id}/cancel`);
    expect(cancelRes.status).toBe(200);
    await pool.query("UPDATE render_jobs SET started_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [cancelledJob.id]);

    const { sweepStaleRenderLocks } = await import('../services/render-worker.js');
    await sweepStaleRenderLocks();

    const { rows } = await pool.query('SELECT id, status FROM render_jobs WHERE id IN ($1, $2)', [
      renderedJobId,
      cancelledJob.id,
    ]);
    const statuses = new Map(rows.map((r: Record<string, unknown>) => [r.id as string, r.status as string]));
    expect(statuses.get(renderedJobId)).toBe('rendered');
    expect(statuses.get(cancelledJob.id)).toBe('cancelled');
  }, 60_000);

  it('renderQueue check in /ready reports degraded when a stale-locked job currently exists', async () => {
    process.env.RENDER_QUEUE_ENABLED = 'true';
    process.env.RENDER_JOB_STALE_LOCK_MS = '1000';

    const { productionJob } = await createPackageReadyProductionJob('Health Ready Stale Ready Endpoint Client');
    const job = await createQueuedRenderJob(productionJob.id as string);
    await store.renderJobs.claimNext('still-stale-worker');
    await pool.query("UPDATE render_jobs SET started_at = NOW() - INTERVAL '5 seconds' WHERE id = $1", [job.id]);

    const res = await request(app).get('/api/health/ready');
    expect(res.body.checks.renderQueue.status).toBe('degraded');
    expect(res.body.checks.renderQueue.details.staleLockedCount).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
