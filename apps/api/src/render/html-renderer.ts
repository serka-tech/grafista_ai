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
 *
 * Phase 3 Step 1 (F8 — render composition polish, ADDITIVE): buildRenderHtml
 * now accepts an optional `imageSources` map (layerId -> injected image
 * source, typically a base64 data URI of the production package's selected
 * generated visual — see ./visual-composition.ts + render-engine.ts). An
 * injected source takes precedence over the layer's own sourceUrl and, unlike
 * sourceUrl, may be a data: URI (it is built server-side from bytes read
 * through the storage abstraction, never from AI-generated freeform text).
 * Layers with neither an injected source nor a valid http(s) sourceUrl keep
 * the exact same gray-placeholder-box behavior as before.
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
  /**
   * Phase 2 render fix (Option A) — true iff this document was built as a
   * single full-bleed generated visual with the template layers suppressed
   * (buildRenderHtml's `fullCanvasVisual` branch). The render engine gates its
   * QA-pass skip on THIS actual outcome rather than re-deriving it from the
   * composition plan, so an invalid/degraded full-canvas source (which falls
   * through to normal layer rendering here) can never silently skip the QA
   * heuristics for the layers it actually rendered. Absent/false on the normal
   * path.
   */
  usedFullCanvas?: boolean;
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

/** Accepted shape for an INJECTED image source only (see buildRenderHtml's
 * `imageSources`): a server-built base64 image data URI. Layer-provided
 * sourceUrl values are still restricted to HTTP_URL_RE. */
const IMAGE_DATA_URI_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-zA-Z0-9+/=]+$/i;

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
function buildLayerHtml(
  layer: Layer,
  canvas: RenderableCanvas,
  warnings: RenderWarning[],
  imageSources?: Record<string, string>
): string {
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

      // Phase 3 Step 1 — an injected source (the composited generated visual,
      // see module header) wins over the layer's own sourceUrl. It must be a
      // base64 image data URI; anything else is ignored (placeholder path
      // below), never interpolated raw.
      const injected = imageSources?.[layer.id]?.trim();
      const sourceUrl = ip?.sourceUrl?.trim();
      const src =
        injected && IMAGE_DATA_URI_RE.test(injected)
          ? injected
          : sourceUrl && HTTP_URL_RE.test(sourceUrl)
            ? sourceUrl
            : undefined;

      if (src) {
        // object-fit only matters on a real <img>; schema default is 'cover'
        // (see ImagePropertiesSchema), applied here too when imageProperties
        // is absent so an injected bare slot still crops predictably.
        styles.push(`object-fit:${ip?.fit ?? 'cover'}`);
        return `<img src="${escapeHtml(src)}" alt="" style="${styles.join('; ')};">`;
      }

      if (ip?.fit) styles.push(`object-fit:${ip.fit}`);
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
 * Option A (Phase 2 render fix) full-canvas render: one self-contained document
 * whose only content is the generated visual, drawn full-bleed
 * (`object-fit:cover`) at the exact target canvas size. No fonts, no template
 * layers, no placeholder boxes — see buildRenderHtml's `fullCanvasVisual`
 * branch for when this path is taken and why the template layers are dropped.
 *
 * An OPAQUE base coat (`canvas.backgroundColor` if given, else white) is placed
 * behind the image so the export never depends on the browser's incidental
 * default background: if the generated visual carries any transparency (a PNG
 * can), those pixels composite over a defined color rather than leaking through
 * to bare white.
 */
function buildFullCanvasHtml(canvas: RenderableCanvas, dataUri: string): HtmlRenderResult {
  const background = safeColor(canvas.backgroundColor, '#ffffff').color;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
.canvas { position: relative; width: ${canvas.width}px; height: ${canvas.height}px; overflow: hidden; background-color: ${background}; }
.canvas > img.full-canvas-visual { position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; }
</style>
</head>
<body>
  <div class="canvas">
    <img class="full-canvas-visual" src="${escapeHtml(dataUri)}" alt="">
  </div>
</body>
</html>`;
  return { html, warnings: [], usedFullCanvas: true };
}

/**
 * Builds one self-contained HTML document for the given canvas + layer tree.
 * Nested `children` are flattened first; hidden layers (`visible === false`)
 * are skipped entirely (no DOM node, no warning); the remaining layers are
 * sorted by `zIndex` ascending and rendered in that order, each as an
 * absolutely-positioned box using the same numeric `zIndex` as its CSS
 * `z-index` (so correctness never depends on DOM order alone).
 *
 * `imageSources` (Phase 3 Step 1, optional/additive): layerId -> injected
 * image source for image/logo layers — see the module header.
 *
 * `fullCanvasVisual` (Phase 2 render fix, Option A, optional/additive): when
 * set to a valid base64 image data URI, the composition planner determined the
 * layout has no usable image slot to receive the generated visual, so that
 * visual IS the finished creative and is rendered full-bleed as the entire
 * canvas — every template layer is suppressed to avoid duplicating the
 * headline/logo already baked into the AI visual (and to avoid the F8 bug: a
 * white-on-white headline over a gray placeholder box on a blank canvas). An
 * invalid value degrades to normal layer rendering with a warning rather than
 * emitting a broken <img>.
 */
export function buildRenderHtml(input: {
  canvas: RenderableCanvas;
  layers: Layer[];
  imageSources?: Record<string, string>;
  fullCanvasVisual?: string;
}): HtmlRenderResult {
  const { canvas, layers, imageSources, fullCanvasVisual } = input;
  const warnings: RenderWarning[] = [];

  if (fullCanvasVisual !== undefined) {
    const trimmed = fullCanvasVisual.trim();
    if (IMAGE_DATA_URI_RE.test(trimmed)) {
      return buildFullCanvasHtml(canvas, trimmed);
    }
    // Never silently wrong: an invalid full-canvas source (should be
    // impossible — render-engine.ts builds it from real bytes) degrades to the
    // normal layer render below with a warning, instead of an empty/broken img.
    warnings.push({
      code: 'full_canvas_visual_invalid',
      message:
        'Full-canvas visual source was not a valid base64 image data URI — falling back to normal template layer rendering',
      severity: 'warning',
    });
  }

  const visibleLayers = flattenLayers(layers)
    .filter((layer) => layer.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  const layerMarkup = visibleLayers
    .map((layer) => buildLayerHtml(layer, canvas, warnings, imageSources))
    .join('\n    ');

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

  return { html, warnings, usedFullCanvas: false };
}
