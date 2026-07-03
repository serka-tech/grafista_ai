/**
 * Grafista AI Studio — Playwright Renderer Adapter (Phase 2 Step 9A)
 *
 * The real renderer: launches headless Chromium, loads the self-contained
 * HTML document built by ../html-renderer.ts, and captures it as a
 * PNG/JPG/PDF. Never used by the test suite (RENDERER_PROVIDER=fake there —
 * see apps/api/vitest.config.ts); this class only runs when
 * RENDERER_PROVIDER is unset or explicitly 'playwright'.
 *
 * `playwright` is a real dependency of this package (see package.json), so a
 * static import is safe at the TypeScript/module-resolution level even
 * though this class is only ever exercised at runtime in
 * RENDERER_PROVIDER=playwright environments with Chromium actually
 * installed (`npx playwright install chromium`).
 */

import { chromium } from 'playwright';
import { RenderError, type RenderInput, type RenderOutput, type RendererAdapter, type RendererProviderName } from './types.js';

// Pinned to match the "playwright" dependency version in apps/api/package.json.
// Kept as a hardcoded constant (documented here) rather than read from the
// installed package's package.json at runtime — simpler, and avoids an extra
// fs read on every construction for a value that only changes when the
// dependency itself is bumped.
const PLAYWRIGHT_PACKAGE_VERSION = '1.61.1';

export class PlaywrightRendererAdapter implements RendererAdapter {
  readonly name: RendererProviderName = 'playwright';
  readonly version = PLAYWRIGHT_PACKAGE_VERSION;

  async render(input: RenderInput): Promise<RenderOutput> {
    const browser = await chromium.launch({ headless: true }).catch((err: unknown) => {
      throw new RenderError(
        `Failed to launch Playwright/Chromium: ${err instanceof Error ? err.message : String(err)}`,
        502
      );
    });

    try {
      const page = await browser.newPage({ viewport: { width: input.width, height: input.height } });
      await page.setContent(input.html, { waitUntil: 'networkidle' });

      if (input.format === 'png') {
        const buffer = await page.screenshot({ type: 'png' });
        return { buffer, mimeType: 'image/png' };
      }
      if (input.format === 'jpg') {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 90 });
        return { buffer, mimeType: 'image/jpeg' };
      }

      // format === 'pdf'
      const buffer = await page.pdf({
        width: `${input.width}px`,
        height: `${input.height}px`,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return { buffer, mimeType: 'application/pdf' };
    } catch (err) {
      if (err instanceof RenderError) throw err;
      throw new RenderError(`Playwright render failed: ${err instanceof Error ? err.message : String(err)}`, 502);
    } finally {
      await browser.close();
    }
  }
}
