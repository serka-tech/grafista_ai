# Grafista AI Studio — Phase 3 Final State (Closure Record)

> **Follow-up:** the §6 recommendation below (Production Readiness Review
> instead of Photoshop/PSD) was carried out — see
> [`docs/production-readiness-review.md`](./production-readiness-review.md)
> for the full review and its own recommended next implementation step,
> followed by [`docs/deployment-runbook.md`](./deployment-runbook.md) for
> the step-by-step operational runbook.

> **Status: Phase 3 CLOSED — 2026-07-06, branch `phase-2-checkpoint`, HEAD
> `8c0d15d`.** This document is the closure record for Phase 3's seven
> sub-steps: what was built, what was verified, what was deliberately left
> out, and what debt is carried forward. It is documentation only — no code
> changes as part of this record. It also opens the Phase 3 Step 7 planning
> question (§6 below), mirroring how [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md)
> and [`docs/analytics-revision-history-plan.md`](./analytics-revision-history-plan.md)
> each closed with a ready-to-hand-off prompt for their own next step.
>
> Sources of truth this document summarizes (read those for full detail):
> - [`docs/phase-3-productization-roadmap.md`](./phase-3-productization-roadmap.md) — the original Step 1–7 scope + prioritization
> - [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md) — Step 5 plan + Step 5A delivery note
> - [`docs/analytics-revision-history-plan.md`](./analytics-revision-history-plan.md) — Step 6A plan + delivery note
> - [`docs/revision-history-plan.md`](./revision-history-plan.md) — Step 6B plan + delivery note
> - [`docs/phase-2-final-state.md`](./phase-2-final-state.md) — the closure record Phase 3 continues from
> - [`docs/roadmap.md`](./roadmap.md), [`docs/release-readiness.md`](./release-readiness.md) — ongoing debt registers
> - [`docs/photoshop-automation-plan.md`](./photoshop-automation-plan.md) — the PARKED plan Step 7 planning (§6) evaluates

---

## 1. Completed Phase 3 capabilities

