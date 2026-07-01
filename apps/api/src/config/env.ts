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
  AI_DEFAULT_PROVIDER: z.enum(['openai', 'claude'], {
    errorMap: () => ({ message: 'AI_DEFAULT_PROVIDER must be one of: openai, claude' }),
  }),
  API_PORT: z.coerce.number({ invalid_type_error: 'API_PORT must be a number' }).int().positive(),
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
