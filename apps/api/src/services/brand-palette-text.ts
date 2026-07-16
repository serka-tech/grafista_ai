/**
 * Grafista AI Studio — Brand palette helpers (shared)
 *
 * Builds the client's authoritative brand palette from their `color_palette` brand
 * asset (metadata.palette — extracted from the uploaded kartela and user-edited).
 * The palette is the SINGLE SOURCE OF TRUTH for brand color, used by every stage
 * that must honor the real brand colors:
 *   - design-dna-analysis (synthesis anchor + deterministic colorUsageRules grounding),
 *   - layout-generation (text/element colors + deterministic layer-color baking), and
 *   - visual-generation (so the image model paints with the real palette).
 *
 * `loadBrandPaletteColors` is the structured core; `loadBrandPaletteText` renders it
 * as a role-tagged human-readable string for prompts.
 *
 * Validity is INDEPENDENT of color count: a single schema-valid swatch is a usable
 * brand truth (a monochrome brand is legitimate). If the NEWEST color_palette asset's
 * metadata.palette fails schema parse, we FAIL CLOSED — treat the client as having no
 * usable palette (and log a warning) rather than silently resurrecting stale colors
 * from an older asset.
 */

import { BrandPaletteSchema, PALETTE_ROLE_ORDER, type BrandPalette } from '@grafista/schemas';
import { store } from '../data/store.js';

const PALETTE_ROLE_LABEL: Record<string, string> = {
  primary: 'primary / main brand color',
  secondary: 'secondary',
  accent: 'accent / highlight',
  background: 'background / base',
  text: 'text',
  other: 'supporting',
};

/** Role precedence index for ordering; unknown roles sort last, stable within a role. */
function roleRank(role: string): number {
  const i = (PALETTE_ROLE_ORDER as readonly string[]).indexOf(role);
  return i === -1 ? PALETTE_ROLE_ORDER.length : i;
}

/**
 * The client's authoritative brand palette, or null when none is usable.
 *
 * Looks ONLY at the newest color_palette asset:
 *  - no color_palette asset            → null (no palette; unchanged downstream behavior)
 *  - newest palette metadata invalid   → null + warning (FAIL CLOSED; never fall back to older)
 *  - newest palette valid (>=1 swatch) → the parsed palette (monochrome allowed)
 *
 * `palette` preserves the asset's original order; `orderedHexes` is role-sorted
 * (PALETTE_ROLE_ORDER, original asset order as within-role tie-break) for the
 * fallback rule and role-tagged output.
 */
export async function loadBrandPaletteColors(
  clientId: string
): Promise<{ palette: BrandPalette; orderedHexes: string[] } | null> {
  const assets = await store.brandAssets.listByClient(clientId);
  // Pick the newest color_palette asset DETERMINISTICALLY. The repo orders by
  // created_at only, so two assets sharing a timestamp could come back in either
  // order — tie-break by id so "newest" (and the fail-closed decision below) is stable.
  let newest: (typeof assets)[number] | undefined;
  for (const a of assets) {
    if (a.type !== 'color_palette') continue;
    if (!newest || a.createdAt > newest.createdAt || (a.createdAt === newest.createdAt && a.id > newest.id)) {
      newest = a;
    }
  }
  if (!newest) return null;

  const parsed = BrandPaletteSchema.safeParse((newest.metadata as { palette?: unknown } | undefined)?.palette);
  if (!parsed.success || parsed.data.length === 0) {
    console.warn(
      `[brand-palette] newest color_palette asset ${newest.id} for client ${clientId} has ` +
        `invalid/empty metadata.palette — failing closed (treating client as having no usable ` +
        `palette; not falling back to an older asset).`
    );
    return null;
  }

  // Stable role-ordered hex list: sort by role rank, preserving original order within a role.
  const orderedHexes = parsed.data
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => roleRank(a.c.role) - roleRank(b.c.role) || a.idx - b.idx)
    .map((x) => x.c.hex);

  return { palette: parsed.data, orderedHexes };
}

/**
 * Role-tagged, human-readable palette string from an already-loaded palette snapshot.
 * Rendered in the canonical role order (PALETTE_ROLE_ORDER), original asset order as the
 * within-role tie-break — matching how orderedHexes is sorted, so prompt text and hexes agree.
 */
export function formatBrandPaletteText(palette: BrandPalette): string {
  return palette
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => roleRank(a.c.role) - roleRank(b.c.role) || a.idx - b.idx)
    .map(({ c }) => `- ${c.hex} — ${PALETTE_ROLE_LABEL[c.role] ?? c.role}${c.name ? ` (${c.name})` : ''}`)
    .join('\n');
}

/**
 * Role-tagged, human-readable palette string for prompts, or '' when no usable palette
 * exists (callers then fall back to the layout's / DNA's own colors). Callers that ALSO
 * need the hexes (to normalize colors) should instead call loadBrandPaletteColors ONCE
 * and pass its `.palette` to formatBrandPaletteText — never load the palette twice, or a
 * concurrent edit between the two reads can desync the prompt from the normalization.
 */
export async function loadBrandPaletteText(clientId: string): Promise<string> {
  const loaded = await loadBrandPaletteColors(clientId);
  return loaded ? formatBrandPaletteText(loaded.palette) : '';
}
