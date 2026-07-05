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
   `1080:1080` passes. Remaining KIE note: the stale hard-coded default
   image model (`gpt-image-1.5`) is still a separate hotfix — real runs
   need `KIE_AI_IMAGE_MODEL` set (verified with `nano-banana-2`).
2. **Step 13 hotfix B (optional, small):** email format validation in
   `db:seed-admin`; Turkish provider-error summary (F6); render warning text
   wrap (F7).
3. **Phase 3 candidate:** composite generated visuals into render image
   slots (F8) — this is the single change that makes the end-to-end demo
   visually convincing.
