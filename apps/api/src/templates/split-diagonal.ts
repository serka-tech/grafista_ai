import { buildBackgroundMarkup, buildDocument } from './base-css.js';
import {
  autoFitFontSize,
  estimateWrappedHeight,
  clampText,
  contrastRatio,
  escapeHtml,
  pickTextColor,
  rgba,
  safeColor,
  turkishUpper,
} from './helpers.js';
import {
  layoutModeFor,
  type BrandPalette,
  type LayoutMode,
  type TemplateInput,
  type TemplateOutput,
  type TextRect,
} from './types.js';

/**
 * The canvas cut in two by a diagonal: photograph on one side, a flat sheet of
 * brand colour on the other, with a thin accent line drawn along the seam.
 *
 * Same legibility contract as the caption panel — every glyph sits on an opaque
 * colour we picked, so contrast is arithmetic rather than a hope — but it reads
 * as a designed poster instead of a photo with a caption bar, which is what
 * keeps a month of scheduled posts from looking like one template repeated.
 *
 * The cut is geometry, not decoration: the text box is placed by solving the
 * divider's equation at the box's far edge, so the copy always clears the
 * slope no matter how steep the mode makes it.
 */
export function splitDiagonal(input: TemplateInput): TemplateOutput {
  const mode = layoutModeFor(input.size);
  const { size, brand, copy, background, safeArea } = input;

  const palette: BrandPalette = {
    primary: safeColor(brand.palette.primary, '#1f2937'),
    secondary: safeColor(brand.palette.secondary, '#111827'),
    accent: safeColor(brand.palette.accent, '#f59e0b'),
    background: safeColor(brand.palette.background, '#0f172a'),
    text: safeColor(brand.palette.text, '#ffffff'),
  };

  // A gradient would look richer here and would also make the backdrop under
  // the headline a range of luminances instead of one, which is the whole
  // thing this template is trading the photo-overlay look to avoid.
  const { fill: fillColor, text: textColor } = pickFillColor(palette);
  const accent = palette.accent;

  const unit = Math.min(size.width, size.height);
  const safeTopPx = Math.round(size.height * safeArea.top);
  const safeBottomPx = Math.round(size.height * safeArea.bottom);

  const geometry = dividerFor(mode);
  const isVerticalSplit = mode === 'landscape';

  const clearance = Math.round(unit * 0.055);
  const lineThickness = Math.max(2, Math.round(unit * 0.007));
  const lineHalf = Math.max(1, Math.round(lineThickness / 2));

  const padX = Math.round(size.width * (isVerticalSplit ? 0.05 : 0.085));
  const padTop = Math.round(unit * 0.06) + safeTopPx;
  const padBottom = Math.round(unit * 0.06) + safeBottomPx;

  const box = isVerticalSplit
    ? verticalSplitBox({ size, geometry, padX, padTop, padBottom, clearance, unit })
    : horizontalSplitBox({ size, geometry, padX, padBottom, clearance, unit, mode });

  const logoHeight = Math.round(unit * 0.052);
  const footerHeight = Math.round(unit * (isVerticalSplit ? 0.145 : 0.072));
  const rowGap = Math.round(unit * 0.024);

  // Uppercase is the point of the layout — a slab of brand colour wants a slab
  // of type. `text-transform` would turn "iyi" into "IYI"; the helper knows
  // that the dotted i has to become İ.
  const headline = turkishUpper(clampText(copy.headline, isVerticalSplit ? 60 : 52));
  const subline = copy.subline ? clampText(copy.subline, isVerticalSplit ? 120 : 100) : '';
  const badge = copy.badge ? turkishUpper(clampText(copy.badge, 24)) : '';
  const cta = copy.cta ? clampText(copy.cta, 36) : '';

  const headlineMaxPx = Math.round(unit * (isVerticalSplit ? 0.082 : 0.09));

  // Size the subline first, then reserve the height it actually needs.
  //
  // Splitting the box by a fixed 60/40 assumes the subline wraps to a known
  // number of lines. It does not: one extra line pushes the headline past its
  // share, and because the stack is a flex column the headline is the item that
  // gets squeezed, so it crops rather than the copy below it.
  const sublineSize = clampNumber(
    Math.round(headlineMaxPx * 0.38),
    Math.round(unit * 0.024),
    Math.round(unit * 0.038)
  );
  const sublineHeight = subline
    ? estimateWrappedHeight({
        text: subline,
        fontSizePx: sublineSize,
        maxWidthPx: box.width,
        lineHeight: 1.42,
      })
    : 0;

  const headlineBudget = Math.max(
    Math.round(unit * 0.08),
    box.height - footerHeight - sublineHeight - rowGap * (subline ? 3 : 2)
  );
  const headlineSize = autoFitFontSize({
    text: headline,
    maxWidthPx: box.width,
    maxHeightPx: headlineBudget,
    maxFontPx: headlineMaxPx,
    minFontPx: Math.round(headlineMaxPx * 0.45),
    // All-caps at a heavy weight runs wider than mixed case.
    widthRatio: 0.58,
    lineHeight: 1.06,
  });
  const footerSize = Math.round(unit * 0.028);

  const badgeGeometry = badge
    ? badgeBox({ badge, unit, size, isVerticalSplit, geometry, padX, safeTopPx })
    : null;

  const fillClip = isVerticalSplit
    ? `polygon(0% 0%, ${geometry.topPct}% 0%, ${geometry.bottomPct}% 100%, 0% 100%)`
    : `polygon(0% ${geometry.topPct}%, 100% ${geometry.bottomPct}%, 100% 100%, 0% 100%)`;

  // The seam line is the fill polygon's edge widened symmetrically. The offset
  // is applied along one axis rather than along the true normal, so at these
  // shallow angles the drawn line is a hair thinner than `lineThickness` —
  // invisible at any of the three sizes, and it keeps the polygon exact.
  const edgeClip = isVerticalSplit
    ? `polygon(calc(${geometry.topPct}% - ${lineHalf}px) 0%, calc(${geometry.topPct}% + ${lineHalf}px) 0%,` +
      ` calc(${geometry.bottomPct}% + ${lineHalf}px) 100%, calc(${geometry.bottomPct}% - ${lineHalf}px) 100%)`
    : `polygon(0% calc(${geometry.topPct}% - ${lineHalf}px), 100% calc(${geometry.bottomPct}% - ${lineHalf}px),` +
      ` 100% calc(${geometry.bottomPct}% + ${lineHalf}px), 0% calc(${geometry.topPct}% + ${lineHalf}px))`;

  const extraCss = `
.fill{position:absolute;inset:0;z-index:2;background:${fillColor};
  -webkit-clip-path:${fillClip};clip-path:${fillClip};}
.seam{position:absolute;inset:0;z-index:3;background:${accent};
  -webkit-clip-path:${edgeClip};clip-path:${edgeClip};}
.content{position:absolute;z-index:4;overflow:hidden;
  left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;
  display:flex;flex-direction:column;justify-content:space-between;gap:${rowGap}px;}
.stack{flex:1 1 auto;min-height:0;overflow:hidden;
  display:flex;flex-direction:column;justify-content:${isVerticalSplit ? 'center' : 'flex-end'};
  gap:${Math.round(rowGap * 0.85)}px;align-items:flex-start;text-align:left;}
.headline{flex:0 0 auto;font-family:${headingFamily(brand)};font-weight:800;color:${textColor};
  font-size:${headlineSize}px;line-height:1.06;letter-spacing:calc(-0.5 * var(--u) * 1px);
  max-width:${box.width}px;overflow:hidden;}
.accent-rule{flex:0 0 auto;width:calc(88 * var(--u) * 1px);height:calc(6 * var(--u) * 1px);
  background:${accent};border-radius:calc(999 * var(--u) * 1px);}
.subline{flex:0 0 auto;font-family:${bodyFamily(brand)};font-weight:400;color:${rgba(textColor, 0.86)};
  font-size:${sublineSize}px;line-height:1.42;max-width:${box.width}px;overflow:hidden;}
.footer{flex:0 0 ${footerHeight}px;display:flex;
  flex-direction:${isVerticalSplit ? 'column-reverse' : 'row'};
  align-items:${isVerticalSplit ? 'flex-start' : 'flex-end'};
  justify-content:${isVerticalSplit ? 'flex-end' : 'space-between'};
  gap:${Math.round(rowGap * 0.9)}px;}
.brandmark{display:flex;align-items:center;gap:calc(14 * var(--u) * 1px);}
.brandmark img{height:${logoHeight}px;width:auto;max-width:${Math.round(box.width * 0.55)}px;
  object-fit:contain;}
.brandmark .name{font-family:${bodyFamily(brand)};font-weight:600;color:${textColor};
  font-size:${footerSize}px;letter-spacing:calc(1 * var(--u) * 1px);}
.cta{font-family:${bodyFamily(brand)};font-weight:600;color:${textColor};
  font-size:${footerSize}px;white-space:nowrap;
  border-bottom:calc(3 * var(--u) * 1px) solid ${accent};padding-bottom:calc(5 * var(--u) * 1px);}
${badgeGeometry
    ? `.badge{position:absolute;z-index:5;left:${badgeGeometry.left}px;top:${badgeGeometry.top}px;
  width:${badgeGeometry.width}px;height:${badgeGeometry.height}px;
  display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;
  background:${accent};color:${pickTextColor(palette, accent)};
  font-family:${bodyFamily(brand)};font-weight:600;font-size:${badgeGeometry.fontSize}px;
  letter-spacing:calc(1.5 * var(--u) * 1px);border-radius:calc(999 * var(--u) * 1px);}`
    : ''}
`.trim();

  const body = `
<div class="canvas">
  ${buildBackgroundMarkup(background, palette)}
  <div class="fill"></div>
  <div class="seam"></div>
  ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}
  <div class="content">
    <div class="stack">
      <h1 class="headline">${escapeHtml(headline)}</h1>
      <div class="accent-rule"></div>
      ${subline ? `<p class="subline">${escapeHtml(subline)}</p>` : ''}
    </div>
    <div class="footer">
      <div class="brandmark">${brandMarkup(brand)}</div>
      ${cta ? `<span class="cta">${escapeHtml(cta)}</span>` : ''}
    </div>
  </div>
</div>`.trim();

  return {
    html: buildDocument({ input, extraCss, body }),
    needsBackgroundImage: true,
    textRects: buildTextRects({ size, box, footerHeight, rowGap, badge: badgeGeometry }),
  };
}

