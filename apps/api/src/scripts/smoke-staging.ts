/**
 * Grafista AI Studio — Staging Smoke Check (Production Step 2)
 *
 * HTTP-based smoke script for a RUNNING staging deployment (the
 * docker-compose.staging.yml stack, or any other staging host). Unlike
 * apps/api/src/scripts/smoke-real-providers.ts (which calls provider SDKs
 * directly in-process — no running server required), this script assumes
 * the app is ALREADY UP and reachable over HTTP at STAGING_BASE_URL. It
 * never logs secrets or full response bodies — only the already-safe,
 * presence/summary fields GET /api/health/ready itself returns (see
 * apps/api/src/routes/health.ts); this script never re-derives or prints
 * env values on its own.
 *
 * Usage:
 *   STAGING_BASE_URL=http://localhost:4000 pnpm run smoke:staging   # all sections
 *   pnpm run smoke:staging -- ready providers                       # a subset
 *
 * Sections: app, ready, providers, queue, demoFlow
 *
 * Outcomes: PASS / WARN / SKIP / FAIL. WARN exists specifically for
 * GET /api/health/ready's `degraded` status — per
 * docs/deployment-runbook.md §8, degraded is NOT automatically a blocker
 * (it can mean e.g. a stale-locked job the sweep will recover next tick, or
 * a missing AI key while intentionally running in fake-provider demo mode),
 * so this script never silently treats it as a hard FAIL, but also never
 * silently reports it as an unqualified PASS. Only a true `error` status
 * (or the HTTP request itself failing/timing out) is a FAIL. Exit code is
 * 0 unless at least one section reports FAIL (matching
 * smoke-real-providers.ts's convention — WARN/SKIP never affect exit code).
 */

type Outcome = 'PASS' | 'WARN' | 'SKIP' | 'FAIL';
const results: Array<{ section: string; outcome: Outcome; detail: string }> = [];

function record(section: string, outcome: Outcome, detail: string): void {
  results.push({ section, outcome, detail });
  console.log(`[smoke-staging] ${section.padEnd(10)} ${outcome.padEnd(5)} ${detail}`);
}

const BASE_URL = (process.env.STAGING_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Mirrors the real shape returned by GET /api/health/ready
// (apps/api/src/routes/health.ts) — kept local/minimal rather than importing
// the route module, since this script talks to a deployed process over HTTP
// and must not depend on in-process route internals.
interface CheckResult {
  status: 'ok' | 'degraded' | 'error';
  message: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

interface ReadyResponse {
  status: 'ok' | 'degraded' | 'error';
  checks: {
    database: CheckResult;
    storage: CheckResult;
    renderQueue: CheckResult;
    workerHeartbeat: CheckResult;
    providers: CheckResult;
    playwright: CheckResult;
  };
}

// Fetched once, shared by `ready` / `providers` / `queue` so a single smoke
// run hits GET /api/health/ready exactly ONE time, not three.
let cachedReady: { httpStatus: number; body: ReadyResponse } | undefined;

async function fetchReady(): Promise<{ httpStatus: number; body: ReadyResponse } | undefined> {
  if (cachedReady) return cachedReady;
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/health/ready`);
    const body = (await res.json()) as ReadyResponse;
    cachedReady = { httpStatus: res.status, body };
    return cachedReady;
  } catch {
    return undefined;
  }
}

async function smokeApp(): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/api/health`);
    if (!res.ok) {
      record('app', 'FAIL', `GET /api/health returned HTTP ${res.status}`);
      return;
    }
    const body = (await res.json()) as { status?: string };
    if (body.status !== 'ok') {
      record('app', 'FAIL', `GET /api/health responded but status was "${body.status}", expected "ok"`);
      return;
    }
    record('app', 'PASS', `${BASE_URL}/api/health responded 200 with status=ok`);
  } catch (err) {
    record('app', 'FAIL', `GET /api/health request failed: ${(err as Error).message} — is the app actually up at ${BASE_URL}?`);
  }
}

async function smokeReady(): Promise<void> {
  const ready = await fetchReady();
  if (!ready) {
    record('ready', 'FAIL', `GET /api/health/ready request failed or timed out against ${BASE_URL}`);
    return;
  }
  const { body } = ready;
  const summary = Object.entries(body.checks)
    .map(([name, check]) => `${name}=${check.status}(${check.message})`)
    .join('; ');
  if (body.status === 'ok') {
    record('ready', 'PASS', `overall status=ok — ${summary}`);
  } else if (body.status === 'degraded') {
    // Explicit WARN, not FAIL — see the file-level doc comment and
    // docs/deployment-runbook.md §8. A human should read the per-check
    // detail above and judge, not this script.
    record('ready', 'WARN', `overall status=degraded (not automatically a blocker — see individual checks) — ${summary}`);
  } else {
    record('ready', 'FAIL', `overall status=error — ${summary}`);
  }
}

