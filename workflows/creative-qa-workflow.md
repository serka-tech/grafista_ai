# Creative QA Workflow

## Purpose
Review every generated design before final approval — 9-point quality check.

## Steps
1. **Brand Consistency** — Colors, fonts, personality match
2. **Logo Check** — Usage, safe area compliance
3. **Typography Check** — Heading/body/caption hierarchy
4. **Spelling Check** — All text elements
5. **Mobile Readability** — Font sizes, contrast on small screens
6. **Visual Hierarchy** — Eye flow, focal points, CTA prominence
7. **DNA Comparison** — Match against client DesignDNA (`style-analysis`)
8. **Generate Score** — Overall 0-100 score from all checks
9. **Revision Recommendations** — If score < 80, specific fixes
10. **Learn Patterns** — Feed results into revision learning (`revision-learning`)
11. **User Approval ⛔** — Final approval if score ≥ 50

## Scoring
- **≥ 80:** Passed — ready for delivery
- **50-79:** Needs Revision — approvable with warnings
- **< 50:** Failed — must fix before approval

## Required Skills
`creative-director-qa` · `style-analysis` · `approval-gate` · `revision-learning`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| CreativeQAReport | JSON | Database |
| Revision recommendations | JSON[] | Brief metadata |
| Final approval status | String | `approvals` table |