/**
 * Where the divider meets the two canvas edges it crosses, in percent.
 *
 * Portrait and square are cut across the width, so the pair is the y where the
 * line leaves the left and right edges. Landscape is cut down the height
 * instead — a horizontal cut there would leave a letterbox strip too short to
 * set a headline in — so the pair is the x at the top and bottom edges.
 *
 * The tilt shrinks as the canvas gets wider. In portrait there is height to
 * spend, so the line falls a long way and the cut reads as a deliberate slash;
 * on landscape the same angle would swing the text column's usable width by
 * hundreds of pixels between its top and bottom, forcing the copy into
 * whatever the narrowest scanline allows.
 */
interface DividerGeometry {
  /** Percent at the left edge (horizontal cut) or the top edge (vertical cut). */
  topPct: number;
  /** Percent at the right edge (horizontal cut) or the bottom edge (vertical cut). */
  bottomPct: number;
}

function dividerFor(mode: LayoutMode): DividerGeometry {
  if (mode === 'portrait') return { topPct: 44, bottomPct: 62 };
  if (mode === 'landscape') return { topPct: 52, bottomPct: 44 };
  return { topPct: 42, bottomPct: 54 };
}

interface ContentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Text box for a cut across the width: the copy lives in the wedge below the
 * line.
 *
 * The top is the divider's y evaluated at the box's RIGHT edge, which is the
 * lowest point of the line anywhere across the box. Taking the y at the left
 * edge instead — the intuitive choice — would tuck the first line of the
 * headline under the slope on the right side of the canvas.
 */
