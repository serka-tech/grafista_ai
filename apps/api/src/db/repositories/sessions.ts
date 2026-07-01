import { pool } from '../pool.js';

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
}

export const sessionsRepo = {
  async create(data: { id: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<Session> {
    const { rows } = await pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.id, data.userId, data.tokenHash, data.expiresAt]
    );
    return { id: rows[0].id, userId: rows[0].user_id, expiresAt: (rows[0].expires_at as Date).toISOString() };
  },

  /** Returns the session only if it exists, is unexpired, and unrevoked. */
  async findValidByTokenHash(tokenHash: string): Promise<Session | undefined> {
    const { rows } = await pool.query(
      `SELECT * FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    if (!rows[0]) return undefined;
    return { id: rows[0].id, userId: rows[0].user_id, expiresAt: (rows[0].expires_at as Date).toISOString() };
  },

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [
      tokenHash,
    ]);
  },
};
