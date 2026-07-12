# Direct-Photo Listing Cards — Design (M6, go-live critical path)

> **Status:** DESIGN (2026-07-12). Approved decisions below; implementation pending
> user green-light. Part of the single-customer production go-live track (real-estate
> customer needs their OWN property photos on designs, not AI-generated images).

## Context & decisions

The first production customer (real-estate, Turyap-style) primarily wants to place
**their own real property photos** into designs — an AI-generated property image is
useless to them. User decisions (2026-07-12):
- **Curated real-estate listing template** (reliable hero photo slot + price/address/
  title text + agency info), NOT reliance on AI-generated layouts having a slot.
- **Upload the photo at use-time** (no reusable photo library yet).

## Key insight — the pipeline is source-agnostic

The entire downstream — `buildProductionPackage` → `renderProductionJob` →
`planVisualComposition` → export artifact → download — operates purely on a
**`generated_output`'s storage coordinates**. It never checks whether those bytes came
from an AI provider or an upload. Confirmed:
- `production-gate.ts:63` `assertGeneratedOutputReadyForProduction` requires only
  `status='generated'` — no Creative QA report needed.
- `render-engine.ts` `loadSelectedVisual` reads `manifest.selectedVisual.storage` via
  `getObjectBuffer` → data URI → `planVisualComposition` composites into the primary
  image slot (or full-bleed if none). Source-agnostic.

So the mechanism is: **make the uploaded photo a `generated_output`** (bytes copied into a
`generated-outputs/…` key, `generationMethod='uploaded'`, `status='generated'`). Everything
downstream is UNCHANGED — no edits to package builder, render engine, composition, artifacts,
or the outputs UI.

## FK-chain reality (why a "listing flow" is needed, not just an endpoint)

A curated template layout can't stand alone — the schema chain is NOT NULL all the way:
`content_ideas` → (`approvals`) → `design_briefs.content_idea_id` NOT NULL +
`approvalId` → `layout_plans.design_brief_id` NOT NULL → `generated_outputs.design_brief_id`
NOT NULL. Relaxing these FKs would touch core tables + many joins (risky). Instead the
listing flow **auto-provisions a minimal chain** with listing-derived values — safe,
additive, no migration to existing tables.

## Design — dedicated Listing Card flow

New service `createListingCard(clientId, input, requestedBy)` where `input` = the uploaded
photo bytes + `{ format, price, address, title, agencyName, … }`:

1. **Auto-chain (reuse existing repos):** create an approved `content_idea` (topic = title),
   an approved `approval` + `design_brief`, then a curated `layout_plan` (status `approved`)
   built by a template factory (below). Boilerplate but reuses `contentIdeasRepo` /
   `approvalsRepo` / `designBriefsRepo` / `layoutPlansRepo` create signatures verbatim.
2. **Curated template factory** `buildRealEstateListingLayout(format, fields)` → a
   `LayoutPlanContent`: background + **hero image slot** (`type:'image'`, `sourceType:'placeholder'`,
   no sourceUrl → injectable) covering the top region + **text layers** (price, address,
   title, agency name) + a logo slot. Parameterized by canvas size per format
   (square 1080×1080, story 1080×1920 for MVP).
3. **Uploaded photo → generated_output:** validate + store the photo bytes into
   `generated-outputs/{clientId}/{uuid}.{ext}` (reuse `getStorageProvider().putObject`,
   same as `visual-generation.ts`), then create the `generated_output` row
   (`generationMethod:'uploaded'`, `status:'generated'`, storage coords, `fileUrl:
   /api/visual-outputs/:id/file`, linked client/brief/layout).
4. Return the `generated_output` (ready for production) — or optionally auto-run production+
   render and return the render job for a one-call "create + render" UX.

Downstream (production → render → composite hero photo into the slot + render text/logo →
download) is **unchanged**. Budget guard (M2.1) naturally does not apply (no AI call).

## File-level plan

| File | Change |
|---|---|
| `packages/schemas` generated-output | add `'uploaded'` to `generationMethod` enum (additive) |
| `apps/api/src/services/listing-card.ts` (new) | `createListingCard` — auto-chain + template + uploaded output |
| `apps/api/src/services/real-estate-template.ts` (new) | `buildRealEstateListingLayout(format, fields)` — curated `LayoutPlanContent` |
| `apps/api/src/routes/listing-cards.ts` (new) | `POST /api/clients/:clientId/listing-cards` (multipart photo + fields), RBAC + `assertClientAccessible`, reuse `upload` middleware |
| `apps/api/src/app.ts` | mount the router |
| `apps/dashboard` | a "Yeni ilan kartı" form (format + fields + photo upload) on the client hub |
| `apps/api/src/__tests__/listing-card.test.ts` (new) | upload+fields → generated_output → production → render → hero photo composited into the slot (real storage + fake renderer), + validation/RBAC/isolation |

## MVP scope + fast-follows

**MVP (this increment):**
- Formats: square (1080×1080) + story (1080×1920).
- Fields: property photo, price, address/location, title/headline, agency name (**as TEXT**).
- Photo composited into the hero slot; text/logo-placeholder render from the template.

**Deliberate fast-follows (documented, not in MVP):**
- **Agency LOGO as an image** on the card — needs multi-image compositing (hero photo +
  logo), i.e. the manifest carries the logo's storage coords and the composition injects a
  SECOND image into the logo slot. `planVisualComposition` today injects one primary slot
  and deliberately skips logo slots. MVP uses agency name as text instead.
- Reusable per-client photo library (MVP uploads at use-time).
- Multiple photos / collage layouts (MVP = single hero).
- Editable/preview of the layout before render.

## Verification

- Unit: `buildRealEstateListingLayout` produces a valid `LayoutPlanContent` with exactly one
  injectable image slot + the text layers, per format.
- Integration (`listing-card.test.ts`, real embedded PG + fake renderer): POST photo+fields →
  201 generated_output (`generationMethod:'uploaded'`, `status:'generated'`, storage bytes match
  upload) → send to production → render → assert the export composited the uploaded bytes into
  the hero slot (composition warning `selected_visual_loaded` for the slot, NOT
  `full_canvas_visual_fallback`) → download byte-verify.
- RBAC/isolation: unauthenticated 401, missing permission 403, foreign client 404.
- Full suite stays green; no changes to package builder / render engine / composition.
