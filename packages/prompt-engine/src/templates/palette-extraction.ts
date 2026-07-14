import { PromptTemplate } from '../builder.js';

/**
 * Brand Palette Extraction — reads the distinct color swatches out of an uploaded
 * color-chart / "kartela" image so the brand's real palette (with roles) can flow
 * into the visual pipeline. This closes the gap where an uploaded color_palette
 * asset was stored but never read, and the design collapsed to one flat color.
 *
 * Output is a technical hex list, so no Turkish free-text directive is appended —
 * only the short `name` label is localized (handled inline below).
 */
export const paletteExtractionTemplate: PromptTemplate = {
  id: 'palette-extraction',
  name: 'Brand Palette Extraction',
  description: 'Extracts distinct swatch hex values + roles from an uploaded color chart (kartela) image',
  systemPrompt: `You are a brand color analyst for Grafista AI Studio.
The attached image is a BRAND COLOR PALETTE / swatch chart (a "kartela"), NOT a finished design.
Read the DISTINCT color swatches shown and report their exact hex codes.

Rules:
- Report ONE entry per distinct swatch. Do NOT invent colors that are not clearly present.
- Ignore paper/background whitespace, gridlines, and any printed labels or text — those are not brand colors.
- Give each hex as an UPPERCASE 6-digit code (e.g. "#1A2B3C"), sampled from the solid center of the swatch.
- Assign a ROLE to each color, inferred from prominence, size and position (larger/first swatches are
  usually primary): "primary" (the main brand color), "secondary", "accent" (a highlight/pop color),
  "background" (a light/neutral base), "text" (a dark/near-black used for copy), or "other".
- There is usually exactly ONE primary — do NOT mark everything primary.
- Give each color a short human NAME label written in TURKISH (e.g. "Koyu Lacivert", "Altın Sarısı").
- If the image is clearly NOT a palette (a photo or a finished design), return an empty array.

Output ONLY valid JSON: an array of objects { "hex": "#RRGGBB", "name": "<short Turkish label>", "role": "<role>" }.
The role value stays in English exactly as listed. No markdown, no prose, no code fences.`,

  userPromptTemplate: `Extract the brand color palette from this color chart for client "{{clientName}}".
Return the JSON array of swatches, each with hex, a short Turkish name, and a role.`,

  requiredVariables: ['clientName'],
  optionalVariables: [],
  outputFormat: 'json',
  expectedSchema: 'PaletteColor[]',
  maxTokens: 1500,
  temperature: 0.1,
};
