/**
 * Grafista AI Studio — Brand palette text helper (shared)
 *
 * Builds a role-tagged, human-readable brand palette string from a client's
 * `color_palette` brand asset (metadata.palette — extracted from the uploaded
 * kartela and user-edited). Shared by BOTH stages that must honor the real brand
 * colors:
 *   - layout-generation (so text/element colors are chosen FROM the palette, not
 *     from DesignDNA's color rules), and
 *   - visual-generation (so the image model paints with the real palette).
 *
 * Returns '' when no usable palette exists (fewer than 2 distinct colors), so
 * callers can fall back to the layout's / DNA's own colors.
 */

import { BrandPaletteSchema } from '@grafista/schemas';
import { store } from '../data/store.js';

const PALETTE_ROLE_LABEL: Record<string, string> = {
  primary: 'primary / main brand color',
  secondary: 'secondary',
  accent: 'accent / highlight',
  background: 'background / base',
  text: 'text',
  other: 'supporting',
};

export async function loadBrandPaletteText(clientId: string): Promise<string> {
  const assets = await store.brandAssets.listByClient(clientId);
  for (let i = assets.length - 1; i >= 0; i -= 1) {
    const a = assets[i];
    if (a.type !== 'color_palette') continue;
    const parsed = BrandPaletteSchema.safeParse((a.metadata as { palette?: unknown } | undefined)?.palette);
    if (!parsed.success) continue;
    const distinctHex = new Set(parsed.data.map((c) => c.hex.toUpperCase()));
    if (distinctHex.size < 2) return '';
    return parsed.data
      .map((c) => `- ${c.hex} — ${PALETTE_ROLE_LABEL[c.role] ?? c.role}${c.name ? ` (${c.name})` : ''}`)
      .join('\n');
  }
  return '';
}
