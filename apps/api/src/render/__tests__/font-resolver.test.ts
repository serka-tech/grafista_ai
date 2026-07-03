import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FALLBACK_FONT,
  FONT_WHITELIST,
  buildGoogleFontsLinkTag,
  resolveFont,
} from '../font-resolver.js';

// Pure-logic unit tests — no DB/HTTP. Deliberately placed under
// src/render/__tests__/ rather than src/__tests__/ (which spins up an
// embedded Postgres instance via global-setup for the whole suite) so this
// file's own assertions run instantly regardless of how the surrounding
// suite is invoked.
describe('resolveFont', () => {
  it('resolves an exact match with no fallback', () => {
    const result = resolveFont('Roboto');
    expect(result).toEqual({ resolvedFont: 'Roboto', requestedFont: 'Roboto', fallbackApplied: false });
  });

  it('resolves a case-insensitive match', () => {
    const result = resolveFont('ROBOTO');
    expect(result.resolvedFont).toBe('Roboto');
    expect(result.fallbackApplied).toBe(false);
  });

  it('resolves a whitespace-trimmed match', () => {
    const result = resolveFont(' roboto ');
    expect(result.resolvedFont).toBe('Roboto');
    expect(result.fallbackApplied).toBe(false);
  });

  it('falls back deterministically for an unknown font', () => {
    const result = resolveFont('Comic Sans MS');
    expect(result).toEqual({
      resolvedFont: DEFAULT_FALLBACK_FONT,
      requestedFont: 'Comic Sans MS',
      fallbackApplied: true,
    });
  });

  it('falls back deterministically for an empty string', () => {
    const result = resolveFont('');
    expect(result.resolvedFont).toBe(DEFAULT_FALLBACK_FONT);
    expect(result.fallbackApplied).toBe(true);
  });

  it('falls back deterministically for a whitespace-only string', () => {
    const result = resolveFont('   ');
    expect(result.resolvedFont).toBe(DEFAULT_FALLBACK_FONT);
    expect(result.fallbackApplied).toBe(true);
  });

  it('never resolves outside the whitelist', () => {
    for (const input of ['Roboto', 'roboto', 'INTER', 'unknown-font', '']) {
      const result = resolveFont(input);
      expect(FONT_WHITELIST).toContain(result.resolvedFont);
    }
  });
});

describe('buildGoogleFontsLinkTag', () => {
  it('returns a single <link> tag referencing all whitelisted families', () => {
    const tag = buildGoogleFontsLinkTag();
    expect(tag).toMatch(/^<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?/);
    expect(tag).toContain('display=swap');
    for (const font of FONT_WHITELIST) {
      expect(tag).toContain(`family=${font}`);
    }
  });
});
