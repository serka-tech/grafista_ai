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
    },
  },
});
