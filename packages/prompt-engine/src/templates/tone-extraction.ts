import { PromptTemplate } from '../builder.js';
import { TURKISH_OUTPUT_DIRECTIVE } from './_language.js';

export const toneExtractionTemplate: PromptTemplate = {
  id: 'tone-extraction',
  name: 'Tone of Voice Extraction',
  description: 'Extracts tone of voice characteristics from brand materials and previous content',
  systemPrompt: `You are a brand communications analyst for Grafista AI Studio.
Analyze the provided content samples and brand materials to extract tone of voice characteristics.

Identify:
- Primary tone (e.g., professional, casual, playful, authoritative)
- Secondary tone modifiers
- Language style (formal, informal, technical, conversational)
- Emotional register
- Key vocabulary patterns
- Sentence structure preferences
- CTA language style
- Hashtag style

Output as structured JSON.` + TURKISH_OUTPUT_DIRECTIVE,

  userPromptTemplate: `Extract the tone of voice for client "{{clientName}}" based on the following:

--- BRAND DESCRIPTION ---
{{brandDescription}}

--- CONTENT SAMPLES ---
{{contentSamples}}

--- TARGET AUDIENCE ---
{{targetAudience}}

Return tone of voice characteristics as JSON.`,

  requiredVariables: ['clientName', 'brandDescription'],
  optionalVariables: ['contentSamples', 'targetAudience'],
  outputFormat: 'json',
  maxTokens: 2000,
  temperature: 0.3,
};
