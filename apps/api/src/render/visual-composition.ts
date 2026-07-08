/**
 * Grafista AI Studio — Generated-Visual Composition Planning (Phase 3 Step 1)
 *
 * Closes friction F8 (docs/manual-demo-pass.md): the render pipeline used to
 * draw every image slot as a gray placeholder box even though the package
 * manifest already carried the selected generated visual's full storage
 * coordinates (`manifest.selectedVisual.storage`, Step 8C). This module is
 * the PURE half of the fix: given the layout plan's layers and an
 * already-loaded visual (as a data URI — render-engine.ts does the storage
 * I/O), it deterministically decides WHICH image slot receives the visual
 * and reports every decision as a structured RenderWarning.
 *
 * Design rules (all deliberate, all covered by tests):
 *  * Only `type: 'image'` layers are candidates — never 'logo' (a brand logo
 *    slot must not be silently replaced by an AI visual) and never
 *    'background'/'shape' (those render as color fills, not <img>).
 *  * Every image slot WITHOUT an already-usable http(s) sourceUrl is
 *    injectable, whatever its sourceType — verified against real AI-generated
 *    layout plans, which freely label the hero slot 'uploaded' even though
 *    nothing was ever uploaded (the Flavora demo layout does exactly this).
 *    A slot with a working sourceUrl is NEVER overridden.
 *  * Exactly ONE primary slot receives the visual (the manifest carries one
 *    selected visual). Primary selection is fully deterministic:
 *    'ai_generated' slots outrank 'placeholder'/bare slots, which outrank
 *    'uploaded'/'stock' ones, then larger area, then lower zIndex, then
 *    lexicographically smaller layer id.
 *  * This module NEVER fails a render — every degenerate case (no injectable
 *    slots, extra unmapped slots, aspect mismatch) degrades to a documented
 *    RenderWarning, same contract as html-renderer.ts / render-quality.ts.
 *
 * Phase 2 render fix (Option A, ADDITIVE): the one degenerate case that USED to
 * silently discard a perfectly good visual — a layout with NO image slot at all
 * (`imageSlots.length === 0`, the pipeline default's background/headline/logo
 * layout) — now returns `fullCanvasVisual` instead. The renderer draws that
 * visual full-bleed as the whole creative and suppresses the template's own
 * layers, fixing the empty-white / gray-placeholder / white-on-white output
 * (friction F8). A layout WITH a usable image slot is unaffected: it still goes
 * through normal per-slot compositing via `imageSources`.
 */

import type { Layer, RenderWarning } from '@grafista/schemas';
import { flattenLayers } from './html-renderer.js';

/** Loose shape of `manifest.selectedVisual` / `manifest.generatedOutput` (see
 * production-package-builder.ts's selectedVisualSection) — the manifest
 * snapshot is a Record<string, unknown>, so every field is treated as
 * possibly absent/null. */
export interface SelectedVisualSection {
  id?: string;
  name?: string;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  dimensions?: { width?: number; height?: number } | null;
  fileUrl?: string | null;
  storage?: {
    provider?: string | null;
    bucket?: string | null;
    key?: string | null;
  } | null;
}

/** The visual render-engine.ts loaded from storage, ready to embed. */
export interface LoadedVisual {
  /** `data:<mime>;base64,...` — self-contained, so Playwright's setContent() page needs no auth/network. */
  dataUri: string;
  mimeType: string;
  sizeBytes: number;
  dimensions?: { width?: number; height?: number } | null;
}

export interface VisualCompositionPlan {
  /** layerId -> image source to inject (currently at most one entry: the primary slot). */
  imageSources: Record<string, string>;
  /**
   * Phase 2 render fix (Option A) — set to the loaded visual's data URI when
   * the layout has NO usable image slot to receive it. In that case the
   * generated visual IS the finished creative (an MVP layout like the pipeline
   * default carries only background + headline + logo, no image layer), so the
   * renderer must draw it full-bleed as the entire canvas and suppress the
   * template's own layers (see html-renderer.ts). Never set when a real image
   * slot exists — normal per-slot compositing (`imageSources`) is used then.
   */
  fullCanvasVisual?: string;
  warnings: RenderWarning[];
}

const HTTP_URL_RE = /^https?:\/\//i;

/** Primary-slot preference by sourceType — lower ranks first. A bare image
 * layer with no imageProperties counts as an empty placeholder slot. */
const SOURCE_TYPE_RANK: Record<string, number> = {
  ai_generated: 0,
  placeholder: 1,
  uploaded: 2,
  stock: 2,
};

/**
 * Reads the selected-visual section out of a package manifest snapshot,
 * preferring the Step 8C canonical key (`selectedVisual`) and falling back to
 * the legacy alias (`generatedOutput`). Returns null when neither exists
 * (e.g. a pre-Step-8C manifest) — backward compatible, never throws.
 */
export function extractSelectedVisual(
  manifestSnapshot: Record<string, unknown> | undefined | null
): SelectedVisualSection | null {
  const section = manifestSnapshot?.selectedVisual ?? manifestSnapshot?.generatedOutput;
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return null;
  }
  return section as SelectedVisualSection;
}

