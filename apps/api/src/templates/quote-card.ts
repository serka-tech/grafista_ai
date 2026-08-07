import { buildBackgroundMarkup, buildDocument } from './base-css.js';
import {
  autoFitFontSize,
  clampText,
  contrastRatio,
  escapeHtml,
  pickTextColor,
  relativeLuminance,
  rgba,
  safeColor,
  turkishUpper,
} from './helpers.js';
import {
  layoutModeFor,
  type BrandPalette,
  type LayoutMode,
  type SafeArea,
  type TemplateBackground,
  type TemplateBrand,
  type TemplateInput,
  type TemplateOutput,
  type TextRect,
} from './types.js';

/**
 * A quote or a tip on a brand gradient. The only template in the catalog that
 * generates no image at all.
 *
 * This is the one that makes a monthly plan affordable. A twelve-post month
 * where every post is a photographic template pays for twelve image generation
 * calls; routing the quotes and tips here drops several of those to zero, and
 * the saving is real rather than a discount on quality — a quote reads better
 * on flat colour than under a photograph anyway, because nothing is competing
 * with the words. `needsBackgroundImage: false` is what tells the planner it
 * may skip the generation call entirely for this card.
 *
 * Because the backdrop is a gradient we authored from two known hex values,
 * contrast is not an estimate here: both ends are checked exactly, so there is
 * no scrim over the artwork the way the photographic templates need one. The
 * tint layer below only engages for mid-tone palettes where neither black nor
 * white clears AA against both stops on its own.
 */
