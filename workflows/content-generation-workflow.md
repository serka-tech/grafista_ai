# Content Generation Workflow

## Purpose
Generate client-specific social media content ideas according to the client's brand profile and campaign goal.

## Trigger
- "Generate Content" button on Content Generator page
- New campaign creation

## Steps

### Step 1: Select Client
- User selects client from dashboard

### Step 2: Enter Campaign Details
- Campaign goal, platform, format, target audience, mood, topic

### Step 3: Load Brand Context
- **System** loads: BrandProfile, DesignDNA, past approved content, RevisionMemory

### Step 4: Generate Content Ideas
- **AI Task** — `content-strategy` + `model-routing`
- Generates multiple distinct ideas with full brand context
- Each idea includes: title, description, hook, visual direction, AI image prompt

### Step 5: Generate Copy
- **AI Task** — `content-strategy`
- Generates: captions, headlines, CTA options, visual directions per idea

### Step 6: Present Options
- Show all options to user with brand alignment scores

### Step 7: User Approval ⛔ APPROVAL GATE
- **Skill:** `approval-gate`
- Approve / Reject / Request Revision per idea
- On reject: apply revision-learning, optionally regenerate

### Step 8: Learn From Feedback
- **Skill:** `revision-learning`
- Process rejection reasons into learned rules
- Condition: only if rejections exist

### Step 9: Save Approved Content
- Save to `content_ideas` table linked to client

## Required Skills
`content-strategy` · `approval-gate` · `revision-learning` · `model-routing`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| ContentIdea[] | JSON[] | `content_ideas` table |
| Captions | String[] | Within ContentIdea |
| Headline options | String[] | Within ContentIdea |
| Approved content record | JSON | `approvals` table |

## Next Workflow
→ `design-brief-workflow`
