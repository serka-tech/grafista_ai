import { configDefaults, defineConfig } from 'vitest/config';

// Test mode is isolated from any real/shared database: globalSetup starts a
// throwaway embedded PostgreSQL instance (see src/test/global-setup.ts) on
// the fixed port/db name below and tears it down after the run. Never point
// this at a developer or production DATABASE_URL.
const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:54329/grafista_test';

export default defineConfig({
  test: {
    environment: 'node',
    // `tsc -p tsconfig.build.json` compiles the *.test.ts files into dist/ too,
    // and without this exclude vitest collected those compiled .test.js copies
    // ALONGSIDE their src/ originals — every pure-unit test ran twice and the
    // suite totals were inflated (discovered in Phase 2 Step 10: 321 collected
    // vs 274 unique). Spreading configDefaults.exclude keeps vitest's own
    // defaults (node_modules etc) intact rather than replacing them.
    exclude: [...configDefaults.exclude, '**/dist/**'],
    globalSetup: './src/test/global-setup.ts',
    // Runs INSIDE every test file (unlike globalSetup, which runs once for
    // the whole run) — closes that file's db/pool.ts Pool singleton after its
    // own tests finish. See src/test/pool-teardown.ts for why (Production
    // Step 4: an unclosed pool per file was accumulating Postgres connections
    // across the run).
    setupFiles: ['./src/test/pool-teardown.ts'],
    env: {
      OPENAI_API_KEY: 'sk-test-fake-key-for-smoke-tests',
      ANTHROPIC_API_KEY: 'sk-ant-test-fake-key-for-smoke-tests',
      AI_DEFAULT_PROVIDER: 'openai',
      API_PORT: '4999',
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: 'test-auth-secret-not-for-production-use-only',
      COOKIE_SECURE: 'false',
      // Default storage provider for the suite is local disk — individual tests that need to
      // exercise the S3 code path (mocked) override process.env.STORAGE_PROVIDER for the
      // duration of that test only (see storage.test.ts) and restore it afterwards.
      STORAGE_PROVIDER: 'local',
      // Small limit so the "oversized file rejected" test doesn't need to allocate/upload a
      // real 50MB buffer — production default (50MB, see .env.example) is untouched.
      UPLOAD_MAX_SIZE_MB: '2',
      // Default renderer for the suite is the deterministic fake adapter (see
      // apps/api/src/render/adapters/fake-adapter.ts) — the suite must never launch a real
      // Playwright/Chromium browser. Production default (RENDERER_PROVIDER unset -> 'playwright',
      // see .env.example) is untouched.
      RENDERER_PROVIDER: 'fake',
    },
  },
});
