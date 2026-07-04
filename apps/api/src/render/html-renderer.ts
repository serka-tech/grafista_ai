/**
 * Grafista AI Studio — Template Render Engine: HTML/CSS Renderer (Phase 2 Step 9A)
 *
 * Consumes the layer data any production package points at
 * (`manifest.layoutPlanSnapshot.layers` / `.canvas`, per
 * production-package-builder.ts's `rendererCompatibilityHints`) and produces
 * ONE self-contained HTML document that a browser (Playwright in production,
 * nothing in unit tests) can render to a pixel-accurate PNG/JPG/PDF. This
 * module only builds markup/CSS strings — it never touches the network, the
 * filesystem, or a real browser.
 *
 * MVP scope, documented rather than silently assumed:
 *  * Every layer is treated as `position.x/y` = canvas-relative top-left
 *    coordinates. Anchor-based repositioning (`position.anchor !== 'top-left'`)
 *    is NOT implemented — the layer still renders at x/y unchanged, and a
 *    `anchor_ignored` warning is recorded instead of silently mispositioning
 *    or throwing.
 *  * All AI-generated freeform strings that would otherwise land inside
 *    HTML/CSS (text content, font family, color, blend mode, filter) are
 *    validated or escaped before interpolation — an unrecognized value never
 *    reaches the output raw; it is replaced with a safe default and recorded
 *    as a `RenderWarning` instead.
 *  * Every warning this module raises is additive (see RenderWarningSchema
 *    in packages/schemas/src/render-job.ts) — a render is never "silently
 *    wrong", it degrades to a documented default and reports what happened.
 *
 * Phase 2 Step 9B: every warning pushed below now also sets `severity`
 * ('warning' for all of them — every MVP limitation this module degrades
 * from is a real, visible deviation from the requested design, never merely
 * informational). No warning `code` was renamed: in particular, `invalid_color`
 * (from safeColor()) IS this module's answer to the Step 9B spec's
 * "invalid_color_fallback" requirement — same event, existing code kept.
 */

import type { Layer, RenderWarning } from '@grafista/schemas';
import { buildGoogleFontsLinkTag, resolveFont } from './font-resolver.js';

export interface RenderableCanvas {
  width: number;
  height: number;
  backgroundColor?: string;
}

export interface HtmlRenderResult {
  html: string;
  warnings: RenderWarning[];
}

