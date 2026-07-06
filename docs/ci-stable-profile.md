# Grafista AI Studio — CI Stable Test Profile (Production Step 3, hardened in Step 4)

> **Status: scripts + docs, plus two real source fixes from Production Step
> 4** (see "Production Step 4" section below for the full, honest account —
> a genuine root cause was found and fixed, but it did NOT eliminate
> `ci:stable`'s test-step flakiness; a second, distinct, unexplained failure
> mode remains). No `.github/workflows/` file was added — see "Why no GitHub
> Actions file yet" below. Continues [`docs/staging-compose.md`](./staging-compose.md)
> (Production Step 2/2B/2C) and [`docs/deployment-runbook.md`](./deployment-runbook.md)
> — neither is re-derived here.

## Production Step 4 — test isolation hardening (partial fix, honestly reported)

**Investigation method:** four parallel, independent, read-only investigation
agents each chased a distinct hypothesis for why `ci:stable`'s test step
(`test:ci`, `--maxWorkers=1`) intermittently fails a DIFFERENT random test
each run, always passing standalone (the Step 3 finding — 1 clean run out of
5 full-suite attempts):

| Hypothesis | Verdict |
|---|---|
| Leaked `setInterval` from the render-queue worker firing across test files | **REFUTED**, high confidence — the interval is never even started during any Vitest run (only `index.ts` calls `startRenderWorkerLoop()`; no test file imports `index.ts`, only `app.ts`, which has zero references to `render-worker.js`). |
| `db/pool.ts`'s module-level `pg.Pool` singleton never closed, leaking connections across test files sharing a Vitest worker process | **CONFIRMED**, high confidence. |
| Test fixtures using colliding non-unique identifiers (timestamp/slug collisions) | **REFUTED** for the current codebase — every hardcoded test client name across all 26 files (170+ call sites audited) is globally unique; the one observed "duplicate slug" Postgres log line is the EXPECTED output of a test that deliberately POSTs the same name twice to assert a 409, not a bug. |
| Vitest's `--maxWorkers`/`isolate` config not actually providing real isolation | **REFUTED** — `--maxWorkers` is a real, correctly-wired flag; `isolate: true` does give each file a fresh JS module registry. (This agent instead found a second, complementary explanation: a never-reset shared database growing across the whole run, an unbounded/N+1-shaped `GET /api/clients` endpoint that gets slower as that shared DB grows, and Vitest's default file-reordering-by-previous-run-duration sequencer cache — meaning WHICH test hits the "worst" point of DB accumulation shifts unpredictably run to run.) |

**Confirmed root cause:** `apps/api/src/db/pool.ts` exports a module-level
`pg.Pool` singleton. No test file — and no teardown hook anywhere — ever
called its own exported `closePool()`. Vitest's `isolate: true` default gives
every one of the 26 test files a fresh module registry, so each file's
`app.js` import graph re-executes `db/pool.ts`'s top-level `new pg.Pool(...)`
— but the underlying Vitest worker PROCESS is reused across many files over
the run (confirmed directly: `ps aux` during a `--maxWorkers=1` run showed
exactly one long-lived `vitest/dist/workers/forks.js` process handling all
26 files sequentially, not one process per file). Each file's pool — and its
already-open Postgres connections — was simply abandoned in that same
process when the file finished, accumulating connections against the single
shared embedded-Postgres instance (`global-setup.ts`, one instance for the
*entire* run) for as long as `pg-pool`'s connections stayed alive.

