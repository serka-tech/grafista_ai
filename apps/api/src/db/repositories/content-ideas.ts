import { pool } from '../pool.js';

export interface ContentIdea {
  id: string;
  clientId: string;
  campaignName?: string;
  title: string;
  description: string;
  platform: string;
  format: string;
  hook?: string;
  caption?: string;
  hashtags: string[];
  callToAction?: string;
  toneOfVoice?: string;
  visualDirection?: string;
  aiImagePrompt?: string;
  status: string;
  generatedBy: string;
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): ContentIdea {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    campaignName: (row.campaign_name as string) ?? undefined,
    title: row.title as string,
    description: (row.description as string) ?? '',
    platform: row.platform as string,
    format: row.format as string,
    hook: (row.hook as string) ?? undefined,
    caption: (row.caption as string) ?? undefined,
    hashtags: (row.hashtags as string[]) ?? [],
    callToAction: (row.call_to_action as string) ?? undefined,
    toneOfVoice: (row.tone_of_voice as string) ?? undefined,
    visualDirection: (row.visual_direction as string) ?? undefined,
    aiImagePrompt: (row.ai_image_prompt as string) ?? undefined,
    status: row.status as string,
    generatedBy: row.generated_by as string,
    approvalId: (row.approval_id as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const contentIdeasRepo = {
  async listByClient(clientId: string, status?: string): Promise<ContentIdea[]> {
    const { rows } = status
      ? await pool.query('SELECT * FROM content_ideas WHERE client_id = $1 AND status = $2 ORDER BY created_at ASC', [
          clientId,
          status,
        ])
      : await pool.query('SELECT * FROM content_ideas WHERE client_id = $1 ORDER BY created_at ASC', [clientId]);
    return rows.map(mapRow);
  },

  async listApprovedByClient(clientId: string): Promise<ContentIdea[]> {
    return this.listByClient(clientId, 'approved');
  },

  async listPendingApproval(): Promise<ContentIdea[]> {
    const { rows } = await pool.query("SELECT * FROM content_ideas WHERE status = 'pending_approval' ORDER BY created_at ASC");
    return rows.map(mapRow);
  },

  async getById(id: string): Promise<ContentIdea | undefined> {
    const { rows } = await pool.query('SELECT * FROM content_ideas WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async create(data: {
    id: string;
    clientId: string;
    campaignName?: string;
    title: string;
    description: string;
    platform: string;
    format: string;
    hook?: string;
    caption?: string;
    hashtags: string[];
    callToAction?: string;
    toneOfVoice?: string;
    visualDirection?: string;
    status: string;
    generatedBy: string;
  }): Promise<ContentIdea> {
    const { rows } = await pool.query(
      `INSERT INTO content_ideas
        (id, client_id, campaign_name, title, description, platform, format, hook, caption, hashtags, call_to_action, tone_of_voice, visual_direction, status, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        data.id,
        data.clientId,
        data.campaignName ?? null,
        data.title,
        data.description,
        data.platform,
        data.format,
        data.hook ?? null,
        data.caption ?? null,
        JSON.stringify(data.hashtags),
        data.callToAction ?? null,
        data.toneOfVoice ?? null,
        data.visualDirection ?? null,
        data.status,
        data.generatedBy,
      ]
    );
    return mapRow(rows[0]);
  },

  async setApprovalOutcome(id: string, status: string, approvalId: string | null): Promise<ContentIdea | undefined> {
    const { rows } = await pool.query(
      'UPDATE content_ideas SET status = $1, approval_id = $2 WHERE id = $3 RETURNING *',
      [status, approvalId, id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
