/**
 * Grafista AI Studio — Design DNA & Per-Reference Style Analysis (Phase 2 Step 4)
 *
 * Two related tables, one file (mirrors the design-references.ts repo style —
 * plain pool.query + a mapRow per table + an exported const object of async
 * functions). node-postgres auto-parses JSONB columns into JS objects/arrays,
 * so reads never need JSON.parse; writes still JSON.stringify() JSONB values
 * explicitly (same convention as design-references.ts / design-briefs.ts).
 */

import { pool } from '../pool.js';
import type { DesignDNA, DesignDNAStatus, StyleAnalysis } from '@grafista/schemas';

type DominantColor = StyleAnalysis['dominantColors'][number];
type TypographyHierarchy = StyleAnalysis['typographyHierarchy'];

type VisualRule = DesignDNA['visualRules'][number];
type TypographyRule = DesignDNA['typographyRules'][number];
type ColorUsageRule = DesignDNA['colorUsageRules'][number];
type LogoUsageRule = DesignDNA['logoUsageRules'][number];
type ImageTreatmentRule = DesignDNA['imageTreatmentRules'][number];
type ContentTone = DesignDNA['contentTone'];
type ApprovalBias = DesignDNA['approvalBias'];
type RecommendedPromptStyle = DesignDNA['recommendedPromptStyle'];
type PreferredLayouts = DesignDNA['preferredLayouts'];

// ─── Per-reference Style Analysis (design_analysis table) ──────────────────

function mapAnalysisRow(row: Record<string, unknown>): StyleAnalysis {
  return {
    id: row.id as string,
    designReferenceId: row.design_reference_id as string,
    format: (row.format as string) ?? '',
    aspectRatio: (row.aspect_ratio as string) ?? '',
    dominantColors: (row.dominant_colors as DominantColor[]) ?? [],
    typographyHierarchy: (row.typography_hierarchy as TypographyHierarchy) ?? {},
    logoPosition: (row.logo_position as StyleAnalysis['logoPosition']) ?? undefined,
    imageTreatment: (row.image_treatment as string) ?? undefined,
    backgroundStyle: (row.background_style as string) ?? undefined,
    textDensity: (row.text_density as StyleAnalysis['textDensity']) ?? undefined,
    ctaStyle: (row.cta_style as string) ?? undefined,
    layoutPattern: (row.layout_pattern as StyleAnalysis['layoutPattern']) ?? undefined,
    visualMood: (row.visual_mood as StyleAnalysis['visualMood']) ?? undefined,
    brandConsistencyNotes: (row.brand_consistency_notes as string) ?? undefined,
    reusableDesignRules: (row.reusable_design_rules as string[]) ?? [],
    designCategory: (row.design_category as StyleAnalysis['designCategory']) ?? undefined,
    confidence: row.confidence != null ? Number(row.confidence) : 0.5,
    analyzedAt: (row.analyzed_at as Date).toISOString(),
  };
}

