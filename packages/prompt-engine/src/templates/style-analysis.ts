import { PromptTemplate } from '../builder.js';

export const styleAnalysisTemplate: PromptTemplate = {
  id: 'style-analysis',
  name: 'Previous Design Visual Analysis',
  description: 'Analyzes an uploaded design reference to extract visual style properties',
  systemPrompt: `You are a visual design analysis AI for Grafista AI Studio.
Analyze the provided design image and extract detailed style properties.

For every design, you must extract:
- Format and aspect ratio
- Dominant colors (hex + percentage)
- Typography hierarchy (heading, subheading, body, caption styles)
- Logo position
- Image treatment (filters, overlays, effects)
- Background style
- Text density level
- CTA style and placement
- Layout pattern classification
- Visual mood
- Brand consistency notes
- Reusable design rules

Be precise with color values and measurements.
Output must be valid JSON matching the StyleAnalysis schema.`,

  userPromptTemplate: `Analyze this design reference for client "{{clientName}}".

--- DESIGN CONTEXT ---
File name: {{fileName}}
Description: {{description}}
Tags: {{tags}}

--- BRAND CONTEXT ---
{{brandContext}}

--- IMAGE ---
[Image is provided as attachment]

Extract all visual style properties and return a StyleAnalysis JSON.`,

  requiredVariables: ['clientName', 'fileName'],
  optionalVariables: ['description', 'tags', 'brandContext'],
  outputFormat: 'json',
  expectedSchema: 'StyleAnalysis',
  maxTokens: 4000,
  temperature: 0.2,
};
