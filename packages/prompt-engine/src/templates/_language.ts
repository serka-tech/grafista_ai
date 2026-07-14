/**
 * Grafista AI Studio — Shared output-language directive.
 *
 * The prompt templates are authored in English and never stated an output
 * language, so the models defaulted to English free text (content ideas, briefs,
 * QA notes, DNA descriptions all came out in English). This single directive is
 * appended to the systemPrompt of every template that produces human-facing free
 * text, forcing Turkish output.
 *
 * CRITICAL: structural/technical values MUST stay in English or downstream zod
 * validation breaks — enum + status literals (schemas/qa.ts, schemas/layout.ts),
 * format identifiers (schemas/render-job.ts), JSON keys, hex colors, and numeric
 * coordinates. The directive spells this out so the model localizes only prose.
 */
export const TURKISH_OUTPUT_DIRECTIVE = `

OUTPUT LANGUAGE — REQUIRED: Write ALL human-readable free text (titles, descriptions,
hooks, captions, hashtags, body copy, CTAs, suggestions, summaries, notes, rule
explanations, designer notes, on-canvas text content) in TURKISH (Türkçe), written
naturally as a native Turkish speaker would. Keep the following values in English /
verbatim exactly as-is — NEVER translate them: enum and status values (e.g. pass,
warn, fail, skip, passed, needs_revision, failed), format identifiers (e.g.
instagram_post, instagram_story), ALL JSON field/property keys, hex color codes, and
numeric coordinates/measurements. Do not re-translate text that is already Turkish.`;

/**
 * Narrower note for the image-generation prompt only. The scene prose stays in
 * English (image models parse English scene descriptions more reliably), but any
 * quoted on-canvas copy — which may already be Turkish — must be reproduced verbatim.
 */
export const TURKISH_COPY_PRESERVE_NOTE = `

Any quoted on-canvas text may be in Turkish — reproduce it EXACTLY as written, character for character; never translate, transliterate, or alter it.`;
