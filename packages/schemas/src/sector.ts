import { z } from 'zod';

// ─── Sector Catalog ──────────────────────────────────────
// A sector definition is what makes "content for a dental clinic" differ from
// "content for a bakery". It is deliberately code (not a DB table): the catalog
// is a product decision that should be versioned in git, reviewed in a PR, and
// covered by tests — not data an operator edits at runtime. Clients reference a
// definition by `sectorKey`.
//
// The month's skeleton is derived from these fields deterministically (which
// pillar lands on which day, at what time, rendered with which template). The
// AI only fills the resulting slots with a topic and copy — it never picks the
// structure.

/** Output sizes a template can be rendered at. */
export const StudioOutputKindEnum = z.enum([
  'square', // 1080x1080 — Instagram / Facebook feed
  'story', // 1080x1920 — Story, Reels cover
  'landscape', // 1200x628 — LinkedIn, link preview
  'carousel', // 1080x1080 x N cards
]);
export type StudioOutputKind = z.infer<typeof StudioOutputKindEnum>;

/** Which palette direction the AI background should lean towards. */
export const PalettePreferenceEnum = z.enum(['warm', 'cool', 'neutral', 'brand']);
export type PalettePreference = z.infer<typeof PalettePreferenceEnum>;

/**
 * A content pillar is one recurring theme in the monthly plan (e.g. "Ürün
 * Vitrin"). `weight` decides how many of the month's posts fall to it; the
 * weights across a sector must sum to 1.
 */
export const ContentPillarSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'pillar key must be lowercase snake_case'),
  label: z.string().min(1).max(80),
  weight: z.number().gt(0).lte(1),
  /** Few-shot topics handed to the model so it writes in-domain, not generic. */
  sampleTopics: z.array(z.string().min(1).max(200)).min(3).max(12),
  /** Template ids this pillar renders well as. Validated against the registry. */
  preferredTemplates: z.array(z.string().min(1).max(50)).min(1),
});
export type ContentPillar = z.infer<typeof ContentPillarSchema>;

export const SectorToneSchema = z.object({
  primary: z.string().min(1).max(120),
  secondary: z.string().min(1).max(120),
  do: z.array(z.string().min(1).max(160)).min(2).max(8),
  dont: z.array(z.string().min(1).max(160)).min(2).max(8),
});
export type SectorTone = z.infer<typeof SectorToneSchema>;

export const SectorHashtagsSchema = z.object({
  /** Applied to every post of this sector. */
  core: z.array(z.string().min(2).max(60)).min(3).max(8),
  /** A few are drawn from this pool per post so the set is not identical. */
  rotating: z.array(z.string().min(2).max(60)).min(8).max(40),
});
export type SectorHashtags = z.infer<typeof SectorHashtagsSchema>;

/** 0 = Sunday, matching JS `Date#getDay()`. */
const DayOfWeek = z.number().int().min(0).max(6);
const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM in 24-hour form');

export const PostingTimeSchema = z.object({
  dayOfWeek: DayOfWeek,
  times: z.array(TimeOfDay).min(1).max(4),
});
export type PostingTime = z.infer<typeof PostingTimeSchema>;

export const SectorCadenceSchema = z.object({
  postsPerWeek: z.number().int().min(1).max(14),
  preferredDays: z.array(DayOfWeek).min(1).max(7),
  avoidDays: z.array(DayOfWeek).max(6),
});
export type SectorCadence = z.infer<typeof SectorCadenceSchema>;

export const BackgroundStyleSchema = z.object({
  /** Sector-specific scene direction appended to the background image prompt. */
  positive: z.string().min(1).max(600),
  /** Cliches to steer away from. */
  negative: z.array(z.string().min(1).max(120)).min(2).max(12),
  palettePreference: PalettePreferenceEnum,
});
export type BackgroundStyle = z.infer<typeof BackgroundStyleSchema>;

/** A dated hook in the Turkish calendar the planner can lean on. */
export const SeasonalHookSchema = z.object({
  /** MM-DD; year-agnostic so it applies every year. */
  monthDay: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'monthDay must be MM-DD'),
  label: z.string().min(1).max(120),
});
export type SeasonalHook = z.infer<typeof SeasonalHookSchema>;

export const SectorDefinitionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'sector key must be lowercase snake_case'),
  label: z.string().min(1).max(80),
  /**
   * Free-text `clients.industry` values that map to this sector. Existing
   * clients predate `sector_key`, so their industry string is matched against
   * these on a best-effort basis.
   */
  aliases: z.array(z.string().min(1).max(80)).max(20),
  contentPillars: z.array(ContentPillarSchema).min(3).max(8),
  tone: SectorToneSchema,
  hashtags: SectorHashtagsSchema,
  bestPostingTimes: z.array(PostingTimeSchema).min(1).max(7),
  cadence: SectorCadenceSchema,
  backgroundStyle: BackgroundStyleSchema,
  /** Legal or ethical red lines — never claim these. */
  forbidden: z.array(z.string().min(1).max(200)).min(1).max(10),
  seasonalHooks: z.array(SeasonalHookSchema).max(20).optional(),
});
export type SectorDefinition = z.infer<typeof SectorDefinitionSchema>;

/**
 * Pillar weights are meant to partition the month, so they must sum to 1. Float
 * addition makes an exact comparison unsafe — a cent of tolerance is plenty
 * given weights are authored to two decimals.
 */
export const PILLAR_WEIGHT_TOLERANCE = 0.001;

export function pillarWeightSum(pillars: readonly ContentPillar[]): number {
  return pillars.reduce((total, pillar) => total + pillar.weight, 0);
}

export function hasValidPillarWeights(pillars: readonly ContentPillar[]): boolean {
  return Math.abs(pillarWeightSum(pillars) - 1) <= PILLAR_WEIGHT_TOLERANCE;
}
