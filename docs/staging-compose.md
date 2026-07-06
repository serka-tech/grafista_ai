# Grafista AI Studio — Staging Docker Compose Skeleton

> **Status: a minimal, safe, LOCAL/STAGING VALIDATION skeleton — NOT a
> production deployment.** This is "Production Step 2", the concrete
> implementation `docs/deployment-runbook.md` §13 recommended next (Docker
> Compose staging skeleton + a real HTTP-based smoke script), continuing the
> topology decision already made in `docs/production-readiness-review.md`
> §3/§4 and restated in `docs/deployment-runbook.md` §2. This doc does not
> re-derive that decision — it documents what was actually built on top of
> it.
>
> **Honest caveat, stated up front:** Docker and `docker compose` were **not
> available** in the sandbox this skeleton was authored in
> (`docker --version` returned "command not found"). Everything below was
> produced and reviewed **statically** — careful manual review of the
> Dockerfile/Compose YAML against the repo's real scripts/ports/paths, plus
> a syntax-only `python3 -c "import yaml; yaml.safe_load(...)"` parse of
> `docker-compose.staging.yml` (confirms YAML is well-formed; does **not**
> confirm the image actually builds or the stack actually comes up). **A
> human must run the first real `docker compose -f
> docker-compose.staging.yml up --build` and report back** — see "Known
> gaps" below.

## What this is for

A disposable, local Docker Compose stack that lets you run the whole API
(and, in-process, its render-queue worker) against a real containerized
Postgres — a much closer approximation of a real deployment than "run
`pnpm run dev:api` on your laptop against a local Postgres install", without
committing to any real cloud infrastructure yet.

## Files

| File | Purpose |
|---|---|
| `apps/api/Dockerfile` | Multi-stage build for the API (build stage: pnpm install + `tsc` build of `@grafista/api` and its workspace deps; runtime stage: Node 20 + Chromium + a non-root user). |
| `docker-compose.staging.yml` (repo root) | Two services: `postgres` (official `postgres:16-alpine`, healthchecked via `pg_isready`, named volume) and `api` (built from the Dockerfile, depends on postgres being healthy, exposes port 4000). |
| `.env.staging.example` (repo root) | Staging-specific env defaults/deltas — copy to `.env.staging` (gitignored) and fill in `AUTH_SECRET` before first use. |
| `apps/api/src/scripts/smoke-staging.ts` | HTTP-based smoke script against a running stack — see below. |

## Bring it up / take it down

```bash
cp .env.staging.example .env.staging
# edit .env.staging: fill AUTH_SECRET at minimum (openssl rand -hex 32)

pnpm run staging:up      # docker compose -f docker-compose.staging.yml up -d --build
# ... wait for postgres + api healthchecks to go healthy ...

# One-time setup inside the running api container (not automated by compose
# on purpose — this project has no automatic migration-on-boot behavior
# anywhere, matching docs/deployment-runbook.md §6's "migrations are
# controlled, not a blind CI step"):
docker compose -f docker-compose.staging.yml exec api pnpm --filter @grafista/api run db:migrate
docker compose -f docker-compose.staging.yml exec api pnpm --filter @grafista/api run db:seed
docker compose -f docker-compose.staging.yml exec api pnpm --filter @grafista/api run db:seed-admin

# From the HOST (not inside the container) — smoke-staging.ts talks HTTP to
# the already-exposed port 4000:
STAGING_BASE_URL=http://localhost:4000 pnpm --filter @grafista/api run smoke:staging

pnpm run staging:down    # docker compose -f docker-compose.staging.yml down
```

## Key design decisions (and why)

- **API container = worker container.** There is no separate worker
  service. The render-queue worker is an in-process `setInterval` polling
  loop started from `apps/api/src/index.ts`'s `startRenderWorkerLoop()`,
  active only when `RENDER_QUEUE_ENABLED=true` — this is the confirmed
  architecture (`docs/production-readiness-review.md`,
  `docs/render-queue-worker-plan.md`), not a simplification made here.
- **No Redis/BullMQ/Temporal.** This project has zero such dependency —
  the queue is a plain Postgres table (`render_jobs`) polled by the
  in-process worker. Adding a message broker here would misrepresent the
  real architecture.
