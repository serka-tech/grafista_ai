import { chromium, type Browser } from 'playwright';

import { loadedFontChecks } from './fonts.js';
import type { TemplateSize } from './types.js';

/**
 * The callbacks handed to `page.evaluate()` are serialised and run inside
 * Chromium, so they legitimately reference browser globals. The API's tsconfig
 * deliberately omits the DOM lib — enabling it would let ordinary server code
 * reference `document` and still typecheck, which is a worse trade than a few
 * local declarations. Only the members actually used are declared.
 */
declare const getComputedStyle: (element: unknown) => { fontFamily: string; fontWeight: string };
declare const document: {
  fonts: { ready: Promise<unknown>; check(font: string, text?: string): boolean };
  querySelectorAll(selector: string): ArrayLike<{
    textContent: string | null;
    className: string;
    tagName: string;
    clientHeight: number;
    scrollHeight: number;
  }>;
  createElement(tag: 'canvas'): {
    width: number;
    height: number;
    getContext(id: '2d'): {
      drawImage(image: unknown, dx: number, dy: number): void;
      getImageData(
        sx: number,
        sy: number,
        sw: number,
        sh: number
      ): { data: Uint8ClampedArray };
    } | null;
  };
};
declare const Image: {
  new (): { src: string; decode(): Promise<void>; naturalWidth: number; naturalHeight: number };
};

