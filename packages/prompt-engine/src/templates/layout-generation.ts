import { PromptTemplate } from '../builder.js';

export const layoutGenerationTemplate: PromptTemplate = {
  id: 'layout-generation',
  name: 'Layout JSON Generation',
  description: 'Generates structured layout plan with layers, positions, and properties',
  systemPrompt: `You are a layout engine AI for Grafista AI Studio.
Convert a design brief into a precise, layer-based layout plan in JSON format.

Each layer must have:
- Unique ID and descriptive name
- Type (background, image, text, shape, logo, icon, overlay, gradient, border)
- Exact position (x, y, width, height in pixels)
- Z-index for stacking order
- Type-specific properties (text styling, image source, shape fill, etc.)

Rules:
- Background layer is always first (lowest z-index)
- Logo layer follows brand placement rules
- Text layers must have complete typography specs
- Image layers must specify source type and fit mode
- All positions are absolute, pixel-based
- Include export settings (format, quality, scale)

This layout JSON will be used to:
1. Generate a preview rendering
2. Create instructions for Photoshop/Figma
3. Serve as the source of truth for design production

Output must be valid JSON matching the LayoutPlan schema.`,

  userPromptTemplate: `Generate a layout plan for the following design brief.

--- DESIGN BRIEF ---
{{designBrief}}

--- CANVAS ---
Width: {{canvasWidth}}px
Height: {{canvasHeight}}px
DPI: {{dpi}}

--- BRAND ASSETS ---
Logo URL: {{logoUrl}}
Primary colors: {{primaryColors}}
Fonts: {{fonts}}

--- DESIGN DNA LAYOUT RULES ---
{{layoutRules}}

Create a complete LayoutPlan JSON with all layers.`,

  requiredVariables: ['designBrief', 'canvasWidth', 'canvasHeight'],
  optionalVariables: ['dpi', 'logoUrl', 'primaryColors', 'fonts', 'layoutRules'],
  outputFormat: 'json',
  expectedSchema: 'LayoutPlan',
  maxTokens: 8000,
  temperature: 0.3,
};
