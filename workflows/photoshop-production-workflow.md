# Photoshop Production Workflow

## Purpose
Prepare editable Photoshop production based on the approved LayoutPlan.

## Steps
1. **Load Layout** — Load approved LayoutPlan
2. **Send to Photoshop** — Send layer instructions to UXP worker (`photoshop-automation`)
3. **Create PSD** — Generate editable PSD with named layers, logo, text, assets, masks, effects
4. **Export Preview** — Generate PNG/JPG preview
5. **Return URLs** — PSD + preview URLs to dashboard
6. **QA Check** — Full creative QA on preview (`creative-director-qa`)
7. **User Approval ⛔** — Present PSD preview + QA report

## Required Skills
`photoshop-automation` · `creative-director-qa` · `approval-gate`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| Editable PSD | File | Object storage |
| Preview PNG/JPG | File | Object storage |
| Export report | JSON | `generated_outputs` table |

## Note
Phase 2 feature — currently returns `not_implemented` with LayoutPlan JSON for manual production.

## Next Workflow → `creative-qa-workflow`
