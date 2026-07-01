import { pool } from '../pool.js';

export interface Approval {
  id: string;
  entityType: string;
  entityId: string;
  clientId: string;
  status: string;
  reviewerRole?: string;
  reviewerName?: string;
  notes?: string;
  revisionNotes?: string;
  approvedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): Approval {
  return {
    id: row.id as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    clientId: row.client_id as string,
    status: row.status as string,
    reviewerRole: (row.reviewer_role as string) ?? undefined,
    reviewerName: (row.reviewer_name as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    revisionNotes: (row.revision_notes as string) ?? undefined,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : undefined,
    rejectedAt: row.rejected_at ? (row.rejected_at as Date).toISOString() : undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const approvalsRepo = {
  async listPendingContentIdeas(): Promise<
    Array<{ entityType: string; entityId: string; clientId: string; clientName?: string; title: string; status: string; createdAt: string }>
  > {
    const { rows } = await pool.query(`
      SELECT i.id, i.client_id, i.title, i.created_at, c.name AS client_name
      FROM content_ideas i
      LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.status = 'pending_approval'
      ORDER BY i.created_at ASC
    `);
    return rows.map((row) => ({
      entityType: 'content_idea',
      entityId: row.id as string,
      clientId: row.client_id as string,
      clientName: (row.client_name as string) ?? undefined,
      title: row.title as string,
      status: 'pending',
      createdAt: (row.created_at as Date).toISOString(),
    }));
  },

  async create(data: {
    id: string;
    entityType: string;
    entityId: string;
    clientId: string;
    status: string;
    reviewerRole?: string;
    reviewerName?: string;
    notes?: string;
    revisionNotes?: string;
    approvedAt?: Date;
    rejectedAt?: Date;
  }): Promise<Approval> {
    const { rows } = await pool.query(
      `INSERT INTO approvals
        (id, entity_type, entity_id, client_id, status, reviewer_role, reviewer_name, notes, revision_notes, approved_at, rejected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        data.id,
        data.entityType,
        data.entityId,
        data.clientId,
        data.status,
        data.reviewerRole ?? null,
        data.reviewerName ?? null,
        data.notes ?? null,
        data.revisionNotes ?? null,
        data.approvedAt ?? null,
        data.rejectedAt ?? null,
      ]
    );
    return mapRow(rows[0]);
  },
};
