# Grafista — Production Provisioning Guide (M3, single-customer go-live)

> Follow these in order in the Render + Cloudflare dashboards. When done, send me:
> **(1)** the API service URL, **(2)** the dashboard service URL. Then I run
> migrations + smoke + seed + a live listing-card E2E. Deploy branch:
> **`go-live/m2-hardening`** (commit `3ccb22f`).
>
> **Migrations run FROM INSIDE Render, not from my machine.** The prod DB
> (`grafista-postgres-prod`) has **Inbound IP Restrictions** on, so its External
> URL is not reachable from here. Instead the API service links the DB's
> **Internal** URL, and I run the migration runner inside that service (Render
> Shell, or a Pre-Deploy Command). No External URL / IP allowlist / password
> sharing needed. See Phase 3 §5 and Phase 5.
>
> This is a **listing-card-focused** go-live: real render (Playwright) + persistent
> storage (R2), NO AI text/image cost (AI provider = fake). You can enable the AI
> pipeline later by flipping `AI_DEFAULT_PROVIDER=openai` + a real `OPENAI_API_KEY`.

---

## PHASE 1 — Cloudflare R2 (persistent storage)

1. Cloudflare dashboard → **R2** → **Create bucket** → name `grafista-prod` → (enable **versioning** in the bucket settings after creation).
2. **R2** → **Manage R2 API Tokens** → **Create API Token** → permissions **Object Read & Write**, scoped to `grafista-prod` → create.
3. Copy the three values it shows: **Access Key ID**, **Secret Access Key**, and the **S3 API endpoint** (looks like `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

→ Keep these for the API env below (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`).

## PHASE 2 — Render Postgres (prod DB) — ✅ DONE (2026-07-12)

