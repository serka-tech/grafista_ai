import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  // Without this, pg's default is unset — a connection attempt that can't be
  // served (e.g. the pool's connections are all checked out, or Postgres is
  // refusing new connections) blocks indefinitely instead of failing with a
  // clear error. Surfacing a fast, diagnosable timeout here is strictly an
  // improvement over an opaque hang/"socket hang up" in both production and
  // the test suite (Production Step 4 investigation).
  connectionTimeoutMillis: 10_000,
});

// node-postgres requires an 'error' listener on the pool — without one, an
// idle client hitting a network blip or server restart crashes the whole
// process with an unhandled 'error' event instead of just losing that connection.
pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err.message);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
