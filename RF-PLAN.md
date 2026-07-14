# RF-PLAN — Design DNA palette fix: finish + harden

## Core Focus (one sentence)
A client's uploaded color palette (kartela) must drive the generated visual so
designs come out on-brand and multi-color, not a single flat color.

## Context — already implemented (baseline commit `01ebe47`, do NOT rewrite)
Root cause found: the uploaded `color_palette` brand asset was stored but never
read; the structured palette was never wired downstream; the image prompt said
"Background: solid <one color>". Approved approach: auto-extract the palette from
the kartela image with vision, let the user edit it, feed it to the image prompt.

Already done and typecheck-clean (`cd apps/api && npx tsc --noEmit` = 0):
- `packages/schemas/src/brand.ts`: `PaletteColorSchema` (`hex`, optional `name`,
  `role` enum: primary|secondary|accent|background|text|other) + `BrandPaletteSchema`
  (array, max 24).
- `packages/prompt-engine/src/templates/palette-extraction.ts` (+ index export):
  vision prompt that reads swatch hex + role from a kartela image; roles stay English,
  `name` is Turkish.
- `apps/api/src/services/palette-extraction.ts`: `extractPaletteFromAsset(asset, clientName)`
  — best-effort (any failure returns `[]`, NEVER throws into the upload path); reuses
  taskType `style_analysis` (vision) + `callAiForJson`.
- `apps/api/src/db/repositories/brand-assets.ts`: `updateMetadata(clientId, id, metadata)`.
- `apps/api/src/routes/brand-assets.ts`: POST upload — when `type==='color_palette'` and
  the file is an image, run extraction and store `metadata.palette`; new
  `PATCH /:clientId/brand-assets/:assetId/palette` (body `{ palette }`, `BrandPaletteSchema`
  validate → 400; missing asset → 404; `assertClientAccessible` → cross-org 404).
- `apps/api/src/services/visual-generation.ts`: `loadBrandPaletteText(clientId)` reads the
  client's `color_palette` asset `metadata.palette` → role-tagged text; passed as the
  `brandPalette` prompt variable.
- `packages/prompt-engine/src/templates/visual-generation.ts`: `{{brandPalette}}` section +
  a rule forbidding collapse to one flat color; `brandPalette` is a required variable.
- `apps/dashboard/src/lib/api.ts`: `updateBrandAssetPalette(clientId, assetId, palette)` (PATCH).
- `apps/dashboard/src/components/palette-editor.tsx`: editable palette UI (color input + hex
  text + role select + Turkish name + save), Turkish labels. NOT wired into any page yet.

(Also in the baseline, out of scope for this rock: FileDropzone drag-drop/preview across
the 3 upload screens; TURKISH_OUTPUT_DIRECTIVE on 5 content templates. Both already
build/test green — do not touch.)

## The Rock — remaining work (implement exactly)
Revised after Same Page round 1 (see RF-SAME-PAGE-LOG.md). Scope note (finding 10):
this Rock guarantees the palette is EXTRACTED, EDITABLE, and WIRED into the image
prompt with explicit precedence — it does NOT unit-assert pixel-level on-brand output;
that is verified by the post-deploy live smoke (a real generation), tracked separately.

### 1. Wire PaletteEditor into the brand page
`apps/dashboard/src/app/clients/[id]/brand/page.tsx`: for each asset whose
`type === 'color_palette'`, render `<PaletteEditor clientId={params.id} assetId={asset.id}
initial={asset.metadata?.palette ?? []} onSaved={() => loadAssets()} />` inside the asset
card, below the existing thumbnail block. Import from `@/components/palette-editor`. Do not
change the upload form or other asset types.
- (finding 14) `PaletteEditor`: disable "+ Renk Ekle" at 24 entries and show the limit.

### 2. Kill the "solid <bg>" flattening + establish palette precedence (findings 1, 2)
This is the other half of the actual bug — the palette must WIN over conflicting color guidance.
- `apps/api/src/services/visual-prompt-layout.ts`: stop emitting `Background: solid <bg>`.
  State the background as a plain color reference and add that the brand palette (passed
  separately) overrides layout-level color choices; never call the whole canvas one solid color.
- `packages/prompt-engine/src/templates/visual-generation.ts`: make precedence explicit —
  the approved Brand Palette overrides any conflicting color value in the DesignBrief, the
  layout description, or the "color usage notes". Reword the "follow color usage verbatim"
  line so it cannot fight the palette.

