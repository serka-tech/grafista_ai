import type { Layer, SafeZone } from '@grafista/schemas';
import { describe, expect, it } from 'vitest';
import { assessRenderQuality } from '../render-quality.js';

// Pure-logic unit tests — no DB/HTTP. See html-renderer.test.ts /
// font-resolver.test.ts for why this lives under src/render/__tests__/.

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
      content: 'Short text',
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
    position: { x: 0, y: 0, width: 400, height: 300, rotation: 0, anchor: 'top-left' },
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

function logoLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'logo-1',
    name: 'Logo',
    type: 'logo',
    position: { x: 40, y: 40, width: 120, height: 120, rotation: 0, anchor: 'top-left' },
    zIndex: 20,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    imageProperties: {
      sourceType: 'uploaded',
      sourceUrl: 'https://example.com/logo.png',
      fit: 'contain',
      opacity: 1,
      borderRadius: 0,
    },
    ...overrides,
  } as Layer;
}

function safeZone(overrides: Partial<SafeZone> = {}): SafeZone {
  return {
    label: 'Top platform UI',
    position: { x: 0, y: 0, width: 1080, height: 250, rotation: 0, anchor: 'top-left' },
    ...overrides,
  } as SafeZone;
}

const canvas = { width: 1080, height: 1080 };