function horizontalSplitBox(options: {
  size: TemplateInput['size'];
  geometry: DividerGeometry;
  padX: number;
  padBottom: number;
  clearance: number;
  unit: number;
  mode: LayoutMode;
}): ContentBox {
  const { size, geometry, padX, padBottom, clearance, unit, mode } = options;

  const width = Math.min(
    size.width - padX * 2,
    Math.round(size.width * (mode === 'portrait' ? 0.76 : 0.78))
  );
  const right = padX + width;

  const leftY = (size.height * geometry.topPct) / 100;
  const rightY = (size.height * geometry.bottomPct) / 100;
  const dividerYAtRight = leftY + (rightY - leftY) * (right / size.width);

  const bottom = size.height - padBottom;
  const top = Math.round(dividerYAtRight) + clearance;
  const height = Math.max(Math.round(unit * 0.18), bottom - top);

  return { left: padX, top: Math.min(top, size.height - height), width, height };
}

/**
 * Text box for a cut down the height: the copy lives in the column to the left
 * of the line, bounded by the line's narrowest x over the column's full height.
 */
function verticalSplitBox(options: {
  size: TemplateInput['size'];
  geometry: DividerGeometry;
  padX: number;
  padTop: number;
  padBottom: number;
  clearance: number;
  unit: number;
}): ContentBox {
  const { size, geometry, padX, padTop, padBottom, clearance, unit } = options;

  const narrowestX = (size.width * Math.min(geometry.topPct, geometry.bottomPct)) / 100;
  const right = Math.round(narrowestX) - clearance;
  const width = Math.max(Math.round(unit * 0.35), right - padX);
  const height = Math.max(Math.round(unit * 0.2), size.height - padTop - padBottom);

  return { left: padX, top: padTop, width, height };
}

