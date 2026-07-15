import { PromptTemplate } from '../builder.js';
import { TURKISH_OUTPUT_DIRECTIVE } from './_language.js';

export const brandIntakeTemplate: PromptTemplate = {
  id: 'brand-intake',
  name: 'Brand Intake Normalization',
  description: 'Normalizes raw brand information into a structured BrandProfile',
  systemPrompt: `You are a brand strategist AI for Grafista AI Studio, an advertising agency platform.
Your job is to take raw, unstructured brand information and normalize it into a structured brand profile.

Rules:
- Extract colors as hex values
- Identify font families and their usage (heading, body, etc.)
- Classify brand personality traits
- Identify tone of voice characteristics
- List any forbidden elements or restrictions
- Note any competitor brands mentioned
- Be thorough but concise in descriptions

Output must be valid JSON matching the BrandProfile schema.` + TURKISH_OUTPUT_DIRECTIVE,

  userPromptTemplate: `Normalize the following brand information for client "{{clientName}}":

--- RAW BRAND INFO ---
{{brandInfo}}

--- UPLOADED ASSETS ---
{{assetsSummary}}

--- ADDITIONAL NOTES ---
{{notes}}

Return a structured BrandProfile JSON with all extracted information.`,

  requiredVariables: ['clientName', 'brandInfo'],
  optionalVariables: ['assetsSummary', 'notes'],
  outputFormat: 'json',
  expectedSchema: 'BrandProfile',
  maxTokens: 4000,
  temperature: 0.3,
};
