/**
 * Grafista AI Studio — Seed Runner
 *
 * Idempotent: skips if the sample "Flavora Organic" client already exists.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.resolve(__dirname, '../../../../database/seed/sample-data.sql');
const SAMPLE_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

export async function runSeed(pool: Pool): Promise<void> {
  const { rows } = await pool.query('SELECT id FROM clients WHERE id = $1', [SAMPLE_CLIENT_ID]);
  if (rows.length > 0) {
    console.log('[seed] sample client already exists — skipping (idempotent)');
    return;
  }

  const sql = fs.readFileSync(SEED_FILE, 'utf8');
  console.log('[seed] inserting sample data...');
  await pool.query(sql);
  console.log('[seed] done');
}
