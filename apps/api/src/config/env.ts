/**
 * Grafista AI Studio — Environment Validation (Phase 1)
 *
 * Fails fast at startup if a required environment variable is missing or
 * invalid, instead of silently degrading into mock/placeholder behavior.
 */

import { z } from 'zod';

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required — set it in .env'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required — set it in .env'),
  // 'fake' enables the offline demo mode: every AI call is answered by the
  // deterministic FakeAIAdapter (packages/model-router/src/providers/fake.ts)
  // with no network and no real keys. OPENAI_API_KEY/ANTHROPIC_API_KEY must
  // still be non-empty at boot (any dummy string) — see .env.example.
  AI_DEFAULT_PROVIDER: z.enum(['openai', 'claude', 'fake'], {
    errorMap: () => ({ message: 'AI_DEFAULT_PROVIDER must be one of: openai, claude, fake' }),
  }),
  API_PORT: z.coerce.number({ invalid_type_error: 'API_PORT must be a number' }).int().positive(),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required — set it in .env (e.g. postgresql://user:password@localhost:5432/grafista)')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),
  AUTH_SECRET: z
    .string()
    .min(16, 'AUTH_SECRET is required and must be at least 16 characters — set it in .env'),
  COOKIE_SECURE: z
    .enum(['true', 'false'], { errorMap: () => ({ message: 'COOKIE_SECURE must be "true" or "false"' }) })
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    console.error(
      `\n[Config Error] Grafista API cannot start — invalid or missing environment variables:\n${issues}\n\n` +
        'See .env.example for the full list of required variables.\n'
    );
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
