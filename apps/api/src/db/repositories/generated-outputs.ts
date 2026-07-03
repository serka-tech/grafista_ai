/**
 * Grafista AI Studio — Generated Outputs (Phase 2 Step 7)
 *
 * Persists visual-generation outputs (AI image -> object storage -> row here)
 * for a layout plan that cleared the Creative QA production gate (see
 * ../../services/visual-generation.ts and ../../services/production-gate.ts).
 * Mirrors the layout-plans.ts / creative-qa.ts repo style — plain pool.query
 * + a mapRow, parameterized queries, node-postgres auto-parsing JSONB.
 *
 * Two independent status axes live on each row:
 *   * status ('pending' | 'generated' | 'failed') — production lifecycle of
 *     the FILE itself (provider + storage outcome, see updateStatus()).
 *   * approval_status ('pending' | 'approved' | 'rejected' |
 *     'revision_requested') — the human review decision on a successfully
 *     generated file (see approve()/reject()).
 */

import { pool } from '../pool.js';
import type { GeneratedOutput, GeneratedOutputStatus, OutputType } from '@grafista/schemas';

function mapRow(row: Record<string, unknown>): GeneratedOutput {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    designBriefId: row.design_brief_id as string,
    layoutPlanId: (row.layout_plan_id as string) ?? undefined,
    creativeQaReportId: (row.creative_qa_report_id as string) ?? undefined,

    type: row.type as OutputType,
    name: row.name as string,
    description: (row.description as string) ?? undefined,

    alternativeIndex: row.alternative_index != null ? Number(row.alternative_index) : undefined,

    status: row.status as GeneratedOutputStatus,
    errorMessage: (row.error_message as string) ?? undefined,

    fileUrl: (row.file_url as string) ?? undefined,
    previewUrl: (row.preview_url as string) ?? undefined,
    thumbnailUrl: (row.thumbnail_url as string) ?? undefined,
    mimeType: (row.mime_type as string) ?? undefined,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : undefined,

    storageProvider: (row.storage_provider as string) ?? undefined,
    storageBucket: (row.storage_bucket as string) ?? undefined,
    storageKey: (row.storage_key as string) ?? undefined,

    dimensions: (row.dimensions as GeneratedOutput['dimensions']) ?? undefined,

    generationMethod: row.generation_method as GeneratedOutput['generationMethod'],
    provider: (row.provider as string) ?? undefined,
    aiModel: (row.ai_model as string) ?? undefined,
    generationTimeMs: row.generation_time_ms != null ? Number(row.generation_time_ms) : undefined,
    promptSnapshot: (row.prompt_snapshot as string) ?? undefined,

    qaStatus: row.qa_status as GeneratedOutput['qaStatus'],
    approvalStatus: row.approval_status as GeneratedOutput['approvalStatus'],

    version: Number(row.version),
    parentOutputId: (row.parent_output_id as string) ?? undefined,

    createdBy: (row.created_by as string) ?? undefined,
    approvedBy: (row.approved_by as string) ?? undefined,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : undefined,

    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const generatedOutputsRepo = {
  /**
   * Persists one visual-generation output row. Callers create one row per generated
   * image alternative (sharing layoutPlanId/creativeQaReportId/provider/model/createdBy
   * and incrementing alternativeIndex — see runVisualGeneration()), including 'failed'
   * rows so failures stay visible instead of being swallowed.
   */
  async create(data: {
    id: string;
    clientId: string;
    designBriefId: string;
    layoutPlanId?: string;
    creativeQaReportId?: string;
    type: OutputType;
    name: string;
    description?: string;
    alternativeIndex?: number;
    status: GeneratedOutputStatus;
    errorMessage?: string;
    mimeType?: string;
    fileSizeBytes?: number;
    storageProvider?: string;
    storageBucket?: string;
    storageKey?: string;
    dimensions?: { width: number; height: number };
    generationMethod: GeneratedOutput['generationMethod'];
    provider?: string;
    aiModel?: string;
    generationTimeMs?: number;
    promptSnapshot?: string;
    createdBy: string;
  }): Promise<GeneratedOutput> {
    const { rows } = await pool.query(
      `INSERT INTO generated_outputs (
         id, client_id, design_brief_id, layout_plan_id, creative_qa_report_id,
         type, name, description, alternative_index, status, error_message,
         mime_type, file_size_bytes, storage_provider, storage_bucket, storage_key,
         dimensions, generation_method, provider, ai_model, generation_time_ms,
         prompt_snapshot, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        data.id,
        data.clientId,
        data.designBriefId,
        data.layoutPlanId ?? null,
        data.creativeQaReportId ?? null,
        data.type,
        data.name,
        data.description ?? null,
        data.alternativeIndex ?? null,
        data.status,
        data.errorMessage ?? null,
        data.mimeType ?? null,
        data.fileSizeBytes ?? null,
        data.storageProvider ?? null,
        data.storageBucket ?? null,
        data.storageKey ?? null,
        data.dimensions ? JSON.stringify(data.dimensions) : null,
        data.generationMethod,
        data.provider ?? null,
        data.aiModel ?? null,
        data.generationTimeMs ?? null,
        data.promptSnapshot ?? null,
        data.createdBy,
      ]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<GeneratedOutput | undefined> {
    const { rows } = await pool.query('SELECT * FROM generated_outputs WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** All generated outputs across all briefs/layout plans for a client. */
  async listByClient(clientId: string): Promise<GeneratedOutput[]> {
    const { rows } = await pool.query(
      'SELECT * FROM generated_outputs WHERE client_id = $1 ORDER BY created_at ASC, alternative_index ASC',
      [clientId]
    );
    return rows.map(mapRow);
  },

  /** All generated outputs for one design brief (across its layout plan alternatives). */
  async listByDesignBrief(designBriefId: string): Promise<GeneratedOutput[]> {
    const { rows } = await pool.query(
      'SELECT * FROM generated_outputs WHERE design_brief_id = $1 ORDER BY created_at ASC, alternative_index ASC',
      [designBriefId]
    );
    return rows.map(mapRow);
  },

  /** All generated outputs for one specific layout plan — the primary "review a batch" query. */
  async listByLayoutPlan(layoutPlanId: string): Promise<GeneratedOutput[]> {
    const { rows } = await pool.query(
      'SELECT * FROM generated_outputs WHERE layout_plan_id = $1 ORDER BY created_at ASC, alternative_index ASC',
      [layoutPlanId]
    );
    return rows.map(mapRow);
  },

  /**
   * Moves a row's production (file) status — e.g. an async worker finishing a
   * 'pending' row as 'generated' or 'failed'. errorMessage is stored when provided
   * and cleared otherwise (a successful retry must not keep a stale error).
   * Returns undefined (-> 404/409 in the route) if no row matched.
   */
  async updateStatus(
    id: string,
    status: GeneratedOutputStatus,
    errorMessage?: string
  ): Promise<GeneratedOutput | undefined> {
    const { rows } = await pool.query(
      `UPDATE generated_outputs SET status = $2, error_message = $3 WHERE id = $1 RETURNING *`,
      [id, status, errorMessage ?? null]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Approves the given output (human sign-off on the generated visual). Only succeeds
   * when the file was actually produced (status = 'generated') and the approval is
   * still open ('pending' or 'revision_requested' — mirrors the layout_plans.approve()
   * guard). Returns undefined (-> 409 in the route) if no row matched.
   */
  async approve(id: string, approvedBy: string): Promise<GeneratedOutput | undefined> {
    const { rows } = await pool.query(
      `UPDATE generated_outputs
       SET approval_status = 'approved', approved_by = $2, approved_at = NOW()
       WHERE id = $1 AND status = 'generated' AND approval_status IN ('pending', 'revision_requested')
       RETURNING *`,
      [id, approvedBy]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Rejects (or requests revision on) the given output — only from an open 'pending'
   * approval. notes provided -> 'revision_requested', otherwise -> 'rejected'
   * (mirrors the layout_plans.reject() pattern; notes land in description-level UX,
   * not a dedicated column, exactly like layout_plans). Returns undefined (-> 409 in
   * the route) if no row matched.
   */
  async reject(id: string, notes?: string): Promise<GeneratedOutput | undefined> {
    const newStatus = notes ? 'revision_requested' : 'rejected';
    const { rows } = await pool.query(
      `UPDATE generated_outputs SET approval_status = $2 WHERE id = $1 AND approval_status = 'pending' RETURNING *`,
      [id, newStatus]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