**Fixes applied:**
1. `apps/api/src/db/pool.ts` — added `connectionTimeoutMillis: 10_000` to the
   `pg.Pool` constructor, so a connection that can't be served fails with a
   clear, fast error instead of hanging indefinitely (pure diagnosability
   improvement, safe in production too — `max`/`idleTimeoutMillis` left at
   `pg`'s defaults, not touched).
2. New `apps/api/src/test/pool-teardown.ts`, registered via
   `vitest.config.ts`'s new `setupFiles` option — runs `afterAll(() =>
   closePool())` **inside every test file** (unlike `globalSetup`, which
   runs once for the whole run), so each file's pool is closed before the
   next file's fresh import re-creates one in the same worker process.
3. `apps/api/src/routes/clients.ts` + `apps/api/src/db/repositories/design-dna.ts`
   — `GET /api/clients` previously ran ONE extra `hasForClient(id)` DB round
   trip PER client row via `Promise.all(...)` (a genuine N+1 pattern whose
   cost — and DB pool connection pressure — scales directly with the total
   number of clients ever created in the run, since the shared test DB is
   never reset between files). Replaced with one new batched
   `hasForClientIds(ids)` query (`WHERE client_id = ANY($1)`). Same response
   shape, same data, purely a performance/connection-pressure fix — not a
   behavior or feature change.

**Verified, not just asserted:** ran the full suite once while polling
`pg_stat_activity`'s connection count every 15s via a direct `pg` query
against the live embedded Postgres instance. Connection count stayed
**flat at 11** for the entire monitored window — it did not grow over time
the way an accumulating leak would. This directly confirms the leak
mechanism above is fixed.

**Honest result — the fix did NOT eliminate `ci:stable`'s flakiness:**
Across 6 full-suite `test:ci` runs after applying the fix: 1 clean
(433/433), 5 with 1–4 failures each — a DIFFERENT random test every time
(`production-jobs`, `analytics-events`, `visual-generation`,
`render-queue-worker`, `creative-qa`, `layout-plans`, `workflows`,
`client-isolation`, `render-jobs`, `design-dna` were each hit at least once
across Step 3's + Step 4's combined ~11 runs), every one passing standalone
— essentially the same ~1-in-5-to-6 clean rate as Step 3's baseline. The
specific connection-leak mechanism is fixed and verified, but it was
evidently not the ONLY contributing cause.

**New, distinct, NOT-yet-root-caused finding from this step's runs:** at
least twice, a legitimate POST endpoint (`design-dna/approve` in one run,
the file-upload `uploadReference` helper in another) returned a bare
**405 Method Not Allowed** instead of its real status. This is not explained
by the connection-pool mechanism above — one of these 405s was observed
during the SAME monitored run where `pg_stat_activity` confirmed connections
stayed bounded, ruling out pool exhaustion as its cause. `grep`ing the
entire `apps/api/src` tree (app code, `error-handler.ts`, and the installed
`express`/`multer`/`pg` packages under `node_modules`) for any explicit `405`
found **nothing** — no code anywhere in this stack sets that status
intentionally, so its origin is still unexplained. Time-boxed within this
step's scope; not chased further. See "Remaining risks" below.

## Production Step 5 — the 405 flake, root-caused (external port collision, not an app bug)

**Root cause found — with direct, reproduced evidence — and it is not a bug
in this repository's application code, test code, or even really in
`supertest`.** It is a collision between two independent processes on the
same developer machine, both drawing from the OS's ephemeral TCP port range.

**Instrumentation added first:** `apps/api/src/middleware/debug-routes.ts`,
mounted as the very first middleware in `apps/api/src/app.ts` (before
`cors`/`cookie-parser`/`json`), gated behind `CI_DEBUG_ROUTES=1` (no-op
otherwise). When enabled it logs, per request: method/url on arrival, and on
`res.on('finish')` the final status, matched route, and content-type; it also
monkey-patches `res.status`/`sendStatus`/`writeHead` to capture a stack trace
if anything ever sets 405 from app code, and logs `res.on('close')` without a
prior `finish` (silent connection drop) and raw socket errors. Output goes to
`console.error` and, if `CI_DEBUG_ROUTES_LOG_FILE` is set, is also appended
synchronously to that file — the file sink was necessary because Vitest's
reporter buffers/reorders console output per-test and does not print it at
all for files with no failing test, which made the first instrumented run
look far sparser than reality.

**How the case broke open:** running `pnpm run test:ci` with
`CI_DEBUG_ROUTES=1` and the file sink enabled reproduced two different bad
statuses across two runs — a `405` on a `POST /api/auth/login` call inside
`render-jobs.test.ts`'s `loginAs()` helper, and (a different run) a `403` on
a `POST /api/auth/login` call inside `auth.test.ts`'s logout test. In both
cases, the debug log — which logs literally every request that reaches
Express, because it is the first middleware in the chain — had **zero
matching entry** for that specific call, while every *other* login call in
the same run (1039 of them in one run, all accounted for as matched
`-->`/`<--` pairs, statuses only ever 200 or 401) was correctly logged. This
is direct proof the bad response never touched this app's Express pipeline
at all — something else answered the client's HTTP request.

**Isolated, faster reproduction:** a temporary stress script (not committed
— written, run, and deleted within this step) repeated the exact
`request.agent(app)` login → `/auth/me` → logout → `/auth/me` sequence used
by `auth.test.ts` 800 times in a tight loop, outside the full 26-file suite.
It reproduced the anomaly in ~800 iterations (~170s): a `GET /api/auth/me`
call got back a **404** whose response was captured in full —
`Content-Type: text/plain; charset=utf-8`, body `404 page not found`,
headers including `X-Content-Type-Options: nosniff` but notably **no**
`Content-Security-Policy` header. That exact combination — plain-text body,
that literal message, that header set, no CSP header — is the byte-for-byte
signature of **Go's standard-library `net/http.Error()`/default 404
handler**, not anything Express (or this app) can produce: Express's own
404 fallback (`finalhandler`) always sends HTML with a
`Content-Security-Policy: default-src 'none'` header, and the literal string
`"404 page not found"` does not exist anywhere in this repo or any of its
installed `node_modules` (grepped and confirmed absent).

**The actual mechanism:** every `supertest` call in this test suite —
`request(app)` and `request.agent(app)` alike — wraps the shared Express
`app` in a **brand-new** `http.createServer(app)` and calls `.listen(0)`
(OS-assigned ephemeral port) for essentially every single HTTP call, closing
that server again once the response is received (`node_modules/.pnpm/.../supertest/lib/test.js`'s
`Test.prototype.end()`/`serverAddress()`). Across one `test:ci` run (433
tests, single worker, ~230s) this churns through roughly two thousand
bind/close cycles, all drawing ephemeral ports from the same OS-wide pool
(confirmed on this machine: `sysctl net.inet.ip.portrange.first/last` →
`49152`–`65535`). `lsof -iTCP -sTCP:LISTEN` while idle showed two
**`language_server_macos_arm`** processes — the Antigravity IDE's own
background language-server/extension-host binary, confirmed via `ps` (PIDs
896 and 2478 in one snapshot) — already listening on ports `49157`, `49158`,
`49178`, `49188`, `49558`: squarely inside that same ephemeral range, and
demonstrably Go-based given the 404 response's exact signature. On rare
occasions, the OS hands Node's `.listen(0)` (or the IDE's own internal
rebind cycle grabs) a port number that collides closely enough in time with
this other process's own bind/rebind churn that a `supertest` client
request ends up answered by the IDE's process instead of by the freshly
bound Express test server — producing whatever that other listener happens
to do with an unrecognized path (a plain 404 in the reproduced case; almost
certainly the source of the previously-seen 405s and "socket hang up"
errors too, depending on which internal state that other listener was in at
the moment of collision). This is corroborated by every one of these
bad-status failures being on a **different endpoint each time**
(`design-dna/approve`, `uploadReference`, `auth/login` twice, `content-ideas`
during this step's own validation runs) with no shared application code path
— fully consistent with a transport-layer coincidence, not an app-level bug.

**Why this is not fixed outright in this step:** the exposure is
proportional to how many ephemeral bind/close cycles the suite performs —
currently ~2000 per run, one per `supertest` call, because every one of the
~26 test files calls `request(app)`/`request.agent(app)` directly rather
than sharing one already-listening server for the file (or the run). The
complete, durable fix is to bind `app` to a real (single, already-listening)
`http.Server` once — per file via `beforeAll`/`afterAll`, or once for the
whole run — and pass that listening server into `supertest` instead of the
bare `app` function; `supertest`'s own `serverAddress()` skips its internal
`.listen(0)` entirely whenever `app.address()` is already non-null, so this
would cut the ~2000 ephemeral binds down to ~26 (or 1), shrinking the
collision window by roughly two to three orders of magnitude. That change
touches the request-construction call sites in essentially every one of the
26 test files, however (`request(app)` → `request(sharedServer)` at every
call site) — a mechanical but wide-blast-radius change across the whole test
suite, which this step's explicit scope boundaries rule out ("no large
refactor of test isolation architecture"). It is recorded here as the
concrete, actionable next step for a dedicated follow-up, not attempted now.

**What this step did instead, in scope:**
1. Confirmed (via the debug instrumentation) that no `res.status`/
   `sendStatus`/`writeHead(405, ...)` call ever fires from this app's own
   code — the earlier grep-based finding, now independently reconfirmed via
   live instrumentation rather than static analysis alone.
2. Confirmed the "no test binds a real listener" assumption from Step 4 —
   `grep -rn '\.listen(' apps/api/src/__tests__ apps/api/src/services`
   returns nothing; only `apps/api/src/index.ts` calls `.listen()`, and no
   test file imports it.
3. Left the `CI_DEBUG_ROUTES` instrumentation in place, permanently, as an
   opt-in diagnostic tool (see `apps/api/src/middleware/debug-routes.ts`'s
   doc comment for full usage) — it is what made this root cause provable
   rather than merely suspected, and it costs nothing when unset (the
   default).
4. Did **not** attempt the wide test-file refactor described above, per this
   step's scope boundary.
5. Side investigation (quick, not time-boxed as the main effort): searched
   this repo's installed `express`/`multer`/`busboy`/`supertest`/`superagent`
   packages for the literal strings `405`/`"Method Not Allowed"` — found in
   neither; this line of inquiry (a Node v24 + Express 4.x compatibility
   issue) became moot once the actual external-process mechanism above was
   found and confirmed with concrete evidence, so it was not pursued further
   with a general web search.

**Net effect on flake rate:** unchanged by this step — the instrumentation
is diagnostic only, not a fix, and the actual fix is explicitly out of
scope. `pnpm run test:ci` runs during this step's own validation reproduced
the same ~1-in-3-to-6 pattern seen in Steps 3–4 (one clean 433/433 run, and
separately one run with a 405+socket-hang-up pair, one run with a
403+socket-hang-up pair, one run with a 404+socket-hang-up pair — all four
distinct symptoms of the exact same root cause identified above, occurring
on four different, unrelated endpoints). **`ci:stable` should still not be
treated as a fully deterministic merge gate** until the follow-up described
above (share one listening server per test file/run) is implemented; in the
meantime, `CI_DEBUG_ROUTES=1 CI_DEBUG_ROUTES_LOG_FILE=<path>` lets anyone
who hits a spurious status on a merge run confirm in under a minute whether
it is this same external-process collision (look for a missing `-->`/`<--`
pair for the failing call in the log) rather than a real regression.

## Why no GitHub Actions file yet

`git remote -v` returns nothing — this repo has never been pushed anywhere,
there is no GitHub remote configured. A `.github/workflows/ci.yml` would sit
completely inert (no GitHub Actions runner would ever see it). Adding one now
would be premature scaffolding for infrastructure that doesn't exist yet, so
this step ships the **scripts** and this **doc** instead — the "Ready-to-add
GitHub Actions workflow" section below is the exact file to drop in
(`.github/workflows/ci.yml`) the day this repo gets a GitHub remote; nothing
else would need to change.

## Two profiles, two different guarantees

### `pnpm run ci:stable`

```
pnpm run typecheck && pnpm run lint && pnpm run build && pnpm run test:ci
```

(Assumes `pnpm install --frozen-lockfile` already ran — that's a separate,
separately-cacheable CI step, matching the existing `check:release`
script's convention; it is not embedded inside `ci:stable` itself.)

**Why `test:ci` (a NEW script, `--maxWorkers=1`) instead of the existing
`test:stable` (`--maxWorkers=2`) — and an honest account of what Step 3's
validation found at the time, not a rosier summary** (Production Step 4,
above, found and fixed one real root cause since this was written — a
never-closed DB pool — but did NOT eliminate the flakiness described below;
read the Step 4 section above first for the current, fuller picture):

`pnpm run test:stable` (`--maxWorkers=2`) was run twice during this step's
validation. Both runs produced DIFFERENT random failures (2 failures one
run, 4 different failures the next — across `analytics-events.test.ts`/
`render-queue-worker.test.ts`/`visual-generation.test.ts`), while every
individual failing test passed cleanly in isolation every time. A fully
serial run (`--maxWorkers=1`) was tried next on the theory that removing
concurrency would remove the contention: the FIRST such run passed 433/433
clean. But three more full-suite runs at `--maxWorkers=1` later in the same
session — two via the full `ci:stable` chain, one standalone — each
produced 2 MORE random failures, again always different tests
(`creative-qa.test.ts`, `production-jobs.test.ts`, `layout-plans.test.ts`,
`analytics-events.test.ts`, `workflows.test.ts` were each hit at least once
across all these runs), and every one of those, too, passed cleanly re-run
in isolation. `vitest --retry=2` was also tried on a `--maxWorkers=1` run —
it did NOT reliably fix it either (one test failed all 3 attempts in that
run, then passed standalone immediately after).

**Conclusion, stated plainly: on this specific development machine, in this
session, the full 433-test suite was NOT reliably green regardless of
worker count or retry — 1 clean run out of 5 full-suite attempts today.**
This is consistent with previously-documented "test suite yük hassasiyeti"
(load sensitivity — 26 files share one embedded Postgres instance; a
different, effectively random test fails under sufficient ambient machine
load each time, always passing standalone) — it is NOT a code regression
(no source or test file was touched in this step), and it is NOT something
this step attempts to fix (that would mean re-architecting test isolation —
e.g. a separate embedded-Postgres instance per file, or connection-pool
tuning — a substantial, separate engineering effort, out of scope for
"build a CI profile out of existing commands"). `test:ci` (`--maxWorkers=1`)
is still the right CI choice among the three available options — it removes
the WORST, concurrency-driven failure mode `--maxWorkers=2` clearly has —
but it is not a proof of zero flakiness, and this doc will not claim
otherwise. **This machine was very likely under heavier-than-normal
concurrent load during this validation session** (this is a plausible,
reasonable explanation — not a certainty); a dedicated CI runner with no
competing processes may well be more consistent than what was observed here
today. That must be confirmed on an actual CI runner before `ci:stable`'s
test step is trusted as fully green-by-default — see "Remaining risks"
below. `test:stable` itself is left completely UNCHANGED (still used by the
pre-existing `check:release` script, still `--maxWorkers=2`) — `test:ci` is
a new, CI-specific, more conservative script, not a rewrite of an existing
one.

**What this guarantees when it passes:**
- Every workspace package (`packages/schemas`, `packages/model-router`,
  `packages/prompt-engine`, `apps/api`, `apps/dashboard`) typechecks, lints,
  and builds cleanly — these three checks (`typecheck`/`lint`/`build`) WERE
  100% consistent across every run today, no flakiness observed in any of
  them.
- Zero Docker dependency. Zero real secrets. Zero network calls — the test
  suite's `vitest.config.ts` hardcodes fake AI provider keys
  (`sk-test-fake-key-for-smoke-tests`) and `RENDERER_PROVIDER=fake`; it never
  launches a real Chromium or calls a real AI provider.
- Runs against an ephemeral **embedded** Postgres instance
  (`apps/api/src/test/global-setup.ts`), started and torn down per test run
  — not a shared/persistent database.
- **Does NOT guarantee** the test step itself is green on the first try
  every time — see the honest account above. A failed `ci:stable` run
  should be re-run once before assuming a real regression, and the specific
  failing test(s) should be checked in isolation (`vitest run -t "<test
  name>"`) — if they pass standalone, it's this known load-sensitivity, not
  a bug.

