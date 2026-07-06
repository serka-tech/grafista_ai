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

## Known gaps (carried forward honestly)

- **Never actually run against real Docker in this authoring session** —
  the very first `docker compose -f docker-compose.staging.yml up --build`
  has not been performed. Static review + a YAML syntax-only parse is not
  a substitute for that.
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

## Recommended immediate next action for a human

Run the actual first bring-up on a machine with Docker installed:

```bash
cp .env.staging.example .env.staging
# fill AUTH_SECRET
pnpm run staging:up
docker compose -f docker-compose.staging.yml ps
docker compose -f docker-compose.staging.yml logs -f api
```

Then follow the migrate/seed/smoke sequence above, and report back what
actually happened (build errors, healthcheck flakiness, Chromium install
issues, anything the static review here could not have caught).
