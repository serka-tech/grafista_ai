import { pool } from '../pool.js';

/**
 * Packaging Phase A — org invites. Mirrors the sessions repo's token pattern
 * (only the HMAC-SHA256 token_hash is stored, never the raw token — see
 * auth/session-token.ts). An invite is single-use (accepted_at) and time-bound
 * (expires_at). See database/migrations/028_invites_and_org_permission.sql.
 */
export interface Invite {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  invitedBy?: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

function mapRow(row: Record<string, unknown>): Invite {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    email: row.email as string,
    role: row.role as string,
    invitedBy: (row.invited_by as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    expiresAt: (row.expires_at as Date).toISOString(),
    acceptedAt: row.accepted_at ? (row.accepted_at as Date).toISOString() : undefined,
  };
}

export const invitesRepo = {
  async create(data: {
    id: string;
    organizationId: string;
    email: string;
    role: string;
    tokenHash: string;
    invitedBy?: string;
    expiresAt: Date;
  }): Promise<Invite> {
    const { rows } = await pool.query(
      `INSERT INTO invites (id, organization_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.id, data.organizationId, data.email.toLowerCase(), data.role, data.tokenHash, data.invitedBy ?? null, data.expiresAt]
    );
    return mapRow(rows[0]);
  },

  /** Returns the invite only if it exists, is unaccepted, and unexpired. */
  async findValidByTokenHash(tokenHash: string): Promise<Invite | undefined> {
    const { rows } = await pool.query(
      `SELECT * FROM invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async markAccepted(id: string): Promise<void> {
    await pool.query('UPDATE invites SET accepted_at = NOW() WHERE id = $1 AND accepted_at IS NULL', [id]);
  },

  /** Pending (unaccepted, unexpired) invites for an org — newest first. */
  async listPendingByOrg(organizationId: string): Promise<Invite[]> {
    const { rows } = await pool.query(
      `SELECT * FROM invites
       WHERE organization_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [organizationId]
    );
    return rows.map(mapRow);
  },
};
