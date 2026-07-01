import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

// node-postgres requires an 'error' listener on the pool — without one, an
// idle client hitting a network blip or server restart crashes the whole
// process with an unhandled 'error' event instead of just losing that connection.
pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err.message);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