| Capability | Step / commit | Summary |
|---|---|---|
| Render Composition Polish | Step 1 — `f41c9f0` | `render-engine.ts` now composites the approved/generated visual into the layout's primary image slot via a new `apps/api/src/render/visual-composition.ts` module (deterministic slot selection, base64 data-URI embed through the storage abstraction). Structured warnings (`selected_visual_loaded`, `selected_visual_missing`, `selected_visual_storage_missing`, `selected_visual_aspect_mismatch`, `image_slot_missing`, `image_slot_unmapped`) replace silent placeholder behavior; when a source visual is missing/unreadable the pre-existing placeholder+warning fallback is preserved unchanged, so compositing never fails a render. Closed F8 — Phase 2's single most visible gap (real generated visuals were previewed but never appeared in the final exported artifact). Remaining constraints: only one primary image slot is filled per layout (extra slots stay placeholder with `image_slot_unmapped`), and there is no focal-point cropping (only predictable `object-fit` cropping). |
| Dashboard UX Polish | Step 2 — `8c1b3c3` | Closed the F1–F7 + F10 friction list recorded in the Phase 2 Step 13R manual demo pass: visible Turkish explanations on gated buttons (F1), Turkish status/type labels (F2), an action added to the draft dead-end (F3), the approve button disabled once already approved (F4), the `model: none` display fixed (F5), classified provider errors given short Turkish summaries with raw-text collapse (F6), render warnings made fully readable via wrap/expand (F7), and dev/test client clutter addressed (F10). No product-value change — purely legibility and friction removal ahead of the next demo. |
| Provider Robustness + Retry | Step 3 — `fd046c6` | Added a classified retry policy (auth / rate-limit / validation / transient) so a schema-validation failure from the LLM gets one automatic in-service retry before surfacing as a 502 — directly resolving Phase 2's N1 observation (rare OpenAI layout-generation 502 flake). Also introduced the shared "friendly error" Turkish dictionary that Step 2's F6 work and later steps (analytics, revision history) all reuse. |
| Client Isolation Hardening | Step 4 — `804fdfd` | Added `client_members` (`021_client_members.sql`, additive/opt-in) and the `assertClientAccessible(userId, clientId)` guard, applied at both route level (production-jobs, render-jobs, export-artifacts, visual-outputs, layout-plans, creative-qa, design-dna) and service level, matching Phase 2's double-guard pattern. Users with zero membership rows stay unrestricted (no existing/seed user's access changed); users with ≥1 row are scoped to those clients. Cross-client access returns 404, never 403, preserving the existing "not found" convention and leaking no information. Regression coverage: `client-isolation.test.ts` proves cross-client 404 across every guarded route with two independent client pipelines. Deliberately out of scope: full tenant/organization model, billing, and any self-service UI to manage `client_members` rows (today only reachable via code/migration). |
| Render Queue / Worker Planning | Step 5 (planning) — `dedef59` | Docs-only step: [`docs/render-queue-worker-plan.md`](./render-queue-worker-plan.md) analyzed the fully-synchronous render/AI call path, ran a queue-technology decision matrix (in-process runner vs. Postgres-backed table vs. BullMQ/Redis vs. Temporal vs. cloud task queue), and recommended a **Postgres-backed job table + in-process polling worker** — no new external dependency (no Redis/BullMQ/Temporal), because `pg` and the embedded-Postgres test convention already exist and fully cover the need. Included a `RenderJob` model-gap analysis, a full worker lifecycle (`pending → queued → rendering → rendered/failed/cancelled`, plus a stale-lock-recovery sweep), an API/dashboard/RBAC/test plan, and a ready Step 5A implementation prompt. |
| Postgres-backed Render Queue Worker | Step 5A — `98f367e` | Implemented the Step 5 plan: additive migration `022_render_jobs_queue.sql` (`queued_at`, `started_at`, `finished_at`, `attempt_count`, `max_attempts`, `next_run_at`, `locked_by`, `locked_at`, `cancellation_requested`), a `'queued'` status added to the existing enum, and a new in-process polling worker (`apps/api/src/services/render-worker.ts`) that claims jobs with `SELECT ... FOR UPDATE SKIP LOCKED`. `POST /production-jobs/:id/render` now returns 202 + a pending job instead of a synchronous render result (default OFF via `RENDER_QUEUE_ENABLED`, backward-compatible); `POST /render-jobs/:id/cancel` was added. Job-level retry is scoped strictly to failure classes the provider/schema retry layers never see (storage/Playwright/non-AI I/O errors), never double-retrying the same failure across layers. Dashboard: `visual-outputs-panel.tsx` gained minimal polling (2–3s interval, stops at terminal status) plus "Sırada…"/"Render Alınıyor…"/"Tekrar Dene"/"İptal Et" states — no large UI redesign. New test file `render-queue-worker.test.ts` covers queued→running→rendered, retry success/exhausted, cancel from both `pending` and `rendering`, and client isolation, all against a deterministic fake-worker poll-tick helper (no real `setInterval` timing in tests). |
| Analytics Event Recorder MVP | Step 6A — `4e4252a` | New append-only `analytics_events` table (`023_analytics_events.sql`, `client_id NOT NULL`, `event_type` CHECK-constrained), the `analyticsEventsRepo` (`record()`/`recordBestEffort()` + `getClientSummary()`), `GET /clients/:id/analytics/summary`, and the dashboard `analytics-summary-panel.tsx`. Shipped event set — narrower than the plan's original draft, confirmed by the delivery note in [`docs/analytics-revision-history-plan.md`](./analytics-revision-history-plan.md): `creative_qa_approved`, `visual_generation_succeeded`, `visual_generation_failed`, `production_package_created`, `production_job_approved`, `production_job_rejected`, `render_job_queued`, `render_job_rendered`, `render_job_failed`, `render_job_cancelled`, `export_artifact_downloaded` (11 total; no `design_brief_created`/`design_dna_*`/`layout_*`/`creative_qa_rejected` — those gaps directly motivated Step 6B, see below). Recording is invoked from the service layer (never routes), always **best-effort** — wrapped in try/catch, failures only `console.warn`, never blocking the underlying domain operation. |
| RevisionEntry MVP | Step 6B — `8c0d15d` | New append-only `revision_entries` table (`024_revision_entries.sql`), `revisionEntriesRepo`, `GET /api/clients/:clientId/revisions/recent`, and the dashboard `revision-history-panel.tsx`. Scoped, after verifying real approve/reject/revise code paths (not the plan's original 5-entity draft), to the three entities with genuine round-trip revision cycles and today's real data loss: `design_dna` (`approved`, `needs_revision`), `layout_plan` (`approved`, `rejected`, `needs_revision`), `creative_qa_report` (`approved`, `rejected`, `needs_revision`) — 8 revision types across 6 real route call sites, wired with `recordBestEffort()` so a revision-log write never blocks the underlying approve/reject/revise HTTP response. `beforeSnapshot`/`afterSnapshot` are deliberately small, selective field subsets (`status`/`notes`/`score`/`approvedBy`/`rejectedBy`), never the full `layout_json`/`qa_json`/`design_dna` blob — a full diff engine (`diffSummary`) was deliberately dropped from scope. |

---

## 2. Final verification snapshot

- **Test count: 418/418 PASS** — this is the count last confirmed at the end
  of the Step 6B implementation session, per that session's own report; this
  docs-only closure step did **not** re-run the full suite (a fresh
  `pnpm run typecheck` was run instead, see below, to confirm the tree is
  still clean without re-paying the cost of a full test run).
- **`pnpm run typecheck` — clean**, freshly re-verified as part of this
  closure step (`apps/dashboard`, `packages/schemas`, `packages/prompt-engine`,
  `packages/model-router`, `apps/api` — all `Done`, zero errors).
- **lint / build** — reported clean at the end of the Step 6B session;
  re-verified as part of this closure step alongside typecheck.
- **`git status` at closure: clean working tree**, HEAD `8c0d15d` ("phase 3
  step 6b: add revision history mvp"), branch `phase-2-checkpoint`.
- **No real provider/render smoke test against live Photoshop/Adobe/PSD has
  ever been performed** — this is not a new gap of Phase 3, it is the same
  running caveat carried since Phase 2 (see
  [`docs/phase-2-final-state.md`](./phase-2-final-state.md), "no real
  Photoshop/Adobe/PSD rendering exists anywhere in the codebase") and
  restated at every subsequent Phase 3 step's own scope boundary (Step 1's
  status note, the roadmap's "Production strategy" section, and
  [`docs/photoshop-automation-plan.md`](./photoshop-automation-plan.md)'s
  PARKED status). It remains true at Phase 3 closure: the render engine is
  HTML/CSS + Playwright end-to-end, and no code path in this repo ever opens
  Photoshop, calls an Adobe API, or writes a `.psd` file.

---

## 3. Product capability summary (plain-language, Turkish)

Phase 3 sonunda ürün gerçekte şunu yapıyor:

- **Üretilen görseller nihai render'a gerçekten giriyor.** Phase 2'nin en
  görünür boşluğu (gri placeholder yerine gerçek görsel) kapatıldı — bir
  müşteriye giden PNG/JPG/PDF artık gerçekten üretilen AI görselini taşıyor.
- **Dashboard daha anlaşılır.** Türkçe durum/hata metinleri, netleşmiş
  gate/uyarı mesajları, stat card'lar; yeni eklenen Analytics özet paneli
  ("Üretilen Görsel", "Render Tamamlanan", "Onay Oranı", "Hata Oranı", "Son 30
  Gün Provider Hataları") ve Revizyon Geçmişi paneli ("Layout planı revizyona
  gönderildi — Ayşe K. — 'Logo çok büyük' — 5 Tem 14:20" gibi satırlar) client
  profil sayfasına eklendi.
- **Provider hataları artık daha sağlam yutuluyor.** Şema doğrulaması
  başarısız olursa kullanıcıya 502 dönmeden önce tek otomatik retry deneniyor;
  hata mesajları sınıflandırılıp Türkçe özetleniyor.
- **Client izolasyonu güçlendirildi.** İsteğe bağlı, ekleme-only bir
  `client_members` modeliyle bir kullanıcı yalnızca kendi client'larına
  erişebiliyor — mevcut hiçbir kullanıcının davranışı değişmedi (varsayılan
  hâlâ "kısıtlama yok").
- **Render kuyruğu var.** Render/export artık senkron bir HTTP isteğinde
  değil, Postgres tabanlı bir job kuyruğunda asenkron işlenebiliyor (flag ile
  açılır) — "Sırada", "Render Alınıyor", "İptal Et", "Tekrar Dene" durumları
  dashboard'da görünür, hata durumunda otomatik retry deneniyor.
- **Analitik olaylar kayıt altında.** Brief/DNA/layout/QA/görsel/production/
  render/export zincirinin büyük kısmı artık append-only bir olay tablosuna
  yazılıyor; client bazında özet ve son aktivite listesi dashboard'da.
- **Revizyon geçmişi var** — ama yalnız üç varlık için (`design_dna`,
  `layout_plan`, `creative_qa_report`): bu üçünün gerçek onay/red/revize
  döngüsü var ve bugüne kadar revizyon notları kayboluyordu; artık her
  revizyonun kim/ne zaman/neden/önce-sonra bilgisi kalıcı.

**Kısacası:** Ürün artık "AI görsel üretir, tasarımcı/ajans onaylar, sistem
gerçek görseli nihai formatta (PNG/JPG/PDF) export eder, bunu ölçülebilir ve
geçmişi izlenebilir şekilde yapar" iddiasını gerçekten yerine getiriyor —
Phase 2'nin uçtan uca zincirine üstüne "değer görünürlüğü", "dayanıklılık",
"ölçüm" ve "geçmiş" katmanları eklendi.

---

## 4. Deliberately out of scope (intentional, not accidental gaps)

Confirmed across [`docs/roadmap.md`](./roadmap.md),
[`docs/release-readiness.md`](./release-readiness.md), and every Phase 3
planning doc's own scope-boundary language — none of these were discovered
late as missing; all were scoped out on purpose:

- **Real Photoshop/Adobe/PSD rendering** — the parked, optional handoff
  layer ([`docs/photoshop-automation-plan.md`](./photoshop-automation-plan.md));
  the render engine is, and was always intended to be, HTML/CSS + Playwright.
- **Social media publish** — export artifacts are downloaded, never
  auto-published to any platform.
- **Billing/payment** — no monetization surface anywhere in the codebase;
  `estimatedCost` in analytics metadata is diagnostic, not billing (§5).
- **Large tenant/organization redesign** — Step 4 hardened client isolation
  additively, but did not build a full multi-tenant organization model,
  billing-tied seat management, or a self-service "add user to client" UI.
- **Large dashboard redesign** — every Phase 3 dashboard change (Step 2, the
  analytics panel, the revision-history panel) was explicitly scoped as
  small, additive components reusing existing CSS classes and page
  structure, never a new page/section/navigation redesign.
- **Real deployment/monitoring** — nothing in Phase 3 touched deployment
  infrastructure, uptime monitoring, alerting, or a production hosting
  target; the entire phase was built and verified against the local dev
  stack and embedded-Postgres test environment.

---

## 5. Remaining technical debt

Synthesized from each plan document's own "Riskler"/known-limitations
section — nothing here is invented; each line is traceable to a specific
doc/commit.

| # | Debt | Source |
|---|---|---|
| 1 | **Stale lock recovery for the render worker is planned but its sweep-timing mechanism is itself a small new moving part** — if a worker process crashes mid-`rendering`, a periodic sweep is supposed to reset `locked_by`/`locked_at` to NULL and requeue the job; this sweep's correctness under real crash scenarios has not been exercised outside tests. | `docs/render-queue-worker-plan.md` |
| 2 | **In-flight render cancellation is limited** — `cancellation_requested` is only observed at the next poll; if a render is already mid-flight in Playwright, that render is not actually interrupted. MVP behavior is "stop at the next checkpoint," not "cut the in-flight work." | `docs/render-queue-worker-plan.md` |
| 3 | **Test suite has documented flakiness under parallel load** — this is not hypothetical; it has been observed repeatedly during Step 5A/6A/6B implementation sessions (a file failing under full parallelism, passing cleanly in isolation and on a clean full re-run). `pnpm run test:stable` (`--maxWorkers=2`) is the working invocation; root cause has not been investigated. | Observed across Step 5A/6A/6B sessions |
| 4 | **F9/F10 status** — both are real, named items from the Phase 2 Step 13R manual demo pass (`docs/manual-demo-pass.md`): F9 = "headline overflows the canvas, white-on-light text," F10 = "leftover dev/test clients in the client list." Step 2 (Dashboard UX Polish) explicitly closed F10 and only "kısmen" (partially) F9 (`docs/phase-3-productization-roadmap.md`: "F1–F7, F9(kısmen), F10"). No Phase 3 doc records a dedicated re-verification pass confirming F9 is now fully resolved after Step 1's real compositing landed — F9 should be treated as *likely improved but not independently re-verified*, not confirmed closed. |
| 5 | **Cost tracking (`estimatedCost` in `analytics_events.metadata`) is not real billing.** It is whatever `AIResponse.usage.estimatedCost` already reports from each provider adapter — never independently validated for consistency across all adapters; adapter changes were explicitly out of scope for Step 6A. | `docs/analytics-revision-history-plan.md` |
| 6 | **`ProductionJob`/`RenderJob` revision entries are deferred/out of scope**, not an oversight — Step 6B's gap analysis found `ProductionJob` decisions terminal (already covered by `approved_by`/`rejected_by`/`rejection_reason` + analytics events) and `RenderJob` retry/cancel automatic/worker-triggered (not a human "revision" decision) — both consciously excluded. | `docs/revision-history-plan.md` |
| 7 | **No optional Photoshop/PSD handoff exists yet** — confirmed again at Phase 3 closure; `docs/photoshop-automation-plan.md` remains entirely PARKED, zero lines of it implemented. See §6 below for whether this should change next. | `docs/photoshop-automation-plan.md` |
| 8 | **`analytics_events`/`revision_entries` best-effort recording can silently no-op under a DB issue** — by design (the underlying domain operation must never depend on it succeeding), but "why is the summary/history empty" can be a real support question with only a `console.warn` as the trail. | `docs/analytics-revision-history-plan.md`, `docs/revision-history-plan.md` |
| 9 | **`design_dna.approve()` cannot recover a row already in `needs_revision`** (its `WHERE` clause only matches `'generated'`/`'waiting_for_approval'`) — a pre-existing behavior, explicitly *not* fixed by Step 6B, only tested-around; flagged as a separate future bug-fix candidate. | `docs/revision-history-plan.md` |
| 10 | **Render history N+1 query** and **client-membership self-service UI absence** carried forward unchanged from Phase 2, still not addressed in Phase 3. | `docs/phase-2-final-state.md`, `docs/phase-3-productization-roadmap.md` |

---

## 6. Phase 3 Step 7 planning — what should come next?

### 6.1 Is Photoshop/PSD genuinely ready to be Step 7, or is it premature?

The original roadmap (`docs/phase-3-productization-roadmap.md`) always listed
Step 7 as "Optional Photoshop/PSD Handoff Adapter (size: L, OPTIONAL)" — its
own lowest-priority item, with an explicit note: **"Çözdüğü borç: Yok"** (it
resolves *zero* items from the technical-debt register — confirmed verbatim
in the roadmap). Checking that claim against §5 above: correct — nothing in
the real technical-debt list (stale lock recovery, in-flight cancellation,
test flakiness, cost-tracking realism, F9 unverified, deferred revision
scope) is touched by a PSD adapter. Meanwhile, §4 confirms **no
deployment/monitoring work of any kind has happened in this entire
project** — every verification in this document (§2) is against a local dev
stack and an embedded-Postgres test harness, never a deployed environment.
That is a materially larger and more load-bearing gap than "no Photoshop
support," because it affects whether *any* of the shipped Phase 3 work
(including the render queue worker, whose stale-lock sweep has never been
observed under a real crash) can be trusted outside a laptop.

**Conclusion: starting Step 7 with Photoshop/PSD would be premature.** The
repo's actual state — real, observed test-flakiness, an unexercised
stale-lock recovery path, and zero deployment/monitoring history — argues
for closing more foundational gaps first.

### 6.2 Photoshop/PSD handoff vs. Production Readiness Review — which delivers more real value now?

| | Photoshop/PSD handoff | Production Readiness Review / Deployment-Monitoring Plan |
|---|---|---|
| Resolves any item in §5's real debt list? | No (roadmap's own admission) | Yes — directly targets stale-lock recovery validation, in-flight cancellation, test-flakiness root cause, and the total absence of deployment/monitoring history |
| Who benefits immediately? | A hypothetical designer wanting a `.psd` handoff — no evidence yet that a real user has asked for this | Everyone: every future customer/investor demo depends on the app actually running somewhere reliably, not just on a dev machine |
| Risk of *not* doing it now | Low — Photoshop was always parked/optional; deferring it changes nothing about what already ships | High — if the render queue worker's stale-lock sweep or the test suite's flakiness turns into a real production incident, there is currently no monitoring to detect it and no deployment runbook to recover from it |
| Effort proportionality | Large (`size: L` per the roadmap's own estimate) for a capability with no confirmed demand | Right-sized — a *review* is planning/process work, not a rewrite; it can be scoped small first (a checklist + a plan doc), same discipline as Steps 5/6's "planning-first" pattern |

Photoshop/PSD does not compete well against a Production Readiness Review on
either "resolves real debt" or "risk of deferring."

### 6.3 Actual product value of a Photoshop/PSD adapter, concretely

Per the project's own stated strategy: Photoshop is explicitly **not** the
primary engine — it is an "optional professional finalization/handoff
layer" sitting *after* the real render pipeline. Concretely, the value is: a
designer at the agency (or a client's in-house designer) receives an
AI-generated, QA-passed, already-rendered creative and wants to hand-polish
it in Photoshop — nudge kerning, swap a font weight, retouch a background —
without starting from a blank canvas. The target user is a **human
finishing an AI draft**, not an automation replacing Photoshop. This is a
legitimate, differentiated capability for an agency-facing product where "AI
does 90%, a human professional finishes the last 10%" is the actual sales
pitch. It is real value — just not *urgent* value, because nothing today
blocks a designer from already opening the exported PNG/PDF in Photoshop
manually; what a PSD/layer handoff adds is *editability* (real text/shape
layers instead of a flattened image), a genuine but incremental improvement
over what already works.

### 6.4 Risks of building it now

- **Adapter complexity**: a real implementation means either a UXP plugin +
  Photoshop-side worker (heavy: requires a running Photoshop instance,
  Adobe's UXP runtime, a new client/server protocol) or a PSD-writing
  library — both are non-trivial, ongoing-maintenance surfaces distinct
  from anything else in this codebase.
- **PSD format constraints**: layers, effects, blend modes, and text-run
  formatting in a real PSD do not map cleanly from Playwright-rendered
  HTML/CSS — HTML gives you a flattened raster (or, at best, DOM structure
  that doesn't correspond 1:1 to PSD's layer/effect model). Faithful
  layer-effect mapping is a research problem, not an engineering task with
  a known effort estimate — which is exactly why the parked plan calls for
  a research spike / go-no-go, not direct implementation.
- **Premature investment before more basic gaps are closed**: per §6.1/6.2,
  building this now means investing "L" effort in a capability with no
  confirmed user demand while stale-lock recovery is unverified, test
  flakiness is unresolved, and there has never been a deployment.
- **Maintenance surface**: a UXP plugin or PSD-writing dependency is a new,
  Adobe-ecosystem-coupled piece of infrastructure that must be kept working
  across Photoshop/UXP version changes — an ongoing cost with, again, no
  confirmed demand to justify it yet.

### 6.5 If Step 7 WERE Photoshop/PSD, what's the smallest safe MVP scope?

The smallest safe MVP is **not** a real `.psd` binary. Generating a true
`.psd` requires either driving a live Photoshop instance via UXP (heavy
runtime dependency) or a PSD-writing library capable of faithfully
reproducing layers/effects/text-runs (a hard, open-ended format problem).
Both are disproportionate to "smallest safe."

The meaningfully smaller alternative is a **designer-handoff package**: a
ZIP/folder containing (a) the already-rendered flat image (PNG/PDF — this
already exists, zero new work), (b) a layer manifest/JSON describing each
layout element's type/position/size/content/font (largely a re-shaping of
the existing manifest v2 / `LayoutPlan` contract — no new data needs to be
invented), and (c) references to the font/asset files already in storage.
This is **meaningfully smaller** than a real PSD file: no UXP runtime, no
PSD-writing library, no layer/effect fidelity research, no
Photoshop-version compatibility maintenance — just an export transform over
data the system already has in full. **Recommendation: if Photoshop/PSD is
ever picked up, start here — a handoff package, not a real PSD** — matching
the parked plan's own fallback ("manual designer handoff even if automation
doesn't get a go").

### 6.6 Which files would this eventually touch (speculative, light — not being built now)

- `apps/api/src/services/render-engine.ts` / `runRenderPipeline` — as the
  point that already assembles the manifest + rendered output, a handoff
  package would likely branch from here.
- A new adapter module, e.g. `apps/api/src/services/psd-handoff.ts` (or a
  new `apps/api/src/handoff/` directory) — kept fully separate from the
  render engine's core path (no regression in the render/export path;
  adapter fully opt-in).
- `export_artifacts` format enum — a new format value (e.g.
  `'designer_handoff_package'`) alongside existing `png`/`jpg`/`pdf`.
- `packages/schemas/src/render-job.ts` — schema additions for the new
  format, additive only.

### 6.7 What must stay explicitly out of scope even in a future Photoshop MVP

- **Real Adobe API integration requiring paid Adobe accounts/licensing
  complexity** — a UXP-driven live-Photoshop worker requires a running,
  licensed Photoshop instance; this should not be a hard dependency for
  MVP.
- **Full layer-effect fidelity** — faithfully reproducing every
  blend-mode/effect/text-run nuance is explicitly a research/go-no-go
  question in the parked plan, not a committed deliverable.
- **Round-trip PSD editing back into the pipeline** — a designer editing a
  handoff package and having those edits flow back into `LayoutPlan`/the
  render pipeline is a fundamentally different (and much larger) feature
  than one-way handoff; never assume it's in-scope for a first MVP.

### 6.8 Final recommendation

The user's own pre-stated preference — defer Photoshop/PSD, do a Production
Readiness Review or Deployment/Monitoring Plan first — **is supported by the
repo's actual state**, not just rubber-stamped: §5's real technical-debt
list (stale-lock recovery unverified, in-flight cancellation limited,
test-suite flakiness genuinely observed across multiple steps, F9 not
independently re-confirmed) and §2's verification snapshot (every check
performed so far is local-dev/embedded-Postgres only — **zero deployment or
monitoring history exists**) both point the same direction: the project has
real, unresolved operational risk that a Photoshop adapter does nothing to
address, while a Production Readiness Review / Deployment-Monitoring Plan
would directly examine and likely help close several of those exact items.

**Recommendation: Phase 3 Step 7 should be a Production Readiness Review /
Deployment-Monitoring Plan, not Photoshop/PSD handoff planning.** Concretely,
this step should (a) produce a deployment target + runbook (mirroring the
"planning-first" discipline already proven twice in this phase, Steps 5 and
6), (b) define what monitoring/alerting looks like for the render queue
worker specifically (given its unverified stale-lock sweep), and (c)
investigate the root cause of the test-suite's parallel-load flakiness
rather than continuing to route around it with `--maxWorkers=2`.
Photoshop/PSD handoff planning remains a legitimate, low-priority, optional
future step — exactly as the original roadmap always scoped it — but it is
not the right subject for Step 7 given what §5 shows is still actually
unresolved.
