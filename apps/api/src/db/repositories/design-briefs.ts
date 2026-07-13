import { pool } from '../pool.js';

export interface DesignBrief {
  id: string;
  clientId: string;
  contentIdeaId: string;
  approvalId: string;
  title: string;
  objective: string;
  platform: string;
  format: string;
  dimensions: { width: number; height: number; unit: string };
  contentElements: Record<string, unknown>;
  visualDirection: Record<string, unknown>;
  brandConstraints: Record<string, unknown>;
  aiImagePrompts: unknown[];
  // Denormalized-read convenience — column has existed since 001_initial_schema.sql
  // (default '[]') but was previously never mapped/read by this repo.
  referenceDesignIds: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): DesignBrief {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    contentIdeaId: row.content_idea_id as string,
    approvalId: row.approval_id as string,
    title: row.title as string,
    objective: (row.objective as string) ?? '',
    platform: row.platform as string,
    format: row.format as string,
    dimensions: row.dimensions as { width: number; height: number; unit: string },
    contentElements: (row.content_elements as Record<string, unknown>) ?? {},
    visualDirection: (row.visual_direction as Record<string, unknown>) ?? {},
    brandConstraints: (row.brand_constraints as Record<string, unknown>) ?? {},
    aiImagePrompts: (row.ai_image_prompts as unknown[]) ?? [],
    referenceDesignIds: (row.reference_design_ids as string[]) ?? [],
    status: row.status as string,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const designBriefsRepo = {
  async create(data: {
    id: string;
    clientId: string;
    contentIdeaId: string;
    approvalId: string;
    title: string;
    objective: string;
    platform: string;
    format: string;
    dimensions: { width: number; height: number; unit: string };
    contentElements: Record<string, unknown>;
    visualDirection: Record<string, unknown>;
    brandConstraints: Record<string, unknown>;
    aiImagePrompts: unknown[];
  }): Promise<DesignBrief> {
    const { rows } = await pool.query(
      `INSERT INTO design_briefs
        (id, client_id, content_idea_id, approval_id, title, objective, platform, format, dimensions, content_elements, visual_direction, brand_constraints, ai_image_prompts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        data.id,
        data.clientId,
        data.contentIdeaId,
        data.approvalId,
        data.title,
        data.objective,
        data.platform,
        data.format,
        JSON.stringify(data.dimensions),
        JSON.stringify(data.contentElements),
        JSON.stringify(data.visualDirection),
        JSON.stringify(data.brandConstraints),
        JSON.stringify(data.aiImagePrompts),
      ]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<DesignBrief | undefined> {
    const { rows } = await pool.query('SELECT * FROM design_briefs WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** `organizationId` is REQUIRED — only briefs whose client is in the caller's tenant. */
  async list(organizationId: string): Promise<DesignBrief[]> {
    const { rows } = await pool.query(
      `SELECT b.* FROM design_briefs b
       JOIN clients c ON c.id = b.client_id
       WHERE c.organization_id = $1
       ORDER BY b.created_at ASC`,
      [organizationId]
    );
    return rows.map(mapRow);
  },

  /** Plain status transition — the `trg_design_briefs_updated` trigger auto-bumps updated_at. */
  async updateStatus(id: string, status: string): Promise<DesignBrief | undefined> {
    const { rows } = await pool.query(
      'UPDATE design_briefs SET status = $2 WHERE id = $1 RETURNING *',
      [id, status]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
