# Layout Generation Workflow

## Purpose
Create a structured layout plan for the approved design brief.

## Steps
1. **Load Brief** — Load approved DesignBrief
2. **Generate Layouts** — AI creates 2-3 LayoutPlan alternatives: canvas size, grid, safe zones, text boxes, visual masks, logo area, CTA area, layer order (`layout-generation`)
3. **QA Check** — Run creative QA on each alternative (`creative-director-qa`)
4. **Present Alternatives** — Show layouts with QA scores to user
5. **User Approval ⛔** — User selects and approves one layout
6. **Save Layout** — Store approved LayoutPlan in database

## Required Skills
`layout-generation` · `approval-gate` · `creative-director-qa` · `model-routing`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| LayoutPlan[] | JSON[] | Alternatives |
| Selected LayoutPlan | JSON | Database |
| Preview instructions | JSON | Brief metadata |

## Next Workflow → `visual-generation-workflow`