**What this does NOT guarantee:**
- That the Docker image actually builds or that the staging stack actually
  comes up — that's `ci:staging`'s job, entirely separate.
- Anything about real AI providers (OpenAI/KIE) actually being reachable
  with real credentials — see `smoke:providers` below, deliberately excluded
  from both CI profiles.
- Multi-worker/horizontal-scale coordination — untested in any profile (see
  `docs/render-queue-worker-plan.md` §7, unchanged by this step).

### `pnpm run ci:staging` (→ `scripts/ci-staging.sh`)

```
pnpm run build                          # HOST-side — see "Step 2C nuance" below
pnpm run staging:up                     # docker compose build + up -d
<poll docker inspect health until both services are "healthy", 60s budget>
docker compose ... exec -T api pnpm --filter @grafista/api run db:migrate
pnpm --filter @grafista/api run smoke:staging
```

...with `pnpm run staging:down` registered via a `trap ... EXIT` in
`scripts/ci-staging.sh`, so it runs **whether the steps above succeed or
fail** — a CI runner (or a human running this locally) never leaks a running
container/volume from a failed attempt. This is the direct, scriptable
answer to the "staging:down must run even on failure" requirement.
**Verified, not just asserted:** a throwaway copy of this script with a
forced failure injected right after `staging:up` was run twice — both times
the `cleanup` trap fired, logged "tearing down staging stack (runs on
success AND failure)", and `docker compose ps` showed zero containers left
running afterward.

