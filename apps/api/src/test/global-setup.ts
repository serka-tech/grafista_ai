/**
 * Grafista AI Studio — Vitest Global Setup (isolated test database)
 *
 * Spins up a fresh, ephemeral, real PostgreSQL instance (embedded-postgres —
 * a real Postgres binary run as a local subprocess, not a mock/fake) with its
 * own throwaway data directory, runs migrations + seed against it, seeds one
 * test user per role, and points DATABASE_URL at it. Torn down after the
 * test run; never touches a shared or developer database.
 */

import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../.test-pgdata');
const PORT = 54329;
const TEST_DB_NAME = 'grafista_test';

export const TEST_USER_PASSWORD = 'Password123!';
export const TEST_USERS = {
  OWNER: 'owner@test.local',
  CREATIVE_DIRECTOR: 'director@test.local',
  DESIGNER: 'designer@test.local',
  CONTENT_MANAGER: 'contentmanager@test.local',
} as const;

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
  process.env.AUTH_SECRET ??= 'test-auth-secret-not-for-production-use-only';
  process.env.COOKIE_SECURE ??= 'false';

  const pool = new Pool({ connectionString: databaseUrl });
  const { runMigrations } = await import('../db/migrate.js');
  const { runSeed } = await import('../db/seed.js');
  const { usersRepo } = await import('../db/repositories/users.js');
  const { hashPassword } = await import('../auth/password.js');

  await runMigrations(pool);
  await runSeed(pool);

  const passwordHash = await hashPassword(TEST_USER_PASSWORD);
  for (const [role, email] of Object.entries(TEST_USERS)) {
    const user = await usersRepo.create({ id: uuid(), email, passwordHash, name: `Test ${role}` });
    await usersRepo.assignRole(user.id, role);
  }

  await pool.end();
}

export async function teardown(): Promise<void> {
  if (embeddedPg) {
    await embeddedPg.stop();
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
