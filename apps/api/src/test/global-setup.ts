/**
 * Grafista AI Studio — Vitest Global Setup (isolated test database)
 *
 * Spins up a fresh, ephemeral, real PostgreSQL instance (embedded-postgres —
 * a real Postgres binary run as a local subprocess, not a mock/fake) with its
 * own throwaway data directory, runs migrations + seed against it, and points
 * DATABASE_URL at it. Torn down after the test run; never touches a shared
 * or developer database.
 */

import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../.test-pgdata');
const PORT = 54329;
const TEST_DB_NAME = 'grafista_test';

let embeddedPg: EmbeddedPostgres | undefined;

export async function setup(): Promise<void> {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  embeddedPg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
  });

  await embeddedPg.initialise();
  await embeddedPg.start();
  await embeddedPg.createDatabase(TEST_DB_NAME);

  const databaseUrl = `postgresql://postgres:postgres@localhost:${PORT}/${TEST_DB_NAME}`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.OPENAI_API_KEY ??= 'sk-test-fake-key-for-smoke-tests';
  process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test-fake-key-for-smoke-tests';
  process.env.AI_DEFAULT_PROVIDER ??= 'openai';
  process.env.API_PORT ??= '4999';

  const pool = new Pool({ connectionString: databaseUrl });
  const { runMigrations } = await import('../db/migrate.js');
  const { runSeed } = await import('../db/seed.js');
  await runMigrations(pool);
  await runSeed(pool);
  await pool.end();
}

export async function teardown(): Promise<void> {
  if (embeddedPg) {
    await embeddedPg.stop();
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
