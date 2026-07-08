/**
 * Grafista AI Studio — Option A full-canvas render E2E (real Playwright/Chromium).
 *
 * Standalone verification, NOT part of the vitest suite (which uses the
 * deterministic fake adapter — see apps/api/vitest.config.ts — and so can never
 * assert real pixels). This script drives the ACTUAL render path
 * (planVisualComposition -> buildRenderHtml -> PlaywrightRendererAdapter) for
 * the exact friction-F8 bug shape — a template with NO image slot (background +
 * headline + logo) plus a loaded generated visual — and asserts, on the real
 * exported PNG bytes:
 *   1. the requested preset dimensions (read from the PNG IHDR),
 *   2. the canvas is NOT mostly white/empty (the AI visual fills it — pixel
 *      sampled via canvas getImageData in a headless page),
 *   3. no gray placeholder box (#e5e7eb) and no headline text leak into the
 *      full-canvas HTML, while the pre-fix normal render of the same template
 *      WOULD have shown the gray box (contrast check).
 *
 * Run:
 *   pnpm --filter @grafista/api exec tsx src/scripts/e2e-full-canvas-render.ts
 * Requires Chromium: npx playwright install chromium
 */

import zlib from 'node:zlib';
import { chromium } from 'playwright';
import type { Layer } from '@grafista/schemas';
import { PlaywrightRendererAdapter } from '../render/adapters/playwright-adapter.js';
import { buildRenderHtml, type RenderableCanvas } from '../render/html-renderer.js';
import { planVisualComposition, type LoadedVisual } from '../render/visual-composition.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  const status = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// ── Minimal solid-color truecolor PNG encoder (no external image lib) ──
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowLen;
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * 3;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}
function readPngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
/** Fully transparent RGBA PNG (color type 6, every pixel alpha=0). */
function transparentPng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = truecolor + alpha
  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(rowLen * height); // all zero -> transparent black
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── Template layers with NO image slot — the pipeline default / F8 bug shape ──
function templateLayers(): Layer[] {
  const base = {
    zIndex: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
  };
  return [
    {
      ...base,
      id: 'bg-1',
      name: 'Background',
      type: 'background',
      position: { x: 0, y: 0, width: 1080, height: 1080, rotation: 0, anchor: 'top-left' },
      shapeProperties: { shapeType: 'rectangle', fillColor: '#ffffff', strokeWidth: 0, opacity: 1, borderRadius: 0 },
    },
    {
      ...base,
      id: 'headline-1',
      name: 'Headline',
      type: 'text',
      zIndex: 10,
      position: { x: 80, y: 120, width: 920, height: 200, rotation: 0, anchor: 'top-left' },
      // White text — the exact "white-on-white, invisible headline" symptom.
      textProperties: { content: 'INVISIBLE-WHITE-HEADLINE', fontFamily: 'Inter', fontSize: 64, fontWeight: '700', color: '#ffffff' },
    },
    {
      ...base,
      id: 'logo-1',
      name: 'Logo',
      type: 'logo',
      zIndex: 20,
      position: { x: 40, y: 40, width: 120, height: 120, rotation: 0, anchor: 'top-left' },
      // No source -> normal render draws the gray placeholder box.
      imageProperties: { sourceType: 'uploaded', fit: 'contain', opacity: 1, borderRadius: 0 },
    },
  ] as Layer[];
}

