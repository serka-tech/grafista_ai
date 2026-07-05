/**
 * Grafista AI Studio — Shared AI JSON Call Helper (Phase 3 Step 3)
 *
 * One generic "complete -> parse -> validate, with limited schema retry" flow
 * for every AI-backed service (layout-generation, creative-qa,
 * design-dna-analysis, visual-generation). Before this helper each service
 * carried its own copy of parseJsonFromModelOutput + logAiCall +
 * providerError/schemaError, and NONE of them retried when a syntactically
 * fine response failed zod validation — the exact N1 flake from
 * docs/manual-demo-pass.md (real OpenAI occasionally returns a
 * schema-violating layout alternative; a manual retry succeeds).
 *
 * Behavior:
 *   - Transport-level failures (response.success === false) are NOT retried
 *     here — the ModelRouter already applies the classified retry policy
 *     (packages/model-router/src/provider-errors.ts). They surface as a
 *     'provider' failure outcome immediately.
 *   - JSON-parse and schema-validation failures get up to `schemaRetries`
 *     (default 1) automatic re-calls with the SAME prompt — the least
 *     invasive option; the flake is nondeterministic sampling, not a prompt
 *     defect.
 *   - The helper never throws: it returns a discriminated outcome so callers
 *     with persistence semantics (visual-generation writes a 'failed' row
 *     AFTER the final attempt) stay in control. `aiCallError()` converts a
 *     failure outcome into the 502 error services throw.
 *
 * Logging carries provider/model/usage/latency and attempt counts only —
 * never prompts, raw model payloads beyond the adapters' own error strings,
 * and never secrets.
 */

import { ModelRouter, type AIRequest, type AIResponse } from '@grafista/model-router';

/** Default number of automatic re-calls after a JSON/schema validation failure. */
export const DEFAULT_SCHEMA_RETRIES = 1;

/** Tolerates markdown code fences around the model's JSON output (shared cleanup, formerly copied per service). */
export function parseJsonFromModelOutput(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

export type ValidateResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type AiJsonFailureStage = 'provider' | 'invalid_json' | 'schema_validation';

export type AiJsonCallOutcome<T> =
  | { ok: true; data: T; response: AIResponse; attempts: number }
  | { ok: false; stage: AiJsonFailureStage; response: AIResponse; errorMessage: string; attempts: number };

export interface AiJsonCallOptions<T> {
  router: ModelRouter;
  request: AIRequest;
  /** Task context used in error messages, e.g. 'layout_generation' or 'style_analysis, reference <id>'. */
  context: string;
  /** Service log prefix WITHOUT brackets, e.g. 'layout-generation'. */
  logPrefix: string;
  /** Automatic re-calls after a parse/schema failure (default DEFAULT_SCHEMA_RETRIES). */
  schemaRetries?: number;
  /** Optional deterministic normalization applied to the parsed JSON BEFORE validation
   * (e.g. creative-qa's QA-check-status synonym mapping, or adding server-controlled fields). */
  transform?: (raw: unknown) => unknown;
  /** Validates the (transformed) parsed output; returns the typed data or a description of why it failed. */
  validate: (raw: unknown) => ValidateResult<T>;
}

function logAiResponse(logPrefix: string, context: string, response: AIResponse, attempt: number): void {
  const attemptNote = attempt > 1 ? ` serviceAttempt=${attempt}` : '';
  if (response.success) {
    console.log(
      `[${logPrefix}] ${context} ok — provider=${response.provider} model=${response.model} ` +
        `tokens(in/out/total)=${response.usage.inputTokens}/${response.usage.outputTokens}/${response.usage.totalTokens} ` +
        `estimatedCost=${response.usage.estimatedCost ?? 'n/a'} latencyMs=${response.latencyMs}${attemptNote}`
    );
  } else {
    console.error(
      `[${logPrefix}] ${context} FAILED — provider=${response.provider} latencyMs=${response.latencyMs} ` +
        `errorKind=${response.errorKind ?? 'n/a'} error=${response.error}${attemptNote}`
    );
  }
}

/**
 * Runs one logical AI JSON task with limited schema-validation retry (the N1
 * hotfix). See the module docblock for the exact retry semantics.
 */
export async function callAiForJson<T>(options: AiJsonCallOptions<T>): Promise<AiJsonCallOutcome<T>> {
  const schemaRetries = options.schemaRetries ?? DEFAULT_SCHEMA_RETRIES;
  const maxAttempts = 1 + Math.max(0, schemaRetries);

  let lastFailure: { stage: AiJsonFailureStage; response: AIResponse; errorMessage: string } | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await options.router.complete(options.request);
    logAiResponse(options.logPrefix, options.context, response, attempt);

    if (!response.success) {
      // Transport failures already went through the router's classified retry —
      // re-calling here would just repeat that whole cycle for a non-schema problem.
      return {
        ok: false,
        stage: 'provider',
        response,
        errorMessage: response.error ?? 'AI provider error',
        attempts: attempt,
      };
    }

    let raw: unknown;
    try {
      raw = parseJsonFromModelOutput(response.content);
    } catch (err) {
      lastFailure = {
        stage: 'invalid_json',
        response,
        errorMessage: `AI response was not valid JSON (${options.context}): ${err instanceof Error ? err.message : String(err)}`,
      };
      if (attempt < maxAttempts) {
        console.warn(
          `[${options.logPrefix}] ${options.context} returned invalid JSON (attempt ${attempt}/${maxAttempts}) — retrying with the same prompt`
        );
        continue;
      }
      break;
    }

    const transformed = options.transform ? options.transform(raw) : raw;
    const validated = options.validate(transformed);
    if (validated.ok) {
      return { ok: true, data: validated.data, response, attempts: attempt };
    }

    lastFailure = {
      stage: 'schema_validation',
      response,
      errorMessage: `AI response failed schema validation (${options.context}): ${validated.error}`,
    };
    if (attempt < maxAttempts) {
      console.warn(
        `[${options.logPrefix}] ${options.context} failed schema validation (attempt ${attempt}/${maxAttempts}) — retrying with the same prompt`
      );
    }
  }

  // lastFailure is always set when the loop finishes without returning.
  const failure = lastFailure!;
  const errorMessage =
    maxAttempts > 1 ? `${failure.errorMessage} — after ${maxAttempts} attempts (automatic retry exhausted)` : failure.errorMessage;
  return { ok: false, stage: failure.stage, response: failure.response, errorMessage, attempts: maxAttempts };
}

/**
 * Converts a failure outcome into the `{ status: 502 }` error every AI-backed
 * service throws, preserving the pre-existing message shapes
 * ("AI provider error…", "AI response was not valid JSON…",
 * "AI response failed schema validation…") that tests, logs and the dashboard
 * message mapper already understand.
 */
export function aiCallError(outcome: Extract<AiJsonCallOutcome<unknown>, { ok: false }>): Error & { status: number } {
  return Object.assign(new Error(outcome.errorMessage), { status: 502 });
}
