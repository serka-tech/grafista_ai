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
 * F9 (low-contrast text heuristic) — colour helpers. Best-effort by design:
 * only hex (#rgb/#rrggbb/#rrggbbaa, alpha ignored) and the handful of CSS
 * named colours the renderer's safeColor() accepts are parsed; rgb()/hsl()/
 * transparent/unknown resolve to null so the contrast check SKIPS them rather
 * than guessing (never a false positive on a colour it cannot reason about).
 */
const NAMED_RGB: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  blue: [0, 0, 255],
  green: [0, 128, 0], // CSS 'green' is #008000, not #00ff00
  gray: [128, 128, 128],
  grey: [128, 128, 128],
};

function parseColorToRgb(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v in NAMED_RGB) return NAMED_RGB[v];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (!m) return null; // rgb()/hsl()/transparent/unrecognized → skip, don't guess
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join(''); // expand shorthand
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG relative luminance of an sRGB colour. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1:1 identical … 21:1 black/white). */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The opaque colour a text layer sits ON: the nearest layer BEHIND it (lower in
 * the flattened render order) that is a full-canvas `background` or an
 * overlapping `shape` with a fill. Falls back to the canvas background colour.
 * Returns undefined when no opaque backdrop can be determined (→ skip the check).
 */
function resolveBackgroundColor(
  ordered: Layer[],
  textIndex: number,
  textRect: Rect,
  canvasBackground?: string
): string | undefined {
  for (let i = textIndex - 1; i >= 0; i--) {
    const l = ordered[i];
    if (l.visible === false) continue;
    if (l.type === 'background') return l.shapeProperties?.fillColor ?? canvasBackground;
    if (l.type === 'shape' && l.shapeProperties?.fillColor && rectsIntersect(textRect, l.position)) {
      return l.shapeProperties.fillColor;
    }
  }
  return canvasBackground;
}

/** WCAG AA threshold for large text — headlines/prices, the F9 case, are large. */
const MIN_TEXT_CONTRAST = 3;

/**
 * Runs every heuristic QA check over one already-resolved render input (the
 * PRESET's target canvas + the layout plan's layers/safeZones — the exact
 * same inputs render-engine.ts hands to buildRenderHtml()). Returns
 * additional RenderWarning entries to be appended to the HTML renderer's own
 * warnings; never throws, never fails a render.
 */
export function assessRenderQuality(input: {
  canvas: { width: number; height: number; backgroundColor?: string };
  layers: Layer[];
  safeZones?: SafeZone[];
  /** Phase 3 Step 1 (additive) — layerId -> injected composited source, same map handed to buildRenderHtml(). */
  imageSources?: Record<string, string>;
}): RenderWarning[] {
  const { canvas, layers, safeZones, imageSources } = input;
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

  // 6. low_text_contrast — the F9 "white-on-light unreadable" case. For each
  // visible text layer, compare its colour to the opaque backdrop behind it and
  // warn when the WCAG contrast ratio is below the large-text threshold. Purely
  // a REVIEWER-FACING warning (this module never changes render output) and
  // best-effort: colours it cannot parse (rgb()/hsl()) or backdrops it cannot
  // determine are skipped, never guessed.
  for (let i = 0; i < visibleLayers.length; i++) {
    const layer = visibleLayers[i];
    if (layer.type !== 'text') continue;
    const tp = layer.textProperties;
    if (!tp || !tp.content || tp.content.length === 0) continue;

    const fg = parseColorToRgb(tp.color ?? '#000000'); // html-renderer defaults text to #000000
    if (!fg) continue;
    const backdrop = resolveBackgroundColor(visibleLayers, i, layer.position, canvas.backgroundColor);
    const bg = parseColorToRgb(backdrop);
    if (!bg) continue;

    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_TEXT_CONTRAST) {
      warnings.push({
        code: 'low_text_contrast',
        message: `Text layer "${layer.name}" has low contrast (~${ratio.toFixed(1)}:1) against its background — it may be hard to read`,
        layerId: layer.id,
        severity: 'warning',
        details: {
          contrastRatio: Number(ratio.toFixed(2)),
          threshold: MIN_TEXT_CONTRAST,
          foreground: tp.color ?? '#000000',
          background: backdrop ?? null,
        },
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