**Step 2C nuance, restated so it isn't lost:** the `pnpm run build` line
above is not optional decoration — Production Step 2C found that on a bare
fresh checkout, running `docker compose build` directly (without a prior
host-side `pnpm run build`) is **not reliably reproducible**, because
`packages/schemas`, `packages/model-router` and `packages/prompt-engine`
need their `dist/` already host-built before the Docker build's `COPY`
step (see [`docs/staging-compose.md`](./staging-compose.md)'s "Production
Step 2B"/"Production Step 2C" sections for the full root-cause writeup —
not repeated here). `scripts/ci-staging.sh` always runs the host build
first specifically because of this.

**What this guarantees:**
- The Docker image for `apps/api` actually builds from the current source
  tree (given the host-build-first step above) and the Compose stack
  (`postgres` + `api`) actually starts and reaches `healthy`.
- Migrations apply cleanly against a genuinely fresh Postgres volume (this
  matters — a CI runner always starts from a fresh volume, unlike a
  developer's laptop where the same volume can persist across many
  `staging:down`/`staging:up` cycles).
- `GET /api/health` responds `200 {"status":"ok"}`.
- `GET /api/health/ready` is read and reported — `degraded` is treated as a
  non-blocking WARN (per `smoke-staging.ts`'s own design, see
  `docs/deployment-runbook.md` §8), never silently upgraded to a false
  "everything is ok". As of the last real run (Production Step 2C), the
  ONLY degraded check was `providers` (`kie` key intentionally absent —
  `.env.staging.example` ships in safe fake-provider demo mode); a
  genuinely broken dependency (`database`/`renderQueue`/`workerHeartbeat`
  reporting `error`) would still make the smoke script's `ready` section
  FAIL and fail the CI job.
