/**
 * Grafista AI Studio — Production Package Builder (Phase 2 Step 8A, hardened in 8C)
 *
 * Pipeline stage: approved/generated visual (generated_outputs row, status
 * 'generated') -> production_jobs row -> ONE combined JSON package (manifest +
 * template contract) in object storage. The package is everything a human
 * production designer OR a future automatic template renderer needs to
 * rebuild the AI preview as a final deliverable — its
 * `templateContract.rendererCompatibilityHints` block is shaped so ANY future
 * renderer (Photoshop-based or otherwise) can consume the same package
 * without a new format. NO Photoshop/PSD logic or render engine exists here —
 * this is packaging only.
 *
 * Deliberate MVP choices (all mirroring existing conventions):
 *  * SINGLE stored artifact: production-package.json contains the manifest with
 *    the template contract and the markdown production instructions embedded as
 *    fields — no separate template-contract.json, no zip. One artifact means one
 *    storage round-trip, one integrity boundary, and the DB snapshots
 *    (package_manifest_snapshot / template_contract_snapshot) cover fast reads.
 *  * IDEMPOTENCY: if an active (non-failed/cancelled/rejected) job already
 *    exists for the generated output, that job is returned as-is — re-sending
 *    the same visual to production is a no-op, not a duplicate (the partial
 *    unique index in 016_production_jobs.sql backs this at the DB layer).
 *  * FAILURES ARE PERSISTED (same contract as visual-generation.ts): any
 *    packaging/storage error marks the job 'failed' with error_message BEFORE
 *    the error propagates — a failed job stays visible, never swallowed.
 *
 * STEP 8C — "package polish" (no behavior change to the pipeline above):
 *  * manifestVersion bumped 1 -> 2. The restructure is ADDITIVE: every Step
 *    8A/8B field stays exactly where it was (same name, same shape) so old
 *    snapshots and the existing test suite's assertions on
 *    `generatedOutput` / `layoutPlanSnapshot` / `creativeQaSnapshot` /
 *    `brandSnapshot` / `futurePhotoshopAdapterHints` / `manifestVersion===1`
 *    keep meaning what they meant — EXCEPT `manifestVersion` itself, which is
 *    now `2` by design (flagged in the Step 8C handoff report as the one
 *    intentional break). Every new/renamed concept is added ALONGSIDE the old
 *    one under a clearer name (`selectedVisual`, `layoutSnapshot`,
 *    `creativeQASnapshot`, `designDNASnapshot`, `rendererCompatibilityHints`,
 *    `colorPalette`, `exportVariants`, `manualHandoffNotes`, `packageVersion`)
 *    rather than replacing it — additive was judged lower-risk than a hard
 *    rename because this package is already persisted (DB snapshot + object
 *    storage) for real production jobs.
 *  * Canvas is now NEVER null: layout plan -> output dimensions -> a
 *    documented `{width:1080,height:1080}` fallback, with `canvasSource`
 *    recorded on the manifest so nothing is silently guessed untraced.
 */

import { v4 as uuid } from 'uuid';
import type {
  CreativeQAReport,
  DesignDNA,
  GeneratedOutput,
  Layer,
  LayoutPlan,
  ProductionJob,
} from '@grafista/schemas';
import { assertGeneratedOutputReadyForProduction } from './production-gate.js';
import { store } from '../data/store.js';
import { getStorageProvider } from '../storage/factory.js';
import { usersRepo } from '../db/repositories/users.js';
import { assertClientAccessible } from '../auth/client-access.js';

const MANIFEST_VERSION = 2;
const CONTRACT_VERSION = 1;
const GENERATION_METHOD = 'manual_package_builder';
const PACKAGE_MIME_TYPE = 'application/json';
const CREATE_PERMISSION = 'production_jobs:create';

// Step 8C — safe square default used ONLY when neither the layout plan nor
// the generated output's own dimensions can supply a canvas size. Documented
// here rather than silently defaulting inline; see `canvasSource` on the
// manifest for which source actually won for a given package.
const FALLBACK_CANVAS = { width: 1080, height: 1080 } as const;

type CanvasSource = 'layout_plan' | 'output_dimensions' | 'fallback_default';

type QualityChecklistStatus = 'ok' | 'warning' | 'missing';
interface QualityChecklistEntry {
  item: string;
  status: QualityChecklistStatus;
}

function notFound(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 404 });
}