/**
 * Same reasoning as the caption template: brand colour first, but only if a
 * headline set on it clears AA. The diagonal makes the fill a large flat area,
 * so a poor choice here is a poster-sized legibility failure rather than a
 * marginal one.
 */
function pickFillColor(palette: BrandPalette): { fill: string; text: string } {
  const candidates = [palette.primary, palette.secondary, palette.background];

  let bestFill = candidates[0];
  let bestText = pickTextColor(palette, candidates[0]);
  let bestRatio = 0;

  for (const candidate of candidates) {
    const text = pickTextColor(palette, candidate);
    const ratio = contrastRatio(text, candidate);
    if (ratio >= 4.5) return { fill: candidate, text };
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestFill = candidate;
      bestText = text;
    }
  }

  return { fill: bestFill, text: bestText };
}

interface BadgeBox {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

/**
 * The badge is the only element on the photograph side, so it is an opaque
 * accent pill with a pinned width — pinned so the rectangle we report to the
 * QA pass is the pill's real box and not an estimate that could spill onto
 * photo pixels.
 */
function badgeBox(options: {
  badge: string;
  unit: number;
  size: TemplateInput['size'];
  isVerticalSplit: boolean;
  geometry: DividerGeometry;
  padX: number;
  safeTopPx: number;
}): BadgeBox {
  const { badge, unit, size, isVerticalSplit, geometry, padX, safeTopPx } = options;

  const fontSize = Math.round(unit * 0.026);
  const padInlinePx = Math.round(unit * 0.026);
  const padBlockPx = Math.round(unit * 0.013);

  const width = Math.min(
    Math.round(size.width * 0.5),
    Math.ceil(badge.length * fontSize * 0.62) + padInlinePx * 2
  );
  const height = Math.round(fontSize * 1.3) + padBlockPx * 2;

  // On a vertical cut the photograph starts at the divider's x on the top edge.
  const left = isVerticalSplit
    ? Math.round((size.width * geometry.topPct) / 100) + Math.round(unit * 0.06)
    : padX;
  const top = safeTopPx + Math.round(unit * 0.05);

  return { left, top, width, height, fontSize };
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
}

/**
 * Rectangles for the pixel QA pass, taken from the same content box the CSS is
 * positioned with.
 *
 * The stack and footer rectangles bound their flex boxes rather than the glyph
 * runs. That is exact enough because the box was placed entirely inside the
 * flat fill — every sample lands on the same colour the text is set on — and
 * a rectangle tied to estimated glyph metrics would be a guess reported as a
 * measurement. The badge rectangle sits on photograph and so is inset well
 * inside its pill.
 */
function buildTextRects(options: {
  size: TemplateInput['size'];
  box: ContentBox;
  footerHeight: number;
  rowGap: number;
  badge: BadgeBox | null;
}): TextRect[] {
  const { size, box, footerHeight, rowGap, badge } = options;

  const toX = (px: number): number => clampPercent((px / size.width) * 100);
  const toY = (px: number): number => clampPercent((px / size.height) * 100);

  const stackHeight = Math.max(
    Math.round(size.height * 0.04),
    box.height - footerHeight - rowGap
  );

  const rects: TextRect[] = [
    {
      x: toX(box.left),
      y: toY(box.top),
      w: toX(box.width),
      h: toY(stackHeight),
    },
    {
      x: toX(box.left),
      y: toY(box.top + box.height - footerHeight),
      w: toX(box.width),
      h: toY(footerHeight),
    },
  ];

  if (badge) {
    rects.push({
      x: toX(badge.left + badge.width * 0.12),
      y: toY(badge.top + badge.height * 0.2),
      w: toX(badge.width * 0.76),
      h: toY(badge.height * 0.6),
    });
  }

  return rects;
}
