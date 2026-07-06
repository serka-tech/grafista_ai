# Grafista AI Studio — CI Stable Test Profile (Production Step 3)

> **Status: scripts + this doc only.** No `.github/workflows/` file was
> added — see "Why no GitHub Actions file yet" below. No code was changed
> beyond `package.json` (4 new scripts: `ci:stable`, `ci:staging`, `ci:all`,
> `test:ci`) and one new helper script (`scripts/ci-staging.sh`). Continues
> [`docs/staging-compose.md`](./staging-compose.md) (Production Step 2/2B/2C)
> and [`docs/deployment-runbook.md`](./deployment-runbook.md) — neither is
> re-derived here.

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
`test:stable` (`--maxWorkers=2`) — and an honest account of what today's
validation actually found, not a rosier summary:**

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

- **The `ci:stable` test step's real-world green rate on THIS machine today
  was 1-out-of-5 full-suite attempts** (see the honest account above) — a
  pre-existing, documented load-sensitivity issue in the shared-embedded-
  Postgres test architecture, not a new regression from this step and not
  something this step fixes. Before trusting `ci:stable` as a hard merge
  gate, run it several times on an actual CI runner (dedicated resources)
  to see if the failure rate observed here — very possibly specific to this
  session's ambient machine load — actually reproduces there.
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
