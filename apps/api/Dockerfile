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
# No tsc build runs in this stage — every workspace package's dist/,
# including @grafista/api's own, is HOST-BUILT and shipped in via the
# `COPY . .` above (see .dockerignore's comment). This Docker Desktop
# environment was found (Production Step 2B) to unreliably emit .js/.d.ts
# for packages/schemas, packages/model-router, packages/prompt-engine when
# their tsc build ran against COPY'd (not bind-mounted or host-native)
# source — reproduced consistently across both the BuildKit and legacy
# builders on that machine, deterministic 0-file emission every time, yet
# the identical tsc invocation never once failed when run directly on the
# host. This stage originally still built @grafista/api's own dist/ fresh
# in-container on the theory that only the other 3 packages were affected —
# Production Step 8's first real GitHub Actions run (a genuinely different
# environment: amd64 Linux, not this Mac) hit the identical failure mode for
# @grafista/api itself (`Error: Cannot find module '/repo/apps/api/dist/index.js'`
# at container boot — the in-container tsc silently produced no output there
# too). Root cause still not fully pinned down (ruled out: this repo's own
# tsconfig composite/extends setup — fixed separately in tsconfig.base.json;
# ruled out: BuildKit-specific COPY mtime handling — reproduces on the legacy
# builder too), but the pattern now clearly generalizes across platforms
# rather than being specific to one machine — so @grafista/api gets the same
# host-build-and-ship treatment as the other 3 packages. `pnpm run build`
# must have been run on the HOST for every workspace package before
# `docker compose build`. See docs/staging-compose.md,
# docs/ci-stable-profile.md ("Production Step 8"), and
# docs/deployment-runbook.md for the full tradeoff writeup and the follow-up
# still needed to root-cause and remove this workaround entirely.

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
