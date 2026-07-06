/**
 * Grafista AI Studio — Render Queue Polling Worker (Phase 3 Step 5A)
 *
 * Implements docs/render-queue-worker-plan.md §6/§10: an in-process,
 * Postgres-backed polling worker that claims 'pending'/'queued' render_jobs
 * rows (see db/repositories/render-jobs.ts's claimNext()) and drives them
 * through render-engine.ts's runRenderPipeline() — the EXACT SAME execution
 * logic the pre-Step-5A synchronous HTTP path used, just called from a
 * different place. This module owns ONLY the surrounding state-machine
 * transitions (success/retry/exhausted/cancel) and job-level retry
 * classification; it never re-implements or alters the render pipeline
 * itself.
 *
 * No new dependency: no Redis/BullMQ/Temporal/cron library — `setInterval` +
 * plain `pg` (already a dependency) is the entire "queue" implementation, in
 * line with docs/render-queue-worker-plan.md §3/§4's decision.
 *
 * ── Job-level retry vs provider-level retry (plan §10) ──
 * `packages/model-router/src/provider-errors.ts` classifies and retries AI
 * transport failures WITHIN a single ModelRouter.complete() call — that
 * layer is untouched here. This worker's retry only ever fires for a
 * render_jobs ATTEMPT that failed for a reason the AI-provider layer never
 * sees at all: a Playwright render exception or a storage `putObject` throw
 * (render-engine.ts's runRenderPipeline has no AI call in it whatsoever).
 * `classifyProviderError` is reused here purely as a shared, already-tested
 * error-message classifier (it recognizes network/timeout/rate-limit/5xx
 * patterns regardless of which subsystem raised them) — NOT because this
 * worker retries AI calls. Its `permanent`/`auth_error`/`provider_unavailable`
 * kinds mean "retrying can never help" in ANY context, so this worker also
 * treats them as immediately terminal (straight to 'failed', no job-level
 * retry attempted), exactly mirroring the provider layer's own policy.
 */

import { classifyProviderError } from '@grafista/model-router';
import type { RenderJob } from '@grafista/schemas';
import { store } from '../data/store.js';
import { runRenderPipeline } from './render-engine.js';
import { assertClientAccessible } from '../auth/client-access.js';
import {
  getRenderJobBaseDelayMs,
  getRenderJobMaxAttempts,
  getRenderJobStaleLockMs,
  getRenderWorkerId,
  getRenderWorkerPollIntervalMs,
  isRenderQueueEnabled,
} from './render-queue-env.js';

/** Error kinds for which retrying can never help — straight to 'failed', no job-level retry (plan §10). */
const NON_RETRYABLE_KINDS = new Set(['permanent', 'auth_error', 'provider_unavailable']);

/**
 * Enqueues an already-validated render request as a 'queued' render_jobs row.
 * Thin wrapper over the repo's queued-create path — kept here (rather than
 * inlined in render-engine.ts) so the queue-specific API surface lives in one
 * module, per docs/render-queue-worker-plan.md §13's implementation prompt.
 * render-engine.ts's renderProductionJob() calls this internally when
 * RENDER_QUEUE_ENABLED is on; every pre-creation guard (permission, gate,
 * client isolation, preset/format validation) has ALREADY run by the time
 * this is reached — this function does no additional validation of its own.
 */
export async function enqueueRenderJob(data: {
  id: string;
  clientId: string;
  productionJobId: string;
  requestedFormat: RenderJob['requestedFormat'];
  manifestSnapshot?: Record<string, unknown>;
  templateContractSnapshot?: Record<string, unknown>;
  requestedBy: string;
}): Promise<RenderJob> {
  const job = await store.renderJobs.create(data, { queued: true, maxAttempts: getRenderJobMaxAttempts() });

  // Phase 3 Step 6A — analytics event (best-effort, nice-to-have per the plan).
  await store.analyticsEvents.recordBestEffort({
    clientId: job.clientId,
    entityType: 'render_job',
    entityId: job.id,
    eventType: 'render_job_queued',
    actorUserId: data.requestedBy,
    status: job.status,
    metadata: {
      preset: job.requestedFormat.preset,
      format: job.requestedFormat.exportFormat,
    },
  });

  return job;
}

