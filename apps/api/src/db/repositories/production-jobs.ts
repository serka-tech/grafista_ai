/**
 * Grafista AI Studio — Production Jobs (Phase 2 Step 8A)
 *
 * Persists production jobs (approved/generated visual -> manifest +
 * template-contract JSON package in object storage — see
 * ../../services/production-package-builder.ts). Mirrors the
 * generated-outputs.ts repo style — plain pool.query + a mapRow,
 * parameterized queries, node-postgres auto-parsing JSONB.
 *
 * SINGLE status axis (unlike generated_outputs' status/approval_status
 * split): a job's packaging lifecycle and its human review never overlap —
 * approve()/reject() are only reachable from 'package_ready', enforced by
 * the same guarded-WHERE idiom as generatedOutputsRepo.approve().
 *
 *   pending -> packaging -> package_ready -> approved | rejected
 *                      \-> failed          (error_message set)
 *   cancelled                               (manual abort)
 */

import { pool } from '../pool.js';
import type { ProductionJob, ProductionJobStatus } from '@grafista/schemas';

function mapRow(row: Record<string, unknown>): ProductionJob {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    generatedOutputId: row.generated_output_id as string,
    layoutPlanId: (row.layout_plan_id as string) ?? undefined,

    status: row.status as ProductionJobStatus,
    errorMessage: (row.error_message as string) ?? undefined,

    generationMethod: row.generation_method as string,

    packageStorageProvider: (row.package_storage_provider as string) ?? undefined,
    packageStorageBucket: (row.package_storage_bucket as string) ?? undefined,
    packageStorageKey: (row.package_storage_key as string) ?? undefined,
    packageMimeType: (row.package_mime_type as string) ?? undefined,
    packageSizeBytes: row.package_size_bytes != null ? Number(row.package_size_bytes) : undefined,

    packageManifestSnapshot: (row.package_manifest_snapshot as Record<string, unknown>) ?? undefined,
    templateContractSnapshot: (row.template_contract_snapshot as Record<string, unknown>) ?? undefined,

    requestedBy: row.requested_by as string,
    approvedBy: (row.approved_by as string) ?? undefined,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : undefined,

    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

/** Statuses that count as "active" for idempotency — must stay in sync with the
 * partial unique index uniq_production_jobs_active_output (016_production_jobs.sql). */
const TERMINAL_RETRYABLE_STATUSES = ['failed', 'cancelled', 'rejected'] as const;

export const productionJobsRepo = {
  /**
   * Persists one production job row (normally status 'pending' — the package
   * builder transitions it forward via updateStatus()). The DB's partial unique
   * index rejects a second active job for the same generated output; callers
   * should check findActiveByGeneratedOutput() first for the friendly path.
   */
  async create(data: {
    id: string;
    clientId: string;
    generatedOutputId: string;
    layoutPlanId?: string;
    status: ProductionJobStatus;
    generationMethod: string;
    requestedBy: string;
  }): Promise<ProductionJob> {
    const { rows } = await pool.query(
      `INSERT INTO production_jobs (
         id, client_id, generated_output_id, layout_plan_id, status, generation_method, requested_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        data.id,
        data.clientId,
        data.generatedOutputId,
        data.layoutPlanId ?? null,
        data.status,
        data.generationMethod,
        data.requestedBy,
      ]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<ProductionJob | undefined> {
    const { rows } = await pool.query('SELECT * FROM production_jobs WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** All production jobs for a client, oldest first. */
  async listByClient(clientId: string): Promise<ProductionJob[]> {
    const { rows } = await pool.query(
      'SELECT * FROM production_jobs WHERE client_id = $1 ORDER BY created_at ASC',
      [clientId]
    );
    return rows.map(mapRow);
  },

  /** Full job history (including failed/cancelled/rejected) for one generated output. */
  async listByGeneratedOutput(generatedOutputId: string): Promise<ProductionJob[]> {
    const { rows } = await pool.query(
      'SELECT * FROM production_jobs WHERE generated_output_id = $1 ORDER BY created_at ASC',
      [generatedOutputId]
    );
    return rows.map(mapRow);
  },

  /**
   * The idempotency lookup: the single active (non-failed/cancelled/rejected)
   * job for a generated output, if any. At most one can exist thanks to the
   * partial unique index in 016_production_jobs.sql.
   */
  async findActiveByGeneratedOutput(generatedOutputId: string): Promise<ProductionJob | undefined> {
    const { rows } = await pool.query(
      `SELECT * FROM production_jobs
       WHERE generated_output_id = $1 AND status NOT IN ($2, $3, $4)
       ORDER BY created_at DESC LIMIT 1`,
      [generatedOutputId, ...TERMINAL_RETRYABLE_STATUSES]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Moves a job's packaging status ('packaging', 'package_ready', 'failed',
   * 'cancelled'). errorMessage is stored when provided and cleared otherwise
   * (a successful retry must not keep a stale error — same contract as
   * generatedOutputsRepo.updateStatus()). Package fields are written when
   * provided and left untouched otherwise, so a later 'failed'/'cancelled'
   * transition never wipes already-stored package coordinates.
   * Returns undefined (-> 404/409 in the route) if no row matched.
   */
  async updateStatus(
    id: string,
    status: ProductionJobStatus,
    fields?: {
      errorMessage?: string;
      packageStorageProvider?: string;
      packageStorageBucket?: string;
      packageStorageKey?: string;
      packageMimeType?: string;
      packageSizeBytes?: number;
      packageManifestSnapshot?: Record<string, unknown>;
      templateContractSnapshot?: Record<string, unknown>;
    }
  ): Promise<ProductionJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE production_jobs
       SET status = $2,
           error_message = $3,
           package_storage_provider = COALESCE($4, package_storage_provider),
           package_storage_bucket = COALESCE($5, package_storage_bucket),
           package_storage_key = COALESCE($6, package_storage_key),
           package_mime_type = COALESCE($7, package_mime_type),
           package_size_bytes = COALESCE($8, package_size_bytes),
           package_manifest_snapshot = COALESCE($9, package_manifest_snapshot),
           template_contract_snapshot = COALESCE($10, template_contract_snapshot)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        status,
        fields?.errorMessage ?? null,
        fields?.packageStorageProvider ?? null,
        fields?.packageStorageBucket ?? null,
        fields?.packageStorageKey ?? null,
        fields?.packageMimeType ?? null,
        fields?.packageSizeBytes ?? null,
        fields?.packageManifestSnapshot ? JSON.stringify(fields.packageManifestSnapshot) : null,
        fields?.templateContractSnapshot ? JSON.stringify(fields.templateContractSnapshot) : null,
      ]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Approves the given job (human sign-off on the built package). Only succeeds
   * when the package was actually built (status = 'package_ready') — same
   * guarded-single-UPDATE idiom as generatedOutputsRepo.approve(). Returns
   * undefined (-> 409 in the route) if no row matched.
   */
  async approve(id: string, approvedBy: string): Promise<ProductionJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE production_jobs
       SET status = 'approved', approved_by = $2, approved_at = NOW()
       WHERE id = $1 AND status = 'package_ready'
       RETURNING *`,
      [id, approvedBy]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * Rejects the given job — only from 'package_ready' (the same prior-status
   * guard as approve(); there is no revision_requested state for jobs, a
   * rejected job is terminal and a new job can be created instead). Returns
   * undefined (-> 409 in the route) if no row matched.
   */
  async reject(id: string): Promise<ProductionJob | undefined> {
    const { rows } = await pool.query(
      `UPDATE production_jobs
       SET status = 'rejected'
       WHERE id = $1 AND status = 'package_ready'
       RETURNING *`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
