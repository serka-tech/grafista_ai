// ─── Grafista AI Studio — Deterministic color normalization ──────────────
//
// Pure, dependency-free helpers shared by the DNA grounding (design-dna-analysis)
// and the layout color baking (layout-generation) so the client's real brand
// palette becomes the single source of truth for color at generation time.
//
// Everything here is a PURE function (no I/O, no Date/Math.random) so each edge
// case is deterministically unit-testable.

/** Canonical role precedence for ordering palette hexes (fallback rule + role-tagged
 * output). Original asset order is the within-role tie-break, applied by the caller. */
export const PALETTE_ROLE_ORDER = [
  'primary',
  'secondary',
  'accent',
  'background',
  'text',
  'other',
] as const;

/**
 * Normalize a hex color string to canonical `#RRGGBB` uppercase form.
 * - leading `#` optional
 * - `#RGB` shorthand expands to `#RRGGBB`
 * - 8-digit `#RRGGBBAA` (alpha) keeps the first 6 (RGB)
 * Returns null for anything that is not a valid 3/6/8-digit hex color.
 */
export function normalizeHex(h: string): string | null {
  if (typeof h !== 'string') return null;
  const raw = h.trim().replace(/^#/, '');
  let rgb: string;
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    rgb = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
  } else if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    rgb = raw;
  } else if (/^[0-9a-fA-F]{8}$/.test(raw)) {
    rgb = raw.slice(0, 6);
  } else {
    return null;
  }
  return '#' + rgb.toUpperCase();
}

/**
 * Canonicalize a palette: normalize each entry, drop invalid ones, stable-dedupe
 * (first occurrence wins). May return an empty array.
 */
export function canonicalizePalette(paletteHexes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of paletteHexes ?? []) {
    const norm = normalizeHex(h);
    if (norm === null || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** sRGB Euclidean distance over 0-255 channels. Inputs must be canonical `#RRGGBB`. */
export function colorDistance(a: string, b: string): number {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

/**
 * Snap a hex to the nearest palette member.
 * - palette is canonicalized first; if it ends up empty, the input is returned unchanged (no-op)
 * - an invalid input hex maps to the first (canonical) palette member
 * - ties are broken by the earlier position in the canonical palette (stable)
 */
export function nearestPaletteHex(hex: string, paletteHexes: string[]): string {
  const palette = canonicalizePalette(paletteHexes);
  if (palette.length === 0) return hex;
  const norm = normalizeHex(hex);
  if (norm === null) return palette[0];
  let best = palette[0];
  let bestDist = colorDistance(norm, palette[0]);
  for (let i = 1; i < palette.length; i += 1) {
    const d = colorDistance(norm, palette[i]);
    if (d < bestDist) {
      best = palette[i];
      bestDist = d;
    }
  }
  return best;
}

/**
 * Map every color to its nearest palette member, preserving order and stable-deduping.
 * - empty `colors` → []
 * - empty canonical palette → `colors` returned unchanged (no-op)
 */
export function normalizeColorsToPalette(colors: string[], paletteHexes: string[]): string[] {
  if (!colors || colors.length === 0) return [];
  const palette = canonicalizePalette(paletteHexes);
  if (palette.length === 0) return [...colors];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of colors) {
    const snapped = nearestPaletteHex(c, palette);
    if (seen.has(snapped)) continue;
    seen.add(snapped);
    out.push(snapped);
  }
  return out;
}

// ─── Recursive layout color normalizer ───────────────────────────────────
// Snaps every present color field of a layout to the nearest palette member, at
// every layer depth. PURE: returns a deep-cloned, adjusted copy; the input is
// never mutated. When the canonical palette is empty, the layout is returned
// unchanged. Tolerant of unknown shapes — only string color fields that exist are
// touched. Field set matches packages/schemas/src/layout.ts:
//   canvas.backgroundColor · layer.textProperties.color ·
//   layer.shapeProperties.fillColor · layer.shapeProperties.strokeColor · children[]

function snapField(obj: Record<string, unknown>, key: string, palette: string[]): void {
  const v = obj[key];
  if (typeof v === 'string' && v.length > 0) {
    obj[key] = nearestPaletteHex(v, palette);
  }
}

function normalizeLayerColors(layer: unknown, palette: string[]): void {
  if (!layer || typeof layer !== 'object') return;
  const l = layer as Record<string, unknown>;

  const text = l.textProperties;
  if (text && typeof text === 'object') {
    snapField(text as Record<string, unknown>, 'color', palette);
  }
  const shape = l.shapeProperties;
  if (shape && typeof shape === 'object') {
    snapField(shape as Record<string, unknown>, 'fillColor', palette);
    snapField(shape as Record<string, unknown>, 'strokeColor', palette);
  }
  const children = l.children;
  if (Array.isArray(children)) {
    for (const child of children) normalizeLayerColors(child, palette);
  }
}

/**
 * Return a deep-cloned layout with every color field snapped to the nearest palette
 * member (recursively, incl. nested `children`). No-op (returns a clone equal to the
 * input) when the canonical palette is empty. Never mutates the input.
 *
 * PRECONDITION: `layout` must be JSON-serializable (no functions, BigInt, or cycles).
 * The only caller passes a schema-validated LayoutPlanContent — plain AI-produced JSON —
 * so the JSON round-trip below is a safe, dependency-free deep clone. Keys whose value is
 * literally `undefined` are dropped by the round-trip, which is fine here because a
 * validated LayoutPlanContent carries no meaningful `undefined`-valued keys.
 */
export function normalizeLayoutColors<T>(layout: T, paletteHexes: string[]): T {
  const palette = canonicalizePalette(paletteHexes);
  const clone = JSON.parse(JSON.stringify(layout)) as T;
  if (palette.length === 0) return clone;
  if (!clone || typeof clone !== 'object') return clone;

  const root = clone as Record<string, unknown>;
  const canvas = root.canvas;
  if (canvas && typeof canvas === 'object') {
    snapField(canvas as Record<string, unknown>, 'backgroundColor', palette);
  }
  const layers = root.layers;
  if (Array.isArray(layers)) {
    for (const layer of layers) normalizeLayerColors(layer, palette);
  }
  return clone;
}