/** Valid CSS `mix-blend-mode` keywords — anything else falls back to 'normal' with a warning. */
const VALID_BLEND_MODES = new Set([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

/** Small set of CSS named colors accepted by safeColor() alongside hex/rgb()/hsl(). */
const SAFE_NAMED_COLORS = new Set(['transparent', 'black', 'white', 'red', 'blue', 'green', 'gray', 'grey']);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const RGB_COLOR_RE = /^rgba?\([\d\s.,%]+\)$/;
const HSL_COLOR_RE = /^hsla?\([\d\s.,%]+\)$/;

/** CSS font-weight values this MVP accepts: a bare 3-digit number, or one of the standard keywords. */
const FONT_WEIGHT_RE = /^\d{3}$|^(normal|bold|lighter|bolder)$/i;

const HTTP_URL_RE = /^https?:\/\/.+/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Flattens the (possibly nested via `children`) layer tree into one list, in
 * traversal order (parent before its children). This is a renderer-local
 * copy of the equivalent helper in production-package-builder.ts, which does
 * not export it — deliberately duplicated rather than imported, per the
 * task's scope boundary (this module must not reach into that service).
 *
 * Exported (Phase 2 Step 9B) so ../render-quality.ts can reuse the exact
 * same traversal/order for its own pre-render QA pass over the same layers —
 * a one-line `export` addition, not a refactor.
 */
export function flattenLayers(layers: Layer[]): Layer[] {
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
 * Validates a color string against a small allow-list of safe CSS color
 * shapes: `#rgb`/`#rrggbb`/`#rrggbbaa` hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`,
 * or one of a handful of named colors. An unvalidated, AI-generated string is
 * NEVER interpolated into a `style` attribute — anything that doesn't match
 * falls back to the given default and reports an `invalid_color` warning.
 * `undefined` (the field was simply not set) is not itself "invalid" and
 * resolves to the fallback silently.
 */
export function safeColor(value: string | undefined, fallback: string): { color: string; warning?: RenderWarning } {
  if (value === undefined) {
    return { color: fallback };
  }
  const trimmed = value.trim();
  if (
    HEX_COLOR_RE.test(trimmed) ||
    RGB_COLOR_RE.test(trimmed) ||
    HSL_COLOR_RE.test(trimmed) ||
    SAFE_NAMED_COLORS.has(trimmed.toLowerCase())
  ) {
    return { color: trimmed };
  }
  return {
    color: fallback,
    warning: {
      code: 'invalid_color',
      message: `Color "${value}" is not a recognized safe color, falling back to "${fallback}"`,
      severity: 'warning',
    },
  };
}

/** Builds the absolutely-positioned markup for one already-flattened, visible layer. */
function buildLayerHtml(layer: Layer, canvas: RenderableCanvas, warnings: RenderWarning[]): string {
  const withLayerId = (warning: RenderWarning): RenderWarning => ({ ...warning, layerId: layer.id });

  if (layer.position.anchor !== 'top-left') {
    warnings.push(
      withLayerId({
        code: 'anchor_ignored',
        message: `Anchor "${layer.position.anchor}" is not supported in this MVP renderer — rendered at x/y unchanged`,
        severity: 'warning',
      })
    );
  }

  let blendMode = layer.blendMode;
  if (!VALID_BLEND_MODES.has(blendMode)) {
    warnings.push(
      withLayerId({
        code: 'unsupported_blend_mode',
        message: `blendMode "${blendMode}" is not supported, falling back to normal`,
        severity: 'warning',
      })
    );
    blendMode = 'normal';
  }

  const baseStyles: string[] = [
    'position:absolute',
    `left:${layer.position.x}px`,
    `top:${layer.position.y}px`,
    `width:${layer.position.width}px`,
    `height:${layer.position.height}px`,
    `z-index:${layer.zIndex}`,
    `opacity:${layer.opacity}`,
    `mix-blend-mode:${blendMode}`,
  ];
  if (layer.position.rotation !== 0) {
    baseStyles.push(`transform: rotate(${layer.position.rotation}deg)`);
  }

  switch (layer.type) {
    case 'text': {
      const tp = layer.textProperties;
      const content = escapeHtml(tp?.content ?? '');

      const fontResolution = resolveFont(tp?.fontFamily ?? '');
      if (fontResolution.fallbackApplied) {
        warnings.push(
          withLayerId({
            code: 'font_fallback',
            message: `Font "${fontResolution.requestedFont}" not in whitelist, using ${fontResolution.resolvedFont}`,
            severity: 'warning',
          })
        );
      }

      const styles = [...baseStyles, `font-family:'${fontResolution.resolvedFont}', sans-serif`];
      if (tp?.fontSize !== undefined) styles.push(`font-size:${tp.fontSize}px`);

      const requestedWeight = tp?.fontWeight ?? '400';
      let fontWeight = requestedWeight;
      if (!FONT_WEIGHT_RE.test(requestedWeight)) {
        warnings.push(
          withLayerId({
            code: 'invalid_font_weight',
            message: `fontWeight "${requestedWeight}" is not a supported CSS value, falling back to "400"`,
            severity: 'warning',
          })
        );
        fontWeight = '400';
      }
      styles.push(`font-weight:${fontWeight}`);

      const colorResult = safeColor(tp?.color, '#000000');
      if (colorResult.warning) warnings.push(withLayerId(colorResult.warning));
      styles.push(`color:${colorResult.color}`);

      if (tp?.alignment) styles.push(`text-align:${tp.alignment}`);
      if (tp?.lineHeight !== undefined) styles.push(`line-height:${tp.lineHeight}`);
      if (tp?.letterSpacing !== undefined) styles.push(`letter-spacing:${tp.letterSpacing}px`);
      if (tp?.textTransform) styles.push(`text-transform:${tp.textTransform}`);
      if (tp?.maxLines !== undefined) {
        styles.push(
          'display:-webkit-box',
          `-webkit-line-clamp:${tp.maxLines}`,
          '-webkit-box-orient:vertical',
          'overflow:hidden'
        );
      }

      return `<div style="${styles.join('; ')};">${content}</div>`;
    }

    case 'image':
    case 'logo': {
      const ip = layer.imageProperties;
      const styles = [...baseStyles];
      if (ip?.fit) styles.push(`object-fit:${ip.fit}`);
      if (ip?.borderRadius !== undefined) styles.push(`border-radius:${ip.borderRadius}px`);

      if (ip?.filter) {
        warnings.push(
          withLayerId({
            code: 'unsupported_filter',
            message: 'Custom filter values are not supported in this MVP',
            severity: 'warning',
          })
        );
      }

      const sourceUrl = ip?.sourceUrl?.trim();
      if (sourceUrl && HTTP_URL_RE.test(sourceUrl)) {
        return `<img src="${escapeHtml(sourceUrl)}" alt="" style="${styles.join('; ')};">`;
      }

      styles.push('background-color:#e5e7eb');
      return `<div style="${styles.join('; ')};"></div>`;
    }

    case 'shape':
    case 'background': {
      const sp = layer.shapeProperties;
      const styles = [...baseStyles];

      if (sp?.fillColor) {
        const result = safeColor(sp.fillColor, 'transparent');
        if (result.warning) warnings.push(withLayerId(result.warning));
        styles.push(`background-color:${result.color}`);
      } else if (layer.type === 'background') {
        const result = safeColor(canvas.backgroundColor, '#ffffff');
        if (result.warning) warnings.push(withLayerId(result.warning));
        styles.push(`background-color:${result.color}`);
      }

      if (sp?.borderRadius !== undefined) styles.push(`border-radius:${sp.borderRadius}px`);
      if (sp?.strokeWidth && sp.strokeWidth > 0) {
        const strokeResult = safeColor(sp.strokeColor, 'black');
        if (strokeResult.warning) warnings.push(withLayerId(strokeResult.warning));
        styles.push(`border:${sp.strokeWidth}px solid ${strokeResult.color}`);
      }

      return `<div style="${styles.join('; ')};"></div>`;
    }

    // icon, overlay, gradient, border, group — no dedicated renderer yet.
    // 'group' is deliberately exempt from the warning: its children have
    // already been flattened and rendered individually, so a group layer
    // itself rendering as an empty positioned box IS the expected degenerate
    // case (it's a container with no own visual affordance, not an
    // "unsupported" type).
    default: {
      const sp = layer.shapeProperties;
      const styles = [...baseStyles];
      if (sp?.fillColor) {
        const result = safeColor(sp.fillColor, 'transparent');
        if (result.warning) warnings.push(withLayerId(result.warning));
        styles.push(`background-color:${result.color}`);
      }
      if (layer.type !== 'group') {
        warnings.push(
          withLayerId({
            code: 'unsupported_layer_type',
            message: `Layer type "${layer.type}" has no dedicated renderer, rendered as empty box`,
            severity: 'warning',
          })
        );
      }
      return `<div style="${styles.join('; ')};"></div>`;
    }
  }
}

/**
 * Builds one self-contained HTML document for the given canvas + layer tree.
 * Nested `children` are flattened first; hidden layers (`visible === false`)
 * are skipped entirely (no DOM node, no warning); the remaining layers are
 * sorted by `zIndex` ascending and rendered in that order, each as an
 * absolutely-positioned box using the same numeric `zIndex` as its CSS
 * `z-index` (so correctness never depends on DOM order alone).
 */
export function buildRenderHtml(input: { canvas: RenderableCanvas; layers: Layer[] }): HtmlRenderResult {
  const { canvas, layers } = input;
  const warnings: RenderWarning[] = [];

  const visibleLayers = flattenLayers(layers)
    .filter((layer) => layer.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  const layerMarkup = visibleLayers.map((layer) => buildLayerHtml(layer, canvas, warnings)).join('\n    ');

  // Canvas-level fill is a convenience base coat only — a 'background'-type
  // layer (validated separately in buildLayerHtml, with its own warning) is
  // rendered on top of it and is the actual documented way to set a fill.
  const canvasBackground = canvas.backgroundColor ? safeColor(canvas.backgroundColor, '#ffffff').color : undefined;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${buildGoogleFontsLinkTag()}
<style>
* { margin:0; padding:0; box-sizing:border-box; }
.canvas { position: relative; width: ${canvas.width}px; height: ${canvas.height}px; overflow: hidden;${
    canvasBackground ? ` background-color: ${canvasBackground};` : ''
  } }
</style>
</head>
<body>
  <div class="canvas">
    ${layerMarkup}
  </div>
</body>
</html>`;

  return { html, warnings };
}
