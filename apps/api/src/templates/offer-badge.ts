import { buildBackgroundMarkup, buildDocument } from './base-css.js';
import {
  autoFitFontSize,
  clampText,
  contrastRatio,
  escapeHtml,
  pickTextColor,
  rgba,
  safeColor,
  scrimAlphaFor,
  turkishUpper,
} from './helpers.js';
import {
  layoutModeFor,
  type LayoutMode,
  type SafeArea,
  type TemplateBrand,
  type TemplateInput,
  type TemplateOutput,
  type TextRect,
} from './types.js';

/**
 * Campaign badge over a photograph, with the price or discount as the second
 * loudest thing on the canvas.
 *
 * SECTOR RESTRICTION — do not route health, dental or legal clients here.
 * Turkish professional regulation forbids those practices from advertising
 * campaigns, discounts and price promotions at all (the health advertising
 * rules and the bar association's advertising ban), so a template whose entire
 * job is to shout a discount is not merely off-brand for them, it is a
 * compliance problem for the client. The catalog is expected to filter this
 * template out by sector before a plan ever reaches it; the note is here so
 * nobody adds it back to those sectors by hand later.
 *
 * The Turkish lira sign ₺ (U+20BA) is covered by every face we ship, so a price
 * string carrying it renders without a fallback swap.
 */
