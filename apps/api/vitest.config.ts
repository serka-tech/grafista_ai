import { defineConfig } from 'vitest/config';

// Test mode is isolated from any real/shared database: globalSetup starts a
// throwaway embedded PostgreSQL instance (see src/test/global-setup.ts) on
// the fixed port/db name below and tears it down after the run. Never point
// this at a developer or production DATABASE_URL.
const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:54329/grafista_test';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './src/test/global-setup.ts',
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
    },
  },
});
