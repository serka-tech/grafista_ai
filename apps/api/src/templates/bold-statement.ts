import { buildBackgroundMarkup, buildDocument } from './base-css.js';
import {
  autoFitFontSize,
  clampText,
  escapeHtml,
  pickTextColor,
  rgba,
  safeColor,
  scrimAlphaFor,
  turkishUpper,
} from './helpers.js';
import { layoutModeFor, type TemplateInput, type TemplateOutput, type TextRect } from './types.js';

/**
 * One large headline over a photograph. The workhorse of the catalog.
 *
 * The headline is set in the display face at the largest size that still fits,
 * anchored to the bottom third on portrait (clear of the story chrome), the
 * centre on square, and the left column on landscape. A gradient scrim rises
 * behind it, with its opacity derived from the text colour rather than fixed,
 * so the same template stays readable over a bright sky and a dark interior.
 */
export function boldStatement(input: TemplateInput): TemplateOutput {
  const mode = layoutModeFor(input.size);
  const { size, brand, copy, background, safeArea } = input;

  const palette = {
    primary: safeColor(brand.palette.primary, '#1f2937'),
    secondary: safeColor(brand.palette.secondary, '#111827'),
    accent: safeColor(brand.palette.accent, '#f59e0b'),
    background: safeColor(brand.palette.background, '#0f172a'),
    text: safeColor(brand.palette.text, '#ffffff'),
  };

  // Over a photograph the reliable choice is the higher-contrast extreme, not
  // the brand's own text colour, which is usually tuned for paper.
  const scrimColor = palette.background;
  const textColor = pickTextColor(palette, scrimColor);
  const scrimAlpha = scrimAlphaFor(textColor, scrimColor, input.scrimBoost ?? 0);

  const headline = turkishUpper(clampText(copy.headline, 64));
  const subline = copy.subline ? clampText(copy.subline, 110) : '';
  const badge = copy.badge ? turkishUpper(clampText(copy.badge, 24)) : '';
  const cta = copy.cta ? clampText(copy.cta, 40) : '';

  const gutterPx = Math.round(size.width * (mode === 'landscape' ? 0.06 : 0.085));
  const textBlockWidth =
    mode === 'landscape' ? Math.round(size.width * 0.54) : size.width - gutterPx * 2;

  const headlineMaxPx = Math.round(Math.min(size.width, size.height) * (mode === 'landscape' ? 0.13 : 0.155));
  const headlineSize = autoFitFontSize({
    text: headline,
    maxWidthPx: textBlockWidth,
    maxHeightPx: Math.round(size.height * (mode === 'portrait' ? 0.3 : 0.36)),
    maxFontPx: headlineMaxPx,
    minFontPx: Math.round(headlineMaxPx * 0.42),
    // Display faces at heavy weights run wider than the default estimate.
    widthRatio: 0.56,
  });
  const sublineSize = Math.round(headlineSize * 0.3);

  const safeTopPx = Math.round(size.height * safeArea.top);
  const safeBottomPx = Math.round(size.height * safeArea.bottom);

  const logoHeightPx = Math.round(Math.min(size.width, size.height) * 0.062);

  const alignment = mode === 'landscape' ? 'flex-start' : mode === 'square' ? 'center' : 'flex-start';
  const justify = mode === 'square' ? 'center' : 'flex-end';
  const textAlign = mode === 'square' ? 'center' : 'left';

  // The scrim only needs to cover the text, so on square it is a centred wash
  // and elsewhere a bottom-up gradient. A full-canvas flat scrim would mute the
  // photograph for no legibility gain.
  const scrimBackground =
    mode === 'square'
      ? `radial-gradient(75% 60% at 50% 55%, ${rgba(scrimColor, scrimAlpha)} 0%, ${rgba(scrimColor, scrimAlpha * 0.55)} 55%, ${rgba(scrimColor, 0)} 100%)`
      : `linear-gradient(to top, ${rgba(scrimColor, Math.min(0.97, scrimAlpha + 0.12))} 0%, ${rgba(scrimColor, scrimAlpha)} 34%, ${rgba(scrimColor, 0)} 78%)`;

  const extraCss = `
.content{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;
  align-items:${alignment};justify-content:${justify};
  padding:${safeTopPx + gutterPx}px ${gutterPx}px ${safeBottomPx + gutterPx}px;
  text-align:${textAlign};}
.stack{display:flex;flex-direction:column;gap:calc(20 * var(--u) * 1px);max-width:${textBlockWidth}px;
  align-items:${mode === 'square' ? 'center' : 'flex-start'};}
.badge{display:inline-block;font-family:${bodyFamily(brand)};font-weight:600;
  font-size:calc(26 * var(--u) * 1px);letter-spacing:calc(2 * var(--u) * 1px);
  color:${palette.background};background:${palette.accent};
  padding:calc(12 * var(--u) * 1px) calc(26 * var(--u) * 1px);border-radius:calc(999 * var(--u) * 1px);}
.headline{font-family:${headingFamily(brand)};font-weight:800;color:${textColor};
  font-size:${headlineSize}px;line-height:1.03;letter-spacing:calc(-1 * var(--u) * 1px);
  max-height:${Math.round(size.height * 0.42)}px;overflow:hidden;
  text-shadow:0 calc(2 * var(--u) * 1px) calc(24 * var(--u) * 1px) ${rgba(scrimColor, 0.55)};}
.accent-rule{width:calc(96 * var(--u) * 1px);height:calc(7 * var(--u) * 1px);background:${palette.accent};
  border-radius:calc(999 * var(--u) * 1px);}
.subline{font-family:${bodyFamily(brand)};font-weight:400;color:${rgba(textColor, 0.92)};
  font-size:${sublineSize}px;line-height:1.4;max-width:${Math.round(textBlockWidth * 0.92)}px;}
.cta{font-family:${bodyFamily(brand)};font-weight:600;color:${textColor};
  font-size:${Math.round(sublineSize * 0.95)}px;
  border-bottom:calc(3 * var(--u) * 1px) solid ${palette.accent};padding-bottom:calc(6 * var(--u) * 1px);
  align-self:${mode === 'square' ? 'center' : 'flex-start'};}
.brandmark{position:absolute;z-index:5;top:${safeTopPx + gutterPx}px;left:${gutterPx}px;
  display:flex;align-items:center;gap:calc(16 * var(--u) * 1px);}
.brandmark img{height:${logoHeightPx}px;width:auto;max-width:${Math.round(size.width * 0.36)}px;
  object-fit:contain;filter:drop-shadow(0 calc(2 * var(--u) * 1px) calc(12 * var(--u) * 1px) ${rgba(scrimColor, 0.5)});}
.brandmark .name{font-family:${bodyFamily(brand)};font-weight:600;color:${textColor};
  font-size:calc(30 * var(--u) * 1px);letter-spacing:calc(1 * var(--u) * 1px);}
`.trim();

  const body = `
<div class="canvas">
  ${buildBackgroundMarkup(background, palette)}
  <div class="scrim" style="background:${scrimBackground};"></div>
  <div class="brandmark">${brandMarkup(brand)}</div>
  <div class="content">
    <div class="stack">
      ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}
      <h1 class="headline">${escapeHtml(headline)}</h1>
      ${mode === 'square' ? '' : '<div class="accent-rule"></div>'}
      ${subline ? `<p class="subline">${escapeHtml(subline)}</p>` : ''}
      ${cta ? `<span class="cta">${escapeHtml(cta)}</span>` : ''}
    </div>
  </div>
</div>`.trim();

  return {
    html: buildDocument({ input, extraCss, body }),
    needsBackgroundImage: true,
    textRects: textRectsFor(mode, safeArea),
  };
}

