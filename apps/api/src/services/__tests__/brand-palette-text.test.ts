import { beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({ assets: [] as any[] }));

vi.mock('../../data/store.js', () => ({
  store: { brandAssets: { listByClient: async () => controls.assets } },
}));

import { loadBrandPaletteColors, loadBrandPaletteText, formatBrandPaletteText } from '../brand-palette-text.js';

const palAsset = (id: string, createdAt: string, palette: unknown, type = 'color_palette') => ({
  id,
  clientId: 'c1',
  type,
  name: 'Kartela',
  metadata: { palette },
  createdAt,
});

describe('loadBrandPaletteColors', () => {
  beforeEach(() => {
    controls.assets = [];
  });

  it('returns null when the client has no color_palette asset', async () => {
    controls.assets = [palAsset('a1', '2026-01-01T00:00:00.000Z', [{ hex: '#006084', role: 'primary' }], 'logo')];
    expect(await loadBrandPaletteColors('c1')).toBeNull();
  });

  it('accepts a single valid swatch (monochrome brand is legitimate)', async () => {
    controls.assets = [palAsset('a1', '2026-01-01T00:00:00.000Z', [{ hex: '#006084', role: 'primary' }])];
    const res = await loadBrandPaletteColors('c1');
    expect(res?.palette).toHaveLength(1);
    expect(res?.orderedHexes).toEqual(['#006084']);
  });

  it('fails closed on a malformed NEWEST palette instead of resurrecting an older valid one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    controls.assets = [
      palAsset('old', '2026-01-01T00:00:00.000Z', [{ hex: '#006084', role: 'primary' }, { hex: '#7FD3F4', role: 'secondary' }]),
      palAsset('new', '2026-02-01T00:00:00.000Z', [{ hex: 'not-a-hex', role: 'primary' }]), // newest is broken
    ];
    expect(await loadBrandPaletteColors('c1')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('orders hexes by role precedence (original order within a role)', async () => {
    controls.assets = [
      palAsset('a1', '2026-01-01T00:00:00.000Z', [
        { hex: '#111111', role: 'text' },
        { hex: '#222222', role: 'primary' },
        { hex: '#333333', role: 'accent' },
        { hex: '#444444', role: 'primary' }, // second primary keeps its original order
      ]),
    ];
    const res = await loadBrandPaletteColors('c1');
    expect(res?.orderedHexes).toEqual(['#222222', '#444444', '#333333', '#111111']);
  });

  it('picks the newest palette deterministically when created_at ties (tie-break by id)', async () => {
    const ts = '2026-03-01T00:00:00.000Z';
    controls.assets = [
      palAsset('aaa', ts, [{ hex: '#000001', role: 'primary' }]),
      palAsset('zzz', ts, [{ hex: '#000002', role: 'primary' }]),
    ];
    const res = await loadBrandPaletteColors('c1');
    // Highest id ('zzz') wins the tie, in either input order.
    expect(res?.orderedHexes).toEqual(['#000002']);
    controls.assets = [controls.assets[1], controls.assets[0]];
    const res2 = await loadBrandPaletteColors('c1');
    expect(res2?.orderedHexes).toEqual(['#000002']);
  });
});

describe('loadBrandPaletteText / formatBrandPaletteText', () => {
  beforeEach(() => {
    controls.assets = [];
  });

  it('renders role-tagged lines and is empty when no palette', async () => {
    expect(await loadBrandPaletteText('c1')).toBe('');
    controls.assets = [palAsset('a1', '2026-01-01T00:00:00.000Z', [{ hex: '#006084', role: 'primary', name: 'Mavi' }])];
    const text = await loadBrandPaletteText('c1');
    expect(text).toContain('#006084');
    expect(text).toContain('Mavi');
  });

  it('formatBrandPaletteText is pure over an already-loaded snapshot', () => {
    expect(formatBrandPaletteText([{ hex: '#006084', role: 'primary' }])).toContain('#006084');
  });

  it('formatBrandPaletteText renders lines in canonical role order', () => {
    const text = formatBrandPaletteText([
      { hex: '#111111', role: 'text' },
      { hex: '#222222', role: 'primary' },
      { hex: '#333333', role: 'accent' },
    ]);
    const order = text.split('\n').map((l) => l.slice(2, 9)); // '- #RRGGBB'
    expect(order).toEqual(['#222222', '#333333', '#111111']); // primary → accent → text
  });
});
