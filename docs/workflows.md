# Grafista AI Studio — Workflows

## Main Workflow: Client Content Production

```
Step 1: Create/Select Client
         ↓
Step 2: Upload Brand Assets (logo, colors, fonts, rules)
         ↓
Step 3: Upload Previous Approved Designs (PNG/JPG)
         ↓
Step 4: System Analyzes → Creates Design DNA
         ↓
Step 5: User Requests Content Ideas (platform, topic)
         ↓
Step 6: AI Generates Multiple Content Options
         ↓
Step 7: User Approves One Content Option
         ↓ ── APPROVAL GATE ──
Step 8: System Creates Structured Design Brief
         ↓
Step 9: System Generates Layout Instructions + AI Image Prompts
         ↓
Step 10: System Produces Preview-Ready Design Plan
         ↓
[Phase 2] Connect Photoshop UXP → Generate PSD
```

## Workflow 1: Client Onboarding

1. Navigate to Clients page
2. Click "Add Client"
3. Enter: name, industry, website, contact info
4. Client created with `active` status

## Workflow 2: Brand Setup

1. Select client → Brand Assets page
2. Upload logo files (PNG/SVG)
3. Define color palette (hex values + usage)
4. Specify fonts (heading, body, accent)
5. Add brand rules (required, forbidden, preferred)
6. System normalizes into BrandProfile

## Workflow 3: Design DNA Generation

1. Select client → Reference Library
2. Upload 3+ previous approved designs
3. Navigate to Design DNA page
4. Click "Run Analysis"
5. System analyzes each reference → StyleAnalysis
6. Synthesizes all analyses → DesignDNA
7. Review: brand personality, layout preferences, visual rules, typography, colors, avoid list

## Workflow 4: Content Generation

1. Select client → Content Generator
2. Choose platform (Instagram, Facebook, Twitter, etc.)
3. Optionally set: topic, campaign name, mood
4. Click "Generate Ideas" → 3 options created
5. Review each option: hook, caption, visual direction
6. Approve best option → status becomes `approved`

## Workflow 5: Design Brief Creation

1. From an approved content idea → "Create Design Brief"
2. System generates structured brief:
   - Exact dimensions for platform
   - Content elements (headline, caption, CTA)
   - Visual direction (mood, colors, imagery)
   - Brand constraints
   - AI image prompts
3. Review brief → run QA check → approve

## Workflow 6: Revision Learning

1. When rejecting an idea or brief, include revision notes
2. System extracts rules from feedback
3. Rules added to RevisionMemory
4. Future generations incorporate learned rules
5. Design DNA updated with high-confidence patterns