describe('assessRenderQuality', () => {
  describe('text_overflow_possible', () => {
    it('warns (spill message) when estimated lines exceed capacity and no maxLines is set', () => {
      const layer = textLayer({
        textProperties: {
          ...textLayer().textProperties!,
          content: 'A'.repeat(500),
          fontSize: 40,
        },
        position: { x: 0, y: 0, width: 100, height: 50, rotation: 0, anchor: 'top-left' },
      });

      const warnings = assessRenderQuality({ canvas, layers: [layer], safeZones: [] });

      const overflow = warnings.find((w) => w.code === 'text_overflow_possible');
      expect(overflow).toBeDefined();
      expect(overflow?.severity).toBe('warning');
      expect(overflow?.layerId).toBe('text-1');
      expect(overflow?.message).toMatch(/spill/i);
      expect(overflow?.details).toMatchObject({ maxLines: null });
      const details = overflow?.details as { estimatedLines: number; capacityLines: number };
      expect(details.estimatedLines).toBeGreaterThan(details.capacityLines);
    });

    it('warns (truncate message) when maxLines is set and estimated lines exceed it', () => {
      const layer = textLayer({
        textProperties: {
          ...textLayer().textProperties!,
          content: 'B'.repeat(500),
          fontSize: 40,
          maxLines: 1,
        },
        position: { x: 0, y: 0, width: 100, height: 500, rotation: 0, anchor: 'top-left' },
      });

      const warnings = assessRenderQuality({ canvas, layers: [layer], safeZones: [] });

      const overflow = warnings.find((w) => w.code === 'text_overflow_possible');
      expect(overflow).toBeDefined();
      expect(overflow?.severity).toBe('warning');
      expect(overflow?.message).toMatch(/truncat/i);
      expect(overflow?.details).toMatchObject({ capacityLines: 1, maxLines: 1 });
    });

    it('does not warn for comfortably-fitting text', () => {
      const layer = textLayer({
        textProperties: {
          ...textLayer().textProperties!,
          content: 'Short headline',
          fontSize: 32,
        },
        position: { x: 0, y: 0, width: 900, height: 400, rotation: 0, anchor: 'top-left' },
      });

      const warnings = assessRenderQuality({ canvas, layers: [layer], safeZones: [] });
      expect(warnings.find((w) => w.code === 'text_overflow_possible')).toBeUndefined();
    });

    it('ignores a text layer with empty content', () => {
      const layer = textLayer({
        textProperties: { ...textLayer().textProperties!, content: '' },
        position: { x: 0, y: 0, width: 10, height: 10, rotation: 0, anchor: 'top-left' },
      });

      const warnings = assessRenderQuality({ canvas, layers: [layer], safeZones: [] });
      expect(warnings.find((w) => w.code === 'text_overflow_possible')).toBeUndefined();
    });
  });

  describe('safe_area_warning / safe_area_unavailable', () => {
    it('warns once for a text layer overlapping a safe zone, with the expected details', () => {
      const overlappingText = textLayer({
        id: 'text-overlap',
        position: { x: 10, y: 10, width: 200, height: 100, rotation: 0, anchor: 'top-left' },
      });
      const zone = safeZone();

      const warnings = assessRenderQuality({ canvas, layers: [overlappingText], safeZones: [zone] });

      const safeAreaWarnings = warnings.filter((w) => w.code === 'safe_area_warning');
      expect(safeAreaWarnings.length).toBe(1);
      expect(safeAreaWarnings[0].severity).toBe('warning');
      expect(safeAreaWarnings[0].layerId).toBe('text-overlap');
      expect(safeAreaWarnings[0].details).toEqual({ safeZoneLabel: zone.label, layerName: 'Headline' });
    });

    it('warns for an overlapping logo layer too (not just text)', () => {
      const overlappingLogo = logoLayer({ position: { x: 5, y: 5, width: 60, height: 60, rotation: 0, anchor: 'top-left' } });
      const zone = safeZone();

      const warnings = assessRenderQuality({ canvas, layers: [overlappingLogo], safeZones: [zone] });
      expect(warnings.find((w) => w.code === 'safe_area_warning' && w.layerId === 'logo-1')).toBeDefined();
    });

    it('does not warn when the layer does not overlap any safe zone', () => {
      const nonOverlappingText = textLayer({
        id: 'text-clear',
        position: { x: 10, y: 900, width: 200, height: 100, rotation: 0, anchor: 'top-left' },
      });
      const zone = safeZone();

      const warnings = assessRenderQuality({ canvas, layers: [nonOverlappingText], safeZones: [zone] });
      expect(warnings.find((w) => w.code === 'safe_area_warning')).toBeUndefined();
    });

    it('warns once per (layer, zone) pair across multiple layers and zones', () => {
      const layerA = textLayer({
        id: 'text-a',
        position: { x: 10, y: 10, width: 200, height: 100, rotation: 0, anchor: 'top-left' },
      });
      const layerB = logoLayer({
        id: 'logo-b',
        position: { x: 20, y: 20, width: 60, height: 60, rotation: 0, anchor: 'top-left' },
      });
      const zoneA = safeZone({ label: 'Zone A' });
      const zoneB = safeZone({
        label: 'Zone B',
        position: { x: 0, y: 0, width: 1080, height: 1080, rotation: 0, anchor: 'top-left' },
      });

      const warnings = assessRenderQuality({ canvas, layers: [layerA, layerB], safeZones: [zoneA, zoneB] });
      const safeAreaWarnings = warnings.filter((w) => w.code === 'safe_area_warning');
      // Both layers overlap both zones -> 2 layers x 2 zones = 4 pairs.
      expect(safeAreaWarnings.length).toBe(4);
    });

    it('emits exactly one safe_area_unavailable info warning (no layerId) when safeZones is an empty array', () => {
      const warnings = assessRenderQuality({ canvas, layers: [textLayer()], safeZones: [] });

      const unavailable = warnings.filter((w) => w.code === 'safe_area_unavailable');
      expect(unavailable.length).toBe(1);
      expect(unavailable[0].severity).toBe('info');
      expect(unavailable[0].layerId).toBeUndefined();
      // And no safe_area_warning is ever produced when there are no zones to check against.
      expect(warnings.find((w) => w.code === 'safe_area_warning')).toBeUndefined();
    });

    it('emits exactly one safe_area_unavailable info warning when safeZones is omitted entirely', () => {
      const warnings = assessRenderQuality({ canvas, layers: [textLayer()] });
      expect(warnings.filter((w) => w.code === 'safe_area_unavailable').length).toBe(1);
    });
  });

  describe('missing_image_source / low_resolution_image_possible', () => {
    it('warns missing_image_source for an image layer with no sourceUrl', () => {
      const layer = imageLayer({ imageProperties: { ...imageLayer().imageProperties!, sourceUrl: undefined } });
      const warnings = assessRenderQuality({ canvas, layers: [layer], safeZones: [] });

      const missing = warnings.find((w) => w.code === 'missing_image_source');
      expect(missing).toBeDefined();
      expect(missing?.severity).toBe('warning');
      expect(missing?.layerId).toBe('image-1');
      expect(missing?.details).toEqual({ sourceType: 'uploaded' });
    });

    it('warns missing_image_source for a non-http sourceUrl (e.g. a bare filename)', () => {
      const layer = imageLayer({ imageProperties: { ...imageLayer().imageProperties!, sourceUrl: 'not-a-url.png' } });
      const warnings = assessRenderQuality({ canvas, layers: [layer], safeZones: [] });
      expect(warnings.find((w) => w.code === 'missing_image_source')).toBeDefined();
    });

    it('does not warn missing_image_source for a valid http(s) url', () => {
      const layer = imageLayer();
      const warnings = assessRenderQuality({ canvas, layers: [layer], safeZones: [] });
      expect(warnings.find((w) => w.code === 'missing_image_source')).toBeUndefined();
    });

    // Phase 3 Step 1 — an injected composited source counts as a usable source.
    it('does not warn missing_image_source for a sourceless layer that received an injected image source', () => {
      const layer = imageLayer({ imageProperties: { ...imageLayer().imageProperties!, sourceUrl: undefined } });
      const warnings = assessRenderQuality({
        canvas,
        layers: [layer],
        safeZones: [],
        imageSources: { 'image-1': 'data:image/png;base64,QUJD' },
      });
      expect(warnings.find((w) => w.code === 'missing_image_source')).toBeUndefined();
    });

    it('still warns missing_image_source for a sourceless layer that is NOT in the injected map', () => {
      const injected = imageLayer({
        id: 'injected-slot',
        imageProperties: { ...imageLayer().imageProperties!, sourceUrl: undefined },
      });
      const orphan = imageLayer({
        id: 'orphan-slot',
        imageProperties: { ...imageLayer().imageProperties!, sourceUrl: undefined },
      });
      const warnings = assessRenderQuality({
        canvas,
        layers: [injected, orphan],
        safeZones: [],
        imageSources: { 'injected-slot': 'data:image/png;base64,QUJD' },
      });
      expect(warnings.find((w) => w.code === 'missing_image_source' && w.layerId === 'orphan-slot')).toBeDefined();
      expect(warnings.find((w) => w.code === 'missing_image_source' && w.layerId === 'injected-slot')).toBeUndefined();
    });

    it('warns low_resolution_image_possible only for a large box with a usable url', () => {
      const largeLayer = imageLayer({
        id: 'image-large',
        position: { x: 0, y: 0, width: 1200, height: 1200, rotation: 0, anchor: 'top-left' },
      });
      const warnings = assessRenderQuality({ canvas, layers: [largeLayer], safeZones: [] });

      const lowRes = warnings.find((w) => w.code === 'low_resolution_image_possible');
      expect(lowRes).toBeDefined();
      expect(lowRes?.severity).toBe('info');
      expect(lowRes?.layerId).toBe('image-large');
      expect(lowRes?.details).toEqual({ boxWidth: 1200, boxHeight: 1200 });
    });

    it('does not warn low_resolution_image_possible for a small box', () => {
      const smallLayer = imageLayer();
      const warnings = assessRenderQuality({ canvas, layers: [smallLayer], safeZones: [] });
      expect(warnings.find((w) => w.code === 'low_resolution_image_possible')).toBeUndefined();
    });

    it('does not warn low_resolution_image_possible for a large box with no usable url (missing_image_source fires instead)', () => {
      const largeNoUrl = imageLayer({
        id: 'image-large-no-url',
        position: { x: 0, y: 0, width: 1200, height: 1200, rotation: 0, anchor: 'top-left' },
        imageProperties: { ...imageLayer().imageProperties!, sourceUrl: undefined },
      });
      const warnings = assessRenderQuality({ canvas, layers: [largeNoUrl], safeZones: [] });
      expect(warnings.find((w) => w.code === 'low_resolution_image_possible')).toBeUndefined();
      expect(warnings.find((w) => w.code === 'missing_image_source')).toBeDefined();
    });

    it('applies the same checks to logo layers, not just image layers', () => {
      const logo = logoLayer({ imageProperties: { ...logoLayer().imageProperties!, sourceUrl: undefined } });
      const warnings = assessRenderQuality({ canvas, layers: [logo], safeZones: [] });
      expect(warnings.find((w) => w.code === 'missing_image_source' && w.layerId === 'logo-1')).toBeDefined();
    });
  });

  describe('visibility and flattening', () => {
    it('ignores invisible layers entirely', () => {
      const layer = imageLayer({
        visible: false,
        imageProperties: { ...imageLayer().imageProperties!, sourceUrl: undefined },
      });
      const warnings = assessRenderQuality({ canvas, layers: [layer], safeZones: [] });
      expect(warnings.find((w) => w.layerId === 'image-1')).toBeUndefined();
    });

    it('flattens nested children and assesses them too', () => {
      const parent = imageLayer({
        id: 'group-parent',
        type: 'group',
        children: [
          imageLayer({ id: 'child-image', imageProperties: { ...imageLayer().imageProperties!, sourceUrl: undefined } }),
        ],
      });

      const warnings = assessRenderQuality({ canvas, layers: [parent], safeZones: [] });
      expect(warnings.find((w) => w.layerId === 'child-image' && w.code === 'missing_image_source')).toBeDefined();
      // The 'group' parent itself is neither image/logo/text, so it must not raise anything of its own.
      expect(warnings.find((w) => w.layerId === 'group-parent')).toBeUndefined();
    });
  });
});