/**
 * DOMAIN-LEVEL permission guard (Phase 2 Step 8A): re-verifies the requester's
 * 'production_jobs:create' permission fresh from the database, independently of
 * the Express middleware chain — the same "route middleware is one guard, the
 * domain layer checks again" precedent as advanceWorkflowRun()'s
 * bindingPermission() check in workflows/engine.ts. Any future non-HTTP caller
 * (workflow engine binding, script) gets the same enforcement for free.
 */
async function assertRequesterMayCreateProductionJobs(requestedBy: string): Promise<void> {
  const requester = await usersRepo.getWithAccess(requestedBy);
  if (!requester || requester.status !== 'active' || !requester.permissions.includes(CREATE_PERMISSION)) {
    throw Object.assign(
      new Error(`Forbidden — user is not an active user with the '${CREATE_PERMISSION}' permission`),
      { status: 403 }
    );
  }
}

/**
 * Step 8C — a package cannot be built for an output missing the fields that
 * identify it anywhere else in the system. Both `id` and `name` are required
 * (non-optional) on GeneratedOutputSchema, so this should be unreachable in
 * practice — it exists as a defensive last line before anything is written to
 * storage, thrown INSIDE the existing try/catch so it lands as a normal
 * 'failed' job with a descriptive error_message, not a new failure path.
 */
function assertOutputIsPackageable(output: GeneratedOutput): void {
  if (!output.id || !output.name || output.name.trim().length === 0) {
    throw new Error(
      `Generated output ${output.id ?? '(missing id)'} is missing required identifying fields (id/name) — cannot build a production package`
    );
  }
}

/**
 * Step 8C — resolves the canvas size ONE time, with an explicit, traceable
 * source: the layout plan's canvas, else the output's own dimensions, else the
 * documented fallback default. Never null/undefined — everything downstream
 * (template contract's canvas/orientation/aspectRatio, manifest's
 * canvasSource) is derived from this single resolution.
 */
function resolveCanvas(
  output: GeneratedOutput,
  layoutPlan?: LayoutPlan
): { canvas: { width: number; height: number }; canvasSource: CanvasSource } {
  if (layoutPlan) {
    return { canvas: { width: layoutPlan.canvas.width, height: layoutPlan.canvas.height }, canvasSource: 'layout_plan' };
  }
  if (output.dimensions) {
    return { canvas: { width: output.dimensions.width, height: output.dimensions.height }, canvasSource: 'output_dimensions' };
  }
  return { canvas: { ...FALLBACK_CANVAS }, canvasSource: 'fallback_default' };
}

/** Flattens the (possibly nested via `children`) layer tree into one list. */
function flattenLayers(layers: Layer[]): Layer[] {
  const result: Layer[] = [];
  for (const layer of layers) {
    result.push(layer);
    if (layer.children && layer.children.length > 0) {
      result.push(...flattenLayers(layer.children as Layer[]));
    }
  }
  return result;
}

/**
 * Builds the template contract — the machine-readable "what must the final
 * design contain" spec derived from the layout plan (and brand context when
 * available). Plain JSON object, no class. Fields that cannot be derived
 * cleanly are null/omitted rather than invented.
 */