- The `smoke:staging` script itself passes with 0 FAIL sections (as of the
  last real run: 2 PASS, 2 WARN, 1 SKIP, 0 FAIL).

**What this does NOT guarantee — do not oversell these:**
- The `demoFlow` section of `smoke:staging` is **always SKIP** — it is not
  implemented as a live authenticated HTTP walkthrough (login → client →
  brief → layout → QA → visual → render → download) in this script; it
  only points at `apps/api/src/__tests__/demo-flow.test.ts` (which DOES run
  for real, but as part of `ci:stable`'s test suite, against an ephemeral
  DB — a different, complementary check, not the same thing). A SKIP here
  is expected and is **not** a stable-CI success signal for that flow —
  it means "not covered by this script," full stop.
- No real production deployment. No real production config. This is a
  disposable local/CI staging stack (`RENDERER_PROVIDER=fake`,
  `AI_DEFAULT_PROVIDER=fake`, `STORAGE_PROVIDER=local`, ephemeral Docker
  volume) — see `docs/staging-compose.md`'s existing "Known gaps" list,
  unchanged by this step.
- Multi-worker/horizontal-scale render-queue coordination — still
  completely untested (`docs/render-queue-worker-plan.md` §7). This CI
  profile runs exactly one `api` container, same as every prior manual run.
