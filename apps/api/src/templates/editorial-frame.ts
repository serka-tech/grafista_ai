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
 * A hairline rule drawn just inside the canvas edge, a serif headline, and far
 * more empty space than any other template in the catalog. Magazine cover.
 *
 * Background decision: the photograph runs full canvas under the frame rather
 * than sitting inside it as a band.
 *
 * A band would have to be a fixed slice of the canvas, and the three sizes we
 * render disagree about where that slice can live — a band that reads as
 * generous on 1080x1920 is a letterbox strip on 1200x628, and the text below it
 * then sits on flat brand colour, which is exactly the "coloured rectangle with
 * words on it" look this template exists to avoid. Full bleed keeps the same
 * composition at all three ratios: the frame floats *over* the image, which is
 * how a real cover is printed, and the headline gets a computed scrim instead
 * of a solid panel. The cost is that the frame crosses the photograph, so its
 * colour is checked against the scrim below before accent is allowed to win.
 */
export function editorialFrame(input: TemplateInput): TemplateOutput {
  const mode = layoutModeFor(input.size);
  const { size, brand, copy, background, safeArea } = input;

  const palette = {
    primary: safeColor(brand.palette.primary, '#1f2937'),
    secondary: safeColor(brand.palette.secondary, '#111827'),
    accent: safeColor(brand.palette.accent, '#c2a878'),
    background: safeColor(brand.palette.background, '#0f172a'),
    text: safeColor(brand.palette.text, '#ffffff'),
  };

  const scrimColor = palette.background;
  const textColor = pickTextColor(palette, scrimColor);
  const scrimAlpha = scrimAlphaFor(textColor, scrimColor, input.scrimBoost ?? 0);

  // The frame is a 3-unit hairline crossing an unpredictable photograph. Accent
  // only earns it when accent still separates from the scrim it is drawn over;
  // otherwise a brand gold on a dark wash disappears and the cover loses the one
  // element that makes it a cover.
  const frameColor = contrastRatio(palette.accent, scrimColor) >= 2.2 ? palette.accent : textColor;

  // Serif headlines stay in mixed case. Editorial covers set their display line
  // in caps only when it is two or three words, and the Turkish dotted-i problem
  // means every uppercase pass has to go through turkishUpper anyway — so caps
  // are reserved for the kicker, where the letterspacing pays for itself.
  const headline = clampText(copy.headline, 68);
  const kicker = copy.badge ? turkishUpper(clampText(copy.badge, 22)) : '';
  const subline = copy.subline ? clampText(copy.subline, 120) : '';
  const cta = copy.cta ? turkishUpper(clampText(copy.cta, 30)) : '';

  const unitPx = Math.min(size.width, size.height) / 1080;
  const un = (units: number): string => `calc(${units.toFixed(2)} * var(--u) * 1px)`;
  const toUnits = (px: number): number => px / unitPx;
  // safeArea is a fraction of canvas height, so it composes with the scale unit
  // inside a single calc() instead of being baked into a pixel constant.
  const fromTop = (units: number): string =>
    `calc(${safeArea.top.toFixed(4)} * var(--h) + ${units.toFixed(2)} * var(--u) * 1px)`;
  const fromBottom = (units: number): string =>
    `calc(${safeArea.bottom.toFixed(4)} * var(--h) + ${units.toFixed(2)} * var(--u) * 1px)`;

  const frameInsetX = mode === 'landscape' ? 0.05 : 0.055; // fraction of canvas width
  const frameInsetY = 56; // scale units, added on top of the platform safe area
  const innerPad = mode === 'landscape' ? 44 : 54; // breathing room inside the rule
  const frameWeight = 3;

  const gutterXFrac = frameInsetX;
  const contentInsetXPx = size.width * frameInsetX + innerPad * unitPx;
  const contentInsetYUnits = frameInsetY + innerPad;

  // Whitespace budget: the text column is capped well under the 55% ceiling so
  // the photograph, not the copy, carries the frame.
  const blockWidthFrac = mode === 'landscape' ? 0.52 : 0.72;
  const textBlockWidthPx = Math.round(size.width * blockWidthFrac);

  const headlineMaxHeightPx = Math.round(
    size.height * (mode === 'portrait' ? 0.24 : mode === 'landscape' ? 0.34 : 0.27)
  );
  const headlineMaxPx = Math.round(
    Math.min(size.width, size.height) * (mode === 'landscape' ? 0.105 : 0.12)
  );
  const headlineSizePx = autoFitFontSize({
    text: headline,
    maxWidthPx: textBlockWidthPx,
    maxHeightPx: headlineMaxHeightPx,
    maxFontPx: headlineMaxPx,
    minFontPx: Math.round(headlineMaxPx * 0.46),
    // Playfair-class serifs run narrower than the sans default.
    widthRatio: 0.5,
    lineHeight: 1.12,
  });

  const kickerSizePx = Math.max(Math.round(unitPx * 22), Math.round(headlineSizePx * 0.22));
  const sublineSizePx = Math.round(headlineSizePx * 0.3);
  const ctaSizePx = Math.round(sublineSizePx * 0.82);
  const gapPx = Math.round(unitPx * 26);
  const logoHeightPx = Math.round(Math.min(size.width, size.height) * 0.055);

  // The copy stack is bottom-anchored, so with a long headline it grows upward.
  // Without this reserve it climbs into the masthead on the short landscape
  // canvas — the headline's own max-height does not stop the subline and the
  // CTA from pushing the whole stack up.
  const mastheadReserveUnits = toUnits(logoHeightPx * 1.2 + gapPx * 1.5);

  const alignItems = mode === 'landscape' ? 'flex-start' : 'center';
  const textAlign = mode === 'landscape' ? 'left' : 'center';
  const mastheadJustify = mode === 'landscape' ? 'flex-start' : 'center';

  // Two washes rather than one: the cover needs contrast at the bottom for the
  // headline and a lighter touch at the top for the masthead, and a single
  // full-canvas flat scrim would grey out the middle of the photograph for no
  // legibility gain at all.
  const scrimBackground = [
    `linear-gradient(to top, ${rgba(scrimColor, Math.min(0.97, scrimAlpha + 0.1))} 0%, ` +
      `${rgba(scrimColor, scrimAlpha)} 30%, ${rgba(scrimColor, 0)} 66%)`,
    `linear-gradient(to bottom, ${rgba(scrimColor, Math.min(0.9, scrimAlpha * 0.8))} 0%, ` +
      `${rgba(scrimColor, 0)} 26%)`,
  ].join(',');

  const extraCss = `
.frame{position:absolute;z-index:3;pointer-events:none;
  top:${fromTop(frameInsetY)};bottom:${fromBottom(frameInsetY)};
  left:calc(${gutterXFrac} * var(--w));right:calc(${gutterXFrac} * var(--w));
  border:${un(frameWeight)} solid ${rgba(frameColor, 0.9)};}
.masthead{position:absolute;z-index:5;display:flex;align-items:center;gap:${un(16)};
  justify-content:${mastheadJustify};
  top:${fromTop(contentInsetYUnits)};
  left:calc(${gutterXFrac} * var(--w) + ${innerPad} * var(--u) * 1px);
  right:calc(${gutterXFrac} * var(--w) + ${innerPad} * var(--u) * 1px);}
.masthead img{height:${un(toUnits(logoHeightPx))};width:auto;
  max-width:calc(0.34 * var(--w));object-fit:contain;
  filter:drop-shadow(0 ${un(2)} ${un(12)} ${rgba(scrimColor, 0.5)});}
.masthead .name{font-family:${headingFamily(brand)};font-weight:700;color:${textColor};
  font-size:${un(30)};letter-spacing:${un(6)};}
.content{position:absolute;z-index:4;display:flex;flex-direction:column;
  justify-content:flex-end;align-items:${alignItems};text-align:${textAlign};
  top:${fromTop(contentInsetYUnits + mastheadReserveUnits)};bottom:${fromBottom(contentInsetYUnits)};
  left:calc(${gutterXFrac} * var(--w) + ${innerPad} * var(--u) * 1px);
  right:calc(${gutterXFrac} * var(--w) + ${innerPad} * var(--u) * 1px);}
.stack{display:flex;flex-direction:column;gap:${un(toUnits(gapPx))};
  align-items:${alignItems};max-width:calc(${blockWidthFrac} * var(--w));}
.kicker{font-family:${bodyFamily(brand)};font-weight:400;color:${rgba(frameColor, 0.95)};
  font-size:${un(toUnits(kickerSizePx))};letter-spacing:${un(8)};line-height:1.2;}
.headline{font-family:${headingFamily(brand)};font-weight:700;color:${textColor};
  font-size:${un(toUnits(headlineSizePx))};line-height:1.12;letter-spacing:${un(-0.5)};
  max-height:${un(toUnits(headlineMaxHeightPx))};overflow:hidden;
  text-shadow:0 ${un(2)} ${un(22)} ${rgba(scrimColor, 0.5)};}
.hairline{width:${un(120)};height:${un(2)};background:${rgba(frameColor, 0.9)};}
.subline{font-family:${bodyFamily(brand)};font-weight:400;color:${rgba(textColor, 0.9)};
  font-size:${un(toUnits(sublineSizePx))};line-height:1.5;
  max-width:calc(${(blockWidthFrac * 0.9).toFixed(3)} * var(--w));}
.cta{font-family:${bodyFamily(brand)};font-weight:400;color:${textColor};
  font-size:${un(toUnits(ctaSizePx))};letter-spacing:${un(5)};}
`.trim();

  const body = `
<div class="canvas">
  ${buildBackgroundMarkup(background, palette)}
  <div class="scrim" style="background:${scrimBackground};"></div>
  <div class="frame"></div>
  <div class="masthead">${mastheadMarkup(brand)}</div>
  <div class="content">
    <div class="stack">
      ${kicker ? `<span class="kicker">${escapeHtml(kicker)}</span>` : ''}
      <h1 class="headline">${escapeHtml(headline)}</h1>
      <div class="hairline"></div>
      ${subline ? `<p class="subline">${escapeHtml(subline)}</p>` : ''}
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
      contentInsetXPx,
      contentInsetYPx: contentInsetYUnits * unitPx,
      mastheadReservePx: mastheadReserveUnits * unitPx,
      textBlockWidthPx,
      logoHeightPx,
      blockHeightPx: estimateBlockHeight({
        headline,
        headlineSizePx,
        headlineMaxHeightPx,
        textBlockWidthPx,
        kickerSizePx: kicker ? kickerSizePx : 0,
        sublineSizePx: subline ? sublineSizePx : 0,
        sublineChars: subline.length,
        ctaSizePx: cta ? ctaSizePx : 0,
        hairlinePx: unitPx * 2,
        gapPx,
      }),
    }),
  };
}

function headingFamily(brand: TemplateBrand): string {
  // Playfair Display is the shipped serif, so it backs the brand face rather
  // than a generic `serif` the render host may resolve to anything.
  return `${brand.headingFont}, 'Playfair Display', serif`;
}

function bodyFamily(brand: TemplateBrand): string {
  return `${brand.bodyFont}, 'Lora', serif`;
}

function mastheadMarkup(brand: TemplateBrand): string {
  if (brand.logoDataUri) {
    return `<img src="${brand.logoDataUri}" alt="">`;
  }
  // No logo file: the name becomes the masthead, letterspaced like one.
  return `<span class="name">${escapeHtml(turkishUpper(brand.name))}</span>`;
}

/**
 * Height the copy stack will actually occupy, from the same character model
 * autoFitFontSize uses. Guessing a fraction of the canvas here would hand the
 * pixel QA pass a rectangle that includes empty photograph, and the averaged
 * contrast reading would come back comfortable for a headline that is not.
 */
function estimateBlockHeight(options: {
  headline: string;
  headlineSizePx: number;
  headlineMaxHeightPx: number;
  textBlockWidthPx: number;
  kickerSizePx: number;
  sublineSizePx: number;
  sublineChars: number;
  ctaSizePx: number;
  hairlinePx: number;
  gapPx: number;
}): number {
  const headlineCharsPerLine = Math.max(
    1,
    Math.floor(options.textBlockWidthPx / (options.headlineSizePx * 0.5))
  );
  const headlineLines = Math.max(1, Math.ceil(options.headline.length / headlineCharsPerLine));
  const headlineHeight = Math.min(
    options.headlineMaxHeightPx,
    headlineLines * options.headlineSizePx * 1.12
  );

  let total = headlineHeight + options.hairlinePx + options.gapPx;
  if (options.kickerSizePx > 0) total += options.kickerSizePx * 1.2 + options.gapPx;
  if (options.sublineSizePx > 0) {
    const charsPerLine = Math.max(
      1,
      Math.floor((options.textBlockWidthPx * 0.9) / (options.sublineSizePx * 0.5))
    );
    const lines = Math.max(1, Math.ceil(options.sublineChars / charsPerLine));
    total += lines * options.sublineSizePx * 1.5 + options.gapPx;
  }
  if (options.ctaSizePx > 0) total += options.ctaSizePx * 1.3 + options.gapPx;

  return total;
}

/** Percentages of the canvas, derived from the same numbers the CSS was built from. */
function buildTextRects(options: {
  mode: LayoutMode;
  size: TemplateInput['size'];
  safeArea: SafeArea;
  contentInsetXPx: number;
  contentInsetYPx: number;
  mastheadReservePx: number;
  textBlockWidthPx: number;
  logoHeightPx: number;
  blockHeightPx: number;
}): TextRect[] {
  const { mode, size, safeArea } = options;
  const widthPct = (px: number): number => (px / size.width) * 100;
  const heightPct = (px: number): number => (px / size.height) * 100;

  const bodyWidth = widthPct(options.textBlockWidthPx);
  const bodyLeft =
    mode === 'landscape'
      ? widthPct(options.contentInsetXPx)
      : Math.max(0, (100 - bodyWidth) / 2);

  const bottomEdge = 100 - heightPct(safeArea.bottom * size.height + options.contentInsetYPx);
  // The stack cannot rise above its own box, so neither may the rectangle we
  // hand to QA — an over-tall estimate would otherwise report the masthead's
  // photograph as part of the headline's backdrop.
  const boxTop = heightPct(
    safeArea.top * size.height + options.contentInsetYPx + options.mastheadReservePx
  );
  const bodyHeight = Math.min(heightPct(options.blockHeightPx), bottomEdge - boxTop);

  const mastheadTop = heightPct(safeArea.top * size.height + options.contentInsetYPx);
  const mastheadHeight = heightPct(options.logoHeightPx * 1.2);
  const mastheadWidth = mode === 'landscape' ? 34 : 56;
  const mastheadLeft =
    mode === 'landscape' ? widthPct(options.contentInsetXPx) : (100 - mastheadWidth) / 2;

  return [
    clampRect({ x: mastheadLeft, y: mastheadTop, w: mastheadWidth, h: mastheadHeight }),
    clampRect({ x: bodyLeft, y: bottomEdge - bodyHeight, w: bodyWidth, h: bodyHeight }),
  ];
}

function clampRect(rect: TextRect): TextRect {
  const round = (value: number): number => Math.round(value * 100) / 100;
  const bound = (value: number, max: number): number => Math.min(max, Math.max(0, value));
  const x = bound(rect.x, 100);
  const y = bound(rect.y, 100);
  return { x: round(x), y: round(y), w: round(bound(rect.w, 100 - x)), h: round(bound(rect.h, 100 - y)) };
}
