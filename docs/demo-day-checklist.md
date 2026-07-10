# Grafista AI Studio — Demo Day Checklist

**Purpose:** a short, ordered checklist to run through before showing
Grafista to someone — local first, then staging. This is a checklist, not a
runbook — every step links to the doc that actually explains it. Don't
re-derive detail here; follow the links.

---

## 1. Local pre-flight (offline, ~5 min)

Run from the repo root, in order:

```bash
pnpm -r run typecheck        # expect: exit 0
pnpm -r run build            # expect: exit 0
pnpm run test:ci             # expect: full API suite passes, 0 failures
                              # (embedded Postgres, deterministic fake renderer,
                              #  fake AI keys — no network/DB setup needed)
pnpm --filter @grafista/api exec vitest run src/__tests__/demo-flow.test.ts
                              # expect: 19/19 pass — the executable twin of the
                              # demo runbook (client → DesignDNA → layout →
                              # Creative QA → visual generation → production →
                              # render/export + 4 failure paths)
```

If all four are green, the code itself is demo-ready. If any fails, stop —
do not proceed to a live demo on a red build.

**Bootstrap a demo database** (idempotent, non-destructive, safe to re-run;
requires `DATABASE_URL` to already point at a real Postgres):

```bash
pnpm --filter @grafista/api run db:seed-demo-all
```

Runs migrate → base seed (Flavora Organic client) → 2 demo design
references with real image bytes → demo OWNER user → one `approved`
render-ready design brief. Optional env: `ADMIN_EMAIL` (default
`demo-owner@grafista.local`), `ADMIN_PASSWORD` (≥8 chars; if unset, a strong
random password is generated and printed **once** — capture it before it
scrolls away).

