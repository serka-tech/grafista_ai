import { contrastAgainstLuminance } from '../templates/helpers.js';
import { samplePngRegions, type RenderResult } from '../templates/render.js';
import type { TextRect } from '../templates/types.js';

/**
 * Quality control on the finished pixels.
 *
 * The old pipeline asked a language model whether a layout looked good, with
 * the render deliberately withheld from it (`router.ts` downgraded the call to
 * text-only), so it approved images it had never seen. Worse, the checks that
 * did exist ran *before* the render and had no access to pixels at all, which
 * is why a design that came out as one flat colour still passed.
 *
 * This runs after the render, on the actual PNG, and measures rather than
 * judges. No model, no cost, no latency beyond a canvas pass.
 */

export type PixelIssueCode =
  | 'flat_output'
  | 'low_contrast'
  | 'busy_text_area'
  | 'clipped_text'
  | 'font_not_loaded';

export interface PixelIssue {
  code: PixelIssueCode;
  message: string;
  /** Which text region tripped it, when applicable. */
  regionIndex?: number;
  measured?: number;
  threshold?: number;
}

export type PixelRemedy =
  | 'none'
  | 'increase_scrim'
  | 'increase_blur'
  | 'shorten_copy'
  | 'switch_template';

export interface PixelReport {
  passed: boolean;
  issues: PixelIssue[];
  /** What the caller should change before re-rendering. */
  remedy: PixelRemedy;
  measurements: {
    canvasStdDev: number;
    regions: {
      meanLuminance: number;
      contrast: number;
      edgeDensity: number;
    }[];
  };
}

/** WCAG AA for large text. Headlines here are always large. */
const MIN_CONTRAST = 4.5;
/** Below this the whole canvas is effectively one colour. */
const MIN_CANVAS_STDDEV = 0.02;
/** Above this there is too much detail directly behind the words. */
const MAX_TEXT_EDGE_DENSITY = 0.18;

export async function checkRenderedDesign(options: {
  render: RenderResult;
  textRects: TextRect[];
  /** The colour the template actually set on the headline. */
  textColor: string;
}): Promise<PixelReport> {
  const { render, textRects, textColor } = options;

  // The full canvas comes first in the batch so both measurements share one
  // decode and one page.
  const samples = await samplePngRegions(render.png, [
    { x: 0, y: 0, w: 100, h: 100 },
    ...textRects,
  ]);

  const canvas = samples[0];
  const regionSamples = samples.slice(1);

  const issues: PixelIssue[] = [];

  if (render.missingFonts.length > 0) {
    issues.push({
      code: 'font_not_loaded',
      message: `Yüklenemeyen font: ${render.missingFonts.join(', ')}. Tasarım yedek yazı tipiyle çizildi.`,
    });
  }

  for (const clipped of render.clippedText) {
    issues.push({
      code: 'clipped_text',
      message:
        `Metin kutusuna sığmadı ve kesildi (.${clipped.selector}): ` +
        `"${clipped.text}" — kutu ${clipped.clientHeight}px, içerik ${clipped.scrollHeight}px.`,
      measured: clipped.scrollHeight,
      threshold: clipped.clientHeight,
    });
  }

  if (canvas.luminanceStdDev < MIN_CANVAS_STDDEV) {
    issues.push({
      code: 'flat_output',
      message: 'Görsel neredeyse tek renk. Arka plan üretimi boş dönmüş olabilir.',
      measured: canvas.luminanceStdDev,
      threshold: MIN_CANVAS_STDDEV,
    });
  }

  const regions = regionSamples.map((sample, index) => {
    const contrast = contrastAgainstLuminance(
      textRects[index]?.textColor ?? textColor,
      sample.meanLuminance
    );

    if (contrast < MIN_CONTRAST) {
      issues.push({
        code: 'low_contrast',
        message: `Metin bölgesi ${index + 1}: kontrast ${contrast.toFixed(2)}, okunabilirlik eşiği ${MIN_CONTRAST}.`,
        regionIndex: index,
        measured: contrast,
        threshold: MIN_CONTRAST,
      });
    }

    if (sample.edgeDensity > MAX_TEXT_EDGE_DENSITY) {
      issues.push({
        code: 'busy_text_area',
        message: `Metin bölgesi ${index + 1}: arka plan fazla detaylı (${(sample.edgeDensity * 100).toFixed(1)}%). Model görselin üstüne yazı çizmiş olabilir.`,
        regionIndex: index,
        measured: sample.edgeDensity,
        threshold: MAX_TEXT_EDGE_DENSITY,
      });
    }

    return {
      meanLuminance: sample.meanLuminance,
      contrast,
      edgeDensity: sample.edgeDensity,
    };
  });

  return {
    passed: issues.length === 0,
    issues,
    remedy: chooseRemedy(issues),
    measurements: { canvasStdDev: canvas.luminanceStdDev, regions },
  };
}

/**
 * Picks the single cheapest fix for what was measured.
 *
 * Ordered by cost, and none of these spends another image generation call:
 * raising the scrim or the blur is a re-render of HTML we already have, about a
 * second. Only when the background is both too detailed and too low-contrast is
 * the image itself the problem, and the answer there is to switch to a template
 * with an opaque panel rather than to pay for a second generation and hope.
 */
function chooseRemedy(issues: PixelIssue[]): PixelRemedy {
  const codes = new Set(issues.map((issue) => issue.code));

  // Clipping is a fitting problem, not a background problem, and no amount of
  // scrim or blur fixes it. Shortening the copy is the caller's job.
  if (codes.has('clipped_text')) return 'shorten_copy';

  if (codes.has('low_contrast') && codes.has('busy_text_area')) return 'switch_template';
  if (codes.has('busy_text_area')) return 'increase_blur';
  if (codes.has('low_contrast')) return 'increase_scrim';

  // A flat canvas is an upstream failure and a font that would not load is an
  // environment failure. Neither is fixed by re-rendering the same input.
  return 'none';
}
