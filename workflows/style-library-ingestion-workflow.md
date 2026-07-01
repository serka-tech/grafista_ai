# Style Library Ingestion Workflow

## Purpose
Analyze previous approved designs and create a reusable design intelligence library.

## Trigger
- Upload of design references
- "Analyze References" button on Reference Library page

## Steps

### Step 1: Upload Design Previews
- **Type:** User Action
- **Action:** Upload previous approved designs as PNG/JPG
- **Minimum:** 3 references recommended

### Step 2: Upload PSD Files (Optional)
- **Type:** User Action
- **Action:** Optionally upload PSD files for deeper layer-level analysis

### Step 3: Extract Visual Metadata
- **Type:** System
- **Skill:** `style-analysis`
- **Action:** Extract dimensions, format, file info from each reference

### Step 4: AI Style Analysis
- **Type:** AI Task
- **Skill:** `style-analysis` + `model-routing`
- **Action:** Analyze each reference for: layout, colors, typography, logo usage, image treatment, CTA style, mood, composition
- **Output:** `StyleAnalysis[]` per reference

### Step 5: Group References
- **Type:** System
- **Skill:** `style-analysis`
- **Action:** Group by format (post/story/carousel) and campaign type
- **Output:** `layout-patterns.json`

### Step 6: Generate DesignDNA
- **Type:** AI Task
- **Skill:** `style-analysis` + `model-routing`
- **Action:** Synthesize all style analyses into unified DesignDNA
- **Output:** `design_dna_draft`

### Step 7: User Approval ⛔ APPROVAL GATE
- **Type:** Approval Gate
- **Skill:** `approval-gate`
- **On reject:** Apply revision-learning, return to Step 6

### Step 8: Learn From Corrections
- **Type:** AI Task
- **Skill:** `revision-learning`
- **Condition:** Only if user provided revision notes
- **Action:** Extract rules from corrections, update learning memory

### Step 9: Save Approved DNA
- **Type:** System
- **Condition:** `approved`
- **Action:** Save DesignDNA to database, link to client

## Required Skills
`style-analysis` · `approval-gate` · `revision-learning` · `model-routing`

## Outputs
| Output | Type | Storage |
|--------|------|---------|
| DesignDNA | JSON | `design_dna` table |
| Reference metadata | JSON[] | `design_references` table |
| layout-patterns.json | JSON | Client files |
| style-analysis.json | JSON[] | `design_analysis` table |

## Next Workflow
→ `content-generation-workflow`
