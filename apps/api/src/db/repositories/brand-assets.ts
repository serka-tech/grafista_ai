import { pool } from '../pool.js';

export interface BrandAsset {
  id: string;
  clientId: string;
  type: string;
  name: string;
  fileUrl?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

function mapRow(row: Record<string, unknown>): BrandAsset {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    type: row.type as string,
    name: row.name as string,
    fileUrl: (row.file_url as string) ?? undefined,
    mimeType: (row.mime_type as string) ?? undefined,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export const brandAssetsRepo = {
  async listByClient(clientId: string): Promise<BrandAsset[]> {
    const { rows } = await pool.query('SELECT * FROM brand_assets WHERE client_id = $1 ORDER BY created_at ASC', [
      clientId,
    ]);
    return rows.map(mapRow);
  },

  async create(data: {
    id: string;
    clientId: string;
    type: string;
    name: string;
    fileUrl?: string;
    mimeType?: string;
    fileSizeBytes?: number;
    metadata?: Record<string, unknown>;
  }): Promise<BrandAsset> {
    const { rows } = await pool.query(
      `INSERT INTO brand_assets (id, client_id, type, name, file_url, mime_type, file_size_bytes, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        data.id,
        data.clientId,
        data.type,
        data.name,
        data.fileUrl ?? null,
        data.mimeType ?? null,
        data.fileSizeBytes ?? null,
        JSON.stringify(data.metadata ?? {}),
      ]
    );
    return mapRow(rows[0]);
  },
};
