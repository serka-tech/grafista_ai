# Grafista AI Studio — CI Stable Test Profile (Production Step 3, hardened in Step 4, 405-flake root-caused in Step 5, substantially reduced in Step 6, remote-runner package added in Step 7, remote validation EXECUTED in Step 8)

> **Status: both GitHub Actions jobs (`stable`, `staging-smoke`) are now
> candidate merge gates, validated against a real GitHub remote** — see
> "Production Step 8 — Remote Runner Validation Protocol EXECUTED" below for
> the full run log and the three real, deterministic CI-environment bugs
> Step 8 found and fixed (none of them the local ephemeral-port flake, which
> did not recur even once across 8 real runs). Earlier history, for full
> context (see "Production Step 4"/"Production Step 5"/"Production Step
> 6"/"Production Step 7" sections below for the full, honest account): Step
> 4 fixed a confirmed DB pool leak but did NOT eliminate flakiness; Step 5
> root-caused the remaining 405/403/404/"socket hang up" flake to an
> external ephemeral-port collision with an unrelated process on the
> developer machine, without fixing it; Step 6 applied the fix Step 5
> identified and measured 6 clean full-suite `test:ci` runs out of 7
> attempts afterward locally; Step 7 committed the workflow file itself and
> defined the Remote Runner Validation Protocol; Step 8 actually executed
> that protocol for the first time, against a real GitHub remote. Continues
> [`docs/staging-compose.md`](./staging-compose.md) (Production Step 2/2B/2C)
> and [`docs/deployment-runbook.md`](./deployment-runbook.md) — neither is
> re-derived here.

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

## Production Step 6 — the 405 flake, actually fixed (shared listening server per test file)

**What this step did:** implemented the exact follow-up Step 5 identified as
the durable fix, and nothing more. Added
`apps/api/src/test/http-test-server.ts`, a small helper (`startTestServer(app)`
→ `{ server, close() }`) that calls `app.listen(0)` **once** and hands back
the already-listening `http.Server`. Per `supertest`'s own source
(`node_modules/.pnpm/supertest@7.2.2/node_modules/supertest/lib/test.js`),
`Test.serverAddress()` only calls `.listen(0)` itself when the object passed
in is a bare function whose `.address()` is still null — pass it an
already-listening `http.Server` instead and it reuses that one address for
every request, and also skips the auto-close-on-`end()` path entirely (that
path only fires for a server `supertest` created internally), so the one
real listener stays up for the whole file and is closed exactly once, in
`afterAll`.

**Files changed:** all 17 test files under `apps/api/src/__tests__/` that
import `supertest` — `analytics-events.test.ts`, `auth.test.ts`,
`client-isolation.test.ts`, `creative-qa.test.ts`, `demo-flow.test.ts`,
`design-dna.test.ts`, `layout-plans.test.ts`, `production-jobs.test.ts`,
`render-health-ready.test.ts`, `render-jobs.test.ts`,
`render-queue-worker.test.ts`, `revision-entries.test.ts`, `routes.test.ts`,
`stability.test.ts`, `storage.test.ts`, `visual-generation.test.ts`,
`workflows.test.ts`. Each file now does `const testServer =
startTestServer(app); afterAll(() => testServer.close());` right after
obtaining `app`, and every `request(app)` / `request.agent(app)` call site
became `request(testServer.server)` / `request.agent(testServer.server)`.
`demo-flow.test.ts` (the one file that loads `app` via a top-level-await
dynamic import, because it deliberately flips `AI_DEFAULT_PROVIDER` before
loading the app graph) got a second, separate `afterAll` for the server,
placed right after its existing env-restore `afterAll` — the env-flip logic
itself was not touched. The other 9 files under `__tests__/` that don't
import `supertest` (pure unit tests) were left untouched, as were
`CI_DEBUG_ROUTES`/`debug-routes.ts`/`app.ts` from Step 5.

**Effect on ephemeral bind/close volume:** this cuts the ~2000
`http.Server.listen(0)`/close cycles per `test:ci` run (one per `supertest`
call, per Step 5's finding) down to 17 — one `.listen(0)` per converted file,
opened once in module scope and closed once in `afterAll` — plus whatever
the other 9 non-`supertest` unit-test files still don't need. That is
roughly two orders of magnitude fewer ephemeral binds contending for the
same OS ephemeral port range that Step 5 found the Antigravity IDE's
`language_server_macos_arm` process also using, which is exactly the lever
Step 5 identified as the fix (shrinking the collision window, not
eliminating the shared port range itself).

**Verification performed, and the honest reliability picture:**
- Each of the 17 converted files was run standalone
  (`vitest run src/__tests__/<file>.test.ts --maxWorkers=1`) immediately
  after conversion, before moving to the next file — all 17 passed with
  their full expected test count on the first try, no fixes needed beyond
  the mechanical substitution itself.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` all passed cleanly across every
  workspace package after all 17 conversions.
- `pnpm run test:ci` (the full 433-test, 26-file, `--maxWorkers=1` suite) was
  run **seven times total across this step's validation** (four by the
  implementing agent — three standalone plus one inside `pnpm run
  ci:stable` — and three more independently by the orchestrating session
  afterward, specifically because four clean runs alone felt like too small
  a sample to call this fixed): **six of the seven were clean 433/433
  passes; one failed.** The failure (independent run #5 overall) was a bare
  `405` on the `POST /api/auth/login` call inside `production-jobs.test.ts`'s
  `loginAs()` helper, which cascaded into 22 dependent test failures in that
  one file (every other helper in that file calls `loginAs()` first) — the
  same symptom class Step 5 root-caused, not a new one. Re-running
  `production-jobs.test.ts` standalone immediately after came back clean
  (23/23) — consistent with the exact "always fails only under full-suite
  load, always clean standalone" pattern documented since Step 3. Two
  further full-suite attempts with `CI_DEBUG_ROUTES=1` enabled, made
  specifically to try to recapture the failure's log signature, both came
  back clean — the debug run never caught the failure recurring, so this
  specific instance's log signature could NOT be independently
  reconfirmed against Step 5's "missing request/response log entry" proof;
  it is presumed to be the same external-collision class based on the
  identical symptom (bare 405 on a login POST, standalone-clean), not
  re-verified with the same rigor as Step 5's original finding.
- **Net result: 6/7 (~86%) clean full-suite runs observed in this step's own
  validation**, versus the ~1-in-3-to-6 (~17–33%) rate documented in Steps
  3–5 on this same machine. This is a real, measured improvement — consistent
  with cutting ephemeral binds from ~2000/run to 17/run, which should shrink
  (not eliminate) the collision window with whatever else is using the OS's
  ephemeral port range — but it is **not zero flakiness**, and this doc will
  not claim it is. The fix reduces exposure to the Step 5 mechanism; it does
  not remove the mechanism itself (the OS ephemeral port range is still
  shared with whatever else is running on this machine).
- `pnpm run ci:stable` (`typecheck && lint && build && test:ci` chained) was
  run once, end to end, and passed cleanly (one of the six clean runs
  counted above).
- **What this does NOT prove:** 6 clean runs out of 7 attempts on one
  developer machine, in one session, is encouraging but still a small
  sample — not a large-sample statistical guarantee, and not a run on a
  dedicated, otherwise-idle CI runner. The specific mechanism Step 5
  identified (an unrelated local IDE process sharing the OS ephemeral port
  range) is inherently machine-specific — a CI runner without that process
  running at all would have a smaller (though not necessarily zero, if
  anything else shares that runner's ephemeral range) collision risk from
  this cause, so this fix's benefit on an actual CI runner could plausibly
  differ from what was measured here in either direction. Given 6/7 clean,
  `ci:stable` can reasonably be treated as an **improved but still
  non-deterministic** merge gate — calling it a "candidate merge gate"
  outright would overstate what one session's 7 runs actually show; a
  spurious failure recurred within this same step's own validation, so this
  doc explicitly does NOT claim the flake is eliminated, only measurably
  reduced. If a spurious failure is observed again, re-run the specific
  failing file standalone first (it is expected to pass, per the pattern
  above), and use `CI_DEBUG_ROUTES=1 CI_DEBUG_ROUTES_LOG_FILE=<path>` (left
  in place, unchanged, from Step 5) on the next full-suite attempt to try to
  catch and reconfirm the log signature.
- Not run in this step: `pnpm run ci:staging` (explicitly lower priority per
  this step's own task scope than repeating `test:ci`; it does not share the
  embedded-Postgres-under-concurrent-supertest architecture this step
  touches, so it was not expected to be affected either way).

**Principles honored:** no test was deleted, no assertion was loosened, no
real endpoint/route behavior changed, no retries were added to mask
flakiness, and `CI_DEBUG_ROUTES`/`debug-routes.ts`/`app.ts` were left
untouched — this step is scoped purely to the test HTTP client/server
lifecycle described above.

## Production Step 7 — CI Runner Readiness & Remote Validation Package

**Goal of this step:** make the repo verifiable on a real GitHub Actions
runner the moment it gets a remote, and define — in writing, before that
first remote run happens — exactly what result would count as trustworthy.
No product feature, no route behavior change, no test loosened, no retry
added. `git remote -v` was re-checked at the start of this step and is still
empty; nothing here assumes a remote exists yet.

### Workflow file decision: commit the real file, not just a docs drop-in

Step 3 chose to ship the ready-to-add YAML only inside this doc (see the
"Ready-to-add GitHub Actions workflow" section below, kept as-is for
reference) specifically because `.github/workflows/ci.yml` would sit
"completely inert" with no remote to run against. That reasoning about
inertness is still correct — a workflow file cannot execute without a GitHub
repository behind it — but on reflection it argued for the wrong conclusion.
An inert file is not a *risky* file: GitHub Actions never evaluates
`.github/workflows/*.yml` outside an actual GitHub-hosted repo, so committing
it today changes nothing about how this repo builds, tests, or runs locally
(verified: `pnpm run ci:stable`/`pnpm run typecheck`/`pnpm run lint`/`pnpm run
build` do not read `.github/`, confirmed by grep — no script references that
path). Two options were weighed for this step:

- **(A) Keep it doc-only** — zero new files, but means someone has to
  correctly *transcribe* the doc's YAML into `.github/workflows/` the day a
  remote is added, with no automated check that the transcription is
  faithful, and the doc's copy can silently drift out of sync with whatever
  actually gets committed later.
- **(B) Commit `.github/workflows/stable-ci.yml` now, dormant** — the exact
  file that will run is already in the repo, already YAML-syntax-validated
  (see below), and already reviewed alongside this doc. The day a remote
  exists, `git push` alone makes it live — no transcription step, no chance
  of drift, nothing else to remember or get wrong.

**(B) was chosen.** Given inertness removes the safety argument for (A), the
practical argument (fewer manual steps between "remote exists" and "CI is
actually running", zero drift risk) wins. The file lives at
[`.github/workflows/stable-ci.yml`](../.github/workflows/stable-ci.yml) and
mirrors `ci:stable`/`ci:staging` as two independent jobs, exactly as the
Step 3 draft below already specified — no new checks were invented, only
committed. Its own header comment repeats this dormancy note so a future
reader opening that file directly (not this doc) still sees it.

**YAML syntax validated statically** (no real GitHub Actions runner
available in this environment to execute it): `python3 -c "import yaml;
yaml.safe_load(open('.github/workflows/stable-ci.yml'))"` parsed cleanly and
confirmed both expected jobs (`stable`, `staging-smoke`) and both expected
triggers (`push` to `main`/`phase-2-checkpoint`, `pull_request`). This is a
syntax check only, not a runtime validation — see the protocol below for
what an actual runtime validation requires.

**No secrets hardcoded, per this step's explicit constraint:** both jobs run
entirely against fake providers (`ci:stable`'s embedded-Postgres test suite,
`ci:staging`'s `.env.staging.example` fake-provider staging stack) — neither
needs a single real credential. The env/secret catalog a future real-provider
job would need is listed by name only (no values) in
[`docs/deployment-runbook.md`](./deployment-runbook.md) §4.

### Remote Runner Validation Protocol

This is the standard this repo commits to **before** treating any GitHub
Actions run of `ci:stable` as a merge gate — written now, in advance, so
nobody is tempted to declare victory off a single green run once a remote
exists:

1. **Run `ci:stable` on the GitHub Actions runner at least 5 times** once a
   remote exists (5 separate triggered runs — re-running the same run is not
   a substitute, since the whole point is sampling independent runner
   instances, not one runner's cache/state).
2. **5/5 clean → candidate merge gate.** This is the first point at which
   `ci:stable`'s test step may reasonably be called a candidate deterministic
   gate — matching the same "small sample, state the number honestly" 
   discipline Step 6 applied to its own 6/7 local result, just applied to a
   clean-runner population instead of this developer's machine.
3. **4/5 or fewer clean → the flake is still an open risk.** Do not raise the
   sample size just to keep re-rolling until a lucky streak of 5 appears —
   report the actual ratio observed (e.g. "4/6 clean over 6 attempts") and
   treat the gate as still non-deterministic, exactly as this doc already
   treats the local 6/7 result from Step 6.
4. **On any failure, re-run with `CI_DEBUG_ROUTES=1`** (add a one-off
   `workflow_dispatch` re-run, or re-push, with that env var set on the
   `stable` job's `test:ci` step) to capture the same request/response log
   Step 5 used to root-cause the local flake — see
   `apps/api/src/middleware/debug-routes.ts`'s own doc comment for output
   format and `CI_DEBUG_ROUTES_LOG_FILE` usage.
5. **Classify the failure by its concrete symptom, not by vibes** — the
   three signatures this doc already has direct evidence for are distinct
   and should be told apart in whatever report follows a failed run:
   - **405/403 on a `POST /api/auth/login` (or similar) call, with the
     `CI_DEBUG_ROUTES` log showing a matching request/response pair** — this
     is a real application-level regression (the log proves the response DID
     come from this app's own Express pipeline) and must be treated as a
     genuine bug, not dismissed as the known local flake.
   - **405/403/404/"socket hang up", with `CI_DEBUG_ROUTES` showing NO
     matching log entry for that call** — this is the exact external-collision
     signature Step 5 root-caused (something other than this app's Express
     pipeline answered the request). On a genuinely idle, dedicated GitHub
     Actions runner this is expected to be far less likely than on the
     developer machine where it was found (no known competing process shares
     that runner's ephemeral port range) — but "far less likely" is not
     "impossible," and a runner could still have contending system services;
     this classification, once confirmed by the missing-log-entry check,
     should not by itself block a merge, but every instance should still be
     recorded in this doc's run log so the true remote rate is tracked
     honestly rather than assumed to be zero.
   - **Anything else (a new failing test, a build/typecheck/lint failure, a
     genuinely different symptom)** — treat as a real regression requiring
     the normal debugging process; none of this doc's local-machine findings
     provide cover for a failure that doesn't match one of the two signatures
     above.
6. **Record every remote attempt's outcome in this doc** (append to this
   section, do not silently overwrite) — clean/failed, and if failed, which
   of the three classifications above it matched — so the "5 attempts"
   standard in step 1 is an honest, auditable count and not a retroactive
   claim.

**Local-vs-remote environment difference, stated explicitly so it isn't
lost:** every flake finding in this doc (Steps 3–6) was measured on **one
specific developer's laptop**, running the Antigravity IDE, whose own
background `language_server_macos_arm` process was directly implicated as
the collision source (Step 5). A GitHub Actions `ubuntu-latest` runner is a
different OS (Linux, not macOS), does not run the Antigravity IDE or any of
its background processes, and is a fresh VM per run (no accumulated state
across runs). This makes it plausible — not certain — that the specific
collision mechanism Step 5 found does not reproduce there at all, or
reproduces at a different rate. That plausibility is exactly why this
protocol requires actually measuring 5 remote runs rather than assuming the
local finding transfers, in either direction.

### This step's own local validation (2/2 clean — not a substitute for the protocol above)

`pnpm run ci:stable` was run twice in full during this step, on this same
developer machine: once as a baseline before any change in this step, once
after the docs/workflow-file changes above (which touch no source or test
code, so an identical result was expected). **Both runs came back clean,
433/433.** This is consistent with — not a contradiction of — Step 6's larger
6/7 (~86%) local sample; a 2-run sample landing all-clean is ordinary
variance, not evidence the flake is gone. This result is recorded honestly
and explicitly does **not** substitute for the Remote Runner Validation
Protocol above — it is a local, single-machine data point, exactly the kind
of signal Steps 3–6 already showed is not sufficient on its own.

### Production Step 8 — Remote Runner Validation Protocol EXECUTED (5/5+ clean, both jobs)

**This is the first time this repo actually had a GitHub remote to validate
against.** `git remote add origin` was run, `phase-2-checkpoint` was pushed
(after the user gave explicit approval for both the remote add and the
push — no destructive/irreversible action was taken without that
confirmation), and the Remote Runner Validation Protocol above was executed
for real, not just planned.

**The first real run immediately found — and this step fixed — three
genuine, 100%-deterministic bugs, none of them the previously-documented
ephemeral-port flake.** All three were invisible on the developer's own
machine only because of leftover state from earlier manual sessions
(`dist/` output, a `.env.staging` file, a cached Docker layer) — exactly the
scenario this whole protocol exists to catch. Each was root-caused with
direct evidence (not guessed) and fixed only after explicit user approval,
per this step's own constraint on config changes:

1. **`ci:stable` ran `typecheck` before `build`** — but `apps/api`/
   `apps/dashboard` resolve the internal workspace packages' types via each
   package's `types` field, which points at `./dist/index.d.ts`, populated
   only by `build`. 100% reproducible on a genuine fresh clone (verified:
   `typecheck` failed with `Cannot find module '@grafista/schemas'` before
   the fix, and passed once `build` had run first). **Fix:** reordered
   `ci:stable` to `build && typecheck && lint && test:ci` in root
   `package.json` (commit `4993f28`).
2. **`ci:staging`'s Compose stack requires `.env.staging`**, gitignored by
   design (holds a developer-filled `AUTH_SECRET`) and never created by CI.
   **Fix:** a new workflow step generates it from `.env.staging.example`
   with a random, disposable `AUTH_SECRET` (`openssl rand -hex 32`), scoped
   only to that job's ephemeral, torn-down-on-exit stack — no real secret,
   nothing added to GitHub Secrets (commit `b216583`). This fix alone wasn't
   sufficient — the next run failed differently (see #3), so a second,
   separate diagnostics-only fix (commit `a299d9e`) was needed first: the
   health-check loop used `docker compose ps -q` (running containers only),
   so a container that crashed and exited between polls silently vanished
   from the health count instead of being flagged, and no container logs
   were ever captured before teardown. Verified via a forced-failure
   injection (invalid `AUTH_SECRET`, matching this doc's own Step 3
   forced-failure precedent) that the loop now fails fast and the crash
   reason actually appears in the CI log.
3. **`apps/api`'s own Dockerfile build step (`RUN pnpm --filter @grafista/api
   run build`) silently produced no output on the GitHub Actions amd64
   runner** — `Error: Cannot find module '/repo/apps/api/dist/index.js'` at
   container boot, only visible once fix #2's diagnostics were in place.
   This is the *exact* failure mode Production Step 2B documented for
   `packages/schemas`/`model-router`/`prompt-engine` on this developer's own
   Mac — but Step 2B's fix (host-build-then-copy) was only ever applied to
   those 3 packages, on the assumption the bug was specific to "this Docker
   Desktop installation." **This run is direct evidence that assumption was
   too narrow** — the identical class of bug hit a completely different
   package on a completely different, genuinely fresh environment (amd64
   Linux, not this Mac's arm64 Docker Desktop). **Fix:** applied the exact
   same host-build-and-ship treatment to `apps/api` — removed `apps/*/dist/`
   from `.dockerignore` and deleted the now-redundant in-container `tsc`
   build step (commit `95c36d5`). Verified locally three ways before
   pushing: full `ci-staging.sh` passed end-to-end on a fresh clone with a
   clean rebuild; `docker run --entrypoint sh` on the built image directly
   confirmed `/repo/apps/api/dist/index.js` exists (with the host build's
   timestamp, proving it's the copied artifact); Node loads it without
   error.

**None of these three fixes touched product behavior, routes, or test
expectations** — all three are build-order/CI-environment fixes, exactly
within this step's scope.

**Full run log (all runs against `phase-2-checkpoint`, `serka-tech/grafista_ai`):**

| Run ID | Commit | `stable` job | `staging-smoke` job |
|---|---|---|---|
| 28846144007 | `fb30735` (pre-fix) | FAILURE (deterministic bug #1, not a flake sample) | FAILURE (deterministic bug #1, cascaded) |
| 28847105359 | `4993f28` (fix #1) | **success** | FAILURE (bug #2, not yet fixed) |
| 28848441633 | `b216583` (fix #2a) | **success** | FAILURE (bug #2b, undiagnosed) |
| 28851431094 | `a299d9e` (fix #2b diagnostics) | **success** | FAILURE (bug #3, now diagnosed) |
| 28852355872 | `95c36d5` (fix #3) | **success** | **success** |
| 28852909977 | `a6b39c6` (workflow_dispatch add) | **success** | **success** |
| 28853401263 | `a6b39c6` (manual trigger) | **success** | **success** |
| 28853409931 | `a6b39c6` (manual trigger) | **success** | **success** |
| 28853414631 | `a6b39c6` (manual trigger) | **success** | **success** |

**Verdict, applying this doc's own protocol honestly:**
- **`stable` job: 5/5 clean** counting only the runs after fix #1 (the last
  one it needed) — actually **8/8 clean** across every run since. Per this
  protocol's own step 2: **this qualifies as a candidate merge gate.** This
  is the job the entire protocol above was written for (Steps 3–6's
  ephemeral-port flake), and it has now run 8 times on real, independent
  GitHub Actions runners with zero recurrence of that flake or anything
  else.
- **`staging-smoke` job: 5/5 clean** counting only the runs after fix #3
  (its last needed fix) — the same 5/5 threshold, on a smaller total
  history since this job needed two additional real fixes first. Also a
  candidate merge gate, with the same caveat as always: 5 (or 8) clean runs
  in one afternoon is a real, meaningful signal, not an infinite-sample
  guarantee — if a spurious failure appears later, re-run once and classify
  it per this doc's own signature-matching rules before assuming a
  regression.
- **The ephemeral-port flake this protocol was originally designed to catch
  (Steps 3–6) did not recur even once** across 8 real runs — consistent
  with Step 5's own hypothesis that the collision source
  (`language_server_macos_arm`, this developer's own IDE background
  process) has no reason to exist on a GitHub-hosted runner.

**What this does NOT prove:** 8 (or 5) clean runs in one session, on one
day, is a strong signal but still not an infinite-sample guarantee — the
same epistemic humility this doc has applied to every local sample size
throughout Steps 3–8 applies here too. If a spurious failure is ever
observed on a future run, classify it per this section's step 5 rules
before assuming either "it's fine, ignore it" or "the gate was wrong."

### No production deploy until remote CI validation — RESOLVED (Production Step 8)

The gate stated here since Production Step 7 — no production deployment
until the Remote Runner Validation Protocol above actually executes against
a real GitHub Actions runner and produces a 5/5 (or honestly-reported
partial) result — **is now satisfied**: see the run log and verdict
immediately above. Both `stable` and `staging-smoke` are candidate merge
gates as of commit `a6b39c6`. This does not mean every future production
readiness question is answered (see `docs/production-readiness-review.md`
§16 for what remains) — only that the specific, narrow gate this doc
imposed on remote CI trustworthiness is met.

## Why no GitHub Actions file yet (superseded by Production Step 7 — kept for history)

> **This section's conclusion no longer holds** — Production Step 7 (above)
> committed the real `.github/workflows/stable-ci.yml` file. The reasoning
> below (why nothing was committed in Steps 3–6) is left unmodified as an
> honest historical record of what was decided and why, at the time it was
> decided; do not read it as describing the current state of the repo.

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

## Ready-to-add GitHub Actions workflow (now committed — see Production Step 7)

**Update (Production Step 7): this is no longer a drop-in-later draft — it is
now committed verbatim at
[`.github/workflows/stable-ci.yml`](../.github/workflows/stable-ci.yml)**
(see "Production Step 7 — CI Runner Readiness & Remote Validation Package"
above for why). The copy below is kept for readability inside this doc; if
the two ever disagree, the committed file is the source of truth. It mirrors
`ci:stable`/`ci:staging` as two independent jobs;
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

- **The `ci:stable` test step's flakiness through Steps 3–5 was roughly
  1-in-3-to-6 full-suite attempts; Production Step 6 applied the durable fix
  Step 5 identified (share one already-listening `http.Server` per test file
  instead of one ephemeral server per `supertest` call) and measured 6
  clean 433/433 runs out of 7 full-suite `test:ci` attempts afterward — a
  real, measured improvement, but the flake recurred once within Step 6's
  own validation, so it is REDUCED, not eliminated.** See "Production Step 6"
  above for the full run-by-run account, including the one recurrence (a
  bare 405 on `production-jobs.test.ts`'s login helper, standalone-clean on
  re-run — same symptom class as before). Step 4 found and fixed one
  confirmed, verified root cause (a never-closed DB pool connection leak);
  Step 5 root-caused the remaining failure mode (the 405s, and by extension
  the 403/404/"socket hang up" variants seen since) to an external collision
  between `supertest`'s ~2000-per-run ephemeral `http.Server` bind/close
  cycles and the Antigravity IDE's own background `language_server_macos_arm`
  process, which independently binds ports inside the same OS ephemeral
  range on this developer machine, WITHOUT fixing it (out of scope for Step
  5). Step 6 then implemented that fix across all 17 `supertest`-using test
  files, cutting ephemeral binds from ~2000/run to 17/run. **6/7 clean runs
  in one session is encouraging, not a large-sample statistical guarantee,
  and the flake recurring even once within this same validation means
  `ci:stable` should NOT yet be called a "candidate merge gate" outright** —
  it is an improved but still non-deterministic gate; `CI_DEBUG_ROUTES=1`
  (see Step 5, left unchanged) still exists for anyone who hits a spurious
  failure to try to confirm whether it's a residual instance of this same
  external-collision class (now less frequent, given the ~2000→17 reduction
  in ephemeral binds) or something new — Step 6's own attempt to recapture
  the recurrence's log signature with `CI_DEBUG_ROUTES` did not catch it
  happening again, so that specific instance's signature was not
  independently reconfirmed, only presumed by symptom match.
- **`ci:staging` was reliable across every attempt today** (multiple full
  runs, plus two forced-failure injections to verify cleanup) — it does not
  share the embedded-Postgres-under-concurrent-vitest-workers architecture
  that `ci:stable`'s test step does, so it is not expected to inherit that
  risk, but it has a much smaller sample size than would be ideal.
  **UPDATE (Production Step 8): this local-only reliability turned out to be
  misleading, not wrong** — the very first real remote run found two
  genuine, 100%-deterministic bugs in `ci:staging` (missing `.env.staging`,
  and an `apps/api` Dockerfile build step that silently failed on amd64),
  both invisible on this developer's machine purely because of leftover
  state from earlier manual sessions. "Reliable in every local attempt" was
  never false — it just wasn't testing what a genuinely fresh environment
  tests. Both are now fixed and verified (see "Production Step 8" above);
  the lesson generalizes beyond this one script.
- **The Step 2C workaround is still in place and still unresolved at the
  root** — `packages/schemas`/`model-router`/`prompt-engine` must be
  host-built before `docker compose build`; `ci:staging` handles this
  correctly (`pnpm run build` runs first), but this remains a real
  constraint on the Docker build, not eliminated by this step.
- **UPDATE (Production Step 8): GitHub Actions now runs this automatically,
  and the "5/5 clean" standard IS met.** A GitHub remote was added and
  `phase-2-checkpoint` pushed; `stable` has run 8 times on real runners
  since its one needed fix, all 8 clean; `staging-smoke` needed two more
  real fixes first (see "Production Step 8" section above for the full
  root-cause writeups) and has run 5 times clean since its last one. The
  ephemeral-port flake this whole protocol was designed to catch (Steps
  3–6, local-machine only) **did not recur even once** across those 8 real
  runs — consistent with Step 5's own hypothesis that the collision source
  was specific to this developer's own machine (its IDE's background
  process), not something inherent to the test suite. Both jobs are now
  candidate merge gates. This entry is left in place (not deleted) as an
  honest record of the "entirely unmet" state that existed for most of this
  step's own duration, before the remote actually existed to test against.
- **No real production deployment. No real production config.** Both
  profiles validate a disposable local/CI staging stack only
  (`RENDERER_PROVIDER=fake`, `AI_DEFAULT_PROVIDER=fake`,
  `STORAGE_PROVIDER=local`) — see `docs/staging-compose.md`'s "Known gaps",
  unchanged.
- **UPDATE (Production Step 9): the "candidate merge gate" status above is
  a CODE-CORRECTNESS gate — it is NOT a data-safety gate, and the two must
  not be conflated.** `stable`/`staging-smoke` passing tells you the code
  compiles, lints, and behaves correctly against a disposable fake-provider
  stack; it says nothing about whether production data can be backed up or
  recovered. That is a separate, previously-undocumented gap — closed as
  of Production Step 9 by [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md)
  (persistence inventory, managed Postgres/S3 decision criteria, backup
  policy, restore procedure, staging restore drill). Written, not yet
  exercised against real data — see that document's own header warning.
  Both gates must independently pass before a real production deploy: this
  CI gate for code correctness, and a completed staging restore drill
  (`docs/backup-restore-runbook.md` §7) for data safety.
- **Multi-worker/horizontal-scale render-queue coordination is still
  completely untested** in any profile — `docs/render-queue-worker-plan.md`
  §7's finding is unchanged.
- **No full authenticated HTTP walkthrough** — `smoke:staging`'s `demoFlow`
  section is always SKIP by design (see above); this is unchanged from
  Step 2/2B/2C.

## Related documents

- [`docs/backup-restore-runbook.md`](./backup-restore-runbook.md) —
  Production Step 9: the separate data-safety gate (persistence
  inventory, managed Postgres/S3 decision, backup policy, restore
  procedure), distinct from this document's code-correctness CI gate.
- [`docs/staging-compose.md`](./staging-compose.md) — full Docker/staging
  design decisions, the Step 2B bugs found+fixed, and the Step 2C
  reproducibility findings this profile builds on. Not repeated here.
- [`docs/deployment-runbook.md`](./deployment-runbook.md) — environment
  profiles, first-deployment sequence, Step 2C result note.
- [`docs/production-readiness-review.md`](./production-readiness-review.md) —
  updated CI-readiness risk status.