async function nonWhiteFraction(png: Buffer, browser: import('playwright').Browser): Promise<number> {
  const page = await browser.newPage();
  try {
    const dataUri = `data:image/png;base64,${png.toString('base64')}`;
    // Browser-context body: reference DOM globals through `globalThis` so this
    // typechecks under the project's Node-only lib (tsconfig lib = ES2022, no DOM).
    return await page.evaluate(async (uri): Promise<number> => {
      const g = globalThis as any;
      const img = new g.Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('img decode failed'));
        img.src = uri;
      });
      const c = g.document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data: Uint8ClampedArray = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonWhite = 0;
      let total = 0;
      // Sample every 17th pixel (RGBA stride 4) for speed.
      for (let i = 0; i < data.length; i += 4 * 17) {
        total++;
        if (!(data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245)) nonWhite++;
      }
      return total === 0 ? 0 : nonWhite / total;
    }, dataUri);
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  console.log('Option A full-canvas render E2E (real Playwright)\n');

  const MAGENTA: [number, number, number] = [216, 27, 96]; // distinctive, clearly non-white
  const visualPng = solidPng(64, 64, MAGENTA);
  const visual: LoadedVisual = {
    dataUri: `data:image/png;base64,${visualPng.toString('base64')}`,
    mimeType: 'image/png',
    sizeBytes: visualPng.length,
    dimensions: { width: 64, height: 64 },
  };

  const layers = templateLayers();

  // 1) Composition planner routes a no-image-slot layout to full-canvas.
  const plan = planVisualComposition({ layers, visual });
  check('planner returns fullCanvasVisual for a no-image-slot layout', plan.fullCanvasVisual === visual.dataUri);
  check(
    'planner emits full_canvas_visual_fallback (warning)',
    plan.warnings.some((w) => w.code === 'full_canvas_visual_fallback' && w.severity === 'warning')
  );

  // 2) Full-canvas HTML contains the visual and NO template leakage.
  const fullCanvas = buildRenderHtml({ canvas: { width: 1080, height: 1080 }, layers, fullCanvasVisual: plan.fullCanvasVisual });
  check('full-canvas HTML has no gray placeholder box (#e5e7eb)', !fullCanvas.html.includes('#e5e7eb'));
  check('full-canvas HTML does not leak the headline text', !fullCanvas.html.includes('INVISIBLE-WHITE-HEADLINE'));
  check('full-canvas HTML embeds the full-bleed visual', fullCanvas.html.includes('class="full-canvas-visual"'));

  // Contrast: the pre-fix normal render of the SAME template DID show the gray box.
  const normal = buildRenderHtml({ canvas: { width: 1080, height: 1080 }, layers });
  check('contrast: normal render of the same template WOULD show the gray box', normal.html.includes('#e5e7eb'));

  // 3) Real render -> real PNG -> pixel + dimension checks.
  const adapter = new PlaywrightRendererAdapter();
  const browser = await chromium.launch({ headless: true });
  try {
    const presets: Array<{ label: string; width: number; height: number }> = [
      { label: 'instagram_post 1080x1080', width: 1080, height: 1080 },
      { label: 'instagram_story 1080x1920', width: 1080, height: 1920 },
    ];
    for (const preset of presets) {
      const canvas: RenderableCanvas = { width: preset.width, height: preset.height };
      const { html } = buildRenderHtml({ canvas, layers, fullCanvasVisual: plan.fullCanvasVisual });
      const { buffer, mimeType } = await adapter.render({ html, width: preset.width, height: preset.height, format: 'png' });

      const size = readPngSize(buffer);
      check(
        `${preset.label}: exported PNG has correct dimensions`,
        size.width === preset.width && size.height === preset.height,
        `got ${size.width}x${size.height}`
      );
      check(`${preset.label}: mime is image/png`, mimeType === 'image/png');

      const frac = await nonWhiteFraction(buffer, browser);
      check(
        `${preset.label}: PNG is NOT mostly white/empty`,
        frac > 0.9,
        `${(frac * 100).toFixed(1)}% non-white pixels`
      );
    }

    // Transparency base coat: a fully-transparent visual over a non-white
    // canvas background must export as that background color, NOT browser-white
    // (validates the buildFullCanvasHtml base-coat — review finding).
    const transparentUri = `data:image/png;base64,${transparentPng(64, 64).toString('base64')}`;
    const tealCanvas: RenderableCanvas = { width: 1080, height: 1080, backgroundColor: '#1b998b' };
    const { html: transHtml } = buildRenderHtml({ canvas: tealCanvas, layers, fullCanvasVisual: transparentUri });
    const trans = await adapter.render({ html: transHtml, width: 1080, height: 1080, format: 'png' });
    const transFrac = await nonWhiteFraction(trans.buffer, browser);
    check(
      'transparent visual over a non-white canvas exports the base coat, not white',
      transFrac > 0.9,
      `${(transFrac * 100).toFixed(1)}% non-white pixels`
    );
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E script crashed:', err);
  process.exit(1);
});
