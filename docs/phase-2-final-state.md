# Grafista AI Studio — Phase 2 Final State (Closure Record)

> **Status: Phase 2 CLOSED — 2026-07-05, branch `phase-2-checkpoint`, HEAD
> `a8e5949`.** This document is the closure record: what was built, what was
> verified, what was deliberately left out, and what debt is carried into
> Phase 3. It is documentation only — no code changed as part of this record.
>
> Sources of truth this document summarizes (read those for detail):
> - [`docs/roadmap.md`](./roadmap.md) — the commit-hashed step-by-step record
> - [`docs/release-readiness.md`](./release-readiness.md) — env/service checklist + debt
> - [`docs/manual-demo-pass.md`](./manual-demo-pass.md) — Step 13 + Step 13R demo records (F1–F10, N1)
> - [`docs/mvp-demo-flow.md`](./mvp-demo-flow.md) — the demo runbook
> - [`docs/phase-3-productization-roadmap.md`](./phase-3-productization-roadmap.md) — what comes next

## 1. Completed capabilities

Each item lists the Phase 2 step and commit(s) as recorded in
[`docs/roadmap.md`](./roadmap.md) and `git log`.

| Capability | Step / commit | Summary |
|---|---|---|
| PostgreSQL persistence | Step 1 — `21068b8` | In-memory store replaced with real repositories + migrations (001–020 by end of phase). |
| Auth/RBAC | Step 2 — `ac60d7d` + hotfix `23e8b63` | Session auth; roles OWNER/CREATIVE_DIRECTOR/DESIGNER/CONTENT_MANAGER; `resource:action` permissions with route + domain double guards. |
| S3/local storage abstraction | Step 3 — `efe89b4` | S3-compatible adapter (MinIO-verified) with `STORAGE_PROVIDER=local` default; authenticated file routes only. |
| DesignDNA | Step 4 — `2701e9a` | Real OpenAI vision analysis per reference + style synthesis, versioned with approval flow. |
| Layout generation | Step 5A — `8e2b38e` | 2–3 layout alternatives per approved brief, schema-validated LLM output. |
| Creative QA | Step 5B — `38498c4` | Scored QA reports (11 sub-scores) with pass/approve gate ahead of visual generation. |
| Workflow engine + skill loader | Step 6 — `580cf95` | Persistent workflow runs, 10 workflow definitions, skill loader. |
| Visual generation | Step 7 — `16a9778` + hotfix `17cb403`; KIE hotfix A `79f2e45` (aspect-ratio normalization), KIE hotfix B `667a546` (default model → `nano-banana-2`) | QA-gated real image generation through the Kie AI adapter, storage-backed outputs. Hotfix A GCD-normalizes raw pixel ratios (`1080:1080` → `1:1`); hotfix B replaces the Kie-rejected `gpt-image-1.5` default. |
| Visual output preview/file access | Step 7 hotfix — `17cb403` | Authenticated `/api/visual-outputs/:id/file` route; dashboard previews. |
| Production package builder | Step 8A — `34c03b2` | Production job + template contract + package builder. |
| Production review lifecycle | Step 8B — `ded3afc` | Approve/reject with audit trail; approved/rejected jobs immutable afterwards. |
| Render-ready handoff package (manifest v2) | Step 8C — `2ae8b51` | Renderer-agnostic handoff manifest; deliberately consumable by a future PSD layer without format change. |
| HTML/CSS + Playwright render engine | Step 9A — `6a452d8` | Template render engine MVP: PNG/JPG/PDF via real Chromium, fake adapter for tests. |
| Render history hydration | Step 9A hotfix — `0fb36ff` | Persisted render history, dashboard hydration. |
| Render quality warnings | Step 9B — `bb3437d` | Structured render warnings with severity + preset/format validation. |
| MVP demo flow hardening | Step 10 — `f12bdcf` + `6bcf223` + `dda634f` | Fake AI provider, `db:seed-demo`, keyless E2E `demo-flow.test.ts`, runbook [`docs/mvp-demo-flow.md`](./mvp-demo-flow.md). |
| Release readiness | Step 11 — `bb8ce58` | [`docs/release-readiness.md`](./release-readiness.md): env checklist, `test:stable` + `check:release` root scripts. |
| Real provider smoke | Step 12 — `ad1a280` | `smoke:providers` probe: storage/OpenAI/KIE/render sections, PASS/SKIP/FAIL, no secrets logged. |
| Dashboard manual demo pass | Step 13 — `a609f61` (11/12) → Step 13R — `a8e5949` (**12/12**, real OpenAI + real KIE) | Full 12-step browser-driven walkthrough on the real local stack; failure paths verified; F1–F10 friction list + N1 observation recorded in [`docs/manual-demo-pass.md`](./manual-demo-pass.md). |

## 2. Final verifications (all as of 2026-07-05)

- **298/298 tests PASS** (`apps/api`, deterministic invocation `pnpm run
  test:stable`; includes the KIE hotfix regression suites
  `kie-aspect-ratio.test.ts` and `kie-default-model.test.ts`).
- **typecheck / lint / build clean** at the repo root.
- **Real OpenAI smoke PASS** (`smoke:providers openai` — live `gpt-4o` completion).
- **Real KIE smoke PASS** — after hotfix A (aspect ratio) + hotfix B (default
  model); the smoke deliberately sends raw `1080:1080` and the adapter
  normalizes to `1:1`.
