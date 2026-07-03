/**
 * Grafista AI Studio — Fake Renderer Adapter (Phase 2 Step 9A)
 *
 * A deterministic stand-in for PlaywrightRendererAdapter: no real rendering,
 * no browser, no network. Used by the whole test suite by default
 * (RENDERER_PROVIDER=fake in apps/api/vitest.config.ts) so tests never
 * launch a real browser. Same input always produces byte-identical output —
 * no Date.now(), no Math.random(), no I/O.
 */

import { createHash } from 'node:crypto';
import type { RenderInput, RenderOutput, RendererAdapter, RendererProviderName } from './types.js';

/** Real magic bytes for each format, prefixed onto the deterministic payload so anything checking
 * file signatures (e.g. a `file` command, an image library sniffing headers) doesn't choke. */
const MAGIC_BYTES: Record<RenderInput['format'], Buffer> = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: Buffer.from([0xff, 0xd8, 0xff]),
  pdf: Buffer.from('%PDF-1.4\n'),
};

const MIME_TYPES: Record<RenderInput['format'], string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
};

export class FakeRendererAdapter implements RendererAdapter {
  readonly name: RendererProviderName = 'fake';
  readonly version = 'fake-1.0.0';

  async render(input: RenderInput): Promise<RenderOutput> {
    const digest = createHash('sha256')
      .update(`${input.html}|${input.format}|${input.width}x${input.height}`)
      .digest();

    const buffer = Buffer.concat([MAGIC_BYTES[input.format], digest]);

    return { buffer, mimeType: MIME_TYPES[input.format] };
  }
}
