/**
 * Grafista AI Studio — Central Turkish enum label dictionary (dashboard)
 *
 * Single source of truth for turning raw schema enum values (platform, content
 * format, visual mood, render preset) into the Turkish labels the UI shows.
 * Previously each component either printed the raw enum ("instagram post",
 * "single image", "professional") or carried its own local dictionary; this
 * module centralizes them so every screen reads the same Turkish strings.
 *
 * Every lookup falls back to `prettify()` (title-cased, de-underscored) so a
 * brand-new enum value is never shown as a raw snake_case token.
 */

/** Title-cases a raw snake_case enum value as a last-resort fallback. */
export function prettify(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// PlatformEnum (packages/schemas/src/content.ts)
export const PLATFORM_LABELS: Record<string, string> = {
  instagram_post: 'Instagram Gönderisi',
  instagram_story: 'Instagram Hikayesi',
  instagram_reel: 'Instagram Reels',
  instagram_carousel: 'Instagram Karusel',
  facebook_post: 'Facebook Gönderisi',
  facebook_story: 'Facebook Hikayesi',
  twitter_post: 'Twitter/X Gönderisi',
  linkedin_post: 'LinkedIn Gönderisi',
  tiktok: 'TikTok',
  youtube_thumbnail: 'YouTube Kapak Görseli',
  youtube_short: 'YouTube Shorts',
  pinterest: 'Pinterest',
  email_header: 'E-posta Başlığı',
  web_banner: 'Web Banner',
  other: 'Diğer',
};

// ContentFormatEnum (packages/schemas/src/content.ts)
export const FORMAT_LABELS: Record<string, string> = {
  single_image: 'Tekli Görsel',
  carousel: 'Karusel',
  video: 'Video',
  story: 'Hikaye',
  reel: 'Reels',
  animated: 'Animasyonlu',
  text_only: 'Sadece Metin',
  infographic: 'İnfografik',
  other: 'Diğer',
};

// VisualMoodEnum (packages/schemas/src/design-dna.ts)
export const MOOD_LABELS: Record<string, string> = {
  energetic: 'Enerjik',
  calm: 'Sakin',
  luxurious: 'Lüks',
  playful: 'Eğlenceli',
  professional: 'Profesyonel',
  bold: 'Cesur',
  minimal: 'Minimal',
  organic: 'Organik',
  tech: 'Teknolojik',
  vintage: 'Vintage',
  modern: 'Modern',
  artistic: 'Sanatsal',
  corporate: 'Kurumsal',
  other: 'Diğer',
};

// RenderPresetEnum (packages/schemas/src/render-job.ts) — with dimensions.
export const RENDER_PRESET_LABELS: Record<string, string> = {
  instagram_post: 'Instagram Gönderisi (1080×1080)',
  instagram_story: 'Instagram Hikayesi (1080×1920)',
  landscape: 'Yatay (1920×1080)',
  ad_creative: 'Reklam Görseli (1200×628)',
};

export const platformLabel = (raw: string | undefined | null): string =>
  raw ? PLATFORM_LABELS[raw] ?? prettify(raw) : '—';
export const formatLabel = (raw: string | undefined | null): string =>
  raw ? FORMAT_LABELS[raw] ?? prettify(raw) : '—';
export const moodLabel = (raw: string | undefined | null): string =>
  raw ? MOOD_LABELS[raw] ?? prettify(raw) : '—';
export const renderPresetLabel = (raw: string | undefined | null): string =>
  raw ? RENDER_PRESET_LABELS[raw] ?? prettify(raw) : '—';
