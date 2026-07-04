# Grafista AI Studio — MVP Demo Flow Runbook

How to run the full MVP pipeline (client → DesignDNA → layout → Creative QA →
visual generation → production package → review → render/export) on a local
machine — with or without real AI provider keys.

The executable twin of this document is
`apps/api/src/__tests__/demo-flow.test.ts`, which walks the exact same chain
against the keyless configuration on every test run.

## Prerequisites

- Node 20+, pnpm 9 (`corepack enable` or `npx pnpm@9.1.0`)
- A local PostgreSQL 14+ database (any empty DB; pgvector optional — the
  migration runner skips `002_pgvector.sql` with a warning when the extension
  is unavailable)
- `pnpm install` at the repo root

## Required environment (`apps/api/.env`)

Copy `.env.example` and fill at minimum:

| Variable | Demo value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/grafista` | must exist |
| `AUTH_SECRET` | any string ≥ 16 chars | session signing |
| `API_PORT` | `4000` | dashboard default expects 4000 |
| `OPENAI_API_KEY` | `sk-demo-not-real` | must be NON-EMPTY at boot, dummy is fine in demo mode |
| `ANTHROPIC_API_KEY` | `sk-ant-demo-not-real` | same — presence only |
| `AI_DEFAULT_PROVIDER` | `fake` | THE demo switch (see below) |
| `STORAGE_PROVIDER` | `local` (default) | files land under `apps/api/uploads/` |
| `RENDERER_PROVIDER` | `fake` or unset | see "Renderer" below |

## Demo mode — fake AI provider (no keys, no network)

`AI_DEFAULT_PROVIDER=fake` routes EVERY AI call (DesignDNA style analysis +
synthesis, content ideation, layout generation, Creative QA, visual
generation) to the deterministic `FakeAIAdapter`
(`packages/model-router/src/providers/fake.ts`):

- Schema-valid canned responses for all six task types; zero network, zero cost.
- Creative QA returns a PASSING report (score 88) so the pipeline can proceed
  without a human QA override.
- Visual generation returns two real 64×64 PNGs, so previews/downloads work.
- Production behavior is untouched unless this switch is set — the adapter
  reports itself unavailable in every other configuration.

**With real keys instead:** set `AI_DEFAULT_PROVIDER=openai` +
`OPENAI_API_KEY` (text/vision tasks), and `KIE_AI_API_KEY`/`KIE_AI_BASE_URL`
(image generation — the only adapter with that capability today). If Kie is
not configured, visual generation fails with a clear
"provider configuration" error and the generated-output row is persisted as
`failed` — nothing crashes, see `docs/model-routing.md`.

## Renderer

- `RENDERER_PROVIDER=fake` — deterministic buffers with correct magic bytes;
  fully offline, no Chromium needed. Downloads "work" but are not real images.
- unset / `playwright` (default) — real PNG/JPG/PDF exports. One-time setup:
  `cd apps/api && npx playwright install chromium`.

## Database setup + seed

```bash
pnpm --filter @grafista/api run db:migrate     # 001..020
pnpm --filter @grafista/api run db:seed        # roles/permissions + Flavora sample client
ADMIN_EMAIL=demo@local ADMIN_PASSWORD='Demo1234!' \
  pnpm --filter @grafista/api run db:seed-admin   # your login user (OWNER)
pnpm --filter @grafista/api run db:seed-demo   # 2 design references WITH real image bytes
```

`db:seed-demo` is idempotent (re-runs don't duplicate) and requires `db:seed`
to have run first. It exists because the base sample data ships metadata-only
references — DesignDNA analysis needs actual image bytes in storage.

## Start the stack

```bash
pnpm run dev:api        # http://localhost:4000
pnpm run dev:dashboard  # http://localhost:3000
```

## Verifying the flow (tests)

The executable twin of this runbook — `apps/api/src/__tests__/demo-flow.test.ts`
— walks the whole chain below (happy path + the four demo failure paths)
against the keyless configuration on every run:

```bash
cd apps/api && npx vitest run src/__tests__/demo-flow.test.ts   # demo chain only
cd apps/api && npx vitest run --maxWorkers=2                    # full API suite (deterministic invocation)
```

Root-level equivalents: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`,
`pnpm run build` (`npx pnpm@9.1.0 run ...` when pnpm is not on PATH).

## Demo flow (dashboard, in order)

1. **Login** (`/login`) with the `db:seed-admin` credentials.
2. **Client** — use the seeded "Flavora" client, or create a new one on `/`
   (a new client needs a design reference uploaded at
   `/clients/[id]/references` before step 3).
3. **DesignDNA** — `/clients/[id]/design-dna` → "Analiz Et" → then approve.
4. **Content idea** — `/clients/[id]/content` → generate → approve one idea.
5. **Design brief** — create from the approved idea → approve on `/briefs/[id]`.
6. **Layout generation** — on the brief page → produces 2–3 alternatives at
   `/briefs/[id]/layout-plans` → approve one plan.
7. **Creative QA** — run on the approved plan; a `passed` (or human-approved)
   report opens the visual-generation gate.
8. **Visual generation** — "Yeni Alternatif Üret" on the same page; outputs
   appear with previews. Optionally approve the best one.
9. **Production package** — "🏭 Üretime Gönder" on a generated output →
   status `package_ready`, "Paketi İndir" serves the manifest JSON.
10. **Production review** — approve (or reject with a reason) the package.
11. **Render/export** — pick a preset + format → "🎨 Render / Export Oluştur".
    Presets: Instagram Post/Story (png, jpg), Landscape & Ad Creative
    (png, jpg, pdf). Render warnings ("Render uyarıları") appear under the
    result; history survives page reloads.
12. **Download** — per-artifact "⬇ PNG/JPG/PDF İndir" links (authenticated
    API routes — no raw storage URLs anywhere).

Every stage shows a "Sıradaki adım: …" hint, and every gate failure surfaces
the backend's actionable message.

## Known limitations

- Fake provider outputs are canned — every run produces the same layouts,
  ideas, and visuals. That's the point (deterministic demos), not a bug.
- Instagram presets deliberately reject PDF (400); PDF is for
  landscape/ad_creative only.
- Render history endpoint does an N+1 artifact query — fine at MVP scale.
- Access control is permission-based, not client-scoped (single-team
  assumption; documented technical debt since Step 8A).
- The API test suite shares one embedded Postgres; on a loaded machine the
  full parallel run can flake one random test with a timeout/socket signature
  — `cd apps/api && npx vitest run --maxWorkers=2` is the deterministic
  invocation, and any flaked file passes in isolation (known load
  sensitivity, not a product bug).
- Dashboard-side manual verification of this flow requires the full local dev
  stack (a real Postgres + `pnpm run dev:api` + `pnpm run dev:dashboard`) —
  the automated twin covers the API chain only.

## Out of scope (deliberate)

**No real Photoshop / Adobe / PSD rendering exists anywhere in this
codebase.** The render engine is HTML/CSS + Playwright (Step 9A/9B); the
production package's template contract is renderer-agnostic so a future
Photoshop-based finalization layer could consume it
(`docs/photoshop-automation-plan.md`), but that layer is optional and
unimplemented. Likewise out of scope: render queues/workers, billing, social
publishing, multi-tenant isolation.

## Related docs

- `docs/architecture.md` — system overview
- `docs/model-routing.md` — provider matrix and routing rules
- `docs/photoshop-automation-plan.md` — future optional Photoshop layer (plan only)
- `docs/workflows.md` — workflow engine (parallel path, not required for this demo)
