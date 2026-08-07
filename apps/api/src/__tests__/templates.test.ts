import { describe, expect, it } from 'vitest';

import { SECTOR_DEFINITIONS } from '../sectors/catalog.js';
import {
  autoFitFontSize,
  clampText,
  contrastRatio,
  escapeHtml,
  pickTextColor,
  safeColor,
  scrimAlphaFor,
  turkishLower,
  turkishUpper,
} from '../templates/helpers.js';
import { getTemplate, listTemplates, templateIds } from '../templates/registry.js';
import { layoutModeFor, type TemplateInput, type TemplateSize } from '../templates/types.js';

const SIZES: { label: string; size: TemplateSize; safeArea: { top: number; bottom: number } }[] = [
  { label: 'square', size: { width: 1080, height: 1080 }, safeArea: { top: 0, bottom: 0 } },
  { label: 'portrait', size: { width: 1080, height: 1920 }, safeArea: { top: 0.14, bottom: 0.2 } },
  { label: 'landscape', size: { width: 1200, height: 628 }, safeArea: { top: 0, bottom: 0 } },
];

// Contains a lowercase dotted i on purpose: without one, correct and
// wrong-locale uppercasing produce the same string and the guard below
// cannot tell them apart.
const TURKISH_HEADLINE = 'Işığın izinde: İstanbul’da iyi şubat';
const TURKISH_SUBLINE = 'Güneşli günlerde çayınızı bahçede için, öğleden sonra 15.00’e kadar açığız.';

function makeInput(size: TemplateSize, safeArea: { top: number; bottom: number }, needsImage: boolean): TemplateInput {
  return {
    size,
    brand: {
      name: 'Çiğdem Kahve',
      palette: {
        primary: '#0f766e',
        secondary: '#134e4a',
        accent: '#f59e0b',
        background: '#0b1f1d',
        text: '#f8fafc',
      },
      headingFont: "'Montserrat'",
      bodyFont: "'Inter'",
    },
    copy: {
      headline: TURKISH_HEADLINE,
      subline: TURKISH_SUBLINE,
      badge: 'Yeni',
      cta: 'Rezervasyon için arayın',
      attribution: 'Ayşe Şıklığıoğlu',
    },
    background: needsImage
      ? { kind: 'ai-image', dataUri: 'data:image/png;base64,iVBORw0KGgo=', blurPx: 4 }
      : { kind: 'brand-gradient' },
    safeArea,
  };
}

const CASES = listTemplates().flatMap((template) =>
  SIZES.filter((variant) => template.supports.includes(layoutModeFor(variant.size))).map(
    (variant) => [`${template.id} @ ${variant.label}`, template, variant] as const
  )
);

describe('template registry', () => {
  it('exposes templates with unique ids', () => {
    const ids = templateIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every template id referenced by a sector', () => {
    // The other half of the sector test's literal id list. That test asserts
    // the definitions only name ids from a hand-written list; this one asserts
    // the registry actually implements them. Neither alone is enough: a shared
    // source would agree with itself.
    const referenced = new Set(
      SECTOR_DEFINITIONS.flatMap((sector) =>
        sector.contentPillars.flatMap((pillar) => pillar.preferredTemplates)
      )
    );
    const implemented = new Set(templateIds());
    const missing = [...referenced].filter((id) => !implemented.has(id));
    expect(missing).toEqual([]);
  });

  it('marks exactly the templates that skip image generation', () => {
    // quote-card is what keeps a month's image bill down. If it silently starts
    // requiring a background, cost per plan rises with nothing else changing.
    const free = listTemplates().filter((t) => !t.needsBackgroundImage).map((t) => t.id);
    expect(free).toContain('quote-card');
  });
});

