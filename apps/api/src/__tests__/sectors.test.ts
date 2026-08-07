import { describe, it, expect } from 'vitest';
import { hasValidPillarWeights, pillarWeightSum } from '@grafista/schemas';

import {
  SECTOR_DEFINITIONS,
  foldTurkish,
  getSector,
  listSectors,
  resolveSectorKeyFromIndustry,
  validateCatalog,
} from '../sectors/catalog.js';

/**
 * The sector catalog drives the monthly plan's whole skeleton: which pillar
 * lands on which day, at what hour, rendered with which template. A content
 * typo here degrades every plan produced for that sector, silently, so the
 * catalog gets the same treatment as code.
 *
 * The template id list below is written out literally rather than imported
 * from the template registry on purpose: if both sides read the same source,
 * a wrong id in a definition would agree with itself and the test would pass.
 * When the registry lands it becomes the second, independent opinion and this
 * list is what it gets checked against.
 */
const KNOWN_TEMPLATE_IDS = [
  'bold-statement',
  'photo-caption',
  'split-diagonal',
  'editorial-frame',
  'offer-badge',
  'quote-card',
  'carousel',
] as const;

const EXPECTED_SECTOR_COUNT = 12;

describe('sector catalog', () => {
  it('parses every definition against the schema', () => {
    expect(() => validateCatalog()).not.toThrow();
  });

  it('ships the full catalog', () => {
    expect(SECTOR_DEFINITIONS).toHaveLength(EXPECTED_SECTOR_COUNT);
    expect(listSectors()).toHaveLength(EXPECTED_SECTOR_COUNT);
  });

  it('has unique sector keys', () => {
    const keys = SECTOR_DEFINITIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has unique labels', () => {
    const labels = SECTOR_DEFINITIONS.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(SECTOR_DEFINITIONS.map((s) => [s.key, s] as const))(
    '%s: pillar weights sum to exactly 1',
    (_key, sector) => {
      // Reported explicitly so a failure names the actual sum instead of just
      // "expected true, got false".
      expect(pillarWeightSum(sector.contentPillars)).toBeCloseTo(1, 3);
      expect(hasValidPillarWeights(sector.contentPillars)).toBe(true);
    }
  );

  it.each(SECTOR_DEFINITIONS.map((s) => [s.key, s] as const))(
    '%s: pillar keys are unique within the sector',
    (_key, sector) => {
      const pillarKeys = sector.contentPillars.map((p) => p.key);
      expect(new Set(pillarKeys).size).toBe(pillarKeys.length);
    }
  );

  it.each(SECTOR_DEFINITIONS.map((s) => [s.key, s] as const))(
    '%s: every preferredTemplates entry is a real template id',
    (_key, sector) => {
      for (const pillar of sector.contentPillars) {
        for (const templateId of pillar.preferredTemplates) {
          expect(KNOWN_TEMPLATE_IDS).toContain(templateId);
        }
      }
    }
  );

  it.each(SECTOR_DEFINITIONS.map((s) => [s.key, s] as const))(
    '%s: cadence days do not contradict each other',
    (_key, sector) => {
      const avoid = new Set(sector.cadence.avoidDays);
      for (const day of sector.cadence.preferredDays) {
        expect(avoid.has(day)).toBe(false);
      }
    }
  );

  it.each(SECTOR_DEFINITIONS.map((s) => [s.key, s] as const))(
    '%s: every preferred day has at least one posting time',
    (_key, sector) => {
      const daysWithTimes = new Set(sector.bestPostingTimes.map((t) => t.dayOfWeek));
      for (const day of sector.cadence.preferredDays) {
        expect(daysWithTimes.has(day)).toBe(true);
      }
    }
  );

  it.each(SECTOR_DEFINITIONS.map((s) => [s.key, s] as const))(
    '%s: hashtags all start with #',
    (_key, sector) => {
      for (const tag of [...sector.hashtags.core, ...sector.hashtags.rotating]) {
        expect(tag.startsWith('#')).toBe(true);
        expect(tag).not.toContain(' ');
      }
    }
  );

  it.each(SECTOR_DEFINITIONS.map((s) => [s.key, s] as const))(
    '%s: rotating hashtags do not repeat the core set',
    (_key, sector) => {
      const core = new Set(sector.hashtags.core);
      for (const tag of sector.hashtags.rotating) {
        expect(core.has(tag)).toBe(false);
      }
    }
  );

  it('does not reuse an alias across two sectors', () => {
    // Compared folded, because that is how resolution actually matches. Two
    // sectors claiming forms that differ only by Turkish diacritics would
    // resolve to whichever happens to come first in the catalog.
    const owners = new Map<string, string>();
    const collisions: string[] = [];
    for (const sector of SECTOR_DEFINITIONS) {
      for (const folded of new Set(sector.aliases.map(foldTurkish))) {
        const owner = owners.get(folded);
        if (owner && owner !== sector.key) {
          collisions.push(`"${folded}" claimed by both ${owner} and ${sector.key}`);
        } else {
          owners.set(folded, sector.key);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it.each(SECTOR_DEFINITIONS.map((s) => [s.key, s] as const))(
    '%s: has no alias that folding already covers',
    (_key, sector) => {
      // Listing both "kuaför" and "kuafor" is dead weight: folding maps them to
      // the same skeleton, so the second never gets consulted. It also signals
      // the author did not know folding exists, which usually means other
      // spellings were skipped for the wrong reason.
      const byFolded = new Map<string, string[]>();
      for (const alias of sector.aliases) {
        const folded = foldTurkish(alias);
        byFolded.set(folded, [...(byFolded.get(folded) ?? []), alias]);
      }
      const redundant = [...byFolded.values()].filter((group) => group.length > 1);
      expect(redundant).toEqual([]);
    }
  );

  it('getSector resolves known keys and rejects unknown ones', () => {
    expect(getSector('kafe_restoran')?.label).toBe('Kafe & Restoran');
    expect(getSector('bilinmeyen_sektor')).toBeUndefined();
  });
});

describe('Turkish folding', () => {
  // JS lowercasing is wrong for Turkish in both directions: 'I'.toLowerCase()
  // yields 'i' (should be 'ı') and 'İ'.toLowerCase() yields 'i' plus a
  // combining dot. Both would break alias matching in ways no schema check
  // catches, so they are pinned here.
  it('collapses dotted and dotless I to the same skeleton', () => {
    expect(foldTurkish('İSTANBUL')).toBe('istanbul');
    expect(foldTurkish('istanbul')).toBe('istanbul');
    expect(foldTurkish('ISTANBUL')).toBe('istanbul');
    expect(foldTurkish('ıstanbul')).toBe('istanbul');
  });

  it('never emits a combining dot', () => {
    // '̇' is the artifact plain toLowerCase() leaves behind on 'İ'.
    expect(foldTurkish('İyi')).not.toContain('̇');
    expect('İ'.toLowerCase()).toContain('̇'); // the trap this guards against
  });

  it('folds the remaining Turkish letters', () => {
    expect(foldTurkish('Şişli Güzellik Çarşı Öğrenci')).toBe('sisli guzellik carsi ogrenci');
  });

  it('normalises surrounding and repeated whitespace', () => {
    expect(foldTurkish('  Diş   Kliniği  ')).toBe('dis klinigi');
  });
});

describe('resolveSectorKeyFromIndustry', () => {
  it('matches an exact label regardless of Turkish casing', () => {
    expect(resolveSectorKeyFromIndustry('Kafe & Restoran')).toBe('kafe_restoran');
  });

  it('matches an alias written without Turkish characters', () => {
    // A user typing on an English keyboard is the common case here.
    expect(resolveSectorKeyFromIndustry('dis klinigi')).toBe('dis_klinigi');
    expect(resolveSectorKeyFromIndustry('DIŞ KLINIGI')).toBe('dis_klinigi');
    expect(resolveSectorKeyFromIndustry('Diş Kliniği')).toBe('dis_klinigi');
  });

  it('matches the sector key itself', () => {
    expect(resolveSectorKeyFromIndustry('spor salonu')).toBe('spor_salonu');
  });

  it('falls back to substring containment for a decorated name', () => {
    expect(resolveSectorKeyFromIndustry('Kadıköy Diş Kliniği')).toBe('dis_klinigi');
  });

  it('returns undefined rather than guessing', () => {
    expect(resolveSectorKeyFromIndustry('uzay madenciliği')).toBeUndefined();
    expect(resolveSectorKeyFromIndustry('')).toBeUndefined();
    expect(resolveSectorKeyFromIndustry(null)).toBeUndefined();
    expect(resolveSectorKeyFromIndustry(undefined)).toBeUndefined();
  });

  it('matches a short alias only as a whole word', () => {
    // "gym" is a real alias and should resolve when it appears as a word.
    expect(resolveSectorKeyFromIndustry('Kadıköy Gym Center')).toBe('spor_salonu');
  });

  it('does not let a short alias match inside an unrelated word', () => {
    // "ymm" is an alias of hukuk_muhasebe and sits inside "symmetri". A plain
    // substring fallback resolves this to a tax office; whole-word matching
    // refuses it. Both alias and haystack are checked folded, so the Turkish
    // characters here are load-bearing rather than decoration.
    expect(resolveSectorKeyFromIndustry('Symmetri Danışmanlık')).toBeUndefined();
    expect(resolveSectorKeyFromIndustry('bir şeyler')).toBeUndefined();
  });
});