### 3. Palette selection + storage correctness (findings 3, 5, 6, 7, 8, 13)
- `visual-generation.ts` `loadBrandPaletteText`: select the NEWEST valid `color_palette`
  asset with a non-empty palette (assets are ordered `created_at ASC`, so iterate from the
  end), not the oldest.
- `brand-assets` repo: replace the whole-blob metadata write with an ATOMIC palette update
  (`jsonb_set(metadata, '{palette}', $3::jsonb, true)`) so a concurrent metadata write is not
  clobbered; add/keep a small `setPalette`/`updateMetadata` used by both the extractor and PATCH.
- PATCH `/:clientId/brand-assets/:assetId/palette`: reject assets whose `type !== 'color_palette'`
  (404, indistinguishable from not-found).
- Extraction guard: only attempt vision extraction for RASTER images (`image/png`,
  `image/jpeg`, `image/webp`); skip `image/svg+xml`, `application/pdf`, others → `[]`.
- Bound the extraction so a slow provider can't hang the upload: the asset is already
  persisted before extraction; wrap extraction in a timeout (e.g. ~20s) and on timeout return
  the asset without a palette (user adds manually). Full async+status pipeline is DEFERRED
  (RF-ISSUES).
- (finding 13) Record a small extraction status on the asset metadata alongside the palette
  (`metadata.paletteExtraction = { status: 'ok' | 'empty' | 'failed', stage? }`) so the UI /
  logs can tell "no swatches found" apart from "provider/JSON/schema failure". Upload stays
  best-effort (never throws).

### 4. ~~Flat-color QA guard~~ — DEFERRED (finding 11)
Codex confirmed `render-quality.ts` is a PRE-render structural checker with no rendered
bytes. A pixel-variance guard needs a post-render sampled-pixel stage. Moved to RF-ISSUES.md;
NOT built this cycle.

### 5. Tests (findings 9, 12 — mirror `apps/api/src/__tests__` patterns)
- `palette-extraction`: valid `BrandPalette` returned + validated (mock/fake provider);
  non-raster or missing-bytes asset → `[]`; provider/JSON/schema failure → `[]` and NEVER
  throws; extraction status recorded.
- `PATCH .../palette`: 200 valid (persisted to `metadata.palette`); 400 invalid hex; 404
  missing asset; 404 wrong asset type; cross-org → 404 (mirror `org-isolation.test.ts`).
- `visual-generation` injection: with a palette set, the COMPLETE built provider request
  (system+user) contains every palette hex + its role tag AND explicit palette precedence,
  AND contains no `Background: solid` / lone-flat-color directive. (finding 9)
- Proof is "the command exits 0 and the NAMED new tests pass", not an exact total count. (finding 12)

### 6. Full verification (PROOF — the driver runs these too)
- `cd apps/api && npx vitest run --maxWorkers=2` — exits 0; the named new tests pass; no prior
  test regressed.
- `cd apps/dashboard && npx tsc --noEmit && npx next build` — clean.
- `cd apps/api && npx tsc --noEmit` and `npx eslint src --ext .ts` on touched files — clean.

## Rejected finding
- (finding 4) Requiring `BrandPaletteSchema` min 2 colors: REJECTED — it breaks incremental
  manual entry (adding one color at a time) and the legitimate empty state. Multi-color is
  served by extraction typically returning several colors + the prompt's explicit "do not
  flatten to one color" rule, not by a schema floor.

## Constraints
- Reuse existing code patterns and helpers; match file style.
- Extraction stays best-effort: an extraction/provider failure must never fail an upload.
- Keep enum/status/format/hex/coordinate values in English (zod validation depends on it);
  user-facing UI text is Turkish.
- NO database migration (palette lives in the `brand_assets.metadata` JSONB).
- Do NOT touch production/staging, do NOT push, do NOT change deploy config.
- Do NOT modify the baseline's unrelated work (FileDropzone, Turkish directive).

## Non-goals
Video, other providers, real billing, a full BrandProfile CRUD, RLS, any other roadmap
item. Only the four items above.

## PROOF commands (the driver runs these, not just Codex)
1. `cd apps/api && npx vitest run --maxWorkers=2`
2. `cd apps/dashboard && npx tsc --noEmit && npx next build`
3. `cd apps/api && npx tsc --noEmit`