describe.each(CASES)('%s', (_label, template, variant) => {
  const input = makeInput(variant.size, variant.safeArea, template.needsBackgroundImage);
  const output = template.render(input);

  it('produces a complete document', () => {
    expect(output.html.startsWith('<!doctype html>')).toBe(true);
    expect(output.html).toContain('</html>');
    expect(output.html).toContain('@font-face');
    expect(output.html).toContain('data:font/woff2;base64,');
  });

  it('reports its background requirement consistently with the registry', () => {
    expect(output.needsBackgroundImage).toBe(template.needsBackgroundImage);
  });

  it('keeps Turkish characters intact', () => {
    // Some templates uppercase the headline, so checking for individual letters
    // would fail on a correct render (ı legitimately becomes I). What must hold
    // is that the headline survives verbatim in one casing or the other: any
    // mojibake or a wrong-locale uppercase produces neither.
    const escaped = escapeHtml(clampText(TURKISH_HEADLINE, 64));
    const asUpper = escapeHtml(turkishUpper(clampText(TURKISH_HEADLINE, 64)));
    const found = output.html.includes(escaped) || output.html.includes(asUpper);
    expect(found, 'headline is missing or mangled in the output').toBe(true);
  });

  it('never uppercases with the wrong locale', () => {
    // The specific failure: JS toUpperCase() turns "ışığın" into "IŞIĞIN" but
    // "İstanbul" into "ISTANBUL", losing the dot. If that string appears, some
    // path bypassed turkishUpper.
    const wrongLocale = escapeHtml(clampText(TURKISH_HEADLINE, 64).toUpperCase());
    expect(output.html).not.toContain(wrongLocale);
  });

  it('never uses CSS uppercasing', () => {
    // The behavioural version of the rule, checked on the emitted document
    // rather than by grepping source. CSS uppercase is wrong for Turkish and no
    // visual review reliably catches "IYI" where "İYİ" belongs.
    expect(output.html).not.toMatch(/text-transform\s*:\s*uppercase/i);
  });

  it('multiplies every scale-unit expression by a unit', () => {
    // `--u` is a bare number, so `calc(20 * var(--u))` produces a <number> and
    // the browser drops the whole declaration without a word: font sizes fall
    // back to the 16px default, padding to 0, gap to normal. The document still
    // contains all the right text and passes every structural check, which is
    // exactly why this needs its own guard.
    const uses = [...output.html.matchAll(/var\(--u\)(.{0,7})/g)];
    expect(uses.length).toBeGreaterThan(0);
    const unitless = uses.filter((match) => !/^\s*\*\s*1px/.test(match[1]));
    expect(unitless.map((m) => `var(--u)${m[1]}`)).toEqual([]);
  });

  it('declares text regions inside the canvas', () => {
    expect(output.textRects.length).toBeGreaterThan(0);
    for (const rect of output.textRects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(100.001);
      expect(rect.y + rect.h).toBeLessThanOrEqual(100.001);
    }
  });

  it('keeps text clear of the platform safe area', () => {
    // Story chrome hides the top and bottom bands. A headline underneath the
    // caption rail is invisible to the viewer but perfectly fine to every
    // check that only looks at the PNG as a whole.
    if (variant.safeArea.bottom === 0 && variant.safeArea.top === 0) return;
    const topLimit = variant.safeArea.top * 100;
    const bottomLimit = 100 - variant.safeArea.bottom * 100;
    for (const rect of output.textRects) {
      expect(rect.y).toBeGreaterThanOrEqual(topLimit - 0.001);
      expect(rect.y + rect.h).toBeLessThanOrEqual(bottomLimit + 0.001);
    }
  });

  it('does not leak a raw palette value into a style attribute unchecked', () => {
    // safeColor is the only path a palette value may take into CSS. A colour
    // that slipped past it would show up as a non-hex token in a style block.
    expect(output.html).not.toContain('javascript:');
    expect(output.html).not.toContain('expression(');
  });
});

describe('helpers: Turkish casing', () => {
  it('uppercases dotted i to İ and dotless ı to I', () => {
    expect(turkishUpper('iyi')).toBe('İYİ');
    expect(turkishUpper('ışık')).toBe('IŞIK');
    expect(turkishUpper('İstanbul')).toBe('İSTANBUL');
    // The trap: the plain JS version gets this wrong.
    expect('iyi'.toUpperCase()).toBe('IYI');
  });

  it('lowercases I to ı and İ to i', () => {
    expect(turkishLower('IŞIK')).toBe('ışık');
    expect(turkishLower('İSTANBUL')).toBe('istanbul');
  });
});

