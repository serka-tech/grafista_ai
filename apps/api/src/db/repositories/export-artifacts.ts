/**
 * Grafista AI Studio — Export Artifacts (Phase 2 Step 9A)
 *
 * A CHILD of render_jobs — one render job can, in principle, produce more
 * than one exported file (see 019_render_jobs.sql). Artifacts are immutable
 * once created: no update method, mirroring the "write-once" nature of a
 * rendered file's bytes/metadata.
 */

import { pool } from '../pool.js';
import type { ExportArtifact, ExportFormat } from '@grafista/schemas';
import type { StorageProviderName } from '../../storage/types.js';

function mapRow(row: Record<string, unknown>): ExportArtifact {
  return {
    id: row.id as string,
    renderJobId: row.render_job_id as string,
    clientId: row.client_id as string,
    format: row.format as ExportFormat,
    width: row.width as number,
    height: row.height as number,
    mimeType: row.mime_type as string,

    storageProvider: row.storage_provider as string,
    storageBucket: row.storage_bucket as string,
    storageKey: row.storage_key as string,

    sizeBytes: Number(row.size_bytes),
    checksum: (row.checksum as string) ?? undefined,

    createdAt: (row.created_at as Date).toISOString(),
  };
}

export const exportArtifactsRepo = {
  /** Persists one export artifact row. Immutable once created — no update method. */
  async create(data: {
    id: string;
    renderJobId: string;
    clientId: string;
    format: ExportFormat;
    width: number;
    height: number;
    mimeType: string;
    storageProvider: StorageProviderName;
    storageBucket: string;
    storageKey: string;
    sizeBytes: number;
    checksum?: string;
  }): Promise<ExportArtifact> {
    const { rows } = await pool.query(
      `INSERT INTO export_artifacts (
         id, render_job_id, client_id, format, width, height, mime_type,
         storage_provider, storage_bucket, storage_key, size_bytes, checksum
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        data.id,
        data.renderJobId,
        data.clientId,
        data.format,
        data.width,
        data.height,
        data.mimeType,
        data.storageProvider,
        data.storageBucket,
        data.storageKey,
        data.sizeBytes,
        data.checksum ?? null,
      ]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<ExportArtifact | undefined> {
    const { rows } = await pool.query('SELECT * FROM export_artifacts WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** All export artifacts for one render job, oldest first. */
  async listByRenderJob(renderJobId: string): Promise<ExportArtifact[]> {
    const { rows } = await pool.query(
      'SELECT * FROM export_artifacts WHERE render_job_id = $1 ORDER BY created_at ASC',
      [renderJobId]
    );
    return rows.map(mapRow);
  },
};
