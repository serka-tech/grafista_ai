import type { Layer } from '@grafista/schemas';
import { describe, expect, it } from 'vitest';
import { buildRenderHtml } from '../html-renderer.js';

// Pure-logic unit tests — no DB/HTTP. See font-resolver.test.ts for why this
// lives under src/render/__tests__/ rather than src/__tests__/.

function textLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'text-1',
    name: 'Headline',
    type: 'text',
    position: { x: 10, y: 20, width: 300, height: 80, rotation: 0, anchor: 'top-left' },
    zIndex: 2,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    textProperties: {
      content: 'Hello <World> & "Friends"',
      fontFamily: 'Roboto',
      fontSize: 32,
      fontWeight: '700',
      color: '#111111',
      alignment: 'left',
    },
    ...overrides,
  } as Layer;
}

function imageLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'image-1',
    name: 'Hero image',
    type: 'image',
    position: { x: 0, y: 0, width: 1080, height: 1080, rotation: 0, anchor: 'top-left' },
    zIndex: 1,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    imageProperties: {
      sourceType: 'uploaded',
      sourceUrl: 'https://example.com/hero.png',
      fit: 'cover',
      opacity: 1,
      borderRadius: 0,
    },
    ...overrides,
  } as Layer;
}

function shapeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'shape-1',
    name: 'Panel',
    type: 'shape',
    position: { x: 5, y: 5, width: 200, height: 100, rotation: 0, anchor: 'top-left' },
    zIndex: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    shapeProperties: {
      shapeType: 'rectangle',
      fillColor: '#ffcc00',
      strokeWidth: 0,
      opacity: 1,
      borderRadius: 4,
    },
    ...overrides,
  } as Layer;
}

const canvas = { width: 1080, height: 1080, backgroundColor: '#ffffff' };

describe('buildRenderHtml', () => {
  it('renders a text+image+shape layer set with escaped text content', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [textLayer(), imageLayer(), shapeLayer()],
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('class="canvas"');
    expect(html).toContain('width: 1080px; height: 1080px');
    expect(html).toContain('Hello &lt;World&gt; &amp; &quot;Friends&quot;');
    expect(html).not.toContain('Hello <World>');
    expect(html).toContain('<img src="https://example.com/hero.png"');
    expect(html).toContain('background-color:#ffcc00');
    expect(warnings).toEqual([]);
  });

  it('excludes an invisible layer entirely with no warning', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [textLayer({ id: 'hidden-1', visible: false })],
    });

    expect(html).not.toContain('hidden-1');
    expect(html).not.toContain('Hello');
    expect(warnings).toEqual([]);
  });

  it('falls back to normal for an unsupported blendMode and records a warning', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [shapeLayer({ blendMode: 'made-up-mode' })],
    });

    expect(html).toContain('mix-blend-mode:normal');
    expect(html).not.toContain('made-up-mode');
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'unsupported_blend_mode', layerId: 'shape-1', severity: 'warning' })
    );
  });

  it('falls back to the default font for a non-whitelisted font and records a warning', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [textLayer({ textProperties: { ...textLayer().textProperties!, fontFamily: 'Comic Sans MS' } })],
    });

    expect(html).toContain("font-family:'Inter'");
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'font_fallback', layerId: 'text-1', severity: 'warning' })
    );
  });

  it('falls back to a safe default color for an invalid color and records a warning', () => {
    const { warnings } = buildRenderHtml({
      canvas,
      layers: [shapeLayer({ shapeProperties: { ...shapeLayer().shapeProperties!, fillColor: 'javascript:alert(1)' } })],
    });

    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'invalid_color', layerId: 'shape-1', severity: 'warning' })
    );
  });

  it('records a warning and emits no filter CSS when imageProperties.filter is present', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [imageLayer({ imageProperties: { ...imageLayer().imageProperties!, filter: 'blur(10px) saturate(2)' } })],
    });

    expect(html).not.toContain('filter:');
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'unsupported_filter', layerId: 'image-1', severity: 'warning' })
    );
  });

  it('flattens nested children and renders them alongside their parent', () => {
    const parent = shapeLayer({
      id: 'group-1',
      type: 'group',
      children: [textLayer({ id: 'child-text' })],
    });

    const { html, warnings } = buildRenderHtml({ canvas, layers: [parent] });

    expect(html).toContain('Hello &lt;World&gt;');
    // 'group' type itself must not raise unsupported_layer_type.
    expect(warnings.find((w) => w.layerId === 'group-1' && w.code === 'unsupported_layer_type')).toBeUndefined();
  });

  it('records an anchor_ignored warning for a non-top-left anchor but still renders the layer', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [textLayer({ position: { ...textLayer().position, anchor: 'center' } })],
    });

    expect(html).toContain('Hello &lt;World&gt;');
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'anchor_ignored', layerId: 'text-1', severity: 'warning' })
    );
  });
});

