/**
 * Grafista AI Studio — Chromium runtime resolution check.
 *
 * Asserts that the Playwright Chromium browser this image ships is actually
 * RESOLVABLE and LAUNCHABLE by whatever user runs this process — the exact
 * runtime assumption the Dockerfile must satisfy (browsers installed to the
 * shared PLAYWRIGHT_BROWSERS_PATH, then chowned to the non-root `grafista`
 * user). It is deliberately independent of the render pipeline: no DB, no
 * network, no storage — just "can Playwright find and start Chromium here".
 *
 * Intended uses:
 *   - as the final RUN assertion when validating the image build, and
 *   - as a post-deploy sanity probe (`pnpm --filter @grafista/api run
 *     check:chromium` inside the container) that would have caught the
 *     "Executable doesn't exist at .../ms-playwright/..." failure BEFORE a
 *     render request did.
 *
 * Exits 0 on success, 1 (with a clear message) on any failure. Never prints
 * secrets.
 */

import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

async function main(): Promise<void> {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(unset — Playwright default per-user cache)';
  console.log(`[check-chromium] PLAYWRIGHT_BROWSERS_PATH = ${browsersPath}`);
  console.log(`[check-chromium] process uid/gid = ${typeof process.getuid === 'function' ? process.getuid() : '?'}/${typeof process.getgid === 'function' ? process.getgid() : '?'}`);

  // Where Playwright THINKS Chromium is (honors PLAYWRIGHT_BROWSERS_PATH).
  const execPath = chromium.executablePath();
  console.log(`[check-chromium] chromium.executablePath() = ${execPath}`);

  if (!existsSync(execPath)) {
    console.error(
      `[check-chromium] FAIL — resolved Chromium executable does not exist on disk for this user.\n` +
        `  This is the "Executable doesn't exist" failure: browsers were installed to a path this ` +
        `user cannot see. Ensure the image installs into PLAYWRIGHT_BROWSERS_PATH and chowns it to the runtime user.`
    );
    process.exit(1);
  }

  // Resolving the path is necessary but not sufficient — actually launch the
  // headless browser (this is what a render does) and read its version, then
  // close it. Exercises the headless-shell binary too.
  const browser = await chromium.launch({ headless: true });
  try {
    const version = browser.version();
    console.log(`[check-chromium] launched + closed OK — Chromium version ${version}`);
  } finally {
    await browser.close();
  }

  console.log('[check-chromium] ✅ Chromium resolves AND launches for the current runtime user');
}

main().catch((err) => {
  console.error(`[check-chromium] FAIL — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
