import { pool } from '../pool.js';

export interface Client {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  status: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientWithCounts extends Client {
  brandAssetsCount: number;
  designReferencesCount: number;
}

const ALLOWED_UPDATE_FIELDS: Record<string, string> = {
  name: 'name',
  industry: 'industry',
  website: 'website',
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  status: 'status',
  notes: 'notes',
};

function mapRow(row: Record<string, unknown>): Client {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    industry: (row.industry as string) ?? undefined,
    website: (row.website as string) ?? undefined,
    contactName: (row.contact_name as string) ?? undefined,
    contactEmail: (row.contact_email as string) ?? undefined,
    status: row.status as string,
    notes: (row.notes as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export const clientsRepo = {
  async listWithCounts(): Promise<ClientWithCounts[]> {
    const { rows } = await pool.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM brand_assets a WHERE a.client_id = c.id) AS brand_assets_count,
        (SELECT COUNT(*) FROM design_references d WHERE d.client_id = c.id) AS design_references_count
      FROM clients c
      ORDER BY c.created_at ASC
    `);
    return rows.map((row) => ({
      ...mapRow(row),
      brandAssetsCount: Number(row.brand_assets_count),
      designReferencesCount: Number(row.design_references_count),
    }));
  },

  async getById(id: string): Promise<Client | undefined> {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  },

  async create(data: {
    id: string;
    name: string;
    slug: string;
    industry?: string;
    website?: string;
    contactName?: string;
    contactEmail?: string;
    notes?: string;
  }): Promise<Client> {
    const { rows } = await pool.query(
      `INSERT INTO clients (id, name, slug, industry, website, contact_name, contact_email, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        data.id,
        data.name,
        data.slug,
        data.industry ?? null,
        data.website ?? null,
        data.contactName ?? null,
        data.contactEmail ?? null,
        data.notes ?? null,
      ]
    );
    return mapRow(rows[0]);
  },

  async update(id: string, patch: Record<string, unknown>): Promise<Client | undefined> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = ALLOWED_UPDATE_FIELDS[key];
      if (!column) continue;
      values.push(value);
      setClauses.push(`${column} = $${values.length}`);
    }
    if (setClauses.length === 0) {
      return this.getById(id);
    }
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE clients SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  },
};