export function offerBadge(input: TemplateInput): TemplateOutput {
  const mode = layoutModeFor(input.size);
  const { size, brand, copy, background, safeArea } = input;

  const palette = {
    primary: safeColor(brand.palette.primary, '#1f2937'),
    secondary: safeColor(brand.palette.secondary, '#111827'),
    accent: safeColor(brand.palette.accent, '#ef4444'),
    background: safeColor(brand.palette.background, '#0f172a'),
    text: safeColor(brand.palette.text, '#ffffff'),
  };

  const scrimColor = palette.background;
  const textColor = pickTextColor(palette, scrimColor);
  const scrimAlpha = scrimAlphaFor(textColor, scrimColor, input.scrimBoost ?? 0);

  // The badge and the CTA are solid accent, so their labels are chosen against
  // accent itself rather than inheriting the headline colour. A brand yellow
  // badge with white text is the classic way this fails silently.
  const onAccent = pickTextColor(palette, palette.accent);

  // The price line wants to be accent for emphasis, but it sits on the scrim,
  // not on a filled shape. Only let it be accent when accent survives there.
  const priceColor = contrastRatio(palette.accent, scrimColor) >= 3 ? palette.accent : textColor;

  const headline = turkishUpper(clampText(copy.headline, 56));
  const price = copy.subline ? clampText(copy.subline, 40) : '';
  const cta = copy.cta ? turkishUpper(clampText(copy.cta, 26)) : '';
  // No badge copy means no badge shape. Substituting an invented word like
  // "KAMPANYA" would put a claim on the canvas that the plan never made.
  const badge = copy.badge ? turkishUpper(clampText(copy.badge, 18)) : '';

  const unitPx = Math.min(size.width, size.height) / 1080;
  const un = (units: number): string => `calc(${units.toFixed(2)} * var(--u) * 1px)`;
  const toUnits = (px: number): number => px / unitPx;
  const fromTop = (units: number): string =>
    `calc(${safeArea.top.toFixed(4)} * var(--h) + ${units.toFixed(2)} * var(--u) * 1px)`;
  const fromBottom = (units: number): string =>
    `calc(${safeArea.bottom.toFixed(4)} * var(--h) + ${units.toFixed(2)} * var(--u) * 1px)`;

  const gutterFrac = mode === 'landscape' ? 0.055 : 0.075; // fraction of canvas width
  const gutterUnits = 60;
  const gutterXPx = size.width * gutterFrac;

  const blockWidthFrac = mode === 'landscape' ? 0.55 : 0.78;
  const textBlockWidthPx = Math.round(size.width * blockWidthFrac);

  const headlineMaxPx = Math.round(
    Math.min(size.width, size.height) * (mode === 'landscape' ? 0.115 : 0.135)
  );
  const headlineMaxHeightPx = Math.round(size.height * (mode === 'portrait' ? 0.24 : 0.3));
  const headlineSizePx = autoFitFontSize({
    text: headline,
    maxWidthPx: textBlockWidthPx,
    maxHeightPx: headlineMaxHeightPx,
    maxFontPx: headlineMaxPx,
    minFontPx: Math.round(headlineMaxPx * 0.44),
    widthRatio: 0.56,
  });

  // Second in the hierarchy, deliberately close to the headline in weight: the
  // number is the reason this design exists.
  const priceSizePx = Math.round(headlineSizePx * 0.52);
  const ctaSizePx = Math.round(Math.min(size.width, size.height) * 0.032);
  const gapPx = Math.round(unitPx * 24);
  const logoHeightPx = Math.round(Math.min(size.width, size.height) * 0.058);

  // Shape by canvas: a disc is the sale-sticker reading and it works where
  // there is vertical room to spare, but on 1200x628 a disc large enough to be
  // legible eats a third of the height, so the wide canvas gets an angled
  // ribbon that runs with the format instead of fighting it.
  const badgeShape: 'disc' | 'ribbon' = mode === 'landscape' ? 'ribbon' : 'disc';
  const discPx = Math.round(Math.min(size.width, size.height) * 0.27);
  const badgeFontPx = badge
    ? autoFitFontSize({
        text: badge,
        maxWidthPx: badgeShape === 'disc' ? discPx * 0.78 : size.width * 0.3,
        maxHeightPx: badgeShape === 'disc' ? discPx * 0.58 : Math.round(unitPx * 90),
        maxFontPx: Math.round(Math.min(size.width, size.height) * (badgeShape === 'disc' ? 0.062 : 0.055)),
        minFontPx: Math.round(Math.min(size.width, size.height) * 0.028),
        widthRatio: 0.58,
        lineHeight: 1.06,
      })
    : 0;
  const ribbonPadXPx = Math.round(unitPx * 44);
  const ribbonPadYPx = Math.round(unitPx * 18);
  const ribbonWidthPx = Math.min(
    size.width * 0.5,
    badge.length * badgeFontPx * 0.58 + ribbonPadXPx * 2
  );
  const ribbonHeightPx = badgeFontPx * 1.15 + ribbonPadYPx * 2;

  // The copy stack is bottom-anchored and grows upward with long copy. Both the
  // brand row and the badge live at the top, so the content box starts below
  // whichever of them reaches further down.
  const topReserveUnits =
    Math.max(
      logoHeightPx * 1.2,
      badge ? (badgeShape === 'disc' ? discPx : ribbonHeightPx) : 0
    ) / unitPx +
    toUnits(gapPx * 1.5);

  const scrimBackground = `linear-gradient(to top, ${rgba(scrimColor, Math.min(0.97, scrimAlpha + 0.12))} 0%, ${rgba(scrimColor, scrimAlpha)} 38%, ${rgba(scrimColor, 0)} 82%)`;

  const extraCss = `
.brandmark{position:absolute;z-index:5;display:flex;align-items:center;gap:${un(16)};
  top:${fromTop(gutterUnits)};left:calc(${gutterFrac} * var(--w));}
.brandmark img{height:${un(toUnits(logoHeightPx))};width:auto;max-width:calc(0.32 * var(--w));
  object-fit:contain;filter:drop-shadow(0 ${un(2)} ${un(12)} ${rgba(scrimColor, 0.5)});}
.brandmark .name{font-family:${bodyFamily(brand)};font-weight:600;color:${textColor};
  font-size:${un(30)};letter-spacing:${un(1)};}
${
  !badge
    ? ''
    : `${
        badgeShape === 'disc'
          ? `.badge-disc{position:absolute;z-index:6;display:flex;align-items:center;justify-content:center;
  top:${fromTop(gutterUnits)};right:calc(${gutterFrac} * var(--w));
  width:${un(toUnits(discPx))};height:${un(toUnits(discPx))};border-radius:50%;
  background:${palette.accent};transform:rotate(-8deg);padding:${un(20)};
  box-shadow:0 ${un(8)} ${un(30)} ${rgba(scrimColor, 0.45)};}`
          : `.badge-ribbon{position:absolute;z-index:6;display:flex;align-items:center;justify-content:center;
  top:${fromTop(gutterUnits)};right:calc(${gutterFrac} * var(--w));
  background:${palette.accent};transform:rotate(-3deg);
  padding:${un(toUnits(ribbonPadYPx))} ${un(toUnits(ribbonPadXPx))};
  box-shadow:0 ${un(8)} ${un(28)} ${rgba(scrimColor, 0.45)};}`
      }
.badge-label{font-family:${headingFamily(brand)};font-weight:800;color:${onAccent};
  font-size:${un(toUnits(badgeFontPx))};line-height:1.06;text-align:center;
  letter-spacing:${un(0.5)};}`
}
.content{position:absolute;z-index:4;display:flex;flex-direction:column;
  justify-content:flex-end;align-items:flex-start;text-align:left;
  top:${fromTop(gutterUnits + topReserveUnits)};bottom:${fromBottom(gutterUnits)};
  left:calc(${gutterFrac} * var(--w));right:calc(${gutterFrac} * var(--w));}
.stack{display:flex;flex-direction:column;gap:${un(toUnits(gapPx))};align-items:flex-start;
  max-width:calc(${blockWidthFrac} * var(--w));}
.headline{font-family:${headingFamily(brand)};font-weight:800;color:${textColor};
  font-size:${un(toUnits(headlineSizePx))};line-height:1.04;letter-spacing:${un(-1)};
  max-height:${un(toUnits(headlineMaxHeightPx))};overflow:hidden;
  text-shadow:0 ${un(2)} ${un(24)} ${rgba(scrimColor, 0.55)};}
.price{font-family:${headingFamily(brand)};font-weight:800;color:${priceColor};
  font-size:${un(toUnits(priceSizePx))};line-height:1.1;letter-spacing:${un(-0.5)};
  text-shadow:0 ${un(2)} ${un(18)} ${rgba(scrimColor, 0.6)};}
.cta{display:inline-block;font-family:${bodyFamily(brand)};font-weight:600;color:${onAccent};
  background:${palette.accent};font-size:${un(toUnits(ctaSizePx))};letter-spacing:${un(2)};
  padding:${un(18)} ${un(40)};border-radius:${un(999)};
  box-shadow:0 ${un(6)} ${un(24)} ${rgba(scrimColor, 0.4)};}
`.trim();

  const badgeMarkup = !badge
    ? ''
    : badgeShape === 'disc'
      ? `<div class="badge-disc"><span class="badge-label">${escapeHtml(badge)}</span></div>`
      : `<div class="badge-ribbon"><span class="badge-label">${escapeHtml(badge)}</span></div>`;

  const body = `
<div class="canvas">
  ${buildBackgroundMarkup(background, palette)}
  <div class="scrim" style="background:${scrimBackground};"></div>
  <div class="brandmark">${brandMarkup(brand)}</div>
  ${badgeMarkup}
  <div class="content">
    <div class="stack">
      <h1 class="headline">${escapeHtml(headline)}</h1>
      ${price ? `<p class="price">${escapeHtml(price)}</p>` : ''}
      ${cta ? `<span class="cta">${escapeHtml(cta)}</span>` : ''}
    </div>
  </div>
</div>`.trim();

  return {
    html: buildDocument({ input, extraCss, body }),
    needsBackgroundImage: true,
    textRects: buildTextRects({
      mode,
      size,
      safeArea,
      gutterXPx,
      gutterYPx: gutterUnits * unitPx,
      topReservePx: topReserveUnits * unitPx,
      textBlockWidthPx,
      logoHeightPx,
      badgeShape: badge ? badgeShape : 'none',
      discPx,
      ribbonWidthPx,
      ribbonHeightPx,
      blockHeightPx: estimateBlockHeight({
        headline,
        headlineSizePx,
        headlineMaxHeightPx,
        textBlockWidthPx,
        priceSizePx: price ? priceSizePx : 0,
        ctaSizePx: cta ? ctaSizePx : 0,
        gapPx,
      }),
    }),
  };
}

