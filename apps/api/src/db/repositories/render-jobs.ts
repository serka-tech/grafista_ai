/**
 * Grafista AI Studio — Render Jobs (Phase 2 Step 9A)
 *
 * Persists render jobs (production_jobs row at 'package_ready'/'approved' ->
 * one Template Render Engine request -> a rendered PNG/JPG/PDF exported to
 * object storage, see ../../services/render-engine.ts). Mirrors the
 * production-jobs.ts repo style exactly — plain pool.query + a mapRow,
 * parameterized queries, node-postgres auto-parsing JSONB.
 *
 * Unlike production_jobs, the manifest/template-contract snapshots are known
 * at CREATE time (copied straight from the production job) rather than
 * populated by a later updateStatus() call — see render-engine.ts.
 */

import { pool } from '../pool.js';
import type { RenderJob, RenderJobStatus, RenderWarning, RequestedFormat } from '@grafista/schemas';

function mapRow(row: Record<string, unknown>): RenderJob {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    productionJobId: row.production_job_id as string,
    requestedFormat: row.requested_format as RequestedFormat,

    manifestSnapshot: (row.manifest_snapshot as Record<string, unknown>) ?? undefined,
    templateContractSnapshot: (row.template_contract_snapshot as Record<string, unknown>) ?? undefined,

    status: row.status as RenderJobStatus,

    rendererName: (row.renderer_name as string) ?? undefined,
    rendererVersion: (row.renderer_version as string) ?? undefined,
    renderWarnings: (row.render_warnings as RenderWarning[]) ?? undefined,

    requestedBy: row.requested_by as string,
    errorMessage: (row.error_message as string) ?? undefined,

    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const renderJobsRepo = {
  /**
   * Persists one render job row (status 'pending'). Unlike production_jobs,
   * manifestSnapshot/templateContractSnapshot are already known at creation
   * time (copied from the production job), so they're inserted directly here
   * rather than deferred to a later updateStatus() call.
   */
  async create(data: {
    id: string;
    clientId: string;
    productionJobId: string;
    requestedFormat: RequestedFormat;
    manifestSnapshot?: Record<string, unknown>;
    templateContractSnapshot?: Record<string, unknown>;
    requestedBy: string;
  }): Promise<RenderJob> {
    const { rows } = await pool.query(
      `INSERT INTO render_jobs (
         id, client_id, production_job_id, requested_format, manifest_snapshot,
         template_contract_snapshot, status, requested_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
       RETURNING *`,
      [
        data.id,
        data.clientId,
        data.productionJobId,
        JSON.stringify(data.requestedFormat),
        data.manifestSnapshot ? JSON.stringify(data.manifestSnapshot) : null,
        data.templateContractSnapshot ? JSON.stringify(data.templateContractSnapshot) : null,
        data.requestedBy,
      ]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<RenderJob | undefined> {
    const { rows } = await pool.query('SELECT * FROM render_jobs WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Full render-job history for one production job, oldest first. */
  async listByProductionJob(productionJobId: string): Promise<RenderJob[]> {
    const { rows } = await pool.query(
      'SELECT * FROM render_jobs WHERE production_job_id = $1 ORDER BY created_at ASC',
      [productionJobId]
    );
    return rows.map(mapRow);
  },

  /**
   * Moves a job's render status ('rendering', 'rendered', 'failed',
   * 'cancelled'). errorMessage is stored when provided and cleared otherwise
   * (a successful retry must not keep a stale error — same contract as
   * productionJobsRepo.updateStatus()). renderer fields/warnings are written
   * when provided and left untouched otherwise. Returns undefined (-> 404 in
   * the route) if no row matched.
   */
  async updateStatus(
    id: string,
    status: RenderJobStatus,
    fields?: {
      errorMessage?: string;
      rendererName?: string;
      rendererVersion?: string;
      renderWarnings?: RenderWarning[];
    }
  ): Promise<RenderJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE render_jobs
       SET status = $2,
           error_message = $3,
           renderer_name = COALESCE($4, renderer_name),
           renderer_version = COALESCE($5, renderer_version),
           render_warnings = COALESCE($6, render_warnings)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        status,
        fields?.errorMessage ?? null,
        fields?.rendererName ?? null,
        fields?.rendererVersion ?? null,
        fields?.renderWarnings ? JSON.stringify(fields.renderWarnings) : null,
      ]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