- **No MinIO/S3 service in this first skeleton.** `STORAGE_PROVIDER=local`
  is the default (`.env.staging.example`) — writes land inside the `api`
  container's `apps/api/uploads/` directory, which is **not** persisted
  across `docker compose down`/recreate (no volume mounted for it, on
  purpose — this is a disposable validation loop, not durable storage). To
  validate the real S3-compatible path later: add a `minio` service block
  to `docker-compose.staging.yml`, or point at a real S3-compatible bucket,
  and switch `STORAGE_PROVIDER=s3` + fill the `S3_*` vars. Not implemented
  here — tracked below as a known gap.
- **`RENDERER_PROVIDER=fake` is the compose default**, not real Playwright
  rendering. The Dockerfile installs Chromium into the image regardless
  (`pnpm --filter @grafista/api exec playwright install --with-deps
  chromium` in the runtime stage), so switching to real rendering is a
  pure env flip (`RENDERER_PROVIDER=playwright` in `.env.staging`), no
  image rebuild required. Defaulting to `fake` keeps the very first
  bring-up of this skeleton as safe/cheap/deterministic as possible —
  matching how local dev's own demo mode already works
  (`docs/release-readiness.md`).
- **`AI_DEFAULT_PROVIDER=fake` is the compose default** for the same
  reason — zero network calls, zero cost, deterministic, on the very first
  validation run. Real provider connectivity is still available via
  `pnpm --filter @grafista/api run smoke:providers` once real keys are
  filled into `.env.staging` (documented inline in
  `.env.staging.example`).
