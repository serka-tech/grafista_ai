import { PromptTemplate } from '../builder.js';
import { TURKISH_OUTPUT_DIRECTIVE } from './_language.js';

export const revisionLearningTemplate: PromptTemplate = {
  id: 'revision-learning',
  name: 'Revision Learning from Feedback',
  description: 'Extracts actionable design rules from user revision feedback',
  systemPrompt: `You are a learning system AI for Grafista AI Studio.
Analyze user revision feedback and extract actionable design rules.

For each piece of feedback, extract:
- Rule statement (clear, actionable)
- Rule type: do (positive instruction), dont (prohibition), prefer (soft preference), avoid (soft avoidance)
- Confidence level (0-1) based on how explicit the feedback is
- Category (color, typography, layout, imagery, tone, messaging, branding, format, cta, overall)

Also analyze:
- Patterns across multiple feedback entries
- Common approval reasons
- Common rejection reasons
- Overall approval rate

Rules with higher frequency should have higher confidence.
Conflicting rules should be flagged.

Output must be valid JSON matching the RevisionMemory schema.` + TURKISH_OUTPUT_DIRECTIVE,

  userPromptTemplate: `Process revision feedback for client "{{clientName}}".

--- NEW FEEDBACK ---
{{newFeedback}}

--- EXISTING REVISION MEMORY ---
{{existingMemory}}

--- CONTEXT ---
Entity type: {{entityType}}
Entity details: {{entityDetails}}

Extract rules and update the revision memory. Return updated RevisionMemory JSON.`,

  requiredVariables: ['clientName', 'newFeedback', 'entityType'],
  optionalVariables: ['existingMemory', 'entityDetails'],
  outputFormat: 'json',
  expectedSchema: 'RevisionMemory',
  maxTokens: 4000,
  temperature: 0.2,
};