Created and **Available**. Actual values (differ from the earlier draft above):
- Name `grafista-postgres-prod`, Service ID `dpg-d99tmrecjfls738sre5g-a`
- Database `grafista_prod`, User `grafista_prod_user`
- **PostgreSQL 18** (matches the test suite's embedded PG major), Region **Frankfurt**
- Plan Basic-256mb (~$10.50/mo)
- **Inbound IP Restrictions are ON** → the External URL is intentionally NOT used.
  Migrations + seed run from inside the API service over the **Internal** URL
  (Phase 3 §5 links it; Phase 5 runs the migrate command in a Render Shell).

## PHASE 3 — Render API service (`grafista-api-prod`) — ✅ DONE + VERIFIED (2026-07-13)

Live at **`https://grafista-api-prod.onrender.com`** (this is the `API_PROXY_TARGET`
for Phase 4). Verified from outside:
- `/api/health` → **200** (`{"status":"ok","service":"grafista-ai-studio-api"}`).
- `/api/health/ready` → **200 `status:degraded`** (the expected healthy state):
  `database:ok` (Internal DB link reachable), `storage:ok` (S3/R2 env present),
  `renderQueue:ok` (queue off, synchronous render), `playwright:ok`, `providers:degraded`
  (KIE absent by design under fake AI).
- `/api/clients` → **401** (auth guard live).

> NOTE for Phase 5: `database:ok` proves DB connectivity only (SELECT 1), NOT that
> migrations are applied. The schema may still be empty — migrations get run in Phase 5.

Original setup steps (kept for reference):

1. Render → **New** → **Web Service** → connect repo **`serka-tech/grafista_ai`** → Branch **`go-live/m2-hardening`**.
2. **Runtime: Docker**. Dockerfile path `./apps/api/Dockerfile`. **Docker build context directory: `.`** (repo root — required for the pnpm workspace). Region **Frankfurt** (same as DB).
3. **Health Check Path: `/api/health`**.
4. **Environment variables** (add each — exact values):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `API_PORT` | `4000` *(the server binds THIS; keep it equal to `PORT` — see note)* |
| `DATABASE_URL` | **link** the `grafista-postgres-prod` DB (Render: "Add from Database" → Internal URL) |
| `AUTH_SECRET` | *(see chat — 64-hex secret I generated)* |
| `OPENAI_API_KEY` | `unused-placeholder` *(presence-only; fake AI)* |
| `ANTHROPIC_API_KEY` | `unused-placeholder` *(presence-only; fake AI)* |
| `AI_DEFAULT_PROVIDER` | `fake` |
| `RENDERER_PROVIDER` | `playwright` *(REAL render — listing cards need this)* |
| `STORAGE_PROVIDER` | `s3` |
| `S3_ENDPOINT` | *(R2 endpoint from Phase 1)* |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `grafista-prod` |
| `S3_ACCESS_KEY_ID` | *(R2 access key)* |
| `S3_SECRET_ACCESS_KEY` | *(R2 secret)* |
| `S3_FORCE_PATH_STYLE` | `false` |
| `S3_SIGNED_URL_EXPIRY_SECONDS` | `300` |
| `RENDER_QUEUE_ENABLED` | `false` *(synchronous render, per decision)* |
| `COOKIE_SECURE` | `true` |
| `RATE_LIMIT_ENABLED` | `true` |
| `TRUST_PROXY` | `1` *(Render is one proxy hop — required for the rate limiter)* |
| `CI_DEBUG_ROUTES` | *(leave empty)* |

> **`API_HOST` is intentionally NOT in this matrix** — nothing in the code reads it
> (`app.listen()` gets no host arg, so Node already binds all interfaces).
>
> **`API_CORS_ORIGIN` is NOT needed for this go-live.** The dashboard reaches the API
> through a server-side BFF proxy (`API_PROXY_TARGET`), so browser traffic is
> same-origin and never triggers the API's CORS middleware. Only set it if you later
> add a direct browser→API path. (Formerly "Phase 4 step 6"; removed.)
>
> **`PORT` and `API_PORT` MUST stay equal (both `4000`).** The server binds `API_PORT`
> (`apps/api/src/index.ts`), Render routes to the container's open port (`EXPOSE 4000`).
> If they drift, Render routes to a port nothing is listening on and the deploy never
> goes green. (Tracked in `ISSUES.md` — a later cleanup should make the server prefer
> Render's canonical `PORT`.)

> Optional (only if you want AI image generation later — NOT needed for listing cards):
> `KIE_AI_API_KEY` (from master.env), `KIE_AI_BASE_URL=https://api.kie.ai`,
> `KIE_AI_IMAGE_MODEL=nano-banana-2`, `CLIENT_MONTHLY_BUDGET_USD=50`, `KIE_IMAGE_COST_USD=0.05`.

5. **Create Web Service** → wait for the first deploy to go green. **Send me the API URL** (e.g. `https://grafista-api-prod.onrender.com`).

> **What "green" does and does NOT prove.** The health check path is `/api/health`,
> which is a pure liveness route — static JSON, no DB, no storage. So the service
> goes green on the very first deploy even though the DB is still **empty** and R2
> is **untested**. That is expected and is only the bootstrap signal, NOT go-live.
> Boot itself runs **no** DB query (the render-queue worker is off via
> `RENDER_QUEUE_ENABLED=false`), so an empty DB will not crash boot.
>
> **`/api/health/ready` is a diagnostic, not proof.** It returns **200 even when
> `degraded`** (only a hard `error` gives 503), and its sub-checks are shallow:
> `storage:ok` means the S3 env vars are *present*, not that R2 actually accepts a
> write; `playwright:ok` means the npm package *resolves*, not that Chromium launches;
> `providers:degraded` is EXPECTED here (KIE key absent by design under fake AI). So
> under this matrix `/health/ready` returns `200 status:degraded` on a healthy service.
> **The real go-live gate is the Phase 5 live E2E** (a real R2 put + a real Chromium
> render + byte-verified download) plus an authenticated dashboard→API proxy smoke.

### Phase 3 §5 — the migration runner (I run this in Phase 5, noted here for setup)

**One sequence** for this empty-DB first go-live: let the first deploy go green
(liveness only), then run migrations once from the **Render Shell**, then verify.

`grafista-api-prod` → **Shell** tab → run exactly:

```
node dist/scripts/db-migrate.js
```

The Dockerfile WORKDIR is `/repo/apps/api`, so this resolves the compiled runner; the
runner resolves `../../../../database/migrations` → `/repo/database/migrations`. **Both
the compiled `dist/scripts/db-migrate.js` AND the `database/migrations/*.sql` files are
asserted present in the image** (`.dockerignore` excludes `dist`/`node_modules`/
`tsbuildinfo` but NOT `database/`; the build stage recompiles `dist/` in-container). If
that command is missing or errors on a fresh deploy, the **image is broken** — do not
paper over it with a tsx/`pnpm run` variant; fix the image. It prints
`[migrate] applied NNN...` for 001→026 and is idempotent (re-run is a no-op via the
`schema_migrations` table).

Requires only env already in the matrix (the runner imports `config/env.ts`, which
validates `DATABASE_URL`, `AUTH_SECRET`, `API_PORT`, `AI_DEFAULT_PROVIDER`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — all present). On Render PG18 the `002_pgvector.sql`
step should apply normally (Render provides the `vector` extension); the runner's
best-effort self-skip is only a fallback for a Postgres without pgvector.

**Optional durability follow-up (after the first Shell run succeeds):** add it as a
Pre-Deploy Command (Settings → Pre-Deploy Command = `node dist/scripts/db-migrate.js`)
so future deploys can never serve an un-migrated schema. Add it AFTER the manual run
confirms the command, so a first-deploy typo can't block go-live.

## PHASE 4 — Render Dashboard service (`grafista-dashboard-prod`) — ✅ DONE + VERIFIED (2026-07-13)

Created via the Render dashboard (browser-driven). Service ID `srv-d9a138d8nd3s73aa5c10`,
**URL `https://grafista-dashboard-prod.onrender.com`**, Node runtime, **Free** instance
(chosen to avoid a recurring charge; spins down after 15min idle — upgrade to Starter later
to kill cold starts). Deployed branch `go-live/m2-hardening` @ `3ccb22f`. Config as below;
`API_PROXY_TARGET=https://grafista-api-prod.onrender.com` set at creation (build-time bake).

**First deploy green** — full workspace build passed (`pnpm -r run build`: schemas + dashboard
`next build` + prompt-engine + model-router + api `tsc`, all Done; the devDep-typescript concern
did NOT materialize). Verified from outside:
- `/login` → **200** (dashboard serving; health-check path).
- `/api/health` (BFF proxy → API) → **200** `{"service":"grafista-ai-studio-api"}` — proves the
  `API_PROXY_TARGET` bake reaches the prod API server-side.
- `/api/clients` (proxy → protected route) → **401** (proxy reaches API + auth guard live).

→ **Both URLs now exist. Phases 1–4 COMPLETE. Ready for Phase 5** (migrations + seed + live E2E).

1. Render → **New** → **Web Service** → same repo, Branch **`go-live/m2-hardening`**.
2. **Runtime: Node**. Region **Frankfurt**.
   - **Build Command:** `pnpm install --frozen-lockfile && pnpm run build`
   - **Start Command:** `pnpm --filter @grafista/dashboard exec next start -p $PORT`
3. **Health Check Path: `/login`**.
4. Environment variable:

| Key | Value |
|---|---|
| `API_PROXY_TARGET` | `https://grafista-api-prod.onrender.com` *(confirmed live Phase-3 API)* |

> ⚠️ **Set `API_PROXY_TARGET` in the creation form, BEFORE the first build.** Next.js bakes
> the rewrite destination into the routes manifest at `next build` time (see
> `apps/dashboard/next.config.js`). If you add it after the first deploy, you MUST trigger a
> manual rebuild — a runtime-only env change will not take effect.

5. **Create Web Service** → wait for green. **Send me the dashboard URL**.
   (No CORS step: the dashboard proxies to the API server-side, so no cross-origin
   browser call exists — see the `API_CORS_ORIGIN` note in Phase 3.)

---

## PHASE 5 — I run (once you send the 2 URLs)

- Apply migrations 001→026 **from inside the API service** (Render Shell,
  `node dist/scripts/db-migrate.js`, Internal `DATABASE_URL`) — see Phase 3 §5. Confirm
  `[migrate] applied 026...` and re-run once to confirm idempotency (all `skip`).
- Smoke (diagnostic, not the gate): `/api/health` (liveness 200); `/api/health/ready`
  will return **200 with `status:degraded`** — that is HEALTHY here. Assert the specific
  sub-checks: `database:ok` (proves only DB **connectivity** + the Internal link — it runs
  `SELECT 1`, NOT a schema check; migration success is proven separately by the runner
  reaching `[migrate] applied 026` + the idempotent re-run above), `storage:ok` (S3 env
  present), `playwright:ok` (package resolves); `providers:degraded` is expected (KIE
  absent). Dashboard `/login` (200) and dashboard `/api/health` (proxy reaches the API).
- Seed the OWNER login + a real customer (Turyap) client.
- **Live E2E — THE actual go-live gate:** create a listing card through the prod API
  (upload photo → real Playwright render → download) → byte-verify the card. This is the
  first real exercise of **R2 storage** (real put/get) and **real Chromium** (neither is
  proven by `/health/ready`). Also do an authenticated dashboard→API proxy smoke (login →
  a client call through the BFF proxy). Then delete the throwaway test data.

## What to send me when Phases 1–4 are done
1. **API service URL** (Phase 3)
2. **Dashboard service URL** (Phase 4)

(No Postgres URL needed — migrations run inside the service over the Internal URL.
If any deploy fails, paste the Render build/deploy log and I'll diagnose.)
