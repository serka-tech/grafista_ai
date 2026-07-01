import { pool } from '../pool.js';
import type { StorageProviderName } from '../../storage/types.js';

export interface DesignReference {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  originalFilename?: string;
  storageProvider?: StorageProviderName;
  storageKey?: string;
  storageBucket?: string;
  uploadedBy?: string;
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
    mimeType: (row.mime_type as string) ?? undefined,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : undefined,
    originalFilename: (row.original_filename as string) ?? undefined,
    storageProvider: (row.storage_provider as StorageProviderName) ?? undefined,
    storageKey: (row.storage_key as string) ?? undefined,
    storageBucket: (row.storage_bucket as string) ?? undefined,
    uploadedBy: (row.uploaded_by as string) ?? undefined,
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

  async getById(clientId: string, id: string): Promise<DesignReference | undefined> {
    const { rows } = await pool.query('SELECT * FROM design_references WHERE client_id = $1 AND id = $2', [
      clientId,
      id,
    ]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async create(data: {
    id: string;
    clientId: string;
    name: string;
    description?: string;
    fileUrl?: string;
    mimeType?: string;
    fileSizeBytes?: number;
    originalFilename?: string;
    storageProvider?: StorageProviderName;
    storageKey?: string;
    storageBucket?: string;
    uploadedBy?: string;
    tags: string[];
  }): Promise<DesignReference> {
    const { rows } = await pool.query(
      `INSERT INTO design_references (
         id, client_id, name, description, file_url, mime_type, file_size_bytes,
         original_filename, storage_provider, storage_key, storage_bucket, uploaded_by, tags, is_approved
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true) RETURNING *`,
      [
        data.id,
        data.clientId,
        data.name,
        data.description ?? null,
        data.fileUrl ?? null,
        data.mimeType ?? null,
        data.fileSizeBytes ?? null,
        data.originalFilename ?? null,
        data.storageProvider ?? null,
        data.storageKey ?? null,
        data.storageBucket ?? null,
        data.uploadedBy ?? null,
        JSON.stringify(data.tags),
      ]
    );
    return mapRow(rows[0]);
  },
};
