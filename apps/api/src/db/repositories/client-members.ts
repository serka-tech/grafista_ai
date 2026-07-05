import { pool } from '../pool.js';

/**
 * Phase 3 Step 4 — client isolation hardening. Backing repository for the
 * additive client_members table (see database/migrations/021_client_members.sql).
 */
export const clientMembersRepo = {
  /**
   * Client ids this user is explicitly scoped to. An EMPTY array means the
   * user has no membership rows at all — callers must treat that as
   * "unrestricted" (today's pre-existing behavior for every current user),
   * NOT as "restricted to nothing".
   */
  async listClientIdsForUser(userId: string): Promise<string[]> {
    const { rows } = await pool.query('SELECT client_id FROM client_members WHERE user_id = $1', [userId]);
    return rows.map((r) => r.client_id as string);
  },

  async addMember(userId: string, clientId: string): Promise<void> {
    await pool.query(
      `INSERT INTO client_members (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, clientId]
    );
  },
};
