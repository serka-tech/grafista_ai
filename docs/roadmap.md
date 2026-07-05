# Grafista AI Studio — Roadmap

> **Last synced with code reality:** 2026-07-04, commit `dda634f` (Phase 2 Step 10R).
> If you are an agent picking up work: THIS file reflects what actually exists;
> when in doubt, trust the test suite (274 tests, `apps/api` + see
> `docs/mvp-demo-flow.md`) over any older planning language you find elsewhere.

## Production strategy (read this first)

- **Photoshop is NOT the primary production engine.** Earlier phase language
  ("PSD Generation") is obsolete.
- The primary production line is **AI-driven design + an automatic
  render/export pipeline** (HTML/CSS + Playwright — shipped in Phase 2 Steps
  9A/9B).
- Photoshop / PSD / Adobe UXP integration is an **optional professional
  finalization/handoff layer** for later — the production package's template
  contract is deliberately renderer-agnostic so such a layer can consume it
  without a format change (`docs/photoshop-automation-plan.md` is the parked
  plan; nothing from it is implemented, by design).
- The first MVP targets **social-media and digital creative exports**
  (Instagram Post/Story, Landscape, Ad Creative — PNG/JPG/PDF).
- Print/outdoor formats and PSD/Adobe integration are later, optional phases.

## Phase 1: MVP Scaffold ✅ (complete)

- [x] Monorepo scaffold (pnpm workspaces)
- [x] Shared schemas (Zod), prompt engine, model router (+ fallback routing)
- [x] Database schema (PostgreSQL + pgvector migrations)
- [x] API server (Express, routes, approval gates)
- [x] Dashboard (Next.js, dark mode UI)
- [x] Real content generation + local uploads
- [x] Sample data (Flavora Organic client)
- [x] Documentation (architecture, workflows, security)

## Phase 2: Real Pipeline — AI Design → Render/Export ✅ (steps 1–10 complete)

- [x] PostgreSQL persistence (real repositories, migrations 001–020)
- [x] Auth/RBAC (session auth, roles OWNER/CREATIVE_DIRECTOR/DESIGNER/CONTENT_MANAGER, `resource:action` permissions, route + domain-level double guards)
- [x] Async route hardening + approval fix
- [x] S3-compatible storage abstraction + MinIO verification (local/S3, authenticated file routes only)
- [x] Real DesignDNA vision analysis (OpenAI, per-reference style analysis + synthesis)
- [x] Layout Generation (2–3 alternatives per approved brief) — `8e2b38e`
- [x] Creative QA (scored reports, pass/approve gate) — `38498c4`
- [x] Workflow Engine + Skill Loader (persistent runs, 10 definitions) — `580cf95`
- [x] Visual Generation (QA-gated, storage-backed) — `16a9778` + file-access hotfix `17cb403`
- [x] Production Job + Template Contract + Package Builder — `34c03b2`
- [x] Production Job Review Lifecycle (approve/reject + audit trail) — `ded3afc`
- [x] Render-ready Production Package / Handoff (manifest v2, renderer-agnostic) — `2ae8b51`
- [x] Template Render Engine planning (decision: HTML/CSS + Playwright; read-only step, no commit)
- [x] HTML/CSS + Playwright Template Render Engine MVP (PNG/JPG/PDF, fake adapter for tests) — `6a452d8`
- [x] Persisted render history + dashboard hydration — `0fb36ff`
- [x] Render Quality QA + Export Preset Polish (structured warnings w/ severity, preset/format validation) — `bb3437d`
- [x] MVP Demo Flow Hardening (fake AI provider, `db:seed-demo`, keyless E2E `demo-flow.test.ts`, runbook `docs/mvp-demo-flow.md`) — `f12bdcf` + `6bcf223` + `dda634f`

