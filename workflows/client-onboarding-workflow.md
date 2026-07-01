# Client Onboarding Workflow

## Purpose
Create a new client profile, upload brand assets, normalize brand information, and generate the first BrandProfile.

## Trigger
- New client creation from dashboard
- "Onboard Client" action button

## Steps

### Step 1: Create Client Record
- **Type:** System
- **Action:** Create a new client record with name, industry, website, and contact info
- **Output:** `client_id`

### Step 2: Upload Brand Assets
- **Type:** User Action
- **Action:** User uploads logo files (PNG/SVG), defines color palette, specifies fonts, and enters brand notes/rules
- **Accepted formats:** PNG, SVG, JPG for logos; hex values for colors; font names with usage tags
- **Output:** `brand_asset_ids[]`

### Step 3: Validate Asset Formats
- **Type:** System
- **Skill:** `brand-intake`
- **Action:** Validate uploaded files — check format, size, and completeness
- **Output:** Validation report (pass/fail per asset)

### Step 4: Generate BrandProfile
- **Type:** AI Task
- **Skill:** `brand-intake` + `model-routing`
- **Action:** Use AI to normalize raw brand data into structured BrandProfile JSON
- **Includes:** Color normalization (hex), font classification (heading/body/accent), personality traits, tone-of-voice extraction, forbidden elements identification
- **Output:** `brand_profile_draft` (BrandProfile JSON)

### Step 5: Generate Brand Rules Documents
- **Type:** AI Task
- **Skill:** `brand-intake`
- **Action:** Generate human-readable `brand-rules.md` (required/preferred elements) and `forbidden-rules.md` (banned elements/styles)
- **Output:** Two markdown documents

### Step 6: User Approval ⛔ APPROVAL GATE
- **Type:** Approval Gate
- **Skill:** `approval-gate`
- **Action:** Present BrandProfile, brand-rules.md, and forbidden-rules.md to user
- **User options:** Approve / Reject with revision notes
- **On reject:** Return to Step 4 with revision notes incorporated

### Step 7: Save Approved Profile
- **Type:** System
- **Condition:** `approval_status === 'approved'`
- **Action:** Save final BrandProfile to database, link to client record
- **Output:** `brand_profile_id`

## Required Skills
- `brand-intake` — Normalizes raw brand data
- `approval-gate` — Manages approval flow
- `model-routing` — Routes AI tasks to best provider

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| BrandProfile | JSON | `brand_profiles` table |
| brand-rules.md | Markdown | Client files |
| forbidden-rules.md | Markdown | Client files |

## Failure Cases
- **No brand info:** Prompt user for minimum data (name + 1 color)
- **AI unavailable:** Fallback to manual template
- **Invalid assets:** Return validation error
- **User rejects:** Loop back with revision notes

## Next Workflow
→ `style-library-ingestion-workflow`