export function quoteCard(input: TemplateInput): TemplateOutput {
  const mode = layoutModeFor(input.size);
  const { size, brand, copy, safeArea } = input;

  const palette = {
    primary: safeColor(brand.palette.primary, '#1f2937'),
    secondary: safeColor(brand.palette.secondary, '#111827'),
    accent: safeColor(brand.palette.accent, '#f59e0b'),
    background: safeColor(brand.palette.background, '#0f172a'),
    text: safeColor(brand.palette.text, '#ffffff'),
  };

  // A caller that hands this template an AI image gets it ignored rather than
  // drawn. Rendering the photo would both spend the generation call this
  // template exists to save and invalidate the exact contrast maths below,
  // which assumes the two gradient stops are the only backdrop that exists.
  const background: TemplateBackground =
    input.background.kind === 'ai-image'
      ? { kind: 'brand-gradient' }
      : input.background;

  // buildBackgroundMarkup paints primary -> secondary, so those two are the
  // whole range the text has to survive.
  const stops = [palette.primary, palette.secondary];
  const { textColor, worstRatio } = pickGradientTextColor(palette, stops);

  // Only a mid-tone pair (or a QA re-render asking for more) gets a tint. On a
  // normal dark or light brand gradient this is absent and the artwork is clean.
  const boost = input.scrimBoost ?? 0;
  const tintColor = relativeLuminance(textColor) > 0.5 ? '#000000' : '#ffffff';
  const tintAlpha =
    worstRatio >= 4.5 && boost <= 0 ? 0 : tintAlphaForGradient(textColor, tintColor, stops, boost);

  const quote = clampText(copy.headline, 190);
  const attribution = copy.attribution ? clampText(copy.attribution, 48) : '';
  const kicker = copy.badge ? turkishUpper(clampText(copy.badge, 22)) : '';
  const cta = copy.cta ? clampText(copy.cta, 36) : '';

  const unitPx = Math.min(size.width, size.height) / 1080;
  const un = (units: number): string => `calc(${units.toFixed(2)} * var(--u) * 1px)`;
  const toUnits = (px: number): number => px / unitPx;
  const fromTop = (units: number): string =>
    `calc(${safeArea.top.toFixed(4)} * var(--h) + ${units.toFixed(2)} * var(--u) * 1px)`;
  const fromBottom = (units: number): string =>
    `calc(${safeArea.bottom.toFixed(4)} * var(--h) + ${units.toFixed(2)} * var(--u) * 1px)`;

  const gutterFrac = mode === 'landscape' ? 0.065 : 0.095; // fraction of canvas width
  const gutterUnits = 64;
  const gutterXPx = size.width * gutterFrac;

  const blockWidthFrac = mode === 'landscape' ? 0.6 : 0.78;
  const textBlockWidthPx = Math.round(size.width * blockWidthFrac);

  // No photograph to compete with, so the quote can run smaller and longer than
  // a headline would; readability beats impact on a card people actually read.
  const quoteMaxPx = Math.round(
    Math.min(size.width, size.height) * (mode === 'landscape' ? 0.078 : 0.09)
  );
  const quoteMaxHeightPx = Math.round(size.height * (mode === 'portrait' ? 0.44 : 0.5));
  const quoteSizePx = autoFitFontSize({
    text: quote,
    maxWidthPx: textBlockWidthPx,
    maxHeightPx: quoteMaxHeightPx,
    maxFontPx: quoteMaxPx,
    minFontPx: Math.round(quoteMaxPx * 0.4),
    widthRatio: 0.5,
    lineHeight: 1.3,
  });

  const markSizePx = Math.round(quoteSizePx * 2.2);
  const attributionSizePx = Math.round(quoteSizePx * 0.36);
  const kickerSizePx = Math.round(quoteSizePx * 0.3);
  const ctaSizePx = Math.round(quoteSizePx * 0.34);
  const gapPx = Math.round(unitPx * 26);
  const logoHeightPx = Math.round(Math.min(size.width, size.height) * 0.052);

  const alignItems = mode === 'landscape' ? 'flex-start' : 'center';
  const textAlign = mode === 'landscape' ? 'left' : 'center';
  const footerJustify = mode === 'landscape' ? 'flex-start' : 'center';

  // Vertically centred in every mode: the block is the whole design, so pinning
  // it to an edge would leave the gradient looking like an unfilled slide.
  const extraCss = `
${tintAlpha > 0 ? `.tint{position:absolute;inset:0;z-index:1;background:${rgba(tintColor, tintAlpha)};}` : ''}
.content{position:absolute;z-index:4;display:flex;flex-direction:column;
  justify-content:center;align-items:${alignItems};text-align:${textAlign};
  top:${fromTop(gutterUnits)};
  bottom:calc(${safeArea.bottom.toFixed(4)} * var(--h) + ${(gutterUnits + 110).toFixed(2)} * var(--u) * 1px);
  left:calc(${gutterFrac} * var(--w));right:calc(${gutterFrac} * var(--w));}
.stack{display:flex;flex-direction:column;gap:${un(toUnits(gapPx))};align-items:${alignItems};
  max-width:calc(${blockWidthFrac} * var(--w));}
.kicker{font-family:${bodyFamily(brand)};font-weight:600;color:${rgba(palette.accent, 0.95)};
  font-size:${un(toUnits(kickerSizePx))};letter-spacing:${un(6)};line-height:1.2;}
.mark{font-family:${headingFamily(brand)};font-weight:700;color:${rgba(palette.accent, 0.85)};
  font-size:${un(toUnits(markSizePx))};line-height:0.72;height:${un(toUnits(markSizePx * 0.5))};
  user-select:none;}
.quote{font-family:${headingFamily(brand)};font-weight:700;color:${textColor};
  font-size:${un(toUnits(quoteSizePx))};line-height:1.3;letter-spacing:${un(-0.3)};
  max-height:${un(toUnits(quoteMaxHeightPx))};overflow:hidden;}
.attrib-rule{width:${un(70)};height:${un(3)};background:${rgba(palette.accent, 0.9)};
  border-radius:${un(999)};}
.attribution{font-family:${bodyFamily(brand)};font-weight:400;color:${rgba(textColor, 0.85)};
  font-size:${un(toUnits(attributionSizePx))};line-height:1.35;letter-spacing:${un(1)};}
.cta{font-family:${bodyFamily(brand)};font-weight:600;color:${textColor};
  font-size:${un(toUnits(ctaSizePx))};
  border-bottom:${un(3)} solid ${palette.accent};padding-bottom:${un(6)};}
.footer{position:absolute;z-index:5;display:flex;align-items:center;gap:${un(16)};
  justify-content:${footerJustify};
  bottom:${fromBottom(gutterUnits)};
  left:calc(${gutterFrac} * var(--w));right:calc(${gutterFrac} * var(--w));}
.footer img{height:${un(toUnits(logoHeightPx))};width:auto;max-width:calc(0.3 * var(--w));
  object-fit:contain;}
.footer .name{font-family:${bodyFamily(brand)};font-weight:600;color:${rgba(textColor, 0.9)};
  font-size:${un(28)};letter-spacing:${un(2)};}
`.trim();

  const body = `
<div class="canvas">
  ${buildBackgroundMarkup(background, palette)}
  ${tintAlpha > 0 ? '<div class="tint"></div>' : ''}
  <div class="content">
    <div class="stack">
      ${kicker ? `<span class="kicker">${escapeHtml(kicker)}</span>` : ''}
      <span class="mark">&ldquo;</span>
      <blockquote class="quote">${escapeHtml(quote)}</blockquote>
      ${attribution ? '<div class="attrib-rule"></div>' : ''}
      ${attribution ? `<p class="attribution">${escapeHtml(attribution)}</p>` : ''}
      ${cta ? `<span class="cta">${escapeHtml(cta)}</span>` : ''}
    </div>
  </div>
  <div class="footer">${footerMarkup(brand)}</div>
</div>`.trim();

  return {
    html: buildDocument({ input: { ...input, background }, extraCss, body }),
    needsBackgroundImage: false,
    textRects: buildTextRects({
      mode,
      size,
      safeArea,
      gutterXPx,
      gutterYPx: gutterUnits * unitPx,
      footerReserveUnits: 110,
      unitPx,
      textBlockWidthPx,
      logoHeightPx,
      blockHeightPx: estimateBlockHeight({
        quote,
        quoteSizePx,
        quoteMaxHeightPx,
        textBlockWidthPx,
        markHeightPx: markSizePx * 0.5,
        kickerSizePx: kicker ? kickerSizePx : 0,
        attributionSizePx: attribution ? attributionSizePx : 0,
        ctaSizePx: cta ? ctaSizePx : 0,
        ruleHeightPx: attribution ? unitPx * 3 : 0,
        gapPx,
      }),
    }),
  };
}

