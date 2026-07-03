/**
 * Grafista AI Studio — Workflow Step Outputs (Phase 2 Step 6)
 *
 * Links workflow steps to the REAL domain entities they produced/affected
 * (design_dna, content_idea, design_brief, layout_plan, creative_qa_report).
 * Approval gates and later steps read these links to act on this run's
 * entities specifically (e.g. "approve one of THIS run's generated ideas").
 */

import { pool } from '../pool.js';

export interface WorkflowStepOutput {
  id: string;
  workflowStepId: string;
  workflowRunId: string;
  entityType: string;
  entityId?: string;
  outputKey: string;
  outputJson: Record<string, unknown>;
  createdAt: string;
}

function mapRow(row: Record<string, unknown>): WorkflowStepOutput {
  return {
    id: row.id as string,
    workflowStepId: row.workflow_step_id as string,
    workflowRunId: row.workflow_run_id as string,
    entityType: row.entity_type as string,
    entityId: (row.entity_id as string) ?? undefined,
    outputKey: row.output_key as string,
    outputJson: (row.output_json as Record<string, unknown>) ?? {},
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export const workflowStepOutputsRepo = {
  async create(data: {
    id: string;
    workflowStepId: string;
    workflowRunId: string;
    entityType: string;
    entityId?: string;
    outputKey: string;
    outputJson?: Record<string, unknown>;
  }): Promise<WorkflowStepOutput> {
    const { rows } = await pool.query(
      `INSERT INTO workflow_step_outputs (id, workflow_step_id, workflow_run_id, entity_type, entity_id, output_key, output_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [data.id, data.workflowStepId, data.workflowRunId, data.entityType, data.entityId ?? null, data.outputKey, JSON.stringify(data.outputJson ?? {})]
    );
    return mapRow(rows[0]);
  },

  async listByRun(runId: string): Promise<WorkflowStepOutput[]> {
    const { rows } = await pool.query(
      'SELECT * FROM workflow_step_outputs WHERE workflow_run_id = $1 ORDER BY created_at ASC',
      [runId]
    );
    return rows.map(mapRow);
  },

  /** All outputs of one entity type for a run, latest first. */
  async findByRunAndEntityType(runId: string, entityType: string): Promise<WorkflowStepOutput[]> {
    const { rows } = await pool.query(
      'SELECT * FROM workflow_step_outputs WHERE workflow_run_id = $1 AND entity_type = $2 ORDER BY created_at DESC',
      [runId, entityType]
    );
    return rows.map(mapRow);
  },
};
