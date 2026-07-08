import type { Layer } from '@grafista/schemas';
import { describe, expect, it } from 'vitest';
import { extractSelectedVisual, planVisualComposition, type LoadedVisual } from '../visual-composition.js';

// Pure-logic unit tests — no DB/HTTP/storage. See font-resolver.test.ts for
// why this lives under src/render/__tests__/ rather than src/__tests__/.

function imageSlot(overrides: Partial<Layer> = {}): Layer {
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
    imageProperties: { sourceType: 'ai_generated', fit: 'cover', opacity: 1, borderRadius: 0 },
    ...overrides,
  } as Layer;
}

const visual: LoadedVisual = {
  dataUri: 'data:image/png;base64,QUJDREVG',
  mimeType: 'image/png',
  sizeBytes: 6,
  dimensions: { width: 1080, height: 1080 },
};

describe('extractSelectedVisual', () => {
  it('prefers the canonical selectedVisual key over the legacy generatedOutput key', () => {
    const section = extractSelectedVisual({
      selectedVisual: { id: 'canonical' },
      generatedOutput: { id: 'legacy' },
    });
    expect(section?.id).toBe('canonical');
  });

  it('falls back to generatedOutput when selectedVisual is absent', () => {
    expect(extractSelectedVisual({ generatedOutput: { id: 'legacy' } })?.id).toBe('legacy');
  });

  it('returns null for a pre-Step-8C manifest, an undefined manifest, or a non-object section', () => {
    expect(extractSelectedVisual({})).toBeNull();
    expect(extractSelectedVisual(undefined)).toBeNull();
    expect(extractSelectedVisual(null)).toBeNull();
    expect(extractSelectedVisual({ selectedVisual: 'not-an-object' })).toBeNull();
    expect(extractSelectedVisual({ selectedVisual: ['array'] })).toBeNull();
  });
});

