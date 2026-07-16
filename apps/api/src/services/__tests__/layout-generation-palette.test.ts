import { beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({
  lastRequest: undefined as any,
  created: [] as any[],
  brandAssets: [] as any[],
  approvedDna: undefined as any,
}));

const offPaletteAlt = () => ({
  format: 'instagram_post',
  canvas: { width: 1080, height: 1080, backgroundColor: '#123456', dpi: 72 },
  layers: [
    {
      id: 'l1',
      name: 'headline',
      type: 'text',
      position: { x: 0, y: 0, width: 500, height: 120, rotation: 0, anchor: 'top-left' },
      zIndex: 0,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      textProperties: { content: 'Merhaba', fontFamily: 'Inter', fontSize: 48, fontWeight: 'bold', color: '#ABCDEF', alignment: 'left' },
    },
  ],
  safeZones: [],
  exportSettings: { formats: ['png'], quality: 90, scaleFactor: 1 },
  referenceDesignIds: [],
  designDnaRulesUsed: [],
});

vi.mock('@grafista/model-router', () => ({
  ModelRouter: class {
    async complete(request: any) {
      controls.lastRequest = request;
      return {
        success: true,
        provider: 'openai',
        model: 'gpt',
        content: JSON.stringify([offPaletteAlt(), offPaletteAlt()]),
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        latencyMs: 1,
      };
    }
  },
}));

vi.mock('../../data/store.js', () => ({
  store: {
    designBriefs: {
      getById: async (id: string) => ({
        id,
        clientId: 'c1',
        contentIdeaId: 'idea-1',
        status: 'approved',
        dimensions: { width: 1080, height: 1080 },
        referenceDesignIds: [],
      }),
    },
    clients: { getById: async (id: string) => ({ id, name: 'Yenişehir' }) },
    designDna: { getLatestByClientId: async () => controls.approvedDna },
    brandAssets: { listByClient: async () => controls.brandAssets },
    layoutPlans: {
      create: async (data: any) => {
        controls.created.push(data);
        return { ...data };
      },
    },
  },
}));

vi.mock('../../auth/client-access.js', () => ({ assertClientAccessible: async () => {} }));

import { runLayoutGeneration } from '../layout-generation.js';

const BLUE = [
  { id: 'p1', clientId: 'c1', type: 'color_palette', metadata: { palette: [{ hex: '#006084', role: 'primary' }, { hex: '#7FD3F4', role: 'secondary' }] }, createdAt: new Date().toISOString() },
];
const GREEN_DNA = { status: 'approved', preferredLayouts: [], visualRules: [], typographyRules: [], logoUsageRules: [], imageTreatmentRules: [], colorUsageRules: [{ rule: 'toprak yeşili', colors: ['#2D5016'] }] };
const PALETTE = ['#006084', '#7FD3F4'];

describe('runLayoutGeneration palette baking (integration, mocked)', () => {
  beforeEach(() => {
    Object.assign(controls, { lastRequest: undefined, created: [], brandAssets: [], approvedDna: undefined });
  });

  it('snaps every persisted layer/canvas color to the palette and drops DNA colorUsageRules from the prompt', async () => {
    controls.brandAssets = BLUE;
    controls.approvedDna = GREEN_DNA;
    await runLayoutGeneration('brief-1', 'user-1');

    expect(controls.created).toHaveLength(2);
    for (const plan of controls.created) {
      expect(PALETTE).toContain(plan.content.canvas.backgroundColor);
      expect(plan.content.canvas.backgroundColor).not.toBe('#123456');
      expect(PALETTE).toContain(plan.content.layers[0].textProperties.color);
      expect(plan.content.layers[0].textProperties.color).not.toBe('#ABCDEF');
    }
    // With a real palette, the DNA's conflicting green colorUsageRules must NOT be in the prompt.
    expect(controls.lastRequest.userPrompt).not.toContain('#2D5016');
    expect(controls.lastRequest.userPrompt).not.toContain('toprak yeşili');
  });

  it('leaves colors untouched and keeps DNA colorUsageRules when there is no palette', async () => {
    controls.brandAssets = [];
    controls.approvedDna = GREEN_DNA;
    await runLayoutGeneration('brief-1', 'user-1');

    for (const plan of controls.created) {
      expect(plan.content.canvas.backgroundColor).toBe('#123456');
      expect(plan.content.layers[0].textProperties.color).toBe('#ABCDEF');
    }
    // No palette → the DNA colorUsageRules ARE fed to the model as before.
    expect(controls.lastRequest.userPrompt).toContain('#2D5016');
  });
});
