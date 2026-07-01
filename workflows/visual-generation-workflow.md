# Visual Generation Workflow

## Purpose
Generate or edit supporting visuals for the design when required.

## Steps
1. **Check Existing** — Are client's existing visuals sufficient?
2. **Generate Prompts** — If needed, refine AI image/video prompts with brand context (`model-routing`)
3. **Route Generation** — Send to best provider: OpenAI DALL-E, KIE AI, or Higgsfield (`model-routing`)
4. **Brand Check** — Verify generated visuals match brand guidelines (`creative-director-qa`)
5. **Style Check** — Compare with DesignDNA style rules (`style-analysis`)
6. **User Approval ⛔** — Present alternatives with check results
7. **Save Visual** — Store approved visual to storage + database

## Required Skills
`model-routing` · `style-analysis` · `creative-director-qa` · `approval-gate`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| Generated assets | File[] | Object storage |
| Approved visual | File | `generated_outputs` table |
| Visual usage notes | JSON | Brief metadata |

## Next Workflow → `photoshop-production-workflow`
