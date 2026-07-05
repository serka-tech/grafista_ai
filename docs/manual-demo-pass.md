# Grafista AI Studio — Dashboard Manual Demo Re-run (Phase 2 Step 13R, after KIE hotfixes)

- **Date:** 2026-07-05
- **Commit under test:** `667a546` (includes Step 13 hotfix A `79f2e45`
  aspect-ratio normalization + hotfix B `667a546` KIE default image model)
- **Branch:** `phase-2-checkpoint`
- **Environment:** local (macOS dev machine)
- **Provider mode:** real — real OpenAI (`gpt-4o` / `gpt-4o-2024-08-06`) for
  all text/vision steps, **real KIE AI (`nano-banana-2`) for image
  generation (this time it worked — see step 7)**, real Playwright/Chromium
  renderer
- **Storage mode:** local (`apps/api/uploads/`)
- **Database:** real local PostgreSQL (`grafista_manual` @ localhost:55432)
- **Method:** same as the original Step 13 pass — the dashboard was driven
  through a real Chromium browser (Playwright) step by step with a full-page
  screenshot per step; failure paths were verified over the authenticated
  HTTP API where the UI cannot reach them.

No secrets or API key values were logged at any point. No real
Photoshop/Adobe/PSD rendering was involved. This step changed no src code —
it is a verification re-run of the Step 13 tour after the two KIE hotfixes,
not a new feature.

## Result: 12/12 PASS

This re-run achieved a **true 12/12** — and unlike the original pass, steps
9–12 ran against a **real KIE-generated output** (no synthetic rows needed).

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Login | PASS | `demo@grafista.local` (OWNER), cookie session, redirect to client list. |
| 2 | Client view | PASS | Flavora Organic opens with brand/reference/DNA/content cards. |
| 3 | DesignDNA | PASS | Existing **approved v2** used (Onaylandı, %95 güven, 3 references) — re-analysis was already exercised in the original pass. |
| 4 | Layout generation | PASS* | "🎨 Yerleşim Planı Oluştur" → 3 new alternatives via real `gpt-4o-2024-08-06` (`01a56f1d`, `c596577a`, `6f5e37eb`). *First click returned 502 — "AI response failed schema validation (layout_generation, alternative 1)" — a real-LLM nondeterminism flake, **not** the B2 bug; the UI surfaced the error and an immediate retry succeeded (201). See observation N1. |
| 5 | Alternative approve | PASS | Alternatif 1 (`01a56f1d`) → Onaylandı (200). |
| 6 | Creative QA + approve | PASS | Real OpenAI QA on the new alternative: report `26cb699b` **passed 78/100** (threshold 75), then explicitly approved via the report card (200). |
| 7 | **Visual generation (real KIE)** | **PASS — B2 RESOLVED** | "▶ Yeni Alternatif Üret" on an approved+QA-passed plan → POST 201, output `e7d01190` **status `generated`**, provider `kie-ai`. API trace: `aspect ratio normalized — originalAspectRatio=1080:1080 normalizedAspectRatio=1:1`, model `nano-banana-2`, latency ~31.7 s. **No aspect-ratio 500, no model 422.** |
| 8 | Output view | PASS | Real 2048×2048 image served from `/api/visual-outputs/:id/file` and rendered in-browser (naturalWidth 2048); all 3 output previews on the page loaded (3/3). |
| 9 | Production package | PASS | "🏭 Üretime Gönder" → job `779902f8` `package_ready`, "Paket Hazır" badge; package download HTTP 200 (34,392-byte manifest JSON). |
| 10 | Production review | PASS | Approve → 200, badge "Onaylandı", approve/reject buttons correctly locked afterwards. Reject path re-verified on the historical rejected job (`af5ff0c4`) in the failure checks below. |
| 11 | Render/export | PASS | Preset Instagram Post (1080×1080) + PNG → real Chromium render, job `85fc95ef` `rendered`, "Render uyarıları (5)". |
| 12 | Artifact download | PASS | `/api/export-artifacts/:id/file` → HTTP 200, 13,429-byte valid PNG (magic bytes verified); same URL unauthenticated → 401. |

## KIE hotfix verification (blocker B2)

- **B2 is resolved end-to-end.** The exact step that failed in the original
  pass (dashboard-driven real KIE visual generation with a 1080×1080 preset)
  now succeeds: the adapter normalized `1080:1080` → `1:1` (trace log
  present, no secrets) and Kie accepted the request on the first attempt.
