/**
 * Grafista AI Studio — Layout Plans (Phase 2 Step 5A)
 *
 * Persists AI-generated LayoutPlan alternatives for an approved DesignBrief (see
 * ../services/layout-generation.ts). Mirrors the design-dna.ts repo style — plain
 * pool.query + a mapRow, parameterized queries, node-postgres auto-parsing JSONB.
 *
 * The full validated LayoutPlanContent (canvas, layers, gridStructure, safeZones,
 * placements, notes, exportSettings, referenceDesignIds, designDnaRulesUsed) is stored
 * as one JSONB blob (layout_json); format/canvas_width/canvas_height are denormalized
 * scalar columns pulled from that same content at write time, for cheap querying
 * without unpacking JSONB.
 */

import { pool } from '../pool.js';
import type { LayoutPlan, LayoutPlanContent, LayoutPlanStatus } from '@grafista/schemas';

function mapRow(row: Record<string, unknown>): LayoutPlan {
  const content = (row.layout_json as LayoutPlanContent) ?? ({} as LayoutPlanContent);
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    designBriefId: row.design_brief_id as string,
    contentIdeaId: (row.content_idea_id as string) ?? undefined,
    designDnaId: (row.design_dna_id as string) ?? undefined,
    status: row.status as LayoutPlanStatus,
    alternativeIndex: Number(row.alternative_index),
    format: (row.format as string) ?? content.format,
    canvas: content.canvas,
    layers: content.layers ?? [],
    gridStructure: content.gridStructure,
    safeZones: content.safeZones ?? [],
    headlinePlacement: content.headlinePlacement,
    subtitlePlacement: content.subtitlePlacement,
    logoPlacement: content.logoPlacement,
    ctaArea: content.ctaArea,
    colorUsageNotes: content.colorUsageNotes,
    typographyNotes: content.typographyNotes,
    exportSettings: content.exportSettings,
    referenceDesignIds: content.referenceDesignIds ?? [],
    designDnaRulesUsed: content.designDnaRulesUsed ?? [],
    designerNotes: content.designerNotes,
    provider: (row.provider as string) ?? undefined,
    model: (row.model as string) ?? undefined,
    createdBy: (row.created_by as string) ?? undefined,
    approvedBy: (row.approved_by as string) ?? undefined,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const layoutPlansRepo = {
  /**
   * Persists one validated layout alternative. Callers loop this once per alternative
   * (2-3 per generation batch), sharing designBriefId/designDnaId/provider/model/createdBy
   * and incrementing alternativeIndex — see runLayoutGeneration().
   */
  async create(data: {
    id: string;
    clientId: string;
    designBriefId: string;
    contentIdeaId?: string;
    designDnaId?: string;
    alternativeIndex: number;
    status: LayoutPlanStatus;
    content: LayoutPlanContent;
    provider: string;
    model: string;
    createdBy: string;
  }): Promise<LayoutPlan> {
    const { rows } = await pool.query(
      `INSERT INTO layout_plans (
         id, client_id, design_brief_id, content_idea_id, design_dna_id, alternative_index,
         status, format, canvas_width, canvas_height, layout_json, provider, model, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        data.id,
        data.clientId,
        data.designBriefId,
        data.contentIdeaId ?? null,
        data.designDnaId ?? null,
        data.alternativeIndex,
        data.status,
        data.content.format,
        data.content.canvas.width,
        data.content.canvas.height,
        JSON.stringify(data.content),
        data.provider,
        data.model,
        data.createdBy,
      ]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<LayoutPlan | undefined> {
    const { rows } = await pool.query('SELECT * FROM layout_plans WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** All layout plans across all briefs for a client. */
  async listByClient(clientId: string): Promise<LayoutPlan[]> {
    const { rows } = await pool.query(
      'SELECT * FROM layout_plans WHERE client_id = $1 ORDER BY created_at ASC, alternative_index ASC',
      [clientId]
    );
    return rows.map(mapRow);
  },

  /** All alternatives (ordered) for one design brief — the primary "review a batch" query. */
  async listByDesignBrief(designBriefId: string): Promise<LayoutPlan[]> {
    const { rows } = await pool.query(
      'SELECT * FROM layout_plans WHERE design_brief_id = $1 ORDER BY alternative_index ASC',
      [designBriefId]
    );
    return rows.map(mapRow);
  },

  /**
   * Approves the given layout plan alternative. Only succeeds from 'generated' or
   * 'needs_revision' (mirrors design_dna.ts's approve() guard). Returns undefined
   * (-> 409 in the route) if no row matched.
   */
  async approve(id: string, approvedBy: string): Promise<LayoutPlan | undefined> {
    const { rows } = await pool.query(
      `UPDATE layout_plans
       SET status = 'approved', approved_by = $2, approved_at = NOW()
       WHERE id = $1 AND status IN ('generated', 'needs_revision')
       RETURNING *`,
      [id, approvedBy]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Rejects (or requests revision on) the given layout plan alternative — only from the
   * 'generated' state. notes provided -> 'needs_revision', otherwise -> 'rejected'
   * (mirrors the content-ideas/approvals reject pattern). Returns undefined (-> 409 in
   * the route) if no row matched.
   */
  async reject(id: string, notes?: string): Promise<LayoutPlan | undefined> {
    const newStatus = notes ? 'needs_revision' : 'rejected';
    const { rows } = await pool.query(
      `UPDATE layout_plans SET status = $2 WHERE id = $1 AND status = 'generated' RETURNING *`,
      [id, newStatus]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