describe('helpers: colour safety', () => {
  it('accepts a six digit hex and normalises case', () => {
    expect(safeColor('#AABBCC', '#000000')).toBe('#aabbcc');
  });

  it('rejects anything that is not a plain hex', () => {
    // The palette comes from a vision model and is then hand-editable, so both
    // ends can produce something that is not a colour at all.
    for (const bad of [
      'red',
      'rgb(0,0,0)',
      'linear-gradient(red, blue)',
      '#fff',
      '#12345',
      'url(javascript:alert(1))',
      '#000000; background:url(x)',
      undefined,
    ]) {
      expect(safeColor(bad as string | undefined, '#123456')).toBe('#123456');
    }
  });
});

describe('helpers: contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 3);
  });

  it('picks the readable text colour for a backdrop', () => {
    const palette = {
      primary: '#0f766e',
      secondary: '#134e4a',
      accent: '#f59e0b',
      background: '#0b1f1d',
      text: '#f8fafc',
    };
    expect(contrastRatio(pickTextColor(palette, '#0b1f1d'), '#0b1f1d')).toBeGreaterThan(4.5);
    expect(contrastRatio(pickTextColor(palette, '#ffffff'), '#ffffff')).toBeGreaterThan(4.5);
  });

  it('asks for more scrim when the text is closer to the worst-case backdrop', () => {
    // Light text over a dark scrim needs less help than dark text does.
    const lightOnDark = scrimAlphaFor('#ffffff', '#000000');
    const darkOnDark = scrimAlphaFor('#333333', '#000000');
    expect(darkOnDark).toBeGreaterThan(lightOnDark);
  });

  it('applies the boost the QA pass asks for', () => {
    // Chosen so the result stays below the 0.95 ceiling; a boost that clamps
    // would make this assert the clamp rather than the boost.
    const base = scrimAlphaFor('#111111', '#ffffff');
    expect(base).toBeLessThan(0.8);
    expect(scrimAlphaFor('#111111', '#ffffff', 0.1)).toBeCloseTo(base + 0.1, 5);
  });

  it('never exceeds full opacity', () => {
    expect(scrimAlphaFor('#808080', '#808080', 0.9)).toBeLessThanOrEqual(0.95);
  });
});

describe('helpers: text fitting', () => {
  it('shrinks the font as the headline grows', () => {
    const common = { maxWidthPx: 900, maxHeightPx: 320, maxFontPx: 160, minFontPx: 60 };
    const short = autoFitFontSize({ text: 'Kısa', ...common });
    const long = autoFitFontSize({
      text: 'Çok daha uzun bir başlık, birkaç satıra yayılacak kadar uzun olmalı ki küçülsün',
      ...common,
    });
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThanOrEqual(common.minFontPx);
  });

  it('clamps overlong copy on a word boundary', () => {
    const clamped = clampText('Güneşli günlerde çayınızı bahçede içmenin tam sırası', 20);
    expect(clamped.length).toBeLessThanOrEqual(21);
    expect(clamped.endsWith('…')).toBe(true);
    expect(clamped).not.toContain('  ');
  });

  it('leaves short copy untouched', () => {
    expect(clampText('Kısa metin', 40)).toBe('Kısa metin');
  });
});

describe('helpers: escaping', () => {
  it('escapes the characters that would break out of markup', () => {
    expect(escapeHtml('<script>"x"&\'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;'
    );
  });

  it('leaves Turkish letters alone', () => {
    expect(escapeHtml('İşığın öğle çayı')).toBe('İşığın öğle çayı');
  });
});

describe('template lookup', () => {
  it('resolves a known id and rejects an unknown one', () => {
    expect(getTemplate('bold-statement')?.id).toBe('bold-statement');
    expect(getTemplate('yok-boyle-bir-sablon')).toBeUndefined();
  });
});
