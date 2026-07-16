import { describe, expect, it } from 'vitest';
import {
  normalizeHex,
  canonicalizePalette,
  colorDistance,
  nearestPaletteHex,
  normalizeColorsToPalette,
  normalizeLayoutColors,
  PALETTE_ROLE_ORDER,
} from '@grafista/schemas';

describe('normalizeHex', () => {
  it('canonicalizes 6-digit hex to uppercase with #', () => {
    expect(normalizeHex('#006084')).toBe('#006084');
    expect(normalizeHex('7fd3f4')).toBe('#7FD3F4');
    expect(normalizeHex('  #7fd3f4  ')).toBe('#7FD3F4');
  });
  it('expands #RGB shorthand', () => {
    expect(normalizeHex('#0af')).toBe('#00AAFF');
    expect(normalizeHex('abc')).toBe('#AABBCC');
  });
  it('keeps the first 6 of an 8-digit RGBA', () => {
    expect(normalizeHex('#006084FF')).toBe('#006084');
  });
  it('returns null for invalid input', () => {
    expect(normalizeHex('nope')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    // @ts-expect-error runtime robustness for non-string
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('canonicalizePalette', () => {
  it('normalizes, drops invalid, and stable-dedupes', () => {
    expect(canonicalizePalette(['#006084', '006084', '#7fd3f4', 'zzz', '#7FD3F4'])).toEqual([
      '#006084',
      '#7FD3F4',
    ]);
  });
  it('returns [] when nothing is valid', () => {
    expect(canonicalizePalette(['x', ''])).toEqual([]);
    expect(canonicalizePalette([])).toEqual([]);
  });
});

describe('colorDistance', () => {
  it('is 0 for identical and symmetric', () => {
    expect(colorDistance('#000000', '#000000')).toBe(0);
    expect(colorDistance('#000000', '#FFFFFF')).toBeCloseTo(Math.sqrt(3 * 255 ** 2));
    expect(colorDistance('#010203', '#040506')).toBe(colorDistance('#040506', '#010203'));
  });
});

describe('nearestPaletteHex', () => {
  const palette = ['#006084', '#7FD3F4'];
  it('snaps a color to the nearest palette member', () => {
    expect(nearestPaletteHex('#004060', palette)).toBe('#006084'); // dark → dark blue
    expect(nearestPaletteHex('#AEE9FF', palette)).toBe('#7FD3F4'); // light → light blue
  });
  it('maps invalid input to the first canonical palette member', () => {
    expect(nearestPaletteHex('garbage', palette)).toBe('#006084');
  });
  it('is a no-op when the canonical palette is empty', () => {
    expect(nearestPaletteHex('#2D5016', ['zzz'])).toBe('#2D5016');
  });
  it('breaks ties toward the earlier canonical palette member', () => {
    // #010000 is exactly equidistant (distance 1) to #000000 and #020000.
    expect(nearestPaletteHex('#010000', ['#000000', '#020000'])).toBe('#000000');
    expect(nearestPaletteHex('#010000', ['#020000', '#000000'])).toBe('#020000');
  });
});

describe('normalizeColorsToPalette', () => {
  const palette = ['#006084', '#7FD3F4'];
  it('maps each color and stable-dedupes preserving order', () => {
    expect(normalizeColorsToPalette(['#2D5016', '#004060', '#AEE9FF'], palette)).toEqual([
      '#006084',
      '#7FD3F4',
    ]);
  });
  it('returns [] for empty colors', () => {
    expect(normalizeColorsToPalette([], palette)).toEqual([]);
  });
  it('returns colors unchanged when the palette is empty', () => {
    expect(normalizeColorsToPalette(['#2D5016'], ['zzz'])).toEqual(['#2D5016']);
  });
});

describe('PALETTE_ROLE_ORDER', () => {
  it('has the documented precedence', () => {
    expect(PALETTE_ROLE_ORDER).toEqual(['primary', 'secondary', 'accent', 'background', 'text', 'other']);
  });
});

describe('normalizeLayoutColors', () => {
  const palette = ['#006084', '#7FD3F4'];
  const layout = () => ({
    format: 'instagram_post',
    canvas: { width: 1080, height: 1080, backgroundColor: '#123456', dpi: 72 },
    layers: [
      {
        id: 'l1',
        type: 'text',
        textProperties: { content: 'Hi', color: '#004060' },
        children: [
          {
            id: 'l1a',
            type: 'shape',
            shapeProperties: { shapeType: 'rectangle', fillColor: '#AEE9FF', strokeColor: '#2D5016' },
          },
        ],
      },
    ],
  });

  it('snaps colors recursively at every depth', () => {
    const out = normalizeLayoutColors(layout(), palette);
    expect(out.canvas.backgroundColor).toBe('#006084');
    expect(out.layers[0].textProperties.color).toBe('#006084');
    expect(out.layers[0].children[0].shapeProperties.fillColor).toBe('#7FD3F4');
    expect(out.layers[0].children[0].shapeProperties.strokeColor).toBe('#006084');
  });

  it('does not mutate the input', () => {
    const input = layout();
    normalizeLayoutColors(input, palette);
    expect(input.canvas.backgroundColor).toBe('#123456');
    expect(input.layers[0].textProperties.color).toBe('#004060');
  });

  it('is a no-op clone when the palette is empty', () => {
    const input = layout();
    const out = normalizeLayoutColors(input, []);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('tolerates missing color fields', () => {
    const minimal = { canvas: { width: 1, height: 1 }, layers: [{ id: 'x', type: 'image' }] };
    expect(() => normalizeLayoutColors(minimal, palette)).not.toThrow();
  });
});