// Phase 3 Step 1 — generated-visual compositing via the injected imageSources map.
describe('buildRenderHtml — injected image sources (Phase 3 Step 1)', () => {
  const DATA_URI = `data:image/png;base64,${Buffer.from('fake-generated-visual-bytes').toString('base64')}`;

  function aiImageLayer(overrides: Partial<Layer> = {}): Layer {
    return imageLayer({
      id: 'ai-slot',
      imageProperties: { sourceType: 'ai_generated', fit: 'cover', opacity: 1, borderRadius: 0 },
      ...overrides,
    });
  }

  it('renders an <img> with the injected data URI for a sourceless ai_generated slot', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [aiImageLayer()],
      imageSources: { 'ai-slot': DATA_URI },
    });

    expect(html).toContain(`<img src="${DATA_URI}"`);
    expect(html).not.toContain('background-color:#e5e7eb');
    expect(warnings).toEqual([]);
  });

  it('an injected source takes precedence over the layer sourceUrl', () => {
    const layer = aiImageLayer({
      imageProperties: {
        sourceType: 'ai_generated',
        sourceUrl: 'https://example.com/old.png',
        fit: 'cover',
        opacity: 1,
        borderRadius: 0,
      },
    });

    const { html } = buildRenderHtml({ canvas, layers: [layer], imageSources: { 'ai-slot': DATA_URI } });

    expect(html).toContain(`<img src="${DATA_URI}"`);
    expect(html).not.toContain('https://example.com/old.png');
  });

  it('rejects a non-data-URI injected value and keeps the gray placeholder box', () => {
    const { html } = buildRenderHtml({
      canvas,
      layers: [aiImageLayer()],
      imageSources: { 'ai-slot': 'javascript:alert(1)' },
    });

    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain('<img');
    expect(html).toContain('background-color:#e5e7eb');
  });

  it('without an injection, a sourceless slot keeps the exact gray placeholder behavior', () => {
    const { html } = buildRenderHtml({ canvas, layers: [aiImageLayer()] });
    expect(html).not.toContain('<img');
    expect(html).toContain('background-color:#e5e7eb');
  });

  it.each(['cover', 'contain', 'fill', 'none'] as const)(
    'emits object-fit:%s on the composited <img>',
    (fit) => {
      const layer = aiImageLayer({
        imageProperties: { sourceType: 'ai_generated', fit, opacity: 1, borderRadius: 0 },
      });
      const { html } = buildRenderHtml({ canvas, layers: [layer], imageSources: { 'ai-slot': DATA_URI } });
      expect(html).toContain(`object-fit:${fit}`);
      expect(html).toContain('<img');
    }
  );

  it('defaults object-fit to cover when a bare injected slot has no imageProperties', () => {
    const bare = aiImageLayer({ imageProperties: undefined });
    const { html } = buildRenderHtml({ canvas, layers: [bare], imageSources: { 'ai-slot': DATA_URI } });
    expect(html).toContain('object-fit:cover');
  });

  it('preserves borderRadius and layer opacity on the composited <img>', () => {
    const layer = aiImageLayer({
      opacity: 0.5,
      imageProperties: { sourceType: 'ai_generated', fit: 'contain', opacity: 1, borderRadius: 24 },
    });
    const { html } = buildRenderHtml({ canvas, layers: [layer], imageSources: { 'ai-slot': DATA_URI } });

    expect(html).toContain('border-radius:24px');
    expect(html).toContain('opacity:0.5');
    expect(html).toContain('object-fit:contain');
  });
});

