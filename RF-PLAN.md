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

### 1. Wire PaletteEditor into the brand page
`apps/dashboard/src/app/clients/[id]/brand/page.tsx`: for each asset whose
`type === 'color_palette'`, render `<PaletteEditor clientId={params.id} assetId={asset.id}
initial={asset.metadata?.palette ?? []} onSaved={() => loadAssets()} />` inside the asset
card, below the existing thumbnail block. Import from `@/components/palette-editor`. Do not
change the upload form or other asset types.

### 2. Flat-color QA guard (best-effort, do not force)
FIRST verify whether `apps/api/src/render/render-quality.ts` has access to the rendered
image bytes. If it does, add a cheap near-solid / low-color-variance detector that emits a
structured `flat_color_output` warning (follow the existing warning shape/severity in that
file). If it does NOT have the pixels cheaply available, SKIP this item and say so in the
report — do not thread a large new data path just for a warning. Keep any check O(sampled
pixels), not full-image.

### 3. Tests (mirror existing patterns in `apps/api/src/__tests__` and dashboard)
- `palette-extraction`: with the fake/deterministic provider (or a mocked model call),
  assert a valid `BrandPalette` is returned and validated; a non-image or missing-bytes
  asset returns `[]`; a provider/JSON failure returns `[]` (never throws).
- `PATCH .../palette`: 200 on valid body (palette persisted to `metadata.palette`);
  400 on invalid hex; 404 on missing asset; cross-org → 404 (mirror `org-isolation.test.ts`
  / `client-isolation.test.ts`).
- `visual-generation` brandPalette injection: when a `color_palette` asset has a palette,
  the built image prompt contains the palette hex values and the role tag; assert the
  prompt does NOT reduce to a lone "solid <bg>" (palette section present). Reuse the
  existing visual-generation test harness/fixtures.
- If item 2 ships: a test that a near-solid rendered image raises `flat_color_output` and a
  varied one does not.

### 4. Full verification (PROOF)
- `cd apps/api && npx vitest run --maxWorkers=2` — existing 493 + new tests all green.
- `cd apps/dashboard && npx tsc --noEmit && npx next build` — clean.
- `cd apps/api && npx tsc --noEmit` and `npx eslint src --ext .ts` on touched files — clean.

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