- Real AI provider connectivity (OpenAI/KIE with real keys) — deliberately
  excluded from every CI profile (see below).

### `pnpm run ci:all`

`ci:stable && ci:staging` — both profiles back to back. Useful for a single
local "run everything CI would run" pass; a real CI system should still run
them as separate jobs (see the ready-to-add workflow below) so a staging
failure doesn't hide whether the stable checks themselves passed, and so
the (much slower) Docker job doesn't block fast feedback from the stable
job.

## What's deliberately excluded from both CI profiles

| Command | Why excluded |
|---|---|
| `pnpm run test` / `pnpm -r run test` (root) | Runs `vitest run` with **no worker cap at all** — the least reliable option of the three (`test`, `test:stable`, `test:ci`). Do not use this in any CI profile. |
| `pnpm run test:stable` (`--maxWorkers=2`, pre-existing, still used by `check:release`) | Better than uncapped `test`, but empirically **not** reliable enough for CI as of this step's own validation (see above: 2 different-random failures, then 4 different-random failures, in two consecutive runs; isolated re-runs of every failing test always passed). Left unchanged for local/`check:release` use — CI uses the new, more conservative `test:ci` instead. |
| `apps/api`'s `smoke:providers` (`tsx src/scripts/smoke-real-providers.ts`) | Requires **real** `OPENAI_API_KEY`/`KIE_AI_API_KEY` and makes real, billed network calls (real image generation, real chat completion). Explicitly out of scope for CI per this task's own constraints (no real secrets in CI). Stays a manual, human-triggered, rate-limited check — see `docs/release-readiness.md`/`docs/deployment-runbook.md` §9. |
| `smoke-staging.ts`'s `demoFlow` section | Always reports SKIP by the script's own design (see above) — not a test that CI runs and passes/fails, just a pointer to `demo-flow.test.ts` (already covered under `ci:stable`). |
| Any Playwright *real* Chromium render | `RENDERER_PROVIDER=fake` is the default everywhere in CI (`vitest.config.ts` for `ci:stable`, `.env.staging.example` for `ci:staging`) — real Chromium rendering is exercised manually only (`docs/manual-demo-pass.md`), never in either CI profile. |

