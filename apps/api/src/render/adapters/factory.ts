/**
 * Grafista AI Studio — Renderer Adapter Factory (Phase 2 Step 9A)
 *
 * Mirrors apps/api/src/storage/factory.ts's exact pattern: reads
 * process.env.RENDERER_PROVIDER directly on every call rather than caching a
 * singleton at process startup, so a config change (or a test that flips the
 * env var) takes effect immediately without a process restart. Defaults to
 * 'playwright' when unset (production-like default); tests set
 * RENDERER_PROVIDER=fake in apps/api/vitest.config.ts so the suite never
 * launches a real browser.
 */

import { FakeRendererAdapter } from './fake-adapter.js';
import { PlaywrightRendererAdapter } from './playwright-adapter.js';
import { RenderError, type RendererAdapter, type RendererProviderName } from './types.js';

export function resolveActiveRendererProviderName(): RendererProviderName {
  const raw = (process.env.RENDERER_PROVIDER ?? 'playwright').trim().toLowerCase();
  if (raw !== 'playwright' && raw !== 'fake') {
    throw new RenderError(`Invalid RENDERER_PROVIDER "${raw}" — must be "playwright" or "fake"`, 500);
  }
  return raw;
}

/** Builds the renderer adapter currently configured via RENDERER_PROVIDER. */
export function getRendererAdapter(): RendererAdapter {
  return resolveActiveRendererProviderName() === 'fake' ? new FakeRendererAdapter() : new PlaywrightRendererAdapter();
}