/**
 * Renders template HTML to a PNG.
 *
 * Separate from `render/adapters/playwright-adapter.ts` on purpose. That
 * adapter launches a fresh browser per render and waits on `networkidle`
 * because the legacy renderer pulls fonts over the network; both choices are
 * wrong here and changing them there would break the old flow. This module
 * keeps one browser alive across the batch (twelve designs would otherwise pay
 * twelve cold starts) and waits on font readiness instead of the network,
 * because nothing it renders makes a request at all.
 */

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((err: unknown) => {
      // Reset so a later call can retry rather than reusing a rejected promise
      // forever, which would turn one transient launch failure into a dead
      // worker for the lifetime of the process.
      browserPromise = null;
      throw new Error(
        `Chromium başlatılamadı: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }
  return browserPromise;
}

export async function closeRenderBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // Nothing useful to do while shutting down.
  }
}

export interface ClippedText {
  /** Class list of the offending element, enough to identify it in a template. */
  selector: string;
  text: string;
  clientHeight: number;
  scrollHeight: number;
}

export interface RenderResult {
  png: Buffer;
  /**
   * Text that overflowed its box and got cut off.
   *
   * Templates cap headline blocks with `max-height` and `overflow:hidden` so a
   * bad auto-fit estimate crops rather than spilling over the logo. Cropping is
   * the safer failure, but it is still a failure: it slices glyphs in half
   * mid-word and every structural check still passes, because the text is in
   * the DOM and the element's box is where the template said it would be.
   */
  clippedText: ClippedText[];
  /**
   * Families the browser could not resolve. Empty on a healthy render. A
   * non-empty list means the screenshot silently used a fallback face, which
   * looks close enough to pass a glance and ruins the typography — so it is
   * surfaced rather than swallowed.
   */
  missingFonts: string[];
}

export async function renderTemplateHtml(
  html: string,
  size: TemplateSize
): Promise<RenderResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
  });

  try {
    const page = await context.newPage();
    // Everything is inlined, so there is no network to idle. Waiting for it
    // would just add the request-timeout delay on an offline machine.
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);

    // Check only the faces this document actually puts on screen, against the
    // text they actually carry.
    //
    // Checking every declared face instead reports most of them missing on a
    // healthy render: `unicode-range` faces stay `unloaded` until something
    // needs a glyph from their range, and a template uses two families out of
    // six. An earlier version did exactly that and cried wolf on all 21
    // previews while the typography was in fact correct.
    const knownFamilies = [...new Set(loadedFontChecks().map((face) => face.family))];
    const missingFonts = await page.evaluate((families) => {
      const failures = new Set<string>();
      const elements = Array.prototype.slice.call(document.querySelectorAll('*'));
      for (const element of elements) {
        const text = (element.textContent ?? '').trim();
        if (!text) continue;

        const style = getComputedStyle(element);
        const first = style.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
        if (families.indexOf(first) === -1) continue;

        const weight = style.fontWeight || '400';
        if (!document.fonts.check(`${weight} 16px "${first}"`, text)) {
          failures.add(`${first} ${weight}`);
        }
      }
      return Array.prototype.slice.call(failures);
    }, knownFamilies);

    // The threshold is proportional, not a flat pixel count. Line boxes round
    // up by a few pixels on almost every block of large text, so a fixed 2px
    // rule fires on renders where nothing is visibly cut. What actually matters
    // is losing part of a glyph row, which costs a meaningful share of the box.
    const clippedText = await page.evaluate(() => {
      const found: { selector: string; text: string; clientHeight: number; scrollHeight: number }[] = [];
      const elements = Array.prototype.slice.call(document.querySelectorAll('*'));
      for (const element of elements) {
        const text = (element.textContent ?? '').trim();
        if (!text) continue;
        // Decorative glyphs (an oversized quote mark, a numeral watermark) are
        // meant to bleed past their box. They are always a character or two of
        // punctuation, never copy, so excluding them costs no real coverage.
        if (text.length <= 2 && !/[\p{L}\p{N}]/u.test(text)) continue;
        const overflow = element.scrollHeight - element.clientHeight;
        if (overflow > Math.max(6, element.clientHeight * 0.05)) {
          found.push({
            selector: element.className || element.tagName,
            text: text.slice(0, 60),
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
          });
        }
      }
      return found;
    });

    const png = await page.screenshot({ type: 'png' });
    return { png, missingFonts, clippedText };
  } finally {
    await context.close();
  }
}

export interface PixelSample {
  /** Mean WCAG relative luminance across the sampled region, 0 to 1. */
  meanLuminance: number;
  /** Standard deviation of per-pixel luminance. Near zero means a flat fill. */
  luminanceStdDev: number;
  /**
   * Share of sampled pixels whose neighbour differs sharply. High values inside
   * a text region mean something detailed is behind the words, which is how a
   * background that the image model wrote letters into gives itself away.
   */
  edgeDensity: number;
}

export interface RegionSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Measures regions of a rendered PNG.
 *
 * Runs inside the already-open Chromium rather than pulling in an image
 * library. `sharp` would be the obvious choice but it is a second native
 * dependency with prebuilt-binary problems on the deployment targets, and
 * Playwright is already here with a full canvas implementation.
 */
export async function samplePngRegions(
  png: Buffer,
  regions: RegionSpec[]
): Promise<PixelSample[]> {
  if (regions.length === 0) return [];

  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><body></body></html>', {
      waitUntil: 'domcontentloaded',
    });

    return await page.evaluate(
      async ({ dataUri, regions: specs }) => {
        const image = new Image();
        image.src = dataUri;
        await image.decode();

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d context unavailable');
        ctx.drawImage(image, 0, 0);

        // A lookup table rather than a helper function on purpose: esbuild (via
        // tsx) wraps named function expressions in its `__name` helper, which
        // does not exist in the page, so any inner named function makes the
        // whole evaluate throw `__name is not defined` at runtime. Only
        // anonymous callbacks are safe here.
        const lut = new Float64Array(256);
        for (let i = 0; i < 256; i += 1) {
          const c = i / 255;
          lut[i] = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        }

        return specs.map((spec) => {
          const sx = Math.max(0, Math.round((spec.x / 100) * canvas.width));
          const sy = Math.max(0, Math.round((spec.y / 100) * canvas.height));
          const sw = Math.max(1, Math.min(canvas.width - sx, Math.round((spec.w / 100) * canvas.width)));
          const sh = Math.max(1, Math.min(canvas.height - sy, Math.round((spec.h / 100) * canvas.height)));

          const { data } = ctx.getImageData(sx, sy, sw, sh);

          const luminances = new Float64Array(sw * sh);
          let sum = 0;
          for (let i = 0; i < sw * sh; i += 1) {
            const o = i * 4;
            const lum =
              0.2126 * lut[data[o]] + 0.7152 * lut[data[o + 1]] + 0.0722 * lut[data[o + 2]];
            luminances[i] = lum;
            sum += lum;
          }

          const mean = sum / luminances.length;
          let variance = 0;
          for (let i = 0; i < luminances.length; i += 1) {
            const delta = luminances[i] - mean;
            variance += delta * delta;
          }
          variance /= luminances.length;

          // Horizontal neighbour difference is enough to separate a photograph
          // or lettering from a smooth gradient, and costs one pass.
          let edges = 0;
          let compared = 0;
          for (let row = 0; row < sh; row += 1) {
            for (let col = 1; col < sw; col += 1) {
              const here = luminances[row * sw + col];
              const prev = luminances[row * sw + col - 1];
              if (Math.abs(here - prev) > 0.12) edges += 1;
              compared += 1;
            }
          }

          return {
            meanLuminance: mean,
            luminanceStdDev: Math.sqrt(variance),
            edgeDensity: compared === 0 ? 0 : edges / compared,
          };
        });
      },
      { dataUri: `data:image/png;base64,${png.toString('base64')}`, regions }
    );
  } finally {
    await context.close();
  }
}
