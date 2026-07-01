# Revision Learning Workflow

## Purpose
Learn from the user's approvals, rejections and revision notes.

## Steps
1. **Capture Feedback** — Collect from approval/rejection actions
2. **Classify Feedback** — Type: copy, layout, color, logo, visual, typography, tone (`revision-learning`)
3. **Update Memory** — Add new rules to RevisionMemory (`revision-learning`)
4. **Update Approval Bias** — Track what gets approved vs rejected
5. **Adjust DNA** — Update DesignDNA rules based on patterns (`revision-learning`)
6. **Review Changes ⛔** — User confirms learned rules
7. **Save Changes** — Store to database
8. **Log Changelog** — Record preference changes

## Required Skills
`revision-learning` · `approval-gate` · `model-routing`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| RevisionMemory | JSON | `revision_feedback` table |
| DNA recommendations | JSON | DesignDNA updates |
| Prompt improvements | JSON | Client-specific modifiers |
