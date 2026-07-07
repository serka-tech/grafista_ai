# Grafista AI Studio — apps/api Dockerfile (STAGING validation skeleton)
#
# Part of "Production Step 2" (Docker Compose staging skeleton) — continues
# docs/deployment-runbook.md §2/§13 and docs/production-readiness-review.md
# §3/§4's already-decided topology (Docker Compose, single host, API
# container = worker container — the in-process render queue worker started
# from src/index.ts's startRenderWorkerLoop() runs INSIDE this same
# container when RENDER_QUEUE_ENABLED=true; there is no separate worker
# image/service). See docs/staging-compose.md for the full skeleton.
#
# BUILD CONTEXT MUST BE THE REPO ROOT, not apps/api — pnpm workspaces need
# the whole monorepo (packages/*, pnpm-workspace.yaml, pnpm-lock.yaml) to
# resolve `workspace:*` dependencies (@grafista/model-router,
# @grafista/prompt-engine, @grafista/schemas). docker-compose.staging.yml
# sets `build.context: .` + `build.dockerfile: apps/api/Dockerfile`
# accordingly — do not `docker build` from inside apps/api directly.
#
# Node version: this repo's root package.json only pins `"node": ">=18.0.0"`
# (no .nvmrc, no more specific engines field found anywhere in the repo) —
# Node 20 (current LTS) is used here as a safe, comfortably-within-range
# choice with headroom for vitest 4.x / playwright 1.61.1.
#
# Base image choice: plain `node:20-bookworm-slim` + `playwright install
# --with-deps chromium` at runtime, INSTEAD of starting FROM the official
# `mcr.microsoft.com/playwright:v1.61.1-jammy` image. Reasoning: (1) this
# keeps ONE base image family across both build and runtime stages instead of
# two different Debian bases to reconcile; (2) `playwright install` always
# installs the browser build matching whatever `playwright` npm version is
# actually installed (1.61.1 today per apps/api/package.json) — it
# self-corrects on every image rebuild instead of requiring a human to keep a
# Docker image tag in lockstep with a package.json version bump. Debian
# "bookworm" (not Alpine) is required — Playwright's own install-deps tooling
# targets glibc/apt-based distros, not musl/Alpine.

# ─── Build stage ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# Simplicity over layer-cache cleverness (explicitly out of scope for this
# first skeleton, per task instructions) — copy the whole monorepo, then
# install + build. A follow-up optimization pass could split package.json
# copies into an earlier layer for better Docker layer-cache reuse.
COPY . .
RUN pnpm install --frozen-lockfile
# Builds @grafista/api AND its workspace dependencies in one command —
# `@grafista/api...` is pnpm's "this package plus everything it depends on"
# filter, so packages/schemas, packages/model-router and packages/prompt-engine
# (each has `main`/`types` pointing at its own dist/, so apps/api cannot even
# typecheck without them built first) all build in the correct topological
# order before apps/api's own `tsc -p tsconfig.build.json` runs.
#
# PRODUCTION STEP 15 (fixed a real Render deploy failure — see
# docs/deployment-runbook.md's Production Step 15 entry for the full
# root-cause + verification writeup): earlier steps (2B, 8) removed this
# in-container build entirely and shipped every package's dist/ HOST-built
# via the `COPY . .` above instead, on a theory that in-container tsc
# unreliably emits zero files. That workaround assumed a host-build step
# always runs before `docker build` (true for scripts/ci-staging.sh and any
# local dev machine, where dist/ — though gitignored — is left on disk from
# earlier builds) but Render's `runtime: docker` service only ever runs
# `docker build` against a genuinely fresh git checkout, with no host-build
# step of its own — so dist/ never existed there, and the container crashed
# at boot with `Cannot find module '/repo/apps/api/dist/index.js'`.
#
# The "unreliable tsc" theory itself turned out to be a misdiagnosis of a
# ONE-LINE .dockerignore bug — see .dockerignore's own comment on
# `**/*.tsbuildinfo` for the actual root cause (a stale, host-built
# tsbuildinfo file was being copied into every Docker build this repo ever
# ran, making tsc's own incremental-build logic correctly, deterministically
# skip re-emitting already-"up to date" output). With that fixed, this
# in-container build was re-verified as fully reliable: repeated `--no-cache`
# builds (both this machine's native arch and a linux/amd64 emulated build
# matching Render's actual platform), and separately reproduced end-to-end
# against a real developer working tree carrying exactly the stale
# artifacts that broke this before — see the runbook entry for the exact
# commands and results.
RUN pnpm --filter @grafista/api... run build

# ─── Runtime stage ───────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /repo

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# Copies the ENTIRE built workspace (node_modules included) from the build
# stage — NOT size-optimized (devDependencies + the full monorepo ship in the
# final image); acceptable for a first staging validation skeleton. A future
# optimization could use `pnpm deploy` or a prune step for a slimmer runtime
# image — tracked as a known gap in docs/staging-compose.md, not solved here.
COPY --from=build /repo /repo

# Chromium + its OS-level dependencies for RENDERER_PROVIDER=playwright.
# Installed unconditionally so the SAME image supports both renderer modes —
# docker-compose.staging.yml's default env (.env.staging.example) sets
# RENDERER_PROVIDER=fake for a safe first validation loop (zero Chromium risk
# on first bring-up), with real Playwright rendering available as a pure env
# flip (RENDER_PROVIDER=playwright), no rebuild required.
RUN pnpm --filter @grafista/api exec playwright install --with-deps chromium

# Non-root user — cheap, sane default; not a full security-hardening pass
# (explicitly out of scope for this first skeleton).
RUN groupadd --system grafista \
  && useradd --system --gid grafista --create-home --home-dir /home/grafista grafista \
  && chown -R grafista:grafista /repo
USER grafista

WORKDIR /repo/apps/api
EXPOSE 4000

CMD ["node", "dist/index.js"]