Pair with `AI_DEFAULT_PROVIDER=fake` in `apps/api/.env` for a fully offline
demo (zero network, zero cost, deterministic — see `.env.example`'s "DEMO
MODE" block).

**Start both apps:**

```bash
pnpm run dev:api          # apps/api on :4000
pnpm run dev:dashboard    # apps/dashboard on :3000
```

For the full click-through script (12-step dashboard walkthrough, exact
screens, what to click), see
**[`mvp-demo-flow.md`](./mvp-demo-flow.md)** — do not re-improvise the tour,
follow that doc.

---

## 2. Staging smoke (against the deployed API)

```bash
STAGING_BASE_URL=<staging-api-or-dashboard-url> \
  pnpm --filter @grafista/api run smoke:staging
```

Sections: `app` (liveness), `ready` (full `/api/health/ready` summary —
`degraded` is reported as **WARN**, never an automatic FAIL), `providers`
(key presence relay), `queue` (render queue / worker heartbeat, SKIP if
`RENDER_QUEUE_ENABLED=false`), `demoFlow` (always SKIP — points back to
§1's `demo-flow.test.ts`). Exit code is non-zero only on FAIL — WARN/SKIP
never fail the run. See **[`ci-stable-profile.md`](./ci-stable-profile.md)**
for the full WARN-vs-FAIL rationale and how this script is used as a CI
merge gate.

**Three behavioral checks** to run by hand against the same base URL
(`$URL`):

```bash
# 1. Health — expect HTTP 200
curl -s -o /dev/null -w '%{http_code}\n' "$URL/api/health"

# 2. Unauthenticated protected route — expect HTTP 401
curl -s -o /dev/null -w '%{http_code}\n' "$URL/api/clients"

# 3. Login with the demo owner — expect HTTP 200 + a grafista_session cookie
curl -s -i -X POST "$URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}' | head -20
```

---

## 3. Render.com env checklist

Grouped by service. "Required" = the app fails to boot or the feature is
broken without it; "Optional" = has a safe default. Sourced from
`apps/api/src/config/env.ts` (boot-time `zod` validation) and
`.env.example`; the dashboard proxy specifics are corroborated in
[`deployment-runbook.md`](./deployment-runbook.md) §23/§28 (Render staging
setup).

### 3a. API service (`grafista-api-staging` or equivalent)

| Variable | Required? | Note |
|---|---|---|
| `DATABASE_URL` | **Required** | `postgres://`/`postgresql://`; API fails fast at boot if missing/malformed (`env.ts`) |
| `AUTH_SECRET` | **Required** | ≥16 chars, boot-time check (`env.ts`); generate with `openssl rand -hex 32` |
| `AI_DEFAULT_PROVIDER` | **Required** | `openai`, `claude`, or `fake` (`env.ts`); `fake` bypasses all real AI calls |
| `API_PORT` | **Required** | numeric (`env.ts`); `.env.example` default `4000` |
| `OPENAI_API_KEY` | **Required (presence-only)** | must be non-empty even in `fake` mode — any dummy string works (`env.ts`, `.env.example`) |
| `ANTHROPIC_API_KEY` | **Required (presence-only)** | same as above (`env.ts`) |
| `COOKIE_SECURE` | Optional, defaults `false` | set `true` in production/staging behind HTTPS (`env.ts`) |
| `STORAGE_PROVIDER` | Optional, defaults `local` | set `s3` for a working staging demo — `local` has no backup story (`.env.example`, [`backup-restore-runbook.md`](./backup-restore-runbook.md)) |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_FORCE_PATH_STYLE` | Required together when `STORAGE_PROVIDER=s3` | `.env.example`; adapter does not auto-create the bucket |
| `RENDERER_PROVIDER` | Optional, defaults `playwright` | set `fake` to remove the Chromium dependency entirely (`.env.example`) |
| `RENDER_QUEUE_ENABLED` | Optional, defaults `false` | `true` moves render onto the Postgres-backed queue/in-process worker (`.env.example`) |
| `RENDER_WORKER_ID` / `RENDER_JOB_MAX_ATTEMPTS` / `RENDER_JOB_BASE_DELAY_MS` / `RENDER_WORKER_POLL_INTERVAL_MS` / `RENDER_JOB_STALE_LOCK_MS` | Optional | queue tuning, all have defaults (`.env.example`) |
| `KIE_AI_API_KEY` / `KIE_AI_BASE_URL` | Required together for real image generation | otherwise visual generation fails with a provider-configuration error (`.env.example`) |
| `KIE_AI_IMAGE_MODEL` / `KIE_AI_TIMEOUT_MS` / `KIE_AI_POLL_INTERVAL_MS` | Optional | override defaults (`.env.example`) |
| `GEMINI_API_KEY`, `HIGGSFIELD_API_KEY` / `HIGGSFIELD_BASE_URL` | Optional | placeholder adapters, not wired to a real capability (`.env.example`) |
| `API_CORS_ORIGIN` | Optional, defaults `http://localhost:3000` | only matters for a direct-browser (non-proxy) topology (`.env.example`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Optional | only read by `db:seed-admin`, not by the API server itself (`.env.example`) |
| `UPLOAD_MAX_SIZE_MB` / `ALLOWED_FILE_TYPES` | Optional | upload limits, have defaults (`.env.example`) |
| `PHOTOSHOP_WORKER_URL` / `PHOTOSHOP_WORKER_ENABLED` | Optional, leave disabled | parked feature, never implemented (`.env.example`) |
| `CI_DEBUG_ROUTES` / `CI_DEBUG_ROUTES_LOG_FILE` | Optional, debug-only | never set in production (`.env.example`) |
| `LOG_LEVEL` / `NODE_ENV` | Optional, cosmetic | not read by any app code today (`.env.example`) |

### 3b. Dashboard service (`grafista-dashboard-staging` or equivalent)

| Variable | Required? | Note |
|---|---|---|
| `API_PROXY_TARGET` | **Required (build-time)** | e.g. `https://grafista-api-staging.onrender.com` — the dashboard's Next.js server proxies `/api/*` to this URL so cookies stay first-party (same-origin proxy; see `apps/dashboard/next.config.js`, `apps/dashboard/src/lib/api.ts`, [`deployment-runbook.md`](./deployment-runbook.md) §28) |
| `NEXT_PUBLIC_API_URL` | **Leave unset** for the same-origin proxy topology — the dashboard talks to its own origin, not directly to the API (`deployment-runbook.md` §28c) |
| `NODE_ENV` | Optional | may be `production`; note that `typescript`/`@types/*` live in `dependencies` (not `devDependencies`) in `apps/dashboard/package.json` specifically so `next build` still works when Render's `NODE_ENV=production` skips devDependencies (`deployment-runbook.md` §28f) |

Not corroborated in the repo and therefore **not listed above**:
`PLAYWRIGHT_BROWSERS_PATH` is a Dockerfile `ENV`, not a Render-panel
variable — it's pinned in `apps/api/Dockerfile` itself, nothing to set
manually per deploy.

---

## 4. Known limitations for a demo

- **Central gallery is live, but view/download-only.** The Product Gallery
  at `/outputs` (nav "📦 Çıktı Geçmişi", also reached via the "Çıktı
  Galerisi" buttons) aggregates every client's rendered outputs, and each
  client hub carries a "Son Çıktılar" strip. It only previews and
  downloads — approve/reject stays on the brief side. (Was previously "no
  central gallery"; that is no longer true — see `outputs/page.tsx` and
  `components/client-recent-outputs.tsx`.)
- **Mixed TR/EN UI labels** (e.g. status badges) — cosmetic, not a
  functional bug.
- Real image generation requires `KIE_AI_API_KEY` + `KIE_AI_BASE_URL`; the
  fake-provider path (§1) never exercises the real KIE round trip.
- `RENDER_QUEUE_ENABLED=false` means renders run synchronously and block
  the HTTP request — fine for a small demo, not representative of the
  queued production path.

For the full friction list (UI rough edges observed during a real-provider
walkthrough) and the exact failure-path behaviors, see
**[`manual-demo-pass.md`](./manual-demo-pass.md)** — not restated here.

---

## Authoritative docs

| Doc | What it covers |
|---|---|
| [`demo-rehearsal-checklist.md`](./demo-rehearsal-checklist.md) | One-page "before you speak" rehearsal checklist — login, first client, the 6 clicks, success signals, do-not-touch list. |
| [`demo-sales-script.md`](./demo-sales-script.md) | 30-second elevator + word-for-word 3-4 min walkthrough script. |
| [`mvp-demo-flow.md`](./mvp-demo-flow.md) | Full local fake-provider runbook + 12-step dashboard walkthrough. |
| [`manual-demo-pass.md`](./manual-demo-pass.md) | Real-provider walkthrough, failure paths, UI-friction list. |
| [`ci-stable-profile.md`](./ci-stable-profile.md) | `smoke:staging` semantics (WARN vs FAIL) and its role as a CI merge gate. |
| [`deployment-runbook.md`](./deployment-runbook.md) | Numbered deploy runbook — topology, env profiles, migration strategy, Render setup steps. |
| [`backup-restore-runbook.md`](./backup-restore-runbook.md) | Backup policy + post-restore smoke gate. |
