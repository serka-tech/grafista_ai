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
 * One card of a multi-card post. The caller renders the same template once per
 * card, varying `copy` and `card.index`.
 *
 * The cards share a single background image, each showing a different slice of
 * it via `object-position`. That is the whole economic point: a five card
 * carousel costs one image generation, not five, while still reading as a set
 * because the slices are continuous. Splitting one image also keeps the cards
 * visually related in a way five independent generations never manage.
 */
export function carousel(input: TemplateInput): TemplateOutput {
  const mode = layoutModeFor(input.size);
  const { size, brand, copy, background, safeArea } = input;

  const index = input.card?.index ?? 0;
  const total = Math.max(1, input.card?.total ?? 1);
  const role: CardRole = index === 0 ? 'cover' : index >= total - 1 ? 'closing' : 'body';

  const palette = {
    primary: safeColor(brand.palette.primary, '#1f2937'),
    secondary: safeColor(brand.palette.secondary, '#111827'),
    accent: safeColor(brand.palette.accent, '#f59e0b'),
    background: safeColor(brand.palette.background, '#0f172a'),
    text: safeColor(brand.palette.text, '#ffffff'),
  };

  const scrimColor = palette.background;
  const textColor = pickTextColor(palette, scrimColor);
  // Body cards carry the most words, so they get the heaviest wash.
  const roleBoost = role === 'body' ? 0.08 : 0;
  const scrimAlpha = scrimAlphaFor(textColor, scrimColor, (input.scrimBoost ?? 0) + roleBoost);

  const un = (units: number): string => `calc(${units.toFixed(2)} * var(--u) * 1px)`;

  const headline =
    role === 'cover' ? turkishUpper(clampText(copy.headline, 56)) : clampText(copy.headline, 70);
  const subline = copy.subline ? clampText(copy.subline, role === 'body' ? 150 : 100) : '';
  const badge = copy.badge ? turkishUpper(clampText(copy.badge, 20)) : '';
  const cta = copy.cta ? clampText(copy.cta, 44) : '';

  const gutterPx = Math.round(size.width * 0.085);
  const textBlockWidth = size.width - gutterPx * 2;

  const headlineCeiling = Math.round(
    Math.min(size.width, size.height) * (role === 'cover' ? 0.145 : 0.085)
  );
  const headlineSize = autoFitFontSize({
    text: headline,
    maxWidthPx: textBlockWidth,
    maxHeightPx: Math.round(size.height * (role === 'cover' ? 0.34 : 0.26)),
    maxFontPx: headlineCeiling,
    minFontPx: Math.round(headlineCeiling * 0.45),
    widthRatio: role === 'cover' ? 0.56 : 0.5,
  });
  const sublineSize = Math.round(headlineSize * (role === 'cover' ? 0.3 : 0.42));

  const safeTopPx = Math.round(size.height * safeArea.top);
  const safeBottomPx = Math.round(size.height * safeArea.bottom);
  const logoHeightPx = Math.round(Math.min(size.width, size.height) * 0.055);

  // Pan across the image as the deck advances. With one card the slice is
  // centred; with several, the first shows the left edge and the last the
  // right, so a reader swiping through sees a continuous scene.
  const panPercent = total <= 1 ? 50 : Math.round((index / (total - 1)) * 100);

  const scrimBackground =
    role === 'cover'
      ? `linear-gradient(to top, ${rgba(scrimColor, Math.min(0.97, scrimAlpha + 0.1))} 0%, ${rgba(scrimColor, scrimAlpha)} 40%, ${rgba(scrimColor, 0)} 82%)`
      : `linear-gradient(to bottom, ${rgba(scrimColor, scrimAlpha)} 0%, ${rgba(scrimColor, Math.min(0.97, scrimAlpha + 0.06))} 100%)`;

  const extraCss = `
.bg{object-position:${panPercent}% center;}
.content{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;
  justify-content:${role === 'cover' ? 'flex-end' : 'center'};align-items:flex-start;
  padding:${safeTopPx + gutterPx}px ${gutterPx}px ${safeBottomPx + gutterPx}px;}
.stack{display:flex;flex-direction:column;gap:${un(22)};max-width:${textBlockWidth}px;}
.badge{display:inline-block;font-family:${bodyFamily(brand)};font-weight:600;
  font-size:${un(26)};letter-spacing:${un(2)};color:${palette.background};
  background:${palette.accent};padding:${un(12)} ${un(26)};border-radius:${un(999)};
  align-self:flex-start;}
.step{display:flex;align-items:center;gap:${un(14)};font-family:${bodyFamily(brand)};
  font-weight:600;font-size:${un(28)};color:${rgba(textColor, 0.85)};}
.step .dot{width:${un(46)};height:${un(46)};border-radius:${un(999)};
  background:${palette.accent};color:${palette.background};
  display:flex;align-items:center;justify-content:center;font-size:${un(24)};}
.headline{font-family:${role === 'cover' ? headingFamily(brand) : bodyFamily(brand)};
  font-weight:${role === 'cover' ? 800 : 600};color:${textColor};
  font-size:${headlineSize}px;line-height:${role === 'cover' ? 1.04 : 1.22};
  max-height:${Math.round(size.height * 0.4)}px;overflow:hidden;
  text-shadow:0 ${un(2)} ${un(22)} ${rgba(scrimColor, 0.5)};}
.subline{font-family:${bodyFamily(brand)};font-weight:400;color:${rgba(textColor, 0.9)};
  font-size:${sublineSize}px;line-height:1.45;}
.cta{display:inline-block;font-family:${bodyFamily(brand)};font-weight:700;
  font-size:${Math.round(sublineSize * 1.05)}px;color:${palette.background};
  background:${palette.accent};padding:${un(18)} ${un(34)};border-radius:${un(999)};
  align-self:flex-start;}
.brandmark{position:absolute;z-index:5;top:${safeTopPx + gutterPx}px;left:${gutterPx}px;
  display:flex;align-items:center;gap:${un(14)};}
.brandmark img{height:${logoHeightPx}px;width:auto;max-width:${Math.round(size.width * 0.34)}px;
  object-fit:contain;filter:drop-shadow(0 ${un(2)} ${un(10)} ${rgba(scrimColor, 0.5)});}
.brandmark .name{font-family:${bodyFamily(brand)};font-weight:600;color:${textColor};
  font-size:${un(28)};}
.pager{position:absolute;z-index:5;right:${gutterPx}px;bottom:${safeBottomPx + gutterPx}px;
  display:flex;gap:${un(10)};align-items:center;}
.pager span{width:${un(14)};height:${un(14)};border-radius:${un(999)};
  background:${rgba(textColor, 0.35)};}
.pager span.on{background:${palette.accent};width:${un(34)};}
`.trim();

  const pager =
    total > 1
      ? `<div class="pager">${Array.from(
          { length: total },
          (_, i) => `<span class="${i === index ? 'on' : ''}"></span>`
        ).join('')}</div>`
      : '';

  const body = `
<div class="canvas">
  ${buildBackgroundMarkup(background, palette)}
  <div class="scrim" style="background:${scrimBackground};"></div>
  <div class="brandmark">${brandMarkup(brand)}</div>
  <div class="content">
    <div class="stack">
      ${role === 'cover' && badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}
      ${
        role === 'body'
          ? `<div class="step"><span class="dot">${index}</span><span>${total - 2 > 0 ? `${index} / ${total - 2}` : ''}</span></div>`
          : ''
      }
      <h2 class="headline">${escapeHtml(headline)}</h2>
      ${subline ? `<p class="subline">${escapeHtml(subline)}</p>` : ''}
      ${role === 'closing' && cta ? `<span class="cta">${escapeHtml(cta)}</span>` : ''}
    </div>
  </div>
  ${pager}
</div>`.trim();

  return {
    html: buildDocument({ input, extraCss, body }),
    needsBackgroundImage: true,
    textRects: textRectsFor(role, mode, safeArea),
  };
}

type CardRole = 'cover' | 'body' | 'closing';

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

function textRectsFor(
  role: CardRole,
  mode: ReturnType<typeof layoutModeFor>,
  safeArea: TemplateInput['safeArea']
): TextRect[] {
  const topInset = safeArea.top * 100;
  const bottomInset = safeArea.bottom * 100;
  const available = 100 - topInset - bottomInset;

  if (role === 'cover') {
    const height = Math.min(38, available - 4);
    return [{ x: 8, y: 100 - bottomInset - height - 2, w: 84, h: height }];
  }

  // Body and closing cards centre their stack, so the region tracks the middle
  // of the usable band rather than an edge.
  const height = Math.min(mode === 'landscape' ? 52 : 44, available - 4);
  const top = topInset + (available - height) / 2;
  return [{ x: 8, y: top, w: 84, h: height }];
}
