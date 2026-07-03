/**
 * Grafista AI Studio — Production Package Builder (Phase 2 Step 8A)
 *
 * Pipeline stage: approved/generated visual (generated_outputs row, status
 * 'generated') -> production_jobs row -> ONE combined JSON package (manifest +
 * template contract) in object storage. The package is everything a human
 * production designer needs to rebuild the AI preview as a final deliverable —
 * and its `templateContract.futurePhotoshopAdapterHints` block is shaped so a
 * future Photoshop worker can consume the same package without a new format.
 * NO Photoshop/PSD logic exists here — this is packaging only.
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
 * The domain-level permission guard (assertRequesterMayCreateProductionJobs)
 * and the production gate (assertGeneratedOutputReadyForProduction) are the
 * FIRST awaits — no code path can touch job/storage state for an unauthorized
 * requester or a non-'generated' output (mirrors runVisualGeneration's gate
 * placement plus engine.ts's independent bindingPermission() check).
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

const MANIFEST_VERSION = 1;
const CONTRACT_VERSION = 1;
const GENERATION_METHOD = 'manual_package_builder';
const PACKAGE_MIME_TYPE = 'application/json';
const CREATE_PERMISSION = 'production_jobs:create';

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
}): Record<string, unknown> {
  const { output, layoutPlan, designDna } = input;
  const layers = layoutPlan ? flattenLayers(layoutPlan.layers) : [];

  const textLayers = layers.filter((l) => l.type === 'text');
  const imageLayers = layers.filter((l) => l.type === 'image');
  const logoLayer = layers.find((l) => l.type === 'logo');

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

  return {
    contractVersion: CONTRACT_VERSION,

    canvas: layoutPlan
      ? layoutPlan.canvas
      : output.dimensions
        ? { width: output.dimensions.width, height: output.dimensions.height }
        : null,

    // Target channel/format (e.g. 'instagram_story') as recorded on the layout plan.
    targetFormats: layoutPlan ? [layoutPlan.format] : [],

    // Areas to keep clear of critical content (platform UI overlays etc).
    safeZones: layoutPlan?.safeZones ?? [],

    brandColors: brandColors && brandColors.length > 0 ? brandColors : null,

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

    // What the eventual export step (once Photoshop automation lands) is
    // expected to produce — straight from the layout plan's export settings.
    exportExpectations: layoutPlan?.exportSettings ?? { formats: ['png'], quality: 90, scaleFactor: 1 },

    manualProductionNotes:
      'Rebuild the referenced AI preview visual as a production-grade design. ' +
      'Respect canvas size, safe zones, text/image/logo slots and font requirements above. ' +
      'The AI preview (sourceVisualReference in the manifest) is the visual target; ' +
      'the layout plan snapshot is the structural source of truth.',

    // Forward-compatibility block for a future automated Photoshop worker —
    // documents where the machine-consumable layer data lives. No PSD logic
    // is implemented anywhere yet; this is a pointer, not an adapter.
    futurePhotoshopAdapterHints: {
      layerDataLocation: 'manifest.layoutPlanSnapshot.layers',
      layerSchema: 'LayerSchema in @grafista/schemas (packages/schemas/src/layout.ts) — position/zIndex/type + per-type properties',
      layerCount: layers.length,
      layerTypesPresent: [...new Set(layers.map((l) => l.type))],
      canvasLocation: 'manifest.layoutPlanSnapshot.canvas',
      note: 'A future photoshop_worker should build the PSD from these layers, then validate against this contract.',
    },
  };
}

/** Markdown instructions for the human production designer — embedded as a
 * manifest field (single-artifact choice, see module header). */
function buildProductionInstructions(input: {
  output: GeneratedOutput;
  layoutPlan?: LayoutPlan;
  qaReport?: CreativeQAReport;
}): string {
  const { output, layoutPlan, qaReport } = input;
  const lines = [
    '# Production Instructions',
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
  return lines.join('\n');
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
    const templateContract = buildTemplateContract({ output, layoutPlan, designDna });

    const manifest: Record<string, unknown> = {
      manifestVersion: MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      productionJobId: job.id,
      clientId: output.clientId,

      generatedOutput: {
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
      },

      // The authenticated preview route the production designer opens to see
      // the visual target.
      sourceVisualReference: output.fileUrl ?? null,

      layoutPlanSnapshot: layoutPlan ?? null,
      creativeQaSnapshot: qaReport ?? null,
      // Approved DesignDNA is the codebase's fetchable brand model (there is no
      // separate brand-snapshot table) — null when the client has none approved.
      brandSnapshot: designDna ?? null,

      templateContract,

      // Embedded markdown (single-artifact choice — see module header).
      productionInstructions: buildProductionInstructions({ output, layoutPlan, qaReport }),
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
