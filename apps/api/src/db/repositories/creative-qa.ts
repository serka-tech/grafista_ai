/**
 * Grafista AI Studio — Creative QA Reports (Phase 2 Step 5B)
 *
 * Persists AI-generated CreativeQAReports for an approved LayoutPlan (see
 * ../../services/creative-qa.ts). Mirrors the layout-plans.ts repo style —
 * plain pool.query + a mapRow, parameterized queries, node-postgres
 * auto-parsing JSONB.
 *
 * The full validated + server-computed report content (scores, checks,
 * priority-tiered fixes, reasons, risks, etc.) is stored as one JSONB blob
 * (qa_json); score/pass_threshold are denormalized scalar columns pulled
 * from that same content at write time, for cheap querying/sorting without
 * unpacking JSONB. `recommendations` is stored twice by design: once inside
 * qa_json (as part of the full report shape) and once as its own top-level
 * JSONB column, for quick listing without parsing the full blob.
 */

import { pool } from '../pool.js';
import type { CreativeQAReport, CreativeQAReportStatus } from '@grafista/schemas';

/** Everything in CreativeQAReport except the relational ids/workflow/timestamps columns
 * that get their own SQL columns — this is exactly what's stored in qa_json. */
type CreativeQaStoredContent = Omit<
  CreativeQAReport,
  | 'id'
  | 'clientId'
  | 'designBriefId'
  | 'layoutPlanId'
  | 'designDnaId'
  | 'status'
  | 'provider'
  | 'model'
  | 'createdBy'
  | 'approvedBy'
  | 'approvedAt'
  | 'rejectedBy'
  | 'rejectedAt'
  | 'createdAt'
  | 'updatedAt'
>;

