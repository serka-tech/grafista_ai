import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Self-contained web fonts, embedded as base64 `@font-face` rules.
 *
 * Deliberately not Google Fonts over the network. The legacy renderer builds a
 * `<link>` to fonts.googleapis.com and waits on `networkidle`, which means an
 * offline or firewalled run either stalls or silently falls back to the system
 * sans with no warning anywhere — the whole design collapses and the pipeline
 * reports success. Everything here ships in the repo, so a render works with
 * the network unplugged and looks identical every time.
 *
 * Each face needs BOTH Latin subsets. Google splits Turkish across them: ğ Ğ ş
 * Ş İ live in latin-ext while ı ç Ç ö Ö ü Ü live in latin. Ship one and the
 * missing letters render as tofu boxes. The `unicode-range` on each rule is
 * what merges their coverage; drop it and the second rule replaces the first
 * outright.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Two levels up lands on the package root from both src/ (tsx) and dist/ (tsc).
const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');

interface ManifestFile {
  subset: string;
  file: string;
  unicodeRange: string;
}

interface ManifestFace {
  name: string;
  family: string;
  weight: number;
  files: ManifestFile[];
}

export interface FontFamilyDefinition {
  id: string;
  label: string;
  /** The CSS `font-family` value, quoted. */
  cssFamily: string;
  /** Weights available, heaviest last. */
  weights: number[];
  role: 'display' | 'text';
}

/**
 * The pairs a template may ask for. Kept small on purpose: every family is a
 * real file we ship and have verified for Turkish coverage, so there is no
 * "requested font not found" path to fall back from.
 */
export const FONT_FAMILIES: readonly FontFamilyDefinition[] = [
  {
    id: 'montserrat',
    label: 'Montserrat',
    cssFamily: "'Montserrat'",
    weights: [600, 800],
    role: 'display',
  },
  { id: 'inter', label: 'Inter', cssFamily: "'Inter'", weights: [400, 600], role: 'text' },
  {
    id: 'playfair',
    label: 'Playfair Display',
    cssFamily: "'Playfair Display'",
    weights: [700],
    role: 'display',
  },
  { id: 'lora', label: 'Lora', cssFamily: "'Lora'", weights: [400], role: 'text' },
  {
    id: 'bebas',
    label: 'Bebas Neue',
    cssFamily: "'Bebas Neue'",
    weights: [400],
    role: 'display',
  },
  { id: 'dmsans', label: 'DM Sans', cssFamily: "'DM Sans'", weights: [500, 700], role: 'text' },
];

const BY_ID = new Map(FONT_FAMILIES.map((family) => [family.id, family]));

export function getFontFamily(id: string): FontFamilyDefinition | undefined {
  return BY_ID.get(id);
}

/** Heading and body pairings a template can pick from by name. */
export const FONT_PAIRS = {
  modern: { heading: 'montserrat', body: 'inter' },
  editorial: { heading: 'playfair', body: 'lora' },
  impact: { heading: 'bebas', body: 'inter' },
  friendly: { heading: 'dmsans', body: 'dmsans' },
} as const;

export type FontPairId = keyof typeof FONT_PAIRS;

let cachedCss: string | null = null;

/**
 * Builds the `@font-face` block once and reuses it. Roughly 500 KB of base64,
 * so re-reading and re-encoding per render would dominate the render cost.
 */
export function fontFaceCss(): string {
  if (cachedCss !== null) return cachedCss;

  const manifest: ManifestFace[] = JSON.parse(
    readFileSync(path.join(FONT_DIR, 'manifest.json'), 'utf-8')
  );

  const rules: string[] = [];
  for (const face of manifest) {
    for (const file of face.files) {
      const base64 = readFileSync(path.join(FONT_DIR, file.file)).toString('base64');
      rules.push(
        `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${face.weight};` +
          `font-display:block;` +
          `src:url(data:font/woff2;base64,${base64}) format('woff2');` +
          `unicode-range:${file.unicodeRange};}`
      );
    }
  }

  cachedCss = rules.join('\n');
  return cachedCss;
}

/**
 * The families a render should confirm are actually loaded before screenshotting.
 * A face that fails to decode leaves the browser on its fallback sans, which
 * looks plausible enough that nobody notices until a client does.
 */
export function loadedFontChecks(): { family: string; weight: number }[] {
  const manifest: ManifestFace[] = JSON.parse(
    readFileSync(path.join(FONT_DIR, 'manifest.json'), 'utf-8')
  );
  const seen = new Set<string>();
  const checks: { family: string; weight: number }[] = [];
  for (const face of manifest) {
    const key = `${face.family}:${face.weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checks.push({ family: face.family, weight: face.weight });
  }
  return checks;
}
