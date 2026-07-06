# Grafista AI Studio — Release Readiness & Local Deployment Checklist

> **Phase 3 follow-up:** this checklist's env/service inventory and
> test-flakiness note were both cross-checked and expanded into a full
> production-readiness plan — see
> [`docs/production-readiness-review.md`](./production-readiness-review.md)
> for the deployment topology recommendation, monitoring/logging gaps, and
> the recommended next implementation step (healthcheck + worker
> heartbeat/stale-lock recovery).

Phase 2 Step 11. This is a checklist document, not a new feature. It
consolidates what's already true about running the MVP demo locally — the
step-by-step mechanics live in `docs/mvp-demo-flow.md`; this document is the
go/no-go gate and the env/service reference around it.

## 1. Project state

- Phase 1 (MVP scaffold) and Phase 2 Steps 1–10 are complete (see
  `docs/roadmap.md` for the full list). Last synced commit: `18a1b51`.
- The MVP demo flow — client → DesignDNA → content idea → design brief →
  layout generation → Creative QA → visual generation → production package →
  production review → render/export → download — runs end-to-end against a
  keyless (fake AI provider) configuration, exercised on every test run by
  `apps/api/src/__tests__/demo-flow.test.ts`.
- 274 unique tests pass (`apps/api`, see "Test suite load sensitivity" below
  for the deterministic invocation).
- **Photoshop is NOT the production engine.** The production line is
  AI-driven design + an automatic render/export pipeline (HTML/CSS +
  Playwright). Photoshop/PSD/Adobe UXP integration is an optional,
  unimplemented finalization/handoff layer for later
  (`docs/photoshop-automation-plan.md` — plan only, nothing built). No real
  Photoshop/Adobe/PSD rendering exists anywhere in this codebase today.

## 2. Required services

| Service | Required for | Notes |
|---|---|---|
| PostgreSQL 14+ | everything | pgvector extension optional — migration `002_pgvector.sql` is skipped with a warning if unavailable |
| S3-compatible storage (MinIO/S3/R2) | design reference & artifact storage | optional — `STORAGE_PROVIDER=local` (default) writes to `apps/api/uploads/` instead |
| API server (`apps/api`, Express) | everything | default port `4000` |
| Dashboard (`apps/dashboard`, Next.js) | manual UI walkthrough | default port `3000`, expects the API at `4000` |
| Playwright/Chromium | real render/export | optional — `RENDERER_PROVIDER=fake` removes this dependency entirely |

## 3. Env checklist

Base file: `.env.example` (root). Copy it to `apps/api/.env` and fill in.

**Database**
- `DATABASE_URL` — required, API fails fast at startup if missing/invalid.
- `PGVECTOR_ENABLED` — optional; migration runner degrades gracefully if the extension isn't installed.

**Auth/session**
- `AUTH_SECRET` — required, ≥16 chars (`openssl rand -hex 32`); API fails fast if missing/short.
- `COOKIE_SECURE` — `false` for local dev, `true` behind HTTPS.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — only read by `db:seed-admin`, not required for API boot.

**Storage**
- `STORAGE_PROVIDER` — `local` (default, no further config) or `s3`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` — required together when `STORAGE_PROVIDER=s3`. No silent fallback to local on failure.

**AI providers**
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` — text/vision. OpenAI and Anthropic keys must be **non-empty** at boot (presence-only check) even in fake mode — a dummy string works.
- `KIE_AI_API_KEY`, `KIE_AI_BASE_URL` (+ optional `KIE_AI_IMAGE_MODEL`, `KIE_AI_TIMEOUT_MS`, `KIE_AI_POLL_INTERVAL_MS`) — required together for real image generation. Without them, visual generation fails with a clear "provider configuration" error and the output row is persisted as `failed` (no crash).
- `HIGGSFIELD_API_KEY`, `HIGGSFIELD_BASE_URL` — placeholder adapter, not yet wired to a real capability.
- `AI_DEFAULT_PROVIDER`, `DEFAULT_TEXT_PROVIDER`, `DEFAULT_VISION_PROVIDER`, `DEFAULT_IMAGE_PROVIDER`, `OPENAI_VISION_MODEL`, `AI_MAX_RETRIES`, `AI_TIMEOUT_MS` — routing defaults; see `docs/model-routing.md`.