async function smokeProviders(): Promise<void> {
  const ready = await fetchReady();
  if (!ready) {
    record('providers', 'FAIL', 'could not read GET /api/health/ready (see the "ready" section for the request failure)');
    return;
  }
  const providers = ready.body.checks.providers;
  // Relay the endpoint's own safe presence/absence summary — never
  // re-derive or print any env value from this script.
  const detail = `${providers.message} — presence: ${JSON.stringify(providers.details ?? {})}`;
  if (providers.status === 'error') {
    record('providers', 'FAIL', detail);
  } else if (providers.status === 'degraded') {
    record('providers', 'WARN', detail);
  } else {
    record('providers', 'PASS', detail);
  }
}

async function smokeQueue(): Promise<void> {
  const ready = await fetchReady();
  if (!ready) {
    record('queue', 'FAIL', 'could not read GET /api/health/ready (see the "ready" section for the request failure)');
    return;
  }
  const { renderQueue, workerHeartbeat } = ready.body.checks;

  // "queue disabled" / "not applicable" are the endpoint's OWN messages when
  // RENDER_QUEUE_ENABLED=false — relay that as SKIP rather than inventing a
  // queue-depth threshold of our own or treating "not applicable" as PASS.
  const queueDisabled = /queue disabled/i.test(renderQueue.message);
  const heartbeatNotApplicable = /not applicable/i.test(workerHeartbeat.message);
  if (queueDisabled && heartbeatNotApplicable) {
    record(
      'queue',
      'SKIP',
      `RENDER_QUEUE_ENABLED is off — renderQueue: "${renderQueue.message}"; workerHeartbeat: "${workerHeartbeat.message}"`
    );
    return;
  }

  const detail = `renderQueue=${renderQueue.status}(${renderQueue.message}); workerHeartbeat=${workerHeartbeat.status}(${workerHeartbeat.message})`;
  if (renderQueue.status === 'error' || workerHeartbeat.status === 'error') {
    record('queue', 'FAIL', detail);
  } else if (renderQueue.status === 'degraded' || workerHeartbeat.status === 'degraded') {
    record('queue', 'WARN', detail);
  } else {
    record('queue', 'PASS', detail);
  }
}

async function smokeDemoFlow(): Promise<void> {
  record(
    'demoFlow',
    'SKIP',
    'run `cd apps/api && npx vitest run src/__tests__/demo-flow.test.ts` separately against a test ' +
      'database before/alongside this smoke — this script validates a LIVE deployed app over HTTP, ' +
      'demo-flow.test.ts validates the full pipeline (client -> DesignDNA -> ... -> render/export -> ' +
      'download) against an ephemeral embedded-Postgres test DB; they are complementary, not the same ' +
      'check. Honest limitation: a full authenticated multi-step HTTP walkthrough (login -> client -> ' +
      'brief -> layout -> QA -> visual -> render -> download) is NOT implemented in this first version ' +
      'of the staging smoke script — that would require session/cookie handling and multi-step state ' +
      'well beyond this script\'s current scope (leaning on the existing vitest mechanism instead of ' +
      'building a new end-to-end HTTP test framework from scratch).'
  );
}

const SECTIONS: Record<string, () => Promise<void>> = {
  app: smokeApp,
  ready: smokeReady,
  providers: smokeProviders,
  queue: smokeQueue,
  demoFlow: smokeDemoFlow,
};

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const unknown = requested.filter((name) => !SECTIONS[name]);
  if (unknown.length > 0) {
    console.error(`[smoke-staging] unknown section(s): ${unknown.join(', ')} — valid: ${Object.keys(SECTIONS).join(', ')}`);
    process.exit(2);
  }
  const names = requested.length > 0 ? requested : Object.keys(SECTIONS);
  console.log(`[smoke-staging] target: ${BASE_URL}`);
  for (const name of names) {
    await SECTIONS[name]();
  }
  const failed = results.filter((r) => r.outcome === 'FAIL');
  const warned = results.filter((r) => r.outcome === 'WARN');
  console.log(
    `[smoke-staging] done — ${results.filter((r) => r.outcome === 'PASS').length} pass, ` +
      `${warned.length} warn, ${results.filter((r) => r.outcome === 'SKIP').length} skip, ${failed.length} fail`
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[smoke-staging] FATAL', (err as Error).message);
  process.exit(1);
});
