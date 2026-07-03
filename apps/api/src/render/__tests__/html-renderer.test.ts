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
      expect.objectContaining({ code: 'unsupported_blend_mode', layerId: 'shape-1' })
    );
  });

  it('falls back to the default font for a non-whitelisted font and records a warning', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [textLayer({ textProperties: { ...textLayer().textProperties!, fontFamily: 'Comic Sans MS' } })],
    });

    expect(html).toContain("font-family:'Inter'");
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'font_fallback', layerId: 'text-1' })
    );
  });

  it('falls back to a safe default color for an invalid color and records a warning', () => {
    const { warnings } = buildRenderHtml({
      canvas,
      layers: [shapeLayer({ shapeProperties: { ...shapeLayer().shapeProperties!, fillColor: 'javascript:alert(1)' } })],
    });

    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'invalid_color', layerId: 'shape-1' })
    );
  });

  it('records a warning and emits no filter CSS when imageProperties.filter is present', () => {
    const { html, warnings } = buildRenderHtml({
      canvas,
      layers: [imageLayer({ imageProperties: { ...imageLayer().imageProperties!, filter: 'blur(10px) saturate(2)' } })],
    });

    expect(html).not.toContain('filter:');
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'unsupported_filter', layerId: 'image-1' })
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
      expect.objectContaining({ code: 'anchor_ignored', layerId: 'text-1' })
    );
  });
});