function headingFamily(brand: TemplateInput['brand']): string {
  return `${brand.headingFont}, 'Montserrat', sans-serif`;
}

function bodyFamily(brand: TemplateInput['brand']): string {
  return `${brand.bodyFont}, 'Inter', sans-serif`;
}

function brandMarkup(brand: TemplateInput['brand']): string {
  if (brand.logoDataUri) {
    return `<img src="${brand.logoDataUri}" alt="">`;
  }
  return `<span class="name">${escapeHtml(brand.name)}</span>`;
}

/**
 * Where the pixel QA pass should sample. These follow the layout above rather
 * than covering the whole canvas: measuring contrast over the entire image
 * would average the bright and dark halves together and report a comfortable
 * number for a headline that is actually sitting on a blown-out highlight.
 */
function textRectsFor(mode: ReturnType<typeof layoutModeFor>, safeArea: TemplateInput['safeArea']): TextRect[] {
  const bottomInset = safeArea.bottom * 100;

  if (mode === 'square') {
    return [{ x: 12, y: 32, w: 76, h: 36 }];
  }
  if (mode === 'landscape') {
    return [{ x: 6, y: 30, w: 54, h: 46 }];
  }
  return [{ x: 8, y: 100 - bottomInset - 42, w: 84, h: 38 }];
}
