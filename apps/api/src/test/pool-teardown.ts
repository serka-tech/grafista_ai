/**
 * Grafista AI Studio — Vitest per-file pool teardown (Production Step 4)
 *
 * Registered via vitest.config.ts's `setupFiles`, so it runs once inside
 * EVERY test file (not once for the whole run, unlike globalSetup.ts).
 *
 * apps/api/src/db/pool.ts exports a module-level `pg.Pool` singleton that no
 * test file ever closed (`closePool()` was previously only called from the
 * one-off `db:migrate`/`db:seed*` CLI scripts). Under Vitest's default
 * `isolate: true`, each test file gets a fresh module registry, so each file
 * re-runs `db/pool.ts`'s top-level `new pg.Pool(...)` — but the worker
 * process handling that file is reused across multiple files over the run,
 * so the previous file's pool (and its open Postgres connections) was simply
 * abandoned rather than closed, accumulating connections against the single
 * shared embedded-Postgres instance for the rest of the run. Closing it here
 * guarantees each file's pool is torn down before the next file's fresh
 * import re-creates one.
 */
import { afterAll } from 'vitest';

afterAll(async () => {
  const { closePool } = await import('../db/pool.js');
  await closePool();
});