**Fake provider / fake renderer (demo mode)**
- `AI_DEFAULT_PROVIDER=fake` — single switch, routes every AI call to the deterministic `FakeAIAdapter`. Zero network, zero cost. Production behavior is unchanged unless explicitly set.
- `RENDERER_PROVIDER=fake` — deterministic render buffers, no Chromium required. Unset/`playwright` (default) does real PNG/JPG/PDF export.

**API / dashboard / ports**
- `API_PORT` (`4000`), `API_HOST` (`0.0.0.0`), `API_CORS_ORIGIN` (`http://localhost:3000`).
- `NEXT_PUBLIC_API_URL` (`http://localhost:4000`) — dashboard's API base.

**Security / misc**
- `UPLOAD_MAX_SIZE_MB`, `ALLOWED_FILE_TYPES`.
- `PHOTOSHOP_WORKER_URL`, `PHOTOSHOP_WORKER_ENABLED=false` — parked, leave disabled.
- `LOG_LEVEL`, `NODE_ENV`.

`.env.example` already documents all of the above inline; no new variables were introduced.

## 4. Local startup checklist

```bash
# 1. install dependencies
pnpm install

# 2. start a local PostgreSQL 14+ (any empty DB), then set DATABASE_URL in apps/api/.env

# 3. apply migrations (001-020, pgvector step auto-skips if unavailable)
pnpm --filter @grafista/api run db:migrate

# 4. seed roles/permissions + sample client
pnpm --filter @grafista/api run db:seed

# 5. create your login user (OWNER)
ADMIN_EMAIL=demo@grafista.local ADMIN_PASSWORD='Demo1234!' \
  pnpm --filter @grafista/api run db:seed-admin

# 6. seed demo design references WITH real image bytes (needed for DesignDNA)
pnpm --filter @grafista/api run db:seed-demo

# 7. (only if STORAGE_PROVIDER=s3) start MinIO/point at your S3-compatible
#    endpoint and confirm the bucket in S3_BUCKET already exists — the
#    storage adapter does not auto-create buckets

# 8. (only if RENDERER_PROVIDER unset/playwright) install the Chromium binary
cd apps/api && npx playwright install chromium && cd ../..

# 9. start the API and dashboard (separate terminals)
pnpm run dev:api        # http://localhost:4000
pnpm run dev:dashboard  # http://localhost:3000

# 10. run the demo flow test as a smoke check
cd apps/api && npx vitest run src/__tests__/demo-flow.test.ts
```

Full step-by-step dashboard walkthrough (12 steps, login → download): see
"Demo flow (dashboard, in order)" in `docs/mvp-demo-flow.md`.

## 5. Fake mode (fully offline demo)

Set in `apps/api/.env`:

```
AI_DEFAULT_PROVIDER=fake
RENDERER_PROVIDER=fake
OPENAI_API_KEY=sk-demo-not-real
ANTHROPIC_API_KEY=sk-ant-demo-not-real
STORAGE_PROVIDER=local
```

