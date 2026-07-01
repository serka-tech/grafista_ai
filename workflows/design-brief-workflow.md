# Design Brief Workflow

## Purpose
Convert approved content into a structured design brief.

## Trigger
- Approved content idea → "Create Design Brief" button

## Steps

1. **Load Approved Content** — Verify idea is `approved`, load all copy and visual direction
2. **Load Brand Context** — BrandProfile + DesignDNA
3. **Select References** — AI selects most relevant reference designs (skill: `style-analysis`)
4. **Generate Brief** — Structured DesignBrief with format, size, hierarchy, copy placement, logo placement, visual direction, export needs (skill: `design-brief-generator`)
5. **Generate AI Prompts** — If imagery needed, generate image prompts (conditional)
6. **User Approval ⛔** — Present brief for approval before production
7. **Save Brief** — Store in `design_briefs` table

## Required Skills
`design-brief-generator` · `style-analysis` · `approval-gate` · `model-routing`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| DesignBrief | JSON | `design_briefs` table |
| Selected references | JSON[] | Brief metadata |
| AI image prompts | JSON[] | Brief metadata (conditional) |

## Next Workflow
→ `layout-generation-workflow`
