/**
 * Grafista AI Studio — Seed the first OWNER user
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD directly from process.env (not the
 * global fail-fast EnvSchema — the API server itself never needs the admin
 * password to run, only this one-off setup script does). Idempotent: skips
 * if a user with that email already exists.
 */

import { v4 as uuid } from 'uuid';
import { pool, closePool } from '../db/pool.js';
import { usersRepo } from '../db/repositories/users.js';
import { hashPassword } from '../auth/password.js';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      '[seed-admin] ADMIN_EMAIL and ADMIN_PASSWORD must both be set in the environment to seed the admin user.\n' +
        'See .env.example.'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('[seed-admin] ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const existing = await usersRepo.findByEmail(email);
  if (existing) {
    console.log(`[seed-admin] user ${email} already exists — skipping (idempotent)`);
    await closePool();
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await usersRepo.create({ id: uuid(), email, passwordHash, name: 'Owner' });
  await usersRepo.assignRole(user.id, 'OWNER');

  console.log(`[seed-admin] created OWNER user: ${user.email}`);
  await closePool();
}

main().catch(async (err) => {
  console.error('[seed-admin] FAILED', err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
