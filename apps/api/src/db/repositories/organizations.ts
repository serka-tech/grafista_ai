import { pool } from '../pool.js';

/**
 * Packaging Phase A — organizations (the tenant boundary). See
 * database/migrations/027_organizations.sql. Phase A has no in-app "create a
 * new org" endpoint (that provisioning UI is Phase B); create() exists for
 * seeds/tests and the future provisioning path.
 */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: Record<string, unknown>): Organization {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    status: row.status as string,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const organizationsRepo = {
  async create(data: { id?: string; name: string; slug: string }): Promise<Organization> {
    const { rows } = data.id
      ? await pool.query(
          `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3) RETURNING *`,
          [data.id, data.name, data.slug]
        )
      : await pool.query(`INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING *`, [data.name, data.slug]);
    return mapRow(rows[0]);
  },

  async getById(id: string): Promise<Organization | undefined> {
    const { rows } = await pool.query('SELECT * FROM organizations WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