// Phase 2 render fix (Option A) — full-canvas visual fallback: when the layout
// has no usable image slot, the generated visual is drawn full-bleed as the
// entire creative and the template's own layers are suppressed.
describe('buildRenderHtml — full-canvas visual fallback (Option A)', () => {
  const FULL_CANVAS_URI = `data:image/png;base64,${Buffer.from('full-canvas-ai-creative-bytes').toString('base64')}`;

  it('renders the visual full-bleed and suppresses all template layers (no headline, no gray placeholder box)', () => {
    // The exact broken-render inputs: a headline text layer, a sourceless logo
    // (would render as a gray box), and a background — plus a real visual.
    const backgroundLayer = shapeLayer({ id: 'bg-1', type: 'background', zIndex: 0 });
    const logoLayer = imageLayer({
      id: 'logo-1',
      type: 'logo',
      imageProperties: { sourceType: 'uploaded', fit: 'contain', opacity: 1, borderRadius: 0 },
    });

    const { html, warnings, usedFullCanvas } = buildRenderHtml({
      canvas,
      layers: [backgroundLayer, textLayer(), logoLayer],
      fullCanvasVisual: FULL_CANVAS_URI,
    });

    // The AI visual is present, full-bleed (object-fit:cover, 100% x 100%).
    expect(html).toContain(`<img class="full-canvas-visual" src="${FULL_CANVAS_URI}"`);
    expect(html).toContain('object-fit:cover');
    expect(html).toContain('width:100%; height:100%');
    expect(usedFullCanvas).toBe(true);

    // An opaque base coat sits behind the image so transparency never leaks to
    // the browser's incidental default (here: white, the default fallback).
    expect(html).toContain('.canvas { position: relative; width: 1080px; height: 1080px; overflow: hidden; background-color: #ffffff;');

    // Template overlays are suppressed — no duplicated headline, no gray box.
    expect(html).not.toContain('Hello &lt;World&gt;');
    expect(html).not.toContain('background-color:#e5e7eb');
    expect(warnings).toEqual([]);
  });

  it('honors an explicit canvas.backgroundColor as the full-canvas base coat', () => {
    const { html } = buildRenderHtml({
      canvas: { width: 1080, height: 1080, backgroundColor: '#000000' },
      layers: [textLayer()],
      fullCanvasVisual: FULL_CANVAS_URI,
    });
    expect(html).toContain('background-color: #000000;');
  });

  it('preserves the requested canvas size for each format', () => {
    for (const [w, h] of [
      [1080, 1080],
      [1080, 1920],
      [1920, 1080],
      [1200, 628],
    ] as const) {
      const { html } = buildRenderHtml({
        canvas: { width: w, height: h },
        layers: [textLayer()],
        fullCanvasVisual: FULL_CANVAS_URI,
      });
      expect(html).toContain(`width: ${w}px; height: ${h}px`);
      expect(html).toContain('<img class="full-canvas-visual"');
    }
  });

  it('composites the real brand logo as an overlay over the full-canvas visual (aspect-preserving, at the given box)', () => {
    const LOGO_URI = `data:image/png;base64,${Buffer.from('real-brand-logo-bytes').toString('base64')}`;
    const { html, usedFullCanvas } = buildRenderHtml({
      canvas,
      layers: [textLayer()],
      fullCanvasVisual: FULL_CANVAS_URI,
      logoOverlay: { dataUri: LOGO_URI, box: { xPct: 39, yPct: 83, wPct: 22, hPct: 12 } },
    });
    expect(usedFullCanvas).toBe(true);
    // The real logo is drawn ON TOP of the full-bleed visual, aspect-preserving.
    expect(html).toContain(`<img class="logo-overlay" src="${LOGO_URI}"`);
    expect(html).toContain('left:39%; top:83%; width:22%; height:12%; object-fit:contain;');
    // Overlay comes after the full-canvas visual so it renders above it.
    expect(html.indexOf('full-canvas-visual')).toBeLessThan(html.indexOf('logo-overlay'));
  });

  it('ignores a logoOverlay whose dataUri is not a valid image data URI (no broken <img>)', () => {
    const { html } = buildRenderHtml({
      canvas,
      layers: [textLayer()],
      fullCanvasVisual: FULL_CANVAS_URI,
      logoOverlay: { dataUri: 'javascript:alert(1)', box: { xPct: 39, yPct: 83, wPct: 22, hPct: 12 } },
    });
    expect(html).not.toContain('class="logo-overlay"');
    expect(html).toContain('class="full-canvas-visual"');
  });

  it.each([
    ['javascript:alert(1)', 'a non-data-URI string'],
    ['data:image/png;base64,', 'an empty-payload data URI (e.g. a 0-byte visual)'],
  ])('an invalid full-canvas source (%s) degrades to normal layer rendering with a full_canvas_visual_invalid warning and usedFullCanvas=false', (badSource) => {
    const { html, warnings, usedFullCanvas } = buildRenderHtml({
      canvas,
      layers: [textLayer(), imageLayer({ imageProperties: { sourceType: 'uploaded', fit: 'cover', opacity: 1, borderRadius: 0 } })],
      fullCanvasVisual: badSource,
    });

    // No broken <img>, and the template layers ARE rendered (safe fallback).
    expect(html).not.toContain('class="full-canvas-visual"');
    expect(html).toContain('Hello &lt;World&gt;');
    // usedFullCanvas must reflect the ACTUAL outcome so the render engine keeps
    // running the QA pass over the layers it really rendered.
    expect(usedFullCanvas).toBe(false);
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'full_canvas_visual_invalid', severity: 'warning' })
    );
  });

  it('without fullCanvasVisual, template layers render normally (visual-missing safe fallback)', () => {
    const { html, warnings, usedFullCanvas } = buildRenderHtml({ canvas, layers: [textLayer()] });
    expect(html).toContain('Hello &lt;World&gt;');
    expect(html).not.toContain('class="full-canvas-visual"');
    expect(usedFullCanvas).toBe(false);
    expect(warnings).toEqual([]);
  });
});
