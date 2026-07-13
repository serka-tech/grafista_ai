import { pool } from '../pool.js';

export interface User {
  id: string;
  email: string;
  name?: string;
  status: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserWithAuth extends User {
  passwordHash: string;
}

export interface UserWithAccess extends User {
  roles: string[];
  permissions: string[];
}

function mapRow(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    name: (row.name as string) ?? undefined,
    status: row.status as string,
    organizationId: row.organization_id as string,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const usersRepo = {
  async findByEmail(email: string): Promise<UserWithAuth | undefined> {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!rows[0]) return undefined;
    return { ...mapRow(rows[0]), passwordHash: rows[0].password_hash as string };
  },

  async create(data: {
    id: string;
    email: string;
    passwordHash: string;
    name?: string;
    /**
     * Founding-tenant deploys omit this and the column DEFAULT (see
     * 027_organizations.sql) places the user in the Grafista Ajans org.
     * Invite acceptance passes the inviter's org so the new user lands in
     * exactly that tenant.
     */
    organizationId?: string;
  }): Promise<User> {
    const { rows } = data.organizationId
      ? await pool.query(
          `INSERT INTO users (id, email, password_hash, name, organization_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [data.id, data.email.toLowerCase(), data.passwordHash, data.name ?? null, data.organizationId]
        )
      : await pool.query(
          `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4) RETURNING *`,
          [data.id, data.email.toLowerCase(), data.passwordHash, data.name ?? null]
        );
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<User | undefined> {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async assignRole(userId: string, roleName: string): Promise<void> {
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = $2
       ON CONFLICT DO NOTHING`,
      [userId, roleName]
    );
  },

  /**
   * Replaces ALL of a user's roles with exactly one (the org team UI models a
   * single role per member). Caller MUST validate roleName against ROLES first
   * so the INSERT cannot leave the user role-less. delete + insert run back to
   * back on the shared pool.
   */
  async replaceRole(userId: string, roleName: string): Promise<void> {
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2`,
      [userId, roleName]
    );
  },

  async updateStatus(id: string, status: 'active' | 'disabled'): Promise<User | undefined> {
    const { rows } = await pool.query('UPDATE users SET status = $2 WHERE id = $1 RETURNING *', [id, status]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  /** Org team roster: every user in the org with their aggregated role names. */
  async listByOrg(
    organizationId: string
  ): Promise<Array<{ id: string; email: string; name?: string; status: string; roles: string[]; createdAt: string }>> {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.status, u.created_at,
         COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.organization_id = $1
       GROUP BY u.id
       ORDER BY u.created_at ASC`,
      [organizationId]
    );
    return rows.map((row) => ({
      id: row.id as string,
      email: row.email as string,
      name: (row.name as string) ?? undefined,
      status: row.status as string,
      roles: (row.roles as string[]) ?? [],
      createdAt: (row.created_at as Date).toISOString(),
    }));
  },

  /** Loads a user with their aggregated roles and permissions, fresh from the DB on every call. */
  async getWithAccess(userId: string): Promise<UserWithAccess | undefined> {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) return undefined;

    const [{ rows: roleRows }, { rows: permRows }] = await Promise.all([
      pool.query(
        `SELECT r.name FROM roles r
         JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT DISTINCT p.key FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN user_roles ur ON ur.role_id = rp.role_id
         WHERE ur.user_id = $1`,
        [userId]
      ),
    ]);

    return {
      ...mapRow(rows[0]),
      roles: roleRows.map((r) => r.name as string),
      permissions: permRows.map((p) => p.key as string),
    };
  },
};
