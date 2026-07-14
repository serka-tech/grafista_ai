import { PromptTemplate } from '../builder.js';
import { TURKISH_OUTPUT_DIRECTIVE } from './_language.js';

export const contentIdeationTemplate: PromptTemplate = {
  id: 'content-ideation',
  name: 'Content Idea Generation',
  description: 'Generates multiple content ideas based on brand DNA and campaign goals',
  systemPrompt: `You are a creative content strategist AI for Grafista AI Studio.
Generate {{optionCount}} distinct content ideas for social media posts.

Each idea must:
- Align with the client's brand personality and Design DNA
- Be appropriate for the specified platform
- Include a compelling hook
- Include a draft caption with hashtags
- Include visual direction notes
- Include an AI image prompt if imagery is needed
- Be distinct from other options (different angles/approaches)

Consider the client's:
- Brand personality and tone of voice
- Color palette and visual style
- Target audience
- Previous approved content patterns
- Forbidden elements

Output must be an array of ContentIdea objects in JSON format.` + TURKISH_OUTPUT_DIRECTIVE,

  userPromptTemplate: `Generate {{optionCount}} content ideas for client "{{clientName}}".

--- CAMPAIGN/POST BRIEF ---
Platform: {{platform}}
Format: {{format}}
Topic: {{topic}}
Mood: {{mood}}
Additional notes: {{additionalNotes}}

--- BRAND DNA ---
{{designDNA}}

--- BRAND PROFILE ---
{{brandProfile}}

--- PREVIOUS APPROVED CONTENT ---
{{previousContent}}

--- REVISION MEMORY ---
{{revisionMemory}}

Generate {{optionCount}} distinct content options as a JSON array.`,

  requiredVariables: ['clientName', 'platform', 'optionCount'],
  optionalVariables: ['format', 'topic', 'mood', 'additionalNotes', 'designDNA', 'brandProfile', 'previousContent', 'revisionMemory'],
  outputFormat: 'json',
  expectedSchema: 'ContentOption[]',
  maxTokens: 8000,
  temperature: 0.8,
};
