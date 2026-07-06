/**
 * Grafista AI Studio — Render Queue/Worker Environment Flags (Phase 3 Step 5A)
 *
 * Small, dependency-free module shared by render-engine.ts (which decides
 * sync-vs-queue at job CREATE time) and render-worker.ts (which reads the
 * worker identity/backoff knobs at PROCESS time) — kept separate from both so
 * neither has to import the other (render-worker.ts imports
 * runRenderPipeline from render-engine.ts; render-engine.ts must not import
 * back from render-worker.ts).
 *
 * Every flag reads `process.env` directly on every call (no caching) — same
 * convention as storage/factory.ts's STORAGE_PROVIDER and
 * render/adapters/factory.ts's RENDERER_PROVIDER, which both do the same so
 * tests can flip an env var mid-suite and see it take effect immediately.
 *
 * Defaults are chosen so the render queue is OFF unless explicitly opted
 * into — every existing deployment/test keeps today's fully-synchronous
 * behavior with zero configuration changes (see docs/render-queue-worker-plan.md
 * §7's "Seçenek A" recommendation).
 */

/** RENDER_QUEUE_ENABLED — default 'false'. Master on/off switch for the whole feature. */
export function isRenderQueueEnabled(): boolean {
  return (process.env.RENDER_QUEUE_ENABLED ?? 'false').trim().toLowerCase() === 'true';
}

/** RENDER_WORKER_ID — identifies this process/instance in render_jobs.locked_by. */
export function getRenderWorkerId(): string {
  return (process.env.RENDER_WORKER_ID ?? '').trim() || `render-worker-${process.pid}`;
}

/** RENDER_JOB_MAX_ATTEMPTS — default 3 (first attempt + 2 retries). */
export function getRenderJobMaxAttempts(): number {
  const raw = Number(process.env.RENDER_JOB_MAX_ATTEMPTS ?? '3');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

/** RENDER_JOB_BASE_DELAY_MS — default 2000ms; doubles per attempt (exponential backoff). */
export function getRenderJobBaseDelayMs(): number {
  const raw = Number(process.env.RENDER_JOB_BASE_DELAY_MS ?? '2000');
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 2000;
}

/** RENDER_WORKER_POLL_INTERVAL_MS — default 3000ms; only used by the setInterval loop, never by tests. */
export function getRenderWorkerPollIntervalMs(): number {
  const raw = Number(process.env.RENDER_WORKER_POLL_INTERVAL_MS ?? '3000');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3000;
}

/**
 * RENDER_JOB_STALE_LOCK_MS — default 900000ms (15 min). A 'rendering' job
 * whose `started_at` is older than this AND still carries a `locked_by` is
 * considered stale (the worker that claimed it crashed or was killed without
 * ever reaching a terminal state) — see render-jobs.ts repo's
 * `resetStaleLocks()` and render-worker.ts's `sweepStaleRenderLocks()`.
 * Tests override this directly via env before calling the sweep, exactly
 * like every other knob in this module.
 */
export function getRenderJobStaleLockMs(): number {
  const raw = Number(process.env.RENDER_JOB_STALE_LOCK_MS ?? '900000');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 900000;
}
