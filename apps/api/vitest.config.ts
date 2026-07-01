import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      OPENAI_API_KEY: 'sk-test-fake-key-for-smoke-tests',
      ANTHROPIC_API_KEY: 'sk-ant-test-fake-key-for-smoke-tests',
      AI_DEFAULT_PROVIDER: 'openai',
      API_PORT: '4999',
    },
  },
});