export const designAnalysisRepo = {
  /**
   * Persists one validated per-reference StyleAnalysis. `id` and `analyzed_at` are
   * intentionally NOT accepted here — they default in the schema (uuid_generate_v4(),
   * NOW()); the id/analyzedAt used to satisfy StyleAnalysisSchema validation upstream
   * are placeholders for shape-checking only, the DB-generated values are the real ones
   * (returned via RETURNING *).
   */
  async create(data: {
    designReferenceId: string;
    format: string;
    aspectRatio: string;
    dominantColors: DominantColor[];
    typographyHierarchy: TypographyHierarchy;
    logoPosition?: string;
    imageTreatment?: string;
    backgroundStyle?: string;
    textDensity?: string;
    ctaStyle?: string;
    layoutPattern?: string;
    visualMood?: string;
    brandConsistencyNotes?: string;
    reusableDesignRules: string[];
    designCategory?: string;
    confidence: number;
  }): Promise<StyleAnalysis> {
    const { rows } = await pool.query(
      `INSERT INTO design_analysis (
         design_reference_id, format, aspect_ratio, dominant_colors, typography_hierarchy,
         logo_position, image_treatment, background_style, text_density, cta_style,
         layout_pattern, visual_mood, brand_consistency_notes, reusable_design_rules,
         design_category, confidence
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        data.designReferenceId,
        data.format,
        data.aspectRatio,
        JSON.stringify(data.dominantColors),
        JSON.stringify(data.typographyHierarchy),
        data.logoPosition ?? null,
        data.imageTreatment ?? null,
        data.backgroundStyle ?? null,
        data.textDensity ?? null,
        data.ctaStyle ?? null,
        data.layoutPattern ?? null,
        data.visualMood ?? null,
        data.brandConsistencyNotes ?? null,
        JSON.stringify(data.reusableDesignRules),
        data.designCategory ?? null,
        data.confidence,
      ]
    );
    return mapAnalysisRow(rows[0]);
  },

  /** All per-reference analyses for a client, joined through design_references. Used by the
   * "list per-reference analyses" GET route — returns [] (not a 404) when none exist yet. */
  async listByClientReferences(clientId: string): Promise<StyleAnalysis[]> {
    const { rows } = await pool.query(
      `SELECT da.* FROM design_analysis da
       JOIN design_references dr ON dr.id = da.design_reference_id
       WHERE dr.client_id = $1
       ORDER BY da.analyzed_at ASC`,
      [clientId]
    );
    return rows.map(mapAnalysisRow);
  },
};

// ─── Aggregated Design DNA (design_dna table) ───────────────────────────────

function mapDnaRow(row: Record<string, unknown>): DesignDNA {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    version: Number(row.version),
    status: row.status as DesignDNAStatus,
    brandPersonality: (row.brand_personality as string[]) ?? [],
    preferredLayouts: (row.preferred_layouts as PreferredLayouts) ?? [],
    visualRules: (row.visual_rules as VisualRule[]) ?? [],
    typographyRules: (row.typography_rules as TypographyRule[]) ?? [],
    colorUsageRules: (row.color_usage_rules as ColorUsageRule[]) ?? [],
    logoUsageRules: (row.logo_usage_rules as LogoUsageRule[]) ?? [],
    imageTreatmentRules: (row.image_treatment_rules as ImageTreatmentRule[]) ?? [],
    contentTone: (row.content_tone as ContentTone) ?? { primary: 'unspecified', keywords: [], examples: [] },
    avoidList: (row.avoid_list as string[]) ?? [],
    approvalBias: (row.approval_bias as ApprovalBias | null) ?? undefined,
    recommendedPromptStyle: (row.recommended_prompt_style as RecommendedPromptStyle | null) ?? undefined,
    confidenceScore: row.confidence_score != null ? Number(row.confidence_score) : undefined,
    referencesUsed: (row.references_used as string[]) ?? [],
    sourceAnalysisCount: Number(row.source_analysis_count ?? 0),
    approvedBy: (row.approved_by as string) ?? undefined,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : undefined,
    revisionNotes: (row.revision_notes as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    lastUpdatedAt: (row.last_updated_at as Date).toISOString(),
  };
}

export const designDnaRepo = {
  /**
   * Inserts a new client-level DesignDNA version. `id` is server-generated (uuid, passed
   * in by the caller — same convention as design-references/design-briefs creates).
   * `version` is computed atomically in-query as `1 + current max version for this
   * client` (0 base when none exist yet) via a CTE, so it never needs a separate
   * SELECT round-trip; the (client_id, version) UNIQUE index is a backstop against races.
   */
  async create(data: {
    id: string;
    clientId: string;
    status: DesignDNAStatus;
    brandPersonality: string[];
    preferredLayouts: PreferredLayouts;
    visualRules: VisualRule[];
    typographyRules: TypographyRule[];
    colorUsageRules: ColorUsageRule[];
    logoUsageRules: LogoUsageRule[];
    imageTreatmentRules: ImageTreatmentRule[];
    contentTone: ContentTone;
    avoidList: string[];
    approvalBias?: ApprovalBias;
    recommendedPromptStyle?: RecommendedPromptStyle;
    confidenceScore?: number;
    referencesUsed: string[];
    sourceAnalysisCount: number;
  }): Promise<DesignDNA> {
    const { rows } = await pool.query(
      `WITH next_version AS (
         SELECT COALESCE(MAX(version), 0) + 1 AS v FROM design_dna WHERE client_id = $2
       )
       INSERT INTO design_dna (
         id, client_id, version, status, brand_personality, preferred_layouts, visual_rules,
         typography_rules, color_usage_rules, logo_usage_rules, image_treatment_rules,
         content_tone, avoid_list, approval_bias, recommended_prompt_style, confidence_score,
         references_used, source_analysis_count
       )
       SELECT $1, $2, next_version.v, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
       FROM next_version
       RETURNING *`,
      [
        data.id,
        data.clientId,
        data.status,
        JSON.stringify(data.brandPersonality),
        JSON.stringify(data.preferredLayouts),
        JSON.stringify(data.visualRules),
        JSON.stringify(data.typographyRules),
        JSON.stringify(data.colorUsageRules),
        JSON.stringify(data.logoUsageRules),
        JSON.stringify(data.imageTreatmentRules),
        JSON.stringify(data.contentTone),
        JSON.stringify(data.avoidList),
        data.approvalBias ? JSON.stringify(data.approvalBias) : null,
        data.recommendedPromptStyle ? JSON.stringify(data.recommendedPromptStyle) : null,
        data.confidenceScore ?? null,
        JSON.stringify(data.referencesUsed),
        data.sourceAnalysisCount,
      ]
    );
    return mapDnaRow(rows[0]);
  },

  /** Latest version (any status) for a client — used by GET /design-dna and re-analysis version bumps. */
  async getLatestByClientId(clientId: string): Promise<DesignDNA | undefined> {
    const { rows } = await pool.query(
      'SELECT * FROM design_dna WHERE client_id = $1 ORDER BY version DESC LIMIT 1',
      [clientId]
    );
    return rows[0] ? mapDnaRow(rows[0]) : undefined;
  },

  /** Latest *approved* version for a client — used by content-ideas prompt building. */
  async getApprovedByClientId(clientId: string): Promise<DesignDNA | undefined> {
    const { rows } = await pool.query(
      `SELECT * FROM design_dna WHERE client_id = $1 AND status = 'approved'
       ORDER BY version DESC LIMIT 1`,
      [clientId]
    );
    return rows[0] ? mapDnaRow(rows[0]) : undefined;
  },

  /** Any row exists for this client, any status — matches the old in-memory hasForClient semantics. */
  async hasForClient(clientId: string): Promise<boolean> {
    const { rows } = await pool.query('SELECT 1 FROM design_dna WHERE client_id = $1 LIMIT 1', [clientId]);
    return rows.length > 0;
  },

  /**
   * Batched form of hasForClient for list endpoints — one query instead of one
   * round trip per client (GET /api/clients previously did N sequential
   * hasForClient() calls via Promise.all, one per row; as a test/dev database
   * accumulates more client rows over time, that N+1 pattern scales query
   * count — and DB pool connection checkouts — directly with total client
   * count instead of staying constant per request).
   */
  async hasForClientIds(clientIds: string[]): Promise<Set<string>> {
    if (clientIds.length === 0) return new Set();
    const { rows } = await pool.query<{ client_id: string }>(
      'SELECT DISTINCT client_id FROM design_dna WHERE client_id = ANY($1)',
      [clientIds]
    );
    return new Set(rows.map((r) => r.client_id));
  },

  /**
   * Approves the given DNA version. Only succeeds from 'generated' or 'waiting_for_approval'
   * ('draft' isn't approvable — nothing was generated yet; 'approved' is already terminal for
   * this transition; approving out of 'needs_revision' should go through a fresh analysis run
   * first). Returns undefined (→ 409 in the route) if no row matched.
   */
  async approve(id: string, approvedBy: string): Promise<DesignDNA | undefined> {
    const { rows } = await pool.query(
      `UPDATE design_dna
       SET status = 'approved', approved_by = $2, approved_at = NOW(), last_updated_at = NOW()
       WHERE id = $1 AND status IN ('generated', 'waiting_for_approval')
       RETURNING *`,
      [id, approvedBy]
    );
    return rows[0] ? mapDnaRow(rows[0]) : undefined;
  },

  /**
   * Requests revision on the given DNA version. Design decision: approved DNA CAN still be
   * sent back for revision (e.g. a client's brand shifts after approval and the DNA needs
   * rework) — the only status this is refused from is 'draft', which has no real generated
   * content to revise in the first place. Returns undefined (→ 409 in the route) if no row
   * matched (e.g. the row is still in 'draft').
   */
  async requestRevision(id: string, notes?: string): Promise<DesignDNA | undefined> {
    const { rows } = await pool.query(
      `UPDATE design_dna
       SET status = 'needs_revision', revision_notes = $2, last_updated_at = NOW()
       WHERE id = $1 AND status != 'draft'
       RETURNING *`,
      [id, notes ?? null]
    );
    return rows[0] ? mapDnaRow(rows[0]) : undefined;
  },
};
