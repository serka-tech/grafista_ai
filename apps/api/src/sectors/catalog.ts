import { SectorDefinitionSchema, type SectorDefinition } from '@grafista/schemas';

import { butikModa } from './definitions/butik-moda.js';
import { disKlinigi } from './definitions/dis-klinigi.js';
import { egitimKurs } from './definitions/egitim-kurs.js';
import { emlak } from './definitions/emlak.js';
import { guzellikKuafor } from './definitions/guzellik-kuafor.js';
import { hukukMuhasebe } from './definitions/hukuk-muhasebe.js';
import { insaatTadilat } from './definitions/insaat-tadilat.js';
import { kafeRestoran } from './definitions/kafe-restoran.js';
import { otomotivServis } from './definitions/otomotiv-servis.js';
import { pastaneFirin } from './definitions/pastane-firin.js';
import { saglikEstetik } from './definitions/saglik-estetik.js';
import { sporSalonu } from './definitions/spor-salonu.js';

/**
 * The catalog is ordered for display, not alphabetically — the setup screen
 * shows these as a grid and the more common sectors should come first.
 */
export const SECTOR_DEFINITIONS: readonly SectorDefinition[] = [
  kafeRestoran,
  guzellikKuafor,
  emlak,
  disKlinigi,
  sporSalonu,
  butikModa,
  otomotivServis,
  insaatTadilat,
  egitimKurs,
  hukukMuhasebe,
  pastaneFirin,
  saglikEstetik,
];

const BY_KEY = new Map<string, SectorDefinition>(
  SECTOR_DEFINITIONS.map((sector) => [sector.key, sector])
);

export function listSectors(): readonly SectorDefinition[] {
  return SECTOR_DEFINITIONS;
}

export function getSector(key: string): SectorDefinition | undefined {
  return BY_KEY.get(key);
}

export function isSectorKey(key: string): boolean {
  return BY_KEY.has(key);
}

/**
 * Folds Turkish letters to their closest ASCII form before comparing.
 *
 * `String#toLowerCase()` is wrong for Turkish in both directions: it maps `I`
 * to `i` (should be `ı`) and `İ` to `i` followed by a combining dot. Locale-
 * aware lowercasing fixes the casing but still leaves `ş`/`s` and `ğ`/`g` as
 * distinct, so a client who typed "dis klinigi" would never match the alias
 * "diş kliniği". Folding sidesteps both problems: every variant collapses to
 * the same ASCII skeleton.
 */
const TURKISH_FOLD: Record<string, string> = {
  İ: 'i',
  I: 'i',
  ı: 'i',
  Ş: 's',
  ş: 's',
  Ğ: 'g',
  ğ: 'g',
  Ü: 'u',
  ü: 'u',
  Ö: 'o',
  ö: 'o',
  Ç: 'c',
  ç: 'c',
  Â: 'a',
  â: 'a',
  Î: 'i',
  î: 'i',
  Û: 'u',
  û: 'u',
};

export function foldTurkish(value: string): string {
  let folded = '';
  for (const char of value) {
    folded += TURKISH_FOLD[char] ?? char;
  }
  // Every remaining character is ASCII-safe for a plain lowercase, and the
  // combining-dot artifact can no longer appear because İ was folded above.
  return folded.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Best-effort mapping from the legacy free-text `clients.industry` column onto
 * a sector key. Clients created before the catalog existed only have that
 * string, so the setup screen pre-selects a sector when it can and otherwise
 * leaves the choice to the user. Never guesses: an unmatched industry returns
 * undefined rather than a default.
 */
export function resolveSectorKeyFromIndustry(industry: string | null | undefined): string | undefined {
  if (!industry) return undefined;

  const needle = foldTurkish(industry);
  if (!needle) return undefined;

  for (const sector of SECTOR_DEFINITIONS) {
    if (foldTurkish(sector.key.replace(/_/g, ' ')) === needle) return sector.key;
    if (foldTurkish(sector.label) === needle) return sector.key;
    for (const alias of sector.aliases) {
      if (foldTurkish(alias) === needle) return sector.key;
    }
  }

  // Fall back to whole-word containment so "Kadıköy Diş Kliniği" still
  // resolves. Runs only after every exact match has failed, so a precise alias
  // always wins over an incidental hit.
  //
  // Word boundaries rather than plain substring: short aliases are real ("gym",
  // "ymm") and a raw `includes` would match them inside unrelated words, so
  // "symmetri danışmanlık" would resolve to a tax office. A length threshold
  // was the obvious guard but it cuts the wrong way — it blocks the legitimate
  // "Kadıköy Gym" too. Matching whole tokens keeps the short aliases useful and
  // still refuses the accidental hit.
  const needleWords = needle.split(' ');
  for (const sector of SECTOR_DEFINITIONS) {
    for (const alias of sector.aliases) {
      if (containsWordSequence(needleWords, foldTurkish(alias).split(' '))) {
        return sector.key;
      }
    }
  }

  return undefined;
}

function containsWordSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;

  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }

  return false;
}

/**
 * Parses every definition against the zod schema. Called from the test suite
 * rather than at import time: a typo in one sector's content should fail CI,
 * not take down an API process whose other routes are unaffected.
 */
export function validateCatalog(): SectorDefinition[] {
  return SECTOR_DEFINITIONS.map((sector) => SectorDefinitionSchema.parse(sector));
}
