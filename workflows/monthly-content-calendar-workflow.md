# Monthly Content Calendar Workflow

## Purpose
Generate a monthly content plan for a selected client.

## Steps
1. **Select Client & Month** — User picks client and target month
2. **Load Context** — Brand profile, sector trends, past content, important dates, revision memory
3. **Generate Calendar** — AI creates monthly plan spread across weeks/platforms (`content-strategy`)
4. **Split by Format** — Organize: post, story, reels cover, carousel, campaign visual
5. **Generate Brief Previews** — Preview briefs for key items (`design-brief-generator`)
6. **User Approval ⛔** — Review and approve full calendar
7. **Learn From Edits** — Process rejections/edits (`revision-learning`)
8. **Create Production Queue** — Move approved items into production as content ideas

## Required Skills
`content-strategy` · `approval-gate` · `design-brief-generator` · `revision-learning`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| Monthly calendar | JSON | Client files |
| Production queue | JSON[] | `content_ideas` table |
| Approved content list | JSON[] | `content_ideas` table |

## Next Workflow → `content-generation-workflow` (per item)