- **Real KIE visual generation through the dashboard PASS** — Step 13R step 7:
  output `generated`, `nano-banana-2`, 2048×2048 image served and rendered.
- **Artifact download PASS** — real 1080×1080 PNG over the authenticated file
  route; the same URL unauthenticated returns 401.
- **12/12 dashboard manual demo PASS** (Step 13R) — plus all five
  failure/gate paths live-verified (409/403/401 with actionable messages).

## 3. Deliberately out of scope (conscious Phase 2 decisions)

These were NOT built in Phase 2, on purpose — none of them is a gap
discovered late:

- **Photoshop/Adobe/PSD rendering** — PARKED as an optional future
  finalization/handoff layer ([`docs/photoshop-automation-plan.md`](./photoshop-automation-plan.md)).
  The primary production line is AI-driven design + the HTML/CSS + Playwright
  render/export pipeline (see "Production strategy" in [`docs/roadmap.md`](./roadmap.md)).
  No real Photoshop/Adobe/PSD rendering exists anywhere in the codebase.
- **Workflow queue/worker infrastructure** — renders and AI calls are
  synchronous by design at MVP scale; async jobs are a Phase 3 planning item.
- **Billing/payment** — no monetization surface yet.
- **Social publish** — export artifacts are downloaded, not auto-published.
- **Large multi-tenant / client-isolation redesign** — the global permission
  model (single-team assumption) was accepted knowingly; hardening is Phase 3.

## 4. Technical debt carried into Phase 3

| # | Debt | Where it was reported |
|---|---|---|
| 1 | **F8 — render does not composite the generated visual into image slots** (gray placeholder + "Görsel kaynağı eksik" warnings). Re-verified in Step 13R as *the single most visible gap* now that real generation works. | [`docs/manual-demo-pass.md`](./manual-demo-pass.md) F8 (both passes) |
| 2 | **N1 — OpenAI schema-validation 502 flake** on layout generation (rare; immediate retry succeeds; UI surfaces it cleanly, nothing half-persisted). | [`docs/manual-demo-pass.md`](./manual-demo-pass.md) observation N1 (Step 13R) |
| 3 | **F6/F7/F9/F10 (+F1–F5) — UI friction**: raw English provider error text (F6), truncated render warnings (F7), placeholder-render text overflow visibility (F9), leftover dev/test clients (F10); plus mixed QA signals (F1), English status badges (F2), draft dead-end (F3), always-enabled approve (F4), `model: none` display (F5). | [`docs/manual-demo-pass.md`](./manual-demo-pass.md) friction list F1–F10 |
| 4 | **No cross-client isolation** — global permission model, every read/write permission-gated but not client-scoped (conscious single-team MVP decision, flagged at Step 8B review-lifecycle work). | [`docs/roadmap.md`](./roadmap.md) + [`docs/release-readiness.md`](./release-readiness.md) §9 |
| 5 | **Render history endpoint N+1 query** (one artifact query per render job) — acceptable at MVP scale, documented in the route. | [`docs/roadmap.md`](./roadmap.md) / [`docs/release-readiness.md`](./release-readiness.md) §9 |
| 6 | **Text overflow / safe area QA are heuristics** (average glyph width, AABB intersection — deterministic, no AI call); they surface risk, not typographic ground truth. | [`docs/roadmap.md`](./roadmap.md) / [`docs/release-readiness.md`](./release-readiness.md) §9 |
| 7 | **Test suite load sensitivity** — parallel run over one embedded Postgres can flake 1 random test under load; `pnpm run test:stable` (`--maxWorkers=2`) is deterministic. | [`docs/release-readiness.md`](./release-readiness.md) §8 |
| 8 | **Optional Photoshop/PSD handoff** stays PARKED — not the render engine, only a possible later adapter over the existing manifest v2 contract. | [`docs/photoshop-automation-plan.md`](./photoshop-automation-plan.md) |

## 5. Phase 2 closure criteria

- [x] Full MVP chain (client → DesignDNA → idea → brief → layout → QA →
      visual → production package → review → render/export → download)
      works end-to-end — keyless fake mode (`demo-flow.test.ts`) **and** the
      real-provider dashboard walkthrough (Step 13R, 12/12).
- [x] Real provider integrations verified live: OpenAI (text/vision), KIE
      (image, after hotfixes A+B), local storage, Playwright render.
- [x] Auth/RBAC enforced on every route incl. file access (401/403 verified live).
- [x] All approval/QA/review gates return actionable 409/400 messages
      (five failure paths verified live in Step 13/13R).
- [x] Test suite green: 298/298 via the deterministic invocation;
      typecheck/lint/build clean.
- [x] Release/runbook documentation exists and matches reality
      ([`docs/release-readiness.md`](./release-readiness.md), [`docs/mvp-demo-flow.md`](./mvp-demo-flow.md)).
- [x] Known debt is written down with owners-in-Phase-3 (this document §4).
- [x] No Photoshop/Adobe/PSD dependency anywhere in the demo path.
- [ ] *(Explicitly deferred, not a Phase 2 failure)* Generated visual
      composited into the final render (F8), client isolation, async render
      queue — these define Phase 3, see
      [`docs/phase-3-productization-roadmap.md`](./phase-3-productization-roadmap.md).

**Verdict: Phase 2 is closed.** Every criterion the phase set for itself is
met; the deferred line items were consciously scoped out and are the opening
items of Phase 3.
