import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandAsset } from '../../db/repositories/brand-assets.js';

const controls = vi.hoisted(() => ({ content: '[]', success: true, storageFails: false, lastRequest: undefined as any }));

vi.mock('../../storage/file-service.js', () => ({
  getObjectBuffer: async () => {
    if (controls.storageFails) throw new Error('storage unavailable');
    return Buffer.from('image');
  },
}));

vi.mock('@grafista/model-router', () => ({
  ModelRouter: class {
    async complete(request: unknown) {
      controls.lastRequest = request;
      return controls.success
        ? { success: true, provider: 'openai', model: 'vision', content: controls.content, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1 }
        : { success: false, provider: 'openai', model: 'vision', content: '', error: 'provider failed', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 1 };
    }
  },
}));

import { extractPaletteFromAsset } from '../palette-extraction.js';

const asset = (patch: Partial<BrandAsset> = {}): BrandAsset => ({
  id: 'asset-1', clientId: 'client-1', type: 'color_palette', name: 'Kartela',
  mimeType: 'image/png', storageProvider: 'local', storageBucket: 'bucket', storageKey: 'key',
  createdAt: new Date().toISOString(), ...patch,
});

describe('palette-extraction outcome object', () => {
  beforeEach(() => Object.assign(controls, { content: '[]', success: true, storageFails: false, lastRequest: undefined }));

  it('returns the complete validated ok outcome and uses capability-based routing', async () => {
    controls.content = JSON.stringify([{ hex: '#112233', role: 'primary' }, { hex: '#AABBCC', role: 'accent' }]);
    await expect(extractPaletteFromAsset(asset(), 'Marka')).resolves.toEqual({
      status: 'ok', palette: [{ hex: '#112233', role: 'primary' }, { hex: '#AABBCC', role: 'accent' }],
    });
    expect(controls.lastRequest).not.toHaveProperty('provider');
    expect(controls.lastRequest.images[0]).toMatch(/^data:image\/png;base64,/);
  });

  it.each([
    ['non-raster', asset({ mimeType: 'image/svg+xml' })],
    ['missing bytes', asset({ storageKey: undefined })],
  ])('returns empty for %s', async (_label, input) => {
    await expect(extractPaletteFromAsset(input, 'Marka')).resolves.toEqual({ status: 'empty', palette: [] });
  });

  it('returns failed with stage and never throws for provider/JSON/schema/storage failures', async () => {
    controls.success = false;
    await expect(extractPaletteFromAsset(asset(), 'Marka')).resolves.toEqual({ status: 'failed', stage: 'provider', palette: [] });
    controls.success = true;
    controls.content = 'not json';
    await expect(extractPaletteFromAsset(asset(), 'Marka')).resolves.toEqual({ status: 'failed', stage: 'invalid_json', palette: [] });
    controls.content = JSON.stringify([{ hex: 'bad', role: 'primary' }]);
    await expect(extractPaletteFromAsset(asset(), 'Marka')).resolves.toEqual({ status: 'failed', stage: 'schema_validation', palette: [] });
    controls.storageFails = true;
    await expect(extractPaletteFromAsset(asset(), 'Marka')).resolves.toEqual({ status: 'failed', stage: 'storage', palette: [] });
  });
});
