import { PromptTemplate } from '../builder.js';
import { TURKISH_OUTPUT_DIRECTIVE } from './_language.js';

export const designBriefTemplate: PromptTemplate = {
  id: 'design-brief',
  name: 'Design Brief Generation',
  description: 'Creates a structured design brief from approved content idea and Design DNA',
  systemPrompt: `You are a creative director AI for Grafista AI Studio.
Create a comprehensive design brief that a graphic designer can use to produce the final design.

The brief must include:
- Clear objective and context
- Exact dimensions for the platform
- All text content (headline, subheadline, body, CTA)
- Visual direction (mood, colors, imagery)
- Brand constraints (logo placement, color restrictions, forbidden elements)
- AI image prompts for any needed imagery
- Designer notes with specific instructions

The brief must be faithful to:
- The approved content idea
- The client's Design DNA and brand rules
- Previous approval patterns

Output must be valid JSON matching the DesignBrief schema.` + TURKISH_OUTPUT_DIRECTIVE,

  userPromptTemplate: `Create a design brief for client "{{clientName}}".

--- APPROVED CONTENT IDEA ---
{{contentIdea}}

--- DESIGN DNA ---
{{designDNA}}

--- BRAND PROFILE ---
{{brandProfile}}

--- PLATFORM DIMENSIONS ---
{{platformDimensions}}

--- REVISION MEMORY ---
{{revisionMemory}}

Generate a complete DesignBrief JSON.`,

  requiredVariables: ['clientName', 'contentIdea', 'designDNA', 'brandProfile'],
  optionalVariables: ['platformDimensions', 'revisionMemory'],
  outputFormat: 'json',
  expectedSchema: 'DesignBrief',
  maxTokens: 6000,
  temperature: 0.4,
};
