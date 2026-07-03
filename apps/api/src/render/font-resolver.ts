/**
 * Grafista AI Studio — Render Font Resolver (Phase 2 Step 9A)
 *
 * The HTML/CSS renderer (see ./html-renderer.ts) never trusts a layer's
 * freeform `textProperties.fontFamily` string directly — it is AI-generated
 * text and may name a font that either isn't loaded in the rendering browser
 * or doesn't exist at all. This module is the single place that maps any
 * requested font name onto one of a small, explicitly whitelisted set of
 * Google Fonts the renderer actually loads (see buildGoogleFontsLinkTag),
 * with a deterministic fallback when the request doesn't match — NEVER a
 * random or "best guess" substitution, so the same input always resolves the
 * same way and a fallback is always traceable in render_warnings.
 */

export const FONT_WHITELIST = ['Inter', 'Roboto', 'Montserrat', 'Poppins'] as const;
export type WhitelistedFont = (typeof FONT_WHITELIST)[number];

/** Used whenever the requested font doesn't match the whitelist (including empty/whitespace input). */
export const DEFAULT_FALLBACK_FONT: WhitelistedFont = 'Inter';

export interface FontResolution {
  /** The font the renderer should actually use — always a whitelisted font. */
  resolvedFont: WhitelistedFont;
  /** The raw, un-normalized font family string that was requested. */
  requestedFont: string;
  /** True when `resolvedFont` differs from what was requested (i.e. the fallback was applied). */
  fallbackApplied: boolean;
}

/**
 * Resolves a freeform font-family request against FONT_WHITELIST.
 * Matching is case-insensitive and trims surrounding whitespace (e.g.
 * "roboto ", "ROBOTO" and "Roboto" all resolve to 'Roboto'). Any non-match —
 * including an empty or whitespace-only string — deterministically falls
 * back to DEFAULT_FALLBACK_FONT.
 */
export function resolveFont(requestedFontFamily: string): FontResolution {
  const normalized = requestedFontFamily.trim().toLowerCase();
  const match = FONT_WHITELIST.find((font) => font.toLowerCase() === normalized);

  if (match) {
    return { resolvedFont: match, requestedFont: requestedFontFamily, fallbackApplied: false };
  }

  return { resolvedFont: DEFAULT_FALLBACK_FONT, requestedFont: requestedFontFamily, fallbackApplied: true };
}

/** Font weights loaded for every whitelisted family — covers the common range a design might request. */
const LOADED_WEIGHTS = [400, 500, 600, 700];

/**
 * Builds a single `<link>` tag (for use inside a rendered document's `<head>`)
 * referencing Google Fonts for exactly the FONT_WHITELIST families. This is a
 * pure string builder — it never performs a network fetch itself. Whether
 * the returned URL is ever actually fetched is entirely up to whatever
 * consumes the HTML this tag is embedded in (Playwright in production,
 * nothing at all in unit tests).
 */
export function buildGoogleFontsLinkTag(): string {
  const families = FONT_WHITELIST.map(
    (font) => `family=${encodeURIComponent(font)}:wght@${LOADED_WEIGHTS.join(';')}`
  ).join('&');
  const href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  return `<link rel="stylesheet" href="${href}">`;
}
