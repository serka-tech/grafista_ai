/**
 * Grafista AI Studio — Workflow Steps (Phase 2 Step 6)
 *
 * Per-run materialized step rows (see ../../workflows/engine.ts). Same
 * guarded single-statement UPDATE convention as workflow-runs.ts: every
 * transition carries a `WHERE status ... RETURNING *` guard, so concurrent
 * double-advances lose the race cleanly (undefined -> 409 in the engine)
 * instead of corrupting state — optimistic concurrency without transactions.
 */

import { pool } from '../pool.js';
import type { WorkflowStepRecord, WorkflowStepStatus, WorkflowStepType } from '@grafista/schemas';

function mapRow(row: Record<string, unknown>): WorkflowStepRecord {
  return {
    id: row.id as string,
    workflowRunId: row.workflow_run_id as string,
    stepId: row.step_id as string,
    stepName: row.step_name as string,
    action: row.action as string,
    stepOrder: Number(row.step_order),
    stepType: row.step_type as WorkflowStepType,
    status: row.status as WorkflowStepStatus,
    requiredPermission: (row.required_permission as string) ?? undefined,
    requiredApproval: row.required_approval as boolean,
    skillIds: (row.skill_ids as string[]) ?? [],
    inputJson: (row.input_json as Record<string, unknown>) ?? {},
    outputJson: (row.output_json as Record<string, unknown>) ?? {},
    errorJson: (row.error_json as Record<string, unknown>) ?? undefined,
    revisionCount: Number(row.revision_count ?? 0),
    approvedBy: (row.approved_by as string) ?? undefined,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : undefined,
    rejectedBy: (row.rejected_by as string) ?? undefined,
    rejectedAt: row.rejected_at ? (row.rejected_at as Date).toISOString() : undefined,
    startedAt: row.started_at ? (row.started_at as Date).toISOString() : undefined,
    completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export interface CreateWorkflowStepData {
  id: string;
  workflowRunId: string;
  stepId: string;
  stepName: string;
  action: string;
  stepOrder: number;
  stepType: WorkflowStepType;
  requiredPermission?: string;
  requiredApproval: boolean;
  skillIds: string[];
  input: Record<string, unknown>;
}

export const workflowStepsRepo = {
  /** Bulk-inserts all of a run's step rows at start time (one multi-row INSERT). */
  async createMany(steps: CreateWorkflowStepData[]): Promise<WorkflowStepRecord[]> {
    if (steps.length === 0) return [];
    const values: unknown[] = [];
    const tuples = steps.map((step) => {
      values.push(
        step.id,
        step.workflowRunId,
        step.stepId,
        step.stepName,
        step.action,
        step.stepOrder,
        step.stepType,
        step.requiredPermission ?? null,
        step.requiredApproval,
        JSON.stringify(step.skillIds),
        JSON.stringify(step.input)
      );
      const base = values.length - 11;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`;
    });
    const { rows } = await pool.query(
      `INSERT INTO workflow_steps (
         id, workflow_run_id, step_id, step_name, action, step_order, step_type,
         required_permission, required_approval, skill_ids, input_json
       )
       VALUES ${tuples.join(', ')}
       RETURNING *`,
      values
    );
    return rows.map(mapRow).sort((a, b) => a.stepOrder - b.stepOrder);
  },

  async listByRun(runId: string): Promise<WorkflowStepRecord[]> {
    const { rows } = await pool.query('SELECT * FROM workflow_steps WHERE workflow_run_id = $1 ORDER BY step_order ASC', [runId]);
    return rows.map(mapRow);
  },

  async getById(id: string): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query('SELECT * FROM workflow_steps WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async getByRunAndStepId(runId: string, stepId: string): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query('SELECT * FROM workflow_steps WHERE workflow_run_id = $1 AND step_id = $2', [runId, stepId]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** pending -> in_progress. The optimistic concurrency guard: no row means someone else already began it. */
  async begin(id: string): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_steps SET status = 'in_progress', started_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** in_progress -> completed. */
  async complete(id: string, output: Record<string, unknown>): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_steps SET status = 'completed', output_json = $2, completed_at = NOW()
       WHERE id = $1 AND status = 'in_progress'
       RETURNING *`,
      [id, JSON.stringify(output)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** pending|in_progress -> failed, persisting the error before it is rethrown. */
  async fail(id: string, error: Record<string, unknown>): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_steps SET status = 'failed', error_json = $2, completed_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'in_progress')
       RETURNING *`,
      [id, JSON.stringify(error)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** pending|in_progress -> skipped (optional/non-blocking steps — never faked as done work). */
  async skip(id: string, output: Record<string, unknown>): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_steps SET status = 'skipped', output_json = $2, completed_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'in_progress')
       RETURNING *`,
      [id, JSON.stringify(output)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** pending -> waiting_for_approval (an approval gate was armed). */
  async wait(id: string): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_steps SET status = 'waiting_for_approval'
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** waiting_for_approval -> approved (domain approval already performed by the engine). */
  async approve(id: string, userId: string, output: Record<string, unknown>): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_steps
       SET status = 'approved', approved_by = $2, approved_at = NOW(), completed_at = NOW(), output_json = $3
       WHERE id = $1 AND status = 'waiting_for_approval'
       RETURNING *`,
      [id, userId, JSON.stringify(output)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** waiting_for_approval -> rejected (domain rejection already performed by the engine). */
  async reject(id: string, userId: string, output: Record<string, unknown>): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_steps
       SET status = 'rejected', rejected_by = $2, rejected_at = NOW(), output_json = $3
       WHERE id = $1 AND status = 'waiting_for_approval'
       RETURNING *`,
      [id, userId, JSON.stringify(output)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Sets output_json without a status transition (e.g. annotating a blocked future step). */
  async setOutput(id: string, output: Record<string, unknown>): Promise<WorkflowStepRecord | undefined> {
    const { rows } = await pool.query('UPDATE workflow_steps SET output_json = $2 WHERE id = $1 RETURNING *', [
      id,
      JSON.stringify(output),
    ]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /**
   * on_reject revision loop: resets every step with fromOrder <= step_order <= toOrder
   * back to 'pending' (clearing outputs/errors/timestamps/decisions) and bumps
   * revision_count — one guarded statement, no transaction needed.
   */
  async resetForRevision(runId: string, fromOrder: number, toOrder: number): Promise<WorkflowStepRecord[]> {
    const { rows } = await pool.query(
      `UPDATE workflow_steps
       SET status = 'pending', output_json = '{}', error_json = NULL,
           started_at = NULL, completed_at = NULL,
           approved_by = NULL, approved_at = NULL, rejected_by = NULL, rejected_at = NULL,
           revision_count = revision_count + 1
       WHERE workflow_run_id = $1 AND step_order BETWEEN $2 AND $3
       RETURNING *`,
      [runId, fromOrder, toOrder]
    );
    return rows.map(mapRow).sort((a, b) => a.stepOrder - b.stepOrder);
  },
};
