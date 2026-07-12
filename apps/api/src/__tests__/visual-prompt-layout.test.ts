import { describe, it, expect } from 'vitest';
import { describeLayoutForImagePrompt } from '../services/visual-prompt-layout.js';
import { visualGenerationTemplate } from '@grafista/prompt-engine';
import type { LayoutPlan } from '@grafista/schemas';

/**
 * F8 fix (go-live M2.3) — the image prompt used to feed the raw layout JSON
 * (with `position: { x, y, ... }`) and the model rendered those coordinates as
 * visible "(30, 30)" text on the creative. These tests lock in that the new
 * semantic description carries the composition intent WITHOUT any raw
 * coordinate numbers, and that the template now forbids drawing metadata as text.
 */

function makeLayoutPlan(): LayoutPlan {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    clientId: '22222222-2222-2222-2222-222222222222',
    designBriefId: '33333333-3333-3333-3333-333333333333',
    status: 'approved',
    alternativeIndex: 1,
    format: 'instagram_post',
    canvas: { width: 1080, height: 1080, backgroundColor: '#FAF5EB', dpi: 72 },
    layers: [
      {
        id: 'bg', name: 'Background', type: 'background',
        position: { x: 0, y: 0, width: 1080, height: 1080, rotation: 0, anchor: 'top-left' },
        zIndex: 0, visible: true, locked: false, opacity: 1, blendMode: 'normal',
      },
      {
        id: 'headline', name: 'Headline', type: 'text',
        position: { x: 80, y: 120, width: 920, height: 200, rotation: 0, anchor: 'top-left' },
        zIndex: 10, visible: true, locked: false, opacity: 1, blendMode: 'normal',
        textProperties: {
          content: 'Taze ve Dogal', fontFamily: 'Playfair Display', fontSize: 64,
          fontWeight: '700', color: '#2D5016', alignment: 'left',
        },
      },
      {
        id: 'logo', name: 'Logo', type: 'logo',
        position: { x: 40, y: 40, width: 120, height: 120, rotation: 0, anchor: 'top-left' },
        zIndex: 20, visible: true, locked: false, opacity: 1, blendMode: 'normal',
      },
      {
        id: 'hero', name: 'Hero image', type: 'image',
        position: { x: 0, y: 540, width: 1080, height: 540, rotation: 0, anchor: 'top-left' },
        zIndex: 5, visible: true, locked: false, opacity: 1, blendMode: 'normal',
        imageProperties: { sourceType: 'ai_generated', aiPrompt: 'a bowl of fresh organic vegetables', fit: 'cover', opacity: 1, borderRadius: 0 },
      },
    ],
    safeZones: [],
    exportSettings: { formats: ['png'], quality: 90, scaleFactor: 1 },
    referenceDesignIds: [],
    designDnaRulesUsed: [],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  } as unknown as LayoutPlan;
}

describe('describeLayoutForImagePrompt — semantic, coordinate-free', () => {
  const desc = describeLayoutForImagePrompt(makeLayoutPlan());

  it('carries the composition intent (copy, font, roles, relative placement)', () => {
    expect(desc).toContain('Taze ve Dogal'); // exact copy
    expect(desc).toContain('Playfair Display'); // font
    expect(desc).toMatch(/logo/i); // logo role
    expect(desc).toMatch(/top center|centered/); // headline placement bucket
    expect(desc).toMatch(/top left/); // logo placement bucket
    expect(desc).toContain('a bowl of fresh organic vegetables'); // image region subject (aiPrompt restored)
  });

  it('emits NO raw layer coordinates, sizes, or JSON position keys', () => {
    // The leaking values were the layer position numbers.
    expect(desc).not.toContain('920'); // headline width
    expect(desc).not.toContain('"x"');
    expect(desc).not.toContain('"position"');
    expect(desc).not.toContain('"width"');
    expect(desc).not.toMatch(/\(\d+,\s*\d+\)/); // "(30, 30)"-style coordinate pairs
  });
});

describe('visualGenerationTemplate — negative metadata instruction (F8)', () => {
  it('tells the image model to never render coordinates/metadata as visible text', () => {
    expect(visualGenerationTemplate.systemPrompt).toMatch(/never draw/i);
    expect(visualGenerationTemplate.systemPrompt).toContain('(30, 30)');
  });

  it('no longer labels the layout variable as raw JSON to reproduce', () => {
    expect(visualGenerationTemplate.userPromptTemplate).not.toContain('JSON, reproduce faithfully');
  });
});
