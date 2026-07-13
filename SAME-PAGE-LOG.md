# Same Page Meeting — M3 Phase 3 (grafista-api-prod provisioning)

Plan file: `docs/production-provisioning-guide.md`
Core Focus: stand up `grafista-api-prod` (Docker, branch `go-live/m2-hardening`) so one
customer (Turyap) can create real-estate listing cards in production — real Playwright
render + R2 storage, AI provider = fake — with migrations that apply cleanly on first
go-live and the service passing its health check on first deploy.
Model: Codex CLI default. Thread: 019f57a1-d23d-7801-a659-80fc9439a708.

## Round 1
### Integrator findings (Codex, verbatim)
- [FIX] `/api/health/ready` cannot report every check `ok` under the Phase 3 matrix because `checkProviders()` marks the absent optional `KIE_AI_API_KEY` as `degraded` even when `AI_DEFAULT_PROVIDER=fake` -> Make provider readiness conditional on the selected provider, or change the Phase 5 success criterion to allow this known degradation.
- [FIX] `/api/health/ready` reports S3 `ok` from variable presence alone and never contacts R2, so its `200` can pass with a wrong endpoint, bucket, credentials, or permissions -> Run `smoke-real-providers` or an explicit R2 put/get/delete probe before claiming storage readiness.
- [FIX] `/api/health/ready` only imports Playwright and never launches Chromium, so its `200` can pass when the browser executable or runtime dependencies are broken -> Run `check:chromium` or a minimal real render before claiming renderer readiness.
- [FIX] The guide calls `/api/health/ready` the "real readiness probe," but it returns `200` for `degraded` and does not verify either critical external production dependency end-to-end -> Describe it as configuration/dependency diagnostics and make the live R2 plus Playwright smoke the actual readiness gate.
- [FIX] The server ignores Render's canonical `PORT` variable and listens only on `API_PORT`, creating two sources of truth that can drift despite Render recommending binding the public server to `PORT` -> Change startup to use `PORT` with `API_PORT` as fallback, or remove `PORT` from the matrix and explicitly retain the custom-port dependency.
- [KILL] `API_HOST=0.0.0.0` is unused because `app.listen(PORT)` receives no host argument -> Remove it from the Phase 3 matrix; Node's unspecified-host binding already exposes the listener appropriately.
- [KILL] `API_CORS_ORIGIN` does not serve the guided production path because browser traffic is same-origin through the dashboard's `API_PROXY_TARGET` rewrite -> Remove Phase 4 step 6 unless direct browser-to-API access is intentionally supported.
- [FIX] "Two migration methods, both fine" hides materially different ordering: Shell is available only after a successful paid-service deploy, whereas Pre-Deploy runs before activation on a separate instance and is the simpler durable schema gate -> State the paid-instance prerequisite and choose one explicit sequence; for this empty-DB first go-live, first liveness deploy followed by Shell migration is coherent.
- [FIX] The documented `pnpm run db:migrate` fallback is not equivalent operationally and is unnecessary because it depends on shipped development tooling and source files -> Remove the fallback and treat absence or failure of `node dist/scripts/db-migrate.js` as a broken image.
- [FIX] The migration runner marks any migration producing the matched "vector extension unavailable" error as applied, rather than restricting best-effort behavior specifically to `002_pgvector.sql` -> Gate the skip logic on `file === '002_pgvector.sql'` so an unrelated future migration cannot be silently recorded as complete.
- [FIX] First-deploy green proves only process boot and static liveness—not database linkage, migrations, R2, authentication, proxying, or rendering—so it is an insufficient go-live success signal -> Keep green as the Phase 3 bootstrap signal, but require migration completion, authenticated dashboard proxy smoke, and byte-verified live listing-card E2E before declaring go-live.
- [DEFER] `TRUST_PROXY=1` is reasonable for the current single Render proxy path and rate limiter, but numeric hop trust becomes unsafe if another proxy or CDN is later inserted -> Move proxy-topology revalidation to the Issues List before adding Cloudflare proxying or another ingress layer.
- [FIX] The migration/image-path claim itself is sound: TypeScript emits `dist/scripts/db-migrate.js`, `/repo/apps/api/dist/db/migrate.js` resolves four levels up to `/repo/database/migrations`, `.dockerignore` does not exclude `database/`, and the runtime copies `/repo` with readable ownership -> Replace speculative "falls back if needed" wording with an image-build assertion that both the compiled runner and SQL directory must exist.