function buildTemplateContract(input: {
  output: GeneratedOutput;
  layoutPlan?: LayoutPlan;
  designDna?: DesignDNA;
  resolvedCanvas: { width: number; height: number };
}): Record<string, unknown> {
  const { output, layoutPlan, designDna, resolvedCanvas } = input;
  const layers = layoutPlan ? flattenLayers(layoutPlan.layers) : [];

  const textLayers = layers.filter((l) => l.type === 'text');
  const imageLayers = layers.filter((l) => l.type === 'image');
  const logoLayer = layers.find((l) => l.type === 'logo');
  const backgroundLayer = layers.find((l) => l.type === 'background');

  // Unique font requirements derivable from the layout plan's text layers.
  const fontMap = new Map<string, { fontFamily: string; fontWeight: string; fontSizes: number[] }>();
  for (const layer of textLayers) {
    const tp = layer.textProperties;
    if (!tp) continue;
    const key = `${tp.fontFamily}::${tp.fontWeight}`;
    const entry = fontMap.get(key) ?? { fontFamily: tp.fontFamily, fontWeight: tp.fontWeight, fontSizes: [] };
    if (!entry.fontSizes.includes(tp.fontSize)) entry.fontSizes.push(tp.fontSize);
    fontMap.set(key, entry);
  }

  // Brand colors: from the approved DesignDNA's color usage rules when present
  // (the only fetchable brand-color model in the codebase today) — else null.
  const brandColors = designDna
    ? [...new Set(designDna.colorUsageRules.flatMap((rule) => rule.colors ?? []))]
    : null;
  const resolvedBrandColors = brandColors && brandColors.length > 0 ? brandColors : null;

  // Existing (pre-8C) canvas derivation, preserved exactly for back-compat —
  // only the final null case is hardened: instead of null it now falls back
  // to the same resolvedCanvas the rest of the manifest already agreed on.
  const canvas = layoutPlan
    ? layoutPlan.canvas
    : output.dimensions
      ? { width: output.dimensions.width, height: output.dimensions.height }
      : resolvedCanvas;

  // Step 8C — orientation/aspectRatio derived from whichever canvas won above.
  // canvas is never null now, so these are always computable, but the guard
  // is kept for defensive safety against a malformed (zero-size) canvas.
  const hasValidCanvasSize = !!canvas && canvas.width > 0 && canvas.height > 0;
  const orientation: 'portrait' | 'landscape' | 'square' | 'unknown' = !hasValidCanvasSize
    ? 'unknown'
    : canvas.width === canvas.height
      ? 'square'
      : canvas.width > canvas.height
        ? 'landscape'
        : 'portrait';
  const aspectRatio = hasValidCanvasSize ? Math.round((canvas.width / canvas.height) * 10000) / 10000 : null;

  // Step 8C — background fill policy. Per docs/photoshop-automation-plan.md's
  // LayoutPlan->PSD layer table, a `background` layer means "fill color or
  // gradient" (a full-bleed photo belongs to a separate `image` layer, not
  // `background`) — so this only describes solid-fill intent, never invents
  // an image-background concept that doesn't exist in the schema.
  const backgroundPolicy = backgroundLayer
    ? backgroundLayer.shapeProperties?.fillColor
      ? `solid_color:${backgroundLayer.shapeProperties.fillColor}`
      : layoutPlan?.canvas.backgroundColor
        ? `solid_color:${layoutPlan.canvas.backgroundColor}`
        : 'background_layer_present_fill_unspecified'
    : 'unspecified';

  // Existing (pre-8C) export expectations, preserved exactly for back-compat.
  const exportExpectations = layoutPlan?.exportSettings ?? { formats: ['png'], quality: 90, scaleFactor: 1 };
  // Step 8C — same data, reshaped into one row per format for a renderer that
  // wants to iterate variants rather than parse a formats[] array itself.
  const exportVariants = exportExpectations.formats.map((format) => ({
    format,
    quality: exportExpectations.quality,
    scaleFactor: exportExpectations.scaleFactor,
  }));

  // Forward-compatibility block for a future automated renderer — documents
  // where the machine-consumable layer data lives. No render-engine logic is
  // implemented anywhere yet; this is a pointer, not an adapter.
  const rendererCompatibilityHints = {
    layerDataLocation: 'manifest.layoutPlanSnapshot.layers',
    layerSchema: 'LayerSchema in @grafista/schemas (packages/schemas/src/layout.ts) — position/zIndex/type + per-type properties',
    layerCount: layers.length,
    layerTypesPresent: [...new Set(layers.map((l) => l.type))],
    canvasLocation: 'manifest.layoutPlanSnapshot.canvas',
    note:
      'Any future automatic template renderer (Photoshop-based or otherwise) should build the final asset ' +
      'from these layers, then validate against this contract.',
  };

  return {
    contractVersion: CONTRACT_VERSION,

    canvas,

    // Step 8C additions — derived purely from `canvas` above, additive only.
    orientation,
    aspectRatio,
    // No bleed concept exists anywhere in this codebase's LayoutPlan (checked
    // docs/photoshop-automation-plan.md and layout.ts) — explicit null rather
    // than inventing a value, until a real bleed field exists to read from.
    bleed: null,
    backgroundPolicy,

    // Target channel/format (e.g. 'instagram_story') as recorded on the layout plan.
    targetFormats: layoutPlan ? [layoutPlan.format] : [],

    // Areas to keep clear of critical content (platform UI overlays etc).
    safeZones: layoutPlan?.safeZones ?? [],

    brandColors: resolvedBrandColors,
    // Step 8C alias — same value, clearer name for a future renderer that
    // thinks in terms of a palette rather than "brand colors" specifically.
    colorPalette: resolvedBrandColors,

    fontRequirements: [...fontMap.values()],

    // Every text layer is a slot the final design must fill (content is the
    // AI-planned copy; the production designer may refine, not drop).
    textSlots: textLayers.map((l) => ({
      layerId: l.id,
      name: l.name,
      content: l.textProperties?.content ?? null,
      maxLines: l.textProperties?.maxLines ?? null,
      position: l.position,
    })),

    imageSlots: imageLayers.map((l) => ({
      layerId: l.id,
      name: l.name,
      sourceType: l.imageProperties?.sourceType ?? null,
      aiPrompt: l.imageProperties?.aiPrompt ?? null,
      position: l.position,
    })),

    logoSlot: logoLayer
      ? { layerId: logoLayer.id, name: logoLayer.name, position: logoLayer.position }
      : (layoutPlan?.logoPlacement ?? null),

    // What the eventual export step (once an automatic renderer lands) is
    // expected to produce — straight from the layout plan's export settings.
    exportExpectations,
    // Step 8C alias — same data, array-of-variants shape.
    exportVariants,

    manualProductionNotes:
      'Rebuild the referenced AI preview visual as a production-grade design. ' +
      'Respect canvas size, safe zones, text/image/logo slots and font requirements above. ' +
      'The AI preview (sourceVisualReference in the manifest) is the visual target; ' +
      'the layout plan snapshot is the structural source of truth.',

    // Back-compat (Step 8A/8B key, same content shape) — kept because the
    // existing test suite asserts on this exact key.
    futurePhotoshopAdapterHints: rendererCompatibilityHints,
    // Step 8C canonical name going forward — same informational content,
    // reworded so a human designer AND a future automatic renderer (any
    // engine, not just Photoshop) are equally valid audiences.
    rendererCompatibilityHints,
  };
}