- The hotfix-B default-model path (`KIE_DEFAULT_IMAGE_MODEL =
  nano-banana-2`) was not separately exercised live because the local env
  still sets the optional `KIE_AI_IMAGE_MODEL=nano-banana-2` override; either
  way no 422 occurred, and the default is covered by
  `apps/api/src/__tests__/kie-default-model.test.ts` plus the Step 12 smoke.

## Failure-path checks (all PASS)

| Check | How | Result |
|---|---|---|
| Visual generation without approved/passed QA | API POST on new unapproved alternative `c596577a` | 409 — "no Creative QA report is in 'approved' or 'passed' status yet" |
| Failed output → production | API POST on failed output `6957e398` | 409 — names the `failed` status and the exact route to fix it |
| Rejected job → render | API POST render on rejected job `af5ff0c4` | 409 — "only a 'package_ready' or 'approved' job can be rendered" (and a wrong field name got a clean 400 listing allowed formats) |
| Unauthorized role | live CONTENT_MANAGER (`cm@grafista.local`) | 403 with `requiredPermission` named (`production_jobs:approve`, `visual_generation:run`); unauthenticated artifact file route → 401 |

(Test-data note: the CM user's local demo password was reset directly in the
local DB via a one-off scratch script — data-only, no src change.)

## UI friction after the re-run (F1–F10 status)

No UI code changed between the two passes, and the re-run confirms the list
is still accurate:

