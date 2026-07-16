import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StyleAnalysis } from '@grafista/schemas';
import type { DesignDNAContent } from '@grafista/schemas';

// ── Mocks for the runDesignDnaAnalysis integration test ──
const controls = vi.hoisted(() => ({
  styleRequests: [] as any[],
  synthesisRequests: [] as any[],
  createdDna: undefined as any,
  brandAssets: [] as any[],
  analysisSeq: 0,
}));

const okResp = (content: string) => ({
  success: true,
  provider: 'openai',
  model: 'gpt-vision',
  content,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  latencyMs: 1,
});

vi.mock('@grafista/model-router', () => ({
  ModelRouter: class {
    async complete(request: any) {
      if (request.taskType === 'style_analysis') {
        controls.styleRequests.push(request);
        return okResp(
          JSON.stringify({
            format: 'square',
            aspectRatio: '1:1',
            dominantColors: [
              { hex: '#2D5016', percentage: 60 },
              { hex: '#FAF5EB', percentage: 40 },
            ],
            logoPosition: 'bottom-center',
            reusableDesignRules: [],
            confidence: 0.8,
          })
        );
      }
      if (request.taskType === 'design_dna_synthesis') {
        controls.synthesisRequests.push(request);
        return okResp(
          JSON.stringify({
            brandPersonality: [],
            preferredLayouts: [],
            visualRules: [],
            typographyRules: [],
            // Deliberately WRONG (earthy green) + hallucinated logo position 'center'.
            colorUsageRules: [{ rule: 'Ana renk toprak yeşili', colors: ['#2D5016'] }],
            logoUsageRules: [{ rule: 'Logo ortada', preferredPosition: 'center' }],
            imageTreatmentRules: [],
            contentTone: { primary: 'friendly', keywords: [], examples: [] },
            avoidList: [],
          })
        );
      }
      throw new Error(`unexpected task ${request.taskType}`);
    }
  },
}));

const ref = (id: string) => ({
  id,
  clientId: 'c1',
  name: 'ref',
  description: '',
  mimeType: 'image/png',
  originalFilename: 'ref.png',
  storageProvider: 'local',
  storageKey: `key-${id}`,
  storageBucket: 'bucket',
  tags: [],
  createdAt: new Date().toISOString(),
});

vi.mock('../../data/store.js', () => ({
  store: {
    clients: { getById: async (id: string) => ({ id, name: 'Yenişehir Merkez Koleji', industry: 'education', notes: '' }) },
    designReferences: {
      listByClient: async () => [ref('11111111-1111-1111-1111-111111111111'), ref('22222222-2222-2222-2222-222222222222')],
    },
    designAnalysis: {
      create: async (data: any) => {
        controls.analysisSeq += 1;
        return { ...data, id: `analysis-${controls.analysisSeq}` };
      },
    },
    designDna: {
      create: async (data: any) => {
        controls.createdDna = data;
        return { ...data };
      },
    },
    brandAssets: { listByClient: async () => controls.brandAssets },
  },
}));

vi.mock('../../storage/file-service.js', () => ({
  getObjectBuffer: async () => Buffer.from('fake-image-bytes'),
}));

vi.mock('../../auth/client-access.js', () => ({
  assertClientAccessible: async () => {},
}));

import { runDesignDnaAnalysis, groundDesignDna } from '../design-dna-analysis.js';

const BLUE = [
  { id: 'p1', clientId: 'c1', type: 'color_palette', metadata: { palette: [{ hex: '#006084', role: 'primary' }, { hex: '#7FD3F4', role: 'secondary' }] }, createdAt: new Date().toISOString() },
];

function dna(patch: Partial<DesignDNAContent>): DesignDNAContent {
  return {
    brandPersonality: [],
    preferredLayouts: [],
    visualRules: [],
    typographyRules: [],
    colorUsageRules: [],
    logoUsageRules: [],
    imageTreatmentRules: [],
    contentTone: { primary: 'friendly', keywords: [], examples: [] },
    avoidList: [],
    ...patch,
  } as DesignDNAContent;
}

const analysis = (logoPosition?: StyleAnalysis['logoPosition']): StyleAnalysis =>
  ({ logoPosition } as unknown as StyleAnalysis);