describe('planVisualComposition', () => {
  it('maps a single ai_generated image slot as primary and reports selected_visual_loaded', () => {
    const { imageSources, warnings } = planVisualComposition({ layers: [imageSlot()], visual });

    expect(imageSources).toEqual({ 'image-1': visual.dataUri });
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'selected_visual_loaded', layerId: 'image-1', severity: 'info' })
    );
    expect(warnings.find((w) => w.code === 'image_slot_unmapped')).toBeUndefined();
  });

  // Option A (Phase 2 render fix) — when the layout has NO usable image slot,
  // the loaded visual is no longer discarded: it becomes the full-canvas
  // creative (`fullCanvasVisual`) and image_slot_missing is replaced by
  // full_canvas_visual_fallback (warning).
  it('returns fullCanvasVisual + full_canvas_visual_fallback (warning) when the layout has no image slots', () => {
    const textLayer = imageSlot({ id: 'text-1', type: 'text', imageProperties: undefined });
    const { imageSources, fullCanvasVisual, warnings } = planVisualComposition({ layers: [textLayer], visual });

    expect(imageSources).toEqual({});
    expect(fullCanvasVisual).toBe(visual.dataUri);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: 'full_canvas_visual_fallback',
        severity: 'warning',
        details: expect.objectContaining({ sizeBytes: visual.sizeBytes, mimeType: visual.mimeType }),
      })
    );
    // The old info-only "did nothing" signal is gone — the visual IS used now.
    expect(warnings.find((w) => w.code === 'image_slot_missing')).toBeUndefined();
  });

  it('never injects into logo layers, but still falls back to a full-canvas visual', () => {
    const logo = imageSlot({ id: 'logo-1', type: 'logo' });
    const { imageSources, fullCanvasVisual, warnings } = planVisualComposition({ layers: [logo], visual });

    // A logo is not an image slot, so nothing is injected into it...
    expect(imageSources).toEqual({});
    // ...and with no image slot at all, the visual is rendered full-bleed.
    expect(fullCanvasVisual).toBe(visual.dataUri);
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'full_canvas_visual_fallback', severity: 'warning' })
    );
  });

  it('does NOT set fullCanvasVisual when a usable image slot exists (normal per-slot compositing preserved)', () => {
    // A real image slot -> the visual is composited into it, NOT full-canvas.
    const withSlot = planVisualComposition({ layers: [imageSlot()], visual });
    expect(withSlot.fullCanvasVisual).toBeUndefined();
    expect(withSlot.imageSources).toEqual({ 'image-1': visual.dataUri });

    // Even when the only image slot already carries its own http(s) source
    // (image_slot_unmapped) a valid image slot DOES exist, so the full-canvas
    // fallback must NOT fire — existing behavior is unchanged.
    const sourced = imageSlot({
      id: 'sourced',
      imageProperties: {
        sourceType: 'uploaded',
        sourceUrl: 'https://example.com/own.png',
        fit: 'cover',
        opacity: 1,
        borderRadius: 0,
      },
    });
    const allSourced = planVisualComposition({ layers: [sourced], visual });
    expect(allSourced.fullCanvasVisual).toBeUndefined();
    expect(allSourced.imageSources).toEqual({});
    expect(allSourced.warnings).toContainEqual(expect.objectContaining({ code: 'image_slot_unmapped' }));
    expect(allSourced.warnings.find((w) => w.code === 'full_canvas_visual_fallback')).toBeUndefined();
  });

  it('deterministically picks the primary slot: ai_generated beats placeholder, larger area beats smaller', () => {
    const smallAi = imageSlot({
      id: 'small-ai',
      position: { x: 0, y: 0, width: 100, height: 100, rotation: 0, anchor: 'top-left' },
    });
    const bigPlaceholder = imageSlot({
      id: 'big-placeholder',
      imageProperties: { sourceType: 'placeholder', fit: 'cover', opacity: 1, borderRadius: 0 },
    });

    // ai_generated outranks a (larger) placeholder slot.
    const planA = planVisualComposition({ layers: [bigPlaceholder, smallAi], visual });
    expect(Object.keys(planA.imageSources)).toEqual(['small-ai']);

    // Among equal sourceTypes, the larger area wins — input order irrelevant.
    const bigAi = imageSlot({ id: 'big-ai' });
    const planB = planVisualComposition({ layers: [smallAi, bigAi], visual });
    const planC = planVisualComposition({ layers: [bigAi, smallAi], visual });
    expect(Object.keys(planB.imageSources)).toEqual(['big-ai']);
    expect(planC.imageSources).toEqual(planB.imageSources);

    // Full tie -> lexicographically smaller id, regardless of input order.
    const twinA = imageSlot({ id: 'twin-a' });
    const twinB = imageSlot({ id: 'twin-b' });
    expect(Object.keys(planVisualComposition({ layers: [twinB, twinA], visual }).imageSources)).toEqual(['twin-a']);
    expect(Object.keys(planVisualComposition({ layers: [twinA, twinB], visual }).imageSources)).toEqual(['twin-a']);
  });

  it('flags every extra injectable slot as image_slot_unmapped (warning) while only the primary is filled', () => {
    const primary = imageSlot({ id: 'primary' });
    const extra = imageSlot({
      id: 'extra',
      name: 'Secondary slot',
      position: { x: 0, y: 0, width: 200, height: 200, rotation: 0, anchor: 'top-left' },
    });

    const { imageSources, warnings } = planVisualComposition({ layers: [primary, extra], visual });

    expect(Object.keys(imageSources)).toEqual(['primary']);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: 'image_slot_unmapped',
        layerId: 'extra',
        severity: 'warning',
        details: expect.objectContaining({ primaryLayerId: 'primary' }),
      })
    );
  });

  it('does not override a slot that already has a usable http(s) source, and says so via image_slot_unmapped', () => {
    const sourced = imageSlot({
      id: 'sourced',
      imageProperties: {
        sourceType: 'uploaded',
        sourceUrl: 'https://example.com/own.png',
        fit: 'cover',
        opacity: 1,
        borderRadius: 0,
      },
    });

    const { imageSources, warnings } = planVisualComposition({ layers: [sourced], visual });

    expect(imageSources).toEqual({});
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'image_slot_unmapped', severity: 'warning' }));
  });

  it('an uploaded/stock slot WITHOUT a url is still injectable (real AI layouts label sourceless hero slots "uploaded"), but ranks below placeholder/ai_generated slots', () => {
    const urlLessUpload = imageSlot({
      id: 'url-less-upload',
      imageProperties: { sourceType: 'uploaded', fit: 'cover', opacity: 1, borderRadius: 0 },
    });

    // Alone, it receives the visual — this is the Flavora demo layout shape.
    const alone = planVisualComposition({ layers: [urlLessUpload], visual });
    expect(alone.imageSources).toEqual({ 'url-less-upload': visual.dataUri });

    // Next to an equally-sized placeholder slot, the placeholder outranks it.
    const placeholderSlot = imageSlot({
      id: 'placeholder-slot',
      imageProperties: { sourceType: 'placeholder', fit: 'cover', opacity: 1, borderRadius: 0 },
    });
    const together = planVisualComposition({ layers: [urlLessUpload, placeholderSlot], visual });
    expect(Object.keys(together.imageSources)).toEqual(['placeholder-slot']);
  });

  it('treats a bare image layer without imageProperties as an injectable placeholder slot', () => {
    const bare = imageSlot({ id: 'bare', imageProperties: undefined });
    const { imageSources } = planVisualComposition({ layers: [bare], visual });
    expect(imageSources).toEqual({ bare: visual.dataUri });
  });

  it('skips invisible image slots entirely (no injection), falling back to a full-canvas visual', () => {
    const hidden = imageSlot({ id: 'hidden', visible: false });
    const { imageSources, fullCanvasVisual, warnings } = planVisualComposition({ layers: [hidden], visual });
    expect(imageSources).toEqual({});
    expect(fullCanvasVisual).toBe(visual.dataUri);
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'full_canvas_visual_fallback', severity: 'warning' })
    );
  });

  it('finds image slots nested inside group children', () => {
    const group = imageSlot({
      id: 'group-1',
      type: 'group',
      imageProperties: undefined,
      children: [imageSlot({ id: 'nested-image' })],
    });
    const { imageSources } = planVisualComposition({ layers: [group], visual });
    expect(imageSources).toEqual({ 'nested-image': visual.dataUri });
  });

  it('emits selected_visual_aspect_mismatch (info) when the visual and slot proportions differ', () => {
    const wideSlot = imageSlot({
      id: 'wide',
      position: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, anchor: 'top-left' },
    });
    const squareVisual: LoadedVisual = { ...visual, dimensions: { width: 1080, height: 1080 } };

    const { warnings } = planVisualComposition({ layers: [wideSlot], visual: squareVisual });

    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: 'selected_visual_aspect_mismatch',
        layerId: 'wide',
        severity: 'info',
        details: expect.objectContaining({ fit: 'cover' }),
      })
    );
  });

  it('emits no aspect warning when proportions match or dimensions are unknown', () => {
    const matching = planVisualComposition({ layers: [imageSlot()], visual });
    expect(matching.warnings.find((w) => w.code === 'selected_visual_aspect_mismatch')).toBeUndefined();

    const unknownDims = planVisualComposition({ layers: [imageSlot()], visual: { ...visual, dimensions: null } });
    expect(unknownDims.warnings.find((w) => w.code === 'selected_visual_aspect_mismatch')).toBeUndefined();
  });

  it('is fully deterministic: identical input twice produces deeply identical plans', () => {
    const layers = [
      imageSlot({ id: 'a' }),
      imageSlot({
        id: 'b',
        imageProperties: { sourceType: 'placeholder', fit: 'contain', opacity: 1, borderRadius: 0 },
      }),
    ];
    const first = planVisualComposition({ layers, visual });
    const second = planVisualComposition({ layers, visual });
    expect(second).toEqual(first);
  });
});