- **Still valid, re-observed:** F1 (QA "Geçti 78/100" + yellow "Üretime
  hazır değil" side by side), F2 (raw English `approved`/`draft`/`pending
  approval` badges on the content page), F4 (enabled "✓ Onayla" on an
  already-approved DNA version), F6 (raw English provider error text on the
  old failed output card), F7 (render warnings truncate), F10 (leftover
  dev/test clients in the list).
- **F5 (provider/model shows `none`):** still valid and now also observed on
  a *successful* output — `model` is not persisted on the generated output
  row (`model: undefined` in the API response), so even real `nano-banana-2`
  runs display without a model name.
- **F8 — explicitly re-checked:** still valid. The rendered export is still
  a placeholder comp: the real generated visual is **not** composited into
  the layout's image slots (gray boxes + "Görsel kaynağı eksik" warnings),
  even though a real image now exists one card above it. With real
  generation working, F8 is now the single most visible gap in the demo —
  unchanged recommendation: Phase 3 item to wire generated outputs into
  image layers.
- **F9:** still valid (headline overflows the canvas and is white-on-light
  in the placeholder render, as QA predicted).
- **F3:** not re-tested in detail (no UI change since the original pass;
  assumed still valid).

## New observation (not a blocker)

- **N1 — layout generation can 502 on real OpenAI (schema-validation
  flake):** the first generation attempt failed with "AI response failed
  schema validation (layout_generation, alternative 1)" (502); the retry
  succeeded. The error was surfaced cleanly in the UI and nothing was
  persisted half-done. Proposed separate (optional) hotfix: one automatic
  in-service retry when the LLM response fails schema validation, before
  returning 502.

## Remaining blockers

None for the 12-step demo chain. B1 (docs credentials) was fixed in Step 13;
B2 (KIE aspect ratio) is resolved and verified above.

---

# Grafista AI Studio — Dashboard Manual Demo Pass (Phase 2 Step 13)

- **Date:** 2026-07-05
- **Commit under test:** `ad1a280`
- **Environment:** local (macOS dev machine)
- **Provider mode:** mixed — real OpenAI (`gpt-4o`) for all text/vision steps,
  real KIE AI attempted for image generation (failed — see blocker B2),
  real Playwright/Chromium renderer
- **Storage mode:** local (`apps/api/uploads/`)
- **Database:** real local PostgreSQL (`grafista_manual`), migrations 001–020
- **Stack commands:** `db:seed` → `db:seed-admin` → `db:seed-demo`, then
  `tsx src/index.ts` (API :4000) + `next dev` (dashboard :3000)
- **Method:** the dashboard was driven through a real Chromium browser
  (Playwright) step by step, with a full-page screenshot and page-state dump
  captured at every step; failure paths were verified over the authenticated
  HTTP API where the UI cannot reach them.

No secrets or API key values were logged at any point. No real
Photoshop/Adobe/PSD rendering was involved. This step changed no src code.

## 12-step demo result

| # | Step | Result | Route | Notes |
|---|---|---|---|---|
| 1 | Login | **PASS**¹ | `/login` | Cookie session, redirect to client list. ¹Runbook's documented `demo@local` seed email is rejected by the login endpoint (blocker B1) — works with `demo@grafista.local`. |
| 2 | Client view | PASS | `/`, `/clients/[id]` | Flavora Organic opens with brand/reference/DNA/content cards + workflow shortcuts. |
| 3 | DesignDNA | PASS | `/clients/[id]/design-dna` | Re-analyze ran a **real OpenAI vision** call (~30 s, live loading state), produced a new version ("Oluşturuldu"), approve → "Onaylandı". |
| 4 | Content idea | PASS | `/clients/[id]/content` | "✨ 3 Fikir Üret" generated 3 real ideas; one approved → brief button appears on the card. |
| 5 | Design brief | PASS | `/briefs/[id]` | Created from the approved idea (real OpenAI), status Taslak → Onaylandı; layout button correctly gated until approval. |
| 6 | Layout generation | PASS | `/briefs/[id]/layout-plans` | 3 alternatives (real `gpt-4o-2024-08-06`), full layout detail per card; first alternative approved. |
| 7 | Creative QA | PASS | same page | Real OpenAI QA: "Geçti (78/100, eşik 75)", 11 sub-scores, issues + fix tiers rendered in Turkish. |
| 8 | Visual generation | **FAIL → blocker B2** | same page | Real KIE call failed: `createTask (code=500): This aspect_ratio is not within the range of allowed options` — service sends raw pixel dims (`1080:1080`), Kie expects normalized (`1:1`). Failure was persisted and displayed clearly on the output card. Steps 9–12 were unblocked with a **synthetic 'generated' output** (same technique as Step 8A/8B verification). |
| 9 | Production package | PASS² | same page | "🏭 Üretime Gönder" → job `package_ready`, v2 package summary + "⬇ Paketi İndir" (34 KB manifest JSON downloads, HTTP 200). |
| 10 | Production review | PASS² | same page | Approve → "Onaylandı" (approve/reject then correctly locked). Reject path verified on a second job via API: reason persisted, status `rejected`. |
| 11 | Render/export | PASS² | same page | Preset Instagram Post + PNG → real Chromium render, "Render uyarıları (5)" listed. |
| 12 | Artifact download | PASS² | API file route | Real 1080×1080 PNG (13.4 KB) downloads with session cookie; same URL without auth → 401. |

² 9–12 ran against the synthetic generated output because of B2; the UI/API
behavior exercised is identical to the real-output path (same rows, same
gates, same routes).

## Failure-path checks (all PASS)

| Check | How | Result |
|---|---|---|
| Visual generation without approved/passed QA | API POST on an unapproved alternative | 409 with explicit reason ("no Creative QA report is in 'approved' or 'passed' status yet") |
| Failed output → production | UI + API | UI button disabled with explanatory title; API 409 names the status and the exact route to fix it |
| Rejected job → render | API | 409: "only a 'package_ready' or 'approved' job can be rendered", with recovery instructions |
| Unauthorized role | live CONTENT_MANAGER user | 403 with `requiredPermission` named (`production_jobs:approve`, `visual_generation:run`); unauthenticated file route → 401 |
| Provider error surfaced to user | live (B2) | The real Kie error text is shown on the output card — visible or, but raw English/technical (see F6) |

## UI friction list (observations only — no UI changes made)

1. **(F1)** Creative QA card shows "✓ Geçti (78/100)" and a yellow "Üretime
   hazır değil" label side by side while the generate button is *enabled* —
   mixed signals. The advisory `readyForProduction` flag needs a tooltip or
   different wording (e.g. "QA önerisi: yayın öncesi düzeltme önerilir").
2. **(F2)** Content idea status badges are raw English (`approved`, `draft`,
   `pending approval`) in an otherwise Turkish UI; same for
   platform/type chips.
3. **(F3)** An idea stuck in `draft` (older data) shows no action buttons at
   all — no approve, no delete; it's a dead end in the UI.
4. **(F4)** On an approved DesignDNA version the "✓ Onayla" button stays
   enabled (idempotent server-side, but reads as "not approved yet").
5. **(F5)** Failed output card shows provider/model as `kie-ai / none` —
   "none" is the unset model field; should show the attempted model or be
   hidden.
6. **(F6)** Provider failure text on the output card is raw English/technical
   ("All 3 attempts failed: Kie AI createTask failed (code=500)...") — great
   for ops, not for a client-facing demo; deserves a short Turkish summary
   with the raw text collapsed underneath.
7. **(F7)** "Render uyarıları (5)" entries truncate mid-sentence with no
   wrap/expand — the useful half of the message (which layer, which zone) is
   cut off.
8. **(F8)** The rendered export is a placeholder comp: generated visuals are
   NOT composited into the layout's image slots (renderer correctly warns
   "Görsel kaynağı eksik" ×2). Correct current MVP behavior, but the
   gray-box PNG will surprise demo viewers — worth a visible note in the UI
   next to the render button, and a Phase 3 roadmap item to wire generated
   outputs into image layers.
9. **(F9)** In the demo render the headline text overflows the canvas edges
   and is white-on-light (exactly what QA sub-scores 65–70 predicted) —
   evidence the QA heuristics are useful; no action needed beyond F8.
10. **(F10)** Client list shows leftover dev/test clients ("E2E Golden
    Path…", "Step8C Verify…") — dev DB hygiene only, not a product issue.

Positives worth keeping: every gate is a *visible disabled button with an
explanatory `title`* (never hidden); all long AI actions have live loading
states; 409/400 messages name the exact status and the route that fixes it;
"Sıradaki adım: …" hints thread the user through the chain.

## Blockers

- **B1 (docs, fixed in this step):** `db:seed-admin` accepts `demo@local`
  but the login endpoint's `z.string().email()` rejects it — the runbook's
  documented credentials could never log in. Both docs now use
  `demo@grafista.local`. A follow-up hotfix could add the same email format
  check to `db:seed-admin` itself.
- **B2 (RESOLVED by Step 13 hotfix A — commit after `a609f61`):**
  `normalizeAspectRatio` (gcd reduction + nearest-supported snapping,
  `packages/model-router/src/aspect-ratio.ts`) is now applied inside
  `KieAIAdapter` before `createTask`, so raw `1080:1080` goes out as `1:1`
  (with an `originalAspectRatio`/`normalizedAspectRatio` trace log, no
  secrets). Regression tests: `apps/api/src/__tests__/kie-aspect-ratio.test.ts`
  (18 tests). Real KIE smoke re-run with the raw `1080:1080` input:
  **PASS** (`nano-banana-2`, 1 image generated, bytes downloaded + stored +
  verified). Original finding kept below for the record.
- **B2 (original finding, src, as observed during the pass):**
  `apps/api/src/services/visual-generation.ts:212` sends
  `aspectRatio: "${width}:${height}"` (e.g. `1080:1080`); Kie AI rejects
  non-normalized ratios with HTTP 500, so **every real image generation
  fails** for standard presets. Step 12's smoke passed because it sent `1:1`
  directly. Proposed hotfix (one function + tests): reduce the ratio by GCD
  (1080:1080 → 1:1, 1080:1920 → 9:16) before passing it to the provider.
  Until then the real-provider chain stops at step 8.

## Next actions (proposed)

1. **Step 13 hotfix A:** ~~aspect-ratio normalization~~ **DONE** — implemented
   at the provider boundary (`packages/model-router/src/aspect-ratio.ts` +
   `KieAIAdapter`) with regression tests; real KIE smoke with raw
   `1080:1080` passes. The remaining KIE note (stale hard-coded default
   image model `gpt-image-1.5`) was closed by **Step 13 hotfix B**: the
   built-in default is now `nano-banana-2` (`KIE_DEFAULT_IMAGE_MODEL` in
   `packages/model-router/src/providers/kie-ai.ts`), so real runs no
   longer require the `KIE_AI_IMAGE_MODEL` override (it remains an
   optional override). Regression tests:
   `apps/api/src/__tests__/kie-default-model.test.ts`.
2. **Step 13 hotfix C (optional, small):** email format validation in
   `db:seed-admin`; Turkish provider-error summary (F6); render warning text
   wrap (F7).
3. **Phase 3 candidate:** composite generated visuals into render image
   slots (F8) — this is the single change that makes the end-to-end demo
   visually convincing.