function headingFamily(brand: TemplateBrand): string {
  return `${brand.headingFont}, 'Montserrat', sans-serif`;
}

function bodyFamily(brand: TemplateBrand): string {
  return `${brand.bodyFont}, 'Inter', sans-serif`;
}

function brandMarkup(brand: TemplateBrand): string {
  if (brand.logoDataUri) {
    return `<img src="${brand.logoDataUri}" alt="">`;
  }
  return `<span class="name">${escapeHtml(brand.name)}</span>`;
}

/** Real stack height from the character model, not a guessed fraction. */
function estimateBlockHeight(options: {
  headline: string;
  headlineSizePx: number;
  headlineMaxHeightPx: number;
  textBlockWidthPx: number;
  priceSizePx: number;
  ctaSizePx: number;
  gapPx: number;
}): number {
  const charsPerLine = Math.max(
    1,
    Math.floor(options.textBlockWidthPx / (options.headlineSizePx * 0.56))
  );
  const lines = Math.max(1, Math.ceil(options.headline.length / charsPerLine));
  let total = Math.min(options.headlineMaxHeightPx, lines * options.headlineSizePx * 1.04);
  if (options.priceSizePx > 0) total += options.priceSizePx * 1.1 + options.gapPx;
  if (options.ctaSizePx > 0) total += options.ctaSizePx * 1.2 + options.gapPx * 2.5;
  return total;
}

