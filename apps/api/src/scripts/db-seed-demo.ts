/**
 * Grafista AI Studio — Demo seed (offline demo mode companion)
 *
 * Adds TWO design references WITH real PNG bytes in object storage to the
 * "Flavora Organic" sample client, so DesignDNA analysis works out of the box:
 * the base seed's three references are metadata-only (no storage columns) and
 * design-dna-analysis.ts skips them, which makes `analyze` 400 on a fresh
 * install. Pair with AI_DEFAULT_PROVIDER=fake (see .env.example DEMO MODE) to
 * run the full dashboard chain with no real AI keys and no network.
 *
 * Run order: `pnpm run db:migrate` then `pnpm run db:seed` first — this script
 * checks that the Flavora sample client exists and exits with a clear message
 * if not. Create a login user separately via `pnpm run db:seed-admin`.
 *
 * Idempotent: re-running never duplicates (references are looked up by their
 * fixed names below). If a reference row exists but its file is missing from
 * storage (e.g. apps/api/uploads/ was deleted), the bytes are re-written to
 * the row's recorded storage key.
 *
 * The reference-seeding loop is also exported as `seedDemoReferences()` so
 * db-seed-demo-all.ts (the one-command demo bootstrap) can reuse this exact,
 * already-tested step instead of duplicating it.
 */

import { pathToFileURL } from 'node:url';
import { v4 as uuid } from 'uuid';
import { pool, closePool } from '../db/pool.js';
import { designReferencesRepo } from '../db/repositories/design-references.js';
import { getStorageProvider, getStorageProviderByName } from '../storage/factory.js';

/** Fixed id of the "Flavora Organic" sample client — see src/db/seed.ts / database/seed/sample-data.sql. */
const SAMPLE_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/**
 * Real 64x64 solid-color PNGs (~137 bytes each), base64-encoded — generated once
 * with Node's zlib and embedded as constants so the seed needs no files and no
 * network. Colors are two Flavora brand tones (see sample-data.sql palette).
 */
const FOREST_GREEN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQQkAAAgEsEthC7vYP40RfAuDFVh66rUICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICFwWncwwiHY52NAAAAAASUVORK5CYII=';
const SUNSET_ORANGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsMtlS1sawwi+hcEKLNP1WgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELguBmTGWgioC/AAAAABJRU5ErkJggg==';

interface DemoReferenceSpec {
  /** Fixed name — the idempotency key for check-before-insert. */
  name: string;
  description: string;
  originalFilename: string;
  tags: string[];
  pngBase64: string;
}

const DEMO_REFERENCES: DemoReferenceSpec[] = [
  {
    name: 'Demo Reference 1 — Forest Green',
    description: 'Seeded demo reference with real image bytes (solid Forest Green #2D5016, 64x64 PNG).',
    originalFilename: 'demo-reference-1-forest-green.png',
    tags: ['demo', 'seeded'],
    pngBase64: FOREST_GREEN_PNG_BASE64,
  },
  {
    name: 'Demo Reference 2 — Sunset Orange',
    description: 'Seeded demo reference with real image bytes (solid Sunset Orange #E8913A, 64x64 PNG).',
    originalFilename: 'demo-reference-2-sunset-orange.png',
    tags: ['demo', 'seeded'],
    pngBase64: SUNSET_ORANGE_PNG_BASE64,
  },
];