describe('groundDesignDna (pure)', () => {
  it('snaps conflicting colorUsageRules to the palette', () => {
    const out = groundDesignDna(dna({ colorUsageRules: [{ rule: 'x', colors: ['#2D5016'] }] }), [analysis('center'), analysis('center')], ['#006084', '#7FD3F4']);
    const colors = out.colorUsageRules.flatMap((r) => r.colors ?? []);
    expect(colors).toContain('#006084');
    expect(colors).not.toContain('#2D5016');
  });

  it('prepends a palette fallback rule when there is no color rule', () => {
    const out = groundDesignDna(dna({ colorUsageRules: [] }), [analysis('center'), analysis('center')], ['#006084', '#7FD3F4']);
    expect(out.colorUsageRules[0].colors).toEqual(['#006084', '#7FD3F4']);
  });

  it('prepends the fallback when all rules are colorless', () => {
    const out = groundDesignDna(dna({ colorUsageRules: [{ rule: 'text-only rule' }] }), [], ['#006084']);
    expect(out.colorUsageRules[0].colors).toEqual(['#006084']);
    expect(out.colorUsageRules).toHaveLength(2);
  });

  it('leaves DNA colors unchanged when there is no palette', () => {
    const out = groundDesignDna(dna({ colorUsageRules: [{ rule: 'x', colors: ['#2D5016'] }] }), [], null);
    expect(out.colorUsageRules[0].colors).toEqual(['#2D5016']);
  });

  it('derives logo position from a strict observation majority', () => {
    const out = groundDesignDna(
      dna({ logoUsageRules: [{ rule: 'logo', preferredPosition: 'center' }] }),
      [analysis('bottom-center'), analysis('bottom-center'), analysis('top-left')],
      null
    );
    expect(out.logoUsageRules[0].preferredPosition).toBe('bottom-center');
  });

  it('adds a canonical logo rule when confident but no rule exists', () => {
    const out = groundDesignDna(dna({ logoUsageRules: [] }), [analysis('top-right'), analysis('top-right')], null);
    expect(out.logoUsageRules).toHaveLength(1);
    expect(out.logoUsageRules[0].preferredPosition).toBe('top-right');
  });

  it('omits the position when there is no majority (tie)', () => {
    const out = groundDesignDna(
      dna({ logoUsageRules: [{ rule: 'logo', preferredPosition: 'center' }] }),
      [analysis('bottom-center'), analysis('top-left')],
      null
    );
    expect(out.logoUsageRules[0].preferredPosition).toBeUndefined();
  });

  it('omits the position with fewer than two observations', () => {
    const out = groundDesignDna(
      dna({ logoUsageRules: [{ rule: 'logo', preferredPosition: 'center' }] }),
      [analysis('bottom-center'), analysis('none'), analysis(undefined)],
      null
    );
    expect(out.logoUsageRules[0].preferredPosition).toBeUndefined();
  });
});

describe('runDesignDnaAnalysis grounding (integration, mocked)', () => {
  beforeEach(() => {
    Object.assign(controls, { styleRequests: [], synthesisRequests: [], createdDna: undefined, brandAssets: [], analysisSeq: 0 });
  });

  it('feeds real image bytes to stage 1 and the palette anchor to synthesis, then persists palette-true DNA', async () => {
    controls.brandAssets = BLUE;
    await runDesignDnaAnalysis('c1', 'user-1');

    // Stage 1 actually received the image bytes.
    expect(controls.styleRequests[0].images[0]).toMatch(/^data:image\/png;base64,/);
    // Synthesis prompt carried the authoritative palette.
    expect(controls.synthesisRequests[0].userPrompt).toContain('AUTHORITATIVE BRAND PALETTE');

    // Persisted DNA color is the brand blue, never the hallucinated green.
    const colors = controls.createdDna.colorUsageRules.flatMap((r: any) => r.colors ?? []);
    expect(colors).toContain('#006084');
    expect(colors).not.toContain('#2D5016');

    // Logo position comes from the observation majority (both refs report bottom-center),
    // overriding the model's hallucinated 'center'.
    expect(controls.createdDna.logoUsageRules[0].preferredPosition).toBe('bottom-center');
  });

  it('leaves DNA colors unchanged when the client has no palette', async () => {
    controls.brandAssets = [];
    await runDesignDnaAnalysis('c1', 'user-1');
    const colors = controls.createdDna.colorUsageRules.flatMap((r: any) => r.colors ?? []);
    expect(colors).toContain('#2D5016');
    // Synthesis carried no palette block.
    expect(controls.synthesisRequests[0].userPrompt).not.toContain('AUTHORITATIVE BRAND PALETTE');
  });
});
