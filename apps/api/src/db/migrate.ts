/**
 * Grafista AI Studio — Migration Runner
 *
 * Applies database/migrations/*.sql in filename order, tracked in a
 * schema_migrations table so re-running is a no-op. The pgvector migration
 * is best-effort: no Phase 1/2 feature reads or writes vector columns yet,
 * so a Postgres instance without the `vector` extension available (e.g. a
 * bare local install) skips it with a warning instead of failing the run.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../database/migrations');

function isMissingExtensionError(err: unknown): boolean {
  return err instanceof Error && /extension "vector" is not available|could not open extension control file/i.test(err.message);
}

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (rows.length > 0) {
      console.log(`[migrate] skip ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[migrate] applying ${file}...`);
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      if (isMissingExtensionError(err)) {
        console.warn(
          `[migrate] WARNING: skipping ${file} — the "vector" extension is not available on this ` +
            'Postgres instance. Vector embedding columns/search will be unavailable; no current ' +
            'feature reads or writes them.'
        );
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        continue;
      }
      throw err;
    }
  }
}