- **The Docker healthcheck on `api` uses `GET /api/health`, not `GET
  /api/health/ready`.** `/api/health/ready` can legitimately report
  `status: "degraded"` (still HTTP 200) for reasons that do not mean the
  container is broken — e.g. a missing AI provider key while intentionally
  running in fake-provider demo mode, or a single stale-locked render job
  the sweep will recover on its very next poll tick
  (`docs/deployment-runbook.md` §8's explicit "degraded is not
  automatically a blocker" guidance). Using it as a hard Docker healthcheck
  gate would make Docker restart/mark-unhealthy a perfectly fine container
  for a non-blocking reason — a misuse of that endpoint's intended
  semantics. `GET /api/health` is a static process-liveness check with no
  dependency checks, which is the correct scope for a container
  healthcheck; `smoke-staging.ts`'s `ready` section is where the richer,
  human-judged dependency-readiness signal lives instead.
- **Base image: plain `node:20-bookworm-slim` + `playwright install
  --with-deps chromium`**, not the official
  `mcr.microsoft.com/playwright:v1.61.1-jammy` image. Reasoning: one base
  image family across both build and runtime stages instead of two
  different Debian variants to reconcile, and `playwright install` always
  installs the browser build matching whatever `playwright` npm version is
  actually pinned in `apps/api/package.json` (`1.61.1` today) — it
  self-corrects on every image rebuild instead of requiring a human to keep
  a Docker image tag in lockstep with a future `playwright` version bump.
- **Node 20** was chosen for the Dockerfile's base image. The repo's root
  `package.json` only pins `"node": ">=18.0.0"` (no `.nvmrc`, no more
  specific engines field found anywhere in the repo) — 20 is the current
  LTS, comfortably within that range, with headroom for `vitest` 4.x /
  `playwright` 1.61.1.
- **Postgres credentials in `docker-compose.staging.yml` are a fixed,
  disposable, local-only placeholder** (`grafista` /
  `grafista_staging_local_only`), not a real secret — the `postgres`
  service publishes no host port by default, so it is only reachable
  inside the compose network by the `api` service. `.env.staging.example`'s
  `DATABASE_URL` matches these exactly. If you ever expose Postgres beyond
  the compose network, change both sides first.

## What `smoke-staging.ts` checks (and does not)

Run via `pnpm --filter @grafista/api run smoke:staging` (or `pnpm run
smoke:staging` from inside `apps/api`), configurable via `STAGING_BASE_URL`
(default `http://localhost:4000`). Sections (run all, or a subset via CLI
args, e.g. `-- ready providers`):

| Section | What it checks | What it does NOT check |
|---|---|---|
| `app` | `GET /api/health` responds 200 with `status: "ok"` — the app process is up and reachable at all. | Any dependency (DB/storage/queue/providers) — that's `ready`'s job. |
| `ready` | `GET /api/health/ready`'s overall `status` + every individual check's status/message. `ok` → PASS. `degraded` → explicit **WARN** (not FAIL — see design decisions above), with the full per-check detail printed so a human can judge. `error` (or the request itself failing/timing out) → FAIL. | Does not itself decide whether a `degraded` reason is actually a blocker for YOUR situation — that judgment call is documented in `docs/deployment-runbook.md` §8, not automated here. |
| `providers` | Reads the `providers` sub-check from the SAME `/api/health/ready` response (no second call) and relays its own safe `present`/`missing` per-provider strings. | Never re-derives or prints actual env values — relays only what the endpoint itself already decided to expose. |
| `queue` | Reads `renderQueue` + `workerHeartbeat` from the same response. If the endpoint's own message says the queue is disabled ("queue disabled" / "not applicable"), reports **SKIP** with that detail — no invented queue-depth threshold. Otherwise PASS/WARN/FAIL based on the worst of the two check statuses. | Does not independently query `render_jobs`/heartbeat tables — purely relays what `/api/health/ready` already computed. |
| `demoFlow` | Nothing new — reports **SKIP** with an explicit pointer: run `cd apps/api && npx vitest run src/__tests__/demo-flow.test.ts` separately against a test database. | **Honest limitation:** a full authenticated multi-step HTTP walkthrough (login → client → brief → layout → QA → visual → render → download) is NOT implemented in this first version — that would need session/cookie handling and multi-step state well beyond this script's current scope. `demo-flow.test.ts` validates the full pipeline against an ephemeral embedded-Postgres test DB; this script validates a LIVE deployed app over HTTP. They are complementary, not the same check, and neither today substitutes for the other. |

Exit code: `0` unless at least one section reports `FAIL` (matching
`smoke-real-providers.ts`'s convention — `WARN`/`SKIP` never affect the exit
code).

## Production Step 2B — real Docker staging validation (done)

Unlike Step 2's authoring session, this WAS actually run against real
Docker (Docker Desktop 29.5.2 / Compose v5.1.3, macOS, arm64):

- `pnpm run staging:up` — succeeds; both `postgres` and `api` reach
  `healthy`.
- `pnpm --filter @grafista/api run db:migrate` — all 25 migrations applied
  cleanly against a fresh `postgres:16-alpine` volume (migration 002's
  `vector` extension is skipped with a warning, as designed — `alpine` does
  not ship `pgvector`; nothing in this codebase reads/writes vector columns
  yet).
- `GET /api/health` → `200 {"status":"ok"}`.
- `GET /api/health/ready` → `200`, overall `degraded` (never `error`) —
  `database`/`storage`/`renderQueue`/`workerHeartbeat`/`playwright` all
  `ok`; only `providers` is `degraded` (`kie` key intentionally absent in
  `.env.staging.example`'s safe-default demo config).
- `pnpm --filter @grafista/api run smoke:staging` → `2 pass, 2 warn, 1
  skip, 0 fail` (the `providers` WARN and `demoFlow` SKIP are both expected
  or by design, per the table above).
- Verified reproducible via a full `staging:down` → `staging:up` →
  smoke cycle, not just the first bring-up.
- Repo-wide `pnpm run typecheck` and `pnpm run lint` both pass (lint has 2
  pre-existing `react-hooks/exhaustive-deps` warnings in
  `apps/dashboard`, unrelated to this step, not treated as failures).

**Two real bugs were found and fixed getting there** (both were latent —
never exercised because Step 2's authoring session never actually ran
`docker compose build`):

1. **No `.dockerignore` existed.** `COPY . .` in `apps/api/Dockerfile` was
   copying the HOST's own `node_modules` (macOS `@esbuild/darwin-arm64`)
   into the Linux image, and `pnpm install --frozen-lockfile` does not
   reliably replace an already-present native optional-dependency binary —
   `db:migrate` (which runs via `tsx`, itself esbuild-backed) failed at
   startup with esbuild's "installed for another platform" error. Fixed by
   adding a `.dockerignore` (excludes `node_modules/`, root/`apps/*` `dist/`,
   env files, etc.).
2. **`tsconfig.base.json` had `"composite": true`** with no project anywhere
   actually using TS project references (`grep -rl '"references"'` across
   every `tsconfig*.json` in the repo: zero hits) — so it was pure dead
   weight. Combined with `packages/*/tsconfig.json` extending it via a
   cross-directory `../../tsconfig.base.json` path, this reproducibly made
   `tsc` silently emit **zero** `.js`/`.d.ts` output (exit code 0, no
   diagnostics) for `packages/schemas`/`model-router`/`prompt-engine` in a
   clean build — confirmed on the host too (not Docker-specific), fixed by
   removing `composite` (kept `incremental`) in `tsconfig.base.json`.

**One environment issue was found and worked around, not root-caused —
flagged here deliberately instead of hidden:** even after both fixes above,
a **clean, no-cache** `docker compose build` of `apps/api` still
nondeterministically produced zero `.js`/`.d.ts` output for
`packages/schemas`/`model-router`/`prompt-engine` when their source arrived
via Docker `COPY` — reproduced across both the BuildKit and legacy
builders, and the SAME `tsc` invocation against a bind-mounted (not
`COPY`'d) copy of the identical files never once failed, nor did it ever
fail once directly on the host across many repeated runs. This points at
this specific Docker Desktop installation's overlayfs/containerd-snapshotter
layer, not at this repo's code — but that could not be fully confirmed
within this session's scope. **Workaround shipped instead of a fix:**
`.dockerignore` deliberately does NOT exclude `packages/*/dist` (unlike
`apps/*/dist`, which IS excluded), and `apps/api/Dockerfile`'s build step
now runs `pnpm --filter @grafista/api run build` (only `@grafista/api`
itself) instead of `--filter @grafista/api... run build` (which would also
rebuild the 3 workspace packages via `tsc` in-container and hit the
flakiness above). **Practical consequence: `pnpm run build` must have been
run successfully on the HOST for `packages/schemas`, `packages/model-router`
and `packages/prompt-engine` before `docker compose -f
docker-compose.staging.yml build`** — a fresh `git clone` with no prior
host build would currently fail this same way. Recommended follow-up:
retry after a Docker Desktop restart/upgrade, or try switching its
file-sharing implementation (VirtioFS ↔ gRPC-FUSE) — both are common fixes
for this class of bug — then remove this workaround by restoring
`--filter @grafista/api... run build` and re-excluding
`packages/*/dist` once a clean rebuild is reliably green.

## Known gaps (carried forward honestly)

- **No MinIO/real-S3 service wired up** — `STORAGE_PROVIDER=local` only,
  in this first skeleton.
- **No CI/CD automation runs any of this** — bringing the stack up and
  running the smoke script is a manual, human-triggered action today.
- **No multi-worker/horizontal-scale testing** — this skeleton runs
  exactly one `api` container; "2 API instances = 2 workers polling the
  same table" is still untested in any real environment
  (`docs/deployment-runbook.md` §12).
- **No full authenticated HTTP walkthrough** — see the `demoFlow` section
  above.
- **Runtime image is not size-optimized** — the full built monorepo
  (including devDependencies) is copied into the runtime stage for
  simplicity; a future pass could use `pnpm deploy` or a prune step for a
  smaller image.
- **Real production deployment is explicitly out of scope** — this is a
  staging validation skeleton only.
- **`docker compose build` is not yet reproducible from a bare `git
  clone`** — see the Step 2B write-up above. It depends on
  `packages/schemas`, `packages/model-router` and `packages/prompt-engine`
  already being built on the HOST first, a workaround for an unresolved
  Docker Desktop file-system issue on this machine, not a proper fix.
- **CI/CD would need updating too** — any pipeline that runs `docker
  compose build` from a fresh checkout hits the same gap above; it would
  need a `pnpm run build` (or at least `pnpm --filter
  "@grafista/{schemas,model-router,prompt-engine}" run build`) step before
  the Docker build until the underlying issue is root-caused.

## Recommended immediate next action for a human

Production Step 2B already completed the first real bring-up (see above —
`staging:up`, migrate, health/ready, smoke, typecheck, lint all passed, and
the down→up→smoke cycle was re-verified for reproducibility). What's still
open for a human with hands-on access to Docker Desktop's settings:

```bash
# Try switching Docker Desktop's file-sharing backend (Settings > General >
# "Choose file sharing implementation": VirtioFS <-> gRPC-FUSE), or simply
# restart Docker Desktop, then re-test whether a clean multi-package build
# now works without the packages/*/dist workaround:
docker compose -f docker-compose.staging.yml build --no-cache api
# If packages/schemas etc. now emit .js/.d.ts correctly in a clean COPY-based
# build, restore `--filter @grafista/api... run build` in
# apps/api/Dockerfile and re-exclude packages/*/dist in .dockerignore.
```

For the day-to-day bring-up itself, the flow is unchanged:

```bash
cp .env.staging.example .env.staging
# fill AUTH_SECRET
pnpm run staging:up
docker compose -f docker-compose.staging.yml ps
docker compose -f docker-compose.staging.yml logs -f api
```

Then follow the migrate/seed/smoke sequence above. This already ran clean
end-to-end in Production Step 2B (see above) — re-run it after any
Dockerfile/`.dockerignore`/tsconfig change to confirm it still does.
