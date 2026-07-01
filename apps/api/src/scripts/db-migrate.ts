import { env } from '../config/env.js';
import { pool, closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

async function main() {
  console.log(`[migrate] connecting to ${env.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);
  await runMigrations(pool);
  await closePool();
  console.log('[migrate] all migrations up to date');
}

main().catch((err) => {
  console.error('[migrate] FAILED', err);
  process.exit(1);
});