- Every AI call (DesignDNA analysis + synthesis, content ideation, layout
  generation, Creative QA, visual generation) resolves to canned,
  schema-valid responses (`packages/model-router/src/providers/fake.ts`) —
  zero network, zero cost, fully deterministic (same layouts/ideas/visuals
  every run — that's intentional, not a bug).
- Creative QA always returns a passing report (score 88), so the pipeline
  proceeds without a human QA override.
- Visual generation returns two real 64×64 PNGs — previews/downloads work.
- `RENDERER_PROVIDER=fake` produces deterministic buffers with correct magic
  bytes; downloads "work" but are not real rendered images.
- This is the configuration `apps/api/src/__tests__/demo-flow.test.ts` and
  the whole `vitest` suite run under — see `apps/api/vitest.config.ts`.

## 6. Real provider smoke mode

Live smoke run on 2026-07-05 (Phase 2 Step 12) via the dedicated probe:

```bash
# from the repo root, with apps/api/.env loaded into the shell
# (the scripts read process.env directly — nothing auto-loads .env):
set -a; source apps/api/.env; set +a
pnpm --filter @grafista/api run smoke:providers            # all sections
pnpm --filter @grafista/api run smoke:providers openai kie # subset
```

Sections and last results (no secrets are ever printed):

| Section | Result | Notes |
|---|---|---|
| `storage` | PASS | local put/get/delete roundtrip under `apps/api/uploads/` |
| `openai` | PASS | one tiny chat completion, `gpt-4o`, auth + routing verified |
| `kie` | PASS* | 1 image via `nano-banana-2`, bytes downloaded + stored + verified. Re-verified after Step 13 hotfix A: the smoke now deliberately sends raw `1080:1080`, which the adapter normalizes to `1:1` (aspect-ratio normalization, see below) |
| `render` | PASS | real Playwright/Chromium PNG render, non-empty buffer |

*KIE caveat — resolved by Step 13 hotfix B: at Step 12 time the adapter's
built-in default model was `gpt-image-1.5`, which Kie no longer accepts
(HTTP 422 "model not supported"), so real runs needed a manual
`KIE_AI_IMAGE_MODEL=nano-banana-2` override in `apps/api/.env`. The
built-in default is now `nano-banana-2` (`KIE_DEFAULT_IMAGE_MODEL` in
`packages/model-router/src/providers/kie-ai.ts`), so fresh environments
work without the override; `KIE_AI_IMAGE_MODEL` remains an optional
override with unchanged precedence.

**Step 13 hotfix A (applied):** KIE aspect-ratio normalization. The adapter
now normalizes any `metadata.aspectRatio` (raw pixel pairs like `1080:1080`,
`WxH` strings, unreduced ratios) to a Kie-supported ratio via gcd reduction +
nearest-supported snapping (`packages/model-router/src/aspect-ratio.ts`);
unusable input degrades to omitting `aspect_ratio` instead of crashing.
Fixes manual-demo-pass blocker B2 (real image generation 500'd for every
standard preset). Covered by `apps/api/src/__tests__/kie-aspect-ratio.test.ts`;
real KIE smoke with raw `1080:1080` passes.

**Step 13 hotfix B (applied):** KIE default image model updated. The
adapter's built-in fallback is now `nano-banana-2` (exported as
`KIE_DEFAULT_IMAGE_MODEL`, single source of truth), replacing the
Kie-rejected `gpt-image-1.5`. Resolution order is unchanged:
`request.model` > `KIE_AI_IMAGE_MODEL` env > built-in default. Covered by
`apps/api/src/__tests__/kie-default-model.test.ts` (mocked fetch, no real
network).

S3 smoke was skipped: `STORAGE_PROVIDER=local` and S3 env vars are empty —
local mode is the verified path.

Env combinations for running real provider mode:

- **OpenAI key present:** set `AI_DEFAULT_PROVIDER=openai` + real
  `OPENAI_API_KEY`. Text tasks (DesignDNA analysis/synthesis, content
  ideation, design brief, layout generation, Creative QA) route to OpenAI
  per `docs/model-routing.md`.
- **KIE AI key present:** set `KIE_AI_API_KEY` + `KIE_AI_BASE_URL` — this is
  the only adapter with real image-generation capability today. Without it,
  visual generation fails with an explicit "provider configuration" error
  (output row persisted as `failed`; no crash, no silent fallback to fake).
- **No real provider keys:** leave `AI_DEFAULT_PROVIDER=fake` — the system
  degrades to deterministic canned output, it does not attempt and fail a
  live call.
- Gemini and Higgsfield adapters remain placeholders — not wired to a real
  capability yet.

## 7. Render runtime check

- Real rendering (`RENDERER_PROVIDER` unset or `playwright`) requires a
  one-time Chromium install: `cd apps/api && npx playwright install
  chromium`.
- Smoke-test locally by generating a render/export for any preset (Instagram
  Post/Story, Landscape, Ad Creative) from the dashboard, or by running the
  API test suite with `RENDERER_PROVIDER` unset for a single manual pass
  (the suite itself always forces `RENDERER_PROVIDER=fake`, see
  `apps/api/vitest.config.ts`).
