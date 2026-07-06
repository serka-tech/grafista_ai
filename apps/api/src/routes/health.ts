/**
 * Grafista AI Studio — Health / Readiness Routes
 * (Production Readiness Step — Healthcheck + Worker Heartbeat/Stale Lock
 * Recovery, see docs/production-readiness-review.md §5/§6/§11/§12)
 *
 * GET /api/health         — UNCHANGED, byte-for-byte identical to the
 *                            previous inline route in app.ts: static
 *                            process-liveness only, no dependency checks.
 *                            Relocated here purely for file organization —
 *                            behavior is untouched.
 * GET /api/health/ready    — NEW. No auth (a deployment platform's health
 *                            probe typically cannot send auth headers) —
 *                            but NEVER returns secret/connection-string/API-
 *                            key values, only presence/absence and small
 *                            operational summaries. Checks database,
 *                            storage, render queue depth, worker heartbeat,
 *                            AI provider key presence, and a lightweight
 *                            Playwright/renderer signal; overall `status` is
 *                            the worst of all individual checks.
 *
 * Deliberately NOT implementing a separate /api/doctor endpoint — the task's
 * own guidance says to skip it unless trivially cheap, and /health + /ready
 * already cover the core requirement without ballooning scope.
 */

import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';
import { store } from '../data/store.js';
import { isRenderQueueEnabled, getRenderJobStaleLockMs, getRenderWorkerPollIntervalMs } from '../services/render-queue-env.js';

export const healthRouter: Router = Router();

type CheckStatus = 'ok' | 'degraded' | 'error';

interface CheckResult {
  status: CheckStatus;
  message: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

function worstOf(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('degraded')) return 'degraded';
  return 'ok';
}

// ─── GET /api/health — UNCHANGED (see app.ts's previous inline version) ────
healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'grafista-ai-studio-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

async function checkDatabase(): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', message: 'database reachable', checkedAt };
  } catch (err) {
    return {
      status: 'error',
      message: `database query failed: ${err instanceof Error ? err.constructor.name : 'unknown error'}`,
      checkedAt,
    };
  }
}

// LOCAL: a cheap fs.access on the upload directory — no test-file write (avoids
// unnecessary disk churn on a route that may be hit frequently by a probe).
// S3: a shallow config-presence check only — this deliberately does NOT make a
// real network call to the bucket on every /ready hit (expensive + risky for a
// frequently-polled health route); it only confirms the required S3 env vars
// are present, mirroring storage/factory.ts's own "missing env" validation
// without duplicating its full client construction.
async function checkStorage(): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  const provider = (process.env.STORAGE_PROVIDER ?? 'local').trim().toLowerCase();

  if (provider === 's3') {
    const required = ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      return {
        status: 'error',
        message: `storage provider "s3" missing required config: ${missing.join(', ')}`,
        checkedAt,
        details: { provider },
      };
    }
    return { status: 'ok', message: 'storage provider configured: s3 (config present, no live connectivity check)', checkedAt, details: { provider } };
  }

  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    await fs.access(uploadsDir);
    return { status: 'ok', message: 'storage provider configured: local (upload directory accessible)', checkedAt, details: { provider } };
  } catch {
    return {
      status: 'degraded',
      message: 'storage provider configured: local, but upload directory is not yet accessible (created on first upload)',
      checkedAt,
      details: { provider },
    };
  }
}

async function checkRenderQueue(): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  if (!isRenderQueueEnabled()) {
    return { status: 'ok', message: 'queue disabled (RENDER_QUEUE_ENABLED=false) — renders run synchronously', checkedAt };
  }

  try {
    const summary = await store.renderJobs.getQueueSummary(getRenderJobStaleLockMs());
    const status: CheckStatus = summary.staleLockedCount > 0 ? 'degraded' : 'ok';
    return {
      status,
      message:
        status === 'degraded'
          ? `${summary.staleLockedCount} stale-locked job(s) detected — the sweep will recover them on its next tick`
          : 'queue healthy',
      checkedAt,
      details: {
        byStatus: summary.byStatus,
        staleLockedCount: summary.staleLockedCount,
        oldestQueuedAgeMs: summary.oldestQueuedAgeMs,
        lastRenderedAt: summary.lastRenderedAt,
      },
    };
  } catch (err) {
    return {
      status: 'error',
      message: `render queue summary query failed: ${err instanceof Error ? err.constructor.name : 'unknown error'}`,
      checkedAt,
    };
  }
}

