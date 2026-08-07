import { fontFaceCss } from './fonts.js';
import { rgba, safeColor } from './helpers.js';
import type { TemplateBackground, TemplateInput, TemplateSize } from './types.js';

/**
 * The stylesheet every template shares: reset, scale unit, and the background
 * stack that sits under the text.
 *
 * All of this is CSS we write, which is the point of the rewrite. The old
 * renderer translated a model-authored layer tree into inline styles and could
 * only emit what its schema allowed, so gradients, shadows, blurs and padding
 * were simply unavailable and every design came out as flat boxes. Here the
 * full language is on the table because no model is choosing any of it.
 */

/**
 * One scale unit. Every dimension in a template is expressed in `--u` so a
 * single layout works at 1080x1080, 1080x1920 and 1200x628 without a separate
 * stylesheet per size. Based on the short edge so text never outgrows the
 * narrow dimension.
 */
export function scaleUnitCss(size: TemplateSize): string {
  const unit = Math.min(size.width, size.height) / 1080;
  return `--u:${unit.toFixed(5)};--w:${size.width}px;--h:${size.height}px;`;
}

export function resetCss(): string {
  return `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
html,body{width:var(--w);height:var(--h);overflow:hidden;background:#000;}
body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
.canvas{position:relative;width:var(--w);height:var(--h);overflow:hidden;isolation:isolate;}
.layer{position:absolute;inset:0;}
img{display:block;}
`.trim();
}

/**
 * Background stack, in z order:
 *   0  the image itself, or a brand gradient when no image was generated
 *   1  blur and desaturation, which is what stops any lettering the image
 *      model hallucinated from reading as words
 *   2  the scrim, whose opacity is computed from the text colour
 *
 * Text and logo layers are added by the template on top of all three, so the
 * AI can never draw over the words. In the old pipeline the generated image
 * WAS the whole canvas and the words were part of it, which is why headlines
 * came out misspelled.
 */
export function backgroundLayersCss(): string {
  return `
.bg{width:100%;height:100%;object-fit:cover;object-position:center;}
.bg-wrap{position:absolute;inset:0;z-index:0;overflow:hidden;}
/* Scaled up slightly so the blur's soft edge never exposes the canvas corners. */
.bg-blur{transform:scale(1.06);filter:blur(var(--bg-blur)) saturate(var(--bg-sat));}
.scrim{position:absolute;inset:0;z-index:2;}
.brand-gradient{position:absolute;inset:0;z-index:0;}
`.trim();
}

export function buildBackgroundMarkup(background: TemplateBackground, palette: {
  primary: string;
  secondary: string;
  background: string;
}): string {
  if (background.kind === 'ai-image' && background.dataUri) {
    return `<div class="bg-wrap"><img class="bg bg-blur" src="${background.dataUri}" alt=""></div>`;
  }

  if (background.kind === 'brand-gradient') {
    const from = safeColor(palette.primary, '#1f2937');
    const to = safeColor(palette.secondary, '#111827');
    // Two stops plus a soft radial highlight, so a gradient card does not read
    // as a flat rectangle next to the photographic ones in the same calendar.
    return `<div class="brand-gradient" style="background:
        radial-gradient(120% 90% at 18% 12%, ${rgba(from, 0.85)} 0%, ${rgba(from, 0)} 55%),
        linear-gradient(155deg, ${from} 0%, ${to} 100%);"></div>`;
  }

  const solid = safeColor(palette.background, '#111827');
  return `<div class="brand-gradient" style="background:${solid};"></div>`;
}

/**
 * Wraps a template body in a complete document.
 *
 * `font-display:block` in the face rules plus the explicit readiness wait in
 * the renderer means the screenshot is never taken mid-swap, which would bake
 * a fallback face into a PNG that looks almost right.
 */
export function buildDocument(options: {
  input: TemplateInput;
  extraCss: string;
  body: string;
}): string {
  const { input, extraCss, body } = options;
  const blur = input.background.kind === 'ai-image' ? (input.background.blurPx ?? 4) : 0;
  const saturate = input.background.kind === 'ai-image' ? 0.92 : 1;

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<style>
${fontFaceCss()}
:root{${scaleUnitCss(input.size)}--bg-blur:${blur}px;--bg-sat:${saturate};}
${resetCss()}
${backgroundLayersCss()}
${extraCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}