## Ready-to-add GitHub Actions workflow

Not committed as `.github/workflows/ci.yml` yet (see "Why no GitHub Actions
file yet" above) — this is the exact file to add the day this repo gets a
GitHub remote. It mirrors `ci:stable`/`ci:staging` as two independent jobs;
`staging-smoke` uses `if: always()` on its own teardown is unnecessary here
because `scripts/ci-staging.sh`'s own `trap` already guarantees
`staging:down` runs regardless of the job's outcome — GitHub Actions just
needs to let the step run to completion, which it does by default.

```yaml
name: CI

on:
  push:
    branches: [main, phase-2-checkpoint]
  pull_request:

jobs:
  stable:
    name: Stable checks (typecheck/lint/build/test)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.1.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run ci:stable

  staging-smoke:
    name: Docker staging build + smoke
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.1.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run ci:staging
```

Note `staging-smoke` does NOT depend on `stable` (`needs:`) — they run in
parallel for fast feedback, matching how `ci:stable`/`ci:staging` are two
independent scripts, not a chain. Add `needs: stable` later only if the
team decides slower feedback is an acceptable tradeoff for not spending
Docker-build minutes on a commit that already fails stable checks.

## Remaining risks

- **The `ci:stable` test step's real-world green rate is still roughly
  1-in-3-to-6 full-suite attempts, even after Production Steps 4 and 5.**
  Step 4 found and fixed one confirmed, verified root cause (a never-closed
  DB pool connection leak) but the overall failure rate did not measurably
  improve. Step 5 then root-caused the second failure mode (the 405s, and by
  extension the 403/404/"socket hang up" variants seen since) to an external
  collision between `supertest`'s ~2000-per-run ephemeral `http.Server`
  bind/close cycles and the Antigravity IDE's own background
  `language_server_macos_arm` process, which independently binds ports
  inside the same OS ephemeral range on this developer machine — see
  "Production Step 5" above for the full evidence chain. **This is a real,
  reproduced, understood root cause — not an application bug — but it is
  NOT fixed**, because the durable fix (give each test file, or the whole
  run, one already-listening server instead of one ephemeral server per
  `supertest` call) touches request-construction call sites across
  essentially all 26 test files, which this step's scope explicitly
  excluded ("no large refactor of test isolation architecture"). Until that
  follow-up lands, `ci:stable`'s test step should still not be treated as a
  fully deterministic merge gate; `CI_DEBUG_ROUTES=1` (see Step 5) lets
  anyone confirm in under a minute whether a given spurious failure is this
  same known, external, non-app-code cause.
- **`ci:staging` was reliable across every attempt today** (multiple full
  runs, plus two forced-failure injections to verify cleanup) — it does not
  share the embedded-Postgres-under-concurrent-vitest-workers architecture
  that `ci:stable`'s test step does, so it is not expected to inherit that
  risk, but it has a much smaller sample size than would be ideal.
- **The Step 2C workaround is still in place and still unresolved at the
  root** — `packages/schemas`/`model-router`/`prompt-engine` must be
  host-built before `docker compose build`; `ci:staging` handles this
  correctly (`pnpm run build` runs first), but this remains a real
  constraint on the Docker build, not eliminated by this step.
- **No GitHub Actions (or any other CI system) actually runs any of this
  automatically yet** — both scripts are real, tested, and ready, but still
  manually triggered until this repo gets a remote and the ready-to-add
  workflow above is actually committed.
- **No real production deployment. No real production config.** Both
  profiles validate a disposable local/CI staging stack only
  (`RENDERER_PROVIDER=fake`, `AI_DEFAULT_PROVIDER=fake`,
  `STORAGE_PROVIDER=local`) — see `docs/staging-compose.md`'s "Known gaps",
  unchanged.
- **Multi-worker/horizontal-scale render-queue coordination is still
  completely untested** in any profile — `docs/render-queue-worker-plan.md`
  §7's finding is unchanged.
- **No full authenticated HTTP walkthrough** — `smoke:staging`'s `demoFlow`
  section is always SKIP by design (see above); this is unchanged from
  Step 2/2B/2C.

## Related documents

- [`docs/staging-compose.md`](./staging-compose.md) — full Docker/staging
  design decisions, the Step 2B bugs found+fixed, and the Step 2C
  reproducibility findings this profile builds on. Not repeated here.
- [`docs/deployment-runbook.md`](./deployment-runbook.md) — environment
  profiles, first-deployment sequence, Step 2C result note.
- [`docs/production-readiness-review.md`](./production-readiness-review.md) —
  updated CI-readiness risk status.