function buildTextRects(options: {
  mode: LayoutMode;
  size: TemplateInput['size'];
  safeArea: SafeArea;
  gutterXPx: number;
  gutterYPx: number;
  topReservePx: number;
  textBlockWidthPx: number;
  logoHeightPx: number;
  badgeShape: 'disc' | 'ribbon' | 'none';
  discPx: number;
  ribbonWidthPx: number;
  ribbonHeightPx: number;
  blockHeightPx: number;
}): TextRect[] {
  const { size, safeArea } = options;
  const widthPct = (px: number): number => (px / size.width) * 100;
  const heightPct = (px: number): number => (px / size.height) * 100;

  const topEdge = heightPct(safeArea.top * size.height + options.gutterYPx);
  const bottomEdge = 100 - heightPct(safeArea.bottom * size.height + options.gutterYPx);
  // Clamped to the content box: an over-tall estimate would hand QA a rectangle
  // covering the badge and the brand row, and the averaged reading would hide a
  // headline actually sitting on a blown-out part of the photograph.
  const boxTop = heightPct(safeArea.top * size.height + options.gutterYPx + options.topReservePx);
  const blockHeight = Math.min(heightPct(options.blockHeightPx), bottomEdge - boxTop);

  const rects: TextRect[] = [
    // Brandmark row.
    clampRect({
      x: widthPct(options.gutterXPx),
      y: topEdge,
      w: 32,
      h: heightPct(options.logoHeightPx * 1.2),
    }),
    // Headline + price + CTA.
    clampRect({
      x: widthPct(options.gutterXPx),
      y: bottomEdge - blockHeight,
      w: widthPct(options.textBlockWidthPx),
      h: blockHeight,
    }),
  ];

  // The badge label sits on accent, not on the photograph, but QA still samples
  // it: a badge whose label lost against its own fill is the failure mode the
  // pixel pass is there to catch.
  if (options.badgeShape === 'disc') {
    const w = widthPct(options.discPx);
    rects.push(
      clampRect({ x: 100 - widthPct(options.gutterXPx) - w, y: topEdge, w, h: heightPct(options.discPx) })
    );
  } else if (options.badgeShape === 'ribbon') {
    const w = widthPct(options.ribbonWidthPx);
    rects.push(
      clampRect({
        x: 100 - widthPct(options.gutterXPx) - w,
        y: topEdge,
        w,
        h: heightPct(options.ribbonHeightPx),
      })
    );
  }

  return rects;
}

function clampRect(rect: TextRect): TextRect {
  const round = (value: number): number => Math.round(value * 100) / 100;
  const bound = (value: number, max: number): number => Math.min(max, Math.max(0, value));
  const x = bound(rect.x, 100);
  const y = bound(rect.y, 100);
  return { x: round(x), y: round(y), w: round(bound(rect.w, 100 - x)), h: round(bound(rect.h, 100 - y)) };
}