function hasUsableHttpSource(layer: Layer): boolean {
  const sourceUrl = layer.imageProperties?.sourceUrl?.trim();
  return !!sourceUrl && HTTP_URL_RE.test(sourceUrl);
}

/** An image slot is injectable unless it already has a working http(s) source. */
function isInjectable(layer: Layer): boolean {
  return !hasUsableHttpSource(layer);
}

function area(layer: Layer): number {
  return layer.position.width * layer.position.height;
}

function sourceTypeRank(layer: Layer): number {
  return SOURCE_TYPE_RANK[layer.imageProperties?.sourceType ?? 'placeholder'] ?? 2;
}

/**
 * Deterministic primary-slot ordering: sourceType preference first
 * (ai_generated > placeholder/bare > uploaded/stock), then larger area, then
 * lower zIndex, then smaller layer id (plain code-unit comparison, NOT
 * localeCompare — locale-independent determinism).
 */
function comparePrimaryCandidates(a: Layer, b: Layer): number {
  const rankDiff = sourceTypeRank(a) - sourceTypeRank(b);
  if (rankDiff !== 0) return rankDiff;
  const areaDiff = area(b) - area(a);
  if (areaDiff !== 0) return areaDiff;
  if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Plans how the loaded generated visual maps onto the layout plan's image
 * slots. Pure and deterministic — same input always yields the same plan.
 * Never throws; every non-ideal case degrades to a RenderWarning.
 */
export function planVisualComposition(input: { layers: Layer[]; visual: LoadedVisual }): VisualCompositionPlan {
  const { layers, visual } = input;
  const warnings: RenderWarning[] = [];
  const imageSources: Record<string, string> = {};

  const imageSlots = flattenLayers(layers).filter((layer) => layer.visible !== false && layer.type === 'image');

  if (imageSlots.length === 0) {
    // Option A (Phase 2 render fix) — no image slot exists to receive the
    // generated visual, so it cannot be composited into a template slot. But a
    // real visual DID load, and for MVP layouts that carry no image layer at
    // all (the pipeline default: background + headline + logo) that visual is
    // itself the finished creative. Signal the renderer to draw it full-bleed
    // as the entire canvas — rather than discarding it and leaving the
    // template's own layers to render as a broken white-on-white headline over
    // a gray placeholder box on an otherwise empty white canvas (friction F8).
    warnings.push({
      code: 'full_canvas_visual_fallback',
      message:
        'Layout plan has no image slot — the generated visual is rendered full-bleed as the final creative; template overlays are suppressed to avoid duplication',
      severity: 'warning',
      details: { sizeBytes: visual.sizeBytes, mimeType: visual.mimeType },
    });
    return { imageSources, fullCanvasVisual: visual.dataUri, warnings };
  }

  const injectable = imageSlots.filter(isInjectable).sort(comparePrimaryCandidates);

  if (injectable.length === 0) {
    warnings.push({
      code: 'image_slot_unmapped',
      message:
        'No image slot could accept the generated visual — every image slot already carries its own usable source URL',
      severity: 'warning',
      details: { imageSlotCount: imageSlots.length },
    });
    return { imageSources, warnings };
  }

  const primary = injectable[0];
  imageSources[primary.id] = visual.dataUri;

  warnings.push({
    code: 'selected_visual_loaded',
    message: `Generated visual (${visual.mimeType}, ${visual.sizeBytes} bytes) was composited into image slot "${primary.name}"`,
    layerId: primary.id,
    severity: 'info',
    details: { sizeBytes: visual.sizeBytes, mimeType: visual.mimeType, slotName: primary.name },
  });

  // Aspect-ratio heads-up (info only): with the slot's object-fit the crop is
  // predictable, but a reviewer should know the source and slot proportions
  // differ. Only possible when the manifest recorded the visual's dimensions.
  const vw = visual.dimensions?.width;
  const vh = visual.dimensions?.height;
  if (typeof vw === 'number' && typeof vh === 'number' && vw > 0 && vh > 0) {
    const slotRatio = primary.position.width / primary.position.height;
    const visualRatio = vw / vh;
    if (Math.abs(slotRatio - visualRatio) / visualRatio > 0.02) {
      const fit = primary.imageProperties?.fit ?? 'cover';
      warnings.push({
        code: 'selected_visual_aspect_mismatch',
        message:
          `Generated visual is ${vw}x${vh} but its slot is ${primary.position.width}x${primary.position.height} — ` +
          `object-fit:${fit} will crop/letterbox predictably`,
        layerId: primary.id,
        severity: 'info',
        details: {
          visualWidth: vw,
          visualHeight: vh,
          slotWidth: primary.position.width,
          slotHeight: primary.position.height,
          fit,
        },
      });
    }
  }

  // Only the primary slot receives the (single) selected visual — every other
  // injectable slot stays a placeholder, loudly.
  for (const extra of injectable.slice(1)) {
    warnings.push({
      code: 'image_slot_unmapped',
      message: `Image slot "${extra.name}" remains a placeholder — only the primary slot receives the generated visual`,
      layerId: extra.id,
      severity: 'warning',
      details: { primaryLayerId: primary.id },
    });
  }

  return { imageSources, warnings };
}
