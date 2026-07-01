import { pool } from '../pool.js';

export interface User {
  id: string;
  email: string;
  name?: string;
  status: string;
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

  async create(data: { id: string; email: string; passwordHash: string; name?: string }): Promise<User> {
    const { rows } = await pool.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.id, data.email.toLowerCase(), data.passwordHash, data.name ?? null]
    );
    return mapRow(rows[0]);
  },

  async assignRole(userId: string, roleName: string): Promise<void> {
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = $2
       ON CONFLICT DO NOTHING`,
      [userId, roleName]
    );
  },

  /** Loads a user with their aggregated roles and permissions, fresh from the DB on every call. */
  async getWithAccess(userId: string): Promise<UserWithAccess | undefined> {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) return undefined;

    const { rows: roleRows } = await pool.query(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [userId]
    );
    const { rows: permRows } = await pool.query(
      `SELECT DISTINCT p.key FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = $1`,
      [userId]
    );

    return {
      ...mapRow(rows[0]),
      roles: roleRows.map((r) => r.name as string),
      permissions: permRows.map((p) => p.key as string),
    };
  },
};