Deliberately NOT done in Phase 2 (moved out of this phase's old wording):
- Photoshop UXP plugin / PSD generation → optional later layer (see strategy above)
- Gemini/Higgsfield adapters remain placeholders; Kie AI adapter is real but
  a live-key end-to-end run is still pending (see Step 12 below)

## Next steps (proposed order after Step 10)

### Phase 2 Step 11 — Release Readiness + Local Deployment Checklist ✅ (complete)
- `docs/release-readiness.md` — env checklist, service list, local startup
  checklist, fake/real provider modes, Playwright runtime check, test
  stability notes, and the release go/no-go checklist
- root scripts added: `pnpm run test:stable` (deterministic
  `--maxWorkers=2` invocation) and `pnpm run check:release` (wraps
  typecheck/lint/test:stable/build — no new tooling, no CI system)
- `.env.example` reviewed — already covered every env var actually read by
  the code, no additions needed

### Phase 2 Step 12 — Real Provider Smoke Test ✅ (complete)
- dedicated probe added: `pnpm --filter @grafista/api run smoke:providers`
  (`apps/api/src/scripts/smoke-real-providers.ts` — sections: storage,
  openai, kie, render; prints PASS/SKIP/FAIL, never logs secrets)
- live results (2026-07-05): storage PASS, OpenAI PASS (real `gpt-4o`
  completion), KIE PASS (1 real image via `nano-banana-2`, bytes stored +
  verified), Playwright render PASS (real Chromium PNG)
- migrations 019–020 applied to the manual DB; API boots against it,
  `/api/health` 200, protected routes return structured 401
- finding: Kie rejects the adapter's built-in default model
  `gpt-image-1.5` (422) — `KIE_AI_IMAGE_MODEL=nano-banana-2` env override
  required; default-model hotfix left as a separate follow-up
  (see `docs/release-readiness.md` §6/§9)
- S3 smoke skipped (`STORAGE_PROVIDER=local`, S3 env empty); full
  dashboard-driven real chain belongs to Step 13's manual pass

### Phase 2 Step 13 — Dashboard Manual Demo Pass ✅ (complete, 1 open hotfix)
- full 12-step walkthrough on the real local stack (real Postgres, real
  OpenAI, real Playwright renderer) driven through a real browser —
  results, failure-path checks and the UI friction list live in
  `docs/manual-demo-pass.md`
- 11/12 steps PASS; step 8 (real KIE image) FAILS on a real bug:
  `visual-generation.ts` sends the aspect ratio as raw pixels
  (`1080:1080`) where Kie expects normalized (`1:1`) → **open Step 13
  hotfix** (GCD-normalize + regression test), steps 9–12 were validated
  with a synthetic generated output meanwhile
- runbook credential fix: seed-admin examples now use `demo@grafista.local`
  (`demo@local` passes seeding but fails the login endpoint's email
  validation)
- all five failure/gate paths verified live (409/403/401 with actionable
  messages); UX polish list (10 items, F1–F10) recorded — no UI changes made

### Phase 3 — Productization
- [ ] Revision history & version control
- [ ] Analytics dashboard (approval rates, generation stats)
- [ ] Customer/project cost tracking
- [ ] Client isolation hardening (move past the global-permission MVP model)
- [ ] Render queue/worker (async renders; synchronous today by design)
- [ ] Optional Photoshop/PSD handoff adapter (consumes the existing template contract)
- [ ] Deployment & monitoring
- Other earlier Phase-3 candidates (kept as backlog, not committed): real-time
  approval notifications, A/B content suggestions, campaign calendar, Figma
  plugin, template library, multi-user collaboration polish

## Phase 4: Scale & Intelligence (unchanged backlog)

- [ ] Vector similarity search (pgvector)
- [ ] Cross-client style learning
- [ ] Automated QA with computer vision
- [ ] Brand consistency scoring
- [ ] Competitor analysis integration
- [ ] Multi-language content generation
- [ ] Video content generation (KIE AI / Higgsfield)
- [ ] API for external integrations
- [ ] White-label deployment
- [ ] Mobile app (React Native)

## Known technical debt (accepted at MVP level — do not "fix" casually)

- **Cross-client isolation** is limited by the global permission model
  (single-team assumption; every read/write is permission-gated but not
  client-scoped). Hardening is a Phase 3 item.
- **Render history endpoint N+1 query** (one artifact query per render job)
  — accepted at MVP scale, documented in the route.
- **Text overflow / safe area QA are heuristics** (average glyph width, AABB
  intersection) — they surface risk, not typographic ground truth.
- **Test suite load sensitivity**: 17 files share one embedded Postgres; the
  deterministic invocation is `cd apps/api && npx vitest run --maxWorkers=2`.
  A flaked file passing in isolation is the known signature, not a product bug.
  (Related fix already landed: `dist/` build artifacts are excluded from test
  collection since `dda634f` — suite totals are real now: 274 unique tests.)
- **Real-provider live smoke has not been run yet** (fake provider covers the
  chain; Step 12 closes this).
- **Dashboard manual demo requires the full local dev stack** (Step 13); the
  automated twin (`demo-flow.test.ts`) covers the API chain only.
- **Photoshop/Adobe/PSD integration is deliberately out of scope** — see the
  strategy section; do not open it as a side effect of another step.