VERDICT: NOT YET

### Visionary response (Fable) — all findings verified against the code myself first
- ACCEPTED (health readiness semantics; findings 1-4): verified `checkProviders` (health.ts:180) marks absent KIE as `degraded`; `checkStorage` s3 branch is env-presence-only (health.ts:82, no network call); `checkPlaywright` (health.ts:202) only `import('playwright')`, no Chromium launch; `/health/ready` returns 200 for `degraded` (health.ts:241, only `error`→503). -> Guide reworded: `/api/health/ready` = config/dependency diagnostics; the **live listing-card E2E** (real R2 put + real Chromium render) is the actual readiness gate. Phase 5 smoke now expects `200 + status:degraded` and asserts `database/storage/playwright = ok`, `providers:degraded` accepted (KIE absent by design).
- ACCEPTED (finding 6, KILL API_HOST): verified `grep API_HOST apps/api/src` returns nothing; `index.ts:21` calls `app.listen(PORT)` with no host arg. -> Removed `API_HOST` from the Phase 3 matrix.
- ACCEPTED (finding 7, KILL API_CORS_ORIGIN): verified only use is `cors({origin: process.env.API_CORS_ORIGIN ?? 'http://localhost:3000'})` (app.ts:63); CORS is browser-enforced and the dashboard reaches the API via a server-side BFF proxy (same-origin), so no cross-origin browser call exists. -> Marked optional/not-needed for the BFF path; removed it as a required post-Phase-4 step.
- ACCEPTED (findings 8, 9, 13, migration mechanism): -> Guide now states ONE sequence (first liveness deploy → Render Shell `node dist/scripts/db-migrate.js` over Internal DATABASE_URL); dropped the tsx fallback; asserts the compiled runner AND `database/migrations/` must exist in the image (both verified present).
- ACCEPTED (finding 11, go-live gate): -> Made explicit that go-live is declared only after migrations complete + authenticated dashboard proxy smoke + byte-verified live E2E; first green is only the bootstrap signal.
- DEFERRED (finding 5, PORT/API_PORT): real latent footgun, but both are pinned to 4000 in the matrix and the API_PORT bind is proven on staging Docker; changing a proven boot path mid-go-live is out of scope. -> ISSUES.md + guide note "PORT and API_PORT MUST stay equal".
- DEFERRED (finding 10, vector-skip gate): cannot misfire here (only 002 uses vector; Render PG18 ships pgvector so 002 will apply, not skip); code change to a proven migration runner is out of scope for standing up the service. -> ISSUES.md.
- DEFERRED (finding 12, TRUST_PROXY future): -> ISSUES.md (revalidate proxy topology before adding a CDN/second proxy).

## Round 2 (resume, read-only)
### Integrator findings (Codex, verbatim)
- [FIX] Phase 5 says `database:ok` proves migration, but the readiness check executes only `SELECT 1` and proves connectivity—not schema state -> Say migration success is proven by the runner reaching 026 and the idempotent rerun; `database:ok` proves only DB connectivity.

All prior findings are otherwise addressed, and the three stated deferrals are correctly documented and bounded for this go-live.

VERDICT: SAME PAGE
### Visionary response (Fable)
- ACCEPTED: `database:ok` = connectivity only -> Phase 5 reworded: `database:ok` proves DB connectivity + Internal link (runs `SELECT 1`, not a schema check); migration success is proven by the runner reaching `[migrate] applied 026` + the idempotent re-run.
- Meeting closed at SAME PAGE after 2 rounds (cap was 5). Plan is frozen; proceeding to guided Phase 3 provisioning.