- If the Chromium binary is missing, real renders fail with Playwright's
  standard "Executable doesn't exist" error pointing at the install command
  above — expected, not a product bug. Use `RENDERER_PROVIDER=fake` to avoid
  the dependency entirely for demo purposes.

## 8. Test commands

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

- **Stability note:** the API test suite (17 files) shares one embedded
  PostgreSQL instance. On a loaded machine, the full parallel run can flake
  one random test with a timeout/socket signature. The deterministic
  invocation is wrapped as a root script:

  ```bash
  pnpm run test:stable   # = cd apps/api && npx vitest run --maxWorkers=2
  ```

  Any file that flakes under full parallelism passes in isolation — this is
  known load sensitivity, not a product bug.
- **One-shot gate:** `pnpm run check:release` chains
  `typecheck && lint && test:stable && build` — the same four commands
  above, run in the safe order, nothing new under the hood.
- `dist/` build artifacts are excluded from vitest collection (since
  `dda634f`) — suite totals are real: 274 unique tests, not double-counted.

## 9. Known technical debt

- ~~**Cross-client isolation** is limited by the global permission model~~ —
  resolved by Phase 3 Step 4: `client_members` (opt-in user↔client scoping,
  additive/non-breaking — zero rows = unrestricted, unchanged for every
  existing user) + `assertClientAccessible()` guard at both route and
  service layer for production jobs, render jobs/export artifacts, visual
  outputs, layout plans, creative QA, and design DNA. Remaining gap: no
  self-service UI to manage `client_members` rows yet — restricting a real
  user today requires a direct DB/migration insert. No tenant/organization/
  billing model was introduced; this is scoping only.
- **Render history endpoint N+1 query** (one artifact query per render job)
  — accepted at MVP scale.
- **Text overflow / safe area QA are heuristics** (average glyph width, AABB
  intersection) — they surface risk, not typographic ground truth.
- **Test suite load sensitivity** — see §8 above.
- ~~**KIE default image model is stale**~~ — resolved by Step 13 hotfix B:
  the built-in default is now `nano-banana-2` (`KIE_DEFAULT_IMAGE_MODEL`),
  `KIE_AI_IMAGE_MODEL` stays an optional override; see §6.
- **Real-provider smoke covers connectivity, not the full user chain** —
  §6's probe verified auth/generation/storage/render per provider; the full
  dashboard-driven chain with real providers is part of Step 13's manual
  pass.
- **Dashboard manual demo requires the full local dev stack** (real
  Postgres + `pnpm run dev:api` + `pnpm run dev:dashboard`) — the automated
  twin (`demo-flow.test.ts`) covers the API chain only. This is Phase 2 Step
  13, not yet done.
- **Photoshop/Adobe/PSD integration is deliberately out of scope** — do not
  open it as a side effect of another step.

## 10. Release go/no-go checklist

- [ ] Migrations applied (`db:migrate`, 001–020) with no unexpected errors
- [ ] Storage verified — `local` uploads directory writable, or (if `s3`)
      bucket exists and credentials work
- [ ] Fake-mode demo passes: `demo-flow.test.ts` green, full 12-step
      dashboard walkthrough completes
- [ ] Render artifact downloads succeed (PNG/JPG/PDF, per preset rules)
- [ ] Dashboard opens and logs in with the seeded admin user
- [ ] Full test suite passes via the deterministic invocation
      (`pnpm run test:stable`)
- [ ] `pnpm run typecheck` and `pnpm run lint` clean at the repo root
      (or run all four gates at once: `pnpm run check:release`)
- [ ] No Photoshop/Adobe/PSD dependency introduced anywhere in the demo path

## Related docs

- `docs/mvp-demo-flow.md` — step-by-step runbook (the source of truth this
  checklist summarizes)
- `docs/roadmap.md` — project state and phase plan
- `docs/model-routing.md` — provider matrix and routing rules
- `docs/architecture.md` — system overview
- `docs/photoshop-automation-plan.md` — parked, unimplemented future layer