function headingFamily(brand: TemplateBrand): string {
  return `${brand.headingFont}, 'Playfair Display', serif`;
}

function bodyFamily(brand: TemplateBrand): string {
  return `${brand.bodyFont}, 'Inter', sans-serif`;
}

function footerMarkup(brand: TemplateBrand): string {
  if (brand.logoDataUri) {
    return `<img src="${brand.logoDataUri}" alt="">`;
  }
  return `<span class="name">${escapeHtml(brand.name)}</span>`;
}

/**
 * Picks the text colour by its WORST contrast across the gradient, not its
 * average. A colour that clears AA against the light end and fails against the
 * dark one produces a card whose last two lines are unreadable, and an average
 * would report that card as fine.
 */
function pickGradientTextColor(
  palette: BrandPalette,
  stops: string[]
): { textColor: string; worstRatio: number } {
  const candidates = [
    pickTextColor(palette, stops[0]),
    pickTextColor(palette, stops[1]),
    '#ffffff',
    '#111111',
  ];

  let textColor = '#ffffff';
  let worstRatio = 0;
  for (const candidate of candidates) {
    const worst = Math.min(...stops.map((stop) => contrastRatio(candidate, stop)));
    if (worst > worstRatio) {
      worstRatio = worst;
      textColor = candidate;
    }
  }
  return { textColor, worstRatio };
}

/**
 * How opaque a tint has to be for the chosen text to clear AA against both
 * gradient stops. Solved against the real stop luminances rather than the
 * worst-case-photo assumption `scrimAlphaFor` has to make, because here we know
 * exactly what is underneath.
 */