/** Markdown instructions for the human production designer — embedded as a
 * manifest field (single-artifact choice, see module header).
 *
 * Step 8C: reworded to be renderer-agnostic — the main body speaks to "a
 * human designer or a future automatic renderer" rather than assuming a
 * Photoshop-centric audience. Any Photoshop/PSD-specific pointer is confined
 * to the small optional subsection at the end. */
function buildProductionInstructions(input: {
  output: GeneratedOutput;
  layoutPlan?: LayoutPlan;
  qaReport?: CreativeQAReport;
}): string {
  const { output, layoutPlan, qaReport } = input;
  const lines = [
    '# Production Instructions',
    '',
    'These instructions serve two equally valid audiences: a human production designer ' +
      'rebuilding this design by hand today, or a future automatic template renderer ' +
      'consuming this package programmatically once one exists.',
    '',
    `- **Source visual**: ${output.name} (\`${output.id}\`) — preview via \`${output.fileUrl ?? 'n/a'}\``,
    `- **Canvas**: ${layoutPlan ? `${layoutPlan.canvas.width}x${layoutPlan.canvas.height}px @ ${layoutPlan.canvas.dpi}dpi` : 'see templateContract.canvas'}`,
    `- **Format**: ${layoutPlan?.format ?? 'n/a'}`,
    '',
    '1. Open the source visual as the visual reference.',
    '2. Rebuild it per `templateContract` (slots, fonts, safe zones, export expectations).',
    '3. Apply any outstanding QA fixes listed below before finalizing.',
  ];
  if (qaReport) {
    lines.push('', '## Creative QA notes', `- Summary: ${qaReport.summary ?? 'n/a'}`);
    for (const fix of qaReport.highPriorityFixes ?? []) lines.push(`- [HIGH] ${fix}`);
    for (const fix of qaReport.mediumPriorityFixes ?? []) lines.push(`- [MEDIUM] ${fix}`);
  }
  if (layoutPlan?.designerNotes) {
    lines.push('', '## Designer notes', layoutPlan.designerNotes);
  }
  lines.push(
    '',
    '## Optional Photoshop/PSD handoff notes',
    'This section only applies if a Photoshop-based workflow is used for this specific handoff — it is not ' +
      'required reading otherwise. See `templateContract.rendererCompatibilityHints` for the layer-data ' +
      'pointer, layer schema location, layer count and layer types present — the same information any other ' +
      'automatic renderer would also need.'
  );
  return lines.join('\n');
}

/**
 * Step 8C — deterministic, no-AI checklist summarizing what's actually
 * available in this package. Every entry is derived from data already fetched
 * for the manifest; nothing here is inferred beyond presence/absence checks.
 */
