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
- (r2-2) In the brand upload form, when the selected `type === 'color_palette'`, narrow the
  FileDropzone `accept` to raster (`image/png,image/jpeg,image/webp`) and note that palette
  auto-extraction needs a raster image (SVG/PDF still allowed for other asset types).

### 2. Kill the "solid <bg>" flattening + establish palette precedence (findings 1, 2)
This is the other half of the actual bug — the palette must WIN over conflicting color guidance.
- `apps/api/src/services/visual-prompt-layout.ts`: stop emitting `Background: solid <bg>`.
  State the background as a plain color reference and add that the brand palette (passed
  separately) overrides layout-level color choices; never call the whole canvas one solid color.
- `packages/prompt-engine/src/templates/visual-generation.ts`: make precedence explicit —
  the approved Brand Palette overrides any conflicting color value in the DesignBrief, the
  layout description, or the "color usage notes". Reword the "follow color usage verbatim"
  line so it cannot fight the palette.

### 3. Palette selection + storage correctness (findings 3,5,6,7,8,13 + round 2: 4,3,4b,5)
- (r2-4) `visual-generation.ts` `loadBrandPaletteText`: select the NEWEST valid `color_palette`
  asset (assets ordered `created_at ASC`, iterate from the end). A palette is only USABLE for
  generation when it has **at least 2 distinct hex values**; a 0/1-color palette returns `''`
  (falls back to layout colors) so a lone color never flattens the output. Storage/edit schema
  stays permissive (manual entry, empty state) — the ≥2 gate lives in this generation selector.
- (r2-3) `extractPaletteFromAsset` returns a discriminated outcome
  `{ palette: BrandPalette; status: 'ok' | 'empty' | 'failed'; stage?: string }` (never throws)
  so the caller can tell an empty extraction apart from a storage/provider/JSON/schema failure.
- (r3-2) The extraction MUST reach a VISION-capable model regardless of `AI_DEFAULT_PROVIDER`.
  Do NOT blindly force `provider: env.AI_DEFAULT_PROVIDER` (the router allows capability-bypassing
  overrides, so a text-only provider like `claude` could be selected and silently ignore the
  image). First read the model-router routing for `style_analysis`: if that taskType already
  routes to a vision provider with fallback, omit the explicit `provider` and rely on it (same
  reasoning as image_generation in visual-generation.ts:196). Otherwise pass an explicitly
  vision-capable provider. Verify against the router's routing table, don't assume.
- (r2-4b) `brand-assets` repo: ONE atomic metadata merge that writes BOTH `palette` and
  `paletteExtraction` together — `SET metadata = COALESCE(metadata,'{}'::jsonb) || $3::jsonb`
  (so a concurrent write is not clobbered and status can never appear without its palette).
  PATCH reuses the same atomic merge for `{palette}`.
- PATCH `/:clientId/brand-assets/:assetId/palette`: reject assets whose `type !== 'color_palette'`
  (404, indistinguishable from not-found).
- Extraction guard: only attempt vision extraction for RASTER images (`image/png`,
  `image/jpeg`, `image/webp`); skip `image/svg+xml`, `application/pdf`, others → `status:'empty'`.
- (r2-5) Do NOT wrap extraction in `Promise.race` (it bounds the HTTP wait but cannot cancel
  the provider call — wasted work/cost). Rely on the model/provider's own request timeout
  (already configured); the asset is persisted BEFORE extraction, so a slow/failed provider
  returns the asset with `status:'failed'` and an empty palette. Real abort-signal cancellation
  is DEFERRED (RF-ISSUES).

### 4. ~~Flat-color QA guard~~ — DEFERRED (finding 11)
Codex confirmed `render-quality.ts` is a PRE-render structural checker with no rendered
bytes. A pixel-variance guard needs a post-render sampled-pixel stage. Moved to RF-ISSUES.md;
NOT built this cycle.

### 5. Tests (findings 9, 12 — mirror `apps/api/src/__tests__` patterns)
- `palette-extraction`: assert the COMPLETE discriminated outcome (r3-1) — a valid extraction
  returns `{status:'ok', palette:[...]}` (validated); a non-raster or missing-bytes asset
  returns `{status:'empty', palette:[]}`; a provider/JSON/schema failure returns
  `{status:'failed', stage:..., palette:[]}` and NEVER throws.
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

## Post-deploy acceptance (finding 10 / r2-6 — the real pixel-level proof)
This Rock's unit tests prove wiring only. The actual fix is proven live, AFTER deploy:
- Owner: the driver (Claude) + user, in the post-deploy live smoke.
- Procedure: for a client with a ≥2-color palette (Yenişehir Merkez Koleji), run one real
  visual generation through the deployed pipeline and download the output.
- Success threshold: the output is visibly multi-color / on-brand (NOT a near-solid single
  color), and the generated colors relate to the saved palette. (The automated post-render
  low-variance check that would make this a hard gate is tracked in RF-ISSUES.)
- Tracking: recorded in the deploy smoke notes; a fail sends the palette-precedence prompt
  wording back as a new rock.

## Resolved finding (was rejected in round 1, refined in round 2)
- (finding 4 / r2-1) `BrandPaletteSchema` stays permissive (no min length) so manual entry and
  the empty state work; the "usable palette needs ≥2 distinct colors" rule moved to the
  GENERATION selector (`loadBrandPaletteText`, Rock item 3), which is where a 1-color palette
  would actually cause a flat output.

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