function mapRow(row: Record<string, unknown>): CreativeQAReport {
  const content = (row.qa_json as CreativeQaStoredContent) ?? ({} as CreativeQaStoredContent);
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    designBriefId: row.design_brief_id as string,
    layoutPlanId: row.layout_plan_id as string,
    designDnaId: (row.design_dna_id as string) ?? undefined,
    status: row.status as CreativeQAReportStatus,

    overallScore: row.score != null ? Number(row.score) : content.overallScore,
    overallStatus: content.overallStatus,
    passThreshold: row.pass_threshold != null ? Number(row.pass_threshold) : content.passThreshold,
    passed: content.passed,

    scores: content.scores,

    checks: content.checks ?? [],
    brandConsistency: content.brandConsistency,
    readability: content.readability,
    mobileLegibility: content.mobileLegibility,
    visualHierarchy: content.visualHierarchy,
    logoSafetyArea: content.logoSafetyArea,
    colorContrast: content.colorContrast,
    spelling: content.spelling,
    designDnaMatch: content.designDnaMatch,
    exportReadiness: content.exportReadiness,
    typographyConsistency: content.typographyConsistency,
    contentClarity: content.contentClarity,

    summary: content.summary,
    detectedIssues: content.detectedIssues ?? [],
    criticalIssues: content.criticalIssues ?? [],

    highPriorityFixes: content.highPriorityFixes ?? [],
    mediumPriorityFixes: content.mediumPriorityFixes ?? [],
    lowPriorityFixes: content.lowPriorityFixes ?? [],
    recommendations: (row.recommendations as string[]) ?? content.recommendations ?? [],

    designerNotes: content.designerNotes,
    finalRecommendation: content.finalRecommendation,
    designDnaReasons: content.designDnaReasons ?? [],
    designBriefReasons: content.designBriefReasons ?? [],
    risksBeforeProduction: content.risksBeforeProduction ?? [],

    canProceedToProduction: content.canProceedToProduction,

    provider: (row.provider as string) ?? undefined,
    model: (row.model as string) ?? undefined,
    createdBy: (row.created_by as string) ?? undefined,
    approvedBy: (row.approved_by as string) ?? undefined,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : undefined,
    rejectedBy: (row.rejected_by as string) ?? undefined,
    rejectedAt: row.rejected_at ? (row.rejected_at as Date).toISOString() : undefined,

    reviewedAt: content.reviewedAt,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const creativeQaReportsRepo = {
  /** Persists one validated + server-computed CreativeQAReport — see runCreativeQa(). */
  async create(data: {
    id: string;
    clientId: string;
    designBriefId: string;
    layoutPlanId: string;
    designDnaId?: string;
    status: CreativeQAReportStatus;
    score: number;
    passThreshold: number;
    provider: string;
    model: string;
    createdBy: string;
    content: CreativeQaStoredContent;
  }): Promise<CreativeQAReport> {
    const { rows } = await pool.query(
      `INSERT INTO creative_qa_reports (
         id, client_id, design_brief_id, layout_plan_id, design_dna_id, status, score,
         pass_threshold, provider, model, qa_json, recommendations, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        data.id,
        data.clientId,
        data.designBriefId,
        data.layoutPlanId,
        data.designDnaId ?? null,
        data.status,
        data.score,
        data.passThreshold,
        data.provider,
        data.model,
        JSON.stringify(data.content),
        JSON.stringify(data.content.recommendations ?? []),
        data.createdBy,
      ]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<CreativeQAReport | undefined> {
    const { rows } = await pool.query('SELECT * FROM creative_qa_reports WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** All Creative QA reports across all layout plans for a client. */
  async listByClient(clientId: string): Promise<CreativeQAReport[]> {
    const { rows } = await pool.query(
      'SELECT * FROM creative_qa_reports WHERE client_id = $1 ORDER BY created_at ASC',
      [clientId]
    );
    return rows.map(mapRow);
  },

  /** All Creative QA reports for one design brief (across its layout plan alternatives). */
  async listByDesignBrief(designBriefId: string): Promise<CreativeQAReport[]> {
    const { rows } = await pool.query(
      'SELECT * FROM creative_qa_reports WHERE design_brief_id = $1 ORDER BY created_at ASC',
      [designBriefId]
    );
    return rows.map(mapRow);
  },

  /** All Creative QA reports for one specific layout plan alternative. */
  async listByLayoutPlan(layoutPlanId: string): Promise<CreativeQAReport[]> {
    const { rows } = await pool.query(
      'SELECT * FROM creative_qa_reports WHERE layout_plan_id = $1 ORDER BY created_at ASC',
      [layoutPlanId]
    );
    return rows.map(mapRow);
  },

  /**
   * Approves the given Creative QA report. Only succeeds from 'generated', 'passed', or
   * 'failed' ('generated' is included defensively even though the service currently
   * always sets 'passed'/'failed' directly at creation, in case that ever changes).
   * Returns undefined (-> 409 in the route) if no row matched.
   */
  async approve(id: string, approvedBy: string): Promise<CreativeQAReport | undefined> {
    const { rows } = await pool.query(
      `UPDATE creative_qa_reports
       SET status = 'approved', approved_by = $2, approved_at = NOW()
       WHERE id = $1 AND status IN ('generated', 'passed', 'failed', 'needs_revision')
       RETURNING *`,
      [id, approvedBy]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Rejects (or requests revision on) the given Creative QA report — only from
   * 'generated', 'passed', or 'failed'. notes provided -> 'needs_revision', otherwise ->
   * 'rejected'. Unlike layout_plans.reject(), this table tracks rejected_by/rejected_at
   * explicitly. Returns undefined (-> 409 in the route) if no row matched.
   */
  async reject(id: string, rejectedBy: string, notes?: string): Promise<CreativeQAReport | undefined> {
    const newStatus = notes ? 'needs_revision' : 'rejected';
    const { rows } = await pool.query(
      `UPDATE creative_qa_reports
       SET status = $2, rejected_by = $3, rejected_at = NOW()
       WHERE id = $1 AND status IN ('generated', 'passed', 'failed')
       RETURNING *`,
      [id, newStatus, rejectedBy]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
