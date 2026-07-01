import { pool, closePool } from '../db/pool.js';
import { runSeed } from '../db/seed.js';

async function main() {
  await runSeed(pool);
  await closePool();
}

main().catch((err) => {
  console.error('[seed] FAILED', err);
  process.exit(1);
});
