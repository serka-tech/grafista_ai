/**
 * Grafista AI Studio — Render Quality Heuristics (Phase 2 Step 9B)
 *
 * Pure, deterministic, pre-render QA pass over the same layer/canvas inputs
 * the HTML renderer consumes (see ./html-renderer.ts), plus the layout
 * plan's `safeZones` (see SafeZoneSchema in packages/schemas/src/layout.ts).
 * This module never touches the network, a browser, or the database — every
 * check below only inspects the numbers/strings already present on each
 * layer.
 *
 * IMPORTANT — every check here is a HEURISTIC meant to surface RISK to a
 * human reviewer, not typographic ground truth ("%100 tipografik doğruluk
 * değil, potansiyel risk göstermek" per the Step 9B spec). In particular the
 * text-overflow estimate uses a rough average-glyph-width factor, not real
 * font metrics or DOM measurement — this module has no browser access and
 * must never gain one (that's html-renderer.ts + the Playwright adapter's
 * job, out of scope here).
 */

import type { Layer, RenderWarning, SafeZone } from '@grafista/schemas';
import { flattenLayers } from './html-renderer.js';

/** Rough average glyph width as a fraction of font-size — not real font metrics. */
const AVG_CHAR_WIDTH_FACTOR = 0.55;

/** Default unitless line-height multiplier when a text layer doesn't set one (matches CSS's own default). */
const DEFAULT_LINE_HEIGHT_MULTIPLIER = 1.2;

/** position.width * position.height threshold (~1000x1000px) at/above which a large image slot deserves a resolution reminder. */
const LARGE_IMAGE_AREA_PX = 1_000_000;

/** Same shape check html-renderer.ts's HTTP_URL_RE performs before drawing an <img> instead of a placeholder box. */
const HTTP_URL_RE = /^https?:\/\//i;

type Rect = { x: number; y: number; width: number; height: number };

/** Simple axis-aligned bounding-box intersection test — any overlap > 0 counts (touching edges do not). */
function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Phase 3 Step 1 — a layer counts as "has a usable source" when EITHER its own
 * sourceUrl is a valid http(s) URL OR the render engine injected a composited
 * source for it (`imageSources`, the selected generated visual as a data URI —
 * see ./visual-composition.ts). Without the second check this heuristic would
 * keep raising a false-positive missing_image_source for the very slot the
 * generated visual was just composited into.
 */
function hasUsableImageSource(layer: Layer, imageSources?: Record<string, string>): boolean {
  if (imageSources?.[layer.id]) return true;
  const sourceUrl = layer.imageProperties?.sourceUrl?.trim();
  return !!sourceUrl && HTTP_URL_RE.test(sourceUrl);
}

/**
 * Runs every heuristic QA check over one already-resolved render input (the
 * PRESET's target canvas + the layout plan's layers/safeZones — the exact
 * same inputs render-engine.ts hands to buildRenderHtml()). Returns
 * additional RenderWarning entries to be appended to the HTML renderer's own
 * warnings; never throws, never fails a render.
 */
export function assessRenderQuality(input: {
  canvas: { width: number; height: number };
  layers: Layer[];
  safeZones?: SafeZone[];
  /** Phase 3 Step 1 (additive) — layerId -> injected composited source, same map handed to buildRenderHtml(). */
  imageSources?: Record<string, string>;
}): RenderWarning[] {
  const { layers, safeZones, imageSources } = input;
  const warnings: RenderWarning[] = [];

  const visibleLayers = flattenLayers(layers).filter((layer) => layer.visible !== false);

  // 1. text_overflow_possible — for each visible text layer with non-empty content.
  for (const layer of visibleLayers) {
    if (layer.type !== 'text') continue;
    const tp = layer.textProperties;
    if (!tp || !tp.content || tp.content.length === 0) continue;

    const avgCharWidth = tp.fontSize * AVG_CHAR_WIDTH_FACTOR;
    const charsPerLine = Math.max(1, Math.floor(layer.position.width / avgCharWidth));
    const estimatedLines = Math.ceil(tp.content.length / charsPerLine);

    const lineHeightPx = tp.fontSize * (tp.lineHeight ?? DEFAULT_LINE_HEIGHT_MULTIPLIER);
    const maxLines = tp.maxLines ?? null;
    const capacityLines = tp.maxLines ?? Math.max(1, Math.floor(layer.position.height / lineHeightPx));

    if (estimatedLines > capacityLines) {
      // Two distinct real-world consequences depending on whether maxLines
      // is set: with it, the renderer's -webkit-line-clamp TRUNCATES the
      // overflow (see html-renderer.ts); without it, nothing clips the box,
      // so the text visually SPILLS out of its bounds.
      const message =
        maxLines !== null
          ? `Text content is estimated at ~${estimatedLines} line(s) but maxLines is ${maxLines} — the renderer will TRUNCATE the overflow`
          : `Text content is estimated at ~${estimatedLines} line(s) but its box only fits ~${capacityLines} — the text may SPILL out of its box`;

      warnings.push({
        code: 'text_overflow_possible',
        message,
        layerId: layer.id,
        severity: 'warning',
        details: { estimatedLines, capacityLines, maxLines },
      });
    }
  }

  // 2 & 3. safe_area_warning / safe_area_unavailable — per SafeZoneSchema's
  // own docstring a safe zone is an area to KEEP CLEAR of critical content
  // (platform UI overlays etc), so overlap with one is the violation — the
  // step spec's phrasing ("taşıyorsa" / outside) is interpreted here per
  // that inverse semantic, matching the codebase's own schema comment.
  if (!safeZones || safeZones.length === 0) {
    warnings.push({
      code: 'safe_area_unavailable',
      message: 'Safe-area checks were skipped because the layout plan defines no safe zones',
      severity: 'info',
    });
  } else {
    for (const layer of visibleLayers) {
      if (layer.type !== 'text' && layer.type !== 'logo') continue;
      for (const zone of safeZones) {
        if (rectsIntersect(layer.position, zone.position)) {
          warnings.push({
            code: 'safe_area_warning',
            message: `Layer "${layer.name}" overlaps the "${zone.label}" safe zone — safe zones must be kept clear of critical content`,
            layerId: layer.id,
            severity: 'warning',
            details: { safeZoneLabel: zone.label, layerName: layer.name },
          });
        }
      }
    }
  }

  // 4 & 5. missing_image_source / low_resolution_image_possible — for each
  // visible image/logo layer.
  for (const layer of visibleLayers) {
    if (layer.type !== 'image' && layer.type !== 'logo') continue;
    const ip = layer.imageProperties;

    if (!hasUsableImageSource(layer, imageSources)) {
      warnings.push({
        code: 'missing_image_source',
        message: `Layer "${layer.name}" has no usable image source URL and will render as a placeholder box`,
        layerId: layer.id,
        severity: 'warning',
        details: { sourceType: ip?.sourceType ?? null },
      });
      continue;
    }

    // We cannot know the source image's intrinsic resolution without
    // fetching it (never fetch here) — this only flags "large target slot,
    // verify the source is high-res" as an informational reminder.
    const boxArea = layer.position.width * layer.position.height;
    if (boxArea >= LARGE_IMAGE_AREA_PX) {
      warnings.push({
        code: 'low_resolution_image_possible',
        message: `Layer "${layer.name}" targets a large box (${layer.position.width}x${layer.position.height}) — verify the source image is high-resolution`,
        layerId: layer.id,
        severity: 'info',
        details: { boxWidth: layer.position.width, boxHeight: layer.position.height },
      });
    }
  }

  return warnings;
}
