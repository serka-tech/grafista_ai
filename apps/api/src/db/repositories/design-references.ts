import { pool } from '../pool.js';

export interface DesignReference {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  tags: string[];
  isApproved: boolean;
  uploadedAt: string;
}

function mapRow(row: Record<string, unknown>): DesignReference {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    name: row.name as string,
    description: (row.description as string) ?? undefined,
    fileUrl: (row.file_url as string) ?? undefined,
    thumbnailUrl: (row.thumbnail_url as string) ?? undefined,
    tags: (row.tags as string[]) ?? [],
    isApproved: row.is_approved as boolean,
    uploadedAt: (row.uploaded_at as Date).toISOString(),
  };
}

export const designReferencesRepo = {
  async listByClient(clientId: string): Promise<DesignReference[]> {
    const { rows } = await pool.query('SELECT * FROM design_references WHERE client_id = $1 ORDER BY uploaded_at ASC', [
      clientId,
    ]);
    return rows.map(mapRow);
  },

  async create(data: {
    id: string;
    clientId: string;
    name: string;
    description?: string;
    fileUrl?: string;
    tags: string[];
  }): Promise<DesignReference> {
    const { rows } = await pool.query(
      `INSERT INTO design_references (id, client_id, name, description, file_url, tags, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
      [data.id, data.clientId, data.name, data.description ?? null, data.fileUrl ?? null, JSON.stringify(data.tags)]
    );
    return mapRow(rows[0]);
  },
};
