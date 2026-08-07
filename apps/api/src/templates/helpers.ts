import type { BrandPalette } from './types.js';

/** Escapes text before it goes into HTML. Copy is the one untrusted input here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Colours reach us from a client's palette, which is extracted by a vision
 * model and then editable by hand, so neither end is trustworthy enough to
 * interpolate straight into a stylesheet. Anything that is not a plain six
 * digit hex is replaced by the fallback rather than passed through.
 */
export function safeColor(value: string | undefined, fallback: string): string {
  if (!value || !HEX_COLOR.test(value.trim())) return fallback;
  return value.trim().toLowerCase();
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped.toFixed(3)})`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Contrast against a known luminance rather than a colour, for measured pixels. */
export function contrastAgainstLuminance(foreground: string, luminance: number): number {
  const a = relativeLuminance(foreground);
  const lighter = Math.max(a, luminance);
  const darker = Math.min(a, luminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Picks whichever of the palette's text colours reads better on a given
 * backdrop, falling back to plain white or black when neither brand colour
 * clears the threshold. Legibility outranks brand fidelity here: an unreadable
 * headline in the exact brand grey is worse than a readable white one.
 */
export function pickTextColor(palette: BrandPalette, backdrop: string): string {
  const candidates = [palette.text, palette.background, '#ffffff', '#111111'];
  let best = '#ffffff';
  let bestRatio = 0;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, backdrop);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

/**
 * How opaque the scrim behind text has to be for the text colour to clear the
 * WCAG AA threshold, assuming the worst case that the photo underneath is the
 * opposite extreme of the text.
 *
 * Computed rather than guessed. A fixed 40% scrim is either too weak over a
 * bright sky or needlessly heavy over a dark interior, and the failure is
 * invisible until someone looks at the output.
 */
export function scrimAlphaFor(textColor: string, scrimColor: string, boost = 0): number {
  const textLuminance = relativeLuminance(textColor);
  // Worst case backdrop is the far end of the luminance range from the text.
  const worstCase = textLuminance > 0.5 ? 1 : 0;
  const scrimLuminance = relativeLuminance(scrimColor);

  let alpha = 0.15;
  while (alpha < 0.95) {
    // Alpha compositing on luminance is an approximation, but it errs towards
    // more scrim rather than less, which is the safe direction.
    const blended = worstCase * (1 - alpha) + scrimLuminance * alpha;
    const lighter = Math.max(textLuminance, blended);
    const darker = Math.min(textLuminance, blended);
    if ((lighter + 0.05) / (darker + 0.05) >= 4.5) break;
    alpha += 0.05;
  }

  return Math.min(0.95, Math.round((alpha + boost) * 100) / 100);
}

/**
 * Uppercases Turkish correctly.
 *
 * CSS `text-transform: uppercase` is wrong for Turkish and cannot be fixed with
 * a lang attribute reliably across engines: "iyi" becomes "IYI" instead of
 * "İYİ", and "ısı" becomes "ISI" instead of "ISI" only by accident. Templates
 * therefore never use text-transform; they call this and emit the result.
 */
export function turkishUpper(value: string): string {
  return value.replace(/i/g, 'İ').replace(/ı/g, 'I').toLocaleUpperCase('tr-TR');
}

/** Lowercases Turkish correctly, the mirror of the above. */
export function turkishLower(value: string): string {
  return value.replace(/I/g, 'ı').replace(/İ/g, 'i').toLocaleLowerCase('tr-TR');
}

/**
 * Chooses a font size that keeps a headline inside its box.
 *
 * A rough character-count model rather than real text metrics: we cannot
 * measure glyphs before the browser has them, and a second render pass to
 * measure would double the cost of every design. The estimate is deliberately
 * conservative, and the CSS that consumes it also sets a hard max-height with
 * overflow hidden so a bad estimate crops rather than spills over the logo.
 */
/**
 * How many lines a string takes at a given size, by greedy word wrap.
 *
 * Shared with autoFitFontSize so a template can reserve the real height of its
 * secondary copy before deciding how big the headline may be. Splitting a fixed
 * box by a guessed ratio (say 60% headline, 40% subline) is what produces a
 * headline sized to fit a budget the subline then overruns, cropping both.
 */
export function estimateLineCount(options: {
  text: string;
  fontSizePx: number;
  maxWidthPx: number;
  widthRatio?: number;
}): number {
  const words = options.text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  const widthRatio = options.widthRatio ?? 0.52;
  const charsPerLine = Math.max(1, Math.floor(options.maxWidthPx / (options.fontSizePx * widthRatio)));

  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used === 0) {
      used = word.length;
    } else if (used + 1 + word.length <= charsPerLine) {
      used += 1 + word.length;
    } else {
      lines += 1;
      used = word.length;
    }
    if (used > charsPerLine) {
      lines += Math.floor(used / charsPerLine);
      used = used % charsPerLine;
    }
  }
  return lines;
}

/** Height a string needs at a given size, rounded up. */
export function estimateWrappedHeight(options: {
  text: string;
  fontSizePx: number;
  maxWidthPx: number;
  lineHeight?: number;
  widthRatio?: number;
}): number {
  const lines = estimateLineCount(options);
  if (lines === 0) return 0;
  return Math.ceil(lines * options.fontSizePx * (options.lineHeight ?? 1.4));
}

export function autoFitFontSize(options: {
  text: string;
  maxWidthPx: number;
  maxHeightPx: number;
  maxFontPx: number;
  minFontPx: number;
  /** Mean glyph width as a fraction of font size. ~0.5 for most sans faces. */
  widthRatio?: number;
  lineHeight?: number;
}): number {
  const { text, maxWidthPx, maxHeightPx, maxFontPx, minFontPx } = options;
  const lineHeight = options.lineHeight ?? 1.08;

  // Uppercase runs wider than the mixed-case average: caps have no narrow
  // x-height forms and no descenders to tuck under. Templates that call
  // turkishUpper() would otherwise get a size that only fits in theory.
  const letters = text.replace(/[^\p{L}]/gu, '');
  const upperShare =
    letters.length === 0
      ? 0
      : letters.split('').filter((c) => c === turkishUpper(c) && c !== turkishLower(c)).length /
        letters.length;
  const widthRatio = (options.widthRatio ?? 0.52) * (1 + 0.14 * upperShare);

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return minFontPx;

  for (let size = maxFontPx; size >= minFontPx; size -= 2) {
    const charsPerLine = Math.max(1, Math.floor(maxWidthPx / (size * widthRatio)));

    // Greedy word wrap rather than characters ÷ charsPerLine.
    //
    // The division model assumes text flows across the line break, but words
    // do not split: a line that cannot fit the next word ends early and wastes
    // the remainder. On a headline of a few long Turkish words that adds a
    // whole line, which is exactly how a fitted headline ended up cropped
    // through the middle of its last row.
    let lines = 1;
    let used = 0;
    for (const word of words) {
      if (used === 0) {
        used = word.length;
      } else if (used + 1 + word.length <= charsPerLine) {
        used += 1 + word.length;
      } else {
        lines += 1;
        used = word.length;
      }
      // A single word wider than the line wraps mid-word and costs extra rows.
      if (used > charsPerLine) {
        lines += Math.floor(used / charsPerLine);
        used = used % charsPerLine;
      }
    }

    // Eight percent of headroom absorbs the gap between this estimate and the
    // browser's real metrics. Measured rather than guessed: at two percent,
    // real Turkish headlines still wrapped one line further than predicted and
    // cropped through the last row. The cost of being generous is a slightly
    // smaller headline; the cost of being tight is a sliced word.
    if (lines * size * lineHeight <= maxHeightPx * 0.92) return size;
  }

  return minFontPx;
}

/** Trims copy to a hard character budget on a word boundary, adding an ellipsis. */
export function clampText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const cut = trimmed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[.,;:!?\s]+$/, '')}…`;
}