async function ensureDemoReference(spec: DemoReferenceSpec): Promise<'created' | 'exists' | 'healed' | 'skipped'> {
  const existing = (await designReferencesRepo.listByClient(SAMPLE_CLIENT_ID)).find((ref) => ref.name === spec.name);
  const body = Buffer.from(spec.pngBase64, 'base64');

  if (existing) {
    if (!existing.storageProvider || !existing.storageKey || !existing.storageBucket) {
      console.warn(
        `[seed-demo] "${spec.name}" exists but has no storage columns — cannot repair in place. ` +
          'Delete that design_references row and re-run to recreate it with file bytes.'
      );
      return 'skipped';
    }
    // Row is fine — make sure the bytes are still in storage (self-heal if the
    // uploads dir / bucket object was wiped). Uses the provider the row was
    // actually stored on, not necessarily today's STORAGE_PROVIDER.
    const provider = getStorageProviderByName(existing.storageProvider);
    try {
      await provider.getObjectBuffer({ key: existing.storageKey });
      console.log(`[seed-demo] "${spec.name}" already exists with file bytes — skipping (idempotent)`);
      return 'exists';
    } catch {
      await provider.putObject({ key: existing.storageKey, body, contentType: 'image/png' });
      console.log(`[seed-demo] "${spec.name}" existed but its file was missing — re-wrote bytes to ${existing.storageKey}`);
      return 'healed';
    }
  }

  // New reference: storage write FIRST, row second (same order as the upload
  // route — a storage failure must never leave a metadata-only row behind).
  const id = uuid();
  const key = `design-references/${SAMPLE_CLIENT_ID}/${uuid()}.png`;
  const stored = await getStorageProvider().putObject({ key, body, contentType: 'image/png' });

  await designReferencesRepo.create({
    id,
    clientId: SAMPLE_CLIENT_ID,
    name: spec.name,
    description: spec.description,
    fileUrl: `/api/clients/${SAMPLE_CLIENT_ID}/design-references/${id}/file`,
    mimeType: 'image/png',
    fileSizeBytes: body.length,
    originalFilename: spec.originalFilename,
    storageProvider: stored.provider,
    storageKey: stored.key,
    storageBucket: stored.bucket,
    tags: spec.tags,
  });

  console.log(`[seed-demo] created "${spec.name}" (${body.length} bytes at ${stored.provider}:${stored.key})`);
  return 'created';
}

/**
 * Runs the DEMO_REFERENCES loop only — assumes the "Flavora Organic" sample
 * client already exists (callers that can't guarantee that, e.g. the CLI
 * `main()` below, must check first). Extracted so db-seed-demo-all.ts can
 * compose this exact, already-tested step without duplicating it; does NOT
 * call process.exit or closePool — safe to call from a longer-lived process.
 */
export async function seedDemoReferences(): Promise<string[]> {
  const results: string[] = [];
  for (const spec of DEMO_REFERENCES) {
    results.push(`${spec.name}: ${await ensureDemoReference(spec)}`);
  }
  return results;
}

async function main() {
  const { rows } = await pool.query('SELECT id, name FROM clients WHERE id = $1', [SAMPLE_CLIENT_ID]);
  if (rows.length === 0) {
    console.error(
      '[seed-demo] The "Flavora Organic" sample client is missing.\n' +
        'Run the base seed first: pnpm run db:migrate && pnpm run db:seed — then re-run pnpm run db:seed-demo.'
    );
    process.exit(1);
  }

  const results = await seedDemoReferences();

  console.log('\n[seed-demo] done.');
  for (const line of results) console.log(`  - ${line}`);
  console.log(
    '\nNext steps for the offline demo:\n' +
      '  1. In .env set AI_DEFAULT_PROVIDER=fake (see the DEMO MODE block in .env.example;\n' +
      '     OPENAI_API_KEY/ANTHROPIC_API_KEY just need any non-empty dummy value).\n' +
      '  2. Create a login user: pnpm run db:seed-admin (uses ADMIN_EMAIL/ADMIN_PASSWORD from the environment).\n' +
      '  3. Start the API + dashboard, log in, open the "Flavora Organic" client and run the chain:\n' +
      '     DesignDNA analyze/approve -> content ideas -> design brief -> layouts -> Creative QA ->\n' +
      '     visual generation -> production package -> render/export.'
  );

  await closePool();
}

// Only auto-run when this file is executed directly (`tsx db-seed-demo.ts`,
// i.e. `pnpm run db:seed-demo`) — not when imported for `seedDemoReferences`
// (e.g. by db-seed-demo-all.ts or its test), which must not trigger the CLI
// side effects (process.exit / closePool) as an import side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    console.error('[seed-demo] FAILED', err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
}
