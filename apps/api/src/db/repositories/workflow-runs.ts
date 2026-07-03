/**
 * Grafista AI Studio — Workflow Runs (Phase 2 Step 6)
 *
 * Persists workflow engine runs (see ../../workflows/engine.ts). Mirrors the
 * layout-plans.ts / creative-qa.ts repo style — plain pool.query + a mapRow,
 * parameterized queries, node-postgres auto-parsing JSONB.
 *
 * All state transitions are guarded single-statement UPDATEs (`WHERE status
 * IN (...) RETURNING *`) — no transactions exist anywhere in this codebase;
 * a transition that matched no row returns undefined and the engine turns
 * that into a 409. State lives fully in PostgreSQL, so runs survive an API
 * restart by construction.
 */

import { pool } from '../pool.js';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStatus } from '@grafista/schemas';

export interface WorkflowRunListItem extends WorkflowRun {
  clientName?: string;
  workflowName?: string;
}

function mapRow(row: Record<string, unknown>): WorkflowRun {
  return {
    id: row.id as string,
    workflowId: row.workflow_id as string,
    clientId: row.client_id as string,
    status: row.status as WorkflowRunStatus,
    startedBy: row.started_by as string,
    currentStepId: (row.current_step_id as string) ?? undefined,
    definitionSnapshot: row.definition_snapshot as WorkflowDefinition,
    inputJson: (row.input_json as Record<string, unknown>) ?? {},
    outputJson: (row.output_json as Record<string, unknown>) ?? {},
    errorJson: (row.error_json as Record<string, unknown>) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : undefined,
  };
}

function mapListRow(row: Record<string, unknown>): WorkflowRunListItem {
  return {
    ...mapRow(row),
    clientName: (row.client_name as string) ?? undefined,
    workflowName: (row.workflow_name as string) ?? undefined,
  };
}

export const workflowRunsRepo = {
  async create(data: {
    id: string;
    workflowId: string;
    clientId: string;
    startedBy: string;
    definitionSnapshot: WorkflowDefinition;
    input: Record<string, unknown>;
  }): Promise<WorkflowRun> {
    const { rows } = await pool.query(
      `INSERT INTO workflow_runs (id, workflow_id, client_id, status, started_by, definition_snapshot, input_json)
       VALUES ($1, $2, $3, 'in_progress', $4, $5, $6)
       RETURNING *`,
      [data.id, data.workflowId, data.clientId, data.startedBy, JSON.stringify(data.definitionSnapshot), JSON.stringify(data.input)]
    );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query('SELECT * FROM workflow_runs WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Runs newest-first, joined with the client name; workflow name read from the snapshot. */
  async list(filters: { clientId?: string; workflowId?: string; status?: string } = {}): Promise<WorkflowRunListItem[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filters.clientId) {
      values.push(filters.clientId);
      conditions.push(`r.client_id = $${values.length}`);
    }
    if (filters.workflowId) {
      values.push(filters.workflowId);
      conditions.push(`r.workflow_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`r.status = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT r.*, c.name AS client_name, r.definition_snapshot->>'name' AS workflow_name
       FROM workflow_runs r
       LEFT JOIN clients c ON c.id = r.client_id
       ${where}
       ORDER BY r.created_at DESC`,
      values
    );
    return rows.map(mapListRow);
  },

  async setCurrentStep(id: string, stepId: string | null): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query('UPDATE workflow_runs SET current_step_id = $2 WHERE id = $1 RETURNING *', [id, stepId]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Shallow-merges a patch into output_json (cross-step context like campaignDetails). */
  async mergeOutput(id: string, patch: Record<string, unknown>): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query(
      'UPDATE workflow_runs SET output_json = output_json || $2::jsonb WHERE id = $1 RETURNING *',
      [id, JSON.stringify(patch)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** in_progress|waiting_for_approval -> in_progress (e.g. resuming after a gate decision). */
  async markInProgress(id: string): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_runs SET status = 'in_progress'
       WHERE id = $1 AND status IN ('in_progress', 'waiting_for_approval')
       RETURNING *`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** in_progress -> waiting_for_approval (an approval gate was armed). */
  async markWaiting(id: string): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_runs SET status = 'waiting_for_approval'
       WHERE id = $1 AND status = 'in_progress'
       RETURNING *`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async markCompleted(id: string, output: Record<string, unknown>): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_runs
       SET status = 'completed', output_json = output_json || $2::jsonb, completed_at = NOW(), current_step_id = NULL
       WHERE id = $1 AND status IN ('in_progress', 'waiting_for_approval')
       RETURNING *`,
      [id, JSON.stringify(output)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async markFailed(id: string, error: Record<string, unknown>): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_runs SET status = 'failed', error_json = $2
       WHERE id = $1 AND status IN ('draft', 'in_progress', 'waiting_for_approval', 'qa_failed', 'blocked_future_feature')
       RETURNING *`,
      [id, JSON.stringify(error)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async markCancelled(id: string): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_runs SET status = 'cancelled'
       WHERE id = $1 AND status IN ('draft', 'in_progress', 'waiting_for_approval', 'blocked_future_feature', 'qa_failed')
       RETURNING *`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Creative-QA gate arrival rule: report failed with score < 50 blocks the run. */
  async markQaFailed(id: string, error: Record<string, unknown>): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_runs SET status = 'qa_failed', error_json = $2
       WHERE id = $1 AND status IN ('in_progress', 'waiting_for_approval')
       RETURNING *`,
      [id, JSON.stringify(error)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** The next step is an explicitly-unimplemented future feature — never faked as success. */
  async markBlockedFuture(id: string, error: Record<string, unknown>): Promise<WorkflowRun | undefined> {
    const { rows } = await pool.query(
      `UPDATE workflow_runs SET status = 'blocked_future_feature', error_json = $2
       WHERE id = $1 AND status IN ('in_progress', 'waiting_for_approval')
       RETURNING *`,
      [id, JSON.stringify(error)]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
