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
  type TemplateInput,
  type TemplateOutput,
  type TextRect,
  type LayoutMode,
} from './types.js';

/**
 * A photograph with an OPAQUE brand panel carrying the words.
 *
 * This is the evolution of the old real-estate listing card, generalised: hero
 * image on top, solid panel below, headline / subline / CTA inside the panel.
 *
 * It is the safety net of the catalog. Every other photo template puts text on
 * top of AI-generated pixels and relies on a computed scrim to keep it legible,
 * which is a probabilistic bet — a bright highlight in the wrong place still
 * costs contrast. Here there is no bet: the panel is fully opaque, so the
 * backdrop behind every glyph is a colour we chose, and the contrast ratio is
 * known before anything is rendered. When the QA pass rejects a design for
 * legibility, this is what the pipeline falls back to, so its contrast has to
 * be guaranteed rather than merely likely.
 *
 * No scrim is emitted at all. A scrim over an opaque panel would only mute the
 * brand colour while changing the measured contrast, which is worse on both
 * counts.
 */
export function photoCaption(input: TemplateInput): TemplateOutput {
  const mode = layoutModeFor(input.size);
  const { size, brand, copy, background, safeArea } = input;

  const palette: BrandPalette = {
    primary: safeColor(brand.palette.primary, '#1f2937'),
    secondary: safeColor(brand.palette.secondary, '#111827'),
    accent: safeColor(brand.palette.accent, '#f59e0b'),
    background: safeColor(brand.palette.background, '#0f172a'),
    text: safeColor(brand.palette.text, '#ffffff'),
  };

  const { panel: panelColor, text: textColor } = pickPanelColor(palette);
  // The accent is decorative only — a rule and a CTA underline. It never
  // carries a glyph, so it is exempt from the contrast guarantee.
  const accent = palette.accent;

  const unit = Math.min(size.width, size.height);
  const safeTopPx = Math.round(size.height * safeArea.top);
  const safeBottomPx = Math.round(size.height * safeArea.bottom);

  // Landscape turns the panel into a side column; the other two keep it as a
  // band along the bottom edge, which is where a caption belongs.
  const isSideColumn = mode === 'landscape';
  const panelRatio = mode === 'portrait' ? 0.38 : mode === 'square' ? 0.34 : 0.42;

  const panelWidth = isSideColumn ? Math.round(size.width * panelRatio) : size.width;
  // The band grows by the story chrome inset rather than losing its content to
  // it. Flush to the canvas edge visually, but the words still clear the UI.
  // The band is sized from what it has to hold, not from a fixed fraction.
  //
  // A fixed ratio cannot know that this month's subline wrapped to three lines,
  // so it silently under-provisions and the headline gets cropped to fit a box
  // that was decided before anyone counted the words. `panelRatio` stays as the
  // floor (the design still wants a substantial band even for one short line)
  // and 0.62 as the ceiling, so the photo never disappears.
  const panelContentNeed = estimatePanelContent({
    size,
    mode,
    unit,
    copy,
    contentWidthPx: Math.round(size.width * (1 - 0.075 * 2)),
  });
  const panelHeight = isSideColumn
    ? size.height
    : Math.min(
        Math.round(size.height * 0.62),
        Math.max(
          Math.round(size.height * panelRatio) + safeBottomPx,
          panelContentNeed + Math.round(unit * 0.116) + safeBottomPx
        )
      );
  const panelTop = isSideColumn ? 0 : size.height - panelHeight;

  const padX = isSideColumn ? Math.round(panelWidth * 0.12) : Math.round(size.width * 0.075);
  const padTop = Math.round(unit * 0.058) + (isSideColumn ? safeTopPx : 0);
  const padBottom = Math.round(unit * 0.058) + safeBottomPx;

  const contentWidth = panelWidth - padX * 2;
  const contentHeight = Math.max(Math.round(unit * 0.2), panelHeight - padTop - padBottom);

  const logoHeight = Math.round(unit * 0.052);
  // The side column stacks its footer vertically, so it needs more of it.
  const footerHeight = Math.round(unit * (isSideColumn ? 0.145 : 0.072));
  const rowGap = Math.round(unit * 0.024);

  const headline = clampText(copy.headline, mode === 'landscape' ? 70 : 62);
  const sublineBudget = mode === 'square' ? 90 : mode === 'portrait' ? 120 : 130;
  const subline = copy.subline ? clampText(copy.subline, sublineBudget) : '';
  const badge = copy.badge ? turkishUpper(clampText(copy.badge, 24)) : '';
  const cta = copy.cta ? clampText(copy.cta, 36) : '';

  const headlineMaxPx = Math.round(unit * (isSideColumn ? 0.085 : 0.095));

  // Size the subline first and reserve the height it genuinely needs, then let
  // the headline have what is left.
  //
  // Splitting the panel by a fixed ratio (60% headline, 40% subline) was the
  // obvious approach and it is what cropped both: the ratio never learns that
  // this particular subline wrapped to three lines rather than two, so the
  // headline was fitted to a budget the subline then overran.
  const sublineSize = clampNumber(
    Math.round(headlineMaxPx * 0.4),
    Math.round(unit * 0.024),
    Math.round(unit * 0.04)
  );
  const sublineHeight = subline
    ? estimateWrappedHeight({
        text: subline,
        fontSizePx: sublineSize,
        maxWidthPx: contentWidth,
        lineHeight: 1.42,
      })
    : 0;

  const headlineBudget = Math.max(
    Math.round(unit * 0.08),
    contentHeight - footerHeight - sublineHeight - rowGap * (subline ? 3 : 2)
  );
  const headlineSize = autoFitFontSize({
    text: headline,
    maxWidthPx: contentWidth,
    maxHeightPx: headlineBudget,
    maxFontPx: headlineMaxPx,
    minFontPx: Math.round(headlineMaxPx * 0.45),
    widthRatio: 0.54,
    lineHeight: 1.1,
  });
  const footerSize = Math.round(unit * 0.028);

  const badgeGeometry = badge
    ? badgeBox({ badge, unit, size, isSideColumn, panelWidth, padX, safeTopPx })
    : null;

  // The panel hides the lower part of the frame, so the photograph is biased
  // upwards to keep its subject inside the window that still shows.
  const photoPosition = isSideColumn ? 'center' : 'center 38%';

  const extraCss = `
.bg{object-position:${photoPosition};}
.panel{position:absolute;z-index:3;overflow:hidden;
  left:0;top:${panelTop}px;width:${panelWidth}px;height:${panelHeight}px;
  background:${panelColor};
  padding:${padTop}px ${padX}px ${padBottom}px;
  display:flex;flex-direction:column;justify-content:space-between;gap:${rowGap}px;}
/* A hairline of accent along the seam, so the panel reads as a deliberate
   surface rather than the photograph being cut off. */
.panel::before{content:'';position:absolute;background:${accent};
  ${isSideColumn
    ? `top:0;right:0;width:calc(6 * var(--u) * 1px);height:100%;`
    : `left:0;top:0;width:100%;height:calc(6 * var(--u) * 1px);`}}
.stack{flex:1 1 auto;min-height:0;overflow:hidden;
  display:flex;flex-direction:column;gap:${Math.round(rowGap * 0.85)}px;
  align-items:flex-start;text-align:left;}
.headline{font-family:${headingFamily(brand)};font-weight:800;color:${textColor};
  font-size:${headlineSize}px;line-height:1.1;letter-spacing:calc(-0.5 * var(--u) * 1px);
  max-width:${contentWidth}px;overflow:hidden;}
.accent-rule{flex:0 0 auto;width:calc(88 * var(--u) * 1px);height:calc(6 * var(--u) * 1px);
  background:${accent};border-radius:calc(999 * var(--u) * 1px);}
.subline{font-family:${bodyFamily(brand)};font-weight:400;color:${rgba(textColor, 0.86)};
  font-size:${sublineSize}px;line-height:1.42;max-width:${contentWidth}px;overflow:hidden;}
.footer{flex:0 0 ${footerHeight}px;display:flex;
  flex-direction:${isSideColumn ? 'column-reverse' : 'row'};
  align-items:${isSideColumn ? 'flex-start' : 'flex-end'};
  justify-content:${isSideColumn ? 'flex-end' : 'space-between'};
  gap:${Math.round(rowGap * 0.9)}px;}
.brandmark{display:flex;align-items:center;gap:calc(14 * var(--u) * 1px);}
.brandmark img{height:${logoHeight}px;width:auto;max-width:${Math.round(contentWidth * 0.55)}px;
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
  ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}
  <div class="panel">
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
    textRects: buildTextRects({
      size,
      panelTop,
      panelHeight,
      padX,
      padTop,
      padBottom,
      contentWidth,
      contentHeight,
      footerHeight,
      rowGap,
      badge: badgeGeometry,
    }),
  };
}

/**
 * Chooses the panel colour, and the text colour that goes on it, together.
 *
 * Brand fidelity first: if the client's primary can carry AA-legible text it
 * wins. Otherwise we fall through to the darker roles and, failing all of them,
 * take whichever candidate scored highest. A mid-tone primary that only
 * reaches 3:1 against every available text colour would look on-brand and read
 * badly, which is exactly the failure this template exists to prevent.
 */
function pickPanelColor(palette: BrandPalette): { panel: string; text: string } {
  const candidates = [palette.primary, palette.background, palette.secondary];

  let bestPanel = candidates[0];
  let bestText = pickTextColor(palette, candidates[0]);
  let bestRatio = 0;

  for (const candidate of candidates) {
    const text = pickTextColor(palette, candidate);
    const ratio = contrastRatio(text, candidate);
    if (ratio >= 4.5) return { panel: candidate, text };
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestPanel = candidate;
      bestText = text;
    }
  }

  return { panel: bestPanel, text: bestText };
}

interface BadgeBox {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

/**
 * The badge is the one element that sits on the photograph, so it is drawn as
 * a solid accent pill — opaque for the same reason the panel is.
 *
 * Its width is pinned rather than left to shrink-wrap the text. A pill whose
 * width the renderer decides is a pill whose bounds we would have to guess when
 * reporting text rectangles, and a guessed rectangle that overshoots would have
 * the QA pass sampling photograph pixels and failing a design that is fine.
 */
function badgeBox(options: {
  badge: string;
  unit: number;
  size: TemplateInput['size'];
  isSideColumn: boolean;
  panelWidth: number;
  padX: number;
  safeTopPx: number;
}): BadgeBox {
  const { badge, unit, size, isSideColumn, panelWidth, padX, safeTopPx } = options;

  const fontSize = Math.round(unit * 0.026);
  const padInlinePx = Math.round(unit * 0.026);
  const padBlockPx = Math.round(unit * 0.013);

  const width = Math.min(
    Math.round(size.width * 0.6),
    Math.ceil(badge.length * fontSize * 0.62) + padInlinePx * 2
  );
  const height = Math.round(fontSize * 1.3) + padBlockPx * 2;

  const left = isSideColumn ? panelWidth + Math.round(unit * 0.06) : padX;
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
 * The rectangles the pixel QA pass samples, derived from the same pixel maths
 * the CSS uses rather than hand-tuned per mode.
 *
 * The two panel rectangles bound the boxes the text lives in, not the glyph
 * runs themselves. That is exact enough here precisely because the panel is
 * opaque and flat: every sample inside those boxes hits the same colour, so a
 * box that is slightly larger than the text measures the same ratio the text
 * experiences. The badge rectangle is the one that has to be tight, because it
 * is surrounded by photograph — so it is inset well inside the pill.
 */
function buildTextRects(options: {
  size: TemplateInput['size'];
  panelTop: number;
  panelHeight: number;
  padX: number;
  padTop: number;
  padBottom: number;
  contentWidth: number;
  contentHeight: number;
  footerHeight: number;
  rowGap: number;
  badge: BadgeBox | null;
}): TextRect[] {
  const { size, panelTop, panelHeight, padX, padTop, padBottom } = options;
  const { contentWidth, contentHeight, footerHeight, rowGap, badge } = options;

  const toX = (px: number): number => clampPercent((px / size.width) * 100);
  const toY = (px: number): number => clampPercent((px / size.height) * 100);

  const stackHeight = Math.max(Math.round(size.height * 0.04), contentHeight - footerHeight - rowGap);
  const footerTop = panelTop + panelHeight - padBottom - footerHeight;

  const rects: TextRect[] = [
    {
      x: toX(padX),
      y: toY(panelTop + padTop),
      w: toX(contentWidth),
      h: toY(stackHeight),
    },
    {
      x: toX(padX),
      y: toY(footerTop),
      w: toX(contentWidth),
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

/**
 * Height the panel's stack needs: headline at its smallest acceptable size,
 * plus the subline's real wrapped height, plus the footer row and the gaps.
 *
 * Deliberately uses the *minimum* headline size. The panel only has to be big
 * enough that nothing is cut; if there is room to spare the headline grows into
 * it afterwards, which is the right order. Sizing the panel from the maximum
 * headline instead would push the photo off the card for a two word title.
 */
function estimatePanelContent(options: {
  size: TemplateInput['size'];
  mode: LayoutMode;
  unit: number;
  copy: TemplateInput['copy'];
  contentWidthPx: number;
}): number {
  const { size, mode, unit, copy, contentWidthPx } = options;

  const headlineMaxPx = Math.round(unit * 0.095);
  const headlineMinPx = Math.round(headlineMaxPx * 0.45);
  const sublineSize = clampNumber(
    Math.round(headlineMaxPx * 0.4),
    Math.round(unit * 0.024),
    Math.round(unit * 0.04)
  );

  const headline = clampText(copy.headline, mode === 'landscape' ? 70 : 62);
  const sublineBudget = mode === 'square' ? 90 : mode === 'portrait' ? 120 : 130;
  const subline = copy.subline ? clampText(copy.subline, sublineBudget) : '';

  const headlineHeight = estimateWrappedHeight({
    text: headline,
    fontSizePx: headlineMinPx,
    maxWidthPx: contentWidthPx,
    lineHeight: 1.1,
    widthRatio: 0.54,
  });
  const sublineHeight = subline
    ? estimateWrappedHeight({
        text: subline,
        fontSizePx: sublineSize,
        maxWidthPx: contentWidthPx,
        lineHeight: 1.42,
      })
    : 0;

  const footerHeight = Math.round(unit * 0.072);
  const rowGap = Math.round(unit * 0.024);
  void size;

  return headlineHeight + sublineHeight + footerHeight + rowGap * (subline ? 3 : 2);
}
