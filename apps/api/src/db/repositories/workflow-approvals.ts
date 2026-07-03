/**
 * Grafista AI Studio — Workflow Approvals (Phase 2 Step 6)
 *
 * Audit trail of approval-gate decisions (who approved/rejected which step,
 * when, on which entity). The domain approval itself still lives on the
 * entity's own status column (and, for content ideas, in the existing
 * approvals table) — this table records the workflow-side decision.
 */

import { pool } from '../pool.js';

export interface WorkflowApproval {
  id: string;
  workflowRunId: string;
  workflowStepId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  entityType?: string;
  entityId?: string;
  notes?: string;
  createdAt: string;
}

function mapRow(row: Record<string, unknown>): WorkflowApproval {
  return {
    id: row.id as string,
    workflowRunId: row.workflow_run_id as string,
    workflowStepId: row.workflow_step_id as string,
    decision: row.decision as 'approved' | 'rejected',
    decidedBy: row.decided_by as string,
    entityType: (row.entity_type as string) ?? undefined,
    entityId: (row.entity_id as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export const workflowApprovalsRepo = {
  async create(data: {
    id: string;
    workflowRunId: string;
    workflowStepId: string;
    decision: 'approved' | 'rejected';
    decidedBy: string;
    entityType?: string;
    entityId?: string;
    notes?: string;
  }): Promise<WorkflowApproval> {
    const { rows } = await pool.query(
      `INSERT INTO workflow_approvals (id, workflow_run_id, workflow_step_id, decision, decided_by, entity_type, entity_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.id,
        data.workflowRunId,
        data.workflowStepId,
        data.decision,
        data.decidedBy,
        data.entityType ?? null,
        data.entityId ?? null,
        data.notes ?? null,
      ]
    );
    return mapRow(rows[0]);
  },

  async listByRun(runId: string): Promise<WorkflowApproval[]> {
    const { rows } = await pool.query('SELECT * FROM workflow_approvals WHERE workflow_run_id = $1 ORDER BY created_at ASC', [runId]);
    return rows.map(mapRow);
  },
};
