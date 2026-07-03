/**
 * Grafista AI Studio — Renderer Adapter Contract (Phase 2 Step 9A)
 *
 * A single interface with two implementations (a real headless-browser
 * renderer, and a deterministic fake for tests) so callers never talk to
 * Playwright directly. Selecting which implementation backs a given call is
 * done via ./factory.ts, mirroring apps/api/src/storage/factory.ts's
 * env-driven, read-on-every-call pattern.
 */

import type { ExportFormat } from '@grafista/schemas';

export type RendererProviderName = 'playwright' | 'fake';

export interface RenderInput {
  /** A complete, self-contained HTML document — see ../html-renderer.ts. */
  html: string;
  width: number;
  height: number;
  format: ExportFormat;
}

export interface RenderOutput {
  buffer: Buffer;
  mimeType: string;
}

export interface RendererAdapter {
  readonly name: RendererProviderName;
  readonly version: string;
  render(input: RenderInput): Promise<RenderOutput>;
}

/**
 * Raised for any renderer configuration or execution failure. Carries an
 * HTTP status so the existing error-handler middleware (which reads
 * `err.status`) renders a clear 4xx/5xx instead of a generic 500 with no
 * context — same convention as StorageError (apps/api/src/storage/types.ts).
 */
export class RenderError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'RenderError';
    this.status = status;
  }
}