function tintAlphaForGradient(
  textColor: string,
  tintColor: string,
  stops: string[],
  boost: number
): number {
  const textLuminance = relativeLuminance(textColor);
  const tintLuminance = relativeLuminance(tintColor);

  for (let alpha = 0; alpha <= 0.9; alpha += 0.05) {
    const passes = stops.every((stop) => {
      const blended = relativeLuminance(stop) * (1 - alpha) + tintLuminance * alpha;
      const lighter = Math.max(textLuminance, blended);
      const darker = Math.min(textLuminance, blended);
      return (lighter + 0.05) / (darker + 0.05) >= 4.5;
    });
    if (passes) return Math.min(0.9, Math.round((alpha + boost) * 100) / 100);
  }
  return 0.9;
}

function estimateBlockHeight(options: {
  quote: string;
  quoteSizePx: number;
  quoteMaxHeightPx: number;
  textBlockWidthPx: number;
  markHeightPx: number;
  kickerSizePx: number;
  attributionSizePx: number;
  ctaSizePx: number;
  ruleHeightPx: number;
  gapPx: number;
}): number {
  const charsPerLine = Math.max(
    1,
    Math.floor(options.textBlockWidthPx / (options.quoteSizePx * 0.5))
  );
  const lines = Math.max(1, Math.ceil(options.quote.length / charsPerLine));
  let total =
    Math.min(options.quoteMaxHeightPx, lines * options.quoteSizePx * 1.3) +
    options.markHeightPx +
    options.gapPx;
  if (options.kickerSizePx > 0) total += options.kickerSizePx * 1.2 + options.gapPx;
  if (options.attributionSizePx > 0) {
    total += options.attributionSizePx * 1.35 + options.ruleHeightPx + options.gapPx * 2;
  }
  if (options.ctaSizePx > 0) total += options.ctaSizePx * 1.3 + options.gapPx;
  return total;
}

function buildTextRects(options: {
  mode: LayoutMode;
  size: TemplateInput['size'];
  safeArea: SafeArea;
  gutterXPx: number;
  gutterYPx: number;
  footerReserveUnits: number;
  unitPx: number;
  textBlockWidthPx: number;
  logoHeightPx: number;
  blockHeightPx: number;
}): TextRect[] {
  const { mode, size, safeArea } = options;
  const widthPct = (px: number): number => (px / size.width) * 100;
  const heightPct = (px: number): number => (px / size.height) * 100;

  // The content box the stack is centred inside, in canvas percentages.
  const boxTop = heightPct(safeArea.top * size.height + options.gutterYPx);
  const boxBottom =
    100 -
    heightPct(
      safeArea.bottom * size.height + options.gutterYPx + options.footerReserveUnits * options.unitPx
    );
  const blockHeight = Math.min(heightPct(options.blockHeightPx), boxBottom - boxTop);
  const blockTop = boxTop + (boxBottom - boxTop - blockHeight) / 2;

  const bodyWidth = widthPct(options.textBlockWidthPx);
  const bodyLeft =
    mode === 'landscape' ? widthPct(options.gutterXPx) : Math.max(0, (100 - bodyWidth) / 2);

  const footerHeight = heightPct(options.logoHeightPx * 1.2);
  const footerTop = 100 - heightPct(safeArea.bottom * size.height + options.gutterYPx) - footerHeight;
  const footerWidth = mode === 'landscape' ? 32 : 44;
  const footerLeft =
    mode === 'landscape' ? widthPct(options.gutterXPx) : (100 - footerWidth) / 2;

  return [
    clampRect({ x: bodyLeft, y: blockTop, w: bodyWidth, h: blockHeight }),
    clampRect({ x: footerLeft, y: footerTop, w: footerWidth, h: footerHeight }),
  ];
}

function clampRect(rect: TextRect): TextRect {
  const round = (value: number): number => Math.round(value * 100) / 100;
  const bound = (value: number, max: number): number => Math.min(max, Math.max(0, value));
  const x = bound(rect.x, 100);
  const y = bound(rect.y, 100);
  return { x: round(x), y: round(y), w: round(bound(rect.w, 100 - x)), h: round(bound(rect.h, 100 - y)) };
}