async function checkWorkerHeartbeat(): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  if (!isRenderQueueEnabled()) {
    return { status: 'ok', message: 'not applicable — RENDER_QUEUE_ENABLED=false', checkedAt };
  }

  try {
    const staleThresholdMs = Math.max(getRenderWorkerPollIntervalMs() * 3, 10_000);
    const recent = await store.renderWorkerHeartbeats.listRecentHeartbeats(staleThresholdMs);
    if (recent.length === 0) {
      return {
        status: 'degraded',
        message: `no worker heartbeat within the last ${staleThresholdMs}ms — the worker loop may not be running`,
        checkedAt,
      };
    }
    const anyDegraded = recent.some((h) => h.status === 'degraded');
    return {
      status: anyDegraded ? 'degraded' : 'ok',
      message: anyDegraded ? 'a recent heartbeat reported a degraded poll tick' : 'worker heartbeat recent and healthy',
      checkedAt,
      details: { workerCount: recent.length, mostRecent: recent[0].lastHeartbeatAt },
    };
  } catch (err) {
    return {
      status: 'error',
      message: `heartbeat query failed: ${err instanceof Error ? err.constructor.name : 'unknown error'}`,
      checkedAt,
    };
  }
}

// Presence/absence ONLY — never the actual value, not even a prefix/suffix.
function checkProviders(): CheckResult {
  const checkedAt = new Date().toISOString();
  const presence = {
    openai: process.env.OPENAI_API_KEY ? 'present' : 'missing',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'present' : 'missing',
    kie: process.env.KIE_AI_API_KEY ? 'present' : 'missing',
  };
  const anyMissing = Object.values(presence).some((v) => v === 'missing');
  return {
    status: anyMissing ? 'degraded' : 'ok',
    message: anyMissing ? 'one or more AI provider keys are not configured' : 'all AI provider keys configured',
    checkedAt,
    details: presence,
  };
}

// Lightweight/cached signal only — does NOT launch a real browser on every
// hit (that would be expensive and risky for a frequently-polled route).
// Reports the configured RENDERER_PROVIDER, and — the first time only —
// whether the `playwright` package resolves at all; the resolution result is
// cached for the life of the process since it cannot change at runtime.
let cachedPlaywrightResolvable: boolean | undefined;
async function checkPlaywright(): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  const rendererProvider = (process.env.RENDERER_PROVIDER ?? 'playwright').trim().toLowerCase();

  if (rendererProvider === 'fake') {
    return { status: 'ok', message: 'renderer provider "fake" — no Playwright/Chromium dependency in use', checkedAt, details: { rendererProvider } };
  }

  if (cachedPlaywrightResolvable === undefined) {
    try {
      await import('playwright');
      cachedPlaywrightResolvable = true;
    } catch {
      cachedPlaywrightResolvable = false;
    }
  }

  return {
    status: cachedPlaywrightResolvable ? 'ok' : 'error',
    message: cachedPlaywrightResolvable
      ? 'renderer provider "playwright" — package resolvable (no browser launched by this check)'
      : 'renderer provider "playwright" but the package failed to resolve',
    checkedAt,
    details: { rendererProvider },
  };
}

healthRouter.get('/health/ready', async (_req, res) => {
  const [database, storage, renderQueue, workerHeartbeat, playwright] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkRenderQueue(),
    checkWorkerHeartbeat(),
    checkPlaywright(),
  ]);
  const providers = checkProviders();

  const status = worstOf([database.status, storage.status, renderQueue.status, workerHeartbeat.status, providers.status, playwright.status]);

  res.status(status === 'error' ? 503 : 200).json({
    status,
    checks: { database, storage, renderQueue, workerHeartbeat, providers, playwright },
  });
});