/**
 * Executes ONE already-claimed render job attempt to completion (success,
 * retry, exhausted-failure, or cancellation) and persists the resulting
 * transition. `renderJobId` must already be in 'rendering' with its lock
 * held by `workerId` (i.e. already returned by claimNext()) — this function
 * does not claim anything itself, see processNextRenderJob() for the
 * claim+process combination most callers want.
 *
 * Returns the job's final row after this attempt (which may still be
 * non-terminal — a retryable failure returns to 'queued', not 'failed').
 * Returns undefined if the job id no longer exists (defensive; should not
 * happen in practice since claimNext() just confirmed it does).
 */
export async function processRenderJob(renderJobId: string, workerId: string): Promise<RenderJob | undefined> {
  const job = await store.renderJobs.getById(renderJobId);
  if (!job) return undefined;

  try {
    const result = await runRenderPipeline(job);

    // Cancellation check (plan §6/§9): the worker has no in-flight abort
    // mechanism for the adapter/storage calls inside runRenderPipeline
    // (Playwright is already running by the time cancellationRequested could
    // be set) — this is the "next observation" the plan describes: right
    // after the attempt finishes, before the success is persisted, re-read
    // the row fresh (the HTTP cancel route may have flipped the flag any
    // time during the render) and finalize to 'cancelled' instead of
    // 'rendered' if so. KNOWN LIMITATION: the render/storage work itself
    // still ran to completion — it is not interrupted mid-flight.
    const fresh = await store.renderJobs.getById(renderJobId);
    if (fresh?.cancellationRequested) {
      const cancelled = await store.renderJobs.markCancelled(renderJobId);
      if (cancelled) {
        await store.analyticsEvents.recordBestEffort({
          clientId: cancelled.clientId,
          entityType: 'render_job',
          entityId: cancelled.id,
          eventType: 'render_job_cancelled',
          actorUserId: null,
          status: cancelled.status,
        });
      }
      return cancelled;
    }

    const rendered = await store.renderJobs.markRendered(renderJobId, result);
    if (rendered) {
      // Phase 3 Step 6A — analytics event (best-effort). Queue/worker path
      // (the sync path's own 'rendered' event is recorded in render-engine.ts).
      await store.analyticsEvents.recordBestEffort({
        clientId: rendered.clientId,
        entityType: 'render_job',
        entityId: rendered.id,
        eventType: 'render_job_rendered',
        actorUserId: null,
        status: rendered.status,
        metadata: {
          preset: rendered.requestedFormat.preset,
          format: rendered.requestedFormat.exportFormat,
          width: rendered.requestedFormat.width,
          height: rendered.requestedFormat.height,
          warningCount: result.renderWarnings.length,
        },
      });
    }
    return rendered;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[render-worker] attempt failed — jobId=${renderJobId} workerId=${workerId} error=${errorMessage}`);

    const fresh = await store.renderJobs.getById(renderJobId);
    if (fresh?.cancellationRequested) {
      const cancelled = await store.renderJobs.markCancelled(renderJobId);
      if (cancelled) {
        await store.analyticsEvents.recordBestEffort({
          clientId: cancelled.clientId,
          entityType: 'render_job',
          entityId: cancelled.id,
          eventType: 'render_job_cancelled',
          actorUserId: null,
          status: cancelled.status,
        });
      }
      return cancelled;
    }

    const classification = classifyProviderError({ error: errorMessage });
    const attemptCount = job.attemptCount ?? 1;
    const maxAttempts = job.maxAttempts ?? getRenderJobMaxAttempts();
    const retryable = !NON_RETRYABLE_KINDS.has(classification.kind) && attemptCount < maxAttempts;

    if (retryable) {
      // Exponential-ish backoff: baseDelay * 2^(attemptCount - 1) — mirrors
      // the shape of provider-errors.ts's own DEFAULT_RETRY_POLICIES doubling,
      // without sharing its (much shorter, transport-scoped) delays.
      const delayMs = getRenderJobBaseDelayMs() * Math.pow(2, Math.max(0, attemptCount - 1));
      const nextRunAt = new Date(Date.now() + delayMs);
      return await store.renderJobs.markRetry(renderJobId, { errorMessage, nextRunAt });
    }

    const failed = await store.renderJobs.markFailed(renderJobId, { errorMessage });
    if (failed) {
      // Phase 3 Step 6A — analytics event (best-effort). Queue/worker path
      // (the sync path's own 'failed' event is recorded in render-engine.ts).
      await store.analyticsEvents.recordBestEffort({
        clientId: failed.clientId,
        entityType: 'render_job',
        entityId: failed.id,
        eventType: 'render_job_failed',
        actorUserId: null,
        status: failed.status,
        metadata: {
          preset: failed.requestedFormat.preset,
          format: failed.requestedFormat.exportFormat,
        },
      });
    }
    return failed;
  }
}

/**
 * Best-effort heartbeat write — NEVER allowed to throw past this call, and
 * never allowed to block/break the actual render poll tick (Production
 * Readiness Step — Worker Heartbeat). Callers still await it (so the write
 * is ordered relative to the rest of the tick for tests), but a failure here
 * only logs, it never propagates.
 */
async function writeHeartbeat(workerId: string, opts?: { status?: 'ok' | 'degraded'; metadata?: Record<string, unknown> }): Promise<void> {
  try {
    await store.renderWorkerHeartbeats.upsertHeartbeat(workerId, opts);
  } catch (err) {
    console.error('[render-worker] heartbeat write failed (non-fatal)', err instanceof Error ? err.message : err);
  }
}

/**
 * Stale-lock sweep, exposed as a standalone deterministic function (matching
 * the `runOnePollCycle` convention) so both the setInterval loop AND a test
 * can call it directly with no timer dependency. Safe to call even when
 * RENDER_QUEUE_ENABLED is false / no worker loop is running — it is a plain
 * SQL sweep over render_jobs, independent of the loop's on/off state.
 */
export async function sweepStaleRenderLocks(): Promise<{ recoveredCount: number; failedCount: number }> {
  return store.renderJobs.resetStaleLocks(getRenderJobStaleLockMs());
}

/**
 * One full poll tick: claim the single oldest claimable job (if any) and run
 * it to completion. Returns the processed job, or null if nothing was
 * claimable right now. This is the function both the `setInterval` loop
 * below AND tests call directly (tests call it as a deterministic
 * "runOnePollCycle" — see the alias export at the bottom — with no real
 * timers involved).
 *
 * A heartbeat is written and the stale-lock sweep runs on EVERY tick,
 * regardless of whether a job was actually claimed — so "worker is alive"
 * and "stale locks get recovered" both hold even when the queue is empty.
 * Both are cheap enough that a separate interval/cadence is unnecessary for
 * MVP (Production Readiness Step — Worker Heartbeat + Stale Lock Recovery).
 */
export async function processNextRenderJob(workerId: string = getRenderWorkerId()): Promise<RenderJob | null> {
  try {
    const claimed = await store.renderJobs.claimNext(workerId);
    await sweepStaleRenderLocks();
    await writeHeartbeat(workerId, { status: 'ok' });
    if (!claimed) return null;
    const result = await processRenderJob(claimed.id, workerId);
    return result ?? null;
  } catch (err) {
    // The tick itself threw before completing (e.g. the claim query or the
    // sweep failed) — never crash the interval; report a degraded heartbeat
    // (safe, fixed-shape metadata only, no raw stack traces) and rethrow so
    // the setInterval loop's own catch still logs it as it always has.
    await writeHeartbeat(workerId, { status: 'degraded', metadata: { note: 'poll tick failed before completion' } });
    throw err;
  }
}

/**
 * Deterministic single-tick alias for tests (plan §11: "await
 * runOnePollCycle()" — no real setInterval/timers, callable directly).
 * Identical to processNextRenderJob, just named per the test plan's own
 * vocabulary.
 */
export const runOnePollCycle = processNextRenderJob;

/**
 * POST /render-jobs/:id/cancel service function (plan §7/§9). Re-checks
 * client isolation independently of the route (defense in depth, same
 * "domain guard + route guard" double-check idiom render-engine.ts's
 * assertRequesterMayCreateRenderJobs/assertClientAccessible pairing already
 * uses) — the route ALSO performs this check after its own 404 lookup, so
 * this is intentionally redundant for callers that go through the route,
 * and load-bearing for any direct/non-HTTP caller.
 *
 *   - pending/queued  -> cancelled immediately (nothing was ever claimed).
 *   - rendering       -> cancellationRequested=true; status stays
 *                        'rendering' until the worker's next observation
 *                        (see processRenderJob above) finalizes it to
 *                        'cancelled'. Real in-flight interruption of the
 *                        renderer/storage call is NOT performed — documented
 *                        limitation (plan §12).
 *   - rendered/failed/cancelled -> throws a 409 (explicit conflict, never a
 *                        silent no-op).
 */
export async function cancelRenderJob(renderJobId: string, requestedBy: string): Promise<RenderJob> {
  const existing = await store.renderJobs.getById(renderJobId);
  if (!existing) {
    throw Object.assign(new Error('Render job not found'), { status: 404 });
  }
  await assertClientAccessible(requestedBy, existing.clientId);

  const result = await store.renderJobs.requestCancellation(renderJobId);
  if (!result) {
    throw Object.assign(new Error('Render job not found'), { status: 404 });
  }
  if (result.oldStatus === 'rendered' || result.oldStatus === 'failed' || result.oldStatus === 'cancelled') {
    throw Object.assign(new Error(`Render job is already '${result.oldStatus}' — cannot cancel`), { status: 409 });
  }

  // Phase 3 Step 6A — analytics event (best-effort, nice-to-have per the
  // plan). Only fires when this call actually transitioned the row straight
  // to 'cancelled' (old status pending/queued) — the 'rendering' branch sets
  // cancellationRequested only, and its own 'render_job_cancelled' event is
  // recorded later by processRenderJob's observation, not here (no double-fire).
  if (result.job.status === 'cancelled') {
    await store.analyticsEvents.recordBestEffort({
      clientId: result.job.clientId,
      entityType: 'render_job',
      entityId: result.job.id,
      eventType: 'render_job_cancelled',
      actorUserId: requestedBy,
      status: result.job.status,
    });
  }

  return result.job;
}

// ─── setInterval loop (production entry point only — see index.ts) ────────
// Deliberately NOT started from app.ts (which tests import) — only index.ts
// (the real server bootstrap) calls startRenderWorkerLoop(), and only when
// RENDER_QUEUE_ENABLED is on, so the Vitest suite (which never sets that
// flag) never has a background timer touching the test database.
let intervalHandle: NodeJS.Timeout | null = null;

export function startRenderWorkerLoop(): void {
  if (!isRenderQueueEnabled()) return;
  if (intervalHandle) return; // already running
  const intervalMs = getRenderWorkerPollIntervalMs();
  const workerId = getRenderWorkerId();
  console.log(`[render-worker] starting poll loop — workerId=${workerId} intervalMs=${intervalMs}`);
  intervalHandle = setInterval(() => {
    processNextRenderJob(workerId).catch((err) => {
      console.error('[render-worker] poll tick failed', err instanceof Error ? err.message : err);
    });
  }, intervalMs);
  // Never let the poll loop keep the process alive on its own (e.g. during
  // graceful shutdown / tests that happen to import this module).
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
}

export function stopRenderWorkerLoop(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
