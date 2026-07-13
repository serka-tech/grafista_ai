# Issues List — deferred from the M3 Phase 3 Same Page Meeting

Real findings that do NOT block standing up `grafista-api-prod`, tracked for a later
hardening pass. Each is out of scope for the go-live because it changes a proven boot /
migration path or a topology that is safe under the current single-proxy setup.

- **[med] Server binds `env.API_PORT`, not Render's canonical `PORT`** (`apps/api/src/index.ts:19`).
  Both are pinned to `4000` in the prod matrix so there is no drift today, and the
  `API_PORT` bind is proven on staging Docker. Footgun: if someone later removes
  `API_PORT` (thinking `PORT` is canonical) the app crashes at boot (`env.ts` requires
  `API_PORT`). Fix later: `const PORT = process.env.PORT ? Number(process.env.PORT) : env.API_PORT`
  and drop `PORT` from the matrix, OR keep both and document the invariant. Interim
  mitigation in the guide: "PORT and API_PORT MUST stay equal."

- **[low] Migration vector-skip is not gated to `002_pgvector.sql`** (`apps/api/src/db/migrate.ts:50`).
  `isMissingExtensionError` matches by message, so any future migration that throws a
  vector-ish error would be silently recorded as applied. Cannot misfire on this go-live
  (only 002 uses `vector`; Render PG18 provides pgvector, so 002 applies normally rather
  than skipping). Fix later: gate the skip on `file === '002_pgvector.sql'`.

- **[low] `TRUST_PROXY=1` numeric hop trust** (`apps/api/src/app.ts:48`).
  Correct for the current single Render proxy hop. Revalidate before inserting a CDN or a
  second ingress layer (e.g. Cloudflare proxy) in front of the API, or `req.ip` /
  rate-limit keying can be spoofed via `X-Forwarded-For`.