function buildQualityChecklist(input: {
  layoutPlan?: LayoutPlan;
  qaReport?: CreativeQAReport;
  designDna?: DesignDNA;
  templateContract: Record<string, unknown>;
}): QualityChecklistEntry[] {
  const { layoutPlan, qaReport, designDna, templateContract } = input;
  const fontRequirements = Array.isArray(templateContract.fontRequirements)
    ? (templateContract.fontRequirements as unknown[])
    : [];

  return [
    { item: 'Layout plan present', status: layoutPlan ? 'ok' : 'missing' },
    { item: 'Creative QA report present', status: qaReport ? 'ok' : 'missing' },
    { item: 'Brand/DesignDNA present', status: designDna ? 'ok' : 'missing' },
    { item: 'Font requirements resolved', status: fontRequirements.length > 0 ? 'ok' : 'missing' },
  ];
}

/**
 * Builds (or returns the existing active) production job for a generated output.
 *
 * Flow: production gate (409 unless the output's status is 'generated') ->
 * idempotency check (existing active job returned as-is) -> job row 'pending'
 * -> 'packaging' -> manifest + template contract -> ONE JSON package in object
 * storage -> job 'package_ready' (storage coords + DB snapshots). Any packaging
 * failure marks the job 'failed' with error_message and rethrows.
 */
export async function buildProductionPackage(generatedOutputId: string, requestedBy: string): Promise<ProductionJob> {
  // DOMAIN GUARD then GATE — the first two awaits, in that order (403 before
  // 404/409, mirroring how engine.ts checks bindingPermission() before
  // executing a step); nothing below runs for an unauthorized requester or a
  // non-'generated' output.
  await assertRequesterMayCreateProductionJobs(requestedBy);
  await assertGeneratedOutputReadyForProduction(generatedOutputId);

  console.log(
    `[production-package] build requested — generatedOutputId=${generatedOutputId} requestedBy=${requestedBy}`
  );

  const output = await store.generatedOutputs.getById(generatedOutputId);
  if (!output) {
    // The gate just saw it; this only fires on a concurrent delete.
    throw notFound('Generated output not found');
  }
  // Phase 3 Step 4 — client isolation hardening.
  await assertClientAccessible(requestedBy, output.clientId);

  // IDEMPOTENCY — one active job per generated output: re-sending the same
  // visual to production returns the existing job instead of duplicating work.
  const existing = await store.productionJobs.findActiveByGeneratedOutput(generatedOutputId);
  if (existing) {
    console.log(
      `[production-package] active job already exists — returning it (jobId=${existing.id} status=${existing.status})`
    );
    return existing;
  }

  // Layout plan is expected but not guaranteed (layout_plan_id is nullable on
  // generated_outputs) — the contract degrades to output dimensions without it.
  const layoutPlan = output.layoutPlanId ? await store.layoutPlans.getById(output.layoutPlanId) : undefined;

  // Best-effort context — packaging must not hard-fail when these are absent.
  const qaReport = output.creativeQaReportId
    ? await store.creativeQaReports.getById(output.creativeQaReportId)
    : undefined;
  const designDna = await store.designDna.getApprovedByClientId(output.clientId);

  const job = await store.productionJobs.create({
    id: uuid(),
    clientId: output.clientId,
    generatedOutputId: output.id,
    layoutPlanId: output.layoutPlanId,
    status: 'pending',
    generationMethod: GENERATION_METHOD,
    requestedBy,
  });

  await store.productionJobs.updateStatus(job.id, 'packaging');

  try {
    // Step 8C — validation BEFORE anything is written to storage. Both id and
    // name are non-optional on GeneratedOutputSchema, so this should be
    // unreachable via normal API traffic — it's a defensive last check, and
    // it reuses the exact same failure-persistence path as every other error
    // in this try block (job marked 'failed' with error_message below).
    assertOutputIsPackageable(output);

    const { canvas: resolvedCanvas, canvasSource } = resolveCanvas(output, layoutPlan);

    const templateContract = buildTemplateContract({ output, layoutPlan, designDna, resolvedCanvas });
    const qualityChecklist = buildQualityChecklist({ layoutPlan, qaReport, designDna, templateContract });
    const instructions = buildProductionInstructions({ output, layoutPlan, qaReport });

    // Shared section, referenced under BOTH the legacy key (`generatedOutput`)
    // and the Step 8C canonical key (`selectedVisual`) — same object, no
    // functional difference, purely a naming migration aid.
    const selectedVisualSection = {
      id: output.id,
      name: output.name,
      mimeType: output.mimeType ?? null,
      fileSizeBytes: output.fileSizeBytes ?? null,
      dimensions: output.dimensions ?? null,
      // Authenticated API route — never a raw storage URL (file-service convention).
      fileUrl: output.fileUrl ?? null,
      storage: {
        provider: output.storageProvider ?? null,
        bucket: output.storageBucket ?? null,
        key: output.storageKey ?? null,
      },
    };

    const manifest: Record<string, unknown> = {
      // ─── Versioning ───
      manifestVersion: MANIFEST_VERSION,
      // Step 8C canonical name going forward — same value as manifestVersion.
      packageVersion: MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      productionJobId: job.id,
      clientId: output.clientId,

      // ─── Step 8C — explicit job + relationship metadata (additive) ───
      job: {
        id: job.id,
        clientId: output.clientId,
        generatedOutputId: output.id,
        layoutPlanId: output.layoutPlanId ?? null,
        requestedBy,
        createdAt: job.createdAt,
      },
      relationships: {
        clientId: output.clientId,
        generatedOutputId: output.id,
        layoutPlanId: output.layoutPlanId ?? null,
      },

      // Back-compat name (Step 8A/8B) — the existing test suite asserts on
      // `storedManifest.generatedOutput.id`.
      generatedOutput: selectedVisualSection,
      // Step 8C canonical name going forward — identical data.
      selectedVisual: selectedVisualSection,

      // The authenticated preview route the production designer opens to see
      // the visual target.
      sourceVisualReference: output.fileUrl ?? null,

      layoutPlanSnapshot: layoutPlan ?? null,
      // Step 8C alias — identical data, clearer name.
      layoutSnapshot: layoutPlan ?? null,

      creativeQaSnapshot: qaReport ?? null,
      // Step 8C alias (exact casing requested) — identical data.
      creativeQASnapshot: qaReport ?? null,

      // Approved DesignDNA is the codebase's fetchable brand model (there is no
      // separate brand-snapshot table) — null when the client has none approved.
      brandSnapshot: designDna ?? null,
      // Step 8C alias — there is currently no separate brand-profile model
      // beyond DesignDNA, so both keys point at the same source until one
      // exists; kept as two distinct keys per the Step 8C spec's wording.
      designDNASnapshot: designDna ?? null,

      templateContract,

      // Step 8C — which source produced templateContract.canvas, so a
      // fallback default is always traceable rather than silently guessed.
      canvasSource,

      // Step 8C — deterministic, no-AI-call checklist of what's available.
      qualityChecklist,

      // Embedded markdown (single-artifact choice — see module header).
      productionInstructions: instructions,
      // Step 8C canonical name going forward — identical markdown, reworded
      // to be renderer-agnostic (see buildProductionInstructions).
      manualHandoffNotes: instructions,
    };

    const body = Buffer.from(JSON.stringify(manifest, null, 2));

    // Same never-persist-metadata-on-storage-failure contract as
    // visual-generation.ts: putObject throws StorageError on any failure,
    // which the catch below records as a 'failed' job.
    const storageProvider = getStorageProvider();
    const stored = await storageProvider.putObject({
      key: `production-jobs/${output.clientId}/${job.id}/packages/production-package.json`,
      body,
      contentType: PACKAGE_MIME_TYPE,
    });

    const ready = await store.productionJobs.updateStatus(job.id, 'package_ready', {
      packageStorageProvider: stored.provider,
      packageStorageBucket: stored.bucket,
      packageStorageKey: stored.key,
      packageMimeType: PACKAGE_MIME_TYPE,
      packageSizeBytes: body.length,
      packageManifestSnapshot: manifest,
      templateContractSnapshot: templateContract,
    });

    if (!ready) {
      throw new Error(`Production job ${job.id} disappeared while packaging`);
    }

    console.log(
      `[production-package] package ready — jobId=${ready.id} key=${stored.key} sizeBytes=${body.length}`
    );

    // Phase 3 Step 6A — analytics event (best-effort).
    await store.analyticsEvents.recordBestEffort({
      clientId: ready.clientId,
      entityType: 'production_job',
      entityId: ready.id,
      eventType: 'production_package_created',
      actorUserId: requestedBy,
      status: ready.status,
      metadata: { sizeBytes: body.length },
    });

    return ready;
  } catch (err) {
    // FAILURES ARE PERSISTED (visual-generation.ts contract): the job row is
    // marked 'failed' with the error before the error propagates.
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[production-package] packaging FAILED — jobId=${job.id} error=${errorMessage}`);
    await store.productionJobs.updateStatus(job.id, 'failed', { errorMessage });
    throw err;
  }
}
